package com.margelo.nitro.nitroui.core

import android.app.Activity
import android.content.Context
import android.os.Build
import android.view.View
import android.widget.FrameLayout
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.IntState
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.platform.AbstractComposeView
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.compose.ui.platform.ViewCompositionStrategy.DisposeOnLifecycleDestroyed
import android.view.ViewTreeObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.savedstate.SavedStateRegistryOwner
import androidx.lifecycle.findViewTreeLifecycleOwner
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.savedstate.findViewTreeSavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import java.lang.ref.WeakReference

/** An immutable size in dp, safe to publish across threads with a `@Volatile`. */
data class NitroUiDpSize(val width: Double, val height: Double)

/**
 * Hosts one component's Compose content: a `FrameLayout` around one [AbstractComposeView].
 * Fabric measures a view before it has a window, and `AbstractComposeView` throws when
 * measured detached, so the wrapper declines those measures and runs them after attach.
 */
abstract class NitroComposeHost<M : NitroUiModel>(
  context: Context,
  /** `reactContext.currentActivity`, for the owners RN may not have set. */
  private val activity: Activity?,
  protected val model: M,
) : FrameLayout(context) {

  /**
   * Whether a `Form.Row`'s cell owns this view's press, which makes the view that row's content
   * and its box the row's. Only an item drawn inside a row hands its `onPress` up to the cell; a
   * control that answers its own taps leaves this `false`.
   */
  open val pressOwnedByRow: Boolean
    get() = false

  var perfInstanceId: Int = NitroUiPerf.NO_INSTANCE

  var sizingInstanceId: Long = NitroUiSizing.NO_INSTANCE

  /**
   * [NitroUiSizing.POLICY_INTRINSIC] when the control sizes itself,
   * [NitroUiSizing.POLICY_FILL_WIDTH] when its width comes from Yoga's box.
   */
  var sizingPolicy: Int = NitroUiSizing.POLICY_INTRINSIC

  /** Whether [contentSize] is recorded. Off by default because it costs every measure pass. */
  var wantsContentSize: Boolean = false

  /** Last measured content size in dp, or null. Written on the UI thread, read from any. */
  @Volatile var contentSize: NitroUiDpSize? = null
    private set

  private var isDirty = true
  private var hasMarkedFirstFrame = false
  private var firstFrameWatchRegistered = false

  private val lifetime = NitroUiLifetimeGate()

  val lifetimeDrops: Int
    get() = lifetime.drops

  val lifetimeRecycles: Int
    get() = lifetime.recycles

  val measuresAfterDrop: Int
    get() = processMeasuresAfterDrop

  val layoutsAfterDrop: Int
    get() = processLayoutsAfterDrop

  // Kept with the observer it was registered on: a detached view's `viewTreeObserver` is a new
  // floating one, so removing through it would leave the listener on the window's observer.
  private var firstFrameWatch: PreDrawWatch? = null

  private var flushWatch: PreDrawWatch? = null

  private var strategyArmed = false

  // Whether this mount ever armed each guard, even if it has been released since.
  private var everArmedStrategy = false
  private var everArmedPreDraw = false

  // The size last sent to the sizing engine, in dp. Only saves the JNI call for a repeat.
  private var lastReportedSize: NitroUiDpSize? = null

  private var sizingKeyChangePending = false
  // While set, measured sizes are not sent to the sizing engine. The engine files a report
  // under the key of the last shadow measure, which between a native-side change and the next
  // props batch still names the content that was replaced.
  private var sizingReportsHeld = false

  // The last size measured while reports were held, filed when the hold is released.
  private var heldContentSize: NitroUiDpSize? = null

  // Read by the measure block of [NitroUiMeasuredRoot], so a write marks that node
  // measure-dirty. Compose does not re-measure a mounted control when only its box moved.
  private val remeasureToken = mutableIntStateOf(0)

  // Counts content changes. The composition reads it, not the measure block: a props batch
  // measures the host before it recomposes, so a live read would name content not yet rendered.
  private val contentRevision = mutableIntStateOf(0)

  // Tracks content wider than its box. Left alone, an `intrinsic` control would draw at its
  // own width, centred, and be clipped at both ends by the host's bounds.
  private val overWidePlacement = NitroUiOverWidePlacement()

  // One stable reference: a new lambda per recomposition would recompose [NitroUiMeasuredRoot].
  private val noteOverWide: (Boolean) -> Unit = ::noteOverWideContent

  private var flushScheduled = false

  // True until a measure has run with a window; set again whenever one is declined.
  private var isMeasurePending = true

  // Null when the activity is not a `LifecycleOwner`; Compose's default strategy then stays.
  private val owner: LifecycleOwner? = activity as? LifecycleOwner

  private val savedStateOwner: SavedStateRegistryOwner? =
    activity as? SavedStateRegistryOwner

  private val composeContent: ComposeContent = ComposeContent(context)

  init {
    addView(
      composeContent,
      LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT),
    )
  }

  @Composable
  protected abstract fun Component(model: M)

  // MARK: - Hosted mode

  /**
   * Whether a [NitroUiHostView] composes this control instead of [composeContent]. Only a direct
   * parent counts. Read from the view tree because RN can re-parent a view at any time.
   */
  internal val isHostedByParent: Boolean
    get() = parent is NitroUiHostView

  /**
   * Renders this control inside the Host's composition. No theme or measured root of its own:
   * the Host provides the theme, and Yoga does not lay a hosted control out.
   */
  @Composable
  internal fun HostedContent() {
    Component(model)
  }

  /**
   * Whether a [NitroUiHostView] may compose this control. Decided natively because React
   * flattens wrapper components, so JS cannot always see what becomes a Host's direct child.
   */
  internal open val isHostable: Boolean
    get() = false

  /** What RN last asked this view to show. `display: 'none'` arrives as `INVISIBLE`. */
  private var visibilityRequestedByRn: Int = VISIBLE

  /**
   * Whether RN hid this child. A Host draws its children, so hiding the child's own view does
   * nothing: the Host has to leave it out of the composition.
   */
  internal val isHiddenByReact: Boolean
    get() = visibilityRequestedByRn == INVISIBLE

  override fun setVisibility(visibility: Int) {
    val changedByRn = visibilityRequestedByRn != visibility
    visibilityRequestedByRn = visibility
    super.setVisibility(visibility)
    if (changedByRn && isHostedByParent) {
      (parent as? NitroUiHostView)?.hostedChildVisibilityChanged()
    }
  }

  // Not what hides a hosted child: Fabric re-asserts visibility and the RN frame on every
  // layout pass, so the child is kept out of the way by measuring it 0 x 0 in [onMeasure].
  private fun applyHostedDrawFlag() {
    if (isHostedByParent) {
      setWillNotDraw(true)
    }
  }

  /**
   * Whether content is centred in the box RN gave it. A composable may be smaller than its box
   * (a Material 3 Switch inside its 48 dp touch target). A container overrides this.
   */
  protected open val centersContent: Boolean
    get() = true

  // Built once per instance: there is no `setContent` per props update.
  @Composable
  private fun Content() {
    NitroUiTheme {
      NitroUiMeasuredRoot(
        centered = centersContent,
        record = wantsContentSize,
        unbounded = wantsContentSize && sizingPolicy == NitroUiSizing.POLICY_INTRINSIC,
        remeasureToken = remeasureToken,
        contentRevision = contentRevision,
        overWide = overWidePlacement,
        onMeasured = ::recordMeasuredSize,
        onOverWide = noteOverWide,
      ) {
        Component(model)
      }
    }
  }

  private inner class ComposeContent(
    context: Context,
  ) : AbstractComposeView(context) {
    @Composable
    override fun Content() {
      this@NitroComposeHost.Content()
    }

    override fun onAttachedToWindow() {
      super.onAttachedToWindow()
      if (isHostedByParent) {
        // A control that moved into a Host after composing still holds its own composition
        // and guards. Drop them so it is composed in exactly one place.
        disposeComposition()
        releaseOwnCompositionGuards()
      }
      // The first moment with a window. If Fabric already laid this view out, run the
      // measure that was declined.
      runPendingMeasure()
    }

    // `AbstractComposeView` composes on attach by default. A hosted control must not build
    // a composition of its own, and attach cannot be avoided.
    override val shouldCreateCompositionOnAttachedToWindow: Boolean
      get() = !isHostedByParent
  }

  // MARK: - Updating

  /** Called by prop setters: record that something rendered changed. */
  fun markDirty() {
    contentRevision.intValue += 1
    isDirty = true
  }

  /**
   * Applies model writes made outside a Compose event handler or a props batch. Such a write
   * lands in the global snapshot, and nothing repaints it until the next [commit].
   */
  fun applyModelWrites() {
    Snapshot.sendApplyNotifications()
  }

  /**
   * Applies the batch; called once per `updateState`. The apply notification makes the writes
   * land in this UI-thread turn. The perf mark is made even when nothing was dirty, as on iOS.
   */
  fun commit() {
    NitroUiPerf.mark(perfInstanceId, NitroUiPerf.KIND_PROPS_APPLIED)
    if (!isDirty) {
      return
    }
    isDirty = false
    Snapshot.sendApplyNotifications()
  }

  /** Resets for reuse. [drop] has already disposed the composition; the next attach rebuilds it. */
  fun prepareForRecycle() {
    // Mark before clearing the id: `NitroUiPerf.mark` ignores `NO_INSTANCE`.
    lifetime.onRecycle()
    NitroUiPerf.mark(perfInstanceId, NitroUiPerf.KIND_RECYCLED)
    perfInstanceId = NitroUiPerf.NO_INSTANCE
    // Nothing is armed here: RN may empty its recycling pool without ever reusing this view.
    model.reset()
    isDirty = true
    isMeasurePending = true
    sizingKeyChangePending = false
    sizingReportsHeld = false
    heldContentSize = null
    contentSize = null
    overWidePlacement.reset()
    hasMarkedFirstFrame = false
    firstFrameWatchRegistered = false
    everArmedStrategy = false
    everArmedPreDraw = false
    releaseSizingInstance()
  }

  /**
   * Disposes the composition. RN calls this for a real unmount and as the first step of
   * recycling, so the composition never survives a recycle.
   */
  fun drop() {
    lifetime.onDrop()
    NitroUiPerf.mark(perfInstanceId, NitroUiPerf.KIND_DROPPED)
    composeContent.disposeComposition()
    // `disposeComposition()` does not uninstall the composition strategy, whose observer on
    // the activity's lifecycle would hold this view until the activity dies.
    unarmCompositionStrategy()
    // A pre-draw listener is held by the window's observer, which outlives this view.
    unregisterPreDraw(firstFrameWatch)
    firstFrameWatch = null
    firstFrameWatchRegistered = false
    unregisterPreDraw(flushWatch)
    flushWatch = null
    sizingReportsHeld = false
    heldContentSize = null
    contentSize = null
    overWidePlacement.reset()
    releaseSizingInstance()
  }

  // Compose's default strategy disposes on detach, but RN detaches views it will re-attach.
  // `DisposeOnViewTreeLifecycleDestroyed` is wrong too: the view-tree owner can be a
  // fragment (react-native-screens), not the activity.
  private fun armCompositionStrategy() {
    if (strategyArmed) {
      // Re-attaching a host that was detached without being dropped (a screen
      // transition, `removeClippedSubviews`) must not pay for a second observer.
      return
    }
    if (isHostedByParent) {
      // A hosted child builds no composition of its own, so there is nothing to guard.
      return
    }
    val owner = owner ?: return
    // `installFor` throws for a DESTROYED owner, and a view can attach during activity teardown.
    if (owner.lifecycle.currentState == Lifecycle.State.DESTROYED) {
      return
    }
    composeContent.setViewCompositionStrategy(DisposeOnLifecycleDestroyed(owner))
    strategyArmed = true
    everArmedStrategy = true
  }

  // A strategy is only uninstalled when another is set, so set one that observes nothing.
  private fun unarmCompositionStrategy() {
    composeContent.setViewCompositionStrategy(DisposeWithTheHost)
    strategyArmed = false
  }

  private fun releaseOwnCompositionGuards() {
    unarmCompositionStrategy()
    unregisterPreDraw(firstFrameWatch)
    firstFrameWatch = null
    firstFrameWatchRegistered = false
  }

  /** Read by the test harness. Only `drops` and `recycles` are per host, not process-wide. */
  internal fun lifetimeReport(): String =
    "drops=${lifetimeDrops} recycles=${lifetimeRecycles}" +
      " measuresAfterDrop=${measuresAfterDrop}" +
      " layoutsAfterDrop=${layoutsAfterDrop}" +
      " giveUps=${giveUpUnregisters}" +
      " floatingFlushes=${floatingFlushSchedules}"

  /**
   * Read by the test harness: the guards this mount ever armed, then those installed now, as
   * `<ever>|live:<live>`. Each half lists `strategy` and/or `preDraw`.
   */
  internal fun armedGuardsReport(): String {
    val ever = mutableListOf<String>()
    if (everArmedStrategy) {
      ever.add("strategy")
    }
    if (everArmedPreDraw) {
      ever.add("preDraw")
    }
    val live = mutableListOf<String>()
    if (strategyArmed) {
      live.add("strategy")
    }
    if (firstFrameWatchRegistered) {
      live.add("preDraw")
    }
    return ever.joinToString(",") + "|live:" + live.joinToString(",")
  }

  // Removes through the observer captured at registration. If that one died in a merge into
  // a window's observer, the listener moved to the view's current observer, so try that.
  private fun unregisterPreDraw(watch: PreDrawWatch?) {
    if (watch == null) {
      return
    }
    val observer =
      if (watch.observer.isAlive) {
        watch.observer
      } else if (isAttachedToWindow) {
        viewTreeObserver
      } else {
        // Detached and the captured observer is dead: no reachable observer holds the listener.
        giveUpUnregisters += 1
        return
      }
    try {
      observer.removeOnPreDrawListener(watch.listener)
    } catch (_: IllegalStateException) {
      // The listener is not in this observer: it went somewhere else with a merge.
    }
  }

  // The engine keeps per-instance entries until told to forget them. Safe to call twice.
  private fun releaseSizingInstance() {
    val instanceId = sizingInstanceId
    sizingInstanceId = NitroUiSizing.NO_INSTANCE
    lastReportedSize = null
    // A flush listener that never ran would otherwise block every flush after a recycle.
    flushScheduled = false
    if (instanceId != NitroUiSizing.NO_INSTANCE) {
      NitroUiSizing.forget(instanceId)
    }
  }

  // MARK: - View lifecycle

  override fun onAttachedToWindow() {
    // Composing is allowed again only here, where the host has both a window and a strategy.
    lifetime.onAttach()
    // Arm before `super`, which dispatches the child's attach, where the composition is created.
    armCompositionStrategy()
    // Compose needs both owners. RN and react-native-screens usually set them; fill only a
    // gap, and never replace one that is set (it may be a fragment's). Before `super`, because
    // the child resolves the owners as it attaches.
    if (owner != null && findViewTreeLifecycleOwner() == null) {
      setViewTreeLifecycleOwner(owner)
    }
    if (savedStateOwner != null && findViewTreeSavedStateRegistryOwner() == null) {
      setViewTreeSavedStateRegistryOwner(savedStateOwner)
    }
    super.onAttachedToWindow()
    applyHostedDrawFlag()
    watchForFirstFrame()
  }

  override fun onDetachedFromWindow() {
    applyHostedDrawFlag()
    super.onDetachedFromWindow()
  }

  // MARK: - Measuring

  // Compose answers a measure by building a composition, which needs a window. The size set
  // here is not used: Fabric lays this view out from the frame C++ computed.
  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    if (lifetime.declineMeasure()) {
      // A dropped host can still be measured while attached (`stopSurface` drops views before
      // it removes the root). Measuring would build a composition that nothing disposes.
      processMeasuresAfterDrop += 1
      isMeasurePending = true
      setMeasuredDimension(0, 0)
      return
    }
    if (isHostedByParent) {
      // A Host composes this control; measuring would build a second composition for it.
      isMeasurePending = true
      setMeasuredDimension(0, 0)
      return
    }
    if (!isAttachedToWindow) {
      isMeasurePending = true
      setMeasuredDimension(0, 0)
      return
    }
    isMeasurePending = false
    super.onMeasure(widthMeasureSpec, heightMeasureSpec)
  }

  // Called from the measure block that found (or cleared) an overrun. Writing the token that
  // block reads schedules one more measure of the node, which places the content at the box's
  // width. It cannot happen in this pass: a `Measurable` may be measured only once per pass.
  private fun noteOverWideContent(overruns: Boolean) {
    overWidePlacement.armed.value = overruns
    if (overruns) remeasureToken.intValue += 1
  }

  // RN can deliver a frame before the window (a `Modal`'s tree). Measure first if one is pending.
  override fun onLayout(
    changed: Boolean,
    left: Int,
    top: Int,
    right: Int,
    bottom: Int,
  ) {
    if (lifetime.declineLayout()) {
      // A dropped host that is still attached can be laid out without being measured first.
      processLayoutsAfterDrop += 1
      return
    }
    if (isHostedByParent) {
      // The Host places this control; its only child view was never measured.
      return
    }
    if (isMeasurePending && isAttachedToWindow) {
      measureNow(right - left, bottom - top)
    }
    super.onLayout(changed, left, top, right, bottom)
    if (changed && sizingKeyChangePending) {
      // This layout carries the engine's box for the new key. Clear the dedupe and ask for a
      // measure, so the control reports its size under that key.
      sizingKeyChangePending = false
      lastReportedSize = null
      overWidePlacement.reset()
      remeasureToken.intValue += 1
    }
  }

  // Nothing else measures the Compose view: Fabric measures once per layout update, and
  // `requestLayout()` stops at `ReactViewGroup`, whose `onMeasure` does nothing.
  private fun runPendingMeasure() {
    if (isHostedByParent) {
      return
    }
    if (!isMeasurePending || !isAttachedToWindow) {
      return
    }
    measureNow(width, height)
  }

  private fun measureNow(width: Int, height: Int) {
    if (width == 0 || height == 0) {
      // No frame yet; [onLayout] measures when one arrives.
      return
    }
    measure(
      View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
      View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY),
    )
    layout(left, top, right, bottom)
  }

  // Marks the first frame this mount draws, from a pre-draw listener that then removes itself.
  private fun watchForFirstFrame() {
    if (hasMarkedFirstFrame || firstFrameWatchRegistered) {
      return
    }
    if (isHostedByParent) {
      // A hosted child draws nothing itself; the Host marks its own first frame.
      return
    }
    val observer = viewTreeObserver
    if (!observer.isAlive) {
      return
    }
    firstFrameWatchRegistered = true
    everArmedPreDraw = true
    val listener =
      object : ViewTreeObserver.OnPreDrawListener {
        override fun onPreDraw(): Boolean {
          if (NitroUiSizing.hasPendingReports()) {
            // A size correction is still queued, so [scheduleSizingFlush] will cancel this
            // frame. Stay registered: the first frame is the first one a user could see.
            return true
          }
          unregister()
          hasMarkedFirstFrame = true
          NitroUiPerf.mark(perfInstanceId, NitroUiPerf.KIND_FIRST_FRAME)
          // The host's size after layout is Yoga's box in px; the engine works in dp.
          val density = resources.displayMetrics.density
          if (density > 0f) {
            NitroUiSizing.recordDrawnSize(
              sizingInstanceId,
              width.toDouble() / density,
              height.toDouble() / density,
            )
          }
          return true
        }

        private fun unregister() {
          firstFrameWatchRegistered = false
          unregisterPreDraw(firstFrameWatch)
          firstFrameWatch = null
        }
      }
    firstFrameWatch = PreDrawWatch(listener, observer)
    observer.addOnPreDrawListener(listener)
  }

  /**
   * Call when the configuration behind the sizing key changed. The new configuration may
   * measure the same size as the old one, and the dedupe in [reportToSizingEngine] would then
   * skip the report the engine needs for the new key. Takes effect at the next layout.
   */
  fun noteSizingKeyChanged() {
    if (contentSize == null) {
      return
    }
    sizingKeyChangePending = true
  }

  /**
   * Stops size reports until [releaseSizingReports]. Call when native changes the content
   * before React has sent the matching sizing key.
   */
  fun holdSizingReports() {
    sizingReportsHeld = true
    heldContentSize = null
  }

  /**
   * Ends the hold; call after the props batch's setters have run. Files the size measured
   * during the hold when [heldSizeBelongsToBatch] says the batch describes that content.
   * A fresh measure here could run before the batch recomposes and report the old content.
   */
  fun releaseSizingReports(heldSizeBelongsToBatch: Boolean) {
    if (!sizingReportsHeld) {
      return
    }
    sizingReportsHeld = false
    val held = heldContentSize
    heldContentSize = null
    if (held == null || !heldSizeBelongsToBatch) {
      return
    }
    // The dedupe holds the previous configuration's size; an equal size must still be filed.
    lastReportedSize = null
    reportToSizingEngine(held)
  }

  private fun recordMeasuredSize(widthPx: Int, heightPx: Int) {
    if (!wantsContentSize) {
      return
    }
    val density = resources.displayMetrics.density
    if (density <= 0f) {
      return
    }
    val size = NitroUiDpSize(widthPx.toDouble() / density, heightPx.toDouble() / density)
    contentSize = size
    if (sizingReportsHeld) {
      heldContentSize = size
    } else {
      reportToSizingEngine(size)
    }
  }

  private fun reportToSizingEngine(size: NitroUiDpSize) {
    val instanceId = sizingInstanceId
    if (!NitroUiSizing.isSized(instanceId)) {
      return
    }
    val last = lastReportedSize
    if (last != null &&
      kotlin.math.abs(last.width - size.width) < SIZING_EPSILON_DP &&
      kotlin.math.abs(last.height - size.height) < SIZING_EPSILON_DP
    ) {
      return
    }
    lastReportedSize = size
    NitroUiSizing.report(instanceId, size.width, size.height, sizingPolicy)
    scheduleSizingFlush()
  }

  // Applies queued size corrections before the next frame. Returning false from `onPreDraw`
  // cancels that draw, so the frame at the old size is never shown.
  private fun scheduleSizingFlush() {
    if (flushScheduled) {
      return
    }
    val observer = viewTreeObserver
    if (!observer.isAlive) {
      return
    }
    if (!isAttachedToWindow) {
      // The listener goes on a floating observer, which dies when it merges into a window's.
      floatingFlushSchedules += 1
    }
    flushScheduled = true
    val listener =
      object : ViewTreeObserver.OnPreDrawListener {
        override fun onPreDraw(): Boolean {
          flushScheduled = false
          unregisterPreDraw(flushWatch)
          flushWatch = null
          return !NitroUiSizing.flush()
        }
      }
    flushWatch = PreDrawWatch(listener, observer)
    observer.addOnPreDrawListener(listener)
    // A pre-draw listener does not request a draw, and an idle window (an RN `Modal` once
    // presented) never draws again by itself. This is the cheapest request that reaches the
    // window this host is in; `requestLayout()` would re-measure the native subtree.
    postInvalidateOnAnimation()
  }

  override fun onConfigurationChanged(newConfig: android.content.res.Configuration?) {
    super.onConfigurationChanged(newConfig)
    lastReportedSize = null
    // Font scale or locale can change what the content wants: ask the unbounded question again.
    overWidePlacement.reset()
    // Compose need not re-measure a node whose size it has no reason to doubt.
    remeasureToken.intValue += 1
    // Only what can move a control's size goes in the signature: a rotation moves none, and
    // this runs once per mounted view. Dynamic colours come from resource overlays that a
    // configuration change can swap.
    NitroUiColorSchemes.invalidate()
    val locales = newConfig?.locales?.toLanguageTags() ?: ""
    NitroUiSizing.invalidateEnvironmentIfChanged(
      "${newConfig?.fontScale}|${newConfig?.densityDpi}|$locales",
    )
  }

  private companion object {
    /** Sub-dp wobble that is not a size change. */
    private const val SIZING_EPSILON_DP = 0.5

    // Test-harness counters, totalled across every host in the process. `@Volatile` because
    // they are written on the UI thread and read from another; the increments are not atomic.
    @Volatile internal var processMeasuresAfterDrop = 0

    @Volatile internal var processLayoutsAfterDrop = 0

    @Volatile internal var giveUpUnregisters = 0

    @Volatile internal var floatingFlushSchedules = 0
  }
}

/**
 * Material 3 Expressive over dynamic colour (Android 12+) or the default schemes. The
 * baseline opt-out only swaps the motion scheme: a separate theme call site would be a
 * different group, so switching would dispose and rebuild every control's composition.
 */
@Composable
fun NitroUiTheme(content: @Composable () -> Unit) {
  val dark = isSystemInDarkTheme()
  val context = LocalContext.current
  MaterialExpressiveTheme(
    colorScheme = NitroUiColorSchemes.forContext(context, dark),
    motionScheme = if (NitroUiMaterialTheme.expressive) MotionScheme.expressive() else MotionScheme.standard(),
    // Passed explicitly so the baseline opt-out keeps a root `MaterialTheme`'s shapes and type.
    shapes = NitroUiBaselineShapes,
    typography = NitroUiBaselineTypography,
  ) {
    // Read by the test harness.
    remember { NitroUiMaterialTheme.noteContentCreated() }
    NitroUiMaterialTheme.noteComposed(MaterialTheme.motionScheme)
    content()
  }
}

private val NitroUiBaselineShapes = Shapes()
private val NitroUiBaselineTypography = Typography()

/**
 * A cache key held weakly and compared by identity. The key is a `Context` whose base is the
 * `Activity`, so a strong reference from a process-wide cache would leak a destroyed one.
 */
internal class WeakKey<T : Any>(value: T) {
  private val reference = WeakReference(value)

  fun matches(candidate: T): Boolean = reference.get() === candidate

  /** The referent, or null once it has been collected. For tests of the contract. */
  val held: T?
    get() = reference.get()
}

/**
 * One colour scheme for the process. Every hosted control is its own composition, so a
 * `remember` would build the dynamic scheme (about 50 resource reads) once per control.
 * A wallpaper change that arrives without a configuration change keeps the old scheme.
 */
internal object NitroUiColorSchemes {
  private class Entry(
    val contextKey: WeakKey<Context>,
    val dark: Boolean,
    val uiMode: Int,
    val scheme: ColorScheme,
  )

  @Volatile private var entry: Entry? = null

  fun forContext(
    context: Context,
    dark: Boolean,
  ): ColorScheme {
    val uiMode = context.resources.configuration.uiMode
    entry?.let {
      if (it.contextKey.matches(context) && it.dark == dark && it.uiMode == uiMode) {
        return it.scheme
      }
    }
    val built =
      when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
          if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)

        dark -> darkColorScheme()
        else -> lightColorScheme()
      }
    entry = Entry(WeakKey(context), dark, uiMode, built)
    return built
  }

  fun invalidate() {
    entry = null
  }
}

/**
 * Measures the content once per pass (a second `measure()` on a `Measurable` throws) and
 * centres it in the box RN gave it. The incoming constraints are exact, so measuring with
 * them would only report the box back: [unbounded] asks with no bounds (`intrinsic`),
 * otherwise with the box's width and a free height (`fillWidth`).
 */
@Composable
internal fun NitroUiMeasuredRoot(
  centered: Boolean,
  record: Boolean,
  unbounded: Boolean,
  remeasureToken: IntState,
  contentRevision: IntState,
  overWide: NitroUiOverWidePlacement,
  onMeasured: (Int, Int) -> Unit,
  onOverWide: (Boolean) -> Unit,
  content: @Composable () -> Unit,
) {
  // Both reads are gated on the arming, so content that never overran its box observes
  // neither and is not recomposed by a props batch. The revision is read here, not in the
  // measure block, because the composition is what knows which content it rendered.
  val armedAtComposition = if (unbounded) overWide.armed.value else false
  val revision =
    if (armedAtComposition) {
      contentRevision.value
    } else {
      NitroUiOverWidePlacement.NO_REVISION
    }
  Layout(content) { measurables, constraints ->
    // The arming is read live because this block sets and clears it. The two stamps are plain
    // fields: a measure block that observes state it writes re-dirties its own node and would
    // loop. An arming is honoured only for the box width and content it was made for.
    val placeAtBoxWidth =
      unbounded &&
      overWide.armed.value &&
      constraints.hasBoundedWidth &&
      constraints.maxWidth == overWide.armedWidthPx &&
      revision != NitroUiOverWidePlacement.NO_REVISION &&
      revision == overWide.armedRevision
    val childConstraints =
      if (unbounded && !placeAtBoxWidth) {
        Constraints()
      } else if (constraints.hasBoundedWidth) {
        constraints.copy(
          minWidth = 0,
          minHeight = 0,
          maxHeight = Constraints.Infinity,
        )
      } else {
        Constraints()
      }
    val placeable = measurables.firstOrNull()?.measure(childConstraints)
    val measuredWidth = placeable?.width ?: 0
    val measuredHeight = placeable?.height ?: 0
    // Always true. The read is the point: it subscribes this measure block to the token, so
    // the host can force a re-measure by writing it.
    val remeasureRequested = remeasureToken.value >= 0
    if (record && remeasureRequested && placeable != null && !placeAtBoxWidth) {
      onMeasured(measuredWidth, measuredHeight)
    }
    if (unbounded && !placeAtBoxWidth && constraints.hasBoundedWidth) {
      // Only an unbounded pass can tell whether the content overruns the box. The host is told
      // from inside the pass because nothing else will measure a view whose box did not move.
      val overruns = measuredWidth > constraints.maxWidth
      overWide.armedWidthPx = if (overruns) constraints.maxWidth else -1
      overWide.armedRevision = revision
      if (overruns || overWide.armed.value) {
        onOverWide(overruns)
      }
    }
    // Returns Yoga's box, not the control's size; the control is placed inside it.
    val width =
      if (constraints.hasBoundedWidth) constraints.maxWidth else measuredWidth
    val height =
      if (constraints.hasBoundedHeight) constraints.maxHeight else measuredHeight
    layout(width, height) {
      if (centered) {
        placeable?.placeRelative(
          (width - measuredWidth) / 2,
          (height - measuredHeight) / 2
        )
      } else {
        placeable?.placeRelative(0, 0)
      }
    }
  }
}

/**
 * What the host knows about content wider than its box. [armed] is snapshot state so the
 * composition can observe it; the two stamps are plain fields because the measure block
 * writes them and must not observe what it writes. UI thread only.
 */
internal class NitroUiOverWidePlacement {
  /**
   * Whether the content is placed at its box's width. Sticky: clearing it after each pass
   * would repeat the unbounded measure and the placement measure on every pass.
   */
  val armed = mutableStateOf(false)

  /** The box width in px that [armed] was set against, or -1. Any other width voids it. */
  var armedWidthPx = -1

  /**
   * The content revision [armed] was set against, or [NO_REVISION]. Content placed at a box's
   * width answers that width whatever it is, so an arming must not outlive its content.
   */
  var armedRevision = NO_REVISION

  fun reset() {
    armed.value = false
    armedWidthPx = -1
    armedRevision = NO_REVISION
  }

  internal companion object {
    /** The pass could not tell which content it measured. Such an arming is never honoured. */
    const val NO_REVISION = -1
  }
}

private class PreDrawWatch(
  val listener: ViewTreeObserver.OnPreDrawListener,
  val observer: ViewTreeObserver,
)

/** Observes and disposes nothing. Installing it uninstalls the previous strategy. */
private object DisposeWithTheHost : ViewCompositionStrategy {
  override fun installFor(view: AbstractComposeView): () -> Unit = {}
}

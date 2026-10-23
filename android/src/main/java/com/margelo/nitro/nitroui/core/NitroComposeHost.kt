package com.margelo.nitro.nitroui.core

import android.app.Activity
import android.content.Context
import android.os.Build
import android.view.View
import android.widget.FrameLayout
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.platform.AbstractComposeView
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.ViewCompositionStrategy.DisposeOnLifecycleDestroyed
import android.view.ViewTreeObserver
import androidx.lifecycle.LifecycleOwner
import androidx.savedstate.SavedStateRegistryOwner
import androidx.lifecycle.findViewTreeLifecycleOwner
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.savedstate.findViewTreeSavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner

/** An immutable size in dp, safe to publish across threads with a `@Volatile`. */
data class NitroUiDpSize(val width: Double, val height: Double)

/**
 * The one place in this library that hosts Compose. Every component's Hybrid View
 * owns exactly one of these, created with it and never replaced
 * (`docs/research/core-architecture.md` §3).
 *
 * It is a `FrameLayout` with one [AbstractComposeView] child, and the wrapper is
 * load-bearing: RN measures a view before that view has a window, and
 * `AbstractComposeView` is not written for it. Its `onMeasure` is `final`, it
 * resolves a `CompositionContext` there, and the only source for one is the
 * window's `ViewRecomposer`, so measuring it detached throws
 * "Cannot locate windowRecomposer; View ... is not attached to a window" - inside
 * the mount batch, which aborts the update and takes the app down. Fabric does
 * exactly that: it measures every view it lays out, and it lays out a `Modal`'s
 * tree before `Dialog.show()` gives that tree a window (measured on API 35: the
 * app died in the mount batch). A `FrameLayout` measured before its window has got
 * nothing to measure yet, and it owns a non-final `onMeasure`/`onLayout` to say so
 * with - see [onMeasure], [onLayout] and [measureNow].
 *
 * Who measures the Compose view, then: nobody but us. Fabric is the only thing
 * that measures an RN view (`SurfaceMountingManager.updateLayout` calls
 * `measure(EXACTLY(w), EXACTLY(h))` once per layout update, then lays the view out
 * itself), and `requestLayout()` reaches nobody either: the parent above is a
 * `ReactViewGroup`, whose `onMeasure` does nothing, because RN drives its
 * children's frames from C++. So whenever a measure was declined, the first moment
 * there is a window and a frame runs it - from the child's own
 * [onAttachedToWindow] if the frame came first, from [onLayout] if the window came
 * first. Either way the control composes in the same UI-thread turn it was laid
 * out in; no `post`ed retry.
 *
 * The price of the wrapper is one extra `View` per hosted control. The gain is
 * that no component has to know which window RN mounted it in.
 *
 * Lifetime:
 * - prop setters write snapshot state on the model and call [markDirty];
 * - [commit] runs once per `updateState` and sends one apply notification;
 * - [drop] disposes the composition;
 * - [prepareForRecycle] resets the model and the flags, ready for the next
 *   attach.
 *
 * Recycling, precisely (RN 0.88): a view only reaches [prepareForRecycle] when the
 * app turns on `ReactNativeFeatureFlags.enableViewRecycling()` (off by default)
 * *and* the Hybrid implements `RecyclableView`, because that is what makes
 * Nitro's generated manager call `setupViewRecycling()`. Even then the generated
 * `onDropViewInstance` runs `onDropView()` - so [drop], and
 * `disposeComposition()` - *before* `prepareToRecycleView`. The composition
 * therefore never survives a recycle: the next attach builds a new one. What
 * recycling does save is everything around it - this View, the child, the Hybrid
 * Object, the model and the owner wiring. We keep the dispose rather than leaving
 * compositions alive: not disposing would leak one per real unmount, and with the
 * flag off every unmount is a real one. Measuring a keep-it-alive variant is
 * T02's job (docs/architecture/core.md §6).
 */
abstract class NitroComposeHost<M : NitroUiModel>(
  context: Context,
  /** `reactContext.currentActivity`, for the owners RN may not have set. */
  private val activity: Activity?,
  /** The component's state. Never replaced. */
  protected val model: M,
) : FrameLayout(context) {

  /** `nuiPerfId` of the owning view, or [NitroUiPerf.NO_INSTANCE]. */
  var perfInstanceId: Int = NitroUiPerf.NO_INSTANCE

  /**
   * `nuiSizingId` of the owning view, or [NitroUiSizing.NO_INSTANCE].
   *
   * The other half of [wantsContentSize]: a measured size is only useful if it
   * can be pushed somewhere, and this says which Fabric node owns it
   * (`docs/architecture/sizing.md`). Reset on every recycle, so a reused host can
   * never report a size into a dead instance's state.
   */
  var sizingInstanceId: Long = NitroUiSizing.NO_INSTANCE

  /**
   * Declared by the component: [NitroUiSizing.POLICY_INTRINSIC] when the control's
   * own size is its size, [NitroUiSizing.POLICY_FILL_WIDTH] when the width comes
   * from Yoga's box. It decides the question [NitroUiMeasuredRoot] asks Compose
   * (see there), so getting it wrong makes a control report its box.
   */
  var sizingPolicy: Int = NitroUiSizing.POLICY_INTRINSIC

  /**
   * Set by components that want [contentSize] maintained (T11's sizing, plus
   * `measureContent()`). Off by default: recording costs a Compose measure
   * bookkeeping step on every pass.
   */
  var wantsContentSize: Boolean = false

  /**
   * Last measured content size in dp, or `null` if never measured. Fabric's
   * measure pass fills it in; `measureContent()` reads it from any thread. An
   * immutable value behind a `@Volatile` is what makes that legal (§1.4).
   */
  @Volatile var contentSize: NitroUiDpSize? = null
    private set

  private var isDirty = true
  private var hasMarkedFirstFrame = false

  /**
   * The size the sizing engine already has from this host, in dp. Compared with an
   * epsilon so a measure that wobbles by a fraction of a dp does not become a
   * Fabric commit (risk R12). This only skips the JNI call - the engine drops a
   * duplicate report by itself.
   */
  private var lastReportedSize: NitroUiDpSize? = null

  /** Whether a pre-draw flush is already queued for this host. */
  private var flushScheduled = false

  /**
   * Whether the measure that arrives for this mount still has to happen. True at
   * the start (there is no composition yet) and again after a measure declined for
   * want of a window; cleared by the run that was not declined.
   */
  private var isMeasurePending = true

  /**
   * What to dispose the composition with. An `Activity` in an RN app is a
   * `ComponentActivity`, so it is a `LifecycleOwner`; if it somehow is not, the
   * default strategy stays and only the composition's lifetime is affected.
   */
  private val owner: LifecycleOwner? = activity as? LifecycleOwner

  /**
   * The same activity, seen as the other owner Compose requires.
   *
   * Asked for separately, not cast from [owner]: an `Activity` in an RN app is a
   * `ComponentActivity`, which is both, but a host that hands us only one of the
   * two roles should still get the one it can give.
   */
  private val savedStateOwner: SavedStateRegistryOwner? =
    activity as? SavedStateRegistryOwner

  /** The one Compose view of this host, made with it and never replaced. */
  private val composeContent: ComposeContent = ComposeContent(context)

  init {
    // The default strategy disposes on detach, which is wrong in RN: screen
    // transitions, `removeClippedSubviews` and the recycling pool all detach
    // views, and each detach would throw the composition away.
    owner?.let { composeContent.setViewCompositionStrategy(DisposeOnLifecycleDestroyed(it)) }
    addView(
      composeContent,
      LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT),
    )
  }

  /** The component's composable. Called from [ComposeContent], never replaced. */
  @Composable
  protected abstract fun Component(model: M)

  /**
   * The composition's root: built once, for the lifetime of the instance. There
   * is no `setContent` per props update, which is the perf contract's main rule.
   */
  @Composable
  private fun Content() {
    NitroUiTheme {
      NitroUiMeasuredRoot(
        record = wantsContentSize,
        unbounded = wantsContentSize && sizingPolicy == NitroUiSizing.POLICY_INTRINSIC,
        onMeasured = ::recordMeasuredSize,
      ) {
        Component(model)
      }
    }
  }

  /** The one Compose view of this host. It never becomes the host itself - see the class docs. */
  private inner class ComposeContent(
    context: Context,
  ) : AbstractComposeView(context) {
    @Composable
    override fun Content() {
      this@NitroComposeHost.Content()
    }

    override fun onAttachedToWindow() {
      super.onAttachedToWindow()
      // The first moment this view has a window, which is the first moment
      // Compose can resolve a composition against one. If Yoga already gave the
      // control a frame - the usual case, since Fabric measures and lays out
      // before it attaches a fresh subtree - that is everything the measure that
      // was declined needed, so run it now rather than a frame later.
      runPendingMeasure()
    }
  }

  // MARK: - Updating

  /** Called by prop setters: record that something rendered changed. */
  fun markDirty() {
    isDirty = true
  }

  /**
   * Apply the batch. Called once, from the generated `updateState`.
   *
   * Snapshot writes are already visible; sending the apply notification here is
   * what makes them land in this UI-thread turn instead of the next global apply.
   * The mark is made whether or not anything was dirty, so that `propsApplied`
   * counts one `updateState` on both platforms (iOS marks every commit) rather
   * than one *visible* update on Android only.
   */
  fun commit() {
    NitroUiPerf.mark(perfInstanceId, NitroUiPerf.KIND_PROPS_APPLIED)
    if (!isDirty) {
      return
    }
    isDirty = false
    Snapshot.sendApplyNotifications()
  }

  /**
   * Reset for reuse: the model is already reset by the Hybrid, and the flags say
   * "this mount has rendered nothing yet". The composition was disposed by
   * [drop], which Nitro calls first, so the next measure rebuilds it and reads
   * this model from scratch.
   */
  fun prepareForRecycle() {
    model.reset()
    isDirty = true
    isMeasurePending = true
    contentSize = null
    // A recycled mount still paints its first frame for itself.
    hasMarkedFirstFrame = false
    sizingInstanceId = NitroUiSizing.NO_INSTANCE
    lastReportedSize = null
  }

  /**
   * Release the composition.
   *
   * Called from `onDropViewInstance`, which RN uses for a real unmount *and* as
   * the front door of recycling (see the class docs), so this is not only the
   * unmount path. Disposing is still the right call: with the recycling flag
   * off - the default - every call here is an unmount, and a composition left
   * alive would be retained until the activity dies.
   * `DisposeOnLifecycleDestroyed` is what bounds the other case.
   */
  fun drop() {
    composeContent.disposeComposition()
    contentSize = null
    sizingInstanceId = NitroUiSizing.NO_INSTANCE
    lastReportedSize = null
  }

  // MARK: - View lifecycle

  override fun onAttachedToWindow() {
    // Compose needs both owners and fails if either is missing, so fill any gap
    // first - and fill each gap separately, since a parent could set one and not
    // the other. Usually `ReactActivity`/react-native-screens already set both
    // (RN 0.88's `Modal` is a `ComponentDialog`, whose window does too), so this
    // stays a fallback for a parent that provides neither. Unlike Expo we never
    // override an owner that is already set - it may be a fragment's, not the
    // activity's. Deliberately before `super`: the child's attach is dispatched
    // after this returns, and it resolves the owners as it attaches.
    if (owner != null && findViewTreeLifecycleOwner() == null) {
      setViewTreeLifecycleOwner(owner)
    }
    if (savedStateOwner != null && findViewTreeSavedStateRegistryOwner() == null) {
      setViewTreeSavedStateRegistryOwner(savedStateOwner)
    }
    super.onAttachedToWindow()
    watchForFirstFrame()
  }

  // MARK: - Measuring

  /**
   * Decline to measure the Compose view while this host has no window.
   *
   * A `ViewGroup` measured before its window is normal in Android and simply
   * means "nothing yet"; the trouble is only that Compose answers a measure by
   * building a composition, and a composition needs the window's
   * `ViewRecomposer`. The size RN gets here is ignored anyway: Fabric lays this
   * view out from the frame C++ computed, it does not read the measured dimension.
   */
  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    if (!isAttachedToWindow) {
      isMeasurePending = true
      setMeasuredDimension(0, 0)
      return
    }
    isMeasurePending = false
    super.onMeasure(widthMeasureSpec, heightMeasureSpec)
  }

  /**
   * Same rule as [onMeasure], other way round: a frame can also arrive before the
   * window does, which is what RN does to a `Modal`'s tree. Lay out whatever has
   * been measured, and if the window is here now, measure first so that there is
   * something to lay out.
   */
  override fun onLayout(
    changed: Boolean,
    left: Int,
    top: Int,
    right: Int,
    bottom: Int,
  ) {
    if (isMeasurePending && isAttachedToWindow) {
      measureNow(right - left, bottom - top)
    }
    super.onLayout(changed, left, top, right, bottom)
  }

  /**
   * Measure and lay the Compose view out with the frame RN gave this host.
   *
   * Called at the first moment there is both a window and a frame, from the
   * child's attach and from [onLayout] - see the class docs. Only [isMeasurePending]
   * decides, so the two callers cannot double-measure: a measure this host
   * completes clears the flag, and a declined one (no window) sets it again.
   */
  private fun runPendingMeasure() {
    if (!isMeasurePending || !isAttachedToWindow) {
      return
    }
    measureNow(width, height)
  }

  private fun measureNow(width: Int, height: Int) {
    if (width == 0 || height == 0) {
      // No frame yet. The layout that gives this view one is the other caller.
      return
    }
    measure(
      View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
      View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY),
    )
    layout(left, top, right, bottom)
  }

  /**
   * Mark the first frame this mount draws. The pre-draw callback is the closest
   * thing to a frame boundary available to a `ViewGroup` here; the listener
   * removes itself after firing once.
   */
  private fun watchForFirstFrame() {
    if (hasMarkedFirstFrame) {
      return
    }
    val observer = viewTreeObserver
    if (!observer.isAlive) {
      return
    }
    observer.addOnPreDrawListener(
      object : ViewTreeObserver.OnPreDrawListener {
        override fun onPreDraw(): Boolean {
          val current = viewTreeObserver
          if (current.isAlive) {
            current.removeOnPreDrawListener(this)
          }
          if (!hasMarkedFirstFrame) {
            hasMarkedFirstFrame = true
            NitroUiPerf.mark(perfInstanceId, NitroUiPerf.KIND_FIRST_FRAME)
          }
          return true
        }
      }
    )
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
    reportToSizingEngine(size)
  }

  /**
   * Hand the measured size to the sizing engine, which decides whether it deserves
   * a Fabric state update at all.
   *
   * The engine drops a report that agrees with its cache, so a pre-warmed mount
   * costs no commit; the epsilon here only skips the JNI call. When a correction
   * *is* queued, the frame that is about to be drawn would show the old size, so
   * [scheduleSizingFlush] asks for it to be skipped.
   */
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

  /**
   * Apply the queued size corrections before the next frame is drawn.
   *
   * Returning `false` from `onPreDraw` cancels that one draw pass, which is how
   * Android skips the wrong-size frame: the correction is a Fabric state update,
   * so Yoga re-lays-out and RN draws again with the right frame. One listener per
   * host, dropped as soon as it has run; [flushScheduled] keeps a burst of reports
   * from stacking listeners up. If this host detaches first the listener dies with
   * its (stale) `ViewTreeObserver`, and the next report re-registers on a live one
   * - a lost flush only means one frame drawn at the fallback size.
   */
  private fun scheduleSizingFlush() {
    if (flushScheduled) {
      return
    }
    val observer = viewTreeObserver
    if (!observer.isAlive) {
      return
    }
    flushScheduled = true
    observer.addOnPreDrawListener(
      object : ViewTreeObserver.OnPreDrawListener {
        override fun onPreDraw(): Boolean {
          flushScheduled = false
          val current = viewTreeObserver
          if (current.isAlive) {
            current.removeOnPreDrawListener(this)
          }
          return !NitroUiSizing.flush()
        }
      }
    )
  }

  /**
   * Font scale, screen size, locale or density changed: every cached size was
   * measured under the old environment, so all of them are suspect - not just this
   * view's (`docs/architecture/sizing.md`). Compose re-measures the content by
   * itself after a configuration change, and the new measure arrives as a report.
   */
  override fun onConfigurationChanged(newConfig: android.content.res.Configuration?) {
    super.onConfigurationChanged(newConfig)
    lastReportedSize = null
    NitroUiSizing.invalidateEnvironment()
  }

  private companion object {
    /** Sub-dp wobble that is not a size change. */
    private const val SIZING_EPSILON_DP = 0.5
  }
}

/**
 * The library's Material theme: dynamic colour on Android 12+, the default M3
 * schemes below, both following the system dark mode.
 *
 * A Hybrid View is its own composition, so it cannot inherit the app's theme;
 * this is the closest equivalent to what the surrounding app sees.
 */
@Composable
fun NitroUiTheme(content: @Composable () -> Unit) {
  val dark = isSystemInDarkTheme()
  val context = LocalContext.current
  // Dynamic colour reads ~50 framework resources, and every hosted control is
  // its own composition, so build it once per (context, appearance) instead of
  // once per hosted instance.
  val colorScheme =
    remember(context, dark) {
      when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
          if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)

        dark -> darkColorScheme()
        else -> lightColorScheme()
      }
    }
  MaterialTheme(colorScheme = colorScheme, content = content)
}

/**
 * Records the control's intrinsic size during Compose's own measure pass and
 * centres it in the box RN gave it.
 *
 * Exactly one `measure()` call per pass, and that is a hard rule rather than a
 * preference: measuring the same `Measurable` twice throws
 * `IllegalStateException: measure() may not be called multiple times on the same
 * Measurable` (`androidx.compose.ui.node.MeasurePassDelegate`), which takes the
 * whole host down at mount time - a first version of this function asked the
 * question twice (bounded for placement, unbounded for the record) and every
 * hosted Switch on Android died before its first frame.
 *
 * So the one question has to be the right one, and it cannot be the incoming
 * constraints as they arrive: the host lays the composition out `MATCH_PARENT`,
 * Fabric measures the host `EXACTLY`, and `AndroidComposeView` turns `EXACTLY`
 * into `minWidth == maxWidth`. A `Placeable`'s size is always coerced into its
 * constraints, so measuring with them reports the box back - the recorded size
 * would be 90x50 dp for a 90x50 dp box no matter what the control is, and the
 * centring offset would always be 0.
 *
 * [unbounded] picks which of the two questions to ask, and the component decides
 * it through its sizing policy (`docs/architecture/sizing.md`):
 *
 * - `true` (policy `intrinsic`, the whole library today): ask
 *   `Constraints()`, no minimum and no maximum - the same question iOS asks with
 *   `sizeThatFits(in: .infinity)`. A control that wants more than the box was
 *   given reports what it wants rather than the box, which is the only answer
 *   Yoga can act on. Capping it at the box maximum instead (what this did before
 *   T11) means a box *smaller* than the control records the box, and that number
 *   then goes in the cache under this configuration - every later Switch with the
 *   same key would be laid out at the wrong size. The layout this returns is
 *   still the box, so the control is centred in what Yoga gave it and a
 *   user-specified width or height still wins.
 * - `false` (policy `fillWidth` - a Slider, whose width *is* the box): keep the
 *   maximum and drop only the minimum, which is one call and asks for the height
 *   the control wants at the width it was given.
 *
 * Material's `minimumInteractiveComponentSize` (a 48 dp touch target) is part of
 * the size by design, and only [NitroComposeHost.wantsContentSize] pays for
 * recording at all.
 */
@Composable
internal fun NitroUiMeasuredRoot(
  record: Boolean,
  unbounded: Boolean,
  onMeasured: (Int, Int) -> Unit,
  content: @Composable () -> Unit,
) {
  Layout(content) { measurables, constraints ->
    val childConstraints =
      if (unbounded) {
        // The unbounded question. See the kdoc: this is what makes the recorded
        // size the control's, not the box's.
        Constraints()
      } else {
        // The minimum as it arrives equals the maximum, which would make this
        // report the box; the maximum is the width a fill-width control wants.
        constraints.copy(minWidth = 0, minHeight = 0)
      }
    val placeable = measurables.firstOrNull()?.measure(childConstraints)
    val measuredWidth = placeable?.width ?: 0
    val measuredHeight = placeable?.height ?: 0
    if (record && placeable != null) {
      onMeasured(measuredWidth, measuredHeight)
    }
    // What this returns is Yoga's box, not the control's size - the control gets
    // centred inside it. `resolveSize` keeps an explicit `EXACTLY` from Fabric
    // winning, and falls back to the measured size when a dimension is unbounded.
    val width =
      if (constraints.hasBoundedWidth) constraints.maxWidth else measuredWidth
    val height =
      if (constraints.hasBoundedHeight) constraints.maxHeight else measuredHeight
    layout(width, height) {
      placeable?.placeRelative(
        (width - measuredWidth) / 2,
        (height - measuredHeight) / 2
      )
    }
  }
}

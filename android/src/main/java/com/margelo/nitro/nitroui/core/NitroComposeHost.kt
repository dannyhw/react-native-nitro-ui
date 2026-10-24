package com.margelo.nitro.nitroui.core

import android.app.Activity
import android.content.Context
import android.os.Build
import android.view.View
import android.widget.FrameLayout
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.IntState
import androidx.compose.runtime.mutableIntStateOf
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
  private var firstFrameWatchRegistered = false

  /**
   * The size the sizing engine already has from this host, in dp. Compared with an
   * epsilon so a measure that wobbles by a fraction of a dp does not become a
   * Fabric commit (risk R12). This only skips the JNI call - the engine drops a
   * duplicate report by itself.
   */
  private var lastReportedSize: NitroUiDpSize? = null

  /**
   * Whether a sizing key has arrived whose box the engine has not been asked about
   * yet. Set by [noteSizingKeyChanged], consumed by [onLayout].
   */
  private var sizingKeyChangePending = false

  /**
   * Bumped when an armed sizing key change lands ([onLayout]) and read by
   * [NitroUiMeasuredRoot]'s measure block. A measure block observes the snapshot
   * state it reads, so writing this marks that node measure-dirty - which is the
   * only way this host can ask a *mounted* Compose control to measure again:
   * Compose leaves it alone when only the box moved (measured by T14 on a mounted
   * control re-laid-out at a wrong guess), and a report only ever comes out of a
   * measure.
   *
   * It is written at the layout, not at the prop: reporting a size while the engine
   * still has the *previous* configuration's box is a correction on a box that this
   * same transaction was already going to fix, which breaks D17's rule that a warm
   * configuration costs nothing.
   */
  private val remeasureToken = mutableIntStateOf(0)

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
    armCompositionStrategy()
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
        remeasureToken = remeasureToken,
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
    // [drop] uninstalled the strategy to get this host out of the activity's
    // `LifecycleRegistry`; a host that is about to compose again needs its guard
    // back. `prepareForRecycle` is the only way back from a [drop] that is not an
    // unmount, so this is the only place that has to re-arm it.
    armCompositionStrategy()
    model.reset()
    isDirty = true
    isMeasurePending = true
    sizingKeyChangePending = false
    contentSize = null
    // A recycled mount still paints its first frame for itself, and has to watch
    // for it again: the listener it registered for the previous mount is gone.
    hasMarkedFirstFrame = false
    firstFrameWatchRegistered = false
    releaseSizingInstance()
  }

  /**
   * Release the composition.
   *
   * Called from `onDropViewInstance`, which RN uses for a real unmount *and* as
   * the front door of recycling (see the class docs), so this is not only the
   * unmount path. Disposing is still the right call: with the recycling flag
   * off - the default - every call here is an unmount, and a composition left
   * alive would be retained until the activity dies.
   *
   * Disposing is not enough on its own. `AbstractComposeView` installs a
   * [ViewCompositionStrategy] when it is set and uninstalls it from nowhere else -
   * not from `disposeComposition()`, not from a detach - so the strategy installed
   * in [init] outlives the composition by the whole life of the activity. What it
   * installs is an observer on the activity's `LifecycleRegistry`, which holds its
   * observers strongly: one unmounted host, one strong path
   * `activity -> LifecycleRegistry -> observer -> ComposeView`, holding the view,
   * its `AndroidComposeView` and the disposed composition's residue - three `View`s
   * per control (host, `ComposeContent`, `AndroidComposeView`) and ~42 KiB. Measured
   * on the churn gate at 8.18 MiB retained per cycle of 200 Switches, which is how
   * `mount.<component>:nitro-ui:200` ran a 192 MiB heap out
   * (`docs/tasks/A1-baselines.report.md`,
   * `docs/tasks/B1-android-mount-oom.report.md`). Hence [unarmCompositionStrategy].
   */
  fun drop() {
    composeContent.disposeComposition()
    // After the dispose, not before: a strategy must be set with no composition
    // in flight, and the guard is worth nothing once the composition is gone.
    unarmCompositionStrategy()
    contentSize = null
    releaseSizingInstance()
  }

  /**
   * Install [DisposeOnLifecycleDestroyed] as the composition's guard.
   *
   * Compose's own default disposes on detach, which RN's detach behaviour makes
   * wrong for us (see [init]), and the alternative `DisposeOnViewTreeLifecycleDestroyed`
   * resolves the owner from the view tree, which for a view that is detached
   * between screens is the same activity anyway. The strategy is the one
   * Compose offers for a view with a 1-1 relationship with a [LifecycleOwner], and
   * we do have that - for one mount. Keeping it installed after the mount is what
   * leaks, so it is installed here and taken out again in
   * [unarmCompositionStrategy]; no-op without a `LifecycleOwner`, as before.
   */
  private fun armCompositionStrategy() {
    val owner = owner ?: return
    // `installFor` throws rather than skip when the owner is already DESTROYED, and
    // [prepareForRecycle] can run while an activity is being torn down (RN drops views
    // as a surface stops). A guard for a dead activity is worth nothing regardless, so
    // refuse it here instead of paying for its exception.
    if (owner.lifecycle.currentState == Lifecycle.State.DESTROYED) {
      return
    }
    composeContent.setViewCompositionStrategy(DisposeOnLifecycleDestroyed(owner))
  }

  /**
   * Uninstall whatever strategy is installed, by installing one that observes
   * nothing.
   *
   * Setting a strategy runs the previous strategy's uninstaller first, and that is
   * the only call site for it in `AbstractComposeView` - which is why [drop] has to
   * do this itself rather than trust `disposeComposition()` to let the host go.
   * [DisposeWithTheHost] then leaves nothing registered: if the view is never
   * attached again it retains nothing and observes nothing, and if it is (the
   * recycle path), [armCompositionStrategy] has already put the guard back.
   */
  private fun unarmCompositionStrategy() {
    composeContent.setViewCompositionStrategy(DisposeWithTheHost)
  }

  /**
   * Tell the sizing engine this instance is finished, then forget its id.
   *
   * The engine's per-instance maps otherwise keep an entry for every mount the
   * process ever made, which leaks for the life of a list that scrolls: expiry of
   * the Fabric `State` is not a signal it can wait for (review S3). Idempotent, so
   * the recycle path (which goes through [drop] first) is fine.
   */
  private fun releaseSizingInstance() {
    val instanceId = sizingInstanceId
    sizingInstanceId = NitroUiSizing.NO_INSTANCE
    lastReportedSize = null
    // Review N2: a flush listener registered on a `ViewTreeObserver` that never
    // attaches again would leave this true forever, and this host would never
    // schedule a flush after its first recycle. The listener itself dies with the
    // (stale) observer, so resetting the flag costs nothing.
    flushScheduled = false
    if (instanceId != NitroUiSizing.NO_INSTANCE) {
      NitroUiSizing.forget(instanceId)
    }
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
    if (changed && sizingKeyChangePending) {
      // This frame is the engine's answer for the new key, so whatever the control
      // now measures is a report about the right configuration: reset the dedupe and
      // ask for the measure that produces it (review F1). `changed` matters twice -
      // it proves the engine has answered, and a key change that moved no box has
      // nothing to correct.
      sizingKeyChangePending = false
      lastReportedSize = null
      remeasureToken.intValue += 1
    }
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
   * thing to a frame boundary available to a `ViewGroup` here, and the listener
   * removes itself once it has marked - but only then: a pass that finds a size
   * correction still queued is a frame about to be cancelled by
   * [scheduleSizingFlush], so unregistering there would mean this mount never
   * marks a first frame at all (measured: no `firstFrame`, no `drew` trace event).
   * [firstFrameWatchRegistered] keeps one listener per mount, since attaching a
   * view repeatedly would otherwise stack them and record the same box twice.
   */
  private fun watchForFirstFrame() {
    if (hasMarkedFirstFrame || firstFrameWatchRegistered) {
      return
    }
    val observer = viewTreeObserver
    if (!observer.isAlive) {
      return
    }
    firstFrameWatchRegistered = true
    observer.addOnPreDrawListener(
      object : ViewTreeObserver.OnPreDrawListener {
        override fun onPreDraw(): Boolean {
          if (NitroUiSizing.hasPendingReports()) {
            // A size measured this turn has not reached Yoga yet, and this frame
            // is the one [scheduleSizingFlush] cancels when it does flush. Staying
            // registered is what makes "first frame" mean the first frame a user
            // could have seen; the next pass decides again. Which of the two
            // listeners the observer runs first is not something to rely on, so
            // this does not: pending reports are enough either way.
            return true
          }
          unregister()
          hasMarkedFirstFrame = true
          NitroUiPerf.mark(perfInstanceId, NitroUiPerf.KIND_FIRST_FRAME)
          // What this frame actually drew into, for the sizing trace: the host
          // is the RN view, so its size here is Yoga's box in px. `onPreDraw`
          // runs after layout, so the box is final for this frame. dp, because
          // that is the unit the engine and the JS side speak.
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
          val current = viewTreeObserver
          if (current.isAlive) {
            current.removeOnPreDrawListener(this)
          }
        }
      }
    )
  }

  /**
   * Forget the size the engine already has from this host, so the next measure is
   * reported even when it matches the last one, and ask for that measure.
   *
   * For a component whose *configuration* changed, where the new configuration may
   * measure the same size as the old one. The engine has no answer for a key it has
   * not seen, so it lays the instance out at the component's declared fallback, and
   * this instance's own report is the only thing that can move the box back. The
   * epsilon in [reportToSizingEngine] compares with the size last reported - which
   * belongs to the configuration being replaced - so without this the correcting
   * report is the one it skips and the instance stays at the fallback, control
   * centred inside it (review F1: setting `systemImage` on Android measures the same
   * size, and its setter does not even recompose anything).
   *
   * Both halves wait for the layout that carries the new box, for the reason on
   * [remeasureToken]. An instance that has never measured has reported nothing, so
   * there is nothing to reset and its own first measure covers it - that is why the
   * first key of a mount does not arm this.
   */
  fun noteSizingKeyChanged() {
    if (contentSize == null) {
      return
    }
    sizingKeyChangePending = true
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
    // A pre-draw listener only runs when the window next traverses, and a quiet
    // window never decides to do that on its own: the listener above is a request
    // to be consulted at the next draw, not a request for one. A report that
    // arrives after an idle window's last draw - measured with a control inside
    // an RN `Modal`, whose dialog stops drawing once presented - would otherwise
    // leave its correction queued until some unrelated redraw came along.
    // `postInvalidateOnAnimation` is the cheapest traversal request that reaches
    // the window this host actually lives in (a `Modal` host's observer is the
    // dialog's, so anything rooted in the main window would miss it entirely):
    // it is vsync-aligned, coalesces with any invalidation already pending, and
    // its cost is usually cancelled outright, because a flush that applies a
    // correction returns `false` from `onPreDraw` and this very frame is skipped.
    // `requestLayout()` would also traverse, but re-measures the native subtree
    // for a size the traversal is about to correct anyway; a bare
    // `postOnAnimation` block runs without scheduling a traversal, so it does
    // not guarantee the listener is ever reached.
    postInvalidateOnAnimation()
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
    // Only the parts of a configuration that can move a control's size belong in
    // the signature. A rotation is a configuration change that moves no size, and
    // this fires once per mounted view, so bumping unconditionally would clear a
    // cache another control had just filled (review S2). Compose re-measures the
    // content by itself after a real change, and the new measure arrives as a
    // report; the engine decides whether the epoch moves.
    // `LocaleList` is not an `Iterable`, so the tags come out as the platform
    // already renders them: one comma-separated string, in priority order.
    // The dynamic colours come from resource overlays, and a configuration
    // change can swap them (night mode certainly does). Cheaper to rebuild the
    // one scheme than to key it on every part of a Configuration.
    NitroUiColorSchemes.invalidate()
    val locales = newConfig?.locales?.toLanguageTags() ?: ""
    NitroUiSizing.invalidateEnvironmentIfChanged(
      "${newConfig?.fontScale}|${newConfig?.densityDpi}|$locales",
    )
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
  MaterialTheme(colorScheme = NitroUiColorSchemes.forContext(context, dark), content = content)
}

/**
 * The key of [NitroUiColorSchemes], held weakly.
 *
 * A process-wide cache that keeps its key strongly keeps everything the key keeps.
 * Here the key is the `Context` the colours were read from - RN's
 * `ThemedReactContext`, whose base context is the `Activity` - so a strong key
 * would pin a destroyed Activity and its whole view hierarchy in every process
 * that ever mounts a control, until some later control composes against a
 * different context (which may be never). The value may stay strong: a
 * `ColorScheme` is a bag of colour longs and reaches nothing.
 *
 * Collected is not wrong, just a miss: [matches] compares the referent, so once
 * the context is gone the next control rebuilds the scheme. Nothing has to be
 * unregistered, and no entry outlives the thing it describes.
 *
 * Identity, not `equals`, as before: resource overlays are per-context, and two
 * `ThemedReactContext`s that compare equal can still be themed differently.
 */
internal class WeakKey<T : Any>(value: T) {
  private val reference = WeakReference(value)

  /** Whether this key is still alive and *is* [candidate]. */
  fun matches(candidate: T): Boolean = reference.get() === candidate

  /** The referent, or null once it has been collected. For tests of the contract. */
  val held: T?
    get() = reference.get()
}

/**
 * The one Material colour scheme of the process, shared by every hosted control.
 *
 * `remember` cannot do this job, which is what an earlier version of
 * [NitroUiTheme] assumed: a `remember` lives in one composition, and every
 * hosted control *is* its own composition (D8 - one host per view). So the
 * dynamic scheme, which reads ~50 framework resources and allocates a
 * `ColorScheme` with ~30 colours, was built once per mounted control, and
 * `SwitchColorsCache` (the tinted-colour cache), keyed by scheme identity - could never hit across
 * controls. Both costs are per instance, which is the wrong shape for a
 * value that is the same for every control on screen.
 *
 * The key is the `Context` the resources were read from (identity: resource
 * overlays are per-context) plus what the build actually branches on. A
 * configuration change can move those colours, so [invalidate] drops the entry
 * and the next control to compose rebuilds it; `uiMode` is also in the key
 * because the cached scheme can outlive every mounted control, and reading the
 * live `Configuration` is a field read, not a copy
 * (`ResourcesImpl#getConfiguration`).
 *
 * The context half of the key is a [WeakKey]: this object lives for the process,
 * and the context it is keyed on is the host's `Activity`. See [WeakKey] for why
 * that is a leak and why losing the entry to the collector is only a miss.
 *
 * Residual, measured as cosmetic rather than fixed: a dynamic-colour change the
 * platform delivers *without* a configuration change (a wallpaper swap on
 * Android 12+) keeps the old scheme until the next configuration change.
 * Material's own `DynamicColors` closes that with a process-wide receiver for
 * `ACTION_WALLPAPER_CHANGED` that bumps a version; silently registering another
 * receiver on the host app for a cosmetic case is a worse trade.
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

  /** A configuration change can move the dynamic colours: build the next one fresh. */
  fun invalidate() {
    entry = null
  }
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
 *   width maximum, unbind the height. The width maximum is the question - a
 *   Slider's height is what it is at *that* width. The height maximum must go for
 *   the same reason the width minimum goes: a box that is temporarily the wrong
 *   height (a `seedSize`-style guess, a stale cache, a correction still in flight)
 *   would otherwise clamp the answer to itself, and the wrong height would
 *   confirm itself forever - the report agrees with the layout, so the engine is
 *   never told and never corrects. iOS asks the same question the same way
 *   (`NitroSwiftUIHost.fittingSizeProposal`: box width, unbounded height).
 *
 *   The `else` arm covers a `fillWidth` control in a genuinely unbounded parent:
 *   with no width to fill there is nothing to ask but the unbounded question.
 *
 * Material's `minimumInteractiveComponentSize` (a 48 dp touch target) is part of
 * the size by design, and only [NitroComposeHost.wantsContentSize] pays for
 * recording at all.
 */
@Composable
internal fun NitroUiMeasuredRoot(
  record: Boolean,
  unbounded: Boolean,
  remeasureToken: IntState,
  onMeasured: (Int, Int) -> Unit,
  content: @Composable () -> Unit,
) {
  Layout(content) { measurables, constraints ->
    val childConstraints =
      if (unbounded) {
        // The unbounded question. See the kdoc: this is what makes the recorded
        // size the control's, not the box's.
        Constraints()
      } else if (constraints.hasBoundedWidth) {
        // The fill-width question: measure at the box's width, at any height.
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
    // Reading the token is the whole reason it is passed: measure blocks run under
    // `Snapshot.observeMeasure`, so a write to what they read marks *this* node
    // measure-dirty. That is the host's only lever to ask a mounted control to
    // measure again (see [NitroComposeHost.remeasureToken]), and a fresh measure is
    // the only thing that can produce the report a new sizing key is waiting for.
    val remeasureRequested = remeasureToken.value >= 0
    if (record && remeasureRequested && placeable != null) {
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

/**
 * A [ViewCompositionStrategy] that neither observes nor disposes.
 *
 * It exists so that installing it can uninstall something else: a strategy's
 * uninstaller only ever runs when the next strategy is installed, and this is the
 * cheapest strategy to be left with. The host owns the composition's lifetime and
 * ends it in `NitroComposeHost.drop`, which is what the composition is disposed by
 * from here on.
 */
private object DisposeWithTheHost : ViewCompositionStrategy {
  override fun installFor(view: AbstractComposeView): () -> Unit = {}
}

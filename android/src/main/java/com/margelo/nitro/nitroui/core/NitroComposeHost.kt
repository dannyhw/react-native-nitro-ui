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
import androidx.compose.runtime.mutableStateOf
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
 * - the composition's strategy is armed at [onAttachedToWindow], which is the first
 *   moment anything can compose, and unarmed at [drop];
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
 *
 * A pooled view therefore holds nothing this host registered: the pool is RN's, it
 * is unbounded, and RN empties it without telling the views in it (`ViewManager`
 * drops the whole map on `trimMemory` and on `onSurfaceStopped`), so arming
 * anything at pool entry would put a host that is never reused back into the
 * activity. Hence arming at attach rather than at recycle.
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
   * Whether a pre-draw listener is registered for this mount, with the observer it
   * was registered on.
   *
   * The pair, not just the flag: a `View` that is no longer attached answers
   * `viewTreeObserver` with a *fresh* floating observer, so removing through the
   * current one after a detach removes nothing and leaves the listener on the
   * window's observer - which holds it, and through it this host, for the life of
   * the window. [unregisterPreDraw] is the only way back.
   */
  private var firstFrameWatch: PreDrawWatch? = null

  /** The same, for the sizing flush. See [firstFrameWatch]. */
  private var flushWatch: PreDrawWatch? = null

  /**
   * Whether a composition strategy is currently installed for this host.
   *
   * A strategy is a registration on the activity, not a property of the view
   * ([armCompositionStrategy]), so it is armed only when there is something to
   * guard - the moment this host is attached - and never while this host is sitting
   * in RN's recycling pool, which RN empties without telling the views inside it.
   */
  private var strategyArmed = false

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

  /**
   * How many times this host's rendered content has been marked changed, for
   * [NitroUiMeasuredRoot]'s placement guard.
   *
   * [remeasureToken] moves when the *box* says something; this moves when the
   * *content* does. Content placed at its box's width answers that width whatever it
   * is, so an arming that outlived the content it was made for would keep the drawing
   * and lose every later correction - and a measure block cannot notice that by
   * reading this live, because a prop batch measures the host before its recomposition
   * has run (measured on `nitroui_t01`: setters, `commit()`, then Fabric's measure,
   * all in one message, with the recomposition dispatched after it). A measure taken
   * in the prop turn is still measuring the *old* content while this counter already
   * says new, so the number has to come from the composition that rendered it:
   * [NitroUiMeasuredRoot] reads it and gives the measure block the revision that
   * content was composed at.
   *
   * That is also what makes a stale pass harmless rather than fatal, which is why this
   * is a revision and not a flag the pass clears: a measure that arrives before the
   * recomposition measures content that is about to be replaced, so its verdict gets no
   * revision to stamp, and the guard refuses to place an unattributed arming bounded.
   * The first pass over the *new* content therefore still asks the unbounded question -
   * and reporting is the one thing a pass may never skip, since a bounded answer is the
   * box, and the box in the cache is the pre-T11 bug.
   *
   * Who reads it is the cost story: only a group that is placed at its box's width
   * reads it, so for content that fits its box - the whole bench corpus, and every
   * Switch on a plain screen - a bump here has no reader. It restarts no group, hands
   * `Layout` no new measure block and asks for no measure. What it costs every host is
   * the write: one snapshot record, the same kind the model's own prop writes make.
   */
  private val contentRevision = mutableIntStateOf(0)

  /**
   * The host's own note of whether this control's content overruns its box, and
   * whether to place it at the box's width (see [NitroUiOverWidePlacement]).
   *
   * Without it, an `intrinsic` control that wants more width than Yoga gave it is
   * drawn at its own width, centred, and cut off at both ends by the host's bounds
   * (G4 review F2): the visible part of an outer segment belongs to its neighbour,
   * so the ends of a long `SegmentedControl` row are both invisible and untappable.
   * iOS has no equivalent - SwiftUI lays a control *into* the box it is offered and
   * truncates - so this is the Android half of matching it.
   */
  private val overWidePlacement = NitroUiOverWidePlacement()

  /**
   * [noteOverWideContent] as one stable object.
   *
   * Held rather than written as `::noteOverWideContent` at the call site so that
   * passing it cannot itself be a reason for [NitroUiMeasuredRoot] to recompose: a
   * fresh lambda per recomposition is a changed argument per recomposition, which is
   * the cost this pass is careful not to add to controls that never overran.
   */
  private val noteOverWide: (Boolean) -> Unit = ::noteOverWideContent

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
    // No strategy is installed here: a strategy is a registration on the activity,
    // and nothing can compose until this host is attached, so
    // [onAttachedToWindow] arms it and nothing here has to. Arming any earlier would
    // make a host that is preallocated and then discarded - RN preallocates views -
    // a registration with no composition behind it.
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
        contentRevision = contentRevision,
        overWide = overWidePlacement,
        onMeasured = ::recordMeasuredSize,
        onOverWide = noteOverWide,
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
    // Every setter that changes what is drawn arrives here, and only when its value
    // actually changed (they compare first), so this is the host's one generic
    // "the content may be different now" signal. See [contentRevision].
    contentRevision.intValue += 1
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
    // No strategy is re-armed here, deliberately: this is pool entry, and the pool
    // is where a host may never be reused. [onAttachedToWindow] arms the guard for
    // the mount that follows, before that mount can compose.
    model.reset()
    isDirty = true
    isMeasurePending = true
    sizingKeyChangePending = false
    contentSize = null
    overWidePlacement.reset()
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
   * not from `disposeComposition()`, not from a detach - so the strategy armed for a
   * mount outlives its composition by the whole life of the activity. What it
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
    // Same rule as the strategy, different registrar: a pre-draw listener is held
    // by the observer it was registered on, which is the *window's* when the host
    // was attached, and a window outlives a control. A host dropped before its
    // listener ran has to take it out itself or the window keeps the host - the
    // same retention shape as the strategy, one per mount.
    unregisterPreDraw(firstFrameWatch)
    firstFrameWatch = null
    firstFrameWatchRegistered = false
    unregisterPreDraw(flushWatch)
    flushWatch = null
    contentSize = null
    overWidePlacement.reset()
    releaseSizingInstance()
  }

  /**
   * Install [DisposeOnLifecycleDestroyed] as the composition's guard.
   *
   * Compose's own default disposes on detach, which RN's detach behaviour makes
   * wrong for us (see [onAttachedToWindow]), and the alternative
   * `DisposeOnViewTreeLifecycleDestroyed` resolves the owner from the view tree -
   * which is not the activity whenever something else owns the view tree, as
   * react-native-screens does for a screen's fragment. The strategy is the one
   * Compose offers for a view with a 1-1 relationship with a [LifecycleOwner], and
   * we do have that - for one mount. Keeping it installed after the mount is what
   * leaks, so it is armed at attach and taken out again in
   * [unarmCompositionStrategy]; no-op without a `LifecycleOwner`, as before.
   */
  private fun armCompositionStrategy() {
    if (strategyArmed) {
      // Re-attaching a host that was detached without being dropped (a screen
      // transition, `removeClippedSubviews`) must not pay for a second observer.
      return
    }
    val owner = owner ?: return
    // `installFor` throws rather than skip when the owner is already DESTROYED, and
    // a view can be attached while an activity is being torn down (a surface that is
    // stopping still lays its tree out). A guard for a dead activity is worth nothing
    // regardless, so refuse it here instead of paying for its exception.
    if (owner.lifecycle.currentState == Lifecycle.State.DESTROYED) {
      return
    }
    composeContent.setViewCompositionStrategy(DisposeOnLifecycleDestroyed(owner))
    strategyArmed = true
  }

  /**
   * Uninstall whatever strategy is installed, by installing one that observes
   * nothing.
   *
   * Setting a strategy runs the previous strategy's uninstaller first, and that is
   * the only call site for it in `AbstractComposeView` - which is why [drop] has to
   * do this itself rather than trust `disposeComposition()` to let the host go.
   * [DisposeWithTheHost] then leaves nothing registered: a dropped host is not in
   * the activity any more, whether it is reused from the pool (whose only way back
   * is an attach, and [onAttachedToWindow] arms) or thrown away.
   */
  private fun unarmCompositionStrategy() {
    composeContent.setViewCompositionStrategy(DisposeWithTheHost)
    strategyArmed = false
  }

  /**
   * Take [watch] off the observer that holds it, if it is still on it.
   *
   * The observer captured at registration is the one holding the listener, so that
   * is the one to ask - while it is alive. A `ViewTreeObserver` dies when a
   * detached view's floating observer is merged into a window's, and the merge
   * copies the listeners into the live destination, which is the current observer
   * for a view that is now attached: hence the fallback. A merged listener that
   * ended up in some *other* window's observer is beyond reach from here, and
   * `ViewTreeObserver` throws for a listener it does not hold, so this stays a
   * best-effort removal rather than one that can crash an unmount.
   */
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
        return
      }
    try {
      observer.removeOnPreDrawListener(watch.listener)
    } catch (_: IllegalStateException) {
      // The listener is not in this observer: it went somewhere else with a merge.
    }
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
    // A flush listener that never ran would leave this true forever, and a host
    // that is recycled would then never schedule a flush again. [drop] has already
    // taken the listener off its observer; clearing the flag keeps the two in step.
    flushScheduled = false
    if (instanceId != NitroUiSizing.NO_INSTANCE) {
      NitroUiSizing.forget(instanceId)
    }
  }

  // MARK: - View lifecycle

  override fun onAttachedToWindow() {
    // The guard goes on before anything can compose, and this is the first moment
    // it can: the child's attach - which is where `AbstractComposeView` creates its
    // composition - is dispatched by `super`, and a measure while detached is
    // declined by [onMeasure]. Arming here instead of in [prepareForRecycle] is
    // what keeps a host that is in RN's recycling pool out of the activity's
    // `LifecycleRegistry`: the pool is unbounded and RN empties it without a word
    // to the views inside it, so a guard installed at pool entry would be a leak
    // with no unmount to explain it (review B1 M1).
    armCompositionStrategy()
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
   * Record that this content overruns the box it was just measured under, or that it
   * no longer does, and ask for the measure that can place it at the box's width.
   *
   * Called by [NitroUiMeasuredRoot]'s measure block, in the pass that found out, and
   * nowhere else. That is the whole point of it being a callback rather than a flag
   * this host reads after `super.onMeasure`, which is how the first version of the
   * placement pass worked: a host's `onMeasure` runs only when Fabric measures it with
   * a spec it has not seen (`View.measure` skips `onMeasure` for one it has), and the
   * passes that matter most never come through there at all - the one after a prop
   * batch, the one an armed sizing key change asks for, the one Compose runs from
   * `dispatchDraw` because a child changed size. An overrun noticed by one of those
   * and left for a later `onMeasure` is an overrun nobody hears about, because nothing
   * else is going to measure a view whose box did not move.
   *
   * The token is the same lever an armed sizing key change uses (see
   * [remeasureToken]), and this is a write to the state the calling measure block
   * reads, from inside that block: Compose routes that as a request to measure the
   * node again, deferred to the end of the traversal, which is exactly the ask. It is
   * only made when there is something to place, and the bounded pass that answers it
   * writes nothing, so the asking stops with that pair.
   *
   * One traversal's worth of the unbounded drawing does reach the screen first, and it
   * cannot be avoided here: a `Measurable` may be measured exactly once per pass
   * (`MeasurePassDelegate` throws for a second `measure()`, checked against the
   * bytecode of Compose UI 1.12.1), so the pass that learns of an overrun has nothing
   * else to place. It is why a prop change to a fitted control costs a clipped frame,
   * and only ever for a control whose content does not fit.
   *
   * Only the arming is written here. The two stamps beside it belong to the measure
   * block, the only place that knows both the box the content was asked under and the
   * content the composition actually rendered.
   */
  private fun noteOverWideContent(overruns: Boolean) {
    overWidePlacement.armed.value = overruns
    if (overruns) remeasureToken.intValue += 1
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
      overWidePlacement.reset()
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
    val listener =
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
          unregisterPreDraw(firstFrameWatch)
          firstFrameWatch = null
        }
      }
    firstFrameWatch = PreDrawWatch(listener, observer)
    observer.addOnPreDrawListener(listener)
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
   * from stacking listeners up. A host that detaches first does not get a free pass:
   * the listener it left on that window's observer is removed by [drop], because the
   * observer outlives the host and would otherwise hold it (review B1 M2). A lost
   * flush only means one frame drawn at the fallback size.
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
    // A new font scale or locale changes what the content wants, which is the one
    // thing the sticky placement flag must not hide: the next measure has to ask the
    // unbounded question again to find out.
    overWidePlacement.reset()
    // ...and something has to *be* that next measure. Compose re-measures for its own
    // reasons after a configuration change, but it is not obliged to re-measure a node
    // whose measured size it has no reason to doubt, and the arming lost above is only
    // re-made by a pass that asks the unbounded question. Ask for that pass.
    remeasureToken.intValue += 1
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
 * When the honest question comes back wider than the box - a long `SegmentedControl`
 * row under a caller's `width`, or one the engine clamped to its parent - the pass
 * that learned it asks for a second question, this one with the box's width (its
 * height still free), and the control then lays itself out the way it would in a
 * Compose layout of that width: labels ellipsize, a row's segments share the space.
 * That pass is for placement only and reports nothing, so the size the engine is
 * given stays the control's own; a `height` too small for the control still clips it
 * centred, as it did before and as the caller's `height` always meant.
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
  contentRevision: IntState,
  overWide: NitroUiOverWidePlacement,
  onMeasured: (Int, Int) -> Unit,
  onOverWide: (Boolean) -> Unit,
  content: @Composable () -> Unit,
) {
  // Both reads are gated on the arming, and that gate is the whole cost story of the
  // placement work: content that never overran its box never arms, so it observes
  // neither of these and a prop batch through [NitroComposeHost.markDirty] neither
  // restarts this group nor hands `Layout` a different measure block for it. Only
  // content that is placed at its box's width pays, which is the content that needs it.
  //
  // [contentRevision] has to be read *here* rather than in the measure block, and that
  // is not a style choice: a block reading the live value reads the revision of content
  // it has not rendered yet (the reason is on the field), and content placed at a box's
  // width answers that width whatever it is, so Compose has no child-size change to
  // propagate and never asks again. The composition is the only thing that knows what it
  // rendered, so the revision has to travel with it - and reading
  // [NitroUiOverWidePlacement.armed] is what makes the gating possible, because writing
  // it at an overrun restarts this group, which is the moment this group starts
  // observing the revision.
  val armedAtComposition = if (unbounded) overWide.armed.value else false
  val revision =
    if (armedAtComposition) {
      contentRevision.value
    } else {
      NitroUiOverWidePlacement.NO_REVISION
    }
  Layout(content) { measurables, constraints ->
    // Which of the two questions to ask the content.
    //
    // The arming and its width are read live rather than captured above because this
    // block is what makes and unmakes them, and a decision taken from a
    // composition-time copy would always be a pass late. They are plain fields, and
    // that matters: a measure block that observes what it writes dirties the node it
    // runs in, which here would be a measure → arm → measure loop that never settles.
    // The one write that has to reach Compose is the ask for the next measure, and that
    // goes through [remeasureToken], which this block already reads.
    //
    // The revision is the exception, and it is what keeps a stale pass from doing
    // damage. Honour an arming only for the content that made it: `NO_REVISION` on
    // either side says the same thing - the pass that armed could not say what it had
    // measured, which is what a measure inside the prop batch that is about to be
    // recomposed means - and an arming that cannot name its content is never placed.
    // Such an arming exists to buy one more unbounded pass, and that is exactly the
    // pass the content it could not see needs in order to be reported at all.
    val placeAtBoxWidth =
      unbounded &&
      overWide.armed.value &&
      constraints.hasBoundedWidth &&
      constraints.maxWidth == overWide.armedWidthPx &&
      revision != NitroUiOverWidePlacement.NO_REVISION &&
      revision == overWide.armedRevision
    val childConstraints =
      if (unbounded && !placeAtBoxWidth) {
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
    if (record && remeasureRequested && placeable != null && !placeAtBoxWidth) {
      onMeasured(measuredWidth, measuredHeight)
    }
    if (unbounded && !placeAtBoxWidth && constraints.hasBoundedWidth) {
      // Only the unbounded question can answer this, and it answers it every time: a
      // row that fits says so, which is what releases the arming when a box grows back
      // to the control's size. The stamps are written by the pass that has the facts -
      // the box this content was asked under, and the revision this composition
      // rendered, which may be no revision at all - and the host is told from here
      // rather than looked at afterwards, because the pass that discovers an overrun is
      // the only one that will: Fabric has no reason to measure this view again for a
      // box that did not move, and Compose has no child size change to propagate once
      // the content answers the box's width. Being told from inside the pass is what
      // makes the second measure happen.
      //
      // An unbounded box skips the verdict entirely: there is nothing to overrun, and
      // an arming made against a narrower box is still true of the content. And a
      // verdict that changes nothing - the content fits, and nothing was armed - says
      // nothing to the host, which is every control that fits its box.
      val overruns = measuredWidth > constraints.maxWidth
      overWide.armedWidthPx = if (overruns) constraints.maxWidth else -1
      overWide.armedRevision = revision
      if (overruns || overWide.armed.value) {
        onOverWide(overruns)
      }
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
 * What the host knows about content that is wider than the box RN gave it.
 *
 * One snapshot value and two plain fields, and the split is load-bearing rather than
 * tidy. [armed] is observed by [NitroUiMeasuredRoot]'s composition, which is what both
 * starts the placement and lets content that never overran observe nothing at all: the
 * write that flips it restarts that group, and the restarted group is the one that can
 * say which content it rendered. The two stamps are written by the measure block, which
 * runs under `Snapshot.observeMeasure`: a block that observes what it writes dirties
 * the node it runs in, which here would be a permanent dirty → measure → honest → arm →
 * dirty loop. Everyone is on the UI thread.
 */
internal class NitroUiOverWidePlacement {
  /**
   * Whether this content is currently placed at its box's width.
   *
   * Sticky rather than per-pass, and it has to be: asking the unbounded question,
   * seeing that it does not fit, and then placing at the box is already two measures.
   * Clearing it after each pass would make that pair the steady state: every pass would
   * start with the question that cannot fit and answer it again.
   *
   * It is a property of one content at one box, so it is *made* by the first unbounded
   * pass that overruns - [armedWidthPx] records the box it overran and [armedRevision]
   * the content it measured, which may be [NO_REVISION] - and *unmade* by the first
   * unbounded pass that fits. A pass under any other box, or over any other content,
   * asks the unbounded question instead, which is the only question that can both find
   * the overrun again and report a size; and the pass that finds it is the one that asks
   * for the placement measure, because nothing else is going to measure a view whose box
   * did not move. It is reset outright when the environment it was measured in changes
   * ([NitroComposeHost.onConfigurationChanged]), when a new sizing key arrives
   * ([NitroComposeHost.onLayout]) and with the mount.
   */
  val armed = mutableStateOf(false)

  /**
   * The box width [armed] was made against, in the px the measure block saw it, or -1
   * (a box width is never negative).
   *
   * The arming is only honoured while the box still has that width, which is what stops
   * two wrong drawings from surviving: content that overran the engine's *first* guess
   * at a box (Yoga's provisional fallback, before the control's own report corrects it)
   * would otherwise be placed at that too-small width forever, and content that has
   * since been given room would stay squeezed into a width it no longer needs. A pass
   * under any other width asks the unbounded question, and that pass either releases
   * the arming or makes a new one for the width it was asked under.
   */
  var armedWidthPx = -1

  /**
   * The [NitroComposeHost.contentRevision] of the content this arming was made against,
   * or [NO_REVISION] when the pass that made it could not tell.
   *
   * The other half of "the box the control overran is still the box it has": props
   * change what the content wants without moving the frame at all, and content measured
   * at a box's width answers that width for *any* content, so an arming that outlived
   * its content would keep the drawing and swallow every later correction. A group
   * placed at the box is subscribed to the revision ([NitroUiMeasuredRoot]), so the pass
   * after a prop change is the one that finds the mismatch and asks again. An arming
   * stamped [NO_REVISION] is never honoured, and re-making it costs one more unbounded
   * pass - the pass that has to happen anyway for new content to be reported.
   */
  var armedRevision = NO_REVISION

  fun reset() {
    armed.value = false
    armedWidthPx = -1
    armedRevision = NO_REVISION
  }

  internal companion object {
    /**
     * "this pass cannot say which content it measured".
     *
     * [NitroComposeHost.contentRevision] starts at 0 and only grows, so -1 is never a
     * revision. A composition only subscribes to the revision once it is placing at its
     * box's width, so a pass before that - and above all the one that runs inside the
     * prop batch, before the recomposition it belongs to - reads this instead. Stamped
     * onto an arming it means the arming is not attributable to any content, so
     * [NitroUiMeasuredRoot]'s guard will not place it, and the next pass asks the
     * unbounded question. There is no adopting a stamp later: an arming is good for the
     * content that measured it, and for nothing else.
     */
    const val NO_REVISION = -1
  }
}

/**
 * A `ViewTreeObserver.OnPreDrawListener` and the observer it was registered on.
 *
 * The two belong together: `View.getViewTreeObserver()` hands a detached view a
 * *new* floating observer, so the only handle on the observer that is actually
 * holding the listener is the one taken when the listener went on it.
 */
private class PreDrawWatch(
  val listener: ViewTreeObserver.OnPreDrawListener,
  val observer: ViewTreeObserver,
)

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

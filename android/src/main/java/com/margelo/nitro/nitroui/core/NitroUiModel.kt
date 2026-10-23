package com.margelo.nitro.nitroui.core

/**
 * Base class for a component's per-instance state - the Compose twin of
 * `NitroUiModel` on iOS.
 *
 * One model per Hybrid View, created with it and never replaced (see
 * `docs/research/core-architecture.md` §3). Subclasses expose their values as
 * `mutableStateOf` properties, so writing one invalidates exactly the composables
 * that read it; [NitroComposeHost.commit] then flushes the batch with one
 * `Snapshot.sendApplyNotifications()`.
 *
 * Never replace the model object, and never rebuild it from a props copy - that
 * is how a per-prop recomposition storm starts.
 */
abstract class NitroUiModel {
  /**
   * Called when the view is recycled: put every field back to its default.
   *
   * Nothing carries over from the previous row - not the model fields, and not
   * the composition either, which `NitroComposeHost.drop()` disposed before this
   * ran (see `docs/architecture/core.md` §6). Leftover state here would show up
   * in the reused row with no props having been sent yet.
   */
  abstract fun reset()
}

/**
 * A value the user can change and React can also write, reconciled with the
 * event-count handshake (`docs/research/core-architecture.md` §4).
 *
 * Native owns [displayed] and updates it immediately on interaction, so there is
 * no visual latency. [js] is the last value React sent, kept *separately*, which
 * is what makes a rejected change revert even though React never called the
 * setter again.
 *
 * Kotlin twin of `NitroUiControlledValue` on iOS. Not a snapshot state itself -
 * components keep it inside a `mutableStateOf` so writes are observed.
 */
class NitroUiControlledValue<T>(displayed: T) {
  /** What the UI shows right now. */
  var displayed: T = displayed

  /** The last `value` React sent, or `null` while uncontrolled. */
  var js: T? = null

  /**
   * The newest value a native interaction reached that has **not** been emitted.
   *
   * A continuous control sets this on every input sample and clears it when the
   * frame tick emits it (`docs/architecture/core.md` §11). It belongs to the
   * handshake rather than to the component because it is the one case where
   * `jsEvents >= nativeEvents` is not enough: the count only advances when we
   * emit, so while this is set native is ahead by a value JS cannot have seen -
   * and accepting a write in that window paints the app's number for a frame
   * before the interaction's own value is emitted under it.
   */
  var unreported: T? = null

  /** How many changes native emitted. */
  var nativeEvents: Int = 0

  /** How many of those changes JS confirmed it processed. */
  var jsEvents: Int = 0

  /** The user changed the value. Returns the new event count to emit. */
  fun user(value: T): Int {
    displayed = value
    nativeEvents += 1
    return nativeEvents
  }

  /**
   * Apply a pending React write. Returns whether [displayed] changed.
   *
   * A write is dropped when `jsEvents < nativeEvents` (stale: JS has not seen our
   * newest event yet) and while [unreported] is set (native holds a value JS has
   * not been told about). Neither is *queued*: the next commit decides again.
   */
  fun reconcile(): Boolean {
    val pending = js ?: return false
    if (unreported != null || jsEvents < nativeEvents || pending == displayed) {
      return false
    }
    displayed = pending
    return true
  }
}

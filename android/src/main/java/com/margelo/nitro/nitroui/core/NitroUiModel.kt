package com.margelo.nitro.nitroui.core

/**
 * A component's per-instance state. One model per view, never replaced: subclasses hold
 * `mutableStateOf` properties, so a write invalidates only the composables that read it.
 */
abstract class NitroUiModel {
  /**
   * Called on recycle: put every field back to its default, or the reused view shows the
   * previous row's state before its first props arrive.
   */
  abstract fun reset()
}

/**
 * A value both the user and React can change. Native updates [displayed] at once; [js] is
 * kept apart so a change React rejects can be reverted without React writing again.
 * Not snapshot state itself: hold it in a `mutableStateOf`.
 */
class NitroUiControlledValue<T>(displayed: T) {
  var displayed: T = displayed

  /** The last `value` React sent, or `null` while uncontrolled. */
  var js: T? = null

  /**
   * The newest value an interaction reached that has not been emitted yet. React writes
   * are ignored while it is set, because JS cannot have seen it.
   */
  var unreported: T? = null

  var nativeEvents: Int = 0

  /** How many of [nativeEvents] JS has confirmed it processed. */
  var jsEvents: Int = 0

  /** The user changed the value. Returns the new event count to emit. */
  fun user(value: T): Int {
    displayed = value
    nativeEvents += 1
    return nativeEvents
  }

  /**
   * Applies the pending React write and returns whether [displayed] changed. A write is
   * dropped, not queued, while JS is behind on events or [unreported] is set.
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

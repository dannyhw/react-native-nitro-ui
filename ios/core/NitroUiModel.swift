// Per-instance state of a hosted control: one model per Hybrid View, created with it and
// never replaced.

import Combine

/// Base class for component models.
///
/// Subclasses use plain stored properties and mark the host dirty when they change; the host
/// sends `objectWillChange` once per `afterUpdate`. `@Published` would notify once per
/// property instead. Main thread only.
class NitroUiModel: ObservableObject {
  /// A `let`, so the publisher's identity never changes.
  let objectWillChange = ObservableObjectPublisher()

  init() { }
}

/// A value the user can change and React can also write, reconciled by event count.
///
/// Native owns `displayed` and updates it immediately on interaction. `js` is the last value
/// React sent, kept separately so that a rejected change reverts even though React did not
/// call the setter again.
struct NitroUiControlledValue<Value: Equatable> {
  /// What the UI shows right now.
  var displayed: Value
  /// The last `value` React sent, or `nil` while uncontrolled.
  var js: Value?
  /// The newest value a native interaction reached that has not been emitted yet. While it
  /// is set, native is ahead by a value JS cannot have seen, which the event counts alone
  /// do not show.
  var unreported: Value?
  /// How many changes native emitted.
  var nativeEvents: Int = 0
  /// How many of those changes JS confirmed it processed.
  var jsEvents: Int = 0

  init(displayed: Value) {
    self.displayed = displayed
  }

  /// The user changed the value. Returns the new event count to emit.
  mutating func user(_ value: Value) -> Int {
    displayed = value
    nativeEvents += 1
    return nativeEvents
  }

  /// Apply a pending React write. Returns whether `displayed` changed.
  ///
  /// A write is dropped when `jsEvents < nativeEvents` (JS has not seen our newest event
  /// yet) and while `unreported` is set. Neither is queued: the next commit decides again.
  mutating func reconcile() -> Bool {
    guard let js, unreported == nil, jsEvents >= nativeEvents, js != displayed else {
      return false
    }
    displayed = js
    return true
  }
}

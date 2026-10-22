//
//  NitroUiModel.swift
//  react-native-nitro-ui
//
//  Per-instance state of a hosted control. One model per Hybrid View, created
//  with it and never replaced (docs/research/core-architecture.md §2).
//

import Combine

/// Base class for component models.
///
/// Subclasses use **plain stored properties** and mark the host dirty when they
/// change; ``NitroSwiftUIHost/commit()`` sends ``objectWillChange`` exactly once
/// per `afterUpdate`. That is deliberate:
/// - `@Published` would notify per property (and pay Combine's side-table
///   lookup), so one batch of six props would mean six invalidations;
/// - `@Observable` (iOS 17+) is an option later but is not needed for a
///   single-control model, and would raise the minimum OS.
///
/// The component's root view holds the model in an `@ObservedObject`, which is
/// what makes SwiftUI subscribe to this publisher.
///
/// All members are touched on the main thread only; see `NitroUiMainThread`.
class NitroUiModel: ObservableObject {
  /// Manual publisher - note `let`, so the identity never changes and there is
  /// one `send()` per commit.
  let objectWillChange = ObservableObjectPublisher()

  init() { }
}

/// A value the user can change and React can also write, reconciled with the
/// event-count handshake (docs/research/core-architecture.md §4).
///
/// Native owns `displayed` and updates it immediately on interaction, so there
/// is no visual latency. `js` is the last value React sent, kept *separately*,
/// which is what makes a rejected change revert even though the prop's identity
/// never changed (React did not call the setter again).
struct NitroUiControlledValue<Value: Equatable> {
  /// What the UI shows right now.
  var displayed: Value
  /// The last `value` React sent, or `nil` while uncontrolled.
  var js: Value?
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
  /// Writes with `jsEvents < nativeEvents` are stale (JS has not seen our newest
  /// event yet) and are dropped.
  mutating func reconcile() -> Bool {
    guard let js, jsEvents >= nativeEvents, js != displayed else {
      return false
    }
    displayed = js
    return true
  }
}

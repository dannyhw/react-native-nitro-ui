import Foundation

/// `@main` because `swiftc` only allows top-level statements in a file named
/// `main.swift`, and this compiles together with the shipping core file.
@main
struct HandshakeTest {
  private static var failures = 0

  private static func check(_ condition: Bool, _ what: String) {
    if condition {
      print("  ok    \(what)")
    } else {
      print("  FAIL  \(what)")
      failures += 1
    }
  }

  static func main() {

    print("NitroUiControlledValue")

    // Fresh: uncontrolled, so a React write has nothing to apply.
    do {
      var value = NitroUiControlledValue<Bool>(displayed: false)
      check(value.displayed == false, "starts at the displayed default")
      check(value.js == nil, "uncontrolled has no pending React write")
      check(value.reconcile() == false, "uncontrolled reconcile changes nothing")
      check(value.nativeEvents == 0 && value.jsEvents == 0, "no events yet")
    }

    // The user changes it: native displays it at once and counts the event.
    do {
      var value = NitroUiControlledValue<Bool>(displayed: false)
      check(value.user(true) == 1, "user() returns the event count to emit")
      check(value.displayed == true, "user() updates the displayed value immediately")
      check(value.user(false) == 2 && value.user(true) == 3,
            "rapid interaction keeps counting")
      check(value.displayed == true, "the last interaction wins")
      check(value.reconcile() == false, "uncontrolled native keeps what the user did")
    }

    // Rejected change: JS keeps its old value, so only the event count moves.
    // Native must revert - but only once JS has caught up.
    do {
      var value = NitroUiControlledValue<Bool>(displayed: false)
      value.js = false
      let eventCount = value.user(true)
      check(eventCount == 1 && value.displayed == true, "optimistic while JS thinks")
      check(value.reconcile() == false && value.displayed == true,
            "a write is stale until JS echoes this many events")
      value.jsEvents = 1
      check(value.reconcile() == true, "the echo lets the rejected write revert")
      check(value.displayed == false, "the rejected change reverted")
      check(value.reconcile() == false, "reconciling twice changes nothing")
    }

    // Stale write: a `value` in flight must not clobber what the user just did.
    do {
      var value = NitroUiControlledValue<Bool>(displayed: false)
      _ = value.user(true)
      value.js = true
      value.jsEvents = 0
      check(value.reconcile() == false && value.displayed == true,
            "a stale write is dropped, not queued")
      value.js = false
      value.jsEvents = 1
      check(value.reconcile() == true && value.displayed == false,
            "the next write after catching up applies")
    }

    // Rapid interaction: two taps in one JS round trip, and JS then writes a
    // value that only matches the *first* of them. Native must accept the write
    // (JS has seen both events) and stop showing the second one.
    do {
      var value = NitroUiControlledValue<Bool>(displayed: false)
      value.js = true
      check(value.user(true) == 1, "first tap")
      check(value.user(false) == 2, "second tap before JS has seen the first")
      check(value.displayed == false, "native shows the newest interaction")
      check(value.reconcile() == false, "a write is still stale before the echo")
      value.jsEvents = 2
      check(value.reconcile() == true && value.displayed == true,
            "the newest write applies once JS has seen every event")
    }

    // Uncontrolled -> controlled: the mode switch seeds the echo (see
    // useControlled.ts), so the first controlled write must apply immediately
    // instead of looking stale until the next tap.
    do {
      var value = NitroUiControlledValue<Bool>(displayed: false)
      _ = value.user(true)
      _ = value.user(false)
      check(value.nativeEvents == 2 && value.jsEvents == 0,
            "uncontrolled interactions leave JS behind")
      check(value.reconcile() == false, "uncontrolled native keeps what the user did")
      value.js = true
      value.jsEvents = 2  // what the seeded `mostRecentEventCount` now sends
      check(value.reconcile() == true && value.displayed == true,
            "the first controlled write after a mode switch applies")
    }

    // A non-Bool value (what Slider/Picker will use) behaves the same, and float
    // equality is `Equatable` equality - a 0.5 step that arrives unchanged is not a
    // change.
    do {
      var value = NitroUiControlledValue<Double>(displayed: 0)
      check(value.user(0.25) == 1, "doubles count events")
      value.js = 0.25
      value.jsEvents = 1
      check(value.reconcile() == false, "an unchanged value is not reported as a change")
      value.js = 0.5
      check(value.reconcile() == true && value.displayed == 0.5, "a new value applies")
      value.js = 0.5000000000000001
      check(value.reconcile() == true, "a different double is a change")
    }

    if failures > 0 {
      print("FAILED: \(failures) check(s)")
      exit(1)
    }
    print("handshake.test: all checks passed")
  }
}

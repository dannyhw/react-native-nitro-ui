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

    do {
      var value = NitroUiControlledValue<Bool>(displayed: false)
      check(value.displayed == false, "starts at the displayed default")
      check(value.js == nil, "uncontrolled has no pending React write")
      check(value.reconcile() == false, "uncontrolled reconcile changes nothing")
      check(value.nativeEvents == 0 && value.jsEvents == 0, "no events yet")
    }

    do {
      var value = NitroUiControlledValue<Bool>(displayed: false)
      check(value.user(true) == 1, "user() returns the event count to emit")
      check(value.displayed == true, "user() updates the displayed value immediately")
      check(value.user(false) == 2 && value.user(true) == 3,
            "rapid interaction keeps counting")
      check(value.displayed == true, "the last interaction wins")
      check(value.reconcile() == false, "uncontrolled native keeps what the user did")
    }

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

    // A continuous control holds its newest sample until the frame tick emits it,
    // so the counts look caught up while native is ahead by an unreported value.
    do {
      var value = NitroUiControlledValue<Double>(displayed: 0)
      value.js = 0
      check(value.user(0.4) == 1, "a drag emits its first change")
      value.unreported = 0.45
      value.js = 0.2
      value.jsEvents = 1
      check(value.jsEvents >= value.nativeEvents, "the counts look caught up")
      check(value.reconcile() == false,
            "a write is refused while native holds an un-emitted sample")
      check(value.displayed == 0.4, "what was last emitted is still what is shown")
      value.unreported = nil
      check(value.reconcile() == true && value.displayed == 0.2,
            "once the sample is emitted, the write is judged by the count alone")
    }

    do {
      var value = NitroUiControlledValue<Double>(displayed: 0)
      value.unreported = 5
      check(value.user(7) == 1 && value.displayed == 7,
            "an interaction is not blocked by an un-emitted sample")
      check(value.reconcile() == false, "with nothing from React there is still nothing to apply")
      value.js = 9
      value.jsEvents = 1
      check(value.reconcile() == false, "an un-emitted sample still refuses the write")
      value.unreported = nil
      check(value.reconcile() == true && value.displayed == 9, "and clearing it lets the write through")
    }

    if failures > 0 {
      print("FAILED: \(failures) check(s)")
      exit(1)
    }
    print("handshake.test: all checks passed")
  }
}

import CoreGraphics
import Foundation

/// `@main` because `swiftc` only allows top-level statements in a file named `main.swift`.
@main
struct GestureSettlementTest {
  private static var failures = 0

  private static func check(_ condition: Bool, _ what: String) {
    if condition {
      print("  ok    \(what)")
    } else {
      print("  FAIL  \(what)")
      failures += 1
    }
  }

  private struct Screen: Equatable {
    var x: CGFloat = 0
    var hittable = true
    var presentations = 0
    var rows = 0

    var insideWindow: Bool { hittable && x >= 0 && x <= 400 - 120 }
  }

  /// A scripted `read`: the i-th call answers with the i-th screen, and the last repeats.
  private static func script(_ screens: [Screen]) -> (read: () -> Screen, calls: () -> Int) {
    var index = 0
    return (
      {
        defer { index += 1 }
        return screens[min(index, screens.count - 1)]
      },
      { index }
    )
  }

  /// A clock that advances only when time is spent, so a bounded wait is deterministic.
  private final class Clock {
    private(set) var ms = 0
    func spend(_ amount: Int) { ms += amount }
    var now: () -> Int { { self.ms } }
  }

  static func main() {
    print("GestureSettlement")

    do {
      let scripted = script([Screen(x: 40), Screen(x: 40)])
      let clock = Clock()
      let outcome = GestureSettlement.settle(
        deadlineMs: 60_000,
        read: scripted.read,
        agrees: ==,
        satisfied: { $0.insideWindow },
        mayPress: { _ in true },
        press: { _ in },
        nowMs: clock.now,
        pause: { _ in }
      )
      check(outcome.satisfied, "a tab already inside the window settles")
      check(outcome.reads == 2, "a settled screen costs two reads, not one (got \(outcome.reads))")
      check(outcome.presses == 0, "a tab already inside the window is never dragged (got \(outcome.presses))")
      check(!outcome.outOfBudget, "a satisfied wait is not out of budget")
    }

    do {
      let scripted = script([
        Screen(x: 500), Screen(x: 500),      // agrees outside -> drag 1
        Screen(x: 400),                      // still moving: no drag
        Screen(x: 400),                      // agrees outside -> drag 2
        Screen(x: 340),                      // still moving
        Screen(x: 340),                      // agrees outside -> drag 3
        Screen(x: 40), Screen(x: 40),        // agrees inside -> settled
      ])
      let clock = Clock()
      var dragged: [CGFloat] = []
      let outcome = GestureSettlement.settle(
        deadlineMs: 60_000,
        read: scripted.read,
        agrees: ==,
        satisfied: { $0.insideWindow },
        mayPress: { _ in true },
        press: { _ in dragged.append(scripted.calls() == 0 ? 0 : 1) },
        nowMs: clock.now,
        pause: { _ in }
      )
      check(outcome.satisfied, "a tab that needs three drags arrives")
      check(outcome.presses == 3, "three drags, one per settled-and-outside reading (got \(outcome.presses))")
      check(outcome.reads == 8, "the mid-flight reads are read, not dragged (got \(outcome.reads) reads)")
      check(dragged.count == 3, "`press` was called once per drag (got \(dragged.count))")
    }

    do {
      let scripted = script([
        Screen(presentations: 0, rows: 0), Screen(presentations: 0, rows: 0),  // nothing up -> tap 1
        Screen(presentations: 1, rows: 0), Screen(presentations: 1, rows: 0),  // up, content late: WAIT
        Screen(presentations: 1, rows: 1), Screen(presentations: 1, rows: 1),  // content published
      ])
      let clock = Clock()
      var taps = 0
      let outcome = GestureSettlement.settle(
        deadlineMs: 24_000,
        read: scripted.read,
        agrees: ==,
        satisfied: { $0.rows > 0 },
        mayPress: { $0.presentations == 0 },
        press: { _ in taps += 1 },
        nowMs: clock.now,
        pause: { _ in }
      )
      check(outcome.satisfied, "a slow popover publish still settles")
      check(taps == 1, "exactly one gesture reaches an anchor whose popover is coming up (got \(taps))")
      check(outcome.presses == 1, "the outcome counts the one gesture it sent")
      check(!outcome.outOfBudget, "waiting out a slow publish is not running out")
    }

    do {
      let scripted = script([
        Screen(presentations: 0, rows: 0), Screen(presentations: 0, rows: 0),
        Screen(presentations: 1, rows: 0), Screen(presentations: 1, rows: 0),
        Screen(presentations: 1, rows: 0), Screen(presentations: 1, rows: 0),
      ])
      let clock = Clock()
      let outcome = GestureSettlement.settle(
        deadlineMs: 24_000,
        maxPresses: 3,
        read: scripted.read,
        agrees: ==,
        satisfied: { $0.rows > 0 },
        mayPress: { _ in true },
        press: { _ in },
        nowMs: clock.now,
        pause: { _ in }
      )
      check(
        outcome.presses == 3 && !outcome.satisfied,
        "pressing regardless of the state is the flake: 3 taps, nothing up at the end (got \(outcome.presses))"
      )
    }

    do {
      let scripted = script([
        Screen(presentations: 0, rows: 0), Screen(presentations: 0, rows: 0), // nothing up -> tap 1
        Screen(presentations: 0, rows: 0), // still no window: UIKit has not presented yet
        Screen(presentations: 1, rows: 1), Screen(presentations: 1, rows: 1), // it arrived, with content
      ])
      let clock = Clock()
      var taps = 0
      let outcome = GestureSettlement.settle(
        deadlineMs: 24_000,
        read: scripted.read,
        agrees: ==,
        satisfied: { $0.rows > 0 },
        mayPress: { $0.presentations == 0 },
        press: { _ in taps += 1 },
        nowMs: clock.now,
        pause: { _ in }
      )
      check(
        taps == 1,
        "a popover that presents two reads after the tap is tapped once, not twice (got \(taps))"
      )
      check(
        outcome.presses == 1,
        "the outcome counts the one tap it sent (got \(outcome.presses))"
      )
      check(
        outcome.satisfied,
        "and the wait settles on the content rather than running out"
      )
    }

    do {
      let clock = Clock()
      var pressAtMs: [Int] = []
      let outcome = GestureSettlement.settle(
        deadlineMs: 60_000,
        maxPresses: 2,
        quietAfterPressMs: 8_000,
        read: {
          clock.spend(700)
          return Screen(presentations: 0, rows: 0)
        },
        agrees: ==,
        satisfied: { $0.rows > 0 },
        mayPress: { $0.presentations == 0 },
        press: { _ in pressAtMs.append(clock.ms) },
        nowMs: clock.now,
        pause: { _ in }
      )
      let gapMs = pressAtMs.count >= 2 ? pressAtMs[1] - pressAtMs[0] : -1
      check(
        gapMs >= 8_000,
        "the second tap waits out the quiet period (gap \(gapMs) ms)"
      )
      check(
        outcome.presses == 2,
        "a quiet period delays a re-send, it does not cancel one (got \(outcome.presses))"
      )
      check(!outcome.satisfied, "an anchor that never presents still fails")
      check(outcome.outOfBudget, "and says it ran out rather than settled")
    }

    do {
      var flip = false
      let clock = Clock()
      let outcome = GestureSettlement.settle(
        deadlineMs: 5_000,
        read: {
          clock.spend(1_000)
          flip.toggle()
          return Screen(x: flip ? 500 : 480)
        },
        agrees: ==,
        satisfied: { $0.insideWindow },
        mayPress: { _ in true },
        press: { _ in },
        nowMs: clock.now,
        pause: { _ in }
      )
      check(!outcome.satisfied, "a screen that never agrees is never satisfied")
      check(outcome.outOfBudget, "the deadline ends a wait that never agrees (reads \(outcome.reads))")
      check(outcome.reads <= 7, "the wait stops near its deadline rather than at the read cap (got \(outcome.reads))")
      check(outcome.presses == 0, "a screen that is still moving gets no gesture (got \(outcome.presses) presses)")
    }

    do {
      let clock = Clock()
      var x: CGFloat = 900
      var reads = 0
      var drags = 0
      let outcome = GestureSettlement.settle(
        deadlineMs: 60_000,
        read: {
          reads += 1
          // Each drag's effect shows on the read after the one that followed it.
          if reads % 2 == 1 { x -= 60 }
          return Screen(x: x)
        },
        agrees: ==,
        satisfied: { $0.insideWindow },
        mayPress: { _ in true },
        press: { _ in drags += 1 },
        nowMs: clock.now,
        pause: { _ in }
      )
      check(outcome.satisfied, "a tab that needs more than eight drags still arrives")
      check(outcome.presses > 8, "more gestures than the old cap are allowed (got \(outcome.presses))")
      check(drags == outcome.presses, "every counted gesture is one the caller sent")
    }

    do {
      let clock = Clock()
      let scripted = script([Screen(x: 40), Screen(x: 40)])
      let outcome = GestureSettlement.settle(
        deadlineMs: 1_000,
        read: {
          // More than the whole budget.
          clock.spend(1_100)
          return scripted.read()
        },
        agrees: ==,
        satisfied: { $0.insideWindow },
        mayPress: { _ in true },
        press: { _ in },
        nowMs: clock.now,
        pause: { _ in }
      )
      check(outcome.reads == 2, "a read that costs the whole budget still buys the second read (got \(outcome.reads))")
      check(outcome.satisfied, "and the wait still settles rather than returning one read")
    }

    do {
      let clock = Clock()
      let outcome = GestureSettlement.settle(
        deadlineMs: 60_000,
        maxPresses: 2,
        read: { Screen(x: 900) },
        agrees: ==,
        satisfied: { $0.insideWindow },
        mayPress: { _ in true },
        press: { _ in },
        nowMs: clock.now,
        pause: { _ in clock.spend(1) }
      )
      check(outcome.presses == 2, "the sanity cap is a cap (got \(outcome.presses) presses)")
      check(!outcome.satisfied, "an unreachable screen stays unsatisfied")
    }

    do {
      let scripted = script([Screen(x: 40, hittable: false), Screen(x: 40, hittable: false)])
      let clock = Clock()
      let outcome = GestureSettlement.settle(
        deadlineMs: 1_000,
        read: scripted.read,
        agrees: ==,
        satisfied: { $0.insideWindow },
        mayPress: { _ in true },
        press: { _ in },
        nowMs: clock.now,
        pause: { _ in clock.spend(200) }
      )
      check(!outcome.satisfied, "a box the finger cannot reach is not inside the window")
      check(outcome.outOfBudget, "and the wait reports that it ran out rather than settled")
    }

    if failures > 0 {
      print("FAILED: \(failures) check(s)")
      exit(1)
    }
    print("gesture-settlement.test: all checks passed")
  }
}

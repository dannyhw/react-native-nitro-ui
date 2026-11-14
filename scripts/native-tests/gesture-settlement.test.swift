// CoreGraphics for `CGRect`, on the host as well as inside the UI-test target.
import CoreGraphics
import Foundation

/// The bounded "act, then decide on observed state" wait the iOS real-input tab scroll and popover
/// anchor use (X34 item 4).
///
/// Run on the host by `bun run test:native`, compiled with the shipping UI-test file
/// `example/ios/NitroUiExampleUITests/GestureSettlement.swift` — the same source the UI-test target
/// builds, not a copy.
///
/// ## The bugs these cases hold shut
///
///   1. **a decision on one read of a moving screen.** `goToTab(IconButton)` failed on a loaded box
///      with the tab "still outside the window" at x=1158 after eight drags: the frame was read while
///      the bar was still animating, so each drag looked like it had done nothing. Case 2 and case 5
///      are that shape — the frame lands one read *after* the drag, every time.
///   2. **re-pressing something that already arrived.** The popover anchor was tapped up to three
///      times on a slow content publish, and the second tap *closed* the popover the first one opened;
///      the run then reported "the touch was never delivered" about a delivered touch. Case 3 asserts
///      the press count is exactly one when a presentation is up and its content is late.
///   3. **a count where a deadline belongs.** Eight drags and three taps were both guesses at how long
///      a loaded machine needs. Case 5 proves gestures are not capped at a magic number; case 4 proves
///      the wait does end, and says which bound ended it.
///   4. **the second read always happens.** The lesson `A11yFrameStability` learned on a device with
///      fourteen red cases: a budget honoured before the second read reinstates the one-read bug, and
///      a fake clock that charges only for pauses cannot see it. Case 6 charges the clock for reads.
///
/// Red proofs, each mutation made in the shipping file, run, then reverted:
///
///   - the deadline honoured before any re-read (`minReads` → 1) → "a read that costs the whole budget
///     still buys the second read (got 1)";
///   - the agreement test dropped (`if agrees(...)` → `if true`) → "a screen that is still moving gets
///     no gesture (got 5 presses)" + the case-3 press count;
///   - `mayPress` dropped (press whenever unsettled) → "no gesture is sent while a presentation is up
///     (got 3 presses)";
///   - the deadline ignored → "the deadline ends a wait that never agrees (reads 400)";
///   - `maxPresses` ignored → "the sanity cap is a cap (got 9 presses)".
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

  /// One observation of a screen: a tab's box, and whether a presentation is up with its content.
  private struct Screen: Equatable {
    var x: CGFloat = 0
    var hittable = true
    var presentations = 0
    var rows = 0

    /// The tab-reveal question: wholly inside a window that spans 0…400.
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

  /// A clock that advances only when time is *spent*, so a bounded wait is deterministic rather than
  /// load-dependent. `spend` is what a `read` pays: the round trip into the test manager is the cost
  /// a real device pays in seconds.
  private final class Clock {
    private(set) var ms = 0
    func spend(_ amount: Int) { ms += amount }
    var now: () -> Int { { self.ms } }
  }

  static func main() {
    print("GestureSettlement")

    // 1. The ordinary case: a tab that is already where it belongs costs two reads and no drag.
    //    The number is the price of the fix on every healthy case, so it is asserted.
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

    // 2. The load shape: the frame lands one read *after* each drag, so between a drag and its effect
    //    the screen is mid-flight and must not be dragged again. Three drags, eight reads.
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

    // 3. The popover anchor. The first tap lands; its content is slow; a UIKit window is already up.
    //    The old loop tapped again and closed it. This one waits.
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

    // 3b. The same fixture read the way the three-tap loop read it: press whenever unsettled. That is
    //     the mutation, kept as a case so the difference is stated in code and not in a comment.
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

    // 4. A screen that never agrees (an animation that never ends) is bounded by the deadline, and
    //    never dragged while it is moving — a gesture aimed at a moving screen is the guess the old
    //    count made on every step.
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

    // 5. No magic number: twelve drags is more than the eight the old scroll allowed, and the only
    //    thing that may stop this is the deadline.
    do {
      let clock = Clock()
      var x: CGFloat = 900
      var reads = 0
      var drags = 0
      let outcome = GestureSettlement.settle(
        deadlineMs: 60_000,
        read: {
          reads += 1
          // Each drag's effect shows up on the read after the one that followed it: the lag the old
          // eight-step loop read as "the drag did nothing, drag again".
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

    // 6. The second read is bought even when the first already looks satisfied and the budget is
    //    already spent — `A11yFrameStability`'s branch 4, charged for the read rather than the pause.
    do {
      let clock = Clock()
      let scripted = script([Screen(x: 40), Screen(x: 40)])
      let outcome = GestureSettlement.settle(
        deadlineMs: 1_000,
        read: {
          // More than the whole budget: on a loaded simulator one read of a subtree really can cost
          // more than a wait's entire deadline, and the pair must still be bought.
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

    // 7. The sanity cap is honoured when a caller gives one — a caller whose repeated gesture is
    //    itself destructive is allowed to insist, and the type must not silently ignore that.
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

    // 8. A non-hittable box inside the window is not "revealed": the old check asked the same thing,
    //    and the answer has to stay the same now that the wait is bounded by time.
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

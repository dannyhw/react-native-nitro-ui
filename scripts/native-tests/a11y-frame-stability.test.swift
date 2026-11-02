// CoreGraphics for `CGRect`, on the host as well as inside the UI-test target.
import CoreGraphics
import Foundation

/// The bounded re-read the iOS accessibility pass runs before it compares a box (X16 item 4).
///
/// Run on the host by `bun run test:native`, compiled with the shipping UI-test file
/// `example/ios/NitroUiExampleUITests/A11yFrameStability.swift` — the same source the UI-test
/// target builds, not a copy.
///
/// ## The bug these cases hold shut
///
/// `a11y:switch` failed twice on maintainer-mac-1 with the React Native wrapper's box at exactly ⅓
/// of the switch's — every component divided by the screen scale — and passed on a re-run of the
/// same tree. The pass decided on one read of `XCUIElement.frame`. The fix reads until two
/// consecutive reads agree, and the three properties that make that fix safe are the three things
/// asserted hardest below:
///
///   1. it settles on *two reads agreeing with each other*, never on the answer it wants — a wait
///      that retried until the wrapper's box matched the control's would retry until the rule
///      passed, and the bug the rule exists for would return as a green with a longer runtime;
///   2. a tree that will not hold still ends the wait at a cap and is reported unsettled, rather
///      than hanging the suite or counting as a pass;
///   3. a stably-wrong tree settles immediately and is still handed to the rule, so the fix cannot
///      become a way of retrying a real defect away.
///
/// The red proofs for this file (each mutation made in the shipping file, run, then reverted):
/// `reads < maxReads` replaced by a single read → `settleStopsAtTheCapWhenNothingAgrees` and
/// `settleReturnsTheAgreeingRead` go red; agreement changed from "this read equals the previous
/// one" to "this read equals the *first* one" → the stably-moving case stops settling; agreement
/// loosened to a tolerance → the NaN / sub-point case goes red.
///
/// `@main` because `swiftc` only allows top-level statements in a file named `main.swift`.
@main
struct A11yFrameStabilityTest {
  private static var failures = 0

  private static func check(_ condition: Bool, _ what: String) {
    if condition {
      print("  ok    \(what)")
    } else {
      print("  FAIL  \(what)")
      failures += 1
    }
  }

  /// One snapshot of a control's tree: the anchor's box plus every node's box, in the order the
  /// pass prints them — the shape `measure` hands to `settle`.
  private struct Snapshot {
    let anchor: CGRect
    let nodes: [CGRect]

    var frames: [CGRect] { [anchor] + nodes }
  }

  /// The measured pair-a Switch: wrapper and hosted element at the same box.
  private static let switchBox = CGRect(x: 325, y: 217.3333282470703, width: 61, height: 28)

  /// The same box read at the screen's ⅓ scale — the exact shape of the two failures on
  /// maintainer-mac-1 (V3's report has `(108.33, 72.44, 20.33, 9.33)` beside
  /// `(325, 217.33, 61, 28)`).
  private static let scaledBox = CGRect(
    x: 325 / 3,
    y: 217.3333282470703 / 3,
    width: 61 / 3,
    height: 28 / 3
  )

  /// A clock that advances by `pauseMs` per pause and nothing else: the budget is then a count of
  /// pauses, so a timeout case is deterministic instead of load-dependent.
  private static func fakeClock() -> (now: () -> Int, pause: (Int) -> Void, state: () -> Int) {
    var elapsed = 0
    return (
      { elapsed },
      { ms in elapsed += ms },
      { elapsed }
    )
  }

  /// `read` over a scripted list: the i-th call answers with the i-th snapshot, and the last one
  /// repeats forever, so "keeps reading" is observable as a call count rather than a hang.
  private static func script(_ snapshots: [Snapshot]) -> (read: () -> Snapshot, calls: () -> Int) {
    var index = 0
    return (
      {
        defer { index += 1 }
        return snapshots[min(index, snapshots.count - 1)]
      },
      { index }
    )
  }

  // swiftlint:disable:next function_body_length
  static func main() {
    print("A11yFrameStability")

    let stable = Snapshot(anchor: switchBox, nodes: [switchBox, switchBox])

    // The ordinary case: a tree that is already laid out costs exactly two reads. That number is
    // the cost of this fix, so it is asserted, not hoped for: fourteen cases times one extra read
    // of a whole subtree is the price added to every `real-input:ios` run.
    do {
      let scripted = script([stable, stable])
      let clock = fakeClock()
      let outcome = A11yFrameStability.settle(
        framesOf: { $0.frames },
        read: scripted.read,
        nowMs: clock.now,
        pause: clock.pause
      )
      check(outcome.settled, "a stable tree settles")
      check(outcome.reads == 2, "a stable tree costs two reads, not six (got \(outcome.reads))")
      check(scripted.calls() == 2, "`read` was called twice (got \(scripted.calls()))")
      check(outcome.previous != nil, "the agreeing read keeps its predecessor for the log")
      check(outcome.moved == 0, "nothing moved")
    }

    // The failure this exists for: the first read is the ⅓-scale snapshot, the second is the real
    // one. Two consecutive reads have to agree before the pass prints, so the first pair is
    // rejected and the snapshot that reaches the log is the stable one.
    do {
      let scaled = Snapshot(anchor: scaledBox, nodes: [scaledBox, switchBox])
      let scripted = script([scaled, stable, stable])
      let clock = fakeClock()
      let outcome = A11yFrameStability.settle(
        framesOf: { $0.frames },
        read: scripted.read,
        nowMs: clock.now,
        pause: clock.pause
      )
      check(outcome.settled, "the pass settles once the snapshot stops being stale")
      check(outcome.reads == 3, "the disagreeing pair is not accepted (got \(outcome.reads))")
      check(
        outcome.snapshot.anchor == switchBox,
        "the snapshot handed back is the agreeing one, not the ⅓-scale one"
      )
      check(
        outcome.previous?.anchor == switchBox,
        "`previous` is the first of the two agreeing reads"
      )
      // The wait is a wait: without a pause between them the test manager answers from the same
      // snapshot twice, and a re-read that cannot change anything is a waste of the whole budget.
      check(clock.state() > 0, "the reads are separated in time (\(clock.state()) ms)")
    }

    // The property the fix must NOT have: waiting for the answer it wants. Here the wrapper is at
    // ⅓ scale and stays there, forever, while the hosted element is at the real box — the control
    // is genuinely broken, on every read. It has to settle on the second read and be handed to the
    // rule, not retry until the two boxes agree. A `settle` that compared the anchor against the
    // nodes (or against any expected frame) would burn the cap here and report a defect it had
    // actually excused.
    do {
      let wrong = Snapshot(anchor: scaledBox, nodes: [scaledBox, switchBox])
      let scripted = script([wrong, wrong, wrong, wrong, wrong, wrong])
      let clock = fakeClock()
      let outcome = A11yFrameStability.settle(
        framesOf: { $0.frames },
        read: scripted.read,
        nowMs: clock.now,
        pause: clock.pause
      )
      check(
        outcome.settled && outcome.reads == 2,
        "a stably-wrong tree settles at once and is still graded (settled=\(outcome.settled) reads=\(outcome.reads))"
      )
      check(
        outcome.snapshot.anchor != outcome.snapshot.nodes[1],
        "the boxes it hands to the rule still disagree — the fix cannot make the finding go away"
      )
    }

    // A tree that never holds still (an indeterminate indicator, a picker mid-spin, a list still
    // recycling): bounded, and reported unsettled. Neither a hang nor a pass.
    do {
      let moving = (0..<12).map {
        Snapshot(
          anchor: CGRect(x: 325 + Double($0) * 7, y: 217, width: 61, height: 28),
          nodes: [CGRect(x: 325, y: 217, width: 61, height: 28)]
        )
      }
      let scripted = script(moving)
      let clock = fakeClock()
      let outcome = A11yFrameStability.settle(
        maxReads: 5,
        budgetMs: 100_000,
        framesOf: { $0.frames },
        read: scripted.read,
        nowMs: clock.now,
        pause: clock.pause
      )
      check(!outcome.settled, "a tree that will not hold still does not settle")
      check(outcome.reads == 5, "and stops at the read cap (got \(outcome.reads))")
      check(scripted.calls() == 5, "`read` is called at most the cap (got \(scripted.calls()))")
      check(outcome.moved > 0, "it reports what moved, for the log line")
      check(
        outcome.snapshot.anchor == moving[4].anchor,
        "the last read is the one printed — the freshest measurement available"
      )
    }

    // The wall-clock budget, and why the cap alone is not enough: each read is a round trip to the
    // test manager and its cost is not ours. A run whose reads take a second apiece must stop on
    // the clock, not after the cap.
    do {
      let moving = (0..<12).map {
        Snapshot(
          anchor: CGRect(x: Double($0) * 11, y: 217, width: 61, height: 28),
          nodes: [CGRect(x: Double($0) * 13, y: 40, width: 61, height: 28)]
        )
      }
      let scripted = script(moving)
      // 400 ms per read, budget 1 s: the cap would allow six reads, the budget allows three.
      var elapsed = 0
      let outcome = A11yFrameStability.settle(
        maxReads: 6,
        budgetMs: 1_000,
        pauseMs: 400,
        framesOf: { $0.frames },
        read: scripted.read,
        nowMs: { elapsed },
        pause: { ms in elapsed += ms }
      )
      check(!outcome.settled, "an out-of-budget wait is not a settle")
      check(
        outcome.reads <= 4 && scripted.calls() <= 4,
        "the budget stops the reads before the cap does (reads=\(outcome.reads))"
      )
      check(outcome.elapsedMs >= 1_000, "and says how long it spent (\(outcome.elapsedMs) ms)")
      // The budget must not be checked *after* a read has already been paid for beyond it, or the
      // worst case is cap x read-cost rather than the budget.
      check(scripted.calls() * 400 <= 1_600, "no read is started past the budget")
    }

    // Two reads of different element counts are not agreement: a subtree that gained a row between
    // reads is a tree still being built, and the pass would compare a name against a box from a
    // tree that no longer has that name.
    do {
      let before = Snapshot(anchor: switchBox, nodes: [switchBox])
      let after = Snapshot(anchor: switchBox, nodes: [switchBox, switchBox])
      let scripted = script([before, after, before, after, before])
      let clock = fakeClock()
      let outcome = A11yFrameStability.settle(
        maxReads: 4,
        framesOf: { $0.frames },
        read: scripted.read,
        nowMs: clock.now,
        pause: clock.pause
      )
      check(!outcome.settled, "a changing element count is not a settle")
      check(outcome.reads == 4, "and it spends the same bounded wait (got \(outcome.reads))")
    }

    // Agreement is exact. A half-point shift is noise for the *rule* (IOS_FRAME_TOLERANCE_PT), but
    // here it is a layout that moved, and loosening the settle is how a slowly-moving tree starts
    // looking settled — the one way this guard could hide the bug it guards.
    do {
      check(
        !A11yFrameStability.framesAgree(
          CGRect(x: 325, y: 217, width: 61, height: 28),
          CGRect(x: 325, y: 217, width: 61, height: 28.5)
        ),
        "half a point is a move"
      )
      check(
        !A11yFrameStability.framesAgree(
          CGRect(x: 325, y: 217, width: 61, height: 28),
          CGRect(x: 325.1, y: 217, width: 61, height: 28)
        ),
        "and so is a tenth"
      )
      let nan = CGRect(
        x: Double.nan,
        y: 217,
        width: 61,
        height: 28
      )
      check(
        !A11yFrameStability.framesAgree(nan, nan),
        "a frame the platform cannot answer for never agrees with itself"
      )
      check(
        A11yFrameStability.framesAgree(switchBox, switchBox),
        "and the same CGRect does"
      )
      check(
        A11yFrameStability.movedFrameCount(
          [switchBox, switchBox, switchBox],
          [scaledBox, switchBox, switchBox]
        ) == 1,
        "the moved count counts frames, for the log line"
      )
      check(
        A11yFrameStability.movedFrameCount([switchBox], [switchBox, switchBox]) == 3,
        "a changed element count reports every frame"
      )
    }

    if failures > 0 {
      print("FAILED: \(failures) check(s)")
      exit(1)
    }
    print("a11y-frame-stability.test: all checks passed")
  }
}

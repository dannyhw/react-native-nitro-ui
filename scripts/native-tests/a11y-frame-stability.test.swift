// CoreGraphics for `CGRect`, on the host as well as inside the UI-test target.
import CoreGraphics
import Foundation

/// The bounded re-read the iOS accessibility pass runs before it compares a box (X16 item 4).
///
/// Run on the host by `bun run test:native`, compiled with the shipping UI-test file
/// `example/ios/NitroUiExampleUITests/A11yFrameStability.swift` — the same source the UI-test
/// target builds, not a copy.
///
/// ## The bugs these cases hold shut
///
/// `a11y:switch` failed twice on maintainer-mac-1 with the React Native wrapper's box at exactly ⅓
/// of the switch's — every component divided by the screen scale — and passed on a re-run of the
/// same tree. The pass decided on one read of `XCUIElement.frame`. The fix reads until two
/// consecutive reads agree, and the properties that make that fix safe are asserted hardest below:
///
///   1. it settles on *two reads agreeing with each other*, never on the answer it wants — a wait
///      that retried until the wrapper's box matched the control's would retry until the rule
///      passed, and the bug the rule exists for would return as a green with a longer runtime;
///   2. a tree that will not hold still ends the wait at a cap and is reported unsettled, rather
///      than hanging the suite or counting as a pass;
///   3. a stably-wrong tree settles immediately and is still handed to the rule, so the fix cannot
///      become a way of retrying a real defect away;
///   4. the **second read always happens**. This one was earned on a device, not invented: the
///      first version checked its wall-clock budget before every read, and a read costs seconds
///      here, so all fourteen cases stopped at one read — the bug, still happening, with a note
///      attached. It passed every unit test until it ran on a simulator, because the fake clock
///      advanced only between reads and so made a read free. `slowScript` charges the clock for
///      each read, which is what makes branch 4 testable at all.
///
/// Red proofs, each mutation made in the shipping file, run, then reverted (check names
/// abbreviated; the binary is deleted before each build, because a stale one reports failures for a
/// mutation that never compiled):
///
///   - budget checked before *every* read, as it was originally → "a budget smaller than one read's
///     cost still buys the second read (got 1)" + 2 more;
///   - the loop never re-reading → "a stable tree costs two reads, not six (got 1)" + 22 more;
///   - `Outcome.first` set to the previous read → "`first` is the stale read, not the agreeing read
///     that preceded the settle";
///   - `moved` measured last-vs-previous instead of first-vs-snapshot → "moved counts
///     first-vs-last frames (got 0)";
///   - agreement loosened to the rule's own half-point tolerance → "half a point is a move";
///   - agreement widened to also accept the wrapper's box matching the control's (i.e. waiting for
///     the answer) → "the disagreeing pair is not accepted (got 2)" + 4 more;
///   - the budget checked after paying for each read instead of before starting one → "a budget
///     smaller than one read's cost still buys the second read (reads=3)" + 1 more: the pair is
///     bought, then a read the budget had already refused is paid for anyway.
///
/// One assertion has no mutation of its own: "never more than the budget plus one read's cost" also
/// holds under the post-read mutant above, because it bounds the worst case rather than the order.
/// It is a bound on the loop as written, not a red proof, and is labelled as such where it is.
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

  /// A clock a scripted `read` can spend time on, shared by the wait, the read and the assertion.
  ///
  /// A class, because `settle` takes escaping closures and Swift will not let one capture an `inout`.
  private final class Clock {
    private(set) var ms = 0
    func spend(_ amount: Int) { ms += amount }
    var now: () -> Int { { self.ms } }
  }

  /// A scripted `read` that also **costs** `costMs`, by advancing the clock the wait reads.
  ///
  /// This is the part the first version of this file got wrong, and the reason a real bug reached a
  /// device: the clock advanced only on `pause`, which made a read free, so a budget small enough to
  /// stop at one read looked fine in a unit test and stopped at one read on a simulator. A read is
  /// the round trip; its cost belongs on the clock.
  private static func slowScript(
    _ snapshots: [Snapshot],
    costMs: Int,
    clock: Clock
  ) -> (read: () -> Snapshot, calls: () -> Int) {
    var index = 0
    return (
      {
        clock.spend(costMs)
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
      check(outcome.first != nil, "a two-read wait keeps the first read for the log")
      check(outcome.moved == 0, "nothing moved between the two reads")
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
      // The diagnostic the whole thing is for: `first` is the box the old single-read pass would
      // have decided on, so it must still be the ⅓-scale one even though a *third* read settled the
      // tree. An outcome that carried "the read before this one" would report the agreeing box here
      // and lose the stale read — the finding, gone.
      check(
        outcome.first?.anchor == scaledBox,
        "`first` is the stale read, not the agreeing read that preceded the settle"
      )
      check(
        outcome.moved == 2,
        "moved counts first-vs-last frames, i.e. what one sample got wrong (got \(outcome.moved))"
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

    // The wall-clock budget, and why the cap alone is not enough. Each read is a round trip to the
    // test manager and its cost is not ours, so a run whose reads take seconds apiece has to stop on
    // the clock, not after the cap. `slowScript` puts the read's cost on the clock, which is the
    // only way this branch can be tested at all: a free `read` makes every budget look generous.
    do {
      let moving = (0..<12).map {
        Snapshot(
          anchor: CGRect(x: Double($0) * 11, y: 217, width: 61, height: 28),
          nodes: [CGRect(x: Double($0) * 13, y: 40, width: 61, height: 28)]
        )
      }
      // 400 ms per read, 1 500 ms budget, cap six. The pair is paid for unconditionally (800 ms), a
      // third and fourth still fit under the budget (1 200, 1 600 ms - each is *started* before the
      // clock passes 1 500), and the fifth is refused at 1 600. Worst case is therefore
      // budget + one read's cost, which is what the last check below pins.
      let clock = Clock()
      let scripted = slowScript(moving, costMs: 400, clock: clock)
      let outcome = A11yFrameStability.settle(
        maxReads: 6,
        budgetMs: 1_500,
        pauseMs: 0,
        framesOf: { $0.frames },
        read: scripted.read,
        nowMs: clock.now,
        pause: { _ in }
      )
      check(!outcome.settled, "an out-of-budget wait is not a settle")
      check(
        outcome.reads == 4 && scripted.calls() == 4,
        "the budget stops the reads before the cap does (reads=\(outcome.reads))"
      )
      check(outcome.elapsedMs >= 1_200, "and says how long it spent (\(outcome.elapsedMs) ms)")
      check(clock.ms == scripted.calls() * 400, "the clock only ever pays for reads")
      // The budget must be checked *before* paying for a read, or the worst case is
      // cap x read-cost rather than the budget plus one read.
      check(
        outcome.elapsedMs <= 1_500 + 400,
        "never more than the budget plus one read's cost (\(outcome.elapsedMs) ms)"
      )
    }

    // THE CASE THIS REWRITE IS FOR, and it was earned on a device rather than invented. The first
    // version of `settle` checked the budget before *every* read, and one read here is a round trip
    // to the test manager for a whole subtree: measured on pair-a (`real-input:ios`, 2026-11-02) it
    // costs 2.0 s to 7.9 s. The 1 500 ms default budget therefore stopped after the *first* read on
    // all fourteen cases, and the run's own log said `reads=1 settled=false` fourteen times - the
    // single-sample behaviour this type exists to remove, still happening, with a note attached to
    // it. So the pair is paid for whatever the clock says, and the budget only refuses reads after
    // it. A budget of 1 ms with a read that costs three seconds is the worst case, and read two
    // still happens: this is the case that was red on the device and green in a unit test.
    do {
      let scaled = Snapshot(anchor: scaledBox, nodes: [scaledBox, switchBox])
      let clock = Clock()
      let scripted = slowScript([scaled, stable, stable], costMs: 3_000, clock: clock)
      let outcome = A11yFrameStability.settle(
        budgetMs: 1,
        pauseMs: 0,
        framesOf: { $0.frames },
        read: scripted.read,
        nowMs: clock.now,
        pause: { _ in }
      )
      check(
        scripted.calls() == 2 && outcome.reads == 2,
        "a budget smaller than one read's cost still buys the second read (reads=\(outcome.reads))"
      )
      check(
        !outcome.settled,
        "the ⅓-scale pair did not agree, so it is not a settle - it reads the next one"
      )
      // Past the pair the budget gets its veto, or a `read` that never returns would hold the suite
      // open: the same tree, still moving, stops at the two reads it was obliged to pay for.
      let moving = (0..<12).map {
        Snapshot(
          anchor: CGRect(x: 325 + Double($0) * 7, y: 217, width: 61, height: 28),
          nodes: [CGRect(x: 325, y: 217, width: 61, height: 28)]
        )
      }
      let clock2 = Clock()
      let runaway = slowScript(moving, costMs: 3_000, clock: clock2)
      let capped = A11yFrameStability.settle(
        budgetMs: 1,
        pauseMs: 0,
        framesOf: { $0.frames },
        read: runaway.read,
        nowMs: clock2.now,
        pause: { _ in }
      )
      check(
        capped.reads == 2 && !capped.settled,
        "past the pair the budget stops it (reads=\(capped.reads) settled=\(capped.settled))"
      )
      check(capped.snapshot.anchor != moving[0].anchor, "and prints the later read")
    }

    // A read that costs seconds still settles a stale first read, with the real-world timing of the
    // bug: two seconds per read, the default budget and cap, and a ⅓-scale snapshot first.
    do {
      let scaled = Snapshot(anchor: scaledBox, nodes: [scaledBox, switchBox])
      let clock = Clock()
      let scripted = slowScript([scaled, stable, stable], costMs: 3_000, clock: clock)
      let outcome = A11yFrameStability.settle(
        framesOf: { $0.frames },
        read: scripted.read,
        nowMs: clock.now,
        pause: { _ in }
      )
      check(outcome.settled && outcome.reads == 3, "the ⅓-scale read is discarded at real cost")
      check(outcome.first?.anchor == scaledBox, "and reported as the first read")
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

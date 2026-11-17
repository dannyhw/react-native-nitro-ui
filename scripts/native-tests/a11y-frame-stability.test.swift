import CoreGraphics
import Foundation

/// Host test for the bounded "read until two reads agree" wait of the iOS accessibility pass,
/// compiled together with the shipping `A11yFrameStability.swift` from the UI-test target.
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

  /// One snapshot of a control's tree: the anchor's box plus every node's box.
  private struct Snapshot {
    let anchor: CGRect
    let nodes: [CGRect]
    /// One string per element; empty means the fixture asks the frame question only.
    var identities: [String] = []

    var frames: [CGRect] { [anchor] + nodes }
  }

  private static let contextBox = CGRect(x: 12, y: 446.666_671_752_929_7, width: 378, height: 68)
  private static let textRow = CGRect(x: 25, y: 459.666_671_752_929_7, width: 352, height: 17)

  private static let switchBox = CGRect(x: 325, y: 217.3333282470703, width: 61, height: 28)

  /// The same box at the screen's ⅓ scale, which is what a stale read returns.
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

  /// A scripted `read` that also costs `costMs` on the clock the wait reads, as a real read does.
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

    // A tree that is already laid out costs exactly two reads.
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

    // A stale ⅓-scale first read: the first pair is rejected and the stable snapshot is reported.
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
        outcome.first?.anchor == scaledBox,
        "`first` is the stale read, not the agreeing read that preceded the settle"
      )
      check(
        outcome.moved == 2,
        "moved counts first-vs-last frames, i.e. what one sample got wrong (got \(outcome.moved))"
      )
      check(clock.state() > 0, "the reads are separated in time (\(clock.state()) ms)")
    }

    // A stably wrong tree settles on the second read: the wait never waits for the answer it
    // wants.
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

    // A tree that never holds still is bounded and reported unsettled: neither a hang nor a pass.
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

    // The wall-clock budget: reads that cost time stop on the clock, not at the read cap.
    do {
      let moving = (0..<12).map {
        Snapshot(
          anchor: CGRect(x: Double($0) * 11, y: 217, width: 61, height: 28),
          nodes: [CGRect(x: Double($0) * 13, y: 40, width: 61, height: 28)]
        )
      }
      // 400 ms per read, 1 500 ms budget, cap six: the pair costs 800 ms, the third and fourth
      // start under the budget, and the fifth is refused at 1 600 ms.
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
      // Worst case is the budget plus one read, because the budget is checked before a read starts.
      check(
        outcome.elapsedMs <= 1_500 + 400,
        "never more than the budget plus one read's cost (\(outcome.elapsedMs) ms)"
      )
    }

    // The second read always happens, however small the budget: a 1 ms budget with a
    // three-second read still buys the pair.
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
      // Past the pair the budget gets its veto: a tree still moving stops at two reads.
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

    // A read that costs seconds still settles a stale first read under the default budget and cap.
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

    // Reads with different element counts do not agree: the tree is still being built.
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

    // Agreement is exact: a half-point shift is a layout that moved.
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

    // Membership is part of agreement: two reads with the same boxes but different elements
    // are not the same tree.
    do {
      let merged = Snapshot(
        anchor: contextBox,
        nodes: [textRow, textRow],
        identities: ["static text|Grace Hopper|", "static text|Grace Hopper|"]
      )
      let unmerged = Snapshot(
        anchor: contextBox,
        nodes: [textRow, textRow],
        identities: ["static text|Grace Hopper|", "static text|With the menu on it.|"]
      )
      check(
        A11yFrameStability.movedFrameCount(merged.frames, unmerged.frames) == 0,
        "the two memberships sit on identical frames — the premise, not an accident"
      )
      check(
        !A11yFrameStability.identitiesAgree(merged.identities, unmerged.identities),
        "and the identity channel is the only thing that tells them apart"
      )
      check(
        !A11yFrameStability.identitiesAgree(["a", "a"], ["a", "b"]),
        "duplicates count: two of one element is not one of each"
      )
      check(
        A11yFrameStability.identitiesAgree(["a", "b"], ["b", "a"]),
        "a subtree walked in the other order is still the same tree"
      )
      check(
        A11yFrameStability.identitiesAgree([], []),
        "a caller with no identity channel asks the frame question only"
      )

      let scripted = script([merged, unmerged, merged, merged])
      let clock = fakeClock()
      let outcome = A11yFrameStability.settle(
        framesOf: { $0.frames },
        identitiesOf: { $0.identities },
        read: scripted.read,
        nowMs: clock.now,
        pause: clock.pause
      )
      check(
        outcome.reads == 4,
        "a same-boxed, swapped-membership pair is not agreement (got \(outcome.reads) reads)"
      )
      check(
        outcome.snapshot.identities == merged.identities && outcome.settled,
        "the wait settles on the tree that repeated itself"
      )

      // The same shape costs the ordinary two reads when nothing swaps.
      let quiet = script([merged, merged])
      let quietOutcome = A11yFrameStability.settle(
        framesOf: { $0.frames },
        identitiesOf: { $0.identities },
        read: quiet.read,
        nowMs: clock.now,
        pause: clock.pause
      )
      check(
        quietOutcome.reads == 2 && quietOutcome.settled,
        "a stable membership still costs two reads (got \(quietOutcome.reads))"
      )
    }

    // The confirmation read: where a late merge of an element's children decides the result,
    // an agreeing pair is confirmed by a third read taken after a real window.
    do {
      let disputed = Snapshot(
        anchor: contextBox,
        nodes: [textRow, textRow],
        identities: ["static text|Grace Hopper|", "static text|Grace Hopper|"]
      )
      let scripted = script([disputed, disputed, disputed])
      let clock = fakeClock()
      let outcome = A11yFrameStability.settle(
        framesOf: { $0.frames },
        identitiesOf: { $0.identities },
        confirmationNeeded: { _ in true },
        read: scripted.read,
        nowMs: clock.now,
        pause: clock.pause
      )
      check(outcome.settled, "the disputed shape settles")
      check(
        outcome.reads == 3,
        "and pays one confirmation read for it (got \(outcome.reads))"
      )
      check(outcome.confirmed, "the outcome says the pair was confirmed, not just agreed")
      check(
        clock.state() >= A11yFrameStability.defaultConfirmMs,
        "the confirmation is a window (\(clock.state()) ms), not the 120 ms snapshot pause"
      )

      // Every other shape does not pay for a confirmation.
      let notInQuestion = A11yFrameStability.settle(
        framesOf: { $0.frames },
        identitiesOf: { $0.identities },
        read: script([disputed, disputed]).read,
        nowMs: clock.now,
        pause: clock.pause
      )
      check(
        notInQuestion.reads == 2 && !notInQuestion.confirmed,
        "a shape that does not ask is not confirmed (got \(notInQuestion.reads) reads)"
      )

      // A confirmation that disagrees restarts the wait on the new baseline.
      let lateMerge = Snapshot(
        anchor: contextBox,
        nodes: [textRow, textRow],
        identities: ["static text|Grace Hopper|", "static text|Grace Hopper|"]
      )
      let beforeMerge = Snapshot(
        anchor: contextBox,
        nodes: [textRow, textRow],
        identities: ["static text|Grace Hopper|", "static text|With the menu on it.|"]
      )
      let late = script([beforeMerge, beforeMerge, lateMerge, lateMerge, lateMerge])
      let lateClock = Clock()
      let lateOutcome = A11yFrameStability.settle(
        framesOf: { $0.frames },
        identitiesOf: { $0.identities },
        confirmationNeeded: { _ in true },
        read: late.read,
        nowMs: lateClock.now,
        pause: { _ in lateClock.spend(A11yFrameStability.defaultConfirmMs) }
      )
      check(
        lateOutcome.reads == 5,
        "a tree that published under the confirmation is chased, not printed (got \(lateOutcome.reads))"
      )
      check(
        lateOutcome.settled && lateOutcome.confirmed,
        "and it settles confirmed once the published tree repeats"
      )
      check(
        lateOutcome.snapshot.identities == lateMerge.identities,
        "the snapshot handed back is the published tree"
      )
      check(
        A11yFrameStability.shouldReport(lateOutcome),
        "reads past the designed confirmation are news, and this run has them (reads=5)"
      )
    }

    // The print decision: two agreeing reads print nothing, but a tree that flaps and lands
    // back where it started (A, B, A, A) is reported even though `moved` is 0.
    do {
      let other = Snapshot(
        anchor: CGRect(x: 325, y: 217, width: 61, height: 30),
        nodes: [CGRect(x: 325, y: 217, width: 61, height: 30)]
      )
      let flap = Snapshot(anchor: switchBox, nodes: [switchBox])
      let scripted = script([flap, other, flap, flap])
      let clock = Clock()
      let outcome = A11yFrameStability.settle(
        framesOf: { $0.frames },
        read: scripted.read,
        nowMs: clock.now,
        pause: { _ in }
      )
      check(outcome.settled, "a tree that flaps and holds still does settle")
      check(outcome.reads == 4, "on the fourth read (got \(outcome.reads))")
      check(
        outcome.moved == 0,
        "and the last box equals the first, so moved is 0 (got \(outcome.moved))"
      )
      check(
        A11yFrameStability.shouldReport(outcome),
        "a flapped-back tree is still reported - moved == 0 is not 'nothing happened'"
      )
    }

    // Each branch of the print rule on its own, so a change to one cannot silently drop another.
    do {
      let quiet = A11yFrameStability.Outcome(
        snapshot: switchBox, first: switchBox, reads: 2, settled: true, moved: 0,
        elapsedMs: 4_000, confirmed: false
      )
      check(
        !A11yFrameStability.shouldReport(quiet),
        "the ordinary two agreeing reads print nothing"
      )
      let moved = A11yFrameStability.Outcome(
        snapshot: switchBox, first: scaledBox, reads: 2, settled: true, moved: 1,
        elapsedMs: 4_000, confirmed: false
      )
      check(
        A11yFrameStability.shouldReport(moved),
        "two reads that disagree and then settle are reported"
      )
      let many = A11yFrameStability.Outcome(
        snapshot: switchBox, first: switchBox, reads: 5, settled: true, moved: 0,
        elapsedMs: 20_000, confirmed: false
      )
      check(A11yFrameStability.shouldReport(many), "five quiet reads are reported")
      let never = A11yFrameStability.Outcome(
        snapshot: switchBox, first: switchBox, reads: 2, settled: false, moved: 0,
        elapsedMs: 1_500, confirmed: false
      )
      // The designed third read is not news; a fourth read is.
      let confirmedQuiet = A11yFrameStability.Outcome(
        snapshot: switchBox, first: switchBox, reads: 3, settled: true, moved: 0,
        elapsedMs: 6_000, confirmed: true
      )
      check(
        !A11yFrameStability.shouldReport(confirmedQuiet),
        "the confirmation read a disputed shape always pays prints nothing"
      )
      let confirmedPast = A11yFrameStability.Outcome(
        snapshot: switchBox, first: switchBox, reads: 4, settled: true, moved: 0,
        elapsedMs: 9_000, confirmed: true
      )
      check(
        A11yFrameStability.shouldReport(confirmedPast),
        "reads past the designed confirmation are still reported"
      )
      check(
        A11yFrameStability.shouldReport(never),
        "an out-of-budget wait is reported even with nothing moved"
      )
    }

    // A tree React Native finishes laying out 600 ms after the first read, read with a snapshot
    // that costs 30 ms: the default gap keeps two reads of the half-built tree from agreeing.
    do {
      let clock = Clock()
      let halfBuilt = Snapshot(anchor: switchBox, nodes: [scaledBox])
      let laidOut = Snapshot(anchor: switchBox, nodes: [switchBox])
      var readStarts: [Int] = []
      let outcome = A11yFrameStability.settle(
        framesOf: { $0.frames },
        read: {
          readStarts.append(clock.ms)
          let snapshot = clock.ms >= 600 ? laidOut : halfBuilt
          clock.spend(30)
          return snapshot
        },
        nowMs: clock.now,
        pause: { clock.spend($0) }
      )
      check(outcome.settled, "a tree laid out within a second settles")
      check(
        outcome.snapshot.frames == laidOut.frames,
        "on the laid-out tree, not two quick reads of the half-built one"
      )
      let gaps = zip(readStarts.dropFirst(), readStarts).map { $0 - $1 }
      check(
        gaps.allSatisfy { $0 >= 1_000 },
        "every read starts at least a second after the one before (gaps \(gaps))"
      )
    }

    if failures > 0 {
      print("FAILED: \(failures) check(s)")
      exit(1)
    }
    print("a11y-frame-stability.test: all checks passed")
  }
}

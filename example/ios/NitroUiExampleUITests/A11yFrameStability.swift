// CoreGraphics, not UIKit or XCTest: this file compiles into the UI-test target *and* on the host
// under `bun run test:native`, and `CGRect` is the only type from either world it needs.
import CoreGraphics
import Foundation

/// The bounded re-read the accessibility pass runs before it compares a box.
///
/// Why this exists (X16 item 4): `a11y:switch` failed twice on maintainer-mac-1 with the React
/// Native wrapper's box at *exactly* ⅓ of the switch's own — `(108.33, 72.44, 20.33, 9.33)` read
/// beside `(325, 217.33, 61, 28)`, every component divided by the screen scale — and passed on a
/// re-run of the same tree twenty minutes later. One read of `XCUIElement.frame` is one sample of
/// a tree the test manager answers out of its own snapshot, and a rule that decides on one sample
/// reports a stale snapshot as a component bug. So the pass reads until two consecutive reads
/// agree, with a bounded wait, and only then prints.
///
/// ## What it waits for, and what it never waits for
///
/// Agreement is with the *previous read* and with nothing else: this type has no expected frame,
/// no reference box, no "keep going until the boxes match" path. That is deliberate, and it is the
/// whole difference between a stability wait and a cheat. A pass that retried until the wrapper's
/// box matched the control's would retry until the rule passed, and the bug the rule exists to
/// catch — a name on a box that is not the control's — would come back as a green with a longer
/// runtime. A control whose two boxes are stably *different* settles on the second read and fails
/// exactly as it did before: `A11yFrameStabilityTest` asserts that directly.
///
/// The wait is bounded twice over — a read cap and a wall-clock budget — because a genuinely
/// animated tree (an indeterminate indicator, a picker mid-spin) never agrees with itself, and an
/// unbounded wait there is a hung suite. Running out is not a pass either: the caller gets the last
/// read with `settled == false`, prints it, and says in the log that the comparison below it rests
/// on a tree that would not hold still.
///
/// Compiled into the UI-test target and, unmodified, on the host by `bun run test:native`
/// (`scripts/native-tests/a11y-frame-stability.test.swift`), because the behaviours worth proving
/// here are a stuck loop, an over-eager early exit and a wait that chases the answer — none of
/// which a device run can be relied on to produce on demand.
enum A11yFrameStability {
  /// What one settle call ended with.
  struct Outcome<Snapshot> {
    /// The read to print. When `settled`, the second of the two agreeing reads; otherwise the
    /// last read taken before the cap or the budget ran out.
    let snapshot: Snapshot
    /// The read before `snapshot`, for the caller that wants to show what moved.
    let previous: Snapshot?
    /// How many times `read` was called, including the first.
    let reads: Int
    /// Two consecutive reads agreed on every frame.
    let settled: Bool
    /// Frames that differed between the last two reads (non-zero whenever `settled` is false
    /// because the cap was reached, and zero when the budget expired before a second read).
    let moved: Int
    /// Wall clock spent, measured with the injected clock.
    let elapsedMs: Int
  }

  /// Exact frame equality, component by component.
  ///
  /// Exact rather than tolerant, because the question is "did these two reads see the same tree",
  /// not "is this box close enough to pass" — a tolerance here would let a slowly moving tree look
  /// settled, which is the one way this guard could hide the bug it guards. Two reads of one
  /// laid-out view are bit-identical or they are not the same layout. A NaN component compares
  /// unequal, so a frame the platform cannot answer for keeps the read unstable and gets reported.
  static func framesAgree(_ left: CGRect, _ right: CGRect) -> Bool {
    return left.origin.x == right.origin.x
      && left.origin.y == right.origin.y
      && left.size.width == right.size.width
      && left.size.height == right.size.height
  }

  /// Do two reads' frame lists agree? A different element count is not agreement: a tree that
  /// gained or lost an element between reads is a tree still being built.
  static func framesAgree(_ left: [CGRect], _ right: [CGRect]) -> Bool {
    guard left.count == right.count else { return false }
    for index in left.indices where !framesAgree(left[index], right[index]) {
      return false
    }
    return true
  }

  /// How many frames differ between two reads. A count change reports every frame as moved,
  /// which is what `settled` refuses anyway; the caller renders the boxes from the snapshots.
  static func movedFrameCount(_ left: [CGRect], _ right: [CGRect]) -> Int {
    guard left.count == right.count else { return left.count + right.count }
    var moved = 0
    for index in left.indices where !framesAgree(left[index], right[index]) {
      moved += 1
    }
    return moved
  }

  /// Read until two consecutive reads agree, or the cap or the budget says stop.
  ///
  /// - Parameters:
  ///   - maxReads: hard cap on calls to `read` (at least 2 — one read is what the pass did before
  ///     this type existed, and it is what the ⅓-scale failure arrived on).
  ///   - budgetMs: wall-clock budget for the whole wait, checked before each re-read.
  ///   - pauseMs: how long to sit between reads. The point of the wait is to give the test
  ///     manager's snapshot a chance to be rebuilt, so a zero pause re-reads the same snapshot.
  ///   - framesOf: the frames of one snapshot that agreement is judged on. What the caller does
  ///     not hand over here is not stability-checked, so pass the whole tree, not the anchor.
  ///   - read: one read of the tree. Called on this thread; each call is the round trip, so
  ///     `maxReads` times the cost of `read` is the real cost of this function.
  ///   - nowMs / pause: injected, so the cap and the budget are provable in milliseconds rather
  ///     than by a device run that happens to be slow.
  static func settle<Snapshot>(
    maxReads: Int = 6,
    budgetMs: Int = 1_500,
    pauseMs: Int = 120,
    framesOf: (Snapshot) -> [CGRect],
    read: () -> Snapshot,
    nowMs: () -> Int = { Int(Date().timeIntervalSince1970 * 1000) },
    pause: (Int) -> Void = { Thread.sleep(forTimeInterval: Double($0) / 1000) }
  ) -> Outcome<Snapshot> {
    precondition(maxReads >= 2, "one read is the bug this type exists to fix")
    let startedAt = nowMs()
    var last = read()
    var lastFrames = framesOf(last)
    var previous: Snapshot? = nil
    var reads = 1
    var moved = 0

    func outcome(settled: Bool, snapshot: Snapshot, before: Snapshot?) -> Outcome<Snapshot> {
      return Outcome(
        snapshot: snapshot,
        previous: before,
        reads: reads,
        settled: settled,
        moved: moved,
        elapsedMs: nowMs() - startedAt
      )
    }

    while reads < maxReads {
      if nowMs() - startedAt >= budgetMs {
        // Out of budget rather than out of reads. Same `settled == false`, and the last read is
        // handed back rather than the first: the caller prints a real measurement either way.
        return outcome(settled: false, snapshot: last, before: previous)
      }
      pause(pauseMs)
      let current = read()
      let currentFrames = framesOf(current)
      reads += 1
      moved = movedFrameCount(lastFrames, currentFrames)
      if moved == 0 {
        return outcome(settled: true, snapshot: current, before: last)
      }
      previous = last
      last = current
      lastFrames = currentFrames
    }

    return outcome(settled: false, snapshot: last, before: previous)
  }
}

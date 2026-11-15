// CoreGraphics, not UIKit or XCTest: this file compiles into the UI-test target and on the host
// for the native unit tests, and `CGRect` is the only type from either world it needs.
import CoreGraphics
import Foundation

/// The bounded re-read the accessibility pass runs before it compares a box. One read of
/// `XCUIElement.frame` can come from a stale test-manager snapshot, so the pass reads until two
/// consecutive reads agree. Agreement is only ever with the previous read, never with an expected
/// frame, so a control whose boxes are stably different still fails.
enum A11yFrameStability {
  /// How long a confirmation read sits behind the pair it confirms, by default. React Native
  /// publishes accessibility elements on the JS thread, so the window has to outlast a frame.
  static let defaultConfirmMs = 2_000

  /// What one settle call ended with.
  struct Outcome<Snapshot> {
    /// The read to print. When `settled`, the second of the two agreeing reads; otherwise the
    /// last read taken before the cap or the budget ran out.
    let snapshot: Snapshot
    /// The first read, or `nil` when there was only one: what a single sample would have said.
    let first: Snapshot?
    /// How many times `read` was called, including the first.
    let reads: Int
    /// Two consecutive reads agreed on every frame.
    let settled: Bool
    /// Frames that differ between `first` and `snapshot`.
    let moved: Int
    /// Wall clock spent, measured with the injected clock.
    let elapsedMs: Int
    /// The agreeing pair was confirmed by one more read, taken a window later, because the
    /// snapshot's element set was in question (`confirmationNeeded`).
    let confirmed: Bool
  }

  /// Exact rather than tolerant: a tolerance would let a slowly moving tree look settled. A NaN
  /// component compares unequal, so a frame the platform cannot answer for keeps the read unstable.
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

  /// How many frames differ between two reads. A count change reports every frame as moved.
  static func movedFrameCount(_ left: [CGRect], _ right: [CGRect]) -> Int {
    guard left.count == right.count else { return left.count + right.count }
    var moved = 0
    for index in left.indices where !framesAgree(left[index], right[index]) {
      moved += 1
    }
    return moved
  }

  /// Do two reads agree on which elements the tree holds? React Native can publish or withdraw a
  /// child accessibility element without moving any box, and XCUITest walks a subtree in no fixed
  /// order. Compared as a sorted multiset, not a set: React Native publishes each element twice,
  /// so `["Grace", "Grace"]` must not agree with `["Grace", "Menu"]`. Two empty lists agree.
  static func identitiesAgree(_ left: [String], _ right: [String]) -> Bool {
    return left.sorted() == right.sorted()
  }

  /// Should this outcome be printed as a stability line? Two reads that agree print nothing. Extra
  /// reads print even when nothing ended up moved (a tree that reads A, B, A, A has `moved == 0`),
  /// and so do any moved frame and any wait that never settled.
  static func shouldReport<Snapshot>(_ outcome: Outcome<Snapshot>) -> Bool {
    // A confirmed outcome takes three reads by design, so only reads past the third count.
    return outcome.reads > (outcome.confirmed ? 3 : 2) || outcome.moved > 0 || !outcome.settled
  }

  /// Read until two consecutive reads agree, or the cap or the budget says stop.
  ///
  /// A read is a round trip to the test manager and takes seconds, so `minReads` are always taken
  /// and `budgetMs` only refuses reads after that. `pauseMs` gives the test manager time to rebuild
  /// its snapshot. Agreement is judged on `framesOf` and `identitiesOf`, so pass the whole tree.
  /// When `confirmationNeeded` says the element set is in question, an agreeing pair is confirmed
  /// by one more read `confirmMs` later: React Native publishes accessibility elements on the JS
  /// thread, and one can still be on its way. `nowMs` and `pause` are injected for the host tests.
  static func settle<Snapshot>(
    maxReads: Int = 6,
    budgetMs: Int = 60_000,
    minReads: Int = 2,
    pauseMs: Int = 120,
    framesOf: (Snapshot) -> [CGRect],
    identitiesOf: (Snapshot) -> [String] = { _ in [] },
    confirmationNeeded: (Snapshot) -> Bool = { _ in false },
    confirmMs: Int = A11yFrameStability.defaultConfirmMs,
    read: () -> Snapshot,
    nowMs: () -> Int = { Int(Date().timeIntervalSince1970 * 1000) },
    pause: (Int) -> Void = { Thread.sleep(forTimeInterval: Double($0) / 1000) }
  ) -> Outcome<Snapshot> {
    precondition(maxReads >= 2, "one read is the bug this type exists to fix")
    let startedAt = nowMs()
    var last = read()
    var lastFrames = framesOf(last)
    var lastIdentities = identitiesOf(last)
    let first = last
    var hasSecondRead = false
    var pendingConfirmation = false
    var confirmed = false
    var reads = 1

    func outcome(settled: Bool, snapshot: Snapshot) -> Outcome<Snapshot> {
      return Outcome(
        snapshot: snapshot,
        first: hasSecondRead ? first : nil,
        reads: reads,
        settled: settled,
        moved: hasSecondRead
          ? movedFrameCount(framesOf(first), framesOf(snapshot))
          : 0,
        elapsedMs: nowMs() - startedAt,
        confirmed: confirmed
      )
    }

    while reads < maxReads {
      if reads >= minReads && nowMs() - startedAt >= budgetMs {
        return outcome(settled: false, snapshot: last)
      }
      pause(pendingConfirmation ? confirmMs : pauseMs)
      let current = read()
      let currentFrames = framesOf(current)
      let currentIdentities = identitiesOf(current)
      reads += 1
      hasSecondRead = true
      let agrees = movedFrameCount(lastFrames, currentFrames) == 0
        && identitiesAgree(lastIdentities, currentIdentities)
      if pendingConfirmation {
        pendingConfirmation = false
        if agrees {
          confirmed = true
          return outcome(settled: true, snapshot: current)
        }
        // The tree changed under the confirmation: the new read becomes the baseline and the wait
        // goes on, up to the same cap as any other disagreement.
      } else if agrees {
        if !confirmed && confirmationNeeded(current) {
          pendingConfirmation = true
        } else {
          return outcome(settled: true, snapshot: current)
        }
      }
      last = current
      lastFrames = currentFrames
      lastIdentities = currentIdentities
    }

    return outcome(settled: false, snapshot: last)
  }
}

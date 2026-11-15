// CoreGraphics and Foundation only, no XCTest: this file also compiles on the host, where the
// native unit tests drive it with an injected clock.
import CoreGraphics
import Foundation

/// Repeats a gesture until the screen says it arrived, bounded by a deadline.
///
/// A decision needs two consecutive reads that agree, both taken after the last press: one read
/// of a moving screen proves nothing. Running out of time is a failure, never a pass.
enum GestureSettlement {
  struct Outcome<Reading> {
    let last: Reading
    let reads: Int
    let presses: Int
    /// Two consecutive agreeing reads said the gesture had arrived.
    let satisfied: Bool
    let outOfBudget: Bool
    let elapsedMs: Int
  }

  /// Reads, and presses while `mayPress` says nothing has arrived, until two agreeing reads
  /// satisfy.
  ///
  /// - Parameter minReads: reads taken whatever the clock says. A read can cost seconds on a loaded
  ///   simulator, so the deadline is checked only after them.
  /// - Parameter quietAfterPressMs: how long the last press gets to land before another may be
  ///   sent. Set it for a gesture that toggles its target, where a second press undoes the first.
  /// - Parameter agrees: whether two readings describe the same screen. Use exact equality: a
  ///   tolerance would let a screen that is still moving look settled.
  /// - Parameter mayPress: whether a reading says nothing has arrived yet, so the gesture may be
  ///   sent again.
  /// - Parameter nowMs / pause: injected so a host test can drive the clock.
  static func settle<Reading>(
    deadlineMs: Int,
    pauseMs: Int = 250,
    maxReads: Int = 400,
    minReads: Int = 2,
    maxPresses: Int? = nil,
    quietAfterPressMs: Int = 0,
    read: () -> Reading,
    agrees: (Reading, Reading) -> Bool,
    satisfied: (Reading) -> Bool,
    mayPress: (Reading) -> Bool,
    press: (Int) throws -> Void,
    nowMs: () -> Int = { Int(Date().timeIntervalSince1970 * 1000) },
    pause: (Int) -> Void = { Thread.sleep(forTimeInterval: Double($0) / 1000) }
  ) rethrows -> Outcome<Reading> {
    precondition(deadlineMs > 0, "a wait with no deadline is the hang this type exists to bound")
    precondition(minReads >= 2, "one read is the flake this type exists to fix")
    precondition(quietAfterPressMs >= 0, "a quiet period that runs backwards is no quiet period")
    let startedAt = nowMs()
    var previous = read()
    var reads = 1
    var presses = 0
    // The reading a press was aimed by describes the screen before the gesture, so it is never
    // paired with the next read: a decision needs two reads taken after the last press.
    var comparable = true
    var lastPressAtMs: Int? = nil

    func quietHasPassed(after lastPressAtMs: Int?) -> Bool {
      guard quietAfterPressMs > 0, let pressedAt = lastPressAtMs else { return true }
      return nowMs() - pressedAt >= quietAfterPressMs
    }

    func outcome(last: Reading, satisfied: Bool, outOfBudget: Bool) -> Outcome<Reading> {
      return Outcome(
        last: last,
        reads: reads,
        presses: presses,
        satisfied: satisfied,
        outOfBudget: outOfBudget,
        elapsedMs: nowMs() - startedAt
      )
    }

    while reads < maxReads {
      // The deadline is checked only after `minReads`: a single read is not a settled screen.
      if reads >= minReads && nowMs() - startedAt >= deadlineMs {
        return outcome(last: previous, satisfied: false, outOfBudget: true)
      }
      pause(pauseMs)
      let current = read()
      reads += 1
      var pressed = false
      if comparable, agrees(previous, current) {
        if satisfied(current) {
          return outcome(last: current, satisfied: true, outOfBudget: false)
        }
        // Settled but not satisfied: press again. A screen that is still moving gets no press.
        if mayPress(current),
          presses < (maxPresses ?? Int.max),
          quietHasPassed(after: lastPressAtMs)
        {
          try press(presses + 1)
          presses += 1
          pressed = true
          lastPressAtMs = nowMs()
        }
      }
      previous = current
      comparable = !pressed
    }
    return outcome(last: previous, satisfied: false, outOfBudget: true)
  }
}

// CoreGraphics and Foundation only — no XCTest, no XCUIApplication: this file compiles into the
// UI-test target *and* on the host under `bun run test:native`, where the properties worth proving
// can be proved with a script instead of hoped for with a loaded machine.
import CoreGraphics
import Foundation

/// A gesture that is repeated until the screen says it arrived, bounded by a deadline.
///
/// Two iOS real-input waits used to be written the other way round, and both flaked on a loaded
/// machine (X31, `docs/tasks/FOLLOWUPS.md`):
///
///   - a tab bar scroll that dragged a fixed eight times and then decided from *one* read of the
///     tab's frame — under load the bar is still animating when that read happens, so eight drags
///     ended with the tab "still outside the window" at x=1158 and the case never got to run;
///   - a popover anchor tapped up to three times, one eight-second window per tap, with no look at
///     whether a popover was already up — so an anchor whose touch *had* landed and whose content was
///     slow to publish was tapped a second time, which closed it, and the run reported "the touch was
///     never delivered" about a touch that was delivered twice.
///
/// Both had the same shape, so both get the same rule: **act, then decide on observed state**. Three
/// properties make that a check rather than a longer wait:
///
///   1. **Two reads, always.** A decision is taken on two consecutive reads that *agree* — one read
///      of a moving screen is the bug, not evidence. `minReads` is paid before the clock gets a vote,
///      because a read here costs seconds on a loaded simulator, not milliseconds (the lesson
///      `A11yFrameStability` learned the hard way: a budget checked before the second read silently
///      reinstates the one-read bug on all fourteen a11y cases).
///   2. **A press only while the state says nothing arrived.** `mayPress` is the caller's reading of
///      "there is nothing there yet". For the popover that is *no presentation up*: a popover that
///      exists but has not published its content is a reason to wait, never a reason to tap again —
///      the second tap is what turns a slow render into a closed popover.
///      Two more rules make that reading honest about *when* it was taken: the reading a press was
///      aimed by is thrown away, so a decision after a press needs two reads taken *after* it, and
///      `quietAfterPressMs` gives the last press that long to land before another one may be sent.
///      Without them the pair can be `before the tap` + `after the tap`, which is the same bug with
///      the label fixed: a popover that presents two reads late is still showing no window when the
///      first post-tap read happens, so it agrees with the pre-tap one and the anchor is tapped
///      again ~1.4 s later — which closes it (the X31 flake, exactly).
///   3. **A deadline, not a count.** How many gestures a loaded machine needs is not knowable at
///      compile time; how long a check may take is. The count is an outcome, printed for the log.
///
/// Running out is not a pass: the caller gets `satisfied == false` with `outOfBudget == true` and the
/// last reading, and says which of the two it is — "the touch was never delivered" and "a window is
/// up and its content never published" are different bugs, and the old fixed-count loop reported the
/// first about the second.
///
/// Compiled into the UI-test target and, unmodified, on the host by `bun run test:native`
/// (`scripts/native-tests/gesture-settlement.test.swift`).
enum GestureSettlement {
  /// How one `settle` call ended.
  struct Outcome<Reading> {
    /// The last reading taken. The caller phrases the failure from this: it knows what the reading
    /// *means*, this type does not.
    let last: Reading
    /// How many times `read` was called, including the first.
    let reads: Int
    /// How many times `press` was called. In a log line, because "answered on the third tap" is the
    /// difference between a delivery that had to be re-sent and one that never was.
    let presses: Int
    /// Two consecutive agreeing reads said the gesture had arrived.
    let satisfied: Bool
    /// The deadline or the read cap ended the wait, rather than agreement. Both mean "never settled",
    /// and both are a failure the caller has to phrase — but they are not the same failure as a
    /// settled reading that was never satisfied, and `last` tells them apart.
    let outOfBudget: Bool
    /// Wall clock spent, measured with the injected clock.
    let elapsedMs: Int
  }

  /// Read, and press while the screen says nothing arrived, until two agreeing reads say it did.
  ///
  /// - Parameter deadlineMs: the whole budget for the wait. The mechanism, not a backstop: the number
  ///   of gestures a loaded simulator needs is exactly what is not knowable in advance.
  /// - Parameter pauseMs: how long to sit before each re-read. A read is a round trip into the test
  ///   manager, so this is cheap next to it; its job is to make the next read a *different* sample.
  /// - Parameter maxReads: the runaway guard for a `read` that never agrees (an animating tree),
  ///   bounded alongside the clock rather than instead of it — the same double bound
  ///   `A11yFrameStability` uses.
  /// - Parameter minReads: reads always paid for, whatever the clock says. Two: the agreeing pair *is*
  ///   the answer. Setting this to 1 reinstates the flake this type exists to remove.
  /// - Parameter maxPresses: an optional sanity cap on gestures. `nil` means the deadline is the only
  ///   bound, which is the point of the type; a cap belongs where a repeated gesture is itself
  ///   destructive, and is not the way to express "don't take too long".
  /// - Parameter quietAfterPressMs: how long the last press gets to land before another may be sent.
  ///   `0` is the old behaviour and belongs to a gesture that is harmless to repeat (a drag); a
  ///   gesture that *toggles* what it is aimed at — a `Popover` anchor — wants the time the app needs
  ///   to react, because two agreeing reads can be two reads of a screen that simply has not caught
  ///   up yet, and the second tap on an open anchor closes it. The deadline still ends the wait, so a
  ///   quiet period delays a re-send; it cannot lose one.
  /// - Parameter read: one observation. Called on this thread; each call is the round trip.
  /// - Parameter agrees: do two readings describe the same screen? Exact equality on what the caller
  ///   reads — a tolerance here would let a still-moving screen look settled.
  /// - Parameter satisfied: does this reading say the gesture arrived?
  /// - Parameter mayPress: does this reading say *nothing has arrived yet*, so the gesture may be
  ///   sent again? This is where a caller says "a presentation is up, so do not tap again".
  /// - Parameter press: the gesture, told which number this is (a caller that drags by the current
  ///   overhang needs no number; one that logs the first attempt differently needs it).
  /// - Parameter nowMs / pause: injected, so the deadline is provable in milliseconds rather than by
  ///   a device run that happens to be slow.
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
    // Can `previous` be paired with the next read to decide anything? Not right after a press: that
    // reading is the one the press was aimed by, so it describes the screen as it was *before* the
    // gesture. Paired with the first read after the press it says "nothing changed", about a change
    // that has not had the chance to be visible yet. Discarding it makes the rule literal — two
    // agreeing reads, both taken after the last press.
    var comparable = true
    var lastPressAtMs: Int? = nil

    /// Has the last press had `quietAfterPressMs` to land? A caller with no quiet period is asked
    /// nothing and gets `true` without the clock being read.
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
      // Only after the pair has been bought: a read costs seconds here, so a budget honoured first
      // would return a single read and call it a settle — `A11yFrameStability`'s branch 4, learned on
      // a device with fourteen red cases attached.
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
        // Settled, and settled *outside*: the state is asking for the gesture again. A screen that is
        // still moving is not, and gets no press — the next read is the one that decides.
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

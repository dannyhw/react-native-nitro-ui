import XCTest

/// Real-input checks: taps and drags synthesised by iOS, asserted only through
/// text the app renders on screen.
///
/// ## Why this exists
///
/// `react-native-harness` drives these controls through the library's own test
/// hooks, so it proves that Nitro's plumbing works. It has never proved that a
/// touch delivered by the operating system reaches a hosted SwiftUI control
/// inside a React Native app - and that is a known failure class for
/// SwiftUI-in-RN, where React Native's touch handler can swallow touches meant
/// for a hosted view. G2 also found a SwiftUI `Button` that ignored the
/// harness's HID-less touch entirely, and `agent-device` could not tap anything
/// on the iOS 27 simulator. XCUITest synthesises events through the simulator's
/// own event path, so they arrive the way a finger's do.
///
/// Every assertion reads an on-screen `Text` by its accessibility identifier:
/// what a person sees and VoiceOver announces. Nothing here reaches for a test
/// hook, a Nitro callback or an in-app tracer, and nothing here patches the
/// library - if a control does not answer a real touch, the check says so.
///
/// ## Adding a control
///
/// Add one `testRealInput<Id>` method here, one entry in
/// `scripts/real-input/controls.mjs`, and one check in
/// `scripts/real-input/android.mjs`. `bun run test:real-input:ios` fails if the
/// shared table lists a control with no matching method in this file (and if
/// this file has a method the table does not know), so a control cannot quietly
/// drop out of the suite.
///
/// ## How elements are found
///
/// By `testID`, which React Native writes onto the component view as
/// `accessibilityIdentifier` - including for a hosted control, whose SwiftUI
/// view sits inside that component view. (Android has to use
/// `accessibilityLabel` there instead: Compose publishes its own accessibility
/// node, and React Native stores `testID` as a view tag, which is not part of
/// the accessibility tree. See `scripts/real-input/uiautomator.mjs`.)
final class RealInputTests: XCTestCase {
  /// The example app's four tabs.
  private enum Tab {
    static let switchTab = "tab-switch"
    static let sliderTab = "tab-slider"
    static let buttonTab = "tab-button"
    static let segmentedTab = "tab-segmented"
  }

  /// The on-screen echoes the checks read (`testID`s from `example/src`).
  private enum Echo {
    static let switchValue = "switch-controlled-value"
    static let buttonCount = "real-input-count"
    static let sliderStart = "slider-start-count"
    static let sliderChange = "slider-change-count"
    static let sliderComplete = "slider-complete-count"
    static let sliderValue = "slider-phase-value"
    static let sliderControlledValue = "slider-controlled-value"
    static let segmentedIndex = "real-input-segmented-index"
    static let segmentedEvents = "real-input-segmented-events"
    static let rejectEvents = "real-input-reject-events"
    static let rejectValue = "real-input-reject-value"
  }

  /// How far the Slider's thumb sits from each end of the track at the extremes,
  /// as a fraction of the track. SwiftUI keeps about half a thumb's width clear
  /// at each end - roughly 4% of this app's 388pt track - so pressing at the raw
  /// value would land beside the thumb rather than on it near the ends.
  fileprivate static let thumbInset: CGFloat = 0.04

  /// A debug build loads its bundle from Metro, so the first render is not
  /// instant - especially on a machine running several tasks at once.
  private let firstRenderTimeout: TimeInterval = 120
  /// How long a control gets to react to a gesture it should have answered.
  private let reactTimeout: TimeInterval = 8

  private var app: XCUIApplication!

  override func setUpWithError() throws {
    try super.setUpWithError()
    // One fresh app per test method, so every counter starts at zero and a
    // failure in one control cannot be explained away by the one before it.
    continueAfterFailure = false
    app = XCUIApplication()
    app.launch()
    _ = try required(Tab.switchTab, as: "the example's tab bar", timeout: firstRenderTimeout)
  }

  override func tearDown() {
    app = nil
    super.tearDown()
  }

  /// A real tap must flip the hosted SwiftUI `Toggle` and bring the new value
  /// back to React. The echo is React's own render, so it only changes if the
  /// touch reached SwiftUI, SwiftUI told Nitro, and Nitro told JS.
  ///
  /// The tap is delivered twice, because a single change could also be an echo
  /// that moved by itself: the control has to answer a second touch, the other
  /// way, to have proved anything.
  func testRealInputSwitch() throws {
    try goToTab(Tab.switchTab, showing: Echo.switchValue)
    let control = try required("switch-controlled", as: "the controlled Switch")
    let whereItStarted = control.frame
    XCTAssertEqual(
      try read(Echo.switchValue),
      "off",
      "the Switch should start off before any touch is delivered"
    )

    control.centre.tap()
    XCTAssertEqual(
      readUntil(Echo.switchValue) { $0 == "on" },
      "on",
      "one real tap should flip the Switch, and React should render \"on\""
    )

    // The second touch has to find the Switch where the app put it. A hosted
    // control that leaves the row when its value changes cannot be tapped
    // again, and that is worth naming instead of losing in a query error -
    // `docs/tasks/T15-real-input.report.md` has the measurements.
    try assertStillInPlace("switch-controlled", startedAt: whereItStarted, after: "the first real tap")

    try required("switch-controlled", as: "the controlled Switch").centre.tap()
    XCTAssertEqual(
      readUntil(Echo.switchValue) { $0 == "off" },
      "off",
      "a second real tap should flip it back, so the check is not one fluke"
    )
  }

  /// A real drag must move the thumb and report every phase.
  ///
  /// The phases Slider is uncontrolled and counts each callback separately, so a
  /// missing `onSlidingStart` cannot hide behind an `onValueChange` that still
  /// worked. The controlled Slider is dragged too: there the echo is React's own
  /// state, so it proves the whole loop - touch → SwiftUI → Nitro → JS →
  /// re-render → value back down to native - with nothing but a finger in it.
  func testRealInputSlider() throws {
    try goToTab(Tab.sliderTab, showing: Echo.sliderStart)
    let phases = try required("slider-phases", as: "the phases Slider")
    XCTAssertEqual(
      "\(try read(Echo.sliderStart)) \(try read(Echo.sliderChange)) \(try read(Echo.sliderComplete))",
      "start=0 change=0 complete=0",
      "no gesture has happened yet, so no phase may be reported"
    )

    // Half-way in: the thumb is exactly there for a Slider that starts at 0.5,
    // and the thumb's inset cancels out at the centre of the track.
    phases.dragFromThumb(atValue: 0.5, toFraction: 0.9)
    _ = readUntil(Echo.sliderComplete) { $0 == "complete=1" }
    XCTAssertEqual(
      try read(Echo.sliderStart),
      "start=1",
      "one drag should fire onSlidingStart exactly once"
    )
    XCTAssertEqual(
      try read(Echo.sliderComplete),
      "complete=1",
      "one drag should fire onSlidingComplete exactly once"
    )
    let changeText = try read(Echo.sliderChange)
    XCTAssertTrue(
      Int(changeText.replacingOccurrences(of: "change=", with: "")) ?? 0 >= 2,
      "a drag should report the way over, not only the end (echo: \(changeText))"
    )
    let landedText = try read(Echo.sliderValue)
    let landed = number(in: landedText)
    XCTAssertTrue(
      landed != nil && landed! > 0.6,
      "dragging right should land right of centre (echo: \(landedText))"
    )

    // Back the other way, from wherever the first drag left the thumb - which is
    // what the echo says, because that is what a person sees.
    phases.dragFromThumb(atValue: landed ?? 0.9, toFraction: 0.1)
    _ = readUntil(Echo.sliderComplete) { $0 == "complete=2" }
    XCTAssertEqual(
      "\(try read(Echo.sliderStart)) \(try read(Echo.sliderComplete))",
      "start=2 complete=2",
      "a second drag should fire both phases again"
    )
    let backText = try read(Echo.sliderValue)
    let backValue = number(in: backText)
    XCTAssertTrue(
      backValue != nil && backValue! < 0.4,
      "dragging back should move the value the other way (echo: \(backText))"
    )

    let controlled = try required("slider-controlled", as: "the controlled Slider")
    let before = number(in: try read(Echo.sliderControlledValue))
    XCTAssertEqual(before, 0.25, "the controlled Slider should start at 0.25")
    controlled.dragFromThumb(atValue: before ?? 0.25, toFraction: 0.8)
    let after = readNumberUntil(Echo.sliderControlledValue) { value in
      value != nil && before != nil && value! > before!
    }
    XCTAssertTrue(
      after != nil && before != nil && after! > before! + 0.2,
      "a real drag on the controlled Slider should reach React (echo went from \(String(describing: before)) to \(String(describing: after)))"
    )
  }

  /// A real tap must reach the hosted SwiftUI `Button`'s `onPress`, and a real
  /// tap on a disabled one must not.
  ///
  /// This is the case the harness could never show: G2 found a SwiftUI `Button`
  /// that ignored `react-native-harness`'s HID-less touch entirely, so the only
  /// witness that counts is one the app renders after a touch that started
  /// outside it. The two Buttons share one counter and both are given `onPress`,
  /// so the disabled half says something: a library that let a disabled control
  /// fire would move the number, and a counter that simply stopped rendering
  /// would be caught by the tap that follows.
  func testRealInputButton() throws {
    try goToTab(Tab.buttonTab, showing: Echo.buttonCount)
    let control = try required("real-input-enabled", as: "the enabled Button")
    let disabled = try required("real-input-disabled", as: "the disabled Button")
    XCTAssertEqual(
      try read(Echo.buttonCount),
      "0",
      "the Button should start with no presses recorded"
    )

    control.centre.tap()
    XCTAssertEqual(
      readUntil(Echo.buttonCount) { $0 == "1" },
      "1",
      "one real tap on the enabled Button should reach onPress and React should render 1 - the hierarchy dump above shows what was on screen instead"
    )

    disabled.centre.tap()
    XCTAssertEqual(
      readUntil(Echo.buttonCount, timeout: 1.5) { $0 != "1" },
      "1",
      "a real tap on the disabled Button should be refused: onPress was passed to it too, so a count that moves proves the touch was not refused"
    )

    control.centre.tap()
    XCTAssertEqual(
      readUntil(Echo.buttonCount) { $0 == "2" },
      "2",
      "a second real tap should press the enabled Button again - which is also what proves the line above measured a refusal and not a screen that had stopped rendering"
    )
    XCTAssert(control.isHittable, "the enabled Button should still be touchable")
    XCTAssert(disabled.isHittable, "the disabled Button should still be on screen")
  }

  /// A real tap must select the segment under the finger, and a selection the
  /// app refuses must go back.
  ///
  /// The uncontrolled half is the plain claim: a touch at the middle of the
  /// second segment makes React render `1`, and one at the first makes it render
  /// `0`. Both echoes are React's own text, so they only move if the touch
  /// reached SwiftUI's segmented `Picker`, SwiftUI told Nitro, and Nitro told JS.
  ///
  /// The controlled half is the harder one, and its witness is a count. The
  /// parent keeps sending `selectedIndex={0}`, so after a tap on segment 2 the
  /// control must snap back to segment 1 - and a snapshot of the screen cannot
  /// prove that, because the screen looks identical before and after a snap. So
  /// the check taps segment 2 *twice*: a control that had stayed on segment 2
  /// would treat the second tap as a tap on the segment that is already chosen
  /// and report nothing (that is the `Picker` binding's own rule, and the rule
  /// Material 3's segment is given on Android). Two reported changes with the
  /// parent's value never moving is therefore the snap-back.
  func testRealInputSegmentedControl() throws {
    try goToTab(Tab.segmentedTab, showing: Echo.segmentedIndex)
    let control = try required("real-input-segmented", as: "the uncontrolled SegmentedControl")
    let whereItStarted = control.frame
    // A dash, not a `0`: the control is uncontrolled, so nothing has told JS its
    // index and nothing should have. That is the claim worth making here, and the
    // one both platforms can make the same way.
    XCTAssertEqual(
      try read(Echo.segmentedIndex),
      "-",
      "the SegmentedControl should not have reported an index before a touch"
    )
    XCTAssertEqual(try read(Echo.segmentedEvents), "0", "no change should be reported before a touch")

    // The three options are single digits, so the segments are the same width and
    // the middle of the control is the middle segment on both platforms.
    control.atFraction(0.5).tap()
    XCTAssertEqual(
      readUntil(Echo.segmentedIndex) { $0 == "1" },
      "1",
      "a real tap on the second segment should reach JS as index 1"
    )
    XCTAssertEqual(try read(Echo.segmentedEvents), "1", "one tap should report one change")

    try assertStillInPlace("real-input-segmented", startedAt: whereItStarted, after: "the first real tap")

    // A different segment, so a second change is owed: a control that reported the
    // same index twice would also satisfy the line above by echoing once.
    try required("real-input-segmented", as: "the uncontrolled SegmentedControl")
      .atFraction(0.12)
      .tap()
    XCTAssertEqual(
      readUntil(Echo.segmentedIndex) { $0 == "0" },
      "0",
      "a real tap on the first segment should reach JS as index 0"
    )
    XCTAssertEqual(try read(Echo.segmentedEvents), "2", "two taps should report two changes")

    // The refusing parent.
    let rejecting = try required("real-input-segmented-reject", as: "the controlled SegmentedControl")
    XCTAssertEqual(
      try read(Echo.rejectValue),
      "0",
      "the refusing parent pins its SegmentedControl at index 0"
    )
    XCTAssertEqual(try read(Echo.rejectEvents), "0", "no change should be reported before a touch")

    rejecting.atFraction(0.5).tap()
    XCTAssertEqual(
      readUntil(Echo.rejectEvents) { $0 == "1" },
      "1",
      "a real tap on the controlled control's second segment should still reach JS - native paints optimistically (core.md section 4)"
    )
    XCTAssertEqual(
      try read(Echo.rejectValue),
      "0",
      "the parent never accepted the change, so the index it sends is still 0"
    )

    // The snap-back oracle, explained above: this tap can only be reported if the
    // selection went back to the first segment.
    try required("real-input-segmented-reject", as: "the controlled SegmentedControl")
      .atFraction(0.5)
      .tap()
    XCTAssertEqual(
      readUntil(Echo.rejectEvents) { $0 == "2" },
      "2",
      "a second tap on segment 2 should be a fresh selection, which is only true if the refused one was rolled back"
    )
    XCTAssertEqual(
      try read(Echo.rejectValue),
      "0",
      "and the parent should still be refusing"
    )
  }

  // MARK: - Reading the screen

  /// The element React Native gave this `testID`, waiting for it to exist.
  ///
  /// `.any` rather than a concrete type: the hosted controls are views React
  /// Native hosts, and which accessibility subclass they surface as is the
  /// library's business, not the check's.
  private func required(
    _ identifier: String,
    as what: String,
    timeout: TimeInterval = 10
  ) throws -> XCUIElement {
    let node = app.descendants(matching: .any)[identifier].firstMatch
    if !node.waitForExistence(timeout: timeout) {
      dumpHierarchy("no element \"\(identifier)\" after \(timeout)s")
      XCTFail(
        "\(what): no element with accessibilityIdentifier \"\(identifier)\" appeared within \(timeout)s"
      )
      throw RealInputCheckAborted(identifier: identifier)
    }
    return node
  }

  /// Switch to one of the example's tabs and wait for its screen.
  ///
  /// The example mounts one screen at a time, so a control on the other screen
  /// is not in the tree at all rather than merely off-screen.
  ///
  /// - Parameter identifier: the tab's `testID`, e.g. `tab-slider`.
  /// - Parameter screenAnchor: a `testID` only that screen renders.
  private func goToTab(_ identifier: String, showing screenAnchor: String) throws {
    if app.descendants(matching: .any)[screenAnchor].firstMatch.exists {
      return
    }
    try required(identifier, as: "the example's tab").centre.tap()
    _ = try required(screenAnchor, as: "the screen behind that tab", timeout: reactTimeout)
  }

  /// Fail, with the hierarchy, if a control has moved out of the window since it
  /// was last looked at.
  ///
  /// Every check here taps or drags a control more than once, and a control that
  /// has been laid out somewhere else - or nowhere - cannot be reached again.
  /// Saying so here turns "the query found nothing" into the measurement that
  /// shows what the app did.
  private func assertStillInPlace(
    _ identifier: String,
    startedAt: CGRect,
    after action: String
  ) throws {
    let node = app.descendants(matching: .any)[identifier].firstMatch
    if !node.exists || !node.isHittable {
      dumpHierarchy("\(action) on \(identifier)")
      XCTFail(
        "\(identifier) is no longer where it was after \(action): it was drawn "
          + "at \(startedAt) and React reported the new value, but the control is "
          + "now \(node.exists ? "outside the window (not hittable)" : "gone from the accessibility tree") "
          + "- so it cannot be touched again. See the hierarchy dump above."
      )
      throw RealInputCheckAborted(identifier: identifier)
    }
    XCTAssertEqual(
      node.frame,
      startedAt,
      "\(identifier) should still be drawn where it started, after \(action)"
    )
  }

  /// What an echo currently says: the string React Native rendered.
  private func read(_ identifier: String) throws -> String {
    let node = try required(identifier, as: "the on-screen text \"\(identifier)\"", timeout: reactTimeout)
    if !node.label.isEmpty {
      return node.label
    }
    return (node.value as? String) ?? ""
  }

  /// Poll an echo until it says something acceptable, then report the last thing
  /// it said - so a failure names the value that arrived, not just the one that
  /// was wanted.
  private func readUntil(
    _ identifier: String,
    timeout: TimeInterval = 8,
    _ isExpected: (String) -> Bool
  ) -> String {
    let deadline = Date().addingTimeInterval(timeout)
    var shown = ""
    repeat {
      let node = app.descendants(matching: .any)[identifier].firstMatch
      if node.exists {
        shown = node.label.isEmpty ? ((node.value as? String) ?? "") : node.label
      }
      if isExpected(shown) {
        return shown
      }
      Thread.sleep(forTimeInterval: 0.25)
    } while Date() < deadline
    dumpHierarchy("nothing matched what was waited for on \(identifier)")
    return shown
  }

  /// `readUntil` for the echoes that carry a number.
  private func readNumberUntil(
    _ identifier: String,
    _ isExpected: (Double?) -> Bool
  ) -> Double? {
    var parsed: Double?
    _ = readUntil(identifier) { text in
      parsed = number(in: text)
      return isExpected(parsed)
    }
    return parsed
  }

  /// The number an echo carries (`value=0.750`, `0.250`, ...).
  private func number(in text: String) -> Double? {
    let digits = text.filter { $0.isNumber || $0 == "." || $0 == "-" }
    return Double(digits)
  }

  /// Print the accessibility tree.
  ///
  /// A real-input failure is worth little without the screen it happened on, and
  /// the xcodebuild log is the evidence this suite keeps: `scripts/real-input/ios.mjs`
  /// writes it to `.real-input/ios/xcodebuild-test.log`.
  private func dumpHierarchy(_ why: String) {
    print("real-input (ios): accessibility hierarchy - \(why)")
    print(app.debugDescription)
  }
}

/// A check could not continue because something it needs is not there at all.
/// `continueAfterFailure = false` already ends the test at the first failed
/// assertion; this keeps the case where an element is missing honest instead of
/// letting the next assertion run against nothing.
private struct RealInputCheckAborted: Error {
  let identifier: String
}

extension XCUIElement {
  /// The middle of this element, as a point the system can touch.
  var centre: XCUICoordinate {
    coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
  }

  /// A point a fraction of the way across this element, vertically centred.
  ///
  /// A segmented control needs it: `centre` is always the middle segment, and
  /// proving that a segment *other* than the middle one answers a touch is half
  /// of what the check is for. Fractions stay away from the edges, where the
  /// rounded end caps and a possible 1 pt divider between segments live.
  func atFraction(_ dx: CGFloat, dy: CGFloat = 0.5) -> XCUICoordinate {
    coordinate(withNormalizedOffset: CGVector(dx: dx, dy: dy))
  }

  /// Press on the thumb and drag it along the track to a fraction of it.
  ///
  /// The start has to be where the thumb actually is. On iOS a SwiftUI Slider
  /// ignores a touch that lands anywhere else on the track: measured in this
  /// suite, presses at 0.1, 0.2, 0.25, 0.75 of the track and a tap on it each
  /// reported nothing at all - no `onSlidingStart`, no `onValueChange`, no value
  /// - while one drag that began on the thumb reported the start, forty changes
  /// and the completion. A person grabs the thumb too. (Compose's Slider does
  /// answer a touch on the track, which is why `scripts/real-input/android.mjs`
  /// can start its drags at a quarter of the way along.)
  ///
  /// - Parameters `atValue`/`toFraction`: where to press, as a Slider value, and
  ///   where to release, as a fraction of the track - both 0 being the left edge.
  func dragFromThumb(atValue: Double, toFraction: CGFloat, hold: TimeInterval = 0.3) {
    let inset = RealInputTests.thumbInset
    let thumb = CGFloat(atValue)
    let start = coordinate(
      withNormalizedOffset: CGVector(dx: min(max(inset + thumb * (1 - 2 * inset), 0.05), 0.95), dy: 0.5)
    )
    let end = coordinate(withNormalizedOffset: CGVector(dx: toFraction, dy: 0.5))
    // The hold is short because iOS clamps it to about three seconds anyway, and
    // long enough that the control must treat this as a drag, not a tap.
    start.press(forDuration: hold, thenDragTo: end)
  }
}

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
    static let datePickerTab = "tab-datepicker"
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
    static let dateValue = "real-input-date-value"
    static let dateEvents = "real-input-date-events"
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

  /// A real tap on the `compact` field must open SwiftUI's own presentation, and a
  /// real tap on a day inside it must reach JS as a new instant.
  ///
  /// This is the control where a hosted-library bug is most likely, because the
  /// thing the finger finally lands on is not in the React Native window at all -
  /// it is SwiftUI's calendar, presented by the presentation system. Two hops have
  /// to work for the echo to move: the field's own button, then the day cell.
  ///
  /// The day is chosen by the helper rather than named: a pick of the date already
  /// showing reports nothing by design (the suppression rule), which from out here
  /// is indistinguishable from a touch that never arrived.
  func testRealInputDatePicker() throws {
    try goToTab(Tab.datePickerTab, showing: Echo.dateValue)
    let field = try required("real-input-date", as: "the uncontrolled DatePicker field")
    let whereItStarted = field.frame
    // A dash, not a date: the picker is uncontrolled, so nothing has told JS a
    // value and nothing should have.
    XCTAssertEqual(
      try read(Echo.dateValue),
      "-",
      "the DatePicker should not have reported a day before a touch"
    )
    XCTAssertEqual(try read(Echo.dateEvents), "0", "no change should be reported before a touch")

    field.centre.tap()
    let opened = try openPresentation(from: field, watching: Echo.dateValue)
    try pickSomeDay(in: opened, from: field, watching: Echo.dateValue) { $0 != "-" }

    XCTAssertEqual(
      try read(Echo.dateEvents),
      "1",
      "one day picked should report one change"
    )
    try assertStillInPlace(
      "real-input-date",
      startedAt: whereItStarted,
      after: "the real pick"
    )

    // The refusing parent: the pick must reach JS, and the day the parent keeps
    // sending must not move. Unlike the SegmentedControl check this does not need
    // a tap-twice oracle - the parent's pinned day is on screen as text, and a
    // picker that never reverted would show the picked day in the field.
    let rejecting = try required(
      "real-input-date-reject",
      as: "the controlled DatePicker field"
    )
    XCTAssertEqual(
      try read(Echo.rejectValue),
      "2024-06-15",
      "the refusing parent pins its DatePicker at 2024-06-15"
    )
    XCTAssertEqual(
      try read(Echo.rejectEvents),
      "0",
      "no change should be reported on the controlled control yet"
    )
    rejecting.centre.tap()
    let rejectingPopover = try openPresentation(from: rejecting, watching: Echo.rejectEvents)
    try pickSomeDay(in: rejectingPopover, from: rejecting, watching: Echo.rejectEvents) { $0 != "0" }
    XCTAssertEqual(
      try read(Echo.rejectEvents),
      "1",
      "a real pick on the controlled field should reach JS once - native paints optimistically (core.md section 4)"
    )
    XCTAssertEqual(
      try read(Echo.rejectValue),
      "2024-06-15",
      "the parent never accepted the change, so the day it sends is still 2024-06-15"
    )

    // And the same control at the bottom of a form rather than the top, where the
    // presentation has no room under it and the label has to leave the value alone.
    try assertLowRowField()
  }

  /// The last row of the Date screen: a labelled `compact` field with the whole
  /// screen above it and nothing under it but the home indicator.
  ///
  /// Two properties live or die in that position, and neither is visible from the
  /// fields near the top that every other check uses.
  ///
  /// **The popover has to fit.** The bubble this control presents is 336 pt wide and
  /// 300-420 pt tall. UIKit sizes a popover to the room available *on the side its
  /// arrow is permitted to point*, so while the presentation permitted only one
  /// direction, a field in the lower half of the screen got a calendar clipped to the
  /// few dozen points left under it - the month cut in half, the day cells far under
  /// the 44 pt target `calendarWidth` exists to guarantee. The fix is to permit both
  /// directions; this is the check that can tell, because the row is scrolled as far
  /// down as the page goes.
  ///
  /// **The announcement has to be complete.** This row sets `accessibilityLabel`, and
  /// with a label set VoiceOver reads the label as the node's *name* - so the date has
  /// to arrive as the node's *value* or the user hears "Departure date, button" and
  /// never the day. That is what `.accessibilityValue` on the compact button is for,
  /// and the accessibility tree is the only place it can be observed.
  private func assertLowRowField() throws {
    // Whatever the earlier half of this test left open has to go first: a tap
    // outside a popover is dismissed by the popover, and the scroll below would
    // otherwise be swallowed by it.
    try dismissAnyPresentation()

    let field = try required("low-date", as: "the last row's DatePicker field")
    let screen = app.windows.firstMatch.frame

    // Scroll to the end of the page. It is at the end when a further swipe no longer
    // moves the field - not when the field becomes hittable, which happens rows
    // before the bottom and would leave this check testing a field in the middle.
    var position = field.frame
    for _ in 0..<12 {
      app.swipeUp()
      let after = field.frame
      if after == position {
        break
      }
      position = after
    }
    let frame = field.frame
    let roomBelow = screen.maxY - frame.maxY
    print("real-input low row: field=\(frame) screen=\(screen) roomBelow=\(roomBelow)")

    // The check is only worth running in the position it is about, so say so loudly
    // rather than pass quietly on a screen that did not scroll.
    XCTAssertGreaterThan(
      frame.minY,
      screen.midY,
      "the last row of the Date screen ended at y \(frame.minY) of a \(screen.height)pt "
        + "screen - not in the lower half, so this cannot see a popover being squeezed"
    )
    XCTAssertLessThan(
      roomBelow,
      250,
      "there are \(roomBelow)pt under the last row, which is room enough for a popover "
        + "of its own - the case this check exists for is a field with almost none"
    )

    // The accessibility pair, read the way a screen reader reads it.
    //
    // `testID` names React Native's container, and the container is *not* the node
    // VoiceOver stops on: the control is the hosted element inside it, which is where
    // `accessibilityLabel` goes (core.md §3 bans naming the box instead). On this
    // screen the two differ in exactly the way that matters - the container reports
    // the label with an empty value, and the hosted button below it reports the label
    // *and* the localised day. So the assertion aims at the innermost element the
    // subtree offers: reading `field.value` would be reading the wrapper, which says
    // nothing about what a user hears.
    //
    // The subtree is printed either way. This is the only place in the suite where the
    // tree a screen reader walks gets written down, and the kept log
    // (`.real-input/ios/xcodebuild-test.log`, "low row a11y") is the evidence behind
    // the M3 claim in the report.
    func describe(_ node: XCUIElement, who: String) -> String {
      let id = node.identifier
      let label = node.label
      let value = (node.value as? String) ?? (node.value == nil ? "<nil>" : "\(String(describing: node.value))")
      return "real-input low row a11y [\(who)]: type=\(node.elementType.rawValue) id=\"\(id)\" "
        + "label=\"\(label)\" value=\"\(value)\" frame=\(node.frame)"
    }

    print(describe(field, who: "the testID node"))
    let walked = field.descendants(matching: .any).allElementsBoundByIndex
    print("real-input low row a11y: \(walked.count) descendants of the testID node")
    for node in walked {
      print(describe(node, who: "descendant"))
    }
    // Contrast, one row above: an unlabelled field's control takes its name from its
    // own text, so a *label* is the only thing that can push the date out of the
    // announcement - which is why the labelled row is the one under test.
    let plain = app.descendants(matching: .any)["tinted-inline"].firstMatch
    if plain.exists {
      print(describe(plain, who: "the unlabelled row above"))
    }

    let control = ([field] + walked).last { $0.elementType == .button } ?? field
    XCTAssertEqual(
      control.label,
      "Departure date",
      "the field's name should be the accessibilityLabel it was given"
    )
    XCTAssertTrue(
      ((control.value as? String) ?? "").contains("2026"),
      "the labelled compact field announced value=\"\(String(describing: control.value))\", "
        + "which is not a date: with a label set the label *replaces* the control's own "
        + "text, so the localised day has to be announced as the value - a field that "
        + "says nothing here tells the user what the field is and never what it holds"
    )

    let popovers = app.descendants(matching: .popover)
    print(
      "real-input low row: before the press popovers=\(popovers.count) "
        + "windows=\(app.windows.count) containerHittable=\(field.isHittable) "
        + "controlHittable=\(control.isHittable)"
    )
    // The finger goes on the *control*, which is what the paragraph above just
    // located. React Native's container reports `isHittable == false` here - hit
    // testing returns the hosted button, not the wrapper around it - and the kept log
    // of the run that aimed at the wrapper shows the first press eaten (`press 1 ->
    // popovers=0`, `press 2 -> popovers=1`) with the bubble then opening at its full
    // size. Aiming at the control is both the honest gesture and the reliable one;
    // the retry stays because a press released while the list is still settling can
    // still be eaten by its own gesture recogniser, and that is not the property
    // under test - the size and place of the presentation below are.
    var attempts = 0
    while popovers.count == 0 && attempts < 3 {
      attempts += 1
      control.centre.tap()
      let settle = Date().addingTimeInterval(2.0)
      while Date() < settle, popovers.count == 0 {
        Thread.sleep(forTimeInterval: 0.1)
      }
      print("real-input low row: press \(attempts) -> popovers=\(popovers.count) windows=\(app.windows.count)")
    }
    guard popovers.count > 0 else {
      dumpHierarchy("tapping the last row presented nothing")
      let shot = XCUIScreen.main.screenshot()
      let url = URL(fileURLWithPath: "/tmp/g5-lowrow-\(attempts).png")
      try? shot.pngRepresentation.write(to: url)
      print("real-input low row: screenshot written to \(url.path)")
      XCTFail("a real tap on the last row's field presented no popover")
      throw RealInputCheckAborted(identifier: Echo.dateValue)
    }
    let popover = popovers.firstMatch
    let bubble = popover.frame
    print("real-input low row: popover=\(bubble)")

    XCTAssertGreaterThanOrEqual(
      bubble.width,
      300,
      "the last row presented a popover \(bubble.width)pt wide - a calendar's seven "
        + "columns of day cells are not tappable at that width"
    )
    XCTAssertGreaterThanOrEqual(
      bubble.height,
      250,
      "the last row presented a popover \(bubble.height)pt tall into \(roomBelow)pt of "
        + "room: UIKit compressed the calendar into the space under the field instead of "
        + "putting the bubble above it, and the month a finger has to use is cut off"
    )
    XCTAssertLessThanOrEqual(
      bubble.maxY,
      frame.minY + 8,
      "the popover was drawn at y \(bubble.minY)-\(bubble.maxY) with the field starting "
        + "at \(frame.minY): it stayed below a field with only \(roomBelow)pt under it. "
        + "A bubble that cannot fit below has to be permitted to sit above, pointing "
        + "down at the field it belongs to"
    )

    // And the calendar inside it is the usable one, not a shrunken drawing.
    let days = popover.descendants(matching: .collectionView).firstMatch
      .descendants(matching: .button)
    var dayCount = 0
    let daysDeadline = Date().addingTimeInterval(reactTimeout)
    while Date() < daysDeadline {
      dayCount = days.count
      if dayCount > 10 {
        break
      }
      Thread.sleep(forTimeInterval: 0.25)
    }
    XCTAssertGreaterThan(
      dayCount,
      10,
      "the popover a finger has to use holds \(dayCount) day cells"
    )
  }

  /// Close whatever presentation is on screen, by tapping outside it.
  ///
  /// Popovers dismiss on a tap outside their own bounds, so the corner of the window
  /// is the neutral place to ask for that - and if something is up that will not
  /// close, that is worth a failure of its own rather than a mysterious later tap.
  private func dismissAnyPresentation() throws {
    let popovers = app.descendants(matching: .popover)
    guard popovers.count > 0 else {
      return
    }
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.95)).tap()
    let deadline = Date().addingTimeInterval(reactTimeout)
    while Date() < deadline, popovers.count > 0 {
      Thread.sleep(forTimeInterval: 0.2)
    }
    if popovers.count > 0 {
      dumpHierarchy("a tap outside the popover left it up")
      XCTFail("a tap outside the presentation did not close it")
      throw RealInputCheckAborted(identifier: Echo.dateValue)
    }
  }

  /// Press a `compact` field and return the popover it presented.
  ///
  /// The press has to produce a *presentation*, not just a flag: this is the one
  /// control in the library whose content, after the tap, is not in the React
  /// Native window at all. The wait is on the popover element itself, so a field
  /// that only moved a piece of state fails here rather than in the day-picking
  /// helper, where the failure would read as "no cells" and hide what happened.
  ///
  /// What is measured here is the thing a flag cannot tell: whether the bubble a
  /// finger has to use is the right size and in the right place. The first version
  /// of this control presented a 68x188.7 pt popover whose calendar was laid out at
  /// 52 pt wide - a month of day cells drawn from `x: -43` to `x: 141`, most of them
  /// outside the bubble and each one a fraction of the 44 pt minimum touch target -
  /// below the status bar, 190 pt away from the field that opened it. Every number
  /// the app reported was true.
  private func openPresentation(from field: XCUIElement, watching echo: String) throws -> XCUIElement {
    let fieldFrame = field.frame
    let popovers = app.descendants(matching: .popover)
    let deadline = Date().addingTimeInterval(reactTimeout)
    while Date() < deadline, popovers.count == 0 {
      Thread.sleep(forTimeInterval: 0.2)
    }
    guard popovers.count > 0 else {
      dumpHierarchy("tapping \(field.identifier) presented nothing")
      XCTFail(
        "a real tap on the field presented no popover - the accessibility tree has "
          + "no presentation, so a finger has nothing to pick"
      )
      throw RealInputCheckAborted(identifier: echo)
    }
    let popover = popovers.firstMatch
    // Seven columns of at least 44 pt, plus the popover's margin: narrower than
    // that and the days are not tappable, however the control describes itself.
    XCTAssertGreaterThanOrEqual(
      popover.frame.width,
      300,
      "the field presented a popover \(popover.frame.width)pt wide - too narrow for a "
        + "calendar's day cells to be tappable, whatever the control reported"
    )
    // A bubble too short clips the calendar below its own edge: the first version of
    // this presentation was 188.7 pt around a calendar that needs about 312, so the
    // bottom rows of the month were drawn outside the popover. There is no matching
    // upper bound on purpose - pinning the content 700 pt tall could not drive such an
    // assertion red, because UIKit clamps a popover to the room it has, so a "sheet
    // wearing a popover's arrow" is not a state an iPhone can show.
    XCTAssertGreaterThanOrEqual(
      popover.frame.height,
      250,
      "the field presented a popover \(popover.frame.height)pt tall, which is shorter "
        + "than the calendar inside it - the bottom rows of the month are cut off"
    )
    // And it has to be *the field's* popover: a presentation that resolves its anchor
    // somewhere else on the screen points at nothing. `+ 8` of tolerance for the
    // arrow's own height, which the accessibility frame may or may not include.
    XCTAssertGreaterThanOrEqual(
      popover.frame.minY,
      fieldFrame.maxY - 8,
      "the popover opened at y \(popover.frame.minY) while the field ends at "
        + "\(fieldFrame.maxY) - it is not anchored to the control that presented it"
    )
    return popover
  }

  /// Tap day cells inside an open popover until the echo moves.
  ///
  /// The days of a SwiftUI calendar are `Button`s inside the calendar's collection
  /// view (`.cell` finds none: there is no table here), and the list is scoped to
  /// the popover on purpose - the screen also has an *inline* picker whose days are
  /// in the app's own window, and a tap that landed there would move the wrong
  /// echo and prove nothing.
  ///
  /// Candidates start at the middle of the list rather than the top: the first rows
  /// of a month are the days that follow its first weekday, and on the first of a
  /// month one of them is today - the date an uncontrolled picker already shows,
  /// whose pick reports nothing by design.
  private func pickSomeDay(
    in popover: XCUIElement,
    from field: XCUIElement,
    watching echo: String,
    until isMoved: (String) -> Bool,
    attempts: Int = 4
  ) throws {
    let days = popover.descendants(matching: .collectionView).firstMatch
      .descendants(matching: .button)
    let deadline = Date().addingTimeInterval(reactTimeout)
    var dayCount = 0
    while Date() < deadline {
      dayCount = days.count
      if dayCount > 10 {
        break
      }
      Thread.sleep(forTimeInterval: 0.25)
    }
    guard dayCount > 10 else {
      dumpHierarchy("the presentation did not open a calendar")
      XCTFail(
        "the popover presented no calendar: its collection view has \(dayCount) "
          + "day buttons, so a finger has nothing to pick"
      )
      throw RealInputCheckAborted(identifier: echo)
    }

    let middle = dayCount / 2
    for attempt in 0..<attempts {
      let step = attempt / 2
      let index = middle + step * (attempt.isMultiple(of: 2) ? 1 : -1)
      guard index >= 0, index < dayCount else { continue }
      // A day cell's label is the localised date ("Tuesday, 27 October"), never a
      // bare number: the month header and the year-picker control are buttons in
      // the same list, and a pick has to be a date.
      let day = days.element(boundBy: index)
      guard day.label.range(of: "[0-9]", options: .regularExpression) != nil else { continue }
      day.tap()
      if isMoved(readUntil(echo, timeout: 3, isMoved)) {
        // The pick worked, and the presentation is still open: it covers the field
        // the next pair of assertions has to press. The field is a point outside the
        // bubble that belongs to no reachable control, so a tap there can only be the
        // platform's own "tap outside" affordance - and waiting for the bubble to go
        // is what makes those assertions mean something. Closing it is the library's
        // job too: UIKit dismisses without asking, and the model's `presented` flag
        // has to follow or it lies to every test that reads it afterwards.
        field.centre.tap()
        let deadline = Date().addingTimeInterval(reactTimeout)
        var open = app.descendants(matching: .popover).count
        while open > 0, Date() < deadline {
          Thread.sleep(forTimeInterval: 0.2)
          open = app.descendants(matching: .popover).count
        }
        guard open == 0 else {
          dumpHierarchy("a tap outside the presentation")
          XCTFail(
            "a real tap outside the presentation left it open - the app cannot get "
              + "rid of the window it opened, so it still covers the app"
          )
          throw RealInputCheckAborted(identifier: echo)
        }
        return
      }
    }
    let last = (try? read(echo)) ?? "-"
    dumpHierarchy("no day cell moved \(echo)")
    XCTFail(
      "\(attempts) real taps on calendar day cells left \(echo) at \"\(last)\" "
        + "- the touches reached the presentation, but no pick came back to JS"
    )
    throw RealInputCheckAborted(identifier: echo)
  }

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

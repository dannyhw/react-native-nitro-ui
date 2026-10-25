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
  /// The example app's tabs.
  private enum Tab {
    static let switchTab = "tab-switch"
    static let sliderTab = "tab-slider"
    static let buttonTab = "tab-button"
    static let segmentedTab = "tab-segmented"
    static let pickerTab = "tab-picker"
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
    static let pickerIndex = "real-input-picker-index"
    static let pickerEvents = "real-input-picker-events"
    static let dropArm = "real-input-drop-button"
    static let dropRemount = "real-input-drop-remount"
    static let dropGone = "real-input-drop-gone"
    static let dropArmed = "real-input-drop-armed"
  }

  /// The three titles of `real-input-picker`, spelled as `PickerScreen` spells them.
  ///
  /// None of the three appears anywhere else on that screen, which is what lets a
  /// label match name one row of a menu instead of some other text on screen. The
  /// longest one is also the growth proof: choosing it paints a title much wider
  /// than the one the control was measured with.
  private enum Choice {
    static let first = "Onyx"
    static let second = "Quartz"
    static let longest = "A considerably longer mineral name"
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


  /// A real tap must open the hosted SwiftUI `Picker`'s menu, and a real tap on a
  /// row must bring the choice back to React.
  ///
  /// The claims here are the ones a test hook cannot make:
  ///
  ///  - Opening a menu reports no choice, and neither does tapping the row that is
  ///    already chosen. Together those are the way out of a menu that changes
  ///    nothing, which is what a person reaches for when they opened it by mistake.
  ///  - The menu says which row is the current choice, in the way VoiceOver reads.
  ///  - The box follows a title that no React render asked for. This picker is
  ///    uncontrolled: choosing paints a wider title and re-renders nothing, so a
  ///    frame that grew is the host's own measure signal (`core.md` §7) and one
  ///    that did not is the bug a props-batched library ships.
  ///  - A choice the parent refuses must go away. The echo cannot show that - the
  ///    parent keeps sending index 0, so the screen looks the same before and after
  ///    a snap - so the oracle is a *second* tap on the same row: it can only be a
  ///    fresh choice if the refused one was rolled back.
  ///
  /// Measured on iPhone 17, because it decides every witness below: a `.menu`
  /// Picker's list is presented inside the app's own window (one `Window`, an
  /// `Other` over it), and its rows are SwiftUI's - `Cell` > `Button`, each labelled
  /// with its option, the chosen one carrying a `checkmark` image. So rows are found
  /// by the label a screen reader reads, not by `testID`, and "the menu is gone" is
  /// "no element carries that row's text any more". A tap outside the list does not
  /// close it: measured, a touch at the top of the screen falls through the overlay
  /// and leaves the menu open, which is why the dismissal case here runs through a
  /// row (`docs/tasks/G6-picker.report.md`).
  func testRealInputPicker() throws {
    try goToTab(Tab.pickerTab, showing: Echo.pickerIndex)
    let control = try required("real-input-picker", as: "the uncontrolled Picker")
    let widthBefore = control.frame.width
    XCTAssertEqual(
      try read(Echo.pickerIndex),
      "-",
      "an uncontrolled Picker has reported no index, and should not have"
    )
    XCTAssertEqual(try read(Echo.pickerEvents), "0", "no touch has happened yet, so no change may be reported")

    // 0. The control for every claim made below about a presented menu.
    //
    //    Step 7 reads this screen's heartbeat while a menu is open, and that reading
    //    is only evidence if the same screen is seen to beat when nothing is
    //    presented. So watch it here, once, before anything is opened: it has to move
    //    inside the window. (The first version of that reading took the anchor's
    //    accessibility label, which says "Choice, Choice" whatever is selected - an
    //    unfalsifiable witness this assertion is what keeps out. The second version
    //    took a single pair of readings 4 s apart, which aliases with the 6 s
    //    rotation - see `tickerBeat`.)
    let beat = tickerBeat()
    print("real-input (ios): heartbeat with nothing presented: \(beat.readings)")
    XCTAssertTrue(
      beat.moved,
      "the screen's own option ticker should repaint within 8s while nothing is presented (readings \(beat.readings)) - a heartbeat that does not beat here makes step 7's reading prove nothing"
    )

    // 1. Opening. The rows exist only while the menu is open, which is also the
    //    witness that the anchor answered a touch at all.
    control.centre.tap()
    _ = try waitForOption(Choice.longest, "the menu to open")
    XCTAssertEqual(
      try read(Echo.pickerEvents),
      "0",
      "opening a menu is not a choice - nothing may be reported until a row is tapped"
    )

    // 2. The menu says which row it is showing. The mark is the one SwiftUI puts on
    //    the chosen row, so this is what VoiceOver reads, not a test-only attribute.
    XCTAssertTrue(
      optionRow(Choice.first).images.count > 0,
      "the current choice (\"\(Choice.first)\") should carry the menu's selection mark"
    )
    XCTAssertEqual(
      optionRow(Choice.second).images.count,
      0,
      "a row that is not the choice should not carry it"
    )

    // 3. The way out that changes nothing: tap the row that is already chosen. The
    //    menu closes and no change is reported - the binding's own rule, and the
    //    reason a person can leave a menu they opened by mistake.
    try waitForOption(Choice.first, "the menu's first row to be tappable").tap()
    _ = waitUntilOptionGone(Choice.longest, "the menu to close")
    XCTAssertEqual(optionLabels(containing: Choice.longest), 0, "the menu should be closed")
    XCTAssertEqual(
      try read(Echo.pickerEvents),
      "0",
      "choosing the row that was already chosen reports nothing, and the anchor still shows what it started with"
    )

    // 4. Choosing something else.
    try required("real-input-picker", as: "the uncontrolled Picker").centre.tap()
    try waitForOption(Choice.longest, "the menu to open again").tap()
    XCTAssertEqual(
      readUntil(Echo.pickerIndex) { $0 == "2" },
      "2",
      "a real tap on the third row should reach JS as index 2"
    )
    XCTAssertEqual(try read(Echo.pickerEvents), "1", "one choice should report one change")

    // 5. The box has to follow the title. React was never told the title changed, so
    //    only the host's own re-measure can widen the frame - the one sizing signal
    //    no props batch can carry.
    let after = try required("real-input-picker", as: "the uncontrolled Picker")
    XCTAssertTrue(after.isHittable, "the Picker should still be on screen after its own menu closed")
    let widthAfter = after.frame.width
    XCTAssertGreaterThan(
      widthAfter,
      widthBefore + 60,
      "choosing a title much wider than the first should widen the control: it measured \(widthBefore) pt with \"\(Choice.first)\" and now paints \"\(Choice.longest)\" - a frame that did not grow means the host never re-measured an uncontrolled choice"
    )

    // 6. A choice the parent refuses.
    let rejecting = try required("real-input-picker-reject", as: "the controlled Picker")
    XCTAssertEqual(
      try read(Echo.rejectValue),
      "0",
      "the refusing parent pins its Picker at index 0"
    )
    rejecting.centre.tap()
    try waitForOption("Ridge", "the refusing Picker's menu to open").tap()
    XCTAssertEqual(
      readUntil(Echo.rejectEvents) { $0 == "1" },
      "1",
      "a real tap on the controlled Picker should still reach JS - native paints optimistically (core.md section 4)"
    )
    XCTAssertEqual(
      try read(Echo.rejectValue),
      "0",
      "the parent never accepted the change, so the index it sends is still 0"
    )

    // The snap-back oracle, explained above: this tap is a fresh choice only if the
    // refused one went back to what the parent keeps sending.
    //
    // The close is waited for rather than assumed. A row tap starts a dismissal that
    // is still running for a moment, and a tap on the anchor that lands inside it is
    // swallowed by the dismissing menu - measured here as this same reopen passing in
    // one run and failing to open anything in a faster one. Waiting for the rows to
    // leave also says something worth saying: choosing a row closes the menu.
    _ = waitUntilOptionGone("Ridge", "the refusing Picker's menu to close")
    try required("real-input-picker-reject", as: "the controlled Picker").centre.tap()
    try waitForOption("Ridge", "the refusing Picker's menu to reopen").tap()
    XCTAssertEqual(
      readUntil(Echo.rejectEvents) { $0 == "2" },
      "2",
      "a second tap on the refused row should be a fresh choice, which is only true if the refused one was rolled back"
    )
    XCTAssertEqual(try read(Echo.rejectValue), "0", "and the parent should still be refusing")

    // 7. The leak case, three times: open a menu, then have React take the view away
    //    underneath it. Nothing per-mount may attach to the view hierarchy without
    //    releasing it (B1's rule), and a menu is the one thing a Picker puts outside
    //    its own box. The menu is not a window of its own on iOS, so the reading is
    //    the window count not moving plus the row's text leaving the tree; a menu that
    //    outlived its control would leave both behind.
    //
    //    Two preconditions make that claim testable rather than theatrical, and both
    //    are witnessed here rather than assumed:
    //
    //      - the press that arms the unmount landed. It is confirmed through the row's
    //        own echo and re-tapped if the echo does not come. Pressing blind once cost
    //        a red run whose only symptom was a Picker that survived, which is exactly
    //        what this step reads as a leaked menu; the real cause was a synthesized
    //        tap that never reached the button.
    //      - the app is still doing its own work with a menu on screen. Step 0's
    //        heartbeat is read again below, while the menu is open, and it moves: so
    //        the unmount that follows is the app taking its own view away, not a
    //        presentational technicality letting something through. (An earlier draft
    //        of this step asserted the opposite - that the app is frozen behind a menu
    //        - from a reading that was insensitive; the assertion now below is what
    //        showed that up.)
    let windowsWhileMounted = app.windows.count
    for cycle in 1...3 {
      if cycle > 1 {
        try required(Echo.dropRemount, as: "the button that brings the drop Picker back").centre.tap()
      }
      try tapUntilEcho(
        Echo.dropArm,
        showing: Echo.dropArmed,
        as: "the button that arms the unmount",
        waitingFor: "cycle \(cycle): the unmount to be armed"
      )
      try required("real-input-drop-picker", as: "the drop Picker").centre.tap()
      _ = try waitForOption("Beta", "cycle \(cycle): the drop Picker's menu to open")
      let beatWhileOpen = tickerBeat()
      print(
        "real-input (ios): cycle \(cycle): with the menu open the screen's heartbeat: \(beatWhileOpen.readings)"
      )
      XCTAssertTrue(
        beatWhileOpen.moved,
        "cycle \(cycle): the app's own 2s ticker should repaint while the menu is open (readings \(beatWhileOpen.readings)) - it moved in step 0 with nothing presented, so if it stands still here then the unmount asserted below is not evidence about this library"
      )
      // The view is taken away with the menu still open: nothing closes it first.
      XCTAssertEqual(
        readUntil(Echo.dropGone, timeout: 10) { $0 == "picker unmounted" },
        "picker unmounted",
        "cycle \(cycle): the unmount armed before the menu opened should land while the menu is up"
      )
      XCTAssertEqual(
        optionLabels(containing: "Beta"),
        0,
        "cycle \(cycle): unmounting the Picker should take its open menu with it"
      )
      XCTAssertEqual(
        app.windows.count,
        windowsWhileMounted,
        "cycle \(cycle): the unmounted Picker should leave no window of its own behind"
      )
    }

    // 8. A disabled Picker refuses a real touch. Its options are 'Cinder'/'Mica'/
    //    'Shale' and it is painted with 'Mica', so 'Cinder' can only be on screen as
    //    an open menu's row - which makes it the witness for "no menu opened". The
    //    words are ones no other row on this screen paints ('One' is not one of
    //    them: the rotating list below shows it 200 times), and the ordinary picker
    //    next to it, tapped the same way, is what turns that into a refusal rather
    //    than a screen that stopped responding.
    XCTAssertEqual(
      optionLabels(containing: "Cinder"),
      0,
      "no menu is open before this, so one option may not be on screen"
    )

    // Both rows have to be reachable before anything here means anything: they
    // render below the fold, and a tap that lands on empty space looks exactly like
    // the refusal this step is looking for.
    try scrollIntoView("disabled-one", as: "the disabled Picker")
    try scrollIntoView("enabled-one", as: "the enabled Picker")

    // SwiftUI's `.disabled(_:)` also marks the control not enabled, which is what
    // lets VoiceOver refuse it too. The reading is taken on the hosted control
    // rather than on the React Native view that hosts it: RN owns the wrapper's
    // accessibility element, and a Hybrid View expresses `disabled` to the
    // platform control rather than also speaking RN's own accessibility props.
    // Android cannot make this claim at all yet (`HybridNitroUiPicker.kt`, and the
    // report). Both readings are quoted so a red run says which element moved.
    let locked = try hostedControl(in: "disabled-one", as: "the disabled Picker")
    let open = try hostedControl(in: "enabled-one", as: "the enabled Picker")
    let lockedWrapper = try required("disabled-one", as: "the disabled Picker")
      .isEnabled
    XCTAssertFalse(
      locked.isEnabled,
      "a disabled Picker should report itself not enabled through accessibility, so VoiceOver refuses it too (hosted control isEnabled=\(locked.isEnabled), React Native wrapper isEnabled=\(lockedWrapper))"
    )
    XCTAssertTrue(
      open.isEnabled,
      "and the ordinary one should not - which is what proves the line above measured a refusal rather than a screen that stopped answering (hosted control isEnabled=\(open.isEnabled))"
    )

    try required("disabled-one", as: "the disabled Picker").centre.tap()
    XCTAssertEqual(
      optionLabels(containing: "Cinder"),
      0,
      "a real tap on a disabled Picker should open nothing"
    )
    try required("enabled-one", as: "the enabled Picker").centre.tap()
    _ = try waitForOption(
      "Cinder",
      "the enabled Picker's menu to open, after the disabled one refused"
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


  /// Scroll until this element sits in the band a tap can land in.
  ///
  /// XCUITest taps an element's frame and does not scroll an ordinary view to reach
  /// it, so a tap on a control below the fold lands on nothing - which is
  /// indistinguishable from a control that refused. Measured here: the disabled and
  /// enabled pair renders at y=773 and y=917 on an 874 pt window, so before this
  /// helper the "a disabled Picker opens nothing" claim was true of a Picker nobody
  /// had touched. The band leaves the header above and the home indicator below
  /// clear, because a menu is presented from the anchor and needs room to open.
  private func scrollIntoView(
    _ identifier: String,
    as what: String,
    maxSwipes: Int = 6
  ) throws {
    let node = try required(identifier, as: what)
    let window = app.windows.firstMatch.frame
    let top = window.minY + 150
    let bottom = window.maxY - 120

    func isReachable() -> Bool {
      let centre = node.frame.midY
      return centre > top && centre < bottom
    }

    var swipes = 0
    while !isReachable() && swipes < maxSwipes {
      app.swipeUp()
      swipes += 1
    }
    XCTAssertTrue(
      isReachable(),
      "\(what) (\(identifier)) could not be brought into the tappable band after \(swipes) swipes (midY=\(node.frame.midY) of \(window.height)); tapping it anyway would read a scroll problem as a refusal"
    )
  }

  /// What this screen's own ticking Picker is painting, as drawn text.
  ///
  /// The screen rotates that Picker's option list every 2 s with a `setInterval`, so
  /// this is a heartbeat the check can watch: while it moves, the app is running its
  /// own work; while it does not, the app is busy with something else.
  ///
  /// Deliberately the drawn `StaticText`s rather than the anchor's accessibility
  /// label: measured, that label reads "Choice, Choice" whatever is selected, so an
  /// "unchanged" reading taken from it would have proved nothing at all. Joining every
  /// drawn string in the anchor keeps the reading sensitive to the title without
  /// betting on which of them SwiftUI puts first.
  private func tickerTitle() -> String {
    let anchor = app.descendants(matching: .any)["ticker-options"].firstMatch
    guard anchor.exists else {
      return "<ticker gone>"
    }
    let texts = anchor.descendants(matching: .staticText)
    let drawn = (0..<texts.count)
      .map { texts.element(boundBy: $0).label }
      .filter { !$0.isEmpty }
    if !drawn.isEmpty {
      return drawn.joined(separator: "|")
    }
    return anchor.label
  }

  /// Watch the ticker for a window and report whether it moved, with what was seen.
  ///
  /// One pair of readings cannot decide anything here. The rotation repeats every
  /// 6 s (three sets, 2 s each), and every reading costs a XCUITest query - about a
  /// second on a loaded machine - so a pair "4 s apart" is really 5-6 s apart, and
  /// once the gap reaches 6 s both readings land on the same set: a screen that is
  /// beating reads as a frozen one. That is what a red step 0 looked like when the
  /// machine was busy with another task's build. Sampling once a second for longer
  /// than a full cycle cannot alias, whatever the phase or the load, and it returns
  /// as soon as the screen visibly moves.
  private func tickerBeat(
    window: TimeInterval = 8
  ) -> (moved: Bool, readings: String) {
    var seen: [String] = []
    let deadline = Date().addingTimeInterval(window)
    while Date() < deadline {
      let reading = tickerTitle()
      if seen.last != reading {
        seen.append(reading)
        if seen.count > 1 {
          break
        }
      }
      Thread.sleep(forTimeInterval: 1)
    }
    return (seen.count > 1, "\"\(seen.joined(separator: "\" then \""))\"")
  }

  /// Tap a button until the echo it is meant to raise appears.
  ///
  /// A synthesized tap can miss, and on a control whose press changes nothing you can
  /// see, the only symptom is that the control looks inert - which a check looking for
  /// a refusal, or for a leak, reads as an answer. So every press this file depends on
  /// for something *later* is confirmed by the echo the screen raises for it, and a
  /// miss costs a retry rather than a wrong conclusion.
  private func tapUntilEcho(
    _ identifier: String,
    showing echo: String,
    as what: String,
    waitingFor: String,
    attempts: Int = 3
  ) throws {
    let node = app.descendants(matching: .any)[echo].firstMatch
    for attempt in 1...attempts {
      try required(identifier, as: what).centre.tap()
      let deadline = Date().addingTimeInterval(3)
      while Date() < deadline {
        if node.exists {
          return
        }
        Thread.sleep(forTimeInterval: 0.2)
      }
      print(
        "real-input (ios): \(waitingFor): tap \(attempt) of \(attempts) on \(identifier) raised no echo; tapping again"
      )
    }
    XCTAssertTrue(
      node.waitForExistence(timeout: 4),
      "\(waitingFor): \(attempts) taps on \(identifier) raised no echo (\(echo)), so the screen is not answering presses at all - which would make every absence asserted after this point meaningless"
    )
  }

  /// The platform control inside a hosted `Picker`'s React Native view.
  ///
  /// React Native owns the view the `testID` lands on, and the hosted control
  /// lives beneath it (the library wraps a SwiftUI `Picker`, which is what knows
  /// about `disabled`). So an accessibility claim about the control has to be read
  /// from the control; the anchor's reading is React Native's answer about its own
  /// view, which says nothing about what nitro-ui passed down.
  private func hostedControl(
    in identifier: String,
    as what: String
  ) throws -> XCUIElement {
    let anchor = try required(identifier, as: what)
    let buttons = anchor.descendants(matching: .button)
    return buttons.firstMatch.exists ? buttons.firstMatch : anchor
  }

  /// A row of a hosted `Picker`'s menu, by the label a screen reader reads.
  ///
  /// The menu is SwiftUI's, not React Native's: it has no `testID`, and which
  /// accessibility subclass a row surfaces as is SwiftUI's business. So the query
  /// crosses element types and matches the row's own text, which is also the only
  /// thing a person has to go on.
  private func optionRow(_ title: String) -> XCUIElement {
    app
      .descendants(matching: .any)
      .matching(NSPredicate(format: "label == %@ OR title == %@", title, title))
      .firstMatch
  }

  /// How many elements on screen carry this text - the reading that separates a
  /// menu that is open from a menu that is gone.
  private func optionLabels(containing title: String) -> Int {
    let rows = app
      .descendants(matching: .any)
      .matching(NSPredicate(format: "label == %@ OR title == %@", title, title))
    return rows.count
  }

  /// Wait for a menu row to appear, and say what was on screen if it never did.
  @discardableResult
  private func waitForOption(
    _ title: String,
    _ description: String,
    timeout: TimeInterval = 8
  ) throws -> XCUIElement {
    let row = optionRow(title)
    if !row.waitForExistence(timeout: timeout) {
      dumpHierarchy("\(description) - looking for a row labelled \"\(title)\"")
      XCTFail(
        "\(description): no menu row labelled \"\(title)\" appeared within \(timeout)s. "
          + "The menu is presented by SwiftUI, so this is where a hosted Picker that "
          + "answers a real touch but cannot present its list shows up."
      )
      throw RealInputCheckAborted(identifier: title)
    }
    return row
  }

  /// Wait until no element carries this text any more.
  private func waitUntilOptionGone(
    _ title: String,
    _ description: String,
    timeout: TimeInterval = 8
  ) {
    let deadline = Date().addingTimeInterval(timeout)
    while optionLabels(containing: title) > 0 && Date() < deadline {
      Thread.sleep(forTimeInterval: 0.25)
    }
    if optionLabels(containing: title) > 0 {
      dumpHierarchy("\(description): something still on screen carries \"\(title)\"")
    }
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

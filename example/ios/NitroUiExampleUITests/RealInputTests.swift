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
    static let datePickerTab = "tab-datepicker"
    static let pickerTab = "tab-picker"
    static let hostTab = "tab-host"
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
    static let pickerIndex = "real-input-picker-index"
    static let pickerEvents = "real-input-picker-events"
    static let dropArm = "real-input-drop-button"
    static let dropRemount = "real-input-drop-remount"
    static let dropGone = "real-input-drop-gone"
    static let dropArmed = "real-input-drop-armed"
    static let hostValue = "host-controlled-value"
    static let hostEvents = "host-events-count"
    static let hostSliderValue = "host-slider-value"
    static let hostButtonPresses = "host-button-presses"
    static let hostMixedState = "host-mixed-state"
    static let hostSegmentedIndex = "host-segmented-index"
    static let hostPickerIndex = "host-picker-index"
    static let hostDateValue = "host-datepicker-value"
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

  /// How long a synthesized press is held, for every tap this suite delivers.
  ///
  /// Measured, not guessed: `docs/tasks/F1/dwell-probe.md` presses the Switch screen
  /// at 0, 0.03, 0.05, 0.08, 0.12 and 0.15 s, twelve times each, calm and loaded, and
  /// reads the control's own native `value:` as the witness. Delivery is 0/12 to 1/12
  /// at zero dwell, 1/12 to 7/12 across 0.03-0.08 s, and 12/12 at 0.12 s and at 0.15 s.
  ///
  /// It stays at 0.15 s rather than dropping to the measured floor of 0.12 s for one
  /// reason: nothing reliable exists below it, so the value is a choice inside a band
  /// the product question decides (a person's quick tap is *inside* the dropped band -
  /// see the report's Questions section), and 0.15 s is the value every green run of
  /// this suite on this branch used. Shortening it is a one-line change the answer to
  /// that question should drive, and the retry counts now printed in the gate log (F1
  /// M2) will say immediately if it was the wrong one.
  fileprivate static let pressDwell: TimeInterval = 0.15

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
    // The dwell probe's no-React-Native arm (F7): when the runner is told which
    // shape to build, the app starts that window instead of React Native. See
    // `NitroUiProbe.swift`.
    if let probeUI = ProcessInfo.processInfo.environment["NUI_PROBE_UI"] {
      app.launchEnvironment["NUI_PROBE_UI"] = probeUI
      if let rows = ProcessInfo.processInfo.environment["NUI_PROBE_ROWS"] {
        app.launchEnvironment["NUI_PROBE_ROWS"] = rows
      }
      app.launch()
      _ = try required(
        "probe-button",
        as: "the native probe's own button",
        timeout: firstRenderTimeout
      )
      return
    }
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

    XCTAssertEqual(
      try tapUntilValue(
        "switch-controlled",
        echo: Echo.switchValue,
        expected: "on",
        as: "the controlled Switch",
        waitingFor: "the first real tap",
        nativeState: { self.nativeSwitchState(of: "switch-controlled") }
      ),
      "on",
      "one real tap should flip the Switch, and React should render \"on\""
    )

    // The second touch has to find the Switch where the app put it. A hosted
    // control that leaves the row when its value changes cannot be tapped
    // again, and that is worth naming instead of losing in a query error -
    // `docs/tasks/T15-real-input.report.md` has the measurements.
    try assertStillInPlace("switch-controlled", startedAt: whereItStarted, after: "the first real tap")

    XCTAssertEqual(
      try tapUntilValue(
        "switch-controlled",
        echo: Echo.switchValue,
        expected: "off",
        as: "the controlled Switch",
        waitingFor: "the second real tap",
        nativeState: { self.nativeSwitchState(of: "switch-controlled") }
      ),
      "off",
      "a second real tap should flip it back, so the check is not one fluke"
    )
  }

  /// Measures how long a synthesised press has to last before the busy Switch screen
  /// delivers it, and prints the table.
  ///
  /// Not a check: nothing here asserts, and the suite's own coverage guard does not
  /// see it, because its name does not start `testRealInput`. It exists because the
  /// dwell `fingerTap` holds was justified by "a person's tap lasts tens of
  /// milliseconds" while the value chosen was 150 ms and the only measurements were
  /// 0 s (dropped) and 0.15 s (delivered). Whether a *human-scale* press is delivered
  /// decides something this suite must not get wrong: if only a 150 ms press arrives,
  /// a quick thumb on a real Switch in a busy list is dropped by the product, and no
  /// test press should hide that.
  ///
  /// Run one dwell per launch, through the environment. Xcode forwards a variable to
  /// the test runner when it is named `TEST_RUNNER_<NAME>` in its own environment, so
  /// the probe reads `NUI_PROBE_DWELL` and is launched with:
  ///
  ///   TEST_RUNNER_NUI_PROBE_DWELL=0.05 TEST_RUNNER_NUI_PROBE_TAPS=12 \
  ///     xcodebuild test-without-building \
  ///       -only-testing:NitroUiExampleUITests/RealInputTests/testMeasureSwitchDwellDelivery ...
  ///
  /// `scripts/real-input/dwell-probe.mjs` does that for a ladder of dwells and writes
  /// the table; `docs/tasks/F1/dwell-probe.md` is the last one it wrote.
  ///
  /// The witness is the control's own native `value:` - not an echo - because the
  /// question is whether the touch reached the recogniser at all. Each dwell is
  /// followed by the `js-toggle` row as a positive control: RN's own `Pressable`
  /// taking the same press says the event path was alive for that launch, which is
  /// what makes a run of drops a fact about the dwell rather than about a stalled app.
  func testMeasureSwitchDwellDelivery() throws {
    let env = ProcessInfo.processInfo.environment
    // No default for the dwell: a probe that silently measures the wrong one is how
    // a table of 0.00 s rows gets reported as a ladder.
    guard let dwellText = env["NUI_PROBE_DWELL"], let dwell = Double(dwellText) else {
      XCTFail(
        "dwell-probe: NUI_PROBE_DWELL is not set to a number, so this run would press "
          + "at some default dwell and print it as though it were the one asked for. "
          + "Launch it as TEST_RUNNER_NUI_PROBE_DWELL=<seconds>."
      )
      return
    }
    let taps = env["NUI_PROBE_TAPS"].flatMap(Int.init) ?? 10
    // Which control, and which screen it lives on. The busy/calm pair is the
    // second half of the question: a dwell that arrives on a screen with a dozen
    // controls and not on one with two hundred says the drop is about how much is
    // mounted, not about the gesture alone - which changes what to do about it.
    let target = env["NUI_PROBE_TARGET"] ?? "switch-uncontrolled"
    let tab = env["NUI_PROBE_TAB"] ?? Tab.switchTab
    let anchor = env["NUI_PROBE_ANCHOR"] ?? Echo.switchValue
    // `native` (the default) reads the control's own `value:`; `echo:<testID>`
    // reads a rendered text, for the controls that publish no value of their own -
    // a Button's press count, a SegmentedControl's event count. Weaker, and named
    // in the RESULT line so no one reads an echo row as a touch-only witness.
    let witness = env["NUI_PROBE_WITNESS"] ?? "native"
    let label = env["NUI_PROBE_LABEL"] ?? ""
    let useEcho = witness.hasPrefix("echo:")
    let echoID = useEcho ? String(witness.dropFirst("echo:".count)) : nil
    // Where across the control to press, cycled one press per entry. A segmented
    // control needs it: pressing the middle twice reports nothing the second time
    // (that is the `Picker` binding's own rule), so only an alternating aim makes
    // every press a fresh selection and the count a usable witness.
    let fractions = (env["NUI_PROBE_FRACTIONS"] ?? "")
      .split(separator: ",")
      .compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
    // The no-React-Native arm (F7): the app launched a probe window instead of a
    // React Native one, so there is no tab to visit and no `js-toggle` to press.
    // The positive control there is the probe's own UIKit button.
    let nativeOnly = env["NUI_PROBE_UI"] != nil
    if nativeOnly {
      print(
        "real-input (ios): dwell-probe: dwell=\(String(format: "%.2f", dwell))s taps=\(taps) target=\(target) ui=\(env["NUI_PROBE_UI"] ?? "?") rows=\(env["NUI_PROBE_ROWS"] ?? "?") label=\(label.isEmpty ? "-" : label)"
      )
      let nativeDelivered = try measureDelivery(
        target: target,
        dwell: dwell,
        taps: taps,
        fractions: fractions,
        reading: { self.nativeSwitchState(of: $0) }
      )
      let positiveDelivered = try measureDelivery(
        target: "probe-button",
        dwell: dwell,
        taps: 3,
        fractions: fractions,
        reading: { element in
          let node = app.descendants(matching: .any)[element].firstMatch
          let shown = (node.value as? String) ?? ""
          return shown.isEmpty ? nil : shown
        }
      )
      print(
        "real-input (ios): dwell-probe: RESULT target=\(target) dwell=\(String(format: "%.2f", dwell))s switch=\(nativeDelivered)/\(taps) js-toggle=\(positiveDelivered)/3"
      )
      return
    }
    try goToTab(tab, showing: anchor)
    // The probe presses a control wherever it is now, and XCUITest taps a frame
    // whether or not the screen can show it — so a control below the fold would be
    // pressed in empty space and read as a lost touch. Same helper the suite's own
    // checks use; it returns without scrolling when the control is already in the
    // band a tap can land in, which is the case for every control at the top.
    try scrollIntoView(target, as: "the control under the probe")
    // The positive control lives on the Switch screen; on another tab, the check
    // that the event path is alive is the screen's own anchor being there at all,
    // which `goToTab` already proved by finding it.
    let toggle = anchor == Echo.switchValue
      ? try required("js-toggle", as: "the RN Pressable that flips the controlled Switch")
      : nil
    // A probe that cannot read its witness has not measured anything, and printing
    // zeros for it would be worse than saying the witness is unreadable.
    if !useEcho, nativeSwitchState(of: target) == nil {
      XCTFail(
        "dwell-probe: \(target) answers no native value, so delivery cannot be read "
          + "from the control. The probe measures the touch, not React's render, and "
          + "an echo would not tell a dropped press from a lost event. Pass "
          + "NUI_PROBE_WITNESS=echo:<testID> to measure a rendered count instead."
      )
      return
    }
    // Which build of the busy screen Metro actually served. The mechanism matrix
    // changes only JS, so a cell whose variant is not the one asked for would
    // otherwise read as a result; this line is what lets it be thrown out.
    let variant = echoText("probe-variant")
    print(
      "real-input (ios): dwell-probe: dwell=\(String(format: "%.2f", dwell))s taps=\(taps) target=\(target) tab=\(tab) witness=\(witness) quiet=\(quiet) label=\(label.isEmpty ? "-" : label) \(variant.isEmpty ? "variant=?" : variant)"
    )

    let delivered = try measureDelivery(
      target: target,
      dwell: dwell,
      taps: taps,
      fractions: fractions,
      reading: { identifier in
        if let echoID {
          let shown = echoText(echoID)
          return shown.isEmpty ? nil : shown
        }
        _ = identifier
        return nativeSwitchState(of: target)
      }
    )

    // Positive control, same launch, same press shape.
    //
    // The default shape presses `js-toggle`, which flips a boolean: three presses,
    // each confirmed by the echo moving. The quiet shape cannot use it — an even
    // number of flips looks like none when the witness is read once at the end — so
    // there the control is `probe-pressable`, whose witness counts, pressed as many
    // times as the target was. If that does not report every press, the launch was
    // not healthy and the target's number says nothing.
    var controlDelivered = 0
    var controlTaps = 3
    if let toggle {
      if quiet {
        controlTaps = taps
        controlDelivered = try measureDelivery(
          target: "probe-pressable",
          dwell: dwell,
          taps: taps,
          fractions: [],
          reading: { _ in
            let shown = echoText("probe-press-events")
            return shown.isEmpty ? nil : shown
          }
        )
      } else {
        for _ in 1...controlTaps {
          let before = echoText(Echo.switchValue)
          toggle.centre.fingerTap(duration: dwell)
          let until = Date().addingTimeInterval(2)
          while Date() < until {
            if echoText(Echo.switchValue) != before {
              controlDelivered += 1
              break
            }
            Thread.sleep(forTimeInterval: 0.05)
          }
          Thread.sleep(forTimeInterval: 0.3)
        }
      }
    }

    print(
      "real-input (ios): dwell-probe: RESULT target=\(target) dwell=\(String(format: "%.2f", dwell))s switch=\(delivered)/\(taps) js-toggle=\(controlDelivered)/\(controlTaps)"
    )
  }

  /// Press one control `taps` times and report how many presses its witness says
  /// arrived. Shared by the dwell probe's two arms (React Native's screen, and the
  /// no-React-Native probe window) so the two are pressed identically and only the
  /// app under the finger differs.
  ///
  /// Set by `NUI_PROBE_QUIET=1` to switch ``measureDelivery`` to the low-
  /// interference shape described by ``measureDeliveryQuietly``.
  private var quiet: Bool {
    ProcessInfo.processInfo.environment["NUI_PROBE_QUIET"] == "1"
  }

  /// - Parameter reading: what the witness says right now, for one control. It is
  ///   passed the identifier so the same closure can serve a control and the
  ///   positive control.
  private func measureDelivery(
    target: String,
    dwell: TimeInterval,
    taps: Int,
    fractions: [Double],
    reading: (String) -> String?
  ) throws -> Int {
    if quiet {
      return try measureDeliveryQuietly(
        target: target,
        dwell: dwell,
        taps: taps,
        fractions: fractions,
        reading: reading
      )
    }
    var delivered = 0
    for index in 1...taps {
      let before = reading(target)
      // Re-aimed each press rather than pressing a coordinate held from the start:
      // the app can lay the row out again while the probe runs, and a stale point
      // would measure the empty space where the Switch used to be.
      let element = try required(target, as: "the control under the probe")
      if let fraction = fractions.isEmpty ? nil : fractions[(index - 1) % fractions.count] {
        element
          .atFraction(CGFloat(fraction))
          .fingerTap(duration: dwell)
      } else {
        element.fingerTap(duration: dwell)
      }
      // "Delivered" is the witness moving. The wait is short on purpose: this
      // measures the touch, not React's round trip, and a long window would credit
      // a press whose value arrived while the next one was already aimed.
      let until = Date().addingTimeInterval(1.5)
      var moved = false
      while Date() < until {
        if reading(target) != before {
          moved = true
          break
        }
        Thread.sleep(forTimeInterval: 0.05)
      }
      if moved {
        delivered += 1
      }
      print(
        "real-input (ios): dwell-probe: tap \(index)/\(taps) \(before ?? "?") -> \(reading(target) ?? "?") delivered=\(moved)"
      )
      // Leave the app settled for the next press: an uncontrolled Toggle keeps its
      // value, so a press that lands while the last one is still being painted would
      // measure the app's queue rather than the gesture's shape.
      Thread.sleep(forTimeInterval: 0.4)
    }
    return delivered
  }

  /// The same presses with the probe's own interference taken out of the run.
  ///
  /// The default loop above consults the witness up to thirty times per press, and
  /// every consultation is an accessibility query that goes into the app under test
  /// and is answered on its main thread. On a screen with two hundred mounted
  /// controls that is a load the probe itself is imposing on the thing it is
  /// measuring, and it is exactly the kind of thing that could turn "the press was
  /// lost" into "the press was lost because I was asking too loudly".
  ///
  /// Here the probe reads the witness twice: once before the first press and once
  /// after the last. A witness that counts (a rendered event count) then reports the
  /// number of delivered presses directly, as a delta, with no polling at all and no
  /// per-pass deadline that a slow-but-real delivery could miss. A witness that only
  /// toggles can still say whether anything arrived, which is the weaker claim, and
  /// is labelled as such by the caller passing a count witness whenever it has one.
  ///
  /// The trade is that this arm cannot say *which* press was lost, and it aims once
  /// rather than re-aiming, so it is only valid while the control does not move.
  private func measureDeliveryQuietly(
    target: String,
    dwell: TimeInterval,
    taps: Int,
    fractions: [Double],
    reading: (String) -> String?
  ) throws -> Int {
    let before = reading(target)
    let element = try required(target, as: "the control under the probe")
    for index in 1...taps {
      if let fraction = fractions.isEmpty ? nil : fractions[(index - 1) % fractions.count] {
        element
          .atFraction(CGFloat(fraction))
          .fingerTap(duration: dwell)
      } else {
        element.fingerTap(duration: dwell)
      }
      print("real-input (ios): dwell-probe: quiet tap \(index)/\(taps) pressed")
      Thread.sleep(forTimeInterval: 0.4)
    }
    // One read, after the last press has had time to be applied and rendered.
    Thread.sleep(forTimeInterval: 1.0)
    let after = reading(target)
    print("real-input (ios): dwell-probe: quiet \(before ?? "?") -> \(after ?? "?")")
    // A counting witness says exactly how many arrived.
    if let start = Int(before ?? ""), let end = Int(after ?? "") {
      return max(0, end - start)
    }
    // Anything else can only answer "did any of them land", and the caller's
    // positive control is what keeps that honest.
    return before == after ? 0 : 1
  }

  /// A real tap must toggle a Switch that sits inside a `<Host>`.
  ///
  /// On iOS a `<Host>` is the documented passthrough `View` while T17 runs, so this is
  /// the regression the passthrough has to keep: the children of a Host are still
  /// React Native's own views, laid out by React Native, and a finger's touch still
  /// reaches them. On Android the same control has no view of its own and answers from
  /// the Host's composition instead (`CHECKS['hosted-switch']`), which is why the check
  /// is written twice rather than skipped - one contract, two mechanisms (D23).
  func testRealInputHostedSwitch() throws {
    try goToTab(Tab.hostTab, showing: Echo.hostValue)
    let control = try required("host-switch-0", as: "the Switch inside the Host")
    let whereItStarted = control.frame
    XCTAssertEqual(
      try read(Echo.hostValue),
      "off",
      "the hosted Switch should start off before any touch is delivered"
    )

    XCTAssertEqual(
      try tapUntilValue(
        "host-switch-0",
        echo: Echo.hostValue,
        expected: "on",
        as: "the Switch inside the Host",
        waitingFor: "the first real tap",
        nativeState: { self.nativeSwitchState(of: "host-switch-0") }
      ),
      "on",
      "one real tap should flip a Switch inside a Host, and React should render \"on\""
    )

    try assertStillInPlace("host-switch-0", startedAt: whereItStarted, after: "the first real tap")

    XCTAssertEqual(
      try tapUntilValue(
        "host-switch-0",
        echo: Echo.hostValue,
        expected: "off",
        as: "the Switch inside the Host",
        waitingFor: "the second real tap",
        nativeState: { self.nativeSwitchState(of: "host-switch-0") }
      ),
      "off",
      "a second real tap should flip it back, so the check is not one fluke"
    )

    // Two taps that each travelled the whole way: the screen counts the changes it
    // accepted, so two taps must read as two changes and not as one lucky render.
    XCTAssertEqual(
      try read(Echo.hostEvents),
      "2",
      "the Host should have reported both changes its child was asked for"
    )
  }

  /// A real tap must press the `Button` inside a Host, and a disabled one beside it
  /// must stay unpressed.
  ///
  /// On iOS a Host is the documented passthrough (D23), so what this presses is the
  /// same SwiftUI Button the unhosted `button` check presses, inside a plain React
  /// Native container. That is a contract and not a skip: the app is promised one tree
  /// to reason about, and this is the case that keeps that promise honest on the
  /// platform that composes nothing. Android checks the other mechanism there — a
  /// Button with no view of its own at all (`CHECKS['hosted-button']`).
  ///
  /// The counter is shared with the disabled Button and both are given `onPress`, so
  /// the refusal means something: a library that let a disabled control answer would
  /// move the number, and a screen that had stopped rendering is caught by the tap
  /// that follows.
  func testRealInputHostedButton() throws {
    try goToTab(Tab.hostTab, showing: Echo.hostValue)
    try scrollIntoView("host-button", as: "the Button inside the Host")
    let control = try required("host-button", as: "the Button inside the Host")
    let disabled = try required("host-button-disabled", as: "the disabled Button inside the Host")
    XCTAssertEqual(
      try read(Echo.hostButtonPresses),
      "0",
      "the hosted Buttons should start with no presses recorded"
    )

    XCTAssertEqual(
      try tapUntilValue(
        "host-button",
        echo: Echo.hostButtonPresses,
        expected: "1",
        as: "the Button inside the Host",
        waitingFor: "the first real tap"
      ),
      "1",
      "one real tap on a Button inside a Host should reach onPress, and React should render 1 (the dump above shows what was on screen instead)"
    )

    disabled.fingerTap()
    XCTAssertEqual(
      readUntil(Echo.hostButtonPresses, timeout: 1.5) { $0 != "1" },
      "1",
      "a real tap on the disabled Button inside the Host should be refused: onPress was passed to it too, so a count that moves proves the touch was not refused"
    )

    XCTAssertEqual(
      try tapUntilValue(
        "host-button",
        echo: Echo.hostButtonPresses,
        expected: "2",
        as: "the Button inside the Host",
        waitingFor: "the second real tap"
      ),
      "2",
      "a second real tap should press the hosted Button again - which is also what proves the line above measured a refusal and not a screen that stopped rendering"
    )
    XCTAssert(control.isHittable, "the hosted Button should still be touchable")
    XCTAssert(disabled.isHittable, "the disabled hosted Button should still be on screen")
  }

  /// A real drag must move the `Slider` inside a Host, and the track it moves along
  /// must be the Host's width rather than the Slider's own box.
  ///
  /// Same reasoning as the Button: on iOS this is the passthrough, so the check is
  /// that the JSX a Host asks for renders and answers there, while Android reads the
  /// same claim out of a shared Compose composition. The width half is the D24
  /// `fillWidth` rule read through the frames React Native ends up with: on both
  /// platforms a hosted child's frame is decorative, and here it happens to agree with
  /// the drawing because a Slider fills whatever it is given.
  func testRealInputHostedSlider() throws {
    try goToTab(Tab.hostTab, showing: Echo.hostValue)
    try scrollIntoView("host-slider", as: "the Slider inside the Host")
    let control = try required("host-slider", as: "the Slider inside the Host")
    let startEcho = try read(Echo.hostSliderValue)
    let before = number(in: startEcho)
    XCTAssertEqual(
      before,
      0.4,
      "the hosted Slider should start where the screen says it does (echo: \(startEcho))"
    )

    // A `fillWidth` control inside a Host has the Host's width, so it should read as a
    // track: much wider than tall, and wider than the switch above it in the same box.
    let frame = control.frame
    XCTAssertGreaterThan(
      frame.width,
      frame.height * 3,
      "a Slider is a track, not a square (hosted frame: \(frame))"
    )

    control.dragFromThumb(atValue: before ?? 0.4, toFraction: 0.9)
    let up = readNumberUntil(Echo.hostSliderValue) { value in
      value != nil && before != nil && value! > before! + 0.2
    }
    XCTAssertTrue(
      up != nil && up! > (before ?? 0) + 0.2,
      "a real drag on a Slider inside a Host should reach React (echo went from \(String(describing: before)) to \(String(describing: up)))"
    )

    control.dragFromThumb(atValue: up ?? 0.9, toFraction: 0.1)
    let back = readNumberUntil(Echo.hostSliderValue) { value in
      value != nil && up != nil && value! < up! - 0.2
    }
    XCTAssertTrue(
      back != nil && back! < (up ?? 0) - 0.2,
      "dragging back should move the hosted Slider the other way (echo went from \(String(describing: up)) to \(String(describing: back)))"
    )
  }

  /// Four kinds of control in one Host, each of which has to stay itself.
  ///
  /// A Host is a container, so the interesting question is not whether one control
  /// answers - the checks above cover that - but whether a batch of different kinds
  /// still behaves as five controls rather than one blob. Three things are read here,
  /// all of them things a person or a screen reader would notice:
  ///
  /// 1. Every child is on screen, reachable, and in the order it was given.
  /// 2. Each keeps its own sizing rule (D24): the linear controls are as wide as each
  ///    other, the indicator is a small square, and none of them was stretched to match
  ///    its neighbour.
  /// 3. Pressing one child moves only what it owns: the Button in this Host moves the
  ///    press count in the echo, and the switch and slider values beside it do not
  ///    move. That is recomposition staying per-child rather than a whole-batch
  ///    redraw, which is what a Host is supposed to preserve.
  ///
  /// Android reads the same three claims out of `uiautomator dump`, where the nodes
  /// are Compose's own (`CHECKS['hosted-mixed']`); here they are the views React Native
  /// lays out, because a Host is a passthrough on iOS.
  func testRealInputHostedMixed() throws {
    try goToTab(Tab.hostTab, showing: Echo.hostValue)
    let ids = [
      "host-mixed-switch",
      "host-mixed-slider",
      "host-mixed-progress-linear",
      "host-mixed-progress-circular",
      "host-mixed-button",
    ]
    try scrollIntoView("host-mixed-button", as: "the last control of the mixed Host")
    XCTAssertEqual(
      try read(Echo.hostMixedState),
      "off 0.50 0",
      "the mixed Host should start with nothing answered"
    )

    var frames: [String: CGRect] = [:]
    for id in ids {
      let element = try required(id, as: "a control of the mixed Host")
      XCTAssert(element.exists, "\(id) should be on screen inside the mixed Host")
      XCTAssert(element.isHittable, "\(id) should be reachable inside the mixed Host")
      frames[id] = element.frame
    }
    let tops = ids.map { frames[$0]!.minY }
    XCTAssertEqual(
      tops,
      tops.sorted(),
      "a Host draws its children in mount order (frames: \(frames))"
    )

    let sliderWidth = frames["host-mixed-slider"]!.width
    let barWidth = frames["host-mixed-progress-linear"]!.width
    let indicator = frames["host-mixed-progress-circular"]!
    let switchWidth = frames["host-mixed-switch"]!.width
    XCTAssertEqual(
      barWidth,
      sliderWidth,
      accuracy: max(2, barWidth * 0.05),
      "both linear controls fill the Host, so they should agree (bar \(barWidth), slider \(sliderWidth))"
    )
    XCTAssertLessThan(
      indicator.width * 3,
      barWidth,
      "a circular indicator keeps its own width instead of stretching to the Host (\(indicator.width) against \(barWidth))"
    )
    XCTAssertEqual(
      indicator.width,
      indicator.height,
      accuracy: 2,
      "a circular indicator is drawn as a square (\(indicator))"
    )
    XCTAssertLessThan(
      switchWidth * 3,
      barWidth,
      "a Switch keeps its own width inside a Host too (\(switchWidth) against \(barWidth))"
    )

    XCTAssertEqual(
      try tapUntilValue(
        "host-mixed-button",
        echo: Echo.hostMixedState,
        expected: "off 0.50 1",
        as: "the Button of the mixed Host",
        waitingFor: "the real tap on the mixed Host's Button"
      ),
      "off 0.50 1",
      "the Button in a mixed Host should press, and nothing else in the echo should move (the dump above shows what was on screen instead)"
    )

    XCTAssertEqual(
      try tapUntilValue(
        "host-mixed-switch",
        echo: Echo.hostMixedState,
        expected: "on 0.50 1",
        as: "the Switch of the mixed Host",
        waitingFor: "the real tap on the mixed Host's Switch"
      ),
      "on 0.50 1",
      "the Switch in the same Host should answer too, with the press count left where the Button put it"
    )
  }

  /// A real tap must open the `DatePicker` inside a Host's presentation, and a real tap
  /// on a day inside it must reach JS as a new instant.
  ///
  /// The Android case for this control is where the substance lives: a Compose dialog is
  /// a window of the Host's own composition, and its OK, Cancel and Back presses cannot be
  /// reached from the harness. On iOS a `<Host>` is the documented passthrough (D23), so
  /// there is no separate window to inherit and this is the regression the passthrough has
  /// to keep — the same JSX presenting the same calendar whether or not a `<Host>` is
  /// wrapped around it, and the same two hops working: the field's button, then a day cell
  /// inside the presentation, all the way back to React's controlled value.
  ///
  /// The day is chosen by the helper rather than named, for the reason `testRealInputDatePicker`
  /// gives: picking the day the field already shows reports nothing by design.
  func testRealInputHostedDatePicker() throws {
    try goToTab(Tab.hostTab, showing: Echo.hostValue)
    try scrollIntoView("host-datepicker", as: "the DatePicker inside the Host")
    let field = try required("host-datepicker", as: "the DatePicker inside the Host")
    let seeded = try read(Echo.hostDateValue)
    XCTAssertEqual(
      seeded,
      "2026-05-17",
      "the hosted DatePicker should show the day JS gave it"
    )

    try tapUntilPresentation(
      "host-datepicker",
      as: "the DatePicker inside the Host",
      waitingFor: "the real tap on the hosted field"
    )
    let opened = try openPresentation(from: field, watching: Echo.hostDateValue)
    try pickSomeDay(in: opened, from: field, watching: Echo.hostDateValue) { $0 != seeded }

    let moved = try read(Echo.hostDateValue)
    XCTAssertNotEqual(
      moved,
      seeded,
      "a real pick inside the presentation should reach JS through the Host"
    )
    XCTAssertEqual(
      moved.split(separator: "-").count,
      3,
      "\(Echo.hostDateValue) should render the day React holds as Y-M-D, got \"\(moved)\""
    )
  }

  /// A real drag must move the thumb and report every phase.
  ///
  /// The phases Slider is uncontrolled and counts each callback separately, so a
  /// missing `onSlidingStart` cannot hide behind an `onValueChange` that still
  /// worked. The controlled Slider is dragged too: there the echo is React's own
  /// state, so it proves the whole loop - touch → SwiftUI → Nitro → JS →
  /// re-render → value back down to native - with nothing but a finger in it.
  /// A real tap must select a segment of the `SegmentedControl` inside a Host.
  ///
  /// H2b's three popup-era controls are the first a Host has ever held that are not
  /// `fillWidth`. On iOS a Host is the documented passthrough (D23), so this is the
  /// same claim the `segmented` check makes one tab away - which is the point: the JSX
  /// a Host asks for has to render and answer there too, or the passthrough is a story.
  /// Android reads the identical claim out of a shared Compose composition.
  ///
  /// The echo is React's own render (`HostScreen`'s `popSegmented`), so it moves only if
  /// the touch reached the control and JS accepted the new index. A second, different
  /// segment is owed: a control that echoed once and froze would satisfy the first line.
  func testRealInputHostedSegmented() throws {
    try goToTab(Tab.hostTab, showing: Echo.hostValue)
    try scrollIntoView("host-segmented", as: "the SegmentedControl inside the Host")
    let control = try required("host-segmented", as: "the SegmentedControl inside the Host")
    let whereItStarted = control.frame
    XCTAssertEqual(
      try read(Echo.hostSegmentedIndex),
      "0",
      "the hosted SegmentedControl should show the index JS gave it"
    )

    XCTAssertEqual(
      try tapUntilValue(
        "host-segmented",
        echo: Echo.hostSegmentedIndex,
        expected: "1",
        as: "the SegmentedControl inside the Host",
        waitingFor: "the real tap on the middle segment",
        atFractionX: 0.5
      ),
      "1",
      "a real tap on the middle segment of a SegmentedControl inside a Host should reach JS as index 1"
    )

    try assertStillInPlace("host-segmented", startedAt: whereItStarted, after: "the first real tap")

    XCTAssertEqual(
      try tapUntilValue(
        "host-segmented",
        echo: Echo.hostSegmentedIndex,
        expected: "2",
        as: "the SegmentedControl inside the Host",
        waitingFor: "the real tap on the last segment",
        atFractionX: 0.9
      ),
      "2",
      "a real tap on the last segment of the hosted SegmentedControl should reach JS as index 2"
    )
  }

  /// A real tap must open the `Picker` inside a Host, and a real tap on one of its rows
  /// must reach JS.
  ///
  /// On Android this is the claim H2b exists to make (a Compose popup is a window of the
  /// Host's own composition, opening under the row the Host drew). On iOS a Host is a
  /// passthrough, so the menu is the one `testRealInputPicker` drives on its own tab -
  /// and it has to be that here too: a `Picker` that loses its menu when the same JSX is
  /// wrapped in a `<Host>` would be a passthrough that does not pass through.
  ///
  /// The three choices are `HostScreen`'s popup set. None of them appears anywhere else
  /// on the screen, which is what lets a label match name a menu row.
  func testRealInputHostedPicker() throws {
    try goToTab(Tab.hostTab, showing: Echo.hostValue)
    try scrollIntoView("host-picker", as: "the Picker inside the Host")
    XCTAssertEqual(
      try read(Echo.hostPickerIndex),
      "1",
      "the hosted Picker should show the index JS gave it"
    )

    // 1. Opening. The rows exist only while the menu is open, which is also the witness
    //    that the hosted anchor answered a real touch - so the press is repeated until
    //    one is up, and "the anchor is deaf" stops being the first explanation offered
    //    for a touch the simulator never delivered.
    try tapUntilOption(
      "host-picker",
      as: "the Picker inside the Host",
      option: "Gamma",
      waitingFor: "the real tap on the hosted anchor"
    )
    _ = try waitForOption("Gamma", "the hosted Picker's menu to open")
    XCTAssertEqual(
      try read(Echo.hostPickerIndex),
      "1",
      "opening a menu is not a choice - nothing may be reported until a row is tapped"
    )

    // 2. The menu says which row it is showing: the mark is SwiftUI's own, so this is
    //    what VoiceOver reads.
    XCTAssertTrue(
      optionRow("Beta").images.count > 0,
      "the current choice (\"Beta\") should carry the hosted menu's selection mark"
    )

    // 3. Choosing something else.
    XCTAssertEqual(
      try tapOptionUntilValue(
        option: "Gamma",
        echo: Echo.hostPickerIndex,
        expected: "2",
        waitingFor: "the real tap on a hosted menu row"
      ),
      "2",
      "a real tap on a hosted menu row should reach JS as index 2"
    )
    // The rows that are *not* the new choice can only exist while the menu is open. The
    // chosen title stays after the pick, as the anchor's own text: measured, exactly one
    // "Gamma" survives, and it is the anchor. Asking a closed menu for the title it is
    // showing would read every closed menu as an open one.
    waitUntilOptionGone("Beta", "the hosted menu closing")
    XCTAssertEqual(
      optionLabels(containing: "Beta"),
      0,
      "the rows that are not the new choice should be gone once the pick closes the menu"
    )
    XCTAssertEqual(
      optionLabels(containing: "Gamma"),
      1,
      "the hosted anchor should show the choice that was just made"
    )

    // 4. The way out that changes nothing: the row already chosen, which since the pick
    //    above is Gamma rather than the row the menu first opened on. The menu closes
    //    and no change is reported - the binding's own rule (G6), read here through a
    //    Host. The witness that the menu reopened is a different row from the one being
    //    tapped: while it is open both exist, and only one of them survives closing.
    try tapUntilOption(
      "host-picker",
      as: "the Picker inside the Host",
      option: "Beta",
      waitingFor: "the real tap that reopens the hosted menu"
    )
    _ = try waitForOption("Beta", "the hosted menu to reopen")
    // The row tap here stays blind on purpose: its correct outcome is that *nothing*
    // is reported, so there is no witness to wait for and a retry would press a
    // closing menu a second time. What the helper above guarantees is only that the
    // menu this tap lands in was really opened by a touch.
    try waitForOption("Gamma", "the reopened hosted menu to list its current choice").fingerTap()
    _ = waitUntilOptionGone("Beta", "the hosted menu to close")
    XCTAssertEqual(
      try read(Echo.hostPickerIndex),
      "2",
      "choosing the row that was already chosen should report nothing, and the hosted anchor "
        + "should still show what it started with"
    )
  }

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

    XCTAssertEqual(
      try tapUntilValue(
        "real-input-enabled",
        echo: Echo.buttonCount,
        expected: "1",
        as: "the enabled Button",
        waitingFor: "the first real tap"
      ),
      "1",
      "one real tap on the enabled Button should reach onPress and React should render 1 - the hierarchy dump above shows what was on screen instead"
    )

    disabled.fingerTap()
    XCTAssertEqual(
      readUntil(Echo.buttonCount, timeout: 1.5) { $0 != "1" },
      "1",
      "a real tap on the disabled Button should be refused: onPress was passed to it too, so a count that moves proves the touch was not refused"
    )

    XCTAssertEqual(
      try tapUntilValue(
        "real-input-enabled",
        echo: Echo.buttonCount,
        expected: "2",
        as: "the enabled Button",
        waitingFor: "the second real tap"
      ),
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
    XCTAssertEqual(
      try tapUntilValue(
        "real-input-segmented",
        echo: Echo.segmentedIndex,
        expected: "1",
        as: "the uncontrolled SegmentedControl",
        waitingFor: "the real tap on the second segment",
        atFractionX: 0.5
      ),
      "1",
      "a real tap on the second segment should reach JS as index 1"
    )
    XCTAssertEqual(try read(Echo.segmentedEvents), "1", "one tap should report one change")

    try assertStillInPlace("real-input-segmented", startedAt: whereItStarted, after: "the first real tap")

    // A different segment, so a second change is owed: a control that reported the
    // same index twice would also satisfy the line above by echoing once.
    XCTAssertEqual(
      try tapUntilValue(
        "real-input-segmented",
        echo: Echo.segmentedIndex,
        expected: "0",
        as: "the uncontrolled SegmentedControl",
        waitingFor: "the real tap on the first segment",
        atFractionX: 0.12
      ),
      "0",
      "a real tap on the first segment should reach JS as index 0"
    )
    XCTAssertEqual(try read(Echo.segmentedEvents), "2", "two taps should report two changes")

    // The refusing parent.
    XCTAssertEqual(
      try read(Echo.rejectValue),
      "0",
      "the refusing parent pins its SegmentedControl at index 0"
    )
    XCTAssertEqual(try read(Echo.rejectEvents), "0", "no change should be reported before a touch")

    XCTAssertEqual(
      try tapUntilValue(
        "real-input-segmented-reject",
        echo: Echo.rejectEvents,
        expected: "1",
        as: "the controlled SegmentedControl",
        waitingFor: "the real tap on the controlled control's second segment",
        atFractionX: 0.5
      ),
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
    XCTAssertEqual(
      try tapUntilValue(
        "real-input-segmented-reject",
        echo: Echo.rejectEvents,
        expected: "2",
        as: "the controlled SegmentedControl",
        waitingFor: "the second real tap on segment 2",
        atFractionX: 0.5
      ),
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
    //    witness that the anchor answered a touch at all - so the press is repeated
    //    until a row is up rather than asserted once and read as a deaf Picker.
    try tapUntilOption(
      "real-input-picker",
      as: "the uncontrolled Picker",
      option: Choice.longest,
      waitingFor: "the real tap on the anchor"
    )
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
    //
    //    The witness for *this* press is the menu going away, and it is a safe one to
    //    retry: choosing the row that is already chosen reports nothing however often
    //    it happens, so an attempt that follows a dropped tap cannot move the echo the
    //    assertion below reads.
    try pressUntil(
      named: "menu row \"\(Choice.first)\"",
      waitingFor: "the real tap on the row that was already chosen",
      press: { attempt in
        // The first attempt insists the row is there, as this check always has. A
        // later one does not: a row can legitimately have gone because the earlier
        // tap *did* travel and the echo is merely slow, and pressing a menu that is
        // on its way out would double-count a choice. Nothing to press, so just keep
        // waiting for the value.
        if attempt > 1 && !optionRow(Choice.first).exists {
          return
        }
        try waitForOption(Choice.first, "the menu's first row to be tappable").fingerTap()
      },
      reading: { "\(optionLabels(containing: Choice.longest)) row(s) named \"\(Choice.longest)\"" }
    ) { shown in
      shown.hasPrefix("0 ")
    }
    XCTAssertEqual(optionLabels(containing: Choice.longest), 0, "the menu should be closed")
    XCTAssertEqual(
      try read(Echo.pickerEvents),
      "0",
      "choosing the row that was already chosen reports nothing, and the anchor still shows what it started with"
    )

    // 4. Choosing something else.
    try tapUntilOption(
      "real-input-picker",
      as: "the uncontrolled Picker",
      option: Choice.longest,
      waitingFor: "the real tap that reopens the menu"
    )
    XCTAssertEqual(
      try tapOptionUntilValue(
        option: Choice.longest,
        echo: Echo.pickerIndex,
        expected: "2",
        waitingFor: "the real tap on the third row"
      ),
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
    XCTAssertEqual(
      try read(Echo.rejectValue),
      "0",
      "the refusing parent pins its Picker at index 0"
    )
    try tapUntilOption(
      "real-input-picker-reject",
      as: "the controlled Picker",
      option: "Ridge",
      waitingFor: "the real tap on the controlled Picker"
    )
    XCTAssertEqual(
      try tapOptionUntilValue(
        option: "Ridge",
        echo: Echo.rejectEvents,
        expected: "1",
        waitingFor: "the real tap on the controlled Picker's menu row"
      ),
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
    try required("real-input-picker-reject", as: "the controlled Picker").fingerTap()
    try waitForOption("Ridge", "the refusing Picker's menu to reopen").fingerTap()
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
        // Same lesson as the press below it, on the button that brings the row back:
        // an un-witnessed remount that never happened would make the armed press that
        // follows read as a dead screen. The arm button is the witness - it is
        // rendered in the same branch as the Picker, so seeing it says the row, and
        // with it the Picker, is mounted again.
        try pressUntil(
          named: "\"\(Echo.dropRemount)\"",
          waitingFor: "cycle \(cycle): the drop Picker to be mounted again",
          press: { _ in
            try required(
              Echo.dropRemount,
              as: "the button that brings the drop Picker back"
            ).fingerTap()
          },
          reading: {
            app.descendants(matching: .any)[Echo.dropArm].firstMatch.exists
              ? "the arm button is up"
              : "nothing"
          }
        ) { shown in
          shown == "the arm button is up"
        }
      }
      try tapUntilEcho(
        Echo.dropArm,
        showing: Echo.dropArmed,
        as: "the button that arms the unmount",
        waitingFor: "cycle \(cycle): the unmount to be armed"
      )
      try tapUntilOption(
        "real-input-drop-picker",
        as: "the drop Picker",
        option: "Beta",
        waitingFor: "cycle \(cycle): the real tap on the drop Picker"
      )
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

    try required("disabled-one", as: "the disabled Picker").fingerTap()
    XCTAssertEqual(
      optionLabels(containing: "Cinder"),
      0,
      "a real tap on a disabled Picker should open nothing"
    )
    // Retried, because this line is the second half of the claim above it: the
    // enabled Picker opening is what turns "nothing appeared" into a *refusal*
    // rather than a screen that answers nothing. A dropped tap here would otherwise
    // fail as "the enabled Picker cannot present its list".
    try tapUntilOption(
      "enabled-one",
      as: "the enabled Picker",
      option: "Cinder",
      waitingFor: "the real tap on the enabled Picker"
    )
    _ = try waitForOption(
      "Cinder",
      "the enabled Picker's menu to open, after the disabled one refused"
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

    try tapUntilPresentation(
      "real-input-date",
      as: "the uncontrolled DatePicker field",
      waitingFor: "the real tap on the field"
    )
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
    try tapUntilPresentation(
      "real-input-date-reject",
      as: "the controlled DatePicker field",
      waitingFor: "the real tap on the controlled field"
    )
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
      control.fingerTap()
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
    app
      .coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.95))
      .fingerTap()
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
    // somewhere else on the screen points at nothing. Which side it lands on is UIKit's
    // choice and not the library's — the bubble goes where the screen has room, so a field
    // near the bottom of a scroll gets its calendar above it. Asserting the side below was
    // therefore wrong, and it went red that way on the leased iPhone 17: "the popover
    // opened at y 213.67 while the field ends at 587.00", a bubble presented above the
    // control that opened it. Adjacency to one of the field's two edges is the property,
    // then, not the side. The band is a tolerance, not a measurement: `-8` of overlap is
    // the arrow's own height, which the accessibility frame may or may not include, and 32
    // is slack over that. What it must catch is an anchor resolved elsewhere — an anchor
    // 220 pt off its field is 220 pt clear of both halves, so it fails by the arithmetic.
    // That displacement was never built, so read it as arithmetic rather than a red proof;
    // what was measured is this gate red at the wrong geometry and green at this one.
    let gapBelow = popover.frame.minY - fieldFrame.maxY
    let gapAbove = fieldFrame.minY - popover.frame.maxY
    XCTAssert(
      (gapBelow >= -8 && gapBelow <= 32) || (gapAbove >= -8 && gapAbove <= 32),
      "the popover opened at \(popover.frame) against a field at \(fieldFrame): "
        + "\(gapBelow)pt clear of its bottom edge and \(gapAbove)pt clear of its top "
        + "edge, so it is not anchored to the control that presented it"
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
      day.fingerTap()
      if isMoved(readUntil(echo, timeout: 3, isMoved)) {
        // The pick worked, and the presentation is still open: it covers the field
        // the next pair of assertions has to press. The field is a point outside the
        // bubble that belongs to no reachable control, so a tap there can only be the
        // platform's own "tap outside" affordance - and waiting for the bubble to go
        // is what makes those assertions mean something. Closing it is the library's
        // job too: UIKit dismisses without asking, and the model's `presented` flag
        // has to follow or it lies to every test that reads it afterwards.
        field.fingerTap()
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
    try required(identifier, as: "the example's tab").fingerTap()
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

  /// Press something, then wait for the witness that the press *arrived*, and retry
  /// the press until the witness shows or the attempts run out.
  ///
  /// Every check in this file used to be `tap(); XCTAssert(readUntil(...))`: it
  /// waited for the answer and nothing waited for the question. A synthesised touch
  /// can be dropped by the OS at any load (`FOLLOWUPS.md:58`; X6 saw it in two of
  /// four full runs), and this machine reproduces it - on 2026-10-28 `testRealInputSwitch`
  /// failed 11/11 runs, one on tap 1 and one on tap 2, with the hierarchy dump
  /// showing the SwiftUI `Switch`'s own `value:` unmoved. Nothing reached the binding
  /// to be painted optimistically, so the missing thing is the delivery, not an
  /// answer. The suite already knew: `tapUntilEcho` retries the press that arms the
  /// leak case "because pressing blind once cost a red run whose only symptom was a
  /// Picker that survived", and that check has not flaked since. This is that lesson
  /// applied everywhere else, with the witness as a closure because it is not always
  /// an element that appears: for a Switch it is a rendered *value*, for a
  /// `compact` field it is a popover, for a menu anchor it is a row.
  ///
  /// Retrying cannot manufacture a result: an attempt happens only while the witness
  /// is still absent, and each witness below is unreachable without a delivered
  /// touch. What a retry does cost is that an echo which arrives *late* rather than
  /// never can be overtapped - a real but far rarer fault (the drop is measured, the
  /// late echo is not, and each attempt first waits the whole `reactTimeout`, eight
  /// seconds). It shows up as the failure text quoting a reading that moved past what
  /// was expected, which is a different sentence from the one a drop produces, and the
  /// native-state check above is what catches the version where the control moved and
  /// the echo did not.
  ///
  /// When every attempt fails, the message names both readings and says which of the
  /// two faults it is: taps that were never delivered, or a control that ignores a
  /// real touch - the distinction a blind tap could not make, and the reason this is
  /// not simply a road to green.
  ///
  /// - Parameter press: delivers the touch, re-finding its target each attempt: a
  ///   control that moved (a Picker whose title grew) must be aimed at where it is now.
  ///   It is told which attempt this is, so a press that can only be made while
  ///   something is on screen (an open menu's row) can insist on it the first time and
  ///   treat it as gone - nothing to press, just keep waiting - after that.
  /// - Parameter reading: what the witness currently says, for the log line and the
  ///   failure. Keep it cheap and non-fatal - `read(_:)` XCTFails on a missing id.
  /// - Parameter nativeState: what the *control itself* says it holds, read the same
  ///   way `switch-uncontrolled`'s native `value:` was read to diagnose the drop. The
  ///   witness is React's render, so it can be absent for two different reasons, and
  ///   an attempt's window expiring cannot tell them apart on its own: the touch never
  ///   arrived, or the control changed and lost the event on its way to JS. Retrying
  ///   is right for the first and wrong for the second - a third press would land the
  ///   event, the echo would arrive, and the check would go green reporting a drop
  ///   that never happened (F1 M3). When this is given and it has moved while the
  ///   witness has not, the helper stops and says "delivered, but the change never
  ///   reached JS". Pass it wherever the control publishes its own state.
  /// - Parameter raised: whether the witness has arrived.
  /// - Parameter attemptWindow: how long one press gets to show its witness. The
  ///   default is `reactTimeout` - the same budget the blind `readUntil` it replaces
  ///   already gave a control - so a check gets that wait *plus* the retries rather
  ///   than three attempts sharing what was one wait. A control that answers in six
  ///   seconds on a loaded machine was never broken, and this helper must not be the
  ///   reason it starts failing.
  @discardableResult
  private func pressUntil(
    named what: String,
    waitingFor: String,
    attempts: Int = 3,
    attemptWindow: TimeInterval? = nil,
    press: (_ attempt: Int) throws -> Void,
    reading: () -> String,
    nativeState: (() -> String?)? = nil,
    _ raised: (String) -> Bool
  ) throws -> String {
    let window = attemptWindow ?? reactTimeout
    var shown = ""
    let startedAt = nativeState?()
    let echoStart = reading()
    if nativeState != nil && startedAt == nil {
      // A witness that reads nothing can never report a change, so passing it would
      // be worse than passing nothing: every retry would be blamed on a dropped
      // touch, and a lost event would still go green. Say the guard is not armed
      // rather than pretending it is.
      XCTFail(
        "\(waitingFor): \(what) was given a native-state witness and it read nothing, "
          + "so a delivered touch could not be told from a lost event. The control "
          + "publishes no value to read, or its testID does not wrap one."
      )
      throw RealInputCheckAborted(identifier: what)
    }
    for attempt in 1...attempts {
      try press(attempt)
      let until = Date().addingTimeInterval(window)
      while Date() < until {
        shown = reading()
        if raised(shown) {
          if attempt > 1 {
            print(
              "real-input (ios): \(waitingFor): \(what) answered on tap \(attempt)/\(attempts) - the earlier tap(s) were never delivered"
            )
          }
          return shown
        }
        Thread.sleep(forTimeInterval: 0.2)
      }
      // Not answered. Before pressing again, ask the control whether it moved:
      // a control that changed state while its echo sat still has the touch, and
      // has lost the event. Pressing a third time would hide that.
      //
      // Only when the echo has not moved *at all*: an echo that moved to the
      // wrong value proves JS heard something, and saying "the event never
      // reached JS" about it would be a false accusation.
      if let nativeState,
        let moved = nativeState(),
        let startedAt,
        moved != startedAt,
        shown == echoStart
      {
        // Not a retry: no press. "The event never reached JS" is only safe once the
        // echo has had a second window to arrive, because a JS thread that is merely
        // very slow - a cold bundle on a busy machine - looks exactly like a lost
        // event from here. A dropped event still fails, one window later.
        let graceUntil = Date().addingTimeInterval(window)
        while Date() < graceUntil {
          shown = reading()
          if raised(shown) {
            print(
              "real-input (ios): \(waitingFor): \(what) answered \(Int(window))s after its press, late enough that the control had already changed - a slow JS thread, not a lost event"
            )
            return shown
          }
          Thread.sleep(forTimeInterval: 0.2)
        }
        dumpHierarchy("\(waitingFor): \(what) changed natively but its echo did not")
        XCTFail(
          "\(waitingFor): \(what) took the touch and lost the event - the control's own "
            + "state moved from \"\(startedAt)\" to \"\(moved)\" and its echo is still "
            + "\"\(shown)\", the value it had before any press, \(Int(window * 2))s "
            + "later. Not retried: a further press would land the event and make a lost "
            + "change look like a dropped tap."
        )
        throw RealInputCheckAborted(identifier: what)
      }
      print(
        "real-input (ios): \(waitingFor): tap \(attempt)/\(attempts) left \(what) at \"\(shown)\""
      )
    }
    dumpHierarchy("\(attempts) presses on \(what) raised no witness")
    XCTFail(
      "\(waitingFor): \(attempts) real presses on \(what) left it at \"\(shown)\". Its "
        + "own state never moved either, so on the evidence here the touch was never "
        + "delivered (FOLLOWUPS.md:58) - though a control that flips back before this "
        + "helper next looks would read the same way, and the dump is what tells them "
        + "apart. One delivered touch was enough to pass, so this is not a control that "
        + "answers sometimes."
    )
    throw RealInputCheckAborted(identifier: what)
  }

  /// The text an echo carries right now, without failing when it is not there.
  private func echoText(_ identifier: String) -> String {
    let node = app.descendants(matching: .any)[identifier].firstMatch
    guard node.exists else {
      return ""
    }
    return node.label.isEmpty ? ((node.value as? String) ?? "") : node.label
  }

  /// Tap a control until the on-screen *value* it is meant to change says so.
  ///
  /// The value rather than the echo's *existence*, which is what `tapUntilEcho`
  /// waits for and is not enough here: `switch-controlled-value` is on screen from
  /// the first render, so existence alone passes untouched. Keying on the value also
  /// means each flip is unreachable without a delivered touch.
  ///
  /// - Parameter atFractionX: how far across the control to press, for the controls
  ///   where the middle is not the segment under test (see `atFraction(_:)`).
  /// - Parameter nativeState: the control's own answer, for the controls that publish
  ///   one - `nativeSwitchState(of:)` for a Switch. See `pressUntil`: this is what
  ///   tells a dropped touch apart from a lost event, before a retry can confuse them.
  private func tapUntilValue(
    _ identifier: String,
    echo: String,
    expected: String,
    as what: String,
    waitingFor: String,
    atFractionX: CGFloat? = nil,
    nativeState: (() -> String?)? = nil,
    attempts: Int = 3
  ) throws -> String {
    return try pressUntil(
      named: "\(what) (\(identifier))",
      waitingFor: waitingFor,
      attempts: attempts,
      press: { _ in
        let control = try required(identifier, as: what)
        if let atFractionX {
          control.atFraction(atFractionX).fingerTap()
        } else {
          control.fingerTap()
        }
      },
      reading: { self.echoText(echo) },
      nativeState: nativeState
    ) { shown in
      shown == expected
    }
  }

  /// A Switch's own state, as iOS answers it: the toggle's `value`, not the echo.
  ///
  /// This is the read that settled the drop question - the one that said
  /// `switch-uncontrolled` was still `0` while nothing on screen had moved - and it is
  /// what makes M3 checkable: a control whose `value` has flipped while its echo sits
  /// still has the touch and has lost the change event.
  ///
  /// The `testID` is on the React Native component view, which answers with no value
  /// of its own; the SwiftUI `Toggle` that holds the state sits *inside* it, so this
  /// asks the inner element first and falls back to the container. Measured here: the
  /// container's `value` is the empty string on every control in this suite, so
  /// reading only the container would read "nothing moved" forever, and a witness that
  /// can never move is worse than no witness - it turns every retry into a claim that
  /// nothing arrived.
  ///
  /// Returns nil when nothing answers with a value, and only ever "on"/"off" when
  /// something does: a witness consulted between attempts must not be the thing that
  /// fails a run, and it must not report a shape the comparison cannot use.
  private func nativeSwitchState(of identifier: String) -> String? {
    let container = app.descendants(matching: .any)[identifier].firstMatch
    guard container.exists else {
      return nil
    }
    for candidate in [
      container.descendants(matching: .`switch`).firstMatch, container,
    ] {
      guard candidate.exists, let raw = candidate.value else {
        continue
      }
      let text = (raw as? NSNumber)?.stringValue
        ?? (raw as? String)
        ?? String(describing: raw)
      switch text {
      case "0", "0.0", "false", "FALSE":
        return "off"
      case "1", "1.0", "true", "TRUE":
        return "on"
      default:
        continue
      }
    }
    return nil
  }

  /// Tap a `compact` field until it presents something.
  ///
  /// Same fault, different witness: a DatePicker's first hop is a *window*, so what
  /// proves the touch arrived is the popover itself and no echo can be read while it
  /// is up. `openPresentation(from:watching:)` cannot tell a dropped tap from a field
  /// that cannot present; this can, and it is the retry the last-row check has used
  /// all along for the same reason (its own comment: a press released while the list
  /// is settling can be eaten by the control's own recogniser).
  private func tapUntilPresentation(
    _ identifier: String,
    as what: String,
    waitingFor: String,
    attempts: Int = 3
  ) throws {
    let popovers = app.descendants(matching: .popover)
    try pressUntil(
      named: "\(what) (\(identifier))",
      waitingFor: waitingFor,
      attempts: attempts,
      press: { _ in try required(identifier, as: what).fingerTap() },
      reading: { String(describing: popovers.count) }
    ) { shown in
      shown != "0"
    }
  }

  /// Tap a menu anchor until one of its rows - named here, so it cannot be some
  /// other text on screen - is up.
  ///
  /// A row is the only witness a menu has while it is open (the rows exist because of
  /// the press), and without this a dropped tap on the anchor reads as the
  /// `waitForOption` failure "no menu row labelled X appeared", i.e. as a Picker that
  /// answers a touch but cannot present its list.
  private func tapUntilOption(
    _ identifier: String,
    as what: String,
    option title: String,
    waitingFor: String,
    attempts: Int = 3
  ) throws {
    try pressUntil(
      named: "\(what) (\(identifier))",
      waitingFor: waitingFor,
      attempts: attempts,
      press: { _ in try required(identifier, as: what).fingerTap() },
      reading: { "\(optionLabels(containing: title)) row(s) named \"\(title)\"" }
    ) { shown in
      !shown.hasPrefix("0 ")
    }
  }

  /// Tap an open menu's row until the *value* it should report arrives.
  ///
  /// The row is re-found each attempt, which is exactly when it can still be found:
  /// a pick that travelled closes the menu and moves the value, so the loop has
  /// already returned, and a pick that never arrived leaves the menu open with that
  /// row still on screen. Keying on the value rather than on the menu leaving the
  /// tree is what keeps a tap that opened nothing from reading as a choice.
  ///
  /// A later attempt presses only while the row is still up. If it has gone, the
  /// earlier tap travelled and the echo is merely slow, and pressing where the menu
  /// was would aim at whatever the closed menu left behind - so that attempt waits
  /// out its window instead.
  private func tapOptionUntilValue(
    option title: String,
    echo: String,
    expected: String,
    waitingFor: String,
    attempts: Int = 3
  ) throws -> String {
    return try pressUntil(
      named: "menu row \"\(title)\"",
      waitingFor: waitingFor,
      attempts: attempts,
      press: { attempt in
        if attempt > 1 && !optionRow(title).exists {
          return
        }
        try waitForOption(title, "the menu row \"\(title)\" to be tappable").fingerTap()
      },
      reading: { self.echoText(echo) }
    ) { shown in
      shown == expected
    }
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
  ///
  /// The scroll is stepped rather than `swipeUp`ed. A full swipe moves the content
  /// about a window's height, which is more than this band is tall, so an element can
  /// cross the band between two checks and never be inside it; and `swipeUp` travels
  /// one way only, so an element that starts above the band is pushed further out of
  /// reach. Measured with the Host screen carrying all seven hosted controls:
  /// `host-button` finished six `swipeUp`s at midY=-1858, three windows above the band
  /// it had been scrolled past. Steps are shorter than the band, and run back down when
  /// they overshoot, which is what lets "could not be reached" mean the screen does not
  /// scroll rather than mean the helper overshot.
  private func scrollIntoView(
    _ identifier: String,
    as what: String,
    maxSteps: Int = 40
  ) throws {
    let node = try required(identifier, as: what)
    let window = app.windows.firstMatch.frame
    let top = window.minY + 150
    let bottom = window.maxY - 120

    func isReachable() -> Bool {
      let centre = node.frame.midY
      return centre > top && centre < bottom
    }

    func scroll(by delta: CGFloat) {
      let anchor = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.6))
      anchor.press(
        forDuration: 0.05,
        thenDragTo: anchor.withOffset(CGVector(dx: 0, dy: delta))
      )
    }

    // Shorter than the band itself, so one step cannot jump across it.
    let step = min(240, (bottom - top) / 2)
    var steps = 0
    var lastCentre = node.frame.midY
    var stuck = 0
    while !isReachable() && steps < maxSteps {
      scroll(by: node.frame.midY < top ? step : -step)
      steps += 1
      let centre = node.frame.midY
      // A screen that answers nothing would otherwise spend every step scrolling empty
      // space, and that failure would look like the overshoot this replaces.
      stuck = abs(centre - lastCentre) < 4 ? stuck + 1 : 0
      if stuck == 2 {
        XCTAssertTrue(
          false,
          "\(what) (\(identifier)) did not move after \(steps) scroll steps (midY=\(centre) of "
            + "\(window.height)); the screen holding it does not scroll, so no tap could reach it"
        )
        throw RealInputCheckAborted(identifier: identifier)
      }
      lastCentre = centre
    }
    XCTAssertTrue(
      isReachable(),
      "\(what) (\(identifier)) could not be brought into the tappable band after \(steps) scroll steps (midY=\(node.frame.midY) of \(window.height)); tapping it anyway would read a scroll problem as a refusal"
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
      try required(identifier, as: what).fingerTap()
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

  /// A finger's tap: a touch that *lasts*, rather than `tap()`'s zero-dwell one.
  ///
  /// Measured (F1, `docs/tasks/F1/dwell-probe.md`): `tap()` puts touch down and touch
  /// up inside a single frame, and the hosted controls on a screen with much mounted on
  /// it almost never take it - 0/12 and 1/12 presses moved `switch-uncontrolled`'s own
  /// native `value:` at zero dwell, calm and loaded, while the same instant tap reached
  /// the React Native `Pressable` beside it 3/3, so the touch path was alive. It is
  /// *nearly* never, not never: the base `main` run at 23:15Z had a zero-dwell tap flip
  /// that Switch on its first try and lose only the second, and X6 saw 10/10 green with
  /// `tap()`. The drop is intermittent, which is exactly why a check that asserts after
  /// one un-witnessed press could pass for months and then fail 11 runs in a row.
  ///
  /// How much is mounted matters as much as the shape: 0.03 s delivers 12/12 on the
  /// Host screen and 1/12 on the 200-switch one. So this is not "SwiftUI ignores short
  /// touches" - it is a recogniser that stops seeing the touch when the screen is busy,
  /// and a person's quick tap lives in that band. That product question is in the
  /// report; this helper's job is only to make the suite ask the same question every
  /// time, and 0.15 s is the shortest shape with no observed losses.
  ///
  /// It is also the honest gesture for the refusal assertions (a disabled Button, a
  /// disabled Picker): on a screen whose instant taps are usually dropped, "nothing
  /// happened" was not evidence that the control refused the touch.
  func fingerTap(duration: TimeInterval = RealInputTests.pressDwell) {
    centre.fingerTap(duration: duration)
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

extension XCUICoordinate {
  /// A finger's tap at this point - the same held press `XCUIElement.fingerTap`
  /// delivers, for the aims that are not an element's middle (a segment's fraction,
  /// or a bare point used as a menu's "tap outside").
  func fingerTap(duration: TimeInterval = RealInputTests.pressDwell) {
    press(forDuration: duration)
  }
}

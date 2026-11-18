import XCTest

/// Real-input checks: taps and drags synthesised by iOS, asserted only through text the app
/// renders on screen. Elements are found by `testID`, which React Native writes onto the
/// component view as `accessibilityIdentifier`.
final class RealInputTests: XCTestCase {
  private enum Tab {
    static let switchTab = "tab-switch"
    static let sliderTab = "tab-slider"
    static let buttonTab = "tab-button"
    static let segmentedTab = "tab-segmented"
    static let datePickerTab = "tab-datepicker"
    static let pickerTab = "tab-picker"
    static let menuTab = "tab-menu"
    static let chipTab = "tab-chip"
    static let checkboxTab = "tab-checkbox"
    static let dialogTab = "tab-dialog"
    static let sheetTab = "tab-sheet"
    static let tooltipTab = "tab-tooltip"
    static let popoverTab = "tab-popover"
    static let hostTab = "tab-host"
    static let textFieldTab = "tab-textfield"
    static let searchFieldTab = "tab-searchfield"
    static let contextMenuTab = "tab-contextmenu"
    static let iconButtonTab = "tab-iconbutton"
    static let formTab = "tab-form"
    static let buttonGroupTab = "tab-buttongroup"
    static let stepperTab = "tab-stepper"
    static let listItemTab = "tab-listitem"
  }

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
    static let menuPick = "real-input-menu-pick"
    static let menuEvents = "real-input-menu-events"
    static let contextMenu = "ctx-echo"
    static let contextMenuOrder = "ctx-order"
    static let formScreen = "form-screen-echo"
    static let chipValue = "real-input-chip-value"
    static let chipEvents = "real-input-chip-events"
    static let chipRefusedLast = "real-input-chip-refused-last"
    static let chipRefusedEvents = "real-input-chip-refused-events"
    static let chipPresses = "real-input-chip-presses"
    static let checkboxValue = "real-input-checkbox-value"
    static let checkboxEvents = "real-input-checkbox-events"
    static let checkboxRefusedLast = "real-input-checkbox-refused-last"
    static let checkboxRefusedEvents = "real-input-checkbox-refused-events"
    static let checkboxDisabledEvents = "real-input-checkbox-disabled-events"
    static let checkboxSwitchEvents = "real-input-checkbox-switch-events"
    static let iconButtonPresses = "real-input-icon-button-presses"
    static let iconButtonValue = "real-input-icon-button-value"
    static let iconButtonEvents = "real-input-icon-button-events"
    static let iconButtonRefusedLast = "real-input-icon-button-refused-last"
    static let iconButtonRefusedEvents = "real-input-icon-button-refused-events"
    static let iconButtonDisabledEvents = "real-input-icon-button-disabled-events"
    static let buttonGroupPresses = "button-group-presses"
    static let buttonGroupPressedId = "button-group-pressed-id"
    static let buttonGroupToggleEvents = "button-group-toggle-events"
    static let buttonGroupToggleState = "button-group-toggle-state"
    static let buttonGroupRefusedLast = "button-group-refused-last"
    static let buttonGroupRefusedEvents = "button-group-refused-events"
    static let buttonGroupDisabledEvents = "button-group-disabled-events"
    static let buttonGroupOverflowDisabled = "button-group-overflow-disabled"
    static let stepperValue = "real-input-stepper-value"
    static let stepperEvents = "real-input-stepper-events"
    static let stepperHoldValue = "real-input-stepper-hold-value"
    static let stepperHoldEvents = "real-input-stepper-hold-events"
    static let stepperSparseValue = "real-input-stepper-sparse-value"
    static let stepperRefusedLast = "real-input-stepper-refused-last"
    static let stepperRefusedEvents = "real-input-stepper-refused-events"
    static let stepperDisabledEvents = "real-input-stepper-disabled-events"
    static let listItemPresses = "real-input-listitem-presses"
    static let listItemLast = "real-input-listitem-last"
    static let listItemDisabledEvents = "real-input-listitem-disabled-events"
    static let listItemFormPresses = "real-input-listitem-form-presses"
    static let dialogLog = "dialog-log"
    static let sheetLog = "sheet-log"
    static let sheetPresses = "sheet-presses"
    static let tooltipLog = "tooltip-log"
    static let tooltipPresses = "tooltip-anchor-presses"
    static let popoverLog = "popover-log"
    static let popoverPresses = "popover-inner-presses"
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
    static let textTyping = "text-typing-echo"
    static let textFrozen = "text-frozen-echo"
    static let textCapped = "text-capped-echo"
    static let textFocus = "text-focus-echo"
    static let searchTyping = "search-typing-echo"
    static let searchFrozen = "search-frozen-echo"
    static let searchCapped = "search-capped-echo"
    static let searchFocus = "search-focus-echo"
    static let searchNumber = "search-number-echo"
    static let searchEmail = "search-email-echo"
    static let formScreenEcho = "form-screen-echo"
    static let formRowPresses = "form-row-presses"
    static let formInnerPresses = "form-inner-presses"
    static let formOutsidePresses = "form-outside-presses"
    static let formSwitchChanges = "form-switch-changes"
    static let formSwitchValue = "form-switch-value"
    static let formFieldFocus = "form-field-focus"
    static let formFieldValue = "form-field-value"
    static let formKeyboardInset = "form-keyboard-inset"
    static let formListGeometry = "form-list-geometry"
  }

  /// The three titles of `real-input-picker`. None appears anywhere else on that screen, so a
  /// label match names one menu row; the longest is much wider than the title the control starts
  /// with.
  private enum Choice {
    static let first = "Onyx"
    static let second = "Quartz"
    static let longest = "A considerably longer mineral name"
  }

  /// SwiftUI keeps about half a thumb's width clear at each end of the Slider's track (about 4%
  /// of it here), so near the ends a press at the raw value would land beside the thumb.
  fileprivate static let thumbInset: CGFloat = 0.04

  /// How long every synthesized press is held. Hosted controls drop most presses shorter than
  /// about 0.12 s.
  fileprivate static let pressDwell: TimeInterval = 0.15

  /// A debug build loads its bundle from Metro, so the first render is not
  /// instant - especially on a machine running several tasks at once.
  private let firstRenderTimeout: TimeInterval = 120
  private let reactTimeout: TimeInterval = 8

  /// How long a tab bar gets to bring a tab into the window. A time budget rather than a drag
  /// count: a frame read or a drag can each cost seconds on a loaded machine.
  private static let revealTabDeadlineMs = 60_000

  private var app: XCUIApplication!

  override func setUpWithError() throws {
    try super.setUpWithError()
    // One fresh app per test method, so every counter starts at zero.
    continueAfterFailure = false
    app = XCUIApplication()
    app.launch()
    _ = try required(Tab.switchTab, as: "the example's tab bar", timeout: firstRenderTimeout)
  }

  override func tearDown() {
    app = nil
    super.tearDown()
  }

  /// Prints what a screen reader is told about each control. It measures and never fails a
  /// case: the runner's log parser applies the rule to the printed lines. The runner names
  /// the cases to read in `NITRO_UI_A11Y_CASES`, comma separated; unset reads them all.
  func testRealInputA11y() throws {
    let only = ProcessInfo.processInfo.environment["NITRO_UI_A11Y_CASES"]
      .map { Set($0.split(separator: ",").map(String.init)) }
    for one in A11yCase.all where only?.contains(one.id) ?? true {
      do {
        try measure(one)
      } catch is RealInputCheckAborted {
        // The runner reads a case with no lines as failed; continuing keeps one screen that
        // will not load from stopping the other cases.
        continue
      } catch {
        print("real-input a11y case=\(one.id) | error | \(error)")
      }
    }
  }

  /// Prints every tab's box once it is scrolled into the window; the runner's log parser
  /// applies the size rule. Tabs are found by `testID` prefix rather than listed here.
  func testRealInputTabTargets() throws {
    let ids = app.descendants(matching: .any)
      .matching(NSPredicate(format: "identifier BEGINSWITH %@", "tab-"))
      .allElementsBoundByIndex
      .map(\.identifier)
    var seen = Set<String>()
    for id in ids where seen.insert(id).inserted {
      let tab = app.descendants(matching: .any)[id].firstMatch
      // The log parser reads `reached=true|false`, so this has to stay a `Bool`.
      let reached: Bool = revealTab(tab).satisfied
      var frame = tab.frame
      for _ in 0..<5 {
        Thread.sleep(forTimeInterval: 0.2)
        let again = tab.frame
        if again == frame { break }
        frame = again
      }
      print(
        "real-input tab-target id=\(id) | frame="
          + String(
            format: "%.1f,%.1f,%.1f,%.1f",
            frame.minX, frame.minY, frame.width, frame.height
          )
          + " | reached=\(reached)"
      )
    }
  }

  /// Prints one control's box and tree. The tree is read until two consecutive reads agree: a
  /// single read of `XCUIElement.frame` can return a stale snapshot.
  private func measure(_ one: A11yCase) throws {
    try goToTab(one.tab, showing: one.screenAnchor)
    let dragged = bringIntoView(one.testId) > 0
    // `waitForExistence` takes a second to answer even for an element that is there. After a
    // drag that second is also what lets the scroll come to rest, so it is kept then.
    let onScreen = app.descendants(matching: .any)[one.testId].firstMatch
    let anchor =
      !dragged && onScreen.exists
      ? onScreen : try required(one.testId, as: "the control \"\(one.testId)\"")
    var snapshotError: Error?
    func readCase() -> A11ySnapshot {
      do {
        let nodes = try A11yNode.tree(of: anchor)
        snapshotError = nil
        return A11ySnapshot(nodes: nodes)
      } catch {
        snapshotError = error
        return A11ySnapshot(nodes: [])
      }
    }

    let settled = A11yFrameStability.settle(
      framesOf: { $0.frames },
      identitiesOf: { $0.identities },
      confirmationNeeded: { $0.mergedChildrenInQuestion },
      read: readCase
    )
    if let snapshotError { throw snapshotError }
    // Printed only when the reads disagreed. `firstAnchor*` is the box a single read would
    // have reported.
    if A11yFrameStability.shouldReport(settled) {
      let firstBox = settled.first?.frames.first
      print(
        "real-input a11y case=\(one.id) kind=stability reads=\(settled.reads) "
          + "settled=\(settled.settled) moved=\(settled.moved) "
          + "elapsedMs=\(settled.elapsedMs)"
          + (firstBox.map {
            " firstAnchorX=\($0.origin.x) firstAnchorY=\($0.origin.y) "
              + "firstAnchorW=\($0.size.width) firstAnchorH=\($0.size.height)"
          } ?? "")
      )
    }
    let nodes = try settled.snapshot.withLiveReads(of: anchor).nodes
    let anchorFrame = nodes[0].frame
    // The log parser reads these lines. The frame numbers are spelled out because the shape
    // of a `CGRect`'s description is not ours to rely on.
    print(
      "real-input a11y case=\(one.id) kind=anchor id=\(one.testId) "
        + "x=\(anchorFrame.origin.x) y=\(anchorFrame.origin.y) "
        + "w=\(anchorFrame.size.width) h=\(anchorFrame.size.height) "
        + "nodes=\(nodes.count)"
    )
    for node in nodes {
      print(
        // Quoted: a trait such as "segmented control" contains a space.
        "real-input a11y case=\(one.id) kind=node trait=\(quoted(node.traitName)) "
          + "enabled=\(node.enabled) hittable=\(node.hittable) "
          + "id=\(quoted(node.identifier)) label=\(quoted(node.label)) "
          + "value=\(quoted(node.valueText)) "
          + "x=\(node.frame.origin.x) y=\(node.frame.origin.y) "
          + "w=\(node.frame.size.width) h=\(node.frame.size.height)"
      )
    }
  }

  /// Scrolls until an element is inside the window, without failing when the screen will not
  /// bring it in: an element below the fold is still measured where it is. Returns how many
  /// drags it made.
  @discardableResult
  private func bringIntoView(_ identifier: String) -> Int {
    let node = app.descendants(matching: .any)[identifier].firstMatch
    guard node.exists else { return 0 }
    let window = app.windows.firstMatch.frame

    func inWindow() -> Bool {
      node.frame.midY > window.minY + 60 && node.frame.midY < window.maxY - 60
    }

    var steps = 0
    while !inWindow() && steps < 4 {
      let from = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.6))
      from.press(
        forDuration: 0.05,
        thenDragTo: from.withOffset(
          CGVector(dx: 0, dy: node.frame.midY < window.minY + 60 ? 160 : -160)
        )
      )
      steps += 1
    }
    if !inWindow() {
      print(
        "real-input a11y: \(identifier) is still outside the window after \(steps) "
          + "scroll steps (midY=\(node.frame.midY) of \(window.height)) — measured "
          + "where it is, which is the honest reading for a control the screen will "
          + "not bring into view"
      )
    }
    return steps
  }

  /// The cases, in the order of the shared table in `scripts/real-input/a11y.mjs`. A unit test
  /// compares the two lists, so ids, testIDs and labels have to match that table.
  private struct A11yCase {
    let id: String
    let testId: String
    let label: String
    let tab: String
    let screenAnchor: String

    static let all: [A11yCase] = [
      A11yCase(id: "switch", testId: "switch-controlled", label: "Controlled switch",
               tab: Tab.switchTab, screenAnchor: Echo.switchValue),
      A11yCase(id: "slider", testId: "slider-controlled", label: "Controlled slider",
               tab: Tab.sliderTab, screenAnchor: Echo.sliderValue),
      A11yCase(id: "button", testId: "real-input-enabled", label: "Real-input button",
               tab: Tab.buttonTab, screenAnchor: Echo.buttonCount),
      A11yCase(id: "segmented-control", testId: "real-input-segmented",
               label: "Real-input segmented control",
               tab: Tab.segmentedTab, screenAnchor: Echo.segmentedIndex),
      A11yCase(id: "date-picker", testId: "real-input-date", label: "Real-input date picker",
               tab: Tab.datePickerTab, screenAnchor: Echo.dateValue),
      A11yCase(id: "picker", testId: "real-input-picker", label: "Real-input picker",
               tab: Tab.pickerTab, screenAnchor: Echo.pickerIndex),
      A11yCase(id: "menu", testId: "real-input-menu", label: "Real-input menu",
               tab: Tab.menuTab, screenAnchor: Echo.menuPick),
      A11yCase(id: "chip", testId: "real-input-chip", label: "Real-input chip",
               tab: Tab.chipTab, screenAnchor: Echo.chipValue),
      A11yCase(id: "checkbox", testId: "real-input-checkbox", label: "Real-input checkbox",
               tab: Tab.checkboxTab, screenAnchor: Echo.checkboxValue),
      A11yCase(id: "icon-button", testId: "real-input-icon-button",
               label: "Real-input icon button",
               tab: Tab.iconButtonTab, screenAnchor: Echo.iconButtonValue),
      A11yCase(id: "button-group", testId: "real-input-button-group",
               label: "Real-input actions",
               tab: Tab.buttonGroupTab, screenAnchor: Echo.buttonGroupPresses),
      A11yCase(id: "stepper", testId: "real-input-stepper", label: "Real-input stepper",
               tab: Tab.stepperTab, screenAnchor: Echo.stepperValue),
      A11yCase(id: "hosted-switch", testId: "host-switch-0", label: "Hosted switch 0",
               tab: Tab.hostTab, screenAnchor: Echo.hostValue),
      A11yCase(id: "hosted-slider", testId: "host-slider", label: "Hosted slider",
               tab: Tab.hostTab, screenAnchor: Echo.hostValue),
      A11yCase(id: "hosted-button", testId: "host-button", label: "Hosted button",
               tab: Tab.hostTab, screenAnchor: Echo.hostValue),
      A11yCase(id: "hosted-segmented", testId: "host-segmented", label: "Hosted segmented",
               tab: Tab.hostTab, screenAnchor: Echo.hostSegmentedIndex),
      A11yCase(id: "hosted-picker", testId: "host-picker", label: "Hosted picker",
               tab: Tab.hostTab, screenAnchor: Echo.hostPickerIndex),
      A11yCase(id: "hosted-date-picker", testId: "host-datepicker",
               label: "Hosted date picker",
               tab: Tab.hostTab, screenAnchor: Echo.hostDateValue),
      A11yCase(id: "hosted-progress", testId: "host-mixed-progress-linear",
               label: "Mixed linear progress",
               tab: Tab.hostTab, screenAnchor: Echo.hostMixedState),
      A11yCase(id: "text-field", testId: "text-typing", label: "Typing field",
               tab: Tab.textFieldTab, screenAnchor: Echo.textTyping),
      A11yCase(id: "search-field", testId: "search-typing", label: "Typing search field",
               tab: Tab.searchFieldTab, screenAnchor: Echo.searchTyping),
      A11yCase(id: "context-menu", testId: "ctx-accessible", label: "Message from Grace",
               tab: Tab.contextMenuTab, screenAnchor: Echo.contextMenu),
      A11yCase(id: "form", testId: "form-row", label: "Row with onPress",
               tab: Tab.formTab, screenAnchor: Echo.formScreen),
      A11yCase(id: "list-item", testId: "real-input-listitem", label: "Real-input item",
               tab: Tab.listItemTab, screenAnchor: Echo.listItemPresses),
    ]
  }

  /// One read of one control's whole tree. Agreement is judged on frames and identities: React
  /// Native can publish or withdraw a child accessibility element without moving a pixel.
  private struct A11ySnapshot {
    let nodes: [A11yNode]

    /// The same nodes with what a snapshot cannot answer read from the live elements, matched
    /// by position: the anchor first, then its descendants in query order. Throws when the live
    /// tree no longer lines up with the snapshot, rather than reading one element into another.
    func withLiveReads(of anchor: XCUIElement) throws -> A11ySnapshot {
      let descendants = anchor.descendants(matching: .any)
      // Checked first: a property read on an index past the end fails the whole test method.
      let liveCount = descendants.count + 1
      guard liveCount == nodes.count else {
        throw LiveTreeMismatch(
          "the live tree has \(liveCount) elements where the settled read had \(nodes.count)"
        )
      }
      var read = nodes
      for index in read.indices {
        let live = index == 0 ? anchor : descendants.element(boundBy: index - 1)
        let liveType = live.elementType
        let liveId = live.identifier
        guard liveType == read[index].elementType, liveId == read[index].identifier else {
          throw LiveTreeMismatch(
            "element \(index) is \(RealInputTests.traitName(liveType)) \"\(liveId)\" live "
              + "but \(read[index].traitName) \"\(read[index].identifier)\" in the settled read"
          )
        }
        read[index].hittable = live.isHittable
        if A11yNode.liveValueTypes.contains(read[index].elementType) {
          read[index].valueText = A11yNode.text(of: live.value)
        }
      }
      return A11ySnapshot(nodes: read)
    }

    var frames: [CGRect] { nodes.map(\.frame) }

    /// One string per element: trait, name and value. Not deduplicated, because the runner
    /// counts duplicates.
    var identities: [String] {
      nodes.map { "\($0.traitName)|\($0.label)|\($0.valueText)" }
    }

    /// True when the wrapper is a named element and the tree still lists differently named
    /// text inside it: either the children are stops of their own, or React Native has not
    /// finished publishing the merged element.
    var mergedChildrenInQuestion: Bool {
      guard let wrapper = nodes.first, !wrapper.label.isEmpty else { return false }
      return nodes.dropFirst().contains { node in
        node.traitName == "static text" && !node.label.isEmpty && node.label != wrapper.label
      }
    }
  }

  /// One accessibility element. Each property of a live `XCUIElement` is a round trip to the
  /// test manager; a snapshot of a subtree is one for the whole subtree.
  private struct A11yNode {
    let identifier: String
    let label: String
    let elementType: XCUIElement.ElementType
    let frame: CGRect
    let enabled: Bool
    /// A snapshot cannot say whether a touch would land on the element, so for one this is
    /// read from the live element once the tree has settled, and is `false` until then.
    var hittable: Bool
    let selected: Bool
    var valueText: String

    /// An empty text-entry element's live `value` is its placeholder, and its snapshot's is
    /// not, so for these the value is read from the live element too.
    static let liveValueTypes: Set<XCUIElement.ElementType> = [
      .textField, .secureTextField, .searchField, .textView,
    ]

    static func text(of raw: Any?) -> String {
      (raw as? String) ?? (raw == nil ? "" : "\(String(describing: raw))")
    }

    init(element: XCUIElement) {
      identifier = element.identifier
      label = element.label
      elementType = element.elementType
      frame = element.frame
      enabled = element.isEnabled
      hittable = element.isHittable
      selected = element.isSelected
      valueText = A11yNode.text(of: element.value)
    }

    init(snapshot: XCUIElementSnapshot) {
      identifier = snapshot.identifier
      label = snapshot.label
      elementType = snapshot.elementType
      frame = snapshot.frame
      enabled = snapshot.isEnabled
      hittable = false
      selected = snapshot.isSelected
      valueText = A11yNode.text(of: snapshot.value)
    }

    /// The element and every descendant, level by level, which is the order
    /// `descendants(matching: .any)` lists them in.
    static func tree(of element: XCUIElement) throws -> [A11yNode] {
      var nodes: [A11yNode] = []
      var level = [try element.snapshot()]
      while !level.isEmpty {
        nodes += level.map(A11yNode.init(snapshot:))
        level = level.flatMap(\.children)
      }
      return nodes
    }

    var traitName: String {
      RealInputTests.traitName(elementType)
    }
  }

  /// Quotes a value for the log. Names and values can hold spaces, and the log parser reads
  /// the quoted form with `JSON.parse`.
  private func quoted(_ text: String) -> String {
    let escaped = text
      .replacingOccurrences(of: "\\", with: "\\\\")
      .replacingOccurrences(of: "\"", with: "\\\"")
    return "\"\(escaped)\""
  }

  /// An element type as the word VoiceOver says before the control's name.
  private static func traitName(_ elementType: XCUIElement.ElementType) -> String {
    switch elementType {
    case .button: return "button"
    case .slider: return "slider"
    case .`switch`: return "switch"
    case .segmentedControl: return "segmented control"
    case .searchField: return "search field"
    case .textField: return "text field"
    case .secureTextField: return "secure text field"
    case .textView: return "text view"
    case .progressIndicator: return "progress indicator"
    case .staticText: return "static text"
    case .group: return "group"
    case .other: return "other"
    default: return "type-\(elementType.rawValue)"
    }
  }

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

    try assertBusyScreenDeliversEveryPress()
  }

  /// Every press on the busy Switch screen must arrive: each is delivered once, with no retry.
  /// A phase of the Switch check rather than a method of its own, because the runner pairs
  /// every `testRealInput*` method with a control and this check is about a screen.
  private func assertBusyScreenDeliversEveryPress() throws {
    // Counted as Switch elements rather than by testID, so a screen of plain boxes carrying
    // the same testIDs does not pass for the busy one.
    let switches = app.descendants(matching: .switch).count
    XCTAssertGreaterThanOrEqual(
      switches,
      Self.busyScreenMinimumSwitches,
      "the Switch screen has to carry its 200-row list of Switches for this check to "
        + "mean anything: with the list absent, the same press was measured arriving "
        + "at 30 ms, so this case would pass on a calm screen and report nothing about "
        + "the busy one. The tree exposes \(switches) switch elements."
    )

    let target = "switch-uncontrolled"
    var delivered = 0
    var unreadable = 0
    var pressedAt: TimeInterval?
    for attempt in 1...Self.busyScreenPresses {
      // A missing reading is a broken check, not a delivered press.
      guard let before = nativeSwitchState(of: target) else {
        XCTFail(
          "\(target) published no switch value before press \(attempt) of "
            + "\(Self.busyScreenPresses), so this check cannot tell a delivered press "
            + "from a dropped one. A witness that stops publishing must not be able to "
            + "read as twelve successes."
        )
        return
      }
      // No `scrollIntoView`: the control sits above the list, and moving the page would change
      // the hit-test workload this check measures.
      guard let dwell = pressOnce(target) else {
        XCTFail(
          "\(target) could not be found before press \(attempt) of "
            + "\(Self.busyScreenPresses): nothing was pressed, so the presses that "
            + "follow would only measure the screen going away."
        )
        return
      }
      pressedAt = dwell
      switch waitForNativeValueToChange(target, from: before) {
      case .delivered:
        delivered += 1
      case .unreadable:
        unreadable += 1
      case .dropped:
        break
      }
    }
    let pressedAtSeconds = pressedAt.map { String($0) } ?? "an unknown"
    XCTAssertEqual(
      unreadable,
      0,
      "the busy Switch screen published no value at all after \(unreadable) of "
        + "\(Self.busyScreenPresses) presses. Those presses are counted as dropped, "
        + "and the check that they are not silently credited is the reason this is a "
        + "separate assertion."
    )
    XCTAssertEqual(
      delivered,
      Self.busyScreenPresses,
      "the busy Switch screen dropped \(Self.busyScreenPresses - delivered) of "
        + "\(Self.busyScreenPresses) presses at \(pressedAtSeconds)s dwell. That is "
        + "the property every other tap in this file depends on; see "
        + "docs/tasks/F7-quick-tap.report.md for the measurements and "
        + "docs/tasks/F1/dwell-probe.md for the study that made them (X37 "
        + "removed the probe that wrote those lines; the reports are the record)."
    )
  }

  /// Below the 200 rows the screen renders, because the tree exposes only the rows that are
  /// realised, and well above the dozen or so controls every other screen carries.
  private static let busyScreenMinimumSwitches = 100
  private static let busyScreenPresses = 12

  /// Delivers exactly one press and returns the dwell it used, or nil without pressing when
  /// the control cannot be found.
  private func pressOnce(_ identifier: String) -> TimeInterval? {
    guard let element = try? required(identifier, as: "the uncontrolled Switch") else {
      return nil
    }
    element.fingerTap()
    return RealInputTests.pressDwell
  }

  private enum PressOutcome {
    /// The control's value moved away from where it started.
    case delivered
    /// The window closed with the control still reporting its original value.
    case dropped
    /// The control answered with nothing at all for the whole window.
    case unreadable
  }

  /// Waits for the control's own value to move away from `before`. The window is short: it
  /// measures whether the touch reached the control, not whether React re-rendered. A nil
  /// reading is never a change; the outcome is `unreadable` only if every reading was nil.
  private func waitForNativeValueToChange(
    _ identifier: String,
    from before: String
  ) -> PressOutcome {
    let until = Date().addingTimeInterval(1.5)
    var sawAnyReading = false
    while Date() < until {
      if let shown = nativeSwitchState(of: identifier) {
        sawAnyReading = true
        if shown != before {
          return .delivered
        }
      }
      Thread.sleep(forTimeInterval: 0.05)
    }
    return sawAnyReading ? .dropped : .unreadable
  }

  /// On iOS a `<Host>` is a passthrough `View`: its children are still React Native's own views.
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

    XCTAssertEqual(
      try read(Echo.hostEvents),
      "2",
      "the Host should have reported both changes its child was asked for"
    )
  }

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

  func testRealInputHostedPicker() throws {
    try goToTab(Tab.hostTab, showing: Echo.hostValue)
    try scrollIntoView("host-picker", as: "the Picker inside the Host")
    XCTAssertEqual(
      try read(Echo.hostPickerIndex),
      "1",
      "the hosted Picker should show the index JS gave it"
    )

    // The rows exist only while the menu is open, so the press is repeated until one is up.
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

    XCTAssertTrue(
      optionRow("Beta").images.count > 0,
      "the current choice (\"Beta\") should carry the hosted menu's selection mark"
    )

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
    // Waits on a row that is not the new choice: the chosen title stays on screen after the
    // menu closes, as the anchor's own text.
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

    // Tapping the row already chosen closes the menu and reports no change.
    try tapUntilOption(
      "host-picker",
      as: "the Picker inside the Host",
      option: "Beta",
      waitingFor: "the real tap that reopens the hosted menu"
    )
    _ = try waitForOption("Beta", "the hosted menu to reopen")
    // Not retried: the correct outcome is that nothing is reported, so there is no state to
    // wait on, and a second tap would press a closing menu.
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

  func testRealInputSegmentedControl() throws {
    try goToTab(Tab.segmentedTab, showing: Echo.segmentedIndex)
    let control = try required("real-input-segmented", as: "the uncontrolled SegmentedControl")
    let whereItStarted = control.frame
    XCTAssertEqual(
      try read(Echo.segmentedIndex),
      "-",
      "the SegmentedControl should not have reported an index before a touch"
    )
    XCTAssertEqual(try read(Echo.segmentedEvents), "0", "no change should be reported before a touch")

    // The options are single digits, so the segments are the same width.
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

    // The parent keeps sending index 0, so a second tap on the same segment is reported only
    // if the selection snapped back.
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


  /// A `.menu` Picker's list is presented inside the app's own window. Its rows are found by
  /// label, the chosen one carries a `checkmark` image, and a tap outside the list does not
  /// close it, so the menu is dismissed through a row.
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

    // The heartbeat is read again below while a menu is open. That reading only means
    // something if the same screen is seen to beat with nothing presented.
    let beat = tickerBeat()
    print("real-input (ios): heartbeat with nothing presented: \(beat.readings)")
    XCTAssertTrue(
      beat.moved,
      "the screen's own option ticker should repaint within 8s while nothing is presented (readings \(beat.readings)) - a heartbeat that does not beat here makes step 7's reading prove nothing"
    )

    // The rows exist only while the menu is open, so the press is repeated until one is up.
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

    XCTAssertTrue(
      optionRow(Choice.first).images.count > 0,
      "the current choice (\"\(Choice.first)\") should carry the menu's selection mark"
    )
    XCTAssertEqual(
      optionRow(Choice.second).images.count,
      0,
      "a row that is not the choice should not carry it"
    )

    // Tapping the row already chosen closes the menu and reports no change, however often it
    // happens, so this press is safe to retry.
    try pressUntil(
      named: "menu row \"\(Choice.first)\"",
      waitingFor: "the real tap on the row that was already chosen",
      press: { attempt in
        // On a retry the row may be gone because the earlier tap did land and the echo is
        // slow. Pressing a menu on its way out would count a second choice.
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

    let after = try required("real-input-picker", as: "the uncontrolled Picker")
    XCTAssertTrue(after.isHittable, "the Picker should still be on screen after its own menu closed")
    let widthAfter = after.frame.width
    XCTAssertGreaterThan(
      widthAfter,
      widthBefore + 60,
      "choosing a title much wider than the first should widen the control: it measured \(widthBefore) pt with \"\(Choice.first)\" and now paints \"\(Choice.longest)\" - a frame that did not grow means the host never re-measured an uncontrolled choice"
    )

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

    // A second tap on the same row is a fresh choice only if the refused one was rolled back.
    // The close is waited for first: a tap on the anchor that lands during the dismissal is
    // swallowed by the closing menu.
    _ = waitUntilOptionGone("Ridge", "the refusing Picker's menu to close")
    try required("real-input-picker-reject", as: "the controlled Picker").fingerTap()
    try waitForOption("Ridge", "the refusing Picker's menu to reopen").fingerTap()
    XCTAssertEqual(
      readUntil(Echo.rejectEvents) { $0 == "2" },
      "2",
      "a second tap on the refused row should be a fresh choice, which is only true if the refused one was rolled back"
    )
    XCTAssertEqual(try read(Echo.rejectValue), "0", "and the parent should still be refusing")

    // Opens a menu, then has React take the view away underneath it, three times. A menu is
    // not a window of its own on iOS, so a leaked one would show as the window count moving
    // or the row's text staying in the tree.
    let windowsWhileMounted = app.windows.count
    for cycle in 1...3 {
      if cycle > 1 {
        // The arm button renders in the same branch as the Picker, so seeing it says the
        // Picker is mounted again.
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

    // The disabled Picker shows 'Mica', and no other row on this screen paints 'Cinder', so
    // 'Cinder' can only be on screen as a row of its open menu.
    XCTAssertEqual(
      optionLabels(containing: "Cinder"),
      0,
      "no menu is open before this, so one option may not be on screen"
    )

    // Both rows render below the fold, and a tap that lands on empty space looks exactly like
    // a refusal.
    try scrollIntoView("disabled-one", as: "the disabled Picker")
    try scrollIntoView("enabled-one", as: "the enabled Picker")

    // Read on the hosted control rather than on the React Native view that hosts it:
    // `disabled` is expressed by the platform control, not by the wrapper's accessibility props.
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

  func testRealInputMenu() throws {
    try goToTab(Tab.menuTab, showing: Echo.menuPick)
    let alpha = "Alpha"
    let bravo = "Bravo"
    let locked = "Locked row"
    // A SwiftUI `Toggle` row: its pick goes through the binding's setter, not a `Button`.
    let checkedRow = "Checked row"

    let anchor = try required("real-input-menu", as: "the Menu")
    let trigger = try hostedControl(in: "real-input-menu", as: "the Menu's trigger")
    XCTAssertNotEqual(
      trigger.identifier,
      anchor.identifier,
      "the node read for the announcement should be the hosted SwiftUI control and not the "
        + "React Native view that carries the testID - the wrapper's own name comes from RN's "
        + "accessibilityLabel prop, so reading it would say nothing about what nitro-ui passed "
        + "down to the control. Both read id=\"\(anchor.identifier)\"."
    )
    XCTAssertEqual(
      trigger.label,
      "Real-input menu",
      "the trigger's name should be the accessibilityLabel the library set on the SwiftUI "
        + "Menu. Without `.accessibilityLabel` the control takes its name from its own title "
        + "and says \"Actions\", which is what a VoiceOver user would hear."
    )
    XCTAssertEqual(
      try read(Echo.menuPick),
      "-",
      "the Menu should have reported no pick before a touch"
    )
    XCTAssertEqual(
      try read(Echo.menuEvents),
      "none",
      "and no event of any kind"
    )
    XCTAssertEqual(
      optionLabels(containing: bravo),
      0,
      "no menu is open yet, so a row may not be on screen"
    )

    try tapUntilOption(
      "real-input-menu",
      as: "the Menu trigger",
      option: bravo,
      waitingFor: "the real tap on the trigger"
    )
    _ = try waitForOption(bravo, "the menu to open")
    // A screenshot, because the accessibility tree cannot show whether the trigger's button
    // style leaks into the rows.
    let openShot = XCUIScreen.main.screenshot()
    let openShotAttachment = XCTAttachment(image: openShot.image)
    openShotAttachment.name = "menu-open"
    openShotAttachment.lifetime = .keepAlways
    add(openShotAttachment)
    // Also written to the process's own sandbox, where a concurrent run cannot overwrite it.
    let openShotURL = URL(fileURLWithPath: NSTemporaryDirectory())
      .appendingPathComponent("g7b-menu-open.png")
    try? openShot.pngRepresentation.write(to: openShotURL)
    print(
      "real-input (ios): menu: open menu screenshot attached, and written to \(openShotURL.path)"
    )
    XCTAssertEqual(
      try read(Echo.menuPick),
      "-",
      "opening a menu is not a choice - nothing may be reported until a row is tapped"
    )

    XCTAssertFalse(
      optionRow(locked).isEnabled,
      "a disabled row should report itself not enabled through accessibility, so VoiceOver "
        + "refuses it too (twin \"\(alpha)\" isEnabled=\(optionRow(alpha).isEnabled))"
    )
    XCTAssertTrue(
      optionRow(alpha).isEnabled,
      "and an ordinary row should not - which is what proves the line above measured a "
        + "refusal rather than a presentation that stopped answering"
    )

    // Pressed once: the correct outcome is that nothing is reported, so there is no state to
    // retry towards.
    try optionRow(locked).fingerTap()
    XCTAssertEqual(
      try read(Echo.menuPick),
      "-",
      "a real tap on the disabled row should report no pick"
    )
    // SwiftUI may leave the menu open after that tap, and the menu is drawn over its own
    // trigger: a press on the trigger while it is up lands on whichever row covers it. So the
    // menu is closed, and seen to be closed, before the trigger is pressed again.
    let stayedUp = optionLabels(containing: locked) > 0
    print(
      "real-input (ios): menu: a real tap on the disabled row left the presentation "
        + (stayedUp ? "open" : "closed")
    )
    if stayedUp {
      // A quarter down the screen is inside the page's description text: above the popup and
      // below the tab bar. Anything added to `MenuScreen` above the real-input Menu moves a
      // control under this point.
      app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
      waitUntilOptionGone(locked, "the tap away from the menu to close it")
    }

    try tapUntilOption(
      "real-input-menu",
      as: "the Menu trigger",
      option: bravo,
      waitingFor: "the real tap that reopens the menu"
    )
    XCTAssertEqual(
      try tapOptionUntilValue(
        option: bravo,
        echo: Echo.menuPick,
        expected: "bravo",
        waitingFor: "the real tap on the row \"\(bravo)\""
      ),
      "bravo",
      "a real tap on a menu row should reach JS as that row's id"
    )
    // iOS reports the pick and nothing else: a SwiftUI presentation has no open or close event.
    XCTAssertEqual(
      try read(Echo.menuEvents),
      "select bravo",
      "one pick on iOS should report the pick alone - a SwiftUI Menu keeps its open state "
        + "to itself, so `onOpen`/`onClose` never fire (DECISIONS D32)"
    )
    XCTAssertEqual(
      optionLabels(containing: bravo),
      0,
      "a pick should take its own menu down - nothing on screen should still carry a row's "
        + "name. iOS reports no dismissal, so this is the only witness that the presentation "
        + "went away by itself."
    )

    try tapUntilOption(
      "real-input-menu",
      as: "the Menu trigger",
      option: alpha,
      waitingFor: "the real tap that reopens the menu for the twin row"
    )
    XCTAssertEqual(
      try tapOptionUntilValue(
        option: alpha,
        echo: Echo.menuPick,
        expected: "alpha",
        waitingFor: "the real tap on the row \"\(alpha)\""
      ),
      "alpha",
      "the enabled row, tapped the same way, should report a pick - so the silence above "
        + "measured a refusal and not a screen that stopped answering"
    )
    XCTAssertEqual(
      try read(Echo.menuEvents),
      "select bravo > select alpha",
      "two picks should report two picks, in order, with no open/close between them"
    )

    // `tapOptionUntilValue` re-presses only while the row is still up, so a retry cannot land
    // a second pick.
    try tapUntilOption(
      "real-input-menu",
      as: "the Menu trigger",
      option: checkedRow,
      waitingFor: "the real tap that reopens the menu for the checked row"
    )
    let toggle = optionRow(checkedRow)
    print(
      "real-input (ios): menu: checked row type=\(toggle.elementType.rawValue) "
        + "value=\(String(describing: toggle.value)) selected=\(toggle.isSelected)"
    )
    XCTAssertEqual(
      try tapOptionUntilValue(
        option: checkedRow,
        echo: Echo.menuPick,
        expected: "checked",
        waitingFor: "the real tap on the row \"\(checkedRow)\""
      ),
      "checked",
      "a real tap on a checked row should reach JS as that row's id - the Toggle's setter "
        + "is the pick, and a setter that does nothing leaves the echo where it was"
    )
    let events = try read(Echo.menuEvents)
    XCTAssertEqual(
      events.components(separatedBy: " > ").filter { $0 == "select checked" }.count,
      1,
      "the checked row should report exactly one select, read \"\(events)\""
    )
    XCTAssertEqual(
      events,
      "select bravo > select alpha > select checked",
      "and nothing else: no open/close on iOS (D32), no second pick from one tap"
    )
    waitUntilOptionGone(checkedRow, "the checked-row pick to take its menu down")
    XCTAssertEqual(
      optionLabels(containing: checkedRow),
      0,
      "a pick of the checked row should take its own menu down"
    )
  }

  // MARK: - ContextMenu

  func testRealInputContextMenu() throws {
    try goToTab(Tab.contextMenuTab, showing: Echo.contextMenu)
    try contextMenuToTop()
    try required("ctx-reset", as: "the counters' reset").fingerTap()
    contextMenuEcho { $0["press"] == 0 && $0["opens"] == 0 }
    let target = try required("ctx-target", as: "the Pressable inside the ContextMenu")
    // Off-centre: what is under the finger is the child, wherever it is pressed.
    let point = target.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.4))

    var before = contextMenuEcho()
    point.fingerTap()
    var after = contextMenuEcho { $0["press"] == (before["press"] ?? 0) + 1 }
    Thread.sleep(forTimeInterval: 0.6)
    XCTAssertEqual(after["press"], (before["press"] ?? 0) + 1, "a quick tap presses the child once")
    XCTAssertEqual(contextMenuEcho()["opens"], before["opens"], "and opens no menu")

    for round in 1...2 {
      before = contextMenuEcho()
      point.press(forDuration: 1.0)
      let row = optionRow("Copy text")
      XCTAssertTrue(
        row.waitForExistence(timeout: 4),
        "hold \(round): a still hold should open the menu with its \"Copy text\" row"
      )
      Thread.sleep(forTimeInterval: 0.4)
      row.fingerTap()
      let mid = contextMenuEcho { $0["closes"] == (before["closes"] ?? 0) + 1 }
      waitUntilOptionGone("Copy text", "the menu to close after a pick", timeout: 4)
      XCTAssertEqual(mid["opens"], (before["opens"] ?? 0) + 1, "hold \(round): one open")
      XCTAssertEqual(
        mid["press"],
        before["press"],
        "hold \(round): the child's onPress must not fire for a hold that opened the menu "
          + "(pressIn \(mid["pressIn"] ?? -1), pressOut \(mid["pressOut"] ?? -1))"
      )
      XCTAssertEqual(mid["selects"], (before["selects"] ?? 0) + 1, "hold \(round): the pick")
      let order = echoText(Echo.contextMenuOrder).replacingOccurrences(of: "order=", with: "")
        .split(separator: ",").suffix(3).joined(separator: ">")
      XCTAssertEqual(order, "open>select:copy>close", "hold \(round): select before close (D32)")
      // UIKit ignores a hold that starts while its dismissal still animates.
      Thread.sleep(forTimeInterval: 1.0)
      point.fingerTap()
      after = contextMenuEcho { $0["press"] == (mid["press"] ?? 0) + 1 }
      XCTAssertEqual(after["press"], (mid["press"] ?? 0) + 1, "hold \(round): a fresh tap presses once")
    }

    before = contextMenuEcho()
    let from = target.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
    from.press(forDuration: 0.05, thenDragTo: from.withOffset(CGVector(dx: 0, dy: -220)))
    Thread.sleep(forTimeInterval: 1.0)
    after = contextMenuEcho()
    XCTAssertNotEqual(after["scrollY"], before["scrollY"], "a drag on the ContextMenu scrolls the page")
    XCTAssertEqual(after["opens"], before["opens"], "and opens no menu")
    XCTAssertEqual(optionLabels(containing: "Copy text"), 0, "nothing is on screen from a menu")
    try contextMenuToTop()

    before = contextMenuEcho()
    let inner = try contextMenuReveal("ctx-inner")
    inner.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(forDuration: 1.0)
    XCTAssertTrue(
      optionRow("Inner action").waitForExistence(timeout: 4),
      "a hold on the inner ContextMenu should open the inner menu"
    )
    XCTAssertEqual(optionLabels(containing: "Outer action"), 0, "and not the outer one")
    contextMenuDismiss(rows: ["Inner action", "Outer action"])
    after = contextMenuEcho { $0["inner"] == (before["inner"] ?? 0) + 1 }
    XCTAssertEqual(after["inner"], (before["inner"] ?? 0) + 1, "the inner reports its open")
    XCTAssertEqual(after["outer"], before["outer"], "the outer reports none")

    // Disabled: the hold stays the child's, and a Pressable with no `onLongPress` presses on
    // release.
    before = contextMenuEcho()
    let disabled = try contextMenuReveal("ctx-disabled-target")
    disabled.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(forDuration: 1.0)
    Thread.sleep(forTimeInterval: 1.0)
    XCTAssertEqual(optionLabels(containing: "Copy text"), 0, "a disabled ContextMenu opens nothing")
    contextMenuDismiss(rows: ["Copy text"])
    after = contextMenuEcho { $0["dPress"] == (before["dPress"] ?? 0) + 1 }
    XCTAssertEqual(after["dOpens"], before["dOpens"], "and reports no open")
    XCTAssertEqual(after["dPress"], (before["dPress"] ?? 0) + 1, "the child keeps the hold: one press")
    try contextMenuToTop()
  }

  /// The `ctx-echo` counters, polled until `ok` accepts them (or once, with no `ok`).
  @discardableResult
  private func contextMenuEcho(
    timeout: TimeInterval = 6,
    _ ok: (([String: Int]) -> Bool)? = nil
  ) -> [String: Int] {
    func parse() -> [String: Int] {
      var out: [String: Int] = [:]
      for part in echoText(Echo.contextMenu).split(separator: ";") {
        let pair = part.split(separator: "=", maxSplits: 1)
        if pair.count == 2, let value = Int(pair[1]) {
          out[String(pair[0])] = value
        }
      }
      return out
    }
    guard let ok else { return parse() }
    let deadline = Date().addingTimeInterval(timeout)
    var echo = parse()
    while !ok(echo) && Date() < deadline {
      Thread.sleep(forTimeInterval: 0.2)
      echo = parse()
    }
    return echo
  }

  /// Back to the top of the page, dragging the right-edge strip no ContextMenu covers.
  private func contextMenuToTop() throws {
    let scroll = try required("ctx-scroll", as: "the ContextMenu screen's ScrollView")
    for _ in 0..<4 where (contextMenuEcho()["scrollY"] ?? 0) > 0 {
      scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.2))
        .press(
          forDuration: 0.05,
          thenDragTo: scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.9))
        )
      Thread.sleep(forTimeInterval: 0.8)
    }
  }

  /// Scroll slowly (no fling) until the element lies wholly inside the page's ScrollView.
  private func contextMenuReveal(_ identifier: String) throws -> XCUIElement {
    let scroll = try required("ctx-scroll", as: "the ContextMenu screen's ScrollView")
    var element = try required(identifier, as: identifier)
    for _ in 0..<8 {
      let frame = element.frame
      if frame.minY >= scroll.frame.minY + 4, frame.maxY <= scroll.frame.maxY - 4 {
        return element
      }
      let delta: CGFloat = frame.maxY > scroll.frame.maxY - 4 ? -140 : 140
      let start = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.6))
      start.press(
        forDuration: 0.3,
        thenDragTo: start.withOffset(CGVector(dx: 0, dy: delta)),
        withVelocity: 300,
        thenHoldForDuration: 0.3
      )
      Thread.sleep(forTimeInterval: 0.8)
      element = try required(identifier, as: identifier)
    }
    return element
  }

  /// Close an open context menu by tapping the dimmed area on the side away from its rows,
  /// then wait out UIKit's dismissal (a hold that starts during it is ignored). Not the top
  /// edge: a tap in the status-bar band leaves the menu up.
  private func contextMenuDismiss(rows: [String]) {
    let screen = app.frame
    let menuUp = { rows.contains(where: { self.optionLabels(containing: $0) > 0 }) }
    for attempt in 0..<3 where menuUp() {
      let shown = rows.map { optionRow($0) }.filter { $0.exists }
      let mid = shown.isEmpty
        ? screen.midY : shown.map { $0.frame.midY }.reduce(0, +) / CGFloat(shown.count)
      let dy: CGFloat = mid < screen.midY ? 0.88 : 0.18
      let dx: CGFloat = [0.5, 0.15, 0.85][attempt]
      app.coordinate(withNormalizedOffset: CGVector(dx: dx, dy: dy)).fingerTap()
      let deadline = Date().addingTimeInterval(3)
      while menuUp() && Date() < deadline {
        Thread.sleep(forTimeInterval: 0.25)
      }
    }
    if menuUp() {
      dumpHierarchy("the context menu to close: still up after three outside taps")
    }
    Thread.sleep(forTimeInterval: 1.0)
  }

  // MARK: - Chip

  func testRealInputChip() throws {
    try goToTab(Tab.chipTab, showing: Echo.chipValue)
    let filter = try required("real-input-chip", as: "the controlled filter chip")
    let disabled = try required("real-input-chip-disabled", as: "the disabled filter chip")
    let assist = try required("real-input-chip-assist", as: "the assist chip")
    let assistDisabled = try required(
      "real-input-chip-assist-disabled", as: "the disabled assist chip")
    XCTAssertEqual(try read(Echo.chipValue), "off", "the filter chip should start unselected")
    XCTAssertEqual(try read(Echo.chipEvents), "0", "no change should be reported before a tap")
    XCTAssertEqual(
      nativeChipState(of: "real-input-chip"), "off",
      "the filter chip's own element should start by announcing itself not selected")

    XCTAssertEqual(
      try tapUntilValue(
        "real-input-chip",
        echo: Echo.chipValue,
        expected: "on",
        as: "the controlled filter chip",
        waitingFor: "the real tap that selects the chip",
        nativeState: { self.nativeChipState(of: "real-input-chip") }
      ),
      "on",
      "one real tap should select the filter chip and React should render on"
    )
    XCTAssertEqual(
      waitForChipState("real-input-chip", "on"), "on",
      "the selected chip's element should announce itself selected")
    XCTAssertEqual(
      try tapUntilValue(
        "real-input-chip",
        echo: Echo.chipValue,
        expected: "off",
        as: "the controlled filter chip",
        waitingFor: "the real tap that deselects the chip",
        nativeState: { self.nativeChipState(of: "real-input-chip") }
      ),
      "off",
      "a second real tap should deselect the chip"
    )
    XCTAssertEqual(try read(Echo.chipEvents), "2", "two taps should report two changes")
    XCTAssertEqual(
      waitForChipState("real-input-chip", "off"), "off",
      "the deselected chip's element should stop announcing itself selected")

    for request in ["1", "2"] {
      XCTAssertEqual(
        try tapUntilValue(
          "real-input-chip-refusing",
          echo: Echo.chipRefusedEvents,
          expected: request,
          as: "the refusing filter chip",
          waitingFor: "refused request \(request)"
        ),
        request,
        "each real tap on the refusing chip should reach onSelectedChange"
      )
      XCTAssertEqual(
        try read(Echo.chipRefusedLast), "true",
        "refused request \(request) should ask for true: a chip that kept the refused "
          + "selection would ask for false on the second tap"
      )
      XCTAssertEqual(
        waitForChipState("real-input-chip-refusing", "off"), "off",
        "the refused chip should snap back to not selected after request \(request)")
    }

    XCTAssertEqual(
      try tapUntilValue(
        "real-input-chip-assist",
        echo: Echo.chipPresses,
        expected: "1",
        as: "the assist chip",
        waitingFor: "the real tap on the assist chip"
      ),
      "1",
      "one real tap on the assist chip should reach onPress once"
    )

    XCTAssertFalse(
      chipElement(of: "real-input-chip-disabled")?.isEnabled ?? true,
      "the disabled filter chip's element should announce itself dimmed")
    disabled.fingerTap()
    assistDisabled.fingerTap()
    XCTAssertEqual(
      readUntil(Echo.chipEvents, timeout: 1.5) { $0 != "2" }, "2",
      "a real tap on the disabled filter chip should be refused")
    XCTAssertEqual(
      readUntil(Echo.chipPresses, timeout: 1.5) { $0 != "1" }, "1",
      "a real tap on the disabled assist chip should be refused")
    XCTAssertEqual(try read(Echo.chipValue), "off", "the refused taps should leave the chip off")

    XCTAssertEqual(
      try tapUntilValue(
        "real-input-chip-assist",
        echo: Echo.chipPresses,
        expected: "2",
        as: "the assist chip",
        waitingFor: "the barrier tap on the assist chip"
      ),
      "2",
      "the enabled assist chip, tapped the same way, should still press"
    )
    XCTAssert(filter.isHittable, "the filter chip should still be touchable")
    XCTAssert(assist.isHittable, "the assist chip should still be touchable")
  }

  /// The chip's own accessibility element: the SwiftUI control inside the React Native
  /// component view that carries the `testID`.
  private func chipElement(of identifier: String) -> XCUIElement? {
    let container = app.descendants(matching: .any)[identifier].firstMatch
    guard container.exists else { return nil }
    // A filter chip's `Toggle(.button)` is reported as a switch, an assist chip's `Button` as
    // a button.
    for type in [XCUIElement.ElementType.`switch`, .button] {
      let inner = container.descendants(matching: type).firstMatch
      if inner.exists { return inner }
    }
    return nil
  }

  /// Whether the chip's element says it is selected, as "on"/"off", or nil when nothing
  /// answers. The filter chip's element answers with `value` 1/0; a selected button would
  /// answer with `isSelected`, so either counts.
  private func nativeChipState(of identifier: String) -> String? {
    guard let element = chipElement(of: identifier) else { return nil }
    if element.isSelected { return "on" }
    let raw = element.value
    let text = (raw as? NSNumber)?.stringValue ?? (raw as? String) ?? ""
    switch text {
    case "1", "1.0", "true": return "on"
    case "0", "0.0", "false", "": return "off"
    default: return nil
    }
  }

  /// Poll a chip's element until it reports `expected` (3 s), and return its last word.
  private func waitForChipState(_ identifier: String, _ expected: String) -> String? {
    let deadline = Date().addingTimeInterval(3)
    var shown = nativeChipState(of: identifier)
    while shown != expected && Date() < deadline {
      Thread.sleep(forTimeInterval: 0.2)
      shown = nativeChipState(of: identifier)
    }
    if shown != expected {
      dumpHierarchy("\(identifier) never announced \(expected)")
    }
    return shown
  }

  // MARK: - Checkbox

  /// iOS has no checkbox, so every style is SwiftUI's `Toggle`, which XCUITest reports as a
  /// switch-type element with `value` 0/1.
  func testRealInputCheckbox() throws {
    try goToTab(Tab.checkboxTab, showing: Echo.checkboxValue)
    let enabled = try required("real-input-checkbox", as: "the controlled Checkbox")
    let disabled = try required("real-input-checkbox-disabled", as: "the disabled Checkbox")
    XCTAssertEqual(
      try read(Echo.checkboxValue), "off",
      "the Checkbox should start unchecked before any touch is delivered"
    )
    XCTAssertEqual(
      try read(Echo.checkboxEvents), "0",
      "no change should be reported before a tap"
    )
    XCTAssertEqual(
      try read(Echo.checkboxDisabledEvents), "0",
      "the counter the disabled Checkbox reports into should start at zero, so a stray "
        + "delivery is a number that moved rather than a callback nobody saw"
    )
    XCTAssertEqual(
      nativeSwitchState(of: "real-input-checkbox"), "off",
      "the Checkbox's own element should start by reporting value 0"
    )

    // Every tap below aims at the row's middle. The glyph is a square of the row's height at
    // its left, so in a row more than twice as wide as it is tall that middle is on the label:
    // the taps ask whether touching the label touches the control.
    let glyph = enabled.descendants(matching: .`switch`).allElementsBoundByIndex.min {
      $0.frame.width < $1.frame.width
    }
    XCTAssertNotNil(glyph, "the Checkbox should offer a switch element of its own")
    XCTAssert(
      enabled.frame.width > enabled.frame.height * 2,
      "the row is \(enabled.frame.width) x \(enabled.frame.height) - the glyph is a square of "
        + "the row's height at its left, so a press at x=\(enabled.frame.midX) only asks about "
        + "the label while the row is more than twice as wide as it is tall"
    )

    XCTAssertEqual(
      try tapUntilValue(
        "real-input-checkbox",
        echo: Echo.checkboxValue,
        expected: "on",
        as: "the controlled Checkbox",
        waitingFor: "the real tap that checks the box",
        nativeState: { self.nativeSwitchState(of: "real-input-checkbox") }
      ),
      "on",
      "one real tap should check the Checkbox, and React should render \"on\""
    )
    XCTAssertEqual(
      waitForNativeSwitchState("real-input-checkbox", "on"), "on",
      "the checked Checkbox's own element should report value 1"
    )
    XCTAssertEqual(
      try read(Echo.checkboxEvents), "1",
      "one tap should report exactly one change"
    )
    XCTAssertEqual(
      try tapUntilValue(
        "real-input-checkbox",
        echo: Echo.checkboxValue,
        expected: "off",
        as: "the controlled Checkbox",
        waitingFor: "the real tap that unchecks the box",
        nativeState: { self.nativeSwitchState(of: "real-input-checkbox") }
      ),
      "off",
      "a second real tap should ask for false: the value echo going back to \"off\" and "
        + "the element back to value 0 is what rules out a native toggle that always "
        + "requests true, which the tap above cannot see"
    )
    XCTAssertEqual(
      waitForNativeSwitchState("real-input-checkbox", "off"), "off",
      "the unchecked Checkbox's own element should report value 0 again"
    )
    XCTAssertEqual(
      try read(Echo.checkboxEvents), "2",
      "two taps should report two changes, one per tap"
    )

    // No `nativeState` witness here: a refused toggle moves natively and is pushed back by the
    // next render, so its value cannot tell a dropped press from a refused one.
    for request in ["1", "2"] {
      XCTAssertEqual(
        try tapUntilValue(
          "real-input-checkbox-refusing",
          echo: Echo.checkboxRefusedEvents,
          expected: request,
          as: "the refusing Checkbox",
          waitingFor: "refused request \(request)"
        ),
        request,
        "each real tap on the refusing Checkbox should reach onCheckedChange"
      )
      XCTAssertEqual(
        try read(Echo.checkboxRefusedLast), "true",
        "refused request \(request) should ask for true: a Checkbox that kept the refused "
          + "selection would ask for false on the second tap"
      )
      XCTAssertEqual(
        waitForNativeSwitchState("real-input-checkbox-refusing", "off"), "off",
        "the refused Checkbox should snap back to value 0 after request \(request)"
      )
    }

    disabled.fingerTap()
    XCTAssertEqual(
      readUntil(Echo.checkboxDisabledEvents, timeout: 1.5) { $0 != "0" }, "0",
      "a real tap on the disabled Checkbox should be refused"
    )
    XCTAssertEqual(
      readUntil(Echo.checkboxEvents, timeout: 1.5) { $0 != "2" }, "2",
      "nothing reached the enabled Checkbox's counter either: the press was aimed at the "
        + "disabled row, and a reading that stayed put is also what says it landed there "
        + "and was refused rather than on the row above it"
    )
    XCTAssertEqual(
      try read(Echo.checkboxValue), "off",
      "the refused tap should leave the value echo where it was"
    )

    XCTAssertEqual(
      try tapUntilValue(
        "real-input-checkbox",
        echo: Echo.checkboxValue,
        expected: "on",
        as: "the controlled Checkbox",
        waitingFor: "the barrier tap on the enabled Checkbox",
        nativeState: { self.nativeSwitchState(of: "real-input-checkbox") }
      ),
      "on",
      "the enabled Checkbox, tapped the same way, should still answer"
    )
    XCTAssert(enabled.isHittable, "the controlled Checkbox should still be touchable")

    // A press on the glyph must report exactly one event. The row carries a tap target of its
    // own, and a control that answered through both it and the `Toggle`'s gesture would
    // report two.
    let glyphBefore = Int(try read(Echo.checkboxEvents)) ?? -1
    let glyphWanted = String(glyphBefore + 1)
    // The leftmost 8% of the row is inside the glyph. The element is the whole row, so its
    // centre would be one more press on the label.
    enabled.atFraction(0.08).fingerTap()
    // Read twice, with a pause between: a surplus event can arrive after the count is reached.
    XCTAssertEqual(
      readUntil(Echo.checkboxEvents, timeout: 3) { $0 != "\(glyphBefore)" }, glyphWanted,
      "a real tap on the switch's own glyph should report exactly one change (the counter "
        + "was at \"\(glyphBefore)\")"
    )
    Thread.sleep(forTimeInterval: 0.5)
    XCTAssertEqual(
      try read(Echo.checkboxEvents), glyphWanted,
      "one press on the glyph is one `onCheckedChange`, no more, after a quiet period"
    )
    XCTAssertEqual(
      readUntil(Echo.checkboxValue, timeout: 3) { $0 == "off" }, "off",
      "a real tap on the switch's own glyph should flip the Checkbox, and the value echo "
        + "should follow it to \"off\""
    )
    XCTAssertEqual(
      waitForNativeSwitchState("real-input-checkbox", "off"), "off",
      "the tapped glyph's own element should report the value it was tapped into"
    )

    let switched = try required(
      "real-input-checkbox-switch", as: "the switch-style Checkbox")
    XCTAssertEqual(
      nativeSwitchState(of: "real-input-checkbox-switch"), "off",
      "the switch-style Checkbox should start by reporting value 0, like the default one"
    )
    XCTAssertEqual(
      try read(Echo.checkboxSwitchEvents), "0",
      "the switch-style Checkbox should have reported no change before a touch"
    )
    // SwiftUI's `.switch` puts its label on the left and its thumb on the right, the reverse
    // of the glyph row. Both rows still have their middle on the label's side.
    let switchGlyph = switched.descendants(matching: .`switch`).allElementsBoundByIndex.min {
      $0.frame.width < $1.frame.width
    }
    XCTAssertNotNil(switchGlyph, "the switch-style Checkbox should offer a switch element too")
    XCTAssert(
      (switchGlyph?.frame.minX ?? .greatestFiniteMagnitude) > switched.frame.midX,
      "the switch thumb starts at x=\(switchGlyph?.frame.minX ?? -1) and the row's middle is "
        + "at x=\(switched.frame.midX) - if the switch style's glyph has moved, its row is no "
        + "longer the layout D47 promised to leave alone"
    )
    XCTAssertEqual(
      try tapUntilValue(
        "real-input-checkbox-switch",
        echo: Echo.checkboxSwitchEvents,
        expected: "1",
        as: "the switch-style Checkbox",
        waitingFor: "the real tap that checks the switch-style box",
        nativeState: { self.nativeSwitchState(of: "real-input-checkbox-switch") }
      ),
      "1",
      "one real tap on the switch style's label should check it and report one change"
    )
    XCTAssertEqual(
      waitForNativeSwitchState("real-input-checkbox-switch", "on"), "on",
      "the switch style's element should report value 1, as it did before the style prop "
        + "existed - the same witness, the same answer"
    )
    XCTAssertEqual(
      try tapUntilValue(
        "real-input-checkbox-switch",
        echo: Echo.checkboxSwitchEvents,
        expected: "2",
        as: "the switch-style Checkbox",
        waitingFor: "the real tap that unchecks the switch-style box",
        nativeState: { self.nativeSwitchState(of: "real-input-checkbox-switch") }
      ),
      "2",
      "a second real tap should ask for false: two presses, two events, both directions"
    )
    XCTAssertEqual(
      waitForNativeSwitchState("real-input-checkbox-switch", "off"), "off",
      "the switch style should snap its element back to value 0 on the second press"
    )
    Thread.sleep(forTimeInterval: 0.5)
    XCTAssertEqual(
      try read(Echo.checkboxSwitchEvents), "2",
      "two presses on the switch style are two `onCheckedChange`s after a quiet period, "
        + "which is the count a row handler and a gesture both answering would break"
    )

    // SwiftUI's `Toggle` has two positions, so the component sets the accessibility value
    // "mixed" for the indeterminate state. Required here: one element, the label as its name,
    // and "mixed" as its value.
    let mixedRow = try required(
      "real-input-checkbox-mixed", as: "the mixed Checkbox")
    let mixedNodes: [A11yNode] = [A11yNode(element: mixedRow)]
      + mixedRow
        .descendants(matching: .any)
        .allElementsBoundByIndex
        .map(A11yNode.init(element:))
    for node in mixedNodes {
      print(
        "real-input checkbox mixed a11y trait=\(quoted(node.traitName)) "
          + "enabled=\(node.enabled) hittable=\(node.hittable) "
          + "id=\(quoted(node.identifier)) label=\(quoted(node.label)) "
          + "value=\(quoted(node.valueText))"
      )
    }
    let announced = mixedNodes
      .map { "\($0.traitName)|\($0.label)|\($0.valueText)" }
      .joined(separator: "  ")
    // The React Native wrapper carries the testID and the name too, so it is not counted as
    // a stop.
    let stops = mixedNodes.filter { $0.identifier != "real-input-checkbox-mixed" }
    let toggles = stops.filter { $0.traitName == "switch" }
    XCTAssertEqual(
      toggles.count, 1,
      "the mixed Checkbox should be one toggle for a reader - the tree read: \(announced)"
    )
    XCTAssertEqual(
      toggles.first?.label, "Real-input mixed checkbox",
      "the toggle's name should be the accessibility label it was given - the tree read: "
        + "\(announced)"
    )
    XCTAssertEqual(
      toggles.first?.valueText, "mixed",
      "the third state should be announced as \"mixed\" - the word Apple uses for a "
        + "checkbox that is partly on (`NSButton.allowsMixedState`), not Android's: Compose "
        + "renders its third state as \"Partially checked\", which is why step 8 below also "
        + "asks what the value does once the dash is gone - the tree read: \(announced)"
    )
    // Neither the symbol nor the row's text may be a second named stop.
    let secondStops = stops.filter { !$0.label.isEmpty && $0.traitName != "switch" }
    XCTAssertEqual(
      secondStops.count, 0,
      "the glyph and the label must be announced as part of the control and not as stops "
        + "of their own - the tree read: \(announced)"
    )

    // The fixture is uncontrolled and reports nothing, so one press is the whole state change
    // and the announced value is the only witness that the dash ended.
    let mixedToggle = mixedRow.descendants(matching: .`switch`).firstMatch
    XCTAssert(
      mixedToggle.waitForExistence(timeout: 3),
      "the mixed Checkbox should still offer its toggle to a reader before the press"
    )
    let valueBefore = A11yNode(element: mixedToggle).valueText
    XCTAssertEqual(
      try pressUntil(
        named: "the mixed Checkbox",
        waitingFor: "the real tap that resolves the dash",
        press: { _ in mixedRow.atFraction(0.5).fingerTap() },
        // XCUITest formats a numeric value as "1" or "1.0"; both mean checked.
        reading: {
          let shown = A11yNode(element: mixedToggle).valueText
          return shown == "1.0" ? "1" : shown
        }
      ) { $0 == "1" },
      "1",
      "a real tap on the mixed Checkbox should check it and hand a reader value 1, not the "
        + "word for the state that was just replaced - before the tap the element answered "
        + "\(quoted(valueBefore))"
    )
  }

  /// Poll one item's element until it reports `expected`, and return its last word.
  private func waitForItemState(
    _ identifier: String,
    _ title: String,
    _ expected: String
  ) -> String? {
    let deadline = Date().addingTimeInterval(3)
    var shown = nativeItemState(of: identifier, title)
    while shown != expected && Date() < deadline {
      Thread.sleep(forTimeInterval: 0.2)
      shown = nativeItemState(of: identifier, title)
    }
    if shown != expected {
      dumpHierarchy("\(identifier) item \"\(title)\" never announced \(expected)")
    }
    return shown
  }

  // MARK: - ButtonGroup

  /// One item of a ButtonGroup, found by title inside that group's own container, because
  /// several groups on this screen draw an item with the same title. `.any` rather than
  /// `.button`: an action item is a `Button` and a toggle item is a `Toggle` drawn in the
  /// library's own style, which XCUITest reports as a switch.
  private func buttonGroupItem(_ identifier: String, titled title: String) -> XCUIElement {
    app
      .descendants(matching: .any)[identifier].firstMatch
      .descendants(matching: .any)
      .matching(NSPredicate(format: "label == %@", title))
      .firstMatch
  }

  /// Like `required`, for one item inside a group: waits for it, and fails with both
  /// names when the row never drew it.
  private func requiredItem(
    _ identifier: String,
    _ title: String,
    timeout: TimeInterval = 10
  ) throws -> XCUIElement {
    let item = buttonGroupItem(identifier, titled: title)
    if !item.waitForExistence(timeout: timeout) {
      dumpHierarchy("no item \"\(title)\" inside \"\(identifier)\" after \(timeout)s")
      XCTFail(
        "the group \"\(identifier)\" drew no item labelled \"\(title)\" within \(timeout)s, "
          + "so no real tap can be aimed at it"
      )
      throw RealInputCheckAborted(identifier: "\(identifier)/\(title)")
    }
    return item
  }

  /// What one toggle item tells a screen reader: that the group offers exactly one element to act
  /// on for it, that the element is a toggle, which state it is in, and that the state is told once
  /// — a reader is given a switch's value, and a `selected` trait on top of it is the same word
  /// twice. Type, value and state all come from that one element, so a row that draws a second one
  /// for the item cannot answer the question through the first.
  private func assertToggleElement(
    _ identifier: String,
    _ title: String,
    state expected: String,
    file: StaticString = #filePath,
    line: UInt = #line
  ) {
    let items = actionableButtonGroupItems(identifier, titled: title)
    if items.count != 1 {
      dumpHierarchy(
        "the group \"\(identifier)\" offers \(items.count) elements for the toggle item "
          + "\"\(title)\""
      )
    }
    XCTAssertEqual(
      items.count,
      1,
      "the group \"\(identifier)\" offers \(items.count) elements to a reader for the toggle "
        + "item \"\(title)\", which hears that item that many times and cannot say which one a "
        + "tap reaches",
      file: file,
      line: line
    )
    guard let item = items.first else { return }
    let said = "\(quoted(item.label)) type=\(item.elementType.rawValue) value=\(String(describing: item.value)) selected=\(item.isSelected)"
    XCTAssertEqual(
      item.elementType,
      .switch,
      "the toggle item \"\(title)\" is not a toggle to VoiceOver: \(said)",
      file: file,
      line: line
    )
    let deadline = Date().addingTimeInterval(3)
    var shown = nativeState(of: item)
    while shown != expected && Date() < deadline {
      Thread.sleep(forTimeInterval: 0.2)
      shown = nativeState(of: item)
    }
    XCTAssertEqual(
      shown,
      expected,
      "the toggle item \"\(title)\" does not say it is \(expected): \(said)",
      file: file,
      line: line
    )
    XCTAssertFalse(
      item.isSelected,
      "the toggle item \"\(title)\" also reports itself selected, so a reader hears its state "
        + "twice: \(said)",
      file: file,
      line: line
    )
  }

  /// The element types a reader can act on, which is every control shape an item of a group can
  /// arrive as. A container or a stray label that repeats the item's name is not one: a reader is
  /// not asked to do anything with it.
  private static let actionableItemTypes: Set<XCUIElement.ElementType> = [
    .button, .cell, .checkBox, .link, .menuItem, .radioButton, .switch, .toggle,
  ]

  /// The elements of one group that a reader can act on under one title. Two of them for one item
  /// is the defect rather than a second thing to read: the reader hears that item twice, and a tap
  /// cannot say which element it moves.
  private func actionableButtonGroupItems(
    _ identifier: String,
    titled title: String
  ) -> [XCUIElement] {
    app
      .descendants(matching: .any)[identifier].firstMatch
      .descendants(matching: .any)
      .matching(NSPredicate(format: "label == %@", title))
      .allElementsBoundByIndex
      .filter { RealInputTests.actionableItemTypes.contains($0.elementType) }
  }

  /// Whether one element says it is checked, as "on"/"off".
  private func nativeState(of item: XCUIElement) -> String? {
    if item.isSelected { return "on" }
    let raw = item.value
    let text = (raw as? NSNumber)?.stringValue ?? (raw as? String) ?? ""
    switch text {
    case "1", "1.0", "true": return "on"
    case "0", "0.0", "false": return "off"
    default: return nil
    }
  }

  /// Whether one item's own element says it is checked, as "on"/"off".
  private func nativeItemState(of identifier: String, _ title: String) -> String? {
    let item = buttonGroupItem(identifier, titled: title)
    guard item.exists else { return nil }
    return nativeState(of: item)
  }

  /// Tap one item until the echo it should move arrives.
  private func tapItemUntilValue(
    _ identifier: String,
    _ title: String,
    echo: String,
    expected: String,
    waitingFor: String,
    nativeState: (() -> String?)? = nil,
    attempts: Int = 3
  ) throws -> String {
    return try pressUntil(
      named: "\"\(title)\" in \(identifier)",
      waitingFor: waitingFor,
      attempts: attempts,
      press: { _ in try self.requiredItem(identifier, title).fingerTap() },
      reading: { self.echoText(echo) },
      nativeState: nativeState
    ) { shown in
      shown == expected
    }
  }

  func testRealInputButtonGroup() throws {
    try goToTab(Tab.buttonGroupTab, showing: Echo.buttonGroupPresses)
    let actions = "real-input-button-group"
    let toggles = "real-input-button-group-toggles"
    let refusing = "real-input-button-group-refusing"
    let disabledItem = "real-input-button-group-disabled-item"
    let disabledGroup = "real-input-button-group-disabled"
    let overflow = "real-input-button-group-overflow"
    let overflowControl = "Real-input overflow control"

    XCTAssertEqual(
      try read(Echo.buttonGroupPresses), "0",
      "no press should be reported before a touch is delivered"
    )
    XCTAssertEqual(
      try read(Echo.buttonGroupPressedId), "none",
      "no item should have been named by a press before a touch"
    )
    XCTAssertEqual(
      try read(Echo.buttonGroupToggleState), "bold",
      "the toggles should start at the set React rendered"
    )
    XCTAssertEqual(
      try read(Echo.buttonGroupToggleEvents), "0",
      "no change should be reported before a tap"
    )
    XCTAssertEqual(
      "\(try read(Echo.buttonGroupRefusedLast)) \(try read(Echo.buttonGroupRefusedEvents))",
      "none 0",
      "the refusing group should have been asked for nothing yet"
    )
    XCTAssertEqual(
      try read(Echo.buttonGroupDisabledEvents), "0",
      "the counter the disabled group and its disabled item report into should start at "
        + "zero, so a stray delivery is a number that moved"
    )
    XCTAssertEqual(
      nativeItemState(of: toggles, "Bold"), "on",
      "the checked toggle item's own element should report value 1"
    )
    assertToggleElement(toggles, "Bold", state: "on")
    assertToggleElement(toggles, "Italic", state: "off")

    for (title, id, count) in [("Copy", "copy", "1"), ("Cut", "cut", "2"), ("Paste", "paste", "3")] {
      XCTAssertEqual(
        try tapItemUntilValue(
          actions,
          title,
          echo: Echo.buttonGroupPresses,
          expected: count,
          waitingFor: "the real tap on the \"\(title)\" item"
        ),
        count,
        "a real tap on \"\(title)\" should report exactly one onPress"
      )
      XCTAssertEqual(
        try read(Echo.buttonGroupPressedId), id,
        "the press should name the item that was tapped, not merely some item"
      )
    }
    XCTAssertEqual(
      "\(try read(Echo.buttonGroupToggleEvents)) \(try read(Echo.buttonGroupToggleState))",
      "0 bold",
      "three presses on the action row should move no toggle"
    )

    XCTAssertEqual(
      try tapItemUntilValue(
        toggles,
        "Italic",
        echo: Echo.buttonGroupToggleState,
        expected: "bold,italic",
        waitingFor: "the real tap that checks \"Italic\"",
        nativeState: { self.nativeItemState(of: toggles, "Italic") }
      ),
      "bold,italic",
      "one real tap should check an unchecked toggle item"
    )
    XCTAssertEqual(
      nativeItemState(of: toggles, "Italic"), "on",
      "the checked item's own element should report value 1"
    )
    assertToggleElement(toggles, "Italic", state: "on")
    XCTAssertEqual(
      try read(Echo.buttonGroupToggleEvents), "1",
      "one tap should report exactly one change"
    )
    XCTAssertEqual(
      try tapItemUntilValue(
        toggles,
        "Italic",
        echo: Echo.buttonGroupToggleState,
        expected: "bold",
        waitingFor: "the real tap that unchecks \"Italic\"",
        nativeState: { self.nativeItemState(of: toggles, "Italic") }
      ),
      "bold",
      "a second real tap should ask for false: the echo back at the old set and the "
        + "element back at value 0 is what rules out a toggle that always requests true"
    )
    XCTAssertEqual(
      nativeItemState(of: toggles, "Italic"), "off",
      "the unchecked item's own element should report value 0 again"
    )
    assertToggleElement(toggles, "Italic", state: "off")
    XCTAssertEqual(
      try read(Echo.buttonGroupToggleEvents), "2",
      "two taps should report two changes — a flip is not a one-way press"
    )

    // No `nativeState` witness here: a refused item moves and is pushed back, so its value
    // cannot tell a dropped press from a refused one.
    for request in ["1", "2"] {
      XCTAssertEqual(
        try tapItemUntilValue(
          refusing,
          "Bold",
          echo: Echo.buttonGroupRefusedEvents,
          expected: request,
          waitingFor: "refused request \(request)"
        ),
        request,
        "each real tap on the refusing group should reach onCheckedChange"
      )
      XCTAssertEqual(
        try read(Echo.buttonGroupRefusedLast), "bold:1",
        "refused request \(request) should ask for true: a group that kept the refused "
          + "change would ask for false on the second tap"
      )
      XCTAssertEqual(
        waitForItemState(refusing, "Bold", "off"), "off",
        "the refused item should snap back to value 0 after request \(request)"
      )
    }

    try requiredItem(disabledItem, "Cut").fingerTap()
    XCTAssertEqual(
      readUntil(Echo.buttonGroupDisabledEvents, timeout: 1.5) { $0 != "0" }, "0",
      "a real tap on the disabled item should be refused"
    )
    try requiredItem(disabledGroup, "Copy").fingerTap()
    XCTAssertEqual(
      readUntil(Echo.buttonGroupDisabledEvents, timeout: 1.5) { $0 != "0" }, "0",
      "a real tap inside the disabled group should be refused too"
    )
    XCTAssertEqual(
      "\(try read(Echo.buttonGroupPresses)) \(try read(Echo.buttonGroupToggleEvents))",
      "3 2",
      "nothing else should answer a tap on the disabled pair"
    )
    // The enabled sibling in the same group still takes a tap. It reports into the disabled
    // pair's own counter, not the presses counter of the actions row.
    XCTAssertEqual(
      try tapItemUntilValue(
        disabledItem,
        "Copy",
        echo: Echo.buttonGroupDisabledEvents,
        expected: "1",
        waitingFor: "the barrier tap beside the disabled item"
      ),
      "1",
      "the enabled item of a group with a disabled sibling should still answer"
    )

    // Six titles cannot share the 220 pt well, so some items are not drawn and are reached
    // through the overflow control.
    XCTAssertFalse(
      buttonGroupItem(overflow, titled: "Quarter").exists,
      "the narrow well should hide \"Quarter\" — the row overflows rather than shrinking"
    )
    XCTAssert(
      buttonGroupItem(overflow, titled: "Day").exists,
      "while an item that fits should still be drawn"
    )
    try tapItemUntilOption(
      overflow,
      titled: overflowControl,
      option: "Quarter",
      waitingFor: "the overflow menu to open"
    )
    XCTAssertEqual(
      try tapOptionUntilValue(
        option: "Quarter",
        echo: Echo.buttonGroupPresses,
        expected: "4",
        waitingFor: "picking the overflowed row"
      ),
      "4",
      "a real tap on the overflowed row should report onPress for it, once"
    )
    XCTAssertEqual(
      try read(Echo.buttonGroupPressedId), "quarter",
      "and it should name the item that came out of the menu"
    )
    waitUntilOptionGone("Quarter", "the overflow menu to close after the pick")
    XCTAssertEqual(
      "\(try read(Echo.buttonGroupPresses)) \(try read(Echo.buttonGroupToggleEvents)) "
        + "\(try read(Echo.buttonGroupDisabledEvents))",
      "4 2 1",
      "four presses and two flips — one more of each than the taps above reported — plus "
        + "the one delivery the barrier tap beside the disabled pair was owed"
    )

    // A group that is disabled while its overflow menu is open must close the menu. The menu
    // is opened first: no rows after the disable is also what a menu that never opened
    // looks like.
    try tapItemUntilOption(
      overflow,
      titled: overflowControl,
      option: "Quarter",
      waitingFor: "the overflow menu to open again, for the disable below"
    )
    XCTAssertGreaterThan(
      optionLabels(containing: "Quarter"),
      0,
      "the menu is up before the flip — without this the assertion below would be true "
        + "of a menu nobody opened"
    )
    try required(
      "button-group-overflow-disable",
      as: "the control that disables the overflowing group"
    ).fingerTap()
    XCTAssertEqual(
      readUntil(Echo.buttonGroupOverflowDisabled) { $0 == "disabled" },
      "disabled",
      "the app should have answered the tap by rendering the group disabled"
    )
    _ = waitUntilOptionGone(
      "Quarter",
      "an open overflow menu to close when its group became disabled"
    )
    XCTAssertEqual(
      optionLabels(containing: "Quarter"),
      0,
      "a disabled group keeps no overflow menu open: its items are not reachable while it "
        + "is disabled, so the open menu is not either"
    )
  }

  // MARK: - IconButton

  /// iOS has no icon button: the press form is a `Button` with an icon-only label and the
  /// toggle form is a `Toggle` in the `.button` style, the same element a filter chip is, so
  /// `nativeChipState` reads it.
  func testRealInputIconButton() throws {
    try goToTab(Tab.iconButtonTab, showing: Echo.iconButtonValue)
    let pressButton = try required(
      "real-input-icon-button", as: "the press icon button")
    let toggle = try required("real-input-icon-button-toggle", as: "the toggle icon button")
    let disabled = try required(
      "real-input-icon-button-disabled", as: "the disabled icon button")
    let disabledToggle = try required(
      "real-input-icon-button-disabled-toggle", as: "the disabled toggle icon button")
    XCTAssert(
      pressButton.isHittable && toggle.isHittable,
      "both enabled controls should be touchable before any tap is delivered"
    )

    XCTAssertEqual(
      try read(Echo.iconButtonPresses), "0",
      "no press should be reported before a touch is delivered"
    )
    XCTAssertEqual(
      try read(Echo.iconButtonValue), "off",
      "the toggle should start off before any touch is delivered"
    )
    XCTAssertEqual(
      try read(Echo.iconButtonEvents), "0",
      "no change should be reported before a tap"
    )
    XCTAssertEqual(
      "\(try read(Echo.iconButtonRefusedLast)) \(try read(Echo.iconButtonRefusedEvents))",
      "none 0",
      "the refusing toggle should have been asked for nothing yet"
    )
    XCTAssertEqual(
      try read(Echo.iconButtonDisabledEvents), "0",
      "the counter the disabled controls report into should start at zero, so a stray "
        + "delivery is a number that moved rather than a callback nobody saw"
    )
    XCTAssertEqual(
      nativeChipState(of: "real-input-icon-button-toggle"), "off",
      "the toggle's own element should start by reporting value 0"
    )

    for count in ["1", "2"] {
      XCTAssertEqual(
        try tapUntilValue(
          "real-input-icon-button",
          echo: Echo.iconButtonPresses,
          expected: count,
          as: "the press icon button",
          waitingFor: "the real tap that makes press \(count)"
        ),
        count,
        "real tap \(count) on the press form should report exactly one onPress"
      )
    }
    XCTAssertEqual(
      try read(Echo.iconButtonValue), "off",
      "a press on the press form should change no toggle"
    )
    XCTAssertEqual(
      try read(Echo.iconButtonEvents), "0",
      "and the toggle should still report no change"
    )

    XCTAssertEqual(
      try tapUntilValue(
        "real-input-icon-button-toggle",
        echo: Echo.iconButtonValue,
        expected: "on",
        as: "the toggle icon button",
        waitingFor: "the real tap that checks the toggle",
        nativeState: { self.nativeChipState(of: "real-input-icon-button-toggle") }
      ),
      "on",
      "one real tap should check the toggle, and React should render \"on\""
    )
    XCTAssertEqual(
      waitForChipState("real-input-icon-button-toggle", "on"), "on",
      "the checked toggle's own element should report value 1"
    )
    XCTAssertEqual(
      try read(Echo.iconButtonEvents), "1",
      "one tap should report exactly one change"
    )
    XCTAssertEqual(
      try tapUntilValue(
        "real-input-icon-button-toggle",
        echo: Echo.iconButtonValue,
        expected: "off",
        as: "the toggle icon button",
        waitingFor: "the real tap that unchecks the toggle",
        nativeState: { self.nativeChipState(of: "real-input-icon-button-toggle") }
      ),
      "off",
      "a second real tap should ask for false: the echo back at \"off\" and the element "
        + "back at value 0 is what rules out a native toggle that always requests true"
    )
    XCTAssertEqual(
      waitForChipState("real-input-icon-button-toggle", "off"), "off",
      "the unchecked toggle's own element should report value 0 again"
    )
    XCTAssertEqual(
      try read(Echo.iconButtonEvents), "2",
      "two taps should report two changes, one per tap"
    )
    XCTAssertEqual(
      try read(Echo.iconButtonPresses), "2",
      "a tap on the toggle should not also be a press on the press form"
    )

    // No `nativeState` witness here: a refused toggle moves and is pushed back, so its value
    // cannot tell a dropped press from a refused one.
    for request in ["1", "2"] {
      XCTAssertEqual(
        try tapUntilValue(
          "real-input-icon-button-refusing",
          echo: Echo.iconButtonRefusedEvents,
          expected: request,
          as: "the refusing toggle icon button",
          waitingFor: "refused request \(request)"
        ),
        request,
        "each real tap on the refusing toggle should reach onCheckedChange"
      )
      XCTAssertEqual(
        try read(Echo.iconButtonRefusedLast), "true",
        "refused request \(request) should ask for true: a toggle that kept the refused "
          + "selection would ask for false on the second tap"
      )
      XCTAssertEqual(
        waitForChipState("real-input-icon-button-refusing", "off"), "off",
        "the refused toggle should snap back to value 0 after request \(request)"
      )
    }

    disabled.fingerTap()
    XCTAssertEqual(
      readUntil(Echo.iconButtonDisabledEvents, timeout: 1.5) { $0 != "0" }, "0",
      "a real tap on the disabled press form should be refused"
    )
    disabledToggle.fingerTap()
    XCTAssertEqual(
      readUntil(Echo.iconButtonDisabledEvents, timeout: 1.5) { $0 != "0" }, "0",
      "a real tap on the disabled toggle should be refused too"
    )
    XCTAssertEqual(
      "\(try read(Echo.iconButtonPresses)) \(try read(Echo.iconButtonValue)) "
        + "\(try read(Echo.iconButtonEvents))",
      "2 off 2",
      "the enabled controls should be left alone by taps on the disabled pair"
    )

    XCTAssertEqual(
      try tapUntilValue(
        "real-input-icon-button-toggle",
        echo: Echo.iconButtonValue,
        expected: "on",
        as: "the toggle icon button",
        waitingFor: "the barrier tap on the enabled toggle",
        nativeState: { self.nativeChipState(of: "real-input-icon-button-toggle") }
      ),
      "on",
      "the enabled toggle, tapped the same way, should still answer"
    )
    XCTAssert(disabled.isHittable, "the disabled control should still be touchable")

    // A tap 2% in from the corner of the 44 pt box is outside the control's own drawing, so
    // only the hit layer behind the control can answer it. One press must report one event.
    let targetBox = pressButton.frame
    XCTAssert(
      targetBox.width >= 43.5 && targetBox.height >= 43.5,
      "the fixture should be laid out at the 44 pt target before a corner is aimed at, "
        + "got \(Int(targetBox.width)) x \(Int(targetBox.height))"
    )
    pressButton.atFraction(0.02, dy: 0.02).fingerTap()
    XCTAssertEqual(
      try read(Echo.iconButtonPresses), "3",
      "a real tap in the corner of the press form's box should press exactly once"
    )
    XCTAssertEqual(
      readUntil(Echo.iconButtonPresses, timeout: 1.0) { $0 != "3" }, "3",
      "and the corner tap should not also reach the control underneath it"
    )
    XCTAssertEqual(
      try tapUntilValue(
        "real-input-icon-button-toggle",
        echo: Echo.iconButtonValue,
        expected: "off",
        as: "the toggle icon button",
        waitingFor: "the real corner tap that flips the toggle",
        nativeState: { self.nativeChipState(of: "real-input-icon-button-toggle") }
      ),
      "off",
      "a real tap in the corner of the toggle's box should flip it once"
    )
    XCTAssertEqual(
      try read(Echo.iconButtonEvents), "4",
      "one flip, one event - a corner tap that reached both layers would report two"
    )
  }

  /// Poll a control's own Switch value until it reports `expected` (3 s), and return its
  /// last reading. SwiftUI paints a tapped toggle before JS has answered, so a snap-back is
  /// only visible after a wait.
  private func waitForNativeSwitchState(_ identifier: String, _ expected: String) -> String? {
    let deadline = Date().addingTimeInterval(3)
    var shown = nativeSwitchState(of: identifier)
    while shown != expected && Date() < deadline {
      Thread.sleep(forTimeInterval: 0.2)
      shown = nativeSwitchState(of: identifier)
    }
    if shown != expected {
      dumpHierarchy("\(identifier) never reported value \(expected == "on" ? "1" : "0")")
    }
    return shown
  }

  // MARK: - Dialog

  /// The dialog is UIKit's `UIAlertController`, presented from a window of the library's own.
  /// The screen's event log records every callback in arrival order.
  func testRealInputDialog() throws {
    try goToTab(Tab.dialogTab, showing: Echo.dialogLog)
    let alertTitle = "Delete the draft?"
    let stickyTitle = "Back and outside do nothing"
    let sheetTitle = "Share the photo"

    XCTAssertEqual(try read(Echo.dialogLog), "none", "no dialog has reported anything before a touch")
    XCTAssertEqual(optionLabels(containing: alertTitle), 0, "no alert is up before a touch")

    try tapUntilOption(
      "dialog-open-alert",
      as: "the alert's opener",
      option: alertTitle,
      waitingFor: "the real tap that opens the alert"
    )
    XCTAssertEqual(app.alerts.count, 1, "the alert variant is presented as one UIKit alert")
    print("real-input (ios): dialog: the alert's identifier is \"\(app.alerts.firstMatch.identifier)\"")
    XCTAssertEqual(try read(Echo.dialogLog), "none", "presenting from JS reports no event")

    XCTAssertFalse(
      optionRow("Locked action").isEnabled,
      "a disabled action should be a button that is not enabled (twin \"Delete draft\" "
        + "isEnabled=\(optionRow("Delete draft").isEnabled))"
    )
    XCTAssertTrue(optionRow("Delete draft").isEnabled, "and an ordinary action should be enabled")

    // Pressed once: the right outcome is silence, so there is nothing to retry towards.
    try waitForOption("Locked action", "the disabled action to be on screen").fingerTap()
    Thread.sleep(forTimeInterval: 1.5)
    XCTAssertEqual(try read(Echo.dialogLog), "none", "a real tap on a disabled action reports nothing")
    XCTAssertGreaterThan(optionLabels(containing: alertTitle), 0, "and the alert stays up")

    XCTAssertEqual(
      try tapOptionUntilValue(
        option: "Delete draft",
        echo: Echo.dialogLog,
        expected: "action:delete > presented:false",
        waitingFor: "the real tap on \"Delete draft\""
      ),
      "action:delete > presented:false",
      "a real tap on an action reports its id, then the close - once each, in that order"
    )
    waitUntilOptionGone(alertTitle, "the action to take the alert down")
    XCTAssertEqual(optionLabels(containing: alertTitle), 0, "an action closes its alert")

    // A tap outside an alert does nothing on iOS whatever `dismissible` says: UIKit offers no
    // way out of an alert but its buttons.
    try tapUntilOption(
      "dialog-open-sticky",
      as: "the sticky alert's opener",
      option: stickyTitle,
      waitingFor: "the real tap that opens the sticky alert"
    )
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.12)).tap()
    Thread.sleep(forTimeInterval: 1.5)
    XCTAssertGreaterThan(optionLabels(containing: stickyTitle), 0, "a tap outside leaves the alert up")
    XCTAssertEqual(
      try read(Echo.dialogLog),
      "action:delete > presented:false",
      "and reports nothing"
    )
    XCTAssertEqual(
      try tapOptionUntilValue(
        option: "Understood",
        echo: Echo.dialogLog,
        expected: "action:delete > presented:false > action:ok > presented:false",
        waitingFor: "the real tap on \"Understood\""
      ),
      "action:delete > presented:false > action:ok > presented:false",
      "its action reports, then the close"
    )
    waitUntilOptionGone(stickyTitle, "the action to take the sticky alert down")

    // A tap outside an action sheet is the Cancel UIKit adds when the app gave no cancel
    // action, so it closes the sheet and reports the close alone.
    try tapUntilOption(
      "dialog-open-sheet",
      as: "the sheet's opener",
      option: "Copy link",
      waitingFor: "the real tap that opens the confirmation sheet"
    )
    XCTAssertEqual(app.sheets.count, 1, "the confirmation variant is presented as one action sheet")
    XCTAssertGreaterThan(optionLabels(containing: sheetTitle), 0, "with its title shown")
    // Whether UIKit draws that Cancel as a button is UIKit's choice, so the buttons are
    // printed rather than asserted.
    let sheetButtons = app.sheets.firstMatch.buttons.allElementsBoundByIndex.map(\.label)
    print(
      "real-input (ios): dialog: the sheet's buttons are \(sheetButtons); "
        + "\(optionLabels(containing: cancelTitle())) element(s) say \"\(cancelTitle())\""
    )
    XCTAssertFalse(optionRow("Locked share").isEnabled, "its disabled action is not enabled")
    let outsideClose = "action:delete > presented:false > action:ok > presented:false > presented:false"
    XCTAssertEqual(
      try pressUntil(
        named: "the dimming view outside the sheet",
        waitingFor: "the tap outside the sheet to close it",
        press: { attempt in
          if attempt > 1 && optionLabels(containing: "Copy link") == 0 {
            return
          }
          app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.12)).tap()
        },
        reading: { self.echoText(Echo.dialogLog) }
      ) { shown in
        shown == outsideClose
      },
      outsideClose,
      "a tap outside a dismissible sheet closes it and reports the close alone"
    )
    waitUntilOptionGone("Copy link", "the tap outside to take the sheet down")

    try tapUntilOption(
      "dialog-open-sheet",
      as: "the sheet's opener",
      option: "Copy link",
      waitingFor: "the real tap that reopens the sheet"
    )
    XCTAssertEqual(
      try tapOptionUntilValue(
        option: "Copy link",
        echo: Echo.dialogLog,
        expected: outsideClose + " > action:copy > presented:false",
        waitingFor: "the real tap on \"Copy link\""
      ),
      outsideClose + " > action:copy > presented:false",
      "a sheet's action reports its id, then the close"
    )
    waitUntilOptionGone("Copy link", "the action to take the sheet down")
  }

  /// The tooltip is a UIKit popover in a window of its own, so "up" is read as its own message
  /// on screen, and the screen's log is read only with the tooltip down.
  func testRealInputTooltip() throws {
    try goToTab(Tab.tooltipTab, showing: Echo.tooltipLog)
    let message = "Tap the star to keep this search."
    let title = "Saved searches"
    let action = "Got it"

    func pressAnchor(_ expected: String, _ waitingFor: String) throws -> String {
      return try pressUntil(
        named: "the star the tooltip points at (tooltip-anchor)",
        waitingFor: waitingFor,
        attempts: 1,
        press: { _ in try required("tooltip-anchor", as: "the tooltip's anchor").fingerTap() },
        reading: { self.echoText(Echo.tooltipPresses) }
      ) { shown in
        shown == expected
      }
    }

    XCTAssertEqual(try read(Echo.tooltipLog), "none", "no tooltip has reported anything before a touch")
    XCTAssertEqual(optionLabels(containing: message), 0, "no tooltip is up before a touch")
    XCTAssertEqual(
      try pressAnchor("star presses: 1", "the real tap on the star"),
      "star presses: 1",
      "a real tap on the anchor of a closed tooltip presses the anchor once"
    )
    Thread.sleep(forTimeInterval: 0.8)
    XCTAssertEqual(optionLabels(containing: message), 0, "and opens nothing")
    XCTAssertEqual(try read(Echo.tooltipLog), "none", "and reports nothing")
    // The tap outside goes to the log line: a `Text` with no press of its own, well above
    // the popover. Its frame is taken while the tooltip is down.
    let logFrame = try required(Echo.tooltipLog, as: "the log line").frame
    let outside = app.coordinate(withNormalizedOffset: .zero)
      .withOffset(CGVector(dx: logFrame.midX, dy: logFrame.midY))

    try tapUntilOption(
      "tooltip-open-rich",
      as: "the rich tooltip's opener",
      option: message,
      waitingFor: "the real tap that opens the rich tooltip"
    )
    XCTAssertGreaterThan(optionLabels(containing: title), 0, "the tooltip shows its title")
    XCTAssertGreaterThan(optionLabels(containing: action), 0, "and its action")
    XCTAssertEqual(app.descendants(matching: .popover).count, 1, "the tooltip is one UIKit popover")
    XCTAssertTrue(
      app.descendants(matching: .any)["tooltip-rich-tooltip"].exists,
      "the presented content carries <testID>-tooltip, for a test or an a11y tool to find"
    )

    // A later attempt taps only while it is still up: once it is down, the log is merely slow.
    XCTAssertEqual(
      try pressUntil(
        named: "the log line outside the tooltip",
        waitingFor: "the tap outside the tooltip to close it",
        press: { attempt in
          if attempt > 1 && optionLabels(containing: message) == 0 {
            return
          }
          outside.tap()
        },
        reading: { self.echoText(Echo.tooltipLog) }
      ) { shown in
        shown == "presented:false"
      },
      "presented:false",
      "a tap outside closes the tooltip and reports the close alone"
    )
    waitUntilOptionGone(message, "the tap outside to take the tooltip down")
    XCTAssertEqual(optionLabels(containing: message), 0, "and the tooltip is gone")

    try tapUntilOption(
      "tooltip-open-rich",
      as: "the rich tooltip's opener",
      option: message,
      waitingFor: "the real tap that reopens the rich tooltip"
    )
    let afterAction = "presented:false > action:ok > presented:false"
    XCTAssertEqual(
      try tapOptionUntilValue(
        option: action,
        echo: Echo.tooltipLog,
        expected: afterAction,
        waitingFor: "the real tap on \"\(action)\""
      ),
      afterAction,
      "a real tap on its action reports the id, then the close - once each, in that order"
    )
    waitUntilOptionGone(message, "the action to take the tooltip down")
    XCTAssertEqual(optionLabels(containing: message), 0, "an action closes its tooltip")

    XCTAssertEqual(
      try pressAnchor("star presses: 2", "the second real tap on the star"),
      "star presses: 2",
      "once it is closed, a real tap on the anchor presses it once more"
    )
    Thread.sleep(forTimeInterval: 0.8)
    XCTAssertEqual(optionLabels(containing: message), 0, "and opens nothing")
    XCTAssertEqual(try read(Echo.tooltipLog), afterAction, "and reports nothing")
  }

  /// The popover is a UIKit popover in a window of its own, so "up" is read as its own content
  /// on screen, and the screen's log is read only with the popover down.
  func testRealInputPopover() throws {
    try goToTab(Tab.popoverTab, showing: Echo.popoverLog)
    let content = "Do the thing"
    let fieldContent = "Rename this list"

    // The tap outside goes to the log line: a `Text` with no press of its own, above every
    // anchor. A fixed point could be a tab or the Reset button, which would zero the counter
    // the ten opens are read from.
    let logFrame = try required(Echo.popoverLog, as: "the log line").frame
    let outside = app.coordinate(withNormalizedOffset: .zero)
      .withOffset(CGVector(dx: logFrame.midX, dy: logFrame.minY + 4))
    func openPopover(_ waitingFor: String) throws {
      try tapUntilPopoverUp(
        "popover-short-anchor",
        as: "the popover's anchor",
        content: content,
        waitingFor: waitingFor
      )
    }

    XCTAssertEqual(try read(Echo.popoverLog), "none", "no popover has reported anything before a touch")
    XCTAssertEqual(optionLabels(containing: content), 0, "no popover is up before a touch")
    XCTAssertEqual(echoText(Echo.popoverPresses), "inner presses: 0", "nothing has been pressed inside")

    try openPopover("the real tap that opens the popover")
    XCTAssertTrue(
      app.descendants(matching: .any)["popover-short-popover"].exists,
      "the presented content carries <testID>-popover, for a test or an a11y tool to find"
    )
    let rowFrame = try required("popover-short-inner-press", as: "the row inside the popover").frame
    print(
      "real-input (ios): popover: \(app.descendants(matching: .popover).count) UIKit "
        + "popover(s); the row inside it is at \(rowFrame)"
    )

    // A later attempt taps only while it is still up: once it is down, the log is merely slow.
    let outsideClose = "short:presented:false > short:dismiss"
    XCTAssertEqual(
      try pressUntil(
        named: "the log line outside the popover",
        waitingFor: "the tap outside the popover to close it",
        press: { attempt in
          if attempt > 1 && optionLabels(containing: content) == 0 {
            return
          }
          outside.tap()
        },
        reading: { self.echoText(Echo.popoverLog) }
      ) { shown in
        shown == outsideClose
      },
      outsideClose,
      "a tap outside closes the popover and reports the close, then the dismiss"
    )
    waitUntilOptionGone(content, "the tap outside to take the popover down")

    // Ten opens with one tap inside each must end on exactly ten presses. The re-read after a
    // settle catches a second press that arrives late.
    for opened in 1...10 {
      try openPopover("the real tap that opens the popover for open number \(opened)")
      try required("popover-short-inner-press", as: "the Pressable inside the popover").fingerTap()
      waitUntilOptionGone(content, "the press inside the popover to close it (open \(opened))")
      let once = "inner presses: \(opened)"
      XCTAssertTrue(
        waitUntil({ self.echoText(Echo.popoverPresses) == once }, window: 8),
        "one injected tap inside reaches JS exactly once (open \(opened)): "
          + "the screen says \"\(echoText(Echo.popoverPresses))\""
      )
      Thread.sleep(forTimeInterval: 0.8)
      XCTAssertEqual(
        echoText(Echo.popoverPresses),
        once,
        "and no second press arrives after open \(opened)"
      )
      if opened == 1 {
        // The press reports, then the dismiss. That close is the app's own, so there is no
        // `presented:false`: only a close the popover decided for itself reports one.
        XCTAssertTrue(
          try read(Echo.popoverLog).hasSuffix("press:popover-short > short:dismiss"),
          "the press inside reports, then the dismiss its own close causes"
        )
      }
    }
    XCTAssertEqual(echoText(Echo.popoverPresses), "inner presses: 10", "ten opens, ten presses inside, and no more")

    // UIKit moves a popover that has no room above the keyboard, so what is asserted is that
    // the content ends up visible above the keyboard. Whether it moved is only printed.
    try tapUntilPopoverUp(
      "popover-field-anchor",
      as: "the field popover's anchor",
      content: fieldContent,
      waitingFor: "the real tap that opens the popover with a field"
    )
    let field = try required("popover-inner-field", as: "the TextInput inside the popover")
    let beforeField = field.frame
    try focusByTap(field, echo: nil, as: "the TextInput inside the popover")
    let keyboard = app.keyboards.firstMatch
    XCTAssertTrue(keyboard.waitForExistence(timeout: 8), "a real tap on the field inside the popover brings up the keyboard")
    let afterField = try required("popover-inner-field", as: "the field with the keyboard up").frame
    let keyboardTop = keyboard.frame.minY
    print(
      "real-input (ios): popover: field \(beforeField) -> \(afterField) with the keyboard "
        + "top at \(keyboardTop)"
    )
    XCTAssertLessThanOrEqual(
      afterField.maxY,
      keyboardTop + 1,
      "the field stays visible above the keyboard (field bottom \(afterField.maxY), keyboard top \(keyboardTop))"
    )
    // One character at a time, each waited for while the popover is still up. A second key
    // sent before the first has round-tripped through JS can be overwritten by the controlled
    // value, and a keystroke still queued is lost when the close unmounts the field.
    field.typeText("a")
    var typedWhileUp = ""
    let firstArrived = waitUntil({
      typedWhileUp = echoText(Echo.popoverLog)
      return typedWhileUp.contains("typed:a")
    }, window: 10)
    XCTAssertTrue(
      firstArrived,
      "the first real keystroke reaches the field inside the popover while it is still up: "
        + typedWhileUp
    )
    field.typeText("b")
    let keystrokesArrived = waitUntil({
      typedWhileUp = echoText(Echo.popoverLog)
      return typedWhileUp.contains("typed:ab")
    }, window: 10)
    XCTAssertTrue(
      keystrokesArrived,
      "both real keystrokes reach the field inside the popover while it is still up: "
        + typedWhileUp
    )
    outside.tap()
    waitUntilOptionGone(fieldContent, "the outside tap to take the field popover down")
    // The log records the field popover's close after the keystrokes, so the order is
    // asserted rather than a suffix.
    let typedLog = try read(Echo.popoverLog)
    let typedAt = typedLog.range(of: "typed:ab")
    let closedAt = typedLog.range(of: "field:presented:false", options: .backwards)
    XCTAssertTrue(
      typedAt != nil && closedAt != nil && typedAt!.lowerBound < closedAt!.lowerBound,
      "real keystrokes reach the field inside the popover, before its own close: "
        + "\(echoText(Echo.popoverLog))"
    )

    XCTAssertEqual(optionLabels(containing: content), 0, "nothing is left up at the end")
    XCTAssertEqual(optionLabels(containing: fieldContent), 0, "and no field popover either")
  }

  /// The screen's log is read only with every sheet down: a presented sheet is modal to
  /// VoiceOver, which keeps the app's own elements out of the tree XCUITest reads while it is
  /// up. Inside the sheet, `sheet-presses` is the sheet's own echo.
  func testRealInputBottomSheet() throws {
    try goToTab(Tab.sheetTab, showing: Echo.sheetLog)
    XCTAssertEqual(try read(Echo.sheetLog), "none", "no sheet has reported anything before a touch")
    XCTAssertFalse(
      app.descendants(matching: .any)["sheet-press"].exists,
      "the sheet's content is not mounted before it is presented"
    )

    try tapUntilElement("sheet-open-fit", as: "the fit sheet's opener", appears: "sheet-press")
    // The sheet's own view carries `<testID>-sheet`, for a test or an a11y tool to find.
    _ = try required("sheet-fit-sheet", as: "the presented sheet, by its testID")
    let pressable = try required("sheet-press", as: "the Pressable inside the sheet")
    let title = try required("sheet-fit-title", as: "the fit sheet's title")
    XCTAssertGreaterThan(
      title.frame.minY,
      app.frame.height * 0.4,
      "a fit sheet sits low on the screen, as tall as its content (title at \(title.frame))"
    )

    XCTAssertEqual(
      try pressUntil(
        named: "the Pressable inside the sheet",
        waitingFor: "the real tap inside the sheet to reach JS",
        press: { _ in pressable.fingerTap() },
        reading: { self.echoText(Echo.sheetPresses) }
      ) { shown in
        shown == "Pressed 1 times"
      },
      "Pressed 1 times",
      "a real tap inside the sheet presses its Pressable once"
    )

    try dragSheetDown(from: "sheet-fit-title", until: "sheet-press")
    XCTAssertEqual(
      readUntil(Echo.sheetLog) { $0 == "press:1 > presented:false > dismiss" },
      "press:1 > presented:false > dismiss",
      "a drag down reports the close, then the dismissal - and the press before them"
    )

    try tapUntilElement("sheet-open-fit", as: "the fit sheet's opener", appears: "sheet-press")
    try tapOutsideSheet(until: "sheet-press")
    XCTAssertEqual(
      readUntil(Echo.sheetLog) { $0.hasSuffix("dismiss > presented:false > dismiss") },
      "press:1 > presented:false > dismiss > presented:false > dismiss",
      "a tap outside reports the close, then the dismissal"
    )

    try tapUntilElement("sheet-open-sticky", as: "the sticky sheet's opener", appears: "sheet-sticky-close")
    let stickyTitle = try required("sheet-sticky-title", as: "the sticky sheet's title")
    stickyTitle.centre.press(
      forDuration: 0.05,
      thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.98))
    )
    Thread.sleep(forTimeInterval: 1.5)
    XCTAssertTrue(
      app.descendants(matching: .any)["sheet-sticky-close"].exists,
      "a drag down leaves a sticky sheet up"
    )
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.1)).fingerTap()
    Thread.sleep(forTimeInterval: 1.5)
    XCTAssertTrue(
      app.descendants(matching: .any)["sheet-sticky-close"].exists,
      "and so does a tap outside"
    )
    try pressUntil(
      named: "the sticky sheet's own button",
      waitingFor: "the real tap on the sticky sheet's button to close it",
      press: { attempt in
        let close = self.app.descendants(matching: .any)["sheet-sticky-close"]
        if attempt > 1 && !close.exists { return }
        close.fingerTap()
      },
      reading: { self.app.descendants(matching: .any)["sheet-sticky-close"].exists ? "up" : "gone" }
    ) { shown in
      shown == "gone"
    }
    XCTAssertEqual(
      readUntil(Echo.sheetLog) { $0.hasSuffix("close > dismiss") },
      "press:1 > presented:false > dismiss > presented:false > dismiss > close > dismiss",
      "only the sticky sheet's own button closed it, and that close is the app's: no presented:false"
    )

    try tapUntilElement("sheet-open-two", as: "the two-detent sheet's opener", appears: "sheet-two-header")
    let header = try required("sheet-two-header", as: "the two-detent sheet's header")
    let mediumTop = header.frame.minY
    header.centre.press(
      forDuration: 0.1,
      thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.05))
    )
    let largeTop = waitForFrame("sheet-two-header") { $0.minY < mediumTop - 100 }
    print("real-input (ios): bottom-sheet: header from y=\(mediumTop) to y=\(largeTop.minY)")
    // A drag down from large may stop at medium first (UIKit reports that as detent 0)
    // and the helper drags again, so the log is read for what it must contain.
    try dragSheetDown(from: "sheet-two-header", until: "sheet-two-header")
    let twoLog = readUntil(Echo.sheetLog) { $0.hasSuffix("presented:false > dismiss") && $0.contains("detent:1") }
    print("real-input (ios): bottom-sheet: log after the two-detent sheet: \(twoLog)")
    XCTAssertTrue(
      twoLog.hasPrefix(
        "press:1 > presented:false > dismiss > presented:false > dismiss > close > dismiss > detent:1"),
      "a drag up reports detent 1 after everything before it (log: \(twoLog))"
    )
    XCTAssertTrue(
      twoLog.hasSuffix("presented:false > dismiss"),
      "and a drag down closes it, reported as the close, then the dismissal (log: \(twoLog))"
    )
  }

  /// Tap a plain RN element until another element appears (a sheet's content).
  private func tapUntilElement(_ identifier: String, as what: String, appears other: String) throws {
    try pressUntil(
      named: "\(what) (\(identifier))",
      waitingFor: "the real tap on \(identifier) to bring up \(other)",
      press: { attempt in
        if attempt > 1 && self.app.descendants(matching: .any)[other].exists { return }
        try self.required(identifier, as: what).fingerTap()
      },
      reading: { self.app.descendants(matching: .any)[other].exists ? "up" : "down" }
    ) { shown in
      shown == "up"
    }
  }

  /// Drag a sheet down from one of its elements until `gone` has left the screen.
  private func dragSheetDown(from identifier: String, until gone: String) throws {
    try pressUntil(
      named: "a drag down from \(identifier)",
      waitingFor: "the drag down to take the sheet away",
      press: { attempt in
        let start = self.app.descendants(matching: .any)[identifier]
        if attempt > 1 && !start.exists { return }
        start.centre.press(
          forDuration: 0.05,
          thenDragTo: self.app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.99)),
          withVelocity: .fast,
          thenHoldForDuration: 0
        )
      },
      reading: { self.app.descendants(matching: .any)[gone].exists ? "up" : "gone" }
    ) { shown in
      shown == "gone"
    }
  }

  /// Tap the dimmed screen above a sheet until `gone` has left.
  private func tapOutsideSheet(until gone: String) throws {
    try pressUntil(
      named: "the dimming view above the sheet",
      waitingFor: "the tap outside to take the sheet away",
      press: { attempt in
        if attempt > 1 && !self.app.descendants(matching: .any)[gone].exists { return }
        self.app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.1)).fingerTap()
      },
      reading: { self.app.descendants(matching: .any)[gone].exists ? "up" : "gone" }
    ) { shown in
      shown == "gone"
    }
  }

  /// Wait for an element's frame to satisfy `check`, and hand it back (or the last one).
  private func waitForFrame(_ identifier: String, _ check: (CGRect) -> Bool) -> CGRect {
    let deadline = Date().addingTimeInterval(reactTimeout)
    var frame = app.descendants(matching: .any)[identifier].frame
    while !check(frame) && Date() < deadline {
      Thread.sleep(forTimeInterval: 0.2)
      frame = app.descendants(matching: .any)[identifier].frame
    }
    XCTAssertTrue(check(frame), "\(identifier) never moved as expected: \(frame)")
    return frame
  }

  /// UIKit's own word for Cancel, which is what the library puts on the implicit
  /// Cancel - read from UIKit's bundle the way the library reads it, so a test
  /// device in another language still names the right button.
  private func cancelTitle() -> String {
    Bundle(for: UIApplication.self).localizedString(forKey: "Cancel", value: "Cancel", table: nil)
  }

  // MARK: - Reading the screen

  /// The emoji half of `maxLength` and the composition guard are checked in the in-app
  /// harness: XCUITest's keyboard types neither marked text nor emoji reliably.
  func testRealInputTextField() throws {
    try goToTab(Tab.textFieldTab, showing: Echo.textTyping)
    XCTAssertEqual(try read(Echo.textTyping), "typed:  (0)", "the typing field should start empty")

    let typing = try textField(labelled: "Typing field")
    try focusByTap(typing, echo: nil, as: "the typing field")
    typing.typeText("abc12")
    XCTAssertEqual(
      readUntil(Echo.textTyping) { $0 == "typed: abc12 (5)" },
      "typed: abc12 (5)",
      "real keystrokes should reach the field, and React should see its text"
    )
    XCTAssertEqual(typing.value as? String, "abc12", "the field should show what React was told")

    let frozen = try textField(labelled: "Frozen field")
    try focusByTap(frozen, echo: nil, as: "the frozen field")
    // One key at a time, each waited for: a key that never arrived is a delivery failure,
    // not a revert that lost an edit.
    try typeKey(
      "x",
      into: frozen,
      echo: Echo.textFrozen,
      expected: "frozen: 1 edits refused",
      resting: "frozen",
      named: "key \"x\" into the frozen field",
      waitingFor: "the first refused edit to be reported"
    )
    try typeKey(
      "y",
      into: frozen,
      echo: Echo.textFrozen,
      expected: "frozen: 2 edits refused",
      resting: "frozen",
      named: "key \"y\" into the frozen field",
      waitingFor: "the second refused edit to be reported"
    )
    XCTAssertEqual(
      echoText(Echo.textFrozen),
      "frozen: 2 edits refused",
      "every key into the frozen field should be reported to JS"
    )
    XCTAssertEqual(
      frozen.value as? String,
      "frozen",
      "and each one reverted: the field should still show what JS kept"
    )

    let capped = try textField(labelled: "Capped field")
    try focusByTap(capped, echo: nil, as: "the capped field")
    capped.typeText("abcdefg")
    XCTAssertEqual(
      readUntil(Echo.textCapped) { $0 == "capped: abcde (5)" },
      "capped: abcde (5)",
      "maxLength 5 should keep five of seven keys"
    )
    XCTAssertEqual(capped.value as? String, "abcde", "and the field should hold the same five")

    let focus = try textField(labelled: "Focus field")
    try focusByTap(focus, echo: Echo.textFocus, as: "the focus field")
    XCTAssertEqual(
      readUntil(Echo.textFocus) { $0 == "focus: 1 blur: 0 submitted: -" },
      "focus: 1 blur: 0 submitted: -",
      "a real tap should focus the field (onFocus)"
    )
    focus.typeText("go\n")
    XCTAssertEqual(
      readUntil(Echo.textFocus) { $0 == "focus: 1 blur: 1 submitted: go" },
      "focus: 1 blur: 1 submitted: go",
      "Return should submit the text, then blur the field"
    )
    try required("text-focus-js", as: "the Focus from JS button").fingerTap()
    XCTAssertEqual(
      readUntil(Echo.textFocus) { $0 == "focus: 2 blur: 1 submitted: go" },
      "focus: 2 blur: 1 submitted: go",
      "a real tap on a button that calls ref.focus() should focus the field"
    )
    try required("text-blur-js", as: "the Blur from JS button").fingerTap()
    XCTAssertEqual(
      readUntil(Echo.textFocus) { $0 == "focus: 2 blur: 2 submitted: go" },
      "focus: 2 blur: 2 submitted: go",
      "and one that calls ref.blur() should blur it"
    )
  }

  /// The text field element carrying `label`: the `UITextField` itself, which is what
  /// takes the keyboard (the React component view around it carries the testID).
  private func textField(labelled label: String) throws -> XCUIElement {
    let node = app.textFields.matching(NSPredicate(format: "label == %@", label)).firstMatch
    if !node.waitForExistence(timeout: reactTimeout) {
      dumpHierarchy("no text field labelled \"\(label)\"")
      XCTFail("no text field labelled \"\(label)\" appeared within \(reactTimeout)s")
      throw RealInputCheckAborted(identifier: label)
    }
    return node
  }

  /// The search field element carrying `label`. The query is an assertion: it goes through
  /// `app.searchFields`, so a field that lost its search-field trait is not found.
  private func searchField(labelled label: String) throws -> XCUIElement {
    let node = app.searchFields.matching(NSPredicate(format: "label == %@", label)).firstMatch
    if !node.waitForExistence(timeout: reactTimeout) {
      dumpHierarchy("no search field labelled \"\(label)\"")
      XCTFail("no search field labelled \"\(label)\" appeared within \(reactTimeout)s")
      throw RealInputCheckAborted(identifier: label)
    }
    return node
  }

  /// The clear button of a field that is editing, found by element rather than by UIKit's
  /// localized "Clear text" label. It exists only while the field edits with text in it.
  private func clearButton(of field: XCUIElement) throws -> XCUIElement {
    let buttons = field.buttons
    XCTAssertEqual(
      buttons.count,
      1,
      "a focused search field with text should offer exactly one clear button, not \(buttons.count)"
    )
    let clear = buttons.firstMatch
    if !clear.waitForExistence(timeout: reactTimeout) {
      dumpHierarchy("no clear button inside the editing search field")
      XCTFail("no clear button appeared inside the editing search field")
      throw RealInputCheckAborted(identifier: "clear button")
    }
    XCTAssertFalse(
      clear.label.isEmpty,
      "and the clear button names itself, so VoiceOver can say what it does"
    )
    return clear
  }

  func testRealInputSearchField() throws {
    try goToTab(Tab.searchFieldTab, showing: Echo.searchTyping)
    XCTAssertEqual(
      try read(Echo.searchTyping),
      "query:  (0)",
      "the typing field should start empty"
    )
    XCTAssertEqual(
      try read(Echo.searchFocus),
      "focus: 0 blur: 0 submitted: -",
      "nothing should have been focused, blurred or submitted yet"
    )

    // Lowest field first: once a keyboard is up it covers the lower half of the screen,
    // and every later tap is aimed higher than the one before it.
    let capped = try searchField(labelled: "Capped search field")
    try focusByTap(capped, echo: nil, as: "the capped field")
    capped.typeText("abcdefg")
    XCTAssertEqual(
      readUntil(Echo.searchCapped) { $0 == "capped: abcde (5)" },
      "capped: abcde (5)",
      "maxLength 5 should keep five of seven keys"
    )
    XCTAssertEqual(
      capped.value as? String,
      "abcde",
      "and the field should hold the same five"
    )

    let frozen = try searchField(labelled: "Frozen search field")
    try focusByTap(frozen, echo: nil, as: "the frozen field")
    // A burst on purpose: two keys delivered before JS has answered the first, so both
    // edits are in flight at once.
    _ = try pressUntil(
      named: "keys \"xy\" into the frozen search field",
      waitingFor: "both refused edits to be reported",
      pressNoun: "key",
      press: { attempt in frozen.typeText(attempt == 1 ? "xy" : "y") },
      reading: { self.echoText(Echo.searchFrozen) },
      nativeState: {
        let shown = (frozen.value as? String) ?? ""
        return shown == "frozen" ? "at rest" : "holds \"\(shown)\""
      },
      { $0 == "frozen: 2 edits refused" }
    )
    XCTAssertEqual(
      echoText(Echo.searchFrozen),
      "frozen: 2 edits refused",
      "every key into the frozen field should be reported to JS"
    )
    // Waited for: with two keys in one delivery the last can still be landing when the echo
    // matches.
    XCTAssertTrue(
      waitUntil({ ((frozen.value as? String) ?? "") == "frozen" }, window: reactTimeout),
      "and each one reverted: the field should still show what JS kept"
    )

    let typing = try searchField(labelled: "Typing search field")
    try focusByTap(typing, echo: nil, as: "the typing field")
    typing.typeText("latte")
    XCTAssertEqual(
      readUntil(Echo.searchTyping) { $0 == "query: latte (5)" },
      "query: latte (5)",
      "real keystrokes should reach the field, and React should see the query"
    )
    XCTAssertEqual(
      typing.value as? String,
      "latte",
      "the field should show what React was told"
    )

    let focus = try searchField(labelled: "Focus search field")
    try focusByTap(focus, echo: Echo.searchFocus, as: "the focus field")
    XCTAssertEqual(
      readUntil(Echo.searchFocus) { $0 == "focus: 1 blur: 0 submitted: -" },
      "focus: 1 blur: 0 submitted: -",
      "a real tap should focus the field (onFocus)"
    )
    focus.typeText("\n")
    XCTAssertEqual(
      readFor(1.5, Echo.searchFocus),
      "focus: 1 blur: 0 submitted: -",
      "Return with an empty query should submit nothing and blur nobody"
    )

    focus.typeText("go")
    XCTAssertEqual(
      focus.value as? String,
      "go",
      "the field should hold the query before anything clears it"
    )
    try clearButton(of: focus).fingerTap()
    XCTAssertEqual(
      readFor(1.5, Echo.searchFocus),
      "focus: 1 blur: 0 submitted: -",
      "a real tap on the clear button should empty the query without a blur or a submit"
    )
    XCTAssertEqual(
      focus.value as? String,
      "",
      "and the field should hold nothing"
    )

    focus.typeText("go")
    focus.typeText("\n")
    XCTAssertEqual(
      readUntil(Echo.searchFocus) { $0 == "focus: 1 blur: 1 submitted: go" },
      "focus: 1 blur: 1 submitted: go",
      "Return should submit the query, then blur the field"
    )
    try required("search-focus-js", as: "the Focus from JS button").fingerTap()
    XCTAssertEqual(
      readUntil(Echo.searchFocus) { $0 == "focus: 2 blur: 1 submitted: go" },
      "focus: 2 blur: 1 submitted: go",
      "a real tap on a button that calls ref.focus() should focus the field"
    )
    try required("search-blur-js", as: "the Blur from JS button").fingerTap()
    XCTAssertEqual(
      readUntil(Echo.searchFocus) { $0 == "focus: 2 blur: 2 submitted: go" },
      "focus: 2 blur: 2 submitted: go",
      "and one that calls ref.blur() should blur it"
    )
    // The keyboard belongs to UIKit, so only a run from outside the app can show which one
    // was drawn. Each keyboard is compared with the letter keyboard measured in this run (the
    // field with no keyboard prop), not with a key count or height remembered from one iOS.
    try required("search-focus-js", as: "the Focus from JS button").fingerTap()
    XCTAssertEqual(
      readUntil(Echo.searchFocus) { $0 == "focus: 3 blur: 2 submitted: go" },
      "focus: 3 blur: 2 submitted: go",
      "a field refocused from JS should have the keyboard again"
    )
    let qwerty = keyboardShape("the field with no keyboard prop")
    XCTAssertTrue(
      qwerty.keys >= 20,
      "a plain search field should still open the letter keyboard, not \(qwerty.keys) keys"
    )
    // The keyboard has to be down before a field lower than this one is tapped, and the
    // Blur button is the one control above the keys that puts it there.
    try required("search-blur-js", as: "the Blur from JS button").fingerTap()
    XCTAssertEqual(
      readUntil(Echo.searchFocus) { $0 == "focus: 3 blur: 3 submitted: go" },
      "focus: 3 blur: 3 submitted: go",
      "and blurring it should take the keyboard away again"
    )

    // The email field first: its keyboard has a Search key, which submits and blurs the
    // field. The number pad has no Return key on iOS, so it goes last with nothing to
    // dismiss it.
    let email = try searchFieldInView(labelled: "Email search field")
    try focusByTap(email, echo: nil, as: "the email field")
    let emailKeys = keyboardShape("keyboardType=email-address")
    XCTAssertTrue(
      emailKeys.keys * 2 > qwerty.keys,
      "keyboardType=\"email-address\" should open a keyboard with letters on it, not "
        + "\(emailKeys.keys) keys (the letter keyboard in this run has \(qwerty.keys))"
    )
    // "@" is on the face of the email keyboard only. One key at a time, each waited for: the
    // fields are controlled, and a burst lands its second key before JS has answered the first.
    var emailQuery = ""
    for key in ["a", "@", "b"] {
      emailQuery += key
      email.typeText(key)
      let expected = "email: \(emailQuery) submitted: -"
      XCTAssertTrue(
        waitUntil({ echoText(Echo.searchEmail) == expected }, window: reactTimeout),
        "typing \"\(key)\" should reach the email field: the echo reads "
          + "\"\(echoText(Echo.searchEmail))\" and should read \"\(expected)\""
      )
    }
    email.typeText("\n")
    XCTAssertEqual(
      readUntil(Echo.searchEmail) { $0 == "email: a@b submitted: a@b" },
      "email: a@b submitted: a@b",
      "the Search key should still submit a query on a keyboard the app chose"
    )

    let numbers = try searchFieldInView(labelled: "Number search field")
    try focusByTap(numbers, echo: nil, as: "the number-pad field")
    let numberPad = keyboardShape("keyboardType=number-pad")
    XCTAssertTrue(
      numberPad.keys > 0 && numberPad.keys * 2 <= qwerty.keys,
      "keyboardType=\"number-pad\" should open a number keyboard, not the \(numberPad.keys) "
        + "keys of a field that was told nothing (the letter keyboard here has \(qwerty.keys))"
    )
    var numberQuery = ""
    for digit in "123" {
      numberQuery += String(digit)
      numbers.typeText(String(digit))
      let expected = "number: \(numberQuery) submitted: -"
      XCTAssertTrue(
        waitUntil({ echoText(Echo.searchNumber) == expected }, window: reactTimeout),
        "typing \"\(digit)\" should reach the number field: the echo reads "
          + "\"\(echoText(Echo.searchNumber))\" and should read \"\(expected)\""
      )
    }
  }

  /// A search field with `label`, scrolled into the window so a tap can reach it. The field's
  /// box is re-read on every pass because the scroll moves it, and the page scrolls back down
  /// when the box is above the window.
  private func searchFieldInView(labelled label: String) throws -> XCUIElement {
    let field = try searchField(labelled: label)
    let screen = app.windows.firstMatch.frame
    for _ in 0..<6 {
      let box = field.frame
      if box.height > 0 && box.minY > screen.minY && box.maxY < screen.maxY {
        return field
      }
      if box.maxY < screen.minY {
        app.swipeDown()
      } else {
        app.swipeUp()
      }
    }
    dumpHierarchy("no search field labelled \"\(label)\" on screen")
    XCTFail(
      "the search field \"\(label)\" never came on screen: its box was \(field.frame) "
        + "in a window of \(screen), however far the page was scrolled."
    )
    throw RealInputCheckAborted(identifier: label)
  }

  /// Which keyboard UIKit drew: how many keys it exposes and how tall it is. Both depend on
  /// the iOS version, so compare a reading with another one from the same run.
  private func keyboardShape(_ what: String) -> (keys: Int, height: CGFloat) {
    let keyboard = app.keyboards.firstMatch
    XCTAssertTrue(
      keyboard.waitForExistence(timeout: 8),
      "no keyboard came up for \(what)"
    )
    // `descendants`, not `children`: UIKit nests a keyboard's keys behind its layout groups.
    let keys = keyboard.descendants(matching: .key)
    let labels = keys.allElementsBoundByIndex.prefix(24).map { element in
      element.label.isEmpty ? element.identifier : element.label
    }
    print(
      "real-input (ios): keyboard for \(what): keys=\(keys.count) "
        + "frame=\(keyboard.frame) labels=\(labels)"
    )
    return (keys.count, keyboard.frame.height)
  }

  /// Read an echo for `seconds` and hand back what it said at the end. A negative assertion
  /// needs the period: one read taken before the keypress was processed would say nothing
  /// happened.
  private func readFor(_ seconds: TimeInterval, _ identifier: String) -> String {
    let deadline = Date().addingTimeInterval(seconds)
    var shown = ""
    repeat {
      let node = app.descendants(matching: .any)[identifier].firstMatch
      if node.exists {
        shown = node.label.isEmpty ? ((node.value as? String) ?? "") : node.label
      }
      Thread.sleep(forTimeInterval: 0.2)
    } while Date() < deadline
    return shown
  }

  /// Tap a field until it has the keyboard focus, retrying a dropped delivery. Focus is
  /// accepted from `hasKeyboardFocus` on the wrapper or anything inside it, or, with `echo`,
  /// from the field's own `onFocus` reaching React while a keyboard is on screen: in a `Form`
  /// row the flag never turns true on the wrapper.
  private func focusByTap(_ field: XCUIElement, echo: String?, as what: String) throws {
    let before = echo.map { echoText($0) }
    for _ in 0..<3 {
      field.fingerTap()
      let deadline = Date().addingTimeInterval(3)
      repeat {
        let moved = echo.map { echoText($0) != before } ?? true
        if moved, holdsKeyboardFocus(field) { return }
        if moved, echo != nil, app.keyboards.firstMatch.exists { return }
        Thread.sleep(forTimeInterval: 0.2)
      } while Date() < deadline
    }
    // Printed so a failure says which witness was missing, and the box, because a tap that
    // landed on the wrong row looks exactly like a field that ignores touches.
    print(
      "real-input focusByTap: FAILED \(what) - box=\(field.frame) "
        + "hasKeyboardFocus=\(holdsKeyboardFocus(field)) "
        + "echo=\(echo ?? "-") \"\(before ?? "-")\" -> \"\(echo.map { echoText($0) } ?? "-")\" "
        + "keyboardWindow=\(app.keyboards.firstMatch.exists)"
    )
    dumpHierarchy("\(what) never took the keyboard focus")
    XCTFail("\(what) never took the keyboard focus after three real taps")
    throw RealInputCheckAborted(identifier: what)
  }

  /// Whether the keyboard focus is on this element or on anything it hosts. The wrapper that
  /// carries the `testID` is not the responder, and XCUITest has no "who has the focus"
  /// query, so descendants are read.
  private func holdsKeyboardFocus(_ field: XCUIElement) -> Bool {
    if (field.value(forKey: "hasKeyboardFocus") as? Bool) ?? false {
      return true
    }
    for one in field.descendants(matching: .any).allElementsBoundByIndex
    where (one.value(forKey: "hasKeyboardFocus") as? Bool) ?? false {
      return true
    }
    return false
  }

  /// Poll `check` until it says yes or `window` runs out.
  private func waitUntil(_ check: () -> Bool, window: TimeInterval) -> Bool {
    if check() { return true }
    let deadline = Date().addingTimeInterval(window)
    while Date() < deadline {
      Thread.sleep(forTimeInterval: 0.2)
      if check() { return true }
    }
    return false
  }

  /// Type one character into a focused field and wait for that character's own echo before
  /// the next, so a key that was never delivered is re-typed rather than read as a lost edit.
  ///
  /// - Parameter resting: the text the app forces this field to show, which a
  ///   refused edit has to return to once the echo arrives.
  private func typeKey(
    _ char: String,
    into field: XCUIElement,
    echo: String,
    expected wanted: String,
    resting: String,
    named what: String,
    waitingFor: String
  ) throws {
    func fieldText() -> String { (field.value as? String) ?? "" }
    // The previous key's revert has to land first: `pressUntil` reads the control's state
    // once, before its first press, and a reading taken mid-revert would be blamed on this key.
    if !waitUntil({ fieldText() == resting }, window: reactTimeout) {
      dumpHierarchy("\(what): the field did not return to its value between keys")
      XCTFail(
        "\(waitingFor): \(what), but the field never came back to \"\(resting)\" - it "
          + "shows \"\(fieldText())\" \(Int(reactTimeout))s later, so the next key "
          + "would be typed into an edit the app has not put back."
      )
      throw RealInputCheckAborted(identifier: what)
    }
    _ = try pressUntil(
      named: what,
      waitingFor: waitingFor,
      pressNoun: "key",
      press: { _ in field.typeText(char) },
      reading: { self.echoText(echo) },
      nativeState: { fieldText() == resting ? "at rest" : "holds \"\(fieldText())\"" },
      { $0 == wanted }
    )
  }

  /// The day is chosen by the helper rather than named: a pick of the date already showing
  /// reports nothing by design, which looks the same as a touch that never arrived.
  func testRealInputDatePicker() throws {
    try goToTab(Tab.datePickerTab, showing: Echo.dateValue)
    let field = try required("real-input-date", as: "the uncontrolled DatePicker field")
    let whereItStarted = field.frame
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

    try assertLowRowField()
  }

  /// The last row of the Date screen: a labelled `compact` field at the bottom of the page.
  /// The popover has to fit there, since UIKit sizes a popover to the room on the side its
  /// arrow may point. And the date has to be announced as the node's value, because with a
  /// label set VoiceOver reads the label as the node's name.
  private func assertLowRowField() throws {
    // Anything still presented has to go first: a popover would swallow the scroll below.
    try dismissAnyPresentation()

    let field = try required("low-date", as: "the last row's DatePicker field")
    let screen = app.windows.firstMatch.frame

    // Scrolls until three steps in a row no longer move the field: it becomes hittable rows
    // before the bottom, and one step can be swallowed. The drag runs down the page's 16pt
    // left padding, because a `wheel` row keeps every vertical drag that starts inside it.
    let gutter = app.coordinate(
      withNormalizedOffset: CGVector(dx: 8 / screen.width, dy: 0.72)
    )
    var position = field.frame
    var steps = 0
    var unmoved = 0
    while steps < 24 && unmoved < 3 {
      steps += 1
      gutter.press(
        forDuration: 0.05,
        thenDragTo: gutter.withOffset(CGVector(dx: 0, dy: -240))
      )
      let after = field.frame
      unmoved = after == position ? unmoved + 1 : 0
      position = after
    }
    print("real-input low row: scrolled in \(steps) steps, last \(unmoved) unmoved")
    let frame = field.frame
    let roomBelow = screen.maxY - frame.maxY
    print("real-input low row: field=\(frame) screen=\(screen) roomBelow=\(roomBelow)")

    XCTAssertLessThanOrEqual(
      frame.maxY,
      screen.maxY,
      "the last row of the Date screen ended at y \(frame.minY)-\(frame.maxY) of a "
        + "\(screen.height)pt window, so it is off it: no finger can reach it, which "
        + "means the page never scrolled to its end rather than that the field refused"
    )
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

    // `testID` names React Native's container, which reports the label with an empty value.
    // VoiceOver stops on the hosted element inside it, so the assertion aims at the innermost
    // element the subtree offers.
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
    // For contrast: an unlabelled field's control takes its name from its own text.
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
    // The press goes on the hosted control: hit testing returns it, not the container.
    // Retried because a press released while the list is still settling can be eaten by its
    // gesture recogniser.
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

  /// Close whatever presentation is on screen by tapping outside it: a popover dismisses on
  /// a tap outside its own bounds.
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

  /// Press a `compact` field and return the popover it presented. The wait is on the popover
  /// element itself, and its size and place are asserted here.
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
    // A bubble too short clips the calendar. There is no upper bound: UIKit clamps a popover
    // to the room it has.
    XCTAssertGreaterThanOrEqual(
      popover.frame.height,
      250,
      "the field presented a popover \(popover.frame.height)pt tall, which is shorter "
        + "than the calendar inside it - the bottom rows of the month are cut off"
    )
    // The popover has to be adjacent to its field, above or below: which side is UIKit's
    // choice. The band allows for the arrow's height, which the accessibility frame may or
    // may not include.
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

  /// Tap day cells inside an open popover until the echo moves. The days are `Button`s in the
  /// calendar's collection view, scoped to the popover because the screen also has an inline
  /// picker. Candidates start mid-list: an early cell can be today, the date an uncontrolled
  /// picker already shows, whose pick reports nothing.
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
        // The presentation is still open and covers the field the next assertions press.
        // The field's position is outside the bubble, so a tap there dismisses the popover.
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
    let tab = try required(identifier, as: "the example's tab")
    let revealed = revealTab(tab)
    if !revealed.satisfied {
      dumpHierarchy("tab \(identifier) is still outside the window")
      XCTFail(
        "the example's tab \"\(identifier)\" could not be scrolled wholly into the window "
          + "in \(revealed.reads) reads and \(revealed.presses) drags over "
          + "\(revealed.elapsedMs) ms (it is at \(revealed.last.frame), hittable: "
          + "\(revealed.last.hittable)), so it cannot be tapped reliably. The wait ran out on its "
          + "deadline, not on a drag count, so this is a bar that will not bring the tab in - not a "
          + "loaded machine that needed one more drag."
      )
      throw RealInputCheckAborted(identifier: identifier)
    }
    tab.fingerTap()
    _ = try required(screenAnchor, as: "the screen behind that tab", timeout: reactTimeout)
  }

  /// Scroll the tab bar sideways until a tab is wholly inside the window. React Native keeps
  /// a scrolled-away tab in the accessibility tree with its real frame, so each drag moves
  /// the bar by what the tab overhangs plus a margin, slowly and with a hold so it does not
  /// fling. A drag is sent only when two reads agree that the tab is outside the window.
  private func revealTab(
    _ tab: XCUIElement
  ) -> GestureSettlement.Outcome<TabReveal> {
    // Read once: every read is a round trip into the test manager.
    let window = app.windows.firstMatch.frame
    // The reading the next drag is aimed by. Only `read` writes it, so a drag is aimed at
    // where the tab was seen.
    var seen = TabReveal(frame: tab.frame, hittable: tab.isHittable, window: window)
    let outcome = GestureSettlement.settle(
      deadlineMs: Self.revealTabDeadlineMs,
      pauseMs: 150,
      read: {
        let reading = TabReveal(
          frame: tab.frame,
          hittable: tab.isHittable,
          window: window
        )
        seen = reading
        return reading
      },
      // `hittable` travels with the frame, so a settled box the finger still cannot reach is
      // not taken for a revealed tab.
      agrees: { $0.frame == $1.frame && $0.hittable == $1.hittable },
      satisfied: { $0.insideWindow },
      // Outside the window and settled is exactly when a drag is owed.
      mayPress: { _ in true },
      press: { _ in
        let margin: CGFloat = 24
        let frame = seen.frame
        let overhang =
          frame.maxX > window.maxX
            ? -(frame.maxX - window.maxX + margin)
            : window.minX - frame.minX + margin
        let shift = max(-window.width * 0.7, min(window.width * 0.7, overhang))
        let startX = shift < 0 ? window.width * 0.85 : window.width * 0.15
        let from = app.coordinate(withNormalizedOffset: .zero)
          .withOffset(CGVector(dx: startX, dy: frame.midY))
        from.press(
          forDuration: 0.05,
          thenDragTo: from.withOffset(CGVector(dx: shift, dy: 0)),
          withVelocity: .slow,
          thenHoldForDuration: 0.2
        )
      }
    )
    print(
      "real-input (ios): reveal tab: reads=\(outcome.reads) drags=\(outcome.presses) "
        + "elapsedMs=\(outcome.elapsedMs) inside=\(outcome.satisfied) "
        + "frame=\(outcome.last.frame) hittable=\(outcome.last.hittable)"
    )
    return outcome
  }

  /// One reading of a tab bar: where a tab is, and whether a finger could reach it.
  private struct TabReveal: Equatable {
    let frame: CGRect
    let hittable: Bool
    let window: CGRect

    var insideWindow: Bool {
      hittable && frame.minX >= window.minX && frame.maxX <= window.maxX
    }
  }

  /// Fail, with the hierarchy, if a control has moved out of the window since it
  /// was last looked at.
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
    // To a hundredth of a point, not bit for bit: XCUITest hands a frame back through
    // float32, so a box that has not moved can read 2^-16 pt differently on two reads.
    let now = node.frame
    let drift = max(
      abs(now.minX - startedAt.minX),
      abs(now.minY - startedAt.minY),
      abs(now.width - startedAt.width),
      abs(now.height - startedAt.height)
    )
    XCTAssertLessThanOrEqual(
      drift,
      0.01,
      "\(identifier) should still be drawn where it started, after \(action): it was "
        + "\(startedAt) and is now \(now)"
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

  /// Press something, wait for the witness that the press arrived, and retry the press until
  /// the witness shows or the attempts run out. A synthesised touch can be dropped by the OS
  /// under load; an attempt happens only while the witness is still absent.
  ///
  /// - Parameter press: delivers the touch, re-finding its target each attempt. It is told
  ///   which attempt this is, so a press that needs something on screen (an open menu's row)
  ///   can insist on it the first time and skip pressing after that.
  /// - Parameter reading: what the witness currently says, for the log line and the failure.
  ///   Keep it cheap and non-fatal.
  /// - Parameter nativeState: what the control itself says it holds. When it has moved while
  ///   the witness has not, the touch arrived and the event was lost on its way to JS, so the
  ///   helper fails instead of pressing again.
  /// - Parameter pressNoun: what to call one delivery in the log lines.
  /// - Parameter attemptWindow: how long one press gets to show its witness.
  @discardableResult
  private func pressUntil(
    named what: String,
    waitingFor: String,
    attempts: Int = 3,
    attemptWindow: TimeInterval? = nil,
    pressNoun: String = "tap",
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
      // A witness that reads nothing can never report a change, so the guard would not be
      // armed.
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
              "real-input (ios): \(waitingFor): \(what) answered on \(pressNoun) "
                + "\(attempt)/\(attempts) - the earlier \(pressNoun)(s) were never "
                + "delivered"
            )
          }
          return shown
        }
        Thread.sleep(forTimeInterval: 0.2)
      }
      // Before pressing again, ask the control whether it moved: one that changed while its
      // echo sat still received the touch and lost the event. Only when the echo has not
      // moved at all, because an echo at the wrong value proves JS heard something.
      if let nativeState,
        let moved = nativeState(),
        let startedAt,
        moved != startedAt,
        shown == echoStart
      {
        // No press here. The echo gets one more window first: a JS thread that is merely
        // slow looks exactly like a lost event.
        let graceUntil = Date().addingTimeInterval(window)
        while Date() < graceUntil {
          shown = reading()
          if raised(shown) {
            print(
              "real-input (ios): \(waitingFor): \(what) answered \(Int(window))s after "
                + "its \(pressNoun), late enough that the control had already changed - "
                + "a slow JS thread, not a lost event"
            )
            return shown
          }
          Thread.sleep(forTimeInterval: 0.2)
        }
        dumpHierarchy("\(waitingFor): \(what) changed natively but its echo did not")
        XCTFail(
          "\(waitingFor): \(what) took the \(pressNoun) and lost the event - the "
            + "control's own "
            + "state moved from \"\(startedAt)\" to \"\(moved)\" and its echo is still "
            + "\"\(shown)\", the value it had before any press, \(Int(window * 2))s "
            + "later. Not retried: a further press would land the event and make a lost "
            + "change look like a dropped tap."
        )
        throw RealInputCheckAborted(identifier: what)
      }
      print(
        "real-input (ios): \(waitingFor): \(pressNoun) \(attempt)/\(attempts) left "
          + "\(what) at \"\(shown)\""
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

  /// A readout that is a bare number, or nil when it is not there or says something else:
  /// an unreadable one is no reading, not zero.
  private func publishedNumber(_ identifier: String) -> String? {
    let shown = echoText(identifier).trimmingCharacters(in: .whitespaces)
    return shown.allSatisfy(\.isNumber) && !shown.isEmpty ? shown : nil
  }

  /// Tap a control until the on-screen value it is meant to change says so.
  ///
  /// - Parameter atFractionX: how far across the control to press, for the controls
  ///   where the middle is not the part under test.
  /// - Parameter nativeState: the control's own answer, for the controls that publish
  ///   one. Passed on to `pressUntil`.
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

  /// Hold-to-repeat exists on iOS only: SwiftUI's Stepper writes its binding once per repeat.
  /// The halves are aimed at by fraction, because the control is one element whose box covers
  /// both.
  func testRealInputStepper() throws {
    try goToTab(Tab.stepperTab, showing: Echo.stepperValue)
    let live = try required("real-input-stepper", as: "the real-input stepper")
    let held = try required("real-input-stepper-hold", as: "the hold stepper")
    let refusing = try required(
      "real-input-stepper-refusing", as: "the refusing stepper")
    let disabled = try required(
      "real-input-stepper-disabled", as: "the disabled stepper")
    XCTAssert(
      live.isHittable && held.isHittable,
      "both enabled steppers should be touchable before any tap is delivered"
    )
    // SwiftUI puts the minus half on the left and the plus half on the right; 0.15
    // and 0.85 are inside each half and clear of the divider between them.
    let minusX: CGFloat = 0.15
    let plusX: CGFloat = 0.85

    XCTAssertEqual(
      try read(Echo.stepperEvents), "0",
      "no step should be reported before a touch is delivered"
    )
    XCTAssertEqual(
      try read(Echo.stepperValue), "1",
      "the stepper should start where React put it"
    )
    XCTAssertEqual(
      "\(try read(Echo.stepperRefusedLast)) \(try read(Echo.stepperRefusedEvents))",
      "- 0",
      "the refusing stepper should have been asked for nothing yet"
    )
    XCTAssertEqual(
      try read(Echo.stepperDisabledEvents), "0",
      "the counter the disabled stepper reports into should start at zero, so a stray "
        + "delivery is a number that moved rather than a callback nobody saw"
    )
    XCTAssertEqual(
      try read(Echo.stepperHoldValue), "5",
      "the hold fixture should start in the middle of its range, with room to repeat"
    )

    XCTAssertEqual(
      try tapUntilValue(
        "real-input-stepper",
        echo: Echo.stepperValue,
        expected: "2",
        as: "the real-input stepper",
        waitingFor: "the real tap on the plus half",
        atFractionX: plusX
      ),
      "2",
      "one real tap on the plus half should step to the maximum"
    )
    XCTAssertEqual(
      try tapUntilValue(
        "real-input-stepper",
        echo: Echo.stepperValue,
        expected: "1",
        as: "the real-input stepper",
        waitingFor: "the real tap on the minus half",
        atFractionX: minusX
      ),
      "1",
      "one real tap on the minus half should step back"
    )
    XCTAssertEqual(
      try read(Echo.stepperEvents), "2",
      "two taps should report two steps — one event per tap, not one per half"
    )

    // SwiftUI disables the half at a bound itself, so the event counter is the read: a step
    // onto the value already held is invisible in the value echo.
    XCTAssertEqual(
      try tapUntilValue(
        "real-input-stepper",
        echo: Echo.stepperValue,
        expected: "0",
        as: "the real-input stepper",
        waitingFor: "the tap that reaches the minimum",
        atFractionX: minusX
      ),
      "0",
      "a third tap downward should reach the minimum"
    )
    var eventsAtBottom = try read(Echo.stepperEvents)
    live.atFraction(minusX).fingerTap()
    XCTAssertEqual(
      readUntil(Echo.stepperEvents, timeout: 1.5) { $0 != eventsAtBottom }, eventsAtBottom,
      "a tap on the half at the minimum should be refused"
    )
    for _ in 0..<3 {
      live.atFraction(plusX).fingerTap()
      usleep(250_000)
    }
    XCTAssertEqual(
      try read(Echo.stepperValue), "2",
      "three taps upward should stop at the maximum rather than past it"
    )
    let eventsAtTop = try read(Echo.stepperEvents)
    live.atFraction(plusX).fingerTap()
    XCTAssertEqual(
      readUntil(Echo.stepperEvents, timeout: 1.5) { $0 != eventsAtTop }, eventsAtTop,
      "a tap on the half at the maximum should be refused too"
    )

    // One held press, several steps: `>= 7` from 5 means at least two, which no single tap
    // can produce, however fast the simulator repeats.
    held.atFraction(plusX).press(forDuration: 1.5)
    let afterHold = readUntil(Echo.stepperHoldValue, timeout: 4) {
      Int($0) ?? 0 >= 7
    }
    XCTAssert(
      Int(afterHold) ?? 0 >= 7,
      "one 1.5 s hold on the plus half should repeat past one step — the value ended at "
        + "\(afterHold), which is one step (no repeat) at best. SwiftUI's hold-to-repeat "
        + "is what `docs/components/stepper.md` promises on iOS, and this is the only "
        + "check that can ask for it"
    )
    // Every repeat is one step and one event, so the event count must have moved exactly as
    // far as the value. Read after a pause, so both echoes have settled.
    usleep(400_000)
    let heldValue = Int(try read(Echo.stepperHoldValue)) ?? -1
    let heldEvents = Int(try read(Echo.stepperHoldEvents)) ?? -1
    XCTAssertEqual(
      heldEvents, heldValue - 5,
      "a hold should report one event per step — the value moved from 5 to \(heldValue) "
        + "(\(heldValue - 5) steps) while \(heldEvents) events were reported, so the two "
        + "echoes of one callback disagree about what a repeat is worth"
    )
    XCTAssertGreaterThanOrEqual(
      heldEvents, 2,
      "the hold should have reported at least two events — the value alone proves the "
        + "steps happened, and an echo that stayed at \(heldEvents) while they did is a "
        + "control taking the steps without telling React about them"
    )

    // React never moves `value`, so every step is refused. The next tap asks for the same
    // value again only if the refused one snapped back.
    for request in ["1", "2"] {
      XCTAssertEqual(
        try tapUntilValue(
          "real-input-stepper-refusing",
          echo: Echo.stepperRefusedEvents,
          expected: request,
          as: "the refusing stepper",
          waitingFor: "refused request \(request)",
          atFractionX: plusX
        ),
        request,
        "refused request \(request) should reach onValueChange"
      )
      XCTAssertEqual(
        try read(Echo.stepperRefusedLast), "2",
        "refused request \(request) should ask for 2 — one step above the value React "
          + "kept; a stepper that had adopted the refused one would ask for 3"
      )
    }
    XCTAssertEqual(
      try read(Echo.stepperValue), "2",
      "taps on the refusing stepper should leave the live one alone"
    )

    for half in [minusX, plusX] {
      disabled.atFraction(half).fingerTap()
    }
    XCTAssertEqual(
      readUntil(Echo.stepperDisabledEvents, timeout: 1.5) { $0 != "0" }, "0",
      "a real tap on either half of the disabled stepper should report no step"
    )

    // The live stepper is at its maximum, so this presses the half that can still move.
    XCTAssertEqual(
      try tapUntilValue(
        "real-input-stepper",
        echo: Echo.stepperValue,
        expected: "1",
        as: "the real-input stepper",
        waitingFor: "the barrier tap on the live stepper",
        atFractionX: minusX
      ),
      "1",
      "the live stepper, tapped on the half that can still move, should still step"
    )

    // `0...1.05` by `0.1` does not end on its step, so SwiftUI is not handed the step and
    // strides by 1 there. Only the direction of its write is used: one tap from the minimum
    // must still move the value by `0.1`.
    XCTAssertEqual(
      try tapUntilValue(
        "real-input-stepper-sparse",
        echo: Echo.stepperSparseValue,
        expected: "0.1",
        as: "the sparse-range stepper",
        waitingFor: "the first real tap on its plus half",
        atFractionX: plusX
      ),
      "0.1",
      "one plus tap on 0...1.05 by 0.1 should move one tenth, not SwiftUI's own stride "
        + "of 1 — the control took the amount of the write instead of its direction"
    )
  }

  /// A Switch's own state as iOS answers it: the toggle's `value`, not the echo. The `testID`
  /// is on the React Native component view, whose own value is empty, and the SwiftUI `Toggle`
  /// sits inside it, so the inner element is asked first. Returns nil when nothing answers
  /// with a value, and otherwise only "on" or "off".
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

  /// Tap a `compact` field until it presents something. The witness is the popover itself:
  /// no echo can be read while it is up.
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

  /// The same retry loop, aimed at one item of a group. A group's overflow control has no
  /// identifier of its own, and pressing the container lands on an ordinary item in the
  /// middle of the row.
  private func tapItemUntilOption(
    _ identifier: String,
    titled itemTitle: String,
    option title: String,
    waitingFor: String,
    attempts: Int = 3
  ) throws {
    try pressUntil(
      named: "\"\(itemTitle)\" in \(identifier)",
      waitingFor: waitingFor,
      attempts: attempts,
      press: { _ in try self.requiredItem(identifier, itemTitle).fingerTap() },
      reading: { "\(self.optionLabels(containing: title)) row(s) named \"\(title)\"" }
    ) { shown in
      !shown.hasPrefix("0 ")
    }
  }

  /// Tap a `Popover` anchor until its content is on screen. A `Popover` toggles, so a second
  /// tap closes what the first one opened: the tap is re-sent only while no popover window
  /// exists at all, and a window whose content is late is waited for.
  private func tapUntilPopoverUp(
    _ identifier: String,
    as what: String,
    content: String,
    waitingFor: String
  ) throws {
    struct Reading: Equatable {
      /// UIKit popovers on screen. Up-but-empty is a reason to wait, not a reason to tap again.
      let windows: Int
      /// Rows of *this* popover's content. The witness: it cannot exist unless the touch arrived.
      let rows: Int
    }
    let outcome = try GestureSettlement.settle(
      deadlineMs: Int(reactTimeout * 3 * 1_000),
      pauseMs: 200,
      // A tap gets a full `reactTimeout` to present before another may be sent.
      quietAfterPressMs: Int(reactTimeout * 1_000),
      read: {
        Reading(
          windows: app.descendants(matching: .popover).count,
          rows: optionLabels(containing: content)
        )
      },
      agrees: ==,
      satisfied: { $0.rows > 0 },
      mayPress: { $0.windows == 0 },
      press: { _ in try required(identifier, as: what).fingerTap() }
    )
    print(
      "real-input (ios): \(waitingFor): \(what) (\(identifier)) up=\(outcome.satisfied) "
        + "reads=\(outcome.reads) taps=\(outcome.presses) elapsedMs=\(outcome.elapsedMs) "
        + "windows=\(outcome.last.windows) rows=\(outcome.last.rows)"
    )
    guard !outcome.satisfied else { return }
    dumpHierarchy("\(waitingFor): no popover content \"\(content)\" appeared")
    if outcome.last.windows > 0 {
      XCTFail(
        "\(waitingFor): \(outcome.presses) real tap(s) on \(what) left a UIKit popover up with no "
          + "\"\(content)\" in it after \(outcome.elapsedMs) ms — the touch arrived and the "
          + "presentation never published its content, which is not a dropped touch and was not "
          + "tapped over: a second tap on an open anchor closes it."
      )
    } else {
      XCTFail(
        "\(waitingFor): \(outcome.presses) real taps on \(what) left no popover up at all after "
          + "\(outcome.elapsedMs) ms — every tap was re-sent only while the screen showed no "
          + "presentation, so on the evidence here the touch was never delivered "
          + "(FOLLOWUPS.md:58). The wait ran out on its deadline, not on a tap count."
      )
    }
    throw RealInputCheckAborted(identifier: identifier)
  }

  /// Tap a menu anchor until one of its rows, named here, is up. A row is the only witness a
  /// menu has while it is open.
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

  /// Tap an open menu's row until the value it should report arrives. A later attempt
  /// presses only while the row is still up: if it has gone, the earlier tap travelled and
  /// the echo is merely slow.
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


  /// Scroll until this element sits in the band a tap can land in. XCUITest taps an element's
  /// frame without scrolling an ordinary view to reach it, so a tap on a control below the
  /// fold lands on nothing. The scroll runs in steps shorter than the band and turns back
  /// when it overshoots: a full swipe can carry an element across the band.
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
      // A screen that does not scroll would otherwise spend every step on empty space.
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

  /// What this screen's ticking Picker is painting, as drawn text. The screen rotates that
  /// Picker's options every 2 s, so it is a heartbeat: while it moves, the app is running its
  /// own work. The drawn `StaticText`s are read because the anchor's accessibility label is
  /// the same whatever is selected.
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

  /// Watch the ticker for a window and report whether it moved, with what was seen. Sampled
  /// once a second for longer than the 6 s rotation: two readings a fixed gap apart can land
  /// on the same set and read a beating screen as a frozen one.
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

  /// The platform control inside a hosted control's React Native view. React Native owns the
  /// view the `testID` lands on, so an accessibility claim about the control is read from the
  /// element beneath it.
  private func hostedControl(
    in identifier: String,
    as what: String
  ) throws -> XCUIElement {
    let anchor = try required(identifier, as: what)
    let buttons = anchor.descendants(matching: .button)
    return buttons.firstMatch.exists ? buttons.firstMatch : anchor
  }

  /// A menu row, by the label a screen reader reads. The menu is SwiftUI's and has no
  /// `testID`, so the query crosses element types and matches the row's own text.
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

  /// Print the accessibility tree, so a failure's log shows the screen it happened on.
  private func dumpHierarchy(_ why: String) {
    print("real-input (ios): accessibility hierarchy - \(why)")
    print(app.debugDescription)
  }
// MARK: - Form

  /// The Form moves a row's React Native view into a `UICollectionViewListCell`, so every
  /// tap here has to cross UIKit's hit-testing to reach it.
  func testRealInputForm() throws {
    try goToTab(Tab.formTab, showing: Echo.formScreenEcho)

    try assertOnePressPerTap(
      "form-row",
      echo: Echo.formRowPresses,
      times: 10,
      as: "the form row with onPress"
    )
    try assertOnePressPerTap(
      "form-inner",
      echo: Echo.formInnerPresses,
      times: 10,
      as: "the Pressable inside a form row"
    )
    try assertSwitchToggledOncePerTap()

    try assertTapsGoNowhere(
      "form-row-plain",
      echoes: [
        Echo.formRowPresses,
        Echo.formInnerPresses,
        Echo.formSwitchChanges,
        Echo.formOutsidePresses,
      ],
      taps: 10,
      as: "the form row with no onPress"
    )

    try assertRowShowsCellHighlight("form-row", echo: Echo.formRowPresses, as: "the form row with onPress")

    logFormRowAccessibilityTree()

    // A drag that begins on a pressable row scrolls the list and must not press. The cell's
    // press recogniser starts at touch-down and recognises alongside the list's own pan, so
    // a flick's release would otherwise fire `onPress`.
    try scrollIntoView("form-row", as: "the form row with onPress")
    try assertDragFromRowIsNotAPress(
      "form-row",
      echo: Echo.formRowPresses,
      as: "the form row with onPress",
      screen: "form"
    )

    // The count is not fresh: the taps above already moved it, so these three are counted
    // from where it stands.
    try scrollIntoView("form-row", as: "the form row with onPress")
    try assertOnePressPerTap(
      "form-row",
      echo: Echo.formRowPresses,
      times: 3,
      as: "the form row with onPress, after a scroll",
      from: try pressCount(Echo.formRowPresses)
    )

    try assertFormKeepsFieldAboveKeyboard()
  }

  /// On iOS a `ListItem` is drawn by UIKit's `UIListContentView` inside a SwiftUI host. Inside
  /// a `Form.Row` the cell is the Form's, and the item only draws content into it.
  func testRealInputListItem() throws {
    try goToTab(Tab.listItemTab, showing: Echo.listItemPresses)

    // The fixtures sit at three heights of a page taller than the window, and XCUITest taps
    // a frame without scrolling to it, so each is brought into view just before it is tapped.
    try scrollIntoView("real-input-listitem", as: "the list item with onPress")
    let item = try required("real-input-listitem", as: "the list item with onPress")
    XCTAssert(
      item.isHittable,
      "the item with onPress should be touchable once it is in the tappable band, "
        + "before any tap is delivered"
    )
    try scrollIntoView("real-input-listitem-in-form", as: "the list item inside a Form.Row")
    let inForm = try required("real-input-listitem-in-form", as: "the list item inside a Form.Row")
    XCTAssert(
      inForm.isHittable,
      "the item inside the Form should be touchable once it is in the band, before any "
        + "tap is delivered — inside a row the leaf still has to be reachable (D46 item 2)"
    )
    let disabled = try required("real-input-listitem-disabled", as: "the disabled list item")
    // The row inside that wrapper, where the item publishes its own element.
    let disabledRow = try hostedControl(in: "real-input-listitem-disabled", as: "the disabled list item")

    XCTAssertEqual(
      try read(Echo.listItemPresses), "0",
      "no item press should be reported before a touch is delivered"
    )
    XCTAssertEqual(
      try read(Echo.listItemFormPresses), "0",
      "the item inside the Form should have been asked for nothing yet"
    )
    XCTAssertEqual(
      try read(Echo.listItemDisabledEvents), "0",
      "the counter the disabled item reports into should start at zero, so a stray "
        + "delivery is a number that moved rather than a callback nobody saw"
    )

    // One element: if UIKit published the title and subtitle as elements beside the merged
    // one, a screen reader would read the row twice.
    XCTAssertEqual(
      item.label, "Real-input item",
      "the item should be one element carrying the label the app chose, not the "
        + "three texts the row is built out of"
    )
    XCTAssertEqual(
      optionLabels(containing: "Real input"), 0,
      "and the row's title should not also be an element of its own — one stop per item"
    )
    // The chevron is a sibling of the content subtree, and `chevron.right` vends its own
    // label, "Forward", which would be a second stop.
    XCTAssertEqual(
      optionLabels(containing: "Forward"), 0,
      "the disclosure chevron is decoration inside the row, not a stop of its own — one "
        + "element per item (D46 item 1) includes the arrow that says what the role says"
    )
    // Read on the row's own element rather than on the React Native view that hosts it:
    // `disabled` is expressed by the platform control.
    print(
      "real-input list-item: item traits label=\(item.label) enabled=\(item.isEnabled) "
        + "frame=\(item.frame); disabled wrapper enabled=\(disabled.isEnabled) "
        + "row enabled=\(disabledRow.isEnabled) row traits label=\(disabledRow.label)"
    )
    XCTAssert(item.isEnabled, "an enabled item should not read as disabled")
    XCTAssertFalse(
      disabledRow.isEnabled,
      "a disabled item should say so in the tree, so a reader is told it is inert "
        + "instead of being handed a control that does nothing "
        + "(row isEnabled=\(disabledRow.isEnabled), React Native wrapper isEnabled=\(disabled.isEnabled))"
    )

    try scrollIntoView("real-input-listitem", as: "the list item with onPress")
    try assertOnePressPerTap("real-input-listitem", echo: Echo.listItemPresses, times: 10, as: "the list item with onPress")
    XCTAssertEqual(
      try read(Echo.listItemLast), "real",
      "the presses should be attributed to the item that was tapped"
    )

    try scrollIntoView("real-input-listitem", as: "the list item with onPress")
    try assertRowShowsCellHighlight("real-input-listitem", echo: Echo.listItemPresses, as: "the list item with onPress")

    try scrollIntoView("real-input-listitem-disabled", as: "the disabled list item")
    try assertTapsGoNowhere(
      "real-input-listitem-disabled",
      echoes: [Echo.listItemDisabledEvents, Echo.listItemPresses, Echo.listItemFormPresses],
      taps: 10,
      as: "the disabled list item"
    )
    try scrollIntoView("real-input-listitem", as: "the list item with onPress")
    // Read from the counter rather than hard-coded: the held press in the highlight check
    // above is itself a press this counter counted.
    let beforeBarrier = Int(try read(Echo.listItemPresses)) ?? -1
    let wantedBarrier = String(beforeBarrier + 1)
    XCTAssertEqual(
      try tapUntilValue(
        "real-input-listitem",
        echo: Echo.listItemPresses,
        expected: wantedBarrier,
        as: "the list item with onPress",
        waitingFor: "the barrier tap after the disabled item"
      ),
      wantedBarrier,
      "the live item, tapped the same way, should still answer (\(beforeBarrier) -> "
        + "\(wantedBarrier))"
    )

    XCTAssertEqual(
      inForm.label, "Item inside a Form row",
      "inside a Form.Row the item is still the element that carries its own name"
    )
    try scrollIntoView("real-input-listitem-in-form", as: "the list item inside a Form.Row")
    try assertOnePressPerTap("real-input-listitem-in-form", echo: Echo.listItemFormPresses, times: 5, as: "the list item inside a Form.Row")

    // Inside a `Form.Row` the item paints nothing of its own, so the only press feedback is
    // the cell's, and the cell highlights only a pressable row: the item's `onPress` has to
    // reach the row.
    try scrollIntoView("real-input-listitem-in-form", as: "the list item inside a Form.Row")
    try assertRowShowsCellHighlight(
      "real-input-listitem-in-form",
      echo: Echo.listItemFormPresses,
      as: "the list item inside a Form.Row"
    )

    // Last, because it scrolls the page out from under everything above it.
    try scrollIntoView("real-input-listitem", as: "the list item with onPress")
    try assertDragFromRowIsNotAPress(
      "real-input-listitem",
      echo: Echo.listItemPresses,
      as: "the list item with onPress"
    )
  }

  /// Print the subtree a screen reader is handed for the Form's pressable row, in the same
  /// shape as the a11y pass's `kind=node` lines. A measurement, not an assertion.
  private func logFormRowAccessibilityTree() {
    guard let anchor = try? required("form-row", as: "the form row with onPress") else {
      print("real-input form a11y kind=nodes skipped=no form-row element to read")
      return
    }
    let nodes =
      [A11yNode(element: anchor)]
      + anchor.descendants(matching: .any).allElementsBoundByIndex.map(A11yNode.init(element:))
    print("real-input form a11y kind=nodes nodes=\(nodes.count)")
    for node in nodes {
      print(
        "real-input form a11y kind=node trait=\(quoted(node.traitName)) "
          + "enabled=\(node.enabled) hittable=\(node.hittable) "
          + "id=\(quoted(node.identifier)) label=\(quoted(node.label)) "
          + "value=\(quoted(node.valueText)) "
          + "x=\(node.frame.origin.x) y=\(node.frame.origin.y) "
          + "w=\(node.frame.size.width) h=\(node.frame.size.height)"
      )
    }
  }

  /// A drag that begins on a row belongs to the scroll view, so the row must not press. The
  /// gesture is a real flick of 200 pt, measured off the row's own frame: a drag of a few
  /// points is not a scroll, and the row is right to call that a press.
  private func assertDragFromRowIsNotAPress(
    _ identifier: String,
    echo: String,
    as what: String,
    screen: String = "list-item"
  ) throws {
    let element = try required(identifier, as: what)
    let window = app.windows.firstMatch.frame
    let travel: CGFloat = 200
    let down = element.frame.midY < window.midY
    let delta = CGVector(dx: 0, dy: down ? travel : -travel)
    let before = echoText(echo)
    element.centre.press(
      forDuration: 0.25,
      thenDragTo: element.centre.withOffset(delta),
      withVelocity: .fast,
      thenHoldForDuration: 0.1
    )
    let after = echoText(echo)
    let direction = down ? "down" : "up"
    print(
      "real-input \(screen) drag: \(what) (\(identifier)) travelled \(direction) "
        + "\(Int(travel)) pt from midY \(Int(element.frame.midY)) of a window ending at "
        + "\(Int(window.maxY)) — echo \"\(before)\" -> \"\(after)\""
    )
    XCTAssertEqual(
      after,
      before,
      "\(what) (\(identifier)) reported a press for a drag that started on it: \"\(echo)\" "
        + "went \"\(before)\" -> \"\(after)\" while the finger travelled \(Int(travel)) pt "
        + "\(direction) the page. A row that fires on a scroll takes the person "
        + "to a screen they only meant to scroll past."
    )
  }

  /// The number an echo reads now, for a tap check that does not start from a fresh count.
  /// A non-number fails rather than reading as 0, so a stale screen cannot pass as a fresh one.
  private func pressCount(_ echo: String) throws -> Int {
    let text = try read(echo)
    guard let count = Int(text) else {
      XCTFail("\"\(echo)\" should read a press count before the taps; it reads \"\(text)\".")
      throw RealInputCheckAborted(identifier: echo)
    }
    return count
  }

  /// Tap `identifier` `times` times and require the echo to read exactly `base + 1`…`base + times`.
  ///
  /// Deliberately one tap, then one wait — not ten taps then a read. Ten taps and a
  /// final count of 10 would also be what a screen looks like after two taps landed
  /// twice and eight were dropped, and the difference is the whole question.
  private func assertOnePressPerTap(
    _ identifier: String,
    echo: String,
    times: Int,
    as what: String,
    from base: Int = 0
  ) throws {
    for attempt in 1...times {
      let wanted = String(base + attempt)
      guard pressOnce(identifier) != nil else {
        dumpHierarchy("\(what): \(identifier) is gone before tap \(attempt)")
        XCTFail(
          "\(what) (\(identifier)) was not on screen before tap \(attempt) of \(times), so "
            + "nothing was tapped and every count after this says nothing about a touch."
        )
        throw RealInputCheckAborted(identifier: identifier)
      }
      if !waitUntil({ self.echoText(echo) == wanted }, window: reactTimeout) {
        let shown = echoText(echo)
        dumpHierarchy("\(what): tap \(attempt) did not arrive as \(wanted)")
        XCTFail(
          "tap \(attempt) of \(times) on \(what) (\(identifier)) should make \"\(echo)\" read "
            + "\(wanted); it reads \"\(shown)\" after \(Int(reactTimeout))s — "
            + ((Int(shown) ?? 0) > base + attempt
              ? "it is ahead, so a tap answered more than once."
              : "it is behind, so a tap was dropped before it reached the content.")
        )
        throw RealInputCheckAborted(identifier: identifier)
      }
    }
  }

  /// Ten taps on the hosted `Switch`: ten accepted changes, and the *value* still in
  /// step. The counter alone would be satisfied by a control that fired an event and
  /// kept its old state; the parity of the value echo is what says the two agree.
  private func assertSwitchToggledOncePerTap() throws {
    let control = "form-switch"
    for attempt in 1...10 {
      guard pressOnce(control) != nil else {
        dumpHierarchy("the hosted Switch is gone before tap \(attempt)")
        XCTFail(
          "the Switch inside the form row (\(control)) was not on screen before tap \(attempt) "
            + "of 10 — nothing was tapped, so the counts below are not evidence."
        )
        throw RealInputCheckAborted(identifier: control)
      }
      let wanted = String(attempt)
      if !waitUntil({ self.echoText(Echo.formSwitchChanges) == wanted }, window: reactTimeout) {
        let shown = echoText(Echo.formSwitchChanges)
        dumpHierarchy("hosted Switch change \(attempt) did not arrive")
        XCTFail(
          "tap \(attempt) of 10 on the Switch inside a form row should make "
            + "\"\(Echo.formSwitchChanges)\" read \(wanted); it reads \"\(shown)\" after "
            + "\(Int(reactTimeout))s."
        )
        throw RealInputCheckAborted(identifier: control)
      }
      let parity = attempt.isMultiple(of: 2) ? "off" : "on"
      XCTAssertEqual(
        try read(Echo.formSwitchValue),
        parity,
        "after \(attempt) taps the Switch inside the row should read \"\(parity)\", so the "
          + "change React accepted and the state it renders are the same event"
      )
    }
  }

  /// Tap something inert ten times and require that no counter moved.
  private func assertTapsGoNowhere(
    _ identifier: String,
    echoes: [String],
    taps: Int,
    as what: String
  ) throws {
    let before = echoes.map { ($0, echoText($0)) }
    for attempt in 1...taps {
      guard pressOnce(identifier) != nil else {
        dumpHierarchy("\(what): \(identifier) is gone before tap \(attempt)")
        XCTFail("\(what) (\(identifier)) disappeared before tap \(attempt) of \(taps).")
        throw RealInputCheckAborted(identifier: identifier)
      }
    }
    // Anything still on its way to JS has to have landed before "nothing changed" means
    // anything, so wait for a change and use the window as the settle.
    _ = waitUntil(
      {
        echoes.contains { name in
          self.echoText(name) != (before.first { $0.0 == name }?.1 ?? "")
        }
      },
      window: 1.5
    )
    let moved = before.compactMap { name, was -> String? in
      let now = echoText(name)
      return now == was ? nil : "\(name) went \"\(was)\" -> \"\(now)\""
    }
    XCTAssertEqual(
      moved,
      [],
      "\(taps) taps on \(what) (\(identifier)) moved counters it had no business moving: "
        + "\(moved.joined(separator: "; ")). A row with no onPress has to be inert, or every "
        + "press above could have come from the row next to it."
    )
  }

  /// The cell's own highlight: one row's average luminance at rest and inside a held press.
  /// UIKit paints it and React never hears about it, so the witness is the screen. The sample
  /// is taken from a background thread with a bounded wait and a timestamp, because a
  /// screenshot asked for during a press may be served after it: a late sample is logged as
  /// UNSAMPLED and not asserted on.
  private func assertRowShowsCellHighlight(
    _ identifier: String,
    echo: String,
    as what: String
  ) throws {
    let element = try required(identifier, as: what)
    guard let atRest = element.frame.width > 0 ? meanLuminance(of: element.screenshot().image) : nil else {
      XCTFail("could not read the pixels of \(what) (\(identifier)) at rest, so the highlight cannot be measured.")
      return
    }

    let hold: TimeInterval = 2.5
    let sampleAfter: TimeInterval = 0.8
    let group = DispatchGroup()
    var held: CGFloat?
    var sampledAt: Date?
    group.enter()
    DispatchQueue.global().asyncAfter(deadline: .now() + sampleAfter) {
      held = self.meanLuminance(of: element.screenshot().image)
      sampledAt = Date()
      group.leave()
    }
    let before = echoText(echo)
    let pressBegan = Date()
    element.press(forDuration: hold)
    let pressEnded = Date()
    _ = group.wait(timeout: .now() + 10)

    let after = echoText(echo)
    XCTAssertEqual(
      after,
      String((Int(before) ?? 0) + 1),
      "a held press on \(what) should arrive as exactly one more press: \"\(echo)\" went "
        + "\"\(before)\" -> \"\(after)\"."
    )

    guard let held, let sampledAt else {
      print(
        "real-input form highlight: UNSAMPLED \(what) (\(identifier)) - the screenshot "
          + "requested \(sampleAfter)s into a \(hold)s press never came back. Rest luminance "
          + "\(atRest). Not a pass: the highlight is unmeasured on iOS."
      )
      return
    }
    guard sampledAt < pressEnded else {
      print(
        "real-input form highlight: UNSAMPLED \(what) (\(identifier)) - the screenshot was "
          + "served \(sampledAt.timeIntervalSince(pressBegan))s after the press began, i.e. "
          + "after it released, so it cannot show a highlight. Rest \(atRest), late sample "
          + "\(held). Not a pass: the highlight is unmeasured on iOS."
      )
      return
    }
    print(
      "real-input form highlight: \(what) (\(identifier)) luminance rest=\(atRest) "
        + "held=\(held) sampled \(sampledAt.timeIntervalSince(pressBegan))s into a \(hold)s press"
    )
    XCTAssertLessThan(
      held,
      atRest - 0.01,
      "\(what) (\(identifier)) is no darker with the finger down than at rest: luminance "
        + "\(held) held against \(atRest) at rest, sampled inside the press. UIKit is not "
        + "highlighting the cell, so a row's press arrives without the feedback that says it did."
    )
  }

  /// A field near the bottom of a long form, focused by a real tap, is still on screen above
  /// the keyboard.
  private func assertFormKeepsFieldAboveKeyboard() throws {
    let identifier = "form-note-field"
    // The list realises a row only while it is drawing it, so the field is not in the
    // accessibility tree at all until the list has been scrolled to it.
    let field = app.descendants(matching: .any)[identifier].firstMatch
    var revealed = false
    for _ in 0..<14 {
      app.swipeUp()
      if field.waitForExistence(timeout: 1) {
        revealed = true
        break
      }
    }
    guard revealed else {
      dumpHierarchy("the note field never appeared, however far the list was scrolled")
      XCTFail(
        "the note field near the bottom of the form never became a realised row, so the list "
          + "never drew it: question 5 has nothing to focus."
      )
      throw RealInputCheckAborted(identifier: identifier)
    }

    // Then to the end of the list: the page is at its end when another swipe stops moving
    // the field.
    var position = field.frame
    for _ in 0..<12 {
      app.swipeUp()
      let after = field.frame
      if after == position { break }
      position = after
    }
    let screen = app.windows.firstMatch.frame
    XCTAssertGreaterThan(
      field.frame.minY,
      screen.midY,
      "the note field ended up at y \(field.frame.minY) of a \(screen.height)pt screen — not "
        + "in its lower half, so this cannot see the keyboard covering it."
    )

    XCTAssertEqual(
      try read(Echo.formFieldFocus),
      "no",
      "the field should not be focused before it is tapped"
    )
    try focusByTap(field, echo: Echo.formFieldFocus, as: "the note field at the bottom of the form")
    if !waitUntil({ self.echoText(Echo.formFieldFocus) == "yes" }, window: reactTimeout) {
      dumpHierarchy("the note field's focus never reached React")
      XCTFail(
        "the field took the keyboard focus but \"\(Echo.formFieldFocus)\" still reads "
          + "\"\(echoText(Echo.formFieldFocus))\" after \(Int(reactTimeout))s, so question 5 has "
          + "nothing to measure."
      )
      throw RealInputCheckAborted(identifier: identifier)
    }

    // XCUITest's keyboard window is the keyboard's real top edge. The inset the Form echoes
    // is produced by the code under test, so it is compared with that edge and never used to
    // place the line the field is judged against.
    _ = waitUntil({ self.echoText(Echo.formKeyboardInset) != "-" }, window: 4)
    let insetText = echoText(Echo.formKeyboardInset)
    let inset = CGFloat(Double(insetText) ?? 0)
    let keyboard = app.keyboards.firstMatch
    if !keyboard.waitForExistence(timeout: 5) {
      if inset <= 0 {
        dumpHierarchy("no keyboard window and no keyboard inset after focusing \(identifier)")
        throw XCTSkip(
          "nothing says a keyboard came up: XCUITest sees no keyboard window (a simulator with "
            + "its hardware keyboard connected shows none) and the Form's own report reads "
            + "keyboard=\(insetText), so there is no keyboard for the field to stay above. Not a "
            + "pass: iOS question 5 is unmeasured on this host."
        )
      }
      dumpHierarchy("no keyboard window, only the Form's own inset, after focusing \(identifier)")
      XCTFail(
        "question 5 has no witness for the keyboard's real top edge: XCUITest sees no keyboard "
          + "window after \(identifier) took the focus, while the Form's own report reads "
          + "keyboard=\(insetText). The only line left to judge the field against is one the code "
          + "under test drew, which can show at most that the Form agrees with itself."
      )
      throw RealInputCheckAborted(identifier: identifier)
    }
    let keyboardTop = keyboard.frame.minY
    let frame = field.frame
    XCTAssertGreaterThan(
      inset,
      0,
      "the Form's report reads keyboard=\(insetText) while XCUITest shows a keyboard window at "
        + "\(keyboardTop) — UIKit never told the Form a keyboard is up, so nothing reserved room "
        + "for these keys and nothing here has measured question 5."
    )
    do {
      // This screen's Form runs to the bottom of the window, so the overlap UIKit should
      // reserve is exactly `screen.maxY - keyboardTop`, however far the list has scrolled.
      let overlap = screen.maxY - keyboardTop
      // Two bounds rather than an equality: XCUITest's keyboard element is the keys, while
      // the keyboard notification's end frame also includes the predictive-text bar above
      // them.
      XCTAssertGreaterThanOrEqual(
        inset,
        overlap - 2,
        "the Form reserves a bottom inset of \(insetText) for a keyboard whose top edge is at "
          + "\(keyboardTop) of a window ending at \(screen.maxY): the keys alone overlap by "
          + "\(overlap), so the avoidance under-reserves by \(overlap - inset) and the field it "
          + "just moved can sit under them."
      )
      XCTAssertLessThanOrEqual(
        inset,
        overlap + 64,
        "the Form reserves a bottom inset of \(insetText) for a keyboard whose top edge is at "
          + "\(keyboardTop) of a window ending at \(screen.maxY): the keys overlap by \(overlap) "
          + "and the accessory bar above them is at most ~44, so the \(inset - overlap) this "
          + "number carries describes something other than the keyboard — the bug here compared "
          + "a keyboard rect converted into the list's content space, where it travels with "
          + "`contentOffset`, against the list's frame bottom, and was off by 187.3 pt."
      )
    }
    XCTAssertGreaterThanOrEqual(
      frame.maxY,
      screen.minY,
      "the focused field scrolled off the top of the window: it is at \(frame)."
    )
    XCTAssertLessThanOrEqual(
      frame.maxY,
      keyboardTop + 1,
      "the keyboard covers the focused field: it is at \(frame) with the keyboard's top edge at "
        + "\(keyboardTop) (XCUITest's keyboard window) — keyboardAvoidance left a field under the "
        + "keys."
    )
    // The list's own numbers, read while the keyboard is up: `ib` is the inset the Form asked
    // for, `ab` the inset the list carries after UIKit added the bottom safe area, and
    // `h`/`bh` the content and the viewport.
    let geometryBefore = echoText(Echo.formListGeometry)
    print(
      "real-input (ios): form keyboard: field=\(frame) keyboardTop=\(keyboardTop) (from the "
        + "keyboard window) inset=\(insetText) focused="
        + "\(echoText(Echo.formFieldFocus)) list=\(geometryBefore)"
    )
    // UIKit adds the list's bottom safe area to the inset asked for and pads the content by
    // the sum, so asking for the whole overlap would reserve the home-indicator strip twice.
    // The same two-ended band as the inset above, asked of the sum.
    if let adjusted = Self.geometryNumber(geometryBefore, "ab") {
      let overlap = screen.maxY - keyboardTop
      XCTAssertGreaterThanOrEqual(
        adjusted,
        overlap - 2,
        "the list carries an adjusted bottom inset of \(adjusted) for keys that overlap by "
          + "\(overlap): its content can be scrolled \(overlap - adjusted) pt too far, under them. "
          + "The list reported \(geometryBefore)."
      )
      XCTAssertLessThanOrEqual(
        adjusted,
        overlap + 64,
        "the list carries an adjusted bottom inset of \(adjusted) for keys that overlap by "
          + "\(overlap), and the predictive-text bar above them is at most ~44: the \(adjusted - overlap) "
          + "over describes something other than the keyboard, and the home indicator's safe area "
          + "counted twice is 34 of them. The list reported \(geometryBefore)."
      )
    } else {
      XCTFail(
        "the echoed list geometry has no `ab=` field, so the inset the list carries cannot be "
          + "asked: \(geometryBefore)"
      )
    }

    // Then a finger's scroll: an inset that a scroll takes back is a bug. The finger goes
    // down on the list's rows well above the field, because a drag that starts just above
    // the field belongs to the text loupe and ends the editing session. Down first, then
    // back up to the end of the content, where the last row must rest above the keyboard.
    let listRow = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
    listRow.press(forDuration: 0.3, thenDragTo: listRow.withOffset(CGVector(dx: 0, dy: 40)))
    var rest = settleFormKeyboard(field: field)
    print(
      "real-input (ios): form keyboard after a drag down: field=\(frame) -> \(rest.frame) "
        + "inset=\(insetText) -> \(rest.inset) list=\(geometryBefore) -> \(rest.geometry)"
    )
    listRow.press(forDuration: 0.3, thenDragTo: listRow.withOffset(CGVector(dx: 0, dy: -40)))
    rest = settleFormKeyboard(field: field)
    print(
      "real-input (ios): form keyboard after the scroll back: field=\(frame) -> "
        + "\(rest.frame) inset=\(insetText) -> \(rest.inset) focused="
        + "\(echoText(Echo.formFieldFocus)) keyboardWindow="
        + "\(app.keyboards.firstMatch.exists) list=\(geometryBefore) -> \(rest.geometry)"
    )

    let insetAfter = CGFloat(Double(rest.inset) ?? -1)
    XCTAssertEqual(
      echoText(Echo.formFieldFocus),
      "yes",
      "the focused field lost the keyboard focus while the list was scrolled by the hand (it "
        + "sat \(rest.frame), and XCUITest sees a keyboard window: "
        + "\(app.keyboards.firstMatch.exists)). Nothing is left to keep above the keys, so the "
        + "half of question 5 that follows a scroll cannot be answered."
    )
    XCTAssertLessThanOrEqual(
      abs(insetAfter - inset),
      2,
      "the reserved keyboard inset changed from \(insetText) to \(rest.inset) when the list was "
        + "scrolled by the hand, without the keyboard moving. The field came to rest at "
        + "\(rest.frame); the list reported \(geometryBefore) before the scroll and "
        + "\(rest.geometry) after it."
    )
    // The same claim asked of the list: the insets it is carrying must survive the scroll.
    for label in ["ib", "ab"] {
      let before = Self.geometryNumber(geometryBefore, label)
      let after = Self.geometryNumber(rest.geometry, label)
      XCTAssertNotNil(before, "the Form's report has no \(label)= field: \(geometryBefore)")
      XCTAssertNotNil(after, "the Form's report has no \(label)= field: \(rest.geometry)")
      if let before, let after {
        XCTAssertLessThanOrEqual(
          abs(after - before),
          2,
          "the list carried a bottom inset of \(before) for the keyboard before the scroll and "
            + "\(after) after it: a scroll is not a keyboard event, and the field came to rest "
            + "at \(rest.frame) with the keys still at \(keyboardTop)."
        )
      }
    }
    // A synthesised drag stops wherever its velocity takes it, so swipe until the list's own
    // numbers say it is at the end of its content.
    for _ in 0..<4 {
      if Self.isAtEndOfContent(rest.geometry) { break }
      listRow.press(forDuration: 0.3, thenDragTo: listRow.withOffset(CGVector(dx: 0, dy: -120)))
      rest = settleFormKeyboard(field: field)
    }
    XCTAssertTrue(
      Self.isAtEndOfContent(rest.geometry),
      "the list never came to rest at the end of its content, so the field's position says "
        + "nothing about the reservation below the last row: it reported \(rest.geometry), where "
        + "the end is `h + ab - bh`. Before the scroll it reported \(geometryBefore)."
    )
    // `maxY`, with a point of slack: a field whose box straddles the keyboard's edge is not
    // clear of it.
    XCTAssertLessThanOrEqual(
      rest.frame.maxY,
      keyboardTop + 1,
      "at the end of its content the focused field (\(rest.frame)) is not above the keyboard's "
        + "top edge \(keyboardTop): the inset that placed it there no longer keeps it on screen. "
        + "Before the scroll it sat \(frame) and the list reported \(geometryBefore); after it the "
        + "list reports \(rest.geometry)."
    )
  }

  /// Whether the list's own echoed numbers say its content is scrolled to the end. The
  /// largest offset a scroll view can hold is its content height plus the adjusted bottom
  /// inset, less the height of the viewport.
  private static func isAtEndOfContent(_ line: String) -> Bool {
    guard let content = geometryNumber(line, "h"),
      let viewport = geometryNumber(line, "bh"),
      let adjusted = geometryNumber(line, "ab"),
      let offset = geometryNumber(line, "off")
    else { return false }
    return offset >= content + adjusted - viewport - 2
  }

  /// The field's box, the echoed list geometry and the echoed keyboard inset, read until two
  /// reads agree. After a synthesised drag the list is still springing back and the echoed
  /// numbers come from polling, so one read can pair a mid-animation frame with stale numbers.
  private func settleFormKeyboard(
    field: XCUIElement
  ) -> (frame: CGRect, geometry: String, inset: String) {
    var frame = field.frame
    var geometry = echoText(Echo.formListGeometry)
    var inset = echoText(Echo.formKeyboardInset)
    for _ in 0..<25 {
      let lastFrame = frame
      let lastGeometry = geometry
      let lastInset = inset
      Thread.sleep(forTimeInterval: 0.2)
      frame = field.frame
      geometry = echoText(Echo.formListGeometry)
      inset = echoText(Echo.formKeyboardInset)
      if abs(frame.minY - lastFrame.minY) < 0.5 && geometry == lastGeometry
        && inset == lastInset
      {
        break
      }
    }
    return (frame, geometry, inset)
  }

  /// One number out of the Form's echoed geometry line (`ib=328.00;ab=362.00;...`).
  private static func geometryNumber(_ line: String, _ label: String) -> CGFloat? {
    for field in line.split(separator: ";") {
      let parts = field.split(separator: "=")
            if parts.count == 2, parts[0] == Substring(label) {
        return CGFloat(Double(String(parts[1])) ?? .nan)
      }
    }
    return nil
  }

  /// The average luminance of one screenshot, 0 (black) to 1 (white).
  ///
  /// Core Graphics draws the whole element into a 1x1 bitmap, which box-averages it —
  /// enough to see a translucent grey laid over the whole row, and immune to where in
  /// the row the aim happens to land.
  private func meanLuminance(of image: UIImage) -> CGFloat? {
    guard let cg = image.cgImage else { return nil }
    var pixel = [UInt8](repeating: 0, count: 4)
    guard
      let space = CGColorSpace(name: CGColorSpace.sRGB),
      let context = CGContext(
        data: &pixel,
        width: 1,
        height: 1,
        bitsPerComponent: 8,
        bytesPerRow: 4,
        space: space,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
      )
    else { return nil }
    context.draw(cg, in: CGRect(x: 0, y: 0, width: 1, height: 1))
    let red = CGFloat(pixel[0]) / 255
    let green = CGFloat(pixel[1]) / 255
    let blue = CGFloat(pixel[2]) / 255
    return red * 0.299 + green * 0.587 + blue * 0.114
  }
}

/// A check could not continue because something it needs is not there at all.
/// `continueAfterFailure = false` already ends the test at the first failed
/// assertion; this keeps the case where an element is missing honest instead of
/// letting the next assertion run against nothing.
private struct RealInputCheckAborted: Error {
  let identifier: String
}

/// The live elements no longer pair with the settled snapshot one for one.
private struct LiveTreeMismatch: Error, CustomStringConvertible {
  let description: String
  init(_ description: String) { self.description = description }
}


extension XCUIElement {
  /// The middle of this element, as a point the system can touch.
  var centre: XCUICoordinate {
    coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
  }

  /// A finger's tap: a touch that lasts, rather than `tap()`'s zero-dwell one. `tap()` puts
  /// touch down and touch up inside a single frame, and the hosted controls on a busy screen
  /// drop most of those.
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

  /// Press on the thumb and drag it along the track to a fraction of it. The start has to be
  /// where the thumb is: on iOS a SwiftUI Slider ignores a touch that lands anywhere else on
  /// the track.
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

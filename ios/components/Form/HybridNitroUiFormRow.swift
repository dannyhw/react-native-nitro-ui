//
//  HybridNitroUiFormRow.swift
//  react-native-nitro-ui
//
//  A Form row: React Native content that keeps its children where Yoga put them and is shown
//  by a `UICollectionViewListCell`, which draws it, handles its tap and owns its accessory.
//

import NitroModules
import UIKit

final class HybridNitroUiFormRow: HybridNitroUiFormRowSpec, RecyclableView {
  private let host = NitroUiFormRowHostView()

  private var rawAccessory: NitroUiFormAccessory = .none
  private var rawSelected = false
  private var rawPressable = false
  private var perfInstanceId: Int32 = nitroUiPerfNoInstance
  private var press: (() -> Void)?
  private var contentBox: ((_ width: Double) -> Void)?
  /// The width this row's cell last gave it, so JavaScript is told on a change only. `-1` is
  /// "not told yet"; a recycled row goes back to it so the next owner's first report is sent.
  private var reportedBoxWidth: CGFloat = -1

  /// `onPress` calls delivered through the cell. Read by tests.
  private(set) var presses = 0

  override init() {
    super.init()
    host.owner = self
  }

  /// The content view: transparent, touch-transparent, and the Form's way back to this
  /// object from a view UIKit is holding.
  var view: UIView {
    host
  }

  /// The row's component view - what the Form moves into a cell.
  var componentView: UIView? {
    host.superview
  }

  /// The width React last laid this row's content out at: the content view's frame, which
  /// Fabric writes from the row's Yoga content box.
  var contentLaidWidth: CGFloat {
    host.bounds.width
  }

  // MARK: Props

  var accessory: NitroUiFormAccessory {
    get { rawAccessory }
    set { rawAccessory = newValue }
  }

  /// `.none` is a case of a C++-backed enum and of `Optional`, so the comparison is done once,
  /// here, on the string.
  var accessoryValue: FormAccessory {
    switch rawAccessory.stringValue {
      case "disclosure": return .disclosure
      case "checkmark": return .checkmark
      default: return .none
    }
  }

  var selected: Bool {
    get { rawSelected }
    set { rawSelected = newValue }
  }

  var pressable: Bool {
    get { rawPressable }
    set { rawPressable = newValue }
  }

  var nuiPerfId: Variant_NullType_Double {
    get { perfInstanceId >= 0 ? .second(Double(perfInstanceId)) : .first(.null) }
    set { perfInstanceId = newValue.asType(Double.self).map { Int32($0) } ?? nitroUiPerfNoInstance }
  }

  var onPress: (() -> Void)? {
    get { press }
    set { press = newValue }
  }

  var onContentBox: ((_ width: Double) -> Void)? {
    get { contentBox }
    set { contentBox = newValue }
  }

  func afterUpdate() {
    nitroUiAssertMainThread()
    guard let component = componentView else { return }
    // The cell draws the props, so refresh the one cell showing this row: an accessory that
    // appeared must reach a row that is already on screen.
    (component.superview as? NitroUiFormRowContainer)?.owningCell()?.refreshChrome()
  }

  func prepareForRecycle() {
    nitroUiAssertMainThread()
    rawAccessory = .none
    rawSelected = false
    rawPressable = false
    presses = 0
    reportedBoxWidth = -1
  }

  func onDropView() {
    nitroUiAssertMainThread()
    press = nil
    contentBox = nil
    reportedBoxWidth = -1
  }

  // MARK: - The box this row is drawn in

  /// The cell holding this row laid it out at `width`.
  ///
  /// Per row: a cell with a trailing accessory shrinks its content margins, so that row's box
  /// is narrower than a plain row's. A row laid out wider than its box draws content past its
  /// bounds, where UIKit's hit-test stops.
  func contentBoxReported(_ width: CGFloat) {
    guard width > 0, abs(width - reportedBoxWidth) > 0.25 else { return }
    reportedBoxWidth = width
    contentBox?(Double(width))
  }

  /// Whether a cell is drawing this row right now. When none is, the row is parked in its
  /// section's holding view.
  var isShownInCell: Bool {
    componentView?.superview is NitroUiFormRowContainer
  }

  /// Whether this row has ever been told the box it is drawn in.
  var hasReportedBox: Bool { reportedBoxWidth > 0 }

  /// Forgets the box this row was last told, so the next one reaches JavaScript even when it is
  /// the same number. The Form calls it on every row when the list's width changes.
  func forgetReportedBox() {
    reportedBoxWidth = -1
  }

  // MARK: - Events

  /// Asks UIKit to activate the accessibility element this row is part of. A person's
  /// activation is UIKit's synthesised centre tap on the cell, which this does not reproduce.
  func nuiTestA11yClick() throws {
    DispatchQueue.main.async { [weak self] in
      guard let component = self?.componentView else { return }
      for candidate in sequence(first: component, next: { $0.superview }) {
        guard candidate.isAccessibilityElement else { continue }
        candidate.accessibilityActivate()
        return
      }
    }
  }

  /// The cell's press reached this row.
  func cellPressed() {
    presses += 1
    press?()
  }

  /// Fabric gave the row a new height (the content view noticed). Tell the Form, which
  /// tells the one cell showing it.
  func contentHeightChanged(_ height: CGFloat) {
    guard let component = componentView, let form = formOwner() else { return }
    _ = height
    form.rowResized(component)
  }

  private func formOwner() -> HybridNitroUiForm? {
    guard let component = componentView else { return nil }
    for candidate in sequence(first: component.superview, next: { $0?.superview }) {
      if let owner = (candidate as? NitroUiFormHoldingView)?.owner as? HybridNitroUiForm {
        return owner
      }
      if let cell = candidate as? NitroUiFormRowCell,
        let form = cell.formOwner {
        return form
      }
    }
    return nil
  }

  // MARK: - Report
  /// The cached report, refreshed on main for the next read.
  private let reportLock = NSLock()
  private var report = "pending"

  func nuiTestRowReport() throws -> String {
    // Nitro calls this on the JS thread and every number here lives on main. Blocking on main
    // is not allowed, so the read is eventually consistent and the caller polls.
    DispatchQueue.main.async { [weak self] in self?.publishReport() }
    reportLock.lock()
    defer { reportLock.unlock() }
    return report
  }

  /// Snapshot the state for ``nuiTestRowReport()``. Main thread only.
  private func publishReport() {
    let next = buildRowReport()
    reportLock.lock()
    report = next
    reportLock.unlock()
  }


  private func buildRowReport() -> String {
    nitroUiAssertMainThread()
    guard let component = componentView else { return "where=detached" }
    // One test of "is this row being drawn" for both `where=` and `window=`, so they agree.
    let inCell = component.superview is NitroUiFormRowContainer
    let frame = component.frame
    return [
      "where=\(inCell ? "cell" : (component.superview is NitroUiFormHoldingView ? "holding" : "other"))",
      "frame=\(String(format: "%.1f,%.1f,%.1f,%.1f", frame.minX, frame.minY, frame.width, frame.height))",
      // Where the row's pixels are: this view, converted to its window by UIKit. `measure()`
      // walks the shadow tree instead.
      "window=\(Self.inWindow(component, inCell: inCell))",
      "h=\(String(format: "%.1f", component.bounds.height))",
      // What React last laid this row's content out at, against `frame` above.
      "laid=\(String(format: "%.1f", host.bounds.width))",
      "presses=\(presses)",
      // What a screen reader would read out for this row.
      "desc=\(component.accessibilityLabel ?? "-")",
      "accessory=\(rawAccessory.stringValue)",
      "pressable=\(rawPressable ? 1 : 0)",
      "selected=\(rawSelected ? 1 : 0)",
    ].joined(separator: ";")
  }

  /// The view's box in its own window, or `-` when no cell is drawing it.
  ///
  /// `view.window` alone cannot tell: the holding view is hidden rather than detached, so a
  /// parked row still has a window, and converting its bounds answers with a box for pixels
  /// that are nowhere on screen.
  private static func inWindow(_ view: UIView, inCell: Bool) -> String {
    guard inCell, let window = view.window else { return "-" }
    let box = view.convert(view.bounds, to: window)
    return String(format: "%.1f,%.1f,%.1f,%.1f", box.minX, box.minY, box.width, box.height)
  }
}

/// The accessory, in the shape the Form's switch wants.
enum FormAccessory {
  case none
  case disclosure
  case checkmark
}

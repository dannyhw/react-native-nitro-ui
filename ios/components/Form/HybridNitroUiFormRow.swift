//
//  HybridNitroUiFormRow.swift
//  react-native-nitro-ui
//
//  A Row of the S6 Form spike: React Native content that keeps its children where Yoga put
//  them, and is the thing a `UICollectionViewListCell` shows (Q10 Appendix C1).
//
//  The Row is *not* in `CONTENT_CHILDREN_VIEWS`, and that is deliberate: as with a
//  ContextMenu (D36 item 5), a row's children belong in the component view, at the frames
//  Yoga gave them. The content view here is an empty, touch-transparent box whose jobs are
//  to point back at this object (so the Form can find its props from the view UIKit is
//  holding) and to notice a height change (`NitroUiFormRowHostView`).
//
//  A row reports no position of its own. Where it is drawn is the Form's business, and the
//  Form answers for all of them at once with one scroll offset on its shadow node
//  (`HybridNitroUiForm.reportGeometry`); a per-row event would cost a re-render per row per
//  settle to say the same thing.
//
//  What the Row does *not* do is draw anything, handle a tap, or own an accessory: on iOS
//  the cell does all three, through UIKit's own selection, highlight and
//  `UICellAccessory`. That division is the spike's answer to "what does UIKit give you for
//  free".
//

import NitroModules
import UIKit

/// The Row Hybrid View. See the file header.
final class HybridNitroUiFormRow: HybridNitroUiFormRowSpec, RecyclableView {
  private let host = NitroUiFormRowHostView()

  private var rawAccessory: NitroUiFormAccessory = .none
  private var rawSelected = false
  private var rawPressable = false
  private var perfInstanceId: Int32 = nitroUiPerfNoInstance
  private var press: (() -> Void)?

  /// `onPress` calls delivered through the cell, for the harness's 10/10.
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

  // MARK: Props

  var accessory: NitroUiFormAccessory {
    get { rawAccessory }
    set { rawAccessory = newValue }
  }

  /// The accessory as this file and the Form both want it. `.none` is a case of a C++-backed
  /// enum *and* of `Optional`, so the comparison is done once, here, on the string.
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

  func afterUpdate() {
    nitroUiAssertMainThread()
    guard let component = componentView else { return }
    // The props are the cell's business, and the cell is wherever the row is: refresh the
    // one cell showing it. An accessory that appeared must reach a row that is on screen
    // without waiting for it to be scrolled out and back.
    (component.superview as? NitroUiFormRowContainer)?.owningCell()?.refreshChrome()
  }

  func prepareForRecycle() {
    nitroUiAssertMainThread()
    rawAccessory = .none
    rawSelected = false
    rawPressable = false
    presses = 0
  }

  func onDropView() {
    nitroUiAssertMainThread()
    press = nil
  }

  // MARK: - Events

  /// Ask UIKit to activate the accessibility element this row is part of.
  ///
  /// The harness does not assert on iOS: a person's activation there is UIKit's synthesised
  /// centre tap on the cell, which no in-process call reproduces, and a seam that called
  /// `cellPressed()` itself would prove only that this file can call itself. The debt is in
  /// `docs/tasks/FOLLOWUPS.md` (override `accessibilityActivate`).
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
    // Nitro calls a Hybrid method on the JS thread and every number here lives on
    // main. Asking main to answer *now* is the hop AGENTS.md forbids, and asserting
    // on the caller's thread traps - so the read is eventually consistent, exactly as
    // `HybridNitroUiBottomSheet.nuiTestStateReport` does it, and the harness polls.
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
    // The one test of "is this row being drawn", used both by `where=` and by `window=` below,
    // so the two can never disagree about the same row.
    let inCell = component.superview is NitroUiFormRowContainer
    let frame = component.frame
    return [
      "where=\(inCell ? "cell" : (component.superview is NitroUiFormHoldingView ? "holding" : "other"))",
      "frame=\(String(format: "%.1f,%.1f,%.1f,%.1f", frame.minX, frame.minY, frame.width, frame.height))",
      // Where the row's pixels actually are: this view, converted to its window by UIKit.
      // That is a different path from `measure()`, which walks the shadow tree, so a case can
      // compare what JavaScript is told with what the screen shows.
      "window=\(Self.inWindow(component, inCell: inCell))",
      "h=\(String(format: "%.1f", component.bounds.height))",
      "presses=\(presses)",
      // What a screen reader would read out for this row. Android answers the same field, and
      // a recycled view that keeps the previous mount's name is a finding there; iOS answers it
      // so the two can be read against each other (fix round 1, item 9).
      "desc=\(component.accessibilityLabel ?? "-")",
      "accessory=\(rawAccessory.stringValue)",
      "pressable=\(rawPressable ? 1 : 0)",
      "selected=\(rawSelected ? 1 : 0)",
    ].joined(separator: ";")
  }

  /// The view's box in its own window, or `-` when it has none: a row at rest in its
  /// section's holding view draws nothing, so it has no place on screen to report.
  ///
  /// "Has none" cannot be asked of `view.window` alone. The holding view is hidden rather than
  /// detached, so a row that has just been handed back still has a window, and converting its
  /// bounds answers with a box - `0,0,340,44` - for pixels that are nowhere on screen. The E7
  /// case found that after a scroll: the two rows the scroll recycled out of their cells were
  /// compared against that box, and no amount of polling settled it. A row reports pixels only
  /// from inside a cell, which is where its pixels are.
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

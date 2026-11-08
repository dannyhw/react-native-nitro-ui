//
//  HybridNitroUiFormSection.swift
//  react-native-nitro-ui
//
//  A Section of the S6 Form spike: a model in the Form's list, plus the content view its
//  React Native rows are mounted into (Q10 Appendix C1).
//
//  On iOS a Section has no look of its own - UIKit draws the header, the footer, the
//  separators and the section's rounded background - so this class is a router:
//
//  - its content view (`NitroUiFormSectionHoldingView`) is hidden and holds the rows until
//    the list wants one;
//  - every row that mounts or unmounts is forwarded to the Form, with Fabric's index, which
//    is what makes React's order the list's order;
//  - the Form is found through the view tree once, at mount (`form`), because a Section's
//    component view is mounted into the Form's holding view by the same patch.
//
//  `title`/`footer` are strings, and the space they take is reported back through
//  `onMetrics` so Yoga can reserve it - the header is drawn natively but React Native lays
//  the section out, and those two facts need a round trip to coexist.
//

import NitroModules
import UIKit

/// The Section Hybrid View. See the file header.
final class HybridNitroUiFormSection: HybridNitroUiFormSectionSpec, RecyclableView {
  private let holding = NitroUiFormSectionHoldingView()
  let model = NitroUiFormSectionModel()
  /// The Form this section was mounted into, found once. Weak: the Form's list holds rows,
  /// not this.
  private weak var form: HybridNitroUiForm?
  /// Rows that mounted before this section could name its Form, in mount order.
  private var pendingRows: [UIView] = []

  private var rawTitle: String?
  private var rawFooter: String?
  private var perfInstanceId: Int32 = nitroUiPerfNoInstance
  private var metrics: ((Double, Double, Double, Double) -> Void)?
  /// The last `[header, footer, inset, gap]` handed to JavaScript. An array, not a tuple:
  /// a tuple is not `Equatable`, so an optional tuple cannot be compared with a new one.
  private var reportedMetrics: [Double]?

  override init() {
    super.init()
    model.hybrid = self
    model.holding = holding
    holding.model = model
    holding.owner = self
    holding.onChildMount = { [weak self] view, index in self?.rowMounted(view, at: index) }
    holding.onChildUnmount = { [weak self] view in self?.rowUnmounted(view) }
    holding.onLayoutChange = { [weak self] in self?.layoutChanged() }
  }

  /// The content view the rows are mounted into. Hidden; the list shows its rows.
  var view: UIView {
    holding
  }

  // MARK: Props

  var title: Variant_NullType_String {
    get { rawTitle.map { .second($0) } ?? .first(.null) }
    set {
      let next = newValue.asType(String.self)
      if next == rawTitle { return }
      rawTitle = next
      model.title = next
    }
  }

  var footer: Variant_NullType_String {
    get { rawFooter.map { .second($0) } ?? .first(.null) }
    set {
      let next = newValue.asType(String.self)
      if next == rawFooter { return }
      rawFooter = next
      model.footerText = next
    }
  }

  var nuiPerfId: Variant_NullType_Double {
    get { perfInstanceId >= 0 ? .second(Double(perfInstanceId)) : .first(.null) }
    set { perfInstanceId = newValue.asType(Double.self).map { Int32($0) } ?? nitroUiPerfNoInstance }
  }

  var onMetrics: ((Double, Double, Double, Double) -> Void)? {
    get { metrics }
    set { metrics = newValue }
  }

  func afterUpdate() {
    nitroUiAssertMainThread()
    // One application for both strings: the section's items change (the header and footer
    // are items), and the space they need is re-reported from what the layout gives them.
    form?.rowsChanged(in: model)
    reportMetrics()
  }

  func prepareForRecycle() {
    nitroUiAssertMainThread()
    NitroUiFormHoldingView.moving {
      for row in model.rows + pendingRows { row.removeFromSuperview() }
    }
    model.rows.removeAll()
    rawTitle = nil
    rawFooter = nil
    model.title = nil
    model.footerText = nil
    form?.rowsChanged(in: model)
  }

  func onDropView() {
    nitroUiAssertMainThread()
    metrics = nil
    form = nil
  }

  // MARK: - Finding the Form, and the rows that arrived before it

  /// The Form this section sits in: the owner of the holding view this section's component
  /// view was mounted into. A section outside a Form keeps its rows queued, shows nothing,
  /// and says so in its report.
  private func resolveForm() {
    guard form == nil, let component = holding.superview else { return }
    for candidate in sequence(first: component.superview, next: { $0?.superview }) {
      if let owner = (candidate as? NitroUiFormHoldingView)?.owner as? HybridNitroUiForm {
        form = owner
        flushPendingRows()
        return
      }
    }
    // The Form's *component* view is the holding view's superview, so the owner lookup
    // above is the direct case; this is the case where a wrapper view was put between.
    for candidate in sequence(first: component, next: \.superview) {
      for subview in candidate.subviews {
        if let owner = (subview as? NitroUiFormHoldingView)?.owner as? HybridNitroUiForm {
          form = owner
          flushPendingRows()
          return
        }
      }
    }
  }

  /// Called by the Form when this section's component view arrives, and from
  /// `layoutChanged()`: the point at which the rows queued below can finally be placed.
  func adoptPendingRows() {
    resolveForm()
  }

  /// Append every queued row that is still here, in the order they mounted.
  private func flushPendingRows() {
    guard let form, !pendingRows.isEmpty else { return }
    let queued = pendingRows
    pendingRows.removeAll()
    for row in queued where row.superview === holding {
      form.rowMounted(row, in: model, at: model.rows.count)
    }
  }

  // MARK: - Rows

  private func rowMounted(_ row: UIView, at index: Int) {
    guard HybridNitroUiForm.isRowView(row) else { return }
    guard let form else {
      // Not yet: Fabric mounts a subtree bottom-up, so a row is handed to this holding view
      // before this section's component view is handed to the Form's, and the Form cannot be
      // named from here yet. Queue it - the only signal this class trusts is the mount
      // callback it was given.
      if !pendingRows.contains(where: { $0 === row }) { pendingRows.append(row) }
      resolveForm()
      return
    }
    form.rowMounted(row, in: model, at: index)
  }

  private func rowUnmounted(_ row: UIView) {
    pendingRows.removeAll { $0 === row }
    form?.rowUnmounted(row, in: model)
  }

  private func layoutChanged() {
    resolveForm()
    reportMetrics()
  }

  // MARK: - Metrics

  /// The space the header and footer take, asked of UIKit's layout - the same configuration
  /// the supplementary cell is built with, measured at the list's width. A typed constant
  /// here would be an imitation (D38.1) and would go stale the day Dynamic Type changes.
  private func reportMetrics() {
    guard let metrics, let form, model.title?.isEmpty == false || model.footerText?.isEmpty == false
    else { return }
    let header = form.supplementaryHeight(footer: false, in: model)
    let footer = form.supplementaryHeight(footer: true, in: model)
    // iOS: the list's layout supplies the inset-grouped margins and the space between
    // sections, so React Native is told to add nothing. That is the answer to "what must JS
    // reserve, on iOS", not a guess at what it might want.
    let next = [Double(header), Double(footer), 0.0, 0.0]
    if reportedMetrics == next { return }
    reportedMetrics = next
    metrics(next[0], next[1], next[2], next[3])
  }

  // MARK: - Report
  /// The cached report, refreshed on main for the next read.
  private let reportLock = NSLock()
  private var report = "pending"

  func nuiTestSectionReport() throws -> String {
    // Nitro calls a Hybrid method on the JS thread and every number here lives on
    // main. Asking main to answer *now* is the hop AGENTS.md forbids, and asserting
    // on the caller's thread traps - so the read is eventually consistent, exactly as
    // `HybridNitroUiBottomSheet.nuiTestStateReport` does it, and the harness polls.
    DispatchQueue.main.async { [weak self] in self?.publishReport() }
    reportLock.lock()
    defer { reportLock.unlock() }
    return report
  }

  /// Snapshot the state for ``nuiTestSectionReport()``. Main thread only.
  private func publishReport() {
    let next = buildSectionReport()
    reportLock.lock()
    report = next
    reportLock.unlock()
  }


  private func buildSectionReport() -> String {
    nitroUiAssertMainThread()
    let inHolding = model.rows.filter { $0.superview === holding }.count
    return [
      "rows=\(model.rows.count)",
      "subviews=\(holding.subviews.count)",
      "index=\(model.sectionIndex)",
      "title=\(model.title ?? "-")",
      "footer=\(model.footerText ?? "-")",
      "inHolding=\(inHolding)",
      "form=\(form == nil ? "none" : "set")",
      "width=\(String(format: "%.2f", holding.bounds.width))",
      "height=\(String(format: "%.2f", holding.bounds.height))",
    ].joined(separator: ";")
  }
}

// A Form section: a model in the Form's list, plus the hidden content view that holds its
// React Native rows until the list shows them. UIKit draws the header, footer and background.

import NitroModules
import UIKit

final class HybridNitroUiFormSection: HybridNitroUiFormSectionSpec, RecyclableView {
  private let holding = NitroUiFormSectionHoldingView()
  let model = NitroUiFormSectionModel()
  /// The Form this section was mounted into, found once through the view tree.
  private weak var form: HybridNitroUiForm?
  /// Rows that mounted before this section could name its Form, in mount order.
  private var pendingRows: [UIView] = []

  private var rawTitle: String?
  private var rawFooter: String?
  private var perfInstanceId: Int32 = nitroUiPerfNoInstance
  private var metrics: ((Double, Double, Double, Double) -> Void)?
  private var placement: ((Double) -> Void)?
  /// The placement last handed to JavaScript, so a settle that moved nothing sends nothing.
  private var reportedPlacement: Double?
  /// The x the Form says a row is drawn at, folded into the next `onMetrics`.
  private var reportedInset: Double?
  /// The last `[header, footer, inset, gap]` handed to JavaScript.
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

  var onPlacement: ((Double) -> Void)? {
    get { placement }
    set { placement = newValue }
  }

  func afterUpdate() {
    nitroUiAssertMainThread()
    form?.rowsChanged(in: model)
    // The model's identity did not change, so the snapshot alone would not redraw a header
    // or footer that is already on screen.
    form?.chromeChanged(in: model)
    reportMetrics()
  }

  func prepareForRecycle() {
    nitroUiAssertMainThread()
    NitroUiFormHoldingView.moving {
      for row in model.rows + pendingRows { row.removeFromSuperview() }
    }
    model.rows.removeAll()
    pendingRows.removeAll()
    rawTitle = nil
    rawFooter = nil
    model.title = nil
    model.footerText = nil
    reportedMetrics = nil
    reportedPlacement = nil
    reportedInset = nil
    form?.rowsChanged(in: model)
    form?.chromeChanged(in: model)
    // Last: `resolveForm` only looks for a Form while it has none, so a cached one would
    // survive into the next mount and could be the Form of the mount that just ended.
    form = nil
  }

  func onDropView() {
    nitroUiAssertMainThread()
    prepareForRecycle()
    metrics = nil
    placement = nil
    form = nil
  }

  // MARK: - Finding the Form, and the rows that arrived before it

  /// Find the Form this section sits in: the owner of the holding view its component view
  /// was mounted into. A section outside a Form keeps its rows queued and shows nothing.
  private func resolveForm() {
    guard form == nil, let component = holding.superview else { return }
    for candidate in sequence(first: component.superview, next: { $0?.superview }) {
      if let owner = (candidate as? NitroUiFormHoldingView)?.owner as? HybridNitroUiForm {
        form = owner
        flushPendingRows()
        return
      }
    }
    // Not a direct ancestor: a wrapper view sits between this section and the Form.
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

  /// Called by the Form when this section's component view arrives, which is when the queued
  /// rows can be placed.
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
      // Fabric mounts bottom-up, so a row arrives before this section is in the Form. Queue it.
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

  /// Report the space the header and footer take, as UIKit's layout gives it, so Yoga can
  /// reserve it.
  func reportMetrics() {
    guard let metrics, let form else { return }
    let header = form.supplementaryHeight(footer: false, in: model)
    let footer = form.supplementaryHeight(footer: true, in: model)
    let inset = reportedInset ?? 0
    // A cell pads its row above and below, so adjacent rows are drawn this far apart.
    // JavaScript spends it as a margin on each row, so Yoga stacks rows at the same pitch.
    let gap = NitroUiFormRowCell.rowChrome * 2
    let next = [Double(header), Double(footer), inset, gap]
    if reportedMetrics == next { return }
    reportedMetrics = next
    metrics(next[0], next[1], next[2], next[3])
  }

  /// What the Form worked out about this section when the list settled. Each number is sent
  /// to JavaScript only when it changed.
  func applyPlacement(top: CGFloat, inset: CGFloat) {
    nitroUiAssertMainThread()
    let nextTop = Double(top)
    if placement != nil, reportedPlacement != nextTop {
      reportedPlacement = nextTop
      placement?(nextTop)
    }
    let nextInset = Double(inset)
    if reportedInset != nextInset {
      reportedInset = nextInset
      reportMetrics()
    }
  }

  // MARK: - Report
  /// The cached report, refreshed on main for the next read.
  private let reportLock = NSLock()
  private var report = "pending"

  func nuiTestSectionReport() throws -> String {
    // Called on the JS thread, which must not block on main, where the state lives: return
    // the cached report and refresh it for the next read.
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
      // "held": a Form was found and it holds this section. "elsewhere": the Form found is
      // not the one holding it.
      "form=\(form == nil ? "none" : (form.map { $0.holds(model) } == true ? "held" : "elsewhere"))",
      "width=\(String(format: "%.2f", holding.bounds.width))",
      "height=\(String(format: "%.2f", holding.bounds.height))",
      "placed=\(reportedPlacement.map { String(format: "%.2f", $0) } ?? "-")",
      "headerBand=\(reportedMetrics.map { String(format: "%.2f", $0[0]) } ?? "-")",
      "footerBand=\(reportedMetrics.map { String(format: "%.2f", $0[1]) } ?? "-")",
      "inset=\(reportedMetrics.map { String(format: "%.2f", $0[2]) } ?? "-")",
      "headerText=\(form?.headerTextHeight(in: model).map { String(format: "%.2f", $0) } ?? "-")",
      // The text actually drawn; `-` while the section is off screen.
      "drawnTitle=\(form?.drawnSupplementaryText(footer: false, in: model) ?? "-")",
      "drawnFooter=\(form?.drawnSupplementaryText(footer: true, in: model) ?? "-")",
    ].joined(separator: ";")
  }
}

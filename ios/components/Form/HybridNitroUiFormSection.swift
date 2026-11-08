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
//  `onPlacement` is the other half of that round trip: where the list put this section, which
//  JavaScript sends back as the section's absolute `top`. With it, a row's Yoga origin *is*
//  its position in the list's content, and the Form's single scroll-offset correction reaches
//  every row (D45 item 3). UIKit never reads it back — the list owns where a cell draws.
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
  private var placement: ((Double) -> Void)?
  /// The placement last handed to JavaScript, so a settle that moved nothing sends nothing.
  private var reportedPlacement: Double?
  /// The x the Form says a row is drawn at, folded into the next `onMetrics`.
  private var reportedInset: Double?
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

  var onPlacement: ((Double) -> Void)? {
    get { placement }
    set { placement = newValue }
  }

  func afterUpdate() {
    nitroUiAssertMainThread()
    // One application for both strings: the section's items change (the header and footer
    // are items), and the space they need is re-reported from what the layout gives them.
    form?.rowsChanged(in: model)
    // ...and the band that is already on screen is re-drawn, because the model's identity did
    // not change and a snapshot that changes nothing tells UIKit nothing.
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
  }

  func onDropView() {
    nitroUiAssertMainThread()
    prepareForRecycle()
    metrics = nil
    placement = nil
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
  func reportMetrics() {
    guard let metrics, let form else { return }
    let header = form.supplementaryHeight(footer: false, in: model)
    let footer = form.supplementaryHeight(footer: true, in: model)
    // The x a row is drawn at, asked of the Form, which reads it off a cell.
    let inset = reportedInset ?? 0
    // The space *between* adjacent rows, which `Form.tsx` spends as a margin on each row
    // (`marginVertical: gap / 2`) so that rows' Yoga pitch is the pitch they are drawn at.
    // On Android that is the Material segmented list's gap. On iOS the list's layout has one
    // continuous background per section, so there is no gap between *shapes* - but there is
    // chrome between rows: `NitroUiFormRowCell` pins a row 4 pt below the cell's top and 4 pt
    // above its bottom, so a cell is 8 pt taller than the row inside it and adjacent rows sit
    // 8 pt apart. Reading `0` there - as this line did - is what made a `measure` of the 14th
    // row 104 pt short of its pixels (E7), because the shadow tree stacked rows at 44 pt
    // while the list drew them at 52. Read off the cell, so the number is the chrome.
    let gap = NitroUiFormRowCell.rowChrome * 2
    let next = [Double(header), Double(footer), inset, gap]
    if reportedMetrics == next { return }
    reportedMetrics = next
    metrics(next[0], next[1], next[2], next[3])
  }

  /// What the Form worked out about this section when the list settled.
  ///
  /// Both numbers arrive together because both are properties of *this section's* box, and
  /// either can move without the other (a header appears; a resize changes the margins). Each
  /// is compared against what was last sent, so a settle that changed neither is silent —
  /// which is the difference between one re-render per settle and one per section per settle.
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
      // What the shadow tree was told, as opposed to where the list actually put the section:
      // `top=-` is a Form that has never settled.
      "placed=\(reportedPlacement.map { String(format: "%.2f", $0) } ?? "-")",
      "headerBand=\(reportedMetrics.map { String(format: "%.2f", $0[0]) } ?? "-")",
      "footerBand=\(reportedMetrics.map { String(format: "%.2f", $0[1]) } ?? "-")",
      "inset=\(reportedMetrics.map { String(format: "%.2f", $0[2]) } ?? "-")",
      "headerText=\(form?.headerTextHeight(in: model).map { String(format: "%.2f", $0) } ?? "-")",
      // What the band on screen is painted with, as opposed to what this class holds: a title
      // that reached `title=` but not `drawnTitle=` is a heading nobody can read. `-` is a
      // band the list has not realised (the section is off screen), not a missing one.
      "drawnTitle=\(form?.drawnSupplementaryText(footer: false, in: model) ?? "-")",
      "drawnFooter=\(form?.drawnSupplementaryText(footer: true, in: model) ?? "-")",
    ].joined(separator: ";")
  }
}

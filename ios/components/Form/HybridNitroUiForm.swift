//
//  HybridNitroUiForm.swift
//  react-native-nitro-ui
//
//  The Form of the S6 spike: a `UICollectionView` with
//  `UICollectionLayoutListConfiguration(appearance: .insetGrouped)` - the UIKit list under
//  SwiftUI's `Form` - whose rows are React Native views moved into
//  `UICollectionViewListCell`s (Q10 Appendix C1; the questions are Appendix E).
//
//  **Registration.** Sections and rows arrive through the mount callbacks of a
//  `NitroUiFormHoldingView` (the content-children patch of `scripts/patch-nitrogen.mjs`
//  inserts Fabric's children into `contentView`, and a holding view *is* a Form's or a
//  Section's content view), in Fabric's order. The Form keeps `[NitroUiFormSectionModel]`,
//  each with its ordered rows.
//
//  **Identity.** The diffable snapshot's item identity *is* the row view's identity. That
//  is what makes a keyed insert in the middle an *insert*: the other rows keep their
//  Fabric state, their hosted control and their text layout, which is question 1's reorder
//  case. A rebuild would have looked the same on screen and failed the question.
//
//  **Reparenting.** `cellForItemAt` takes a row out of its section's holding view and puts
//  it in the cell; `didEndDisplaying` gives it back. The row is in one place at a time
//  because this class owns both moves, and its frame is `(0, 0, w, h)` in either - see
//  `NitroUiFormViews.swift` for why.
//
//  Nothing here is a shippable decision. It is a prototype to be measured and argued with;
//  `docs/tasks/S6-form-spike.report.md` is the deliverable.
//

import NitroModules
import SwiftUI
import UIKit

/// One section of the prototype Form: its rows, in React's order, and its chrome.
///
/// Identity-based - a Section is a screen object, not a value - which is also what a
/// diffable snapshot section needs.
final class NitroUiFormSectionModel: NSObject {
  /// The rows, in the order React rendered them. Weak-free on purpose: a row React keeps
  /// alive must not vanish from the list because nothing else held it.
  var rows: [UIView] = []
  var title: String?
  var footerText: String?
  /// The section's Hybrid View. Weak: the component view owns it.
  weak var hybrid: HybridNitroUiFormSection?
  /// Where this section's rows live while they are not in a cell.
  weak var holding: NitroUiFormSectionHoldingView?
  /// Position in the Form, for reports.
  private(set) var sectionIndex = 0

  func reindex(_ index: Int) { sectionIndex = index }
}

/// The Form Hybrid View. See the file header.
final class HybridNitroUiForm: HybridNitroUiFormSpec, RecyclableView {
  // MARK: Views

  /// The Form's content view: where the sections' component views are mounted, hidden,
  /// while the list is not showing them.
  private let holding = NitroUiFormHoldingView()
  var holdingView: UIView { holding }

  private lazy var list: UICollectionView = {
    var configuration = UICollectionLayoutListConfiguration(appearance: .insetGrouped)
    configuration.headerMode = .supplementary
    configuration.footerMode = .supplementary
    let layout = UICollectionViewCompositionalLayout.list(using: configuration)
    let view = UICollectionView(frame: .zero, collectionViewLayout: layout)
    view.backgroundColor = .systemGroupedBackground
    view.keyboardDismissMode = .interactive
    if #available(iOS 16.0, *) {
      // A row's height constraint is the cell's height; this is what tells the layout that
      // it changed, instead of a hand-rolled invalidation for every text reflow.
      view.selfSizingInvalidation = .enabledIncludingConstraints
    }
    view.register(
      NitroUiFormRowCell.self,
      forCellWithReuseIdentifier: NitroUiFormItem.rowReuseIdentifier
    )
    let headerKind = UICollectionView.elementKindSectionHeader
    let footerKind = UICollectionView.elementKindSectionFooter
    view.register(
      NitroUiFormSupplementaryCell.self,
      forSupplementaryViewOfKind: headerKind,
      withReuseIdentifier: NitroUiFormItem.headerReuseIdentifier
    )
    view.register(
      NitroUiFormSupplementaryCell.self,
      forSupplementaryViewOfKind: footerKind,
      withReuseIdentifier: NitroUiFormItem.footerReuseIdentifier
    )
    return view
  }()

  private var dataSource:
    UICollectionViewDiffableDataSource<NitroUiFormSectionModel, NitroUiFormItem>?
  private var sections: [NitroUiFormSectionModel] = []
  /// The component view, so rows can be given back to the tree the list is not showing.
  private weak var component: UIView?
  private var framedList = false

  // MARK: Props, stored raw (the setter stores; `afterUpdate()` applies)

  private var avoidsKeyboard = true
  private var perfInstanceId: Int32 = nitroUiPerfNoInstance
  private var contentBox: ((_ width: Double) -> Void)?

  // MARK: Witnesses

  /// Every row this Form has been told about and that is still alive - the leak witness.
  private let knownRows = NSHashTable<UIView>.weakObjects()
  private var reparents = 0
  private var reclaims = 0
  private var taps = 0
  private var snapshotApplies = 0
  private var reportedWidth: CGFloat = .zero
  private var keyboardInset: CGFloat = .zero

  override init() {
    super.init()
    holding.owner = self
    holding.onChildMount = { [weak self] view, index in self?.sectionMounted(view, at: index) }
    holding.onChildUnmount = { [weak self] view in self?.sectionUnmounted(view) }
    holding.onLayoutChange = { [weak self] in self?.listNeedsFrame() }
  }

  /// The Hybrid View's view, which `setContentView:` installs and the content-children
  /// patch mounts into. The collection view is added to the *component* view once, in
  /// `listNeedsFrame()`, so no update path ever recreates it.
  var view: UIView {
    holding
  }

  // MARK: Props

  var keyboardAvoidance: Bool {
    get { avoidsKeyboard }
    set { avoidsKeyboard = newValue }
  }

  var nuiPerfId: Variant_NullType_Double {
    get { perfInstanceId >= 0 ? .second(Double(perfInstanceId)) : .first(.null) }
    set { perfInstanceId = newValue.asType(Double.self).map { Int32($0) } ?? nitroUiPerfNoInstance }
  }

  var onContentBox: ((_ width: Double) -> Void)? {
    get { contentBox }
    set { contentBox = newValue }
  }

  func afterUpdate() {
    nitroUiAssertMainThread()
    if avoidsKeyboard {
      addKeyboardObservers()
    } else {
      removeKeyboardObservers()
      setBottomInset(0)
    }
  }

  func prepareForRecycle() {
    nitroUiAssertMainThread()
    for section in sections {
      NitroUiFormHoldingView.moving {
        for row in section.rows { row.removeFromSuperview() }
      }
      section.rows.removeAll()
    }
    sections.removeAll()
    knownRows.removeAllObjects()
    reparents = 0
    reclaims = 0
    taps = 0
    applySnapshot()
  }

  func onDropView() {
    nitroUiAssertMainThread()
    prepareForRecycle()
    removeKeyboardObservers()
    contentBox = nil
  }

  // MARK: - Putting the list in the component view

  /// The holding view is laid out by Fabric, inside the component view's padding. The list
  /// takes the same box. Once, not per update.
  private func listNeedsFrame() {
    guard let parent = holding.superview else { return }
    component = parent
    list.frame = holding.frame
    list.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    if list.superview !== parent {
      parent.insertSubview(list, at: 0)
      list.delegate = listDelegate
    }
    if holding.frame.width > 0 {
      // The layout needs one pass before it can answer what a cell is wide.
      list.layoutIfNeeded()
      reportContentBox()
      if !framedList { framedList = true }
    }
  }

  // MARK: - Sections (the content-children patch drives these)

  private func sectionMounted(_ view: UIView, at index: Int) {
    guard let model = HybridNitroUiForm.sectionModel(in: view) else {
      // Not a Section - a stray `View` React Native put in the Form. It stays in the
      // holding view, invisible, and the harness's `orphans` line says so.
      return
    }
    guard !sections.contains(where: { $0 === model }) else { return }
    sections.insert(model, at: min(index, sections.count))
    reindex()
    applySnapshot()
    // Fabric mounts a subtree bottom-up, so this section's rows were already handed to its
    // holding view, and the `didAddSubview` that saw each one could not name a Form yet and
    // dropped it. Ask the section for them now that both ends exist.
    model.hybrid?.adoptPendingRows()
    applySnapshot()
  }

  private func sectionUnmounted(_ view: UIView) {
    guard let model = HybridNitroUiForm.sectionModel(in: view) else { return }
    NitroUiFormHoldingView.moving {
      for row in model.rows { row.removeFromSuperview() }
    }
    model.rows.removeAll()
    sections.removeAll { $0 === model }
    reindex()
    applySnapshot()
  }

  /// A Section's model, from the Section's component view: the model is reachable through
  /// the Section's content view, which is a subview of that component view.
  static func sectionModel(in componentView: UIView) -> NitroUiFormSectionModel? {
    for subview in componentView.subviews {
      if let holding = subview as? NitroUiFormSectionHoldingView { return holding.model }
    }
    return nil
  }

  private func reindex() {
    for (index, section) in sections.enumerated() { section.reindex(index) }
  }

  // MARK: - Rows (a Section drives these)

  func rowMounted(_ row: UIView, in model: NitroUiFormSectionModel, at index: Int) {
    guard HybridNitroUiForm.isRowView(row) else { return }
    if model.rows.contains(where: { $0 === row }) {
      rowMoved(row, in: model, to: index)
      return
    }
    model.rows.insert(row, at: min(index, model.rows.count))
    knownRows.add(row)
    applySnapshot()
  }

  func rowUnmounted(_ row: UIView, in model: NitroUiFormSectionModel) {
      // The caller is whatever view currently holds the row - the section's holding view or
      // a cell's container - and it is mid-removal already, so there is nothing to detach
      // here. Doing it again re-enters `willRemoveSubview`, and detaching a row the caller
      // has not yet removed leaves Fabric a child with no parent to unmount.
      model.rows.removeAll { $0 === row }
    applySnapshot()
  }

  private func rowMoved(_ row: UIView, in model: NitroUiFormSectionModel, to index: Int) {
    guard let current = model.rows.firstIndex(where: { $0 === row }), current != index else {
      return
    }
    model.rows.remove(at: current)
    model.rows.insert(row, at: min(index, model.rows.count))
    applySnapshot()
  }

  /// A row's Yoga height changed. If it is on screen its cell's height constraint follows
  /// and `selfSizingInvalidation` re-runs the layout for that one item; if it is not, the
  /// next dequeue reads the new height anyway.
  func rowResized(_ row: UIView) {
    guard let path = path(for: row),
      let cell = list.cellForItem(at: path) as? NitroUiFormRowCell else { return }
    cell.formOwner = self
    cell.apply(row)
  }

  func rowsChanged(in model: NitroUiFormSectionModel) {
    guard sections.contains(where: { $0 === model }) else { return }
    applySnapshot()
  }

  /// Whether this Form has ever been told about `row`. The harvest's filter: a row it has
  /// seen and then dropped from a model went away for a reason, and re-adding it from the
  /// harvest would loop (drop -> harvest -> cell -> drop).
  func knows(_ row: UIView) -> Bool {
    knownRows.contains(row)
  }

  func model(forRow row: UIView) -> NitroUiFormSectionModel? {
    sections.first { section in section.rows.contains(where: { $0 === row }) }
  }

  func path(for row: UIView) -> IndexPath? {
    guard let sectionIndex = sections.firstIndex(where: { section in
      section.rows.contains(where: { $0 === row })
    }) else { return nil }
    let rows = sections[sectionIndex].rows
    guard let rowIndex = rows.firstIndex(where: { $0 === row }) else { return nil }
    // A section's header and footer are supplementary views, not items, so item `n` is
    // row `n`.
    return IndexPath(item: rowIndex, section: sectionIndex)
  }

  /// A snapshot is queued, not applied in place.
  ///
  /// Sections and rows arrive from `didAddSubview`, which runs inside Fabric's layout of
  /// the component view; applying a snapshot there is UIKit's "the data source changed
  /// during a layout pass" crash. One coalesced apply per turn of the run loop is also
  /// what makes mounting 50 rows 1 apply rather than 50.
  private var snapshotQueued = false

  private func applySnapshot() {
    if snapshotQueued { return }
    snapshotQueued = true
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.snapshotQueued = false
      self.applySnapshotNow()
    }
  }

  private func applySnapshotNow() {
    var snapshot = NSDiffableDataSourceSnapshot<
      NitroUiFormSectionModel, NitroUiFormItem
    >()
    if !sections.isEmpty {
      snapshot.appendSections(sections)
      for section in sections {
        snapshot.appendItems(section.rows.map { NitroUiFormItem.row($0) }, toSection: section)
      }
    }
    snapshotApplies += 1
    if dataSource == nil {
      configureDataSource()
    }
    dataSource?.apply(snapshot, animatingDifferences: false)
  }

  private func configureDataSource() {
    let dataSource = UICollectionViewDiffableDataSource<
      NitroUiFormSectionModel, NitroUiFormItem
    >(collectionView: list) { [weak self] collectionView, indexPath, item in
      self?.cell(at: indexPath, for: item, in: collectionView) ?? UICollectionViewCell()
    }
    dataSource.supplementaryViewProvider = { [weak self] collectionView, kind, indexPath in
      self?.supplementary(kind, at: indexPath, in: collectionView)
    }
    self.dataSource = dataSource
  }

  private func cell(
    at indexPath: IndexPath,
    for item: NitroUiFormItem,
    in collectionView: UICollectionView
  ) -> UICollectionViewCell {
    guard case let .row(row) = item,
      let cell = collectionView.dequeueReusableCell(
        withReuseIdentifier: NitroUiFormItem.rowReuseIdentifier,
        for: indexPath
      ) as? NitroUiFormRowCell,
      indexPath.section < sections.count
    else {
      return UICollectionViewCell()
    }
    let model = sections[indexPath.section]
    cell.onGiveBack = { [weak self] given in
      self?.reclaims += 1
      // Back to its section's holding view, where Fabric put it. The Form's own move, so
      // the holding view must not read it as a Fabric remount.
      NitroUiFormHoldingView.moving { model.holding?.addSubview(given) }
    }
    cell.onRowRemoved = { [weak self] removed in
      // Fabric unmounted this row out of the cell it was showing.
      self?.rowUnmounted(removed, in: model)
    }
    cell.apply(row)
    reparents += 1
    knownRows.add(row)

    refresh(cell: cell, for: row)
    return cell
  }

  /// The chrome a row's props decide: the accessory, and whether a tap highlights it. The
  /// Row calls this when its props change while it is on screen, so an accessory that
  /// appeared does not have to wait for a scroll.
  func refresh(cell: NitroUiFormRowCell, for row: UIView) {
    let owner = HybridNitroUiForm.rowOwner(of: row)
    cell.accessories = Self.accessories(for: owner)
    cell.isPressable = owner?.pressable == true
    cell.isSelectedRow = owner?.selected == true
    var configuration = UIBackgroundConfiguration.listGroupedCell()
    configuration.backgroundColor = .secondarySystemGroupedBackground
    cell.backgroundConfiguration = configuration
    // UIKit re-runs this on highlight and selection, which is the only way to follow them:
    // iOS 27's UIKit has no `selectionHighlightConfiguration` any more (see the cell).
    cell.setNeedsUpdateConfiguration()
  }

  private func supplementary(
    _ kind: String,
    at indexPath: IndexPath,
    in collectionView: UICollectionView
  ) -> UICollectionReusableView? {
    let isFooter = kind == UICollectionView.elementKindSectionFooter
    let reuse = isFooter
      ? NitroUiFormItem.footerReuseIdentifier
      : NitroUiFormItem.headerReuseIdentifier
    guard indexPath.section < sections.count,
      let cell = collectionView.dequeueReusableSupplementaryView(
        ofKind: kind,
        withReuseIdentifier: reuse,
        for: indexPath
      ) as? NitroUiFormSupplementaryCell else { return nil }
    let model = sections[indexPath.section]
    cell.configure(text: isFooter ? model.footerText : model.title, footer: isFooter)
    return cell
  }

  private static func accessories(
    for row: HybridNitroUiFormRow?
  ) -> [UICellAccessory] {
    switch row?.accessoryValue {
      case .disclosure: return [.disclosureIndicator(displayed: .always)]
      case .checkmark: return [.checkmark(displayed: .always)]
      default: return []
    }
  }

  /// The row a view is inside of, walking out of a cell's container. Used by the keyboard
  /// path, which starts at the focused control rather than at a row.
  static func rowAncestor(of view: UIView) -> UIView? {
    for candidate in sequence(first: view, next: { $0.superview }) {
      if candidate is NitroUiFormRowContainer || candidate is NitroUiFormRowHostView {
        return candidate
      }
    }
    return nil
  }

  /// The Row Hybrid View behind a row's component view, reached the same way the Section's
  /// model is: through the content view the Row installed.
  static func rowOwner(of componentView: UIView) -> HybridNitroUiFormRow? {
    for subview in componentView.subviews {
      if let host = subview as? NitroUiFormRowHostView { return host.owner }
    }
    return nil
  }

  // MARK: - The list's delegate (a separate `NSObject`; a Nitro Hybrid is not one)

  private lazy var listDelegate = NitroUiFormListDelegate(form: self)

  /// UIKit's cell selection reached a row.
  func listDidSelectItem(
    _ indexPath: IndexPath,
    in collectionView: UICollectionView
  ) {
    collectionView.deselectItem(at: indexPath, animated: true)
    guard let item = dataSource?.itemIdentifier(for: indexPath),
      case let .row(view) = item,
      let row = HybridNitroUiForm.rowOwner(of: view),
      row.pressable else { return }
    taps += 1
    row.cellPressed()
  }

  /// A cell scrolled away: hand its row back before UIKit reuses the cell.
  func listDidEndDisplaying(_ cell: UICollectionViewCell) {
    guard let cell = cell as? NitroUiFormRowCell else { return }
    cell.giveBack()
  }

  // MARK: - Content box

  private func reportContentBox() {
    let width = contentWidth()
    guard width > 0, abs(width - reportedWidth) > 0.25 else { return }
    reportedWidth = width
    contentBox?(Double(width))
  }

  /// The width a cell actually gets, asked of the layout - not four typed constants. The
  /// inset-grouped margins and the cell's own content margins live in the layout.
  private func contentWidth() -> CGFloat {
    guard list.bounds.width > 0 else { return 0 }
    if let attributes = list.layoutAttributesForItem(at: IndexPath(item: 0, section: 0)) {
      return attributes.frame.width
    }
    return list.bounds.width
  }

  // MARK: - What the layout knows (a Section asks, rather than typing constants)

  /// The width a cell gets, for measuring the space a header needs.
  func contentWidthForMetrics() -> CGFloat {
    contentWidth()
  }

  /// The height UIKit's own layout gives this section's header, or 0. Asked of the layout
  /// with the configuration the header cell is built with, which is the only way this number
  /// is not an imitation (D38.1).
  func supplementaryHeight(footer: Bool, in model: NitroUiFormSectionModel) -> CGFloat {
    guard let sectionIndex = sections.firstIndex(where: { $0 === model }) else { return 0 }
    let kind = footer
      ? UICollectionView.elementKindSectionFooter
      : UICollectionView.elementKindSectionHeader
    let attributes = list.collectionViewLayout.layoutAttributesForSupplementaryView(
      ofKind: kind,
      at: IndexPath(item: 0, section: sectionIndex)
    )
    return attributes?.frame.height ?? 0
  }

  // MARK: - Keyboard (question 5)

  private var keyboardObservers: [NSObjectProtocol] = []

  private func addKeyboardObservers() {
    guard keyboardObservers.isEmpty else { return }
    let center = NotificationCenter.default
    keyboardObservers = [
      center.addObserver(
        forName: UIResponder.keyboardWillChangeFrameNotification,
        object: nil,
        queue: .main
      ) { [weak self] note in self?.keyboardFrameChanged(note) },
      center.addObserver(
        forName: UIResponder.keyboardDidHideNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in self?.setBottomInset(0) },
    ]
  }

  private func removeKeyboardObservers() {
    for observer in keyboardObservers { NotificationCenter.default.removeObserver(observer) }
    keyboardObservers.removeAll()
  }

  private func keyboardFrameChanged(_ note: Notification) {
    guard let end = (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?
      .cgRectValue
    else { return }
    let inList = list.convert(end, from: nil)
    let overlap = max(0, list.frame.maxY - inList.minY)
    setBottomInset(overlap)
    guard let focused = list.findFirstResponder(),
      let row = HybridNitroUiForm.rowAncestor(of: focused) else { return }
    let rect = list.convert(row.frame, from: row.superview)
    let visibleBottom = list.frame.maxY - list.adjustedContentInset.bottom
    if rect.maxY > visibleBottom {
      list.setContentOffset(
        CGPoint(
          x: list.contentOffset.x,
          y: list.contentOffset.y + (rect.maxY - visibleBottom) + 8
        ),
        animated: true
      )
    }
  }

  private func setBottomInset(_ inset: CGFloat) {
    keyboardInset = inset
    guard abs(list.contentInset.bottom - inset) > 0.5 else { return }
    list.contentInset.bottom = inset
    list.verticalScrollIndicatorInsets.bottom = inset
  }

  // MARK: - Reports (test seams)
  /// The cached report, refreshed on main for the next read.
  private let reportLock = NSLock()
  private var report = "pending"

  func nuiTestFormReport() throws -> String {
    // Nitro calls a Hybrid method on the JS thread and every number here lives on
    // main. Asking main to answer *now* is the hop AGENTS.md forbids, and asserting
    // on the caller's thread traps - so the read is eventually consistent, exactly as
    // `HybridNitroUiBottomSheet.nuiTestStateReport` does it, and the harness polls.
    DispatchQueue.main.async { [weak self] in self?.publishReport() }
    reportLock.lock()
    defer { reportLock.unlock() }
    return report
  }

  /// Snapshot the state for ``nuiTestFormReport()``. Main thread only.
  private func publishReport() {
    let next = buildFormReport()
    reportLock.lock()
    report = next
    reportLock.unlock()
  }


  private func buildFormReport() -> String {
    nitroUiAssertMainThread()
    if reference != nil, let measured = measuredList() {
      // The reference is over the box, so the prototype cannot be measured at the same time;
      // the harness takes the prototype reading first.
      return geometryFields(of: measured, kind: "reference").joined(separator: ";")
    }
    var rows = 0
    var orphans = 0
    for section in sections {
      rows += section.rows.count
      for row in section.rows where !HybridNitroUiForm.rowIsPlaced(row, in: section) {
        orphans += 1
      }
    }
    let inCells = list.visibleCells.compactMap { ($0 as? NitroUiFormRowCell)?.row }.count
    let heights = visibleHeights()
    return ([
      "sections=\(sections.count)",
      "rows=\(rows)",
      "items=\(dataSource?.snapshot().numberOfItems ?? -1)",
      "inCells=\(inCells)",
      "orphans=\(orphans)",
      "alive=\(knownRows.count)",
      "reparents=\(reparents)",
      "reclaims=\(reclaims)",
      "applies=\(snapshotApplies)",
      "width=\(Self.number(reportedWidth))",
      "listWidth=\(Self.number(list.bounds.width))",
      "heights=\(heights)",
      "taps=\(taps)",
      "keyboard=\(Self.number(keyboardInset))",
    ] + geometryFields(of: list, kind: "prototype")).joined(separator: ";")
  }

  /// The heights the layout gives the first few rows, so a harness compares the list's own
  /// answer rather than a screenshot.
  private func visibleHeights() -> String {
    var out: [String] = []
    for section in 0..<min(sections.count, 2) {
      for item in 0..<(dataSource?.snapshot().numberOfItems(inSection: sections[section]) ?? 0) {
        let path = IndexPath(item: item, section: section)
        guard case .row? = dataSource?.itemIdentifier(for: path),
          let height = list.layoutAttributesForItem(at: path)?.frame.height else { continue }
        out.append(Self.number(height))
        if out.count >= 6 { break }
      }
    }
    return out.joined(separator: ",")
  }

  private static func number(_ value: CGFloat) -> String {
    String(format: "%.2f", value)
  }

  func nuiTestScrollTo(y: Double) throws {
    // Same reason as the reports: the caller is on the JS thread. The harness reads a
    // report after this, and a report is refreshed on main, so it cannot overtake it.
    DispatchQueue.main.async { [weak self] in
      self?.list.setContentOffset(CGPoint(x: 0, y: CGFloat(y)), animated: false)
      self?.list.layoutIfNeeded()
    }
  }

  // MARK: - The SwiftUI `Form` reference (question 2)

  /// The hosted reference, while it is up.
  private var reference: UIHostingController<NitroUiFormReferenceForm>?

  func nuiTestCommand(command: String) throws {
    DispatchQueue.main.async { [weak self] in self?.run(command: command) }
  }

  private func run(command: String) {
    nitroUiAssertMainThread()
    switch command {
      case "show-reference":
        guard reference == nil, let component else { return }
        let host = UIHostingController(rootView: NitroUiFormReferenceForm())
        host.view.backgroundColor = .systemGroupedBackground
        host.view.frame = component.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        list.isHidden = true
        component.addSubview(host.view)
        component.bringSubviewToFront(host.view)
        reference = host
        component.setNeedsLayout()
        component.layoutIfNeeded()
      case "hide-reference":
        hideReference()
      default:
        break
    }
  }

  private func hideReference() {
    guard let reference else { return }
    reference.view.removeFromSuperview()
    self.reference = nil
    list.isHidden = false
  }

  /// The list currently answering for this Form's box: the reference's when it is up.
  private func measuredList() -> UICollectionView? {
    if let reference { return nitroUiFindListView(reference.view) }
    return list
  }

  /// What a grouped list measures like, read from the list itself.
  ///
  /// One function for both sides of question 2 on purpose: the prototype and the SwiftUI
  /// reference are only comparable if the same code measures them, and the go line is in
  /// points, not in impressions. The item frame is the group's box, `radius` the corner the
  /// list actually draws, `sep` the x a separator starts at, and the header/footer frames
  /// the supplementary view's own - all of it the layout's answer, never a constant.
  private func geometryFields(of list: UICollectionView, kind: String) -> [String] {
    var out = ["kind=\(kind)", "listW=\(Self.number(list.bounds.width))"]
    list.layoutIfNeeded()
    let first = IndexPath(item: 0, section: 0)
    if let attrs = list.layoutAttributesForItem(at: first) {
      out.append("x=\(Self.number(attrs.frame.minX))")
      out.append("y=\(Self.number(attrs.frame.minY))")
      out.append("w=\(Self.number(attrs.frame.width))")
    }
    var heights: [String] = []
    if list.numberOfSections > 0 {
      for item in 0..<min(list.numberOfItems(inSection: 0), 3) {
        let height = list.layoutAttributesForItem(at: IndexPath(item: item, section: 0))?
          .frame.height
        heights.append(Self.number(height ?? -1))
      }
    }
    while heights.count < 3 { heights.append("-") }
    out.append("h0=\(heights[0])")
    out.append("h1=\(heights[1])")
    out.append("h2=\(heights[2])")
    let headerKind = UICollectionView.elementKindSectionHeader
    let footerKind = UICollectionView.elementKindSectionFooter
    let headerPath = IndexPath(item: 0, section: 0)
    if let header = list.layoutAttributesForSupplementaryElement(ofKind: headerKind, at: headerPath) {
      out.append("headerX=\(Self.number(header.frame.minX))")
      out.append("headerY=\(Self.number(header.frame.minY))")
      out.append("headerH=\(Self.number(header.frame.height))")
    }
    if let footer = list.layoutAttributesForSupplementaryElement(
      ofKind: footerKind,
      at: IndexPath(item: 0, section: max(0, list.numberOfSections - 1))
    ) {
      out.append("footerH=\(Self.number(footer.frame.height))")
    }
    if let cell = list.visibleCells.first {
      // The rounding of a grouped cell lives on the background configuration's own view, not
      // on the cell layer, so the scan covers every view the cell owns.
      var radius = nitroUiMaxCornerRadius(cell.layer)
      for view in [cell.backgroundView, cell.selectedBackgroundView, cell.contentView] {
        if let view { radius = max(radius, nitroUiMaxCornerRadius(view.layer)) }
      }
      out.append("radius=\(Self.number(radius))")
      // Where a separator starts, from the guide UIKit aligns it to. `separatorInset` is a
      // `UITableView` idea; a list cell exposes a layout guide instead.
      let separator = (cell as? UICollectionViewListCell)?.separatorLayoutGuide.layoutFrame.minX
      out.append("sep=\(Self.number(separator ?? cell.directionalLayoutMargins.leading))")
    }
    return out
  }

  /// A row is placed when it is in its section's holding view or in a cell's container.
  static func rowIsPlaced(_ row: UIView, in model: NitroUiFormSectionModel) -> Bool {
    guard let superview = row.superview else { return false }
    if superview === model.holding { return true }
    return superview is NitroUiFormRowContainer
  }

  /// Whether a subview of a Section's holding view is a `Form.Row`'s component view - which
  /// it is exactly when it carries the content view the Row Hybrid View installed. A plain
  /// `View` React Native put in a Section is not a row, and registering one as a row would
  /// give the list an item no React tree has.
  static func isRowView(_ view: UIView) -> Bool {
    view.subviews.contains { $0 is NitroUiFormRowHostView }
  }
}

extension NitroUiFormItem {
  static let rowReuseIdentifier = "nitroui-form-row"
  static let headerReuseIdentifier = "nitroui-form-header"
  static let footerReuseIdentifier = "nitroui-form-footer"
}

/// The items of one section: its row views, identified by the view itself.
///
/// Identity is the row's, not its position, which is what makes a keyed insert in the
/// middle of a section a real insert in the diff (Appendix E question 1). A section's
/// header and footer are supplementary views, so they are not items and cannot collide
/// with one another the way an enum case per part of a section would.
enum NitroUiFormItem: Hashable {
  case row(UIView)

  static func == (lhs: NitroUiFormItem, rhs: NitroUiFormItem) -> Bool {
    switch (lhs, rhs) {
      case let (.row(a), .row(b)): return a === b
    }
  }

  func hash(into hasher: inout Hasher) {
    switch self {
      case let .row(view): hasher.combine(ObjectIdentifier(view))
    }
  }
}

private extension UIView {
  func findFirstResponder() -> UIView? {
    if isFirstResponder { return self }
    for subview in subviews {
      if let found = subview.findFirstResponder() { return found }
    }
    return nil
  }
}

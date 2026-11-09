//
//  HybridNitroUiForm.swift
//  react-native-nitro-ui
//
//  `Form`: a `UICollectionView` with
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
//  **Where a row is.** A row is drawn by a cell, which moves without React Native knowing,
//  and `measure` never asks a view where it ended up (D45 item 3). Two numbers fix that for
//  every row at once, both reported when the list *settles*: each section's top in the list's
//  own content coordinates (`onPlacement`, which `Form.tsx` puts the section at with
//  `position: absolute`), and how far the content is scrolled (`onContentOffset`, which goes
//  straight back in as `nuiContentOffsetY` and out of the Form's shadow node as
//  `-offset`). A row's Yoga origin is then its position in the content, and the one number
//  the shadow node subtracts is the one number that changes while scrolling. See
//  `docs/components/form.md` for what that means for a `measure` taken mid-flick.
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
    // UIKit's own selection recognises at touch-down, and React Native will not share a
    // touch with a recognizer it did not create - `RCTSurfaceTouchHandler` answers `NO` to
    // `shouldRecognizeSimultaneouslyWithGestureRecognizer:` - so with selection on, the
    // list wins every touch inside a row and the React content in it never sees the
    // release (S6 question 4: 0 of 10 taps on a `Pressable` in a row). A row's press is its
    // own recognizer's job instead: `NitroUiFormRowCell.pressGesture`.
    view.allowsSelection = false
    if #available(iOS 16.0, *) {
      // A row's height constraint is the cell's height; this is what tells the layout that
      // it changed, instead of a hand-rolled invalidation for every text reflow.
      view.selfSizingInvalidation = .enabledIncludingConstraints
      // Read back what the list was actually configured with, rather than trusting the OS
      // version: the flag is the question "will UIKit notice a row's height constraint moving
      // on its own", and `rowResized` is the fallback for every list where the answer is no -
      // which below iOS 16 is all of them, and which the harness can also arrange on a modern
      // system by putting the list in `.disabled` (fix round 1, E3).
      listSelfSizesRows = view.selfSizingInvalidation != .disabled
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

  /// Whether the list will notice a row's height constraint changing by itself.
  private var listSelfSizesRows = false

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
  private var scrollOffsetReport: ((_ y: Double) -> Void)?
  /// Received and never used on iOS: React Native's own `ScrollViewShadowNode` is what
  /// carries the scroll correction there, and this list is the only scroller here. Stored so
  /// the prop exists for `Form.tsx` to send on both platforms.
  private var receivedContentOffsetY: Double?
  /// Declared because the spec has it; iOS never calls it. UIKit avoids the keyboard with a
  /// content inset on this very list (`setBottomInset`), so there is no inset for JavaScript
  /// to reserve. Android, whose scroller is React Native's and above the Form, does call it.
  private var imeInset: ((Double) -> Void)?
  /// The last offset handed to JavaScript, so a settle that moved nothing sends nothing.
  private var reportedOffset: Double?
  /// The last per-section placement, per model, for the same reason.
  private var reportedPlacement: [ObjectIdentifier: Double] = [:]

  // MARK: Witnesses

  /// Every row this Form has been told about and that is still alive - the leak witness.
  private let knownRows = NSHashTable<UIView>.weakObjects()
  private var reparents = 0
  private var reclaims = 0
  private var taps = 0
  private var snapshotApplies = 0
  private var reportedWidth: CGFloat = .zero
  /// How many times a laid-out cell has offered its row box. A witness, not a counter with
  /// a bound: `width` right and `boxReports` zero means the cell never asked, and the row
  /// was laid out at whatever an earlier, wider guess said.
  private var boxReports = 0
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

  var onContentOffset: ((_ y: Double) -> Void)? {
    get { scrollOffsetReport }
    set { scrollOffsetReport = newValue }
  }

  var onImeInset: ((_ inset: Double) -> Void)? {
    get { imeInset }
    set { imeInset = newValue }
  }

  /// The offset this Form reported and JavaScript sent back, which the *shadow node* is the
  /// consumer of. Read here only for the report, so a harness can tell "the list is at 300"
  /// apart from "the list is at 300 and the shadow tree was told".
  var nuiContentOffsetY: Variant_NullType_Double {
    get { receivedContentOffsetY.map { .second($0) } ?? .first(.null) }
    set { receivedContentOffsetY = newValue.asType(Double.self) }
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
    reportedPlacement.removeAll()
    reportedOffset = nil
    reportedWidth = .zero
    reparents = 0
    reclaims = 0
    taps = 0
    boxReports = 0
    setBottomInset(0)
    applySnapshot()
  }

  func onDropView() {
    nitroUiAssertMainThread()
    prepareForRecycle()
    removeKeyboardObservers()
    contentBox = nil
    scrollOffsetReport = nil
    imeInset = nil
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
      // A resize moves every section's box, so the placements the shadow tree holds are
      // as stale as a scroll would have made them.
      reportGeometry()
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

  /// Whether this Form is the one that holds `model` - asked by the Section's report, which
  /// otherwise says only that *a* Form was found.
  ///
  /// A Section that came back from the pool with a cached Form can be answering to the mount
  /// that ended: `set` then means "found somebody", not "found my Form" (fix round 1, item 8).
  func holds(_ model: NitroUiFormSectionModel) -> Bool {
    sections.contains { $0 === model }
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

  /// A row's Yoga height changed. If it is on screen its cell's height constraint follows;
  /// if it is not, the next dequeue reads the new height anyway.
  ///
  /// Who tells the layout is the part that needs a condition. On iOS 16 and later the list's
  /// `selfSizingInvalidation` re-runs the layout for that one item when the constraint moves.
  /// That property does not exist before iOS 16, so on those systems a row that grew was
  /// drawn at its old height forever: the constraint moved, the cell's content hugging had
  /// nothing to tell, and nothing asked the layout again (fix round 1). Asking for one
  /// invalidation when UIKit has not been asked to do it is the whole fallback, and it is
  /// gated on what the list was *configured* with rather than on the OS version, so the
  /// harness can take the property away on a modern system and watch the fallback carry E3.
  func rowResized(_ row: UIView) {
    guard let path = path(for: row),
      let cell = list.cellForItem(at: path) as? NitroUiFormRowCell else { return }
    cell.formOwner = self
    cell.apply(row)
    if !listSelfSizesRows {
      list.collectionViewLayout.invalidateLayout()
    }
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
    // A snapshot moves every cell below it, so the rows positions the shadow tree knows about are
    // now wrong. One turn later, when UIKit has placed the cells, they are read again. The
    // delegate also reports a settle that moves the offset; this hop is the one that covers a
    // snapshot that re-placed cells without scrolling anything, which no delegate method says.
    //
    // The same turn is where a band is reconciled. At the moment `apply` returns, an element
    // the snapshot just brought in has not been dequeued yet, so the only place its text can
    // still be wrong - a Section that came back from the pool with its list, its model and its
    // heading view, where the snapshot changes nothing and UIKit never runs the provider - is
    // one turn later, with the element on screen (fix round 1, item 8).
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      // A list with items and no cells is stuck: `apply` alone does not always bring a
      // layout pass, and the pass that would has nothing left to invalidate. The first
      // mount is saved by `listNeedsFrame`, which lays the list out once its frame
      // arrives; a Form that re-mounts into a frame that never changed is not, and its
      // rows then wait for a cell forever (five items on screen, one row shown).
      if list.visibleCells.isEmpty,
        (dataSource?.snapshot().numberOfItems ?? 0) > 0 {
        list.collectionViewLayout.invalidateLayout()
        list.layoutIfNeeded()
      }
      if self.reconcileBands() {
        self.list.collectionViewLayout.invalidateLayout()
      }
      self.reportGeometry()
    }
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
    // Name this Form to the cell here, where the cell is *configured*. A
    // `UICollectionViewCell` has no back-reference to its collection view, so everything a
    // cell has to ask its Form - the box it draws a row in, a chrome refresh - goes through
    // this one reference, and it used to be set only as a side effect of `rowResized`,
    // which a row reaches by way of it. Nothing reported anything: the width a row was laid
    // out at stayed at the last guess the list's layout made, and a hosted `Switch` ended up
    // past the cell's edge, where UIKit stops hit-testing (S6b question 4, 0 of 10 taps).
    cell.formOwner = self
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
    cell.onPressTap = { [weak self, weak cell] in
      // Read the row out of the cell when the finger lifts, not the one handed over here:
      // a cell is reused, and a press that reaches a recycled cell belongs to its new row.
      guard let shown = cell?.row, let owner = HybridNitroUiForm.rowOwner(of: shown) else {
        return
      }
      self?.rowPressed(owner)
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
    // One button element, or the row's own content.
    //
    // `isAccessibilityElement = true` makes the cell a *leaf*: UIKit stops descending, so the
    // text, the `Switch` and the value label inside the row become one thing a person can
    // activate instead of six swipes that do nothing. The label is then this cell's job, and
    // it is read out of the row rather than typed (C1: "rows with `onPress` are one button
    // element"). A row without `onPress` is left exactly as React Native laid it out — a
    // `Switch` in it stays its own element, which is what the brief asks for.
    let pressable = owner?.pressable == true
    cell.isAccessibilityElement = pressable
    cell.accessibilityTraits = pressable ? .button : []
    cell.accessibilityLabel = pressable ? nitroUiAggregatedLabel(in: row) : nil
    cell.isSelectedRow = owner?.selected == true
    var configuration = UIBackgroundConfiguration.listGroupedCell()
    configuration.backgroundColor = .secondarySystemGroupedBackground
    cell.backgroundConfiguration = configuration
    // UIKit re-runs this on highlight and selection, which is the only way to follow them:
    // iOS 27's UIKit has no `selectionHighlightConfiguration` any more (see the cell).
    cell.setNeedsUpdateConfiguration()
  }

  /// A section's `title` or `footer` string changed while the section is in the list.
  ///
  /// Nothing UIKit does on its own can show this. The section's *identity* is the model, and
  /// the model did not change, so the snapshot the Section's `afterUpdate` applies is a no-op
  /// and UIKit never re-runs the provider that fills the band in: the old heading stays drawn,
  /// at the old height, forever (fix round 1). Reloading the section would fix the drawing by
  /// tearing down and re-dequeuing every cell in it - which for this library means handing
  /// every row in the section back to its holding view and re-adopting it, a round trip
  /// through Fabric for a string.
  ///
  /// So say it to the view that is on screen, and ask the layout for the band's height again:
  /// `supplementaryHeight` - which is where the Section's `onMetrics` band comes from - reads
  /// the layout's answer, and that answer is cached against the old text.
  func chromeChanged(in model: NitroUiFormSectionModel) {
    guard let index = sections.firstIndex(where: { $0 === model }) else { return }
    guard reconcileBands() else { return }
    list.collectionViewLayout.invalidateLayout()
    // One turn later, when the invalidation has been answered: the band the shadow tree
    // reserves is read from the layout, and the layout has only just been asked again.
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      model.hybrid?.reportMetrics()
      self.reportGeometry()
    }
  }

  /// Ask every band that is on screen whether it still says what its own section says, and
  /// say it to the ones that do not. Whether anything had to be re-painted is the answer, so
  /// the caller knows whether the layout needs asking again for a band's height.
  ///
  /// A band's text is normally the provider's job, and for a band UIKit has just dequeued it
  /// is. This is for the one case the provider cannot see: a Section that came back from the
  /// pool with the same model, the same list and the same heading view, so the snapshot it
  /// applies is identical, UIKit keeps the element it already drew, and the new title is a
  /// string the Form holds and no screen has ever shown.
  @discardableResult
  func reconcileBands() -> Bool {
    var changed = false
    for (index, model) in sections.enumerated() {
      let path = IndexPath(item: 0, section: index)
      for kind in [
        UICollectionView.elementKindSectionHeader,
        UICollectionView.elementKindSectionFooter,
      ] {
        guard let view = list.supplementaryView(forElementKind: kind, at: path)
          as? NitroUiFormSupplementaryCell else { continue }
        let isFooter = kind == UICollectionView.elementKindSectionFooter
        let text = isFooter ? model.footerText : model.title
        guard view.drawnText != text else { continue }
        view.configure(text: text, footer: isFooter)
        changed = true
      }
    }
    return changed
  }


  /// The text a section's visible band is actually painted with, or `-` when it is not on
  /// screen to be read. The harness's `drawnTitle=` - the difference between a Section that
  /// stored a title and a Form that drew one.
  func drawnSupplementaryText(
    footer: Bool,
    in model: NitroUiFormSectionModel
  ) -> String? {
    guard let index = sections.firstIndex(where: { $0 === model }) else { return nil }
    let kind = footer
      ? UICollectionView.elementKindSectionFooter
      : UICollectionView.elementKindSectionHeader
    guard
      let view = list.supplementaryView(
        forElementKind: kind,
        at: IndexPath(item: 0, section: index)
      ) as? NitroUiFormSupplementaryCell
    else { return nil }
    return view.drawnText ?? ""
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

  /// A row's own recognizer reported a completed press. `pressGesture` only begins for a
  /// pressable row, so the `pressable` check the old selection path did is the gesture's.
  func rowPressed(_ row: HybridNitroUiFormRow) {
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
    // Only what the layout *knows*. `contentWidth()`'s fallback is the list's own box,
    // which is the window's width on an inset-grouped list: reported once before the
    // layout had attributes, it laid every row out 64 pt wider than its cell, and the
    // right-aligned content of a row (a Switch, a chevron) landed past the cell's edge -
    // where UIKit stops hit-testing, which is S6b's 0-of-10 hosted `Switch`.
    // And it is only a guess for the time before a cell exists: once one is on screen it
    // reports its own box from `layoutSubviews`, which is the number the row is drawn in,
    // and a later guess must not take the last word over it.
    guard rowBoxWidth() < 0 else { return }
    guard let width = attributesWidth(), abs(width - reportedWidth) > 0.25 else { return }
    reportedWidth = width
    contentBox?(Double(width))
  }

  /// The width a cell actually gets, asked of the layout - not four typed constants. The
  /// inset-grouped margins and the cell's own content margins live in the layout.
  private func contentWidth() -> CGFloat {
    attributesWidth() ?? 0
  }

  /// What the list's own layout says a cell is wide, or `nil` while it has not worked that
  /// out yet. `nil` is the answer a caller has to be able to tell from `0`.
  private func attributesWidth() -> CGFloat? {
    guard list.bounds.width > 0 else { return nil }
    return list.layoutAttributesForItem(at: IndexPath(item: 0, section: 0))?.frame.width
  }

  /// The width a *laid-out cell* gives its row, reported by that cell's container.
  ///
  /// `contentWidth()` is what the list's attributes say a cell is; this is what the row is
  /// actually drawn in, and the two differ by the cell's own content margins (16 pt on each
  /// side of an inset-grouped list). A row whose React side is laid out at the wider number
  /// draws its right-aligned content - a `Switch`, a chevron, a value - past the cell's edge,
  /// and UIKit stops hit-testing at that edge: S6b measured a hosted `Switch` in a row taking
  /// 0 of 10 real taps for exactly this reason, while content on the row's left worked.
  func rowBoxWidthReported(_ width: CGFloat) {
    boxReports += 1
    guard width > 0, abs(width - reportedWidth) > 0.25 else { return }
    reportedWidth = width
    contentBox?(Double(width))
  }

  // MARK: - What the layout knows (a Section asks, rather than typing constants)

  /// The width a cell gets, for measuring the space a header needs.
  func contentWidthForMetrics() -> CGFloat {
    contentWidth()
  }

  /// The width a row on screen is drawn in, or -1 while none is. This is the number the
  /// React side has to lay a row's content out at; `width` in the report is what it was
  /// told, and the two disagreeing is the row drawing past its cell.
  private func rowBoxWidth() -> CGFloat {
    for cell in list.visibleCells {
      let width = (cell as? NitroUiFormRowCell)?.rowBoxWidth ?? 0
      if width > 0 { return width }
    }
    return -1
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
      ) { [weak self] _ in
        // Taking the inset away moves the content back up, which is a change of the same kind
        // the delegate's `scrollViewDidChangeAdjustedContentInset` answers for - and this
        // observer does not go through the delegate, so the shadow tree is told from here.
        self?.setBottomInset(0)
        self?.reportGeometry()
      },
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
    // One space per comparison, and they are two different spaces.
    //
    // `list.convert(end, from: nil)` answers in the list's *bounds* space, which for a scroll
    // view is its content space: it travels with `contentOffset`. `list.frame.maxY` does not
    // travel - it is where the box sits in the superview. Comparing them was right only while
    // the list was at the top of its own content, and by the time question 5 is asked the list
    // has been scrolled to a field near the bottom of a long form. The overlap then carried the
    // whole scroll distance (or lost it, depending on direction) and the bottom inset stopped
    // describing the keyboard at all (fix round 1).
    //
    // So: the overlap is asked in the window's space, where the keyboard's own frame already
    // is, and the scroll decision below is asked in content space, where the row's frame
    // already is.
    let boxInWindow =
      list.superview.map { $0.convert(list.frame, to: nil) } ?? list.frame
    let overlap = max(0, boxInWindow.maxY - end.minY)
    setBottomInset(overlap)
    guard let focused = list.findFirstResponder(),
      let row = HybridNitroUiForm.rowAncestor(of: focused) else { return }
    let rect = list.convert(row.frame, from: row.superview)
    // `list.bounds` *is* the visible box in content coordinates: its origin is the scroll
    // offset and its height is the viewport, and the bottom of what a person can see is one
    // adjusted inset above `bounds.maxY` - the safe area and the inset set just above, both
    // of which UIKit has already folded into `adjustedContentInset`.
    let visibleBottom = list.bounds.maxY - list.adjustedContentInset.bottom
    if rect.maxY > visibleBottom {
      list.setContentOffset(
        CGPoint(
          x: list.contentOffset.x,
          y: list.contentOffset.y + (rect.maxY - visibleBottom) + 8
        ),
        animated: true
      )
    }
    // The inset changed the visible box and the scroll changed the offset, both of which the
    // shadow tree has to be told about — and the settle animation reports again when it ends.
    reportGeometry()
  }

  // MARK: - Where the list came to rest (`onPlacement` / `onContentOffset`, D45 item 3)

  /// Tell the shadow tree the two numbers that make every row measure where it is drawn.
  ///
  /// - one per section: where the list put its first row, less the header band JavaScript
  ///   already reserves inside the section, in the list's own *content* coordinates — sent
  ///   back as that section's absolute `top`, so a row's Yoga origin within it is the same
  ///   offset its cell is drawn at within the section;
  /// - one for the Form: how far the content is scrolled, sent back as `nuiContentOffsetY`
  ///   and out of the Form's shadow node as the origin offset every descendant is measured
  ///   against.
  ///
  /// Two numbers, not one per row, is the point: `children` is the app's own element tree, so
  /// a settle re-renders the Form and the sections and nothing below them, where the spike's
  /// per-row `onFrameMoved` re-rendered every visible row.
  ///
  /// Called when the list settles, never per scroll frame — JS cannot be told about every
  /// frame of a flick. Between settles the published offset lags by the scroll distance, which
  /// is what `docs/components/form.md` says out loud.
  ///
  /// A settle includes the list's box *moving*: an adjusted content inset (the safe area
  /// arriving, a keyboard inset) shifts `contentOffset` without scrolling, and no drag ending
  /// fires for it — UIKit's callback for that shift is `scrollViewDidChangeAdjustedContentInset`
  /// (on the delegate since iOS 11), which the delegate answers, as does the holding view's
  /// `safeAreaInsetsDidChange`. E7 measured the gap left by not answering either as 72 pt on
  /// every row of a form at rest.
  func reportGeometry() {
    // A list that is not on screen has no geometry to report, and reporting it is not
    // merely useless: UIKit shifts `contentOffset` itself as a scroll view leaves the window
    // (`_didMoveFromWindow:toWindow:` -> `_stopScrollingNotify:` -> `scrollViewDidScroll`),
    // and by then the JS side of this Form's sections may already be gone - calling into a
    // callback that has been torn down is a fatal error, not a no-op. Measured: a Form that
    // was scrolled when its screen went away took the whole app with it, and the next test
    // suite in the same app died with "the app bridge disconnected" (fix round 1).
    guard holding.superview != nil, list.window != nil else { return }
    list.layoutIfNeeded()

    let offset = Double(list.contentOffset.y)
    // `reportedOffset` records what JavaScript was *told*, so it moves only on a publish that
    // had someone to tell: the first geometry pass of a list can run before the app's
    // `onContentOffset` has been applied, and recording the number then would leave the
    // shadow tree correcting by an offset from a tree that never heard it - every row of a
    // form at rest wrong by the list's own top inset (E7).
    if reportedOffset != offset, scrollOffsetReport != nil {
      reportedOffset = offset
      scrollOffsetReport?(offset)
    }

    let inset = rowInset()
    for (sectionIndex, model) in sections.enumerated() {
      guard let top = sectionTop(sectionIndex, in: model) else { continue }
      // The inset is a property of the section's box too, so it rides along even when the
      // top did not move; `applyPlacement` sends neither number if neither changed.
      model.hybrid?.applyPlacement(top: top, inset: inset)
    }
  }

  /// The y JavaScript has to put this section at, so that every row's Yoga origin *is* its
  /// cell's position in the window — which is what makes the Form's one `-contentOffset`
  /// correction enough for all of them (D45 item 3).
  ///
  /// Asked of the layout, not of a cell on screen. A cell's own position is in the window, so
  /// turning it back into content coordinates means adding the scroll offset and this
  /// section's *current* placement back on — and a section being re-placed is a section that
  /// has not been told the right placement yet. Read from a cell it therefore feeds on
  /// itself: the answer moves by the scroll on every settle, which is the drift that makes a
  /// `measure` disagree with the pixels. The layout also answers for a section that is off
  /// screen, which a cell cannot (D45 item 5).
  ///
  /// Three terms, all asked of the platform, none typed:
  ///
  /// - `holding.frame.minY`: the shadow tree measures a section from the *Form's* box, while
  ///   the list is a sibling of the holding view at its frame, so it measures from a box
  ///   `holding.frame.minY` lower. Zero for a Form with no padding and the padding for one
  ///   that has it — the same difference the width is reported for (`onContentBox`).
  /// - the header band, because JavaScript reserves it *inside* the section (`paddingTop`),
  ///   and `reportMetrics` takes that band from this same query — so the two halves of the
  ///   invariant are read from one place, not from two that have to agree.
  /// The cell's chrome is *not* taken off, because JavaScript pays for it itself: the
  /// Section reports it as the space between rows (`gap`, spent by `Form.tsx` as each row's
  /// `marginVertical`), so the first row's own margin is already the 4 pt the cell puts above
  /// it and every following row's margin pair is the 8 pt that separates two cells. Rows'
  /// Yoga pitch then equals the cells' pitch, which is the E7 finding - measured without the
  /// chrome, row 13 of a list of 44 pt rows landed 104 pt away from what `measure` said, 8 pt
  /// per row of chrome the shadow tree had never been told about.
  ///
  /// `nil` means the layout has not worked this section out yet, and the caller leaves the
  /// section where the last settle put it rather than sending it a `0` to start from.
  private func sectionTop(_ sectionIndex: Int, in model: NitroUiFormSectionModel) -> CGFloat? {
    guard !model.rows.isEmpty else { return nil }
    guard let first = list.collectionViewLayout.layoutAttributesForItem(
      at: IndexPath(item: 0, section: sectionIndex)
    ) else { return nil }
    return first.frame.minY + holding.frame.minY
      - supplementaryHeight(footer: false, in: model)
  }

  /// The height the header's *text* needs, asked of the same content configuration the header
  /// cell is built with. A section's band has to be at least this plus the text's leading, so
  /// the harness compares the band the shadow tree was told with the text it has to hold —
  /// which is the assertion that keeps a row from painting over a header.
  func headerTextHeight(in model: NitroUiFormSectionModel) -> CGFloat? {
    guard let title = model.title, !title.isEmpty else { return nil }
    // A value type, so filling it in needs a `var` — and the font is read from the
    // configuration rather than typed, because "the same configuration the header cell is
    // built with" is only an argument if the font really is the one it uses.
    var configuration = UIListContentConfiguration.groupedHeader()
    configuration.text = title
    let font = configuration.textProperties.font
      ?? UIFont.preferredFont(forTextStyle: .subheadline)
    // `lineHeight`, not the glyph box: the band has to hold the text *and* its leading, and
    // a band sized to the glyphs alone is what lets the first row paint over a header.
    return ceil(title.size(withAttributes: [.font: font]).height + font.leading)
  }

  /// The x a row is drawn at, in the same space: what the list's margins and the cell's own
  /// content margins put between the Form's edge and the row. The spike typed `20` here,
  /// which is right until the layout changes its mind (D38.1).
  private func rowInset() -> CGFloat {
    for cell in list.visibleCells {
      guard let cell = cell as? NitroUiFormRowCell, let shown = cell.row,
        shown.window != nil else { continue }
      return shown.convert(shown.bounds, to: holding).minX
    }
    guard let attributes = list.layoutAttributesForItem(at: IndexPath(item: 0, section: 0))
    else { return 0 }
    return list.convert(attributes.frame, to: holding).minX
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
    // A row view sitting in a section's holding view that this Form was never told about:
    // the shape a recycled component view left behind by a careless registration takes.
    var stale = 0
    for section in sections {
      for subview in section.holding?.subviews ?? []
      where HybridNitroUiForm.isRowView(subview)
        && !section.rows.contains(where: { $0 === subview })
      {
        stale += 1
      }
    }
    return ([
      "sections=\(sections.count)",
      "rows=\(rows)",
      "items=\(dataSource?.snapshot().numberOfItems ?? -1)",
      "inCells=\(inCells)",
      // Where the list itself is: is it in a window, how tall is it, how much content does
      // it hold and how many items does it think are visible. A Form that reports rows and
      // no cells says which of its two jobs stopped (fix round 1).
      "screen=\(list.window != nil ? 1 : 0),\(Self.number(list.bounds.height)),\(Self.number(list.contentSize.height)),\(list.indexPathsForVisibleItems.count)",
      "orphans=\(orphans)",
      "stale=\(stale)",
      "alive=\(knownRows.count)",
      "reparents=\(reparents)",
      "reclaims=\(reclaims)",
      "applies=\(snapshotApplies)",
      "width=\(Self.number(reportedWidth))",
      "listWidth=\(Self.number(list.bounds.width))",
      "boxW=\(Self.number(rowBoxWidth()))",
      "boxReports=\(boxReports)",
      "heights=\(heights)",
      "taps=\(taps)",
      "keyboard=\(Self.number(keyboardInset))",
      "ime=0.00",
      "offset=\(Self.number(list.contentOffset.y))",
      "origin=\(Self.number(reportedOffset ?? .nan))",
      // What the shadow tree was *told*, as opposed to what was sent (`origin=`): the two
      // differ while a re-render is in flight, and E7 is about the number the shadow node
      // holds, not the number this class emitted.
      "received=\(Self.number(receivedContentOffsetY ?? .nan))",
      // The two constants the section placement is built from, so an E7 mismatch says which
      // of them moved instead of leaving the arithmetic to be reconstructed from the log.
      "listY=\(Self.number(holding.frame.minY))",
      "insetTop=\(Self.number(list.adjustedContentInset.top))",
      "placed=\(reportedPlacement.count)",
      // The rows in the order this Form holds them, by their own words. A count cannot say
      // whether a keyed insert landed where React put it, and a wrong index is invisible in
      // every other field here (fix round 1).
      "order=\(rowOrder())",
    ] + geometryFields(of: list, kind: "prototype")).joined(separator: ";")
  }

  /// The rows, in the order the Form's models hold them, named by the words inside them.
  ///
  /// Read from the row rather than given one by the app on purpose: this is the Form's own
  /// claim about React's order, checked against what the app actually rendered, so a Form that
  /// inserted a row in the wrong place cannot agree with itself. `nitroUiAggregatedLabel` is
  /// the same helper that names a pressable row for a screen reader, and the harness rows are
  /// written so their first words differ.
  ///
  /// Capped and sanitised because it rides in the same `;`- and `=`-separated line as the
  /// numbers: a form with 200 rows is not a 200-name line in every poll of the harness, and a
  /// label containing a separator would desynchronise the parser at the other end.
  private func rowOrder(limit: Int = 10) -> String {
    var names: [String] = []
    for section in sections {
      for row in section.rows {
        guard names.count < limit else { break }
        let label = String((nitroUiAggregatedLabel(in: row) ?? "?").prefix(20))
        names.append(
          String(
            label.unicodeScalars.map { Self.separatorScalars.contains($0) ? " " : Character($0) }
          )
          .trimmingCharacters(in: .whitespaces)
        )
      }
      if names.count >= limit { break }
    }
    return names.joined(separator: "|")
  }

  /// The characters this report line is built out of, which a row's own words must not contain.
  private static let separatorScalars: Set<Unicode.Scalar> = [";", "=", "|", ":"]

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
      self?.reportGeometry()
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
      case "scroll-no-report":
        // Move the content and *not* report it, from inside the library - the shape of every
        // settle callback that used to be missing. E7 then has to notice the new offset by
        // itself, which is what the delegate methods added in fix round 1 are for.
        list.setContentOffset(
          CGPoint(x: list.contentOffset.x, y: list.contentOffset.y + 60),
          animated: false
        )
        list.layoutIfNeeded()
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
    // Diagnostic only (never a compared field): what the row itself measured, so a
    // row box that is off by N is visibly the chrome and not the content. Absent for
    // the SwiftUI reference, whose rows are not ours.
    if let cell = list.cellForItem(at: first) as? NitroUiFormRowCell, cell.lastRowHeight > 0 {
      out.append("rowH=\(Self.number(cell.lastRowHeight))")
    }
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
    // Ask every section, and take the first footer the layout has: the last section of a
    // form usually has none, and asking only it is how the reference came back with no
    // `footerH` at all while the prototype - whose sections all have one - had a number.
    // The two are then measured at the same place, which is the whole point of the seam.
    var footer: UICollectionViewLayoutAttributes?
    var footerSection = -1
    for section in 0..<max(1, list.numberOfSections) {
      if let attrs = list.layoutAttributesForSupplementaryElement(
        ofKind: footerKind,
        at: IndexPath(item: 0, section: section)
      ) {
        footer = attrs
        footerSection = section
        break
      }
    }
    if let footer {
      out.append("footerH=\(Self.number(footer.frame.height))")
      out.append("footerSection=\(footerSection)")
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

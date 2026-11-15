// The Form component: an inset-grouped `UICollectionView` whose rows are React Native views
// moved into `UICollectionViewListCell`s. A list item's identity is its row view.

import NitroModules
import UIKit

/// One section of the Form: its rows, in React's order, and its header and footer text.
final class NitroUiFormSectionModel: NSObject {
  var rows: [UIView] = []
  var title: String?
  var footerText: String?
  weak var hybrid: HybridNitroUiFormSection?
  /// Where this section's rows live while they are not in a cell.
  weak var holding: NitroUiFormSectionHoldingView?
  private(set) var sectionIndex = 0

  func reindex(_ index: Int) { sectionIndex = index }
}

final class HybridNitroUiForm: HybridNitroUiFormSpec, RecyclableView {
  // MARK: Views

  /// The Form's content view: Fabric mounts the sections' component views here, hidden.
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
    // Off: UIKit's selection recognises at touch-down and React Native does not share a touch
    // with a recognizer it did not create, so a `Pressable` inside a row would never see the
    // release. A row's press is the cell's own recognizer instead.
    view.allowsSelection = false
    if #available(iOS 16.0, *) {
      // Lets the list notice a row's height constraint changing by itself; `rowResized` is
      // the fallback where this is unavailable or disabled.
      view.selfSizingInvalidation = .enabledIncludingConstraints
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
  /// The models of the mount that just ended. `prepareForRecycle` leaves the list's snapshot
  /// alone, so UIKit can still ask about these items until the next apply replaces it.
  private var retiredSections: [NitroUiFormSectionModel] = []
  private weak var component: UIView?
  private var framedList = false

  // MARK: Props, stored raw (the setter stores; `afterUpdate()` applies)

  private var avoidsKeyboard = true
  private var perfInstanceId: Int32 = nitroUiPerfNoInstance
  private var contentBox: ((_ width: Double) -> Void)?
  private var scrollOffsetReport: ((_ y: Double) -> Void)?
  /// Not used natively: the Form's shadow node consumes it. Kept for the getter and the
  /// test report.
  private var receivedContentOffsetY: Double?
  /// Never called on iOS: the keyboard is avoided with a content inset on the list itself.
  private var imeInset: ((Double) -> Void)?
  /// The last offset handed to JavaScript, so a settle that moved nothing sends nothing.
  private var reportedOffset: Double?
  /// The last per-section placement, per model, for the same reason.
  private var reportedPlacement: [ObjectIdentifier: Double] = [:]

  // MARK: Witnesses

  /// Every row this Form has been told about and that is still alive.
  private let knownRows = NSHashTable<UIView>.weakObjects()
  private var reparents = 0
  private var reclaims = 0
  private var taps = 0
  private var snapshotApplies = 0
  private var reportedWidth: CGFloat = .zero
  /// The box the most recent laid-out row container gave its row. A guessed content box is
  /// clamped to it: a row laid out wider than its cell draws content UIKit will not hit-test.
  private var lastRowBoxWidth: CGFloat = -1
  /// The box a cell gives a row *without* a trailing accessory: the one width published to
  /// JavaScript for the whole list. An accessory row is told its own box per row.
  private var plainRowBoxWidth: CGFloat = -1
  /// The box a cell gives a row *with* a trailing accessory, or -1 until one has laid out.
  private var accessoryRowBoxWidth: CGFloat = -1
  /// What a trailing accessory costs a row: `plainRowBoxWidth - accessoryRowBoxWidth`.
  private var accessoryInset: CGFloat = 0
  /// The list width the boxes above belong to, so the next resize is visible as one.
  private var framedBoxWidth: CGFloat = -1
  /// How many times the list-wide box has been published; it should be once per list width.
  private var widthPublishes = 0
  /// How many times a laid-out cell has offered its row box.
  private var boxReports = 0
  /// How many times a cell has had its row taken by another cell.
  private var rowLosses = 0
  /// How many times a provider had nothing to draw and answered with a blank.
  private var giveUps = 0
  /// How many times this view has been prepared for reuse. Never reset.
  private var recycles = 0
  private var keyboardInset: CGFloat = .zero
  /// How many offsets have been handed to JavaScript; a settle reports once.
  private var offsetPublishes = 0
  /// Whether the list is in an animated scroll no finger started. Such a scroll sets none of
  /// `isDragging`, `isTracking` or `isDecelerating`, so the delegate checks this flag too.
  var scrollAnimating = false

  /// Whether this list still owes the reset that puts it at the top of its own content. One
  /// ask in `prepareForRecycle` is not enough: UIKit restores the old offset when the view
  /// re-enters a window.
  private var pendingTopReset = false

  /// How many turns the reset has spent on one mount, so an unreachable offset is given up.
  private var topResetTries = 0

  /// Whether an earlier mount put content in this list; a later mount then owes a top reset.
  private var hasCarriedContent = false

  override init() {
    super.init()
    holding.owner = self
    holding.onChildMount = { [weak self] view, index in self?.sectionMounted(view, at: index) }
    holding.onChildUnmount = { [weak self] view in self?.sectionUnmounted(view) }
    holding.onLayoutChange = { [weak self] in self?.listNeedsFrame() }
  }

  /// Fabric mounts children into this view. The collection view is added to the component
  /// view once, in `listNeedsFrame()`, so no update path recreates it.
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
    recycles += 1
    for section in sections {
      NitroUiFormHoldingView.moving {
        for row in section.rows { row.removeFromSuperview() }
      }
      section.rows.removeAll()
    }
    retiredSections = sections
    sections.removeAll()
    knownRows.removeAllObjects()
    reportedPlacement.removeAll()
    reportedOffset = nil
    reportedWidth = .zero
    lastRowBoxWidth = -1
    plainRowBoxWidth = -1
    accessoryRowBoxWidth = -1
    accessoryInset = 0
    framedBoxWidth = -1
    widthPublishes = 0
    reparents = 0
    reclaims = 0
    rowLosses = 0
    giveUps = 0
    taps = 0
    boxReports = 0
    offsetPublishes = 0
    scrollAnimating = false
    setBottomInset(0)
    // A recycled list keeps its `contentOffset`; put it back at the top of its content.
    list.setContentOffset(
      CGPoint(x: list.contentOffset.x, y: -list.adjustedContentInset.top),
      animated: false
    )
    pendingTopReset = true
    topResetTries = 0
    // The list keeps its content until the next mount's coalesced apply. Emptying it here
    // would send the recycled list through an empty layout before the new content arrives.
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

  /// Put a list that another mount left scrolled back at the top of its own content. Asked
  /// from every geometry pass until it sticks, because a snapshot still being applied puts
  /// the old offset back. Returns whether this is the pass that finished the job.
  @discardableResult
  private func takeTopResetIfNeeded() -> Bool {
    guard pendingTopReset, !sections.isEmpty, list.window != nil else { return false }
    let top = -list.adjustedContentInset.top
    if abs(list.contentOffset.y - top) > 0.5 {
      list.setContentOffset(
        CGPoint(x: list.contentOffset.x, y: top),
        animated: false
      )
      list.collectionViewLayout.invalidateLayout()
      list.layoutIfNeeded()
    }
    guard abs(list.contentOffset.y - top) <= 0.5 else {
      // UIKit moved it back. Try again next turn, a bounded number of times.
      topResetTries += 1
      guard topResetTries < 40 else {
        pendingTopReset = false
        return false
      }
      DispatchQueue.main.async { [weak self] in self?.reportGeometry() }
      return false
    }
    pendingTopReset = false
    topResetTries = 0
    return true
  }

  // MARK: - Putting the list in the component view

  /// Give the list the box Fabric gave the holding view, and add it to the component view
  /// the first time.
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
      if abs(holding.frame.width - framedBoxWidth) > 0.25 {
        // A new list width (a rotation, a resize): every remembered box belongs to the old
        // one, and an off-screen row is not laid out again until it is scrolled back.
        forgetRowBoxes()
        framedBoxWidth = holding.frame.width
      }
      // The layout needs one pass before it can answer what a cell is wide.
      list.layoutIfNeeded()
      reportContentBox()
      // Rows parked in a section's holding view have nothing else to tell them the new box.
      pushRowBoxEstimates()
      // A resize moves every section, so the placements the shadow tree holds are stale.
      reportGeometry()
      if !framedList { framedList = true }
    }
  }

  // MARK: - Sections (the content-children patch drives these)

  private func sectionMounted(_ view: UIView, at index: Int) {
    guard let model = HybridNitroUiForm.sectionModel(in: view) else {
      // Not a Section: a stray view React Native put in the Form. It stays hidden.
      return
    }
    guard !sections.contains(where: { $0 === model }) else { return }
    // A mount starting on a list that carried content before inherits its scroll position.
    if sections.isEmpty, hasCarriedContent {
      pendingTopReset = true
      topResetTries = 0
    }
    sections.insert(model, at: min(index, sections.count))
    hasCarriedContent = true
    reindex()
    applySnapshot()
    // Fabric mounts bottom-up, so this section's rows reached its holding view before there
    // was a Form to register them with. Ask the section for them now.
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

  /// A Section's model, reached through the content view inside its component view.
  static func sectionModel(in componentView: UIView) -> NitroUiFormSectionModel? {
    for subview in componentView.subviews {
      if let holding = subview as? NitroUiFormSectionHoldingView { return holding.model }
    }
    return nil
  }

  private func reindex() {
    for (index, section) in sections.enumerated() { section.reindex(index) }
  }

  /// Whether this Form is the one that holds `model`. A recycled Section can still point at
  /// the Form of a mount that ended.
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
      // The view holding the row is already removing it. Detaching it here as well would
      // re-enter `willRemoveSubview` and leave Fabric a child with no parent to unmount.
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

  /// A row's Yoga height changed: its cell's height constraint follows. Where the list does
  /// not notice a constraint change by itself (before iOS 16, or when that is turned off),
  /// the layout is invalidated by hand.
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

  /// Whether this Form has ever been told about `row`. A row it knew and then dropped must
  /// not be adopted again from a holding view, or the drop and the adoption would loop.
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

  /// A snapshot is queued, not applied in place: sections and rows arrive from
  /// `didAddSubview`, inside Fabric's layout pass, where applying one crashes UIKit. One
  /// apply per turn of the run loop also makes mounting many rows a single apply.
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
    // Whatever reconfigure was in flight is superseded by this snapshot.
    reconfigureTargets = [:]
    dataSource?.apply(snapshot, animatingDifferences: false)
    // The ended mount's models were only owed an answer until this snapshot replaced theirs.
    retiredSections.removeAll()
    // A snapshot moves cells without any delegate callback, so the geometry is reported one
    // turn later, once UIKit has placed them. Header and footer text is reconciled then too,
    // when the views the snapshot brought in are on screen.
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      // First, because a recycled list still at the previous mount's offset can be showing
      // no items at all, and a list with no visible items dequeues no cells.
      takeTopResetIfNeeded()
      // `apply` does not always bring a layout pass, and a list with items but no cells
      // would stay blank until something else laid it out.
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

  /// Whether a re-adoption pass is queued. A visible cell can end up not drawing its item's
  /// row, and nothing else asks for that cell again, so every settle re-runs the provider for
  /// such cells: one turn later, because a snapshot must not be applied inside a UIKit callback.
  private var readoptQueued = false

  /// The cells a pending reconfigure was applied for, by index path. UIKit requires a
  /// reconfigure to be answered with the cell already on screen.
  private var reconfigureTargets: [IndexPath: UICollectionViewCell] = [:]

  /// One visible item its cell is not drawing, and the cell that is short of its row.
  private struct MisdrawnItem {
    let id: NitroUiFormItem
    let path: IndexPath
    /// The cell on screen when it is one of ours, which can be reconfigured. `nil` means the
    /// item has to be reloaded instead.
    let cell: NitroUiFormRowCell?
  }

  private func readoptMisdrawnCells() {
    guard !readoptQueued else { return }
    readoptQueued = true
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.readoptQueued = false
      // React can take the tree away within this turn, and UIKit raises for a reconfigure of
      // an item whose cell is no longer on screen.
      guard self.holding.superview != nil, self.list.window != nil, !self.sections.isEmpty,
        var snapshot = self.dataSource?.snapshot()
      else { return }
      let misdrawn = self.misdrawnVisibleItems()
      guard !misdrawn.isEmpty else { return }
      var reconfigure: [NitroUiFormItem] = []
      var replace: [NitroUiFormItem] = []
      var targets: [IndexPath: UICollectionViewCell] = [:]
      for item in misdrawn {
        if let cell = item.cell {
          reconfigure.append(item.id)
          targets[item.path] = cell
        } else {
          replace.append(item.id)
        }
      }
      if !reconfigure.isEmpty { snapshot.reconfigureItems(reconfigure) }
      if !replace.isEmpty { snapshot.reloadItems(replace) }
      self.snapshotApplies += 1
      self.reconfigureTargets = targets
      self.dataSource?.apply(snapshot, animatingDifferences: false)
      // `apply` may run the reconfigure inline or in the next layout pass, so the targets are
      // cleared a turn later.
      DispatchQueue.main.async { [weak self] in
        self?.reconfigureTargets = [:]
      }
    }
  }

  /// The visible items whose cell is not holding that item's own row: a cell holding nothing,
  /// or holding another row. Only items the models still put at that index path are included,
  /// because UIKit raises for a reconfigure of an item React has dropped. Main thread only.
  private func misdrawnVisibleItems() -> [MisdrawnItem] {
    guard let dataSource, dataSource.snapshot().numberOfItems > 0 else { return [] }
    var found: [MisdrawnItem] = []
    for at in list.indexPathsForVisibleItems {
      guard let id = dataSource.itemIdentifier(for: at), let row = id.rowView else { continue }
      guard self.path(for: row) == at else { continue }
      if self.cell(at: at, isDrawing: id) { continue }
      // A cell that is not one of ours reads as `nil` here and is reloaded, not reconfigured.
      let cell = list.cellForItem(at: at) as? NitroUiFormRowCell
      found.append(MisdrawnItem(id: id, path: at, cell: cell))
    }
    return found
  }
  /// The cell to answer with when this Form has nothing to draw at an index path. UIKit
  /// aborts on a cell it did not dequeue, and during a reconfigure on any cell but the one on
  /// screen, so the answer is the reconfigure's own cell or a blank dequeued one.
  private func giveUpCell(
    in collectionView: UICollectionView,
    at indexPath: IndexPath
  ) -> UICollectionViewCell {
    giveUps += 1
    if let existing = reconfigureTargets[indexPath] { return existing }
    return Self.blankCell(for: indexPath, in: collectionView)
  }

  /// Whether the cell on screen at `path` is drawing the row `item` names.
  private func cell(at path: IndexPath, isDrawing item: NitroUiFormItem) -> Bool {
    guard let expected = item.rowView else { return true }
    guard let cell = list.cellForItem(at: path) as? NitroUiFormRowCell else { return false }
    return cell.row === expected && cell.isDrawingRow
  }

  private func configureDataSource() {
    let dataSource = UICollectionViewDiffableDataSource<
      NitroUiFormSectionModel, NitroUiFormItem
    >(collectionView: list) { [weak self] collectionView, indexPath, item in
      // Never a bare `UICollectionViewCell()`: UIKit raises for a cell it did not dequeue, and
      // Swift cannot catch that exception.
      self?.cell(at: indexPath, for: item, in: collectionView)
        ?? Self.blankCell(for: indexPath, in: collectionView)
    }
    dataSource.supplementaryViewProvider = { [weak self] collectionView, kind, indexPath in
      // Never `nil`: the diffable data source raises for a missing supplementary view.
      self?.supplementary(kind, at: indexPath, in: collectionView)
        ?? Self.blankBand(ofKind: kind, for: indexPath, in: collectionView)
    }
    self.dataSource = dataSource
  }

  /// The section that owns a row, including a section of the mount that just ended, or
  /// `nil`. Asked of the row, not of the index path: after a recycle the two disagree.
  private func model(owning row: UIView) -> NitroUiFormSectionModel? {
    for section in sections + retiredSections
    where section.rows.contains(where: { $0 === row }) {
      return section
    }
    return nil
  }

  /// The section UIKit is asking about, read from the snapshot it is laying out. `sections`
  /// can already be ahead of that snapshot: applies are deferred a turn, and a layout pass
  /// can run in between.
  private func sectionModel(
    at section: Int,
    in collectionView: UICollectionView
  ) -> NitroUiFormSectionModel? {
    guard collectionView.dataSource === dataSource,
      let snapshot = dataSource?.snapshot(),
      section >= 0,
      section < snapshot.sectionIdentifiers.count
    else { return nil }
    return snapshot.sectionIdentifiers[section]
  }

  /// A dequeued cell that draws nothing. It comes from the row registration, so a later
  /// reconfigure can fill this same cell.
  private static func blankCell(
    for indexPath: IndexPath,
    in collectionView: UICollectionView
  ) -> UICollectionViewCell {
    collectionView.dequeueReusableCell(
      withReuseIdentifier: NitroUiFormItem.rowReuseIdentifier,
      for: indexPath
    )
  }

  /// A dequeued, empty header or footer, for when there is no Form left to ask.
  private static func blankBand(
    ofKind kind: String,
    for indexPath: IndexPath,
    in collectionView: UICollectionView
  ) -> UICollectionReusableView {
    let band = dequeueBand(ofKind: kind, for: indexPath, in: collectionView)
    if let band = band as? NitroUiFormSupplementaryCell {
      band.configure(text: nil, footer: kind == UICollectionView.elementKindSectionFooter)
    }
    return band
  }

  private static func dequeueBand(
    ofKind kind: String,
    for indexPath: IndexPath,
    in collectionView: UICollectionView
  ) -> UICollectionReusableView {
    let isFooter = kind == UICollectionView.elementKindSectionFooter
    return collectionView.dequeueReusableSupplementaryView(
      ofKind: kind,
      withReuseIdentifier: isFooter
        ? NitroUiFormItem.footerReuseIdentifier
        : NitroUiFormItem.headerReuseIdentifier,
      for: indexPath
    )
  }

  private func cell(
    at indexPath: IndexPath,
    for item: NitroUiFormItem,
    in collectionView: UICollectionView
  ) -> UICollectionViewCell {
    guard case let .row(row) = item else {
      return giveUpCell(in: collectionView, at: indexPath)
    }
    let cell = collectionView.dequeueReusableCell(
      withReuseIdentifier: NitroUiFormItem.rowReuseIdentifier,
      for: indexPath
    )
    guard let cell = cell as? NitroUiFormRowCell else {
      // Not a cell of ours; still answer with the cell UIKit just dequeued.
      giveUps += 1
      return cell
    }
    // The section may be gone while the snapshot still holds the item. The item names its
    // row, so the cell can still be filled; only the callbacks below need a section.
    let model = model(owning: row)
    // A `UICollectionViewCell` has no reference to its collection view, so everything the
    // cell asks its Form (its row box, a chrome refresh) goes through this.
    cell.formOwner = self
    cell.onGiveBack = { [weak self] given in
      self?.reclaims += 1
      guard let model = model else {
        // No section to go back to: park it in the Form's own holding view.
        NitroUiFormHoldingView.moving {
          if let form = self {
            form.holding.addSubview(given)
          }
        }
        return
      }
      // Back to its section's holding view, marked as the Form's own move so the holding view
      // does not read it as a Fabric remount.
      NitroUiFormHoldingView.moving { model.holding?.addSubview(given) }
    }
    cell.onRowRemoved = { [weak self] removed in
      guard let model = model else { return }
      // Fabric unmounted this row out of the cell it was showing.
      self?.rowUnmounted(removed, in: model)
    }
    cell.onRowLost = { [weak self] _, ownHandOver in
      // This cell is now blank on screen, and a list at rest never asks for it again, so it
      // is chased now. A hand-over between our own cells is chased too, but not counted.
      if !ownHandOver { self?.rowLosses += 1 }
      self?.readoptMisdrawnCells()
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

  /// Apply the chrome a row's props decide: the accessory, and whether a tap highlights it.
  /// The Row calls this when its props change while it is on screen.
  func refresh(cell: NitroUiFormRowCell, for row: UIView) {
    let owner = HybridNitroUiForm.rowOwner(of: row)
    cell.accessories = Self.accessories(for: owner)
    cell.isPressable = owner?.pressable == true
    // A pressable row is one accessibility element, a button labelled from its content. A
    // row without `onPress` keeps its content's own elements.
    let pressable = owner?.pressable == true
    cell.isAccessibilityElement = pressable
    cell.accessibilityTraits = pressable ? .button : []
    cell.accessibilityLabel = pressable ? nitroUiAggregatedLabel(in: row) : nil
    cell.isSelectedRow = owner?.selected == true
    var configuration = UIBackgroundConfiguration.listGroupedCell()
    configuration.backgroundColor = .secondarySystemGroupedBackground
    cell.backgroundConfiguration = configuration
    // UIKit re-runs the cell's configuration update on highlight and selection.
    cell.setNeedsUpdateConfiguration()
  }

  /// A section's `title` or `footer` changed while the section is in the list. The section's
  /// identity did not change, so a snapshot apply is a no-op and UIKit never re-runs the
  /// provider: the visible view is updated directly and the layout asked for its height again.
  func chromeChanged(in model: NitroUiFormSectionModel) {
    guard let index = sections.firstIndex(where: { $0 === model }) else { return }
    guard reconcileBands() else { return }
    list.collectionViewLayout.invalidateLayout()
    // One turn later, once the layout has answered the invalidation.
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      model.hybrid?.reportMetrics()
      self.reportGeometry()
    }
  }

  /// Update every visible header and footer whose text differs from its section's. Returns
  /// whether any changed, so the caller knows to invalidate the layout.
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


  /// The text a section's header or footer is drawn with, or `nil` while it is off screen.
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
  ) -> UICollectionReusableView {
    let isFooter = kind == UICollectionView.elementKindSectionFooter
    let band = Self.dequeueBand(ofKind: kind, for: indexPath, in: collectionView)
    guard let band = band as? NitroUiFormSupplementaryCell else {
      giveUps += 1
      return band
    }
    // With no section in the snapshot, answer with an empty view: the diffable data source
    // asserts on `nil`.
    guard let model = sectionModel(at: indexPath.section, in: collectionView) else {
      giveUps += 1
      band.configure(text: nil, footer: isFooter)
      return band
    }
    band.configure(text: isFooter ? model.footerText : model.title, footer: isFooter)
    return band
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

  /// The row a view is inside of. The keyboard path starts at the focused control.
  static func rowAncestor(of view: UIView) -> UIView? {
    for candidate in sequence(first: view, next: { $0.superview }) {
      if candidate is NitroUiFormRowContainer || candidate is NitroUiFormRowHostView {
        return candidate
      }
    }
    return nil
  }

  /// The Row Hybrid View behind a row's component view, reached through its content view.
  static func rowOwner(of componentView: UIView) -> HybridNitroUiFormRow? {
    for subview in componentView.subviews {
      if let host = subview as? NitroUiFormRowHostView { return host.owner }
    }
    return nil
  }

  // MARK: - The list's delegate (a separate `NSObject`; a Nitro Hybrid is not one)

  private lazy var listDelegate = NitroUiFormListDelegate(form: self)

  /// A row's own recognizer reported a completed press; it only begins for a pressable row.
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
    // A guess from the layout's attributes, used only until a cell is on screen: a laid-out
    // cell reports the box it really draws its row in, and that number wins.
    guard rowBoxWidth() < 0 else { return }
    guard let guess = attributesWidth() else { return }
    // Never wider than the last real box: too wide puts a row's content past its bounds,
    // where UIKit's hit-test does not look.
    let width = lastRowBoxWidth > 0 ? min(guess, lastRowBoxWidth) : guess
    guard abs(width - reportedWidth) > 0.25 else { return }
    publishRowBox(width)
  }

  /// The width the layout gives a cell.
  private func contentWidth() -> CGFloat {
    attributesWidth() ?? 0
  }

  /// What the list's own layout says a cell is wide, or `nil` while it has not worked that
  /// out yet. `nil` is the answer a caller has to be able to tell from `0`.
  private func attributesWidth() -> CGFloat? {
    guard list.bounds.width > 0 else { return nil }
    return list.layoutAttributesForItem(at: IndexPath(item: 0, section: 0))?.frame.width
  }

  /// A laid-out cell reports the width it gives its row. Only a plain row's box is published
  /// as the list-wide width; an accessory row's box teaches this class what an accessory
  /// costs, and that row is told its own box directly.
  func rowBoxWidthReported(_ width: CGFloat, accessory: Bool) {
    boxReports += 1
    guard width > 0 else { return }
    // A cell reports on every layout of itself, so only a change triggers the walk below.
    var moved = false
    if accessory {
      moved = abs(width - accessoryRowBoxWidth) > 0.25
      accessoryRowBoxWidth = width
      // With no plain row seen yet, an accessory row's box is still a real box to clamp by.
      if lastRowBoxWidth < 0 { lastRowBoxWidth = width }
    } else {
      moved = abs(width - plainRowBoxWidth) > 0.25
      plainRowBoxWidth = width
      lastRowBoxWidth = width
      if abs(width - reportedWidth) > 0.25 {
        publishRowBox(width)
        moved = true
      }
    }
    if plainRowBoxWidth > 0, accessoryRowBoxWidth > 0 {
      let inset = max(0, plainRowBoxWidth - accessoryRowBoxWidth)
      if abs(inset - accessoryInset) > 0.25 {
        accessoryInset = inset
        moved = true
      }
    }
    if moved { pushRowBoxEstimates() }
  }

  private func publishRowBox(_ width: CGFloat) {
    reportedWidth = width
    widthPublishes += 1
    contentBox?(Double(width))
  }

  /// Forget every box this Form remembers, and every row's memory of the box it was told, so
  /// the next reports get past the change guards on both sides.
  private func forgetRowBoxes() {
    lastRowBoxWidth = -1
    plainRowBoxWidth = -1
    accessoryRowBoxWidth = -1
    accessoryInset = 0
    reportedWidth = .zero
    for model in sections {
      for view in model.rows {
        HybridNitroUiForm.rowOwner(of: view)?.forgetReportedBox()
      }
    }
  }

  /// The box to hand a row that cannot ask its own cell: the plain box, less what an accessory
  /// costs, or `nil` while the list has not laid out a cell at all.
  private func estimatedRowBox(accessory: Bool) -> CGFloat? {
    let base = plainRowBoxWidth > 0 ? plainRowBoxWidth : reportedWidth
    guard base > 0 else { return nil }
    return accessory ? max(1, base - accessoryInset) : base
  }

  /// Tell every row that cannot ask its own cell what the list gives a row of its kind: rows
  /// parked in a holding view after a resize, and rows mounted before the list knew its width.
  private func pushRowBoxEstimates() {
    for model in sections {
      for view in model.rows {
        guard let row = HybridNitroUiForm.rowOwner(of: view) else { continue }
        guard !row.isShownInCell || !row.hasReportedBox else { continue }
        guard let box = estimatedRowBox(accessory: row.accessoryValue != .none) else {
          continue
        }
        row.contentBoxReported(box)
      }
    }
  }

  // MARK: - What the layout knows (a Section asks, rather than typing constants)

  /// The width a cell gets, for measuring the space a header needs.
  func contentWidthForMetrics() -> CGFloat {
    contentWidth()
  }

  /// For the test report: `span` is the widest visible row box minus the narrowest, and
  /// `mismatch` the worst gap on screen between a row's box and the width its React content
  /// was laid out at.
  private func boxWitness() -> (span: CGFloat, mismatch: CGFloat) {
    var boxes: [CGFloat] = []
    var mismatch: CGFloat = 0
    for case let cell as NitroUiFormRowCell in list.visibleCells {
      guard cell.rowBoxWidth > 0 else { continue }
      boxes.append(cell.rowBoxWidth)
      guard let row = cell.row,
        let laid = HybridNitroUiForm.rowOwner(of: row)?.contentLaidWidth,
        laid > 0
      else { continue }
      mismatch = max(mismatch, abs(laid - cell.rowBoxWidth))
    }
    let span = boxes.count > 1 ? (boxes.max() ?? 0) - (boxes.min() ?? 0) : -1
    return (span, mismatch)
  }

  /// The width a row on screen is drawn in, or -1 while none is.
  private func rowBoxWidth() -> CGFloat {
    for cell in list.visibleCells {
      let width = (cell as? NitroUiFormRowCell)?.rowBoxWidth ?? 0
      if width > 0 { return width }
    }
    return -1
  }

  /// The height the layout gives this section's header or footer, or 0.
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

  // MARK: - Keyboard

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
        // Removing the inset moves the content, and no delegate callback reports it.
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
    // The overlap is taken in window space, where the keyboard's frame is. The list's bounds
    // space travels with `contentOffset`, so it is only right for the scroll decision below.
    let boxInWindow =
      list.superview.map { $0.convert(list.frame, to: nil) } ?? list.frame
    let overlap = max(0, boxInWindow.maxY - end.minY)
    // Less the bottom safe area: UIKit adds it to the inset by itself, and the overlap
    // already covers it.
    setBottomInset(max(0, overlap - list.safeAreaInsets.bottom))
    guard let focused = list.findFirstResponder(),
      let row = HybridNitroUiForm.rowAncestor(of: focused) else { return }
    let rect = list.convert(row.frame, from: row.superview)
    // `list.bounds` is the visible box in content coordinates; the adjusted inset covers the
    // bottom of it.
    let visibleBottom = list.bounds.maxY - list.adjustedContentInset.bottom
    if rect.maxY > visibleBottom {
      scrollList(
        to: list.contentOffset.y + (rect.maxY - visibleBottom) + 8,
        animated: true
      )
    }
    reportGeometry()
  }

  /// Scroll the list programmatically. An animated scroll here sets none of `isDragging`,
  /// `isTracking` or `isDecelerating` and ends without a delegate callback, so
  /// `scrollAnimating` guards its frames and the completion reports the geometry.
  func scrollList(to targetY: CGFloat, animated: Bool) {
    let target = CGPoint(x: list.contentOffset.x, y: targetY)
    guard animated else {
      list.setContentOffset(target, animated: false)
      list.layoutIfNeeded()
      reportGeometry()
      return
    }
    scrollAnimating = true
    UIView.animate(
      withDuration: 0.3,
      delay: 0,
      options: [.beginFromCurrentState, .allowUserInteraction],
      animations: { self.list.contentOffset = target },
      completion: { _ in
        self.scrollAnimating = false
        self.reportGeometry()
      }
    )
  }

  // MARK: - Where the list came to rest (`onPlacement` / `onContentOffset`)

  /// Report where the list came to rest: each section's top in content coordinates, and how
  /// far the content is scrolled. Together they make every row measure where it is drawn.
  /// Called when the list settles (an inset change included), never per scroll frame.
  func reportGeometry() {
    // UIKit shifts `contentOffset` as a scroll view leaves its window, when the JS callbacks
    // may already be torn down, and calling one then is fatal.
    guard holding.superview != nil, list.window != nil else { return }
    list.layoutIfNeeded()

    takeTopResetIfNeeded()

    let offset = Double(list.contentOffset.y)
    // Recorded only when there was a callback to tell: the first pass can run before
    // `onContentOffset` is set, and that offset must still be sent later.
    if reportedOffset != offset, scrollOffsetReport != nil {
      reportedOffset = offset
      offsetPublishes += 1
      scrollOffsetReport?(offset)
    }

    let inset = rowInset()
    for (sectionIndex, model) in sections.enumerated() {
      guard let top = sectionTop(sectionIndex, in: model) else { continue }
      model.hybrid?.applyPlacement(top: top, inset: inset)
    }

    // Every settle ends here, so this is where a cell not drawing its item is chased.
    readoptMisdrawnCells()
  }

  /// The y JavaScript puts this section at so that each row's Yoga origin is its cell's
  /// position in the content: the first item's top in the Form's box, less the header band
  /// JavaScript reserves inside the section. Asked of the layout, which also answers for an
  /// off-screen section. `nil` while the layout has not worked the section out.
  private func sectionTop(_ sectionIndex: Int, in model: NitroUiFormSectionModel) -> CGFloat? {
    guard !model.rows.isEmpty else { return nil }
    guard let first = list.collectionViewLayout.layoutAttributesForItem(
      at: IndexPath(item: 0, section: sectionIndex)
    ) else { return nil }
    return first.frame.minY + holding.frame.minY
      - supplementaryHeight(footer: false, in: model)
  }

  /// The height the header's text needs, leading included, measured with the font of the
  /// configuration the header cell is built with.
  func headerTextHeight(in model: NitroUiFormSectionModel) -> CGFloat? {
    guard let title = model.title, !title.isEmpty else { return nil }
    var configuration = UIListContentConfiguration.groupedHeader()
    configuration.text = title
    let font = configuration.textProperties.font
      ?? UIFont.preferredFont(forTextStyle: .subheadline)
    return ceil(title.size(withAttributes: [.font: font]).height + font.leading)
  }

  /// The x a row is drawn at in the Form's box: the list's margins plus the cell's own.
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
    // Called on the JS thread, which must not block on main, where the state lives: return
    // the cached report and refresh it for the next read.
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
    let boxes = boxWitness()
    var drawn: Set<ObjectIdentifier> = []
    var claims = 0
    for case let cell as NitroUiFormRowCell in list.visibleCells {
      if let row = cell.row { drawn.insert(ObjectIdentifier(row)) }
      if cell.claimsRowItDoesNotHold { claims += 1 }
    }
    // Cells holding a row that is not their item's.
    var wrongCells = 0
    if let dataSource {
      for path in list.indexPathsForVisibleItems {
        guard let id = dataSource.itemIdentifier(for: path) else { continue }
        if !self.cell(at: path, isDrawing: id) { wrongCells += 1 }
      }
    }
    let rowsInCells = sections.reduce(0) { total, section in
      total + section.rows.filter { $0.superview is NitroUiFormRowContainer }.count
    }
    // Row views in a section's holding view that this Form was never told about.
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
      "rowsInCells=\(rowsInCells)",
      "distinctDrawn=\(drawn.count)",
      "claims=\(claims)",
      "wrongCells=\(wrongCells)",
      "losses=\(rowLosses)",
      "giveUps=\(giveUps)",
      // In a window, list height, content height, visible index paths, realised cells.
      "screen=\(list.window != nil ? 1 : 0),\(Self.number(list.bounds.height)),\(Self.number(list.contentSize.height)),\(list.indexPathsForVisibleItems.count),\(list.visibleCells.count)",
      "orphans=\(orphans)",
      "stale=\(stale)",
      "alive=\(knownRows.count)",
      "reparents=\(reparents)",
      "reclaims=\(reclaims)",
      "applies=\(snapshotApplies)",
      "width=\(Self.number(reportedWidth))",
      "plainBox=\(Self.number(plainRowBoxWidth))",
      "accessoryInset=\(Self.number(accessoryInset))",
      "widthPublishes=\(widthPublishes)",
      "listWidth=\(Self.number(list.bounds.width))",
      "boxW=\(Self.number(rowBoxWidth()))",
      "boxReports=\(boxReports)",
      "boxSpan=\(Self.number(boxes.span))",
      "boxMismatch=\(Self.number(boxes.mismatch))",
      "heights=\(heights)",
      "taps=\(taps)",
      "keyboard=\(Self.number(keyboardInset))",
      "insetBottom=\(Self.number(list.contentInset.bottom))",
      "adjBottom=\(Self.number(list.adjustedContentInset.bottom))",
      "offsetPublishes=\(offsetPublishes)",
      "recycles=\(recycles)",
      "selfSizing=\(listSelfSizesRows ? 1 : 0)",
      "ime=0.00",
      "offset=\(Self.number(list.contentOffset.y))",
      // `origin` is the offset sent to JavaScript, `received` the one it sent back.
      "origin=\(Self.number(reportedOffset ?? .nan))",
      "received=\(Self.number(receivedContentOffsetY ?? .nan))",
      "listY=\(Self.number(holding.frame.minY))",
      "insetTop=\(Self.number(list.adjustedContentInset.top))",
      "placed=\(reportedPlacement.count)",
      "order=\(rowOrder())",
    ] + geometryFields(of: list, kind: "prototype")).joined(separator: ";")
  }

  /// The first rows in model order, each named by its own text and joined with `|`. Capped,
  /// and stripped of the characters the report line uses as separators.
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

  /// The heights the layout gives the first few rows.
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
    // Called on the JS thread.
    DispatchQueue.main.async { [weak self] in
      self?.list.setContentOffset(CGPoint(x: 0, y: CGFloat(y)), animated: false)
      self?.list.layoutIfNeeded()
      self?.reportGeometry()
    }
  }

  /// Test-only: drive one of the list's own behaviours from inside the library.
  func nuiTestCommand(command: String) throws {
    DispatchQueue.main.async { [weak self] in self?.run(command: command) }
  }

  private func run(command: String) {
    nitroUiAssertMainThread()
    switch command {
      case "scroll-no-report":
        // Move the content without reporting it, so the delegate has to notice by itself.
        list.setContentOffset(
          CGPoint(x: list.contentOffset.x, y: list.contentOffset.y + 60),
          animated: false
        )
        list.layoutIfNeeded()
      case "scroll-animated":
        scrollList(to: list.contentOffset.y + 60, animated: true)
      case "self-sizing-off":
        // Behave like a list before iOS 16, which never notices a row's height constraint.
        if #available(iOS 16.0, *) {
          list.selfSizingInvalidation = .disabled
        }
        listSelfSizesRows = false
      default:
        break
    }
  }

  /// The grouped list's own measurements for the test report, all read from the layout.
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
    // What the row itself measured; absent while the row has no filled cell.
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
    // The first footer any section has: a form's last section usually has none.
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
      // A list cell exposes where its separator starts as a layout guide.
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

  /// Whether a subview of a Section's holding view is a `Form.Row`'s component view: it
  /// carries the content view the Row installed. A plain `View` in a Section is not a row.
  static func isRowView(_ view: UIView) -> Bool {
    view.subviews.contains { $0 is NitroUiFormRowHostView }
  }
}

extension NitroUiFormItem {
  /// The row an item names, or `nil` for an item that is not one.
  var rowView: UIView? {
    if case let .row(view) = self { return view }
    return nil
  }

  static let rowReuseIdentifier = "nitroui-form-row"
  static let headerReuseIdentifier = "nitroui-form-header"
  static let footerReuseIdentifier = "nitroui-form-footer"
}

/// A list item: a row, identified by its view. Identity by view is what makes a keyed insert
/// in the middle of a section an insert in the diff, so the other rows keep their state.
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

/// The largest corner radius anywhere in a cell's layers: the cell's own layer is square and
/// the rounding lives on the background view UIKit puts behind its content.
private func nitroUiMaxCornerRadius(_ layer: CALayer, depth: Int = 0) -> CGFloat {
  guard depth < 4 else { return layer.cornerRadius }
  var best = layer.cornerRadius
  for sublayer in layer.sublayers ?? [] {
    best = max(best, nitroUiMaxCornerRadius(sublayer, depth: depth + 1))
  }
  return best
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

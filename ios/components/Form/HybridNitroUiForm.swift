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
    // What the provider answers with when it has nothing to draw has to be a cell UIKit can
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
  /// The models of the mount that has just ended, kept only so that the provider can still
  /// answer for them: `prepareForRecycle` leaves the list's snapshot alone (emptying it costs
  /// a layout pass that the next mount then has to undo), so UIKit lays these items out again
  /// when the recycled list comes back on screen. Cleared by the next apply, which replaces
  /// the snapshot they are in.
  private var retiredSections: [NitroUiFormSectionModel] = []
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
  /// The box the most recent laid-out row container handed its row, kept after that cell is
  /// gone, so a guess about the content box has something real to be measured against. A
  /// guess is `attributesWidth()`: the width of the *cell*, not of the box inside the cell's
  /// own margins, so it is wider than every row by those margins - 32 pt on a 402 pt screen,
  /// 40 pt on a 420 pt one. A row laid out at a guess draws its right-aligned content past
  /// its own bounds, and UIKit stops hit-testing there, which is why one simulator counted
  /// ten presses of a `Pressable` at the right end of a row and the other counted none for
  /// the same Form on the same runtime (X29): the escape needs the content to overhang by
  /// more than half the content's own width, and only the wider screen quite does it.
  private var lastRowBoxWidth: CGFloat = -1
  /// The box a cell gives a row *without* a trailing accessory — the number this class
  /// publishes to JavaScript as the Form's one width.
  ///
  /// It is the plain box and nothing else, because there is one number for the whole list and
  /// only the plain rows share it: publishing the last box any cell reported made the number
  /// every `Section` and `RowRoot` renders against flip between 338 and 316 depending on which
  /// cell laid out last, and each flip re-renders the Form's whole tree (fix round 2, item 3).
  /// An accessory row does not need the list-wide number to be its own: it is told its box
  /// through `NitroUiFormRow.contentBoxReported`, and the rows that cannot answer for
  /// themselves are handed `plainRowBoxWidth - accessoryInset` by `pushRowBoxEstimates`.
  private var plainRowBoxWidth: CGFloat = -1
  /// The box a cell gives a row *with* a trailing accessory, or -1 until one has laid out.
  private var accessoryRowBoxWidth: CGFloat = -1
  /// What a trailing accessory costs a row: `plainRowBoxWidth - accessoryRowBoxWidth`, the
  /// 22 pt the accessory's own margins take out of the plain box. Measured, never typed.
  private var accessoryInset: CGFloat = 0
  /// The list width the boxes above belong to, so the next resize is visible as one.
  private var framedBoxWidth: CGFloat = -1
  /// How many times the list-wide box has been published. The contract is one per list width:
  /// a number that climbs while the list merely scrolls says the number is following the
  /// cells rather than the list (fix round 2, item 3).
  private var widthPublishes = 0
  /// How many times a laid-out cell has offered its row box. A witness, not a counter with
  /// a bound: `width` right and `boxReports` zero means the cell never asked, and the row
  /// was laid out at whatever an earlier, wider guess said.
  private var boxReports = 0
  /// How many times a cell has had its row taken out from under it (``NitroUiFormRowCell``'s
  /// `onRowLost`). Not a bound: adoption by another cell is a legitimate repair, and the
  /// stealing happens all the way through a mount. It is the witness that the *event* the
  /// Form used to be blind to really does happen here, rather than being a story told about
  /// a red test - `claims` is the number that has to be 0 once it is noticed.
  private var rowLosses = 0
  private var giveUps = 0
  /// How many times the provider could not fill an index path and handed back an empty cell
  /// (fix round 2). A witness, not a bound: it says whether the blank rows a chase repairs ever
  /// came from here, and it is the number to watch if a Form starts drawing gaps.
  /// How many times this *view* has been prepared for reuse - one `prepareForRecycle`, whether
  /// it came from the pool or from a drop. Deliberately not reset by the reset: the Form
  /// mounted into a recycled list is the only one that can say it was recycled, and a case that
  /// cannot tell the two apart cannot assert anything about what the recycle left behind.
  private var recycles = 0
  private var keyboardInset: CGFloat = .zero
  /// How many offsets have actually been handed to JavaScript. A settle reports once, so a
  /// number that climbs by one per frame of a scroll says the guard in
  /// `NitroUiFormDelegate.scrollViewDidScroll` has stopped guarding (fix round 2, item 3).
  private var offsetPublishes = 0
  /// Whether the list is in a scroll that *nobody's finger* started: this class's animated
  /// `setContentOffset` for the keyboard, or UIKit's own animated scroll to the top from a
  /// status-bar tap. Neither sets `isDragging`, `isTracking` or `isDecelerating`, so the
  /// delegate's guard lets every frame of them through (fix round 2, item 3).
  var scrollAnimating = false

  /// Whether this list still owes the reset that puts it at the top of its own content.
  ///
  /// `prepareForRecycle` asks UIKit for it, and the answer does not always stick: a recycled
  /// list's offset comes back with the view as it re-enters a window, later than the recycle,
  /// Which is how a Form mounted into a list another mount had scrolled was measured still
  /// sitting at 200 pt against a 68 pt top inset (fix round 2, item 2).
  private var pendingTopReset = false

  /// How many turns the reset above has spent on one mount, so a list that cannot reach the
  /// offset it is being pushed to stops being pushed.
  private var topResetTries = 0

  /// Whether this list has carried content in a mount that has since ended. The rule for
  /// owing a top reset: a Form's first mount has no scroll to inherit, and a second mount
  /// into the same list has exactly that.
  private var hasCarriedContent = false

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
    // A recycled list keeps its `contentOffset`, and the Form mounted into it inherits a
    // scroll nobody asked for: E7 measured an at-rest offset of -2 against a 62 pt top inset,
    // which is another surface's +60 carried over (fix round 2, item 2). Back to the top of
    // the content, wherever the list's *current* inset puts that.
    list.setContentOffset(
      CGPoint(x: list.contentOffset.x, y: -list.adjustedContentInset.top),
      animated: false
    )
    pendingTopReset = true
    topResetTries = 0
    // The list keeps its data source and its content, and the models the ended mount left
    // behind stay drawable (`retiredSections`, and `model(owning:)` below), so the recycle
    // asks nothing of the next mount. Emptying the list here — detaching its data source,
    // or applying the empty snapshot before returning — also keeps UIKit from asking about
    // items this Form has forgotten, and was this fix's first answer, but each costs E4: the
    // recycled list then passes through an empty layout before the new content arrives,
    // instead of going from the old content to the new in the one coalesced apply below, and
    // the row content the case presses is then aimed at a box the shadow tree has not been
    // told about (pair-b, fix round 2: both eager variants red, this one green).
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

  /// Put a list that another mount left scrolled back at the top of its own content.
  ///
  /// `prepareForRecycle` asks UIKit for it, and that ask cannot stick on its own: at that
  /// moment the list has no sections, so "the top" has nothing to mean, and a snapshot that is
  /// still being applied puts the old offset back after any later ask has run. The Form
  /// therefore asks again from every geometry pass until the list is *verifiably* at the top,
  /// and the ask is owed whenever a mount begins on a list that has carried content before —
  /// whether the view came back from React Native's pool or Fabric kept this very view for a
  /// keyed change (measured: a key swap leaves `recycles` where it was and the offset at the
  /// 200 pt the previous mount left it, so a Form mounted into it inherited a scroll nobody
  /// asked for, fix round 2, item 2).
  ///
  /// Returns whether this is the pass that finished the job.
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
      // Not there: UIKit moved it back behind the ask. Another turn, a bounded number of
      // them, so a list that cannot reach that offset stops being fought over.
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
      if abs(holding.frame.width - framedBoxWidth) > 0.25 {
        // The list is a width it has not been laid out at: a rotation, an iPad resize, or the
        // app changing a parent's width. Every box remembered below belongs to the old one, and
        // a row that is *off screen* is not laid out again until it is scrolled back — so it
        // would go on being laid out, and measured, at a box the list no longer gives anybody
        // (fix round 2, item 2). Forgetting here is also what lets the reports the new pass is
        // about to make through the change guards on both sides.
        forgetRowBoxes()
        framedBoxWidth = holding.frame.width
      }
      // The layout needs one pass before it can answer what a cell is wide.
      list.layoutIfNeeded()
      reportContentBox()
      // The rows the new pass did not reach — the ones parked in a section's holding view —
      // have nothing else that will ever tell them the new box.
      pushRowBoxEstimates()
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
    // A mount beginning on a list that has carried content before inherits that content's
    // scroll position unless something puts it back (fix round 2, item 2).
    if sections.isEmpty, hasCarriedContent {
      pendingTopReset = true
      topResetTries = 0
    }
    sections.insert(model, at: min(index, sections.count))
    hasCarriedContent = true
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
    // Whatever reconfigure was in flight is superseded by this snapshot.
    reconfigureTargets = [:]
    dataSource?.apply(snapshot, animatingDifferences: false)
    // The ended mount's models were only owed an answer until this snapshot replaced theirs.
    retiredSections.removeAll()
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
      // Before anything is asked of the visible rect: a recycled list still sitting at the
      // previous mount's offset puts that rect outside the content, and a list with no visible
      // items dequeues no cells and adopts no rows - the Form draws nothing at all until
      // something scrolls it (measured at 200 pt against 646 pt of content).
      takeTopResetIfNeeded()
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

  /// Notice every visible item that its cell is not drawing, and ask the data source again for it.
  ///
  /// A cell can be on screen holding nothing while no count beside it is wrong: the snapshot has
  /// the item, the model has the row, and the row is alive in a section's holding view. Three
  /// ways in, the first two measured in fix round 1's own logs — `inCells` 3 against 5 items on
  /// screen, 2 against 5, 1 against 5, and 0 against 4 at offset 400, none of which looked like
  /// anything but a blank row:
  ///
  /// - UIKit moves an item to another index path in a snapshot apply and keeps the cell already
  ///   drawing it, without asking the provider again — and the row went to its section's holding
  ///   view on the way;
  /// - the provider gives up once (its guard reads an index path the models have moved under, or
  ///   hands back a plain `UICollectionViewCell`) and UIKit keeps that blank cell, because the
  ///   next snapshot says the same item at the same index path and has nothing to reconfigure;
  /// - a row is taken out of a cell that is still on screen (another cell adopts it), and
  ///   `giveBack` correctly refuses to hand the same row back twice, so this cell's pointer was
  ///   cleared with nobody coming to replace it.
  ///
  /// The remedy is the same in every case: adoption is the provider's job, so run the provider
  /// again for those items — and which of the two snapshot operations that is depends on what is
  /// actually on screen at that item:
  ///
  /// - one of *our* cells — holding nothing, or holding somebody else's row: `reconfigureItems`,
  ///   the API for "build this cell again". It re-runs the provider and requires it to return
  ///   *that same cell*, which is only possible for a cell that came from this registration — so
  ///   it is the right ask for ours and a fatal one for anything else (see `giveUpCell(in:at:)`).
  ///   The blank a provider that gave up leaves behind is deliberately one of ours, which is why
  ///   it gets filled by a reconfigure instead of replaced by a reload;
  /// - a cell that is not ours at all cannot be reconfigured either: the provider cannot hand
  ///   back *that* cell through any registration, and a freshly dequeued one is another cell,
  ///   which is the answer that aborts. Those items get `reloadItems`, which is allowed to build
  ///   a new cell, which is the only thing that can replace one.
  ///
  /// Asked from `reportGeometry`, which is every settle there is — the one after a snapshot
  /// apply and the one after a list came to rest — so a blank cell is chased whether an apply or
  /// a scroll made it. The apply itself waits for the next turn: writing a diffable snapshot from
  /// inside a `UIScrollView` or layout callback is the class of thing UIKit answers with an
  /// exception, and by the next turn a settle may have been followed by an apply that fixed the
  /// cell anyway. `readoptQueued` keeps it to one per settle.
  ///
  /// That hop is also why the models are asked, again, in the turn the apply is written: React
  /// can unmount a Section — or the whole Form — in between, which leaves the *snapshot* holding
  /// items this class has forgotten, and a provider run for one of those index paths has nothing
  /// to draw. `misdrawnVisibleItems()` drops them; `applySnapshot` is already queued for the same
  /// change, so it costs nothing but a turn.
  private var readoptQueued = false

  /// The cells a reconfigure has been applied for, by index path, while that reconfigure can
  /// still run. The only thing the provider may answer a reconfiguration with; see
  /// `giveUpCell(in:at:)`. Another snapshot closes the window before it applies: answering an
  /// insert with a cell that is already on screen is as wrong as the reverse.
  private var reconfigureTargets: [IndexPath: UICollectionViewCell] = [:]

  /// One visible item its cell is not drawing, and the cell that is short of its row.
  private struct MisdrawnItem {
    let id: NitroUiFormItem
    let path: IndexPath
    /// The cell on screen when it is one of ours. `nil` says a different cell is there, or
    /// none yet — and a reconfigure may not be asked for either.
    let cell: NitroUiFormRowCell?
  }

  private func readoptMisdrawnCells() {
    guard !readoptQueued else { return }
    readoptQueued = true
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.readoptQueued = false
      // A turn is a long time for a Form whose cell just lost its row: this is the same window
      // in which React can take the whole tree away, and a reconfigure for an item whose cell is
      // no longer on screen is answered by UIKit with an exception, not a no-op. The settle path
      // gets the first two guards from `reportGeometry`; the loss path has to ask for itself. The
      // third is the shape a mount/unmount loop leaves between the settle and this turn: a Form
      // with no sections has no rows to put in a cell, and nothing worth chasing.
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
      // `apply` may run the reconfigure inline or hand it to the next layout pass, so the
      // window cannot close the moment it returns — the provider may still be coming. Once
      // the run loop has moved on, nothing is owed an answer any more.
      DispatchQueue.main.async { [weak self] in
        self?.reconfigureTargets = [:]
      }
    }
  }

  /// The items on screen that their cell is not drawing, and the cell on screen at each.
  /// Main thread only.
  ///
  /// Asked as "is this the item's row?", not "does this cell hold a row?" — and the difference is
  /// the bug. A cell's `row` is a pointer to *a* row, and a cell can be on screen holding a
  /// perfectly live row that is not the one its item names: a recycled list whose cells came
  /// through a snapshot apply with the previous mount's rows in them, which UIKit sees as
  /// configured because something is in them. Asked the old question, the answer is "nothing is
  /// rowless", `inCells` equals the item count, and the row the item *does* own sits in its
  /// section's hidden holding view drawing nothing — a blank row no count beside it calls wrong,
  /// and the state X29's harness case pressed ten times at and hit the neighbour's pixels instead
  /// (measured: `rows` 9, `inCells` 9, `rowsInCells` 8, `wrongCells` 1).
  ///
  /// So the question is identity: the cell at this index path has to be holding the row this item
  /// is. Anything else — nothing, or somebody else's row — is re-run through the provider, which
  /// is the one place allowed to adopt, and which hands the wrong row back on its way in.
  ///
  /// Only an item the models still put at this index path may be chased: reconfiguring one that
  /// React has already dropped makes the provider answer with a cell of its own, and UIKit raises
  /// an exception for a reconfigure that does not return the cell on screen. That item is on its
  /// way out of the snapshot with the apply React's unmount queued.
  private func misdrawnVisibleItems() -> [MisdrawnItem] {
    guard let dataSource, dataSource.snapshot().numberOfItems > 0 else { return [] }
    var found: [MisdrawnItem] = []
    for at in list.indexPathsForVisibleItems {
      guard let id = dataSource.itemIdentifier(for: at), let row = id.rowView else { continue }
      guard self.path(for: row) == at else { continue }
      if self.cell(at: at, isDrawing: id) { continue }
      // A cell that is not one of ours at all has no row either, and reads as `nil` here — which
      // sends it down the `reloadItems` branch, the only one that can replace a cell.
      let cell = list.cellForItem(at: at) as? NitroUiFormRowCell
      found.append(MisdrawnItem(id: id, path: at, cell: cell))
    }
    return found
  }
  /// The cell to answer with when this Form has nothing to draw at an index path.
  ///
  /// Every answer has to be a cell UIKit can account for — one it handed out for a registered
  /// reuse identifier — because UIKit checks. While it is bringing an item on screen the check
  /// is that the cell came from a registration at all, and a bare `UICollectionViewCell()`
  /// aborts the app in `_createPreparedCellForItemAtIndexPath:`; that is the crash the harness
  /// churn case finds, on the fixed tree as much as the broken one, because a Form torn down
  /// mid-settle leaves items in the list that its models have forgotten, and the next layout
  /// asks the provider for one of them. While it is *reconfiguring* an item the check is
  /// narrower: the answer has to be the cell already on screen, and anything else raises
  /// `NSInternalInconsistencyException` out of
  /// `-[UICollectionView _reconfigureCell:forItemAtIndexPath:]` — the crash X24's bench hit on
  /// every launch, when a Section unmounted in the turn between a settle's readopt and the
  /// apply it queued.
  ///
  /// So a reconfigure is answered with the cell it asked about, and anything else with a blank
  /// cell of this list's own registration. The blank one draws nothing, the next settle finds no
  /// row in it and reconfigures it, and the `applySnapshot` queued behind the give-up has the
  /// real content either way.
  ///
  /// Every branch counts a `giveUps`: with the cell provider answering from the item and the band
  /// provider from the snapshot, a Form that gets here has a list and a model stream that disagree
  /// in a way neither chase covers, and that is worth a number in the report.
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
      // Every answer is a view UIKit handed out. A bare `UICollectionViewCell()` — a view nobody
      // dequeued — is answered on iOS 27 with an `NSInternalInconsistencyException` from
      // `-[UICollectionView _createPreparedCellForItemAtIndexPath:...]` ("returned a cell without
      // a reuseIdentifier"), and Swift has no landing place for an ObjC exception, so the app
      // dies: measured on pair-b at index path 1-2, where the whole Form suite then reads as
      // "The app bridge disconnected during test execution" instead of as a dead app (X29 fix
      // round 2). A Form whose view is gone is held to the same rule as one still here.
      self?.cell(at: indexPath, for: item, in: collectionView)
        ?? Self.blankCell(for: indexPath, in: collectionView)
    }
    dataSource.supplementaryViewProvider = { [weak self] collectionView, kind, indexPath in
      // The same rule for a band: iOS 27 raises for
      // "UICollectionViewDiffableDataSource supplementary view provider returned nil", measured
      // at index path 1-0 on the same tree that fixed the cell answer above. Both providers are
      // total because both questions can be asked about a section this Form has already let go.
      self?.supplementary(kind, at: indexPath, in: collectionView)
        ?? Self.blankBand(ofKind: kind, for: indexPath, in: collectionView)
    }
    self.dataSource = dataSource
  }

  /// The live section that owns a row, or `nil` when this Form has no live section for it.
  ///
  /// Asked of the row rather than of the index path UIKit is holding: after a recycle the two
  /// disagree, and the list is entitled to be shown the row it was shown before either way. What
  /// a model is good for here is *lifecycle* — whose holding view a row goes back to, and which
  /// section a Fabric unmount is reported against — and an ended mount's section can promise
  /// neither: its holding view belongs to a tree that is gone, so a row parked in it has no
  /// pixels and no next owner. A row with no live section goes to the Form's own holding view
  /// instead (see `cell(at:for:in:)`), which the next mount takes from. What the section *says*
  /// — a band's title — comes from the snapshot instead, in `sectionModel(at:in:)`.
  private func model(owning row: UIView) -> NitroUiFormSectionModel? {
    for section in sections + retiredSections
    where section.rows.contains(where: { $0 === row }) {
      return section
    }
    return nil
  }

  /// The section UIKit is asking about, read out of the snapshot it is laying out.
  ///
  /// Not `sections`: that array is what React Native's mount/unmount stream says *now*, while the
  /// snapshot is what UIKit is laying out, and the two are only equal between a mutation and the
  /// next apply - which `applySnapshot` deliberately defers a turn, because applying a snapshot
  /// inside Fabric's layout pass is itself a UIKit crash. So there is a real window in which a
  /// section is gone from `sections` and the list is still laying it out, and the way into it
  /// needs no test of its own: the mounting transaction that removes a Section also resizes the
  /// Form's holding view, and `safeAreaInsetsDidChange` -> `listNeedsFrame` ->
  /// `list.layoutIfNeeded()` lays the list out inside that same transaction - before the queued
  /// apply. UIKit then legitimately asks for section 1 while `sections` has one entry, and an
  /// index test against `sections` is a test of the wrong thing.
  ///
  /// The snapshot answers for the index path UIKit holds by construction, and names the model
  /// that snapshot was built from, so a band gets the text of the section it was asked for. A
  /// row does not ask this: its item names the row itself, and the section a row needs is the one
  /// that still owns it (`model(owning:)`), which no index path can answer.
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

  /// A cell for `indexPath` that draws nothing - what a provider hands back when it cannot fill
  /// one. Dequeued, always: `UICollectionViewCell()` is not an option, because UIKit on iOS 27
  /// raises for a cell it never handed out, and that exception kills the app instead of leaving
  /// one blank row (X29 fix round 2). `prepareForReuse` has already given whatever row this cell
  /// used to hold back to its section, so it is empty.
  ///
  /// It is a cell of the *row* registration, which is what makes the blank repairable: the chase
  /// sees one of ours holding nothing and asks for a reconfigure, which the provider can answer
  /// with that same cell. A second, separate registration could only ever be replaced by a
  /// reload - a new cell for a row that only needed its old one filled.
  private static func blankCell(
    for indexPath: IndexPath,
    in collectionView: UICollectionView
  ) -> UICollectionViewCell {
    collectionView.dequeueReusableCell(
      withReuseIdentifier: NitroUiFormItem.rowReuseIdentifier,
      for: indexPath
    )
  }

  /// The band answer when there is no Form left to ask - dequeued and empty, for the same
  /// reason `blankCell` exists.
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
    // The answer comes from this list's own registration whatever the models say: a cell can be
    // asked for while the mount stream has already moved past this index path, and answering "I
    // have no section 1" is what used to hand UIKit a view it never dequeued. `giveUps` says how
    // often a provider still cannot fill what it was asked for — it should read 0, and a Form
    // that draws a blank row is a Form whose snapshot and models disagree in some new way.
    guard case let .row(row) = item else {
      return giveUpCell(in: collectionView, at: indexPath)
    }
    let cell = collectionView.dequeueReusableCell(
      withReuseIdentifier: NitroUiFormItem.rowReuseIdentifier,
      for: indexPath
    )
    guard let cell = cell as? NitroUiFormRowCell else {
      // Only a list that was not built by `makeList` could get this far, and the answer is still
      // the cell UIKit just handed out, not a new one.
      giveUps += 1
      return cell
    }
    // The model may be gone: the mount that had it ended, or React unmounted the Section in the
    // turn since the last settle, while the list's snapshot still holds the item. Asked about
    // such an item, the list is entitled to be shown the row it was shown before, and the item
    // names it — so the ask is still answerable with a real cell of this list's own registration,
    // and only the two lifecycle answers below need a section to be in it. Every other answer is
    // an abort: the harness churn case measures a give-up here as an assertion failure in
    // -[UICollectionView _updateVisibleCellsNow:] nine index paths deep, and X25 round 1's bench
    // crash is the same question answered into a reconfigure.
    let model = model(owning: row)
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
      guard let model = model else {
        // No section to go back to: the Form's own holding view keeps it out of the list,
        // and whoever mounts next takes it from there.
        NitroUiFormHoldingView.moving {
          if let form = self {
            form.holding.addSubview(given)
          }
        }
        return
      }
      // Back to its section's holding view, where Fabric put it. The Form's own move, so
      // the holding view must not read it as a Fabric remount.
      NitroUiFormHoldingView.moving { model.holding?.addSubview(given) }
    }
    cell.onRowRemoved = { [weak self] removed in
      guard let model = model else { return }
      // Fabric unmounted this row out of the cell it was showing.
      self?.rowUnmounted(removed, in: model)
    }
    cell.onRowLost = { [weak self] _, ownHandOver in
      // This cell lost its row to another cell, and is now a blank row on screen. Handing the
      // pointer back is the cell's job (it is what lets `misdrawnVisibleItemIdentifiers` see the
      // gap); noticing the gap is this Form's, and it cannot wait for the next settle —
      // a list at rest is exactly the state in which a blank cell appeared, and nothing else
      // ever asks for that cell again. The chase is coalesced per turn and re-reads the
      // visible cells rather than trusting this signal, so a steal during a scroll costs one
      // walk of the visible index paths, and a spurious one costs nothing.
      //
      // A hand-over (`ownHandOver`) is not a lost row and is not counted as one - that is
      // `losses` telling the truth (fix round 2, item 1) - but it still runs the chase below,
      // exactly as it did before the label existed. The label is only about the counting.
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
  ) -> UICollectionReusableView {
    let isFooter = kind == UICollectionView.elementKindSectionFooter
    let band = Self.dequeueBand(ofKind: kind, for: indexPath, in: collectionView)
    guard let band = band as? NitroUiFormSupplementaryCell else {
      giveUps += 1
      return band
    }
    // The band for a section that has gone out of `sections` while the list is still laying it
    // out still has a home in the snapshot (see `sectionModel`); only a snapshot that has moved
    // under UIKit leaves this with nothing to say, and an empty band is the answer that keeps the
    // app up to answer the next question. `nil` is not available either: the diffable data source
    // asserts on one, and the abort takes the app with it — which is what X25 round 1 found on
    // the device, one turn between a settle and the `applySnapshot` that removes a Section.
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
    guard let guess = attributesWidth() else { return }
    // The guard above only asks the cells on screen *right now*, and every one of them can be
    // mid-recycle, so this line is reached with a real box remembered rather than a fresh one.
    // A guess may not overhang the box it remembers: too narrow only moves content inward,
    // where it stays reachable, while too wide puts it past the row's own bounds, where
    // UIKit's hit-test will not look at it again.
    let width = lastRowBoxWidth > 0 ? min(guess, lastRowBoxWidth) : guess
    guard abs(width - reportedWidth) > 0.25 else { return }
    publishRowBox(width)
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

  /// The width a *laid-out cell* gives its row, and what that cell is drawing.
  ///
  /// `contentWidth()` is what the list's attributes say a cell is; this is what the row is
  /// actually drawn in, and the two differ by the cell's own content margins (16 pt on each
  /// side of an inset-grouped list). A row whose React side is laid out at the wider number
  /// draws its right-aligned content - a `Switch`, a chevron, a value - past the cell's edge,
  /// and UIKit stops hit-testing at that edge: S6b measured a hosted `Switch` in a row taking
  /// 0 of 10 real taps for exactly this reason, while content on the row's left worked.
  ///
  /// Two boxes come through here and only one of them is published: the plain row's box is the
  /// list-wide number, and the accessory row's teaches this class what an accessory costs —
  /// that row's own number travels by `NitroUiFormRow.contentBoxReported` instead. Publishing
  /// whichever cell laid out last is what made the list-wide number flip 338/316 and every
  /// Section and `RowRoot` re-render per flip (fix round 2, item 3).
  func rowBoxWidthReported(_ width: CGFloat, accessory: Bool) {
    boxReports += 1
    guard width > 0 else { return }
    // Whether anything a row could be waiting for just moved. A cell reports on every layout
    // of itself, so the walk in `pushRowBoxEstimates` has to be the exception rather than the
    // per-frame chore it would be without this.
    var moved = false
    if accessory {
      moved = abs(width - accessoryRowBoxWidth) > 0.25
      accessoryRowBoxWidth = width
      // A real box is a real box: the guess in `reportContentBox` is clamped by one, and a Form
      // whose visible cells all have accessories still has nothing better to remember.
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

  /// Publish the list-wide box. Every publish of it goes through here, so `widthPublishes`
  /// counts the whole story.
  private func publishRowBox(_ width: CGFloat) {
    reportedWidth = width
    widthPublishes += 1
    contentBox?(Double(width))
  }

  /// Forget every box this Form remembers, and every row's memory of the box it was told.
  ///
  /// The rows are included because each one guards its own report the same way this class
  /// guards the published number: a row parked off screen at 338 pt, asked to remember nothing,
  /// will take the 256 pt the list now gives it as a report rather than as a repeat of what it
  /// already had.
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

  /// Tell every row that cannot answer for itself what the list now gives a row of its kind.
  ///
  /// A row in a cell knows better than this class does — its own cell reports the box it is
  /// drawn in — so those are skipped unless they have never been told anything. Who this
  /// reaches is the rows parked in a section's holding view after a resize, and a row mounted
  /// before the list knew its own width; neither is ever laid out again by a layout pass that
  /// this class takes part in, and a row still holding a box from the *previous* orientation
  /// is measured at a width nothing on screen has (fix round 2, item 2). Each push is guarded
  /// per row on change, so the steady state is a comparison and no round trip.
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

  /// The geometry of the rows on screen, as two numbers a test can be graded on:
  /// `span` — the widest row box minus the narrowest — and `mismatch`, the worst gap anywhere on
  /// screen between a row's own box and the width its React content was laid out at.
  ///
  /// Asked of the Form rather than of a row handle, because a handle is only a handle: a row view
  /// another case unmounted goes on answering `where=holding` for itself, at a frame nothing is
  /// drawing, while the Form on screen has that row in a cell — which is how the first version of
  /// this witness failed a case that had nothing wrong with it. The Form knows which view it is
  /// drawing in which cell, so it can answer for *every* row on screen instead of for the two a
  /// case happens to hold references to.
  ///
  /// `mismatch` is the number that was wrong: the Form used to publish one width for the whole
  /// list, while a cell reserves its accessory's room by shrinking its own margins for the row it
  /// draws, so no single width can match two rows whose boxes differ — one of them is always
  /// `span` away from itself. Being laid out *wider* than the box is the dangerous direction
  /// (content is drawn past the row's bounds, where UIKit's hit-test does not look, which is what
  /// X29's press count was actually measuring); being narrower only moves content inward. The
  /// witness is the absolute difference, because "each row at its own box" is the claim worth
  /// making, and it is the one that cannot be satisfied by luck about which row reported last.
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
    // Minus the list's own bottom safe area, which UIKit adds back by itself: the inset is
    // asked for, the safe area is added to it, and the sum is what the content is padded by
    // (`adjustedContentInset.bottom`). The overlap above already covers that strip — the
    // keyboard's frame starts below it and the list's frame runs to the bottom of the window
    // through it — so asking for the whole overlap reserved the home indicator twice and left
    // 34 pt of empty list above the keys (adjusted 362 against an overlap of 328).
    setBottomInset(max(0, overlap - list.safeAreaInsets.bottom))
    guard let focused = list.findFirstResponder(),
      let row = HybridNitroUiForm.rowAncestor(of: focused) else { return }
    let rect = list.convert(row.frame, from: row.superview)
    // `list.bounds` *is* the visible box in content coordinates: its origin is the scroll
    // offset and its height is the viewport, and the bottom of what a person can see is one
    // adjusted inset above `bounds.maxY` - the safe area and the inset set just above, both
    // of which UIKit has already folded into `adjustedContentInset`.
    let visibleBottom = list.bounds.maxY - list.adjustedContentInset.bottom
    if rect.maxY > visibleBottom {
      scrollList(
        to: list.contentOffset.y + (rect.maxY - visibleBottom) + 8,
        animated: true
      )
    }
    // The inset changed the visible box and the scroll changed the offset, both of which the
    // shadow tree has to be told about — and the settle animation reports again when it ends.
    reportGeometry()
  }

  /// Move the list for the library itself: the keyboard path above, and the harness's
  /// `scroll-animated` command, which exists to measure exactly this shape.
  ///
  /// An animated `setContentOffset` sets none of `isDragging`, `isTracking` or
  /// `isDecelerating`, so its frames have to be guarded out by `scrollAnimating` rather than
  /// by the delegate's three states — and measured on iOS 27, it reports no settle this list
  /// answers either: the offset JavaScript was told stayed at the value from before a scroll
  /// that had already happened. So the end of the animation is this class's own business, and
  /// the completion is where the flag goes down and the geometry gets reported (fix round 2,
  /// item 3). `scrollToItem` and `scrollRectToVisible` do answer
  /// `scrollViewDidEndScrollingAnimation`; this path does not wait for that.
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

    // The fallback place for the reset a recycled list owes (the hop after a snapshot apply
    // is the first): a settle is the other moment the list is definitely on screen, laid out
    // and worth asking.
    takeTopResetIfNeeded()

    let offset = Double(list.contentOffset.y)
    // `reportedOffset` records what JavaScript was *told*, so it moves only on a publish that
    // had someone to tell: the first geometry pass of a list can run before the app's
    // `onContentOffset` has been applied, and recording the number then would leave the
    // shadow tree correcting by an offset from a tree that never heard it - every row of a
    // form at rest wrong by the list's own top inset (E7).
    if reportedOffset != offset, scrollOffsetReport != nil {
      reportedOffset = offset
      offsetPublishes += 1
      scrollOffsetReport?(offset)
    }

    let inset = rowInset()
    for (sectionIndex, model) in sections.enumerated() {
      guard let top = sectionTop(sectionIndex, in: model) else { continue }
      // The inset is a property of the section's box too, so it rides along even when the
      // top did not move; `applyPlacement` sends neither number if neither changed.
      model.hybrid?.applyPlacement(top: top, inset: inset)
    }

    // A list that came to rest with a cell that is not drawing its item stays that way:
    // nothing else asks for that cell. Every settle ends here, whether it was an apply or a
    // scroll, so this is where the misdrawn visible cell is chased (fix round 2, item 1).
    readoptMisdrawnCells()
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
    let boxes = boxWitness()
    // `inCells` counts *cells* that hold a row. This counts the rows: how many of this Form's
    // own rows are sitting in a cell right now, and how many distinct row views the cells are
    // showing. A cell holding a row that is not this Form's, and one of its rows held by two
    // cells, are both invisible to a cell count and both are the shape an identity mix-up takes
    // — a row whose pixels are elsewhere answers a press aimed at its own content with nothing.
    var drawn: Set<ObjectIdentifier> = []
    var claims = 0
    for case let cell as NitroUiFormRowCell in list.visibleCells {
      if let row = cell.row { drawn.insert(ObjectIdentifier(row)) }
      if cell.claimsRowItDoesNotHold { claims += 1 }
    }
    // The count that was missing: cells that hold a row that is not their item's. Every other
    // number about the cells asks whether they are *full*, and a cell full of the wrong row
    // answers that everything is fine while the row it should be drawing is in a hidden view.
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
      "rowsInCells=\(rowsInCells)",
      "distinctDrawn=\(drawn.count)",
      // The two numbers that say *why* a row can be missing from the cells while every cell
      // holds one: `claims` counts cells naming a row they are not drawing (a blank row no
      // chase can see), and `losses` counts the takes that made them, across this view's
      // life. A Form with `rowsInCells` short of `rows` and `claims` above 0 is a Form whose
      // rows are somewhere else and whose own answer about the cells is lying.
      "claims=\(claims)",
      "wrongCells=\(wrongCells)",
      "losses=\(rowLosses)",
      // How often a provider could not fill what UIKit asked for and handed back an empty cell
      // or band instead. It reads 0 now that both providers answer from the snapshot; a Form
      // with a visible blank row and this above 0 is a Form whose snapshot and models disagree
      // in some new way (fix round 2).
      "giveUps=\(giveUps)",
      // Where the list itself is: is it in a window, how tall is it, how much content does
      // it hold, how many items does it think are visible, and how many cells has it actually
      // realised. A Form that reports rows and no cells says which of its two jobs stopped
      // (fix round 1); the last two apart says whether a row on screen is a cell that was
      // never built or a cell built with nothing in it (fix round 2, item 1).
      "screen=\(list.window != nil ? 1 : 0),\(Self.number(list.bounds.height)),\(Self.number(list.contentSize.height)),\(list.indexPathsForVisibleItems.count),\(list.visibleCells.count)",
      "orphans=\(orphans)",
      "stale=\(stale)",
      "alive=\(knownRows.count)",
      "reparents=\(reparents)",
      "reclaims=\(reclaims)",
      "applies=\(snapshotApplies)",
      "width=\(Self.number(reportedWidth))",
      // The two numbers behind it: the plain box the published width is supposed to be, what
      // an accessory costs, and how many times anything was published at all — a list-wide
      // number that moves while the list only scrolls re-renders the Form's whole tree per
      // move, which is what `widthPublishes` makes visible (fix round 2, item 3).
      "plainBox=\(Self.number(plainRowBoxWidth))",
      "accessoryInset=\(Self.number(accessoryInset))",
      "widthPublishes=\(widthPublishes)",
      "listWidth=\(Self.number(list.bounds.width))",
      "boxW=\(Self.number(rowBoxWidth()))",
      "boxReports=\(boxReports)",
      // The two halves of "every row here is laid out at the box of its own cell": `boxMismatch`
      // is the worst gap between the two anywhere on screen, and `boxSpan` is how far apart those
      // boxes are — which is what makes the first number an assertion, since a Form whose rows
      // were all one wide could satisfy `boxMismatch` with a single shared width.
      "boxSpan=\(Self.number(boxes.span))",
      "boxMismatch=\(Self.number(boxes.mismatch))",
      "heights=\(heights)",
      "taps=\(taps)",
      "keyboard=\(Self.number(keyboardInset))",
      // The reservation this class asked UIKit for (`keyboard=`) and the two numbers the list
      // ends up *carrying*: its own `contentInset.bottom`, and the adjusted inset every
      // keyboard decision is measured against. They agree until someone else writes the
      // list's inset — a scroll that takes the reservation back does not come through
      // `setBottomInset`, so `keyboard=` alone cannot see it (fix round 1, question 5).
      "insetBottom=\(Self.number(list.contentInset.bottom))",
      "adjBottom=\(Self.number(list.adjustedContentInset.bottom))",
      // One publish per settle is the contract, so this is the number that says whether it is
      // kept: an animated scroll that reports every frame moves it by twenty (fix round 2).
      "offsetPublishes=\(offsetPublishes)",
      // Witness that this view is the one a previous Form finished with, which is the only way
      // the assertions about what a recycle leaves behind can be aimed at something.
      "recycles=\(recycles)",
      // Whether the list still watches a row's height constraint by itself. `0` means the
      // `rowResized` fallback is the only thing that can grow a row — which is what iOS 15 is
      // always in, and what the `self-sizing-off` command arranges on a modern system.
      "selfSizing=\(listSelfSizesRows ? 1 : 0)",
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
      case "scroll-animated":
        // The keyboard path's shape: a scroll UIKit animates with no finger on it. Every frame
        // of it is a `scrollViewDidScroll` with nothing beside it, so this is how the harness
        // counts publishes per programmatic scroll (fix round 2, item 3).
        scrollList(to: list.contentOffset.y + 60, animated: true)
      case "self-sizing-off":
        // Take away the property that tells UIKit a row's height constraint moved, and say so,
        // so the harness can watch the `rowResized` fallback carry a growing row. Below iOS 16
        // this is the permanent state of every Form; here it is a switch.
        if #available(iOS 16.0, *) {
          list.selfSizingInvalidation = .disabled
        }
        listSelfSizesRows = false
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
  /// The row an item names, or `nil` for an item that is not one.
  var rowView: UIView? {
    if case let .row(view) = self { return view }
    return nil
  }

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

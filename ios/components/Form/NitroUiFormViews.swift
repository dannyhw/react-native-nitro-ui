//
//  NitroUiFormViews.swift
//  react-native-nitro-ui
//
//  The four views of the S6 Form spike (Q10 Appendix C1, questions in Appendix E).
//
//  All four are about one trick: a React Native row is a Fabric view whose frame Fabric
//  writes, and it has to look right in two superviews - the section's holding view while it
//  is off screen, and a `UICollectionViewListCell` while it is on.
//
//  **The holding views** are where the content-children patch (`scripts/patch-nitrogen.mjs`)
//  puts a Form's sections and a Section's rows: the generated override inserts Fabric's
//  children into `self.contentView`, and a holding view *is* that content view. They are
//  hidden, so what they hold is laid out and measured but not drawn; a row that moves into a
//  cell leaves its holding view and draws from there. `didAddSubview` / `willRemoveSubview`
//  are the mount and unmount signals, which is why the patch needed no new shape.
//
//  **A row's frame** is `(0, 0, w, h)` *inside a cell*, which is where its pixels are, and
//  that is the origin cancellation Appendix C1 asked a container for - with no container. It
//  is not `(0, 0, w, h)` in the holding view: since S6b the row's absolute `top`/`left` carry
//  where the list put its cell, so that a `measure` of the row answers where the row actually
//  is (question 3), and `NitroUiFormRowContainer.layoutRow` is what takes the origin back off
//  when the row is adopted. A row at rest in its holding view has a position and draws nothing.
//

import UIKit

// MARK: - Holding views

/// A container for React Native views that are not being shown where Yoga put them.
class NitroUiFormHoldingView: UIView {
  /// The Hybrid View this is the content view of.
  weak var owner: AnyObject?
  /// A React Native child mounted (`mountChildComponentView:`), at Fabric's index.
  var onChildMount: ((UIView, Int) -> Void)?
  /// A React Native child unmounted (`unmountChildComponentView:`).
  var onChildUnmount: ((UIView) -> Void)?
  /// This view's own box changed, or it moved: the Form reads its width from here.
  var onLayoutChange: (() -> Void)?

  override init(frame: CGRect) {
    super.init(frame: frame)
    isHidden = true
    isUserInteractionEnabled = false
    clipsToBounds = false
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("not used")
  }

  /// Set while the Form moves a row into or out of a holding view itself.
  ///
  /// `didAddSubview` / `willRemoveSubview` are the mount and unmount signals, and a move
  /// the Form makes (handing a row back when its cell is reused, or pulling a dropped row
  /// out of a cell) is not a Fabric mount. Without this, the give-back reads as a remount,
  /// and the unmount path's own `removeFromSuperview` re-enters `willRemoveSubview`
  /// forever - a `Thread stack size exceeded` crash on the first scroll.
  static var isMovingRow = false

  /// Run `move` - a relocation this library owns - so the holding views along the way do not
  /// read it as a Fabric mount or unmount. Nest-safe: the outer context is restored.
  static func moving(_ move: () -> Void) {
    let wasMoving = isMovingRow
    isMovingRow = true
    defer { isMovingRow = wasMoving }
    move()
  }

  override func didAddSubview(_ subview: UIView) {
    super.didAddSubview(subview)
    guard !NitroUiFormHoldingView.isMovingRow else { return }
    onChildMount?(subview, mountIndex(for: subview))
  }

  /// Fabric's own index for `subview`, which is the only index that means "where React put it".
  ///
  /// The position among this view's *current* subviews is not that number, and the two diverge
  /// the moment a row is shown: a row on screen is in a list cell, not here, so by the time a
  /// fourth row mounts, a holding view holding two rows calls it child 0. The Form believed
  /// that - `model.rows.insert(at: 0)` - and a keyed insert in the middle of a section landed
  /// at the front of the list (fix round 1). `nil` means the child arrived some other way
  /// (`addSubview`), where this view's own order is all there is.
  private func mountIndex(for subview: UIView) -> Int {
    if let pending = pendingMountIndex { return pending }
    return subviews.firstIndex(of: subview) ?? subviews.count - 1
  }

  /// Fabric's index for the child being inserted, read by `mountIndex(for:)` while the
  /// insertion is still on the stack.
  private var pendingMountIndex: Int?

  /// The patch in `scripts/patch-nitrogen.mjs` mounts a child with
  /// `insertSubview(_:at:)`, and this is where Fabric's index survives the call: UIKit clamps
  /// the index to its own subview count *inside* its implementation, so a `didAddSubview`
  /// alone can only ever report a position in a list that is missing the rows a cell has
  /// taken. Overriding the setter side of the same call sees the number as React wrote it.
  override func insertSubview(_ view: UIView, at index: Int) {
    let outer = pendingMountIndex
    pendingMountIndex = index
    defer { pendingMountIndex = outer }
    let alreadyOurs = subviews.contains(where: { $0 === view })
    super.insertSubview(view, at: index)
    // A *move* of a child that was already here - the shape a Fabric reorder takes - is not
    // guaranteed to announce itself again, and this is the one place it cannot be missed.
    if alreadyOurs, !NitroUiFormHoldingView.isMovingRow { onChildMount?(view, index) }
  }

  override func willRemoveSubview(_ subview: UIView) {
    // Before `super`, so the index the callback sees is still the one Fabric used.
    defer { super.willRemoveSubview(subview) }
    guard !NitroUiFormHoldingView.isMovingRow else { return }
    onChildUnmount?(subview)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    onLayoutChange?()
  }

  override func didMoveToSuperview() {
    super.didMoveToSuperview()
    onLayoutChange?()
  }

  /// The safe area moved, which moves the list's *content* without moving its frame.
  ///
  /// The list is this view's sibling at the same frame, so it takes the same insets, and an
  /// automatic adjustment turns them into an `adjustedContentInset` that shifts
  /// `contentOffset.y` - the one number the shadow tree corrects every row by. Neither
  /// `layoutSubviews` (the box did not change) cannot see it either. UIKit's own callback for
  /// it, `scrollViewDidChangeAdjustedContentInset:`, has been on `UIScrollViewDelegate` since
  /// iOS 11 and the Form's delegate answers it (fix round 1; the earlier note here claimed it
  /// arrived in iOS 16.4, which is why a callback that existed went unimplemented) - this
  /// remains as well, because the safe area also moves when the *list* is nowhere near a
  /// settle, and both paths only ever report the same two numbers.
  override func safeAreaInsetsDidChange() {
    super.safeAreaInsetsDidChange()
    onLayoutChange?()
  }
}

/// A Section's content view: its rows' holding view, and the way back to its model.
///
/// The Form reaches a section through here, because what it is given is the Section's
/// *component* view - and this is the one subview of it that this library owns.
final class NitroUiFormSectionHoldingView: NitroUiFormHoldingView {
  weak var model: NitroUiFormSectionModel?
}

// MARK: - The row's content view

/// The Row Hybrid View's content view: a transparent box inside the row that keeps a
/// pointer to the Row, and notices when Fabric gives the row a new height.
///
/// `RCTViewComponentView` re-frames its `contentView` in its own `layoutSubviews`, so a
/// text reflow that changes the row's Yoga height arrives here as a `setFrame:` - which is
/// the one hook the spike needs and the reason the Row cannot be a plain `View`.
final class NitroUiFormRowHostView: UIView {
  weak var owner: HybridNitroUiFormRow?
  private var lastHeight: CGFloat = .nan

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .clear
    isUserInteractionEnabled = false
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("not used")
  }

  /// Fabric writes layout metrics into a row twice per update, and only one of the two is
  /// allowed to move pixels: `RCTViewComponentView.updateLayoutMetrics:` sets the component
  /// view's own frame from `layoutMetrics.frame` (origin included) and then, on the very
  /// next statement, sets this view's - the content view - from `getContentFrame()`, whose
  /// origin is the row's own border+padding (`RCTViewComponentView.mm`, read in 0.88).
  ///
  /// Since S6b that origin is *not* zero-based any more: the Form publishes where this row's
  /// cell came to rest into the row's absolute `top`/`left`, so that `measure` - which is a
  /// shadow-tree walk, never a UIKit question (`docs/components/form.md`) - describes
  /// where the row actually is. UIKit must not obey the same number: the cell owns where a
  /// row is drawn. So on every write, after the component view has had its frame written
  /// from the same metrics, the origin is taken back off it. Being asked from the content
  /// view's own setter is what makes this reliable - it is the statement immediately after
  /// the one that moves the component view, so there is no window in which the row is
  /// displaced and no layout pass has to be coaxed into happening.
  ///
  /// The size is untouched: it is the number the cell's height constraint mirrors.
  override var frame: CGRect {
    get { super.frame }
    set {
      super.frame = newValue
      pinComponentToCell()
    }
  }

  /// Put the row's component view back at the cell's content origin, and only there.
  ///
  /// The guard is the whole check: this is the row's component view, whose superview is the
  /// cell's container, and whose origin is not already zero. In a section's holding view the
  /// row is inside a hidden view and draws nothing wherever its frame says, so a stale origin
  /// there costs nothing and is left alone (`NitroUiFormHoldingView.init` hides it).
  ///
  /// A cell that has just adopted a row needs no help from here: `NitroUiFormRowContainer`
  /// zeroes the row's origin when it adopts and on every layout of its own.
  private func pinComponentToCell() {
    guard let component = owner?.componentView,
      component.superview is NitroUiFormRowContainer,
      component.frame.origin != .zero
    else { return }
    var pinned = component.frame
    pinned.origin = .zero
    component.frame = pinned
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let height = bounds.height
    guard height > 0, lastHeight.isNaN || abs(height - lastHeight) > 0.25 else { return }
    lastHeight = height
    owner?.contentHeightChanged(height)
  }
}

// MARK: - The cell

/// The cell: UIKit's inset-grouped chrome, with one React Native row inside.
///
/// The background, the separator, the highlight and the accessory are all UIKit's. The
/// `contentConfiguration` is `nil`, because the content is a view, not a configuration.
final class NitroUiFormRowCell: UICollectionViewListCell, UIGestureRecognizerDelegate {
  private let container = NitroUiFormRowContainer()
  private var height: NSLayoutConstraint!
  /// The width this cell gives its row - the box the row's React side has to be laid out
  /// at, and the number a `measure` of the row has to agree with.
  var rowBoxWidth: CGFloat { container.bounds.width }
  /// The row's press, delivered by ``pressGesture`` instead of by UIKit's cell selection.
  var onPressTap: (() -> Void)?
  /// Whether the finger is down on this row right now, which is what makes it look pressed.
  private var pressed = false
  /// The row this cell is showing.
  private(set) weak var row: UIView?
  /// Whether the row this cell names is the one it is drawing. A cell whose pointer went stale
  /// names a row it is not holding, which is a blank line on screen that no "does this cell hold
  /// a row?" question can find (X29).
  var isDrawingRow: Bool {
    guard let row else { return false }
    return container.isHolding(row)
  }
  /// Whether this cell names a row it is not holding at all.
  var claimsRowItDoesNotHold: Bool {
    row != nil && !isDrawingRow
  }
  /// What to do with a row this cell is finished with - back to its section.
  var onGiveBack: ((UIView) -> Void)?
  /// Someone else took this cell's row, so the cell is now drawing nothing. Forwarded from the
  /// container (see its `onRowLost`); the cell clears its own pointer first, and the Form uses
  /// this to chase the blank cell without waiting for a settle that a resting list never sends.
  ///
  /// `ownHandOver` says whether this cell asked for the trip itself (`giveBack`) or somebody
  /// else took the row: the Form counts only the foreign ones and chases both.
  var onRowLost: ((UIView, _ ownHandOver: Bool) -> Void)?
  /// A row Fabric unmounted while this cell was holding it. The generated
  /// `unmountChildComponentView:` detaches it from whichever view has it, so the container
  /// - not the section's holding view - is where that signal arrives.
  var onRowRemoved: ((UIView) -> Void)?
  /// The Form this cell belongs to. Set by the Form when it hands this cell a row — a
  /// `UICollectionViewCell` has no back-reference to its collection view, so guessing one
  /// from the superview chain would break the first time UIKit re-parents a cell.
  weak var formOwner: HybridNitroUiForm?
  /// Whether this row answers a tap: only then may the cell look pressed when it is.
  var isPressable = false
  /// The row's own `selected` prop, which is a different thing from UIKit's selection.
  var isSelectedRow = false

  /// A row's props changed: re-read the chrome the Row owns (accessory, selection).
  func refreshChrome() {
    guard let row else { return }
    (formOwner as HybridNitroUiForm?)?.refresh(cell: self, for: row)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    // Report the width this cell really gives the row, on every layout of the cell.
    // `NitroUiFormRowContainer.layoutSubviews` says the same thing, and for a cell that is
    // being configured for the first time it says it too early: the Form names itself as the
    // owner just after the row is adopted, and nothing lays the cell out again just because
    // that happened. S6b found the row still being laid out at the list's cell width (370 pt,
    // and 402 pt before the layout had any attributes at all) instead of the 338 pt it is
    // drawn in, which pushes right-aligned content out past the cell.
    if container.bounds.width > 0 {
      formOwner?.rowBoxWidthReported(
        container.bounds.width, accessory: container.drawsAccessoryRow
      )
    }
  }

  override init(frame: CGRect) {
    super.init(frame: frame)
    contentConfiguration = nil
    // The handler below writes the background itself, and UIKit raises an
    // `NSInternalInconsistencyException` for that while the automatic updates are on -
    // raised from inside `_createPreparedCellForItemAtIndexPath:`, which is a message
    // about configurations nobody reading the crash would guess.
    automaticallyUpdatesContentConfiguration = false
    automaticallyUpdatesBackgroundConfiguration = false
    contentView.addSubview(container)
    container.onRowLost = { [weak self] row in
      // The row was taken out of this container by someone else, so this cell must stop
      // naming it. `row` is weak and the pointer is what the Form reads to decide whether
      // this cell is blank, so a cell that keeps naming a row another cell adopted is a blank
      // row that no chase can find - which is how a row ends up drawing from its section's
      // hidden holding view (X29).
      //
      // The trip is labelled, not swallowed: `ownHandOver` says whether this cell asked for the
      // move. A cell handing the row over is not losing it, and counting the ordinary trip of
      // every cell leaving the screen made `losses` climb through a fling for something that is
      // not wrong (fix round 2, item 1). The signal itself still goes out, so the chase behind
      // it runs exactly as it did before: what had to change was what the Form *counts*, and
      // dropping the signal instead would have silently switched that repair off as well.
      if self?.row === row { self?.row = nil }
      self?.onRowLost?(row, self?.handingOverRow ?? false)
    }
    container.onRowRemoved = { [weak self] row in
      // Fabric took the row out of this cell, so this cell must stop saying it is showing
      // it. `row` is weak and a Fabric component view is pooled rather than freed, so a
      // stale pointer here outlives the row's removal - and `apply(_:)` skips adopting a row
      // it believes it already has, which is a cell that draws nothing (fix round 1).
      if self?.row === row { self?.row = nil }
      self?.onRowRemoved?(row)
    }
    NSLayoutConstraint.activate([
      container.leadingAnchor.constraint(equalTo: contentView.layoutMarginsGuide.leadingAnchor),
      container.trailingAnchor.constraint(equalTo: contentView.layoutMarginsGuide.trailingAnchor),
      // Vertically the margins guide is *not* right: it inset the row by 8 pt top and
      // bottom, which made every row 8 pt taller than the same row in the reference
      // (60 pt against SwiftUI's 52). Horizontally it is exactly right, so only these two
      // lines move, onto `rowChrome` - the cell's whole vertical chrome, named.
      container.topAnchor.constraint(equalTo: contentView.topAnchor, constant: Self.rowChrome),
      container.bottomAnchor.constraint(
        equalTo: contentView.bottomAnchor, constant: -Self.rowChrome
      ),
    ])
    height = container.heightAnchor.constraint(equalToConstant: 44)
    height.priority = .required - 1
    height.isActive = true
    configurationUpdateHandler = { [weak self] _, state in
      guard let self, var background = self.backgroundConfiguration else { return }
      let pressed = self.isPressable && (self.pressed || state.isHighlighted || state.isSelected)
      background.backgroundColor =
        pressed ? .quaternarySystemFill
        : (self.isSelectedRow ? .systemFill : .secondarySystemGroupedBackground)
      self.backgroundConfiguration = background
    }
    addGestureRecognizer(pressGesture)
  }

  /// UIKit's own selection recognises at touch-down, and React Native's touch handler
  /// will not share a touch with a recognizer it did not create: `RCTSurfaceTouchHandler`
  /// answers `NO` to `shouldRecognizeSimultaneouslyWithGestureRecognizer:`. With selection
  /// on, the list wins every touch inside a row and the React content in it never sees the
  /// release - S6 question 4 measured that as 0 of 10 taps on a `Pressable` in a row.
  ///
  /// So the list does not select at all (`allowsSelection = false` on the Form), and a
  /// row's press comes from this recognizer instead: it starts at touch-down (which is what
  /// makes the row look pressed), accepts simultaneous recognition, and never cancels
  /// touches in views - so the React content inside the row keeps the same touch.
  private lazy var pressGesture: UILongPressGestureRecognizer = {
    let gesture = UILongPressGestureRecognizer(
      target: self,
      action: #selector(pressChanged(_:))
    )
    gesture.minimumPressDuration = 0
    gesture.cancelsTouchesInView = false
    gesture.delaysTouchesBegan = false
    gesture.delaysTouchesEnded = false
    gesture.delegate = self
    return gesture
  }()

  /// The touch this recogniser is tracking, and how far its finger has gone.
  private var pressTravel = NitroUiPressTravel()

  @objc private func pressChanged(_ gesture: UILongPressGestureRecognizer) {
    switch gesture.state {
      case .began:
        pressTravel.began(at: gesture.location(in: self))
        pressed = true
      case .changed:
        // A scroll that began on this row: stand down, and take the highlight with the
        // press. The recogniser recognises alongside the list's pan precisely so the
        // React content in the row keeps the same touch, which means the list scrolling
        // is not a reason for this cell to stop tracking — travel is the only thing left
        // that says the finger was on its way somewhere else (`NitroUiPressTravel`).
        if pressTravel.moved(to: gesture.location(in: self), within: bounds) {
          pressed = false
        }
      case .ended:
        pressed = false
        // The whole difference between a row that presses and a row that fires whenever
        // someone scrolls past it: `.ended` is where a long press with no minimum says
        // "the finger lifted", and a flick lifts a finger too. G30 wrote this line for
        // ListItem's own row (`HybridNitroUiListItem.swift`'s `pressChanged`); the Form's
        // cell had the same recogniser without it, so a flick that began on a pressable
        // row scrolled the list *and* took the person to the screen behind the row.
        if pressTravel.ended() {
          onPressTap?()
        }
      default:
        // Cancelled or failed: a scroll that turned out to be a scroll, say.
        pressTravel.cancelled()
        pressed = false
    }
    setNeedsUpdateConfiguration()
  }

  // MARK: UIGestureRecognizerDelegate

  override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
    // A row that answers no tap should not track one at all.
    isPressable
  }

  func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer,
    shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
  ) -> Bool {
    // React Native's touch handler above the surface, and the list's own pan. Neither is
    // made worse by this row also being pressed.
    true
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("not used")
  }

  /// The cell's vertical chrome, one side. A row's box is its Yoga height plus
  /// `2 * rowChrome`, and question 2's go line is that box against the same row in a
  /// SwiftUI `Form` - 52 pt for this app's one-line rows, which is what 4 pt here buys.
  static let rowChrome: CGFloat = 4
  /// What the row itself measured last, for the geometry probe: the row box minus the
  /// chrome. `-1` until a row has been shown.
  private(set) var lastRowHeight: CGFloat = -1
  /// Show `rowView`, at the height its last Yoga layout gave it.
  func apply(_ rowView: UIView) {
    if row !== rowView {
      giveBack()
      row = rowView
    }
    // Ask the container every time, not only when the pointer changed. The cell's `row` is a
    // pointer; the container is what actually holds the view, and a row can be adopted
    // elsewhere while this cell still names it - after which `row !== rowView` is false, the
    // adopt is skipped, and the cell goes on being configured with nothing in it. `adopt`
    // early-outs when it already holds the row, so the steady state is one comparison.
    container.adopt(rowView)
    let measured = rowView.bounds.height > 0 ? rowView.bounds.height : rowView.frame.height
    if measured > 0, abs(height.constant - measured) > 0.25 {
      height.constant = measured
    }
    if measured > 0 {
      lastRowHeight = measured
    }
  }

  /// Hand the row to whoever owns it, and forget it.
  ///
  /// Only a row this cell is still *holding* may be handed back. A row can be taken by
  /// another cell without this cell being told - UIKit reuses a cell for a snapshot apply
  /// while the old cell is still pointing at the row - and then `onGiveBack` reparents a row
  /// that is being drawn elsewhere: the cell that took it keeps showing a row whose
  /// superview is a hidden holding view, which is a blank row on screen and no wrong count
  /// anywhere (fix round 1).
  /// Raised while this cell hands its row over, to label the `willRemoveSubview` that the
  /// hand-over itself causes.
  ///
  /// `onGiveBack` reparents the row, and the Form has no other way to tell that trip from
  /// somebody else taking the row out from under it. The label travels *with* the signal: the
  /// container keeps naming the row across the move, because `ownsRow` and `path(for:)` are
  /// asked mid-move by the code that is moving it, and the chase behind the signal keeps running
  /// on both kinds of trip (fix round 2, item 1).
  private var handingOverRow = false

  func giveBack() {
    guard let row else { return }
    self.row = nil
    guard row.superview === container else {
      // Not ours any more. Let go of the pointer, and leave the row where it is.
      container.releaseRow()
      return
    }
    // Give the row away *before* letting go of it: the taker `addSubview`s it, which moves
    // it in one step. Detaching first would leave a React Native view parentless for a
    // moment, and a row that loses its parent while Fabric still owns it trips the
    // "unmount a view which is mounted inside a different view" assertion.
    if onGiveBack != nil {
      // The container keeps naming the row across the hand-over - the taker is `addSubview`ing
      // the very view it names, and every reader of that pointer has to keep seeing this cell as
      // the row's home until the move is done. The flag only *labels* the `willRemoveSubview`
      // trip this move causes, so the Form can keep its chase and still not count a hand-over as
      // a lost row (fix round 2, item 1).
      handingOverRow = true
      defer { handingOverRow = false }
      onGiveBack?(row)
    } else {
      container.releaseRow()
    }
  }

  override func prepareForReuse() {
    // A row is never in two cells: whatever this one had goes back before anything else.
    super.prepareForReuse()
    pressed = false
    giveBack()
  }
}

/// The one subview of a cell's content view: takes a row, and gives it back.
///
/// Has a height constraint of its own (installed by the cell), which is what makes a
/// self-sizing cell as tall as a view Fabric lays out.
final class NitroUiFormRowContainer: UIView {
  private weak var row: UIView?
  /// This container lost a row by itself, i.e. React Native unmounted it out of the cell.
  var onRowRemoved: ((UIView) -> Void)?
  /// Someone else took this container's row: another cell adopted it, or a section's holding
  /// view took it back. It also fires for the trip a `giveBack` hand-over makes, which the cell
  /// labels as its own (`ownHandOver`) on the way to the Form: the Form chases every trip and
  /// counts only the foreign ones (fix round 2, item 1). The container still names the row while
  /// the taker moves it - the label is the whole difference, not the pointer.
  ///
  /// The distinction is the whole bug. A move out of a cell is wrapped in
  /// `NitroUiFormHoldingView.moving` so that no section reads it as an unmount, which also
  /// keeps it silent toward the cell: the cell goes on naming a row it is not drawing, and
  /// nothing below it looks blank. `HybridNitroUiForm.misdrawnVisibleItemIdentifiers` asks
  /// each cell whether it is holding the row its item names, and a cell holding a row it is
  /// entitled to no answer at all would leave the row that item owns in its section's hidden
  /// holding view while the list draws somebody else's (X29).
  var onRowLost: ((UIView) -> Void)?

  /// Whether `view` is the row this container is drawing right now.
  func isHolding(_ view: UIView) -> Bool {
    row === view && view.superview === self
  }

  /// Whether the row this container is drawing has a trailing accessory.
  ///
  /// The accessory is the only thing that makes one row's box narrower than the plain rows
  /// around it, so it is what the Form has to know about a box report: the list-wide number
  /// is the *plain* box, and an accessory row is told its own narrower one by this container
  /// (fix round 2, item 3). A container holding nothing reports the plain box, which is true.
  var drawsAccessoryRow: Bool {
    guard let row, let owner = HybridNitroUiForm.rowOwner(of: row) else { return false }
    return owner.accessoryValue != .none
  }

  override init(frame: CGRect) {
    super.init(frame: frame)
    translatesAutoresizingMaskIntoConstraints = false
    clipsToBounds = false
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("not used")
  }

  func adopt(_ rowView: UIView) {
    if row === rowView, rowView.superview === self { return }
    releaseRow()
    row = rowView
    // Frame-based: Fabric owns this view's frame, and `Form.tsx` made it (0, 0, w, h).
    rowView.translatesAutoresizingMaskIntoConstraints = true
    // `addSubview` moves the row out of its section's holding view, and that move is ours,
    // not Fabric's - unguarded it fires `willRemoveSubview`, and the section reports the row
    // as unmounted the moment its cell appears.
    NitroUiFormHoldingView.moving { addSubview(rowView) }
    layoutRow()
  }

  /// Detach the row. Idempotent: a row that already moved on is not this container's.
  func releaseRow() {
    guard let row else { return }
    self.row = nil
    if row.superview === self {
      NitroUiFormHoldingView.moving { row.removeFromSuperview() }
    }
  }

  override func willRemoveSubview(_ subview: UIView) {
    // Before `super`, so the row is still this container's when the callback looks at it.
    defer { super.willRemoveSubview(subview) }
    let wasOurs = row === subview
    if wasOurs { row = nil }
    // Taken by someone else, mid-move: the cell has to hear about it even though no section
    // may hear about it. See `onRowLost`.
    if wasOurs, NitroUiFormHoldingView.isMovingRow { onRowLost?(subview) }
    guard !NitroUiFormHoldingView.isMovingRow else { return }
    onRowRemoved?(subview)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    layoutRow()
  }

  /// The cell this container belongs to, so a row inside it can find its Form.
  func owningCell() -> NitroUiFormRowCell? {
    var candidate: UIView? = superview
    while let view = candidate {
      if let cell = view as? NitroUiFormRowCell { return cell }
      candidate = view.superview
    }
    return nil
  }

  /// The row takes this container's origin and keeps the size Fabric gave it. With
  /// `Form.tsx`'s absolute layout the origin is already zero, so this is the rule rather
  /// than a correction.
  private func layoutRow() {
    guard let row else { return }
    row.frame = CGRect(x: 0, y: 0, width: bounds.width, height: row.frame.height)
    if bounds.width <= 0 { return }
    // This row's content has to be laid out at the width it is *drawn* at, which is this
    // container's, not the list's idea of a cell — and it has to be told to *this row*,
    // because the box is per row: a cell drawing an accessory row shrinks its own margins for
    // it, and the Form's list-wide number is then wrong for one row whatever it says. Guarded
    // on change on both sides, so the per-layout call is a comparison rather than a round trip.
    let owner = HybridNitroUiForm.rowOwner(of: row)
    owner?.contentBoxReported(bounds.width)
    // The Form's own number: still the estimate a row gets before its first cell lays it out,
    // and the number the harness reads as `width=` - which is the *plain* box, published once
    // per list width. Offering this row's box as the list-wide number made the one number
    // every Section and RowRoot renders against follow whichever cell laid out last (338 and
    // 316 on the harness's screen), so a Form re-rendered its whole tree per flip of it
    // (fix round 2, item 3).
    owningCell()?.formOwner?.rowBoxWidthReported(
      bounds.width, accessory: drawsAccessoryRow
    )
  }
}

// MARK: - The cell for an item with nothing to draw

// MARK: - The header and footer

/// A section header or footer, drawn by UIKit's own grouped configuration.
final class NitroUiFormSupplementaryCell: UICollectionViewListCell {
  /// The text this band was last configured with.
  ///
  /// The harness reads it back (through the Form, which is what can find this view by its
  /// section) as `drawnTitle=` / `drawnFooter=`: the model can hold a title the screen has
  /// never been shown, and only this view knows what is painted.
  private(set) var drawnText: String?

  func configure(text: String?, footer: Bool) {
    drawnText = text
    var configuration = footer
      ? UIListContentConfiguration.groupedFooter()
      : UIListContentConfiguration.groupedHeader()
    configuration.text = text ?? ""
    contentConfiguration = configuration
    isHidden = (text ?? "").isEmpty
    // A heading, in the one sense a screen reader has for it. UIKit draws these, so UIKit has
    // to say what they are: React Native never sees a header, and an app cannot set a trait on
    // a view it does not have.
    isAccessibilityElement = !(text ?? "").isEmpty
    accessibilityLabel = text
    accessibilityTraits = footer ? [] : .header
  }
}

/// The label for a view that VoiceOver is going to announce as one element: the text of what
/// it contains, in reading order.
///
/// A pressable `Form.Row` is one button (C1), and a button with no label is worse than no
/// button — so the label is gathered from the row's own React Native content rather than
/// invented. `UIAccessibilityElementsNotification`-style traversal is what UIKit does for a
/// leaf element anyway; doing it here is only about *before* it becomes one.
func nitroUiAggregatedLabel(in view: UIView) -> String? {
  var parts: [String] = []
  nitroUiAppendLabels(from: view, into: &parts)
  guard !parts.isEmpty else { return nil }
  return parts.joined(separator: ", ")
}

/// One level of {@link nitroUiAggregatedLabel}: a function rather than a local closure,
/// because a closure that recurses cannot be the `let` it is binding.
private func nitroUiAppendLabels(from view: UIView, into parts: inout [String]) {
  if let label = view.accessibilityLabel, !label.isEmpty {
    parts.append(label)
    return
  }
  if let text = (view as? UILabel)?.text, !text.isEmpty {
    parts.append(text)
    return
  }
  for subview in view.subviews { nitroUiAppendLabels(from: subview, into: &parts) }
}

// MARK: - The list's delegate

/// `UICollectionView`'s delegate for a Form.
///
/// A Nitro Hybrid View is not an `NSObject`, so the `@objc` protocol it needs cannot live on
/// the Hybrid itself — the same reason `NitroUiTooltipPopoverDelegate` exists. The list does
/// not select (`allowsSelection = false`), so the only message it sends is the one that says
/// a cell has stopped being shown; the row's press comes from the cell's own recognizer.
final class NitroUiFormListDelegate: NSObject, UICollectionViewDelegate {
  private weak var form: HybridNitroUiForm?

  init(form: HybridNitroUiForm) {
    self.form = form
    super.init()
  }

  func collectionView(
    _ collectionView: UICollectionView,
    didEndDisplaying cell: UICollectionViewCell,
    forItemAt indexPath: IndexPath
  ) {
    form?.listDidEndDisplaying(cell)
  }

  // MARK: Settling: where the list came to rest

  /// The list scrolled. This is the only delegate method UIKit sends for a scroll, and the
  /// only one that catches a list coming to rest without an ending to announce it: a
  /// `setContentOffset(animated: false)`, a programmatic jump, or an inset that moved the
  /// content all arrive as scroll frames with no drag and no deceleration around them. The
  /// guard is therefore the whole method - the Form reports when the list is *at rest*,
  /// because JS cannot be told about each frame of a flick and `measure` is a question about
  /// where something stopped.
  ///
  /// The method that used to be here, `scrollViewDidLayout(_:)`, is not part of
  /// `UIScrollViewDelegate`: a scroll view does not forward its own `layoutSubviews` to its
  /// delegate, so nothing ever called it, and every settle that was not one of the three
  /// endings below relied on the single hop `applySnapshotNow` queues (fix round 1, E7).
  ///
  /// `reportGeometry` sends at most one number per settle and nothing at all when the offset
  /// did not move, so being reached twice from here and from the endings below costs a
  /// comparison, not a re-render.
  func scrollViewDidScroll(_ scrollView: UIScrollView) {
    // Three states say a finger is on the list. A fourth shape exists that none of them cover:
    // a scroll UIKit *animates* for a caller - the keyboard path's `setContentOffset(animated:)`
    // and a status-bar scroll to the top - which arrives as a dozen scroll frames with no
    // drag, no tracking and no deceleration around them, and used to publish every one of them
    // to JavaScript (fix round 2, item 3). The Form names that window instead.
    guard !scrollView.isDragging, !scrollView.isTracking, !scrollView.isDecelerating,
      form?.scrollAnimating != true
    else { return }
    form?.reportGeometry()
  }

  /// The list is about to scroll to the top on its own - a status-bar tap. UIKit animates it
  /// and sets none of the three finger states, so its frames have to be guarded out from here
  /// and the settle reported from `scrollViewDidScrollToTop` below.
  func scrollViewShouldScrollToTop(_ scrollView: UIScrollView) -> Bool {
    form?.scrollAnimating = true
    return true
  }

  /// The list was scrolled to the top - a real tap on the status bar, or a caller that asked
  /// UIKit for it. The frames of that scroll are guarded out above while it animates, and
  /// UIKit sends no drag ending for it, so this is where the new offset is reported.
  func scrollViewDidScrollToTop(_ scrollView: UIScrollView) {
    form?.scrollAnimating = false
    form?.reportGeometry()
  }

  /// The list's *visible box* changed without its frame moving.
  ///
  /// An adjusted content inset - the safe area arriving or going, a keyboard inset, an
  /// `additionalSafeAreaInsets` write - shifts `contentOffset` under the content, and no
  /// other settle callback fires for it: the drag endings do not, because nobody dragged, and
  /// a scroll frame may not even arrive. On iOS 11 and later this is UIKit's own callback for
  /// exactly that shift, which is why the holding view's `safeAreaInsetsDidChange` is a
  /// second path rather than the only one.
  func scrollViewDidChangeAdjustedContentInset(_ scrollView: UIScrollView) {
    form?.reportGeometry()
  }

  /// A drag ended without decelerating: UIKit does not have to lay anything out for the list
  /// to be at rest, so this ending cannot be left to `scrollViewDidLayout`.
  func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
    // A finger took over, so whatever animation was in flight ends with it.
    form?.scrollAnimating = false
    if !decelerate { form?.reportGeometry() }
  }

  /// A `setContentOffset(animated: true)` finished - the keyboard path's scroll, and the
  /// harness's own.
  func scrollViewDidEndScrollingAnimation(_ scrollView: UIScrollView) {
    form?.scrollAnimating = false
    form?.reportGeometry()
  }

  func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
    form?.scrollAnimating = false
    form?.reportGeometry()
  }
}

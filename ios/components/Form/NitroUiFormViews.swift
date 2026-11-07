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
//  **A row's frame** is `(0, 0, w, h)` in both places, because `Form.tsx` lays every row out
//  `position: 'absolute'` at `top: 0, left: 0` with the width the Form reported. That is the
//  whole origin cancellation Appendix C1 asked a container for - with no container.
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
    onChildMount?(subview, subviews.firstIndex(of: subview) ?? subviews.count - 1)
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

  /// Fabric writes Yoga's frame into this view (an `RCTViewComponentView` sets its content
  /// view's frame in `updateLayoutMetrics`), and on iOS Yoga's origin now carries where this
  /// row's *cell* came to rest - the shadow-tree half of S6b question 4's `measure` fix.
  /// Where the view sits is UIKit's decision, not Yoga's: the cell owns that. So the origin
  /// is dropped on the way in, and the row's component view - whose frame Fabric wrote from
  /// the same metrics one statement earlier, before the write ever reached this view - is put
  /// back where the cell put it. The size is untouched, which is the number the cell reads.
  ///
  /// This is why a row may carry a Yoga origin it does not obey: nothing else reads that
  /// origin, because `measure` is computed from the shadow tree and hit-testing from this
  /// view's real position.
  override func setFrame(_ frame: CGRect) {
    let own = frame.origin == .zero
      ? frame
      : CGRect(x: 0, y: 0, width: frame.width, height: frame.height)
    super.setFrame(own)
    guard frame.origin != .zero,
      let component = owner?.componentView,
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
  /// The row's press, delivered by ``pressGesture`` instead of by UIKit's cell selection.
  var onPressTap: (() -> Void)?
  /// Whether the finger is down on this row right now, which is what makes it look pressed.
  private var pressed = false
  /// The row this cell is showing.
  private(set) weak var row: UIView?
  /// What to do with a row this cell is finished with - back to its section.
  var onGiveBack: ((UIView) -> Void)?
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
    container.onRowRemoved = { [weak self] row in self?.onRowRemoved?(row) }
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

  @objc private func pressChanged(_ gesture: UILongPressGestureRecognizer) {
    switch gesture.state {
      case .began:
        pressed = true
      case .ended:
        pressed = false
        onPressTap?()
      default:
        // Cancelled or failed: a scroll that turned out to be a scroll, say.
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
      container.adopt(rowView)
    }
    let measured = rowView.bounds.height > 0 ? rowView.bounds.height : rowView.frame.height
    if measured > 0, abs(height.constant - measured) > 0.25 {
      height.constant = measured
    }
    if measured > 0 {
      lastRowHeight = measured
    }
  }

  /// Hand the row to whoever owns it, and forget it.
  func giveBack() {
    guard let row else { return }
    self.row = nil
    // Give the row away *before* letting go of it: the taker `addSubview`s it, which moves
    // it in one step. Detaching first would leave a React Native view parentless for a
    // moment, and a row that loses its parent while Fabric still owns it trips the
    // "unmount a view which is mounted inside a different view" assertion.
    if onGiveBack != nil {
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
    if row === subview { row = nil }
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
  }
}

// MARK: - The header and footer

/// A section header or footer, drawn by UIKit's own grouped configuration.
final class NitroUiFormSupplementaryCell: UICollectionViewListCell {
  func configure(text: String?, footer: Bool) {
    var configuration = footer
      ? UIListContentConfiguration.groupedFooter()
      : UIListContentConfiguration.groupedHeader()
    configuration.text = text ?? ""
    contentConfiguration = configuration
    isHidden = (text ?? "").isEmpty
  }
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

  // MARK: Settling: where the rows came to rest (`onFrameMoved`)

  /// The list laid out. Every scroll frame calls this, so the guard is the point: the
  /// Form publishes row positions when the list is *at rest*, because JS cannot be told
  /// about each frame of a flick and an anchor is shown to a list that stopped moving.
  func scrollViewDidLayout(_ scrollView: UIScrollView) {
    guard !scrollView.isDragging, !scrollView.isTracking, !scrollView.isDecelerating else {
      return
    }
    form?.publishRowFrames()
  }

  /// A flick ended. `scrollViewDidLayout` already covers this (UIKit lays out after the
  /// deceleration), and being told twice costs a comparison per row - so only the two
  /// endings that can leave the list resting without a later layout are here.
  func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
    if !decelerate { form?.publishRowFrames() }
  }

  func scrollViewDidEndScrollingAnimation(_ scrollView: UIScrollView) {
    form?.publishRowFrames()
  }
}

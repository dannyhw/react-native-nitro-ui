//
//  NitroUiFormViews.swift
//  react-native-nitro-ui
//
//  The UIKit views a Form is built from. A row is a Fabric view that sits in its section's
//  hidden holding view while off screen and in a `UICollectionViewListCell` while on screen.
//

import UIKit

// MARK: - Holding views

/// A hidden container for React Native children: they are laid out and measured here but
/// not drawn. `didAddSubview` and `willRemoveSubview` are the mount and unmount signals.
class NitroUiFormHoldingView: UIView {
  weak var owner: AnyObject?
  /// A React Native child mounted, at Fabric's index.
  var onChildMount: ((UIView, Int) -> Void)?
  var onChildUnmount: ((UIView) -> Void)?
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

  /// Set while the Form itself moves a row between a holding view and a cell, so the
  /// subview callbacks do not read the move as a Fabric mount or unmount.
  static var isMovingRow = false

  /// Runs `move` with `isMovingRow` set. Nest-safe: the outer value is restored.
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

  /// Fabric's index for `subview`. The position among this view's current subviews is not
  /// that number: rows on screen are in list cells, not here.
  private func mountIndex(for subview: UIView) -> Int {
    if let pending = pendingMountIndex { return pending }
    return subviews.firstIndex(of: subview) ?? subviews.count - 1
  }

  /// Fabric's index for the child being inserted, while the insertion is on the stack.
  private var pendingMountIndex: Int?

  /// Captures Fabric's index before UIKit clamps it to this view's own subview count.
  override func insertSubview(_ view: UIView, at index: Int) {
    let outer = pendingMountIndex
    pendingMountIndex = index
    defer { pendingMountIndex = outer }
    let alreadyOurs = subviews.contains(where: { $0 === view })
    super.insertSubview(view, at: index)
    // A Fabric reorder moves a child that is already here, and UIKit does not call
    // `didAddSubview` again for it.
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

  /// A safe-area change shifts the sibling list's `contentOffset` without changing this
  /// view's box, so `layoutSubviews` does not see it.
  override func safeAreaInsetsDidChange() {
    super.safeAreaInsetsDidChange()
    onLayoutChange?()
  }
}

/// A Section's content view: its rows' holding view, and the way back to its model.
final class NitroUiFormSectionHoldingView: NitroUiFormHoldingView {
  weak var model: NitroUiFormSectionModel?
}

// MARK: - The row's content view

/// The Row's content view: a transparent box that notices when Fabric gives the row a new
/// height. `RCTViewComponentView` re-frames its content view on every layout update.
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

  /// The row's shadow-tree position says where its cell came to rest, so that `measure`
  /// answers correctly, but the cell owns where the row is drawn. Fabric sets the
  /// component view's frame and then this view's in the same update, so this setter is
  /// where the component's origin is taken back off before anything draws.
  override var frame: CGRect {
    get { super.frame }
    set {
      super.frame = newValue
      pinComponentToCell()
    }
  }

  /// Puts the row's component view back at the cell's content origin. Only while it is in
  /// a cell: in a hidden holding view its origin does not matter.
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

/// The cell: UIKit's inset-grouped chrome (background, separator, highlight, accessory)
/// with one React Native row inside.
final class NitroUiFormRowCell: UICollectionViewListCell, UIGestureRecognizerDelegate {
  private let container = NitroUiFormRowContainer()
  private var height: NSLayoutConstraint!
  /// The width this cell gives its row.
  var rowBoxWidth: CGFloat { container.bounds.width }
  /// The row's press, delivered by ``pressGesture`` instead of by UIKit's cell selection.
  var onPressTap: (() -> Void)?
  private var pressed = false
  private(set) weak var row: UIView?
  /// Whether the row this cell names is the one it is drawing. Another cell can adopt the
  /// row while this one still names it.
  var isDrawingRow: Bool {
    guard let row else { return false }
    return container.isHolding(row)
  }
  var claimsRowItDoesNotHold: Bool {
    row != nil && !isDrawingRow
  }
  /// Returns a row this cell is finished with to its section.
  var onGiveBack: ((UIView) -> Void)?
  /// The row left this cell without being unmounted. `ownHandOver` is true when this cell
  /// asked for the move itself (`giveBack`) and false when something else took the row.
  var onRowLost: ((UIView, _ ownHandOver: Bool) -> Void)?
  /// Fabric unmounted the row while this cell was holding it.
  var onRowRemoved: ((UIView) -> Void)?
  /// Set by the Form when it hands this cell a row: a `UICollectionViewCell` has no
  /// back-reference to its collection view.
  weak var formOwner: HybridNitroUiForm?
  var isPressable = false
  /// The row's own `selected` prop, which is a different thing from UIKit's selection.
  var isSelectedRow = false

  func refreshChrome() {
    guard let row else { return }
    (formOwner as HybridNitroUiForm?)?.refresh(cell: self, for: row)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    // The container reports the same width from its own layout, but on a cell's first
    // configuration that runs before `formOwner` is set.
    if container.bounds.width > 0 {
      formOwner?.rowBoxWidthReported(
        container.bounds.width, accessory: container.drawsAccessoryRow
      )
    }
  }

  override init(frame: CGRect) {
    super.init(frame: frame)
    contentConfiguration = nil
    // The update handler below writes the background itself, and UIKit raises an
    // `NSInternalInconsistencyException` for that while automatic updates are on.
    automaticallyUpdatesContentConfiguration = false
    automaticallyUpdatesBackgroundConfiguration = false
    contentView.addSubview(container)
    container.onRowLost = { [weak self] row in
      if self?.row === row { self?.row = nil }
      self?.onRowLost?(row, self?.handingOverRow ?? false)
    }
    container.onRowRemoved = { [weak self] row in
      // Fabric pools component views rather than freeing them, so the weak `row` would
      // otherwise keep naming a row this cell no longer holds.
      if self?.row === row { self?.row = nil }
      self?.onRowRemoved?(row)
    }
    NSLayoutConstraint.activate([
      container.leadingAnchor.constraint(equalTo: contentView.layoutMarginsGuide.leadingAnchor),
      container.trailingAnchor.constraint(equalTo: contentView.layoutMarginsGuide.trailingAnchor),
      // Not the margins guide vertically: its 8 pt insets make a row taller than the same
      // row in a SwiftUI `Form`.
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

  /// The row's press. The list does not select: UIKit's selection recognises at touch-down
  /// and React Native's touch handler will not share a touch with it, so React content in
  /// a row would never see the release. This recognizer recognises simultaneously and
  /// never cancels touches in views.
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

  private var pressTravel = NitroUiPressTravel()

  @objc private func pressChanged(_ gesture: UILongPressGestureRecognizer) {
    switch gesture.state {
      case .began:
        pressTravel.began(at: gesture.location(in: self))
        pressed = true
      case .changed:
        // The recognizer keeps tracking while the list scrolls, so finger travel is the
        // only sign that this touch is a scroll and not a press.
        if pressTravel.moved(to: gesture.location(in: self), within: bounds) {
          pressed = false
        }
      case .ended:
        pressed = false
        // A flick lifts the finger too: only a touch that did not travel is a press.
        if pressTravel.ended() {
          onPressTap?()
        }
      default:
        pressTravel.cancelled()
        pressed = false
    }
    setNeedsUpdateConfiguration()
  }

  // MARK: UIGestureRecognizerDelegate

  override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
    isPressable
  }

  func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer,
    shouldReceive touch: UITouch
  ) -> Bool {
    // UIKit asks this of the cell for the recognizers it owns as a cell, too. Declining one of
    // those would take the cell's own behaviour, so only this row's press is the row's to give.
    guard gestureRecognizer === pressGesture else { return true }
    // A touch that lands on a hosted control inside the row is that control's, and the row
    // leaves it: the recognizer is never given the touch, so nothing is cancelled for the
    // control either.
    return isPressable && !hostedControlCovers(touch.location(in: container))
  }

  /// Whether a hosted control's box holds this point of the container.
  private func hostedControlCovers(_ point: CGPoint) -> Bool {
    holdsHostedControl(container, at: point)
  }

  /// Whether `view` holds a hosted control whose box covers `point`, given in the coordinates
  /// of `view`.
  ///
  /// Geometric rather than `hitTest`: a React Native subtree reports no touch owner until the
  /// release, so a hosted view's box is the only sign available while the touch is still down.
  /// Every branch whose box holds the point is asked, not only the topmost: a control can sit
  /// behind plain content the row draws over it.
  private func holdsHostedControl(_ view: UIView, at point: CGPoint) -> Bool {
    if let control = view as? NitroUiHostedControl {
      // An item that hands its press to the cell is the row's own content, box included.
      return !control.pressOwnedByRow
    }
    for subview in view.subviews {
      guard !subview.isHidden, subview.alpha > 0.01, !subview.frame.isEmpty else { continue }
      guard subview.frame.contains(point) else { continue }
      if holdsHostedControl(subview, at: subview.convert(point, from: view)) { return true }
    }
    return false
  }

  func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer,
    shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
  ) -> Bool {
    true
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("not used")
  }

  /// The cell's vertical padding, one side: a row's box is its Yoga height plus twice this.
  static let rowChrome: CGFloat = 4
  /// The height the row last measured, or `-1` until a row has been shown.
  private(set) var lastRowHeight: CGFloat = -1
  /// Shows `rowView` at the height its last Yoga layout gave it.
  func apply(_ rowView: UIView) {
    if row !== rowView {
      giveBack()
      row = rowView
    }
    // Every time, not only when the pointer changed: another cell can adopt the row while
    // this one still names it.
    container.adopt(rowView)
    let measured = rowView.bounds.height > 0 ? rowView.bounds.height : rowView.frame.height
    if measured > 0, abs(height.constant - measured) > 0.25 {
      height.constant = measured
    }
    if measured > 0 {
      lastRowHeight = measured
    }
  }

  /// Set while this cell hands its row over, so the removal that causes is reported as
  /// the cell's own.
  private var handingOverRow = false

  /// Hands the row back to its section and forgets it. Only a row this cell is still
  /// holding is handed back: another cell may already have adopted it.
  func giveBack() {
    guard let row else { return }
    self.row = nil
    guard row.superview === container else {
      container.releaseRow()
      return
    }
    // The taker `addSubview`s the row, which moves it in one step. Detaching it first
    // would leave a view Fabric still owns without a parent, which trips an RN assertion.
    if onGiveBack != nil {
      handingOverRow = true
      defer { handingOverRow = false }
      onGiveBack?(row)
    } else {
      container.releaseRow()
    }
  }

  override func prepareForReuse() {
    super.prepareForReuse()
    pressed = false
    // A finger still down on the row this cell held must not end as a press on the next one.
    pressTravel.reset()
    giveBack()
  }
}

/// The one subview of a cell's content view: takes a row, and gives it back. The cell
/// gives it a height constraint, which makes a self-sizing cell as tall as its row.
final class NitroUiFormRowContainer: UIView {
  private weak var row: UIView?
  /// React Native unmounted the row out of this container.
  var onRowRemoved: ((UIView) -> Void)?
  /// The library moved the row out: another cell adopted it, or it went back to its
  /// section's holding view.
  var onRowLost: ((UIView) -> Void)?

  func isHolding(_ view: UIView) -> Bool {
    row === view && view.superview === self
  }

  /// Whether the row being drawn has a trailing accessory, which makes its box narrower
  /// than a plain row's.
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
    // Frame-based: Fabric owns this view's frame.
    rowView.translatesAutoresizingMaskIntoConstraints = true
    NitroUiFormHoldingView.moving { addSubview(rowView) }
    layoutRow()
  }

  /// Detaches the row, unless it has already moved to another superview.
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
    if wasOurs, NitroUiFormHoldingView.isMovingRow { onRowLost?(subview) }
    guard !NitroUiFormHoldingView.isMovingRow else { return }
    onRowRemoved?(subview)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    layoutRow()
  }

  func owningCell() -> NitroUiFormRowCell? {
    var candidate: UIView? = superview
    while let view = candidate {
      if let cell = view as? NitroUiFormRowCell { return cell }
      candidate = view.superview
    }
    return nil
  }

  /// The row takes this container's origin and width, and keeps the height Fabric gave it.
  private func layoutRow() {
    guard let row else { return }
    row.frame = CGRect(x: 0, y: 0, width: bounds.width, height: row.frame.height)
    if bounds.width <= 0 { return }
    // The row's content is laid out at the width it is drawn at, which is per row: a cell
    // with an accessory gives its row a narrower box.
    let owner = HybridNitroUiForm.rowOwner(of: row)
    owner?.contentBoxReported(bounds.width)
    // The Form's list-wide width is the plain box, so the report says whether this row
    // has an accessory.
    owningCell()?.formOwner?.rowBoxWidthReported(
      bounds.width, accessory: drawsAccessoryRow
    )
  }
}

// MARK: - The cell for an item with nothing to draw

// MARK: - The header and footer

/// A section header or footer, drawn by UIKit's own grouped configuration.
final class NitroUiFormSupplementaryCell: UICollectionViewListCell {
  /// The text this view was last configured with, for the test state report.
  private(set) var drawnText: String?

  func configure(text: String?, footer: Bool) {
    drawnText = text
    var configuration = footer
      ? UIListContentConfiguration.groupedFooter()
      : UIListContentConfiguration.groupedHeader()
    configuration.text = text ?? ""
    contentConfiguration = configuration
    isHidden = (text ?? "").isEmpty
    // UIKit draws the header, so the heading trait has to be set here: React Native never
    // sees this view.
    isAccessibilityElement = !(text ?? "").isEmpty
    accessibilityLabel = text
    accessibilityTraits = footer ? [] : .header
  }
}

/// The label for a view that VoiceOver announces as one element: the text of what it
/// contains, in reading order.
func nitroUiAggregatedLabel(in view: UIView) -> String? {
  var parts: [String] = []
  nitroUiAppendLabels(from: view, into: &parts)
  guard !parts.isEmpty else { return nil }
  return parts.joined(separator: ", ")
}

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

/// `UICollectionView`'s delegate for a Form. A separate class because a Nitro Hybrid View
/// is not an `NSObject` and cannot adopt an `@objc` protocol.
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

  /// Reports geometry only when the list is at rest. This catches the moves no ending
  /// callback announces: a non-animated `setContentOffset` or an inset change.
  func scrollViewDidScroll(_ scrollView: UIScrollView) {
    // A scroll UIKit animates for a caller sets none of the three finger states, so the
    // Form tracks that window itself in `scrollAnimating`.
    guard !scrollView.isDragging, !scrollView.isTracking, !scrollView.isDecelerating,
      form?.scrollAnimating != true
    else { return }
    form?.reportGeometry()
  }

  /// A status-bar tap: UIKit animates the scroll and sets none of the three finger states.
  func scrollViewShouldScrollToTop(_ scrollView: UIScrollView) -> Bool {
    form?.scrollAnimating = true
    return true
  }

  func scrollViewDidScrollToTop(_ scrollView: UIScrollView) {
    form?.scrollAnimating = false
    form?.reportGeometry()
  }

  /// An inset change (safe area, keyboard) shifts `contentOffset` without a drag, and a
  /// scroll frame may not arrive for it.
  func scrollViewDidChangeAdjustedContentInset(_ scrollView: UIScrollView) {
    form?.reportGeometry()
  }

  func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
    // A finger took over, so whatever animation was in flight ends with it.
    form?.scrollAnimating = false
    if !decelerate { form?.reportGeometry() }
  }

  func scrollViewDidEndScrollingAnimation(_ scrollView: UIScrollView) {
    form?.scrollAnimating = false
    form?.reportGeometry()
  }

  func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
    form?.scrollAnimating = false
    form?.reportGeometry()
  }
}

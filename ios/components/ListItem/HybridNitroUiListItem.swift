// The ListItem component: UIKit's row content, a `UIListContentView`, hosted through SwiftUI
// (`UIViewRepresentable`) so the shared host does the sizing, recycling and environment work.

import NitroModules
import SwiftUI
import UIKit

/// Anything unrecognised is `none`.
enum ListItemAccessory: String {
  case none
  case disclosure
}

final class ListItemModel: NitroUiModel {
  var title: String?
  var subtitle: String?
  var value: String?
  /// The SF Symbol name, or `nil` for none. An unknown name draws nothing.
  var systemImage: String?
  /// The Android glyph name. Stored so the getter answers; never drawn on iOS.
  var androidIcon: String?
  var accessory: ListItemAccessory = .none
  /// Whether `onPress` is wired: the row's highlight and its button role.
  var pressable = false
  /// Whether a `Form.Row` is drawing this item. Its cell already provides the insets, the
  /// shape and the highlight, so the item draws edge-to-edge with no background of its own.
  var insideRow = false

  /// Inside a row the item installs no recogniser and hands its `onPress` up to the cell, so the
  /// row reads this view as the content it laid out rather than as a control that took the tap.
  override var pressOwnedByRow: Bool { insideRow }

  var disabled = false
  var testID: String?
  var accessibilityLabel: String?
  /// `''`, `'s'`, `'i'` or `'s|i'`. The sizing engine reads the key from Fabric state itself.
  var sizingKey = ""
  var onPress: (() -> Void)?

  /// Test-only read-outs behind one lock, never published: the row writes them during
  /// layout, and publishing there would request another update.
  private let reportLock = NSLock()
  private var drawn = "none"
  private var presses = 0
  private var probes = 0
  private var accessibilityReport = "none"
  /// The colours the row last gave each slot, recorded where each is configured.
  private var colours = "pending"
  /// Whether the row's own highlight painted a background during the last press.
  private var highlightPainted = false
  /// The live row, so a test-only read can ask the drawn view. Set once by the row's `init`.
  weak var row: NitroUiListRowView?
  /// Where the row's layout put its content, in points. Written by the row's
  /// `layoutSubviews`.
  private var laidOut = false
  private var layoutLeading: CGFloat = 0
  private var layoutTrailing: CGFloat = 0
  private var layoutWidth: CGFloat = 0
  private var layoutHeight: CGFloat = 0

  /// One press, through the path a tap takes. Refused while disabled, as a tap is; only an
  /// accepted press is counted.
  func press() {
    guard !disabled, pressable else { return }
    reportLock.lock()
    presses += 1
    reportLock.unlock()
    onPress?()
  }

  /// `<title>|<subtitle>|<value>|<accessory>`, as the row was handed them.
  func recordDrawn(_ report: String) {
    reportLock.lock()
    drawn = report
    reportLock.unlock()
  }

  func recordAccessibility(_ report: String) {
    reportLock.lock()
    probes += 1
    accessibilityReport = report
    reportLock.unlock()
  }

  func recordColours(_ report: String) {
    reportLock.lock()
    colours = report
    reportLock.unlock()
  }

  func recordHighlightPainted(_ painted: Bool) {
    reportLock.lock()
    highlightPainted = painted
    reportLock.unlock()
  }

  func recordLayout(
    leading: CGFloat,
    trailing: CGFloat,
    width: CGFloat,
    height: CGFloat
  ) {
    reportLock.lock()
    laidOut = true
    layoutLeading = leading
    layoutTrailing = trailing
    layoutWidth = width
    layoutHeight = height
    reportLock.unlock()
  }

  /// `displayed=<…>;presses=<n>;probes=<n>;a11y=<…>;iconTint=-;colours=<…>`. Safe from any
  /// thread. `iconTint` is Android's field; iOS always answers `-`.
  func stateReport() -> String {
    reportLock.lock()
    defer { reportLock.unlock() }
    return "displayed=\(drawn);presses=\(presses);probes=\(probes);" +
      "a11y=\(accessibilityReport);iconTint=-;colours=\(colours)"
  }

  /// `insets=<l>,<t>;shape=<0|1>;box=<w>x<h>`, or `pending` before the first layout. Safe
  /// from any thread.
  func layoutReport() -> String {
    reportLock.lock()
    defer { reportLock.unlock() }
    guard laidOut else { return "pending" }
    return String(
      format: "insets=%.2f,%.2f;shape=%d;box=%.2fx%.2f",
      layoutLeading,
      layoutTrailing,
      highlightPainted ? 1 : 0,
      layoutWidth,
      layoutHeight
    )
  }

  /// For recycling, so a reused row does not report the previous item's content.
  func clearReports() {
    reportLock.lock()
    drawn = "none"
    presses = 0
    probes = 0
    accessibilityReport = "none"
    colours = "pending"
    highlightPainted = false
    laidOut = false
    reportLock.unlock()
  }
}

// MARK: - The row

/// The row: a `UIListContentView` filling the view, plus a value label and a chevron of our
/// own. Row content rather than a cell, because a bare `UICollectionViewListCell` does not
/// self-size outside a collection view.
///
/// The value is not `.valueCell()`'s: that stacks the value under a long title, which makes
/// the height depend on the text. The chevron is ours because a cell's accessory lives in
/// the cell. Created once per instance; later commits only re-apply the configuration.
final class NitroUiListRowView: UIView {
  private let model: ListItemModel
  private let content: UIListContentView
  private let valueLabel = UILabel()
  private let chevron = UIImageView()
  /// The chevron's holder: an accessibility container with no elements, which hides the
  /// glyph from screen readers.
  private let chevronHost = UIView()
  /// A long press with no minimum duration: it recognises at touch-down, so the row looks
  /// pressed, and fires on release. UIKit's default minimum of half a second would miss
  /// every quick tap. React Native's touch handler will not share a touch with a recogniser
  /// it did not create, so this one recognises simultaneously rather than taking the touch.
  private lazy var pressGesture = UILongPressGestureRecognizer(target: self, action: #selector(pressChanged(_:)))
  private var pressed = false
  /// `own` (this row paints its own highlight), `cell` (inside a `Form.Row`, whose cell owns
  /// the highlight) or `none`.
  private(set) var pressPath = "pending"
  /// Ties the value label to the title label's baseline. Rebuilt if UIKit hands us a
  /// different label.
  private var baselineConstraint: NSLayoutConstraint?
  /// The value label's trailing constraint, whose constant moves with the chevron.
  private var valueTrailing: NSLayoutConstraint?
  private var valueWidth: NSLayoutConstraint?
  /// Kept so the width limit can be computed in `layoutSubviews`, where the row has a width.
  private var valueText: String?
  private var chevronVisible = false

  /// The same pressed colour as a Form row.
  static let pressedColor: UIColor = .quaternarySystemFill

  init(model: ListItemModel) {
    self.model = model
    self.content = UIListContentView(configuration: ListItemModel.configuration(title: nil, subtitle: nil, image: nil, insideRow: false, disabled: false))
    super.init(frame: .zero)
    model.row = self
    backgroundColor = .clear
    // The row content is pinned to these edges, so layout margins here would inset it twice.
    directionalLayoutMargins = NSDirectionalEdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0)
    // `UIListContentView` places its labels inside its layout margins, which include the
    // safe area by default: a row whose frame crosses the window's top inset would have its
    // labels pushed down and measure taller by that inset.
    insetsLayoutMarginsFromSafeArea = false
    content.insetsLayoutMarginsFromSafeArea = false
    addSubview(content)
    content.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      content.topAnchor.constraint(equalTo: topAnchor),
      content.bottomAnchor.constraint(equalTo: bottomAnchor),
      content.leadingAnchor.constraint(equalTo: leadingAnchor),
      content.trailingAnchor.constraint(equalTo: trailingAnchor),
    ])

    valueLabel.numberOfLines = 1
    valueLabel.lineBreakMode = .byTruncatingTail
    valueLabel.isHidden = true
    valueLabel.translatesAutoresizingMaskIntoConstraints = false
    // The title truncates and the value stays whole.
    valueLabel.setContentCompressionResistancePriority(.required, for: .horizontal)
    valueLabel.setContentHuggingPriority(.required, for: .horizontal)
    addSubview(valueLabel)
    valueTrailing = valueLabel.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -ListItemModel.listInset)
    valueWidth = valueLabel.widthAnchor.constraint(lessThanOrEqualToConstant: 0)
    NSLayoutConstraint.activate([
      valueTrailing!,
      valueWidth!,
      valueLabel.topAnchor.constraint(greaterThanOrEqualTo: topAnchor),
      valueLabel.bottomAnchor.constraint(lessThanOrEqualTo: bottomAnchor),
    ])

    let symbol = UIImage.SymbolConfiguration(textStyle: .body, scale: .small)
    chevron.image = UIImage(systemName: "chevron.right", withConfiguration: symbol)
    chevron.tintColor = .tertiaryLabel
    chevron.contentMode = .center
    chevron.isHidden = true
    chevron.translatesAutoresizingMaskIntoConstraints = false
    // The chevron is decoration, but `isAccessibilityElement = false` and
    // `accessibilityElementsHidden = true` on the image view both leave an element named
    // "Forward" (the symbol's own label) in the tree. A container with an empty
    // `accessibilityElements` removes it.
    chevronHost.translatesAutoresizingMaskIntoConstraints = false
    chevronHost.isAccessibilityElement = false
    chevronHost.accessibilityElements = []
    chevronHost.addSubview(chevron)
    addSubview(chevronHost)
    NSLayoutConstraint.activate([
      chevronHost.centerYAnchor.constraint(equalTo: centerYAnchor),
      chevronHost.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -ListItemModel.chevronInset),
      chevronHost.widthAnchor.constraint(equalToConstant: ListItemModel.chevronWidth),
      chevron.leadingAnchor.constraint(equalTo: chevronHost.leadingAnchor),
      chevron.trailingAnchor.constraint(equalTo: chevronHost.trailingAnchor),
      chevron.centerYAnchor.constraint(equalTo: chevronHost.centerYAnchor),
    ])

    pressGesture.delegate = self
    pressGesture.minimumPressDuration = 0
    pressGesture.cancelsTouchesInView = false
    pressGesture.delaysTouchesBegan = false
    pressGesture.delaysTouchesEnded = false
    addGestureRecognizer(pressGesture)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("nitro-ui: NitroUiListRowView cannot be built from a nib")
  }

  /// The row's height at `width`. A synchronous Auto Layout pass, so only SwiftUI's
  /// `sizeThatFits` calls it.
  func rowSizeThatFits(_ width: CGFloat) -> CGSize {
    let fitted = content.systemLayoutSizeFitting(
      CGSize(width: max(width, 1), height: UIView.layoutFittingCompressedSize.height),
      withHorizontalFittingPriority: .required,
      verticalFittingPriority: .fittingSizeLevel
    )
    return CGSize(width: max(width, 1), height: ceil(fitted.height))
  }

  /// Re-apply everything the model says, without touching the views' identity.
  func nuiApply() {
    // Inside a `Form.Row` the cell is the touch target and paints the press; a recogniser
    // here would answer the same touch a second time.
    pressPath = !model.pressable || model.disabled
      ? "none"
      : (model.insideRow ? "cell" : "own")
    let image = model.systemImage.flatMap { UIImage(systemName: $0) }
    let configuration = ListItemModel.configuration(
      title: model.title,
      subtitle: model.subtitle,
      image: image,
      insideRow: model.insideRow,
      disabled: model.disabled
    )
    // UIKit truncates the title at the configuration's trailing margin. Reserving the value
    // label's and the chevron's width there makes the title truncate before them, and it
    // cannot move the height.
    var margins = configuration.directionalLayoutMargins
    let reservation = ListItemModel.trailingReservation(
      value: model.value,
      accessory: model.accessory,
      font: ListItemModel.valueFont
    )
    margins.trailing = ListItemModel.listInset(model.insideRow) + reservation
    var configured = configuration
    configured.directionalLayoutMargins = margins
    content.configuration = configured

    valueLabel.isHidden = model.value == nil
    if let value = model.value {
      valueLabel.text = value
      valueLabel.font = ListItemModel.valueFont
      valueLabel.textColor = ListItemModel.valueColor(disabled: model.disabled)
      // The width limit needs the row's width, which is 0 on the first apply, so it is set
      // in `layoutSubviews`.
      valueText = value
      valueTrailing?.constant = -(ListItemModel.listInset(model.insideRow)
        + ListItemModel.chevronSpace(model.accessory))
    }

    chevronVisible = model.accessory == .disclosure
    chevron.isHidden = !chevronVisible
    chevron.tintColor = model.disabled ? ListItemModel.disabledColor : ListItemModel.chevronColor

    pressGesture.isEnabled = model.pressable && !model.disabled && !model.insideRow
    if !pressGesture.isEnabled { setPressed(false) }

    // Both text colours are nil when never set, and the cell's defaults (`.label` and
    // `.secondaryLabel`) paint; those are reported so an enabled row has a value to compare
    // with a disabled one. An unset image tint is reported as `unset`.
    func painted(
      _ color: UIColor?,
      _ fallback: UIColor
    ) -> String {
      Self.hex((color ?? fallback).resolvedColor(with: traitCollection))
    }
    let paintedImageTint = configured.imageProperties.tintColor.map { tint in
      Self.hex(tint.resolvedColor(with: traitCollection))
    } ?? "unset"
    model.recordColours(
      "text=\(painted(configured.textProperties.color, .label))"
        + ",secondary=\(painted(configured.secondaryTextProperties.color, .secondaryLabel))"
        + ",image=\(paintedImageTint)"
        + ",chevron=\(painted(chevron.tintColor, .tertiaryLabel))"
        + ",value=\(valueLabel.isHidden ? "none" : painted(valueLabel.textColor, .label))"
    )

    applyAccessibility()
    model.recordDrawn(
      "\(model.title ?? "-")|\(model.subtitle ?? "-")|\(model.value ?? "-")|\(model.accessory.rawValue)"
    )
    setNeedsLayout()
  }

  /// One element for the row, as a UIKit cell is. The label reads title, subtitle, value,
  /// unless the caller's `accessibilityLabel` replaces it.
  private func applyAccessibility() {
    isAccessibilityElement = true
    if let label = model.accessibilityLabel {
      accessibilityLabel = label
    } else {
      accessibilityLabel = [model.title, model.subtitle, model.value]
        .compactMap { $0 }
        .joined(separator: ", ")
    }
    // Inside a `Form.Row` the cell publishes its own button element, and a second button
    // nested in it would be an extra stop.
    var traits: UIAccessibilityTraits = model.pressable && !model.insideRow
      ? .button
      : .staticText
    if model.disabled { traits.insert(.notEnabled) }
    accessibilityTraits = traits
    // The row being an element hides the content's labels from UIKit's walk.
    content.isAccessibilityElement = false
    // The chevron is a sibling of the content, and an image view holding an SF Symbol is an
    // element in its own right ("Forward"), so it is hidden separately.
    chevron.isAccessibilityElement = false
    chevron.accessibilityElementsHidden = true
    // Re-asserted on every apply: the holder's empty list is what removes the chevron.
    chevronHost.accessibilityElements = []
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    applyValueWidth()
    rideValueLabelOnTitleBaseline()
    if let geometry = Self.layoutGeometry(self) {
      model.recordLayout(
        leading: geometry.leading,
        trailing: geometry.trailing,
        width: geometry.width,
        height: geometry.height
      )
    }
  }

  /// Set in `layoutSubviews`, not `nuiApply`: the first apply runs before the view has a
  /// width, and a limit computed at width 0 would truncate the value to nothing.
  private func applyValueWidth() {
    guard let value = valueText, bounds.width > 0 else { return }
    let width = ListItemModel.valueMaxWidth(
      width: bounds.width,
      value: value,
      accessory: model.accessory,
      insideRow: model.insideRow,
      font: ListItemModel.valueFont
    )
    if valueWidth?.constant != width {
      valueWidth?.constant = width
    }
  }

  /// Puts the value label on the title's baseline rather than the row's centre: with a
  /// subtitle, a centred value would sit between the two lines. Until a title label exists
  /// the value is centred.
  private func rideValueLabelOnTitleBaseline() {
    guard !valueLabel.isHidden else { return }
    let title = Self.titleLabel(in: content)
    if let existing = baselineConstraint {
      if let title, (existing.firstAnchor as? NSLayoutYAxisAnchor) === title.firstBaselineAnchor {
        return
      }
      existing.isActive = false
      baselineConstraint = nil
    }
    guard let title else {
      baselineConstraint = valueLabel.centerYAnchor.constraint(equalTo: centerYAnchor)
      baselineConstraint?.isActive = true
      return
    }
    baselineConstraint = title.firstBaselineAnchor.constraint(equalTo: valueLabel.firstBaselineAnchor)
    baselineConstraint?.isActive = true
  }

  /// The label UIKit drew highest in the row. The labels' class names are private, so the
  /// walk looks for any `UILabel`.
  static func titleLabel(in view: UIView) -> UILabel? {
    var found: UILabel?
    for subview in view.subviews {
      if let label = subview as? UILabel, label.frame.height > 1, label.frame.height < 500,
        label.frame.width > 1 {
        if found == nil || label.frame.minY < found!.frame.minY {
          found = label
        }
      }
      if let nested = titleLabel(in: subview), found == nil || nested.frame.minY < found!.frame.minY {
        found = nested
      }
    }
    return found
  }

  /// Leading inset, trailing inset and box, in points, read from the drawn frames rather
  /// than from the configuration, so an ignored `insideRow` shows. The trailing inset is the
  /// gap after the furthest thing drawn on that edge. `nil` until there is a title label.
  private static func layoutGeometry(
    _ row: NitroUiListRowView
  ) -> (leading: CGFloat, trailing: CGFloat, width: CGFloat, height: CGFloat)? {
    guard let title = titleLabel(in: row.content) else { return nil }
    let frame = title.convert(title.bounds, to: row)
    var drawnTo = frame.maxX
    if !row.valueLabel.isHidden {
      drawnTo = max(drawnTo, row.valueLabel.frame.maxX)
    }
    if row.chevronVisible {
      drawnTo = max(drawnTo, row.chevronHost.frame.maxX)
    }
    return (
      leading: frame.minX,
      trailing: row.bounds.width - drawnTo,
      width: row.bounds.width,
      height: row.bounds.height
    )
  }

  /// One resolved colour as `#rrggbbaa`, for the `colours=` report.
  static func hex(_ color: UIColor) -> String {
    var red: CGFloat = 0
    var green: CGFloat = 0
    var blue: CGFloat = 0
    var alpha: CGFloat = 0
    guard color.getRed(&red, green: &green, blue: &blue, alpha: &alpha) else {
      return "other"
    }
    func byte(_ value: CGFloat) -> String {
      String(format: "%02x", Int((max(0, min(1, value)) * 255).rounded()))
    }
    return "#" + byte(red) + byte(green) + byte(blue) + byte(alpha)
  }
  /// The recogniser starts at touch-down and recognises alongside the scroll view, so travel
  /// is the only thing that tells a tap from a scroll that began on the row.
  private var pressTravel = NitroUiPressTravel()

  @objc private func pressChanged(_ gesture: UILongPressGestureRecognizer) {
    switch gesture.state {
      case .began:
        pressTravel.began(at: gesture.location(in: self))
        model.recordHighlightPainted(setPressed(true))
      case .changed:
        // A scroll that began on the row: drop the highlight, and the release will not press.
        if pressTravel.moved(to: gesture.location(in: self), within: bounds) {
          setPressed(false)
          model.recordHighlightPainted(false)
        }
      case .ended:
        setPressed(false)
        // A scroll lifts the finger too, so only a press that did not travel counts.
        if pressTravel.ended() {
          model.press()
        } else {
          model.recordHighlightPainted(false)
        }
      default:
        // Cancelled or failed.
        pressTravel.cancelled()
        setPressed(false)
        model.recordHighlightPainted(false)
    }
  }

  /// Paints or clears the row's own highlight. Never paints inside a `Form.Row`, whose cell
  /// draws its own. Returns whether the row is now painted pressed.
  @discardableResult
  private func setPressed(_ pressed: Bool) -> Bool {
    let wantsPressed = pressed && model.pressable && !model.disabled && !model.insideRow
    guard wantsPressed != self.pressed else { return self.pressed }
    self.pressed = wantsPressed
    backgroundColor = wantsPressed ? Self.pressedColor : .clear
    return wantsPressed
  }

  /// A test press: highlight, release, then the callback, in the order the recogniser uses.
  func simulatePressForTesting() {
    model.recordHighlightPainted(setPressed(true))
    setPressed(false)
    model.press()
  }

  /// Resets the drawn row for reuse. A model reset reaches the row only through a re-apply,
  /// which may not happen before the instance is reused.
  func prepareForReuseForTesting() {
    pressed = false
    backgroundColor = .clear
    pressTravel.reset()
    pressGesture.isEnabled = false
  }
}

extension NitroUiListRowView: UIGestureRecognizerDelegate {
  func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer,
    shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
  ) -> Bool {
    // Alongside React Native's touch handler and any enclosing scroll view.
    true
  }

  override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
    // Inside a `Form.Row` the cell owns the touch and the highlight.
    model.pressable && !model.disabled && !model.insideRow
  }
}

// MARK: - Configuration

extension ListItemModel {
  /// UIKit's horizontal inset for a list cell's content.
  static let listInset: CGFloat = 16
  /// The inset inside a `Form.Row`, whose cell has already paid for its own.
  static func listInset(_ insideRow: Bool) -> CGFloat {
    insideRow ? 0 : listInset
  }
  /// The chevron's box and its inset from the trailing edge, as UIKit's own disclosure
  /// accessory has them.
  static let chevronWidth: CGFloat = 14
  static let chevronInset: CGFloat = 8
  /// The gap kept between the value and whatever trails it.
  static let valueGap: CGFloat = 8

  /// The width the title may not use, because this file draws something there.
  static func trailingReservation(value: String?, accessory: ListItemAccessory, font: UIFont) -> CGFloat {
    var reserved = chevronSpace(accessory)
    if let value {
      reserved += valueWidth(value, font: font) + valueGap
    }
    return reserved
  }

  /// The width the chevron takes, including its inset.
  static func chevronSpace(_ accessory: ListItemAccessory) -> CGFloat {
    accessory == .disclosure ? chevronWidth + chevronInset : 0
  }

  /// How wide the value's text is, untruncated.
  static func valueWidth(_ value: String, font: UIFont) -> CGFloat {
    ceil(value.size(withAttributes: [.font: font]).width)
  }

  /// The most width the value may take: the row's own content width, minus the two list
  /// insets, the title's minimum and the chevron. The title truncates first, so this
  /// only ever bites on a narrow row with a long value.
  static func valueMaxWidth(
    width: CGFloat,
    value: String,
    accessory: ListItemAccessory,
    insideRow: Bool,
    font: UIFont
  ) -> CGFloat {
    let wanted = valueWidth(value, font: font)
    let available = width - listInset(insideRow) * 2 - chevronSpace(accessory) - valueGap - listTitleMinimum
    guard width > 0 else { return wanted }
    return max(0, min(wanted, available))
  }

  /// How much of the row the title keeps, so a long value cannot squeeze it to nothing.
  static let listTitleMinimum: CGFloat = 44

  /// Read from a `.valueCell()` configuration rather than hardcoded, so it follows Dynamic
  /// Type.
  static var valueFont: UIFont {
    UIListContentConfiguration.valueCell().secondaryTextProperties.font
  }

  /// The colour a disabled row draws everything in: text, supporting text, the leading glyph
  /// and the chevron.
  static let disabledColor: UIColor = .tertiaryLabel
  static let chevronColor: UIColor = .tertiaryLabel

  static func valueColor(disabled: Bool) -> UIColor {
    var properties = UIListContentConfiguration.valueCell().secondaryTextProperties
    if disabled {
      properties.color = disabledColor
    }
    return properties.resolvedColor()
  }

  /// `.subtitleCell()` when there is a supporting line, `.cell()` when there is not.
  static func configuration(
    title: String?,
    subtitle: String?,
    image: UIImage?,
    insideRow: Bool,
    disabled: Bool
  ) -> UIListContentConfiguration {
    var configuration: UIListContentConfiguration = subtitle == nil ? .cell() : .subtitleCell()
    configuration.text = title
    configuration.secondaryText = subtitle
    configuration.image = image
    // One line per slot, so the height depends on which slots are filled and not on the
    // text: one cached size per configuration is then correct.
    configuration.textProperties.numberOfLines = 1
    configuration.textProperties.lineBreakMode = .byTruncatingTail
    configuration.secondaryTextProperties.numberOfLines = 1
    configuration.secondaryTextProperties.lineBreakMode = .byTruncatingTail
    if disabled {
      // A `UIListContentConfiguration` does not grey itself; a cell does that, and this is
      // not a cell.
      configuration.textProperties.color = disabledColor
      configuration.secondaryTextProperties.color = disabledColor
      if image != nil {
        configuration.imageProperties.tintColor = disabledColor
      }
    }
    var margins = configuration.directionalLayoutMargins
    margins.leading = listInset(insideRow)
    configuration.directionalLayoutMargins = margins
    return configuration
  }
}

// MARK: - SwiftUI

private struct ListItemRow: UIViewRepresentable {
  @ObservedObject var model: ListItemModel

  func makeUIView(context: Context) -> NitroUiListRowView {
    let row = NitroUiListRowView(model: model)
    // The row takes the box's width and offers no opinion of its own on it.
    row.setContentHuggingPriority(.defaultLow, for: .horizontal)
    row.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    row.nuiApply()
    return row
  }

  func updateUIView(_ uiView: NitroUiListRowView, context: Context) {
    uiView.nuiApply()
  }

  /// The proposed width, and the row's height at it.
  @available(iOS 16.0, *)
  func sizeThatFits(_ proposal: ProposedViewSize, uiView: NitroUiListRowView, context: Context) -> CGSize? {
    let width = proposal.width ?? uiView.bounds.width
    guard width > 0 else { return nil }
    return uiView.rowSizeThatFits(width)
  }
}

struct ListItemContent: NitroUIContent {
  @ObservedObject private var model: ListItemModel

  init(model: ListItemModel) {
    self.model = model
  }

  var body: some View {
    ListItemRow(model: model)
  }
}

// MARK: - Hybrid View

final class HybridNitroUiListItem: HybridNitroUiListItemSpec, RecyclableView {
  private let host: NitroSwiftUIHost<ListItemContent>

  /// Must match the component name in the generated C++ and Kotlin.
  private static let sizingComponentName = "NitroUiListItem"

  /// In points. The height of a title-only row at the default text size; the width only
  /// applies under a parent that gives the row none.
  private static let fallbackSize = (width: 300.0, height: 52.0)

  private static let declaresFallback: Bool = {
    NitroUiSizing.setFallback(sizingComponentName, fallbackSize.width, fallbackSize.height, NitroUiSizingPolicy.fillWidth.rawValue)
    return true
  }()

  /// Registers the fallback once per process: at startup, with `init` as the backstop.
  static func declareFallback() {
    _ = Self.declaresFallback
  }

  override init() {
    host = NitroSwiftUIHost(model: ListItemModel())
    super.init()
    host.wantsContentSize = true
    host.sizingPolicy = .fillWidth
    // A row presents nothing, so it needs no view-controller containment.
    host.needsContainment = false
    Self.declareFallback()
  }

  var view: NitroSwiftUIHost<ListItemContent> {
    return host
  }

  private var model: ListItemModel { host.model }

  // MARK: - Props
  // Setters only store and mark dirty; everything is applied in one `nuiApply` per
  // commit. A slot that can move the height also tells the host to measure again.

  var title: Variant_NullType_String {
    get { model.title.map { .second($0) } ?? .first(.null) }
    set {
      let next = newValue.asType(String.self)
      guard next != model.title else { return }
      model.title = next
      markContent()
    }
  }

  var subtitle: Variant_NullType_String {
    get { model.subtitle.map { .second($0) } ?? .first(.null) }
    set {
      let next = newValue.asType(String.self)
      guard next != model.subtitle else { return }
      model.subtitle = next
      // A subtitle changes the row's height.
      markContent()
    }
  }

  var value: Variant_NullType_String {
    get { model.value.map { .second($0) } ?? .first(.null) }
    set {
      let next = newValue.asType(String.self)
      guard next != model.value else { return }
      model.value = next
      markContent()
    }
  }

  var systemImage: Variant_NullType_String {
    get { model.systemImage.map { .second($0) } ?? .first(.null) }
    set {
      let next = newValue.asType(String.self)
      guard next != model.systemImage else { return }
      model.systemImage = next
      markContent()
    }
  }

  var androidIcon: Variant_NullType_String {
    get { model.androidIcon.map { .second($0) } ?? .first(.null) }
    set { model.androidIcon = newValue.asType(String.self) }
  }

  var accessory: String {
    get { model.accessory.rawValue }
    set {
      let next = ListItemAccessory(rawValue: newValue) ?? .none
      guard next != model.accessory else { return }
      model.accessory = next
      markContent()
    }
  }

  var pressable: Bool {
    get { model.pressable }
    set {
      guard newValue != model.pressable else { return }
      model.pressable = newValue
      // The recogniser's `isEnabled` and the button role both read it.
      host.markDirty()
    }
  }

  var insideRow: Bool {
    get { model.insideRow }
    set {
      guard newValue != model.insideRow else { return }
      model.insideRow = newValue
      // The insets live in the row's configuration, so it has to be re-applied.
      markContent()
    }
  }

  var disabled: Bool {
    get { model.disabled }
    set {
      guard newValue != model.disabled else { return }
      model.disabled = newValue
      markContent()
    }
  }

  var testID: Variant_NullType_String {
    get { model.testID.map { .second($0) } ?? .first(.null) }
    set {
      // Nothing to apply: React Native already puts `testID` on the component view as
      // `accessibilityIdentifier`.
      model.testID = newValue.asType(String.self)
    }
  }

  var accessibilityLabel: Variant_NullType_String {
    get { model.accessibilityLabel.map { .second($0) } ?? .first(.null) }
    set {
      let next = newValue.asType(String.self)
      guard next != model.accessibilityLabel else { return }
      model.accessibilityLabel = next
      host.markDirty()
    }
  }

  var nuiPerfId: Variant_NullType_Double {
    get {
      guard host.perfInstanceId >= 0 else { return .first(.null) }
      return .second(Double(host.perfInstanceId))
    }
    set { host.perfInstanceId = newValue.asType(Double.self).map { Int32($0) } ?? nitroUiPerfNoInstance }
  }

  var nuiSizingKey: String {
    get { model.sizingKey }
    set {
      guard newValue != model.sizingKey else { return }
      model.sizingKey = newValue
      // A new key may measure exactly what the old one did, and the host would drop that
      // report as a duplicate.
      host.noteSizingKeyChanged()
    }
  }

  var nuiSizingId: Double {
    get { Double(host.sizingInstanceId) }
    set { host.sizingInstanceId = Int64(newValue) }
  }

  var onPress: (() -> Void)? {
    get { model.onPress }
    set { model.onPress = newValue }
  }

  /// A change that may move the height: redraw, and ask the host to measure again.
  private func markContent() {
    host.markDirty()
    host.noteContentSizeMayHaveChanged()
  }

  // MARK: - Lifecycle

  func afterUpdate() {
    host.commit()
  }

  func prepareForRecycle() {
    // The drawn row first: a pressed background or an armed recogniser outlives a model
    // reset until something re-applies.
    model.row?.prepareForReuseForTesting()
    model.title = nil
    model.subtitle = nil
    model.value = nil
    model.systemImage = nil
    model.androidIcon = nil
    model.accessory = .none
    model.pressable = false
    model.insideRow = false
    model.disabled = false
    model.testID = nil
    model.accessibilityLabel = nil
    model.sizingKey = ""
    model.clearReports()
    host.prepareForRecycle()
  }

  func onDropView() {
    model.onPress = nil
    host.drop()
  }

  // MARK: - Methods

  /// Reads the host's cache: this can be called from JS, and SwiftUI may only be measured
  /// on main.
  func measureContent() throws -> NitroUiSize {
    guard let size = host.contentSize else {
      return NitroUiSize(width: 0, height: 0)
    }
    return NitroUiSize(width: Double(size.width), height: Double(size.height))
  }

  /// Presses on main, without waiting. The drawn row runs it when there is one, so a test
  /// press paints the highlight as a finger does.
  func nuiTestPress() throws {
    let model = host.model
    if Thread.isMainThread {
      Self.pressForTesting(model)
    } else {
      DispatchQueue.main.async { Self.pressForTesting(model) }
    }
  }

  private static func pressForTesting(_ model: ListItemModel) {
    if let row = model.row {
      row.simulatePressForTesting()
    } else {
      model.press()
    }
  }

  /// Reads the row's own `UIView` accessibility element, which, unlike a SwiftUI control's,
  /// is readable in-process. Those are `UIView` properties, so this hops to main.
  func nuiTestProbeAccessibility() throws {
    let model = host.model
    if Thread.isMainThread {
      model.recordAccessibility(Self.accessibilityProbe(model))
    } else {
      DispatchQueue.main.async { model.recordAccessibility(Self.accessibilityProbe(model)) }
    }
  }

  private static func accessibilityProbe(_ model: ListItemModel) -> String {
    guard let row = model.row else {
      return "no row"
    }
    let traits = row.accessibilityTraits
    let role: String
    if traits.contains(.button) {
      role = "button"
    } else if traits.contains(.staticText) {
      role = "text"
    } else {
      role = "none"
    }
    let label = row.accessibilityLabel ?? ""
    return "role=\(role),disabled=\(traits.contains(.notEnabled)),"
      + "element=\(row.isAccessibilityElement),label=\(label)"
  }

  func nuiTestStateReport() throws -> String {
    return host.model.stateReport()
  }

  func nuiTestLayoutReport() throws -> String {
    return host.model.layoutReport()
  }

  private let pixelProbesLock = NSLock()
  private var pixelProbes = 0

  /// iOS has no Android icon glyph to sample, so the report says `no pixels`, which the
  /// tests treat as a failure.
  func nuiTestPixelProbe(color: Double) throws {
    pixelProbesLock.lock()
    pixelProbes += 1
    pixelProbesLock.unlock()
  }

  func nuiTestPixelReport() throws -> String {
    pixelProbesLock.lock()
    let probes = pixelProbes
    pixelProbesLock.unlock()
    return "n=\(probes) no pixels platform=ios"
  }

  func nuiTestLifetimeReport() throws -> String {
    return host.lifetimeReport()
  }
}

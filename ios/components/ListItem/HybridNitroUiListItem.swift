//
//  HybridNitroUiListItem.swift
//  react-native-nitro-ui
//
//  The ListItem component: UIKit's own row content — a `UIListContentView` with a
//  `UIListContentConfiguration` — on the core runtime (DECISIONS D46).
//
//  This is the library's only place where UIKit is hosted rather than SwiftUI, and it
//  is hosted *through* SwiftUI (`UIViewRepresentable` inside `NitroSwiftUIHost`) rather
//  than by a bespoke UIKit root, for the reason `SingleLineBox` in
//  `HybridNitroUiTextField.swift` gives: the sizing engine, the recycle path, the perf
//  marks and the environment handling all live in the host, and a row of text has no
//  business reimplementing them. What SwiftUI adds here is one pass over a view whose
//  size UIKit already knows.
//
//  Why `UIListContentView` and not a cell: Q10 question C wants the *row content*, and
//  a cell drags in a collection view, reuse identifiers and a `UICollectionViewListCell`
//  that does not self-size outside one (measured: `systemLayoutSizeFitting` answers 0
//  for a bare `UICollectionViewListCell`), so it cannot be the thing a `fillWidth` leaf
//  measures. `UIListContentView` is what a list cell *draws*: it lays out title,
//  subtitle, leading image and its own margins, and it self-sizes at a given width
//  (G30 early check 1: 52 pt for `.cell()`, 68.33 for `.subtitleCell()` at the large
//  content size, with the label's leading edge at 16 pt inside a real `.insetGrouped`
//  cell, a real `.plain` cell and standalone — the same 16 pt a Form row gives its
//  content).
//
//  Two slots are ours rather than UIKit's, for measured reasons:
//
//  - **the trailing value.** `.valueCell()` puts the value in the secondary slot and
//    *stacks* it under a long title (measured: 74.67 pt, i.e. a height that depends on
//    the text), which is exactly the width-dependent height a `fillWidth` control may
//    not have. A one-line value that never moves the height is UIKit's own
//    side-by-side value only when it fits, so the value is our own label, styled from
//    `.valueCell()`'s own secondary text properties and pinned to the title's baseline.
//  - **the disclosure chevron.** A cell's accessory lives in the cell, and this is not
//    a cell. The glyph is the one UIKit uses — SF Symbol `chevron.right`, the cell's own
//    `emphasizedBody`/`small` symbol configuration in a 14 pt box 8 pt off the trailing
//    edge (measured off `UICollectionViewListCell`'s own disclosure accessory) — and the
//    colour is the list's: `.tertiaryLabel`, which is what the Form's screenshot reads.
//
//  Every slot is capped to one line. That is a sizing decision, not a style one: it is
//  what makes the height a function of *which* slots are filled rather than of what was
//  typed into them, so one cache entry per configuration is correct
//  (`docs/architecture/sizing.md` §5).
//

import NitroModules
import SwiftUI
import UIKit

/// The trailing edge of an item. Anything unrecognised is `none` (Button's rule).
enum ListItemAccessory: String {
  case none
  case disclosure
}

/// State of one ListItem. See ``NitroUiModel`` for why this is not `@Published`.
final class ListItemModel: NitroUiModel {
  var title: String?
  var subtitle: String?
  var value: String?
  /// The SF Symbol name, or `nil` for none. A name the runtime does not have draws
  /// nothing, which is why the row sets `image` only after `UIImage(systemName:)`
  /// resolves (Button's `systemImage` says the whole thing).
  var systemImage: String?
  /// The Android glyph name. Stored so the getter answers; iOS draws `systemImage` and
  /// never reads this (`HybridNitroUiChip.swift`'s `androidIcon` says why it is stored
  /// at all).
  var androidIcon: String?
  var accessory: ListItemAccessory = .none
  /// Whether `onPress` is wired: the row's highlight and its button role.
  var pressable = false
  /// Whether a `Form.Row` is drawing this item. The cell has already paid for its
  /// insets, its shape and its highlight, so the leaf draws its content edge-to-edge in
  /// the box it is given and adds no background of its own (DECISIONS D46 item 2).
  var insideRow = false
  var disabled = false
  var testID: String?
  var accessibilityLabel: String?
  /// The size configuration React sent (`''` / `'s'` / `'i'` / `'s|i'`). Stored for
  /// symmetry; the sizing engine reads the key out of Fabric state itself.
  var sizingKey = ""
  var onPress: (() -> Void)?

  /// Test-only read-outs, behind one lock and never `@Published`: the row writes
  /// `drawn`, and publishing from a layout pass would ask for the update that just ran.
  private let reportLock = NSLock()
  private var drawn = "none"
  private var presses = 0
  private var probes = 0
  private var accessibilityReport = "none"
  /// The colours the row last handed each of its slots, as `text:..,secondary:..,..`.
  /// Written where each slot is configured, so it says what will be painted rather than
  /// what `disabled` was sent; see ``stateReport()``.
  private var colours = "pending"
  /// Whether the row's *own* highlight actually painted a background during the last
  /// press. `shape=` reads this, so the answer comes from the painter and not from the
  /// props that choose the painter.
  private var highlightPainted = false
  /// The live row, so a test-only read can ask the drawn view rather than recompute what
  /// the props would have produced. Set once by the row's `init`, which is the only time
  /// the model gains a row: a recycled host keeps drawing the same view.
  weak var row: NitroUiListRowView?
  /// Where the row's own layout put its content, in points: leading inset, trailing inset,
  /// box. Written by `NitroUiListRowView.layoutSubviews` from the frames the layout gave,
  /// so these describe what drew rather than what was sent. `layoutReport` answers from
  /// them, and composes `shape=` here from `highlightPainted` — a layout pass does not run
  /// when a press paints or unpaints a background, so the two have to be read together at
  /// the moment the report is asked for.
  private var laidOut = false
  private var layoutLeading: CGFloat = 0
  private var layoutTrailing: CGFloat = 0
  private var layoutWidth: CGFloat = 0
  private var layoutHeight: CGFloat = 0

  /// One press, through the path a tap takes. Refused while disabled, as a tap is, and
  /// the counter only moves for an accepted one — which is what makes
  /// "`disabled` sends nothing" a reading rather than an echo.
  func press() {
    guard !disabled, pressable else { return }
    reportLock.lock()
    presses += 1
    reportLock.unlock()
    onPress?()
  }

  /// Record what the row was handed, from the row: `<title>|<subtitle>|<value>|<accessory>`.
  func recordDrawn(_ report: String) {
    reportLock.lock()
    drawn = report
    reportLock.unlock()
  }

  /// Store a probe's answer and count it, so a test can tell it from the last one.
  func recordAccessibility(_ report: String) {
    reportLock.lock()
    probes += 1
    accessibilityReport = report
    reportLock.unlock()
  }

  /// Record the colours the row handed its slots, taken at the place each is configured.
  func recordColours(_ report: String) {
    reportLock.lock()
    colours = report
    reportLock.unlock()
  }

  /// Say whether the row's own highlight painted for the press being applied.
  func recordHighlightPainted(_ painted: Bool) {
    reportLock.lock()
    highlightPainted = painted
    reportLock.unlock()
  }

  /// Record where the row put its content, in points. `nil` until the row has laid out.
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

  /// `displayed=<…>;presses=<n>;probes=<n>;a11y=<…>;iconTint=-;colours=<…>`.
  ///
  /// Safe from any thread.
  ///
  /// The last field answers `-` because iOS has no pixel sampler to feed (`nuiTestPixelReport`
  /// answers `no pixels platform=ios` for the same reason). Android records the colour its
  /// leading glyph was actually tinted with there, so one harness reads one line shape.
  func stateReport() -> String {
    reportLock.lock()
    defer { reportLock.unlock() }
    return "displayed=\(drawn);presses=\(presses);probes=\(probes);" +
      "a11y=\(accessibilityReport);iconTint=-;colours=\(colours)"
  }

  /// `insets=<l>,<t>;shape=<0|1>;box=<w>x<h>`, or `pending` before the first layout.
  ///
  /// Safe from any thread. The insets and the box are the last layout's measured frames;
  /// `shape=` is this model's `highlightPainted`, asked at the moment of reading — see
  /// ``recordHighlightPainted(_:)``.
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

  /// Back to "nothing yet", for recycling: a reused row whose report still described the
  /// previous owner's item would let a test read that owner's content.
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

/// The row UIKit draws: a `UIListContentView` filling the view, plus the two slots this
/// file's header explains (the value label and the chevron).
///
/// Created once per instance by ``ListItemRow``'s `makeUIView` and never replaced; every
/// later commit only re-applies the configuration (`nuiApply`).
final class NitroUiListRowView: UIView {
  private let model: ListItemModel
  private let content: UIListContentView
  private let valueLabel = UILabel()
  private let chevron = UIImageView()
  /// The chevron's holder, whose only job is to be an accessibility container with no
  /// elements in it (see the comment where it is configured).
  private let chevronHost = UIView()
  /// The press recogniser. A long press with no minimum, which is what UIKit's own list
  /// selection effectively is: it recognises at touch-down, so the row *looks* pressed,
  /// and it fires at the release. `Form`'s cell uses the same shape for the same reason
  /// (`NitroUiFormViews.swift`): React Native's touch handler will not share a touch with
  /// a recogniser it did not create, so the row has to accept simultaneous recognition
  /// rather than take the touch for itself.
  ///
  /// The minimum is part of the shape, not a tuning knob: UIKit's default is half a
  /// second, and a recogniser with that floor is a row that answers nobody. Measured on
  /// `real-input:ios`, the suite's 0.15 s press landed on a row that was on screen and
  /// hittable and reported no press at all, on every run that reached it, while the same
  /// press at the same dwell reached the controls beside it. The highlight never appeared
  /// either — it is drawn by the same `.began` this floor postponed. A person's tap lasts
  /// less than half a second too, so this was the row failing every quick thumb, not a
  /// test asking for something unnatural.
  private lazy var pressGesture = UILongPressGestureRecognizer(target: self, action: #selector(pressChanged(_:)))
  /// Whether the row is drawing its pressed background right now.
  private var pressed = false
  /// Which press path this row is configured for: `own` (this row paints its own
  /// highlight), `cell` (inside a `Form.Row`, whose cell owns the highlight) or `none`.
  ///
  /// Recorded in ``nuiApply()``, where the decision is made, and read back by
  /// ``layoutReport(_:)`` for `shape=` — the same answer Android records at the branch that
  /// picks Material's interactive row. Without it `shape=` would read `0` for every row at
  /// rest and could not tell a leaf that obeys `insideRow` from one that ignores it.
  private(set) var pressPath = "pending"
  /// The baseline the value label rides, taken from the row's own title label. Built once
  /// the first label exists, and rebuilt if UIKit hands us a different one.
  private var baselineConstraint: NSLayoutConstraint?
  /// The value label's trailing constraint, whose constant moves with the chevron.
  private var valueTrailing: NSLayoutConstraint?
  private var valueWidth: NSLayoutConstraint?
  /// The value's text, kept so the width limit can be computed in `layoutSubviews`, where a
  /// box exists, instead of in `nuiApply`, where on the first apply one does not.
  private var valueText: String?
  private var chevronVisible = false

  /// The colour a pressed row draws, which is the one Form's own row uses
  /// (`NitroUiFormViews.swift`), so the library's rows press alike.
  static let pressedColor: UIColor = .quaternarySystemFill

  init(model: ListItemModel) {
    self.model = model
    self.content = UIListContentView(configuration: ListItemModel.configuration(title: nil, subtitle: nil, image: nil, insideRow: false, disabled: false))
    super.init(frame: .zero)
    // So a test-only read (`nuiTestProbeAccessibility`) can ask the drawn view what it
    // publishes instead of recomputing what the props would have produced.
    model.row = self
    backgroundColor = .clear
    // The view's own margins must not add to the configuration's: the row is pinned to
    // these edges, and a box that inherits layout margins would inset it a second time.
    directionalLayoutMargins = NSDirectionalEdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0)
    // ... and neither may the row content's. `insetsLayoutMarginsFromSafeArea` is on by
    // default, and `UIListContentView` places its labels *inside* `directionalLayoutMargins`
    // — so a row whose frame crosses the window's top inset gets its whole label block
    // pushed down by that inset, and `systemLayoutSizeFitting` then reports a row that is
    // the safe area taller. Measured on the harness before this line existed: the first
    // `ListItem` under a status bar measured 52 pt while it had no geometry, and 113 pt on
    // the first prop change after it had (`ListItem.harness.tsx` · "keeps one box while the
    // slots that cost nothing change"). A list that absorbs the inset itself — `Form`, a
    // `FlashList` — hides this; a plain `<View>` at the top of a screen does not.
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
    // The value must never win a fight with the title for width: the title truncates and
    // the value stays whole, which is the other way round to what UIKit does when it
    // stacks (`valueCell`'s long-value case), and the row's height depends on that choice.
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
    // The glyph is decoration, and the row is one element (D46 item 1) — but the flags
    // that normally say so do not reach it: `isAccessibilityElement = false` and
    // `accessibilityElementsHidden = true` on the image view were both measured on device
    // and both left an element named "Forward" (the symbol's own label) in the tree. An
    // empty `accessibilityElements` on the view that holds it is the explicit answer
    // rather than a flag UIKit may second-guess: this container has no elements, so
    // nothing inside it is vended. Same frame, same pixels, one fewer stop.
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

  /// The row's own height at `width`, asked of UIKit's row content.
  ///
  /// The width is required and the height is whatever the configuration wants at that
  /// width — the same question the sizing engine asks a `fillWidth` control, asked one
  /// level down. It is a synchronous Auto Layout pass and it is not free, which is why
  /// the only caller is SwiftUI's `sizeThatFits`, itself once per size-affecting change.
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
    // Who paints the press: this row's own highlight, the `Form.Row`'s cell, or nobody.
    // `setPressed(_:)` is the painter, and this is its condition spelled once.
    // Inside a `Form.Row` the leaf tracks nothing: the cell is the touch target and the
    // cell is what paints a pressed row (D46 item 2), and `Form.Row` takes this row's
    // `onPress` through the context so the press still arrives. A recogniser armed inside a
    // row would answer a touch the cell is already answering, and could only paint a
    // highlight the row has no business painting.
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
    // The trailing reservation: UIKit truncates the title at the configuration's trailing
    // margin, and the value label and chevron are drawn inside it. Reserving their width
    // here is what makes the title truncate *before* them instead of underneath them, and
    // it cannot move the height (measured: 16/58/89/160 pt of trailing margin all measure
    // the same height at the same width).
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
      // The width the value may take is a question about the *box*, and `nuiApply` runs
      // before the box exists - on the first apply `bounds.width` is 0, which answers the
      // reservation as if the row were 0 wide. It is applied where the box is known
      // (`layoutSubviews`); this is the value, which the box cannot change.
      valueText = value
      valueTrailing?.constant = -(ListItemModel.listInset(model.insideRow)
        + ListItemModel.chevronSpace(model.accessory))
    }

    chevronVisible = model.accessory == .disclosure
    chevron.isHidden = !chevronVisible
    chevron.tintColor = model.disabled ? ListItemModel.disabledColor : ListItemModel.chevronColor

    pressGesture.isEnabled = model.pressable && !model.disabled && !model.insideRow
    if !pressGesture.isEnabled { setPressed(false) }

    // What the row will paint in each slot, recorded where each is set: the colour the
    // configuration carries for the headline and the supporting line, the image tint, the
    // chevron this file draws, and the value label. `disabled` is a colour decision as much as
    // an inertness one, and reading it back is the only way a harness can tell "greyed the
    // row" from "greyed the value label".
    //
    // Both text colours are `null_resettable`: a configuration that was never told answers
    // `nil`, and the colour it then paints with is the list cell's own default — `.label` and
    // `.secondaryLabel`. Those are named here rather than reported as "unset", because the
    // harness is comparing an enabled row with a disabled one and needs a number on both
    // sides. An image tint answers `unset` when none was set: UIKit picks the symbol's own
    // tint there, and this row has not chosen it.
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

  /// The one accessibility element this row publishes.
  ///
  /// One element rather than one per label: a list row is a single thing a person
  /// navigates to, and UIKit agrees (a cell is an element and its labels are not). The
  /// order is the row's own reading order — title, subtitle, value — with the caller's
  /// `accessibilityLabel` winning outright, which is what `Form.Row` does too.
  private func applyAccessibility() {
    isAccessibilityElement = true
    if let label = model.accessibilityLabel {
      accessibilityLabel = label
    } else {
      accessibilityLabel = [model.title, model.subtitle, model.value]
        .compactMap { $0 }
        .joined(separator: ", ")
    }
    // `.button` is a promise about a touch. Inside a `Form.Row` the touch belongs to the
    // cell, which publishes its own button element, and a second button nested in it is one
    // stop too many for a row that is already one.
    var traits: UIAccessibilityTraits = model.pressable && !model.insideRow
      ? .button
      : .staticText
    if model.disabled { traits.insert(.notEnabled) }
    accessibilityTraits = traits
    // The labels inside are not elements: `isAccessibilityElement` on the row hides the
    // subtree from UIKit's own walk, and the leading image is decoration. The chevron is
    // a *sibling* of that subtree, so the line above does not reach it and it has to be
    // stood down by name: `chevron.right` vends its own label ("Forward", measured in
    // `real-input:ios`'s own node dump), and a row that goes somewhere would otherwise
    // hand a reader a second stop inside the one element this leaf is (D46 item 1). The
    // arrow says what the role already says.
    content.isAccessibilityElement = false
    // `isAccessibilityElement = false` on the row's own subtree is not enough for the
    // chevron: a view that is itself an element still hands UIKit's walk its subviews
    // that are elements in their own right, and an image view with an SF Symbol is one
    // (measured twice: the element survived the line above, `id="chevron.right"
    // label="Forward"`, eleven of them on the component's own screen).
    // `accessibilityElementsHidden` is the property that takes the subtree out of the
    // walk rather than marking one view, which is the claim being made here.
    chevron.isAccessibilityElement = false
    chevron.accessibilityElementsHidden = true
    // The holder is the part that actually removes it from the walk, and the row's own
    // children have to stay reachable for the label above to be read at all, so the
    // empty list is asserted here as well as at construction (a re-apply must not lose it).
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

  /// The value label's own width limit, at the width the row actually has.
  ///
  /// Asked in `layoutSubviews` and not in `nuiApply`: the apply that first sets a value
  /// runs before the view has a box (`bounds.width == 0`), and a reservation computed at
  /// width 0 is a value label with no room, truncated to nothing on the frame it arrives.
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

  /// Put the value label on the *title's* baseline.
  ///
  /// Not the row's centre: with a subtitle the row is taller than the title's line, and a
  /// centred value sits between the two lines instead of beside the headline, which is
  /// not what a settings row looks like. The baseline is read off UIKit's own title label
  /// once it exists — a public `UILabel`, walked out of the row content — and the
  /// constraint is exact wherever the label ends up, including under Dynamic Type.
  ///
  /// Until a title label exists (no title, or a layout pass that has not run) the value
  /// rides the row's centre, which is the right answer for a row with no headline.
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

  /// The row's own title label: the label UIKit drew highest in the row.
  ///
  /// A depth-first walk of our own subviews, read-only, with a `nil` answer that leaves
  /// the value on the row's centre. The labels are public `UILabel`s; their class names
  /// are private, which is why the walk asks for a label rather than for a name.
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

  /// What the row drew, as numbers: leading inset, trailing inset, box — in points.
  ///
  /// Both halves come off the drawn thing, not off what was asked of it. The insets are the
  /// title label's own frame, converted into the row's coordinates: reading
  /// `configuration.directionalLayoutMargins` back would only repeat the number `nuiApply`
  /// wrote into it, and a report that echoes the prop cannot notice an `insideRow` that was
  /// ignored. The trailing number is the gap to the furthest thing the row draws on that edge
  /// - the value label or the chevron when there is one, the title's own right edge when
  /// there is not - because that is the inset the list paid for.
  ///
  /// `nil` until there is a title label to measure, so a row that has not drawn its content
  /// yet reports `pending` rather than a pair of made-up zeroes.
  ///
  /// `shape=` is not answered here: a layout pass does not run when a press paints or
  /// unpaints a background, so the flag would go stale between the press and the read.
  /// `ListItemModel.layoutReport()` composes it from `highlightPainted`, which the painter
  /// itself sets. A row inside a `Form.Row` never answers `1`: its cell is the shape.
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
  /// The touch this recogniser is tracking, and how far its finger has gone.
  ///
  /// The rule is core's (`NitroUiPressTravel`), shared with the Form row's cell, which
  /// came to it a component later and for the same reason: the recogniser starts at
  /// touch-down (`minimumPressDuration = 0`), which is what makes a quick thumb work at
  /// all, and recognises alongside the scroll view, which is what lets React Native and
  /// the list keep their own read of the same touch. Travel is therefore the only thing
  /// left that tells a tap from a flick that happened to begin on a row.
  private var pressTravel = NitroUiPressTravel()

  @objc private func pressChanged(_ gesture: UILongPressGestureRecognizer) {
    switch gesture.state {
      case .began:
        pressTravel.began(at: gesture.location(in: self))
        model.recordHighlightPainted(setPressed(true))
      case .changed:
        // A scroll that began on the row: stand down. The highlight goes, and what the
        // rule remembers is what keeps the release from firing a press anyway.
        if pressTravel.moved(to: gesture.location(in: self), within: bounds) {
          setPressed(false)
          // Not a press after all, so nothing counts as having painted one.
          model.recordHighlightPainted(false)
        }
      case .ended:
        setPressed(false)
        // This is the whole difference between a row that presses and a row that fires
        // whenever someone scrolls past it: `.ended` is where a long press with no minimum
        // says "the finger lifted", and a flick lifts a finger too.
        if pressTravel.ended() {
          model.press()
        } else {
          model.recordHighlightPainted(false)
        }
      default:
        // Cancelled or failed: a scroll that turned out to be a scroll.
        pressTravel.cancelled()
        setPressed(false)
        model.recordHighlightPainted(false)
    }
  }

  /// The row's own highlight: the platform's colour at the platform's press timing, and
  /// nothing at all inside a `Form.Row`, whose cell draws its own (DECISIONS D46 item 2).
  ///
  /// Answers whether a background was painted *by this call*, which is what `shape=` reads.
  /// The claim is "this row's own highlight is what a press draws", and the only witness for
  /// that is the painter running.
  @discardableResult
  private func setPressed(_ pressed: Bool) -> Bool {
    let wantsPressed = pressed && model.pressable && !model.disabled && !model.insideRow
    guard wantsPressed != self.pressed else { return self.pressed }
    self.pressed = wantsPressed
    backgroundColor = wantsPressed ? Self.pressedColor : .clear
    return wantsPressed
  }

  /// The press path a test drives: the highlight, then the release, then the callback, in the
  /// order the recogniser uses, so `shape=` means the same thing from a test as under a
  /// finger. The travel check is a gesture's business; a test press is a tap.
  func simulatePressForTesting() {
    model.recordHighlightPainted(setPressed(true))
    setPressed(false)
    model.press()
  }

  /// Back to a row at rest, for a host object being reused.
  ///
  /// `prepareForRecycle` resets the *model*, and a model reset reaches the drawn row only
  /// through a re-apply, which the pool does not promise before the instance goes back out.
  /// A row still wearing its previous owner's pressed background, or still armed for that
  /// owner's touch, is a recycled row that looks pressed and could answer a callback its next
  /// owner never set.
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
    // React Native's touch handler above the surface, and whatever scroll view the row is
    // in. Both are made worse, not better, by this row also tracking a press.
    true
  }

  override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
    // Inside a `Form.Row` the cell owns the touch and the highlight, and the item's handler
    // was handed up to it (`Form.Row`'s `RowItemPressContext`), so a recogniser here would be
    // a second answer to one touch.
    model.pressable && !model.disabled && !model.insideRow
  }
}

// MARK: - Configuration

extension ListItemModel {
  /// The list's own horizontal inset, and the one number the `insets` report answers.
  ///
  /// 16 pt is what UIKit uses for a list cell's content and what a Form row's cell gives
  /// its content (measured: the label's leading edge is at 16.00 inside an
  /// `.insetGrouped` cell, a `.plain` cell and standalone). Inside a `Form.Row` it is 0,
  /// because that cell has already paid (DECISIONS D46 item 2).
  static let listInset: CGFloat = 16
  /// The inset inside a `Form.Row`, whose cell has already paid for its own.
  static func listInset(_ insideRow: Bool) -> CGFloat {
    insideRow ? 0 : listInset
  }
  /// The chevron's box, and its inset from the trailing edge: both measured off
  /// `UICollectionViewListCell`'s own disclosure accessory (a 14 pt glyph 8 pt off the
  /// edge, so the box occupies `[W-22, W-8]`).
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

  /// How much of the row the headline keeps for itself. UIKit's own side-by-side value
  /// layout leaves the title room rather than taking the whole row, and a value that ate
  /// the row would leave a one-character headline.
  static let listTitleMinimum: CGFloat = 44

  /// The font and colour UIKit's own value slot uses, read from a `.valueCell()`
  /// configuration rather than hardcoded: it is the platform's secondary-text role, and
  /// it is the thing that re-resolves under Dynamic Type.
  static var valueFont: UIFont {
    UIListContentConfiguration.valueCell().secondaryTextProperties.font
  }

  /// The colour a disabled row draws *everything* in: text, supporting text, the leading
  /// glyph and the chevron. `.tertiaryLabel` is the one UIKit hands a disabled label, and it
  /// is the colour the value label has always used for this - a row that greys only its value
  /// looks like a row with a placeholder, not a row you cannot press.
  static let disabledColor: UIColor = .tertiaryLabel
  /// The chevron's colour when the row is enabled: a piece of decoration, one step behind the
  /// headline, and the same colour the disabled row uses (which is why only the text, the
  /// supporting text and the glyph change when a row is disabled).
  static let chevronColor: UIColor = .tertiaryLabel

  static func valueColor(disabled: Bool) -> UIColor {
    var properties = UIListContentConfiguration.valueCell().secondaryTextProperties
    if disabled {
      // The row's own disabled colour, not a dimmed copy of the normal one.
      properties.color = disabledColor
    }
    return properties.resolvedColor()
  }

  /// The row content's configuration: which of UIKit's three list cells this item is.
  ///
  /// `.subtitleCell()` when there is a supporting line and `.cell()` when there is not,
  /// which is the pair the sizing key names. `.valueCell()` is deliberately not used —
  /// see the file header for the height it measures with a long value.
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
    // One line per slot, tail-truncated: the sizing rule in the file header, drawn.
    configuration.textProperties.numberOfLines = 1
    configuration.textProperties.lineBreakMode = .byTruncatingTail
    configuration.secondaryTextProperties.numberOfLines = 1
    configuration.secondaryTextProperties.lineBreakMode = .byTruncatingTail
    if disabled {
      // `UIListContentConfiguration` does not grey itself: the configuration it hands a
      // disabled cell is the configuration it hands an enabled one, and the greying is the
      // cell's. This leaf is not a cell, so the row's disabled colour has to be said for
      // each slot - headline, supporting line and the leading glyph's template tint.
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

/// The representable: UIKit's row content inside the library's one SwiftUI host.
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

  /// The box's width, and the row configuration's own height at it (`fillWidth`).
  ///
  /// Every slot is capped to one line, so the height is a function of the *configuration*
  /// and not of the text: the same question `docs/architecture/sizing.md` §5 says a
  /// `fillWidth` control must be able to answer from its key.
  @available(iOS 16.0, *)
  func sizeThatFits(_ proposal: ProposedViewSize, uiView: NitroUiListRowView, context: Context) -> CGSize? {
    let width = proposal.width ?? uiView.bounds.width
    guard width > 0 else { return nil }
    return uiView.rowSizeThatFits(width)
  }
}

/// The SwiftUI half: one row, one configuration.
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

/// The Hybrid View React renders as `NitroUiListItem`.
final class HybridNitroUiListItem: HybridNitroUiListItemSpec, RecyclableView {
  private let host: NitroSwiftUIHost<ListItemContent>

  /// This component's name in the sizing engine: `HybridNitroUiListItemComponentName`
  /// in the generated C++, and `getName()` in the generated Kotlin.
  private static let sizingComponentName = "NitroUiListItem"

  /// The size to lay a ListItem out with before anything has been measured, in points.
  ///
  /// One line of the body font inside UIKit's own list insets: the height `.cell()`
  /// measures at the large content size on iOS 27 (52 pt, G30 early check 1), which is
  /// the title-only configuration — the one an app's first row almost always is, and the
  /// one the conformance fixture mounts. The width is what a row gets under a parent that
  /// gives it none, where `fillWidth` draws the declared width.
  ///
  /// Deliberately not a rounded-up guess: `boxRuleFor` compares the measured title-only
  /// row with this number, and the harness measures every *other* configuration from a
  /// poisoned fallback so a failed correction cannot hide.
  private static let fallbackSize = (width: 300.0, height: 52.0)

  private static let declaresFallback: Bool = {
    NitroUiSizing.setFallback(sizingComponentName, fallbackSize.width, fallbackSize.height, NitroUiSizingPolicy.fillWidth.rawValue)
    return true
  }()

  /// Hand this control's declared size to the sizing engine, once per process.
  /// ``NitroUiDeclaredFallbacks`` calls this at startup; `init` is the backstop.
  static func declareFallback() {
    _ = Self.declaresFallback
  }

  /// The Nitro `view` - created once here and never replaced.
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

  /// The model, through the host that owns it (one owner, no second reference).
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
      // The one prop that moves the height on its own (a subtitle is UIKit's
      // `.subtitleCell()`), so the measure is owed whether or not the key also changed.
      markContent()
    }
  }

  var value: Variant_NullType_String {
    get { model.value.map { .second($0) } ?? .first(.null) }
    set {
      let next = newValue.asType(String.self)
      guard next != model.value else { return }
      model.value = next
      // One line, inside the row's own line: the height does not move, so the host is
      // only told the *content* may have moved (which covers a value that truncates).
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
      // Rendered: the recogniser's `isEnabled` and the button role both read it.
      host.markDirty()
    }
  }

  var insideRow: Bool {
    get { model.insideRow }
    set {
      guard newValue != model.insideRow else { return }
      model.insideRow = newValue
      // The insets move, the height does not, so this is a redraw rather than a re-measure
      // — but the row's configuration carries the insets, so it has to be applied.
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
      // Nothing to apply: RN's component view already carries `testID` as its
      // `accessibilityIdentifier`. It stays in the spec because Android needs it as a tag.
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
      // A new configuration may measure what the old one did; the host must not swallow
      // that report against its dedupe (Button's `nuiSizingKey` setter).
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

  /// Apply a size-affecting change: redraw, and let the host know the height may have
  /// moved. The row re-measures itself, so `invalidateContentSize` is not needed — the
  /// host's own `sizeThatFits` asks the row, and the row asks UIKit.
  private func markContent() {
    host.markDirty()
    host.noteContentSizeMayHaveChanged()
  }

  // MARK: - Lifecycle

  func afterUpdate() {
    // Nothing to reconcile: a ListItem has no controlled value (a press is not a value —
    // see the spec), so one commit per turn is the entire update path.
    host.commit()
  }

  func prepareForRecycle() {
    // The drawn row first: a pressed background or an armed recogniser survives a model reset
    // until something re-applies, and the pool does not promise that before reuse.
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

  /// The row's own height, from the host's cache. Never touches the main thread: this can
  /// be called from JS, and SwiftUI may only be measured on main (§1.4).
  func measureContent() throws -> NitroUiSize {
    guard let size = host.contentSize else {
      return NitroUiSize(width: 0, height: 0)
    }
    return NitroUiSize(width: Double(size.width), height: Double(size.height))
  }

  /// Press through the tap's path, on main (see the spec). Returns at once.
  ///
  /// The drawn row runs it when there is one, so a test press paints the highlight and
  /// counts the press in the order a finger does, and `shape=` means the same thing here as
  /// under a held touch. The model alone answers only when the row has not been made yet.
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

  /// What the row publishes to a reader, as the row itself sees it.
  ///
  /// Unlike a SwiftUI control's element (`HybridNitroUiChip.nuiTestProbeAccessibility`
  /// answers `unavailable` for exactly that reason), this row's element is a plain
  /// `UIView` element built in ``NitroUiListRowView/applyAccessibility``, and readable
  /// in-process. It is a reading of *this leaf's* element: what VoiceOver is finally
  /// handed through a SwiftUI host is XCUITest's to check, and is
  /// (`real-input:ios`'s a11y case for the same item).
  ///
  /// The answers come off the element - `isAccessibilityElement`, `accessibilityLabel()`,
  /// `accessibilityTraits` - because recomputing them from the model would only be an echo
  /// of the props, and the point of the probe is that `applyAccessibility` ran and put
  /// something on screen for a reader to find. Those are `UIView` properties, so this one
  /// *does* hop to main, and the harness's probe helper waits for the counter to move
  /// rather than reading the line straight back.
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

  /// Records that a probe was asked for, and answers nothing.
  ///
  /// iOS has no glyph to sample: `androidIcon` is Android's prop and iOS draws
  /// `systemImage` instead, so an iOS probe of an Android icon is a test that should not
  /// be running there. The report says `no pixels`, which the harness's probe helper
  /// treats as a hard failure rather than an answer (Button's and Chip's pair).
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

  /// What this host object has been through, for the conformance suite's recycle rule.
  func nuiTestLifetimeReport() throws -> String {
    return host.lifetimeReport()
  }
}

//
//  HybridNitroUiIconButton.swift
//  react-native-nitro-ui
//
//  The IconButton component: one glyph as a control, with no text anywhere.
//
//  It is Button's control and Switch's value in one file, because that is what the
//  component is (`docs/tasks/Q9-buttongroup-iconbutton-design.report.md` C4): the
//  press form is a `Button` whose label is a `Label` drawn `.iconOnly`, and the
//  toggle form is `Toggle(isOn:) { … }.toggleStyle(.button)` — the same control
//  Chip's filter form uses, and the one iOS gives a "selected" state for free.
//  The value half is the event-count handshake (`docs/architecture/core.md` §4),
//  so a change JS refuses reverts instead of stranding the glyph in the wrong
//  state.
//
//  What is new here relative to Button is that the *name* is required: an
//  IconButton has no text, so `accessibilityLabel` is both the Label's title (the
//  element's name) and the only thing a screen reader can read.
//

import NitroModules
import SwiftUI
import UIKit

/// The four looks, named after the Material 3 components they map to
/// (`IconButton` / `FilledIconButton` / `FilledTonalIconButton` /
/// `OutlinedIconButton`). Anything unrecognised is `standard` — Button's rule.
enum IconButtonVariant: String {
  case standard
  case filled
  case tonal
  case outlined
}

/// `.controlSize` for the five rungs of the shared ladder (D42 item 4).
///
/// iOS has five usable values and the ladder has five rungs, so — unlike
/// `HybridNitroUiButton`, where two rungs share the largest control — each rung
/// here is its own control size. `.extraLarge` is iOS 17+; before it the largest
/// is `.large`, so on an older OS the top two rungs are one control. That collapse
/// is the honest mapping: there is no sixth button size to point at, and
/// `docs/components/icon-button.md` states it beside Android's five distinct
/// Material containers.
///
/// What it does *not* do here is size the control. On a titled `Button`,
/// `.controlSize` moves the label's font and the button with it — measured on
/// `Button` at 28 / 34.3 / 50.3 pt. This control has no title: its label is a
/// symbol under `.labelStyle(.iconOnly)`, and the first device run of this suite
/// measured `.mini` and `.small` at one 15.33 × 15.00 pt box and `.regular`,
/// `.large` and `.extraLarge` at one 17.67 × 16.00 pt box — two boxes for a ladder
/// with five rungs, i.e. a `size` prop that does almost nothing. So the rung also
/// sets the symbol's point size, below, and `.controlSize` is left to what it does
/// control: the style's own padding, corner and press feedback.
enum IconButtonScale: String {
  case small
  case medium
  case large
  case xlarge
  case xxlarge

  var controlSize: ControlSize {
    switch self {
    case .small: return .mini
    case .medium: return .small
    case .large: return .regular
    case .xlarge: return .large
    case .xxlarge:
      if #available(iOS 17.0, *) {
        return .extraLarge
      }
      return .large
    }
  }

  /// The symbol's point size for the rung.
  ///
  /// Material's own icon-button glyph tokens — the same five numbers Android draws
  /// its glyph at (`IconButtonScale.iconSize()`, read from `IconButtonDefaults`):
  /// XS 20, S 24, M 24, L 32, XL 40. One ladder, two platforms, so `size="large"`
  /// draws the same 24 pt / 24 dp artwork on either side; what differs is the
  /// container around it, which Android takes from Material and iOS takes from the
  /// button style. Note `medium` and `large` share Material's 24: the rung that
  /// separates them on Android is a *container* difference (40 → 56 dp), and iOS has
  /// no icon-button containers to make it — `docs/components/icon-button.md` prints
  /// both measured grids rather than pretending they agree.
  var symbolPointSize: CGFloat {
    switch self {
    case .small: return 20
    case .medium, .large: return 24
    case .xlarge: return 32
    case .xxlarge: return 40
    }
  }
}

/// The corner. `'square'` is the nearest corner iOS has, as in Button's.
enum IconButtonShapeKind: String {
  case round
  case square

  /// The radius `square` draws with — Button's number, so a `Button` and an
  /// `IconButton` with `shape="square"` have the same corner.
  static let squareCornerRadius: CGFloat = 8
}

/// State of one IconButton. See ``NitroUiModel`` for why this is not `@Published`.
final class IconButtonModel: NitroUiModel {
  /// The control's only name, and the Label's title.
  var accessibilityLabel: String = ""
  /// A symbol name that resolved to an actual SF Symbol (Button's rule: the
  /// content never renders the "missing symbol" placeholder).
  var systemImage: String?
  /// Stored, never drawn: iOS has no drawable to paint, and the prop is Android's.
  var androidIcon: String?
  var variant: IconButtonVariant = .standard
  var scale: IconButtonScale = .medium
  /// Stored, never applied: Material's width options have no iOS counterpart
  /// (`docs/components/icon-button.md`, "Width"). It is in the size
  /// configuration the wrapper builds, which is what keeps the two platforms from
  /// sharing a cached box.
  var width: String = "uniform"
  var shape: IconButtonShapeKind = .round
  var disabled = false
  var tint: UIColor?
  var testID: String?
  /// The size configuration React sent; the engine reads it out of Fabric state,
  /// and the host only needs to hear that it changed.
  var sizingKey = ""

  /// Whether the control is a toggle. The wrapper sends `defaultChecked` as
  /// non-null exactly when the caller used the toggle form, which is the one
  /// signal that tells an *uncontrolled toggle* (both values null) apart from a
  /// press button (both null too) - and, for the same reason, the only one that
  /// says when the caller has *stopped* using it. Written from that signal in
  /// ``HybridNitroUiIconButton/afterUpdate()``, never by a prop setter.
  var isToggle = false
  /// Whether the 44 pt target is built by widening the *label* rather than by a hit
  /// layer behind the whole control.
  ///
  /// Only `standard` can do that, and only in the press form: it is the one variant
  /// iOS draws with no container (`.borderless`), so a 44 pt label is a 44 pt control
  /// with nothing grown around it. Every other configuration draws a bezel - the
  /// three bordered button styles and the toggle form, whose `.button` toggle style is
  /// a bordered box whatever `variant` says - and widening their label would widen
  /// the artwork, not just the target (`IconButtonContent/minimumTouchTarget`).
  var floorsLabel: Bool {
    return !isToggle && variant == .standard
  }

  /// The toggle's selection, behind the handshake (§4). The press form never reads
  /// it, which is why `displayed` starting at `false` costs nothing there.
  var state = NitroUiControlledValue<Bool>(displayed: false)
  var defaultChecked: Bool?
  var didApplyDefault = false

  var onCheckedChange: ((_ checked: Bool, _ eventCount: Double) -> Void)?
  var onPress: (() -> Void)?

  /// Test-only read-outs (`nuiTestStateReport`). Plain storage behind a lock,
  /// never `@Published`: the body writes `drawn`, and publishing from the body
  /// would ask for the update that has just happened. Chip's shape.
  private let reportLock = NSLock()
  private var drawn = "none"
  private var probes = 0
  private var accessibilityReport = "none"
  /// What the glyph measures with no target floor applied, as `WxH` (`control=` in
  /// ``stateReport()``).
  ///
  /// The 44 pt floor is why this exists: with it, `small`, `medium` and `large` all
  /// lay out at one 44 x 44 pt box, so the laid-out box stops being evidence that the
  /// rung moved the artwork at all - and "the rung sizes the glyph" is the iOS half of
  /// the ladder, the thing `symbolPointSize` is for. Recording what the label measures
  /// before the floor is applied lets the harness assert both halves at once: the
  /// glyph ladder from this field, and the floor from `box == max(control, 44)`.
  ///
  /// Test-only, and stored rather than published for Chip's reason: the drawing code
  /// writes it, and publishing what the body wrote would ask for the update that just
  /// happened.
  private var artworkSize = "none"

  override init() {
    super.init()
  }

  /// The user flipped the toggle - from the Toggle's binding, or from ``press()``.
  /// Native is optimistic: show the new value now, before React has seen the
  /// event, so there is no visual latency (§4).
  func userToggle(to requested: Bool) {
    let eventCount = state.user(requested)
    objectWillChange.send()
    onCheckedChange?(requested, Double(eventCount))
  }

  /// One press, through the path a tap takes: the toggle's flip or the button's
  /// action. Refused while disabled, as `.disabled(true)` refuses a tap.
  func press() {
    guard !disabled else { return }
    if isToggle {
      userToggle(to: !state.displayed)
    } else {
      onPress?()
    }
  }

  /// Record what the drawing code was handed: `1`/`0` for a toggle, `none` for the
  /// press form, which has no selection.
  func recordDrawn(_ value: String) {
    reportLock.lock()
    drawn = value
    reportLock.unlock()
  }

  /// Store a probe's answer and count it, so a test can tell it from the last one.
  func recordAccessibility(_ report: String) {
    reportLock.lock()
    probes += 1
    accessibilityReport = report
    reportLock.unlock()
  }

  /// Store what the glyph measured before the target floor widened the control.
  func recordArtworkSize(_ size: CGSize) {
    reportLock.lock()
    artworkSize = String(format: "%.2fx%.2f", size.width, size.height)
    reportLock.unlock()
  }

  /// `displayed=<0|1|none>;probes=<n>;a11y=<...>;control=<WxH>`. Safe from any thread.
  func stateReport() -> String {
    reportLock.lock()
    defer { reportLock.unlock() }
    return "displayed=\(drawn);probes=\(probes);a11y=\(accessibilityReport);"
      + "control=\(artworkSize)"
  }

  /// Back to "nothing yet", for recycling: a reused view whose report still
  /// described the previous owner's control would let a test read that owner's
  /// state.
  func clearReports() {
    reportLock.lock()
    drawn = "none"
    probes = 0
    accessibilityReport = "none"
    artworkSize = "none"
    reportLock.unlock()
  }
}

/// The SwiftUI half. Reads only the model, so any commit can rebuild it.
struct IconButtonContent: NitroUIContent {
  /// The subscription to ``NitroUiModel/objectWillChange``.
  @ObservedObject private var model: IconButtonModel

  /// iOS's floor under the laid-out box, in points - Apple's own minimum for a
  /// tappable region, the number its Human Interface Guidelines have quoted since iOS 7
  /// and the one UIKit controls keep for their cells and bars, and the exact
  /// counterpart of Android's 48 dp
  /// `MinInteractiveComponentSize`, which `IconButtonScale.containerSize` applies to
  /// every rung there. A rung whose glyph is smaller than the target is drawn at its
  /// own rung and *centred inside* the target: the ladder sizes the artwork, the
  /// floor sizes the target, and Material separates those two on purpose.
  ///
  /// Why a floor is needed at all: before it, the laid-out box *was* the tappable
  /// area, and `standard`/`medium` measured 25 x 23 pt - a control a fifth smaller
  /// than Apple's minimum, against Android's rule that no rung is ever below Material's.
  ///
  /// Growing the layout alone would not fix that either, and that is the part this
  /// file has to get right rather than assume: a SwiftUI `Button` hit-tests its own
  /// label and style, not the frame its host was laid out in, so `.frame(minWidth: 44,
  /// minHeight: 44)` around one moves the box React Native reserves and leaves the
  /// gesture exactly where it was. Hence the two different constructions below.
  private static let minimumTouchTarget: CGFloat = 44

  init(model: IconButtonModel) {
    self.model = model
  }

  // `@ViewBuilder` so the read-out below can be a statement: without it a `Void`
  // statement would be the body's value.
  @ViewBuilder var body: some View {
    // The reading `nuiTestStateReport()` answers with: taken where the control is
    // drawn, so it is what the Toggle is handed rather than what React sent.
    let drawn = model.isToggle ? (model.state.displayed ? "1" : "0") : "none"
    let _ = model.recordDrawn(drawn)
    // Everything that applies to every variant stays outside the switch, so a
    // variant change costs one style and not a different set of modifiers.
    if model.floorsLabel {
      // `standard`: the label is already framed to the target (see ``label``), so
      // the Button's own hit area is the whole 44 pt box and its accessibility
      // element is that box too. No second layer, and no `.accessibilityElement`
      // rewrite of an element iOS already gets right.
      styledControl
        .controlSize(model.scale.controlSize)
        .disabled(model.disabled)
        .modifier(OptionalIconButtonTint(color: model.tint))
    } else {
      // Every drawn-container configuration: the control keeps the box its own
      // style measures, and a target the same control cannot reach is added behind
      // it. See ``targetLayered``.
      targetLayered
    }
  }

  /// The control plus ``IconButtonContent/minimumTouchTarget`` of tappable area, for
  /// the configurations that draw a bezel.
  ///
  /// Growing the *layout* is not the same as growing the target here: the frame that
  /// widens the host's box leaves the Button's own gesture inside the label. The extra
  /// area therefore needs a view of its own to receive the tap, and the only place it
  /// can go is **behind** the control - in front it would swallow the taps the style is
  /// supposed to answer (the press highlight, the Toggle's own binding) and the control
  /// would stop looking pressed.
  ///
  /// The layer is `Color.clear`, so nothing is painted; `contentShape(Rectangle())`
  /// is what makes a clear view hit-testable at all, and `onTapGesture` runs the same
  /// ``IconButtonModel/press()`` the control's own gesture runs, so a tap on the
  /// corner and a tap on the glyph cannot disagree about what a press is. A tap
  /// landing inside both goes to the control, which is on top of the `ZStack`.
  ///
  /// What a reader stops on is the control, not the layer: the layer is hit area, so
  /// it is hidden from a11y and the SwiftUI control keeps its own element. Two ways of
  /// moving that stop onto the 44 pt box were tried and both measured worse:
  /// `.accessibilityElement(children: .combine)` on the `ZStack` leaves the label on
  /// **both** the box and the `Button` inside it - the sweep reports 2 elements under
  /// `real-input-icon-button` announced as the control's name - and hiding the control
  /// and naming the box leaves that `Button` element in the tree all the same, so the
  /// name is doubled either way. One stop on the drawn control, inset from the target
  /// it sits in, is what ships: `A11Y_EXEMPTIONS` carries the measured inset and
  /// `scripts/real-input/a11y.mjs` says what it means.
  private var targetLayered: some View {
    ZStack {
      Color.clear
        .frame(
          width: Self.minimumTouchTarget,
          height: Self.minimumTouchTarget
        )
        .contentShape(Rectangle())
        .onTapGesture { model.press() }
        .accessibilityHidden(true)
      styledControl
        .controlSize(model.scale.controlSize)
        .disabled(model.disabled)
        .modifier(OptionalIconButtonTint(color: model.tint))
    }
  }

  /// The control, in the style its form has on iOS.
  ///
  /// The two forms are styled by different SwiftUI machinery, and only one of them
  /// has four looks. A `Button` answers `buttonStyle`, so `variant` maps onto the
  /// four iOS button styles below. A `Toggle` with `.toggleStyle(.button)` does not
  /// read `buttonStyle` at all — iOS gives it exactly one look: a bordered box that
  /// fills with the accent colour while on. Applying a button style to it would be
  /// decoration that does nothing, so `variant` is documented as the press form's
  /// prop on iOS, and a toggle's `tintColor` is what moves its on-fill.
  @ViewBuilder private var styledControl: some View {
    if model.isToggle {
      Toggle(
        isOn: Binding(
          get: { model.state.displayed },
          set: { requested in model.userToggle(to: requested) }
        )
      ) {
        label
      }
      .toggleStyle(.button)
    } else {
      switch model.variant {
      case .standard:
        // Material's bare icon button: a glyph with no container. `.borderless` is
        // the only iOS style that draws nothing behind the label.
        buttonControl.buttonStyle(.borderless)
      case .filled:
        buttonControl.buttonStyle(.borderedProminent).buttonBorderShape(borderShape)
      case .tonal:
        buttonControl.buttonStyle(.bordered).buttonBorderShape(borderShape)
      case .outlined:
        // iOS has no outlined button style: `.bordered` plus a hairline is what
        // Button does for the same variant, and the same reasoning applies
        // (`HybridNitroUiButton.swift`) - the stroke reads as an outline in both
        // appearances and `.tint()` still colours the glyph.
        buttonControl
          .buttonStyle(.bordered)
          .buttonBorderShape(borderShape)
          .overlay(outline)
      }
    }
  }

  /// The corner for ``IconButtonModel/shape``.
  ///
  /// `.circle` is iOS 17+; before it the roundest shape iOS has is `.capsule`,
  /// which for a control this close to square is the same reading.
  private var borderShape: ButtonBorderShape {
    switch model.shape {
    case .round:
      if #available(iOS 17.0, *) {
        return .circle
      }
      return .capsule
    case .square:
      return .roundedRectangle(radius: IconButtonShapeKind.squareCornerRadius)
    }
  }

  /// The hairline the `outlined` variant strokes, on the corner it is drawn with —
  /// Button's rule: the stroke follows `shape` rather than being a fixed capsule,
  /// because a capsule stroke around a square-cornered control shows two corners.
  @ViewBuilder private var outline: some View {
    let stroke = AnyShapeStyle(Color(UIColor.separator))
    if model.shape == .square {
      RoundedRectangle(cornerRadius: IconButtonShapeKind.squareCornerRadius)
        .strokeBorder(stroke, lineWidth: 1)
    } else {
      Capsule().strokeBorder(stroke, lineWidth: 1)
    }
  }

  private var buttonControl: some View {
    Button(action: press) { label }
  }

  /// The glyph, named. `.iconOnly` draws the icon and keeps the title as the
  /// element's accessibility name, which is the whole of C4's iOS accessibility
  /// rule: the control is named by the only text it has, and shows none of it.
  @ViewBuilder private var label: some View {
    let glyph = Label {
      Text(model.accessibilityLabel)
    } icon: {
      if let systemImage = model.systemImage {
        // The rung's point size, spelled: a symbol-only label does not follow
        // `.controlSize` the way a title does (the measurement is on `IconButtonScale`),
        // so the glyph is sized directly and `.controlSize` keeps styling the control
        // around it. A symbol image sizes with its font, which is what makes this the
        // lever rather than a `scaleEffect` that would lie to the measurement.
        Image(systemName: systemImage)
          .font(.system(size: model.scale.symbolPointSize))
      }
    }
    .labelStyle(.iconOnly)
    .background(IconButtonArtworkReader { size in model.recordArtworkSize(size) })

    // The one configuration where the target can be built by widening the label:
    // `minWidth`/`minHeight` rather than `width`/`height`, because from `xxlarge` up
    // the glyph is what decides the box and a fixed frame would clip it. `Content`
    // centres by default, which is what "the glyph drawn at its rung and centred"
    // means here, and `contentShape` is what makes the widened label tappable in the
    // space around the artwork rather than only on the artwork's own pixels.
    if model.floorsLabel {
      glyph
        .frame(
          minWidth: Self.minimumTouchTarget,
          minHeight: Self.minimumTouchTarget
        )
        .contentShape(Rectangle())
    } else {
      glyph
    }
  }

  /// A tap on the press form. Nothing to reconcile: a press is a gesture, not a
  /// value React owns.
  private func press() {
    model.press()
  }
}

/// Reports the size of the view it is a `background` of, once per layout, without
/// becoming a second source of truth about it.
///
/// A `GeometryReader` in a `background` is laid out *at* the primary view's size and
/// proposes nothing back to it, so this cannot widen the label it measures - which is
/// the whole reason the floor above is written as `minWidth`/`minHeight` on the label
/// and this hangs off the artwork instead of being the other way round. The callback
/// stores; it never publishes, so a layout pass cannot ask itself for another one.
private struct IconButtonArtworkReader: View {
  let onMeasure: (CGSize) -> Void

  var body: some View {
    GeometryReader { proxy in
      // Read where SwiftUI hands the size over, and store. This is the same move
      // ``IconButtonContent/body`` makes with `recordDrawn`: a statement in the view
      // that has the value, writing plain storage. It deliberately does *not* use
      // `onAppear`/`onChange` - the deployment target is 15.1, where both spellings
      // of the current signature are unavailable and the older one is deprecated -
      // and a body re-evaluation is exactly the moment the new size is known anyway.
      let _ = onMeasure(proxy.size)
      Color.clear
    }
  }
}

/// `.tint()` has no "unset" form, so the default keeps SwiftUI's accent colour -
/// the variant's container for `.borderedProminent`, the glyph for the others.
private struct OptionalIconButtonTint: ViewModifier {
  let color: UIColor?

  func body(content: Content) -> some View {
    if let color {
      content.tint(Color(color))
    } else {
      content
    }
  }
}

/// The Hybrid View React renders as `NitroUiIconButton`.
final class HybridNitroUiIconButton: HybridNitroUiIconButtonSpec, RecyclableView {
  private let host: NitroSwiftUIHost<IconButtonContent>

  /// Guards `pixelProbes`, which a probe writes on main and a report reads from
  /// whichever thread Nitro called.
  private let pixelProbesLock = NSLock()

  /// This component's name in the sizing engine: `HybridNitroUiIconButtonComponentName`
  /// in the generated C++, and `getName()` in the generated Kotlin.
  private static let sizingComponentName = "NitroUiIconButton"

  /// The size to lay an IconButton out with before anything has been measured, in
  /// points.
  ///
  /// The engine's fallback is keyed by component alone, so this is one number for
  /// every configuration (`HybridNitroUiButton.swift` explains why): here it is
  /// the default configuration - the **press** form at `medium`/`uniform` with the
  /// variant and shape defaults - and `docs/components/icon-button.md` carries the
  /// measured rung table. Unlike Button, no configuration of this control is *much*
  /// wider than this - the glyph is the whole content - so one number is a fair
  /// first frame for every rung rather than a compromise between a title and a
  /// paragraph.
  ///
  /// Measured on the device (`harness:ios`'s Conformance run compares this row
  /// against the control's own measurement): with the 44 pt target floor
  /// (`IconButtonContent/minimumTouchTarget`) every rung up to and including
  /// `xxlarge` is *under* the floor - the largest glyph box measured 40.67 x 38 - so
  /// the default configuration, and every other `standard` rung, is laid out at
  /// exactly 44 x 44 pt. Before the floor this row said 25 x 23, the glyph plus what
  /// the `.borderless` style adds, and the version before that said 32 x 32 from an
  /// off-device estimate and went red against the real number.
  ///
  /// The floor also makes the declaration true for **every** rung rather than only
  /// for the default one: the glyph boxes run 20.33 x 19 up to 40.67 x 38, all inside
  /// 44, so no cold first frame is further from its control than this one is. See the
  /// table in the docs page for the glyph and the box of every rung.
  private static let fallbackSize = (width: 44.0, height: 44.0)

  private static let declaresFallback: Bool = {
    NitroUiSizing.setFallback(sizingComponentName, fallbackSize.width, fallbackSize.height, NitroUiSizingPolicy.intrinsic.rawValue)
    return true
  }()

  /// Hand this control's declared size to the sizing engine, once per process.
  /// ``NitroUiDeclaredFallbacks`` calls this at startup - Fabric measures a shadow
  /// node before it creates any view, so a fallback declared from `init` is one
  /// measure too late for the first instance (T14). `init` is the backstop.
  static func declareFallback() {
    _ = Self.declaresFallback
  }

  /// The Nitro `view` - created once here and never replaced.
  override init() {
    host = NitroSwiftUIHost(model: IconButtonModel())
    super.init()
    host.wantsContentSize = true
    host.sizingPolicy = .intrinsic
    // An IconButton presents nothing, so it needs no view-controller containment.
    host.needsContainment = false
    Self.declareFallback()
  }

  var view: NitroSwiftUIHost<IconButtonContent> {
    return host
  }

  private var model: IconButtonModel {
    return host.model
  }

  // MARK: - Props
  // Setters only store and mark dirty; everything is applied in `afterUpdate()`.

  var accessibilityLabel: String {
    get { model.accessibilityLabel }
    set {
      guard newValue != model.accessibilityLabel else { return }
      model.accessibilityLabel = newValue
      // Rendered: the title is the element's name, and `.iconOnly` shows none of
      // it - so the box does not move, and this is a repaint only.
      host.markDirty()
    }
  }

  var systemImage: Variant_NullType_String {
    get { model.systemImage.map { .second($0) } ?? .first(.null) }
    set {
      // Only a name that resolves to a symbol reaches the content (Button's rule).
      let next = newValue.asType(String.self).flatMap { UIImage(systemName: $0) == nil ? nil : $0 }
      guard next != model.systemImage else { return }
      model.systemImage = next
      host.markDirty()
      // The glyph *is* the content: a different symbol is a different box on iOS,
      // which is why the wrapper puts it in the size configuration.
      host.noteContentSizeMayHaveChanged()
    }
  }

  var androidIcon: Variant_NullType_String {
    get { model.androidIcon.map { .second($0) } ?? .first(.null) }
    set {
      // Stored, never drawn - iOS has no drawable to paint. No `markDirty()`:
      // nothing that affects the pixels or the box changes here, and the prop is
      // sent on every platform so a repaint for it would cost a frame for nothing.
      model.androidIcon = newValue.asType(String.self)
    }
  }

  var variant: String {
    get { model.variant.rawValue }
    set {
      let next = IconButtonVariant(rawValue: newValue) ?? .standard
      guard next != model.variant else { return }
      model.variant = next
      host.markDirty()
      // `.borderless` and `.bordered` pad differently, so the box moves with it.
      host.noteContentSizeMayHaveChanged()
    }
  }

  var size: String {
    get { model.scale.rawValue }
    set {
      let next = IconButtonScale(rawValue: newValue) ?? .medium
      guard next != model.scale else { return }
      model.scale = next
      host.markDirty()
      host.noteContentSizeMayHaveChanged()
    }
  }

  var width: String {
    get { model.width }
    set {
      // Stored only: no iOS control gets wider from this (the prop's own docstring
      // and the docs page say so). The *wrapper* re-keys on it, which is the part
      // that has to work - the engine must not hand Android's narrow box to a wide
      // configuration - and a stored value keeps the getter honest.
      model.width = newValue
    }
  }

  var shape: String {
    get { model.shape.rawValue }
    set {
      let next = IconButtonShapeKind(rawValue: newValue) ?? .round
      guard next != model.shape else { return }
      model.shape = next
      // The corner is drawn, not measured: a circle and a rounded square at one
      // rung are the same box.
      host.markDirty()
    }
  }

  var disabled: Bool {
    get { model.disabled }
    set {
      guard newValue != model.disabled else { return }
      model.disabled = newValue
      // Repaints only: a disabled control is the same size.
      host.markDirty()
    }
  }

  var tintColor: Variant_NullType_Double {
    get {
      guard let tint = model.tint else { return .first(.null) }
      return .second(tint.nitroUiARGBValue)
    }
    set {
      let next = newValue.asType(Double.self).flatMap(UIColor.init(nitroUiARGB:))
      guard next != model.tint else { return }
      model.tint = next
      host.markDirty()
    }
  }

  var checked: Variant_Bool_NullType {
    get {
      guard let js = model.state.js else { return .second(.null) }
      return .first(js)
    }
    set {
      let next = newValue.asType(Bool.self)
      // Not visual on its own: `displayed` only follows once the event count says
      // JS has caught up. See `afterUpdate()`. Not a form signal either: see the
      // `afterUpdate()` note on `isToggle` for why the form comes from
      // `defaultChecked` and is re-read on every batch.
      model.state.js = next
    }
  }

  var defaultChecked: Variant_Bool_NullType {
    get {
      guard let value = model.defaultChecked else { return .second(.null) }
      return .first(value)
    }
    set {
      let next = newValue.asType(Bool.self)
      model.defaultChecked = next
      // The form itself is decided in `afterUpdate()`, from this value, so that a
      // caller who *stops* using the toggle form is believed as well as one who
      // starts. A `null` here is that signal, and only `afterUpdate()` can act on
      // it without racing the other setter.
      guard model.state.js == nil, !model.didApplyDefault, let seed = next else {
        return
      }
      model.didApplyDefault = true
      guard seed != model.state.displayed else { return }
      model.state.displayed = seed
      host.markDirty()
    }
  }

  var mostRecentEventCount: Double {
    get { Double(model.state.jsEvents) }
    set { model.state.jsEvents = Int(newValue) }
  }

  var testID: Variant_NullType_String {
    get { model.testID.map { .second($0) } ?? .first(.null) }
    set {
      // Nothing to apply: RN's component view already carries `testID` as its
      // `accessibilityIdentifier`. It stays in the spec because Android needs it.
      model.testID = newValue.asType(String.self)
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
      // A new configuration may measure what the old one did; the host must not
      // swallow that report against its dedupe (Button's `nuiSizingKey` setter).
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

  var onCheckedChange: ((Bool, Double) -> Void)? {
    get { model.onCheckedChange }
    set { model.onCheckedChange = newValue }
  }

  // MARK: - Lifecycle

  func afterUpdate() {
    // The form, re-read every batch.
    //
    // `defaultChecked` is non-null exactly when the wrapper is in the toggle form
    // (`IconButton.tsx`: `defaultChecked={isToggle ? controlled.defaultValue :
    // null}`, and `useControlled` answers a `Bool` for `defaultValue` in that form,
    // never `null`), so it is a signal that goes both ways. Reading it here rather
    // than latching `isToggle = true` in a setter is what makes the form
    // *switchable off*: a control that used `onCheckedChange` and now passes only
    // `onPress` has to compose a `Button` again, and a latch could only ever
    // answer "still a toggle". `prepareForRecycle` is not the other half of the
    // story - a form flip is one prop update on a live view.
    //
    // Flipping redraws *and* resizes: a `Toggle(...).toggleStyle(.button)` is a
    // bordered box where a `.borderless` `Button` is a bare glyph, which is why the
    // wrapper puts the form in the size configuration.
    let isToggle = model.defaultChecked != nil
    if isToggle != model.isToggle {
      model.isToggle = isToggle
      if !isToggle {
        // The value half belongs to the toggle form. Leaving a selection behind
        // would let a control that returns to the toggle form show a value its
        // previous toggle left there.
        model.state = NitroUiControlledValue<Bool>(displayed: false)
        model.didApplyDefault = false
      }
      host.markDirty()
      host.noteContentSizeMayHaveChanged()
    }
    // The handshake decides whether React's `checked` wins over what the user just
    // did - including a flip JS refused (§4). The press form has no value to
    // reconcile, so this is a no-op there.
    if model.state.reconcile() {
      host.markDirty()
    }
    host.commit()
  }

  func prepareForRecycle() {
    model.accessibilityLabel = ""
    model.systemImage = nil
    model.androidIcon = nil
    model.variant = .standard
    model.scale = .medium
    model.width = "uniform"
    model.shape = .round
    model.disabled = false
    model.tint = nil
    model.testID = nil
    model.sizingKey = ""
    // The reset the brief asks for, including the resolved icon above: a view that
    // came back still `isToggle`, or still holding the previous owner's selection
    // and default, would show a state nobody asked for.
    model.isToggle = false
    model.state = NitroUiControlledValue<Bool>(displayed: false)
    model.defaultChecked = nil
    model.didApplyDefault = false
    model.onCheckedChange = nil
    model.onPress = nil
    model.clearReports()
    host.prepareForRecycle()
  }

  func onDropView() {
    model.onCheckedChange = nil
    model.onPress = nil
    host.drop()
  }

  // MARK: - Methods

  /// The size SwiftUI wants for this control, from the host's cache. Never touches
  /// the main thread (core-architecture §1.4).
  func measureContent() throws -> NitroUiIconButtonSize {
    guard let size = host.contentSize else {
      return NitroUiIconButtonSize(width: 0, height: 0)
    }
    return NitroUiIconButtonSize(width: Double(size.width), height: Double(size.height))
  }

  /// Press through the tap's path, on main (see the spec). Returns at once.
  func nuiTestPress() throws {
    let model = host.model
    if Thread.isMainThread {
      model.press()
    } else {
      DispatchQueue.main.async { model.press() }
    }
  }

  /// iOS has no node to read in-process: the SwiftUI hosting view answers
  /// `accessibilityElements == []` to anything that is not an accessibility client
  /// (measured in `HybridNitroUiSlider.swift`). Saying so is the answer; the role
  /// and the selected state are XCUITest's to read, in `real-input:ios`. No UI is
  /// touched, so there is nothing to hop for.
  func nuiTestProbeAccessibility() throws {
    host.model.recordAccessibility("unavailable")
  }

  func nuiTestStateReport() throws -> String {
    return host.model.stateReport()
  }

  /// Probes answered since the view mounted, so the report's `n=` counts the
  /// caller's own probe rather than a previous control's.
  private var pixelProbes = 0

  /// Records that a probe was asked for, and answers nothing.
  ///
  /// iOS has no glyph to sample: `androidIcon` is Android's prop and iOS draws
  /// `systemImage` instead, so an iOS probe of an Android icon is a test that
  /// should not be running there. The report says `no pixels`, which the harness's
  /// probe helper treats as a hard failure rather than an answer - the honest
  /// outcome is a red test, not a green one about nothing (Button's reasoning).
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
}

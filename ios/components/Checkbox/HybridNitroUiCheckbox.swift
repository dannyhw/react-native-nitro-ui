//
//  HybridNitroUiCheckbox.swift
//  react-native-nitro-ui
//
//  The Checkbox component. iOS has no checkbox - `CheckboxToggleStyle` is
//  `@available(iOS, unavailable)` in the SDK - so this is SwiftUI's `Toggle` wearing a
//  style of ours that draws Apple's checklist glyph (`checkmark.circle.fill` over
//  `circle`, or the square pair), which is what Reminders and Notes draw and what
//  DECISIONS D47 settled on after a Checkbox that looked exactly like a Switch read as
//  the wrong component. `iosStyle='switch'` is what this shipped with under D38 item 1
//  - Expo's answer, the system's own control, unchanged.
//
//  Either way the control is Apple's and the symbols are Apple's: nothing here
//  imitates a control (D38 item 1), and the tap, the value and the accessibility
//  element are one code path for all three styles. The glyph table is in
//  `NitroUiCheckboxGlyph.swift`, which is also the only place the whole table runs.
//
//  The structure is Switch's for the value (`HybridNitroUiSwitch.swift`: the
//  event-count handshake) and Chip's for the label (`HybridNitroUiChip.swift`: a
//  label is content, so it is in the sizing key and a new one asks for a new
//  measure). What is its own is the name: with no label the switch has nothing to
//  read, so `accessibilityLabel` is applied with a label-less `Toggle`'s own
//  `.accessibilityAddTraits(.isToggle)` already in place.
//

import NitroModules
import SwiftUI
import UIKit

/// State of one Checkbox. See ``NitroUiModel`` for why this is not `@Published`.
final class CheckboxModel: NitroUiModel {
  /// The checkbox's value, behind the event-count handshake (§4).
  var state = NitroUiControlledValue<Bool>(displayed: false)
  var defaultChecked: Bool?
  var didApplyDefault = false
  /// Three-state display: the dash glyph (`minus.circle.fill` / `minus.square.fill`),
  /// which D47 item 3 gave this platform. The `'switch'` style still has two positions
  /// and reads it as off, so the *style* decides whether it is drawn - see
  /// `showsThirdState` in ``CheckboxContent``.
  var indeterminate = false
  /// Which picture to draw (DECISIONS D47 item 2). `'switch'` is everything below as it
  /// shipped; the two glyph styles change the drawing and the box, nothing else.
  var iosStyle: NitroUiCheckboxStyle = .circle
  /// Text beside the glyph or switch, or `nil`. Content: it is width, and it is the name.
  var label: String?
  var disabled = false
  var tint: UIColor?
  var testID: String?
  /// `accessibilityLabel`, or `nil` to fall back to ``label``.
  var accessibilityLabel: String?
  /// The size configuration React sent; the engine reads it out of Fabric state.
  var sizingKey = ""
  /// `onCheckedChange`, wired through a stable JS callback.
  var onChange: ((_ checked: Bool, _ eventCount: Double) -> Void)?

  /// Test-only read-outs (`nuiTestStateReport`). Plain storage behind a lock,
  /// never `@Published`: the body writes `drawn`, and publishing from the body
  /// would ask for the update that has just happened.
  private let reportLock = NSLock()
  private var drawn = "none"
  private var symbol = "none"
  private var probes = 0
  private var merged = "none"
  private var accessibilityReport = "none"

  override init() {
    super.init()
  }

  /// The user tapped - from the Toggle's binding, or from ``press()``. Native is
  /// optimistic: show the new value now, before React has seen the event, so there
  /// is no visual latency (§4).
  func userToggle(to requested: Bool) {
    let eventCount = state.user(requested)
    objectWillChange.send()
    onChange?(requested, Double(eventCount))
  }

  /// One press, through the path a tap takes: the opposite of what the switch shows.
  /// Refused while disabled, as `.disabled(true)` refuses a tap.
  ///
  /// It has to be a toggle and not "ask for checked": this platform's `Toggle` is a
  /// two-position control whose real taps go through the binding below with the value
  /// SwiftUI computed, so a hook that always asked for `true` would differ from the
  /// tap it stands in for, and a switch that cannot be turned off by being pressed
  /// would read as a control the harness - and only the harness - can turn off.
  /// `Checkbox.harness.tsx`'s second toggle measures this.
  func press() {
    guard !disabled else { return }
    userToggle(to: !state.displayed)
  }

  /// Record what the drawing code was handed: `1`, `0`, or `mixed` for the dash the two
  /// glyph styles draw (DECISIONS D47 item 3). `'switch'` never answers `mixed` - that
  /// control has two positions - which is the point `Checkbox.harness.tsx` pins by
  /// reading the same flag that decides the picture.
  func recordDrawn(_ value: String) {
    reportLock.lock()
    drawn = value
    reportLock.unlock()
  }

  /// Record the symbol the drawing code was handed - the SF Symbol name for a glyph
  /// style, or `switch` for the style that draws none of ours.
  ///
  /// This is how a device test checks *which picture* a style drew: the hosting view
  /// answers `accessibilityElements == []` to anything that is not an accessibility
  /// client (``nuiTestProbeAccessibility``), and a pixel probe would have to name the
  /// colour before it knew what was on screen. Read where the control is drawn, like
  /// ``recordDrawn``, so it is the picture the `Toggle` was handed and not an echo of the
  /// prop - and `checked`/`unchecked`/`indeterminate` answer three different names, which
  /// is what makes "the glyph changed with the state" a comparison rather than a claim.
  func recordSymbol(_ value: String) {
    reportLock.lock()
    symbol = value
    reportLock.unlock()
  }

  /// Record how many nodes a reader is offered. iOS answers `unavailable` for the
  /// probe, and `merged` with it, rather than inventing a count it cannot read.
  func recordMerged(_ value: String) {
    reportLock.lock()
    merged = value
    reportLock.unlock()
  }

  /// Store a probe's answer and count it, so a test can tell it from the last one.
  func recordAccessibility(_ report: String) {
    reportLock.lock()
    probes += 1
    accessibilityReport = report
    reportLock.unlock()
  }

  /// `displayed=…;probes=…;merged=…;a11y=…;symbol=…`. Safe from any thread.
  ///
  /// `symbol` is iOS's half of "what is on screen": `displayed` is the state and `symbol`
  /// is the picture it wears, and the two differ exactly once - the dash, which is
  /// `mixed` wearing `minus.circle.fill`. The `'switch'` style answers `symbol=switch`.
  /// Android has no symbol of ours to name and leaves the field out, as it has always
  /// left `labelBox` out on iOS.
  func stateReport() -> String {
    reportLock.lock()
    defer { reportLock.unlock() }
    return "displayed=\(drawn);probes=\(probes);merged=\(merged);a11y=\(accessibilityReport);symbol=\(symbol)"
  }

  /// Back to "nothing yet", for recycling: a reused view whose report still
  /// described the previous owner's checkbox would let a test read that owner's state.
  func clearReports() {
    reportLock.lock()
    drawn = "none"
    symbol = "none"
    probes = 0
    merged = "none"
    accessibilityReport = "none"
    reportLock.unlock()
  }
}

/// The SwiftUI half. Reads only the model, so any commit can rebuild it.
struct CheckboxContent: NitroUIContent {
  /// The subscription to ``NitroUiModel/objectWillChange``.
  @ObservedObject private var model: CheckboxModel

  init(model: CheckboxModel) {
    self.model = model
  }

  // `@ViewBuilder` so the read-outs below can be statements: without them a `Void`
  // statement would be the body's value.
  @ViewBuilder var body: some View {
    // The switch style has two positions, so it neither draws the third state nor
    // claims it: one flag says whether the dash is on screen, and the drawing, the
    // `displayed` read-out and the announced value all read *that* rather than each
    // asking about the style again.
    let showsThirdState = model.indeterminate && model.iosStyle.drawsGlyph
    // The reading `nuiTestStateReport()` answers with: taken where the control is
    // drawn, so it is what the Toggle is handed rather than what React sent. `mixed` is
    // the dash, which iOS now draws too - the state and its picture are `recordSymbol`.
    let drawn = model.state.displayed ? "1" : (showsThirdState ? "mixed" : "0")
    let glyph = NitroUiCheckboxGlyphs.glyph(
      style: model.iosStyle,
      checked: model.state.displayed,
      indeterminate: showsThirdState
    )
    let _ = model.recordDrawn(drawn)
    let _ = model.recordSymbol(glyph?.symbol ?? "switch")
    let name = model.accessibilityLabel ?? model.label
    Toggle(isOn: Binding(
      get: { model.state.displayed },
      set: { requested in model.userToggle(to: requested) }
    )) {
      // With no label the Toggle still needs an empty one: `Toggle("", isOn:)` and
      // `labelsHidden()` is what Switch does for the same reason, so a checkbox
      // without text is the control and nothing else. The glyph style asks the same
      // question one rung later and leaves the empty text out of its row
      // (`showsLabel`), because a `HStack` charges spacing for a zero-width child.
      if let label = model.label {
        Text(label).lineLimit(1)
      } else {
        Text("")
      }
    }
    // A `Toggle` with a label keeps the label visible; a label-less one hides the empty
    // text so the box is the control alone.
    .modifier(OptionalHideLabels(hidden: model.label == nil))
    // DECISIONS D47: the checklist glyph for the two default styles, and the system's
    // switch for `'switch'` - the look, the box and the read-out that came with it.
    .modifier(
      CheckboxToggleStyleModifier(
        style: model.iosStyle,
        showsThirdState: showsThirdState,
        showsLabel: model.label != nil,
        disabled: model.disabled,
        tint: model.tint
      )
    )
    .disabled(model.disabled)
    .modifier(OptionalTint(color: model.tint))
    // A checkbox with no text has no name, and the one thing that gives it one is
    // this: `accessibilityLabel(_:)` on the Toggle, which an empty label does not
    // (an empty `accessibilityLabel("")` would silence the text it does have, so it
    // is applied only when there is a name - Switch's and Chip's rule).
    .modifier(OptionalAccessibility(label: name))
    // The third state's word, for the one state whose picture and value disagree.
    //
    // A `Toggle` is two-position, so its element can only say checked or unchecked; the
    // dash is drawn by a control that is *not* checked, and a reader told "off" about a
    // box showing a dash is being told about a different box. Android's Material
    // publishes `ToggleableState.Indeterminate` and TalkBack reads it as "Mixed", so iOS
    // says the same word and neither platform invents a third `checked` value.
    //
    // Measured, not assumed: `real-input:ios`'s a11y sweep prints the element this ends
    // up with (`trait=… value=…`), which is the closest thing to a transcript this
    // suite can read, and `docs/components/checkbox.md` quotes what it said.
    .modifier(OptionalAccessibilityValue(value: showsThirdState ? "mixed" : nil))
    // The label is part of the control, so touching it is touching the control - which
    // is also what Android's merged `Row` node does.
    //
    // For the switch style this is a measured necessity and not a guess: a press on a
    // labelled switch-style Checkbox's label was measured here (`real-input:ios
    // --control checkbox`) as no `value` change and no event at all, while a press on the
    // glyph toggled. For a glyph row it is the only tap target there is - the style draws
    // a symbol and a text and installs no gesture of its own, so without this row
    // handler nothing on the control would answer a touch at all. Either way the row gets
    // one target, and it asks through the hook a press is documented to take - `press()`:
    // the opposite of what the box shows, refused while `disabled`.
    //
    // It has to be an overlay, and not the `background` layer one would rather write.
    // That version was tried on this simulator and measured: three presses on the row's
    // middle left the switch at `off` with its own element's `value` unmoved, because a
    // `Toggle` claims the whole row for hit testing and acts on the glyph only, so a layer
    // *behind* it is never asked and the label's touches die in the control that owns the
    // row. In front, they cannot be missed.
    //
    // What the overlay takes from the glyph is SwiftUI's press feedback and the thumb's
    // drag; what it buys is that one press of this control is exactly one `onCheckedChange`
    // wherever it lands, and the glyph is no exception - `testRealInputCheckbox` taps the
    // glyph and counts, which is the assertion that a row handler and the `Toggle`'s own
    // gesture both answering the same touch would go red on. Out of the accessibility tree,
    // so the element a reader meets is still the switch.
    // One element for a reader, on the row's own box (DECISIONS D47 item 3).
    //
    // Measured on the device by `real-input:ios`'s accessibility sweep, a custom
    // `ToggleStyle` does not get the accessibility SwiftUI's own styles get: the element
    // a reader reaches is built from the style's *content*, so a glyph row read as three
    // stops - the `Toggle` (named, valued, and laid out at 107 x 21.67 pt inside a
    // control laid out at 109 x 26), the symbol as an image named "Circle", and the row's
    // text as static text of its own. Two of those are things a person has to skip to
    // reach the control, and a name 2 pt off the box the finger presses is exactly the
    // finding `scripts/real-input/a11y.mjs` fails a control for. Neither of the two
    // obvious fixes measures out: `.accessibilityHidden(true)` on the symbol leaves the
    // symbol in the tree with its "Circle" name, and
    // `.accessibilityElement(children: .ignore)` - in the style or on the `Toggle` - adds
    // an element rather than replacing one, and loses the toggle trait with it.
    //
    // `accessibilityRepresentation` replaces the row's accessibility with a `Toggle`'s
    // that is never drawn, and it is the only shape measured here that answers all four
    // questions at once: one element (no symbol stop, no text stop), the control's name,
    // the value - including `mixed` for the dash - and the row's own box, one pixel of
    // height taller than the host's (1/3 pt, inside the rule's half-point tolerance).
    // The bare case gains the most: unnamed, its element used to be the symbol, named
    // "Circle", at 21.67 pt; named with `accessibilityLabel`, it is now that name on the
    // 26 pt box.
    //
    // `.disabled` is restated inside the representation because the representation is a
    // separate view: measured without it, a *disabled* Checkbox's element answered
    // `enabled=true` to a reader, which is a worse announcement than the inset box this
    // replaced. The `'switch'` style is not represented at all - its element is already
    // the row, at the box the sweep has read since D38 - so D47 changes nothing about
    // what a reader meets for the look it kept.
    .modifier(
      CheckboxGlyphAccessibility(
        glyph: model.iosStyle.drawsGlyph,
        name: name ?? "",
        isOn: model.state.displayed,
        setOn: { requested in model.userToggle(to: requested) },
        disabled: model.disabled,
        value: showsThirdState ? "mixed" : nil
      )
    )
    .overlay {
      Color.clear
        .contentShape(Rectangle())
        .accessibilityHidden(true)
        .onTapGesture { model.press() }
    }
  }
}

/// The two glyph styles of DECISIONS D47: the system's checklist symbol, then the label
/// beside it.
///
/// A style of ours on Apple's `Toggle`, which is what keeps every promise the component
/// makes: the binding is the Toggle's, so a press means "the opposite of what is showing"
/// here exactly as it does in the switch style; `.disabled` refuses the touch and dims
/// the row; and the symbol is `.font(…)`-sized, so Dynamic Type scales the glyph with the
/// label instead of leaving a 1990s-sized box behind large text.
///
/// It says nothing to a reader, on purpose. What the elements of a custom style's content
/// become is measured in `CheckboxContent/body` - three stops, with the name 2 pt off the
/// box - which is why the row's one element comes from `CheckboxGlyphAccessibility`
/// rather than from anything in here: a symbol and a text that are *pictures of* the
/// state have no announcement to make.
///
/// It draws and does not intercept. The row's tap target is applied to the control in
/// ``CheckboxContent/body`` - one target for all three styles, for the measured reason
/// spelled out there - so this style cannot answer a touch twice.
private struct CheckboxGlyphToggleStyle: ToggleStyle {
  /// `circle` or `square`: the two glyph styles are one symbol pair apart and nothing
  /// else, which is also why they share a sizing rule.
  let style: NitroUiCheckboxStyle
  /// Is the dash the state on screen? (`checked` outranks it - see the table.)
  let showsThirdState: Bool
  /// Is there a label to show? `labelsHidden()` is honoured by SwiftUI's own styles,
  /// not by this one, so the empty text a label-less `Toggle` carries has to be left
  /// out here - an `HStack` charges its spacing for a zero-width child, and a bare
  /// checkbox would measure a glyph plus a gap it never drew.
  let showsLabel: Bool
  /// Whether the row dims. `.disabled(…)` is applied to the `Toggle` outside this
  /// style, and it is the same fact the row needs to look like a disabled control.
  let disabled: Bool
  /// The accent a state glyph takes, or `nil` for the app's own accent colour.
  let tint: UIColor?

  func makeBody(configuration: Configuration) -> some View {
    let glyph = NitroUiCheckboxGlyphs.glyph(
      style: style,
      checked: configuration.isOn,
      indeterminate: showsThirdState
    )
    // SwiftUI's own spacing between an image and a text - not an invented number. It is
    // what a row of `Image` + `Text` gets on this platform, and it is the spacing the
    // label's own font decides, which is the pair Dynamic Type needs to stay in step.
    return HStack {
      Image(systemName: glyph?.symbol ?? "circle")
        // The body font, which is the font the label inherits: the glyph rides the
        // same text style, so a larger accessibility size grows the box and its label
        // together (and the sizing engine's environment epoch is what re-measures it).
        .font(.body)
        .imageScale(.large)
        .symbolRenderingMode(.monochrome)
        .foregroundStyle(
          glyph?.filled == true
            ? (tint.map { Color(uiColor: $0) } ?? Color.accentColor)
            : Color(uiColor: .secondaryLabel)
        )
      if showsLabel {
        configuration.label
      }
    }
    .opacity(disabled ? 0.5 : 1)
  }
}

/// Puts one of the three iOS looks on the `Toggle`.
///
/// `.toggleStyle(…)` takes a different concrete style per branch, so the choice is a
/// modifier and not an argument - the `OptionalTint` shape below, for the same reason:
/// the branches belong together, and the call site keeps one chain of modifiers that
/// every style shares (`disabled`, the tint, the name, the row's tap target).
private struct CheckboxToggleStyleModifier: ViewModifier {
  let style: NitroUiCheckboxStyle
  let showsThirdState: Bool
  let showsLabel: Bool
  let disabled: Bool
  let tint: UIColor?

  @ViewBuilder func body(content: Content) -> some View {
    switch style {
    case .toggle:
      // D38 item 1's look, and the branch that keeps it: SwiftUI draws every pixel of
      // this control, so nothing above or below this line changes its box, its element
      // or its read-out.
      content.toggleStyle(.switch)
    case .circle, .square:
      content.toggleStyle(
        CheckboxGlyphToggleStyle(
          style: style,
          showsThirdState: showsThirdState,
          showsLabel: showsLabel,
          disabled: disabled,
          tint: tint
        )
      )
    }
  }
}

/// The glyph styles' one accessibility element: the platform's `Toggle`, represented
/// rather than drawn, on the row's box.
///
/// ``CheckboxContent/body`` carries the reason, measured. It is a modifier because
/// `.accessibilityRepresentation` replaces the accessibility of everything it is applied
/// to: the glyph branch gets it, the `'switch'` branch gets the element SwiftUI builds
/// for itself, and the chain above (the name, the third state's word) stays one chain
/// that every style shares. The name and the value inside the representation are the
/// same two values the chain applies, from the same two sources, so a reader is told the
/// same thing whichever style drew the row.
private struct CheckboxGlyphAccessibility: ViewModifier {
  /// Glyph styles only; `'switch'` keeps its own element.
  let glyph: Bool
  /// The control's name - `accessibilityLabel`, else `label` - or empty for no name.
  let name: String
  let isOn: Bool
  let setOn: (Bool) -> Void
  /// Restated inside the representation, which does not inherit it.
  let disabled: Bool
  /// The third state's word, or `nil` to let the `Toggle`'s own checked/unchecked answer
  /// through (`NitroUiCheckboxGlyphs.accessibilityValue`'s rule).
  let value: String?

  @ViewBuilder func body(content: Content) -> some View {
    if glyph {
      content.accessibilityRepresentation {
        Toggle(name, isOn: Binding(get: { isOn }, set: { requested in setOn(requested) }))
          .modifier(OptionalAccessibilityValue(value: value))
          .disabled(disabled)
      }
    } else {
      content
    }
  }
}

/// `.labelsHidden()` has no "keep the label" form, so it is applied only when there
/// is nothing to show.
private struct OptionalHideLabels: ViewModifier {
  let hidden: Bool

  func body(content: Content) -> some View {
    if hidden {
      content.labelsHidden()
    } else {
      content
    }
  }
}

/// `.tint()` has no "unset" form, so the default keeps SwiftUI's accent colour.
private struct OptionalTint: ViewModifier {
  let color: UIColor?

  func body(content: Content) -> some View {
    if let color {
      // `tint(_:)` takes a `ShapeStyle`, and `UIColor` is not one.
      content.tint(Color(color))
    } else {
      content
    }
  }
}

/// `.accessibilityValue(_:)` has no "leave the control's own value alone" form either, so
/// the third state's word is applied only for the third state. Same rule as the name
/// below: an empty value would silence what the `Toggle` has to say about itself.
private struct OptionalAccessibilityValue: ViewModifier {
  let value: String?

  func body(content: Content) -> some View {
    if let value {
      content.accessibilityValue(Text(value))
    } else {
      content
    }
  }
}

/// An empty `accessibilityLabel(_:)` would silence the Toggle's own label, so it is
/// applied only when set. `testID` deliberately does *not* go in here: RN already
/// puts it on the component view, and putting it on the SwiftUI element too would
/// make the view match a testID query twice.
private struct OptionalAccessibility: ViewModifier {
  let label: String?

  func body(content: Content) -> some View {
    if let label {
      content.accessibilityLabel(label)
    } else {
      content
    }
  }
}

/// The Hybrid View React renders as `NitroUiCheckbox`.
final class HybridNitroUiCheckbox: HybridNitroUiCheckboxSpec, RecyclableView {
  private let host: NitroSwiftUIHost<CheckboxContent>

  /// This component's name in the sizing engine: `HybridNitroUiCheckboxComponentName`
  /// in the generated C++, and `getName()` in the generated Kotlin.
  private static let sizingComponentName = "NitroUiCheckbox"

  /// The size to lay a Checkbox out with before anything has been measured, in
  /// points.
  ///
  /// One number for every configuration, for the reason Button's is (the engine keys
  /// fallbacks by component alone), and it is the *default* configuration's box: a
  /// checkbox with no label, in the default `'circle'` style, is what an app draws
  /// first. `Checkbox.harness.tsx` measures that box on the device - 26x26 pt on
  /// iPhone Air / iOS 27 - and `scripts/conformance-core.mjs` keeps this number
  /// beside it, because a fallback that drifts from the box it names is a guess with
  /// a number in it.
  ///
  /// Until DECISIONS D47 this read the Switch's box - 61x28 pt from iOS 26, 51x31 pt
  /// before it, with the same OS check `HybridNitroUiSwitch.swift` makes - because a
  /// Checkbox on iOS *was* a `Toggle(.switch)`. It is not any more, and the glyph's
  /// measure is an SF Symbol's, which does not care about the SDK split that moves
  /// the switch's thumb; hence one constant where that needed two. `'switch'` remains
  /// one configuration of three, and its box is in the measured table in
  /// `docs/components/checkbox.md` alongside the other two.
  private static let declaresFallback: Bool = {
    NitroUiSizing.setFallback(sizingComponentName, 26.0, 26.0, NitroUiSizingPolicy.intrinsic.rawValue)
    return true
  }()

  /// Hand this control's declared size to the sizing engine, once per process
  /// (the static above is lazy and thread-safe, so repeat calls cost nothing).
  ///
  /// ``NitroUiDeclaredFallbacks`` calls this at startup, which is the point that
  /// matters: Fabric measures a Checkbox's shadow node before it creates any
  /// Checkbox view, so a fallback declared from `init` is one measure too late for
  /// the first instance (T14). `init` still calls it, as the backstop.
  static func declareFallback() {
    _ = Self.declaresFallback
  }

  /// The Nitro `view` - created once here and never replaced.
  override init() {
    host = NitroSwiftUIHost(model: CheckboxModel())
    super.init()
    // A checkbox presents nothing, so it needs no view-controller containment.
    host.needsContainment = false
    host.wantsContentSize = true
    host.sizingPolicy = .intrinsic
    Self.declareFallback()
  }

  var view: NitroSwiftUIHost<CheckboxContent> {
    return host
  }

  private var model: CheckboxModel {
    return host.model
  }

  // MARK: - Props
  // Setters only store and mark dirty; everything is applied in `afterUpdate()`.

  var checked: Variant_Bool_NullType {
    get {
      guard let js = model.state.js else { return .second(.null) }
      return .first(js)
    }
    set {
      // Not visual on its own: `displayed` only follows once the event count says
      // JS has caught up. See `afterUpdate()`.
      model.state.js = newValue.asType(Bool.self)
    }
  }

  var defaultChecked: Variant_Bool_NullType {
    get {
      guard let value = model.defaultChecked else { return .second(.null) }
      return .first(value)
    }
    set {
      model.defaultChecked = newValue.asType(Bool.self)
      guard model.state.js == nil, !model.didApplyDefault, let seed = model.defaultChecked else {
        return
      }
      model.didApplyDefault = true
      guard seed != model.state.displayed else { return }
      model.state.displayed = seed
      host.markDirty()
    }
  }

  /// Rendered wherever the style can draw it: the two glyph styles have a dash
  /// (`minus.circle.fill` / `minus.square.fill`, D47 item 3) and `'switch'` does not, so
  /// the same prop marks dirty for one style and only stores for the other. The style
  /// branch lives in the content (`showsThirdState`), which is what reads it; the setter
  /// marks dirty for both because a style change and a value change arrive in one batch
  /// and `commit()` applies the batch, not the prop.
  ///
  /// No `noteContentSizeMayHaveChanged()`: the dash, the check mark and the empty box are
  /// one symbol box, which `Checkbox.harness.tsx` measures (`keeps its size checked and
  /// unchecked`) - and that is also why the harness's key has to keep agreeing.
  var indeterminate: Variant_Bool_NullType {
    get { .first(model.indeterminate) }
    set {
      let next = newValue.asType(Bool.self) ?? false
      guard next != model.indeterminate else { return }
      model.indeterminate = next
      host.markDirty()
    }
  }

  /// Which picture this platform draws (DECISIONS D47). A different control's box, so
  /// this is the size-affecting prop of the component: it repaints *and* asks for a new
  /// measure, and `Checkbox.tsx` puts it in the iOS sizing key.
  var iosStyle: String {
    get { model.iosStyle.rawValue }
    set {
      let next = NitroUiCheckboxStyle.resolve(newValue)
      guard next != model.iosStyle else { return }
      model.iosStyle = next
      host.markDirty()
      // The three styles measure apart - a bare 61x28 switch against a bare 26x26
      // glyph, and the two glyph shapes are 2 pt apart from each other - and the
      // engine only learns that from this instance's next report.
      host.noteContentSizeMayHaveChanged()
    }
  }

  var mostRecentEventCount: Double {
    get { Double(model.state.jsEvents) }
    set { model.state.jsEvents = Int(newValue) }
  }

  var label: Variant_NullType_String {
    get { model.label.map { .second($0) } ?? .first(.null) }
    set {
      let next = newValue.asType(String.self)
      guard next != model.label else { return }
      model.label = next
      host.markDirty()
      // A different string is a different width, and no bounds or trait change is
      // coming to say so (Chip's `label` setter).
      host.noteContentSizeMayHaveChanged()
    }
  }

  var disabled: Bool {
    get { model.disabled }
    set {
      guard newValue != model.disabled else { return }
      model.disabled = newValue
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

  var testID: Variant_NullType_String {
    get { model.testID.map { .second($0) } ?? .first(.null) }
    set {
      // Nothing to apply: `testID` is an RN base prop too, and
      // `RCTViewComponentView` already puts it on the component view as
      // `accessibilityIdentifier`. It stays in the spec because Android needs it as
      // a `tag`.
      model.testID = newValue.asType(String.self)
    }
  }

  var accessibilityLabel: Variant_NullType_String {
    get { model.accessibilityLabel.map { .second($0) } ?? .first(.null) }
    set {
      // Rendered, not bookkeeping: the name is on the SwiftUI element, so it needs a
      // commit or a late-set name never reaches VoiceOver.
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
      // A new configuration may measure what the old one did - `'circle'` and `'square'`
      // are expected to - and the host must not swallow that report against its dedupe
      // (Button's and Chip's `nuiSizingKey` setters, and review F1's stuck fallback).
      host.noteSizingKeyChanged()
    }
  }

  var nuiSizingId: Double {
    get { Double(host.sizingInstanceId) }
    set { host.sizingInstanceId = Int64(newValue) }
  }

  var onCheckedChange: ((Bool, Double) -> Void)? {
    get { model.onChange }
    set { model.onChange = newValue }
  }

  // MARK: - Lifecycle

  func afterUpdate() {
    // The event-count handshake decides whether React's `checked` wins over what
    // the user just did - including a change JS rejected (§4).
    if model.state.reconcile() {
      host.markDirty()
    }
    host.commit()
  }

  func prepareForRecycle() {
    model.state = NitroUiControlledValue<Bool>(displayed: false)
    model.defaultChecked = nil
    model.didApplyDefault = false
    model.indeterminate = false
    model.iosStyle = .circle
    model.label = nil
    model.disabled = false
    model.tint = nil
    model.testID = nil
    model.accessibilityLabel = nil
    model.sizingKey = ""
    model.onChange = nil
    model.clearReports()
    host.prepareForRecycle()
  }

  func onDropView() {
    model.onChange = nil
    host.drop()
  }

  // MARK: - Methods

  /// The size SwiftUI wants for this Toggle, from the host's cache.
  ///
  /// Never touches the main thread: this can be called from JS, and SwiftUI may
  /// only be measured on main (core-architecture §1.4).
  func measureContent() throws -> NitroUiCheckboxSize {
    guard let size = host.contentSize else {
      return NitroUiCheckboxSize(width: 0, height: 0)
    }
    return NitroUiCheckboxSize(width: Double(size.width), height: Double(size.height))
  }

  /// Toggle through the tap's path, on the UI thread (see the spec). Returns at once.
  func nuiTestToggle() {
    DispatchQueue.main.async { [host] in
      host.model.press()
    }
  }

  /// Records `unavailable` - see the spec, and `HybridNitroUiSlider.swift` and
  /// `HybridNitroUiChip.swift` for the measurement this rests on: a SwiftUI hosting
  /// view answers `accessibilityElements == []` to anything that is not an
  /// accessibility client, so there is nothing to read in-process. The role and the
  /// checked value are XCUITest's to assert, in `real-input:ios`.
  func nuiTestProbeAccessibility() {
    DispatchQueue.main.async { [host] in
      host.model.recordMerged("unavailable")
      host.model.recordAccessibility("unavailable")
    }
  }

  func nuiTestStateReport() throws -> String {
    return model.stateReport()
  }
}

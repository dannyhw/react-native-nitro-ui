//
//  HybridNitroUiProgress.swift
//  react-native-nitro-ui
//
//  The Progress component: SwiftUI `ProgressView` in its `.linear` and
//  `.circular` styles, on the core runtime.
//
//  It is the library's first **non-interactive** component, so it is the one
//  place that shows what a control without a handshake looks like
//  (`docs/architecture/core.md` §12): no `NitroUiControlledValue`, no
//  `mostRecentEventCount`, no callback props. `afterUpdate()` is `host.commit()`
//  and nothing else, which is exactly why a `value` written at 60 Hz costs one
//  props commit and no round trip.
//

import NitroModules
import SwiftUI
import UIKit

/// State of one Progress. See ``NitroUiModel`` for why this is not `@Published`.
final class ProgressModel: NitroUiModel {
  /// `'linear'` or `'circular'`. Rendered (it picks the style), so the body reads
  /// it.
  var variant = "linear"
  /// The fraction React sent, unclamped, or `nil` for an indeterminate indicator.
  /// Clamping happens where it is drawn (``drawnValue``), because the drawing code
  /// is what has to stay in range while the prop getter has to answer what was
  /// sent.
  var value: Double?
  var tint: UIColor?
  /// Stored and *not painted*: SwiftUI's `ProgressView` has no API that addresses
  /// its track (`docs/components/progress.md`). It is a prop anyway so that the JS
  /// API means one thing, and the value round-trips.
  var track: UIColor?
  var testID: String?
  var accessibilityLabel: String?
  /// The size configuration React sent (`''` / `'circular'`). Stored for
  /// symmetry; the sizing engine reads the key out of Fabric state itself.
  var sizingKey = ""
  /// Whether the hosted view is in a window. Rendered: an indeterminate indicator
  /// is the only thing in this library that draws itself forever, and off-window
  /// nobody is watching it (see ``drawnValue``).
  ///
  /// Written on the main thread by ``NitroUiProgressWindowObserver`` and by the
  /// recycle/drop path; read on the main thread by the body, and from any thread
  /// through ``isAnimating``.
  var inWindow = false {
    didSet {
      if inWindow != oldValue {
        // The flag is rendered, so a window change is an invalidation - and it
        // arrives outside a props commit, the only other place `objectWillChange`
        // is sent (`NitroSwiftUIHost.commit()`).
        objectWillChange.send()
      }
    }
  }
  /// Guards the two mirrors below: they are written on the main thread and read on
  /// the JS thread. One lock, because the invariant the harness asserts spans both
  /// ("indeterminate *and* on screen"). Same pattern as
  /// `NitroUiFramePump.isArmed` (`HybridNitroUiSlider.swift:56`).
  private let mirrorLock = NSLock()
  /// What the drawing code was last handed, as one line - written by the body.
  private var drawnReport = "displayed=none"
  /// Whether this control is allowed to be animating right now. Written where both
  /// halves are known (the body, and the window observer). Never derived on the JS
  /// thread: reading `UIView.window` there would be off-main.
  private var animating = false

  /// The fraction to hand the drawing code, clamped into range, or `nil` for the
  /// indeterminate indicator.
  ///
  /// The off-window rule: an indeterminate `ProgressView` runs an animation of its
  /// own, so a control nobody can see would keep asking for frames. Away from a
  /// window it is drawn as an **empty determinate** indicator in the same style -
  /// same style, so the measured size does not move, and empty because that is the
  /// one determinate state that needs no motion. Re-entering a window restores it.
  /// Android applies the same rule, and the harness asserts the shared invariant.
  var drawnValue: Double? {
    if let value {
      return value.isFinite ? min(max(value, 0), 1) : 0
    }
    return inWindow ? nil : 0
  }

  /// Record what the drawing code was handed, from the body.
  func recordDrawn(_ drawn: Double?) {
    mirrorLock.lock()
    drawnReport = drawn.map { "displayed=\($0)" } ?? "displayed=indeterminate"
    animating = drawn == nil && inWindow
    mirrorLock.unlock()
  }

  /// Say so from somewhere that is not the body (the window observer, a recycle),
  /// keeping the one-line report in step with the flag.
  func refreshAnimationReport() {
    recordDrawn(drawnValue)
  }

  /// What the control displays, as one line. Thread-safe.
  var displayedReport: String {
    mirrorLock.lock()
    defer { mirrorLock.unlock() }
    return drawnReport
  }

  /// Whether the control is allowed to be animating. Thread-safe.
  var isAnimating: Bool {
    mirrorLock.lock()
    defer { mirrorLock.unlock() }
    return animating
  }

  /// The value as an accessibility percentage: `0...1` to `"0%"..."100%"`.
  static func percent(_ value: Double) -> String {
    "\(Int((min(max(value, 0), 1) * 100).rounded()))%"
  }

  override init() {
    super.init()
  }
}

/// A zero-size UIKit sibling of the hosted SwiftUI view whose only job is to
/// report window membership.
///
/// Why it exists: `NitroSwiftUIHost` is `final`, so a component cannot override its
/// `didMoveToWindow`, and "the indeterminate animation stops when nobody can see
/// the control" needs to know exactly that. One non-interactive, zero-frame
/// subview per control is cheaper than widening the core host for every component
/// that might want this, and a `UIViewRepresentable` in the SwiftUI body would put
/// a representable in every control's mount path.
///
/// It is deliberately not part of the layout: `measureFittingSize()` asks the
/// *hosting controller* for a size, so a sibling cannot move a measured number.
private final class NitroUiProgressWindowObserver: UIView {
  var onChange: ((_ inWindow: Bool) -> Void)?

  override func didMoveToWindow() {
    super.didMoveToWindow()
    onChange?(window != nil)
  }
}

/// Picks the indicator style.
///
/// A ternary cannot: `.linear` and `.circular` are two different opaque
/// `ProgressViewStyle` types, so the choice is a conditional in a modifier - which
/// also means the two shapes are two different view trees, as they should be for
/// two different controls.
private struct ProgressVariantStyle: ViewModifier {
  let variant: String

  @ViewBuilder
  func body(content: Content) -> some View {
    if variant == "circular" {
      content.progressViewStyle(.circular)
    } else {
      content.progressViewStyle(.linear)
    }
  }
}

/// The SwiftUI half. Reads only the model, so any commit can rebuild it.
struct ProgressContent: NitroUIContent {
  /// The subscription to ``NitroUiModel/objectWillChange``.
  @ObservedObject private var model: ProgressModel

  init(model: ProgressModel) {
    self.model = model
  }

  var body: some View {
    // Recording here - rather than in a prop setter - is what makes
    // `nuiTestDisplayedValue()` a reading of the hosted control instead of an echo
    // of the prop: a commit that stored the number without the body ever being
    // handed it fails the test.
    let drawn = model.drawnValue
    model.recordDrawn(drawn)

    return Group {
      if let drawn {
        ProgressView(value: drawn)
      } else {
        ProgressView()
      }
    }
    .modifier(ProgressVariantStyle(variant: model.variant))
    .modifier(OptionalTint(color: model.tint))
    .modifier(OptionalAccessibility(label: model.accessibilityLabel, drawn: drawn))
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

/// The label and the value belong on the control, and an empty
/// `accessibilityLabel(_:)` would silence the element, so each is applied only when
/// there is something to say. `testID` deliberately does not appear here: RN
/// already puts it on the component view (core.md §3).
///
/// What iOS cannot say is the *role*: SwiftUI exposes a `ProgressView` with its own
/// element traits, and there is no public progressbar/busy trait to add, so the
/// number travels as an `accessibilityValue` percentage and the platform's own
/// element carries the rest (`docs/components/progress.md`).
private struct OptionalAccessibility: ViewModifier {
  let label: String?
  let drawn: Double?

  func body(content: Content) -> some View {
    if let label, let drawn {
      content.accessibilityLabel(label).accessibilityValue(ProgressModel.percent(drawn))
    } else if let label {
      content.accessibilityLabel(label)
    } else if let drawn {
      content.accessibilityValue(ProgressModel.percent(drawn))
    } else {
      content
    }
  }
}

/// The Hybrid View React renders as `NitroUiProgress`.
final class HybridNitroUiProgress: HybridNitroUiProgressSpec, RecyclableView {
  private let host: NitroSwiftUIHost<ProgressContent>
  private let windowObserver = NitroUiProgressWindowObserver()

  /// This component's name in the sizing engine:
  /// `HybridNitroUiProgressComponentName` in the generated C++, and `getName()` in
  /// the generated Kotlin.
  private static let sizingComponentName = "NitroUiProgress"

  /// The size to lay a Progress out with before anything has been measured, in
  /// points - the first Progress of an app's first launch.
  ///
  /// **The linear variant's numbers**: the engine's declared-fallback map is keyed
  /// by *component*, not by configuration (`docs/architecture/sizing.md` §2), so
  /// one pair has to serve both shapes and the default variant is the one to
  /// serve. A cold first *circular* mount is therefore laid out at the linear box
  /// for one frame before its own measurement corrects it - D17's one-frame
  /// budget, not a bug, and the harness test that names it.
  ///
  /// The width of a `fillWidth` fallback barely matters (the box's width replaces
  /// it); the height is the number that has to be right (sizing.md §5). It is: on
  /// the iPhone 17 / iOS 27 this task measured on, a `.linear` `ProgressView` is
  /// **4 pt** tall (`measureContent()` and the Yoga box agreed), and a `.circular`
  /// one is a **20 pt** square - the pair, with Android's, is the table in
  /// `docs/components/progress.md`. The 320 below is a plausible bar width, which a
  /// `fillWidth` layout overwrites with the box's.
  private static let declaresFallback: Bool = {
    NitroUiSizing.setFallback(sizingComponentName, 320.0, 4.0, NitroUiSizingPolicy.fillWidth.rawValue)
    return true
  }()

  /// Hand this control's declared size to the sizing engine, once per process (the
  /// static above is lazy and thread-safe, so repeat calls cost nothing).
  ///
  /// ``NitroUiDeclaredFallbacks`` calls this at startup, which is the point that
  /// matters: Fabric measures a shadow node before it creates a view (T14). `init`
  /// still calls it, as the backstop.
  static func declareFallback() {
    _ = Self.declaresFallback
  }

  /// The Nitro `view` - created once here and never replaced.
  override init() {
    host = NitroSwiftUIHost(model: ProgressModel())
    super.init()
    // Containment is for controls that present UI (menus, pickers); an indicator
    // never does.
    host.needsContainment = false
    // Both variants are self-sized: a linear bar measures its height, a circular
    // one its square. `wantsContentSize` costs one `sizeThatFits` per bounds or
    // trait change, not per commit.
    host.wantsContentSize = true
    // The default variant is linear, so the default policy is `fillWidth`; the
    // `variant` setter moves it along with the rest of the variant change.
    host.sizingPolicy = .fillWidth
    // The backstop: startup normally registers this through
    // ``NitroUiDeclaredFallbacks`` long before a Progress can be measured.
    Self.declareFallback()
    // Window membership, for the animation gate. Set up in `init` only: this view
    // is a sibling of the hosted content for the life of the host, so it survives a
    // recycle and never needs removing.
    windowObserver.frame = .zero
    windowObserver.isUserInteractionEnabled = false
    windowObserver.isAccessibilityElement = false
    windowObserver.onChange = { [weak self] inWindow in
      guard let model = self?.model else { return }
      model.inWindow = inWindow
    }
    host.addSubview(windowObserver)
  }

  var view: NitroSwiftUIHost<ProgressContent> {
    return host
  }

  // MARK: - Props
  // Setters only store and mark dirty; everything is applied in `afterUpdate()`.

  var variant: String {
    get { model.variant }
    set {
      // The wrapper is the only writer and sends one of two names; anything else
      // behaves as `'linear'`, which is what the spec documents.
      let next = newValue == "circular" ? "circular" : "linear"
      guard next != model.variant else { return }
      model.variant = next
      // The one prop that changes the control's *size* - and the question the
      // toolkit is asked (an `intrinsic` square vs a bar at the box's width), so
      // the policy has to move with it and the fitting size has to be taken again
      // (`docs/architecture/sizing.md` §5 point 5).
      host.sizingPolicy = next == "circular" ? .intrinsic : .fillWidth
      host.markDirty()
      host.noteContentSizeMayHaveChanged()
    }
  }

  var value: Variant_NullType_Double {
    get { model.value.map { .second($0) } ?? .first(.null) }
    set {
      let next = newValue.asType(Double.self)
      guard next != model.value else { return }
      model.value = next
      host.markDirty()
      // Not size-affecting: a bar at 0.2 and a bar at 0.9 are the same box on both
      // toolkits, so no `noteContentSizeMayHaveChanged()`.
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

  var trackColor: Variant_NullType_Double {
    get {
      guard let track = model.track else { return .first(.null) }
      return .second(track.nitroUiARGBValue)
    }
    set {
      let next = newValue.asType(Double.self).flatMap(UIColor.init(nitroUiARGB:))
      guard next != model.track else { return }
      // Stored, not rendered - SwiftUI has nothing to put it on - so this does not
      // even mark the host dirty. Round-tripping the prop is what makes the
      // documented iOS limitation observable rather than mysterious.
      model.track = next
    }
  }

  var testID: Variant_NullType_String {
    get { model.testID.map { .second($0) } ?? .first(.null) }
    set {
      // Nothing to apply: `testID` is an RN base prop too, and
      // `RCTViewComponentView` already puts it on the component view as
      // `accessibilityIdentifier`. Setting it again would make the view match a
      // testID query twice. It stays in the spec because Android needs it as a tag.
      model.testID = newValue.asType(String.self)
    }
  }

  var accessibilityLabel: Variant_NullType_String {
    get {
      guard let label = model.accessibilityLabel else { return .first(.null) }
      return .second(label)
    }
    set {
      // Rendered: the label is on the SwiftUI element, so a late-set label needs a
      // commit to reach VoiceOver.
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
    set { model.sizingKey = newValue }
  }

  var nuiSizingId: Double {
    get { Double(host.sizingInstanceId) }
    set { host.sizingInstanceId = Int64(newValue) }
  }

  // MARK: - Lifecycle

  func afterUpdate() {
    // Nothing to reconcile (`docs/architecture/core.md` §12): React's `value` is
    // the whole story, so one commit per turn is the entire update path.
    host.commit()
  }

  func prepareForRecycle() {
    model.variant = "linear"
    model.value = nil
    model.tint = nil
    model.track = nil
    model.testID = nil
    model.accessibilityLabel = nil
    model.sizingKey = ""
    // Back to the default policy, matching the reset variant - a host that kept
    // `intrinsic` would ask the next owner's linear bar the wrong question.
    host.sizingPolicy = .fillWidth
    // A recycled host is not in a window, and the reset above leaves the model
    // *indeterminate* - so without this the next owner's indicator would count as
    // animating between the recycle and the next attach. The observer sets `true`
    // on the way back in; saying it here closes the gap between the two.
    model.inWindow = false
    model.refreshAnimationReport()
    host.prepareForRecycle()
  }

  func onDropView() {
    // No callbacks to release (there are none), but the window flag and the
    // animation mirror still belong to the mount that is ending.
    model.inWindow = false
    model.refreshAnimationReport()
    host.drop()
  }

  // MARK: - Methods

  /// The size SwiftUI wants for this indicator, from the host's cache.
  ///
  /// Never touches the main thread: this can be called from JS, and SwiftUI may
  /// only be measured on main (core-architecture §1.4).
  func measureContent() throws -> NitroUiSize {
    guard let size = host.contentSize else {
      return NitroUiSize(width: 0, height: 0)
    }
    return NitroUiSize(width: Double(size.width), height: Double(size.height))
  }

  /// What the control is displaying - see `NitroUiProgressMethods.nuiTestDisplayedValue`.
  func nuiTestDisplayedValue() throws -> String {
    return model.displayedReport
  }

  /// Whether the control is allowed to be animating - see
  /// `NitroUiProgressMethods.nuiTestIsAnimating`. On iOS that is "indeterminate,
  /// and its view is in a window", which is the rule ``ProgressModel/drawnValue``
  /// actually draws under.
  func nuiTestIsAnimating() throws -> Bool {
    return model.isAnimating
  }

  private var model: ProgressModel {
    return host.model
  }
}

// The Progress component: SwiftUI's `ProgressView` in its `.linear` and `.circular` styles.
// Not interactive, so it has no controlled value and no callbacks.

import NitroModules
import SwiftUI
import UIKit

final class ProgressModel: NitroUiModel {
  /// `'linear'`, `'circular'` or `'loading'`. SwiftUI has no loading indicator, so
  /// `'loading'` is drawn as a circular `ProgressView`.
  var variant = "linear"
  /// `'flat'` or `'wavy'`. Stored and not painted: SwiftUI has no wavy progress indicator.
  var appearance = "flat"
  /// Material's tonal container for `'loading'`. Stored and not painted: no iOS control has
  /// that form.
  var contained = false
  /// The fraction React sent, unclamped, or `nil` for an indeterminate indicator. Clamped
  /// where it is drawn (`drawnValue`), so the getter answers what was sent.
  var value: Double?
  var tint: UIColor?
  /// Stored and not painted: SwiftUI's `ProgressView` has no API for its track.
  var track: UIColor?
  var testID: String?
  var accessibilityLabel: String?
  /// `''` or `'circular'`. The sizing engine reads the key from Fabric state itself.
  var sizingKey = ""
  /// Whether the hosted view is in a window. An indeterminate indicator animates forever, so
  /// it is only drawn as one while in a window. Main thread only; other threads read
  /// `isAnimating`.
  var inWindow = false {
    didSet {
      if inWindow != oldValue {
        // A window change arrives outside a props commit, so it has to invalidate the view
        // itself.
        objectWillChange.send()
      }
    }
  }
  /// Guards the two values below, which are written on the main thread and read on the JS
  /// thread.
  private let mirrorLock = NSLock()
  /// What the drawing code was last handed, as one line. Written by the body.
  private var drawnReport = "displayed=none"
  /// Whether the control may be animating right now. Never derived on the JS thread:
  /// reading `UIView.window` there would be off-main.
  private var animating = false

  /// The fraction to draw, clamped into range, or `nil` for the indeterminate indicator.
  ///
  /// An indeterminate `ProgressView` runs its own animation, so off-window it would keep
  /// asking for frames. There it is drawn as an empty determinate indicator in the same
  /// style, which needs no motion and measures the same. Android applies the same rule.
  var drawnValue: Double? {
    if let value {
      return value.isFinite ? min(max(value, 0), 1) : 0
    }
    return inWindow ? nil : 0
  }

  func recordDrawn(_ drawn: Double?) {
    mirrorLock.lock()
    drawnReport = drawn.map { "displayed=\($0)" } ?? "displayed=indeterminate"
    animating = drawn == nil && inWindow
    mirrorLock.unlock()
  }

  /// For callers outside the body (the window observer, a recycle).
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

  /// Whether the shape measures its own square: a ring, or the loading indicator drawn as
  /// one.
  var isIntrinsicShape: Bool {
    variant == "circular" || variant == "loading"
  }

  override init() {
    super.init()
  }
}

/// A zero-size sibling of the hosted SwiftUI view that reports window membership. The host
/// class is `final`, so a component cannot override its `didMoveToWindow`. It does not
/// affect the measured size, which comes from the hosting controller.
private final class NitroUiProgressWindowObserver: UIView {
  var onChange: ((_ inWindow: Bool) -> Void)?

  override func didMoveToWindow() {
    super.didMoveToWindow()
    onChange?(window != nil)
  }
}

/// `.linear` and `.circular` are two different `ProgressViewStyle` types, so the choice is a
/// conditional rather than a ternary.
private struct ProgressVariantStyle: ViewModifier {
  let variant: String

  @ViewBuilder
  func body(content: Content) -> some View {
    // SwiftUI has no loading indicator; a circular `ProgressView` is the closest native
    // control.
    if variant == "circular" || variant == "loading" {
      content.progressViewStyle(.circular)
    } else {
      content.progressViewStyle(.linear)
    }
  }
}

struct ProgressContent: NitroUIContent {
  @ObservedObject private var model: ProgressModel

  init(model: ProgressModel) {
    self.model = model
  }

  var body: some View {
    // Recorded here, not in a prop setter, so the test read-out is what the control was
    // actually handed.
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

/// `.tint()` has no "unset" form, so it is applied only when a colour is set.
private struct OptionalTint: ViewModifier {
  let color: UIColor?

  func body(content: Content) -> some View {
    if let color {
      content.tint(Color(color))
    } else {
      content
    }
  }
}

/// An empty `accessibilityLabel(_:)` would silence the element, so the label and the value
/// are each applied only when present. `testID` is not applied here: React Native already
/// puts it on the component view. There is no public progress-bar trait to add, so the
/// number travels as an `accessibilityValue` percentage.
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

final class HybridNitroUiProgress: HybridNitroUiProgressSpec, RecyclableView {
  private let host: NitroSwiftUIHost<ProgressContent>
  private let windowObserver = NitroUiProgressWindowObserver()

  /// Must match the component name in the generated C++ and Kotlin.
  private static let sizingComponentName = "NitroUiProgress"

  /// The linear variant's size, in points: one fallback has to serve both shapes. Under a
  /// finite parent only the height matters. Under a parent that gives no finite width (a
  /// horizontal `ScrollView`), the declared width is what the bar draws at.
  private static let declaresFallback: Bool = {
    NitroUiSizing.setFallback(sizingComponentName, 320.0, 4.0, NitroUiSizingPolicy.fillWidth.rawValue)
    return true
  }()

  /// Registers the fallback once per process. Called at startup, because Fabric measures a
  /// shadow node before it creates any view; `init` calls it as a backstop.
  static func declareFallback() {
    _ = Self.declaresFallback
  }

  override init() {
    host = NitroSwiftUIHost(model: ProgressModel())
    super.init()
    // Containment is for controls that present UI (menus, pickers); an indicator
    // never does.
    host.needsContainment = false
    // Both variants are self-sized: a linear bar measures its height, a circular one its
    // square.
    host.wantsContentSize = true
    // The default variant is linear, hence `fillWidth`; the `variant` setter changes the
    // policy with the variant.
    host.sizingPolicy = .fillWidth
    Self.declareFallback()
    // A sibling of the hosted content for the life of the host, so it survives a recycle.
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
      // Anything unrecognised is `'linear'`.
      let next: String
      if newValue == "circular" || newValue == "loading" {
        next = newValue
      } else {
        next = "linear"
      }
      guard next != model.variant else { return }
      model.variant = next
      // The variant changes the sizing policy as well as the size.
      host.sizingPolicy = model.isIntrinsicShape ? .intrinsic : .fillWidth
      host.markDirty()
      host.noteContentSizeMayHaveChanged()
    }
  }

  var appearance: String {
    get { model.appearance }
    set {
      // Stored, not drawn, so the host is not marked dirty.
      model.appearance = newValue == "wavy" ? "wavy" : "flat"
    }
  }

  var contained: Bool {
    get { model.contained }
    set {
      // Stored, not drawn: no iOS control has a contained loading form.
      model.contained = newValue
    }
  }

  var value: Variant_NullType_Double {
    get { model.value.map { .second($0) } ?? .first(.null) }
    set {
      let next = newValue.asType(Double.self)
      guard next != model.value else { return }
      model.value = next
      host.markDirty()
      // Not size-affecting: the box is the same at any value.
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
      // Stored, not drawn, so the host is not marked dirty.
      model.track = next
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
    get {
      guard let label = model.accessibilityLabel else { return .first(.null) }
      return .second(label)
    }
    set {
      // The label is on the SwiftUI element, so it needs a commit to reach VoiceOver.
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
      // report as a duplicate. Guarded, because React re-sends an unchanged key every render.
      host.noteSizingKeyChanged()
    }
  }

  var nuiSizingId: Double {
    get { Double(host.sizingInstanceId) }
    set { host.sizingInstanceId = Int64(newValue) }
  }

  // MARK: - Lifecycle

  func afterUpdate() {
    host.commit()
  }

  func prepareForRecycle() {
    model.variant = "linear"
    model.appearance = "flat"
    model.contained = false
    model.value = nil
    model.tint = nil
    model.track = nil
    model.testID = nil
    model.accessibilityLabel = nil
    model.sizingKey = ""
    // Back to the default policy, matching the reset variant.
    host.sizingPolicy = .fillWidth
    // A recycled host is not in a window, and the reset leaves the model indeterminate:
    // without this the indicator would count as animating until the next attach.
    model.inWindow = false
    model.refreshAnimationReport()
    host.prepareForRecycle()
  }

  func onDropView() {
    model.inWindow = false
    model.refreshAnimationReport()
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

  func nuiTestDisplayedValue() throws -> String {
    return model.displayedReport
  }

  /// True when the indicator is indeterminate and its view is in a window.
  func nuiTestIsAnimating() throws -> Bool {
    return model.isAnimating
  }

  private var model: ProgressModel {
    return host.model
  }
}

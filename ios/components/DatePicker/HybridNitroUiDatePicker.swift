// The DatePicker component: SwiftUI's `DatePicker`. The `compact` variant is a field that
// opens a popover presented through UIKit, so its host needs view-controller containment.

import NitroModules
import SwiftUI
import UIKit

final class DatePickerModel: NitroUiModel {
  /// The selected instant, in ms since the epoch. A raw `Double` rather than a `Date`
  /// because it cannot be clamped until the bounds are known, and they may arrive later in
  /// the same batch; `afterUpdate()` clamps it.
  var state = NitroUiControlledValue<Double>(displayed: 0)
  /// Uncontrolled seed, in ms. Applied once, in `afterUpdate()`.
  var defaultValueMillis: Double = 0
  var didApplyDefault = false
  /// `'date'`, `'time'` or `'datetime'`.
  var mode = "date"
  /// `'compact'`, `'inline'` or `'wheel'`.
  var variant = "compact"
  /// Lowest selectable instant, or `nil` for "no lower bound" (`null` on the wire).
  var minimum: Double?
  /// Highest selectable instant, or `nil` for "no upper bound".
  var maximum: Double?
  var disabled = false
  var tint: UIColor?
  var testID: String?
  var accessibilityLabel: String?
  /// The sizing engine reads the key from Fabric state; the host only needs to hear that it
  /// changed.
  var sizingKey = ""
  /// Whether the `compact` field's popover is open. Written only by `setPresented(_:)`.
  var presented = false
  /// Opens and closes the popover in UIKit. Only `setPresented(_:)` calls it, so the press,
  /// the test hook and UIKit's own dismissal all go through one place.
  var presentationHandler: ((_ next: Bool) -> Void)?
  var onChange: ((_ millis: Double, _ eventCount: Double) -> Void)?

  // MARK: - Test report
  // The report may be read from the JS thread, so it is a string written under a lock: JS
  // must never `main.sync` into UI state.

  private let reportLock = NSLock()
  private var report = "0|0"
  /// What `publishReport()` last formatted, so an unchanged batch skips the `String(format:)`.
  private var publishedDisplayed: Double = 0
  private var publishedPresented = false

  override init() {
    super.init()
  }

  // MARK: - Calendar arithmetic

  /// The instant of `millis`, or the epoch for a number that is not one. A `Date` built from
  /// NaN or infinity compares greater than everything, so it would pass both bounds.
  static func date(_ millis: Double) -> Date {
    guard millis.isFinite else { return Date(timeIntervalSince1970: 0) }
    return Date(timeIntervalSince1970: millis / 1000.0)
  }

  static func millis(_ date: Date) -> Double {
    guard date.timeIntervalSince1970.isFinite else { return 0 }
    return date.timeIntervalSince1970 * 1000.0
  }

  /// `millis` inside `[minimum, maximum]`, with either bound possibly absent. Runs in
  /// `afterUpdate()`, never in a prop setter: the value and the bounds arrive in one batch in
  /// unspecified order. The JS wrapper clamps the same way, and the two must agree exactly.
  ///
  /// Inverted bounds (`minimum > maximum`) make the lower one win.
  static func clamp(_ millis: Double, minimum: Double?, maximum: Double?) -> Double {
    guard millis.isFinite else { return 0 }
    var value = millis
    if let maximum, value > maximum { value = maximum }
    if let minimum, value < minimum { value = minimum }
    return value
  }

  // MARK: - Reports

  func publishReport() {
    let displayed = state.displayed
    let presented = self.presented
    reportLock.lock()
    if displayed == publishedDisplayed, presented == publishedPresented {
      reportLock.unlock()
      return
    }
    publishedDisplayed = displayed
    publishedPresented = presented
    report = String(format: "%.0f|%d", displayed, presented ? 1 : 0)
    reportLock.unlock()
  }

  /// The last published report. Safe from any thread.
  func readReport() -> String {
    reportLock.lock()
    defer { reportLock.unlock() }
    // After the published pair: two calendar fields that are Android's (`-1` here), the
    // process-wide count of live presentations, this mount's `controlBuilds`, and the bounds
    // the control on screen was built with (`-1` = no control built yet, `-2` = bound unset).
    let built = builtBounds.map { bounds in
      "\(Int64(bounds.minimum ?? Self.NO_BOUND))|\(Int64(bounds.maximum ?? Self.NO_BOUND))"
    } ?? "\(Self.NO_BUILD)|\(Self.NO_BUILD)"
    return "\(report)|-1|-1|\(NitroUiDatePickerPresentation.livePresentations)|\(controlBuilds)|\(built)"
  }

  /// `readReport()`'s sentinel for a bound the app never set.
  static let NO_BOUND: Double = -2
  /// `readReport()`'s sentinel for a mount that has not built a control yet.
  static let NO_BUILD: Int = -1

  /// How many times this mount built the platform control. Plain storage: nothing may
  /// recompose because it moved.
  var controlBuilds = 0

  /// The bounds the control on screen was built with, or nil before the first one appeared.
  private(set) var builtBounds: (minimum: Double?, maximum: Double?)?

  /// `granularBoundsIdentity` as it read when the control on screen was built.
  private(set) var builtGranular: String?

  /// A platform control appeared, built from these bounds. Appearances are the closest thing
  /// SwiftUI offers to "the control was rebuilt": a control that survives a render does not
  /// appear again, and one that a new identity replaces does.
  func noteControlBuilt(minimum: Double?, maximum: Double?) {
    controlBuilds += 1
    builtBounds = (minimum, maximum)
    builtGranular = granularBoundsIdentity
  }

  /// Forgets what the live control holds. Recycling keeps this model but not the control, so
  /// the next mount must not compare itself against the previous mount's bounds.
  func clearBuiltBounds() {
    builtBounds = nil
    builtGranular = nil
  }

  /// The SwiftUI identity of the platform control; a new identity rebuilds it.
  ///
  /// `UIDatePicker` applies a new `date` before a new `maximumDate`, clamps a date outside
  /// the bounds it still holds, and reports that clamp as a selection change from inside its
  /// own update, which asserts in `UICalendarView` (SIGABRT). A fresh control starts
  /// unbounded, so both bounds land first. The cost of a rebuild is the calendar's page and
  /// a wheel's scroll position, which reset.
  ///
  /// So the identity changes only when a bound moves by a step the control can show (a day,
  /// or a minute when it shows time), or, with `|outside`, when the value has left the range
  /// the control on screen was built with while those steps have not changed.
  ///
  /// Apply it as `.id(_:)` on the `DatePicker` itself: one level out, the fresh control is
  /// asked for a month its own bounds exclude as it goes on screen, and asserts the same way.
  var controlIdentity: String {
    let granular = granularBoundsIdentity
    guard let built = builtBounds else {
      return granular
    }
    let lower = built.minimum ?? -.greatestFiniteMagnitude
    let upper = max(built.maximum ?? .greatestFiniteMagnitude, lower)
    let shown = state.displayed
    if (shown < lower || shown > upper) && granular == builtGranular {
      return granular + "|outside"
    }
    return granular
  }

  /// The two bounds, rounded down to the step the control shows.
  private var granularBoundsIdentity: String {
    let calendar = Calendar.current
    let showsTime = components != .date
    let step: Set<Calendar.Component> = showsTime
      ? [.year, .month, .day, .hour, .minute]
      : [.year, .month, .day]
    func bucket(_ millis: Double?) -> String {
      guard let millis else {
        return "none"
      }
      let parts = calendar.dateComponents(step, from: DatePickerModel.date(millis))
      let day = "\(parts.year ?? 0)-\(parts.month ?? 0)-\(parts.day ?? 0)"
      return showsTime ? "\(day)T\(parts.hour ?? 0):\(parts.minute ?? 0)" : day
    }
    return "min:\(bucket(minimum)) max:\(bucket(maximum))"
  }

  /// Anything unrecognised is `'date'`.
  var components: DatePickerComponents {
    switch mode {
    case "time":
      return .hourAndMinute
    case "datetime":
      return [.date, .hourAndMinute]
    default:
      return .date
    }
  }


  // MARK: - Interaction

  /// Opens or closes the `compact` field's presentation. Every write to `presented` goes
  /// through here: the press, UIKit's dismissal, recycle and drop.
  func setPresented(_ next: Bool) {
    guard next != presented else { return }
    presented = next
    publishReport()
    objectWillChange.send()
    presentationHandler?(next)
  }

  /// The user picked `millis`. Optimistic: `displayed` moves now, before React has seen the
  /// event.
  ///
  /// A selection that does not move the displayed instant reports nothing. SwiftUI's binding
  /// only writes on a change, but Material 3's calendar fires on a tap of the selected day,
  /// so suppressing here keeps the two platforms emitting the same events.
  func applyUserSelection(_ millis: Double) {
    // `.disabled(_:)` stops the binding from writing, but the test hook does not go through
    // the view.
    guard !disabled else { return }
    let next = DatePickerModel.clamp(millis, minimum: minimum, maximum: maximum)
    guard next != state.displayed else { return }
    let eventCount = state.user(next)
    publishReport()
    objectWillChange.send()
    onChange?(next, Double(eventCount))
  }
}

/// The `compact` field's text and its width. Main-thread only.
///
/// The width is that of the widest string the mode can produce, never of the displayed value:
/// pickers that share a sizing key must want the same box, or each would correct the other's.
/// The cache is keyed by mode, Dynamic Type and locale, which are what can change the answer.
@MainActor
enum NitroUiDatePickerField {
  /// Cached `(formatter, width)` per `mode|contentSizeCategory|locale`.
  private static var cache: [String: (formatter: DateFormatter, width: CGFloat)] = [:]

  static func label(millis: Double, mode: String) -> String {
    entry(mode: mode).formatter.string(from: DatePickerModel.date(millis))
  }

  /// In points: wide enough for every date.
  static func width(mode: String) -> CGFloat {
    entry(mode: mode).width
  }

  static func invalidate() {
    cache.removeAll()
  }

  private static func entry(mode: String) -> (formatter: DateFormatter, width: CGFloat) {
    let category = UIApplication.shared.preferredContentSizeCategory.rawValue
    let locale = Locale.current.identifier
    let key = "\(mode)|\(category)|\(locale)"
    if let cached = cache[key] {
      return cached
    }
    let built = makeEntry(mode: mode)
    // Bounded by the `(mode, Dynamic Type, locale)` triples the app renders, so nothing is
    // evicted.
    cache[key] = built
    return built
  }

  private static func makeEntry(mode: String) -> (formatter: DateFormatter, width: CGFloat) {
    let formatter = DateFormatter()
    // `autoupdatingCurrent`, not `current`: this cached instance must follow the user's
    // settings for as long as it lives.
    formatter.locale = .autoupdatingCurrent
    formatter.calendar = .autoupdatingCurrent
    switch mode {
    case "time":
      formatter.dateStyle = .none
      formatter.timeStyle = .short
    case "datetime":
      formatter.dateStyle = .medium
      formatter.timeStyle = .short
    default:
      formatter.dateStyle = .medium
      formatter.timeStyle = .none
    }

    let font = UIFont.preferredFont(forTextStyle: .body)
    let attributes: [NSAttributedString.Key: Any] = [.font: font]
    var widest: CGFloat = 0
    for components in probes {
      guard let date = Calendar.current.date(from: components) else { continue }
      let text = formatter.string(from: date)
      let size = (text as NSString).boundingRect(
        with: CGSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude),
        options: [.usesLineFragmentOrigin, .usesFontLeading],
        attributes: attributes,
        context: nil
      )
      widest = max(widest, size.width)
    }
    // `ceil` plus a point of slack: SwiftUI's `Text` lays out on its own subpixel grid, and a
    // field a fraction of a point short truncates the month name.
    return (formatter, min(max(ceil(widest) + 1.0, 44.0), 520.0))
  }

  /// Dates whose formatting is widest: every month (name width depends on the locale), one-
  /// and two-digit days, hours on both sides of AM/PM, and a four-digit year.
  private static let probes: [DateComponents] = {
    var result: [DateComponents] = []
    for month in 1...12 {
      for day in [8, 28] {
        for hour in [0, 8, 12, 20, 23] {
          var components = DateComponents()
          components.year = 2288
          components.month = month
          components.day = day
          components.hour = hour
          components.minute = 8
          result.append(components)
        }
      }
    }
    return result
  }()
}

struct DatePickerContent: NitroUIContent {
  @ObservedObject private var model: DatePickerModel

  init(model: DatePickerModel) {
    self.model = model
  }

  var body: some View {
    Group {
      switch model.variant {
      case "inline":
        PlatformPicker(model: model).datePickerStyle(.graphical)
      case "wheel":
        PlatformPicker(model: model).datePickerStyle(.wheel)
      default:
        compactField
      }
    }
    .modifier(OptionalDatePickerTint(color: model.tint))
    .disabled(model.disabled)
    .modifier(OptionalDatePickerAccessibility(label: model.accessibilityLabel))
  }

  // MARK: - The compact field

  /// Not `.datePickerStyle(.compact)`: with the platform style the popover's open state lives
  /// inside SwiftUI, where nothing can close it on recycle or drop or report it to JS, and
  /// the field's width follows the current value. The popover's content is still the
  /// platform picker.
  private var compactField: some View {
    Button(action: openPresentation) {
      Text(NitroUiDatePickerField.label(millis: model.state.displayed, mode: model.mode))
        .font(.body)
        .lineLimit(1)
        .truncationMode(.tail)
        .foregroundStyle(model.tint.map { Color($0) } ?? Color.accentColor)
        // The cached width, never the string's. `.leading` so a string that overruns
        // truncates on the right.
        .frame(width: NitroUiDatePickerField.width(mode: model.mode), alignment: .leading)
        // Inside the label, so the padding is part of the button's tap target.
        .padding(.vertical, 8)
    }
    .buttonStyle(.plain)
    // Makes the whole padded rect the hit area, not just the glyphs.
    .contentShape(Rectangle())
    // An `accessibilityLabel` replaces this button's only accessible text, the date, so the
    // date is announced as the value instead.
    .accessibilityValue(
      Text(NitroUiDatePickerField.label(millis: model.state.displayed, mode: model.mode))
    )
  }

  // MARK: - The press

  private func openPresentation() {
    model.setPresented(true)
  }
}

// MARK: - The platform picker

/// SwiftUI's `DatePicker`, unstyled: each call site picks its style. Shared by the content
/// React Native lays out and the popover UIKit presents.
private struct PlatformPicker: View {
  @ObservedObject private var model: DatePickerModel

  init(model: DatePickerModel) {
    self.model = model
  }

  /// A `DatePicker` always takes a title; it is hidden and serves as the accessibility label.
  var body: some View {
    DatePicker(
      model.accessibilityLabel ?? "",
      selection: selection,
      in: selectableRange,
      displayedComponents: model.components
    )
    .labelsHidden()
    // Must be inside `.id(_:)`: an `.onAppear` outside it belongs to the enclosing structure,
    // which survives a new identity, and would fire only once per mount.
    .onAppear { model.noteControlBuilt(minimum: model.minimum, maximum: model.maximum) }
    // Must stay on the `DatePicker` itself; one level out it asserts in `UICalendarView`.
    .id(model.controlIdentity)
  }

  /// "No bound" is `distantPast`/`distantFuture`, so an unbounded picker can show any
  /// instant. Inverted bounds collapse to `minimum...minimum`: a `ClosedRange` with
  /// `lowerBound > upperBound` is a runtime trap.
  private var selectableRange: ClosedRange<Date> {
    let lower = model.minimum.map(DatePickerModel.date) ?? .distantPast
    guard let maximum = model.maximum else {
      return lower...Date.distantFuture
    }
    let upper = DatePickerModel.date(maximum)
    if upper < lower {
      return lower...lower
    }
    return lower...upper
  }

  /// Optimistic: the setter shows the new date before JS has seen the event.
  private var selection: Binding<Date> {
    Binding(
      get: { DatePickerModel.date(model.state.displayed) },
      set: { model.applyUserSelection(DatePickerModel.millis($0)) }
    )
  }
}
/// `.tint()` has no "unset" form, so it is applied only when a colour is set. It colours the
/// graphical calendar's selected day and the wheel's highlight.
private struct OptionalDatePickerTint: ViewModifier {
  let color: UIColor?

  func body(content: Content) -> some View {
    if let color {
      content.tint(Color(color))
    } else {
      content
    }
  }
}

/// An empty `accessibilityLabel(_:)` would silence the picker's own labels, so it is applied
/// only when set. `testID` is not applied here: React Native already puts it on the component
/// view, and a second copy would match a testID query twice.
private struct OptionalDatePickerAccessibility: ViewModifier {
  let label: String?

  func body(content: Content) -> some View {
    if let label {
      content.accessibilityLabel(label)
    } else {
      content
    }
  }
}

/// What the `compact` field's popover shows: `.wheel` for a time, `.graphical` otherwise. The
/// tint is repeated here because a popover is a new SwiftUI environment.
private struct DatePickerPopoverContent: View {
  @ObservedObject private var model: DatePickerModel

  init(model: DatePickerModel) {
    self.model = model
  }

  var body: some View {
    Group {
      if model.mode == "time" {
        PlatformPicker(model: model).datePickerStyle(.wheel)
      } else {
        // For `datetime` too: `.graphical` with both components draws the calendar and a
        // time row.
        PlatformPicker(model: model).datePickerStyle(.graphical)
      }
    }
    .frame(width: NitroUiDatePickerPresentation.calendarWidth)
    .padding(.horizontal, NitroUiDatePickerPresentation.margin)
    .modifier(OptionalDatePickerTint(color: model.tint))
  }
}

/// The `compact` field's popover: UIKit's presentation, SwiftUI's content.
///
/// A SwiftUI `.popover` attached to content hosted inside a React Native view gets both size
/// and anchor wrong. The content is asked for its size before there is a width to offer, and
/// a `DatePicker` takes whatever it is offered; and the source item is resolved in the
/// nearest presenting controller's view rather than the field's. Presenting through UIKit
/// supplies both: `sourceView` is the control's own view, and `preferredContentSize` is
/// measured with `sizeThatFits(in:)`.
final class NitroUiDatePickerPresentation: NSObject, UIPopoverPresentationControllerDelegate {
  /// The calendar's width inside the popover. A `.graphical` calendar divides its width by
  /// seven and does not refuse a small proposal: 320 pt gives 45 pt day cells, just over the
  /// 44 pt minimum touch target. A `time` wheel gets the same box.
  static let calendarWidth: CGFloat = 320
  /// The gap between the calendar and the popover's edge.
  static let margin: CGFloat = 8
  /// `calendarWidth` plus both margins - the width the content is measured with.
  static var contentWidth: CGFloat { calendarWidth + 2 * margin }

  // MARK: - Live presentations

  /// How many DatePicker presentations this process has open. Process-wide, because a mount
  /// that has been dropped has nothing left to report; tests read it to check that no
  /// presentation outlives its mount.
  static let live = NitroUiPresentationCounter()

  static var livePresentations: Int {
    live.value
  }

  private let model: DatePickerModel
  /// The control's own view: what the popover's arrow points at.
  private weak var anchor: UIView?
  /// Read at present time: a presentation is only possible while the view is in a window.
  private let presenterProvider: @MainActor () -> UIViewController?
  private var controller: UIHostingController<DatePickerPopoverContent>?
  private let presentation = NitroUiPresentation(counter: NitroUiDatePickerPresentation.live)

  init(
    model: DatePickerModel,
    anchor: UIView,
    presenterProvider: @escaping @MainActor () -> UIViewController?
  ) {
    self.model = model
    self.anchor = anchor
    self.presenterProvider = presenterProvider
    super.init()
  }

  /// Opens the popover anchored to the field. A no-op when the view is not in a window.
  func present() {
    nitroUiAssertMainThread()
    // This class is created from a Hybrid `init`, which has no actor to inherit, so the main
    // thread is asserted rather than inferred.
    MainActor.assumeIsolated {
      presentIsolated()
    }
  }

  @MainActor
  private func presentIsolated() {
    if let controller, controller.presentingViewController != nil {
      // Already on screen. A dismissal can only be outstanding if a teardown arrived during
      // the entry transition, so this request is from the replacement mount: cancel the close.
      presentation.cancelPendingDismissal()
      return
    }
    guard let anchor, let presenter = presenterProvider() else {
      return
    }
    let hosted = controller ?? UIHostingController(rootView: DatePickerPopoverContent(model: model))
    controller = hosted
    // `popoverPresentationController` is rebuilt every time the style is assigned,
    // so all of it - size included - is set per presentation rather than in `init`.
    hosted.modalPresentationStyle = .popover
    hosted.preferredContentSize = CGSize(
      width: Self.contentWidth,
      height: hosted.sizeThatFits(
        in: CGSize(width: Self.contentWidth, height: .infinity)
      ).height
    )
    guard let popover = hosted.popoverPresentationController else {
      return
    }
    popover.sourceView = anchor
    popover.sourceRect = anchor.bounds
    // Either direction: UIKit squeezes the content into the room on the permitted side, so
    // `.up` alone would clip the calendar for a field in the lower half of the screen.
    popover.permittedArrowDirections = [.up, .down]
    popover.delegate = self
    presentation.present(hosted, from: presenter, animated: true)
  }

  /// Closes the popover without animation. UIKit refuses a dismissal that arrives while the
  /// presentation is still animating in, which for a dropped view would leak the popover, so
  /// the teardown hides the container at once and dismisses when the transition completes.
  func dismiss() {
    presentation.dismissForTeardown()
  }

  // MARK: - UIPopoverPresentationControllerDelegate

  /// Keeps it a popover on a phone: UIKit otherwise adapts it to a full-screen sheet at
  /// compact width.
  func adaptivePresentationStyle(
    for presentationController: UIPresentationController,
    traitCollection: UITraitCollection
  ) -> UIModalPresentationStyle {
    .none
  }

  /// The user tapped outside. UIKit closed the popover without asking, so the flag follows.
  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    presentation.noteClosedByUIKit()
    model.setPresented(false)
  }
}

final class HybridNitroUiDatePicker: HybridNitroUiDatePickerSpec, RecyclableView {
  private let host: NitroSwiftUIHost<DatePickerContent>
  private let popover: NitroUiDatePickerPresentation

  /// Must match the component name in the generated C++ and Kotlin.
  private static let sizingComponentName = "NitroUiDatePicker"

  private static let declaresFallback: Bool = {
    NitroUiSizing.setFallback(sizingComponentName, fallbackSize.width, fallbackSize.height, NitroUiSizingPolicy.intrinsic.rawValue)
    return true
  }()

  /// Registers the fallback once per process. Called at startup, because Fabric measures a
  /// shadow node before it creates any view; `init` calls it as a backstop.
  static func declareFallback() {
    _ = Self.declaresFallback
  }

  /// In points. The engine keeps one fallback per component, so this is the most common
  /// configuration: a `compact` `date` field in `en_US` at the default text size. The width
  /// varies with the locale; the height does not.
  private static let fallbackSize = (width: 107.0, height: 36.33)

  override init() {
    let host = NitroSwiftUIHost<DatePickerContent>(model: DatePickerModel())
    let model = host.model
    popover = NitroUiDatePickerPresentation(
      model: model,
      anchor: host,
      presenterProvider: { [weak host] in host?.containingViewController }
    )
    self.host = host
    super.init()
    host.wantsContentSize = true
    // `compact`, the default, is intrinsic; the `variant` setter changes the policy for the
    // other two.
    host.sizingPolicy = .intrinsic
    // `compact` presents a popover, and a presentation needs a view controller to present
    // from.
    host.needsContainment = true
    // Weak: the popover keeps the model alive through its SwiftUI content, and the model
    // must not own what it presents.
    model.presentationHandler = { [weak popover] next in
      next ? popover?.present() : popover?.dismiss()
    }
    Self.declareFallback()
  }

  var view: NitroSwiftUIHost<DatePickerContent> {
    return host
  }

  // MARK: - Props
  // Setters only store and mark dirty; everything is applied in `afterUpdate()`.

  var valueMillis: Variant_NullType_Double {
    get {
      guard let js = model.state.js else { return .first(.null) }
      // The clamped instant, not the number React sent.
      return .second(DatePickerModel.clamp(js, minimum: model.minimum, maximum: model.maximum))
    }
    set {
      // Not visual on its own: `afterUpdate()` clamps it against the bounds, which can be in
      // this same batch, and shows it once the event count says JS has caught up.
      model.state.js = newValue.asType(Double.self)
    }
  }

  var defaultValueMillis: Double {
    get { model.defaultValueMillis }
    set {
      // Stored raw: it has to be clamped against bounds that may arrive after it.
      model.defaultValueMillis = newValue
    }
  }

  var mostRecentEventCount: Double {
    get { Double(model.state.jsEvents) }
    set { model.state.jsEvents = Int(newValue) }
  }

  var mode: String {
    get { model.mode }
    set {
      guard newValue != model.mode else { return }
      model.mode = newValue
      host.markDirty()
      // The mode changes the control's size, and no bounds or trait change follows to
      // trigger a new measure.
      host.noteContentSizeMayHaveChanged()
    }
  }

  var variant: String {
    get { model.variant }
    set {
      guard newValue != model.variant else { return }
      model.variant = newValue
      host.markDirty()
      // The variant changes both the size and how it is decided.
      host.sizingPolicy = newValue == "compact" ? .intrinsic : .fillWidth
      host.noteContentSizeMayHaveChanged()
    }
  }

  var minimumMillis: Variant_NullType_Double {
    get {
      guard let minimum = model.minimum else { return .first(.null) }
      return .second(minimum)
    }
    set {
      let next = newValue.asType(Double.self)
      guard next != model.minimum else { return }
      model.minimum = next
      // Can move the displayed instant, which `afterUpdate()` applies. Not a size change.
      host.markDirty()
    }
  }

  var maximumMillis: Variant_NullType_Double {
    get {
      guard let maximum = model.maximum else { return .first(.null) }
      return .second(maximum)
    }
    set {
      let next = newValue.asType(Double.self)
      guard next != model.maximum else { return }
      model.maximum = next
      host.markDirty()
    }
  }

  var disabled: Bool {
    get { model.disabled }
    set {
      guard newValue != model.disabled else { return }
      model.disabled = newValue
      // Repaints only: a disabled picker is the same size.
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
      // The label is on the hosted element and the `DatePicker`'s title, so it needs a
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

  var onValueChange: ((_ millis: Double, _ eventCount: Double) -> Void)? {
    get { model.onChange }
    set { model.onChange = newValue }
  }

  // MARK: - Lifecycle

  func afterUpdate() {
    let minimum = model.minimum
    let maximum = model.maximum
    // The value, the default and the bounds can land in one batch in any order, so nothing
    // is interpreted until the batch is complete.
    if let js = model.state.js {
      let clamped = DatePickerModel.clamp(js, minimum: minimum, maximum: maximum)
      if clamped != js { model.state.js = clamped }
    }
    if model.state.js == nil, !model.didApplyDefault {
      model.didApplyDefault = true
      let seeded = DatePickerModel.clamp(model.defaultValueMillis, minimum: minimum, maximum: maximum)
      if seeded != model.state.displayed {
        model.state.displayed = seeded
        host.markDirty()
      }
    }
    // The event counts decide whether React's instant wins over what the user just picked.
    if model.state.reconcile() {
      host.markDirty()
    }
    // Bounds that arrived after the displayed instant can leave it outside them.
    let shown = DatePickerModel.clamp(model.state.displayed, minimum: minimum, maximum: maximum)
    if shown != model.state.displayed {
      model.state.displayed = shown
      host.markDirty()
    }
    // A batch can move the displayed instant without a rendered change, and the report must
    // not go stale.
    model.publishReport()
    host.commit()
  }

  func prepareForRecycle() {
    // First, before the value resets: an open popover belongs to the previous mount.
    model.setPresented(false)
    model.state = NitroUiControlledValue<Double>(displayed: 0)
    model.defaultValueMillis = 0
    model.didApplyDefault = false
    model.mode = "date"
    model.variant = "compact"
    model.minimum = nil
    model.maximum = nil
    model.clearBuiltBounds()
    model.disabled = false
    model.tint = nil
    model.testID = nil
    model.accessibilityLabel = nil
    model.sizingKey = ""
    model.onChange = nil
    // A recycled instance must not keep a `fillWidth` policy from an `inline` previous mount.
    host.sizingPolicy = .intrinsic
    model.publishReport()
    host.prepareForRecycle()
  }

  func onDropView() {
    model.onChange = nil
    // A presentation must not outlive the mount that opened it.
    model.setPresented(false)
    host.drop()
  }

  // MARK: - Methods

  /// Reads the host's cache: this can be called from JS, and SwiftUI may only be measured
  /// on main.
  func measureContent() throws -> NitroUiDatePickerSize {
    guard let size = host.contentSize else {
      return NitroUiDatePickerSize(width: 0, height: 0)
    }
    return NitroUiDatePickerSize(width: Double(size.width), height: Double(size.height))
  }

  /// Test-only: drives one selection through the same path as a user's.
  func nuiTestSelect(year: Double, month: Double, day: Double, hour: Double, minute: Double) throws {
    let run = { [weak self] in
      self?.performTestSelect(year: year, month: month, day: day, hour: hour, minute: minute)
    }
    if Thread.isMainThread {
      run()
    } else {
      DispatchQueue.main.async { run() }
    }
  }

  /// Test-only: opens the `compact` field's presentation through the same entry point as
  /// the press.
  func nuiTestPresent() throws {
    let run = { [weak self] in
      guard let self, !self.model.disabled, self.model.variant == "compact" else { return }
      self.model.setPresented(true)
    }
    if Thread.isMainThread {
      run()
    } else {
      DispatchQueue.main.async { run() }
    }
  }

  /// Safe from any thread.
  func nuiTestStateReport() throws -> String {
    return model.readReport()
  }

  /// Fields the current `mode` does not show keep the displayed value, as the platform
  /// control does: the graphical calendar writes the day and leaves the hour alone.
  private func performTestSelect(year: Double, month: Double, day: Double, hour: Double, minute: Double) {
    nitroUiAssertMainThread()
    let calendar = Calendar.current
    var components = calendar.dateComponents(
      [.year, .month, .day, .hour, .minute, .second],
      from: DatePickerModel.date(model.state.displayed)
    )
    if model.mode != "time" {
      if year.isFinite { components.year = Int(year.rounded(.down)) }
      if month.isFinite { components.month = min(12, max(1, Int(month.rounded(.down)))) }
      if day.isFinite {
        let requested = max(1, Int(day.rounded(.down)))
        // A day the target month does not have is clamped to its last day rather than
        // rolled into the next month.
        var probe = components
        probe.day = 1
        if let probeDate = calendar.date(from: probe),
          let daysInMonth = calendar.range(of: .day, in: .month, for: probeDate)?.count {
          components.day = min(requested, daysInMonth)
        } else {
          components.day = requested
        }
      }
    }
    if model.mode != "date" {
      if hour.isFinite { components.hour = min(23, max(0, Int(hour.rounded(.down)))) }
      if minute.isFinite { components.minute = min(59, max(0, Int(minute.rounded(.down)))) }
    }
    // Neither picker has seconds, so the displayed ones survive.
    guard let date = calendar.date(from: components) else { return }
    model.applyUserSelection(DatePickerModel.millis(date))
  }

  private var model: DatePickerModel {
    return host.model
  }
}

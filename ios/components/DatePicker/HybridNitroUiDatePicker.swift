//
//  HybridNitroUiDatePicker.swift
//  react-native-nitro-ui
//
//  The DatePicker component: SwiftUI `DatePicker` on the core runtime.
//
//  Structure is SegmentedControl's (`HybridNitroUiSegmentedControl.swift`) - a
//  user-editable value behind the event-count handshake, whose width comes from
//  what it renders - plus one thing no shipped component has: a presentation.
//  `compact` is a field that opens a popover, so this host sets
//  `needsContainment` (a `UIHostingController` cannot present from nowhere) and
//  the model owns *whether it is open* rather than leaving that to a `@State`
//  SwiftUI cannot hand back on recycle or drop.
//

import NitroModules
import SwiftUI
import UIKit

/// State of one DatePicker. See ``NitroUiModel`` for why this is not `@Published`.
final class DatePickerModel: NitroUiModel {
  /// The selected instant, in ms since the epoch, behind the handshake (core.md §4).
  ///
  /// A `Double` and not a `Date` for the same reason Slider's value is one: the
  /// handshake stores what React sent *raw*, and a raw `Double` cannot become a
  /// `Date` before the bounds it has to be clamped against are known - which can
  /// be in this same batch, after it (core.md §3). `afterUpdate()` clamps both
  /// `js` and `displayed`, so everything the content reads is already in range.
  ///
  /// The ms is an absolute instant. The *calendar fields* the user sees come from
  /// the device's calendar and time zone, which is what makes a value survive a
  /// DST boundary: React sent an instant, and an instant does not gain an hour
  /// because a region changed its clocks.
  var state = NitroUiControlledValue<Double>(displayed: 0)
  /// Uncontrolled seed, in ms. Applied once, in `afterUpdate()`.
  var defaultValueMillis: Double = 0
  var didApplyDefault = false
  /// `'date'`, `'time'` or `'datetime'`. Size-affecting, so it is in `nuiSizingKey`.
  var mode = "date"
  /// `'compact'`, `'inline'` or `'wheel'`. The most size-affecting prop here.
  var variant = "compact"
  /// Lowest selectable instant, or `nil` for "no lower bound" (`null` on the wire).
  var minimum: Double?
  /// Highest selectable instant, or `nil` for "no upper bound".
  var maximum: Double?
  var disabled = false
  var tint: UIColor?
  var testID: String?
  var accessibilityLabel: String?
  /// The size configuration React sent; the engine reads it out of Fabric state,
  /// the host only needs to hear that it changed (``NitroSwiftUIHost/noteSizingKeyChanged()``).
  var sizingKey = ""
  /// Whether the `compact` field's popover is open.
  ///
  /// Rendered (it drives `isPresented`) *and* readable from JS
  /// (`nuiTestStateReport`), because "the popover closed when the view went away"
  /// has to be assertable structurally rather than from a screenshot. Nothing
  /// here registers with a shared/global table on open - see the B1 lesson in
  /// `docs/tasks/G6-picker.md`: a SwiftUI `popover` is owned by the presentation
  /// system and dismissed with the presenting view, and this flag is per-instance
  /// state that `prepareForRecycle()` clears.
  var presented = false
  /// UIKit's half of the presentation, installed by ``HybridNitroUiDatePicker``.
  ///
  /// The flag above says whether the popover is open; this is what opens and closes
  /// it. The split is what keeps one entry point: the field's press, `nuiTestPresent()`
  /// and SwiftUI's dismissal of the bubble all write the flag, and the flag's setter
  /// is the only place that talks to UIKit. A presentation that no view controller
  /// is available for (a view not yet in a window) therefore cannot desynchronise the
  /// flag either - `presented` describes what the app asked for, and the dismiss
  /// delegate writes it back when UIKit closes the bubble on its own.
  var presentationHandler: ((_ next: Bool) -> Void)?
  /// `onValueChange`, wired through a stable JS callback.
  var onChange: ((_ millis: Double, _ eventCount: Double) -> Void)?

  // MARK: - Test report
  // `nuiTestStateReport()` may be called from the JS thread, so the answer is a
  // string written under a lock rather than two live reads: `NitroUiMainThread`'s
  // rule is that JS must never `main.sync` into UI state.

  private let reportLock = NSLock()
  private var report = "0|0"
  /// The pair ``publishReport()`` last formatted, so an unchanged batch skips the
  /// `String(format:)`. Every mutation path calls it, including the two bookkeeping
  /// ones that cannot change anything, and a benchmark sends many value writes.
  private var publishedDisplayed: Double = 0
  private var publishedPresented = false

  override init() {
    super.init()
  }

  // MARK: - Calendar arithmetic

  /// The instant of `millis`, or the epoch for a number that is not one.
  ///
  /// A `Date` from `timeIntervalSince1970` accepts NaN and infinity and turns them
  /// into a date 1e308 years out, which every calendar comparison then answers
  /// "greater than" for - so an unclamped NaN would sail past both bounds.
  static func date(_ millis: Double) -> Date {
    guard millis.isFinite else { return Date(timeIntervalSince1970: 0) }
    return Date(timeIntervalSince1970: millis / 1000.0)
  }

  /// The ms of `date`, for the trip back out of SwiftUI's binding.
  static func millis(_ date: Date) -> Double {
    guard date.timeIntervalSince1970.isFinite else { return 0 }
    return date.timeIntervalSince1970 * 1000.0
  }

  /// `millis` inside `[minimum, maximum]`, with either bound possibly absent.
  ///
  /// Runs in `afterUpdate()` (never in a prop setter: the value and the bounds
  /// arrive in one batch in unspecified order) and on every user selection, so a
  /// wheel spun past the bound or a calendar cell outside the range is clamped
  /// natively and the event JS gets is already legal - the JS wrapper clamps the
  /// same way, and both have to agree exactly.
  ///
  /// Inverted bounds (`minimum > maximum`) make the lower one win: it is the
  /// bound the caller wrote first in the common `min={a} max={b}` mistake, and a
  /// `ClosedRange` built from the pair would have to be broken anyway (see
  /// ``DatePickerContent/selectableRange``).
  static func clamp(_ millis: Double, minimum: Double?, maximum: Double?) -> Double {
    guard millis.isFinite else { return 0 }
    var value = millis
    if let maximum, value > maximum { value = maximum }
    if let minimum, value < minimum { value = minimum }
    return value
  }

  // MARK: - Reports

  /// Snapshot `(displayed, presented)` for ``readReport()``.
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
    // The calendar's own two fields are Android's (-1 = "this platform has no
    // calendar state to read": Material 3's `DatePickerState` publishes a displayed
    // month and a nullable selection, SwiftUI's `DatePicker` publishes neither), and
    // then the process-wide count of live presentations, read live rather than
    // published: a dropped mount has nothing left to publish, which is exactly the
    // case the count exists for.
    // The last field is this mount's own count of platform controls it has built
    // (`controlBuilds`), which is how "a re-render must not re-create the control" is
    // tested: the number has to move when a bound really moved, and must not when only
    // the bound's millisecond did.
    return "\(report)|-1|-1|\(NitroUiDatePickerPresentation.livePresentations)|\(controlBuilds)"
  }

  /// How many times the platform control was built by this mount. See ``readReport()``.
  ///
  /// Counted by ``noteControlBuilt(minimum:maximum:)`` from the control's own
  /// appearance. Plain (not published): it is read after the fact, and nothing may
  /// recompose because it moved.
  var controlBuilds = 0

  /// The bounds the control that is on screen was built with, and nil before the first
  /// one appeared. Recorded by ``noteControlBuilt(minimum:maximum:)``, which the control
  /// itself calls when it appears - so it describes the live control rather than what
  /// React last sent, which is the comparison ``controlIdentity`` needs.
  private(set) var builtBounds: (minimum: Double?, maximum: Double?)?

  /// A platform control appeared, built from these bounds.
  ///
  /// `controlBuilds` counts appearances, the closest thing SwiftUI offers to "this
  /// control was re-built": a control that survives a render does not appear again, and
  /// one that a re-identification replaces does. It is not the identity string itself -
  /// changing an `.id(_:)` on a control that is already on screen can update the live
  /// one in place - so the number only ever means *more or fewer than the same renders
  /// produced before it*, which is how the harness reads it.
  func noteControlBuilt(minimum: Double?, maximum: Double?) {
    controlBuilds += 1
    builtBounds = (minimum, maximum)
  }

  /// What the platform control's SwiftUI identity is keyed on.
  ///
  /// Re-identifying is not a style choice: `UIDatePicker` applies a new `date` *before*
  /// a new `maximumDate`, and a date outside the bounds it still holds is clamped - a
  /// clamp UIKit reports as a selection change from inside its own update, whose reload
  /// then asserts in `UICalendarView _setVisibleMonth:` (SIGABRT; see the
  /// `shows the month the value is in...` harness test, which does exactly this:
  /// `maximumDate` to 31 Dec 2028 together with a value in March 2028). A *fresh*
  /// control starts unbounded, so both bounds land before anything can be clamped - and
  /// a rebuild resets that calendar's own page and a wheel's scroll position, which is
  /// the price documented on the page.
  ///
  /// The price is only worth paying when something actually moved for the control.
  /// Keying it on the raw bound instants made *every* parent render a rebuild, because
  /// `minimumDate={new Date()}` - the first example in `docs/components/date-picker.md` -
  /// sends a new millisecond each time. So: two parts.
  ///
  /// The bounds, at the granularity the control itself has - the local day for a picker
  /// that shows no time, the minute for one that does (``components``). Below that step
  /// the control cannot offer a different day or minute, so a smaller move is not a
  /// reason to take the caller's page or scroll position away from them.
  ///
  /// And one escape: a value that has left the range the control *on screen* was built
  /// with. A bound can move enough to put the clamped value outside the range the live
  /// control holds while moving too little to change the first part - widening
  /// `maximumDate` by an hour inside one day and sending a value in that hour is exactly
  /// the crash above - and that value needs a control that is not holding the old bound.
  /// Such a re-identification rebuilds once more than the bounds alone ask for (the new
  /// control records the bounds it was built from, so the escape stops applying right
  /// after); the alternative is the assert.
  ///
  /// Applied as `.id(_:)` to the control itself. One level out, on `PlatformPicker`, the
  /// same key was measured to assert in `UICalendarView _setVisibleMonth:` - the fresh
  /// control is asked for a month its own bounds exclude as it goes on screen.
  var controlIdentity: String {
    var identity = granularBoundsIdentity
    guard let built = builtBounds else {
      return identity
    }
    let lower = built.minimum ?? -.greatestFiniteMagnitude
    let upper = max(built.maximum ?? .greatestFiniteMagnitude, lower)
    let shown = state.displayed
    if shown < lower || shown > upper {
      identity += "|outside"
    }
    return identity
  }

  /// ``controlIdentity``'s first part: the two bounds, rounded down to the step the
  /// control shows. An unbounded picker has no part of its own, so the common case
  /// never re-identifies.
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

  /// Which components the mode shows. `'date'` is the default for anything unrecognised,
  /// which is what makes a typo on the wire a date picker rather than a crash.
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

  /// Open or close the `compact` field's presentation.
  ///
  /// Every write goes through here - the press, SwiftUI's dismissal of the
  /// popover (tap outside, the Done affordance), `prepareForRecycle()` and
  /// `onDropView()` - because the flag has to describe reality for
  /// ``readReport()`` to be worth testing with. A `@State` in the content would
  /// have been one line shorter and unreadable from JS.
  func setPresented(_ next: Bool) {
    guard next != presented else { return }
    presented = next
    publishReport()
    objectWillChange.send()
    presentationHandler?(next)
  }

  /// The user picked `millis` - through the real binding or a simulated selection.
  ///
  /// Optimistic (core.md §4): `displayed` moves now, so there is no visual latency
  /// while React round-trips, and `(millis, eventCount)` goes out under a fresh
  /// count. A write React sends later either lands on the next `afterUpdate()`
  /// (accepted) or the handshake reverts `displayed`, which is the snap-back.
  ///
  /// A selection that does not move the displayed instant reports nothing. That is
  /// not an optimisation: SwiftUI's binding only writes when the date changes, but
  /// a tap on the already-selected day in Material 3's calendar fires its click
  /// handler anyway, so suppressing here is what keeps the two platforms emitting
  /// the same events (SegmentedControl does the same). It is also what makes a
  /// rejected change *observable*: once the revert has landed, tapping the same day
  /// again must report nothing.
  func applyUserSelection(_ millis: Double) {
    // A disabled control is inert. SwiftUI's `.disabled(_:)` already stops the
    // binding from writing, but `nuiTestSelect` does not go through the view, and
    // "disabled emits nothing" is only assertable if this path agrees.
    guard !disabled else { return }
    let next = DatePickerModel.clamp(millis, minimum: minimum, maximum: maximum)
    guard next != state.displayed else { return }
    let eventCount = state.user(next)
    publishReport()
    objectWillChange.send()
    onChange?(next, Double(eventCount))
  }
}

/// The `compact` field's text and its width.
///
/// Main-thread only (a `UIFont` measurement and a shared cache), like the rest of
/// the SwiftUI side. The cache is keyed by `mode`, Dynamic Type and locale, which
/// is the whole set of things that can change this answer:
///
/// - **The width must not depend on the value.** That is the one decision in this
///   file the sizing engine cares about. `nuiSizingKey` is
///   `"<variant>|<mode>"` (`sizingVariantFor` in `DatePicker.tsx`) and two pickers
///   that share it must want the same box. If the width came from the *displayed*
///   date, "Mar 5" and "December 28, 2288" would share a key and each first
///   instance would report a size that corrects the other's box, back and forth,
///   every time the two of them swapped which one mounted - a layout ping-pong
///   that no test in this repo would catch until an app did it. So the field is
///   as wide as the *widest* string this mode can produce, and the value cannot
///   move the box at all. The alternative (the value in the key) was rejected:
///   `nuiSizingKey` would then have an entry per distinct date ever rendered, the
///   engine's cache would grow without bound in a list of rows, and every value
///   change would be a cold configuration - the exact opposite of what a
///   continuously-changing control needs.
/// - **Dynamic Type** moves it: the field is `.body` text, and the sizing engine's
///   iOS environment signature is content size category + legibility weight
///   (`NitroSwiftUIHost.environmentSignature`), so those two are the environment
///   half of the key.
/// - **Locale** moves it too (German `25.10.2026` vs English `Oct 25, 2026`), and
///   `DatePicker.tsx` deliberately sends no locale: the formatter here *is*
///   `autoupdatingCurrent`, so a runtime locale change would otherwise leave the
///   cached width describing another language. Including it in the key makes the
///   stale entry unreachable instead of wrong. (The engine's own iOS signature
///   still does not carry the locale - a core limitation, recorded in
///   `docs/tasks/G5-datepicker.report.md`.)
@MainActor
enum NitroUiDatePickerField {
  /// Cached `(formatter, width)` per `mode|contentSizeCategory|locale`.
  ///
  /// The formatter is cached because `DateFormatter` construction is famously
  /// expensive; it is `autoupdatingCurrent`, so a locale change *would* be picked
  /// up by an old instance, and the key change below means the pair is fresh
  /// anyway.
  private static var cache: [String: (formatter: DateFormatter, width: CGFloat)] = [:]

  /// The localised text of `millis` for `mode`.
  static func label(millis: Double, mode: String) -> String {
    entry(mode: mode).formatter.string(from: DatePickerModel.date(millis))
  }

  /// The field's text width for `mode`, in points: wide enough for every date.
  static func width(mode: String) -> CGFloat {
    entry(mode: mode).width
  }

  /// Forget every cached width. Nothing calls it today - a Dynamic Type or locale
  /// change makes a *new* key, which is the point of keying on them - but the
  /// cache is process-wide and this is the handle for whoever needs it (an
  /// `app.languageChanged` event, a test that wants the cold path twice).
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
    // Bounded by the number of `(mode, Dynamic Type, locale)` triples the app
    // actually renders - dozens, not thousands - so no eviction policy is worth it.
    cache[key] = built
    return built
  }

  private static func makeEntry(mode: String) -> (formatter: DateFormatter, width: CGFloat) {
    let formatter = DateFormatter()
    // `autoupdatingCurrent`, not `current`: the object must follow the user's
    // settings for as long as it lives, and this cache hands the same instance to
    // every picker of a mode.
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
      // `.font` in the attributes, not `size(withAttributes:)` alone, because the
      // question is "how wide is *this* string in *this* font", and
      // `boundingRect` with `.usesLineFragmentOrigin` is what UIKit itself uses.
      let size = (text as NSString).boundingRect(
        with: CGSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude),
        options: [.usesLineFragmentOrigin, .usesFontLeading],
        attributes: attributes,
        context: nil
      )
      widest = max(widest, size.width)
    }
    // `ceil`, plus a point of slack: `boundingRect` truncates nothing but SwiftUI's
    // `Text` lays out on its own subpixel grid, and a field that is 0.3 pt short
    // truncates "December" to "Decem…" - which is the one failure mode of this
    // design that a user would actually see.
    return (formatter, min(max(ceil(widest) + 1.0, 44.0), 520.0))
  }

  /// The dates whose formatting is widest, so the field never truncates.
  ///
  /// Not a guess at "a long date": every digit of a `.medium` date is at its widest
  /// here, and every month name in the locale is measured rather than assumed to be
  /// the one that *looks* longest in English.
  ///
  /// - day `8` and `28`: the one-digit form is narrower, the two-digit one is what
  ///   must fit; `8` is kept because some locales pad to `08`, which is wider still.
  /// - all twelve months: month name width is locale-dependent, and a locale's
  ///   longest name is not knowable without asking it.
  /// - hours `0`, `8`, `12`, `20`, `23`: one- and two-digit hours, and both AM/PM
  ///   halves (in 12-hour locales `PM` and `AM` differ in width, and in some
  ///   locales the suffix is longer than the digits).
  /// - minute `8`: minutes are always two digits, so one sample is enough; `8`
  ///   rather than `0` because a locale could render `08` wider than `00`.
  /// - year `2288`: four digits like any modern year, so this costs nothing, and
  ///   it covers a calendar that pads the year.
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

/// The SwiftUI half. Reads only the model, so any commit can rebuild it.
struct DatePickerContent: NitroUIContent {
  /// The subscription to ``NitroUiModel/objectWillChange``.
  @ObservedObject private var model: DatePickerModel

  init(model: DatePickerModel) {
    self.model = model
  }

  var body: some View {
    // One `switch` on the variant, three shapes. Changing `variant` swaps the
    // branch, i.e. SwiftUI throws the old picker away and builds the new one -
    // which is right (a calendar and a wheel share no state) and is also why the
    // JS wrapper puts the variant in the element `key`: the sizing *policy* differs
    // per variant, and a remount makes "the policy belongs to the mount" true
    // instead of a rule about prop order.
    Group {
      switch model.variant {
      case "inline":
        // The calendar itself, in the app's layout rather than in a dialog. This
        // is the variant whose height the sizing engine measures, and - unlike the
        // popover - one the harness can press into, because it lives in the app's
        // own window (`docs/components/date-picker.md`, Testing).
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

  /// The field, without a presentation of its own.
  ///
  /// This is *not* `.datePickerStyle(.compact)`, and the reason is the popover's
  /// owner. With the platform's compact style, whether the popover is open lives
  /// inside SwiftUI's own picker state: nothing can close it when the view is
  /// recycled or dropped, nothing can tell JS it is open, and its width is the
  /// width of the *current* value - which is the sizing bug
  /// ``NitroUiDatePickerField`` exists to avoid. Owning the field costs this
  /// ~25-line view and buys three things the brief asks for:
  /// - `prepareForRecycle()`/`onDropView()` can close it, so a popover cannot
  ///   outlive the mount that opened it (the B1 class of bug, in `docs/tasks/G6-picker.md`);
  /// - `nuiTestStateReport()` can report it, so "closed on unmount" is a structural
  ///   assertion instead of a screenshot;
  /// - the width is value-independent, so two pickers sharing an `nuiSizingKey`
  ///   cannot correct each other.
  /// The platform picker is still what the user interacts with: it is the content
  /// of the popover, which ``NitroUiDatePickerPresentation`` presents.
  private var compactField: some View {
    Button(action: openPresentation) {
      Text(NitroUiDatePickerField.label(millis: model.state.displayed, mode: model.mode))
        .font(.body)
        .lineLimit(1)
        .truncationMode(.tail)
        .foregroundStyle(model.tint.map { Color($0) } ?? Color.accentColor)
        // The width is the cache's, never the string's - see the type above.
        // `.leading` so a string that somehow still overruns truncates on the
        // right instead of centring a short date in a wide field.
        .frame(width: NitroUiDatePickerField.width(mode: model.mode), alignment: .leading)
        // Inside the label, so the padding is part of the button: a 20 pt text
        // makes a 20 pt tap target, which is a dead-zone story (`core.md` §7) even
        // though the field itself is legible.
        .padding(.vertical, 8)
    }
    .buttonStyle(.plain)
    // Without this the hit area is the *glyphs*; with it, the whole padded rect -
    // including the space either side of a short month name.
    .contentShape(Rectangle())
    // The announced value. ``OptionalDatePickerAccessibility`` applies
    // `accessibilityLabel(_:)` to the whole content, and for this variant that content
    // is this button - whose only accessible text is the date, which the label
    // *replaces*. With a label set, VoiceOver would read "Departure, button" and never
    // the day: the brief's "the announced value is localised" fails on the one variant
    // an app puts in a form (`.graphical` and `.wheel` are fine - the platform picker
    // keeps its own value). The same string the field paints, from the same cached
    // formatter, so the announcement is what the user sees.
    .accessibilityValue(
      Text(NitroUiDatePickerField.label(millis: model.state.displayed, mode: model.mode))
    )
  }

  // MARK: - The press

  /// The press. Goes through the model, so `nuiTestPresent()` and a real tap are
  /// the same code path and a harness can drive either.
  private func openPresentation() {
    model.setPresented(true)
  }
}

// MARK: - The platform picker

/// SwiftUI's `DatePicker`, unstyled - each call site picks its style.
///
/// Its own view rather than a property of ``DatePickerContent`` because there are
/// two hosts: the content React Native lays out, and the popover UIKit presents.
/// Both must show the same bound value with the same localised label, and one place
/// that builds it is what stops a clamp or a range meaning two things.
private struct PlatformPicker: View {
  /// The subscription to ``NitroUiModel/objectWillChange``.
  @ObservedObject private var model: DatePickerModel

  init(model: DatePickerModel) {
    self.model = model
  }

  /// The title is the accessibility label: a `DatePicker` always takes a label, and
  /// the *visible* one is hidden by `labelsHidden()` because a React Native control
  /// is labelled by its `accessibilityLabel` prop (or not at all, for a field that
  /// sits next to a Text the app drew). VoiceOver still announces the label plus the
  /// localised value, which is the requirement in the brief.
  var body: some View {
    DatePicker(
      model.accessibilityLabel ?? "",
      selection: selection,
      in: selectableRange,
      displayedComponents: model.components
    )
    .labelsHidden()
    // Re-identified by ``DatePickerModel/controlIdentity``, and only there: the same
    // key, applied one level out to `PlatformPicker` from its call sites, was measured
    // to assert in `UICalendarView _setVisibleMonth:` - which is the failure the
    // identity exists to avoid.
    .id(model.controlIdentity)
    .onAppear { model.noteControlBuilt(minimum: model.minimum, maximum: model.maximum) }
  }

  /// The bounds, as the range SwiftUI's `DatePicker(in:)` wants.
  ///
  /// "No bound" is `distantPast`/`distantFuture` rather than the other initialiser,
  /// because `valueMillis` can be any instant and an unbounded picker must be able
  /// to *show* it: a range that clipped 1901 would fight the clamped value, and the
  /// binding would then be inconsistent with what the calendar displays.
  ///
  /// Inverted bounds collapse to `minimum...minimum` - the same rule as
  /// ``DatePickerModel/clamp(_:minimum:maximum:)``, and required: a `ClosedRange`
  /// with `lowerBound > upperBound` is a runtime trap, not an empty range.
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

  /// The selection, native-owned and optimistic (core.md §4).
  ///
  /// The setter paints the new date *before* JS has seen the event, and emits
  /// `(millis, eventCount)` through the model, so the same `useControlled` in JS
  /// drives this as drives Switch and SegmentedControl.
  private var selection: Binding<Date> {
    Binding(
      get: { DatePickerModel.date(model.state.displayed) },
      set: { model.applyUserSelection(DatePickerModel.millis($0)) }
    )
  }
}
/// `.tint()` has no "unset" form, so the default keeps SwiftUI's accent colour.
///
/// Unlike SegmentedControl's tint - which a segmented `Picker` ignores (G4 F1) -
/// this one is visible on iOS: it is the graphical calendar's selected day and the
/// wheel's highlight.
private struct OptionalDatePickerTint: ViewModifier {
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

/// An empty `accessibilityLabel(_:)` would silence the picker's own labels, so it
/// is applied only when set. `testID` deliberately does *not* go in here: RN already
/// puts it on the component view, and putting it on the SwiftUI element too would
/// make the view match a testID query twice.
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

/// What the `compact` field's popover shows, as a view tree UIKit can host.
///
/// The content React Native lays out and the content of the presentation are the
/// same platform picker with a different style: `.graphical` for a date and
/// `.wheel` for a time, which is what iOS's own compact field opens. The tint is
/// repeated here because a popover is a new environment - without it the calendar's
/// selected day would be the app's accent rather than this instance's `tintColor`.
private struct DatePickerPopoverContent: View {
  /// The subscription to ``NitroUiModel/objectWillChange``, so a value the parent
  /// changes while the bubble is open repaints it rather than freezing the frame
  /// the press happened on.
  @ObservedObject private var model: DatePickerModel

  init(model: DatePickerModel) {
    self.model = model
  }

  var body: some View {
    Group {
      if model.mode == "time" {
        PlatformPicker(model: model).datePickerStyle(.wheel)
      } else {
        // `datetime` too: SwiftUI's `.graphical` style with `[.date, .hourAndMinute]`
        // draws the calendar *and* a time row that opens a wheel, so the time half of
        // a `datetime` field is reachable from this one bubble rather than missing.
        PlatformPicker(model: model).datePickerStyle(.graphical)
      }
    }
    // The width the picker is laid out at - the reason this view exists as its own
    // type. See ``NitroUiDatePickerPresentation/calendarWidth``.
    .frame(width: NitroUiDatePickerPresentation.calendarWidth)
    .padding(.horizontal, NitroUiDatePickerPresentation.margin)
    .modifier(OptionalDatePickerTint(color: model.tint))
  }
}

/// The `compact` field's popover: UIKit's presentation, SwiftUI's content.
///
/// Both things a popover has to get right come out wrong when a SwiftUI `.popover`
/// is attached to content hosted inside a React Native view, and neither failure is
/// visible to the app:
///
/// - **Size.** A presentation asks its content how big it is before there is a width
///   to offer, and a `DatePicker` answers by taking whatever it is offered. Measured
///   that way this one asked for 68x188.7 pt and laid a month of day cells from
///   `x: -43` to `x: 141` of that: seven columns 7 pt wide, most of the month outside
///   its own bubble, and every day a fraction of the 44 pt minimum touch target
///   (`core.md` §7). The `presented` flag, the reported value and the harness were all
///   truthful about it.
/// - **Anchor.** `UIViewController.present` walks up to the nearest presenter, so
///   SwiftUI's source item is resolved in *that* controller's view rather than the
///   field's: the bubble appeared below the status bar with its arrow pointing at
///   nothing while the field sat 190 pt below it.
///
/// Presenting here costs ~60 lines and fixes both with the two facts UIKit needs:
/// `sourceView`, which is this control's own view wherever Yoga put it, and
/// `preferredContentSize`, measured the same way the sizing engine measures every
/// other control in this library - `sizeThatFits(in:)` with an unbounded height
/// proposal, which is what `NitroSwiftUIHost.fittingSizeProposal` asks too.
///
/// What did *not* move is the lifecycle: `presented` stays the model's, UIKit writes
/// it back when the user taps outside, and `prepareForRecycle()`/`onDropView()` close
/// the bubble through the same setter (the B1 rule in `docs/tasks/G6-picker.md`), so
/// a presentation cannot outlive the mount that opened it.
final class NitroUiDatePickerPresentation: NSObject, UIPopoverPresentationControllerDelegate {
  /// The calendar's own width inside the popover.
  ///
  /// A `.graphical` calendar divides its width by seven and does not refuse a small
  /// proposal, so this number is the touch-target decision: 320 pt gives 45 pt day
  /// cells, the narrowest width that still clears the 44 pt minimum, and it is about
  /// what iOS's own compact field presents. A `time` wheel is narrower than this but
  /// is given the same box, so two modes of one control cannot present two different
  /// widths for a reason nobody chose.
  ///
  /// This is *not* the sizing engine's business: Yoga sized the field, and the
  /// popover is not in the React Native layout at all.
  static let calendarWidth: CGFloat = 320
  /// The gap between the calendar and the popover's edge.
  static let margin: CGFloat = 8
  /// `calendarWidth` plus both margins - the width the content is measured with.
  static var contentWidth: CGFloat { calendarWidth + 2 * margin }

  // MARK: - Live presentations

  /// How many presentations this process has open right now.
  ///
  /// Process-wide rather than per mount, because the property it guards is "no
  /// presentation outlives the mount that opened it" - and a mount that has been
  /// dropped has nothing left to report. ``countOpened()`` runs in `present`'s
  /// completion and ``countClosed()`` on each terminal path (UIKit's own dismissal,
  /// and our `dismissNow`), so the number returns to zero only when the window is
  /// really gone. `presents nothing after the mount that opened it is gone` reads it
  /// through a *fresh* mount's `nuiTestStateReport()`, which is the only witness that
  /// survives the drop.
  ///
  /// Locked rather than a plain `static var`: the writes are all on main, but
  /// ``DatePickerModel/readReport()`` is documented safe from any thread and reads it
  /// from JS, and JS must never hop to main for it (`core.md` §1.4).
  private static let countLock = NSLock()
  private static var count = 0

  static var livePresentations: Int {
    countLock.lock()
    defer { countLock.unlock() }
    return count
  }

  private static func countOpened() {
    countLock.lock()
    count += 1
    countLock.unlock()
  }

  private static func countClosed() {
    countLock.lock()
    count -= 1
    countLock.unlock()
  }

  private let model: DatePickerModel
  /// The control's own view: what the popover's arrow points at.
  private weak var anchor: UIView?
  /// Read at present time, because containment follows the view in and out of a
  /// window and a presentation is only possible while it is in one. Main-actor
  /// because it reads a view controller, which is what the closure is for.
  private let presenterProvider: @MainActor () -> UIViewController?
  private var controller: UIHostingController<DatePickerPopoverContent>?
  /// Whether `present()`'s entry transition is still running.
  private var isPresenting = false
  /// A dismissal that arrived during that transition, carried to its completion.
  private var dismissWhenPresented = false
  /// Whether this instance's presentation is counted in
  /// ``livePresentations``. One presentation, one decrement: a programmatic
  /// ``dismissNow()`` whose completion lands next to a `presentationControllerDidDismiss`
  /// from the same teardown must not take the count below zero, or the harness's
  /// witness would read "nothing presented" while a window is still up.
  private var countedOpen = false

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

  /// Open the bubble anchored to the field, sized to what the picker needs.
  ///
  /// No-op when there is nothing to present from (the view is not in a window, so
  /// nothing contains this host's controller) - the model's flag still says what the
  /// app asked for, and no half-presented window is left behind.
  func present() {
    nitroUiAssertMainThread()
    // The type system does not model this class's thread (it is created from a
    // Hybrid `init`, which has no actor to inherit), so the hop is asserted rather
    // than inferred - the same bargain `NitroUiMainThread` strikes for the hosts.
    MainActor.assumeIsolated {
      presentIsolated()
    }
  }

  @MainActor
  private func presentIsolated() {
    if let controller, controller.presentingViewController != nil {
      // Already on screen for this instance. The only way a dismissal is outstanding
      // is an entry transition that has not finished, which means the request came
      // from a mount that is already gone - and a press arriving *now* is that
      // mount's replacement asking for the same window. Cancelling the pending close
      // is what makes the flag the caller just wrote true; obeying it would leave the
      // new mount claiming an open popover that is on its way out.
      dismissWhenPresented = false
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
    // Either direction, and UIKit picks the one with room. The old comment here
    // claimed a bubble flipped above the field "would point at the tab bar"; it does
    // no such thing - an arrow pointing *down* lands on the field - and what
    // permitting only `.up` actually did was cap the popover at the space *below* the
    // field. UIKit honours the permitted directions and squeezes the content into the
    // room on that side, so a field in the lower half of the screen (a form's last
    // row, anything above a keyboard or a tab bar) got a calendar shorter than the
    // `preferredContentSize` it asked for: the month clipped, and the day cells under
    // the 44 pt target this class's `calendarWidth` exists to guarantee.
    popover.permittedArrowDirections = [.up, .down]
    popover.delegate = self
    isPresenting = true
    dismissWhenPresented = false
    presenter.present(hosted, animated: true) { [weak self] in
      guard let self else { return }
      self.isPresenting = false
      if !self.countedOpen {
        self.countedOpen = true
        Self.countOpened()
      }
      if self.dismissWhenPresented {
        self.dismissWhenPresented = false
        self.dismissNow()
      }
    }
  }

  /// Close the bubble. Not animated: the callers are recycle and drop, where the
  /// view that owned it is going away in the same turn.
  func dismiss() {
    nitroUiAssertMainThread()
    MainActor.assumeIsolated {
      // UIKit refuses a dismissal that arrives while the presentation is still
      // animating in, and a dropped view does not wait for the animation: the
      // refusal is then not a delay but a leak, and the popover goes on covering the
      // app that no longer owns it. So the request is remembered and carried out by
      // the presentation's own completion, which is the earliest moment UIKit can
      // honour it. (This is how the leak showed up: presenting the popover with its
      // platform animation made the harness's "dropped while open" check fail.)
      if isPresenting {
        hideImmediately()
        dismissWhenPresented = true
        return
      }
      dismissNow()
    }
  }

  /// Take the bubble out of the app's way without waiting for UIKit's teardown.
  ///
  /// A presentation UIKit is still animating in cannot be dismissed - but it can be
  /// *unplugged*, and that is the difference between a control the app dropped
  /// costing a fraction of a second and costing a stuck screen. UIKit installs a
  /// presentation in one full-screen view (measured on iOS 27: the window's child
  /// `presentationController.containerView`, holding `_UIPopoverDimmingView` at the
  /// window's size and the `_UIPopoverView` bubble), so hiding that one view takes
  /// both the calendar *and* its dimming layer out of the draw and out of `hitTest:`
  /// in the same turn. Without this the dimming view is what the next touch belongs
  /// to: measured here, a `DatePicker` dropped 140 ms after its field was pressed
  /// kept swallowing touches for another 500 ms - the length of the entry
  /// transition - while the app underneath was untouchable under a control it had
  /// already deleted.
  ///
  /// Nothing here is UIKit's teardown: `dismissWhenPresented` still dismisses for
  /// real at the completion, so UIKit removes its own views and releases the
  /// presentation controller the way it expects. Hiding may stay set because
  /// `popoverPresentationController` is rebuilt per presentation (see
  /// ``presentIsolated()``), so the next bubble arrives with a fresh container.
  @MainActor
  private func hideImmediately() {
    controller?.presentationController?.containerView?.isHidden = true
  }

  /// The dismissal UIKit can perform right now. Split from ``dismiss()`` so the
  /// completion above can reach it without re-asking about the transition.
  @MainActor
  private func dismissNow() {
    guard let controller, controller.presentingViewController != nil else {
      return
    }
    // Take the ticket before asking, and hand *that* to the completion: this can be
    // called for a presentation that was never counted (a `dismiss()` on a control that
    // never got a presenter), and an unearned decrement would put the harness's witness
    // at "nothing presented" while a window is still up. The completion deliberately
    // does not capture `self` - it has to run even when the view that owned the
    // presentation is already gone, which is the normal case for a drop.
    let wasCounted = countedOpen
    countedOpen = false
    controller.dismiss(animated: false) {
      if wasCounted {
        Self.countClosed()
      }
    }
  }

  // MARK: - UIPopoverPresentationControllerDelegate

  /// Keep it a popover on a phone.
  ///
  /// Without this, UIKit adapts a `popover` to a full-screen sheet at compact width,
  /// which is a different control: closing it is a drag rather than a tap outside,
  /// and it covers the app instead of pointing at the field it belongs to.
  func adaptivePresentationStyle(
    for presentationController: UIPresentationController,
    traitCollection: UITraitCollection
  ) -> UIModalPresentationStyle {
    .none
  }

  /// The user tapped outside. UIKit closed the window without asking us, so the flag
  /// has to follow - that write is what makes "closed on unmount" (`test 6`) a real
  /// assertion instead of a claim about a state nothing ever reads.
  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    if countedOpen {
      countedOpen = false
      Self.countClosed()
    }
    model.setPresented(false)
  }
}

/// The Hybrid View React renders as `NitroUiDatePicker`.
final class HybridNitroUiDatePicker: HybridNitroUiDatePickerSpec, RecyclableView {
  private let host: NitroSwiftUIHost<DatePickerContent>
  /// The `compact` field's popover. UIKit owns the window, this owns the window's
  /// size and anchor, and the model's `presented` flag owns whether it is open -
  /// see ``NitroUiDatePickerPresentation`` for why neither SwiftUI's `.popover` nor
  /// a `@State` can do that from inside hosted content.
  private let popover: NitroUiDatePickerPresentation

  /// This component's name in the sizing engine: `HybridNitroUiDatePickerComponentName`
  /// in the generated C++, and `getName()` in the generated Kotlin.
  private static let sizingComponentName = "NitroUiDatePicker"

  /// The size to lay a DatePicker out with before anything has been measured.
  ///
  /// One pair for a component with six configurations (`3 modes x 2 variants` that
  /// are intrinsic-relevant, plus two fillWidth variants): the engine's fallback is
  /// keyed by component, so this is the most common one - a `compact` `date` field -
  /// and every other configuration is a first instance of *its own* configuration
  /// that gets corrected the turn it measures (`docs/architecture/sizing.md` §9).
  ///
  /// Measured on the gate simulator (iOS 27, iPhone Air, regular text size,
  /// `AppleLocale = en_PT`) with `variant = "compact"`, `mode = "date"`: the field's
  /// box is **103.00 x 36.33 pt** - the size the harness logs for that configuration
  /// (`variants (ios, ...): field=103.00x36.33`), not a round number picked to look
  /// tidy. Declaring what the control actually measures puts the pair inside the
  /// engine's 0.5 pt `kEpsilon`, so a cold `compact` `date` mount is laid out at its
  /// own size and pays no correction (D17).
  ///
  /// The height is the one number here that does not move with the locale. The width
  /// is the widest `date` string the *locale's* formatter produces (see
  /// ``NitroUiDatePickerField``), so it is exact for the configuration it was measured
  /// in and approximate for the rest: the same configuration measures 107.00 under
  /// `en_US`, and `mode = "time"` measures 48.00 here against 72.00 there. A locale
  /// wider than this one costs that configuration's first instance one horizontal
  /// correction, which is the documented price of a sizing key that excludes the
  /// value. That is a price, not a safe side: `core.md` section 7 says neither
  /// direction is safe - too narrow is the dead-touch story, and too wide is dead
  /// padding beside the control - so the honest statement is how far wrong this
  /// pair can be for a configuration it was not measured in (4 pt narrow for
  /// `en_US`), not that being wrong there is free.
  ///
  /// As everywhere else, a fallback *smaller* than the control is the dead-touch
  /// story in `core.md` §7, and a `compact` field that is 44 pt wide for one frame
  /// truncates a long month name for exactly that frame. `inline` is the
  /// configuration where being wrong is most visible (a calendar laid out 32 pt
  /// tall clips itself), which is why `lays each variant out at the size the control
  /// measured` puts a cold `inline` and a cold `wheel` under a 320 dp caller and
  /// requires each to correct to its own measured height.
  private static let declaresFallback: Bool = {
    NitroUiSizing.setFallback(sizingComponentName, fallbackSize.width, fallbackSize.height, NitroUiSizingPolicy.intrinsic.rawValue)
    return true
  }()

  /// Hand this control's declared size to the sizing engine, once per process (the
  /// static above is lazy and thread-safe, so repeat calls cost nothing).
  ///
  /// ``NitroUiDeclaredFallbacks`` calls this at startup, which is the point that
  /// matters: Fabric measures a shadow node before it creates any view, so a
  /// fallback declared from `init` is one measure too late for the first instance
  /// (T14). `init` still calls it, as the backstop.
  static func declareFallback() {
    _ = Self.declaresFallback
  }

  /// The declared fallback - see ``declaresFallback``.
  private static let fallbackSize = (width: 103.0, height: 36.33)

  /// The Nitro `view` - created once here and never replaced.
  override init() {
    // Explicit generic: as a property declaration the type came from `view`'s
    // signature, but a local that feeds both the popover and `self.host` has to say
    // what it hosts.
    let host = NitroSwiftUIHost<DatePickerContent>(model: DatePickerModel())
    let model = host.model
    popover = NitroUiDatePickerPresentation(
      model: model,
      anchor: host,
      presenterProvider: { [weak host] in host?.containingViewController }
    )
    self.host = host
    super.init()
    // The fitting size is both measured and pushed (docs/architecture/sizing.md).
    host.wantsContentSize = true
    // `compact` - the default - is intrinsic. The setter below moves this for the
    // two picker variants, and the JS wrapper remounts on a variant change so the
    // policy is per mount.
    host.sizingPolicy = .intrinsic
    // The one shipped component that needs it: `compact` presents a popover, and a
    // presentation needs a view controller to be presented *by*. Containment is what
    // gives ``NitroUiDatePickerPresentation`` one, and the walk in
    // `NitroSwiftUIHost.findContainerViewController()` skips navigation/tab
    // controllers, which cannot host a popover cleanly.
    host.needsContainment = true
    // The single door between the flag and the window: the field's press,
    // `nuiTestPresent()`, `prepareForRecycle()` and UIKit's own tap-outside dismissal
    // all write `presented`, and only this closure talks to UIKit. Weak, because the
    // popover keeps the model alive through its SwiftUI content and the model must not
    // own the thing it presents.
    model.presentationHandler = { [weak popover] next in
      next ? popover?.present() : popover?.dismiss()
    }
    // The backstop: startup normally registers this through
    // ``NitroUiDeclaredFallbacks`` long before one can be measured, and a host
    // built without that table still gets its fallback here.
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
      // The *clamped* instant, not the number React sent - same as Slider's
      // `value` and SegmentedControl's `selectedIndex`, and what makes a value the
      // bounds rejected visible to a test instead of readable as if it were live.
      return .second(DatePickerModel.clamp(js, minimum: model.minimum, maximum: model.maximum))
    }
    set {
      // Not visual on its own: `displayed` only follows once the event count says
      // JS has caught up, and the instant only means something against the bounds,
      // which can be in this same batch. Both happen in `afterUpdate()`.
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
      // A time field is not the same width as a date field, and the graphical
      // calendar for a date is not the same height as a time wheel: no bounds or
      // trait change will notice, so the size has to be asked for again (`F1` in
      // the SegmentedControl review is the same bug class).
      host.noteContentSizeMayHaveChanged()
    }
  }

  var variant: String {
    get { model.variant }
    set {
      guard newValue != model.variant else { return }
      model.variant = newValue
      host.markDirty()
      // The biggest size change this component can make - a 32 pt field versus a
      // ~360 pt calendar - and it also changes *how* the size is decided, which is
      // what Progress does per `variant` and Slider does statically.
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
      // Repaints (a calendar greys out days) and can move the displayed instant,
      // which `afterUpdate()` applies. Not a size change: the picker's shape does
      // not depend on the range.
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
      // Nothing to apply: `testID` is an RN base prop too, and
      // `RCTViewComponentView` already puts it on the component view as
      // `accessibilityIdentifier`. It stays in the spec because Android needs it
      // as a `tag`.
      model.testID = newValue.asType(String.self)
    }
  }

  var accessibilityLabel: Variant_NullType_String {
    get {
      guard let label = model.accessibilityLabel else { return .first(.null) }
      return .second(label)
    }
    set {
      // Rendered, not bookkeeping: the label goes on the hosted element - and on
      // the `DatePicker`'s title, which is what VoiceOver reads as the field's name
      // - so it needs a commit or a late-set label never reaches VoiceOver.
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
      // The engine has no answer for a key it has not seen, so it lays this out at
      // the declared fallback; the new configuration may measure exactly what the
      // old one did, and that is the size the host's dedupe would swallow the
      // correcting report against (review F1). Guarded, because React re-sends an
      // unchanged key on every render and the reset costs a measure.
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
    // The value, the default and the two bounds can all land in one batch in any
    // order, so none of them is interpreted until the batch is complete - an
    // instant outside the range only means something once the range it belongs to
    // is known (core.md §3, and Slider's `value` does the same against its range).
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
    // The event-count handshake decides whether React's instant wins over what the
    // user just picked - including a change JS rejected (§4).
    if model.state.reconcile() {
      host.markDirty()
    }
    // Bounds that arrived *after* the displayed instant can leave it outside them.
    // The same clamp, and idempotent, so an instant that is already legal comes
    // back unchanged - which is why this runs on every batch without needing to
    // know which prop moved.
    let shown = DatePickerModel.clamp(model.state.displayed, minimum: minimum, maximum: maximum)
    if shown != model.state.displayed {
      model.state.displayed = shown
      host.markDirty()
    }
    // A batch can move the displayed instant without any rendered change (React
    // confirming what native already picked), and the report must not go stale:
    // the call itself costs two float comparisons when nothing moved.
    model.publishReport()
    host.commit()
  }

  func prepareForRecycle() {
    // First, before the value resets: an open popover belongs to the *previous*
    // mount, and SwiftUI dismisses it as part of this write. Order is load-bearing
    // in the other direction too - if the model reset first, the dismissed popover
    // would report the next mount's value.
    model.setPresented(false)
    model.state = NitroUiControlledValue<Double>(displayed: 0)
    model.defaultValueMillis = 0
    model.didApplyDefault = false
    model.mode = "date"
    model.variant = "compact"
    model.minimum = nil
    model.maximum = nil
    model.disabled = false
    model.tint = nil
    model.testID = nil
    model.accessibilityLabel = nil
    model.sizingKey = ""
    model.onChange = nil
    // The next mount starts at the default policy: a recycled instance must not
    // keep a `fillWidth` policy from an `inline` previous mount while the new
    // content is a `compact` field (the `variant` setter is what normally owns this).
    host.sizingPolicy = .intrinsic
    model.publishReport()
    host.prepareForRecycle()
  }

  func onDropView() {
    model.onChange = nil
    // The other half of the leak rule: a presentation must not outlive the mount
    // that opened it. `host.drop()` detains the container too, but closing first is
    // what makes the *state* honest as well as the screen - and the generated
    // component view calls this before `prepareForRecycle()`, so both paths run.
    model.setPresented(false)
    host.drop()
  }

  // MARK: - Methods

  /// The size SwiftUI wants for this picker, from the host's cache.
  ///
  /// Never touches the main thread: this can be called from JS, and SwiftUI may
  /// only be measured on main (core.md §1.4).
  func measureContent() throws -> NitroUiDatePickerSize {
    guard let size = host.contentSize else {
      return NitroUiDatePickerSize(width: 0, height: 0)
    }
    return NitroUiDatePickerSize(width: Double(size.width), height: Double(size.height))
  }

  /// Drive one selection through the real interaction pipeline. Test-only; see the
  /// spec's doc comment for why it exists.
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

  /// Open the `compact` field's presentation, through the same entry point the press
  /// uses. Test-only.
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

  /// `(displayed, presented)` as one lock-guarded line. Safe from any thread, and
  /// the only way JS can see what native is showing rather than what it was told.
  func nuiTestStateReport() throws -> String {
    return model.readReport()
  }

  /// Assemble the instant `nuiTestSelect` asked for and hand it to the selection path.
  ///
  /// Fields the current `mode` does not show keep the displayed value, because that
  /// is what the platform control does: iOS's graphical calendar writes the day and
  /// leaves the hour alone, and a simulator that also rewrote the time would make
  /// the harness's DST expectation differ from a real tap's for no reason.
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
        // A day the target month does not have is clamped to its last day rather
        // than rolled into the next month, which is what `DateComponents` and
        // Java's `LocalDate.withDayOfMonth` both do. Asking for the 31st of a
        // 30-day month must not silently become the 1st of the next one.
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
    // No seconds on the wire and no seconds in either picker, so the displayed
    // ones survive - the same rule as the fields the mode does not show.
    guard let date = calendar.date(from: components) else { return }
    model.applyUserSelection(DatePickerModel.millis(date))
  }

  private var model: DatePickerModel {
    return host.model
  }
}

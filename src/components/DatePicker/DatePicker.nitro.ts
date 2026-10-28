import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';

/**
 * Native props of the `NitroUiDatePicker` Hybrid View.
 *
 * No member is optional (DECISIONS D7 / nitro#1184) except the callback (D7b):
 * Fabric sends `null` for a prop that JS removed and Nitro only treats
 * `undefined` as "unset", so an optional prop that vanishes crashes. The wrapper
 * (`DatePicker.tsx`) always sends every prop, using `null` for "not set".
 *
 * Every date crosses the bridge as **milliseconds since the epoch** (`number`).
 * A `Date` is not a Nitro type, and ms is the only representation that survives
 * both `processColor`-free props and the `Double` the handshake needs. The ms is
 * an absolute instant; what the user sees is that instant rendered in the
 * device's calendar and time zone (`docs/components/date-picker.md`), which is
 * why a value round-trips across a DST boundary instead of drifting an hour.
 *
 * "No lower bound" / "no upper bound" is `null`, not a sentinel number. A magic
 * `Date` (`0`, or ±8.64e15) would have to be *chosen* to be outside every
 * calendar, and both platforms' pickers have a real year range they derive from
 * the bounds they are given - a number that means "unbounded" to one platform is
 * the year 1 to the other. `number | null` is the spelling the library already
 * uses for an absent colour and an absent controlled value, and a getter that
 * sees `null` never has to compare a NaN (whose every comparison is false, which
 * is how a clamp written against a sentinel silently clamps nothing).
 *
 * Setters must not interpret one prop against another (Nitro does not order
 * props inside a batch - core.md §3), so the value, the default and the two
 * bounds are stored raw and reconciled together in `afterUpdate()`.
 */
export interface NitroUiDatePickerProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  /**
   * Controlled value in ms since the epoch, or `null` for an uncontrolled
   * control - in which case native keeps the displayed instant and
   * `defaultValueMillis` seeded it.
   *
   * Stored raw and clamped into `[minimumMillis, maximumMillis]` in
   * `afterUpdate()`, like Slider's `value` is quantised there rather than in the
   * setter.
   */
  valueMillis: number | null;
  /**
   * Initial displayed instant of an uncontrolled control, in ms; ignored while
   * `valueMillis` is set. Applied once, in `afterUpdate()`.
   *
   * Not nullable: an uncontrolled picker must start somewhere, and the wrapper
   * sends the JS-side fallback (`new Date()`'s ms, or `defaultValue`) so native
   * never has to invent a date on its own.
   */
  defaultValueMillis: number;
  /**
   * The last event count JS has fully processed (core.md §4). Native only accepts
   * a `valueMillis` write once it has seen this many of its own events, which is
   * what makes a rejected change revert to the date React is still showing.
   */
  mostRecentEventCount: number;
  /**
   * What the user picks: `'date'`, `'time'` or `'datetime'`.
   *
   * Size-affecting on both platforms (a time picker is a different shape from a
   * calendar), so it is part of `nuiSizingKey` and its setter says so.
   */
  mode: string;
  /**
   * How it is presented: `'compact'` (a field that opens the platform picker),
   * `'inline'` (the picker itself) or `'wheel'` (iOS's wheel; see the platform
   * notes in `docs/components/date-picker.md` for what Android renders).
   *
   * The most size-affecting prop here - it is the difference between a 32 pt
   * field and a calendar - so it is the leading component of
   * `nuiSizingKey`, and its setter also moves the host's sizing policy:
   * `compact` is intrinsic, the two picker variants are `fillWidth` (Progress
   * switches its policy per `variant` the same way).
   */
  variant: string;
  /** Lowest selectable instant in ms, or `null` for "no lower bound". */
  minimumMillis: number | null;
  /** Highest selectable instant in ms, or `null` for "no upper bound". */
  maximumMillis: number | null;
  /** Disable interaction (and show the disabled style). No change events. */
  disabled: boolean;
  /**
   * RN-processed (`processColor`) ARGB colour, or `null` for the platform
   * default.
   *
   * Unlike SegmentedControl's tint, this one takes effect on both platforms: it
   * is the SwiftUI date picker's accent (its field label, calendar selection and
   * wheel highlight) and the Material 3 picker's primary colour (headline,
   * selected day, dial, field outline).
   */
  tintColor: number | null;
  /** Forwarded to the native view so tests and a11y tools can find it. */
  testID: string | null;
  /**
   * Accessibility label of the control. Both platforms give their picker a
   * localised value announcement of its own ("Saturday, March 14, 2026"); this
   * is the *label*, which is what makes the announcement say what the field is
   * for (`docs/components/date-picker.md`, Accessibility).
   */
  accessibilityLabel: string | null;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
  /**
   * Called on every user selection with the instant native now displays, plus
   * native's event count (the JS wrapper echoes it back as
   * `mostRecentEventCount` and rebuilds the `Date` for `onChange`).
   *
   * Not called for a selection that does not move the displayed instant: a
   * SwiftUI `DatePicker` binding only writes when the date changes, and tapping
   * the day that is already selected in Material 3's calendar fires its click
   * handler anyway, so the Android implementation suppresses the no-op to keep
   * the two platforms reporting the same events (as SegmentedControl does).
   * Suppression is also what makes a rejected change observable: the second
   * selection of the same day must report nothing once the revert has landed.
   *
   * Callback props are the exception to the no-optional rule (D7b): Nitro only
   * unwraps `{ f: fn }` for a prop whose type *is* a function, so this must never
   * become `fn | null`. The wrapper always sends one - a stable no-op when the
   * caller passed nothing - so removing a handler cannot leave the previous one.
   */
  onValueChange?: (millis: number, eventCount: number) => void;
}

export interface NitroUiDatePickerMethods extends HybridViewMethods {
  /**
   * The size of the hosted control, as measured on the UI thread during the last
   * layout/commit. Never calls into SwiftUI/Compose: JS reads a cached value, so
   * this is safe to call from the JS thread (core.md §1.4).
   */
  measureContent(): NitroUiDatePickerSize;

  /**
   * TEMPORARY, test-only: perform one user selection of the given **local**
   * calendar fields through the same entry point a real pick uses - clamped to
   * the current bounds, optimistic, and emitted with a fresh event count - so a
   * harness can assert the handshake, the clamping and the DST round-trip without
   * a touch synthesiser that can reach a calendar cell, a wheel or a dialog.
   *
   * `month` is 1-12 (a JS `Date`'s month is 0-based; a native calendar field is
   * not, and a picker that speaks in calendar fields should not shadow the
   * engine's off-by-one). Fields that cannot exist in the target month are
   * clamped the way `Calendar`/`DateComponents` clamp them - the 31st of a
   * 30-day month is its last day, not the 1st of the next one.
   *
   * Fields the current `mode` does not show keep the displayed value, and seconds
   * are never touched: a `date` picker's hour/minute arguments are ignored, a
   * `time` picker's date arguments are ignored. That is what the platform control
   * does when a user taps a day (it writes the day and leaves the clock alone), so
   * a simulated pick and a real one cannot disagree about the resulting instant.
   *
   * Goes through the *selection* path, not the props path: it moves `displayed`
   * and emits, exactly like a tap, so a change JS refuses still reverts.
   *
   * @internal Not app API (DECISIONS D14). Deleted when the harness can drive a
   * calendar cell.
   */
  nuiTestSelect(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number
  ): void;

  /**
   * TEMPORARY, test-only: open the presentation the `compact` field's press
   * opens (iOS popover, Material 3 dialog), through the same entry point the
   * press uses. A no-op for the picker variants, which present nothing.
   *
   * Exists because `react-native-harness` presses a *hosted* control by
   * hit-testing the app window, and whether that reaches a SwiftUI field's button
   * is exactly the thing this suite must not depend on to test the far more
   * important half: that a presentation a mount opened is gone when the mount
   * ends. Read that with ``nuiTestStateReport``.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestPresent(): void;

  /**
   * TEMPORARY, test-only: what this control currently shows, as one line:
   * `<displayed ms>|<presented 0|1>|<calendar month>|<calendar has selection>|<live presentations>|<control builds>|<built minimum>|<built maximum>`.
   *
   * The displayed instant is the one thing neither a geometry query nor a prop
   * read can see: `valueMillis` is what React *asked for*, and after a change JS
   * rejected the two differ - which is the entire content of the controlled-
   * rejection test, and of the DST round-trip. The presented flag is what makes
   * "the dialog closed when the view went away" a structural assertion rather
   * than a screenshot.
   *
   * The last two fields are the bounds the platform control *on screen* was built
   * with (`-1` = none built yet, `-2` = that bound is unset) - what the rebuild
   * decision is keyed on, as distinct from what React last sent. Both platforms
   * record them at the moment the control is built.
   *
   * It is a method rather than a prop because it reads UI-thread state from any
   * thread: the answer is snapshotted under the same lock that guards the write
   * (`NitroUiMainThread`'s rule - never `main.sync`), so this never blocks for
   * the main thread.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestStateReport(): string;
}

/**
 * The fitting size of the hosted control, in points (iOS) or dp (Android).
 *
 * For a `fillWidth` variant (`inline`, `wheel`) the width is the box Yoga gave
 * and the height is what the picker wants at that width; for `compact` both come
 * from the control.
 */
export interface NitroUiDatePickerSize {
  width: number;
  height: number;
}

/**
 * The Hybrid View React renders as `NitroUiDatePicker`.
 *
 * @internal v0.1 does not expose Hybrid Views or their settable props publicly
 * (DECISIONS D14): it is exported for this repo's example, harness, bench and
 * smoke apps, and for the typed `hybridRef` handle, and is not semver surface.
 */
export type NitroUiDatePicker = HybridView<
  NitroUiDatePickerProps,
  NitroUiDatePickerMethods
>;

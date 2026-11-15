import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';

/**
 * Native props of the `NitroUiDatePicker` Hybrid View.
 *
 * No prop is optional except the callback: a removed prop arrives as `null`,
 * which crashes an optional one (nitro#1184). The wrapper always sends every prop.
 *
 * Every date crosses as milliseconds since the epoch: an absolute instant,
 * shown in the device's calendar and time zone. "No bound" is `null`, not a
 * sentinel number, because each platform's picker derives a real year range
 * from the bounds it is given.
 *
 * Nitro does not order props inside a batch, so the value, the default and the
 * two bounds are stored raw and reconciled together in `afterUpdate()`.
 */
export interface NitroUiDatePickerProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  /**
   * Controlled value in ms since the epoch, or `null` for an uncontrolled
   * control. Clamped into `[minimumMillis, maximumMillis]` in `afterUpdate()`.
   */
  valueMillis: number | null;
  /**
   * Initial instant of an uncontrolled control, in ms; ignored while
   * `valueMillis` is set. Not nullable: the wrapper sends a fallback so native
   * never invents a date.
   */
  defaultValueMillis: number;
  /**
   * The last event count JS has fully processed. Native accepts a `valueMillis`
   * write only once it has seen this many of its own events.
   */
  mostRecentEventCount: number;
  /** What the user picks: `'date'`, `'time'` or `'datetime'`. */
  mode: string;
  /**
   * How it is presented: `'compact'` (a field that opens the platform picker),
   * `'inline'` (the picker itself) or `'wheel'`. `compact` sizes itself; the two
   * picker variants fill the width they are given.
   */
  variant: string;
  /** Lowest selectable instant in ms, or `null` for "no lower bound". */
  minimumMillis: number | null;
  /** Highest selectable instant in ms, or `null` for "no upper bound". */
  maximumMillis: number | null;
  disabled: boolean;
  /**
   * `processColor` output (ARGB), or `null` for the platform default: the
   * SwiftUI picker's accent and the Material 3 picker's primary colour.
   */
  tintColor: number | null;
  testID: string | null;
  /**
   * Accessibility label of the control. Both platforms announce the selected
   * date themselves; this names what the field is for.
   */
  accessibilityLabel: string | null;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
  /**
   * Called on every user selection with the instant native now displays and
   * native's event count.
   *
   * Not called for a selection that does not move the displayed instant. SwiftUI
   * only writes its binding on a change; Material 3's calendar fires a click for
   * the already-selected day, so Android suppresses it to match.
   *
   * Callbacks are the exception to the no-optional rule: Nitro only unwraps a
   * callback prop whose type is a plain function, so this must never become
   * `fn | null`. The wrapper always sends one.
   */
  onValueChange?: (millis: number, eventCount: number) => void;
}

export interface NitroUiDatePickerMethods extends HybridViewMethods {
  /**
   * The size of the hosted control as of the last layout. It returns a cached
   * value, so it is safe to call from the JS thread.
   */
  measureContent(): NitroUiDatePickerSize;

  /**
   * Test-only: perform one user selection of the given local calendar fields
   * through the path a real pick uses: clamped to the bounds, and emitted with a
   * fresh event count.
   *
   * `month` is 1-12. A day that does not exist in the month is clamped to its
   * last day. Fields the current `mode` does not show keep the displayed value,
   * and seconds are never touched.
   *
   * @internal Not app API. Remove once the test harness can drive a calendar cell.
   */
  nuiTestSelect(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number
  ): void;

  /**
   * Test-only: open what a press on the `compact` field opens (iOS popover,
   * Material 3 dialog). A no-op for the picker variants, which present nothing.
   *
   * @internal Not app API.
   */
  nuiTestPresent(): void;

  /**
   * Test-only: what this control currently shows, as one line:
   * `<displayed ms>|<presented 0|1>|<calendar month>|<calendar has selection>|<live presentations>|<control builds>|<built minimum>|<built maximum>`.
   *
   * The displayed instant can differ from `valueMillis` after a change JS
   * rejected. The last two fields are the bounds the control on screen was built
   * with (`-1` = none built yet, `-2` = that bound is unset). Reads a snapshot,
   * so it never blocks for the main thread.
   *
   * @internal Not app API.
   */
  nuiTestStateReport(): string;
}

/**
 * The fitting size of the hosted control, in points (iOS) or dp (Android).
 *
 * For `inline` and `wheel` the width is the box Yoga gave and the height is what
 * the picker wants at that width; for `compact` both come from the control.
 */
export interface NitroUiDatePickerSize {
  width: number;
  height: number;
}

/**
 * The Hybrid View React renders as `NitroUiDatePicker`.
 *
 * @internal Not public and not semver surface: exported for this repo's example,
 * tests and benchmarks, and for the typed `hybridRef` handle.
 */
export type NitroUiDatePicker = HybridView<
  NitroUiDatePickerProps,
  NitroUiDatePickerMethods
>;

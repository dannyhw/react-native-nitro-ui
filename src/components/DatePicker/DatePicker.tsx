import { type ColorValue, type ViewProps } from 'react-native';
import { useState } from 'react';

import { useControlled } from '../../core/useControlled';
import { useProcessedColor } from '../../core/useProcessedColor';
import { useSizingId } from '../../core/useSizingId';
import { useStableCallback } from '../../core/useStableCallback';
import { NativeNitroUiDatePicker } from './NativeNitroUiDatePicker';

/**
 * What the user picks.
 *
 * `date` and `time` are one control each on both platforms. `datetime` is a
 * different story: iOS has one control that shows both (a graphical picker gets
 * a clock under the calendar, a wheel gets both sets of wheels), while Material
 * 3 has a date picker *and* a time picker and no combined one - so Android opens
 * the date dialog and then the time dialog (`docs/components/date-picker.md`).
 */
export type DatePickerMode = 'date' | 'time' | 'datetime';

/**
 * How the control is presented.
 *
 * - `compact`: a field showing the value, which opens the platform's picker
 *   (a SwiftUI popover, a Material 3 dialog). Intrinsic size.
 * - `inline`: the picker itself, always on screen. `fillWidth`.
 * - `wheel`: iOS's wheel picker. Android has no wheel, so it renders the inline
 *   picker and says so in its docs. `fillWidth`.
 */
export type DatePickerVariant = 'compact' | 'inline' | 'wheel';

/**
 * Props of {@link DatePicker}.
 *
 * Dates are `Date` objects here and **milliseconds since the epoch** on the
 * bridge: a `Date` is not a Nitro type, and an instant in ms is what survives
 * the trip without a format to argue about. The device's time zone and calendar
 * decide how that instant is *shown* and what "the same day" means, which is why
 * `onChange` reports an instant rather than a `y/m/d` triple.
 */
export interface DatePickerProps extends ViewProps {
  /**
   * The selected instant. Pass it to control the picker; leave it `undefined`
   * for an uncontrolled one (native then owns the displayed date, and a pick
   * costs no React render).
   *
   * Outside `[minimumDate, maximumDate]` it is clamped into range, in JS and in
   * native. An invalid `Date` (`new Date('nope')`) is treated as "not set".
   */
  value?: Date | undefined;
  /**
   * Initial date of an uncontrolled picker. Default: the moment this instance
   * mounted, which is what every native date picker does with no value.
   *
   * Ignored while `value` is set, and clamped to the bounds when applied.
   */
  defaultValue?: Date | undefined;
  /**
   * Called after every user selection with the newly selected instant.
   *
   * Not called for a selection React itself made, not called for a selection that
   * lands on the date already showing, and not called while `disabled`.
   */
  onChange?: ((date: Date) => void) | undefined;
  /** What to pick. Default: `'date'`. */
  mode?: DatePickerMode | undefined;
  /** How to present it. Default: `'compact'`. */
  variant?: DatePickerVariant | undefined;
  /**
   * Earliest selectable instant. Default: no lower bound (each platform's own
   * picker range, which SwiftUI and Material 3 both derive from the calendar).
   */
  minimumDate?: Date | undefined;
  /** Latest selectable instant. Default: no upper bound. */
  maximumDate?: Date | undefined;
  /** Disable interaction. Default: `false`. */
  disabled?: boolean | undefined;
  /**
   * Accent colour: the SwiftUI picker's tint (field label, calendar selection,
   * wheel highlight) and Material 3's primary colour (headline, selected day,
   * time dial, the compact field's outline). Default: each platform's theme.
   */
  tintColor?: ColorValue | undefined;
  /**
   * Access to the native Hybrid Object, for this repo's harness and benchmarks.
   *
   * @internal Not app API (DECISIONS D14): props must flow through React, so a
   * direct write here runs the native setter off the UI thread and never commits.
   * Reading props and calling `measureContent()` is all it is for, and the
   * callback runs once, when the view mounts - a new function does not re-run it.
   *
   * The shape is written inline rather than named: it is the same read-only
   * handle as `NitroUiDatePickerHandle` in `NativeNitroUiDatePicker.ts`, and
   * naming it here would make api-extractor demand that a v0.1-hidden native type
   * be exported from the entry point.
   */
  hybridRef?:
    | ((view: {
        readonly valueMillis: number | null;
        readonly mostRecentEventCount: number;
        readonly mode: string;
        readonly variant: string;
        readonly minimumMillis: number | null;
        readonly maximumMillis: number | null;
        readonly disabled: boolean;
        readonly tintColor: number | null;
        readonly accessibilityLabel: string | null;
        measureContent(): { width: number; height: number };
        nuiTestSelect(
          year: number,
          month: number,
          day: number,
          hour: number,
          minute: number
        ): void;
        nuiTestPresent(): void;
        nuiTestStateReport(): string;
      }) => void)
    | undefined;
  /**
   * Instance id used by native perf marks (`nitroUiCore.drainPerf()`). Benchmark
   * only; `null` turns marks off for this view.
   *
   * @internal Benchmark and diagnostics only - not app API.
   */
  nuiPerfId?: number | null | undefined;
}

/**
 * The sizing **variant** of one configuration, as the sizing engine sees it.
 *
 * `variant` and `mode` are the only props that change the control's size, and
 * both are closed enums, so the key is two normalised names joined - not the
 * caller's strings. That normalisation is load-bearing: a caller that bypasses
 * the union would otherwise mint a cache entry per typo, each with the other
 * variant's fallback for its first frame.
 *
 * Deliberately **not** in the key, and the interesting decision of this
 * component (`docs/tasks/G5-datepicker.report.md`):
 *
 * - **The rendered value.** A compact field is a text button, so its natural
 *   width is the width of "Mar 14, 2026 at 10:00 AM" - and two compact pickers
 *   showing different dates would then share one sizing key while reporting two
 *   different sizes. The engine caches *one* size per key, so each instance's
 *   correct report would correct the other's box, whose content would then
 *   re-measure its own width and correct back: an infinite layout loop between
 *   two controls that are each telling the truth. The fix had to be either the
 *   key or the control, and the key was the wrong place: a per-date key means a
 *   pick costs a cache entry and a box resize, and a list of dated rows mints
 *   hundreds. So the **field's width does not follow the date** - it is the
 *   width of the widest rendering of the *format* the locale uses, measured once
 *   per process from the platform's own formatter. Both instances then report
 *   the same size, which is the only thing a shared key may require. The test is
 *   `two compact pickers with different dates share one box` in
 *   `example/__tests__/DatePicker.harness.tsx`.
 * - **Locale, time zone, text size, density.** Environment. Native folds those
 *   in through the epoch (`docs/architecture/sizing.md`), and repeating them
 *   would fragment the cache.
 */
function sizingVariantFor(
  variant: DatePickerVariant,
  mode: DatePickerMode
): string {
  return `${variant}|${mode}`;
}

/**
 * What a self-sizing control is laid out with, before any caller `style`.
 *
 * With `alignItems: stretch` (the column default) Yoga decides a stretched
 * child's width *for* it as an exact constraint, so the measured size is never
 * asked for and a compact field becomes a 402 pt box with a small button inside
 * it. Same rule as `Switch`, `Button` and `SegmentedControl`.
 */
const SELF_SIZING_BASE_STYLE = { alignSelf: 'flex-start' } as const;

/**
 * The same for a `fillWidth` control, spelled the other way: an inline calendar
 * measures its height at the width it was *given*, so it needs the row's width,
 * and `flex-start` would ask it to invent one. Slider and the linear `Progress`
 * bar do the same (`docs/architecture/sizing.md` §5).
 */
const FILL_WIDTH_BASE_STYLE = { alignSelf: 'stretch' } as const;

/** The instant a `Date` carries, or `null` for "not set" / "not a date". */
function millisOf(date: Date | undefined | null): number | null {
  if (date == null || typeof date !== 'object') {
    return null;
  }
  const millis = date.getTime();
  return Number.isFinite(millis) ? millis : null;
}

/**
 * `value` clamped into `[minimum, maximum]`, non-numerics untouched.
 *
 * The JS half of the clamp the brief asks for. Native clamps again on its own,
 * because a props batch has no order (core.md §3): a `value` can be applied
 * before the `minimumDate` that should have clamped it, and only native's
 * `afterUpdate()` sees both. The JS half is what makes the *prop* honest - a
 * caller reading their own state back sees what the picker will show.
 *
 * A bound that is not finite (a caller who passed `Infinity`, or a NaN from an
 * invalid `Date`) is dropped rather than compared: every comparison with NaN is
 * false, so a clamp written against one silently clamps nothing.
 */
function clampMillis(
  millis: number | null,
  minimum: number | null,
  maximum: number | null
): number | null {
  if (millis == null || !Number.isFinite(millis)) {
    return null;
  }
  if (minimum != null && millis < minimum) {
    return minimum;
  }
  if (maximum != null && millis > maximum) {
    return maximum;
  }
  return millis;
}

/** The normalised `mode`, so a bypassed union cannot mint a sizing key. */
function normaliseMode(mode: DatePickerMode | undefined): DatePickerMode {
  return mode === 'time' || mode === 'datetime' ? mode : 'date';
}

/** The normalised `variant`, so a bypassed union cannot mint a sizing key. */
function normaliseVariant(
  variant: DatePickerVariant | undefined
): DatePickerVariant {
  return variant === 'inline' || variant === 'wheel' ? variant : 'compact';
}

/**
 * The platform date/time picker: SwiftUI `DatePicker` on iOS, Material 3
 * `DatePicker` / `TimePicker` (inline) and `DatePickerDialog` /
 * `TimePickerDialog` (compact) on Android.
 *
 * ```tsx
 * const [date, setDate] = useState(new Date())
 * <DatePicker
 *   value={date}
 *   onChange={setDate}
 *   variant="inline"
 *   maximumDate={new Date(2027, 0, 1)}
 * />
 * ```
 *
 * The value is an instant behind the event-count handshake
 * (`docs/architecture/core.md` §4): native paints a pick at once and reverts it
 * if the parent does not move `value`. An uncontrolled picker (no `value`) paints
 * a pick and reports it without a React render.
 */
export function DatePicker({
  value,
  defaultValue,
  onChange,
  mode = 'date',
  variant = 'compact',
  minimumDate,
  maximumDate,
  disabled = false,
  tintColor,
  testID,
  accessibilityLabel,
  hybridRef,
  nuiPerfId = null,
  style,
  ...restProps
}: DatePickerProps) {
  const normalisedMode = normaliseMode(mode);
  const normalisedVariant = normaliseVariant(variant);
  // Bounds first: the value is clamped against them, and it may be `undefined`
  // while they are set, so they cannot be derived from it.
  const minimumMillis = millisOf(minimumDate);
  const maximumMillis = millisOf(maximumDate);
  const controlledMillis = clampMillis(
    millisOf(value),
    minimumMillis,
    maximumMillis
  );
  // The starting instant of an uncontrolled picker is the moment of mounting,
  // decided once: `Date.now()` in the render body would move on every render,
  // and a prop that changes for no reason is a prop a reviewer has to reason
  // about. `useState`'s initialiser is the stable form of "once per mount".
  const [mountedAt] = useState<number>(() => Date.now());
  const defaultMillis =
    clampMillis(millisOf(defaultValue), minimumMillis, maximumMillis) ??
    mountedAt;
  // The handshake works on the instant. The public `onChange` rebuilds a `Date`
  // from it: `useControlled` keeps one native callback identity forever and
  // swaps only the closure it reads, so an event reports through the handler of
  // the render the pick happened in.
  const controlled = useControlled<number>(
    // `undefined`, not `null`, is "uncontrolled" in this hook's vocabulary - and
    // `null` is what the *native* prop means by it, which is the other half of
    // what `useControlled` hands back as `value`.
    controlledMillis ?? undefined,
    defaultMillis,
    (millis) => {
      onChange?.(new Date(millis));
    }
  );
  const processedTint = useProcessedColor(tintColor);
  const hybridRefCallback = useStableCallback(hybridRef);
  // A variant change is a different control, not a repaint - it is the
  // difference between an intrinsic field and a `fillWidth` calendar, and the
  // sizing policy is a property of the mount, so the wrapper keys the native view
  // on it and `useSizingId` gets the same value (its `configuration` contract:
  // a remount must not inherit the dropped mount's id, and an id must not change
  // under a view that is not remounting).
  const sizingKey = sizingVariantFor(normalisedVariant, normalisedMode);
  const sizingId = useSizingId(normalisedVariant);
  const isFillWidth = normalisedVariant !== 'compact';

  return (
    <NativeNitroUiDatePicker
      {...restProps}
      key={normalisedVariant}
      valueMillis={controlled.value}
      defaultValueMillis={controlled.defaultValue}
      mostRecentEventCount={controlled.mostRecentEventCount}
      mode={normalisedMode}
      variant={normalisedVariant}
      minimumMillis={minimumMillis}
      maximumMillis={maximumMillis}
      disabled={disabled}
      tintColor={processedTint}
      testID={testID ?? null}
      accessibilityLabel={accessibilityLabel ?? null}
      nuiPerfId={nuiPerfId}
      onValueChange={controlled.onNativeChange}
      nuiSizingKey={sizingKey}
      nuiSizingId={sizingId}
      hybridRef={hybridRefCallback ?? undefined}
      style={[
        isFillWidth ? FILL_WIDTH_BASE_STYLE : SELF_SIZING_BASE_STYLE,
        style,
      ]}
    />
  );
}

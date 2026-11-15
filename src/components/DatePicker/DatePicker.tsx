import { type ColorValue, type ViewProps } from 'react-native';
import { useState } from 'react';

import { useControlled } from '../../core/useControlled';
import { useProcessedColor } from '../../core/useProcessedColor';
import { useSizingId } from '../../core/useSizingId';
import { useStableCallback } from '../../core/useStableCallback';
import { useSelfSizingBaseStyle } from '../../core/useSelfSizing';
import { NativeNitroUiDatePicker } from './NativeNitroUiDatePicker';

/**
 * What the user picks.
 *
 * `date` and `time` are one control each on both platforms. For `datetime`, iOS
 * shows one control with both; Android opens the date dialog and then the time
 * dialog, because Material 3 has no combined picker.
 */
export type DatePickerMode = 'date' | 'time' | 'datetime';

/**
 * How the control is presented.
 *
 * - `compact`: a field showing the value, which opens the platform's picker (a
 *   popover on iOS, a Material 3 dialog on Android). Sized to its content.
 * - `inline`: the picker itself, always on screen. Fills the available width.
 * - `wheel`: the wheel picker, for every `mode` on iOS. On Android it is the
 *   time picker's drums for `mode="time"` and the inline calendar for the other
 *   modes, because Material 3 has no date wheel. Fills the available width.
 */
export type DatePickerVariant = 'compact' | 'inline' | 'wheel';

/**
 * Props of {@link DatePicker}.
 *
 * Every date is a `Date` holding an instant. The device's time zone and
 * calendar decide how that instant is shown.
 */
export interface DatePickerProps extends ViewProps {
  /**
   * The selected instant. Pass it to control the picker; leave it `undefined`
   * for an uncontrolled one.
   *
   * Outside `[minimumDate, maximumDate]` it is clamped into range. An invalid
   * `Date` (`new Date('nope')`) is treated as "not set".
   */
  value?: Date | undefined;
  /**
   * Initial date of an uncontrolled picker. Default: the moment the picker
   * mounted.
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
  /** Earliest selectable instant. Default: no lower bound. */
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
   * Read-only access to the native view, for tests and benchmarks.
   *
   * @internal
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
   * Instance id for native performance marks; `null` turns them off.
   *
   * @internal
   */
  nuiPerfId?: number | null | undefined;
}

/**
 * Only `variant` and `mode` change the control's size. The displayed date must
 * not: native sizes the compact field for the widest rendering of the locale's
 * format, so every picker that shares a key reports the same size.
 */
function sizingVariantFor(
  variant: DatePickerVariant,
  mode: DatePickerMode
): string {
  return `${variant}|${mode}`;
}

/**
 * An inline calendar measures its height at the width it is given, so it
 * stretches to the row's width.
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
 * Native clamps as well: the props of one batch have no order, so a `value`
 * can be applied before the `minimumDate` that should clamp it. Clamping here
 * too keeps the prop equal to what the picker shows.
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

/** A value outside the union falls back to the default. */
function normaliseMode(mode: DatePickerMode | undefined): DatePickerMode {
  return mode === 'time' || mode === 'datetime' ? mode : 'date';
}

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
 * A controlled picker shows a pick at once and reverts it if the parent does
 * not move `value`. An uncontrolled picker (no `value`) shows a pick and
 * reports it without a React render.
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
  const selfSizingBaseStyle = useSelfSizingBaseStyle();
  const normalisedMode = normaliseMode(mode);
  const normalisedVariant = normaliseVariant(variant);
  const minimumMillis = millisOf(minimumDate);
  const maximumMillis = millisOf(maximumDate);
  const controlledMillis = clampMillis(
    millisOf(value),
    minimumMillis,
    maximumMillis
  );
  // `Date.now()` in the render body would change the prop on every render;
  // `useState`'s initialiser runs once per mount.
  const [mountedAt] = useState<number>(() => Date.now());
  const defaultMillis =
    clampMillis(millisOf(defaultValue), minimumMillis, maximumMillis) ??
    mountedAt;
  const controlled = useControlled<number>(
    // `undefined` means "uncontrolled" to the hook; `null` is the native prop's
    // spelling of it.
    controlledMillis ?? undefined,
    defaultMillis,
    (millis) => {
      onChange?.(new Date(millis));
    }
  );
  const processedTint = useProcessedColor(tintColor);
  const hybridRefCallback = useStableCallback(hybridRef);
  // A variant change is a different control with a different sizing policy, so
  // the native view is keyed on it and `useSizingId` gets the same value: a
  // remount needs a new id, and an id must not change without one.
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
      style={[isFillWidth ? FILL_WIDTH_BASE_STYLE : selfSizingBaseStyle, style]}
    />
  );
}

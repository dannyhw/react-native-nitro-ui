import { useState } from 'react';
import { type ColorValue, Platform, type ViewProps } from 'react-native';

import { useControlled } from '../../core/useControlled';
import { useProcessedColor } from '../../core/useProcessedColor';
import { useSizingId } from '../../core/useSizingId';
import {
  type NitroCallbackProp,
  useStableCallback,
} from '../../core/useStableCallback';
import { useSelfSizingBaseStyle } from '../../core/useSelfSizing';
import { NativeNitroUiPicker } from './NativeNitroUiPicker';

/**
 * What {@link PickerProps.onChange} reports: the index that was selected, plus
 * the option's text.
 */
export interface PickerChange {
  /** Position of the chosen option in `options`. */
  index: number;
  /** That option's label, read from the `options` rendered at event time. */
  value: string;
}

/**
 * How the control presents its options.
 *
 * `'radio'` is a radio-group column on Android. iOS has no radio-group picker
 * style, so `'radio'` shows the menu there.
 */
export type PickerVariant = 'menu' | 'wheel' | 'radio';

/** Props of {@link Picker}. */
export interface PickerProps extends ViewProps {
  /**
   * The choices, in order. Two options may share a label; the value of the
   * control is always the index, never the text.
   */
  options: string[];
  /**
   * Selected index. Pass it to control the picker; leave it `undefined` for an
   * uncontrolled one. A value outside the current `options` is clamped into
   * range.
   */
  selectedIndex?: number | undefined;
  /**
   * Initial selected index of an uncontrolled picker. Default: `0`. Ignored
   * while `selectedIndex` is set, and clamped to `options` when applied.
   */
  defaultSelectedIndex?: number | undefined;
  /**
   * Called after every user selection, with the new index and its label.
   *
   * Not called for a selection React itself made, for opening or closing the
   * menu, and not called while `disabled`.
   */
  onChange?: ((event: PickerChange) => void) | undefined;
  /**
   * `'menu'` (default), `'wheel'` or `'radio'`.
   *
   * A menu is a button that opens a list, sized by the title it shows. A wheel
   * fills its box's width and measures its own height: SwiftUI's `.wheel` on
   * iOS, Material 3's `ScrollField` on Android. One settled value is one
   * `onChange`, whatever rows the roll passed.
   *
   * A radio group shows every option at once, one `RadioButton` row per option,
   * **on Android only**. iOS has no radio-group picker style, so `'radio'`
   * renders the menu there; an iOS layout that needs every choice visible can
   * use `SegmentedControl` for up to about five options.
   */
  variant?: PickerVariant | undefined;
  /**
   * A label for the control. Android draws it as the Material 3 field's label.
   * iOS draws nothing for it and uses it as the control's accessibility name
   * when `accessibilityLabel` is not set. Default: none.
   */
  label?: string | undefined;
  /** Disable interaction. Default: `false`. */
  disabled?: boolean | undefined;
  /**
   * Accent colour of the control. Default: the platform's own.
   *
   * **Android** colours the outlined field's focused outline, focused label,
   * focused trailing icon and unfocused label. **iOS** tints the menu picker's
   * title and chevron; a wheel does not take it at all.
   */
  tintColor?: ColorValue | undefined;
  /**
   * Identifier for tests: the accessibility identifier on iOS, the view tag on
   * Android.
   */
  testID?: string | undefined;
  /**
   * Accessibility label of the control. The options keep their own labels; this
   * names the control that opens them.
   */
  accessibilityLabel?: string | undefined;
  /**
   * Read-only access to the native view, for this library's own tests and
   * benchmarks.
   *
   * @internal Not app API. A write through this handle bypasses React and never
   * commits. The callback runs once, when the view mounts.
   */
  hybridRef?:
    | ((view: {
        readonly options: string[];
        readonly selectedIndex: number | null;
        readonly mostRecentEventCount: number;
        readonly variant: string;
        readonly label: string | null;
        readonly disabled: boolean;
        readonly tintColor: number | null;
        readonly accessibilityLabel: string | null;
        measureContent(): { width: number; height: number };
        nuiTestSelect(index: number): void;
        /**
         * Test-only: the open menu's state and geometry. Android measures it; iOS
         * answers `-1` in every field, because a SwiftUI `Picker` keeps its menu in
         * the system's own presentation.
         */
        nuiTestMenuReport(): string;
      }) => void)
    | undefined;
  /**
   * Instance id for native performance marks; `null` turns them off for this view.
   *
   * @internal Benchmark and diagnostics only - not app API.
   */
  nuiPerfId?: number | null | undefined;
}

/**
 * Separates the parts of `nuiSizingKey`. Labels are escaped, so `['a|b']` and
 * `['a', 'b']` cannot build the same key and share one cached size.
 */
const OPTION_SEPARATOR = '|';

/** Escape one free-form label so it cannot forge a separator. */
function escapeOption(label: string): string {
  return label.replace(/[\\|]/g, '\\$&');
}

/**
 * The key two Pickers share when they are the same size: the variant, the option
 * count and labels, the selected label (a menu button is as wide as the title it
 * shows) and the `label` (part of the field's box on Android).
 *
 * A radio group leaves the last two out: it shows every option and draws no
 * `label`, so neither changes its box. `disabled` and `tintColor` only repaint,
 * and text size and density are tracked natively.
 */
function sizingVariantFor(
  options: readonly string[],
  selectedIndex: number,
  label: string | null,
  variant: ResolvedPickerVariant
): string {
  const selected = options[selectedIndex] ?? '';
  // A radio group shows every option and draws no field, so neither is in its key.
  const drawnFromKey = variant !== 'radio';
  return [
    variant,
    String(options.length),
    ...options.map(escapeOption),
    ...(drawnFromKey ? [`sel:${escapeOption(selected)}`] : []),
    ...(drawnFromKey ? [`lbl:${escapeOption(label ?? '')}`] : []),
  ].join(OPTION_SEPARATOR);
}

/** The variant native is asked for: `'radio'` only where there is a radio group. */
type ResolvedPickerVariant = 'menu' | 'wheel' | 'radio';

/**
 * Whether this platform draws `radio` as a radio group rather than a menu. iOS
 * has no radio-group picker style. Resolved in JS, not natively, because the
 * native `variant`, the layout style and the sizing key must all agree: a
 * `radio` key has no selection in it, while a menu's width follows its title.
 */
function radioIsRadioGroup(): boolean {
  return Platform.OS === 'android';
}

/** The variant to hand the native view; anything unknown is the menu. */
function resolveVariant(variant: PickerVariant): ResolvedPickerVariant {
  if (variant === 'radio') {
    return radioIsRadioGroup() ? 'radio' : 'menu';
  }
  return variant === 'wheel' ? 'wheel' : 'menu';
}

/**
 * A wheel is as wide as its box, and `alignSelf` is the only thing that decides
 * the cross-axis size.
 */
const FILL_WIDTH_BASE_STYLE = { alignSelf: 'stretch' } as const;

/** Clamp a caller's index into `options`, non-numerics going to the front. */
function clampToOptions(index: number, optionCount: number): number {
  if (!(optionCount > 0)) {
    return 0;
  }
  if (!Number.isFinite(index)) {
    return 0;
  }
  const rounded = Math.trunc(index);
  if (rounded < 0) {
    return 0;
  }
  return rounded > optionCount - 1 ? optionCount - 1 : rounded;
}

/**
 * The platform picker: SwiftUI `Picker` with `.pickerStyle(.menu)` or `.wheel`
 * on iOS; on Android Material 3's `ExposedDropdownMenuBox` for `menu`, a
 * `ScrollField` drum for `wheel` and a radio group for `radio`.
 *
 * ```tsx
 * const [index, setIndex] = useState(0)
 * <Picker
 *   options={['Small', 'Medium', 'Large']}
 *   selectedIndex={index}
 *   onChange={(_event) => setIndex(_event.index)}
 * />
 * ```
 *
 * A controlled picker shows a choice at once and reverts it if the parent does
 * not move `selectedIndex`.
 */
export function Picker({
  options,
  selectedIndex,
  defaultSelectedIndex = 0,
  onChange,
  variant = 'menu',
  label,
  disabled = false,
  tintColor,
  testID,
  accessibilityLabel,
  hybridRef,
  nuiPerfId = null,
  style,
  ...restProps
}: PickerProps) {
  const selfSizingBaseStyle = useSelfSizingBaseStyle();
  // `options` may be `undefined` at runtime despite the type; treat that as no
  // options rather than throwing inside a render.
  const safeOptions = options ?? [];
  const optionCount = safeOptions.length;
  // Resolved once: the native prop, the layout style and the sizing key must all
  // use the same variant.
  const nativeVariant = resolveVariant(variant);
  // The view's `key`, the `variant` prop and the sizing id are one value, so the
  // native view is replaced exactly when the variant changes. Android fixes its
  // sizing policy (self-sized or fill-width) when the composition is built, so a
  // menu cannot become a wheel in place. Computed before `lastChoice`, which is
  // stamped with the id.
  const variantKey = nativeVariant;
  const sizingId = useSizingId(variantKey);
  // An uncontrolled picker's last choice. The sizing key names the shown title,
  // so without a render per choice the new title's width would be cached under
  // the old title's key. Stamped with the sizing id, not the variant: a variant
  // change remounts the view and re-seeds it from `defaultSelectedIndex`, and
  // ids are never reused. It carries the event count because native holds a pick's
  // size report until JS has echoed every pick it made.
  const [lastChoice, setLastChoice] = useState<{
    readonly sizingId: number;
    readonly index: number;
    readonly eventCount: number;
  } | null>(null);
  const controlled = useControlled<number>(
    selectedIndex,
    clampToOptions(defaultSelectedIndex, optionCount),
    (index) => {
      onChange?.({ index, value: safeOptions[index] ?? '' });
    }
  );
  const forwardNativeChange = controlled.onNativeChange.f;
  const onNativeValueChange = useStableCallback(
    (index: number, eventCount: number) => {
      if (selectedIndex === undefined) {
        setLastChoice({ sizingId, index, eventCount });
      }
      forwardNativeChange(index, eventCount);
    }
  ) as NitroCallbackProp<(index: number, eventCount: number) => void>;
  const processedTint = useProcessedColor(tintColor);
  const hybridRefCallback = useStableCallback(hybridRef);
  const chosen =
    lastChoice !== null && lastChoice.sizingId === sizingId ? lastChoice : null;
  // Clamped as native clamps it, so the sizing key names the title the control
  // will actually paint.
  const shownIndex = clampToOptions(
    controlled.value === null
      ? (chosen?.index ?? clampToOptions(defaultSelectedIndex, optionCount))
      : controlled.value,
    optionCount
  );
  // `useControlled` echoes only while controlled; an uncontrolled picker echoes its
  // last choice here, so native never waits for a count that cannot come.
  const mostRecentEventCount = Math.max(
    controlled.mostRecentEventCount,
    chosen?.eventCount ?? 0
  );

  return (
    <NativeNitroUiPicker
      {...restProps}
      // A variant change is a different control: an uncontrolled picker starts
      // its new mount again from `defaultSelectedIndex`.
      key={variantKey}
      options={safeOptions}
      selectedIndex={
        controlled.value === null
          ? null
          : clampToOptions(controlled.value, optionCount)
      }
      defaultSelectedIndex={clampToOptions(defaultSelectedIndex, optionCount)}
      mostRecentEventCount={mostRecentEventCount}
      variant={nativeVariant}
      label={label ?? null}
      disabled={disabled}
      tintColor={processedTint}
      testID={testID ?? null}
      accessibilityLabel={accessibilityLabel ?? null}
      nuiPerfId={nuiPerfId}
      onValueChange={onNativeValueChange}
      nuiSizingKey={sizingVariantFor(
        safeOptions,
        shownIndex,
        label ?? null,
        nativeVariant
      )}
      nuiSizingId={sizingId}
      hybridRef={hybridRefCallback ?? undefined}
      style={[
        nativeVariant === 'wheel' ? FILL_WIDTH_BASE_STYLE : selfSizingBaseStyle,
        style,
      ]}
    />
  );
}

import { type ColorValue, type ViewProps } from 'react-native';

import { useControlled } from '../../core/useControlled';
import { useProcessedColor } from '../../core/useProcessedColor';
import { useSizingId } from '../../core/useSizingId';
import { useStableCallback } from '../../core/useStableCallback';
import { useSelfSizingBaseStyle } from '../../core/useSelfSizing';
import { NativeNitroUiSegmentedControl } from './NativeNitroUiSegmentedControl';

/**
 * What {@link SegmentedControlProps.onChange} reports: the index that was
 * selected, plus the option's text.
 */
export interface SegmentedControlChange {
  /** Position of the chosen option in `options`. */
  index: number;
  /** That option's label, or `''` if `options` no longer has that index. */
  value: string;
}

/**
 * Props of {@link SegmentedControl}. Everything not listed comes from
 * `ViewProps`.
 */
export interface SegmentedControlProps extends ViewProps {
  /**
   * The segment labels, in order. The control is as wide as these labels.
   *
   * Two options may share a label; the value of the control is always the
   * *index*, never the text.
   */
  options: string[];
  /**
   * Selected index. Pass it to control the selection; leave it `undefined` for
   * an uncontrolled control, where a tap causes no React render.
   *
   * A value outside the current `options` is clamped into range.
   */
  selectedIndex?: number | undefined;
  /**
   * Initial selected index of an uncontrolled control. Default: `0`. Ignored
   * while `selectedIndex` is set, and clamped to `options` when applied.
   */
  defaultSelectedIndex?: number | undefined;
  /**
   * Called after every user selection, with the new index and its label.
   *
   * Not called when `selectedIndex` changes from React, and not called while
   * `disabled`.
   */
  onChange?: ((event: SegmentedControlChange) => void) | undefined;
  /** Disable interaction. Default: `false`. */
  disabled?: boolean | undefined;
  /**
   * Accent colour of the selected segment on Android (its container and
   * border). Default: the Material 3 scheme.
   *
   * No visible effect on iOS, where a segmented picker ignores the tint.
   */
  tintColor?: ColorValue | undefined;
  /**
   * Read-only access to the native view, for tests and benchmarks.
   *
   * @internal
   */
  hybridRef?:
    | ((view: {
        readonly options: string[];
        readonly selectedIndex: number | null;
        readonly mostRecentEventCount: number;
        readonly disabled: boolean;
        readonly tintColor: number | null;
        readonly accessibilityLabel: string | null;
        measureContent(): { width: number; height: number };
        nuiTestPixelProbe(color: number): void;
        nuiTestPixelReport(): string;
        nuiTestDisplayedIndex(): string;
      }) => void)
    | undefined;
  /**
   * Instance id for native performance marks, for benchmarks; `null` turns
   * marks off for this view.
   *
   * @internal
   */
  nuiPerfId?: number | null | undefined;
}

const OPTION_SEPARATOR = '|';

/**
 * Escapes the separator in a label: otherwise `['a|b']` and `['a', 'b']`
 * would build the same sizing key and share one cached size.
 */
function escapeOption(label: string): string {
  return label.replace(/[\\|]/g, '\\$&');
}

/**
 * The labels decide the control's width, so they are the whole sizing variant.
 * The count goes in front because `[]` and `['']` join to the same string.
 */
function sizingVariantFor(options: readonly string[]): string {
  return `${String(options.length)}${OPTION_SEPARATOR}${options
    .map(escapeOption)
    .join(OPTION_SEPARATOR)}`;
}

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
 * The platform segmented control: a segmented SwiftUI `Picker` on iOS,
 * Material 3 segmented buttons on Android.
 *
 * ```tsx
 * const [index, setIndex] = useState(0)
 * <SegmentedControl
 *   options={['List', 'Grid', 'Board']}
 *   selectedIndex={index}
 *   onChange={(_event) => setIndex(_event.index)}
 * />
 * ```
 *
 * A tap is painted at once, and reverted if a controlled parent does not move
 * `selectedIndex`.
 */
export function SegmentedControl({
  options,
  selectedIndex,
  defaultSelectedIndex = 0,
  onChange,
  disabled = false,
  tintColor,
  testID,
  accessibilityLabel,
  hybridRef,
  nuiPerfId = null,
  style,
  ...restProps
}: SegmentedControlProps) {
  const selfSizingBaseStyle = useSelfSizingBaseStyle();
  // `options` may be `undefined` at runtime despite the type.
  const safeOptions = options ?? [];
  const optionCount = safeOptions.length;
  const controlled = useControlled<number>(
    selectedIndex,
    clampToOptions(defaultSelectedIndex, optionCount),
    (index) => {
      onChange?.({ index, value: safeOptions[index] ?? '' });
    }
  );
  const processedTint = useProcessedColor(tintColor);
  const hybridRefCallback = useStableCallback(hybridRef);
  const sizingId = useSizingId();

  return (
    <NativeNitroUiSegmentedControl
      {...restProps}
      options={safeOptions}
      selectedIndex={
        controlled.value === null
          ? null
          : clampToOptions(controlled.value, optionCount)
      }
      defaultSelectedIndex={clampToOptions(defaultSelectedIndex, optionCount)}
      mostRecentEventCount={controlled.mostRecentEventCount}
      disabled={disabled}
      tintColor={processedTint}
      testID={testID ?? null}
      accessibilityLabel={accessibilityLabel ?? null}
      nuiPerfId={nuiPerfId}
      onValueChange={controlled.onNativeChange}
      nuiSizingKey={sizingVariantFor(safeOptions)}
      nuiSizingId={sizingId}
      hybridRef={hybridRefCallback ?? undefined}
      style={[selfSizingBaseStyle, style]}
    />
  );
}

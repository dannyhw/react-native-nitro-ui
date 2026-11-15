import { type ColorValue, type ViewProps } from 'react-native';

import { useSizingId } from '../../core/useSizingId';
import { useControlled } from '../../core/useControlled';
import { useProcessedColor } from '../../core/useProcessedColor';
import { useStableCallback } from '../../core/useStableCallback';
import type { NitroCallbackProp } from '../../core/useStableCallback';
import { NativeNitroUiSlider } from './NativeNitroUiSlider';

type SlideHandler = (value: number, eventCount: number) => void;

/**
 * Props of {@link Slider}. The names follow `@react-native-community/slider`;
 * everything not listed comes from `ViewProps`.
 */
export interface SliderProps extends ViewProps {
  /**
   * The value. Pass it to control the Slider; leave it `undefined` for an
   * uncontrolled one, where dragging causes no React render.
   */
  value?: number | undefined;
  /**
   * Initial value of an uncontrolled Slider. Default: `minimumValue`.
   * Ignored while `value` is set.
   */
  defaultValue?: number | undefined;
  /** Lower bound of the range. Default: `0`. */
  minimumValue?: number | undefined;
  /** Upper bound of the range. Default: `1`. */
  maximumValue?: number | undefined;
  /**
   * Increment the value snaps to, in the Slider's own units. `0` (the default)
   * means continuous. Use e.g. `1` for whole numbers, or `0.1` for tenths.
   *
   * Reported values are always snapped. When the range is not a whole number
   * of steps, the maximum stays reachable.
   */
  step?: number | undefined;
  /** Disable interaction. Default: `false`. */
  disabled?: boolean | undefined;
  /**
   * Accent colour of the filled track and thumb. Default: the platform accent
   * on iOS, the Material 3 colour scheme on Android.
   */
  tintColor?: ColorValue | undefined;
  /**
   * Called during a drag, at most once per frame, with the value now displayed.
   * Use {@link onSlidingComplete} for the value a gesture settled on.
   */
  onValueChange?: ((value: number) => void) | undefined;
  /** Called when a drag begins, with the value it began at. */
  onSlidingStart?: ((value: number) => void) | undefined;
  /**
   * Called when a drag ends, always with the final value, even when
   * {@link onValueChange} already reported that value.
   */
  onSlidingComplete?: ((value: number) => void) | undefined;
  /**
   * Read-only access to the native view, for tests and benchmarks.
   *
   * @internal
   */
  hybridRef?:
    | ((view: {
        readonly value: number | null;
        readonly mostRecentEventCount: number;
        readonly disabled: boolean;
        readonly tintColor: number | null;
        readonly accessibilityLabel: string | null;
        measureContent(): { width: number; height: number };
        nuiTestDrag(to: number, steps: number, msPerStep: number): void;
        nuiTestAccessibilityStep(direction: number): void;
        nuiTestAccessibilityStepReport(): string;
        nuiTestFramePumpArmed(): boolean;
        nuiTestPointerStream(mode: number): void;
        nuiTestPointerStreamReport(): string;
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

/**
 * Every prop that can change the control's size must appear in the sizing
 * variant. A Slider has none: its props move the thumb or repaint, and its
 * width is the layout box.
 */
const SIZING_VARIANT = '';

/**
 * A Slider takes its width from its box and measures only its height, so it
 * must be stretched by default. The caller's `style` is applied after this and
 * still wins.
 */
const FILL_WIDTH_BASE_STYLE = { alignSelf: 'stretch' } as const;

/**
 * Sent when the app passes no `onSlidingStart` or `onSlidingComplete`: a
 * callback prop must never go missing between commits (nitro#1184).
 */
const NO_SLIDE_HANDLER: (value: number) => void = () => {
  /* installed so the prop always has one stable identity */
};

/**
 * The platform Slider: SwiftUI `Slider` on iOS, Material 3 `Slider` on Android.
 *
 * ```tsx
 * const [volume, setVolume] = useState(0.5)
 * <Slider value={volume} onValueChange={setVolume} />
 * ```
 *
 * The thumb tracks the finger during a drag even when JS is slow.
 */
export function Slider({
  value,
  defaultValue,
  minimumValue = 0,
  maximumValue = 1,
  step = 0,
  disabled = false,
  tintColor,
  testID,
  accessibilityLabel,
  onValueChange,
  onSlidingStart,
  onSlidingComplete,
  hybridRef,
  nuiPerfId = null,
  style,
  ...restProps
}: SliderProps) {
  const controlled = useControlled(
    value,
    defaultValue ?? minimumValue,
    onValueChange
  );
  const processedTint = useProcessedColor(tintColor);
  const hybridRefCallback = useStableCallback(hybridRef);
  // `useStableCallback` returns `null` only when handed no handler, which
  // cannot happen here; its return type is one union for both cases.
  const startCallback = useStableCallback(
    onSlidingStart ?? NO_SLIDE_HANDLER
  ) as NitroCallbackProp<SlideHandler>;
  const completeCallback = useStableCallback(
    onSlidingComplete ?? NO_SLIDE_HANDLER
  ) as NitroCallbackProp<SlideHandler>;
  const sizingId = useSizingId();

  return (
    <NativeNitroUiSlider
      {...restProps}
      value={controlled.value}
      defaultValue={controlled.defaultValue}
      mostRecentEventCount={controlled.mostRecentEventCount}
      minimumValue={minimumValue}
      maximumValue={maximumValue}
      step={step}
      disabled={disabled}
      tintColor={processedTint}
      testID={testID ?? null}
      accessibilityLabel={accessibilityLabel ?? null}
      nuiPerfId={nuiPerfId}
      onValueChange={controlled.onNativeChange}
      onSlidingStart={startCallback}
      onSlidingComplete={completeCallback}
      nuiSizingKey={SIZING_VARIANT}
      nuiSizingId={sizingId}
      hybridRef={hybridRefCallback ?? undefined}
      style={[FILL_WIDTH_BASE_STYLE, style]}
    />
  );
}

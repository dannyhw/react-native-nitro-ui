import type { ViewProps } from 'react-native';

import { useControlled } from '../../core/useControlled';
import { useSizingId } from '../../core/useSizingId';
import { useStableCallback } from '../../core/useStableCallback';
import { useSelfSizingBaseStyle } from '../../core/useSelfSizing';
import { NativeNitroUiStepper } from './NativeNitroUiStepper';

/** No Stepper prop changes its size, so every Stepper shares one sizing key. */
const SIZING_VARIANT = '';

/** Props of {@link Stepper}. */
export interface StepperProps extends ViewProps {
  /**
   * The value. Pass it to control the Stepper; leave it `undefined` for an
   * uncontrolled one, which keeps its own value.
   */
  value?: number | undefined;
  /**
   * Initial value of an uncontrolled Stepper. Default: `minimumValue`.
   * Ignored while `value` is set.
   */
  defaultValue?: number | undefined;
  /** Lower bound of the range. Default: `0`. */
  minimumValue?: number | undefined;
  /** Upper bound of the range. Default: `100`. */
  maximumValue?: number | undefined;
  /**
   * Increment one step moves by. Default: `1`. It must be greater than `0`;
   * anything else throws in development.
   *
   * The value snaps to multiples of `step` measured from `minimumValue`, with
   * `maximumValue` always reachable, so a `0.1` step never arrives as `0.3000…4`.
   */
  step?: number | undefined;
  /**
   * Disable interaction. Both halves take the disabled style and no event fires.
   * Default: `false`.
   */
  disabled?: boolean | undefined;
  /**
   * Called once per step, with the value now displayed.
   *
   * On iOS, holding a half repeats, and every repeat is its own event. Android
   * has no hold-to-repeat.
   */
  onValueChange?: ((value: number) => void) | undefined;
  /**
   * Names the control for a screen reader. The *value* is announced by the
   * control itself; this is the half it cannot work out.
   */
  accessibilityLabel?: string | undefined;
  /**
   * Read-only access to the native view, for this library's own tests and
   * benchmarks.
   *
   * @internal Not app API: props must flow through React. The callback runs
   * once, when the view mounts.
   */
  hybridRef?:
    | ((view: {
        readonly value: number | null;
        readonly mostRecentEventCount: number;
        readonly minimumValue: number;
        readonly maximumValue: number;
        readonly step: number;
        readonly disabled: boolean;
        readonly accessibilityLabel: string | null;
        measureContent(): { width: number; height: number };
        nuiTestStep(direction: number): void;
        nuiTestAccessibilityStep(direction: number): void;
        nuiTestAccessibilityStepReport(): string;
        nuiTestProbeAccessibility(): void;
        nuiTestPixelProbe(color: number): void;
        nuiTestPixelReport(): string;
        nuiTestStateReport(): string;
      }) => void)
    | undefined;
  /**
   * Instance id for native performance marks; `null` turns them off for this view.
   *
   * @internal Benchmark and diagnostics only — not app API.
   */
  nuiPerfId?: number | null | undefined;
}

/**
 * A numeric stepper: two halves that move a value by one `step` each.
 *
 * ```tsx
 * <Stepper
 *   value={quantity}
 *   onValueChange={setQuantity}
 *   minimumValue={1}
 *   maximumValue={99}
 *   accessibilityLabel="Quantity"
 * />
 * ```
 *
 * SwiftUI's `Stepper` on iOS, with hold-to-repeat and the disabled half at a
 * bound. Material has no stepper, so on Android it is two Material 3 tonal icon
 * buttons, without hold-to-repeat. It shows no number: the value goes to your
 * own text.
 */
export function Stepper({
  value,
  defaultValue,
  minimumValue = 0,
  maximumValue = 100,
  step = 1,
  disabled = false,
  accessibilityLabel,
  testID,
  onValueChange,
  hybridRef,
  nuiPerfId = null,
  style,
  ...restProps
}: StepperProps) {
  const selfSizingBaseStyle = useSelfSizingBaseStyle();
  // A step of 0 or less would leave the control stuck at one value while looking
  // like it works.
  if (__DEV__ && !(step > 0)) {
    throw new Error(
      `nitro-ui: <Stepper step> must be greater than 0; received ${String(step)}.`
    );
  }
  // Without a `defaultValue`, start at `minimumValue` rather than 0, which may be
  // outside the range. `useControlled` always wires `onValueChange`, so the
  // callback prop keeps one identity and is never `null`.
  const controlled = useControlled(
    value,
    defaultValue ?? minimumValue,
    onValueChange
  );
  const hybridRefCallback = useStableCallback(hybridRef);
  const sizingId = useSizingId();

  return (
    <NativeNitroUiStepper
      {...restProps}
      value={controlled.value}
      defaultValue={controlled.defaultValue}
      mostRecentEventCount={controlled.mostRecentEventCount}
      minimumValue={minimumValue}
      maximumValue={maximumValue}
      step={step}
      disabled={disabled}
      testID={testID ?? null}
      accessibilityLabel={accessibilityLabel ?? null}
      nuiPerfId={nuiPerfId}
      onValueChange={controlled.onNativeChange}
      nuiSizingKey={SIZING_VARIANT}
      nuiSizingId={sizingId}
      hybridRef={hybridRefCallback ?? undefined}
      style={[selfSizingBaseStyle, style]}
    />
  );
}

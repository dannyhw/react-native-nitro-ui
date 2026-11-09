import type { ViewProps } from 'react-native';

import { useControlled } from '../../core/useControlled';
import { useSizingId } from '../../core/useSizingId';
import { useStableCallback } from '../../core/useStableCallback';
import { NativeNitroUiStepper } from './NativeNitroUiStepper';

/**
 * The size configuration of a Stepper, as the sizing engine sees it.
 *
 * Every prop that can change a control's size has to appear in this variant
 * (`docs/architecture/sizing.md` §5). A Stepper has none: `minimumValue`,
 * `maximumValue` and `step` decide *which numbers* the control steps through,
 * never how wide its two buttons are, and `disabled` only changes what they look
 * like. So the variant is empty — one configuration, one cached size for the
 * whole app, and the one `prewarm(['NitroUiStepper'])` can pre-warm.
 */
const SIZING_VARIANT = '';

/** An intrinsic control is not stretched; the same base style Switch's uses. */
const SELF_SIZING_BASE_STYLE = { alignSelf: 'flex-start' } as const;

/**
 * Props of {@link Stepper}.
 *
 * The value names follow our own `Slider`, which follows
 * `@react-native-community/slider`; `disabled` and `accessibilityLabel` are
 * every other control's.
 */
export interface StepperProps extends ViewProps {
  /**
   * The value. Pass it to control the Stepper; leave it `undefined` for an
   * uncontrolled one (native then owns the displayed value, and a step costs no
   * React render).
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
   * Increment one step moves by. Default: `1`; it must be greater than `0`, and
   * a value that is not throws in development.
   *
   * The value snaps to multiples of `step` measured from `minimumValue`, with
   * `maximumValue` always reachable — Slider's rule, run natively before any
   * event is emitted, which is what keeps a `0.1` step from arriving as `0.3000…4`.
   */
  step?: number | undefined;
  /**
   * Disable interaction. Both halves take the disabled style and no event fires.
   * Default: `false`.
   */
  disabled?: boolean | undefined;
  /**
   * Once per step, with the value native now displays.
   *
   * On iOS, holding a half repeats: every repeat is a step and so its own event.
   * On Android there is no hold-to-repeat — see `docs/components/stepper.md`.
   */
  onValueChange?: ((value: number) => void) | undefined;
  /**
   * Names the control for a screen reader. The *value* is announced by the
   * control itself; this is the half it cannot work out.
   */
  accessibilityLabel?: string | undefined;
  /**
   * Access to the native Hybrid View, for this repo's harness and benchmarks.
   *
   * @internal Not app API (DECISIONS D14): props must flow through React. Reading
   * props and calling `measureContent()` is all it is for (plus the test-only
   * probes), and the callback runs once, when the view mounts.
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
   * Instance id used by native perf marks (`nitroUiCore.drainPerf()`). Benchmark
   * only; `null` turns marks off for this view.
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
 * SwiftUI's `Stepper` on iOS — hold-to-repeat and the disabled half at a bound
 * included. Material has no stepper, so on Android it is two Material 3 tonal
 * icon buttons (`docs/components/stepper.md` says so plainly, and says which
 * half Android leaves out). It shows no number: the value goes to your own text.
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
  // A step of 0 or less is not a small step, it is no step: the control would sit
  // at one value and report nothing while looking like it worked. Throwing in
  // development is the only honest answer, and it is the same call Slider makes
  // about a range nobody can drag along.
  if (__DEV__ && !(step > 0)) {
    throw new Error(
      `nitro-ui: <Stepper step> must be greater than 0; received ${String(step)}.`
    );
  }
  // An uncontrolled Stepper with no `defaultValue` starts at the bottom of its own
  // range, not at a literal 0 — `<Stepper minimumValue={20} />` starting at 0 would
  // display a value outside its range.
  // `useControlled` wires `onValueChange` whether or not the app passed one (its
  // own echo is what lets native accept the next `value` write), so the prop always
  // has one stable identity and never becomes `null` mid-mount (D7b).
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
      style={[SELF_SIZING_BASE_STYLE, style]}
    />
  );
}

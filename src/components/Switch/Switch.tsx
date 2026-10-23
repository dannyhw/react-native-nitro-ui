import { type ColorValue, type ViewProps } from 'react-native';

import { useSizingId } from '../../core/useSizingId';
import { useControlled } from '../../core/useControlled';
import { useProcessedColor } from '../../core/useProcessedColor';
import { useStableCallback } from '../../core/useStableCallback';
import { NativeNitroUiSwitch } from './NativeNitroUiSwitch';

/**
 * Props of {@link Switch}.
 *
 * `value`/`defaultValue`/`onValueChange`/`disabled`/`tintColor` follow the
 * platform controls they wrap (UIKit `UISwitch`, SwiftUI `Toggle`, Compose
 * `Switch`, RN's own `Switch`); everything else comes from `ViewProps`.
 */
export interface SwitchProps extends ViewProps {
  /**
   * Selected state. Pass it to control the Switch; leave it `undefined` for an
   * uncontrolled one (native then owns the displayed value).
   */
  value?: boolean | undefined;
  /** Initial value of an uncontrolled Switch. Default: `false`. */
  defaultValue?: boolean | undefined;
  /** Called with the new value after every user interaction. */
  onValueChange?: ((value: boolean) => void) | undefined;
  /** Disable interaction. Default: `false`. */
  disabled?: boolean | undefined;
  /**
   * Accent color of the "on" state: SwiftUI `.tint()` on iOS, the checked track
   * color on Android. Default: the platform accent / Material 3 scheme.
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
   * handle as `NitroUiSwitchHandle` in `NativeNitroUiSwitch.ts`, and naming it
   * here would make api-extractor demand that a v0.1-hidden native type be
   * exported from the entry point.
   */
  hybridRef?:
    | ((view: {
        readonly value: boolean | null;
        readonly mostRecentEventCount: number;
        readonly disabled: boolean;
        readonly tintColor: number | null;
        readonly accessibilityLabel: string | null;
        measureContent(): { width: number; height: number };
      }) => void)
    | undefined;
  /**
   * Instance id used by native perf marks (`nitroUiCore.drainPerf()`). Benchmark
   * only; `null` turns marks off for this view.
   *
   * @internal Benchmark and diagnostics only - not app API.
   */
  nuiPerfId?: number | null | undefined;
  /**
   * TEMPORARY, test-only: the control's width in platform units, so a harness can
   * drive a real size change through a prop and prove that a `nuiSizingKey` change
   * re-measures (review S1). A Switch has no size-affecting public prop, and
   * DECISIONS D16 gives the real R3 test to the G2 Button.
   *
   * @internal Not app API. Deleted once the G2 Button test exists.
   */
  nuiTestWidth?: number | null | undefined;
}

/**
 * The size configuration of a Switch, as the sizing engine sees it.
 *
 * Every prop that can change a Switch's size has to appear in this variant
 * (`docs/architecture/sizing.md`). A Switch has none: `value`, `disabled` and
 * `tintColor` repaint, they do not resize - the only thing that changes a
 * control's size is the environment (the OS's control size, the text size), and
 * native folds that in itself through the environment epoch. So the variant is
 * empty, which is the cheapest possible answer - one configuration, one cached
 * size for the whole app - and the one `prewarmSizing(['NitroUiSwitch'])` can
 * pre-warm, because an empty variant *is* the default configuration.
 */
const SIZING_VARIANT = '';

/**
 * The sizing variant for one Switch, given the temporary test width. Setting a
 * width makes it a different configuration, which is the point: two instances
 * that are laid out at different sizes must never share one cache entry.
 */
function sizingVariantFor(testWidth: number | null | undefined): string {
  return testWidth == null
    ? SIZING_VARIANT
    : `${SIZING_VARIANT}|w${String(testWidth)}`;
}

/**
 * What a self-sizing control is laid out with, before any `style`.
 *
 * `alignItems: stretch` (the default in a column) otherwise decides a control's
 * width for it: Yoga gives a stretched child the row's width as an *exact*
 * constraint, so the measured size is never even asked for and a Switch becomes
 * a 402pt-wide box with a 61pt control in it. React Native's own `Switch` does
 * the same thing for the same reason (`Libraries/Components/Switch/Switch.js`).
 * It is a base style, not a forced one: an explicit `width`, `flex`, or
 * `alignSelf: 'stretch'` in the caller's `style` wins, because their styles are
 * applied after this.
 */
const SELF_SIZING_BASE_STYLE = { alignSelf: 'flex-start' } as const;

/**
 * The platform Switch: SwiftUI `Toggle` with `.switch` style on iOS, Material 3
 * `Switch` on Android.
 *
 * ```tsx
 * const [on, setOn] = useState(false)
 * <Switch value={on} onValueChange={setOn} />
 * ```
 */
export function Switch({
  value,
  defaultValue = false,
  onValueChange,
  disabled = false,
  tintColor,
  testID,
  accessibilityLabel,
  hybridRef,
  nuiPerfId = null,
  nuiTestWidth = null,
  style,
  ...restProps
}: SwitchProps) {
  const controlled = useControlled(value, defaultValue, onValueChange);
  const processedTint = useProcessedColor(tintColor);
  const hybridRefCallback = useStableCallback(hybridRef);
  const sizingId = useSizingId();

  return (
    <NativeNitroUiSwitch
      {...restProps}
      value={controlled.value}
      defaultValue={controlled.defaultValue}
      mostRecentEventCount={controlled.mostRecentEventCount}
      disabled={disabled}
      tintColor={processedTint}
      testID={testID ?? null}
      accessibilityLabel={accessibilityLabel ?? null}
      nuiPerfId={nuiPerfId}
      onValueChange={controlled.onNativeChange}
      nuiSizingKey={sizingVariantFor(nuiTestWidth)}
      nuiSizingId={sizingId}
      nuiTestWidth={nuiTestWidth}
      hybridRef={hybridRefCallback ?? undefined}
      style={[SELF_SIZING_BASE_STYLE, style]}
    />
  );
}

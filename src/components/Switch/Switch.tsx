import { type ColorValue, type ViewProps } from 'react-native';

import { useSizingId } from '../../core/useSizingId';
import { useControlled } from '../../core/useControlled';
import { useProcessedColor } from '../../core/useProcessedColor';
import { useStableCallback } from '../../core/useStableCallback';
import { useSelfSizingBaseStyle } from '../../core/useSelfSizing';
import { NativeNitroUiSwitch } from './NativeNitroUiSwitch';

/** Props of {@link Switch}. Everything not listed comes from `ViewProps`. */
export interface SwitchProps extends ViewProps {
  /**
   * Selected state. Pass it to control the Switch; leave it `undefined` for an
   * uncontrolled one.
   */
  value?: boolean | undefined;
  /** Initial value of an uncontrolled Switch. Default: `false`. */
  defaultValue?: boolean | undefined;
  /** Called with the new value after every user interaction. */
  onValueChange?: ((value: boolean) => void) | undefined;
  /** Disable interaction. Default: `false`. */
  disabled?: boolean | undefined;
  /**
   * Accent color of the "on" state: the tint on iOS, the checked track color
   * on Android. Default: the platform accent / Material 3 scheme.
   */
  tintColor?: ColorValue | undefined;
  /**
   * Read-only access to the native view, for tests and benchmarks.
   *
   * @internal
   */
  hybridRef?:
    | ((view: {
        readonly value: boolean | null;
        readonly mostRecentEventCount: number;
        readonly disabled: boolean;
        readonly tintColor: number | null;
        readonly accessibilityLabel: string | null;
        measureContent(): { width: number; height: number };
        nuiTestArmedGuards(): string;
        nuiTestLifetimeReport(): string;
      }) => void)
    | undefined;
  /**
   * Instance id for native performance marks, for benchmarks; `null` turns
   * marks off for this view.
   *
   * @internal
   */
  nuiPerfId?: number | null | undefined;
  /**
   * Test-only: the control's width in platform units.
   *
   * @internal
   */
  nuiTestWidth?: number | null | undefined;
}

/**
 * Every prop that can change the control's size must appear in the sizing
 * variant. A Switch has none: `value`, `disabled` and `tintColor` only repaint.
 */
const SIZING_VARIANT = '';

/**
 * A test width is its own variant: instances laid out at different sizes must
 * never share one cached size.
 */
function sizingVariantFor(testWidth: number | null | undefined): string {
  return testWidth == null
    ? SIZING_VARIANT
    : `${SIZING_VARIANT}|w${String(testWidth)}`;
}

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
  const selfSizingBaseStyle = useSelfSizingBaseStyle();
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
      style={[selfSizingBaseStyle, style]}
    />
  );
}

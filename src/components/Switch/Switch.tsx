import { Platform, type ColorValue, type ViewProps } from 'react-native';
import { useMemo } from 'react';

import { useControlled } from '../../core/useControlled';
import { useProcessedColor } from '../../core/useProcessedColor';
import { useStableCallback } from '../../core/useStableCallback';
import { NativeNitroUiSwitch } from './NativeNitroUiSwitch';
import type { NitroUiSwitch } from './Switch.nitro';

/**
 * Props of {@linkcode Switch}.
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
   * Access to the native Hybrid Object (props and methods). Prefer `value` +
   * `onValueChange`; this is for imperative use and benchmarks.
   */
  hybridRef?: ((view: NitroUiSwitch) => void) | undefined;
  /**
   * Instance id used by native perf marks (`nitroUiCore.drainPerf()`). Benchmark
   * only; `null` turns marks off for this view.
   */
  nuiPerfId?: number | null | undefined;
}

/**
 * The default box of a Switch, per platform, until T11 measures it natively.
 *
 * A Nitro Hybrid View is a plain Yoga leaf, so with no style it is 0x0
 * (docs/research/core-architecture.md §1.1). These are the *measured* intrinsic
 * sizes of the controls we host - see docs/components/switch.md:
 * - iOS: SwiftUI `Toggle(...).toggleStyle(.switch)` is 51x31 pt.
 * - Android: a Material 3 `Switch` is a 52x32 dp track inside a 48 dp minimum
 *   interactive size, so it measures 52x48 dp.
 * A `style` from the user wins over these.
 */
const DEFAULT_SIZE = Platform.select({
  ios: { width: 51, height: 31 },
  android: { width: 52, height: 48 },
  default: { width: 51, height: 31 },
});

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
  style,
  ...restProps
}: SwitchProps) {
  const controlled = useControlled(value, defaultValue, onValueChange);
  const processedTint = useProcessedColor(tintColor);
  const hybridRefCallback = useStableCallback(hybridRef);
  const sizedStyle = useMemo(() => [DEFAULT_SIZE, style], [style]);

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
      hybridRef={hybridRefCallback ?? undefined}
      style={sizedStyle}
    />
  );
}

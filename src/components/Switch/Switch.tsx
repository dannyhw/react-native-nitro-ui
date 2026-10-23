import { Platform, type ColorValue, type ViewProps } from 'react-native';
import { useMemo } from 'react';

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
}

/**
 * Whether the running iOS lays a switch out at the iOS 26 size.
 *
 * `Platform.Version` is a **string** on iOS (`"27.0"`) and a number on Android,
 * so `typeof … === 'number' && … >= 26` is quietly false on every iPhone and the
 * pre-26 size ships everywhere - which the on-device box test caught. iOS also
 * reports the same value as `constants.osVersion`, which Android does not have,
 * hence the read-through-unknown cast: this runs on every platform because
 * `Platform.select` builds all of its branches.
 */
function usesModernSwitchSize(): boolean {
  const osVersion = (
    Platform.constants as { readonly osVersion?: string } | undefined
  )?.osVersion;
  const major = Number.parseInt(osVersion ?? String(Platform.Version), 10);
  return Number.isFinite(major) && major >= 26;
}

/**
 * The default box of a Switch, per platform, until T11 measures it natively.
 *
 * A Nitro Hybrid View is a plain Yoga leaf, so with no style it is 0x0
 * (docs/research/core-architecture.md §1.1). These are the *measured* intrinsic
 * sizes of the controls we host - see docs/components/switch.md:
 * - iOS: SwiftUI `Toggle(...).toggleStyle(.switch)` is 61x28 pt from iOS 26, and
 *   51x31 pt before it - the control changed size with the OS, so the default has
 *   to follow the running OS (DECISIONS D14). Anything smaller and SwiftUI
 *   overflows the Fabric box, which paints outside it and leaves dead touch zones
 *   at both ends; anything larger adds padding the control does not have.
 * - Android: a Material 3 `Switch` is a 52x32 dp track inside a 48 dp minimum
 *   interactive size, so it measures 52x48 dp.
 * A `style` from the user wins over these.
 */
const DEFAULT_SIZE = Platform.select({
  ios: usesModernSwitchSize()
    ? { width: 61, height: 28 }
    : { width: 51, height: 31 },
  android: { width: 52, height: 48 },
  default: { width: 61, height: 28 },
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

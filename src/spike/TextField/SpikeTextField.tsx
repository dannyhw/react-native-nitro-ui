import { useCallback, useState } from 'react';
import { type LayoutChangeEvent, type ViewProps } from 'react-native';

import { useControlled } from '../../core/useControlled';
import { useSizingId } from '../../core/useSizingId';
import { useStableCallback } from '../../core/useStableCallback';
import { sizingVariantFor } from './keyboard';
import {
  NativeNitroUiSpikeTextField,
  type SpikeTextFieldHandle,
} from './NativeNitroUiSpikeTextField';

export type { SpikeTextFieldHandle };

/**
 * T18 spike — the JS half of the spike field: props in, native view out.
 *
 * @internal Spike only. `src/spike/**` is not published and has no `component.json`, so nothing in
 * `src/index.ts` reaches this file. It exists because the shipped prop rules (D7/D7b: every prop always
 * sent) have to be followed *here* for the measurements to mean anything — a spike that sent props lazily
 * would be measuring a path nobody ships.
 */
export interface SpikeTextFieldProps extends ViewProps {
  /** Which iOS shape this instance hosts; inert on Android (P1's A/B switch). */
  iosImplementation: 'swiftui' | 'textfield';
  value?: string | undefined;
  defaultValue?: string | undefined;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  maxLength?: number | null | undefined;
  multiline?: boolean | undefined;
  maxLines?: number | null | undefined;
  keyboardHints?: number | undefined;
  autoFocus?: boolean | undefined;
  onValueChange?: ((value: string) => void) | undefined;
  onFocus?: (() => void) | undefined;
  onBlur?: (() => void) | undefined;
  onSubmitEditing?: (() => void) | undefined;
  /**
   * The box width to put in the sizing key, or `null` for "not laid out yet".
   *
   * P4's whole question: a `fillWidth` control whose height depends on its width has to put the width in its
   * sizing key, because one cache entry holds one height (`cpp/NitroUiSizingEngine.hpp:502`). Passing it
   * explicitly is how a test drives a *known* width; when it is absent the width comes from `onLayout`.
   */
  layoutWidth?: number | null | undefined;
  /**
   * Access to the native instance, for this repo's harness and example only.
   *
   * @internal Not app API (D14), and not app API here either — `nuiTestApplyWrite` exists to make the
   * handshake's write outcome observable, not to give an app a side channel around React.
   */
  hybridRef?: ((view: SpikeTextFieldHandle) => void) | undefined;
  nuiPerfId?: number | null | undefined;
}

/**
 * A field is `fillWidth`, so it deliberately does *not* carry Switch's `alignSelf: 'flex-start'`: a field
 * sized to its content's preferred width is a field that never gets a width-driven height, which is the
 * thing P4 measures. See `Switch.tsx` for the base style this leaves out.
 */
export function SpikeTextField({
  iosImplementation,
  value,
  defaultValue,
  placeholder,
  disabled = false,
  maxLength = null,
  multiline = false,
  maxLines = null,
  keyboardHints = 0,
  autoFocus = false,
  onValueChange,
  onFocus,
  onBlur,
  onSubmitEditing,
  layoutWidth = null,
  testID,
  accessibilityLabel,
  hybridRef,
  nuiPerfId = null,
  onLayout,
  ...restProps
}: SpikeTextFieldProps) {
  const controlled = useControlled(value, defaultValue ?? '', onValueChange);
  const hybridRefCallback = useStableCallback(hybridRef);
  const sizingId = useSizingId();
  const handleFocus = useStableCallback(onFocus);
  const handleBlur = useStableCallback(onBlur);
  const handleSubmit = useStableCallback(onSubmitEditing);

  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const width = layoutWidth ?? measuredWidth;
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      onLayout?.(event);
      setMeasuredWidth(event.nativeEvent.layout.width);
    },
    [onLayout]
  );

  return (
    <NativeNitroUiSpikeTextField
      {...restProps}
      onLayout={handleLayout}
      iosImplementation={iosImplementation}
      value={controlled.value}
      defaultValue={controlled.defaultValue}
      mostRecentEventCount={controlled.mostRecentEventCount}
      placeholder={placeholder ?? null}
      disabled={disabled}
      maxLength={maxLength}
      multiline={multiline}
      maxLines={maxLines}
      keyboardHints={keyboardHints}
      autoFocus={autoFocus}
      accessibilityLabel={accessibilityLabel ?? null}
      testID={testID ?? null}
      nuiPerfId={nuiPerfId}
      onValueChange={controlled.onNativeChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onSubmitEditing={handleSubmit}
      nuiSizingKey={sizingVariantFor(multiline, maxLines ?? 0, width)}
      nuiSizingId={sizingId}
      hybridRef={hybridRefCallback ?? undefined}
    />
  );
}

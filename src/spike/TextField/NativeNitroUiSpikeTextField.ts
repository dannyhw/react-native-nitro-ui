import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import {
  getHostComponent,
  type HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroCallbackProp } from '../../core/useStableCallback';
import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';

/**
 * What a `hybridRef` callback receives, for this repo's harness and example.
 *
 * Declared here rather than derived from `NitroUiSpikeTextFieldMethods` because nitrogen's generated
 * methods type carries the *methods* only — the props are on the Hybrid View type — and the spike's checks
 * read `value` / `mostRecentEventCount` off the instance, exactly as `NitroUiSwitchHandle` does for Switch.
 *
 * @internal Spike only.
 */
export interface SpikeTextFieldHandle {
  /** The last `value` React sent, or `null` while uncontrolled. */
  readonly value: string | null;
  /** How many native changes JS has confirmed. */
  readonly mostRecentEventCount: number;
  /**
   * The shape native is holding, as opposed to `nuiTestState()`'s `impl=`, which is the shape that won.
   *
   * Readable because the first iOS run of P1 reported `swiftui` for an instance that had been asked for
   * `textfield`, and the only way to tell "the prop never arrived" from "the branch never got built" is to
   * ask the instance for both.
   */
  readonly iosImplementation: string;
  measureContent(): { width: number; height: number };
  focus(): void;
  blur(): void;
  nuiTestState(): string;
  nuiTestApplyWrite(text: string): void;
}

/**
 * The Fabric view config of the spike field.
 *
 * A hand-kept copy of `nitrogen/generated/shared/json/
 * NitroUiSpikeTextFieldConfig.json`, the same way every shipped component keeps
 * one (`Switch/NitroUiSwitchConfig.ts` explains why the copy exists at all: a
 * published `src/` module cannot import JSON above `src`).
 *
 * It is kept in `src/__tests__/viewConfigs.test.ts`'s table like every other generated config: that test's
 * job is to catch a hand-kept copy drifting from what nitrogen emits, and the spike's config is exactly as
 * capable of drifting as Switch's is. Its one exception is the "every generated config belongs to a
 * manifested component" assertion, which lets the spike through on purpose (no `component.json`, on
 * purpose — see `TextField.nitro.ts`).
 *
 * @internal Spike only.
 */
export const NitroUiSpikeTextFieldConfig = {
  uiViewClassName: 'NitroUiSpikeTextField',
  supportsRawText: false,
  bubblingEventTypes: {},
  directEventTypes: {},
  validAttributes: {
    iosImplementation: true,
    value: true,
    defaultValue: true,
    mostRecentEventCount: true,
    placeholder: true,
    disabled: true,
    maxLength: true,
    multiline: true,
    maxLines: true,
    keyboardHints: true,
    autoFocus: true,
    accessibilityLabel: true,
    testID: true,
    nuiPerfId: true,
    onValueChange: true,
    onFocus: true,
    onBlur: true,
    onSubmitEditing: true,
    nuiSizingKey: true,
    nuiSizingId: true,
    hybridRef: true,
  },
} as const;

/**
 * Props of the raw host component: **every** spec prop, always sent, callbacks in Nitro's `{ f: … }`
 * wrapper — DECISIONS D7 again, and the reason is sharper here than anywhere else in the library: a text
 * field is the one control where a prop that *disappears* between two commits would silently change what a
 * person is allowed to type (`maxLength`, `keyboardHints`, `disabled`).
 *
 * @internal Spike only.
 */
interface NativeNitroUiSpikeTextFieldProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  iosImplementation: string;
  value: string | null;
  defaultValue: string | null;
  mostRecentEventCount: number;
  placeholder: string | null;
  disabled: boolean;
  maxLength: number | null;
  multiline: boolean;
  maxLines: number | null;
  keyboardHints: number;
  autoFocus: boolean;
  accessibilityLabel: string | null;
  testID: string | null;
  nuiPerfId: number | null;
  onValueChange: NitroCallbackProp<
    (value: string, eventCount: number) => void
  > | null;
  onFocus: NitroCallbackProp<() => void> | null;
  onBlur: NitroCallbackProp<() => void> | null;
  onSubmitEditing: NitroCallbackProp<() => void> | null;
  hybridRef?: NitroCallbackProp<(view: SpikeTextFieldHandle) => void>;
}

/**
 * The raw host component of the spike field.
 *
 * `getHostComponent`'s return type intersects props with `ViewProps` and types Nitro's nullable callback
 * props as raw functions, so only the props type is corrected here — the runtime object is exactly what
 * `getHostComponent` returns. `NitroUiSpikeTextFieldHandle` is passed as the methods type: the cast below
 * discards it anyway, and the harness reads the shape declared above.
 */
export const NativeNitroUiSpikeTextField = getHostComponent<
  NativeNitroUiSpikeTextFieldProps,
  SpikeTextFieldHandle
>(
  'NitroUiSpikeTextField',
  () => NitroUiSpikeTextFieldConfig
) as unknown as ComponentType<
  Omit<
    ViewProps,
    'testID' | 'accessibilityLabel' | 'onFocus' | 'onBlur' | 'onSubmitEditing'
  > &
    NativeNitroUiSpikeTextFieldProps
>;

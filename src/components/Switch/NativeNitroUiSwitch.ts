import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import {
  getHostComponent,
  type HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';
import { NitroUiSwitchConfig } from './NitroUiSwitchConfig';
import type { NitroUiSize, NitroUiSwitchMethods } from './Switch.nitro';
import type { NitroCallbackProp } from '../../core/useStableCallback';

type ValueChangeHandler = (value: boolean, eventCount: number) => void;
type HybridRefHandler = (view: NitroUiSwitchHandle) => void;

/**
 * The read side of the native Switch - what a `hybridRef` callback gets.
 *
 * Deliberately read-only (DECISIONS D14): writing `view.value = …` from JS would
 * run the native setter on the JS thread, mutate model state the UI thread owns,
 * and never commit, so the write would silently do nothing. Every prop goes
 * through React. Methods that only read a cache (`measureContent()`) are safe
 * from any thread, which is why they are here.
 *
 * @internal v0.1 does not publish Hybrid View types; this alias exists so
 * `hybridRef` can be typed for this repo's harness and benchmarks.
 */
export interface NitroUiSwitchHandle {
  /** The last `value` React sent, or `null` while uncontrolled. */
  readonly value: boolean | null;
  /** How many native changes JS has confirmed. */
  readonly mostRecentEventCount: number;
  /** Whether interaction is disabled. */
  readonly disabled: boolean;
  /** The tint as this platform's `processColor` produces it, or `null`. */
  readonly tintColor: number | null;
  /** The control's accessibility label, or `null`. */
  readonly accessibilityLabel: string | null;
  /** The fitting size of the hosted control, in platform units. */
  measureContent(): NitroUiSize;
}

/**
 * Props of the raw host component: **every** spec prop, always sent, with
 * callbacks in Nitro's `{ f: … }` wrapper.
 *
 * Nothing here is optional on purpose (DECISIONS D7) - `Switch.tsx` is the
 * friendly API, and it converts `undefined` into `null` so a prop can never
 * disappear between two commits (nitro#1184).
 */
/**
 * The two sizing props (`nuiSizingKey`, `nuiSizingId`) come from
 * [NitroUiIntrinsicProps](../../core/NitroUiIntrinsicProps.ts), like every other
 * self-sizing component's native props.
 */
export interface NativeNitroUiSwitchProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  value: boolean | null;
  defaultValue: boolean | null;
  mostRecentEventCount: number;
  disabled: boolean;
  tintColor: number | null;
  testID: string | null;
  accessibilityLabel: string | null;
  nuiPerfId: number | null;
  /** TEMPORARY, test-only size-affecting prop - see `SwitchProps.nuiTestWidth`. */
  nuiTestWidth: number | null;
  onValueChange: NitroCallbackProp<ValueChangeHandler>;
  hybridRef?: NitroCallbackProp<HybridRefHandler>;
}

/**
 * The host component for the `NitroUiSwitch` Hybrid View.
 *
 * `getHostComponent`'s return type intersects the props with `ViewProps`, which
 * would make `testID`/`accessibilityLabel` optional again and type Nitro's
 * nullable callback props as raw functions. The runtime object is exactly what
 * `getHostComponent` returns; only the props type is corrected here (a
 * `ComponentType`, so `style` and the other base props still apply).
 */
export const NativeNitroUiSwitch = getHostComponent<
  NativeNitroUiSwitchProps,
  NitroUiSwitchMethods
>('NitroUiSwitch', () => NitroUiSwitchConfig) as unknown as ComponentType<
  Omit<ViewProps, 'testID' | 'accessibilityLabel'> & NativeNitroUiSwitchProps
>;

import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import { getHostComponent, type HybridViewProps } from 'react-native-nitro-modules';

import { NitroUiSwitchConfig } from './NitroUiSwitchConfig';
import type {
  NitroUiSwitch,
  NitroUiSwitchMethods,
} from './Switch.nitro';
import type { NitroCallbackProp } from '../../core/useStableCallback';

type ValueChangeHandler = (value: boolean, eventCount: number) => void;
type HybridRefHandler = (view: NitroUiSwitch) => void;

/**
 * Props of the raw host component: **every** spec prop, always sent, with
 * callbacks in Nitro's `{ f: … }` wrapper.
 *
 * Nothing here is optional on purpose (DECISIONS D7) - `Switch.tsx` is the
 * friendly API, and it converts `undefined` into `null` so a prop can never
 * disappear between two commits (nitro#1184).
 */
export interface NativeNitroUiSwitchProps extends HybridViewProps {
  value: boolean | null;
  defaultValue: boolean | null;
  mostRecentEventCount: number;
  disabled: boolean;
  tintColor: number | null;
  testID: string | null;
  accessibilityLabel: string | null;
  nuiPerfId: number | null;
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

/** A reference to the native Switch, obtained through `hybridRef`. */
export type NitroUiSwitchRef = NitroUiSwitch;

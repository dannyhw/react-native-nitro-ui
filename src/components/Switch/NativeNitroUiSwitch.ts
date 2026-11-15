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
 * What a `hybridRef` callback receives. Read-only: a write from JS would run
 * the native setter off the UI thread and never commit.
 *
 * @internal
 */
export interface NitroUiSwitchHandle {
  /** `null` while uncontrolled. */
  readonly value: boolean | null;
  /** How many native changes JS has confirmed. */
  readonly mostRecentEventCount: number;
  readonly disabled: boolean;
  /** The tint as this platform's `processColor` produces it, or `null`. */
  readonly tintColor: number | null;
  readonly accessibilityLabel: string | null;
  /** The fitting size of the hosted control, in platform units. */
  measureContent(): NitroUiSize;
  /** Test-only: which composition guards this control's view has armed. */
  nuiTestArmedGuards(): string;
  /**
   * Test-only: what this native object has been through.
   * @internal
   */
  nuiTestLifetimeReport(): string;
}

/**
 * No spec prop is optional: Fabric sends `null` for a removed prop, which
 * crashes an optional one (nitro#1184).
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
  /** Test-only: the control's width in platform units. */
  nuiTestWidth: number | null;
  onValueChange: NitroCallbackProp<ValueChangeHandler>;
  hybridRef?: NitroCallbackProp<HybridRefHandler>;
}

/**
 * The cast corrects only the props type: `getHostComponent` intersects the
 * props with `ViewProps`, which would make `testID` and `accessibilityLabel`
 * optional again.
 */
export const NativeNitroUiSwitch = getHostComponent<
  NativeNitroUiSwitchProps,
  NitroUiSwitchMethods
>('NitroUiSwitch', () => NitroUiSwitchConfig) as unknown as ComponentType<
  Omit<ViewProps, 'testID' | 'accessibilityLabel'> & NativeNitroUiSwitchProps
>;

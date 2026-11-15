import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import {
  getHostComponent,
  type HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';
import { NitroUiButtonGroupConfig } from './NitroUiButtonGroupConfig';
import type {
  NitroUiButtonGroupItem,
  NitroUiButtonGroupMethods,
  NitroUiButtonGroupSize,
} from './ButtonGroup.nitro';
import type { NitroCallbackProp } from '../../core/useStableCallback';

type PressHandler = (id: string) => void;
type CheckedChangeHandler = (
  id: string,
  checked: boolean,
  eventCount: number
) => void;
type HybridRefHandler = (view: NitroUiButtonGroupHandle) => void;

/**
 * What a `hybridRef` callback receives. Read-only: a write from JS would run
 * the native setter off the UI thread and never commit.
 *
 * @internal
 */
export interface NitroUiButtonGroupHandle {
  readonly items: NitroUiButtonGroupItem[];
  /** `'standard'` for anything unrecognised. */
  readonly appearance: string;
  readonly variant: string;
  readonly size: string;
  readonly labelStyle: string;
  readonly disabled: boolean;
  /** The tint as this platform's `processColor` produces it, or `null`. */
  readonly tintColor: number | null;
  readonly accessibilityLabel: string | null;
  /** What React last sent as the checked set (not necessarily what is drawn). */
  readonly checkedIds: string[];
  /** The ids a `checkedIds` write may move. */
  readonly controlledIds: string[];
  /** How many native changes JS has confirmed. */
  readonly mostRecentEventCount: number;
  /** The fitting size of the hosted control, in platform units. */
  measureContent(): NitroUiButtonGroupSize;
  /** Test-only: presses one item through the tap's path. */
  nuiTestPressItem(id: string): void;
  /**
   * Test-only: opens the overflow menu on Android. Does nothing on iOS, whose
   * `Menu` opens only by gesture.
   */
  nuiTestOpenOverflow(): void;
  /** Test-only: reads what the row laid out. */
  nuiTestProbeRow(): void;
  /** Test-only: reads the accessibility nodes. */
  nuiTestProbeAccessibility(): void;
  /**
   * Test-only:
   * `checked=…;visible=…;overflow=…;row=…;menu=…;probes=…;a11y=…`.
   */
  nuiTestStateReport(): string;
}

/**
 * No spec prop is optional: Fabric sends `null` for a removed prop, which
 * crashes an optional one (nitro#1184).
 */
export interface NativeNitroUiButtonGroupProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  items: NitroUiButtonGroupItem[];
  appearance: string;
  variant: string;
  size: string;
  labelStyle: string;
  disabled: boolean;
  tintColor: number | null;
  checkedIds: string[];
  controlledIds: string[];
  defaultCheckedIds: string[];
  mostRecentEventCount: number;
  overflowAccessibilityLabel: string | null;
  accessibilityLabel: string | null;
  testID: string | null;
  nuiPerfId: number | null;
  onPress: NitroCallbackProp<PressHandler>;
  onCheckedChange: NitroCallbackProp<CheckedChangeHandler>;
  hybridRef?: NitroCallbackProp<HybridRefHandler>;
}

/**
 * The cast corrects only the props type: `getHostComponent` intersects the
 * props with `ViewProps`, which would make `testID` and `accessibilityLabel`
 * optional again.
 */
export const NativeNitroUiButtonGroup = getHostComponent<
  NativeNitroUiButtonGroupProps,
  NitroUiButtonGroupMethods
>(
  'NitroUiButtonGroup',
  () => NitroUiButtonGroupConfig
) as unknown as ComponentType<
  Omit<ViewProps, 'testID' | 'accessibilityLabel'> &
    NativeNitroUiButtonGroupProps
>;

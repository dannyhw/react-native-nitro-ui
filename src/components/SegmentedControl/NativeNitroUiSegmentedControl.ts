import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import {
  getHostComponent,
  type HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';
import { NitroUiSegmentedControlConfig } from './NitroUiSegmentedControlConfig';
import type {
  NitroUiSegmentedControlMethods,
  NitroUiSegmentedControlSize,
} from './SegmentedControl.nitro';
import type { NitroCallbackProp } from '../../core/useStableCallback';

type ChangeHandler = (index: number, eventCount: number) => void;
type HybridRefHandler = (view: NitroUiSegmentedControlHandle) => void;

/**
 * The read side of the native SegmentedControl - what a `hybridRef` callback gets.
 *
 * Read-only: a prop written from JS runs the native setter on the JS thread and
 * never commits. Methods that only read a cache (`measureContent()`) are safe on
 * any thread.
 *
 * @internal Hybrid View types are not published; this alias exists so
 * `hybridRef` can be typed for this repo's harness and benchmarks.
 */
export interface NitroUiSegmentedControlHandle {
  readonly options: string[];
  /** The selected index as React sent it, or `null` while uncontrolled. */
  readonly selectedIndex: number | null;
  readonly mostRecentEventCount: number;
  readonly disabled: boolean;
  readonly tintColor: number | null;
  readonly accessibilityLabel: string | null;
  /** The fitting size of the hosted control, in platform units. */
  measureContent(): NitroUiSegmentedControlSize;
  /**
   * Test-only pixel probe.
   * @internal
   */
  nuiTestPixelProbe(color: number): void;
  /**
   * Test-only: what that probe found.
   * @internal
   */
  nuiTestPixelReport(): string;
  /**
   * Test-only: which segment the control is displaying.
   * @internal
   */
  nuiTestDisplayedIndex(): string;
}

/**
 * Props of the raw host component: every spec prop, always sent, with callbacks
 * in Nitro's `{ f: … }` wrapper. Nothing is optional, so a prop can never
 * disappear between two commits (nitro#1184); `SegmentedControl.tsx` turns
 * `undefined` into `null` and a missing array into `[]`, and always sends the
 * callback.
 */
export interface NativeNitroUiSegmentedControlProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  options: string[];
  selectedIndex: number | null;
  defaultSelectedIndex: number;
  mostRecentEventCount: number;
  disabled: boolean;
  tintColor: number | null;
  testID: string | null;
  accessibilityLabel: string | null;
  nuiPerfId: number | null;
  onValueChange: NitroCallbackProp<ChangeHandler>;
  hybridRef?: NitroCallbackProp<HybridRefHandler>;
}

/**
 * The host component for the `NitroUiSegmentedControl` Hybrid View. The cast
 * corrects only the props type: `getHostComponent` intersects it with
 * `ViewProps`, which would make `testID`/`accessibilityLabel` optional again and
 * type the callback as a raw function.
 */
export const NativeNitroUiSegmentedControl = getHostComponent<
  NativeNitroUiSegmentedControlProps,
  NitroUiSegmentedControlMethods
>(
  'NitroUiSegmentedControl',
  () => NitroUiSegmentedControlConfig
) as unknown as ComponentType<
  Omit<ViewProps, 'testID' | 'accessibilityLabel'> &
    NativeNitroUiSegmentedControlProps
>;

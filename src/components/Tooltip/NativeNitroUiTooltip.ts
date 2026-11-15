import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import {
  getHostComponent,
  type HybridViewProps,
} from 'react-native-nitro-modules';

import { NitroUiTooltipConfig } from './NitroUiTooltipConfig';
import type {
  NitroUiTooltipAction,
  NitroUiTooltipMethods,
} from './Tooltip.nitro';
import type { NitroCallbackProp } from '../../core/useStableCallback';

type PresentedChangeHandler = (presented: boolean, eventCount: number) => void;
type ActionHandler = (id: string) => void;
type HybridRefHandler = (view: NitroUiTooltipHandle) => void;

/**
 * The read side of the native tooltip - what a `hybridRef` callback gets.
 *
 * Read-only: a prop written from JS runs the native setter off the UI thread and
 * never commits. The three methods are test seams, and each hops to the main
 * thread itself.
 *
 * @internal Hybrid View types are not published; this alias exists so
 * `hybridRef` can be typed for this repo's harness and benchmarks.
 */
export interface NitroUiTooltipHandle {
  readonly presented: boolean;
  readonly mostRecentEventCount: number;
  readonly message: string;
  readonly title: string | null;
  readonly placement: string;
  /**
   * Test-only state readback.
   * @internal
   */
  nuiTestStateReport(): string;
  /**
   * Test-only action seam.
   * @internal
   */
  nuiTestPerformAction(id: string): void;
  /**
   * Test-only dismissal seam.
   * @internal
   */
  nuiTestDismiss(): void;
}

/**
 * Props of the raw host component: every spec prop, always sent, with callbacks
 * in Nitro's `{ f: … }` wrapper. A tooltip is not self-sizing, so there are no
 * sizing props.
 */
export interface NativeNitroUiTooltipProps extends HybridViewProps {
  presented: boolean;
  mostRecentEventCount: number;
  message: string;
  title: string | null;
  actions: NitroUiTooltipAction[];
  placement: string;
  testID: string | null;
  nuiPerfId: number | null;
  onPresentedChange: NitroCallbackProp<PresentedChangeHandler>;
  onAction: NitroCallbackProp<ActionHandler>;
  hybridRef?: NitroCallbackProp<HybridRefHandler>;
}

/**
 * The host component for the `NitroUiTooltip` Hybrid View. The cast corrects only
 * the props type, which `getHostComponent` intersects with `ViewProps`.
 */
export const NativeNitroUiTooltip = getHostComponent<
  NativeNitroUiTooltipProps,
  NitroUiTooltipMethods
>('NitroUiTooltip', () => NitroUiTooltipConfig) as unknown as ComponentType<
  Omit<ViewProps, 'testID'> & NativeNitroUiTooltipProps
>;

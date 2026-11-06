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
 * Read-only for the reason every handle here is (DECISIONS D14): a prop written from
 * JS runs the native setter off the UI thread and never commits. The three methods
 * are the test seams, and each hops to the main thread itself.
 *
 * @internal v0.1 does not publish Hybrid View types; this alias exists so
 * `hybridRef` can be typed for this repo's harness and benchmarks.
 */
export interface NitroUiTooltipHandle {
  /** What React last asked for. */
  readonly presented: boolean;
  /** The event count JS has echoed. */
  readonly mostRecentEventCount: number;
  readonly message: string;
  readonly title: string | null;
  readonly placement: string;
  /**
   * Test-only readback - see `NitroUiTooltipMethods.nuiTestStateReport`.
   * @internal
   */
  nuiTestStateReport(): string;
  /**
   * Test-only action seam - see `NitroUiTooltipMethods.nuiTestPerformAction`.
   * @internal
   */
  nuiTestPerformAction(id: string): void;
  /**
   * Test-only dismissal seam - see `NitroUiTooltipMethods.nuiTestDismiss`.
   * @internal
   */
  nuiTestDismiss(): void;
}

/**
 * Props of the raw host component: **every** spec prop, always sent, with callbacks
 * in Nitro's `{ f: … }` wrapper (DECISIONS D7, D7b). `Tooltip.tsx` is the friendly
 * API.
 *
 * No `NitroUiIntrinsicProps`: a tooltip is not self-sizing (`sizing: null`).
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
 * The host component for the `NitroUiTooltip` Hybrid View. Only the props type is
 * corrected here, as for every other control (`NativeNitroUiDialog.ts`).
 */
export const NativeNitroUiTooltip = getHostComponent<
  NativeNitroUiTooltipProps,
  NitroUiTooltipMethods
>('NitroUiTooltip', () => NitroUiTooltipConfig) as unknown as ComponentType<
  Omit<ViewProps, 'testID'> & NativeNitroUiTooltipProps
>;

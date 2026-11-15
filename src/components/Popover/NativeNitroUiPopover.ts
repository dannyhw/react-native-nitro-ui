import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import {
  getHostComponent,
  type HybridViewProps,
} from 'react-native-nitro-modules';

import { NitroUiPopoverConfig } from './NitroUiPopoverConfig';
import type { NitroUiPopoverMethods } from './Popover.nitro';
import type { NitroCallbackProp } from '../../core/useStableCallback';

type PresentedChangeHandler = (presented: boolean, eventCount: number) => void;
type DismissedHandler = (ended: boolean) => void;
type HybridRefHandler = (view: NitroUiPopoverHandle) => void;

/**
 * The read side of the native popover - what a `hybridRef` callback gets.
 *
 * Read-only: a prop written from JS runs the native setter off the UI thread and
 * never commits. The two methods are test seams, and each hops to the UI thread
 * itself.
 *
 * @internal Hybrid View types are not published; this alias exists so `hybridRef`
 * can be typed for this repo's harness.
 */
export interface NitroUiPopoverHandle {
  readonly presented: boolean;
  readonly mostRecentEventCount: number;
  /** The cap the content is laid out at, in points. */
  readonly maxWidth: number;
  /**
   * Test-only state readback.
   * @internal
   */
  nuiTestStateReport(): string;
  /**
   * Test-only dismissal seam.
   * @internal
   */
  nuiTestDismiss(): void;
}

/**
 * Props of the raw host component: every spec prop, always sent, with callbacks
 * in Nitro's `{ f: … }` wrapper. A popover is not self-sizing, so there are no
 * sizing props: its box comes from the content Yoga has already laid out.
 */
export interface NativeNitroUiPopoverProps extends HybridViewProps {
  presented: boolean;
  mostRecentEventCount: number;
  maxWidth: number;
  testID: string | null;
  nuiPerfId: number | null;
  onPresentedChange: NitroCallbackProp<PresentedChangeHandler>;
  onDismissed: NitroCallbackProp<DismissedHandler>;
  hybridRef?: NitroCallbackProp<HybridRefHandler>;
}

/**
 * The host component for the `NitroUiPopover` Hybrid View. The cast corrects only
 * the props type, which `getHostComponent` intersects with `ViewProps`.
 */
export const NativeNitroUiPopover = getHostComponent<
  NativeNitroUiPopoverProps,
  NitroUiPopoverMethods
>('NitroUiPopover', () => NitroUiPopoverConfig) as unknown as ComponentType<
  Omit<ViewProps, 'testID'> & NativeNitroUiPopoverProps
>;

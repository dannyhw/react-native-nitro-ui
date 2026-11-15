import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import {
  getHostComponent,
  type HybridViewProps,
} from 'react-native-nitro-modules';

import { NitroUiDialogConfig } from './NitroUiDialogConfig';
import type { NitroUiDialogAction, NitroUiDialogMethods } from './Dialog.nitro';
import type { NitroCallbackProp } from '../../core/useStableCallback';

type PresentedChangeHandler = (presented: boolean, eventCount: number) => void;
type ActionHandler = (id: string) => void;
type HybridRefHandler = (view: NitroUiDialogHandle) => void;

/**
 * The read side of the native dialog - what a `hybridRef` callback gets.
 *
 * Read-only: a prop written from JS runs the native setter off the UI thread and
 * never commits. The three methods are test seams, and each hops to the main
 * thread itself.
 *
 * @internal Hybrid View types are not published; this alias exists so
 * `hybridRef` can be typed for this repo's harness and benchmarks.
 */
export interface NitroUiDialogHandle {
  /** `'alert'` or `'confirmation'`. */
  readonly variant: string;
  readonly presented: boolean;
  readonly mostRecentEventCount: number;
  readonly title: string;
  readonly message: string | null;
  readonly dismissible: boolean;
  readonly tintColor: number | null;
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
 * in Nitro's `{ f: … }` wrapper. A dialog is not self-sizing, so there are no
 * sizing props.
 */
export interface NativeNitroUiDialogProps extends HybridViewProps {
  variant: string;
  presented: boolean;
  mostRecentEventCount: number;
  title: string;
  message: string | null;
  titleVisibility: string;
  actions: NitroUiDialogAction[];
  dismissible: boolean;
  tintColor: number | null;
  testID: string | null;
  nuiPerfId: number | null;
  onPresentedChange: NitroCallbackProp<PresentedChangeHandler>;
  onAction: NitroCallbackProp<ActionHandler>;
  hybridRef?: NitroCallbackProp<HybridRefHandler>;
}

/**
 * The host component for the `NitroUiDialog` Hybrid View. The cast corrects only
 * the props type, which `getHostComponent` intersects with `ViewProps`.
 */
export const NativeNitroUiDialog = getHostComponent<
  NativeNitroUiDialogProps,
  NitroUiDialogMethods
>('NitroUiDialog', () => NitroUiDialogConfig) as unknown as ComponentType<
  Omit<ViewProps, 'testID'> & NativeNitroUiDialogProps
>;

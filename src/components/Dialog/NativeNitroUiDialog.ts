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
 * Read-only for the reason every handle here is (DECISIONS D14): a prop written
 * from JS runs the native setter off the UI thread and never commits. The three
 * methods are the test seams, and each hops to the main thread itself.
 *
 * @internal v0.1 does not publish Hybrid View types; this alias exists so
 * `hybridRef` can be typed for this repo's harness and benchmarks.
 */
export interface NitroUiDialogHandle {
  /** `'alert'` or `'confirmation'`, as React sent it. */
  readonly variant: string;
  /** What React last asked for. */
  readonly presented: boolean;
  /** The event count JS has echoed. */
  readonly mostRecentEventCount: number;
  readonly title: string;
  readonly message: string | null;
  readonly dismissible: boolean;
  readonly tintColor: number | null;
  /**
   * Test-only readback - see `NitroUiDialogMethods.nuiTestStateReport`.
   * @internal
   */
  nuiTestStateReport(): string;
  /**
   * Test-only action seam - see `NitroUiDialogMethods.nuiTestPerformAction`.
   * @internal
   */
  nuiTestPerformAction(id: string): void;
  /**
   * Test-only dismissal seam - see `NitroUiDialogMethods.nuiTestDismiss`.
   * @internal
   */
  nuiTestDismiss(): void;
}

/**
 * Props of the raw host component: **every** spec prop, always sent, with
 * callbacks in Nitro's `{ f: … }` wrapper (DECISIONS D7, D7b). `Dialog.tsx` is
 * the friendly API.
 *
 * No `NitroUiIntrinsicProps`: a dialog is not self-sizing (`sizing: null`).
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
 * The host component for the `NitroUiDialog` Hybrid View. Only the props type is
 * corrected here, as for every other control (`NativeNitroUiMenu.ts`).
 */
export const NativeNitroUiDialog = getHostComponent<
  NativeNitroUiDialogProps,
  NitroUiDialogMethods
>('NitroUiDialog', () => NitroUiDialogConfig) as unknown as ComponentType<
  Omit<ViewProps, 'testID'> & NativeNitroUiDialogProps
>;

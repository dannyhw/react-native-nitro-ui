import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import {
  getHostComponent,
  type HybridViewProps,
} from 'react-native-nitro-modules';

import { NitroUiBottomSheetConfig } from './NitroUiBottomSheetConfig';
import type {
  NitroUiBottomSheetMethods,
  NitroUiSheetDetent,
} from './BottomSheet.nitro';
import type { NitroCallbackProp } from '../../core/useStableCallback';

type PresentedChangeHandler = (presented: boolean, eventCount: number) => void;
type DetentChangeHandler = (index: number) => void;
type DismissedHandler = (ended: boolean) => void;
type ContentBoxHandler = (width: number, height: number) => void;
type HybridRefHandler = (view: NitroUiBottomSheetHandle) => void;

/**
 * The read side of the native sheet - what a `hybridRef` callback gets.
 * Read-only: a prop written from JS never commits. The three methods are test
 * seams, and each hops to the main thread itself.
 *
 * @internal Hybrid View types are not published; this alias exists so
 * `hybridRef` can be typed for this repo's harness and benchmarks.
 */
export interface NitroUiBottomSheetHandle {
  readonly presented: boolean;
  readonly mostRecentEventCount: number;
  readonly dismissible: boolean;
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
  /**
   * Test-only detent seam.
   * @internal
   */
  nuiTestSelectDetent(index: number): void;
}

/**
 * Props of the raw host component: every spec prop, always sent, with callbacks
 * in Nitro's `{ f: … }` wrapper.
 *
 * A sheet is not self-sizing, so there are no sizing props: its node's `style`
 * is the content's box, which the wrapper writes from `onContentBox`.
 */
export interface NativeNitroUiBottomSheetProps extends HybridViewProps {
  presented: boolean;
  mostRecentEventCount: number;
  detents: NitroUiSheetDetent[];
  dismissible: boolean;
  showsGrabber: boolean;
  cornerRadius: number | null;
  containerColor: number | null;
  label: string | null;
  testID: string | null;
  nuiPerfId: number | null;
  onPresentedChange: NitroCallbackProp<PresentedChangeHandler>;
  onDetentChange: NitroCallbackProp<DetentChangeHandler>;
  onDismissed: NitroCallbackProp<DismissedHandler>;
  onContentBox: NitroCallbackProp<ContentBoxHandler>;
  hybridRef?: NitroCallbackProp<HybridRefHandler>;
}

/**
 * The host component for the `NitroUiBottomSheet` Hybrid View. The cast corrects
 * only the props type, which `getHostComponent` intersects with `ViewProps`.
 */
export const NativeNitroUiBottomSheet = getHostComponent<
  NativeNitroUiBottomSheetProps,
  NitroUiBottomSheetMethods
>(
  'NitroUiBottomSheet',
  () => NitroUiBottomSheetConfig
) as unknown as ComponentType<
  Omit<ViewProps, 'testID'> & NativeNitroUiBottomSheetProps
>;

import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import {
  getHostComponent,
  type HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';
import { NitroUiButtonConfig } from './NitroUiButtonConfig';
import type { NitroUiButtonMethods, NitroUiButtonSize } from './Button.nitro';
import type { NitroCallbackProp } from '../../core/useStableCallback';

type PressHandler = () => void;
type HybridRefHandler = (view: NitroUiButtonHandle) => void;

/**
 * The read side of the native Button - what a `hybridRef` callback gets.
 *
 * Read-only: a prop written from JS runs the native setter on the JS thread and
 * never commits. Methods that only read a cache (`measureContent()`) are safe
 * from any thread.
 *
 * @internal Hybrid View types are not published; this alias exists so
 * `hybridRef` can be typed for this repo's harness and benchmarks.
 */
export interface NitroUiButtonHandle {
  readonly title: string;
  readonly variant: string;
  readonly size: string;
  readonly shape: string;
  readonly disabled: boolean;
  readonly tintColor: number | null;
  readonly systemImage: string | null;
  /** The normalised Android drawable name, or `null`. */
  readonly androidIcon: string | null;
  /** The control's accessibility label, or `null` when it falls back to `title`. */
  readonly accessibilityLabel: string | null;
  /** The fitting size of the hosted control, in platform units. */
  measureContent(): NitroUiButtonSize;
  /** Test-only: ask whether `color` is among the pixels this Button drew. */
  nuiTestPixelProbe(color: number): void;
  /** Test-only: the last probe's result line. */
  nuiTestPixelReport(): string;
}

/**
 * Props of the raw host component: every spec prop, always sent, with callbacks
 * in Nitro's `{ f: … }` wrapper. Nothing is optional, so a prop can never
 * disappear between two commits (nitro#1184); `Button.tsx` turns `undefined`
 * into `null` and always sends an `onPress`.
 */
export interface NativeNitroUiButtonProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  title: string;
  variant: string;
  size: string;
  shape: string;
  disabled: boolean;
  tintColor: number | null;
  systemImage: string | null;
  androidIcon: string | null;
  testID: string | null;
  accessibilityLabel: string | null;
  nuiPerfId: number | null;
  onPress: NitroCallbackProp<PressHandler>;
  hybridRef?: NitroCallbackProp<HybridRefHandler>;
}

/**
 * The host component for the `NitroUiButton` Hybrid View. The cast corrects only
 * the props type: `getHostComponent` intersects it with `ViewProps`, which would
 * make `testID`/`accessibilityLabel` optional again and type the callback props
 * as raw functions.
 */
export const NativeNitroUiButton = getHostComponent<
  NativeNitroUiButtonProps,
  NitroUiButtonMethods
>('NitroUiButton', () => NitroUiButtonConfig) as unknown as ComponentType<
  Omit<ViewProps, 'testID' | 'accessibilityLabel'> & NativeNitroUiButtonProps
>;

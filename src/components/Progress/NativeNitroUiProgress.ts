import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import {
  getHostComponent,
  type HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';
import { NitroUiProgressConfig } from './NitroUiProgressConfig';
import type { NitroUiSize } from '../Switch/Switch.nitro';
import type { NitroUiProgressMethods } from './Progress.nitro';
import type { NitroCallbackProp } from '../../core/useStableCallback';

type HybridRefHandler = (view: NitroUiProgressHandle) => void;

/**
 * What a `hybridRef` callback receives. Read-only: a write from JS would run
 * the native setter off the UI thread and never commit.
 *
 * @internal
 */
export interface NitroUiProgressHandle {
  /** `'linear'`, `'circular'` or `'loading'`. */
  readonly variant: string;
  /** `'flat'` or `'wavy'` - stored on iOS, where nothing draws it. */
  readonly appearance: string;
  /** Whether a `'loading'` indicator has a container. */
  readonly contained: boolean;
  /** `null` for an indeterminate indicator. */
  readonly value: number | null;
  /** The tint as this platform's `processColor` produces it, or `null`. */
  readonly tintColor: number | null;
  /** The track colour as this platform's `processColor` produces it, or `null`. */
  readonly trackColor: number | null;
  readonly accessibilityLabel: string | null;
  /** The fitting size of the hosted control, in platform units. */
  measureContent(): NitroUiSize;
  /** Test-only: what the control is displaying. */
  nuiTestDisplayedValue(): string;
  /** Test-only: whether the control is allowed to be animating. */
  nuiTestIsAnimating(): boolean;
}

/**
 * No spec prop is optional: Fabric sends `null` for a removed prop, which
 * crashes an optional one (nitro#1184).
 */
export interface NativeNitroUiProgressProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  variant: string;
  appearance: string;
  contained: boolean;
  value: number | null;
  tintColor: number | null;
  trackColor: number | null;
  testID: string | null;
  accessibilityLabel: string | null;
  nuiPerfId: number | null;
  hybridRef?: NitroCallbackProp<HybridRefHandler>;
}

/**
 * The cast corrects only the props type: `getHostComponent` intersects the
 * props with `ViewProps`, which would make `testID` and `accessibilityLabel`
 * optional again.
 */
export const NativeNitroUiProgress = getHostComponent<
  NativeNitroUiProgressProps,
  NitroUiProgressMethods
>('NitroUiProgress', () => NitroUiProgressConfig) as unknown as ComponentType<
  Omit<ViewProps, 'testID' | 'accessibilityLabel'> & NativeNitroUiProgressProps
>;

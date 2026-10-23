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
 * The read side of the native Progress - what a `hybridRef` callback gets.
 *
 * Read-only like the other handles (DECISIONS D14): a prop write here runs the
 * native setter on the JS thread, mutates model state the UI thread owns and
 * never commits. `measureContent()` is a cached value and safe from any thread.
 *
 * The two `nuiTest*` methods are the exception to "read only" in the sense that
 * they are *methods* rather than setters - but they are test seams that read
 * state the UI thread wrote, not an imperative API (see `Progress.nitro.ts`).
 *
 * @internal v0.1 does not publish Hybrid View types; this alias exists so
 * `hybridRef` can be typed for this repo's harness and benchmarks.
 */
export interface NitroUiProgressHandle {
  /** `'linear'` or `'circular'`. */
  readonly variant: string;
  /** The fraction React sent, or `null` for an indeterminate indicator. */
  readonly value: number | null;
  /** The tint as this platform's `processColor` produces it, or `null`. */
  readonly tintColor: number | null;
  /** The track colour as this platform's `processColor` produces it, or `null`. */
  readonly trackColor: number | null;
  /** The control's accessibility label, or `null`. */
  readonly accessibilityLabel: string | null;
  /** The fitting size of the hosted control, in platform units. */
  measureContent(): NitroUiSize;
  /** What the control is displaying - see `NitroUiProgressMethods`. */
  nuiTestDisplayedValue(): string;
  /** Whether the control is allowed to be animating - see `NitroUiProgressMethods`. */
  nuiTestIsAnimating(): boolean;
}

/**
 * Props of the raw host component: **every** spec prop, always sent.
 *
 * Nothing here is optional on purpose (DECISIONS D7) - `Progress.tsx` is the
 * friendly API, and it converts `undefined` into `null` so a prop can never
 * disappear between two commits (nitro#1184). There are no callback props
 * (`docs/architecture/core.md` §12), so D7b has nothing to do here beyond
 * `hybridRef`, which is the one Nitro-boxed callback the harness needs.
 */
/**
 * The two sizing props (`nuiSizingKey`, `nuiSizingId`) come from
 * [NitroUiIntrinsicProps](../../core/NitroUiIntrinsicProps.ts), like every other
 * self-sizing component's native props.
 */
export interface NativeNitroUiProgressProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  variant: string;
  value: number | null;
  tintColor: number | null;
  trackColor: number | null;
  testID: string | null;
  accessibilityLabel: string | null;
  nuiPerfId: number | null;
  hybridRef?: NitroCallbackProp<HybridRefHandler>;
}

/**
 * The host component for the `NitroUiProgress` Hybrid View.
 *
 * `getHostComponent`'s return type intersects the props with `ViewProps`, which
 * would make `testID`/`accessibilityLabel` optional again and type Nitro's
 * nullable callback props as raw functions. The runtime object is exactly what
 * `getHostComponent` returns; only the props type is corrected here (a
 * `ComponentType`, so `style` and the other base props still apply).
 */
export const NativeNitroUiProgress = getHostComponent<
  NativeNitroUiProgressProps,
  NitroUiProgressMethods
>('NitroUiProgress', () => NitroUiProgressConfig) as unknown as ComponentType<
  Omit<ViewProps, 'testID' | 'accessibilityLabel'> & NativeNitroUiProgressProps
>;

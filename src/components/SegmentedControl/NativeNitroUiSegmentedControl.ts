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
 * Deliberately read-only (DECISIONS D14): writing `view.options = […]` from JS
 * runs the native setter on the JS thread, mutates model state the UI thread
 * owns, and never commits, so the write would silently do nothing (and, because
 * `options` decides the size, desync the size Yoga was told). Every prop goes
 * through React. Methods that only read a cache (`measureContent()`) are safe on
 * any thread, which is why that one is here.
 *
 * @internal v0.1 does not publish Hybrid View types; this alias exists so
 * `hybridRef` can be typed for this repo's harness and benchmarks.
 */
export interface NitroUiSegmentedControlHandle {
  /** The labels React last sent, in order. */
  readonly options: string[];
  /** The selected index as React sent it, or `null` while uncontrolled. */
  readonly selectedIndex: number | null;
  /** The event count JS has echoed. */
  readonly mostRecentEventCount: number;
  /** Whether interaction is disabled. */
  readonly disabled: boolean;
  /** The tint as this platform's `processColor` produces it, or `null`. */
  readonly tintColor: number | null;
  /** The control's accessibility label, or `null`. */
  readonly accessibilityLabel: string | null;
  /** The fitting size of the hosted control, in platform units. */
  measureContent(): NitroUiSegmentedControlSize;
  /**
   * Test-only pixel probe - see `NitroUiSegmentedControlMethods.nuiTestPixelProbe`.
   * @internal
   */
  nuiTestPixelProbe(color: number): void;
  /**
   * Test-only readback - see `NitroUiSegmentedControlMethods.nuiTestPixelReport`.
   * @internal
   */
  nuiTestPixelReport(): string;
}

/**
 * Props of the raw host component: **every** spec prop, always sent, with
 * callbacks in Nitro's `{ f: … }` wrapper.
 *
 * Nothing here is optional on purpose (DECISIONS D7) - `SegmentedControl.tsx` is
 * the friendly API, and it converts `undefined` into `null` and a missing array
 * into `[]` so a prop can never disappear between two commits (nitro#1184). The
 * callback is the D7b exception, and `SegmentedControl.tsx` always sends one.
 *
 * The two sizing props (`nuiSizingKey`, `nuiSizingId`) come from
 * [NitroUiIntrinsicProps](../../core/NitroUiIntrinsicProps.ts). For a
 * SegmentedControl `nuiSizingKey` is not decoration: the labels *are* the
 * control's width, so the key is what makes two different option lists get two
 * different cached sizes (`docs/architecture/sizing.md`).
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
 * The host component for the `NitroUiSegmentedControl` Hybrid View.
 *
 * `getHostComponent`'s return type intersects the props with `ViewProps`, which
 * would make `testID`/`accessibilityLabel` optional again and type Nitro's
 * nullable callback props as raw functions. The runtime object is exactly what
 * `getHostComponent` returns; only the props type is corrected here (a
 * `ComponentType`, so `style` and the other base props still apply).
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

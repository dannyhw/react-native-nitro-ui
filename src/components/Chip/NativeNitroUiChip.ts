import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import {
  getHostComponent,
  type HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';
import type { NitroCallbackProp } from '../../core/useStableCallback';
import type { NitroUiChipMethods, NitroUiChipSize } from './Chip.nitro';
import { NitroUiChipConfig } from './NitroUiChipConfig';

type SelectedChangeHandler = (selected: boolean, eventCount: number) => void;
type PressHandler = () => void;
type HybridRefHandler = (view: NitroUiChipHandle) => void;

/**
 * The read side of the native Chip - what a `hybridRef` callback gets.
 *
 * Deliberately read-only (DECISIONS D14), for the reason
 * `NitroUiButtonHandle` gives: a prop written here runs the native setter on the
 * JS thread and never commits. Methods that only read a cache
 * (`measureContent()`, `nuiTestStateReport()`) or hop to the UI thread
 * themselves (`nuiTestPress()`, `nuiTestProbeAccessibility()`) are safe.
 *
 * @internal Hybrid View types are not published; this alias exists so
 * `hybridRef` can be typed for this repo's harness.
 */
export interface NitroUiChipHandle {
  /** The last label React sent. */
  readonly label: string;
  /** The resolved variant (`'filter'` for anything unrecognised). */
  readonly variant: string;
  /** The controlled selection React sent, or `null` for an uncontrolled chip. */
  readonly selected: boolean | null;
  /** The last event count JS echoed back. */
  readonly mostRecentEventCount: number;
  /** Whether interaction is disabled. */
  readonly disabled: boolean;
  /** The SF Symbol name, or `null`. */
  readonly systemImage: string | null;
  /** The `androidIcon` wire string React sent, or `null`. */
  readonly androidIcon: string | null;
  /** The control's accessibility label, or `null` when it falls back to `label`. */
  readonly accessibilityLabel: string | null;
  /** The fitting size of the hosted control, in platform units. */
  measureContent(): NitroUiChipSize;
  /** Test-only: press through the tap's path (see the spec). */
  nuiTestPress(): void;
  /** Test-only: read the accessibility node on the UI thread (see the spec). */
  nuiTestProbeAccessibility(): void;
  /** Test-only: `displayed=…;probes=…;a11y=…` (see the spec). */
  nuiTestStateReport(): string;
  /** Test-only: sample this chip's pixels for `color` (see the spec). */
  nuiTestPixelProbe(color: number): void;
  /** Test-only: the last pixel probe's line (see the spec). */
  nuiTestPixelReport(): string;
}

/**
 * Props of the raw host component: **every** spec prop, always sent, with
 * callbacks in Nitro's `{ f: … }` wrapper.
 *
 * Nothing here is optional on purpose (DECISIONS D7) - `Chip.tsx` is the
 * friendly API, and it converts `undefined` into `null` so a prop can never
 * disappear between two commits (nitro#1184). The callbacks are the D7b
 * exception, and `Chip.tsx` always sends both.
 */
export interface NativeNitroUiChipProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  label: string;
  variant: string;
  selected: boolean | null;
  defaultSelected: boolean | null;
  mostRecentEventCount: number;
  disabled: boolean;
  systemImage: string | null;
  androidIcon: string | null;
  testID: string | null;
  accessibilityLabel: string | null;
  nuiPerfId: number | null;
  onSelectedChange: NitroCallbackProp<SelectedChangeHandler>;
  onPress: NitroCallbackProp<PressHandler>;
  hybridRef?: NitroCallbackProp<HybridRefHandler>;
}

/**
 * The host component for the `NitroUiChip` Hybrid View.
 *
 * The props type is corrected for the reason `NativeNitroUiButton` gives:
 * `getHostComponent`'s own intersection with `ViewProps` would make
 * `testID`/`accessibilityLabel` optional again and type the callbacks as raw
 * functions.
 */
export const NativeNitroUiChip = getHostComponent<
  NativeNitroUiChipProps,
  NitroUiChipMethods
>('NitroUiChip', () => NitroUiChipConfig) as unknown as ComponentType<
  Omit<ViewProps, 'testID' | 'accessibilityLabel'> & NativeNitroUiChipProps
>;

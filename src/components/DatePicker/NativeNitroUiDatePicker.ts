import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import {
  getHostComponent,
  type HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';
import { NitroUiDatePickerConfig } from './NitroUiDatePickerConfig';
import type {
  NitroUiDatePickerMethods,
  NitroUiDatePickerSize,
} from './DatePicker.nitro';
import type { NitroCallbackProp } from '../../core/useStableCallback';

type ChangeHandler = (millis: number, eventCount: number) => void;
type HybridRefHandler = (view: NitroUiDatePickerHandle) => void;

/**
 * The read side of the native DatePicker - what a `hybridRef` callback gets.
 *
 * Deliberately read-only (DECISIONS D14): writing `view.valueMillis = …` from JS
 * runs the native setter on the JS thread, mutates model state the UI thread
 * owns, and never commits, so the write would silently do nothing (and, for a
 * prop that decides the size, desync the size Yoga was told). Every prop goes
 * through React. Methods that only read a cache (`measureContent()`) are safe on
 * any thread, which is why those are here.
 *
 * @internal v0.1 does not publish Hybrid View types; this alias exists so
 * `hybridRef` can be typed for this repo's harness and benchmarks.
 */
export interface NitroUiDatePickerHandle {
  /** The instant React last sent, clamped to the bounds React sent, or `null`. */
  readonly valueMillis: number | null;
  /** The event count JS has echoed. */
  readonly mostRecentEventCount: number;
  /** The mode as React sent it (`'date'`, `'time'`, `'datetime'`). */
  readonly mode: string;
  /** The variant as React sent it. */
  readonly variant: string;
  /** The lower bound React sent, or `null`. */
  readonly minimumMillis: number | null;
  /** The upper bound React sent, or `null`. */
  readonly maximumMillis: number | null;
  /** Whether interaction is disabled. */
  readonly disabled: boolean;
  /** The tint as this platform's `processColor` produces it, or `null`. */
  readonly tintColor: number | null;
  /** The control's accessibility label, or `null`. */
  readonly accessibilityLabel: string | null;
  /** The fitting size of the hosted control, in platform units. */
  measureContent(): NitroUiDatePickerSize;
  /**
   * Test-only selection seam - see `NitroUiDatePickerMethods.nuiTestSelect`.
   * @internal
   */
  nuiTestSelect(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number
  ): void;
  /**
   * Test-only presentation seam - see `NitroUiDatePickerMethods.nuiTestPresent`.
   * @internal
   */
  nuiTestPresent(): void;
  /**
   * Test-only readback - see `NitroUiDatePickerMethods.nuiTestStateReport`.
   * @internal
   */
  nuiTestStateReport(): string;
}

/**
 * Props of the raw host component: **every** spec prop, always sent, with
 * callbacks in Nitro's `{ f: … }` wrapper.
 *
 * Nothing here is optional on purpose (DECISIONS D7) - `DatePicker.tsx` is the
 * friendly API, and it converts `undefined` into `null` so a prop can never
 * disappear between two commits (nitro#1184). The callback is the D7b exception,
 * and `DatePicker.tsx` always sends one.
 *
 * The two sizing props (`nuiSizingKey`, `nuiSizingId`) come from
 * [NitroUiIntrinsicProps](../../core/NitroUiIntrinsicProps.ts). For a
 * DatePicker the key is `variant|mode` and *not* the rendered date, which is the
 * decision `DatePicker.tsx`'s `sizingVariantFor` documents.
 */
export interface NativeNitroUiDatePickerProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  valueMillis: number | null;
  defaultValueMillis: number;
  mostRecentEventCount: number;
  mode: string;
  variant: string;
  minimumMillis: number | null;
  maximumMillis: number | null;
  disabled: boolean;
  tintColor: number | null;
  testID: string | null;
  accessibilityLabel: string | null;
  nuiPerfId: number | null;
  onValueChange: NitroCallbackProp<ChangeHandler>;
  hybridRef?: NitroCallbackProp<HybridRefHandler>;
}

/**
 * The host component for the `NitroUiDatePicker` Hybrid View.
 *
 * `getHostComponent`'s return type intersects the props with `ViewProps`, which
 * would make `testID`/`accessibilityLabel` optional again and type Nitro's
 * nullable callback props as raw functions. The runtime object is exactly what
 * `getHostComponent` returns; only the props type is corrected here (a
 * `ComponentType`, so `style` and the other base props still apply).
 */
export const NativeNitroUiDatePicker = getHostComponent<
  NativeNitroUiDatePickerProps,
  NitroUiDatePickerMethods
>(
  'NitroUiDatePicker',
  () => NitroUiDatePickerConfig
) as unknown as ComponentType<
  Omit<ViewProps, 'testID' | 'accessibilityLabel'> &
    NativeNitroUiDatePickerProps
>;

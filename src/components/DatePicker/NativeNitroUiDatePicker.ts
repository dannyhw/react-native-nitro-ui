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
 * What a `hybridRef` callback receives. Read-only: a write from JS would run
 * the native setter off the UI thread and never commit.
 *
 * @internal
 */
export interface NitroUiDatePickerHandle {
  /** The instant React last sent, clamped to the bounds React sent, or `null`. */
  readonly valueMillis: number | null;
  /** How many native changes JS has confirmed. */
  readonly mostRecentEventCount: number;
  /** `'date'`, `'time'` or `'datetime'`. */
  readonly mode: string;
  readonly variant: string;
  readonly minimumMillis: number | null;
  readonly maximumMillis: number | null;
  readonly disabled: boolean;
  /** The tint as this platform's `processColor` produces it, or `null`. */
  readonly tintColor: number | null;
  readonly accessibilityLabel: string | null;
  /** The fitting size of the hosted control, in platform units. */
  measureContent(): NitroUiDatePickerSize;
  /**
   * Test-only: selects a date and time.
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
   * Test-only: presents the picker.
   * @internal
   */
  nuiTestPresent(): void;
  /**
   * Test-only: reads back the picker's state.
   * @internal
   */
  nuiTestStateReport(): string;
}

/**
 * No spec prop is optional: Fabric sends `null` for a removed prop, which
 * crashes an optional one (nitro#1184).
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
 * The cast corrects only the props type: `getHostComponent` intersects the
 * props with `ViewProps`, which would make `testID` and `accessibilityLabel`
 * optional again.
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

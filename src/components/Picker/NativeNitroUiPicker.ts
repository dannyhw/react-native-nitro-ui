import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import {
  getHostComponent,
  type HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';
import type { NitroCallbackProp } from '../../core/useStableCallback';
import { NitroUiPickerConfig } from './NitroUiPickerConfig';
import type { NitroUiPickerMethods, NitroUiPickerSize } from './Picker.nitro';

type ChangeHandler = (index: number, eventCount: number) => void;
type HybridRefHandler = (view: NitroUiPickerHandle) => void;

/**
 * What a `hybridRef` callback receives. Read-only: a write from JS would run
 * the native setter off the UI thread and never commit.
 *
 * @internal
 */
export interface NitroUiPickerHandle {
  readonly options: string[];
  /** `null` while uncontrolled. */
  readonly selectedIndex: number | null;
  /** How many native changes JS has confirmed. */
  readonly mostRecentEventCount: number;
  readonly variant: string;
  readonly label: string | null;
  readonly disabled: boolean;
  /** The tint as this platform's `processColor` produces it, or `null`. */
  readonly tintColor: number | null;
  readonly accessibilityLabel: string | null;
  /** The fitting size of the hosted control, in platform units. */
  measureContent(): NitroUiPickerSize;
  /**
   * Test-only: presses the row for `index` through the same path a real row
   * press takes.
   */
  nuiTestSelect(index: number): void;
  /**
   * Test-only: the popup and its anchor as measured, as
   * `expanded=...;live=...;anchor=...;menu=...;rows=...`. iOS reports `-1` in
   * every field: a SwiftUI `Picker` keeps its menu inside the system's own
   * presentation, where it cannot be read.
   */
  nuiTestMenuReport(): string;
}

/**
 * No spec prop is optional: Fabric sends `null` for a removed prop, which
 * crashes an optional one (nitro#1184).
 */
export interface NativeNitroUiPickerProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  options: string[];
  selectedIndex: number | null;
  defaultSelectedIndex: number;
  mostRecentEventCount: number;
  variant: string;
  label: string | null;
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
export const NativeNitroUiPicker = getHostComponent<
  NativeNitroUiPickerProps,
  NitroUiPickerMethods
>('NitroUiPicker', () => NitroUiPickerConfig) as unknown as ComponentType<
  Omit<ViewProps, 'testID' | 'accessibilityLabel'> & NativeNitroUiPickerProps
>;

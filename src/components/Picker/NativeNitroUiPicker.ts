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
 * The read side of the native Picker - what a `hybridRef` callback gets.
 *
 * Deliberately read-only (DECISIONS D14): writing `view.options = […]` from JS
 * runs the native setter on the JS thread, mutates model state the UI thread
 * owns, and never commits, so the write would silently do nothing (and, because
 * `options` and the selected title decide the width, desync the size Yoga was
 * told). Every prop goes through React. Methods that only read a cache
 * (`measureContent()`) are safe on any thread, which is why that one is here.
 *
 * There is deliberately no `isExpanded()` / `setExpanded()` here: the SwiftUI
 * menu's open state is not observable from the Hybrid View, so a method that
 * reported it would answer confidently and wrongly. Whether the popup is open is
 * evidence for the real-input suite (`scripts/real-input/`), not for JS.
 *
 * H2b added the one method that does report an open state - `nuiTestMenuReport()`,
 * which reads it off the Android model as one field of a popup witness. It is not a
 * `setExpanded()`: nothing may drive a popup from JS, and on iOS the method answers
 * `-1` for exactly the reason above.
 *
 * @internal v0.1 does not publish Hybrid View types; this alias exists so
 * `hybridRef` can be typed for this repo's harness and benchmarks.
 */
export interface NitroUiPickerHandle {
  /** The choices React last sent, in order. */
  readonly options: string[];
  /** The selected index as React sent it, or `null` while uncontrolled. */
  readonly selectedIndex: number | null;
  /** The event count JS has echoed. */
  readonly mostRecentEventCount: number;
  /** `'menu'` or `'wheel'`, as normalised by the wrapper. */
  readonly variant: string;
  /** The picker's label, or `null`. */
  readonly label: string | null;
  /** Whether interaction is disabled. */
  readonly disabled: boolean;
  /** The tint as this platform's `processColor` produces it, or `null`. */
  readonly tintColor: number | null;
  /** The control's accessibility label, or `null`. */
  readonly accessibilityLabel: string | null;
  /** The fitting size of the hosted control, in platform units. */
  measureContent(): NitroUiPickerSize;
  /**
   * Test-only: press the row for `index` through the same path a real row press
   * takes. `@internal` (D14) - the harness uses it because it cannot reach a row
   * in a popup; apps must not.
   */
  nuiTestSelect(index: number): void;
  /**
   * Test-only: what the popup and its anchor are, as the composition that renders
   * them measured them - `expanded=...;live=...;anchor=...;menu=...;rows=...`.
   * `@internal` (D14).
   *
   * Android answers; iOS reports `-1` in every field, because a SwiftUI `Picker`
   * keeps its menu inside the system's own presentation and there is no window of
   * its own here to read.
   */
  nuiTestMenuReport(): string;
}

/**
 * Props of the raw host component: **every** spec prop, always sent, with
 * callbacks in Nitro's `{ f: … }` wrapper.
 *
 * Nothing here is optional on purpose (DECISIONS D7) - `Picker.tsx` is the
 * friendly API, and it converts `undefined` into `null` and a missing array into
 * `[]` so a prop can never disappear between two commits (nitro#1184). The
 * callback is the D7b exception, and `Picker.tsx` always sends one.
 *
 * The two sizing props (`nuiSizingKey`, `nuiSizingId`) come from
 * [NitroUiIntrinsicProps](../../core/NitroUiIntrinsicProps.ts). For a Picker the
 * key carries the variant, the options, the selected title and the label: a menu
 * button is as wide as the title it shows, so a new selection is a new size
 * configuration (`docs/architecture/sizing.md`).
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
 * The host component for the `NitroUiPicker` Hybrid View.
 *
 * `getHostComponent`'s return type intersects the props with `ViewProps`, which
 * would make `testID`/`accessibilityLabel` optional again and type Nitro's
 * nullable callback props as raw functions. The runtime object is exactly what
 * `getHostComponent` returns; only the props type is corrected here (a
 * `ComponentType`, so `style` and the other base props still apply).
 */
export const NativeNitroUiPicker = getHostComponent<
  NativeNitroUiPickerProps,
  NitroUiPickerMethods
>('NitroUiPicker', () => NitroUiPickerConfig) as unknown as ComponentType<
  Omit<ViewProps, 'testID' | 'accessibilityLabel'> & NativeNitroUiPickerProps
>;

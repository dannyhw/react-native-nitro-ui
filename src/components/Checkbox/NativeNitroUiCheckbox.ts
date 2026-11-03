import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import {
  getHostComponent,
  type HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';
import type { NitroCallbackProp } from '../../core/useStableCallback';
import type {
  NitroUiCheckboxMethods,
  NitroUiCheckboxSize,
} from './Checkbox.nitro';
import { NitroUiCheckboxConfig } from './NitroUiCheckboxConfig';

type CheckedChangeHandler = (checked: boolean, eventCount: number) => void;
type HybridRefHandler = (view: NitroUiCheckboxHandle) => void;

/**
 * The read side of the native Checkbox - what a `hybridRef` callback gets.
 *
 * Deliberately read-only (DECISIONS D14), for the reason
 * `NitroUiButtonHandle` gives: a prop written here runs the native setter on the
 * JS thread and never commits. Methods that only read a cache
 * (`measureContent()`, `nuiTestStateReport()`) or hop to the UI thread
 * themselves (`nuiTestToggle()`, `nuiTestProbeAccessibility()`) are safe.
 *
 * @internal Hybrid View types are not published; this alias exists so
 * `hybridRef` can be typed for this repo's harness.
 */
export interface NitroUiCheckboxHandle {
  /** The controlled checked state React sent, or `null` when uncontrolled. */
  readonly checked: boolean | null;
  /** The last event count JS echoed back. */
  readonly mostRecentEventCount: number;
  /** The label text React sent, or `null`. */
  readonly label: string | null;
  /** Whether interaction is disabled. */
  readonly disabled: boolean;
  /** The three-state display React sent, or `null` (Android only in effect). */
  readonly indeterminate: boolean | null;
  /** The control's accessibility label, or `null` when it falls back to `label`. */
  readonly accessibilityLabel: string | null;
  /** The fitting size of the hosted control, in platform units. */
  measureContent(): NitroUiCheckboxSize;
  /** Test-only: toggle through the tap's path (see the spec). */
  nuiTestToggle(): void;
  /** Test-only: read the accessibility node on the UI thread (see the spec). */
  nuiTestProbeAccessibility(): void;
  /** Test-only: `displayed=…;probes=…;merged=…;a11y=…` (see the spec). */
  nuiTestStateReport(): string;
}

/**
 * Props of the raw host component: **every** spec prop, always sent, with
 * callbacks in Nitro's `{ f: … }` wrapper.
 *
 * Nothing here is optional on purpose (DECISIONS D7) - `Checkbox.tsx` is the
 * friendly API, and it converts `undefined` into `null` so a prop can never
 * disappear between two commits (nitro#1184). The callback is the D7b exception,
 * and `Checkbox.tsx` always sends it.
 */
export interface NativeNitroUiCheckboxProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  checked: boolean | null;
  defaultChecked: boolean | null;
  indeterminate: boolean | null;
  mostRecentEventCount: number;
  label: string | null;
  disabled: boolean;
  tintColor: number | null;
  testID: string | null;
  accessibilityLabel: string | null;
  nuiPerfId: number | null;
  onCheckedChange: NitroCallbackProp<CheckedChangeHandler>;
  hybridRef?: NitroCallbackProp<HybridRefHandler>;
}

/**
 * The host component for the `NitroUiCheckbox` Hybrid View.
 *
 * The props type is corrected for the reason `NativeNitroUiButton` gives:
 * `getHostComponent`'s own intersection with `ViewProps` would make
 * `testID`/`accessibilityLabel` optional again and type the callback as a raw
 * function.
 */
export const NativeNitroUiCheckbox = getHostComponent<
  NativeNitroUiCheckboxProps,
  NitroUiCheckboxMethods
>('NitroUiCheckbox', () => NitroUiCheckboxConfig) as unknown as ComponentType<
  Omit<ViewProps, 'testID' | 'accessibilityLabel'> & NativeNitroUiCheckboxProps
>;

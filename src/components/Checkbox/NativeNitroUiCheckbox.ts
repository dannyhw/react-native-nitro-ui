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
 * Read-only: a prop written from JS runs the native setter on the JS thread and
 * never commits. The methods are safe: they read a cache (`measureContent()`,
 * `nuiTestStateReport()`) or hop to the UI thread themselves (`nuiTestToggle()`,
 * `nuiTestProbeAccessibility()`).
 *
 * @internal Hybrid View types are not published; this alias exists so
 * `hybridRef` can be typed for this repo's harness.
 */
export interface NitroUiCheckboxHandle {
  /** The controlled checked state React sent, or `null` when uncontrolled. */
  readonly checked: boolean | null;
  readonly mostRecentEventCount: number;
  readonly label: string | null;
  readonly disabled: boolean;
  readonly indeterminate: boolean | null;
  /** The iOS picture: `'circle'`, `'square'` or `'switch'`. */
  readonly iosStyle: string;
  /** The control's accessibility label, or `null` when it falls back to `label`. */
  readonly accessibilityLabel: string | null;
  /** The fitting size of the hosted control, in platform units. */
  measureContent(): NitroUiCheckboxSize;
  /** Test-only: toggle through the tap's path. */
  nuiTestToggle(): void;
  /** Test-only: read the accessibility node on the UI thread. */
  nuiTestProbeAccessibility(): void;
  /** Test-only: `displayed=…;probes=…;merged=…;a11y=…`. */
  nuiTestStateReport(): string;
}

/**
 * Props of the raw host component: every spec prop, always sent, with callbacks
 * in Nitro's `{ f: … }` wrapper. Nothing is optional, so a prop can never
 * disappear between two commits (nitro#1184); `Checkbox.tsx` turns `undefined`
 * into `null` and always sends the callback.
 */
export interface NativeNitroUiCheckboxProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  checked: boolean | null;
  defaultChecked: boolean | null;
  indeterminate: boolean | null;
  mostRecentEventCount: number;
  label: string | null;
  iosStyle: string;
  disabled: boolean;
  tintColor: number | null;
  testID: string | null;
  accessibilityLabel: string | null;
  nuiPerfId: number | null;
  onCheckedChange: NitroCallbackProp<CheckedChangeHandler>;
  hybridRef?: NitroCallbackProp<HybridRefHandler>;
}

/**
 * The host component for the `NitroUiCheckbox` Hybrid View. The cast corrects
 * only the props type: `getHostComponent` intersects it with `ViewProps`, which
 * would make `testID`/`accessibilityLabel` optional again and type the callback
 * as a raw function.
 */
export const NativeNitroUiCheckbox = getHostComponent<
  NativeNitroUiCheckboxProps,
  NitroUiCheckboxMethods
>('NitroUiCheckbox', () => NitroUiCheckboxConfig) as unknown as ComponentType<
  Omit<ViewProps, 'testID' | 'accessibilityLabel'> & NativeNitroUiCheckboxProps
>;

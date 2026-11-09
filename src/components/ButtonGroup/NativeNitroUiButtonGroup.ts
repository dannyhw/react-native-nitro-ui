import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import {
  getHostComponent,
  type HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';
import { NitroUiButtonGroupConfig } from './NitroUiButtonGroupConfig';
import type {
  NitroUiButtonGroupItem,
  NitroUiButtonGroupMethods,
  NitroUiButtonGroupSize,
} from './ButtonGroup.nitro';
import type { NitroCallbackProp } from '../../core/useStableCallback';

type PressHandler = (id: string) => void;
type CheckedChangeHandler = (
  id: string,
  checked: boolean,
  eventCount: number
) => void;
type HybridRefHandler = (view: NitroUiButtonGroupHandle) => void;

/**
 * The read side of the native ButtonGroup — what a `hybridRef` callback gets.
 *
 * Deliberately read-only (DECISIONS D14), for Button's reason: a direct write runs
 * the native setter on the JS thread, mutates model state the UI thread owns, and
 * never commits. Reading props and calling `measureContent()` is all it is for.
 *
 * @internal v0.1 does not publish Hybrid View types; this alias exists so
 * `hybridRef` can be typed for this repo's harness and benchmarks.
 */
export interface NitroUiButtonGroupHandle {
  /** The items as React sent them. */
  readonly items: NitroUiButtonGroupItem[];
  /** The resolved appearance (`'standard'` for anything unrecognised). */
  readonly appearance: string;
  /** The resolved variant. */
  readonly variant: string;
  /** The resolved size. */
  readonly size: string;
  /** The resolved label style. */
  readonly labelStyle: string;
  /** Whether the whole group is disabled. */
  readonly disabled: boolean;
  /** The tint as this platform's `processColor` produces it, or `null`. */
  readonly tintColor: number | null;
  /**
   * The group's name, as the last commit set it. `Handle` in
   * `example/__tests__/Conformance.harness.tsx` reads it because it is the one prop a
   * previous owner could leave on a recycled view that no item array rewrites.
   */
  readonly accessibilityLabel: string | null;
  /** What React last sent as the checked set (not necessarily what is drawn). */
  readonly checkedIds: string[];
  /** The ids a `checkedIds` write may move. */
  readonly controlledIds: string[];
  /** The handshake count JS has echoed back. */
  readonly mostRecentEventCount: number;
  /** The fitting size of the hosted control, in platform units. */
  measureContent(): NitroUiButtonGroupSize;
  /** Test-only: press one item through the tap's path (see the spec). */
  nuiTestPressItem(id: string): void;
  /**
   * Test-only: open the overflow menu where the platform can open one in code — Android,
   * via Material's own state. iOS's `Menu` needs a gesture (iOS 18 for the flag), so there
   * it does nothing and D29 is proved by `real-input:ios` instead (see the spec).
   */
  nuiTestOpenOverflow(): void;
  /** Test-only: read what the row laid out (see the spec). */
  nuiTestProbeRow(): void;
  /** Test-only: read the accessibility nodes (see the spec). */
  nuiTestProbeAccessibility(): void;
  /**
   * Test-only:
   * `checked=…;visible=…;overflow=…;row=…;menu=…;probes=…;a11y=…`.
   */
  nuiTestStateReport(): string;
}

/**
 * Props of the raw host component: **every** spec prop, always sent, with
 * callbacks in Nitro's `{ f: … }` wrapper.
 *
 * Nothing here is optional on purpose (DECISIONS D7) — `ButtonGroup.tsx` is the
 * friendly API, and it converts `undefined` into `null` or `[]` so a prop can
 * never disappear between two commits (nitro#1184). The two callbacks are the D7b
 * exception, and the wrapper always sends both.
 */
export interface NativeNitroUiButtonGroupProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  items: NitroUiButtonGroupItem[];
  appearance: string;
  variant: string;
  size: string;
  labelStyle: string;
  disabled: boolean;
  tintColor: number | null;
  checkedIds: string[];
  controlledIds: string[];
  defaultCheckedIds: string[];
  mostRecentEventCount: number;
  overflowAccessibilityLabel: string | null;
  accessibilityLabel: string | null;
  testID: string | null;
  nuiPerfId: number | null;
  onPress: NitroCallbackProp<PressHandler>;
  onCheckedChange: NitroCallbackProp<CheckedChangeHandler>;
  hybridRef?: NitroCallbackProp<HybridRefHandler>;
}

/**
 * The host component for the `NitroUiButtonGroup` Hybrid View.
 *
 * `getHostComponent`'s return type intersects the props with `ViewProps`, which
 * would make `testID`/`accessibilityLabel` optional again and type Nitro's
 * nullable callback props as raw functions; the runtime object is exactly what
 * `getHostComponent` returns, and only the props type is corrected here
 * (Button's and IconButton's note). `accessibilityLabel` is omitted from
 * `ViewProps` as well: RN types it as a plain `string`, and this control sends
 * `null` for "the group has no label", which is the answer a recycled view has to
 * be able to give.
 */
export const NativeNitroUiButtonGroup = getHostComponent<
  NativeNitroUiButtonGroupProps,
  NitroUiButtonGroupMethods
>(
  'NitroUiButtonGroup',
  () => NitroUiButtonGroupConfig
) as unknown as ComponentType<
  Omit<ViewProps, 'testID' | 'accessibilityLabel'> &
    NativeNitroUiButtonGroupProps
>;

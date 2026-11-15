import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import {
  getHostComponent,
  type HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';
import type { NitroCallbackProp } from '../../core/useStableCallback';
import type { NitroUiSize } from '../Switch/Switch.nitro';
import type { NitroUiListItemMethods } from './ListItem.nitro';
import { NitroUiListItemConfig } from './NitroUiListItemConfig';

type PressHandler = () => void;
type HybridRefHandler = (view: NitroUiListItemHandle) => void;

/**
 * The read side of the native ListItem — what a `hybridRef` callback gets.
 *
 * Read-only: a prop written from JS runs the native setter on the JS thread and
 * never commits. The methods are safe: they read a cache (`measureContent()`,
 * `nuiTestStateReport()`) or hop to the UI thread themselves (`nuiTestPress()`).
 *
 * @internal Hybrid View types are not published; this alias exists so `hybridRef`
 * can be typed for this repo's harness.
 */
export interface NitroUiListItemHandle {
  readonly title: string | null;
  readonly subtitle: string | null;
  readonly value: string | null;
  readonly accessory: string;
  readonly pressable: boolean;
  readonly insideRow: boolean;
  readonly disabled: boolean;
  readonly systemImage: string | null;
  readonly androidIcon: string | null;
  /** The item's accessibility label, or `null` when native reads the text. */
  readonly accessibilityLabel: string | null;
  /** The fitting size of the hosted row content, in platform units. */
  measureContent(): NitroUiSize;
  /** Test-only: press through the tap's path. */
  nuiTestPress(): void;
  /** Test-only: read the accessibility node on the UI thread. */
  nuiTestProbeAccessibility(): void;
  /** Test-only: `displayed=…;presses=…;probes=…;a11y=…`. */
  nuiTestStateReport(): string;
  /** Test-only: `insets=…;shape=…;box=…`. */
  nuiTestLayoutReport(): string;
  /** Test-only: sample this item's pixels for `color`. */
  nuiTestPixelProbe(color: number): void;
  /** Test-only: the last pixel probe's line. */
  nuiTestPixelReport(): string;
  /** Test-only: `drops=<n> recycles=<m>`. */
  nuiTestLifetimeReport(): string;
}

/**
 * Props of the raw host component: every spec prop, always sent, with callbacks
 * in Nitro's `{ f: … }` wrapper. Nothing is optional, so a prop can never
 * disappear between two commits (nitro#1184); `ListItem.tsx` turns `undefined`
 * into `null` and always sends the callback.
 */
export interface NativeNitroUiListItemProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  title: string | null;
  subtitle: string | null;
  value: string | null;
  systemImage: string | null;
  androidIcon: string | null;
  accessory: string;
  pressable: boolean;
  insideRow: boolean;
  disabled: boolean;
  testID: string | null;
  accessibilityLabel: string | null;
  nuiPerfId: number | null;
  onPress: NitroCallbackProp<PressHandler>;
  hybridRef?: NitroCallbackProp<HybridRefHandler>;
}

/**
 * The host component for the `NitroUiListItem` Hybrid View. The cast corrects
 * only the props type: `getHostComponent` intersects it with `ViewProps`, which
 * would make `testID`/`accessibilityLabel` optional again and type the callback
 * as a raw function.
 */
export const NativeNitroUiListItem = getHostComponent<
  NativeNitroUiListItemProps,
  NitroUiListItemMethods
>('NitroUiListItem', () => NitroUiListItemConfig) as unknown as ComponentType<
  Omit<ViewProps, 'testID' | 'accessibilityLabel'> & NativeNitroUiListItemProps
>;

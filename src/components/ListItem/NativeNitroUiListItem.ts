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
 * Deliberately read-only (DECISIONS D14), for the reason `NitroUiButtonHandle`
 * gives: a prop written here runs the native setter on the JS thread and never
 * commits. Methods that only read a cache (`measureContent()`,
 * `nuiTestStateReport()`) or hop to the UI thread themselves (`nuiTestPress()`)
 * are safe.
 *
 * @internal Hybrid View types are not published; this alias exists so `hybridRef`
 * can be typed for this repo's harness.
 */
export interface NitroUiListItemHandle {
  /** The headline text React sent, or `null`. */
  readonly title: string | null;
  /** The supporting line React sent, or `null`. */
  readonly subtitle: string | null;
  /** The trailing value React sent, or `null`. */
  readonly value: string | null;
  /** The resolved accessory (`'none'` for anything unrecognised). */
  readonly accessory: string;
  /** Whether the item is wired to `onPress`. */
  readonly pressable: boolean;
  /** Whether the item is drawn inside a `Form.Row`. */
  readonly insideRow: boolean;
  /** Whether interaction is disabled. */
  readonly disabled: boolean;
  /** The SF Symbol name, or `null`. */
  readonly systemImage: string | null;
  /** The `androidIcon` wire string React sent, or `null`. */
  readonly androidIcon: string | null;
  /** The item's accessibility label, or `null` when native reads the text. */
  readonly accessibilityLabel: string | null;
  /** The fitting size of the hosted row content, in platform units. */
  measureContent(): NitroUiSize;
  /** Test-only: press through the tap's path (see the spec). */
  nuiTestPress(): void;
  /** Test-only: read the accessibility node on the UI thread (see the spec). */
  nuiTestProbeAccessibility(): void;
  /** Test-only: `displayed=…;presses=…;probes=…;a11y=…` (see the spec). */
  nuiTestStateReport(): string;
  /** Test-only: `insets=…;shape=…;box=…` (see the spec). */
  nuiTestLayoutReport(): string;
  /** Test-only: sample this item's pixels for `color` (see the spec). */
  nuiTestPixelProbe(color: number): void;
  /** Test-only: the last pixel probe's line (see the spec). */
  nuiTestPixelReport(): string;
  /** Test-only: `drops=<n> recycles=<m>` (see the spec). */
  nuiTestLifetimeReport(): string;
}

/**
 * Props of the raw host component: **every** spec prop, always sent, with
 * callbacks in Nitro's `{ f: … }` wrapper.
 *
 * Nothing here is optional on purpose (DECISIONS D7) — `ListItem.tsx` is the
 * friendly API, and it converts `undefined` into `null` so a prop can never
 * disappear between two commits (nitro#1184). The callback is the D7b exception,
 * and `ListItem.tsx` always sends it.
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
 * The host component for the `NitroUiListItem` Hybrid View.
 *
 * The props type is corrected for the reason `NativeNitroUiButton` gives:
 * `getHostComponent`'s own intersection with `ViewProps` would make
 * `testID`/`accessibilityLabel` optional again and type the callback as a raw
 * function.
 */
export const NativeNitroUiListItem = getHostComponent<
  NativeNitroUiListItemProps,
  NitroUiListItemMethods
>('NitroUiListItem', () => NitroUiListItemConfig) as unknown as ComponentType<
  Omit<ViewProps, 'testID' | 'accessibilityLabel'> & NativeNitroUiListItemProps
>;

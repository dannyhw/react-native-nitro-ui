import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import {
  getHostComponent,
  type HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';
import { NitroUiMenuConfig } from './NitroUiMenuConfig';
import type { NitroUiMenuMethods, NitroUiMenuRow } from './Menu.nitro';
import type { NitroCallbackProp } from '../../core/useStableCallback';

type SelectHandler = (id: string) => void;
type VoidHandler = () => void;
type HybridRefHandler = (view: NitroUiMenuHandle) => void;

/**
 * The read side of the native Menu - what a `hybridRef` callback gets.
 *
 * Deliberately read-only (DECISIONS D14): writing `view.title = ...` from JS runs
 * the native setter on the JS thread, mutates model state the UI thread owns, and
 * never commits, so the write would silently do nothing (and, for a size-affecting
 * prop, desync the size Yoga was told). Every prop goes through React. Methods that
 * only read a cache (`measureContent()`) are safe from any thread, which is why
 * those are here too.
 *
 * There is no `expanded`: the open state is native-owned (D29), and the popup
 * witness below is the test-only seam that reads it.
 *
 * @internal v0.1 does not publish Hybrid View types; this alias exists so
 * `hybridRef` can be typed for this repo's harness and benchmarks.
 */
export interface NitroUiMenuHandle {
  /** The last trigger title React sent. */
  readonly title: string;
  /** The resolved variant (`'filled'` for anything unrecognised). */
  readonly variant: string;
  /** The resolved size. */
  readonly size: string;
  /** Whether interaction is disabled. */
  readonly disabled: boolean;
  /** The tint as this platform's `processColor` produces it, or `null`. */
  readonly tintColor: number | null;
  /** The SF Symbol name, or `null`. */
  readonly systemImage: string | null;
  /** The control's accessibility label, or `null` when it falls back to `title`. */
  readonly accessibilityLabel: string | null;
  /** The fitting size of the hosted control, in platform units. */
  measureContent(): { width: number; height: number };
  /**
   * Test-only (`@internal`, D14): press the row `id` through the same path a real
   * row press takes - the disabled guards, the report, and on Android the closing
   * of the popup. The harness cannot reach a row in a popup (it is not in the app's
   * window), so this is how a *real* pick gets tested; see `scripts/real-input/`
   * for the same pick done with a real tap.
   */
  nuiTestSelectRow(id: string): void;
  /**
   * Test-only (`@internal`, D14): the popup witness -
   * `expanded=…;live=…;anchor=…;menu=…;rows=…;drawn=…`, per `Menu.nitro.ts`.
   */
  nuiTestMenuReport(): string;
  /**
   * Test-only (`@internal`, D14): on iOS, read the `UIMenu` UIKit built from the
   * rows into the witness's `drawn` field (it opens and closes the menu to do it);
   * a no-op on Android. Per `Menu.nitro.ts`.
   */
  nuiTestMenuProbe(): void;
}

/**
 * Props of the raw host component: **every** spec prop, always sent, with
 * callbacks in Nitro's `{ f: ... }` wrapper.
 *
 * Nothing here is optional on purpose (DECISIONS D7) - `Menu.tsx` is the friendly
 * API, and it converts `undefined` into `null` so a prop can never disappear
 * between two commits (nitro#1184). The four callbacks are the D7b exception, and
 * `Menu.tsx` always sends all four.
 *
 * The two sizing props (`nuiSizingKey`, `nuiSizingId`) come from
 * [NitroUiIntrinsicProps](../../core/NitroUiIntrinsicProps.ts). For a Menu the key
 * is Button's: the trigger is the only part of the control that is laid out, and
 * the items live in a popup.
 */
export interface NativeNitroUiMenuProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  title: string;
  variant: string;
  size: string;
  disabled: boolean;
  rows: NitroUiMenuRow[];
  tintColor: number | null;
  systemImage: string | null;
  hasPrimaryAction: boolean;
  testID: string | null;
  accessibilityLabel: string | null;
  nuiPerfId: number | null;
  onSelect: NitroCallbackProp<SelectHandler>;
  onOpen: NitroCallbackProp<VoidHandler>;
  onClose: NitroCallbackProp<VoidHandler>;
  primaryAction: NitroCallbackProp<VoidHandler>;
  hybridRef?: NitroCallbackProp<HybridRefHandler>;
}

/**
 * The host component for the `NitroUiMenu` Hybrid View.
 *
 * `getHostComponent`'s return type intersects the props with `ViewProps`, which
 * would make `testID`/`accessibilityLabel` optional again and type Nitro's
 * nullable callback props as raw functions. The runtime object is exactly what
 * `getHostComponent` returns; only the props type is corrected here (a
 * `ComponentType`, so `style` and the other base props still apply).
 */
export const NativeNitroUiMenu = getHostComponent<
  NativeNitroUiMenuProps,
  NitroUiMenuMethods
>('NitroUiMenu', () => NitroUiMenuConfig) as unknown as ComponentType<
  Omit<ViewProps, 'testID' | 'accessibilityLabel'> & NativeNitroUiMenuProps
>;

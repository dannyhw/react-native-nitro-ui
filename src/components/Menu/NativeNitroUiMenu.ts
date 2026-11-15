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
 * Read-only: a prop written from JS runs the native setter on the JS thread and
 * never commits. Methods that only read a cache (`measureContent()`) are safe
 * from any thread.
 *
 * There is no `expanded`: native owns the open state, and the test-only report
 * below reads it.
 *
 * @internal Hybrid View types are not published; this alias exists so
 * `hybridRef` can be typed for this repo's harness and benchmarks.
 */
export interface NitroUiMenuHandle {
  readonly title: string;
  readonly variant: string;
  readonly size: string;
  readonly disabled: boolean;
  readonly tintColor: number | null;
  readonly systemImage: string | null;
  readonly androidIcon: string | null;
  /** The control's accessibility label, or `null` when it falls back to `title`. */
  readonly accessibilityLabel: string | null;
  /** The fitting size of the hosted control, in platform units. */
  measureContent(): { width: number; height: number };
  /**
   * Test-only: press the row `id` through the path a real row press takes. A
   * popup's rows are outside the app's window, so a test cannot reach them
   * otherwise.
   */
  nuiTestSelectRow(id: string): void;
  /** Test-only: the popup's state, as `expanded=…;live=…;anchor=…;menu=…;rows=…;drawn=…`. */
  nuiTestMenuReport(): string;
  /**
   * Test-only: on iOS, read the `UIMenu` UIKit built from the rows into the
   * report's `drawn` field, which opens and closes the menu. A no-op on Android.
   */
  nuiTestMenuProbe(): void;
  /** Test-only: sample this control's trigger for `color`. iOS answers `no pixels`. */
  nuiTestPixelProbe(color: number): void;
  /** Test-only: what that probe found. */
  nuiTestPixelReport(): string;
  /**
   * Test-only: sample the open menu's window for `color`. Android refuses with
   * `no popup` when this mount has none composed; iOS answers `no pixels`.
   */
  nuiTestMenuPixelProbe(color: number): void;
  /** Test-only: what that probe found. */
  nuiTestMenuPixelReport(): string;
}

/**
 * Props of the raw host component: every spec prop, always sent, with callbacks
 * in Nitro's `{ f: ... }` wrapper. Nothing is optional, so a prop can never
 * disappear between two commits (nitro#1184); `Menu.tsx` turns `undefined` into
 * `null` and always sends all four callbacks.
 *
 * The sizing key is Button's: only the trigger is laid out, and the items live
 * in a popup.
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
  androidIcon: string | null;
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
 * The host component for the `NitroUiMenu` Hybrid View. The cast corrects only
 * the props type: `getHostComponent` intersects it with `ViewProps`, which would
 * make `testID`/`accessibilityLabel` optional again and type the callback props
 * as raw functions.
 */
export const NativeNitroUiMenu = getHostComponent<
  NativeNitroUiMenuProps,
  NitroUiMenuMethods
>('NitroUiMenu', () => NitroUiMenuConfig) as unknown as ComponentType<
  Omit<ViewProps, 'testID' | 'accessibilityLabel'> & NativeNitroUiMenuProps
>;

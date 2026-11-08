import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import {
  getHostComponent,
  type HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';
import { NitroUiIconButtonConfig } from './NitroUiIconButtonConfig';
import type {
  NitroUiIconButtonMethods,
  NitroUiIconButtonSize,
} from './IconButton.nitro';
import type { NitroCallbackProp } from '../../core/useStableCallback';

type PressHandler = () => void;
type CheckedChangeHandler = (checked: boolean, eventCount: number) => void;
type HybridRefHandler = (view: NitroUiIconButtonHandle) => void;

/**
 * The read side of the native IconButton — what a `hybridRef` callback gets.
 *
 * Deliberately read-only (DECISIONS D14), for Button's reason: a direct write
 * runs the native setter on the JS thread, mutates model state the UI thread
 * owns, and never commits. Reading props and calling `measureContent()` is all
 * it is for.
 *
 * @internal v0.1 does not publish Hybrid View types; this alias exists so
 * `hybridRef` can be typed for this repo's harness and benchmarks.
 */
export interface NitroUiIconButtonHandle {
  /** The control's accessibility label — its only name. */
  readonly accessibilityLabel: string;
  /** The SF Symbol name, or `null`. */
  readonly systemImage: string | null;
  /** The resolved Android icon string, or `null`. */
  readonly androidIcon: string | null;
  /** The resolved variant (`'standard'` for anything unrecognised). */
  readonly variant: string;
  /** The resolved size. */
  readonly size: string;
  /** The resolved width option. */
  readonly width: string;
  /** The resolved corner shape (`'round'` for anything unrecognised). */
  readonly shape: string;
  /** Whether interaction is disabled. */
  readonly disabled: boolean;
  /** The tint as this platform's `processColor` produces it, or `null`. */
  readonly tintColor: number | null;
  /** What React last sent as `checked`, or `null` for the press form. */
  readonly checked: boolean | null;
  /** The handshake count JS has echoed back. */
  readonly mostRecentEventCount: number;
  /** The fitting size of the hosted control, in platform units. */
  measureContent(): NitroUiIconButtonSize;
  /** Test-only: press through the tap's path (see the spec). */
  nuiTestPress(): void;
  /** Test-only: read the accessibility node on the UI thread (see the spec). */
  nuiTestProbeAccessibility(): void;
  /** Test-only: `displayed=…;probes=…;a11y=…` (see the spec). */
  nuiTestStateReport(): string;
  /** Test-only: ask whether `color` is among the pixels this control drew. */
  nuiTestPixelProbe(color: number): void;
  /** Test-only: the last probe's line (see the spec). */
  nuiTestPixelReport(): string;
}

/**
 * Props of the raw host component: **every** spec prop, always sent, with
 * callbacks in Nitro's `{ f: … }` wrapper.
 *
 * Nothing here is optional on purpose (DECISIONS D7) — `IconButton.tsx` is the
 * friendly API, and it converts `undefined` into `null` so a prop can never
 * disappear between two commits (nitro#1184). The two callbacks are the D7b
 * exception, and the wrapper always sends both, whichever form is showing.
 */
export interface NativeNitroUiIconButtonProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  accessibilityLabel: string;
  systemImage: string | null;
  androidIcon: string | null;
  variant: string;
  size: string;
  width: string;
  shape: string;
  disabled: boolean;
  tintColor: number | null;
  checked: boolean | null;
  defaultChecked: boolean | null;
  mostRecentEventCount: number;
  testID: string | null;
  nuiPerfId: number | null;
  onPress: NitroCallbackProp<PressHandler>;
  onCheckedChange: NitroCallbackProp<CheckedChangeHandler>;
  hybridRef?: NitroCallbackProp<HybridRefHandler>;
}

/**
 * The host component for the `NitroUiIconButton` Hybrid View.
 *
 * `getHostComponent`'s return type intersects the props with `ViewProps`, which
 * would make `testID`/`accessibilityLabel` optional again and type Nitro's
 * nullable callback props as raw functions; the runtime object is exactly what
 * `getHostComponent` returns, and only the props type is corrected here. Unlike
 * `Button`, `accessibilityLabel` stays **required** through the cast: it is the
 * control's only name, and a missing one is the bug this type exists to prevent.
 */
export const NativeNitroUiIconButton = getHostComponent<
  NativeNitroUiIconButtonProps,
  NitroUiIconButtonMethods
>(
  'NitroUiIconButton',
  () => NitroUiIconButtonConfig
) as unknown as ComponentType<
  Omit<ViewProps, 'testID' | 'accessibilityLabel'> &
    NativeNitroUiIconButtonProps
>;

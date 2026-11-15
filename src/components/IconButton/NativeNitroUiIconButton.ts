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
 * What a `hybridRef` callback receives. Read-only: a write from JS would run
 * the native setter off the UI thread and never commit.
 *
 * @internal
 */
export interface NitroUiIconButtonHandle {
  readonly accessibilityLabel: string;
  /** The SF Symbol name, or `null`. */
  readonly systemImage: string | null;
  readonly androidIcon: string | null;
  /** `'standard'` for anything unrecognised. */
  readonly variant: string;
  readonly size: string;
  readonly width: string;
  /** `'round'` for anything unrecognised. */
  readonly shape: string;
  readonly disabled: boolean;
  /** The tint as this platform's `processColor` produces it, or `null`. */
  readonly tintColor: number | null;
  /** What React last sent as `checked`, or `null` for the press form. */
  readonly checked: boolean | null;
  /** How many native changes JS has confirmed. */
  readonly mostRecentEventCount: number;
  /** The fitting size of the hosted control, in platform units. */
  measureContent(): NitroUiIconButtonSize;
  /** Test-only: presses through the tap's path. */
  nuiTestPress(): void;
  /** Test-only: reads the accessibility node on the UI thread. */
  nuiTestProbeAccessibility(): void;
  /** Test-only: `displayed=…;probes=…;a11y=…`. */
  nuiTestStateReport(): string;
  /** Test-only: asks whether `color` is among the pixels this control drew. */
  nuiTestPixelProbe(color: number): void;
  /** Test-only: the last pixel probe's line. */
  nuiTestPixelReport(): string;
}

/**
 * No spec prop is optional: Fabric sends `null` for a removed prop, which
 * crashes an optional one (nitro#1184).
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
 * The cast corrects only the props type: `getHostComponent` intersects the
 * props with `ViewProps`, which would make `testID` and `accessibilityLabel`
 * (the control's only name) optional again.
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

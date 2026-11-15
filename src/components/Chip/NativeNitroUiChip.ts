import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import {
  getHostComponent,
  type HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';
import type { NitroCallbackProp } from '../../core/useStableCallback';
import type { NitroUiChipMethods, NitroUiChipSize } from './Chip.nitro';
import { NitroUiChipConfig } from './NitroUiChipConfig';

type SelectedChangeHandler = (selected: boolean, eventCount: number) => void;
type PressHandler = () => void;
type HybridRefHandler = (view: NitroUiChipHandle) => void;

/**
 * What a `hybridRef` callback receives. Read-only: a write from JS would run
 * the native setter off the UI thread and never commit.
 *
 * @internal
 */
export interface NitroUiChipHandle {
  readonly label: string;
  /** `'filter'` for anything unrecognised. */
  readonly variant: string;
  /** `null` for an uncontrolled chip. */
  readonly selected: boolean | null;
  /** How many native changes JS has confirmed. */
  readonly mostRecentEventCount: number;
  readonly disabled: boolean;
  /** The SF Symbol name, or `null`. */
  readonly systemImage: string | null;
  readonly androidIcon: string | null;
  /** `null` when it falls back to `label`. */
  readonly accessibilityLabel: string | null;
  /** The fitting size of the hosted control, in platform units. */
  measureContent(): NitroUiChipSize;
  /** Test-only: presses through the tap's path. */
  nuiTestPress(): void;
  /** Test-only: reads the accessibility node on the UI thread. */
  nuiTestProbeAccessibility(): void;
  /** Test-only: `displayed=…;probes=…;a11y=…`. */
  nuiTestStateReport(): string;
  /** Test-only: samples this chip's pixels for `color`. */
  nuiTestPixelProbe(color: number): void;
  /** Test-only: the last pixel probe's line. */
  nuiTestPixelReport(): string;
}

/**
 * No spec prop is optional: Fabric sends `null` for a removed prop, which
 * crashes an optional one (nitro#1184).
 */
export interface NativeNitroUiChipProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  label: string;
  variant: string;
  selected: boolean | null;
  defaultSelected: boolean | null;
  mostRecentEventCount: number;
  disabled: boolean;
  systemImage: string | null;
  androidIcon: string | null;
  testID: string | null;
  accessibilityLabel: string | null;
  nuiPerfId: number | null;
  onSelectedChange: NitroCallbackProp<SelectedChangeHandler>;
  onPress: NitroCallbackProp<PressHandler>;
  hybridRef?: NitroCallbackProp<HybridRefHandler>;
}

/**
 * The cast corrects only the props type: `getHostComponent` intersects the
 * props with `ViewProps`, which would make `testID` and `accessibilityLabel`
 * optional again.
 */
export const NativeNitroUiChip = getHostComponent<
  NativeNitroUiChipProps,
  NitroUiChipMethods
>('NitroUiChip', () => NitroUiChipConfig) as unknown as ComponentType<
  Omit<ViewProps, 'testID' | 'accessibilityLabel'> & NativeNitroUiChipProps
>;

import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import {
  getHostComponent,
  type HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';
import type { NitroCallbackProp } from '../../core/useStableCallback';
import type {
  NitroUiStepperMethods,
  NitroUiStepperSize,
} from './Stepper.nitro';
import { NitroUiStepperConfig } from './NitroUiStepperConfig';

type ChangeHandler = (value: number, eventCount: number) => void;
type HybridRefHandler = (view: NitroUiStepperHandle) => void;

/**
 * What a `hybridRef` callback receives. Read-only: a write from JS would run
 * the native setter off the UI thread and never commit.
 *
 * @internal
 */
export interface NitroUiStepperHandle {
  /** `null` while uncontrolled. */
  readonly value: number | null;
  /** How many native changes JS has confirmed. */
  readonly mostRecentEventCount: number;
  readonly minimumValue: number;
  readonly maximumValue: number;
  readonly step: number;
  readonly disabled: boolean;
  readonly accessibilityLabel: string | null;
  /** The fitting size of the hosted control, in platform units. */
  measureContent(): NitroUiStepperSize;
  /** Test-only: one step through the tap's path. */
  nuiTestStep(direction: number): void;
  /** Test-only: performs the screen reader's adjust action. */
  nuiTestAccessibilityStep(direction: number): void;
  /** Test-only: what the last screen-reader adjust action did. */
  nuiTestAccessibilityStepReport(): string;
  /** Test-only: reads the accessibility node on the UI thread. */
  nuiTestProbeAccessibility(): void;
  /** Test-only: asks whether `color` is among the pixels the control draws. */
  nuiTestPixelProbe(color: number): void;
  /** Test-only: what the last pixel probe found. */
  nuiTestPixelReport(): string;
  /** Test-only: `displayed=…;probes=…;merged=…;a11y=…`. */
  nuiTestStateReport(): string;
}

/**
 * No spec prop is optional: Fabric sends `null` for a removed prop, which
 * crashes an optional one (nitro#1184).
 */
export interface NativeNitroUiStepperProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  value: number | null;
  defaultValue: number | null;
  mostRecentEventCount: number;
  minimumValue: number;
  maximumValue: number;
  step: number;
  disabled: boolean;
  testID: string | null;
  accessibilityLabel: string | null;
  nuiPerfId: number | null;
  onValueChange: NitroCallbackProp<ChangeHandler>;
  hybridRef?: NitroCallbackProp<HybridRefHandler>;
}

/**
 * The cast corrects only the props type: `getHostComponent` intersects the
 * props with `ViewProps`, which would make `testID` and `accessibilityLabel`
 * optional again.
 */
export const NativeNitroUiStepper = getHostComponent<
  NativeNitroUiStepperProps,
  NitroUiStepperMethods
>('NitroUiStepper', () => NitroUiStepperConfig) as unknown as ComponentType<
  Omit<ViewProps, 'testID' | 'accessibilityLabel'> & NativeNitroUiStepperProps
>;

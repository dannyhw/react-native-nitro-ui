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
 * The read side of the native Stepper - what a `hybridRef` callback gets.
 *
 * Deliberately read-only (DECISIONS D14), for the reason
 * `NitroUiCheckboxHandle` gives: a prop written here runs the native setter on the
 * JS thread, mutates model state the UI thread owns and never commits. Methods that
 * only read a cache (`measureContent()`, `nuiTestStateReport()`) or hop to the UI
 * thread themselves (`nuiTestStep()`, `nuiTestProbeAccessibility()`) are safe.
 *
 * @internal Hybrid View types are not published; this alias exists so
 * `hybridRef` can be typed for this repo's harness and benchmarks.
 */
export interface NitroUiStepperHandle {
  /** The controlled value React sent, or `null` when uncontrolled. */
  readonly value: number | null;
  /** The last event count JS echoed back. */
  readonly mostRecentEventCount: number;
  /** The lower bound React sent. */
  readonly minimumValue: number;
  /** The upper bound React sent. */
  readonly maximumValue: number;
  /** The step React sent. */
  readonly step: number;
  /** Whether interaction is disabled. */
  readonly disabled: boolean;
  /** The control's accessibility label, or `null`. */
  readonly accessibilityLabel: string | null;
  /** The fitting size of the hosted control, in platform units. */
  measureContent(): NitroUiStepperSize;
  /** Test-only: one step through the tap's path (see the spec). */
  nuiTestStep(direction: number): void;
  /** Test-only: perform the reader's adjust action (see the spec). */
  nuiTestAccessibilityStep(direction: number): void;
  /** Test-only: what the last reader's adjust action did (see the spec). */
  nuiTestAccessibilityStepReport(): string;
  /** Test-only: read the accessibility node on the UI thread (see the spec). */
  nuiTestProbeAccessibility(): void;
  /** Test-only: is this colour among the pixels the control draws (see the spec). */
  nuiTestPixelProbe(color: number): void;
  /** Test-only: what the last pixel probe found (see the spec). */
  nuiTestPixelReport(): string;
  /** Test-only: `displayed=…;probes=…;merged=…;a11y=…` (see the spec). */
  nuiTestStateReport(): string;
}

/**
 * Props of the raw host component: **every** spec prop, always sent, with the
 * callback in Nitro's `{ f: … }` wrapper.
 *
 * Nothing here is optional on purpose (DECISIONS D7) - `Stepper.tsx` is the
 * friendly API, and it converts `undefined` into `null` so a prop can never
 * disappear between two commits (nitro#1184). The callback is the D7b exception,
 * and `Stepper.tsx` always sends it.
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
 * The host component for the `NitroUiStepper` Hybrid View.
 *
 * The props type is corrected for the reason `NativeNitroUiButton` gives:
 * `getHostComponent`'s own intersection with `ViewProps` would make
 * `testID`/`accessibilityLabel` optional again and type the callback as a raw
 * function.
 */
export const NativeNitroUiStepper = getHostComponent<
  NativeNitroUiStepperProps,
  NitroUiStepperMethods
>('NitroUiStepper', () => NitroUiStepperConfig) as unknown as ComponentType<
  Omit<ViewProps, 'testID' | 'accessibilityLabel'> & NativeNitroUiStepperProps
>;

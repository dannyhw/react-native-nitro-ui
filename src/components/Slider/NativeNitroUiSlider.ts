import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import {
  getHostComponent,
  type HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';
import { NitroUiSliderConfig } from './NitroUiSliderConfig';
import type { NitroUiSliderMethods, NitroUiSliderSize } from './Slider.nitro';
import type { NitroCallbackProp } from '../../core/useStableCallback';

type ChangeHandler = (value: number, eventCount: number) => void;
type HybridRefHandler = (view: NitroUiSliderHandle) => void;

/**
 * What a `hybridRef` callback receives. Read-only: a write from JS would run
 * the native setter off the UI thread and never commit.
 *
 * @internal
 */
export interface NitroUiSliderHandle {
  /** `null` while uncontrolled. */
  readonly value: number | null;
  /** How many native changes JS has confirmed. */
  readonly mostRecentEventCount: number;
  readonly disabled: boolean;
  /** The tint as this platform's `processColor` produces it, or `null`. */
  readonly tintColor: number | null;
  readonly accessibilityLabel: string | null;
  /** The fitting size of the hosted control, in platform units. */
  measureContent(): NitroUiSliderSize;
  /** Test-only: drags the thumb. */
  nuiTestDrag(to: number, steps: number, msPerStep: number): void;
  /** Test-only: performs one accessibility step. */
  nuiTestAccessibilityStep(direction: number): void;
  /** Test-only: what the last accessibility step did. */
  nuiTestAccessibilityStepReport(): string;
  /** Test-only: whether the drag's frame pump is still armed. */
  nuiTestFramePumpArmed(): boolean;
  /** Test-only: injects a pointer stream. */
  nuiTestPointerStream(mode: number): void;
  /** Test-only: what the last injected stream did. */
  nuiTestPointerStreamReport(): string;
}

/**
 * No spec prop is optional: Fabric sends `null` for a removed prop, which
 * crashes an optional one (nitro#1184).
 */
export interface NativeNitroUiSliderProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  value: number | null;
  defaultValue: number | null;
  mostRecentEventCount: number;
  minimumValue: number;
  maximumValue: number;
  step: number;
  disabled: boolean;
  tintColor: number | null;
  testID: string | null;
  accessibilityLabel: string | null;
  nuiPerfId: number | null;
  onValueChange: NitroCallbackProp<ChangeHandler>;
  onSlidingStart: NitroCallbackProp<ChangeHandler>;
  onSlidingComplete: NitroCallbackProp<ChangeHandler>;
  hybridRef?: NitroCallbackProp<HybridRefHandler>;
}

/**
 * The cast corrects only the props type: `getHostComponent` intersects the
 * props with `ViewProps`, which would make `testID` and `accessibilityLabel`
 * optional again.
 */
export const NativeNitroUiSlider = getHostComponent<
  NativeNitroUiSliderProps,
  NitroUiSliderMethods
>('NitroUiSlider', () => NitroUiSliderConfig) as unknown as ComponentType<
  Omit<ViewProps, 'testID' | 'accessibilityLabel'> & NativeNitroUiSliderProps
>;

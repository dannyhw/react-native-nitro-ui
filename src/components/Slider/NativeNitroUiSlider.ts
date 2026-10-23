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
 * The read side of the native Slider - what a `hybridRef` callback gets.
 *
 * Read-only like `NitroUiSwitchHandle` (DECISIONS D14): a prop write here runs
 * the native setter on the JS thread, mutates model state the UI thread owns and
 * never commits. `measureContent()` is a cached value and safe from any thread.
 *
 * `nuiTestDrag` is the one exception to "read only", and it is a test seam, not
 * an API: it is a *method*, it hops to the main thread itself, and it is what
 * lets the harness exercise a drag (see `Slider.nitro.ts`).
 *
 * @internal v0.1 does not publish Hybrid View types; this alias exists so
 * `hybridRef` can be typed for this repo's harness and benchmarks.
 */
export interface NitroUiSliderHandle {
  /** The last `value` React sent, or `null` while uncontrolled. */
  readonly value: number | null;
  /** How many native changes JS has confirmed. */
  readonly mostRecentEventCount: number;
  /** Whether interaction is disabled. */
  readonly disabled: boolean;
  /** The tint as this platform's `processColor` produces it, or `null`. */
  readonly tintColor: number | null;
  /** The control's accessibility label, or `null`. */
  readonly accessibilityLabel: string | null;
  /** The fitting size of the hosted control, in platform units. */
  measureContent(): NitroUiSliderSize;
  /** Test-only drag - see `NitroUiSliderMethods.nuiTestDrag`. */
  nuiTestDrag(to: number, steps: number, msPerStep: number): void;
}

/**
 * Props of the raw host component: **every** spec prop, always sent, with
 * callbacks in Nitro's `{ f: … }` wrapper.
 *
 * Nothing here is optional on purpose (DECISIONS D7) - `Slider.tsx` is the
 * friendly API, and it converts `undefined` into `null` so a prop can never
 * disappear between two commits (nitro#1184).
 */
/**
 * The two sizing props (`nuiSizingKey`, `nuiSizingId`) come from
 * [NitroUiIntrinsicProps](../../core/NitroUiIntrinsicProps.ts), like every other
 * self-sizing component's native props.
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
 * The host component for the `NitroUiSlider` Hybrid View.
 *
 * `getHostComponent`'s return type intersects the props with `ViewProps`, which
 * would make `testID`/`accessibilityLabel` optional again and type Nitro's
 * nullable callback props as raw functions. The runtime object is exactly what
 * `getHostComponent` returns; only the props type is corrected here (a
 * `ComponentType`, so `style` and the other base props still apply).
 */
export const NativeNitroUiSlider = getHostComponent<
  NativeNitroUiSliderProps,
  NitroUiSliderMethods
>('NitroUiSlider', () => NitroUiSliderConfig) as unknown as ComponentType<
  Omit<ViewProps, 'testID' | 'accessibilityLabel'> & NativeNitroUiSliderProps
>;

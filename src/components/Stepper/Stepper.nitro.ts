import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';

/**
 * Native props of the `NitroUiStepper` Hybrid View.
 *
 * No prop is optional except the callback: a removed prop arrives as `null`,
 * which crashes an optional one (nitro#1184), and Nitro only unwraps a callback
 * prop whose type is a plain function. The wrapper always sends every prop.
 *
 * The value uses the event-count handshake: native displays a step at once,
 * emits `(value, eventCount)`, and accepts a `value` write only once it has seen
 * that many of its own events.
 */
export interface NitroUiStepperProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  /** Controlled value, or `null` for an uncontrolled Stepper. */
  value: number | null;
  /** Initial value of an uncontrolled Stepper; ignored while `value` is set. */
  defaultValue: number | null;
  /**
   * The last event count JS has fully processed. Native accepts a `value` write
   * only once it has seen this many of its own events.
   */
  mostRecentEventCount: number;
  minimumValue: number;
  maximumValue: number;
  /**
   * Increment the value snaps to. The wrapper requires it to be greater than
   * `0`; to the quantiser shared with Slider, `0` would mean continuous.
   */
  step: number;
  disabled: boolean;
  testID: string | null;
  /** Names the control. The control announces its value itself. */
  accessibilityLabel: string | null;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
  /** Once per step, with the value native now displays. */
  onValueChange?: (value: number, eventCount: number) => void;
}

export interface NitroUiStepperMethods extends HybridViewMethods {
  /**
   * The size of the hosted control as of the last layout. It returns a cached
   * value, so it is safe to call from the JS thread.
   */
  measureContent(): NitroUiStepperSize;

  /**
   * Test-only: take one step through the path a tap takes, `+1` up or `-1` down.
   * Returns at once; observe the step through `onValueChange` and
   * `nuiTestStateReport`. A step past either end reports nothing, as a tap on
   * the disabled half does.
   *
   * @internal Not app API.
   */
  nuiTestStep(direction: number): void;

  /**
   * Test-only: perform the screen reader's adjust action (iOS
   * `accessibilityIncrement`/`accessibilityDecrement`, Android's `SetProgress`
   * on the merged semantics node) and keep the answer for
   * `nuiTestAccessibilityStepReport`. Returns at once. Unlike `nuiTestStep`, it
   * goes through the accessibility tree and never falls back to the control.
   *
   * @internal Not app API.
   */
  nuiTestAccessibilityStep(direction: number): void;

  /**
   * Test-only: what the last `nuiTestAccessibilityStep` did, as one line: the
   * element or node it found, the value before and after, and whether the reader
   * is told the control is disabled. Same shape on both platforms.
   *
   * @internal Not app API.
   */
  nuiTestAccessibilityStepReport(): string;

  /**
   * Test-only: read the control's accessibility node on the UI thread and keep
   * the answer for `nuiTestStateReport`. Returns at once.
   *
   * iOS reports the element this view vends to UIKit (traits, label and value).
   * Android reads the merged Compose semantics node: whether it carries a
   * `ProgressBarRangeInfo`, how many nodes publish one, and whether the two
   * buttons are still in the tree beside it.
   *
   * @internal Not app API.
   */
  nuiTestProbeAccessibility(): void;

  /**
   * Test-only: ask whether `color` (an ARGB `processColor` int) is among the
   * pixels this control is drawing, and keep the answer for `nuiTestPixelReport`.
   * iOS answers `no pixels`: SwiftUI draws its own stepper, with no Android glyph
   * to sample.
   *
   * @internal Not app API. Remove once the test harness can read pixels.
   */
  nuiTestPixelProbe(color: number): void;

  /**
   * Test-only: what the last `nuiTestPixelProbe` found, as one line in the shape
   * Button and IconButton answer with.
   *
   * @internal Not app API.
   */
  nuiTestPixelReport(): string;

  /**
   * Test-only: what the control is showing, as one line:
   * `displayed=<number|none>;probes=<n>;merged=<n>;a11y=<...>`.
   *
   * `displayed` is read where the control is drawn, not an echo of the prop.
   * `probes` counts the accessibility answers, so a test can tell a fresh one
   * from a stale one. `merged` counts the nodes a reader is offered.
   *
   * @internal Not app API.
   */
  nuiTestStateReport(): string;
}

/**
 * A size in platform units (iOS points / Android density-independent pixels).
 * Per-component because nitrogen generates one struct per name.
 *
 * @internal Only reachable through a Hybrid View, which is not public.
 */
export interface NitroUiStepperSize {
  width: number;
  height: number;
}

/**
 * The Hybrid View React renders as `NitroUiStepper`.
 *
 * @internal Not public and not semver surface: exported for this repo's example,
 * tests and benchmarks, and for the typed `hybridRef` handle.
 */
export type NitroUiStepper = HybridView<
  NitroUiStepperProps,
  NitroUiStepperMethods
>;

import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';

/**
 * Native props of the `NitroUiStepper` Hybrid View.
 *
 * Same rules as every other component (DECISIONS D7/D7b): value props are
 * `T | null` and the JS wrapper (`Stepper.tsx`) always sends all of them, so a
 * prop can never disappear between two commits (nitro#1184); callbacks are
 * `fn?`, because Nitro only unwraps its `{ f: … }` wrapper for a prop whose type
 * *is* a function.
 *
 * The value rides the event-count handshake (`docs/architecture/core.md` §4),
 * exactly as Slider's does: native displays a step at once, emits
 * `(value, eventCount)`, and only accepts a `value` write once it has seen that
 * many of its own events — which is what lets a tap win while JS lags and a
 * refused change still snap back.
 */
export interface NitroUiStepperProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  /**
   * Controlled value, or `null` for an uncontrolled Stepper - in which case
   * native keeps the displayed value and `defaultValue` seeded it.
   */
  value: number | null;
  /** Initial value of an uncontrolled Stepper; ignored while `value` is set. */
  defaultValue: number | null;
  /**
   * The last event count JS has fully processed. Native only accepts a `value`
   * write once it has seen at least that many of its own events (§4).
   */
  mostRecentEventCount: number;
  /** Lower bound of the range. Default `0`. */
  minimumValue: number;
  /** Upper bound of the range. Default `100`. */
  maximumValue: number;
  /**
   * Increment the value snaps to, in the Stepper's own units. The wrapper
   * requires it to be greater than `0` (a dev throw otherwise), so native never
   * sees `0` from this library's own JS - `0` still means *continuous* to
   * `NitroUiSliderValue.quantize`, which is the rule this control shares.
   */
  step: number;
  /** Disable interaction (and show the disabled style). No event fires. */
  disabled: boolean;
  /** Forwarded to the native view so tests and a11y tools can find it. */
  testID: string | null;
  /**
   * Names the control. The *value* is announced by the control itself, so this
   * is the one half a caller has to provide (`docs/components/stepper.md`).
   */
  accessibilityLabel: string | null;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
  /** Once per step, with the value native now displays. */
  onValueChange?: (value: number, eventCount: number) => void;
}

export interface NitroUiStepperMethods extends HybridViewMethods {
  /**
   * The size of the hosted control, as measured on the UI thread during the last
   * layout/commit. Never calls into SwiftUI/Compose: JS reads a cached value, so
   * this is safe to call from the JS thread (core-architecture §1.4).
   */
  measureContent(): NitroUiStepperSize;

  /**
   * TEMPORARY, test-only: take one step through the path a tap takes, `+1` up or
   * `-1` down. Returns at once, because a Nitro method may not block for the UI
   * thread; observe the step through `onValueChange` and
   * {@link nuiTestStateReport}.
   *
   * It goes in through the control's own step entry point rather than writing the
   * value, so the bound rules apply: a step past either end is the end, and the
   * end is where the half that would take it is disabled - so it reports nothing,
   * exactly as the tap it stands in for does.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestStep(direction: number): void;

  /**
   * TEMPORARY, test-only: perform the *reader's* adjust action - iOS's
   * `accessibilityIncrement`/`accessibilityDecrement` on the element UIKit vends, and
   * Android's real `SetProgress` action on the merged Compose semantics node - and
   * keep the answer for {@link nuiTestAccessibilityStepReport}. Returns at once.
   *
   * It is not ``nuiTestStep``: that asks the control to step, this asks the
   * accessibility tree to. A control whose own step works while its published action
   * does nothing is exactly the bug only this seam can see, and it is why neither
   * platform falls back to the model when it finds nothing to act on.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestAccessibilityStep(direction: number): void;

  /**
   * TEMPORARY, test-only: what the last {@link nuiTestAccessibilityStep} did, as one
   * line — the element or node it found, the value before and after, and whether the
   * reader is being told the control is disabled. Same shape on both platforms.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestAccessibilityStepReport(): string;

  /**
   * TEMPORARY, test-only: read the control's accessibility node on the UI thread
   * and keep the answer for {@link nuiTestStateReport}. Returns at once.
   *
   * iOS reports the element this view vends to UIKit (its traits, label and value).
   * Android reads the merged Compose semantics node a reader is handed — whether it
   * carries a `ProgressBarRangeInfo`, how many nodes publish one, and whether the
   * two buttons are still in the tree beside it.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestProbeAccessibility(): void;

  /**
   * TEMPORARY, test-only: ask whether `color` (an ARGB `processColor` int) is among
   * the pixels this control is drawing. Answer stored for {@link nuiTestPixelReport}.
   *
   * It exists because "the minus and plus glyphs are drawn" is a *drawing* contract
   * no prop echo answers, and IconButton's probe (`NitroUiPixelProbe.kt`) is the
   * sampler for it. **iOS answers `no pixels`**, having no Android glyph to sample —
   * there SwiftUI draws its own stepper.
   *
   * @internal Not app API (DECISIONS D14). Deleted when the harness can read pixels.
   */
  nuiTestPixelProbe(color: number): void;

  /**
   * TEMPORARY, test-only: what the last {@link nuiTestPixelProbe} found, as one line —
   * the same shape Button and IconButton answer with, so the harness reads one format
   * from any control.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestPixelReport(): string;

  /**
   * TEMPORARY, test-only: what the control is showing, as one line —
   * `displayed=<number|none>;probes=<n>;merged=<n>;a11y=<...>`.
   *
   * `displayed` is written where the control is drawn, so it is a reading of the
   * hosted control rather than an echo of a prop (`hybridRef`'s `value` answers what
   * React sent). `probes` counts the accessibility answers, so a test can tell its
   * own from the previous control's. `merged` counts the nodes a reader is offered.
   * Shape shared with IconButton's report.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestStateReport(): string;
}

/**
 * A size in platform units (iOS points / Android density-independent pixels).
 *
 * @internal Only reachable through a Hybrid View, which is not exposed publicly
 * (DECISIONS D14).
 *
 * Per-component on purpose, like `NitroUiButtonSize` and `NitroUiIconButtonSize`:
 * nitrogen generates one struct per name.
 */
export interface NitroUiStepperSize {
  width: number;
  height: number;
}

/**
 * The Hybrid View React renders as `NitroUiStepper`.
 *
 * @internal Hybrid Views and their settable props are not public (DECISIONS D14):
 * exported for this repo's example, harness, bench and smoke apps, and for the
 * typed `hybridRef` handle; not semver surface.
 */
export type NitroUiStepper = HybridView<
  NitroUiStepperProps,
  NitroUiStepperMethods
>;

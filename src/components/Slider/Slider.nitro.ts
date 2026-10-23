import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';

/**
 * Native props of the `NitroUiSlider` Hybrid View.
 *
 * Same rules as every other component (DECISIONS D7/D7b): value props are
 * `T | null` and the JS wrapper (`Slider.tsx`) always sends all of them;
 * callbacks are `fn?`, because Nitro only unwraps its `{ f: … }` wrapper for a
 * prop whose type *is* a function.
 *
 * The three callbacks are one contract, not three independent ones - see
 * `docs/architecture/core.md` §11:
 * - `onSlidingStart` fires once when a drag begins, with the value it began at;
 * - `onValueChange` fires **at most once per frame** during the drag, coalesced
 *   to the newest value the finger reached (native samples touch events faster
 *   than the display draws them);
 * - `onSlidingComplete` fires once at release and always carries the final
 *   value, even when the last frame already emitted it.
 * The `eventCount` argument is native's own change counter; the JS wrapper
 * echoes the newest one back as `mostRecentEventCount` (the event-count
 * handshake, §4). `onSlidingStart`/`onSlidingComplete` report the count as it
 * stands - they change nothing, so they do not increment it.
 */
export interface NitroUiSliderProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  /**
   * Controlled value, or `null` for an uncontrolled Slider - in which case
   * native keeps the displayed value and `defaultValue` seeded it.
   */
  value: number | null;
  /** Initial value of an uncontrolled Slider; ignored while `value` is set. */
  defaultValue: number | null;
  /**
   * The last event count JS has fully processed. Native only accepts a `value`
   * write once it has seen at least that many of its own events, which is what
   * lets a drag win while JS lags and a rejected change still revert (§4).
   */
  mostRecentEventCount: number;
  /** Lower bound of the range. Default `0`. */
  minimumValue: number;
  /** Upper bound of the range. Default `1`. */
  maximumValue: number;
  /**
   * Increment the value snaps to, in the Slider's own units. `0` means
   * continuous (the default). A value larger than the range, or a range that is
   * not a whole number of steps, still quantises - to the nearest multiple of
   * `step` measured from `minimumValue`, with the maximum always reachable.
   */
  step: number;
  /** Disable interaction (and show the disabled style). */
  disabled: boolean;
  /**
   * RN-processed (`processColor`) ARGB colour for the filled track and thumb, or
   * `null` for the platform default: SwiftUI `.tint()` / M3 slider colours.
   */
  tintColor: number | null;
  /** Forwarded to the native view so tests and a11y tools can find it. */
  testID: string | null;
  /** Accessibility label of the control itself. */
  accessibilityLabel: string | null;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
  /** During a drag, once per frame at most. */
  onValueChange?: (value: number, eventCount: number) => void;
  /** When a drag begins, with the value it began at. */
  onSlidingStart?: (value: number, eventCount: number) => void;
  /** At release, always with the final value. */
  onSlidingComplete?: (value: number, eventCount: number) => void;
}

export interface NitroUiSliderMethods extends HybridViewMethods {
  /**
   * The size of the hosted control, as measured on the UI thread during the last
   * layout/commit. For a `fillWidth` control this is the height the control
   * wants *at the width Yoga gave it*, plus that width.
   */
  measureContent(): NitroUiSliderSize;

  /**
   * TEMPORARY, test-only: drive one drag through the real interaction pipeline
   * (the same entry points a touch stream uses), so a harness can assert the
   * frame coalescing, the quantisation and the three-callback contract without a
   * touch synthesiser. `react-native-harness` can synthesise a tap but not a
   * drag, and the platform controls need a drag to change value on iOS.
   *
   * The drag begins on the value the control *displays* - touching down on the
   * thumb, not on a point of the track - which is what makes it a real test of
   * the handshake: after a change JS rejected, the value it starts from is the
   * evidence of what native is showing. It then moves to `to`, which is
   * quantised like any other value, and ends.
   *
   * With `msPerStep` 0 every move lands in **one** main-thread turn - which is
   * the point, because a pipeline that emitted per move would then emit `steps`
   * times where this one emits once. With a positive `msPerStep` each move waits
   * that long, so the coalescer gets several frames.
   *
   * Returns nothing; observe the drag through the three callbacks.
   *
   * @internal Not app API (DECISIONS D14). Deleted when the harness can drag.
   */
  nuiTestDrag(to: number, steps: number, msPerStep: number): void;
}

/**
 * A size in platform units (iOS points / Android density-independent pixels).
 *
 * @internal Only reachable through a Hybrid View, which v0.1 does not expose
 * publicly (DECISIONS D14).
 */
export interface NitroUiSliderSize {
  width: number;
  height: number;
}

/**
 * The Hybrid View behind the `Slider` wrapper.
 *
 * @internal v0.1 does not expose Hybrid Views or their settable props publicly
 * (DECISIONS D14): it is exported for this repo's example, harness, bench and
 * smoke apps, and for the typed `hybridRef` handle, and is not semver surface.
 */
export type NitroUiSlider = HybridView<
  NitroUiSliderProps,
  NitroUiSliderMethods
>;

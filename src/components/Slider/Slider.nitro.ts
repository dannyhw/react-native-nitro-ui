import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';

/**
 * No prop is optional: Fabric sends `null` for a removed prop, which crashes
 * an optional one (nitro#1184). Callbacks are the exception: Nitro only
 * accepts a callback prop typed as a function, never `fn | null`.
 *
 * Each callback's `eventCount` is native's change counter. `onSlidingStart`
 * and `onSlidingComplete` report it as it stands and do not increment it.
 */
export interface NitroUiSliderProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  /** `null` while uncontrolled: native then keeps the displayed value. */
  value: number | null;
  defaultValue: number | null;
  /** Native ignores a `value` sent with a count behind its own. */
  mostRecentEventCount: number;
  minimumValue: number;
  maximumValue: number;
  /**
   * `0` means continuous. Otherwise values snap to the nearest multiple of
   * `step` from `minimumValue`, and the maximum is always reachable.
   */
  step: number;
  disabled: boolean;
  /** A `processColor` ARGB int, or `null` for the platform default. */
  tintColor: number | null;
  testID: string | null;
  accessibilityLabel: string | null;
  nuiPerfId: number | null;
  /** At most once per frame during a drag, with the newest value reached. */
  onValueChange?: (value: number, eventCount: number) => void;
  /** Once when a drag begins, with the value it began at. */
  onSlidingStart?: (value: number, eventCount: number) => void;
  /** Once at release, always with the final value. */
  onSlidingComplete?: (value: number, eventCount: number) => void;
}

export interface NitroUiSliderMethods extends HybridViewMethods {
  /** The height the control wants at the width Yoga gave it, and that width. */
  measureContent(): NitroUiSliderSize;

  /**
   * @internal Test-only: drags from the displayed value to `to` in `steps`
   * moves. With `msPerStep` 0 every move lands in one main-thread turn.
   */
  nuiTestDrag(to: number, steps: number, msPerStep: number): void;

  /**
   * @internal Test-only: performs the platform's accessibility increment
   * (`direction` > 0) or decrement (`direction` < 0) on the hosted control.
   */
  nuiTestAccessibilityStep(direction: number): void;

  /**
   * @internal Test-only: what the last `nuiTestAccessibilityStep` acted on.
   * Separate because the step runs on the UI thread, which a Nitro method
   * must not block for.
   */
  nuiTestAccessibilityStepReport(): string;

  /**
   * @internal Test-only: whether the drag's frame pump is still running (a
   * `CADisplayLink` on iOS, a `Choreographer` callback on Android).
   */
  nuiTestFramePumpArmed(): boolean;

  /**
   * @internal Test-only: injects a pointer stream through the platform's
   * touch entry point (Android `View.dispatchTouchEvent`). `mode`:
   * - `0`: DOWN, three MOVEs, then the final MOVE and the UP in one turn;
   * - `1`: DOWN, then `ACTION_CANCEL`;
   * - `2`: a second finger joins and leaves;
   * - `3`: the press, a move past the touch slop and the release in one turn.
   * Each is one gesture: one `onSlidingStart` and one `onSlidingComplete`.
   */
  nuiTestPointerStream(mode: number): void;

  /**
   * @internal Test-only: how many events the last `nuiTestPointerStream`
   * dispatched, or why it dispatched none.
   */
  nuiTestPointerStreamReport(): string;
}

/** @internal In platform units (iOS points, Android dp). */
export interface NitroUiSliderSize {
  width: number;
  height: number;
}

/** @internal Exported for this repo's apps and tests; not semver surface. */
export type NitroUiSlider = HybridView<
  NitroUiSliderProps,
  NitroUiSliderMethods
>;

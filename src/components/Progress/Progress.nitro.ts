import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';
import type { NitroUiSize } from '../Switch/Switch.nitro';

/**
 * Native props of the `NitroUiProgress` Hybrid View.
 *
 * There are no callbacks and no event-count handshake: the user cannot change a
 * Progress, so React's `value` is always the truth.
 *
 * No prop is optional: a removed prop arrives as `null`, which crashes an
 * optional one (nitro#1184). The wrapper always sends every prop.
 */
export interface NitroUiProgressProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  /**
   * `'linear'`, `'circular'` or `'loading'`; anything else behaves as `'linear'`.
   *
   * `'loading'` is Material 3 Expressive's morphing loading indicator on Android
   * and a circular `ProgressView` on iOS. Changing the variant remounts the
   * native view.
   */
  variant: string;
  /**
   * `'flat'` (the default) or `'wavy'`.
   *
   * `'wavy'` draws Material 3's wavy indicators on Android. iOS has none and
   * paints flat, and a `'loading'` indicator ignores it. The wavy indicators are
   * larger than the flat ones, so a change re-measures.
   */
  appearance: string;
  /**
   * Whether a `'loading'` indicator is drawn inside Material's tonal container
   * (`ContainedLoadingIndicator`). Ignored by the other variants and on iOS.
   */
  contained: boolean;
  /**
   * The fraction shown, 0...1, or `null` for an indeterminate indicator.
   * Out-of-range values are clamped natively, and `NaN` is 0.
   *
   * iOS draws the fraction for a `linear` bar only: a circular `ProgressView`
   * spins regardless, so the value reaches accessibility and not the ring. An
   * indeterminate `linear` bar on iOS paints an empty track and does not animate.
   */
  value: number | null;
  /** `processColor` output (ARGB) for the indicator, or `null` for the platform default. */
  tintColor: number | null;
  /**
   * `processColor` output (ARGB) for the track behind the indicator, or `null`
   * for the platform default. Android only: SwiftUI's `ProgressView` has no
   * track colour.
   */
  trackColor: number | null;
  testID: string | null;
  accessibilityLabel: string | null;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
}

export interface NitroUiProgressMethods extends HybridViewMethods {
  /**
   * The size of the hosted control as of the last layout. It returns a cached
   * value, so it is safe to call from the JS thread. A linear Progress fills the
   * width it is given, so only its height is its own.
   */
  measureContent(): NitroUiSize;

  /**
   * Test-only: what the control is displaying, read where it is drawn rather
   * than from the prop: `displayed=<value>` for a determinate indicator,
   * `displayed=indeterminate` otherwise.
   *
   * @internal Not app API. Remove once the test harness can read a progress
   * value out of a hosted control.
   */
  nuiTestDisplayedValue(): string;

  /**
   * Test-only: whether this control may be animating right now: `true` only for
   * an indeterminate indicator whose view is mounted, in a window and not
   * recycled.
   *
   * @internal Not app API.
   */
  nuiTestIsAnimating(): boolean;
}

/**
 * The Hybrid View behind the `Progress` wrapper.
 *
 * @internal Not public and not semver surface: exported for this repo's example,
 * tests and benchmarks, and for the typed `hybridRef` handle.
 */
export type NitroUiProgress = HybridView<
  NitroUiProgressProps,
  NitroUiProgressMethods
>;

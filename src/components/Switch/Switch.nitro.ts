import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';

/**
 * Native props of the `NitroUiSwitch` Hybrid View.
 *
 * No prop is optional: a removed prop arrives as `null`, which crashes an
 * optional one (nitro#1184). The wrapper always sends every prop.
 */
export interface NitroUiSwitchProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  /** Controlled value, or `null` for an uncontrolled Switch. */
  value: boolean | null;
  /** Initial value of an uncontrolled Switch; ignored while `value` is set. */
  defaultValue: boolean | null;
  /**
   * The last event count JS has fully processed. Native accepts a `value` write
   * only once it has seen this many of its own events.
   */
  mostRecentEventCount: number;
  disabled: boolean;
  /** `processColor` output (ARGB) for the "on" accent, or `null` for the platform default. */
  tintColor: number | null;
  testID: string | null;
  accessibilityLabel: string | null;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
  /** Test-only: the control's width in platform units, so a test can resize it through a prop. */
  nuiTestWidth: number | null;
  /**
   * Called on every user interaction with the value native now displays and
   * native's event count.
   *
   * Callbacks are the exception to the no-optional rule: Nitro only unwraps a
   * callback prop whose type is a plain function, so `fn | null` throws at mount.
   * The wrapper always sends a callback.
   */
  onValueChange?: (value: boolean, eventCount: number) => void;
}

export interface NitroUiSwitchMethods extends HybridViewMethods {
  /**
   * The size of the hosted control as of the last layout. It returns a cached
   * value, so it is safe to call from the JS thread.
   */
  measureContent(): NitroUiSize;

  /**
   * Test-only: the Android guards this view has armed for a composition of its
   * own, as `<ever>|live:<live>`. `ever` lists what this mount armed at any point
   * (`strategy`, `preDraw`), `live` what is installed now. A control composed by a
   * `<Host>` answers `|live:`, and so does every Switch on iOS.
   */
  nuiTestArmedGuards(): string;

  /**
   * Test-only: `drops=<n> recycles=<m>`, how many mounts of this object have
   * ended and how many of those entered the platform's view pool. The counters
   * survive recycling, so a non-zero answer proves the pool handed the instance
   * back.
   *
   * @internal Not app API.
   */
  nuiTestLifetimeReport(): string;
}

/**
 * A size in platform units (iOS points / Android density-independent pixels).
 *
 * @internal Only reachable through a Hybrid View, which is not public.
 */
export interface NitroUiSize {
  width: number;
  height: number;
}

/**
 * The Hybrid View behind the `Switch` wrapper.
 *
 * @internal Not public and not semver surface: exported for this repo's example,
 * tests and benchmarks, and for the typed `hybridRef` handle.
 */
export type NitroUiSwitch = HybridView<
  NitroUiSwitchProps,
  NitroUiSwitchMethods
>;

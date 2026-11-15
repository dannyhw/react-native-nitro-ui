import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';

/**
 * Native props of the `NitroUiChip` Hybrid View.
 *
 * A filter chip has a value, so `selected` uses the event-count handshake; an
 * assist chip is a press and reports `onPress`. Both sets are always sent, so a
 * variant change never makes a prop disappear between two commits.
 *
 * No prop is optional except the callbacks: a removed prop arrives as `null`,
 * which crashes an optional one (nitro#1184).
 */
export interface NitroUiChipProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  /** The chip's text, and its default accessibility label. */
  label: string;
  /** `'filter' | 'assist'`; anything else is `'filter'`. */
  variant: string;
  /**
   * Controlled selection of a filter chip, or `null` for an uncontrolled one.
   * Ignored by an assist chip.
   */
  selected: boolean | null;
  /** Initial selection of an uncontrolled filter chip; ignored while `selected` is set. */
  defaultSelected: boolean | null;
  /**
   * The last event count JS has fully processed. Native accepts a `selected`
   * write only once it has seen this many of its own events.
   */
  mostRecentEventCount: number;
  disabled: boolean;
  /** Leading SF Symbol name, or `null`. iOS only. */
  systemImage: string | null;
  /**
   * Leading glyph for Android, or `null`: a drawable resource name, or a `url:`
   * marker in front of a dev-server file. Android only.
   *
   * An assist chip draws it next to the label. A filter chip draws it while
   * unselected; the check takes its slot when selected. A name that cannot be
   * resolved draws nothing and reserves no space.
   */
  androidIcon: string | null;
  testID: string | null;
  /** Accessibility label of the control itself, or `null` to use `label`. */
  accessibilityLabel: string | null;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
  /**
   * A filter chip's toggle: the selection native now displays and native's event
   * count.
   *
   * Callbacks are the exception to the no-optional rule: Nitro only unwraps a
   * callback prop whose type is a plain function. The wrapper always sends one.
   */
  onSelectedChange?: (selected: boolean, eventCount: number) => void;
  /** An assist chip's tap. */
  onPress?: () => void;
}

export interface NitroUiChipMethods extends HybridViewMethods {
  /**
   * The size of the hosted control as of the last layout. It returns a cached
   * value, so it is safe to call from the JS thread.
   */
  measureContent(): NitroUiChipSize;

  /**
   * Test-only: press the chip through the path a tap takes; refused while
   * disabled. SwiftUI's button gesture ignores a synthesised touch. Hops to the
   * UI thread and returns at once.
   *
   * @internal Not app API.
   */
  nuiTestPress(): void;

  /**
   * Test-only: read the chip's accessibility node on the UI thread and keep the
   * answer for `nuiTestStateReport`. Returns at once. iOS records
   * `a11y=unavailable`: a SwiftUI hosting view exposes no elements in-process.
   *
   * @internal Not app API.
   */
  nuiTestProbeAccessibility(): void;

  /**
   * Test-only: what the chip is showing, as one line:
   * `displayed=<0|1|none>;probes=<n>;a11y=<...>`.
   *
   * `displayed` is read where the control is drawn, not an echo of the prop; it
   * is `none` until the control has drawn, and for an assist chip. `probes`
   * counts the answers `nuiTestProbeAccessibility` has stored, and `a11y` is the
   * last one (Android:
   * `role=<role>,selected=<bool|none>,toggle=<On|Off|none>,disabled=<bool>,clickable=<bool>,label=<text>`).
   *
   * @internal Not app API.
   */
  nuiTestStateReport(): string;

  /**
   * Test-only: sample the pixels this chip is drawing, looking for `color`, and
   * keep the answer for `nuiTestPixelReport`. Returns at once, because sampling
   * needs the UI thread; poll the report.
   *
   * @internal Not app API. Remove once the test harness can read pixels.
   */
  nuiTestPixelProbe(color: number): void;

  /**
   * Test-only: what the last `nuiTestPixelProbe` found:
   * `n=<probes> size=<w>x<h> want=#<RRGGBB> hits=<n> mean=#<RRGGBB>
   * closest=#<RRGGBB>`, or `n=<probes> no pixels` on iOS, which has no Android
   * glyph to sample. Empty before the first probe.
   *
   * @internal Not app API.
   */
  nuiTestPixelReport(): string;
}

/**
 * A size in platform units (iOS points / Android density-independent pixels).
 * Per-component because nitrogen generates one struct per name.
 *
 * @internal Only reachable through a Hybrid View, which is not public.
 */
export interface NitroUiChipSize {
  width: number;
  height: number;
}

/**
 * The Hybrid View React renders as `NitroUiChip`.
 *
 * @internal Not public and not semver surface: exported for this repo's example
 * and tests, and for the typed `hybridRef` handle.
 */
export type NitroUiChip = HybridView<NitroUiChipProps, NitroUiChipMethods>;

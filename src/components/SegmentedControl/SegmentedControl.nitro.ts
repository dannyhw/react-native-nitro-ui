import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';

/**
 * Native props of the `NitroUiSegmentedControl` Hybrid View.
 *
 * No member is optional (DECISIONS D7 / nitro#1184) except the callbacks
 * (D7b): Fabric sends `null` for a prop that JS removed and Nitro only treats
 * `undefined` as "unset", so an optional prop that goes away crashes. The JS
 * wrapper (`SegmentedControl.tsx`) always sends every prop, using `null` for
 * "not set" and `[]` for "no options" — an array prop has no `null` form worth
 * having, and a missing `options` would leave a recycled view showing the
 * previous row's segments.
 *
 * The value is an **index** into `options`, not the option's text: two options
 * can have the same label, and an index is what both platforms' controls store.
 *
 * Setters must not interpret one prop against another (Nitro does not order
 * props inside a batch — core.md §3), so `options`, `selectedIndex` and
 * `defaultSelectedIndex` are stored raw and clamped together in `afterUpdate()`.
 */
export interface NitroUiSegmentedControlProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  /**
   * The segment labels, in order. Always sent; `[]` renders an empty control.
   *
   * Size-affecting on both platforms (the control is as wide as its labels), so
   * it is the whole of `nuiSizingKey` and every setter for it has to say so.
   */
  options: string[];
  /**
   * Controlled selected index, or `null` for an uncontrolled control - in which
   * case native keeps the displayed index and `defaultSelectedIndex` seeded it.
   *
   * Stored raw and clamped to the current `options` in `afterUpdate()`, like
   * Slider's `value` is quantised there rather than in the setter.
   */
  selectedIndex: number | null;
  /**
   * Initial selected index of an uncontrolled control; ignored while
   * `selectedIndex` is set. Also clamped, in `afterUpdate()`.
   */
  defaultSelectedIndex: number;
  /**
   * The last event count JS has fully processed (core.md §4). Native only
   * accepts a `selectedIndex` write once it has seen this many of its own
   * events, which is what makes a rejected change snap back.
   */
  mostRecentEventCount: number;
  /** Disable interaction (and show the disabled style). No selection change. */
  disabled: boolean;
  /**
   * RN-processed (`processColor`) ARGB color, or `null` for the platform
   * default: the selected segment's container + border on Android. Applied on iOS
   * as `.tint()`, which a segmented `Picker` ignores, so it is a no-op there.
   */
  tintColor: number | null;
  /** Forwarded to the native view so tests and a11y tools can find it. */
  testID: string | null;
  /** Accessibility label of the control itself. */
  accessibilityLabel: string | null;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
  /**
   * Called on every user selection with the index native now displays, plus
   * native's event count (the JS wrapper echoes it back as
   * `mostRecentEventCount` and adds the option's text).
   *
   * Not called for a tap on the segment that is already selected: a SwiftUI
   * `Picker` binding only writes when the selection moves, and Android's
   * Material 3 button fires for every press, so the Android implementation
   * suppresses the no-op to keep the two platforms reporting the same events.
   *
   * Callback props are the exception to the no-optional rule (D7b): Nitro only
   * unwraps `{ f: fn }` for a prop whose type *is* a function, so this must
   * never become `fn | null`. The JS wrapper always sends one — a stable no-op
   * when the caller passed nothing — so removing a handler cannot leave the
   * previous one behind.
   */
  onValueChange?: (index: number, eventCount: number) => void;
}

export interface NitroUiSegmentedControlMethods extends HybridViewMethods {
  /**
   * The size of the hosted control, as measured on the UI thread during the last
   * layout/commit. Never calls into SwiftUI/Compose: JS reads a cached value, so
   * this is safe to call from the JS thread (core.md §5).
   */
  measureContent(): NitroUiSegmentedControlSize;

  /**
   * TEMPORARY, test-only: ask the platform to look at the pixels this control is
   * actually drawing and say whether `color` (an ARGB `processColor` int) is among
   * them. Result is stored for ``nuiTestPixelReport``.
   *
   * Nothing else can answer `docs/tasks/Q4-followups-triage.md` row 27. Every other
   * reading this control offers is a prop echo: `hybridRef.tintColor` reports what
   * React sent on both platforms, so it cannot tell a tint that arrived from a tint
   * the platform ignored — which is precisely the bug that made `tintColor` a
   * documented iOS no-op (G4 F1) while the docs still claimed it painted the
   * selected segment. Only the drawn pixels know.
   *
   * Sampling runs on the platform's UI thread and stores its answer, so this returns
   * at once; poll ``nuiTestPixelReport`` the way the Slider's
   * `nuiTestAccessibilityStep` pair works (`ios/core/NitroUiMainThread.swift`: never
   * block a Nitro method for main).
   *
   * @internal Not app API (DECISIONS D14). Deleted when the harness can read pixels.
   */
  nuiTestPixelProbe(color: number): void;

  /**
   * TEMPORARY, test-only: what the last ``nuiTestPixelProbe`` found, as one line —
   * empty until a probe has run.
   *
   * Shape, on both platforms: `n=<count> size=<w>x<h> want=#RRGGBB hits=<n>
   * mean=#RRGGBB closest=#RRGGBB`, where the leading count is how many probes this
   * control has answered — the only way a test can tell a fresh answer from the previous
   * one, since the probe is asynchronous. `hits` counts the sampled pixels that match
   * the requested colour within tolerance, `mean` is the area-weighted average of
   * everything drawn, and `closest` is the nearest colour found. A control that drew
   * nothing says `no pixels` / `no image`.
   *
   * Both platforms composite the control over a neutral mid grey before reading it,
   * because the iOS 26+ selection fill is glass and arrives translucent: sampled on its
   * own, a 102×31 pt control returned only 566 opaque pixels and they were the labels and
   * the track — the fill was filtered out and the probe reported "no such colour" for a
   * colour the control had demonstrably been told to draw.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestPixelReport(): string;
}

/**
 * A size in platform units (iOS points / Android density-independent pixels).
 *
 * @internal Only reachable through a Hybrid View, which v0.1 does not expose
 * publicly (DECISIONS D14).
 *
 * The shape is per-component on purpose, like `NitroUiSize`,
 * `NitroUiSliderSize` and `NitroUiButtonSize`: nitrogen generates one struct per
 * name, and a shared type in one component's spec file would make every other
 * component import that component's spec.
 */
export interface NitroUiSegmentedControlSize {
  width: number;
  height: number;
}

/**
 * The Hybrid View React renders as `NitroUiSegmentedControl`.
 *
 * @internal v0.1 does not expose Hybrid Views or their settable props publicly
 * (DECISIONS D14): it is exported for this repo's example, harness, bench and
 * smoke apps, and for the typed `hybridRef` handle, and is not semver surface.
 */
export type NitroUiSegmentedControl = HybridView<
  NitroUiSegmentedControlProps,
  NitroUiSegmentedControlMethods
>;

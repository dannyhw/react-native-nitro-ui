import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';

/**
 * One item of the group, as the native side sees it.
 *
 * Every member is required, as props are. The checked state is not here: it
 * travels separately so one item's change does not give the whole array a new
 * identity.
 */
export interface NitroUiButtonGroupItem {
  /**
   * Stable id, unique across the group. The callbacks report it and the checked
   * set is made of it.
   */
  id: string;
  /**
   * Drawn, read by a screen reader, and used as the overflow row's text when the
   * item does not fit in the row.
   */
  title: string;
  /** SF Symbol name, or `null`. iOS only. */
  systemImage: string | null;
  /**
   * Android glyph as one resolved string: a resource name, a `res:` name or a
   * `url:`. Android only.
   */
  androidIcon: string | null;
  disabled: boolean;
  /**
   * A toggle shows a checked state and reports `onCheckedChange`; an action
   * reports `onPress`.
   */
  toggle: boolean;
}

/**
 * Native props of the `NitroUiButtonGroup` Hybrid View.
 *
 * No prop is optional except the callbacks: a removed prop arrives as `null`,
 * which crashes an optional one (nitro#1184). The wrapper always sends every
 * prop, with `null` for "not set" and `[]` for "none".
 *
 * The checked set uses the event-count handshake: native flips a toggle at once
 * and emits `(id, checked, eventCount)`, and honours a `checkedIds` write only
 * once it has seen that many of its own events.
 *
 * Nitro does not order props inside a batch, so `items`, `checkedIds`,
 * `controlledIds` and `defaultCheckedIds` are stored raw and reconciled together
 * in `afterUpdate()`.
 */
export interface NitroUiButtonGroupProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  /** The items, in render order. `[]` draws an empty row. */
  items: NitroUiButtonGroupItem[];
  /**
   * `'standard'` or `'connected'`. Android: spaced items with their own corners,
   * or Material's connected corners. iOS: a row of bordered buttons, or SwiftUI's
   * `ControlGroup`.
   */
  appearance: string;
  /**
   * `'filled' | 'tonal' | 'outlined' | 'text' | 'elevated'`, as `Button` sends.
   * A connected iOS group ignores it: `ControlGroup` ignores `.buttonStyle` and
   * `.tint`.
   */
  variant: string;
  /**
   * `'small' | 'medium' | 'large' | 'xlarge' | 'xxlarge'`. A connected iOS group
   * ignores it: `ControlGroup` is one height at every `.controlSize`.
   */
  size: string;
  /**
   * `'automatic' | 'titleOnly' | 'iconOnly' | 'titleAndIcon'`. `automatic` is the
   * platform's default: a connected iOS group draws icons only once an item has
   * one; iOS standard and Android draw icon and title.
   */
  labelStyle: string;
  /** Disables every item. An open overflow menu closes. */
  disabled: boolean;
  /**
   * `processColor` output (ARGB), or `null` for the platform default. Ignored by
   * a connected iOS group.
   */
  tintColor: number | null;
  /** The ids of the controlled toggle items that are checked. */
  checkedIds: string[];
  /**
   * The ids of the toggle items whose `checked` is a boolean: the only ids a
   * `checkedIds` write may move. Other items keep the state the user gave them.
   */
  controlledIds: string[];
  /**
   * The ids of the uncontrolled toggle items that start checked. Native applies
   * it once, when it first sees an item, so a re-render cannot undo the user.
   */
  defaultCheckedIds: string[];
  /**
   * The last event count JS has fully processed. Native accepts a `checkedIds`
   * write only once it has seen this many of its own events.
   */
  mostRecentEventCount: number;
  /**
   * Accessibility name of the overflow control, or `null` for the platform's
   * own: Material's localised "More options" on Android, "More" on iOS.
   */
  overflowAccessibilityLabel: string | null;
  accessibilityLabel: string | null;
  testID: string | null;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
  /**
   * An action item's tap, from the row or from an overflow row. Never fires for
   * a toggle item.
   *
   * Callbacks are the exception to the no-optional rule: Nitro only unwraps a
   * callback prop whose type is a plain function. The wrapper always sends one,
   * so a recycled view cannot keep the previous mount's handler.
   */
  onPress?: (id: string) => void;
  /**
   * A toggle item's change: the id, the state native now displays, and native's
   * event count.
   */
  onCheckedChange?: (id: string, checked: boolean, eventCount: number) => void;
}

export interface NitroUiButtonGroupMethods extends HybridViewMethods {
  /**
   * The size of the hosted control as of the last layout. It returns a cached
   * value, so it is safe to call from the JS thread. The width is the box's; the
   * height is the row's measured height.
   */
  measureContent(): NitroUiButtonGroupSize;

  /**
   * Test-only: press `id` through the path a tap takes; refused while the group
   * or the item is disabled. SwiftUI's button gesture ignores a synthesised
   * touch, and an item in the overflow menu cannot be tapped otherwise.
   *
   * @internal Not app API.
   */
  nuiTestPressItem(id: string): void;

  /**
   * Test-only: open the overflow menu as the indicator's tap does. Returns at
   * once. A no-op on iOS, where a SwiftUI `Menu` cannot be expanded from code
   * before iOS 18.
   *
   * @internal Not app API.
   */
  nuiTestOpenOverflow(): void;

  /**
   * Test-only: record which items the row laid out and which overflowed, for
   * `nuiTestStateReport`. Returns at once. The props cannot answer this: the
   * items array is the same either way.
   *
   * @internal Not app API.
   */
  nuiTestProbeRow(): void;

  /**
   * Test-only: read the group's accessibility nodes on the UI thread and keep
   * the answer for `nuiTestStateReport`. Returns at once. iOS answers
   * `a11y=unavailable`: a SwiftUI hosting view exposes no elements in-process.
   *
   * @internal Not app API.
   */
  nuiTestProbeAccessibility(): void;

  /**
   * Test-only: what the control is showing, as one line:
   * `checked=<a,b|none>;visible=<n>;overflow=<0|1>;row=<r>;menu=<open|closed>;`
   * `probes=<n>;a11y=<...>`.
   *
   * `checked` is what the row shows, not an echo of the prop. `visible`,
   * `overflow` and `row` are the last `nuiTestProbeRow` reading; `row` is
   * `controlGroup` or `standard` on iOS and always `standard` on Android.
   * `probes` counts the probes, so a test can tell a fresh answer from a stale one.
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
export interface NitroUiButtonGroupSize {
  width: number;
  height: number;
}

/**
 * The Hybrid View React renders as `NitroUiButtonGroup`.
 *
 * @internal Not public and not semver surface: exported for this repo's example,
 * tests and benchmarks, and for the typed `hybridRef` handle.
 */
export type NitroUiButtonGroup = HybridView<
  NitroUiButtonGroupProps,
  NitroUiButtonGroupMethods
>;

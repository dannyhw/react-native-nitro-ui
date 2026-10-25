import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';

/**
 * Native props of the `NitroUiPicker` Hybrid View.
 *
 * No member is optional (DECISIONS D7 / nitro#1184) except the callback
 * (D7b): Fabric sends `null` for a prop that JS removed and Nitro only treats
 * `undefined` as "unset", so an optional prop that goes away crashes. The JS
 * wrapper (`Picker.tsx`) always sends every prop, using `null` for "not set"
 * and `[]` for "no options" — a missing `options` would leave a recycled view
 * showing the previous row's choices.
 *
 * The value is an **index** into `options`, not the option's text: two options
 * can have the same label, and an index is what both platforms' controls store
 * (SegmentedControl's data model, reused, not forked).
 *
 * Setters must not interpret one prop against another (Nitro does not order
 * props inside a batch — core.md §3), so `options`, `selectedIndex` and
 * `defaultSelectedIndex` are stored raw and clamped together in `afterUpdate()`.
 */
export interface NitroUiPickerProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  /**
   * The choices, in order. Always sent; `[]` renders a control with nothing to
   * pick and no valid index.
   *
   * Size-affecting on both platforms (a menu button is as wide as the title it
   * shows, and the list decides what a re-measure can find), so it is part of
   * `nuiSizingKey` and the setter has to say so.
   */
  options: string[];
  /**
   * Controlled selected index, or `null` for an uncontrolled picker - in which
   * case native keeps the displayed index and `defaultSelectedIndex` seeded it.
   *
   * Stored raw and clamped to the current `options` in `afterUpdate()`, like
   * SegmentedControl's and Slider's values are normalised there rather than in
   * the setter.
   */
  selectedIndex: number | null;
  /**
   * Initial selected index of an uncontrolled picker; ignored while
   * `selectedIndex` is set. Also clamped, in `afterUpdate()`.
   */
  defaultSelectedIndex: number;
  /**
   * The last event count JS has fully processed (core.md §4). Native only
   * accepts a `selectedIndex` write once it has seen this many of its own
   * events, which is what makes a rejected change snap back.
   */
  mostRecentEventCount: number;
  /**
   * `'menu'` or `'wheel'`. Anything else behaves as `'menu'`, which is also the
   * default the wrapper sends.
   *
   * The one prop that changes the control's *size policy*: a menu button is
   * sized by its title (`intrinsic`), a wheel fills its box's width and measures
   * its own height (`fillWidth`) — the same two-policy dance Progress does
   * between its linear and circular shapes. On Android `'wheel'` renders the
   * menu control (Material 3 has no wheel) under the wheel's layout policy.
   */
  variant: string;
  /**
   * The picker's label, or `null` for none: shown where the platform shows one
   * (Android's Material 3 text-field label; iOS uses it as the menu's title and
   * for accessibility, and draws nothing next to the button).
   *
   * Size-affecting on Android, where the label is part of the field's box.
   */
  label: string | null;
  /** Disable interaction (and show the disabled style). No selection, no menu. */
  disabled: boolean;
  /**
   * RN-processed (`processColor`) ARGB color, or `null` for the platform
   * default. What it paints per platform is documented in
   * `docs/components/picker.md` — on iOS it reaches the menu's title colour, on
   * Android the field's focus/label accent.
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
   * Not called for a selection React itself made, for opening or closing the
   * menu, or while `disabled`. Picking the item that is already selected is not
   * a change and reports nothing, on both platforms.
   *
   * Callback props are the exception to the no-optional rule (D7b): Nitro only
   * unwraps `{ f: fn }` for a prop whose type *is* a function, so this must
   * never become `fn | null`. The JS wrapper always sends one — a stable no-op
   * when the caller passed nothing — so removing a handler cannot leave the
   * previous one behind.
   */
  onValueChange?: (index: number, eventCount: number) => void;
}

export interface NitroUiPickerMethods extends HybridViewMethods {
  /**
   * The size of the hosted control, as measured on the UI thread during the last
   * layout/commit. Never calls into SwiftUI/Compose: JS reads a cached value, so
   * this is safe to call from the JS thread (core.md §5).
   */
  measureContent(): NitroUiPickerSize;
}

/**
 * A size in platform units (iOS points / Android density-independent pixels).
 *
 * @internal Only reachable through a Hybrid View, which v0.1 does not expose
 * publicly (DECISIONS D14).
 *
 * The shape is per-component on purpose, like `NitroUiSize`,
 * `NitroUiSliderSize`, `NitroUiButtonSize` and `NitroUiSegmentedControlSize`:
 * nitrogen generates one struct per name, and a shared type in one component's
 * spec file would make every other component import that component's spec.
 */
export interface NitroUiPickerSize {
  width: number;
  height: number;
}

/**
 * The Hybrid View React renders as `NitroUiPicker`.
 *
 * @internal v0.1 does not expose Hybrid Views or their settable props publicly
 * (DECISIONS D14): it is exported for this repo's example, harness, bench and
 * smoke apps, and for the typed `hybridRef` handle, and is not semver surface.
 */
export type NitroUiPicker = HybridView<
  NitroUiPickerProps,
  NitroUiPickerMethods
>;

import type {
  HybridView,
  HybridViewProps,
  HybridViewMethods,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';

/**
 * Native props of the `NitroUiCheckbox` Hybrid View.
 *
 * No member is optional (DECISIONS D7 / nitro#1184): Fabric sends `null` for a
 * prop that JS removed, and Nitro 0.37 only treats `undefined` as "unset", so an
 * optional prop that goes away crashes. The JS wrapper (`Checkbox.tsx`) always
 * sends every prop, using `null` for "not set".
 *
 * All props are applied in one batch between `beforeUpdate()` and
 * `afterUpdate()`; setters only store + mark dirty.
 */
export interface NitroUiCheckboxProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  /**
   * Controlled checked state, or `null` for an uncontrolled Checkbox - in which
   * case native keeps the displayed value and `defaultChecked` seeded it.
   *
   * A boolean on both platforms: three-state support is `indeterminate` below,
   * not a third value here, so an app's `checked` is the same type everywhere.
   */
  checked: boolean | null;
  /** Initial value of an uncontrolled Checkbox; ignored while `checked` is set. */
  defaultChecked: boolean | null;
  /**
   * Three-state display: Material 3's `TriStateCheckbox` draws a dash instead of the
   * box, and on iOS the glyph styles draw `minus.circle.fill` / `minus.square.fill`
   * (DECISIONS D47 item 3). It is never a value - a tap still asks for "checked" -
   * and `checked` outranks it on both platforms: a box that is `indeterminate` *and*
   * checked draws the check mark, which is Android's rule and has to stay Android's.
   * `docs/components/checkbox.md` has the table.
   *
   * The one thing `'switch'` does not draw: that style is SwiftUI's two-position
   * control, which reads this as off, exactly as it did before D47.
   *
   * It is in the sizing key wherever it changes what is drawn - on Android, and on iOS
   * in the glyph styles - and out wherever it does not; `checked` is out on both,
   * because no box on either platform moves between states (the harness measures all
   * of them).
   */
  indeterminate: boolean | null;
  /**
   * Which picture iOS draws: `'circle'` (the default), `'square'` or `'switch'`,
   * resolved by the wrapper - anything else is `'circle'`. See
   * `docs/components/checkbox.md` for what each maps to.
   *
   * `'circle'` and `'square'` are still the platform's own `Toggle`, with a style of
   * ours that draws Apple's SF Symbols (`checkmark.circle.fill` / `circle`,
   * `checkmark.square.fill` / `square`) - the checklist glyph iOS itself uses in
   * Reminders and Notes, which is why a Checkbox no longer has to look like a Switch
   * on this platform (DECISIONS D47). `'switch'` is the look this component shipped
   * with under D38 item 1, unchanged in every detail: same control, same box, same
   * element a reader meets.
   *
   * **Android ignores it** - Material 3 has a checkbox, so there is nothing to choose
   * - and it stays out of Android's sizing key for the reason `indeterminate` stays
   * out of iOS's: a prop that changes nothing that is drawn must not cost a cold
   * configuration. On iOS it *is* in the key, because the three styles measure apart
   * (`HybridNitroUiCheckbox.swift` declares the default one's box).
   */
  iosStyle: string;
  /**
   * The last event count JS has fully processed (core-architecture §4). Native
   * only accepts a `checked` write once it has seen this many of its own events.
   */
  mostRecentEventCount: number;
  /**
   * Text beside the box, in the platform's own body type, or `null` for a bare
   * checkbox. It is part of the control and of its size on both platforms, and on
   * Android it is also the box's accessible name when `accessibilityLabel` is unset
   * - a bare Android checkbox would otherwise have no name at all.
   */
  label: string | null;
  /** Disable interaction (and show the disabled style). No event fires. */
  disabled: boolean;
  /**
   * RN-processed (`processColor`) ARGB color for the "on" accent, or `null` for
   * the platform default: SwiftUI `.tint()` / Compose `Checkbox(checkedColor:)`.
   * Switch's convention (`docs/components/switch.md`).
   */
  tintColor: number | null;
  /** Forwarded to the native view so tests and a11y tools can find it. */
  testID: string | null;
  /** Accessibility label of the control itself, or `null` to use `label`. */
  accessibilityLabel: string | null;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
  /**
   * Called on every user interaction with the value native now displays, plus
   * native's event count (the JS wrapper echoes it back as
   * `mostRecentEventCount`).
   *
   * Callback props are the one exception to the no-optional rule above, and
   * `| null` is not an alternative (D7b, `NitroUiSwitchProps.onValueChange`). The
   * JS wrapper therefore always sends a callback (see `useControlled`) and
   * `undefined` instead of `null` when there is none.
   */
  onCheckedChange?: (checked: boolean, eventCount: number) => void;
}

export interface NitroUiCheckboxMethods extends HybridViewMethods {
  /**
   * The size of the hosted control, as measured on the UI thread during the last
   * layout/commit. Never calls into SwiftUI/Compose: JS reads a cached value, so
   * this is safe to call from the JS thread (core-architecture §1.4).
   */
  measureContent(): NitroUiCheckboxSize;

  /**
   * TEMPORARY, test-only: toggle the box through the same path a tap takes -
   * M3's `onCheckedChange` / the Toggle's binding - optimistic, with a fresh event
   * count, so a change JS refuses still reverts. Refused while disabled, as a tap
   * is.
   *
   * It exists for one platform's harness: a harness tap is a `UITouch` with no HID
   * event behind it, which SwiftUI's gesture refuses (`Button.harness.tsx` measured
   * it, and a `.switch` Toggle is a gesture). The real tap is `real-input:ios`'s
   * job. Runs on the UI thread, like a tap; a call from JS hops there and returns
   * at once.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestToggle(): void;

  /**
   * TEMPORARY, test-only: read the control's accessibility node on the UI thread
   * and keep the answer for `nuiTestStateReport`. Returns at once (the Chip's
   * `nuiTestProbeAccessibility` pair has the same shape, for the same reason: a
   * Nitro method never blocks for main).
   *
   * Android reads the merged Compose semantics node a reader is handed. iOS has
   * nothing to read in-process - the SwiftUI hosting view answers
   * `accessibilityElements == []` to anything that is not an accessibility client
   * (`HybridNitroUiSlider.swift` measured it, and the Chip's probe found the same)
   * - so iOS records `a11y=unavailable` and the role and checked value are asserted
   * by XCUITest in `real-input:ios`.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestProbeAccessibility(): void;

  /**
   * TEMPORARY, test-only: what the checkbox is showing, as one line -
   * `displayed=<0|1|mixed|none>;probes=<n>;merged=<0|1|none>;a11y=<...>`.
   *
   * `displayed` is written where the control is drawn (the SwiftUI body, the
   * composable), so it is a reading of the hosted control rather than an echo of a
   * prop: the handle's `checked` answers what React sent. `none` until the control
   * has drawn; `mixed` is Android's indeterminate, which iOS never draws.
   * `probes` counts the answers `nuiTestProbeAccessibility` has stored, so a test
   * can tell a fresh one from the last; `merged` is whether Android found one
   * focusable node for a labelled checkbox or two (1 = one node, which is what
   * TalkBack needs); `a11y` is that answer (Android:
   * `role=<role>,checked=<bool|none>,toggle=<On|Off|Indeterminate|none>,disabled=<bool>,clickable=<bool>,label=<text>`).
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestStateReport(): string;
}

/**
 * A size in platform units (iOS points / Android density-independent pixels).
 *
 * @internal Only reachable through a Hybrid View, which v0.1 does not expose
 * publicly (DECISIONS D14).
 *
 * The shape is per-component on purpose, like `NitroUiChipSize`: nitrogen
 * generates one struct per name, and a shared type in one component's spec file
 * would make every other component import that component's spec.
 */
export interface NitroUiCheckboxSize {
  width: number;
  height: number;
}

/**
 * The Hybrid View React renders as `NitroUiCheckbox`.
 *
 * @internal Hybrid Views and their settable props are not public (DECISIONS
 * D14): it is exported for this repo's example, harness and smoke apps, and for
 * the typed `hybridRef` handle, and is not semver surface.
 */
export type NitroUiCheckbox = HybridView<
  NitroUiCheckboxProps,
  NitroUiCheckboxMethods
>;

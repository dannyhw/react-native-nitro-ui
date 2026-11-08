import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';

/**
 * One item of the group, as the native side sees it.
 *
 * The caller writes objects (`ButtonGroup.tsx`); they cross as one typed struct
 * array, because that is the composite prop shape this repo has generation for
 * (`Menu.nitro.ts`'s `rows` states the case: a struct vector is a real
 * `ReactProp`, compared after conversion, so the items never travel as a JSON
 * string — lint `no-json-string-prop`, `no-anymap-in-spec`).
 *
 * Every member is required. A struct with optional members would let the native
 * side ask "absent or false?" about an item a JS spread produced, and D7 keeps
 * that question out of props (nitro#1184: a prop that can vanish between two
 * commits is a crash).
 *
 * What is *not* in here is the checked state: that is a controlled value and
 * travels separately, so that one item's state change cannot cost the whole
 * array a new identity (see `NitroUiButtonGroupProps.checkedIds`).
 */
export interface NitroUiButtonGroupItem {
  /**
   * The item's stable id, unique across the group. `onPress` and
   * `onCheckedChange` report it, the checked set is made of it, and a harness
   * gate names an item by it rather than by an index.
   */
  id: string;
  /**
   * The item's text: what is drawn, what a screen reader reads, and the text of
   * the overflow row when the item does not fit in the row.
   */
  title: string;
  /**
   * SF Symbol name, or `null`. **iOS only** — Android has no SF Symbols and takes
   * the drawable in `androidIcon` instead, so each platform draws its own glyph
   * and a caller names both on one item (the Button convention).
   */
  systemImage: string | null;
  /**
   * Android glyph, resolved by the wrapper to one string: a resource name, a
   * `res:` name the bundler derived from an asset path, or a `url:` the dev server
   * serves (`src/iconSource.ts`, DECISIONS D43). **Android only.**
   */
  androidIcon: string | null;
  /** Disable this one item. It draws disabled and reports nothing. */
  disabled: boolean;
  /**
   * Whether the item is a toggle rather than an action. A toggle shows a checked
   * state and reports `onCheckedChange`; an action reports `onPress`.
   */
  toggle: boolean;
}

/**
 * Native props of the `NitroUiButtonGroup` Hybrid View.
 *
 * No member is optional (DECISIONS D7 / nitro#1184) except the callbacks (D7b):
 * Fabric sends `null` for a prop that JS removed and Nitro only treats
 * `undefined` as "unset", so an optional prop that goes away crashes. The JS
 * wrapper (`ButtonGroup.tsx`) always sends every prop, using `null` for "not set"
 * and `[]` for "none" — a missing `items` would leave a recycled view showing the
 * previous mount's row.
 *
 * The value half is the event-count handshake (`docs/architecture/core.md` §4),
 * spelled for a *set* instead of a single value: native flips a toggle at once and
 * emits `(id, checked, eventCount)`; a `checkedIds` write is honoured only once
 * native has seen that many of its own events, which is what makes a change JS
 * refused snap back instead of stranding the item.
 *
 * Setters must not interpret one prop against another (Nitro does not order props
 * inside a batch — core.md §3), so `items`, `checkedIds`, `controlledIds` and
 * `defaultCheckedIds` are stored raw and reconciled together in `afterUpdate()`.
 */
export interface NitroUiButtonGroupProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  /**
   * The items, in render order. Always sent; `[]` draws an empty row.
   *
   * They are the control's size, so the wrapper's `nuiSizingKey` carries one
   * field per item (`docs/architecture/sizing.md`, "Building `nuiSizingKey`").
   */
  items: NitroUiButtonGroupItem[];
  /**
   * `'standard'` or `'connected'`, resolved by the wrapper.
   *
   * Android: 12 dp of space and each item's own corner, versus Material's 2 dp
   * connected corners. iOS: a row of bordered buttons, versus SwiftUI's
   * `ControlGroup` (`docs/components/button-group.md`).
   */
  appearance: string;
  /**
   * One of `'filled' | 'tonal' | 'outlined' | 'text' | 'elevated'` — the same
   * ladder `Button` sends, resolved by the wrapper.
   *
   * **Android and iOS `standard`.** An iOS connected group ignores it: measured
   * (`docs/tasks/Q9-buttongroup-iconbutton-design.report.md` Appendix A) that
   * `ControlGroup` ignores `.buttonStyle` and `.tint` entirely, so a variant that
   * cannot be drawn is documented rather than faked.
   */
  variant: string;
  /**
   * One of `'small' | 'medium' | 'large' | 'xlarge' | 'xxlarge'`, resolved.
   *
   * Android and iOS `standard`, for the same reason as `variant`: a connected
   * `ControlGroup` measured 31 pt at every `.controlSize`.
   */
  size: string;
  /**
   * `'automatic' | 'titleOnly' | 'iconOnly' | 'titleAndIcon'`, resolved.
   *
   * `automatic` is each platform's own default, which differs: a connected iOS
   * group draws icons only as soon as an item has one, and iOS standard and
   * Android draw icon and title. `docs/components/button-group.md` prints what
   * each platform does with each value.
   */
  labelStyle: string;
  /**
   * Disable the whole group. No item is reachable and no event fires; an open
   * overflow menu closes (D29's rule, as on Menu).
   */
  disabled: boolean;
  /**
   * RN-processed (`processColor`) ARGB colour, or `null` for the platform default:
   * the variant's container colour on Android, SwiftUI `.tint()` on an iOS
   * standard row. **Ignored by a connected iOS group** (measured).
   */
  tintColor: number | null;
  /**
   * The ids of the toggle items a *controlled* group is showing as checked.
   *
   * Built by the wrapper from the items whose `checked` is a boolean, so an item
   * absent here is either uncontrolled or not a toggle at all.
   */
  checkedIds: string[];
  /**
   * The ids of the toggle items whose `checked` is a boolean — the only ids a
   * write to `checkedIds` may move. An item not listed here keeps whatever state
   * the user gave it, which is what lets controlled and uncontrolled items
   * coexist in one group.
   */
  controlledIds: string[];
  /**
   * The ids of the *uncontrolled* toggle items that start checked. Native applies
   * this once, when it first sees an item, and never again — re-applying it would
   * let a re-render undo what the user just did.
   */
  defaultCheckedIds: string[];
  /**
   * The last event count JS has fully processed (core-architecture §4). Native
   * only accepts a `checkedIds` write once it has seen this many of its own
   * events.
   */
  mostRecentEventCount: number;
  /**
   * The name of the iOS "More" button, or `null` for the default. Android's
   * overflow indicator carries Material's own localised label and needs nothing.
   */
  overflowAccessibilityLabel: string | null;
  /** The group's own accessibility label, or `null`. */
  accessibilityLabel: string | null;
  /** Forwarded to the native view so tests and a11y tools can find it. */
  testID: string | null;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
  /**
   * An action item's tap — from the row or from an overflow row. Nothing fires
   * for a disabled group or item, and nothing fires for a toggle item, which
   * reports `onCheckedChange` instead.
   *
   * Optional for the reason `NitroUiSwitchProps.onValueChange` spells out (D7b),
   * and always sent: a stable no-op when the caller passed none, so a recycled
   * view cannot keep the previous mount's handler.
   */
  onPress?: (id: string) => void;
  /**
   * A toggle item's change: the id, the state native now displays, and native's
   * event count (echoed back as `mostRecentEventCount`). Optional (D7b), always
   * sent.
   */
  onCheckedChange?: (id: string, checked: boolean, eventCount: number) => void;
}

export interface NitroUiButtonGroupMethods extends HybridViewMethods {
  /**
   * The size of the hosted control, as measured on the UI thread during the last
   * layout/commit. Never calls into SwiftUI/Compose: JS reads a cached value, so
   * this is safe to call from the JS thread (core-architecture §1.4).
   *
   * The width is the box's (the control is `fillWidth`); the height is the row's
   * measured height, which is the number the engine caches.
   */
  measureContent(): NitroUiButtonGroupSize;

  /**
   * TEMPORARY, test-only: press `id` through the same path a tap takes — a toggle
   * item's optimistic flip with a fresh event count, or an action item's
   * `onPress`. Refused while the group or the item is disabled, as a tap is.
   *
   * It exists for iOS's reason (Button's and IconButton's wording): a harness tap
   * is a `UITouch` with no HID event behind it, which SwiftUI's button gesture
   * refuses. An item that overflowed is reachable here too, which is the only way
   * a harness can ask what an item that did not fit in the row does when pressed.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestPressItem(id: string): void;

  /**
   * TEMPORARY, test-only: ask what the row *drew*, and keep the answer for
   * `nuiTestStateReport`. Returns at once, because a Nitro method may not block
   * for the UI thread.
   *
   * This is how "an item that does not fit moved into the overflow menu" is
   * proved. It cannot be read from the props — the items array is the same array
   * either way — and on Android it cannot be read from Material's own state at
   * all: which items overflowed lives in `ButtonGroupOverflowState`, which the
   * artifact keeps private. So both platforms report what their own row laid out,
   * from where it was laid out (iOS: which `ViewThatFits` candidate was chosen;
   * Android: which items the measure policy placed).
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestProbeRow(): void;

  /**
   * TEMPORARY, test-only: read the group's accessibility nodes on the UI thread
   * and keep the answer for `nuiTestStateReport`. Returns at once.
   *
   * Android enumerates the merged Compose semantics nodes a reader is handed —
   * which is how "an icon-only item is still named by its title" and "a toggle
   * item reads as a checkbox" are proved there. iOS has nothing to read
   * in-process (the hosting view answers `accessibilityElements == []` to anything
   * that is not an accessibility client, as `HybridNitroUiSlider.swift` measured),
   * so iOS answers `a11y=unavailable` and the labels are read by the a11y sweep in
   * `real-input:ios`.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestProbeAccessibility(): void;

  /**
   * TEMPORARY, test-only: what the control is showing, as one line —
   * `checked=<a,b|none>;visible=<n>;overflow=<0|1>;menu=<open|closed>;probes=<n>;`
   * `a11y=<...>`.
   *
   * `checked` is read where the items are drawn, so it is a reading of the hosted
   * control rather than an echo of a prop (`hybridRef`'s `checkedIds` answers what
   * React sent). `visible` / `overflow` are the last `nuiTestProbeRow` reading;
   * `menu` is whether the overflow menu is open. `probes` counts the probes so a
   * test can tell its own answer from the previous control's.
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
export interface NitroUiButtonGroupSize {
  width: number;
  height: number;
}

/**
 * The Hybrid View React renders as `NitroUiButtonGroup`.
 *
 * @internal Hybrid Views and their settable props are not public (DECISIONS D14):
 * exported for this repo's example, harness, bench and smoke apps, and for the
 * typed `hybridRef` handle; not semver surface.
 */
export type NitroUiButtonGroup = HybridView<
  NitroUiButtonGroupProps,
  NitroUiButtonGroupMethods
>;

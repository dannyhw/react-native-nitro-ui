import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';

/**
 * One row of a menu, as the native side sees it.
 *
 * The caller writes a nested `group` (`Menu.tsx`); the wrapper flattens it into
 * one ordered array of these, because:
 *
 * - a struct **array** is the one composite prop shape this repo has generation
 *   for (`HybridNitroUiPickerComponent.hpp` carries `ReactProp<std::vector<std::string>>`,
 *   compared after conversion), and nitrogen keeps a struct vector equatable, so
 *   `rows` is a real `ReactProp` and never a JSON string (lint
 *   `no-json-string-prop`, `no-anymap-in-spec`);
 * - the nesting the public API has is exactly two levels deep, so a parent
 *   pointer carries it: `parentId` is the submenu's or section's id, `null` at
 *   the top level. Depth stays capped at one submenu level (DECISIONS D29);
 * - every member is required, so no row can arrive half-built. A struct with
 *   optional members would make the native side ask "absent or false?" for a row
 *   that a JS spread produced, and D7 exists to keep that question out of props.
 *
 * `kind` is a `string` rather than a union because that is how this repo names an
 * enumerated native prop (`variant` on Button, Picker and Progress): nitrogen has
 * no string-literal unions, and the wrapper resolves anything unrecognised before
 * it sends.
 */
export interface NitroUiMenuRow {
  /**
   * The row's stable id, unique across the menu's rows. A pick reports it, and a
   * re-ordered list keeps each row's identity - which is what makes a harness
   * gate name a row instead of an index.
   */
  id: string;
  /**
   * `'action'`, `'submenu'` or `'section'`. Anything else behaves as `'action'`.
   *
   * A `'submenu'` owns the rows whose `parentId` is its id: iOS nests them,
   * Android paints them inline under a divider (D29). A `'section'` is a header
   * row that owns rows the same way, and renders as a group on both platforms.
   */
  kind: string;
  /** The row's text. */
  title: string;
  /**
   * The id of the `'submenu'` or `'section'` this row belongs to, or `null` for a
   * top-level row. The array is in render order, so a child directly follows its
   * parent; the pointer is what says so rather than hoping.
   */
  parentId: string | null;
  /** Disable this row. It draws disabled and reports nothing. */
  disabled: boolean;
  /** Draw the row as destructive (iOS red, Material 3 error colour). */
  destructive: boolean;
  /** Leading SF Symbol name, or `null`. iOS only - Android ignores it. */
  systemImage: string | null;
}

/**
 * Native props of the `NitroUiMenu` Hybrid View.
 *
 * No member is optional (DECISIONS D7 / nitro#1184) except the callbacks
 * (D7b): Fabric sends `null` for a prop that JS removed and Nitro only treats
 * `undefined` as "unset", so an optional prop that goes away crashes. The JS
 * wrapper (`Menu.tsx`) always sends every prop, using `null` for "not set" and
 * `[]` for "no rows" - a missing `rows` would leave a recycled view showing the
 * previous row's menu.
 *
 * There is **no** controlled value and no event-count handshake: a menu reports
 * gestures (`onSelect`), not a state change JS can reject - Button's reasoning
 * (`Button.nitro.ts:17-19`, `docs/architecture/core.md` §12). Open state is not a
 * prop either (D29: no imperative `open()`/`close()` in 0.4).
 *
 * Setters must not interpret one prop against another (Nitro does not order
 * props inside a batch - core.md §3), so `rows`, `disabled` and
 * `hasPrimaryAction` are stored raw and applied together in `afterUpdate()`.
 */
export interface NitroUiMenuProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  /**
   * The trigger's text - the same label a Button draws, sized the same way. Also
   * the default accessibility label.
   */
  title: string;
  /**
   * One of `'filled' | 'tonal' | 'outlined' | 'text' | 'elevated'`, resolved to
   * one of those five by the wrapper. The trigger reuses Button's label
   * composition, so the box *is* a Button's box.
   */
  variant: string;
  /**
   * One of `'small' | 'medium' | 'large'`, resolved by the wrapper. SwiftUI
   * `.controlSize` / Android content padding + label typography.
   */
  size: string;
  /**
   * Disable interaction. No row is reachable, no event fires, and an open menu
   * closes (DECISIONS D29, D32) - a control that answers nothing cannot own a live
   * popup, the rule Picker and DatePicker already keep.
   *
   * Closing an open menu is **Android only**. There the popup is our own window; on
   * iOS SwiftUI owns the presentation, so nothing here can dismiss it and nothing can
   * report that it did. That is a platform limit, not a choice, and D32 accepts it as
   * one - see `docs/components/menu.md` ("Limits").
   */
  disabled: boolean;
  /**
   * The items, flattened and in render order by the wrapper. Always sent; `[]`
   * renders a trigger with an empty menu.
   *
   * Deliberately **not** part of `nuiSizingKey`: the items never change the
   * trigger's box (they live in a popup), and free-form text in the key would
   * fragment the size cache (`docs/components/menu.md`).
   */
  rows: NitroUiMenuRow[];
  /**
   * RN-processed (`processColor`) ARGB color for the trigger, or `null` for the
   * platform default: SwiftUI `.tint()` / the variant's container colour.
   */
  tintColor: number | null;
  /**
   * Leading SF Symbol name on the trigger, or `null`. iOS only - ignored on
   * Android, exactly as it is on Button, so it never changes the label's text.
   */
  systemImage: string | null;
  /**
   * Whether `primaryAction` means anything. iOS only (DECISIONS D29): a tap runs
   * the action and a long-press opens the menu. Android ignores it and always
   * opens on tap.
   *
   * This is a separate prop because `primaryAction` is *always sent* (D7b: a
   * callback prop can never be removed), so its presence cannot be the flag - the
   * wrapper sends a stable no-op alongside `false`.
   */
  hasPrimaryAction: boolean;
  /** Forwarded to the native view so tests and a11y tools can find it. */
  testID: string | null;
  /** Accessibility label of the control itself, or `null` to use `title`. */
  accessibilityLabel: string | null;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
  /**
   * Called with the picked row's id. Not called for a disabled row, for a section
   * header, for a submenu, or while the control is disabled.
   *
   * Callback props are the exception to the no-optional rule (D7b): Nitro only
   * unwraps `{ f: fn }` for a prop whose type *is* a function, so this must never
   * become `fn | null`. The wrapper always sends one - a stable no-op when the
   * caller passed nothing - so removing a handler cannot leave the previous one
   * behind.
   */
  onSelect?: (id: string) => void;
  /**
   * Called when the menu opens. **Android only**: a Compose `Popup` is our own
   * window, so `expanded` is model state we set. SwiftUI hands a `Menu` to the
   * system's presentation and its `Menu` has no open binding in the iPhoneOS SDK,
   * so **iOS never fires this** - see `docs/components/menu.md` and DECISIONS D32.
   */
  onOpen?: () => void;
  /**
   * Called when the menu closes, whichever way it closed - a pick, an outside
   * tap, the back gesture, a layout move, or the control being disabled while it
   * was open. **Android only**, for the same reason as `onOpen`: **iOS never fires
   * either of them** (DECISIONS D32).
   *
   * A pick fires it too, so an open never goes unpaired. It fires *after*
   * `onSelect`: the choice is reported first, then the close, so a listener that
   * acts on the pick is never handed a menu that is still up (DECISIONS D32).
   * `docs/tasks/Q1-menu-design.md` §5 worded the pairing as "never for a pick" and
   * D32 supersedes that: every open is paired with one close, including the open a
   * pick ends.
   */
  onClose?: () => void;
  /**
   * The primary action: a tap runs it and a long-press opens the menu. **iOS
   * only** (DECISIONS D29), and only consulted while `hasPrimaryAction` is `true`.
   */
  primaryAction?: () => void;
}

export interface NitroUiMenuMethods extends HybridViewMethods {
  /**
   * The size of the hosted control, as measured on the UI thread during the last
   * layout/commit. Never calls into SwiftUI/Compose: JS reads a cached value, so
   * this is safe to call from the JS thread (core.md §5).
   */
  measureContent(): NitroUiMenuSize;

  /**
   * TEMPORARY, test-only: press the row `id` through the same code path a popup
   * row press uses - refused while the control or the row is disabled, no-op for
   * an id that is not there - so a harness can assert a *real* pick without a
   * touch injector that can reach a row in a popup.
   *
   * Goes through the *selection* path, not the props path, and on Android it is the
   * row's own pick: the choice is reported, then the popup closes (DECISIONS D32).
   * Runs on the UI thread like a real press (core.md §5), so a call from JS hops
   * there.
   *
   * @internal Not app API (DECISIONS D14). Deleted when the harness can press a
   * popup row.
   */
  nuiTestSelectRow(id: string): void;

  /**
   * TEMPORARY, test-only: what this Menu's *popup* and its anchor are, as the
   * side that renders them measured them. One line:
   *
   * ```
   * expanded=<0|1|-1>;live=<n|-1>;anchor=<l>,<t>,<r>,<b>;menu=<l>,<t>,<r>,<b>;rows=<n|-1>;drawn=<tree|-1>
   * ```
   *
   * `expanded` is the model's own flag. `live` is how many menus this **process**
   * has composed right now - process-wide on purpose, because the question the
   * number answers is "did a popup outlive the view that opened it?", and a mount
   * dropped mid-menu has nothing left to ask: the next mount reads the leak.
   * `anchor`/`menu` are screen pixel rects as the composing side measured them, and
   * `rows` is how many rows the menu has. `drawn` is what ``nuiTestMenuProbe`` last
   * found in the platform's own menu. `-1` means "this platform cannot measure
   * that".
   *
   * Android answers with the first five, and `-1` for `drawn`: its `rows` is
   * already read from the rows the popup composed. iOS answers `rows` from its
   * model, `drawn` from the probe, and `-1` for the other four: SwiftUI keeps a
   * `Menu`'s open state and its window to itself, so there is no popup here to
   * measure - the same answer `HybridNitroUiPicker.nuiTestMenuReport` gives, and
   * never a `0` that would read as "checked".
   *
   * `drawn`'s tree, written in the menu's order with `,` between siblings: a row is
   * its title, with `!` after it when it is destructive and `~` when it is
   * disabled; an inline group (a section) is `(<title>:<rows>)`, with an empty
   * title for an untitled one; a submenu is `{<title>:<rows>}`; anything else is
   * `?`. Titles are written as they are, so a fixture that reads this keeps `,`,
   * `:`, `;`, `!`, `~` and brackets out of its titles.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestMenuReport(): string;

  /**
   * TEMPORARY, test-only: read the menu the platform itself builds from this
   * control's rows, for ``nuiTestMenuReport``'s `drawn` field.
   *
   * On iOS a SwiftUI `Menu` is drawn by UIKit: SwiftUI turns the content into a
   * `UIMenu` on the trigger's `UIButton`, and only when the menu is presented, so
   * that tree - not the model's rows - is what a person sees. The probe opens the
   * menu with `UIControl.performPrimaryAction()` (iOS 17.4), copies the tree, and
   * dismisses it again in the same main-thread turn. A Menu with a
   * `primaryAction`, a disabled one, an OS below 17.4, or a trigger whose button
   * cannot be found leaves `drawn` at `-1`, because pressing those would act
   * rather than open, or cannot be done. Runs on the UI thread, so a call from JS
   * hops there; poll the report for the answer.
   *
   * Android has no second renderer to ask - its `rows` already counts the
   * composed rows - so this is a no-op there and `drawn` stays `-1`.
   *
   * @internal Not app API (DECISIONS D14). Deleted when the harness can open a
   * SwiftUI `Menu` and read its rows itself.
   */
  nuiTestMenuProbe(): void;
}

/**
 * A size in platform units (iOS points / Android density-independent pixels).
 *
 * @internal Only reachable through a Hybrid View, which v0.1 does not expose
 * publicly (DECISIONS D14).
 *
 * The shape is per-component on purpose, like `NitroUiButtonSize` and
 * `NitroUiPickerSize`: nitrogen generates one struct per name, and a shared type
 * in one component's spec file would make every other component import that
 * component's spec.
 */
export interface NitroUiMenuSize {
  width: number;
  height: number;
}

/**
 * The Hybrid View React renders as `NitroUiMenu`.
 *
 * @internal v0.1 does not expose Hybrid Views or their settable props publicly
 * (DECISIONS D14): it is exported for this repo's example, harness, bench and
 * smoke apps, and for the typed `hybridRef` handle, and is not semver surface.
 */
export type NitroUiMenu = HybridView<NitroUiMenuProps, NitroUiMenuMethods>;

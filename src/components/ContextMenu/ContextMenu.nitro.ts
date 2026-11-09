import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiMenuRow } from '../Menu/Menu.nitro';

/**
 * Native props of the `NitroUiContextMenu` Hybrid View.
 *
 * A ContextMenu is a `View` whose React Native children stay where Yoga put them and
 * which opens a menu of Menu's rows on a long press (`docs/tasks/Q6-contextmenu-design.report.md`,
 * DECISIONS D36/D37): `UIContextMenuInteraction` on the generated component view on iOS,
 * a Material 3 `DropdownMenu` anchored at the press point on Android.
 *
 * No member is optional (DECISIONS D7 / nitro#1184) except the callbacks (D7b). The
 * wrapper (`ContextMenu.tsx`) always sends every prop, `null` for "not set" and `[]`
 * for "no rows".
 *
 * There is no `testID`, `accessibilityLabel` or `style` here, unlike every leaf
 * control: the wrapper *is* the box React Native styles - the generated component view
 * on iOS, a `ReactViewGroup` under a `ReactViewManager` on Android - so React Native's
 * own `View` props land on exactly the view that carries the menu.
 *
 * No controlled value and no handshake (Button's and Menu's reasoning): a menu reports
 * a gesture, and there is no `open()` (D29, D36 item 3). Setters store raw values and
 * `afterUpdate()` applies them together, because Nitro does not order props in a batch.
 */
export interface NitroUiContextMenuProps extends HybridViewProps {
  /**
   * Menu's flattened rows (`MenuRows.ts`'s `flattenGroup`), in render order. Always
   * sent; `[]` means no menu at all - a long press then does nothing and the children
   * keep the gesture.
   */
  rows: NitroUiMenuRow[];
  /**
   * A header over the rows, or `null`: the root `UIMenu`'s title on iOS, a header row
   * on Android.
   */
  title: string | null;
  /**
   * No menu: a long press does nothing, the children keep every gesture of their own,
   * and an open menu closes (both platforms - UIKit has `dismissMenu`, unlike SwiftUI's
   * `Menu`, so D32's iOS limit does not apply here).
   */
  disabled: boolean;
  /**
   * The corner radius of the lifted preview on iOS, in points: the flattened style's
   * `borderRadius`, sent by the wrapper (DECISIONS D37 item 3). `null` draws square
   * corners. React Native leaves `layer.cornerRadius` at 0 whenever the view has a
   * visible border (it draws the border in a layer of its own), so the native side
   * never reads it there. Android ignores it: its menu is a popup, with no preview.
   */
  previewCornerRadius: number | null;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
  /**
   * Called with the picked row's id. Not called for a disabled row, a section header,
   * a submenu, or while the control is disabled. Fires before `onClose` (D32).
   */
  onSelect?: (id: string) => void;
  /**
   * Called when the menu opens, on **both** platforms: iOS `willDisplayMenu`, Android
   * the long press's recognition. A tap, or an iOS hold released before the lift,
   * fires nothing.
   */
  onOpen?: () => void;
  /**
   * Called once for every `onOpen`, however the menu closed: a pick (after
   * `onSelect`), an outside tap, back, `disabled`, a layout move (Android) or the view
   * being dropped.
   */
  onClose?: () => void;
}

export interface NitroUiContextMenuMethods extends HybridViewMethods {
  /**
   * TEMPORARY, test-only: pick the row `id` through the same path a row press takes -
   * refused while the control or the row is disabled, no-op for an unknown id - and on
   * an open menu the close that follows it. Hops to the UI thread.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestSelectRow(id: string): void;

  /**
   * TEMPORARY, test-only: read the menu this platform would be handed right now into
   * the report's `drawn` field. iOS runs this view's own configuration provider and
   * action provider and writes the `UIMenu` tree in Menu's `drawn=` notation
   * (`Menu.nitro.ts`), or `nil` when the provider refuses (disabled, no rows). Android
   * has no second renderer to ask, and answers `drawn=-1`; its `rows` field counts the
   * rows an open popup composed. Hops to the UI thread.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestMenuProbe(): void;

  /**
   * TEMPORARY, test-only: one line describing this ContextMenu as the platform sees
   * it, `key=value` pairs separated by `;` (`ContextMenu.harness.tsx` parses it):
   *
   * - `open`, `opens`, `closes`, `selects`: the model's flag and its counters;
   * - `box`: the wrapper's size, and `kids`: each React Native child's native frame
   *   relative to the wrapper, `<testID>@x,y,w,h` joined by `|`, in platform units;
   * - `rows`: pickable rows (iOS: the model's; Android: the open popup's, else the
   *   model's), `drawn`: the probe's last answer;
   * - `interaction` (iOS): whether the component view still carries this view's
   *   interaction; `ax`: whether the wrapper is an accessibility element; `a11yAction`
   *   (Android): the label of the long-click action its node offers, `none` for none and
   *   `-` for an unlabelled one;
   * - `press`, `menu` (Android): the last press point and the open popup's window,
   *   screen px; `live`: popups this process has composed right now (Menu's rule);
   * - `arms`: long presses armed since mount (Android), `armed`: one is pending now,
   *   `copies`: `MotionEvent` copies since mount (Android, made only while one is);
   * - `watchStray` (Android): runs of a layout-move listener whose menu was closed or
   *   whose view had left its window, process-wide - a leaked registration;
   * - `seq`: reports this object has built.
   *
   * A field a platform cannot answer reads `-1`, never `0`. Reads a snapshot published
   * on the UI thread, so it is safe from the JS thread and never waits. Nothing builds
   * that snapshot until the first read asks for it (an app never does), so the first
   * read answers `pending`.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestContextMenuReport(): string;

  /**
   * TEMPORARY, test-only: Android performs `ACTION_LONG_CLICK` on the wrapper - the
   * action TalkBack's double-tap-and-hold sends. A no-op on iOS, where the menu's
   * accessibility action is UIKit's, derived from the interaction (nothing here can
   * perform it). Hops to the UI thread.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestA11yLongClick(): void;

  /**
   * TEMPORARY, test-only: sample the pixels the **open menu** is drawing, looking for
   * `color`, and keep the answer for ``nuiTestMenuPixelReport``. Returns at once.
   *
   * Menu's method of the same name, for the same reason: a row's `androidIcon` is a
   * drawing contract, and the rows live in a popup window of their own, so nothing
   * readable on this wrapper says whether a glyph was painted. With no popup open the
   * report says `no popup`, and iOS - whose menu UIKit draws in a window this process
   * cannot rasterise - says `no pixels`.
   *
   * @internal Not app API (DECISIONS D14). Deleted when the harness can read pixels.
   */
  nuiTestMenuPixelProbe(color: number): void;

  /**
   * TEMPORARY, test-only: what the last ``nuiTestMenuPixelProbe`` found, in Button's
   * shape - `n=<probes> size=<w>x<h> want=#<RRGGBB> hits=<n> mean=#<RRGGBB>
   * closest=#<RRGGBB>`, plus the `no popup` / `no pixels` refusals. Empty before the
   * first probe.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestMenuPixelReport(): string;
}

/**
 * The Hybrid View React renders as `NitroUiContextMenu`.
 *
 * @internal Not semver surface (DECISIONS D14): exported for this repo's example,
 * harness and bench apps, and for the typed `hybridRef` handle.
 */
export type NitroUiContextMenu = HybridView<
  NitroUiContextMenuProps,
  NitroUiContextMenuMethods
>;

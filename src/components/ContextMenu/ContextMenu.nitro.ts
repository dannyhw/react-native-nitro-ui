import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiMenuRow } from '../Menu/Menu.nitro';

/**
 * Native props of the `NitroUiContextMenu` Hybrid View.
 *
 * No prop is optional except the callbacks: a removed prop arrives as `null`,
 * which crashes an optional one (nitro#1184), and Nitro only unwraps a callback
 * prop whose type is a plain function. The wrapper always sends every prop,
 * with `null` for "not set" and `[]` for "no rows".
 *
 * There is no `testID`, `accessibilityLabel` or `style`: this view is the box
 * React Native styles, so React Native's own `View` props land on it.
 *
 * Nitro does not order props inside a batch, so setters store raw values and
 * `afterUpdate()` applies them together.
 */
export interface NitroUiContextMenuProps extends HybridViewProps {
  /**
   * Menu's flattened rows, in render order. `[]` means no menu: a long press
   * does nothing and the children keep the gesture.
   */
  rows: NitroUiMenuRow[];
  /**
   * A header over the rows, or `null`: the root `UIMenu`'s title on iOS, a header row
   * on Android.
   */
  title: string | null;
  /**
   * No menu: a long press does nothing, the children keep their own gestures,
   * and an open menu closes.
   */
  disabled: boolean;
  /**
   * The corner radius of the lifted preview on iOS, in points, or `null` for
   * square corners. Sent by the wrapper from the style's `borderRadius`, because
   * React Native leaves `layer.cornerRadius` at 0 when the view has a visible
   * border. Android ignores it: its menu is a popup with no preview.
   */
  previewCornerRadius: number | null;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
  /**
   * Called with the picked row's id, before `onClose`. Not called for a disabled
   * row, a section header, a submenu, or while the control is disabled.
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
   * Test-only: pick the row `id` through the path a row press takes, including
   * the close that follows on an open menu. Refused while the control or the row
   * is disabled; a no-op for an unknown id. Hops to the UI thread.
   *
   * @internal Not app API.
   */
  nuiTestSelectRow(id: string): void;

  /**
   * Test-only: read the menu the platform would be handed right now into the
   * report's `drawn` field. iOS writes the `UIMenu` tree in Menu's `drawn=`
   * notation, or `nil` when there is no menu (disabled, no rows). Android answers
   * `drawn=-1`; its `rows` field counts the rows an open popup composed. Hops to
   * the UI thread.
   *
   * @internal Not app API.
   */
  nuiTestMenuProbe(): void;

  /**
   * Test-only: one line describing this ContextMenu as the platform sees it,
   * `key=value` pairs separated by `;`:
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
   *   screen px; `live`: popups this process has composed right now;
   * - `arms`: long presses armed since mount (Android), `armed`: one is pending now,
   *   `copies`: `MotionEvent` copies since mount (Android, made only while one is);
   * - `watchStray` (Android): runs of a layout-move listener whose menu was closed or
   *   whose view had left its window, process-wide - a leaked registration;
   * - `seq`: reports this object has built.
   *
   * A field a platform cannot answer reads `-1`, never `0`. Reads a snapshot
   * published on the UI thread, so it never waits. The snapshot is built on
   * demand, so the first read answers `pending`.
   *
   * @internal Not app API.
   */
  nuiTestContextMenuReport(): string;

  /**
   * Test-only: Android performs `ACTION_LONG_CLICK` on the wrapper, the action
   * TalkBack's double-tap-and-hold sends. A no-op on iOS, where UIKit derives the
   * accessibility action from the interaction. Hops to the UI thread.
   *
   * @internal Not app API.
   */
  nuiTestA11yLongClick(): void;

  /**
   * Test-only: sample the pixels the open menu is drawing, looking for `color`,
   * and keep the answer for `nuiTestMenuPixelReport`. Returns at once. With no
   * popup open the report says `no popup`; iOS, whose menu is drawn in a window
   * this process cannot rasterise, says `no pixels`.
   *
   * @internal Not app API. Remove once the test harness can read pixels.
   */
  nuiTestMenuPixelProbe(color: number): void;

  /**
   * Test-only: what the last `nuiTestMenuPixelProbe` found:
   * `n=<probes> size=<w>x<h> want=#<RRGGBB> hits=<n> mean=#<RRGGBB>
   * closest=#<RRGGBB>`, or the `no popup` / `no pixels` refusals. Empty before
   * the first probe.
   *
   * @internal Not app API.
   */
  nuiTestMenuPixelReport(): string;
}

/**
 * The Hybrid View React renders as `NitroUiContextMenu`.
 *
 * @internal Not semver surface: exported for this repo's example, tests and
 * benchmarks, and for the typed `hybridRef` handle.
 */
export type NitroUiContextMenu = HybridView<
  NitroUiContextMenuProps,
  NitroUiContextMenuMethods
>;

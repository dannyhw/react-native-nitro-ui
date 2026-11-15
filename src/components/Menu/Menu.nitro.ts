import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';

export interface NitroUiMenuRow {
  /** Unique across the menu's rows. A pick reports it. */
  id: string;
  /** 'action' | 'submenu' | 'section'. Anything else behaves as 'action'. */
  kind: string;
  title: string;
  /**
   * The id of the owning submenu or section, or `null` at the top level. A
   * child directly follows its parent in the array.
   */
  parentId: string | null;
  disabled: boolean;
  destructive: boolean;
  /** Leading SF Symbol name. iOS only. */
  systemImage: string | null;
  /** A drawable resource name or `url:<file>`. Android only. */
  androidIcon: string | null;
  /** Second line. `null` on a submenu or section row. */
  subtitle: string | null;
  /** A boolean makes the row checkable. `null` on a submenu or section row. */
  checked: boolean | null;
}

/**
 * No prop is optional: Fabric sends `null` for a removed prop, which crashes
 * an optional one (nitro#1184). Callbacks are the exception: Nitro only
 * accepts a callback prop typed as a function, never `fn | null`.
 */
export interface NitroUiMenuProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  /** The trigger's text. Also the default accessibility label. */
  title: string;
  /** 'filled' | 'tonal' | 'outlined' | 'text' | 'elevated'. */
  variant: string;
  /** 'small' | 'medium' | 'large' | 'xlarge' | 'xxlarge'. */
  size: string;
  /** Also closes an open menu on Android. iOS cannot dismiss one. */
  disabled: boolean;
  /** Flattened, in render order. `[]` renders a trigger with an empty menu. */
  rows: NitroUiMenuRow[];
  /** A `processColor` ARGB int, or `null` for the platform default. */
  tintColor: number | null;
  /** Leading SF Symbol name on the trigger. iOS only. */
  systemImage: string | null;
  /** A drawable resource name or `url:<file>`. Android only. */
  androidIcon: string | null;
  /**
   * Whether the caller passed a `primaryAction`: the callback is always sent.
   * On Android it turns the trigger into a split button.
   */
  hasPrimaryAction: boolean;
  testID: string | null;
  /** `null` uses `title`. */
  accessibilityLabel: string | null;
  /** Instance id for perf marks; `null` disables them for this view. */
  nuiPerfId: number | null;
  /** Called with the picked row's id. Never for a disabled row. */
  onSelect?: (id: string) => void;
  /** Android only: SwiftUI's `Menu` does not report opening. */
  onOpen?: () => void;
  /** Android only. After `onSelect` when a pick closed the menu. */
  onClose?: () => void;
  /**
   * iOS: a tap runs it and a long-press opens the menu. Android: the leading
   * half of the split button runs it.
   */
  primaryAction?: () => void;
}

export interface NitroUiMenuMethods extends HybridViewMethods {
  /** Reads a size cached on the UI thread; safe to call from the JS thread. */
  measureContent(): NitroUiMenuSize;

  /** Test-only: picks the row through the path a row press takes. @internal */
  nuiTestSelectRow(id: string): void;

  /**
   * Test-only: the popup and its anchor as the rendering side measured them,
   * as one line:
   *
   * ```
   * expanded=<0|1|-1>;live=<n|-1>;anchor=<l>,<t>,<r>,<b>;menu=<l>,<t>,<r>,<b>;rows=<n|-1>;drawn=<tree|-1>;split=<0|1|-1>;leading=<l>,<t>,<r>,<b>;trailing=<l>,<t>,<r>,<b>
   * ```
   *
   * `-1` means the platform cannot measure that: iOS answers only `rows` and
   * `drawn`. `live` counts the menus composed in the whole process. Rects are
   * screen pixels. `split` is whether a split trigger was composed, and
   * `leading`/`trailing` are its halves.
   *
   * `drawn` is what `nuiTestMenuProbe()` last read, in menu order with `,`
   * between siblings. A row is its title, then `@<subtitle>`, `+` when
   * checked, `=` when checkable and unchecked (Android only), `!` when
   * destructive (iOS only) and `~` when disabled. A group is
   * `(<title>:<rows>)`, a submenu `{<title>:<rows>}` (iOS only), a menu's own
   * title `#<title>`, anything else `?`. Titles are not escaped.
   * @internal
   */
  nuiTestMenuReport(): string;

  /**
   * Test-only: reads the menu the platform builds, for the `drawn` field of
   * `nuiTestMenuReport()`. On iOS it opens and dismisses the menu, and leaves
   * `drawn` at `-1` below iOS 17.4, when disabled, or with a `primaryAction`.
   * @internal
   */
  nuiTestMenuProbe(): void;

  /**
   * Test-only: samples the trigger's drawn pixels for `color` on the UI thread
   * and stores the answer for `nuiTestPixelReport()`.
   * @internal
   */
  nuiTestPixelProbe(color: number): void;

  /**
   * Test-only: the last probe's result, empty before the first probe -
   * `n=<probes> size=<w>x<h> want=#<RRGGBB> hits=<n> mean=#<RRGGBB>
   * closest=#<RRGGBB>`, or `n=<probes> no pixels` on iOS.
   * @internal
   */
  nuiTestPixelReport(): string;

  /**
   * Test-only: samples the open menu's drawn pixels for `color` and stores the
   * answer for `nuiTestMenuPixelReport()`. The popup is a separate window.
   * @internal
   */
  nuiTestMenuPixelProbe(color: number): void;

  /**
   * Test-only: the last menu probe's result, in the format of
   * `nuiTestPixelReport()`, or `n=<probes> no popup` when no menu is open.
   * iOS always answers `n=<probes> no pixels`.
   * @internal
   */
  nuiTestMenuPixelReport(): string;
}

/** In platform units (iOS points, Android dp). @internal */
export interface NitroUiMenuSize {
  width: number;
  height: number;
}

/** @internal */
export type NitroUiMenu = HybridView<NitroUiMenuProps, NitroUiMenuMethods>;

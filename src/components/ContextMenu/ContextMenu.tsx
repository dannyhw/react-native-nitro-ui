import type { ReactNode } from 'react';
import { StyleSheet, type ViewProps } from 'react-native';

import type { NitroCallbackProp } from '../../core/useStableCallback';
import { useStableCallback } from '../../core/useStableCallback';
import { useMenuRows, type MenuGroup } from '../Menu/MenuRows';
import { NativeNitroUiContextMenu } from './NativeNitroUiContextMenu';

/**
 * Props of {@link ContextMenu}.
 *
 * Everything a `View` takes, plus the menu. The box is Yoga's, sized by `style` and
 * the children exactly as a `View` with the same props would be: there is no base
 * style and no native measurement (`sizing: null`).
 */
export interface ContextMenuProps extends ViewProps {
  /** The items - Menu's `group`, unchanged (`docs/components/menu.md` "The group"). */
  group: MenuGroup;
  /** The content a long press is made on. Laid out in place, like a `View`'s. */
  children?: ReactNode;
  /**
   * A header over the rows: the menu's title on iOS, a header row on Android.
   * Default: none.
   */
  title?: string | undefined;
  /**
   * No menu: a long press does nothing and the children keep every gesture of their
   * own. An open menu closes, on both platforms. Default: `false`.
   */
  disabled?: boolean | undefined;
  /** Called with the picked row's `id`. Fires before `onClose` (DECISIONS D32). */
  onSelect?: ((id: string) => void) | undefined;
  /** Called when the menu opens - on iOS and on Android. */
  onOpen?: (() => void) | undefined;
  /**
   * Called once for every `onOpen`, however the menu closed. A pick fires `onSelect`
   * first.
   */
  onClose?: (() => void) | undefined;
  /**
   * Access to the native Hybrid Object, for this repo's harness and benchmarks.
   *
   * @internal Not app API (DECISIONS D14). The shape is written inline for the reason
   * `MenuProps.hybridRef` gives: it is `NitroUiContextMenuHandle`, and naming that type
   * here would make api-extractor demand it from the entry point.
   */
  hybridRef?:
    | ((view: {
        readonly disabled: boolean;
        readonly title: string | null;
        readonly previewCornerRadius: number | null;
        /** Test-only row pick, the path a row press takes. `@internal` (D14). */
        nuiTestSelectRow(id: string): void;
        /** Test-only: read the menu UIKit would be handed (iOS). `@internal` (D14). */
        nuiTestMenuProbe(): void;
        /** Test-only witness line - see `ContextMenu.nitro.ts`. `@internal` (D14). */
        nuiTestContextMenuReport(): string;
        /** Test-only: Android's `ACTION_LONG_CLICK` on the wrapper. `@internal` (D14). */
        nuiTestA11yLongClick(): void;
      }) => void)
    | undefined;
  /**
   * Instance id used by native perf marks (`nitroUiCore.drainPerf()`). Benchmark
   * only; `null` turns marks off for this view.
   *
   * @internal Benchmark and diagnostics only - not app API.
   */
  nuiPerfId?: number | null | undefined;
}

/**
 * What the library answers when the caller passed no handler: module-level, so each
 * callback prop is referentially stable and always sent (D7b).
 */
function onSelectNotProvided(): void {
  // Intentionally empty: the caller asked for nothing.
}
function onOpenNotProvided(): void {
  // Intentionally empty: the caller asked for nothing.
}
function onCloseNotProvided(): void {
  // Intentionally empty: the caller asked for nothing.
}

/**
 * The preview's corner radius: the flattened style's `borderRadius`, when it is a
 * number (DECISIONS D37 item 3). A per-corner radius or a percentage is not a
 * uniform radius, so the preview keeps square corners for those rather than guess.
 */
function previewRadiusOf(style: ViewProps['style']): number | null {
  const radius = StyleSheet.flatten(style)?.borderRadius;
  return typeof radius === 'number' && Number.isFinite(radius) && radius > 0
    ? radius
    : null;
}

/**
 * A `View` that opens a menu on a long press: `UIContextMenuInteraction` with the
 * system's lifted preview on iOS, a Material 3 `DropdownMenu` at the finger on
 * Android.
 *
 * The children stay where they are and keep their own gestures: a tap is theirs, and a
 * hold that opens the menu cancels their touch, so a `Pressable` inside never fires
 * `onPress` for it. The items are Menu's `group`, as data (DECISIONS D29, D36).
 *
 * Screen readers reach the menu on the element that carries it, so an app that wants
 * one sets `accessible` (and a label) on the ContextMenu itself - not the default,
 * because that would hide the inner buttons (D36 item 1, `docs/components/context-menu.md`).
 */
export function ContextMenu({
  group,
  title,
  disabled = false,
  onSelect,
  onOpen,
  onClose,
  hybridRef,
  nuiPerfId = null,
  style,
  children,
  ...restProps
}: ContextMenuProps) {
  const rows = useMenuRows(group, 'ContextMenu');
  // Always functions, so every callback prop is always sent (D7b); the casts state what
  // each `??` guarantees, as in `Menu.tsx`.
  const selectCallback = useStableCallback(
    onSelect ?? onSelectNotProvided
  ) as NitroCallbackProp<(id: string) => void>;
  const openCallback = useStableCallback(
    onOpen ?? onOpenNotProvided
  ) as NitroCallbackProp<() => void>;
  const closeCallback = useStableCallback(
    onClose ?? onCloseNotProvided
  ) as NitroCallbackProp<() => void>;
  const hybridRefCallback = useStableCallback(hybridRef);

  return (
    <NativeNitroUiContextMenu
      {...restProps}
      style={style}
      rows={rows}
      title={title ?? null}
      disabled={disabled}
      previewCornerRadius={previewRadiusOf(style)}
      nuiPerfId={nuiPerfId}
      onSelect={selectCallback}
      onOpen={openCallback}
      onClose={closeCallback}
      hybridRef={hybridRefCallback ?? undefined}
    >
      {children}
    </NativeNitroUiContextMenu>
  );
}

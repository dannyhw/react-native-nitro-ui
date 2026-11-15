import type { ReactNode } from 'react';
import { StyleSheet, type ViewProps } from 'react-native';

import type { NitroCallbackProp } from '../../core/useStableCallback';
import { useStableCallback } from '../../core/useStableCallback';
import { useMenuRows, type MenuGroup } from '../Menu/MenuRows';
import { NativeNitroUiContextMenu } from './NativeNitroUiContextMenu';

/**
 * Props of {@link ContextMenu}: everything a `View` takes, plus the menu. It is
 * sized by `style` and its children, as a `View` would be.
 */
export interface ContextMenuProps extends ViewProps {
  /** The menu's items, in the same shape as Menu's `group`. */
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
  /** Called with the picked row's `id`, before `onClose`. */
  onSelect?: ((id: string) => void) | undefined;
  /** Called when the menu opens. */
  onOpen?: (() => void) | undefined;
  /**
   * Called once for every `onOpen`, however the menu closed. A pick fires `onSelect`
   * first.
   */
  onClose?: (() => void) | undefined;
  /**
   * Read-only access to the native view, for tests and benchmarks.
   *
   * @internal
   */
  hybridRef?:
    | ((view: {
        readonly disabled: boolean;
        readonly title: string | null;
        readonly previewCornerRadius: number | null;
        nuiTestSelectRow(id: string): void;
        nuiTestMenuProbe(): void;
        nuiTestMenuPixelProbe(color: number): void;
        nuiTestMenuPixelReport(): string;
        nuiTestContextMenuReport(): string;
        nuiTestA11yLongClick(): void;
      }) => void)
    | undefined;
  /**
   * Instance id for native performance marks; `null` turns them off.
   *
   * @internal
   */
  nuiPerfId?: number | null | undefined;
}

/**
 * Module-level no-ops, so every callback prop is always sent and keeps one
 * identity when the caller passes no handler.
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
 * The style's `borderRadius` when it is a number. A per-corner radius or a
 * percentage is not uniform, so the preview keeps square corners for those.
 */
function previewRadiusOf(style: ViewProps['style']): number | null {
  const radius = StyleSheet.flatten(style)?.borderRadius;
  return typeof radius === 'number' && Number.isFinite(radius) && radius > 0
    ? radius
    : null;
}

/**
 * A `View` that opens a menu on a long press: `UIContextMenuInteraction` with
 * the system's lifted preview on iOS, a Material 3 `DropdownMenu` at the finger
 * on Android.
 *
 * The children stay where they are and keep their own gestures: a tap is
 * theirs, and a hold that opens the menu cancels their touch, so a `Pressable`
 * inside never fires `onPress` for it.
 *
 * Screen readers reach the menu on the element that carries it. To offer it to
 * them, set `accessible` and a label on the ContextMenu itself; that is not the
 * default because it would hide the buttons inside.
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
  // `??` guarantees a function, so none of these is `null`; the casts say so.
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

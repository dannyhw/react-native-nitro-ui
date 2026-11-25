import { useRef } from 'react';

import {
  androidIconResourceName,
  androidIconUrl,
  resolveAndroidIcon,
  type AndroidIconProp,
} from '../../iconSource';
import { warnAndroidIconName } from '../../iconName';
import { warnIosSystemImageName } from '../../systemImageName';
import type { NitroUiMenuRow } from './Menu.nitro';

// The rows of a menu, shared by `Menu` and `ContextMenu`: the public `group`
// types and their flattening into the array native renders.

/**
 * Resolves one row's `androidIcon` into the string native is sent, and warns in
 * development about a name that cannot be a resource name. `componentName` says
 * which control asked.
 */
function resolveRowAndroidIcon(
  componentName: string,
  source: AndroidIconProp | null | undefined
): string | null {
  const resolved = resolveAndroidIcon(source);
  if (
    resolved != null &&
    androidIconUrl(resolved) == null &&
    androidIconResourceName(resolved) == null
  ) {
    warnAndroidIconName(componentName, 'androidIcon', resolved);
  }
  return resolved;
}

/**
 * The row's SF Symbol name as native is sent it, warning in development about a
 * name this iOS cannot draw. `propName` is where the app wrote the name.
 */
function resolveRowSystemImage(
  componentName: string,
  propName: string,
  name: string | undefined
): string | null {
  if (name != null) {
    warnIosSystemImageName(componentName, propName, name);
  }
  return name ?? null;
}

/** A pickable row. Its `id` must be stable and unique across the whole menu. */
export interface MenuAction {
  /** Unique id for this menu. Reported by `onSelect`. */
  id: string;
  /** The row's text. */
  title: string;
  /** Draw it as destructive (iOS red, Material 3 error). Default: `false`. */
  destructive?: boolean | undefined;
  /** Leading SF Symbol name. iOS only - Android ignores it. */
  systemImage?: string | undefined;
  /**
   * Leading glyph for Android: an app-shipped vector drawable, as
   * `require('./icons/share.xml')` or as its resource name (`"share"`), the two
   * forms `Button`'s `androidIcon` takes.
   *
   * Android only - iOS draws `systemImage` and ignores this, so a row with a glyph
   * on both platforms names both and needs no `Platform.select`. It is drawn in the
   * row's content colour. A checked row on Android shows its check in place of the
   * glyph.
   */
  androidIcon?: AndroidIconProp | undefined;
  /** Disable this one row. Default: `false`. */
  disabled?: boolean | undefined;
  /**
   * A second, smaller line under the title: iOS `UIAction.subtitle`, Android the
   * row's supporting text. `null` or absent draws none.
   */
  subtitle?: string | null | undefined;
  /**
   * Draw the row as a checkable one, with a check when `true`: iOS a menu toggle
   * (`UIAction.state`), Android a selected row with a leading check. `null` or
   * absent is a plain row. The menu still has no value: a pick reports the row's `id`
   * through `onSelect`, and the app flips its own state.
   */
  checked?: boolean | null | undefined;
}

/**
 * A row that opens a further list.
 *
 * iOS nests it as a real submenu. Android renders its items inline, as a group
 * titled with the submenu's title. A submenu cannot contain a submenu.
 */
export interface MenuSubmenu {
  /** Unique id for this menu. */
  id: string;
  /** The parent row's text. */
  title: string;
  /** Leading SF Symbol name on the parent row. iOS only. */
  systemImage?: string | undefined;
  /**
   * The rows inside it. A submenu itself takes no `androidIcon`: Android draws
   * its row as a group label, which has no icon.
   */
  items: MenuAction[];
}

/**
 * A group of rows with an optional header: an inline section on iOS, a Material 3
 * Expressive menu group on Android.
 */
export interface MenuSection {
  /** Unique id for this menu. */
  id: string;
  /** The group's header, or `undefined` for a group with no header. */
  title?: string | undefined;
  /** The rows inside it. */
  items: MenuAction[];
}

/**
 * The menu's items, as data.
 *
 * Both fields are optional, and a group can carry both - `actions` first, then
 * `sections`, which is the order the menu draws. An empty group renders a trigger
 * with nothing in it.
 */
export interface MenuGroup {
  /** Top-level rows and submenus, in order. */
  actions?: (MenuAction | MenuSubmenu)[] | undefined;
  /** Titled groups, in order, after `actions`. */
  sections?: MenuSection[] | undefined;
}

type MenuActionOrSubmenu = MenuAction | MenuSubmenu;

/** Is this row a submenu? `items` is the field an action does not have. */
function isSubmenu(row: MenuActionOrSubmenu): row is MenuSubmenu {
  return Array.isArray((row as Partial<MenuSubmenu>).items);
}

/**
 * Flattens the nested `group` into the one ordered array native renders:
 * `actions` first, then `sections`. Children follow their parent and carry its
 * id as `parentId`.
 */
export function flattenGroup(
  group: MenuGroup | undefined,
  componentName = 'Menu'
): NitroUiMenuRow[] {
  const rows: NitroUiMenuRow[] = [];
  const pushAction = (
    action: MenuAction,
    parentId: string | null,
    systemImageProp: string
  ): void => {
    rows.push({
      id: action.id,
      kind: 'action',
      title: action.title,
      parentId,
      disabled: action.disabled === true,
      destructive: action.destructive === true,
      systemImage: resolveRowSystemImage(
        componentName,
        systemImageProp,
        action.systemImage
      ),
      androidIcon: resolveRowAndroidIcon(
        componentName,
        action.androidIcon ?? null
      ),
      subtitle:
        action.subtitle == null || action.subtitle === ''
          ? null
          : action.subtitle,
      checked: action.checked ?? null,
    });
  };
  const pushSubmenu = (row: MenuSubmenu, systemImageProp: string): void => {
    rows.push({
      id: row.id,
      kind: 'submenu',
      title: row.title,
      parentId: null,
      disabled: false,
      destructive: false,
      systemImage: resolveRowSystemImage(
        componentName,
        systemImageProp,
        row.systemImage
      ),
      // A submenu's row has no icon on either platform. The field must still be
      // present (nitro#1184).
      androidIcon: null,
      subtitle: null,
      checked: null,
    });
    for (const item of row.items) {
      pushAction(item, row.id, 'actions[].items[].systemImage');
    }
  };
  for (const row of group?.actions ?? []) {
    if (isSubmenu(row)) pushSubmenu(row, 'actions[].systemImage');
    else pushAction(row, null, 'actions[].systemImage');
  }
  for (const section of group?.sections ?? []) {
    rows.push({
      id: section.id,
      kind: 'section',
      title: section.title ?? '',
      parentId: null,
      disabled: false,
      destructive: false,
      systemImage: null,
      // A section header has no icon on either platform.
      androidIcon: null,
      subtitle: null,
      checked: null,
    });
    for (const item of section.items) {
      pushAction(item, section.id, 'sections[].items[].systemImage');
    }
  }
  return rows;
}

/**
 * A string that is equal for two flattened menus that draw the same. An inline
 * `group` literal is a new object every render, so the memo below compares
 * content rather than identity.
 */
function groupSignature(rows: readonly NitroUiMenuRow[]): string {
  const parts: string[] = [];
  for (const row of rows) {
    parts.push(
      row.id,
      row.kind,
      row.title,
      row.parentId ?? '',
      row.disabled ? 'd' : '',
      row.destructive ? 'x' : '',
      row.systemImage ?? '',
      row.androidIcon ?? '',
      row.subtitle ?? '',
      row.checked == null ? '' : row.checked ? 'c' : 'u'
    );
  }
  return parts.join(' ');
}

/**
 * The flattened rows, with a stable identity: the same array is returned until
 * the menu it describes changes, so an unrelated re-render does not re-send the
 * rows to native. A ref rather than `useMemo`, because the cache key is derived
 * from the result.
 */
export function useMenuRows(
  group: MenuGroup | undefined,
  componentName = 'Menu'
): NitroUiMenuRow[] {
  const flattened = flattenGroup(group, componentName);
  const signature = groupSignature(flattened);
  const cache = useRef<{ signature: string; rows: NitroUiMenuRow[] } | null>(
    null
  );
  const previous = cache.current;
  if (previous != null && previous.signature === signature) {
    return previous.rows;
  }
  cache.current = { signature, rows: flattened };
  return flattened;
}

import { useRef } from 'react';

import {
  androidIconResourceName,
  androidIconUrl,
  resolveAndroidIcon,
  type AndroidIconProp,
} from '../../iconSource';
import { warnAndroidIconName } from '../../iconName';
import type { NitroUiMenuRow } from './Menu.nitro';

/*
 * The rows a menu is made of, shared by `Menu` and `ContextMenu` (DECISIONS D36 item
 * 4): the public `group` types, the flattening into Menu.nitro.ts's `NitroUiMenuRow`
 * array, and the memo that keeps that array's identity stable. Both controls send the
 * same struct array, so the Android `parseMenuRows` and the iOS row builders read one
 * shape, and a change to the rows is a change to both menus.
 */

/**
 * Resolve one row's `androidIcon` into the string native is sent.
 *
 * `Button`'s rules, applied per row (DECISIONS D43 item 2): an asset id becomes a
 * `url:`/`res:` marked string, a typed name is normalised, and a name that could never
 * be a resource name says so in development - native cannot tell that typo from a file
 * the app did not ship, since both are resource id `0`. Named once per control, so the
 * warning says which of the two menus asked.
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
 * A pickable row.
 *
 * `id` is what the menu reports when the row is picked and what a test presses,
 * so it has to be stable and unique across the whole menu - a re-ordered list
 * keeps each row's identity.
 */
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
   * `require('./icons/share.xml')` or as its resource name (`"share"`), the two forms
   * `Button`'s `androidIcon` takes (`docs/components/button.md`, "Android icons").
   *
   * Android only - iOS draws `systemImage` and ignores this, so a row with a glyph on
   * both platforms names both and needs no `Platform.select`. It takes Material's own leading-icon slot
   * (`MenuDefaults.LeadingIconSize`) in the row's content colour, and on a checked
   * Android row the leading check keeps that slot: the check is what the row *means*.
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
 * iOS nests it (a real submenu). Android renders its items inline, as a group of
 * their own titled with the submenu's title, because a second nested popup needs a second anchor and a second witness - the
 * same kind of documented platform difference as Picker's iOS-only `wheel`
 * (DECISIONS D29). Depth stops here: a submenu cannot contain a submenu.
 */
export interface MenuSubmenu {
  /** Unique id for this menu. */
  id: string;
  /** The parent row's text. */
  title: string;
  /** Leading SF Symbol name on the parent row. iOS only. */
  systemImage?: string | undefined;
  /**
   * Leading glyph on the parent row for Android, in either of `Button`'s forms. Android
   * draws a submenu's rows inline (DECISIONS D29), so this row is a group row there and
   * takes the same slot as an action does.
   */
  androidIcon?: AndroidIconProp | undefined;
  /** The rows inside it. */
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
 * The menu's items, as data: never JSON, and never child views.
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

/** What a caller passed for a top-level row: an action, or a submenu. */
type MenuActionOrSubmenu = MenuAction | MenuSubmenu;

/** Is this row a submenu? `items` is the field an action does not have. */
function isSubmenu(row: MenuActionOrSubmenu): row is MenuSubmenu {
  return Array.isArray((row as Partial<MenuSubmenu>).items);
}

/**
 * The nested `group`, flattened into the one ordered array native renders.
 *
 * `actions` come first, then `sections`; inside a submenu or a section the children
 * follow their parent and carry its id as `parentId`. A submenu inside a submenu is
 * not representable (D29 caps the depth at one), and a submenu in a section reads
 * as its own group on Android - the shape the public type already refuses is
 * documented rather than silently redrawn.
 */
export function flattenGroup(
  group: MenuGroup | undefined,
  componentName = 'Menu'
): NitroUiMenuRow[] {
  const rows: NitroUiMenuRow[] = [];
  const pushAction = (action: MenuAction, parentId: string | null): void => {
    rows.push({
      id: action.id,
      kind: 'action',
      title: action.title,
      parentId,
      disabled: action.disabled === true,
      destructive: action.destructive === true,
      systemImage: action.systemImage ?? null,
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
  const pushSubmenu = (row: MenuSubmenu): void => {
    rows.push({
      id: row.id,
      kind: 'submenu',
      title: row.title,
      parentId: null,
      disabled: false,
      destructive: false,
      systemImage: row.systemImage ?? null,
      androidIcon: resolveRowAndroidIcon(componentName, row.androidIcon ?? null),
      subtitle: null,
      checked: null,
    });
    for (const item of row.items) pushAction(item, row.id);
  };
  for (const row of group?.actions ?? []) {
    if (isSubmenu(row)) pushSubmenu(row);
    else pushAction(row, null);
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
      // A section header has no icon on either platform: iOS spells it a `Section`'s
      // header text and Android a `DropdownMenuGroupLabel`, and neither has a slot.
      androidIcon: null,
      subtitle: null,
      checked: null,
    });
    for (const item of section.items) pushAction(item, section.id);
  }
  return rows;
}

/**
 * What makes one flattened menu the same as another, for the memo below.
 *
 * A row's identity and look are what native draws, so those are the fields. A
 * caller who writes `group={{ actions: [...] }}` inline gets a new object every
 * render, and props diff by identity (docs/research/nitro-patterns.md) - without
 * this, an unrelated parent re-render would re-convert the whole struct array on
 * every frame.
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
 * The flattened rows, with a stable identity.
 *
 * The array native is handed only changes when the menu it describes changes,
 * which is what `ReactProp`'s equality check needs in order to answer "nothing
 * moved" (brief item 4, and Q1 §1 on identity). The cache is keyed on the rows'
 * own content rather than on the caller's object identity, so an inline `group`
 * literal costs one string build per render instead of a re-conversion of the
 * struct array - and a caller who did memoise its `group` pays nothing extra.
 *
 * The cache is a ref, not a `useMemo`, because the key is derived rather than
 * passed in: it holds the last result and its signature, and a render that
 * describes the same menu gets the same array back.
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

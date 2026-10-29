import { useRef } from 'react';
import { type ColorValue, type ViewProps } from 'react-native';

import type { ButtonSize, ButtonVariant } from '../Button/Button';
import type { NitroCallbackProp } from '../../core/useStableCallback';
import { useProcessedColor } from '../../core/useProcessedColor';
import { useSizingId } from '../../core/useSizingId';
import { useStableCallback } from '../../core/useStableCallback';
import { NativeNitroUiMenu } from './NativeNitroUiMenu';
import type { NitroUiMenuRow } from './Menu.nitro';

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
  /** Disable this one row. Default: `false`. */
  disabled?: boolean | undefined;
}

/**
 * A row that opens a further list.
 *
 * iOS nests it (a real submenu). Android renders its items inline under a divider,
 * because a second nested popup needs a second anchor and a second witness - the
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
  /** The rows inside it. */
  items: MenuAction[];
}

/**
 * A titled group of rows - a divider and a header on iOS, a divider and a
 * non-interactive header row on Android.
 */
export interface MenuSection {
  /** Unique id for this menu. */
  id: string;
  /** The group's header, or `undefined` for a group that is only a divider. */
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

/**
 * Props of {@link Menu}.
 *
 * There are no children: v0.1 supports only leaf Hybrid Views
 * (`docs/architecture/core.md`), so the items are the `group` data and the trigger
 * label is the `title` string.
 */
export interface MenuProps extends ViewProps {
  /** The trigger's text - a Button's label, sized like a Button's. */
  title: string;
  /** The items. */
  group: MenuGroup;
  /** Trigger style, shared with Button. Default: `'filled'`. */
  variant?: ButtonVariant | undefined;
  /** Trigger size, shared with Button. Default: `'medium'`. */
  size?: ButtonSize | undefined;
  /**
   * Disable interaction. Default: `false`. An open menu closes — on Android only; on
   * iOS the presentation is SwiftUI's, so it is neither enforced nor observable
   * (DECISIONS D32).
   */
  disabled?: boolean | undefined;
  /** Leading SF Symbol name on the trigger. iOS only in v0.1. */
  systemImage?: string | undefined;
  /** Trigger colour: SwiftUI `.tint()` / the variant's container colour. */
  tintColor?: ColorValue | undefined;
  /**
   * Called with the picked row's `id`. Fires before `onClose`, which a pick also
   * fires (DECISIONS D32).
   */
  onSelect?: ((id: string) => void) | undefined;
  /**
   * Called when the menu opens. **Android only** — iOS never fires it; see
   * `docs/components/menu.md` and DECISIONS D32.
   */
  onOpen?: (() => void) | undefined;
  /**
   * Called when the menu closes. **Android only** — iOS never fires it; see
   * `docs/components/menu.md` and DECISIONS D32. A pick fires `onSelect` first.
   */
  onClose?: (() => void) | undefined;
  /**
   * Tap runs this, long-press opens the menu. **iOS only** (DECISIONS D29):
   * Android always opens on tap and never calls it.
   */
  primaryAction?: (() => void) | undefined;
  /**
   * Access to the native Hybrid Object, for this repo's harness and benchmarks.
   *
   * @internal Not app API (DECISIONS D14): props must flow through React, so a
   * direct write here runs the native setter off the UI thread and never commits.
   * Reading props and calling `measureContent()` is all it is for, and the
   * callback runs once, when the view mounts - a new function does not re-run it.
   *
   * The shape is written inline rather than named: it is the same read-only
   * handle as `NitroUiMenuHandle` in `NativeNitroUiMenu.ts`, and naming it here
   * would make api-extractor demand that a v0.1-hidden native type be exported
   * from the entry point.
   */
  hybridRef?:
    | ((view: {
        readonly title: string;
        readonly variant: string;
        readonly size: string;
        readonly disabled: boolean;
        readonly tintColor: number | null;
        readonly systemImage: string | null;
        readonly accessibilityLabel: string | null;
        measureContent(): { width: number; height: number };
        /**
         * Test-only row press (G7a): runs the pick path a popup row uses, so a
         * harness can assert a real pick without an injector that reaches into a
         * popup's window. `@internal` (D14) - see `NitroUiMenuHandle`.
         */
        nuiTestSelectRow(id: string): void;
        /**
         * Test-only popup witness (G7a): `expanded=...;live=...;anchor=...;` +
         * `menu=...;rows=...`. Android measures it; iOS answers `-1` in every field
         * but `rows`, because a SwiftUI `Menu` keeps its open state and its window to
         * itself. `@internal` (D14) - see `NitroUiMenuHandle`.
         */
        nuiTestMenuReport(): string;
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

/** What a caller passed for a top-level row: an action, or a submenu. */
type MenuActionOrSubmenu = MenuAction | MenuSubmenu;

const VARIANTS: readonly ButtonVariant[] = [
  'filled',
  'tonal',
  'outlined',
  'text',
  'elevated',
];
const SIZES: readonly ButtonSize[] = ['small', 'medium', 'large'];

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
function flattenGroup(group: MenuGroup | undefined): NitroUiMenuRow[] {
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
      row.systemImage ?? ''
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
function useMenuRows(group: MenuGroup | undefined): NitroUiMenuRow[] {
  const flattened = flattenGroup(group);
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

const FIELD_SEPARATOR = '|';

/** Escape one free-form value so it cannot forge a separator. */
function escapeField(value: string): string {
  return value.replace(/[\\|]/g, '\\$&');
}

/**
 * The size configuration of one Menu, as the sizing engine sees it.
 *
 * The trigger is a Button, so its key is Button's (`variant|size|systemImage|title`,
 * `Button.tsx`): those four decide the box. `group` is *not* in the key - the items
 * live in a popup and never change the trigger's size, and free-form text in a key
 * fragments the cache (Q1 §5). `disabled` and `tintColor` repaint, they do not
 * resize, and the environment (text size, density, OS control size) reaches native
 * through the epoch rather than through here.
 */
function sizingVariantFor(
  variant: ButtonVariant,
  size: ButtonSize,
  systemImage: string | undefined,
  title: string
): string {
  return [
    variant,
    size,
    escapeField(systemImage ?? ''),
    escapeField(title),
  ].join(FIELD_SEPARATOR);
}

/**
 * What a self-sizing control is laid out with, before any `style`.
 *
 * `alignItems: stretch` (the default in a column) otherwise decides a control's
 * width for it: Yoga gives a stretched child the row's width as an *exact*
 * constraint, so the measured size is never even asked for and a Menu becomes a
 * wide box with a small control in it. Same base style as Button, Picker and
 * SegmentedControl; an explicit `width`, `flex` or `alignSelf: 'stretch'` in the
 * caller's `style` still wins.
 */
const SELF_SIZING_BASE_STYLE = { alignSelf: 'flex-start' } as const;

/** Resolve a caller's variant, defaulting anything unrecognised to `'filled'`. */
function resolveVariant(variant: ButtonVariant | undefined): ButtonVariant {
  return variant != null && VARIANTS.includes(variant) ? variant : 'filled';
}

/** Resolve a caller's size, defaulting anything unrecognised to `'medium'`. */
function resolveSize(size: ButtonSize | undefined): ButtonSize {
  return size != null && SIZES.includes(size) ? size : 'medium';
}

/**
 * What the library answers when the caller passed no handler.
 *
 * Module-level constants, so each callback prop is referentially stable and is
 * *always* sent: Nitro treats `undefined` as "unset", so a prop that goes away
 * between two commits never reaches native, and a recycled view would otherwise
 * keep the previous mount's handler alive (D7b).
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
function primaryActionNotProvided(): void {
  // Intentionally empty: there is no primary action - `hasPrimaryAction` says so.
}

/**
 * A button that opens a list of actions: SwiftUI `Menu` on iOS, a Material 3
 * `DropdownMenu` anchored to the button on Android.
 *
 * It is Button's sibling, not Picker's: a menu has no value, so there is no
 * controlled-value handshake and nothing for JS to accept or refuse - `onSelect`
 * reports a gesture. Open state is native-owned and observed through
 * `onOpen`/`onClose`, and there is no `open()`/`close()` (DECISIONS D29).
 *
 * The items are data, not children: v0.1 has no Hybrid View children, and items as
 * child views is what `@expo/ui` does and what this design refuses (Q1 §4).
 */
export function Menu({
  title,
  group,
  variant = 'filled',
  size = 'medium',
  disabled = false,
  systemImage,
  tintColor,
  onSelect,
  onOpen,
  onClose,
  primaryAction,
  testID,
  accessibilityLabel,
  hybridRef,
  nuiPerfId = null,
  style,
  ...restProps
}: MenuProps) {
  const resolvedVariant = resolveVariant(variant);
  const resolvedSize = resolveSize(size);
  const processedTint = useProcessedColor(tintColor);
  const rows = useMenuRows(group);
  // Always functions, so every callback prop is always sent - see
  // `onSelectNotProvided`. `useStableCallback` keeps one wrapper per mounted view.
  // The cast states what each `??` above already guarantees: `useStableCallback`
  // answers `null` only when it was handed no handler, and a null callback prop is
  // what D7b forbids on a mounted view.
  const selectCallback = useStableCallback(
    onSelect ?? onSelectNotProvided
  ) as NitroCallbackProp<(id: string) => void>;
  const openCallback = useStableCallback(
    onOpen ?? onOpenNotProvided
  ) as NitroCallbackProp<() => void>;
  const closeCallback = useStableCallback(
    onClose ?? onCloseNotProvided
  ) as NitroCallbackProp<() => void>;
  const primaryCallback = useStableCallback(
    primaryAction ?? primaryActionNotProvided
  ) as NitroCallbackProp<() => void>;
  const hybridRefCallback = useStableCallback(hybridRef);
  const sizingId = useSizingId();

  return (
    <NativeNitroUiMenu
      {...restProps}
      title={title}
      variant={resolvedVariant}
      size={resolvedSize}
      disabled={disabled}
      rows={rows}
      tintColor={processedTint}
      systemImage={systemImage ?? null}
      hasPrimaryAction={primaryAction != null}
      testID={testID ?? null}
      accessibilityLabel={accessibilityLabel ?? null}
      nuiPerfId={nuiPerfId}
      onSelect={selectCallback}
      onOpen={openCallback}
      onClose={closeCallback}
      primaryAction={primaryCallback}
      nuiSizingKey={sizingVariantFor(
        resolvedVariant,
        resolvedSize,
        systemImage,
        title
      )}
      nuiSizingId={sizingId}
      hybridRef={hybridRefCallback ?? undefined}
      style={[SELF_SIZING_BASE_STYLE, style]}
    />
  );
}

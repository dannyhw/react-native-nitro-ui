import { type ColorValue, type ViewProps } from 'react-native';

import type { ButtonSize, ButtonVariant } from '../Button/Button';
import type { NitroCallbackProp } from '../../core/useStableCallback';
import { useProcessedColor } from '../../core/useProcessedColor';
import { useSizingId } from '../../core/useSizingId';
import { useStableCallback } from '../../core/useStableCallback';
import { NativeNitroUiMenu } from './NativeNitroUiMenu';
import { useMenuRows, type MenuGroup } from './MenuRows';

export type {
  MenuAction,
  MenuGroup,
  MenuSection,
  MenuSubmenu,
} from './MenuRows';

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
   * A second job for the trigger, so the control carries both an action and a list.
   * Each platform draws its own idiom for that (DECISIONS D29, E3):
   *
   * - iOS: a plain button - a tap runs this and a long-press opens the menu.
   * - Android: a Material 3 Expressive split button - the left half runs this, the
   *   right half (the chevron) opens the menu. The control is wider than the plain
   *   trigger, and `variant="text"` draws the outlined split button.
   *
   * Setting it is also a size statement, so the sizing key changes with it.
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
         * `menu=...;rows=...;drawn=...;split=...;leading=...;trailing=...`. Android
         * measures the first five and the split trigger's two halves; iOS answers
         * `-1` in every field but `rows` and `drawn`, because a SwiftUI `Menu` keeps
         * its open state and its window to itself - and its `primaryAction` is a
         * gesture on one button, not a second hit target. `@internal` (D14) -
         * see `NitroUiMenuHandle`.
         */
        nuiTestMenuReport(): string;
        /**
         * Test-only (G9): on iOS, open the menu, copy the `UIMenu` UIKit built
         * for it into the report's `drawn` field, and close it. A no-op on
         * Android. `@internal` (D14) - see `NitroUiMenuHandle`.
         */
        nuiTestMenuProbe(): void;
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

const VARIANTS: readonly ButtonVariant[] = [
  'filled',
  'tonal',
  'outlined',
  'text',
  'elevated',
];
const SIZES: readonly ButtonSize[] = ['small', 'medium', 'large'];

const FIELD_SEPARATOR = '|';

/** Escape one free-form value so it cannot forge a separator. */
function escapeField(value: string): string {
  return value.replace(/[\\|]/g, '\\$&');
}

/**
 * The size configuration of one Menu, as the sizing engine sees it.
 *
 * The trigger is a Button, so its key is Button's (`variant|size|systemImage|title`,
 * `Button.tsx`) with one field added: `variant|size|action|systemImage|title`, where
 * `action` is `'action'` when `primaryAction` is set and `'plain'` when it is not.
 * That fifth decides the box because on Android it changes the *layout* - a split
 * button is two containers beside a gap, so it is wider than the single button it
 * replaces (E3). iOS ignores the field and pays for it with one extra cache entry per
 * (variant, size, icon, title) pair, which is cheaper than a platform-specific key.
 *
 * `group` is *not* in the key - the items live in a popup and never change the
 * trigger's size, and free-form text in a key fragments the cache (Q1 §5).
 * `disabled` and `tintColor` repaint, they do not resize, and the environment (text
 * size, density, OS control size) reaches native through the epoch rather than here.
 */
function sizingVariantFor(
  variant: ButtonVariant,
  size: ButtonSize,
  hasPrimaryAction: boolean,
  systemImage: string | undefined,
  title: string
): string {
  return [
    variant,
    size,
    hasPrimaryAction ? 'action' : 'plain',
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
        primaryAction != null,
        systemImage,
        title
      )}
      nuiSizingId={sizingId}
      hybridRef={hybridRefCallback ?? undefined}
      style={[SELF_SIZING_BASE_STYLE, style]}
    />
  );
}

import { type ColorValue, type ViewProps } from 'react-native';

import type { ButtonSize, ButtonVariant } from '../Button/Button';
import { warnAndroidIconName } from '../../iconName';
import { warnIosSystemImageName } from '../../systemImageName';
import {
  androidIconUrl,
  androidIconResourceName,
  resolveAndroidIcon,
  type AndroidIconProp,
} from '../../iconSource';
import type { NitroCallbackProp } from '../../core/useStableCallback';
import { useProcessedColor } from '../../core/useProcessedColor';
import { useSizingId } from '../../core/useSizingId';
import { useStableCallback } from '../../core/useStableCallback';
import { useSelfSizingBaseStyle } from '../../core/useSelfSizing';
import { NativeNitroUiMenu } from './NativeNitroUiMenu';
import { useMenuRows, type MenuGroup } from './MenuRows';

export type {
  MenuAction,
  MenuGroup,
  MenuSection,
  MenuSubmenu,
} from './MenuRows';

/**
 * Props of {@link Menu}. The items are the `group` data and the trigger label is
 * the `title` string; there are no children.
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
   * Disable interaction. Default: `false`. An open menu closes on Android only; on
   * iOS the system owns the presentation and the library does not close it.
   */
  disabled?: boolean | undefined;
  /** Leading SF Symbol name on the trigger. iOS only. */
  systemImage?: string | undefined;
  /**
   * Leading glyph on the trigger for Android: the same artwork {@link
   * ButtonProps.androidIcon} takes, in the same two forms — a Metro asset
   * (`androidIcon={require('./icons/share.xml')}`) or an Android resource name
   * (`'share'`). **Android only** — iOS draws {@link systemImage} and ignores this,
   * so a Menu with a glyph on both platforms sends both and needs no
   * `Platform.select`.
   *
   * The glyph is sized by the trigger's `size` and never by the file, it takes the
   * control's own text colour, and artwork that cannot be resolved draws nothing
   * and reserves no space. When `primaryAction` makes Android draw the split
   * button, the glyph goes on the leading half, where the label is.
   */
  androidIcon?: AndroidIconProp | undefined;
  /** Trigger colour: SwiftUI `.tint()` / the variant's container colour. */
  tintColor?: ColorValue | undefined;
  /** Called with the picked row's `id`. Fires before `onClose`, which a pick also fires. */
  onSelect?: ((id: string) => void) | undefined;
  /** Called when the menu opens. **Android only** — iOS never fires it. */
  onOpen?: (() => void) | undefined;
  /**
   * Called when the menu closes. **Android only** — iOS never fires it. A pick
   * fires `onSelect` first.
   */
  onClose?: (() => void) | undefined;
  /**
   * A second job for the trigger, so the control carries both an action and a list.
   * Each platform draws its own idiom for that:
   *
   * - iOS: a plain button - a tap runs this and a long-press opens the menu.
   * - Android: a Material 3 Expressive split button - the left half runs this, the
   *   right half (the chevron) opens the menu. The control is wider than the plain
   *   trigger, and `variant="text"` draws the outlined split button.
   */
  primaryAction?: (() => void) | undefined;
  /**
   * Read-only access to the native view, for this library's own tests and
   * benchmarks.
   *
   * @internal Not app API. A write through this handle bypasses React and never
   * commits. The callback runs once, when the view mounts. The shape is inline
   * because naming it would force an internal native type into the public exports.
   */
  hybridRef?:
    | ((view: {
        readonly title: string;
        readonly variant: string;
        readonly size: string;
        readonly disabled: boolean;
        readonly tintColor: number | null;
        readonly systemImage: string | null;
        /** The Android icon string the wrapper built, or `null`. */
        readonly androidIcon: string | null;
        readonly accessibilityLabel: string | null;
        measureContent(): { width: number; height: number };
        /** Test-only: runs the pick path a popup row uses, without reaching into the popup's window. */
        nuiTestSelectRow(id: string): void;
        /**
         * Test-only: the popup's state as `expanded=...;live=...;anchor=...;` +
         * `menu=...;rows=...;drawn=...;split=...;leading=...;trailing=...`. iOS
         * answers `-1` in every field but `rows` and `drawn`, because a SwiftUI
         * `Menu` keeps its open state and its window to itself.
         */
        nuiTestMenuReport(): string;
        /**
         * Test-only: on iOS, opens the menu, copies the `UIMenu` UIKit built for
         * it into the report's `drawn` field, and closes it. A no-op on Android.
         */
        nuiTestMenuProbe(): void;
        /** Test-only: sample the trigger's pixels. */
        nuiTestPixelProbe(color: number): void;
        /** Test-only: the trigger probe's answer. */
        nuiTestPixelReport(): string;
        /** Test-only: sample the open menu's window. */
        nuiTestMenuPixelProbe(color: number): void;
        /** Test-only: the open-menu probe's answer. */
        nuiTestMenuPixelReport(): string;
      }) => void)
    | undefined;
  /**
   * Instance id for native performance marks; `null` turns them off for this view.
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
const SIZES: readonly ButtonSize[] = [
  'small',
  'medium',
  'large',
  'xlarge',
  'xxlarge',
];

const FIELD_SEPARATOR = '|';

/** Escape one free-form value so it cannot forge a separator. */
function escapeField(value: string): string {
  return value.replace(/[\\|]/g, '\\$&');
}

/**
 * The key two Menus share when their triggers are the same size: Button's key
 * with an `action` field added. `primaryAction` is part of it because Android
 * then draws a split button, which is wider. `group` is not: the items live in
 * a popup and never change the trigger's size.
 */
function sizingVariantFor(
  variant: ButtonVariant,
  size: ButtonSize,
  hasPrimaryAction: boolean,
  systemImage: string | undefined,
  androidIcon: string | undefined,
  title: string
): string {
  return [
    variant,
    size,
    hasPrimaryAction ? 'action' : 'plain',
    escapeField(systemImage ?? ''),
    escapeField(androidIcon ?? ''),
    escapeField(title),
  ].join(FIELD_SEPARATOR);
}

function resolveVariant(variant: ButtonVariant | undefined): ButtonVariant {
  return variant != null && VARIANTS.includes(variant) ? variant : 'filled';
}

function resolveSize(size: ButtonSize | undefined): ButtonSize {
  return size != null && SIZES.includes(size) ? size : 'medium';
}

/**
 * Sent when the caller passes no handler. Every callback prop must always be
 * sent: Nitro treats `undefined` as "unset", so a recycled view would otherwise
 * keep the previous mount's handler.
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
 * A menu has no value: `onSelect` reports the picked row's `id`. The items are
 * the `group` data, not children. The menu opens and closes itself; there is no
 * `open()` or `close()`.
 */
export function Menu({
  title,
  group,
  variant = 'filled',
  size = 'medium',
  disabled = false,
  systemImage,
  androidIcon,
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
  const selfSizingBaseStyle = useSelfSizingBaseStyle();
  const resolvedVariant = resolveVariant(variant);
  const resolvedSize = resolveSize(size);
  // Resolved before the sizing key so both spellings of one icon (an asset or a
  // name) share one key.
  const resolvedAndroidIcon = resolveAndroidIcon(androidIcon);
  if (
    resolvedAndroidIcon != null &&
    androidIconUrl(resolvedAndroidIcon) == null &&
    androidIconResourceName(resolvedAndroidIcon) == null
  ) {
    // Neither a URL nor a valid resource name is most likely a typo, and native
    // would draw nothing without saying why.
    warnAndroidIconName('Menu', 'androidIcon', resolvedAndroidIcon);
  }
  if (systemImage != null) {
    warnIosSystemImageName('Menu', 'systemImage', systemImage);
  }
  const processedTint = useProcessedColor(tintColor);
  const rows = useMenuRows(group);
  // Always functions, so every callback prop is always sent. The casts are safe:
  // `useStableCallback` returns `null` only when it is handed no handler.
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
      androidIcon={resolvedAndroidIcon ?? null}
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
        resolvedAndroidIcon ?? undefined,
        title
      )}
      nuiSizingId={sizingId}
      hybridRef={hybridRefCallback ?? undefined}
      style={[selfSizingBaseStyle, style]}
    />
  );
}

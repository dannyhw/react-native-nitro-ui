import { useInsertionEffect, useMemo, useRef, useState } from 'react';
import { type ColorValue, type ViewProps } from 'react-native';

import { warnAndroidIconName } from '../../iconName';
import {
  androidIconResourceName,
  androidIconUrl,
  resolveAndroidIcon,
  type AndroidIconProp,
} from '../../iconSource';
import type { NitroCallbackProp } from '../../core/useStableCallback';
import { useProcessedColor } from '../../core/useProcessedColor';
import { useSizingId } from '../../core/useSizingId';
import { useStableCallback } from '../../core/useStableCallback';
import type { ButtonVariant } from '../Button/Button';
import { NativeNitroUiButtonGroup } from './NativeNitroUiButtonGroup';
import type { NitroUiButtonGroupItem } from './ButtonGroup.nitro';

/** Re-exported so an app can write the prop type without a second import. */
export type { AndroidIconProp } from '../../iconSource';

/**
 * How the items sit next to each other. Default: `'standard'`.
 *
 * - `'standard'`: a row of separate controls with a gap.
 * - `'connected'`: one track. Material's connected corners on Android,
 *   SwiftUI's `ControlGroup` on iOS, where it ignores `variant`, `size` and
 *   `tintColor`.
 */
export type ButtonGroupAppearance = 'standard' | 'connected';

/**
 * Whether an item draws its title, its icon, or both. `'automatic'` is each
 * platform's default: a connected iOS group drops the title of an item that
 * has an icon, while Android and a standard iOS row draw both. Pass an explicit
 * value to make a screen look the same on both.
 */
export type ButtonGroupLabelStyle =
  | 'automatic'
  | 'titleOnly'
  | 'iconOnly'
  | 'titleAndIcon';

/**
 * One item of a {@link ButtonGroup}. Items are data, not children, so the
 * group can move one that does not fit into an overflow menu.
 */
export interface ButtonGroupItem {
  /**
   * Stable id, unique in the group. `onPress` and `onCheckedChange` report it.
   * A duplicate warns in development.
   */
  id: string;
  /**
   * The item's text: drawn, read by a screen reader, and used for the overflow
   * row when the item does not fit.
   */
  title: string;
  /** SF Symbol name. iOS only: Android ignores it and draws `androidIcon`. */
  systemImage?: string | null | undefined;
  /**
   * The glyph on Android: a vector drawable, passed as a Metro asset
   * (`require('./icons/share.xml')`) or as an Android resource name
   * (`'share'`). Android only: iOS draws `systemImage`. Artwork that cannot be
   * resolved draws nothing and reserves no space.
   */
  androidIcon?: AndroidIconProp | null | undefined;
  /** Disable this item. It draws disabled and reports nothing. Default `false`. */
  disabled?: boolean | undefined;
  /**
   * Make the item a toggle instead of an action: it shows a checked state and
   * reports `onCheckedChange`. Default `false`.
   *
   * TalkBack reads a toggle item as a checkbox. A connected iOS group falls
   * back to a row of bordered toggles, because `ControlGroup` cannot draw an
   * on-state.
   */
  toggle?: boolean | undefined;
  /**
   * Controlled checked state of a toggle item. Pass a boolean to control it; pass
   * `null` or leave it out and the item keeps whatever the user last set, like an
   * uncontrolled `Switch`.
   */
  checked?: boolean | null | undefined;
  /**
   * Initial checked state of an uncontrolled toggle item, applied once. Ignored
   * while `checked` is a boolean.
   */
  defaultChecked?: boolean | undefined;
}

/** Props of {@link ButtonGroup}. There are no children: the items are data. */
export interface ButtonGroupProps extends ViewProps {
  /** The items, in render order. `[]` draws an empty row. */
  items: ButtonGroupItem[];
  /** How the items sit together. Default `'standard'`. */
  appearance?: ButtonGroupAppearance | undefined;
  /**
   * Visual style, the same five names `Button` takes. Default `'filled'`.
   * Ignored by a connected iOS group.
   */
  variant?: ButtonVariant | undefined;
  /** Control size. Default `'medium'`. Ignored by a connected iOS group. */
  size?: 'small' | 'medium' | 'large' | 'xlarge' | 'xxlarge' | undefined;
  /** Whether items draw their title, icon or both. Default `'automatic'`. */
  labelStyle?: ButtonGroupLabelStyle | undefined;
  /** Disable the whole group. Default `false`. */
  disabled?: boolean | undefined;
  /**
   * Container colour: the variant's container on Android, SwiftUI `.tint()` on
   * a standard iOS row. Ignored by a connected iOS group.
   */
  tintColor?: ColorValue | undefined;
  /** Called with an item's `id` when it is pressed, in the row or the overflow menu. */
  onPress?: ((id: string) => void) | undefined;
  /** Called when a toggle item changes, once per tap. */
  onCheckedChange?: ((id: string, checked: boolean) => void) | undefined;
  /**
   * Accessibility label of the iOS "More" button. Default: `"More"`. Does
   * nothing on Android, whose overflow button has Material's localised label.
   */
  overflowAccessibilityLabel?: string | undefined;
  /** Accessibility label of the group as a container. */
  accessibilityLabel?: string | undefined;
  /** Test identifier, passed through to the native view. */
  testID?: string | undefined;
  /**
   * Read-only access to the native view, for tests and benchmarks.
   *
   * @internal
   */
  hybridRef?:
    | ((view: {
        readonly items: {
          readonly id: string;
          readonly title: string;
          readonly systemImage: string | null;
          readonly androidIcon: string | null;
          readonly disabled: boolean;
          readonly toggle: boolean;
        }[];
        readonly appearance: string;
        readonly variant: string;
        readonly size: string;
        readonly labelStyle: string;
        readonly disabled: boolean;
        readonly tintColor: number | null;
        readonly accessibilityLabel: string | null;
        readonly checkedIds: string[];
        readonly controlledIds: string[];
        readonly mostRecentEventCount: number;
        measureContent(): { width: number; height: number };
        nuiTestPressItem(id: string): void;
        nuiTestOpenOverflow(): void;
        nuiTestProbeRow(): void;
        nuiTestProbeAccessibility(): void;
        nuiTestStateReport(): string;
      }) => void)
    | undefined;
  /**
   * Instance id for native performance marks; `null` turns them off.
   *
   * @internal
   */
  nuiPerfId?: number | null | undefined;
}

const APPEARANCES: readonly ButtonGroupAppearance[] = ['standard', 'connected'];
const VARIANTS: readonly ButtonVariant[] = [
  'filled',
  'tonal',
  'outlined',
  'text',
  'elevated',
];
const SIZES: readonly NonNullable<ButtonGroupProps['size']>[] = [
  'small',
  'medium',
  'large',
  'xlarge',
  'xxlarge',
];
const LABEL_STYLES: readonly ButtonGroupLabelStyle[] = [
  'automatic',
  'titleOnly',
  'iconOnly',
  'titleAndIcon',
];

const FIELD_SEPARATOR = '|';

/** Escape one free-form value so it cannot forge a separator. */
function escapeField(value: string): string {
  return value.replace(/[\\|]/g, '\\$&');
}

/**
 * Everything that changes the row's height, and nothing else: `checked`,
 * `disabled` and `tintColor` only repaint. The width is left out because the
 * group takes its box's width.
 */
function sizingVariantFor(
  appearance: ButtonGroupAppearance,
  variant: ButtonVariant,
  size: NonNullable<ButtonGroupProps['size']>,
  labelStyle: ButtonGroupLabelStyle,
  items: readonly ButtonGroupItem[],
  androidIcons: readonly (string | null)[]
): string {
  const fields = [appearance, variant, size, labelStyle, String(items.length)];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    fields.push(
      item.toggle === true ? 't' : 'a',
      escapeField(item.title),
      escapeField(item.systemImage ?? ''),
      escapeField(androidIcons[index] ?? '')
    );
  }
  return fields.join(FIELD_SEPARATOR);
}

/**
 * The group takes its box's width, since overflow is decided at that width, and
 * `alignSelf: 'stretch'` is what gives the box one.
 */
const FILL_WIDTH_BASE_STYLE = { alignSelf: 'stretch' } as const;

function resolveAppearance(
  appearance: ButtonGroupAppearance | undefined
): ButtonGroupAppearance {
  return appearance != null && APPEARANCES.includes(appearance)
    ? appearance
    : 'standard';
}

function resolveVariant(variant: ButtonVariant | undefined): ButtonVariant {
  return variant != null && VARIANTS.includes(variant) ? variant : 'filled';
}

function resolveSize(
  size: NonNullable<ButtonGroupProps['size']> | undefined
): NonNullable<ButtonGroupProps['size']> {
  return size != null && SIZES.includes(size) ? size : 'medium';
}

function resolveLabelStyle(
  labelStyle: ButtonGroupLabelStyle | undefined
): ButtonGroupLabelStyle {
  return labelStyle != null && LABEL_STYLES.includes(labelStyle)
    ? labelStyle
    : 'automatic';
}

function onPressNotProvided(): void {
  // Deliberately empty: a Hybrid View must not have a callback prop removed
  // (nitro#1184), so the wrapper sends this instead of `null`.
}

interface NativeButtonGroupItems {
  items: NitroUiButtonGroupItem[];
  /** Ids of the *controlled* toggle items that are checked. */
  checkedIds: string[];
  /** Ids of the toggle items whose `checked` is a boolean. */
  controlledIds: string[];
  /** Ids of the *uncontrolled* toggle items that start checked. */
  defaultCheckedIds: string[];
  androidIcons: (string | null)[];
  duplicateIds: string[];
}

/**
 * Keeps one array identity until the content changes: Nitro diffs props by
 * identity, so an array rebuilt every render would be re-sent every render.
 * `androidIcon` is resolved here so the two spellings of one icon (`require`
 * and a resource name) share one size configuration.
 */
function useNativeItems(
  items: readonly ButtonGroupItem[]
): NativeButtonGroupItems {
  const androidIcons = items.map((item) =>
    resolveAndroidIcon(item.androidIcon)
  );
  for (let index = 0; index < items.length; index += 1) {
    const resolved = androidIcons[index];
    if (
      resolved != null &&
      androidIconUrl(resolved) == null &&
      androidIconResourceName(resolved) == null
    ) {
      warnAndroidIconName('ButtonGroup', 'items[].androidIcon', resolved);
    }
  }

  const rows: unknown[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    rows.push([
      item.id,
      item.title,
      item.systemImage ?? '',
      androidIcons[index] ?? '',
      item.disabled === true,
      item.toggle === true,
      item.checked == null ? 'u' : item.checked ? '1' : '0',
      item.defaultChecked === true,
    ]);
  }
  const signature = JSON.stringify(rows);
  const cache = useRef<{
    signature: string;
    value: NativeButtonGroupItems;
  } | null>(null);
  const previous = cache.current;
  if (previous != null && previous.signature === signature) {
    return previous.value;
  }

  const nativeItems: NitroUiButtonGroupItem[] = [];
  const checkedIds: string[] = [];
  const controlledIds: string[] = [];
  const defaultCheckedIds: string[] = [];
  const seen = new Set<string>();
  const duplicateIds: string[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    if (seen.has(item.id)) {
      if (duplicateIds.indexOf(item.id) < 0) {
        duplicateIds.push(item.id);
      }
    } else {
      seen.add(item.id);
    }
    nativeItems.push({
      id: item.id,
      title: item.title,
      systemImage: item.systemImage ?? null,
      androidIcon: androidIcons[index] ?? null,
      disabled: item.disabled === true,
      toggle: item.toggle === true,
    });
    if (item.toggle === true) {
      if (item.checked === true || item.checked === false) {
        controlledIds.push(item.id);
        if (item.checked) {
          checkedIds.push(item.id);
        }
      } else if (item.defaultChecked === true) {
        defaultCheckedIds.push(item.id);
      }
    }
  }
  const value: NativeButtonGroupItems = {
    items: nativeItems,
    checkedIds,
    controlledIds,
    defaultCheckedIds,
    androidIcons,
    duplicateIds,
  };
  cache.current = { signature, value };
  return value;
}

interface ControlledIdsState {
  /** The controlled checked set, or `null` while nothing in the group is controlled. */
  checkedIds: string[] | null;
  controlledIds: string[];
  defaultCheckedIds: string[];
  mostRecentEventCount: number;
  onNativeChange: NitroCallbackProp<
    (id: string, checked: boolean, eventCount: number) => void
  >;
}

/**
 * `useControlled`'s handshake for a set of toggles: native reports
 * `(id, checked)` and JS writes the whole set. One controlled toggle puts the
 * whole group in controlled mode, because per-item counts would let one item's
 * stale write be accepted on another item's event.
 */
function useControlledCheckedIds(
  checkedIds: string[],
  controlledIds: string[],
  defaultCheckedIds: string[],
  onCheckedChange: ((id: string, checked: boolean) => void) | undefined
): ControlledIdsState {
  const [mostRecentEventCount, setMostRecentEventCount] = useState(0);
  const isControlled = controlledIds.length > 0;
  // Tracked in both modes, so a group that becomes controlled can catch native
  // up instead of having its first write treated as stale.
  const seenEvents = useRef(0);
  const [wasControlled, setWasControlled] = useState(isControlled);
  if (wasControlled !== isControlled) {
    setWasControlled(isControlled);
    if (isControlled && seenEvents.current > mostRecentEventCount) {
      setMostRecentEventCount(seenEvents.current);
    }
  }

  // The native callback keeps one identity, so what it reads lives in a ref
  // that each commit refreshes.
  const latest = useRef({ onCheckedChange, isControlled });
  useInsertionEffect(() => {
    const previouslyControlled = latest.current.isControlled;
    latest.current = { onCheckedChange, isControlled };
    if (previouslyControlled !== isControlled && __DEV__) {
      console.warn(
        'react-native-nitro-ui: a ButtonGroup changed from controlling its items ' +
          'to not controlling them (or back). Pass `checked` on the same items on ' +
          'every render, or on none of them.'
      );
    }
  });
  const handleNativeChange = useMemo(
    () => (id: string, checked: boolean, eventCount: number) => {
      if (eventCount > seenEvents.current) {
        seenEvents.current = eventCount;
      }
      // Echo before the user's handler: a handler that throws must not stop the
      // echo, or native would treat every later write as stale.
      if (latest.current.isControlled) {
        setMostRecentEventCount((previous) =>
          eventCount > previous ? eventCount : previous
        );
      }
      latest.current.onCheckedChange?.(id, checked);
    },
    []
  );
  // Always wired, even with no user handler: in controlled mode the echo is what
  // lets native accept the next `checkedIds` write.
  const onNativeChange = useStableCallback(
    handleNativeChange
  ) as NitroCallbackProp<
    (id: string, checked: boolean, eventCount: number) => void
  >;

  return {
    checkedIds: isControlled ? checkedIds : null,
    controlledIds,
    defaultCheckedIds,
    mostRecentEventCount: isControlled ? mostRecentEventCount : 0,
    onNativeChange,
  };
}

/**
 * A row of commands (Copy | Paste | Share), optionally with independent
 * toggles (Bold | Italic | Underline).
 *
 * ```tsx
 * <ButtonGroup
 *   items={[
 *     { id: 'copy', title: 'Copy', systemImage: 'doc.on.doc', androidIcon: 'copy' },
 *     { id: 'paste', title: 'Paste', systemImage: 'doc.on.clipboard' },
 *   ]}
 *   appearance="connected"
 *   onPress={run}
 * />
 * ```
 *
 * Unlike a `SegmentedControl`, which picks one option, a group has no value. It
 * fills the available width, and items that do not fit move into an overflow
 * menu.
 */
export function ButtonGroup({
  items,
  appearance = 'standard',
  variant = 'filled',
  size = 'medium',
  labelStyle = 'automatic',
  disabled = false,
  tintColor,
  onPress,
  onCheckedChange,
  overflowAccessibilityLabel,
  accessibilityLabel,
  testID,
  hybridRef,
  nuiPerfId = null,
  style,
  ...restProps
}: ButtonGroupProps) {
  const resolvedAppearance = resolveAppearance(appearance);
  const resolvedVariant = resolveVariant(variant);
  const resolvedSize = resolveSize(size);
  const resolvedLabelStyle = resolveLabelStyle(labelStyle);
  const processedTint = useProcessedColor(tintColor);

  const native = useNativeItems(items);
  if (__DEV__ && native.duplicateIds.length > 0) {
    warnDuplicateIds(native.duplicateIds);
  }

  const controlled = useControlledCheckedIds(
    native.checkedIds,
    native.controlledIds,
    native.defaultCheckedIds,
    onCheckedChange
  );

  // `??` guarantees a function, so this is never `null`; the cast says so.
  const pressCallback = useStableCallback(
    onPress ?? onPressNotProvided
  ) as NitroCallbackProp<(id: string) => void>;
  const hybridRefCallback = useStableCallback(hybridRef);
  const sizingId = useSizingId();

  return (
    <NativeNitroUiButtonGroup
      {...restProps}
      items={native.items}
      appearance={resolvedAppearance}
      variant={resolvedVariant}
      size={resolvedSize}
      labelStyle={resolvedLabelStyle}
      disabled={disabled}
      tintColor={processedTint}
      checkedIds={controlled.checkedIds ?? []}
      controlledIds={controlled.controlledIds}
      defaultCheckedIds={controlled.defaultCheckedIds}
      mostRecentEventCount={controlled.mostRecentEventCount}
      overflowAccessibilityLabel={overflowAccessibilityLabel ?? null}
      accessibilityLabel={accessibilityLabel ?? null}
      testID={testID ?? null}
      nuiPerfId={nuiPerfId}
      onPress={pressCallback}
      onCheckedChange={controlled.onNativeChange}
      nuiSizingKey={sizingVariantFor(
        resolvedAppearance,
        resolvedVariant,
        resolvedSize,
        resolvedLabelStyle,
        items,
        native.androidIcons
      )}
      nuiSizingId={sizingId}
      hybridRef={hybridRefCallback ?? undefined}
      style={[FILL_WIDTH_BASE_STYLE, style]}
    />
  );
}

/** So a bad `items` array warns once, not on every render. */
const warnedDuplicateIds = { done: false };

function warnDuplicateIds(ids: readonly string[]): void {
  if (warnedDuplicateIds.done) {
    return;
  }
  warnedDuplicateIds.done = true;
  console.warn(
    `react-native-nitro-ui: ButtonGroup items have duplicate ids (${ids.join(
      ', '
    )}). onPress and onCheckedChange report an id, so two items with one id are ` +
      'one item to the handler — give every item its own id.'
  );
}

/** Test-only: lets the next test see the warning again. */
export function resetButtonGroupWarningsForTests(): void {
  warnedDuplicateIds.done = false;
}

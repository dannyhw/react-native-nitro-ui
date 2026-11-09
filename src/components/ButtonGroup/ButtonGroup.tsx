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
 * How the items sit next to each other.
 *
 * `'standard'` is a row of separate controls with a gap; `'connected'` is the
 * single-track look — Material's connected corners on Android, SwiftUI's
 * `ControlGroup` on iOS. The default is `'standard'`, which is also Material's
 * own default for `ButtonGroup`.
 *
 * A connected iOS group is a *quieter* control than a standard one: measured
 * (`docs/tasks/Q9-buttongroup-iconbutton-design.report.md` Appendix A) that
 * `ControlGroup` ignores `variant`, `size` and `tintColor`, and draws no on-state
 * for a toggle item. `docs/components/button-group.md` says which props a
 * connected iOS group does not take, and what it draws instead of toggles.
 */
export type ButtonGroupAppearance = 'standard' | 'connected';

/**
 * Whether an item draws its title, its icon, both, or whatever the platform's own
 * default is (`'automatic'`).
 *
 * The platforms' defaults differ, and neither is a bug: a connected iOS group
 * drops titles as soon as an item has an icon, while Android and an iOS standard
 * row draw icon and title together. Pass an explicit value to make a screen look
 * the same on both.
 */
export type ButtonGroupLabelStyle =
  'automatic' | 'titleOnly' | 'iconOnly' | 'titleAndIcon';

/**
 * One item of a {@link ButtonGroup}.
 *
 * Items are data, not children: the group has to be able to move an item into an
 * overflow menu, and a control it cannot re-order cannot do that.
 */
export interface ButtonGroupItem {
  /**
   * Stable id, unique in the group — `onPress` and `onCheckedChange` report it,
   * which is what lets a handler be one function for the whole group. A duplicate
   * warns in development: two items with one id are one item to a handler.
   */
  id: string;
  /**
   * The item's text. It is drawn, read by a screen reader, and used as the text
   * of the overflow row when the item does not fit in the row — so unlike an icon
   * it is never optional.
   */
  title: string;
  /**
   * SF Symbol name. **iOS only** — Android has no SF Symbols, so the prop is
   * accepted there and draws nothing; name the drawable in `androidIcon` and each
   * platform takes its own (the Button convention).
   */
  systemImage?: string | null | undefined;
  /**
   * The glyph on Android: a vector drawable the app owns, passed as a Metro asset
   * (`androidIcon: require('./icons/share.xml')`) or, for an app that already ships
   * drawables, as its Android resource name (`'share'`). **Android only** — iOS
   * draws `systemImage` and ignores this.
   *
   * Same rules as `Button.androidIcon`: Metro carries the file, the size comes
   * from the ladder rather than from the file, and artwork that cannot be resolved
   * draws nothing and reserves no space.
   */
  androidIcon?: AndroidIconProp | null | undefined;
  /** Disable this item. It draws disabled and reports nothing. Default `false`. */
  disabled?: boolean | undefined;
  /**
   * Make the item a toggle instead of an action: it shows a checked state and
   * reports `onCheckedChange`. Default `false`.
   *
   * On Android a toggle item is a checkbox to TalkBack (independent toggles, which
   * is what a group of them is). On iOS an *connected* group falls back to a row of
   * bordered toggles, because `ControlGroup` cannot draw an on-state.
   */
  toggle?: boolean | undefined;
  /**
   * Controlled checked state of a toggle item. Pass a boolean to control it; pass
   * `null` or leave it out and the item keeps whatever the user last set, like an
   * uncontrolled `Switch`.
   */
  checked?: boolean | null | undefined;
  /**
   * Seed for an uncontrolled toggle item, applied once. Ignored while `checked` is
   * a boolean, and ignored after the first render — otherwise a re-render would
   * undo the tap that just happened.
   */
  defaultChecked?: boolean | undefined;
}

/**
 * Props of {@link ButtonGroup}.
 *
 * There are no children: items are data (`ButtonGroupItem`), which is what lets
 * the group move the ones that do not fit into an overflow menu.
 */
export interface ButtonGroupProps extends ViewProps {
  /** The items, in render order. `[]` draws an empty row. */
  items: ButtonGroupItem[];
  /** How the items sit together. Default `'standard'`. */
  appearance?: ButtonGroupAppearance | undefined;
  /**
   * Visual style, the same five names `Button` takes. Default `'filled'`, which is
   * what Material's own group items draw.
   *
   * Android and an iOS standard row. A connected iOS group has one look — measured,
   * `ControlGroup` ignores the style, the size and the tint.
   */
  variant?: ButtonVariant | undefined;
  /** Control size, the same ladder `Button` and `IconButton` take. Default `'medium'`. */
  size?: 'small' | 'medium' | 'large' | 'xlarge' | 'xxlarge' | undefined;
  /** What each item draws besides its tap. Default `'automatic'`. */
  labelStyle?: ButtonGroupLabelStyle | undefined;
  /** Disable the whole group. Default `false`. */
  disabled?: boolean | undefined;
  /**
   * Container colour: the variant's container on Android, SwiftUI `.tint()` on an
   * iOS standard row. A connected iOS group ignores it (measured).
   */
  tintColor?: ColorValue | undefined;
  /** One item was pressed — from the row or from the overflow menu. */
  onPress?: ((id: string) => void) | undefined;
  /** A toggle item changed, reported once per tap. */
  onCheckedChange?: ((id: string, checked: boolean) => void) | undefined;
  /**
   * The name of the iOS "More" button. Default: `"More"`. Android's overflow
   * indicator carries Material's own localised label, so the prop does nothing
   * there.
   */
  overflowAccessibilityLabel?: string | undefined;
  /** The group's own label, for a screen reader that wants a container name. */
  accessibilityLabel?: string | undefined;
  /** Test identifier, passed through to the native view. */
  testID?: string | undefined;
  /**
   * Receives the read-only native handle once the view mounts, so a harness or a
   * benchmark can ask what the control is showing (`measureContent()`,
   * `nuiTestStateReport()`).
   *
   * @internal Not app API (DECISIONS D14): props must flow through React, so a
   * direct write here runs the native setter off the UI thread and never commits.
   * The callback runs once, when the view mounts.
   *
   * The shape is written inline rather than named for Button's reason: naming it
   * would make api-extractor demand that a hidden native type be exported from the
   * entry point.
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
   * Instance id used by native perf marks (`nitroUiCore.drainPerf()`). Benchmark
   * only; `null` turns marks off for this view.
   *
   * @internal Benchmark and diagnostics only — not app API.
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
 * The size configuration of one ButtonGroup, as the sizing engine sees it.
 *
 * Everything that moves the row's height has to be in here, and nothing else
 * (`docs/architecture/sizing.md`, "Building `nuiSizingKey`"): `appearance`,
 * `variant` and `size` decide the control each item draws; `labelStyle` decides
 * whether a title is in it; and the items themselves are the row, so one field
 * per item follows the item count. `checked`, `disabled` and `tintColor` repaint
 * and are left out.
 *
 * The **width is not in the key**. The group is `fillWidth` (B4 of the design):
 * its width is its box's, and a `fillWidth` entry files only the height, so a
 * row that overflows at 220 pt and the same row at 400 pt share one height rather
 * than fragmenting the cache on a number Yoga already owns.
 *
 * The count is in the key because it moves the height of a wrapped row would it
 * ever wrap — and, more practically, because two groups whose item lists differ
 * only in length must not share an entry before the per-item fields are read.
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
 * What a `fillWidth` control is laid out with, before any `style`.
 *
 * The group's width *is* its box's — overflow can only be decided at the width the
 * row actually has — so `alignSelf: 'stretch'` hands it that width: the engine's
 * `fillWidth` policy overrides the measured width with the box's, but only when the
 * box has a finite width, and `alignSelf` is the one thing that decides a Yoga
 * cross-axis size (`Slider.tsx` and `Progress.tsx` carry the full reasoning).
 */
const FILL_WIDTH_BASE_STYLE = { alignSelf: 'stretch' } as const;

/** Resolve a caller's appearance, defaulting anything unrecognised to `'standard'`. */
function resolveAppearance(
  appearance: ButtonGroupAppearance | undefined
): ButtonGroupAppearance {
  return appearance != null && APPEARANCES.includes(appearance)
    ? appearance
    : 'standard';
}

/** Resolve a caller's variant, defaulting anything unrecognised to `'filled'`. */
function resolveVariant(variant: ButtonVariant | undefined): ButtonVariant {
  return variant != null && VARIANTS.includes(variant) ? variant : 'filled';
}

/** Resolve a caller's size, defaulting anything unrecognised to `'medium'`. */
function resolveSize(
  size: NonNullable<ButtonGroupProps['size']> | undefined
): NonNullable<ButtonGroupProps['size']> {
  return size != null && SIZES.includes(size) ? size : 'medium';
}

/** Resolve a caller's label style, defaulting anything unrecognised to `'automatic'`. */
function resolveLabelStyle(
  labelStyle: ButtonGroupLabelStyle | undefined
): ButtonGroupLabelStyle {
  return labelStyle != null && LABEL_STYLES.includes(labelStyle)
    ? labelStyle
    : 'automatic';
}

/** A no-op press handler, so the callback prop is never absent (D7b). */
function onPressNotProvided(): void {
  // Deliberately empty: a Hybrid View must not have a callback prop removed
  // (nitro#1184), so the wrapper sends this instead of `null`.
}

/**
 * One entry of the native prop batch, plus everything derived from the same list.
 */
interface NativeButtonGroupItems {
  items: NitroUiButtonGroupItem[];
  /** Ids of the *controlled* toggle items that are checked. */
  checkedIds: string[];
  /** Ids of the toggle items whose `checked` is a boolean. */
  controlledIds: string[];
  /** Ids of the *uncontrolled* toggle items that start checked. */
  defaultCheckedIds: string[];
  /** The resolved per-item Android glyph, for the size key. */
  androidIcons: (string | null)[];
  /** Ids that appear twice, for the development warning. */
  duplicateIds: string[];
}

/**
 * Turn the caller's `items` into the native batch, keeping one array identity
 * until something in it changes.
 *
 * The identity matters the way Menu's `useMenuRows` says: Nitro diffs props by
 * identity, so an array rebuilt on every render re-sends the items on every
 * render. The signature is the whole content of the batch — including the checked
 * state, which lives in the *same* arrays native reads — so a rebuild happens
 * exactly when a value changed, not when the caller's inline object literal did.
 *
 * `androidIcon` is resolved here rather than at each use site so the two spellings
 * of one icon (`require` and a resource name) cannot become two size
 * configurations, and so the name warning runs once per value and not once per
 * render (`warnAndroidIconName` keeps its own history for that).
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

/**
 * What the wrapper has to hand its native view to control a *set* of toggles.
 */
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
 * The event-count handshake of `docs/architecture/core.md` §4, for a set.
 *
 * `useControlled` is the same contract for one value; it cannot be reused here
 * because the value this control owns is a *set* that several items move
 * independently: native reports `(id, checked)`, and the JS write is a whole set.
 * The rules are the ones that file spells:
 *
 * - native owns the displayed set and flips an item at once, so there is no visual
 *   latency;
 * - an item whose `checked` is not a boolean is uncontrolled — it is not in
 *   `controlledIds`, so no `checkedIds` write may move it;
 * - a change JS refused (the next render's `checked` unchanged) still moves
 *   `mostRecentEventCount`, so the commit happens and native snaps the item back;
 * - while *no* item is controlled, nothing is echoed and a tap costs no React
 *   render at all — the uncontrolled case is the cheap one.
 *
 * A group with at least one controlled toggle is in controlled mode for its whole
 * set, so a tap on an uncontrolled item in such a group does cost a render. That
 * is documented rather than worked around: per-item handshake counts would let one
 * item's stale write be accepted on the strength of another item's event.
 */
function useControlledCheckedIds(
  checkedIds: string[],
  controlledIds: string[],
  defaultCheckedIds: string[],
  onCheckedChange: ((id: string, checked: boolean) => void) | undefined
): ControlledIdsState {
  const [mostRecentEventCount, setMostRecentEventCount] = useState(0);
  const isControlled = controlledIds.length > 0;
  // Every native event count is remembered, controlled or not, so that a group
  // which *becomes* controlled can catch native up instead of treating its first
  // write as stale (`useControlled` has the same two counters for the same reason).
  const seenEvents = useRef(0);
  const [wasControlled, setWasControlled] = useState(isControlled);
  if (wasControlled !== isControlled) {
    setWasControlled(isControlled);
    if (isControlled && seenEvents.current > mostRecentEventCount) {
      setMostRecentEventCount(seenEvents.current);
    }
  }

  // Everything the native callback needs lives in refs refreshed in the commit
  // phase, so the callback itself keeps one identity forever.
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
      // Echo *before* the user's handler, for useControlled's reason: a handler
      // that throws must not stop the echo, or native would treat every later
      // write as stale from then on. Both updates batch with the user's own
      // `setState`, so the commit still sees both.
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
 * A row of commands — *Copy | Paste | Share* — optionally with independent
 * toggles — *Bold | Italic | Underline*.
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
 * It is not a `SegmentedControl`: a segmented control picks **one** option and has
 * a value, while a group has none, and `docs/components/button-group.md` carries
 * the paragraph that tells the two apart. When the row runs out of room the items
 * that do not fit move into an overflow menu, so the group is `fillWidth` and its
 * height — never its width — is what gets measured (`docs/architecture/sizing.md`).
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

  // Always a function, so the callback prop is always sent — see
  // `onPressNotProvided`; the cast is Button's (`useStableCallback` answers `null`
  // only when handed no handler, and a null callback prop is what D7b forbids on a
  // mounted view).
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

/** Ids already warned about, so a bad `items` array warns once and not per render. */
const warnedDuplicateIds = { done: false };

/** One development warning for a group whose items cannot be told apart. */
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

/** Forget the warning history. For tests, which must each see a fresh console. */
export function resetButtonGroupWarningsForTests(): void {
  warnedDuplicateIds.done = false;
}

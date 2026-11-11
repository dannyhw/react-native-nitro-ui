import { useEffect } from 'react';
import type { ViewProps } from 'react-native';

import { useSizingId } from '../../core/useSizingId';
import {
  useStableCallback,
  type NitroCallbackProp,
} from '../../core/useStableCallback';
import { warnAndroidIconName } from '../../iconName';
import {
  androidIconResourceName,
  androidIconUrl,
  resolveAndroidIcon,
  type AndroidIconProp,
} from '../../iconSource';
import { useInsideFormRow, useFormRowItemPressReporter } from '../Form/Form';
import { NativeNitroUiListItem } from './NativeNitroUiListItem';

/**
 * What the trailing edge of an item draws.
 *
 * `disclosure` is the platform's own "goes somewhere" chevron — UIKit's list
 * disclosure indicator on iOS, Material Symbols' `chevron_right` on Android — and
 * `'none'` draws nothing. `'checkmark'`, a switch in the row and a detail
 * disclosure button are all out of v1 (`docs/tasks/G30-list-item.md`).
 */
export type ListItemAccessory = 'none' | 'disclosure';

const ACCESSORIES: readonly ListItemAccessory[] = ['none', 'disclosure'];

/** Props of {@link ListItem}. */
export interface ListItemProps extends ViewProps {
  /**
   * The headline text. One line, tail-truncated — see {@link ListItem} for why a
   * row never wraps.
   */
  title?: string | null | undefined;
  /**
   * The supporting line under the headline, or `undefined` for none. One line,
   * tail-truncated.
   *
   * This is the one prop that changes the row's height, so it is the one (with the
   * leading icon) that decides its size configuration.
   */
  subtitle?: string | null | undefined;
  /**
   * Trailing text on the headline's own line — "Off", "1.2.3", "Last week" — or
   * `undefined` for none. One line, tail-truncated.
   *
   * It costs no height: the row is as tall as it is with the value alone.
   */
  value?: string | null | undefined;
  /**
   * Leading SF Symbol name, iOS only (Android has no SF Symbols and draws
   * {@link androidIcon} instead). A name the runtime does not have draws nothing,
   * exactly as `Button.systemImage` behaves.
   */
  systemImage?: string | undefined;
  /**
   * Leading icon on Android: `require('./icons/bell.xml')`'s id, a `{ uri }`
   * source, or a drawable name — G43's three forms, the same as `Button.androidIcon`.
   */
  androidIcon?: AndroidIconProp | undefined;
  /** The trailing chevron: `'none'` (the default) or `'disclosure'`. */
  accessory?: ListItemAccessory | undefined;
  /**
   * Disable the row: no press, no highlight, no button role, and the platform's
   * own disabled colours. A tap does nothing and no event fires.
   */
  disabled?: boolean | undefined;
  /**
   * Called when the row is tapped, drawn with the platform's own row highlight.
   *
   * Without it the row is a label, not a button: no highlight, no button role, and
   * a tap goes to whatever is behind the row. Inside a `Form.Row` the *cell* takes this
   * handler and presses for the item, because the cell is the touch target and the only
   * thing that can paint a pressed row — see {@link ListItem}'s "Inside a `Form`"
   * section. A row with a handler of its own keeps its own; wiring both warns.
   */
  onPress?: (() => void) | undefined;
  /**
   * The item's whole accessibility label. Without it native reads title, subtitle
   * and value in the platform's own order.
   */
  accessibilityLabel?: string | undefined;
  /**
   * Access to the native Hybrid Object, for this repo's harness.
   *
   * @internal Not app API (DECISIONS D14): props must flow through React, so a
   * direct write here runs the native setter off the UI thread and never commits.
   * The callback runs once, when the view mounts.
   *
   * The shape is written inline rather than named, for the reason `ButtonProps`
   * gives: naming it would make api-extractor demand that a hidden native type be
   * exported from the entry point.
   */
  hybridRef?:
    | ((view: {
        readonly title: string | null;
        readonly subtitle: string | null;
        readonly value: string | null;
        readonly accessory: string;
        readonly pressable: boolean;
        readonly insideRow: boolean;
        readonly disabled: boolean;
        readonly systemImage: string | null;
        readonly androidIcon: string | null;
        readonly accessibilityLabel: string | null;
        measureContent(): { width: number; height: number };
        nuiTestPress(): void;
        nuiTestProbeAccessibility(): void;
        nuiTestStateReport(): string;
        nuiTestLayoutReport(): string;
        nuiTestPixelProbe(color: number): void;
        nuiTestPixelReport(): string;
        nuiTestLifetimeReport(): string;
      }) => void)
    | undefined;
  /**
   * Instance id used by native perf marks (`nitroUiCore.drainPerf()`). Benchmark
   * only; `null` turns marks off for this view.
   */
  nuiPerfId?: number | null | undefined;
}

/**
 * What a ListItem does when the caller passed no `onPress`: Button's rule
 * (`onPressNotProvided` in `Button.tsx`) — the callback prop is always sent, so it
 * has to be a function that asks for nothing. Whether it is *wired at all* is
 * `pressable`, which the app's `onPress` decides.
 */
function onPressNotProvided(): void {
  // The caller asked for nothing.
}

/** The field separator of {@link sizingVariantFor}, as every component's. */
const FIELD_SEPARATOR = '|';

/**
 * The size configuration of one item, as the sizing engine sees it.
 *
 * Every text slot is capped to one line, so **no text length moves the height** and
 * the key carries only which slots are filled:
 *
 * - the subtitle is the row's second line and the one prop that moves the height on
 *   both platforms (52 → 68.33 pt on iOS, 56 → 72 dp on Android);
 * - the leading icon is here because it is the one slot that could: on Android a
 *   leading composable taller than one line's room raises the row's own minimum, and
 *   the two spellings are one glyph, so `systemImage` and `androidIcon` collapse to
 *   a single `i` field whichever platform reads it;
 * - `value` and `accessory` are measured not to move the height on either platform —
 *   a value shares the headline's line and a chevron fits inside the insets the row
 *   already has;
 * - `disabled`, `accessibilityLabel` and `onPress`/`pressable` repaint or re-role
 *   and do not resize; the environment (text size, density) is folded in by native
 *   through the epoch, so none of them is here.
 *
 * Empty for a title-only row, which is the default configuration the engine's
 * pre-warm looks for (`core/NitroUiIntrinsicProps.ts`).
 */
function sizingVariantFor(hasSubtitle: boolean, hasIcon: boolean): string {
  const fields: string[] = [];
  if (hasSubtitle) {
    fields.push('s');
  }
  if (hasIcon) {
    fields.push('i');
  }
  return fields.join(FIELD_SEPARATOR);
}

/**
 * A row takes the width of the list it is in. `alignSelf: 'stretch'` is what hands
 * it that width — the engine's `fillWidth` policy overrides the measured width with
 * the box's, but only when the box has a finite width, and `alignSelf` is the one
 * thing that decides a Yoga cross-axis size (`docs/architecture/sizing.md` §6, and
 * `Progress.tsx` for the same line).
 */
const FILL_WIDTH_BASE_STYLE = { alignSelf: 'stretch' } as const;

/** Resolve a caller's accessory, defaulting anything unrecognised to `'none'`. */
function resolveAccessory(accessory: ListItemAccessory | undefined): string {
  return accessory != null && ACCESSORIES.includes(accessory)
    ? accessory
    : 'none';
}

/**
 * What a row of a settings screen, an inbox or a menu is made of: the platform's
 * own row content — UIKit's `UIListContentView` on iOS, Material 3's `ListItem` on
 * Android — rather than React Native `Text` approximating it (DECISIONS D46).
 *
 * ```tsx
 * <ListItem title="Push notifications" subtitle="Only while the app is open" />
 * <ListItem title="Version" value="1.2.3" />
 * <ListItem title="Account" systemImage="person.crop.circle"
 *   androidIcon="account_circle" accessory="disclosure" onPress={openAccount} />
 * ```
 *
 * **One line per slot.** Title, subtitle and value are each capped to one line and
 * tail-truncated, and that is a sizing decision, not a style one: it is what makes a
 * row's height a function of *which* slots are filled rather than of what was typed
 * into them, so one cached height per configuration is correct, a warm mount needs
 * no correction, and rows in a `FlashList` or a `Form` keep a stable pitch. The
 * alternative — letting a row wrap — makes the height depend on a width JS does not
 * know when it mounts (`docs/architecture/sizing.md` §5). Multi-line rows are a
 * follow-up, not an oversight.
 *
 * **Inside a `Form.Row`** the leaf draws no insets, no shape and no press of its own
 * beyond what it is told to: the row is the cell, and the cell has already paid for
 * both (D46 item 2). It knows because `Form.Row` publishes that through a context,
 * so nothing has to be configured by hand — and the same context carries the
 * other way too, so an item's `onPress` becomes the cell's press and is drawn with the
 * cell's highlight. That is why the handler can be written on the item alone. Standalone
 * it adds the platform's own list insets, measured to match a real list cell's.
 *
 * `measureContent()` answers the row's own height; the width is the box's
 * (`fillWidth`).
 */
export function ListItem({
  title,
  subtitle,
  value,
  systemImage,
  androidIcon,
  accessory = 'none',
  disabled = false,
  onPress,
  accessibilityLabel,
  testID,
  hybridRef,
  nuiPerfId = null,
  style,
  ...restProps
}: ListItemProps) {
  const resolvedAccessory = resolveAccessory(accessory);
  // One string for native whichever form the caller used, and the same rules
  // `Button.tsx` applies — see there for why only a typed name is checked. Resolved
  // before the size configuration below, because the two spellings of one icon must
  // not be two configurations.
  const resolvedAndroidIcon = resolveAndroidIcon(androidIcon);
  if (
    resolvedAndroidIcon != null &&
    androidIconUrl(resolvedAndroidIcon) == null &&
    androidIconResourceName(resolvedAndroidIcon) == null
  ) {
    warnAndroidIconName('ListItem', 'androidIcon', resolvedAndroidIcon);
  }
  // An empty string is not a slot: it would draw an empty line and, worse, file the
  // row under a configuration the same row with `undefined` does not use, which is
  // two cache entries for one row. `null` and `''` are the same "nothing here".
  const filledTitle = title == null || title === '' ? null : title;
  const filledSubtitle = subtitle == null || subtitle === '' ? null : subtitle;
  const filledValue = value == null || value === '' ? null : value;
  const hasIcon = systemImage != null || resolvedAndroidIcon != null;
  const insideRow = useInsideFormRow();
  const reportRowItemPress = useFormRowItemPressReporter();
  // Inside a row the leaf installs no press of its own (the cell is the touch target, and
  // the cell is what paints a pressed row), so the handler has to travel up to the row
  // that owns the touch - otherwise the README's own shape, a `<Form.Row>` with no handler
  // around a `<ListItem onPress>`, presses in silence: the callback is wired, and nothing
  // on screen ever says the row was pressed. Reported from an effect, because the row is an
  // *ancestor*: reporting during render would set state in a component React is not
  // rendering. `null` on the way out, so a row that loses its item stops being pressable.
  useEffect(() => {
    if (reportRowItemPress == null) {
      return;
    }
    reportRowItemPress(onPress ?? null, disabled);
    return () => {
      reportRowItemPress(null, false);
    };
  }, [reportRowItemPress, onPress, disabled]);
  const sizingId = useSizingId();
  const pressCallback = useStableCallback(
    onPress ?? onPressNotProvided
  ) as NitroCallbackProp<() => void>;
  const hybridRefCallback = useStableCallback(hybridRef);

  return (
    <NativeNitroUiListItem
      {...restProps}
      title={filledTitle}
      subtitle={filledSubtitle}
      value={filledValue}
      systemImage={systemImage ?? null}
      androidIcon={resolvedAndroidIcon}
      accessory={resolvedAccessory}
      pressable={onPress != null}
      insideRow={insideRow}
      disabled={disabled}
      testID={testID ?? null}
      accessibilityLabel={accessibilityLabel ?? null}
      nuiPerfId={nuiPerfId}
      onPress={pressCallback}
      nuiSizingKey={sizingVariantFor(filledSubtitle != null, hasIcon)}
      nuiSizingId={sizingId}
      hybridRef={hybridRefCallback ?? undefined}
      style={[FILL_WIDTH_BASE_STYLE, style]}
    />
  );
}

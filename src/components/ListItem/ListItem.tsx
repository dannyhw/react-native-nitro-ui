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
 * `'disclosure'` is the platform's own "goes somewhere" chevron: UIKit's list
 * disclosure indicator on iOS, Material Symbols' `chevron_right` on Android.
 * `'none'` draws nothing.
 */
export type ListItemAccessory = 'none' | 'disclosure';

const ACCESSORIES: readonly ListItemAccessory[] = ['none', 'disclosure'];

/** Props of {@link ListItem}. */
export interface ListItemProps extends ViewProps {
  /** The headline text. One line, tail-truncated. */
  title?: string | null | undefined;
  /**
   * The supporting line under the headline, or `undefined` for none. One line,
   * tail-truncated. It makes the row taller.
   */
  subtitle?: string | null | undefined;
  /**
   * Trailing text on the headline's own line — "Off", "1.2.3", "Last week" — or
   * `undefined` for none. One line, tail-truncated. It adds no height.
   */
  value?: string | null | undefined;
  /**
   * Leading SF Symbol name, iOS only (Android has no SF Symbols and draws
   * {@link androidIcon} instead). A name the runtime does not have draws nothing.
   */
  systemImage?: string | undefined;
  /**
   * Leading icon on Android: a `require('./icons/bell.xml')` asset, a `{ uri }`
   * source, or a drawable resource name, as `Button`'s `androidIcon` takes.
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
   * a tap goes to whatever is behind the row. Inside a `Form.Row` the row takes
   * this handler and presses for the item, so it can be written on the item
   * alone. A `Form.Row` with a handler of its own keeps its own; wiring both
   * warns.
   */
  onPress?: (() => void) | undefined;
  /**
   * The item's whole accessibility label. Without it native reads title, subtitle
   * and value in the platform's own order.
   */
  accessibilityLabel?: string | undefined;
  /**
   * Read-only access to the native view, for this library's own tests.
   *
   * @internal Not app API. A write through this handle bypasses React and never
   * commits. The callback runs once, when the view mounts.
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
   * Instance id for native performance marks; `null` turns them off for this
   * view. Benchmark only.
   */
  nuiPerfId?: number | null | undefined;
}

/**
 * Sent when the caller passes no `onPress`: the callback prop is always sent.
 * Whether the row is pressable at all is the `pressable` prop.
 */
function onPressNotProvided(): void {
  // The caller asked for nothing.
}

const FIELD_SEPARATOR = '|';

/**
 * The key two items share when they are the same height. Every text slot is one
 * line, so no text length changes the height and the key says only which slots
 * are filled: the subtitle (a second line) and the leading icon (on Android a
 * tall leading slot can raise the row's minimum). `systemImage` and
 * `androidIcon` are one `i` field. `value` and `accessory` do not change the
 * height. A title-only row has the empty key.
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
 * A row takes the width of the list it is in. `alignSelf: 'stretch'` gives it
 * that width: the measured width is replaced by the box's only when the box has
 * a finite width.
 */
const FILL_WIDTH_BASE_STYLE = { alignSelf: 'stretch' } as const;

function resolveAccessory(accessory: ListItemAccessory | undefined): string {
  return accessory != null && ACCESSORIES.includes(accessory)
    ? accessory
    : 'none';
}

/**
 * A row of a settings screen, an inbox or a menu, drawn by the platform's own
 * row content: UIKit's `UIListContentView` on iOS, Material 3's `ListItem` on
 * Android.
 *
 * ```tsx
 * <ListItem title="Push notifications" subtitle="Only while the app is open" />
 * <ListItem title="Version" value="1.2.3" />
 * <ListItem title="Account" systemImage="person.crop.circle"
 *   androidIcon="account_circle" accessory="disclosure" onPress={openAccount} />
 * ```
 *
 * Title, subtitle and value are each one line, tail-truncated, so a row's height
 * depends only on which of them are set.
 *
 * Inside a `Form.Row` the item draws no insets or shape of its own, and its
 * `onPress` becomes the row's press, drawn with the row's highlight. Nothing has
 * to be configured for that. Standalone it adds the platform's own list insets.
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
  // Resolved before the sizing key so both spellings of one icon (an asset or a
  // name) share one key.
  const resolvedAndroidIcon = resolveAndroidIcon(androidIcon);
  // Neither a URL nor a valid resource name is most likely a typo, and native
  // would draw nothing without saying why.
  if (
    resolvedAndroidIcon != null &&
    androidIconUrl(resolvedAndroidIcon) == null &&
    androidIconResourceName(resolvedAndroidIcon) == null
  ) {
    warnAndroidIconName('ListItem', 'androidIcon', resolvedAndroidIcon);
  }
  // An empty string is not a slot: it would draw an empty line and give the row
  // a different sizing key from the same row with `undefined`.
  const filledTitle = title == null || title === '' ? null : title;
  const filledSubtitle = subtitle == null || subtitle === '' ? null : subtitle;
  const filledValue = value == null || value === '' ? null : value;
  const hasIcon = systemImage != null || resolvedAndroidIcon != null;
  const insideRow = useInsideFormRow();
  const reportRowItemPress = useFormRowItemPressReporter();
  // Inside a `Form.Row` the cell is the touch target and paints the pressed
  // state, so the handler is handed up to the row. From an effect because the
  // row is an ancestor: reporting during render would set state in a component
  // React is not rendering. `null` on cleanup makes the row unpressable again.
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

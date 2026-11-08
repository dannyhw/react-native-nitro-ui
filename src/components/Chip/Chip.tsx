import { useState } from 'react';
import { Platform, type ViewProps } from 'react-native';

import { useControlled } from '../../core/useControlled';
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
import { NativeNitroUiChip } from './NativeNitroUiChip';

/**
 * What a chip is for, named after the Material 3 chip types.
 *
 * - `filter` has a selection: Material 3 `FilterChip`, SwiftUI
 *   `Toggle(isOn:) { … }.toggleStyle(.button)`.
 * - `assist` is an action: Material 3 `AssistChip`, a SwiftUI `Button` with the
 *   bordered capsule style.
 *
 * Material's `input` and `suggestion` chips are not in v1; the union is open so
 * they can be added without breaking anyone. `docs/components/chip.md` has the
 * table.
 */
export type ChipVariant = 'filter' | 'assist';

const VARIANTS: readonly ChipVariant[] = ['filter', 'assist'];

/**
 * Props of {@link Chip}.
 *
 * There are no children: the label is the `label` string, as a Button's is its
 * `title` (`docs/architecture/core.md`, leaf Hybrid Views).
 */
export interface ChipProps extends ViewProps {
  /** The chip's text. Also its default accessibility label, and part of its size. */
  label: string;
  /** What the chip is for. Default: `'filter'`. */
  variant?: ChipVariant | undefined;
  /**
   * Filter chips: the selection. Pass it to control the chip; leave it
   * `undefined` for an uncontrolled one (native then owns what is shown). Ignored
   * by an assist chip.
   */
  selected?: boolean | undefined;
  /** Filter chips: the initial selection of an uncontrolled chip. Default: `false`. */
  defaultSelected?: boolean | undefined;
  /**
   * Filter chips: called with the new selection after every user toggle. A
   * controlled chip that does not pass the value back reverts.
   */
  onSelectedChange?: ((selected: boolean) => void) | undefined;
  /** Assist chips: called once per tap. Nothing fires while `disabled`. */
  onPress?: (() => void) | undefined;
  /** Disable interaction. Default: `false`. */
  disabled?: boolean | undefined;
  /**
   * Leading SF Symbol name. iOS only - Android ignores it, as it does a Button's
   * (`docs/components/button.md`), so it never changes the label's text there.
   */
  systemImage?: string | undefined;
  /**
   * Leading glyph for Android: an app-shipped vector drawable, as
   * `require('./icons/share.xml')` or as its resource name (`"share"`) - the two forms
   * `Button`'s `androidIcon` takes (`docs/components/button.md`, "Android icons").
   *
   * Android only, like `Button`'s: iOS draws `systemImage` and ignores this. An assist
   * chip draws it beside the label; a filter chip draws it while unselected, and the
   * leading check takes the slot when selected. A name that resolves to nothing leaves
   * the chip exactly its no-icon self.
   */
  androidIcon?: AndroidIconProp | undefined;
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
        readonly label: string;
        readonly variant: string;
        readonly selected: boolean | null;
        readonly mostRecentEventCount: number;
        readonly disabled: boolean;
        readonly systemImage: string | null;
        readonly androidIcon: string | null;
        readonly accessibilityLabel: string | null;
        measureContent(): { width: number; height: number };
        nuiTestPress(): void;
        nuiTestProbeAccessibility(): void;
        nuiTestStateReport(): string;
        nuiTestPixelProbe(color: number): void;
        nuiTestPixelReport(): string;
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

/**
 * What a chip does when the caller passed no `onPress`: Button's rule
 * (`onPressNotProvided` in `Button.tsx`) - the callback prop is always sent, so
 * a recycled view cannot keep the previous mount's handler.
 */
function onPressNotProvided(): void {
  // Intentionally empty: the caller asked for nothing.
}

/**
 * Whether a filter chip's selection changes its size on this platform.
 *
 * Android: yes. Material 3's selected `FilterChip` gains a leading check, so the
 * selected chip is wider, and the sizing key has to say which one is showing.
 * iOS: no. `Toggle(.button)` fills the same capsule; the harness asserts the two
 * states measure the same, so this is a measurement and not a hope. Keeping the
 * selection out of the iOS key is what keeps a first toggle there from being a
 * cold configuration with a frame at the declared fallback.
 */
const SELECTION_RESIZES = Platform.OS === 'android';

/**
 * The separator between the fields of a Chip's `nuiSizingKey`, and the escape
 * that keeps a free-form value from forging one - G10's rule for Button
 * (`\` -> `\\`, `|` -> `\|`).
 */
const FIELD_SEPARATOR = '|';

/** Escape one free-form value so it cannot forge a separator. */
function escapeField(value: string): string {
  return value.replace(/[\\|]/g, '\\$&');
}

/**
 * The size configuration of one Chip, as the sizing engine sees it:
 * `variant|selected|systemImage|androidIcon|label`.
 *
 * - `variant` picks a different control (and on Android a different padding);
 * - `selected` is `1` only where a selection moves the size: a filter chip on
 *   Android (see {@link SELECTION_RESIZES}). Everywhere else it is `0`, so the
 *   field is fixed-width and a toggle is not a new configuration;
 * - `systemImage` and `androidIcon` are the two roads to a leading glyph, one per
 *   platform. Both are here on both platforms: the glyph widens the chip on whichever
 *   platform draws it (Android the `androidIcon`, iOS the `systemImage`), and one key
 *   read by both is what keeps a chip with a glyph on one platform from inheriting the
 *   cached width of a chip without one on the other. The value is the *resolved*
 *   string, so `share-24px` and `share_24px` stay one configuration;
 * - `label` is the chip's width;
 * - `disabled` repaints and does not resize, and the environment (text size,
 *   density) is folded in by native through the epoch, so neither is here.
 */
function sizingVariantFor(
  variant: ChipVariant,
  shownSelected: boolean,
  systemImage: string | undefined,
  androidIcon: string | null,
  label: string
): string {
  const selectedField =
    variant === 'filter' && SELECTION_RESIZES && shownSelected ? '1' : '0';
  return [
    variant,
    selectedField,
    escapeField(systemImage ?? ''),
    escapeField(androidIcon ?? ''),
    escapeField(label),
  ].join(FIELD_SEPARATOR);
}

/**
 * What a self-sizing control is laid out with, before any `style`: Button's and
 * Switch's base style, for their reason (a column's `alignItems: stretch` would
 * otherwise decide the width and the measurement would never be asked for).
 */
const SELF_SIZING_BASE_STYLE = { alignSelf: 'flex-start' } as const;

/** Resolve a caller's variant, defaulting anything unrecognised to `'filter'`. */
function resolveVariant(variant: ChipVariant | undefined): ChipVariant {
  return variant != null && VARIANTS.includes(variant) ? variant : 'filter';
}

/**
 * A compact choice or action: Material 3 `FilterChip` / `AssistChip` on Android,
 * SwiftUI `Toggle(.button)` / a bordered capsule `Button` on iOS (iOS has no
 * chip, and these are the two real controls that do the two jobs).
 *
 * ```tsx
 * const [vegan, setVegan] = useState(false)
 * <Chip label="Vegan" selected={vegan} onSelectedChange={setVegan} />
 * <Chip variant="assist" label="Directions" onPress={openMaps} />
 * ```
 *
 * The box is measured, not declared: the first chip of a configuration is laid
 * out at a fallback and corrected the turn it measures
 * (`docs/architecture/sizing.md`).
 */
export function Chip({
  label,
  variant = 'filter',
  selected,
  defaultSelected = false,
  onSelectedChange,
  onPress,
  disabled = false,
  systemImage,
  androidIcon,
  testID,
  accessibilityLabel,
  hybridRef,
  nuiPerfId = null,
  style,
  ...restProps
}: ChipProps) {
  const resolvedVariant = resolveVariant(variant);
  // One string for native whichever form the caller used, and the same rules
  // `Button.tsx` applies - see there for why only a typed name is checked. Resolved
  // before the size configuration below, because the two spellings of one icon must
  // not be two configurations.
  const resolvedAndroidIcon = resolveAndroidIcon(androidIcon);
  if (
    resolvedAndroidIcon != null &&
    androidIconUrl(resolvedAndroidIcon) == null &&
    androidIconResourceName(resolvedAndroidIcon) == null
  ) {
    warnAndroidIconName('Chip', 'androidIcon', resolvedAndroidIcon);
  }
  const sizingId = useSizingId();
  // What native seeded an uncontrolled chip with. Native applies `defaultSelected`
  // once per mount (Switch's rule), so a later change to the prop is not what is
  // showing, and the key must not claim it is.
  const [seeded] = useState(defaultSelected);
  // What an uncontrolled chip showed its user last, where that moves the size.
  //
  // Native owns an uncontrolled chip's selection and a toggle costs no React render
  // (core.md section 4) - except where the selection is in the sizing key. There a
  // key that never moved would file the selected chip's width under the unselected
  // configuration: Picker's G6 review M1, and Picker's fix, one render per toggle.
  // Stamped with the sizing id like Picker's, so a choice can only ever describe
  // the mount that made it.
  //
  // The render carries the toggle's event count as well, as a controlled chip's
  // does. Native holds the toggle's size report until JS has seen *every* toggle
  // (`HybridNitroUiChip.afterUpdate`): a batch keyed for an older toggle - a second
  // toggle landed before the first one's render reached native - must not have the
  // newer toggle's width filed under it (G12 review, fix round 1).
  const [lastChoice, setLastChoice] = useState<{
    readonly sizingId: number;
    readonly selected: boolean;
    readonly eventCount: number;
  } | null>(null);
  const controlled = useControlled<boolean>(
    selected,
    defaultSelected,
    onSelectedChange
  );
  const forwardNativeChange = controlled.onNativeChange.f;
  const onNativeSelectedChange = useStableCallback(
    (next: boolean, eventCount: number) => {
      if (SELECTION_RESIZES && selected === undefined) {
        setLastChoice({ sizingId, selected: next, eventCount });
      }
      forwardNativeChange(next, eventCount);
    }
  ) as NitroCallbackProp<(next: boolean, eventCount: number) => void>;
  const chosen =
    lastChoice !== null && lastChoice.sizingId === sizingId ? lastChoice : null;
  const shownSelected =
    controlled.value !== null ? controlled.value : (chosen?.selected ?? seeded);
  // `useControlled` echoes only while controlled; an uncontrolled Android chip
  // echoes its last toggle here. Counts only grow within a mount, and a new mount
  // (a new sizing id) starts again at 0, as native's reset does.
  const mostRecentEventCount = Math.max(
    controlled.mostRecentEventCount,
    chosen?.eventCount ?? 0
  );
  // Always a function - see `onPressNotProvided`. The cast states what the `??`
  // guarantees, as `Button.tsx` does.
  const pressCallback = useStableCallback(
    onPress ?? onPressNotProvided
  ) as NitroCallbackProp<() => void>;
  const hybridRefCallback = useStableCallback(hybridRef);

  return (
    <NativeNitroUiChip
      {...restProps}
      label={label}
      variant={resolvedVariant}
      selected={controlled.value}
      defaultSelected={controlled.defaultValue}
      mostRecentEventCount={mostRecentEventCount}
      disabled={disabled}
      systemImage={systemImage ?? null}
      androidIcon={resolvedAndroidIcon}
      testID={testID ?? null}
      accessibilityLabel={accessibilityLabel ?? null}
      nuiPerfId={nuiPerfId}
      onSelectedChange={onNativeSelectedChange}
      onPress={pressCallback}
      nuiSizingKey={sizingVariantFor(
        resolvedVariant,
        shownSelected,
        systemImage,
        resolvedAndroidIcon,
        label
      )}
      nuiSizingId={sizingId}
      hybridRef={hybridRefCallback ?? undefined}
      style={[SELF_SIZING_BASE_STYLE, style]}
    />
  );
}

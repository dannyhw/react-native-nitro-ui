import { useState } from 'react';
import { Platform, type ViewProps } from 'react-native';

import { useControlled } from '../../core/useControlled';
import { useSizingId } from '../../core/useSizingId';
import { useSelfSizingBaseStyle } from '../../core/useSelfSizing';
import {
  useStableCallback,
  type NitroCallbackProp,
} from '../../core/useStableCallback';
import { warnAndroidIconName } from '../../iconName';
import { warnIosSystemImageName } from '../../systemImageName';
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
 */
export type ChipVariant = 'filter' | 'assist';

const VARIANTS: readonly ChipVariant[] = ['filter', 'assist'];

/** Props of {@link Chip}. The label is the `label` string; there are no children. */
export interface ChipProps extends ViewProps {
  /** The chip's text. Also its default accessibility label, and part of its size. */
  label: string;
  /** What the chip is for. Default: `'filter'`. */
  variant?: ChipVariant | undefined;
  /**
   * Filter chips: the selection. Pass it to control the chip; leave it
   * `undefined` for an uncontrolled one. Ignored by an assist chip.
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
  /** Leading SF Symbol name. iOS only - Android ignores it. */
  systemImage?: string | undefined;
  /**
   * Leading icon on Android: an app-shipped vector drawable, as
   * `require('./icons/share.xml')` or as its resource name (`"share"`).
   *
   * Android only: iOS draws `systemImage` and ignores this. An assist chip draws
   * it beside the label; a filter chip draws it while unselected, and the leading
   * check takes its place when selected. An icon that cannot be resolved draws
   * nothing.
   */
  androidIcon?: AndroidIconProp | undefined;
  /**
   * Read-only access to the native view, for this library's own tests.
   *
   * @internal Not app API. A write through this handle bypasses React and never
   * commits. The callback runs once, when the view mounts.
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
   * Instance id for native performance marks; `null` turns them off for this view.
   *
   * @internal Benchmark and diagnostics only - not app API.
   */
  nuiPerfId?: number | null | undefined;
}

/**
 * Sent when the caller passes no `onPress`. The callback prop is always sent, so
 * a recycled view cannot keep the previous mount's handler.
 */
function onPressNotProvided(): void {
  // Intentionally empty: the caller asked for nothing.
}

/**
 * Whether a filter chip's selection changes its size. On Android the selected
 * `FilterChip` gains a leading check and is wider; on iOS both states fill the
 * same capsule, so the selection stays out of the sizing key there.
 */
const SELECTION_RESIZES = Platform.OS === 'android';

/**
 * Separates the fields of a Chip's `nuiSizingKey`. Free-form values are escaped
 * so they cannot contain a bare separator.
 */
const FIELD_SEPARATOR = '|';

/** Escape one free-form value so it cannot forge a separator. */
function escapeField(value: string): string {
  return value.replace(/[\\|]/g, '\\$&');
}

/**
 * The key two Chips share when they are the same size:
 * `variant|selected|systemImage|androidIcon|label`.
 *
 * `selected` is `1` only where the selection changes the size (see
 * {@link SELECTION_RESIZES}). Both icon props are in the key on both platforms;
 * each widens the chip on the platform that draws it. The icon is the resolved
 * string, so two spellings of one name share a key. `disabled` only repaints,
 * and text size and density are tracked natively.
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

function resolveVariant(variant: ChipVariant | undefined): ChipVariant {
  return variant != null && VARIANTS.includes(variant) ? variant : 'filter';
}

/**
 * A compact choice or action: Material 3 `FilterChip` / `AssistChip` on Android,
 * SwiftUI `Toggle(.button)` / a bordered capsule `Button` on iOS, which has no
 * chip control.
 *
 * ```tsx
 * const [vegan, setVegan] = useState(false)
 * <Chip label="Vegan" selected={vegan} onSelectedChange={setVegan} />
 * <Chip variant="assist" label="Directions" onPress={openMaps} />
 * ```
 *
 * It sizes itself to its label and icon.
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
  const selfSizingBaseStyle = useSelfSizingBaseStyle();
  const resolvedVariant = resolveVariant(variant);
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
    warnAndroidIconName('Chip', 'androidIcon', resolvedAndroidIcon);
  }
  if (systemImage != null) {
    warnIosSystemImageName('Chip', 'systemImage', systemImage);
  }
  const sizingId = useSizingId();
  // Native applies `defaultSelected` once per mount, so a later change to the
  // prop is not what is showing and must not reach the sizing key.
  const [seeded] = useState(defaultSelected);
  // An uncontrolled chip's last toggle, kept only where the selection is in the
  // sizing key: without a render per toggle the selected width would be cached
  // under the unselected key. Stamped with the sizing id so it describes only
  // the mount that made it. It carries the event count because native holds a
  // toggle's size report until JS has echoed every toggle.
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
  // `useControlled` echoes only while controlled; an uncontrolled chip echoes its
  // last toggle here. A new mount (a new sizing id) starts again at 0.
  const mostRecentEventCount = Math.max(
    controlled.mostRecentEventCount,
    chosen?.eventCount ?? 0
  );
  // Always a function, so the callback prop is always sent. The cast is safe:
  // `useStableCallback` returns `null` only when it is handed no handler.
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
      style={[selfSizingBaseStyle, style]}
    />
  );
}

import { type ColorValue, type ViewProps } from 'react-native';

import { warnAndroidIconName } from '../../iconName';
import {
  androidIconResourceName,
  androidIconUrl,
  resolveAndroidIcon,
  type AndroidIconProp,
} from '../../iconSource';
import { useControlled } from '../../core/useControlled';
import type { NitroCallbackProp } from '../../core/useStableCallback';
import { useProcessedColor } from '../../core/useProcessedColor';
import { useSizingId } from '../../core/useSizingId';
import { useStableCallback } from '../../core/useStableCallback';
import { useSelfSizingBaseStyle } from '../../core/useSelfSizing';
import type { ButtonShape } from '../Button/Button';
import { NativeNitroUiIconButton } from './NativeNitroUiIconButton';

/**
 * The four icon-button styles, named after the Material 3 components
 * (`IconButton` / `FilledIconButton` / `FilledTonalIconButton` /
 * `OutlinedIconButton`).
 *
 * `standard` is Material's bare icon button: no container, just the icon. iOS
 * draws its closest native style for each; the two sets do not line up one to
 * one.
 */
export type IconButtonVariant = 'standard' | 'filled' | 'tonal' | 'outlined';

/**
 * The control's size. The values are `ButtonSize`'s, so one word means the same
 * size on both components.
 *
 * On Android each value is one of Material's icon-button sizes: `small`=XS,
 * `medium`=S, `large`=M, `xlarge`=L, `xxlarge`=XL. On iOS it picks a control
 * size.
 */
export type IconButtonSize =
  | 'small'
  | 'medium'
  | 'large'
  | 'xlarge'
  | 'xxlarge';

/**
 * How wide the control is for its size: Material's three width options.
 *
 * **Android only.** iOS has no counterpart, so the option is accepted and
 * ignored there.
 */
export type IconButtonWidth = 'narrow' | 'uniform' | 'wide';

/**
 * The corner, shared with `ButtonShape`: `'round'` is each platform's default,
 * `'square'` is the nearest corner that platform has.
 */
export type IconButtonShape = ButtonShape;

const VARIANTS: readonly IconButtonVariant[] = [
  'standard',
  'filled',
  'tonal',
  'outlined',
];
const SIZES: readonly IconButtonSize[] = [
  'small',
  'medium',
  'large',
  'xlarge',
  'xxlarge',
];
const WIDTHS: readonly IconButtonWidth[] = ['narrow', 'uniform', 'wide'];
const SHAPES: readonly ButtonShape[] = ['round', 'square'];

/**
 * Props of {@link IconButton}.
 *
 * There are no children and no text: the icon is the whole control, which is why
 * {@link accessibilityLabel} is required.
 */
export interface IconButtonProps extends ViewProps {
  /**
   * What a screen reader reads — the control's only name, because an IconButton
   * has no text. **Required in the type**, and an empty string warns in
   * development: a button with no name is announced as "button" and is unusable
   * with VoiceOver or TalkBack.
   */
  accessibilityLabel: string;
  /**
   * SF Symbol name. **iOS only** — Android has no SF Symbols, so the prop is
   * accepted there and draws nothing; name the drawable in {@link androidIcon} and
   * each platform takes its own.
   */
  systemImage?: string | undefined;
  /**
   * The icon on Android: a vector drawable the app owns, passed as a Metro asset
   * (`androidIcon={require('./icons/share.xml')}`) or, for an app that already
   * ships drawables, as its Android resource name (`'share'`). **Android only** —
   * iOS draws {@link systemImage} and ignores this.
   *
   * An asset needs no setup step. The icon's size comes from {@link size}, never
   * from the file. Artwork that cannot be resolved draws nothing.
   */
  androidIcon?: AndroidIconProp | undefined;
  /** Called once per tap on the press form. Nothing fires while `disabled`. */
  onPress?: (() => void) | undefined;
  /** Visual style. Default: `'standard'`. */
  variant?: IconButtonVariant | undefined;
  /** Control size. Default: `'medium'`. */
  size?: IconButtonSize | undefined;
  /**
   * Width for the size. **Android only** (see {@link IconButtonWidth}).
   * Default: `'uniform'`.
   */
  width?: IconButtonWidth | undefined;
  /** Corner: `'round'` (the default) or `'square'`. `null` means the default. */
  shape?: ButtonShape | null | undefined;
  /**
   * The toggle form's selection. Pass it to control the toggle; leave it
   * `undefined` for an uncontrolled one or for a plain press button.
   *
   * Any of `checked`, `defaultChecked` or `onCheckedChange` makes the control a
   * toggle instead of a press button: it shows an on state, and reports
   * {@link onCheckedChange} rather than {@link onPress}.
   */
  checked?: boolean | undefined;
  /** Toggle form: the initial selection of an uncontrolled toggle. Default: `false`. */
  defaultChecked?: boolean | undefined;
  /**
   * Toggle form: called with the new selection after every user toggle. A
   * controlled toggle that does not pass the value back reverts.
   */
  onCheckedChange?: ((checked: boolean) => void) | undefined;
  /** Disable interaction. Default: `false`. */
  disabled?: boolean | undefined;
  /**
   * Colour: SwiftUI `.tint()` on iOS; on Android the variant's container colour,
   * or its content colour for `outlined` (which has no container to fill).
   * Default: the platform accent / the Material 3 scheme.
   */
  tintColor?: ColorValue | undefined;
  /**
   * Read-only access to the native view, for this library's own tests and
   * benchmarks.
   *
   * @internal Not app API. A write through this handle bypasses React and never
   * commits. The callback runs once, when the view mounts.
   */
  hybridRef?:
    | ((view: {
        readonly accessibilityLabel: string;
        readonly systemImage: string | null;
        readonly androidIcon: string | null;
        readonly variant: string;
        readonly size: string;
        readonly width: string;
        readonly shape: string;
        readonly disabled: boolean;
        readonly tintColor: number | null;
        readonly checked: boolean | null;
        readonly mostRecentEventCount: number;
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
 * Sent when the caller passes no `onPress`. The callback prop is always sent:
 * Nitro treats `undefined` as "unset", so a recycled view would otherwise keep
 * the previous mount's handler.
 */
function onPressNotProvided(): void {
  // Intentionally empty: the caller asked for nothing.
}

/**
 * Separates the fields of an IconButton's `nuiSizingKey`. Free-form values are
 * escaped so they cannot contain a bare separator.
 */
const FIELD_SEPARATOR = '|';

/** Escape one free-form value so it cannot forge a separator. */
function escapeField(value: string): string {
  return value.replace(/[\\|]/g, '\\$&');
}

/**
 * The key two IconButtons share when they are the same size:
 * `variant|size|width|form|systemImage|androidIcon`.
 *
 * `form` is `press` or `toggle`: on iOS those are two controls (`Button` and
 * `Toggle(.button)`) with different boxes for the same configuration. The symbol
 * sets the width on iOS. `width` and `androidIcon` cannot change an iOS or an
 * Android box respectively, and are here so both platforms read one key.
 * `checked`, `disabled`, `tintColor` and `shape` only repaint, and text size and
 * density are tracked natively.
 */
function sizingVariantFor(
  variant: IconButtonVariant,
  size: IconButtonSize,
  width: IconButtonWidth,
  isToggle: boolean,
  systemImage: string | undefined,
  androidIcon: string | undefined
): string {
  return [
    variant,
    size,
    width,
    isToggle ? 'toggle' : 'press',
    escapeField(systemImage ?? ''),
    escapeField(androidIcon ?? ''),
  ].join(FIELD_SEPARATOR);
}

function resolveVariant(
  variant: IconButtonVariant | undefined
): IconButtonVariant {
  return variant != null && VARIANTS.includes(variant) ? variant : 'standard';
}

function resolveSize(size: IconButtonSize | undefined): IconButtonSize {
  return size != null && SIZES.includes(size) ? size : 'medium';
}

function resolveWidth(width: IconButtonWidth | undefined): IconButtonWidth {
  return width != null && WIDTHS.includes(width) ? width : 'uniform';
}

function resolveShape(shape: ButtonShape | null | undefined): ButtonShape {
  return shape != null && SHAPES.includes(shape) ? shape : 'round';
}

const warnedEmptyLabel = { done: false };

/**
 * Warns once per process, in development, about an empty `accessibilityLabel`.
 * The type requires the prop but cannot reject `""`.
 */
function warnAboutEmptyLabel(accessibilityLabel: string): void {
  if (!__DEV__ || warnedEmptyLabel.done || accessibilityLabel !== '') {
    return;
  }
  warnedEmptyLabel.done = true;
  console.warn(
    'nitro-ui: an IconButton was rendered with an empty accessibilityLabel. An ' +
      'IconButton has no text, so that label is the only name a screen reader ' +
      'has to read — with it empty, the control is announced as "button" and ' +
      'cannot be used with VoiceOver or TalkBack.'
  );
}

/** Forget the warning history. For tests, which must each see a fresh console. */
export function resetIconButtonWarningsForTests(): void {
  warnedEmptyLabel.done = false;
}

/**
 * A single icon as a control: Material 3's four icon buttons and their toggle
 * forms on Android, and a SwiftUI `Button` / `Toggle(.button)` with
 * `.labelStyle(.iconOnly)` on iOS.
 *
 * ```tsx
 * <IconButton
 *   accessibilityLabel="Search"
 *   systemImage="magnifyingglass"
 *   androidIcon={require('./icons/search.xml')}
 *   onPress={openSearch}
 * />
 *
 * <IconButton
 *   accessibilityLabel="Bookmark"
 *   systemImage="bookmark"
 *   androidIcon="bookmark"
 *   variant="filled"
 *   checked={saved}
 *   onCheckedChange={setSaved}
 * />
 * ```
 *
 * It sizes itself to its icon, variant, size and width.
 */
export function IconButton({
  accessibilityLabel,
  systemImage,
  androidIcon,
  onPress,
  variant = 'standard',
  size = 'medium',
  width = 'uniform',
  shape = 'round',
  checked,
  defaultChecked,
  onCheckedChange,
  disabled = false,
  tintColor,
  testID,
  hybridRef,
  nuiPerfId = null,
  style,
  ...restProps
}: IconButtonProps) {
  const selfSizingBaseStyle = useSelfSizingBaseStyle();
  warnAboutEmptyLabel(accessibilityLabel);

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
    warnAndroidIconName('IconButton', 'androidIcon', resolvedAndroidIcon);
  }

  const resolvedVariant = resolveVariant(variant);
  const resolvedSize = resolveSize(size);
  const resolvedWidth = resolveWidth(width);
  const resolvedShape = resolveShape(shape);
  const processedTint = useProcessedColor(tintColor);

  // The form is what the caller wrote. `defaultChecked` has no destructuring
  // default: a default of `false` would make every IconButton a toggle.
  const isToggle =
    checked !== undefined ||
    defaultChecked !== undefined ||
    onCheckedChange !== undefined;
  const controlled = useControlled<boolean>(
    isToggle ? checked : undefined,
    defaultChecked ?? false,
    onCheckedChange
  );

  // Always a function, so the callback prop is always sent. The cast is safe:
  // `useStableCallback` returns `null` only when it is handed no handler.
  const pressCallback = useStableCallback(
    onPress ?? onPressNotProvided
  ) as NitroCallbackProp<() => void>;
  const hybridRefCallback = useStableCallback(hybridRef);
  const sizingId = useSizingId();

  return (
    <NativeNitroUiIconButton
      {...restProps}
      accessibilityLabel={accessibilityLabel}
      systemImage={systemImage ?? null}
      androidIcon={resolvedAndroidIcon}
      variant={resolvedVariant}
      size={resolvedSize}
      width={resolvedWidth}
      shape={resolvedShape}
      disabled={disabled}
      tintColor={processedTint}
      // A press button sends `null` for both, so native composes a Button and not
      // a Toggle. An uncontrolled toggle is seeded through `defaultChecked`.
      checked={isToggle ? controlled.value : null}
      defaultChecked={isToggle ? controlled.defaultValue : null}
      mostRecentEventCount={controlled.mostRecentEventCount}
      testID={testID ?? null}
      nuiPerfId={nuiPerfId}
      onPress={pressCallback}
      onCheckedChange={controlled.onNativeChange}
      nuiSizingKey={sizingVariantFor(
        resolvedVariant,
        resolvedSize,
        resolvedWidth,
        isToggle,
        systemImage,
        resolvedAndroidIcon ?? undefined
      )}
      nuiSizingId={sizingId}
      hybridRef={hybridRefCallback ?? undefined}
      style={[selfSizingBaseStyle, style]}
    />
  );
}

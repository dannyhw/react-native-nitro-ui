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
 * The four icon-button styles, named after the Material 3 components they are
 * (`IconButton` / `FilledIconButton` / `FilledTonalIconButton` /
 * `OutlinedIconButton`).
 *
 * `standard` is Material's bare icon button: no container, just the glyph. The
 * iOS mapping is in `docs/components/icon-button.md` — iOS has four button
 * styles and four icon-button looks, and they do not line up one to one.
 */
export type IconButtonVariant = 'standard' | 'filled' | 'tonal' | 'outlined';

/**
 * The control's size: the same shared ladder as `ButtonSize` (D42 item 4), so one
 * word means the same rung on both components.
 *
 * On Android a rung *is* Material's own icon-button size token, so in Material's
 * language `small`=XS, `medium`=S, `large`=M, `xlarge`=L, `xxlarge`=XL. On iOS the
 * rung picks a `.controlSize`; `docs/components/icon-button.md` prints the
 * measured box on each platform.
 */
export type IconButtonSize =
  'small' | 'medium' | 'large' | 'xlarge' | 'xxlarge';

/**
 * How wide the control is for its rung — Material's three width options.
 *
 * **Android only.** iOS has no counterpart: its icon-button box is the symbol
 * plus the style's own padding, and nothing makes it wider or narrower while
 * keeping it the same height. The option is accepted and ignored there, and it is
 * part of the size configuration on both platforms so neither can cache the
 * other's box.
 */
export type IconButtonWidth = 'narrow' | 'uniform' | 'wide';

/**
 * The corner, shared with `ButtonShape`: `'round'` is each platform's own default,
 * `'square'` is the nearest corner that platform has. One vocabulary for the two
 * components, so a `Button` and an `IconButton` side by side take the same word.
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
 * There are no children and no text: the glyph is the whole control, which is why
 * {@link accessibilityLabel} is the one prop this component requires.
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
   * each platform takes its own (the Button convention).
   *
   * The symbol is part of the control's width on iOS, so it is part of the size
   * configuration.
   */
  systemImage?: string | undefined;
  /**
   * The glyph on Android: a vector drawable the app owns, passed as a Metro asset
   * (`androidIcon={require('./icons/share.xml')}`) or, for an app that already
   * ships drawables, as its Android resource name (`'share'`). **Android only** —
   * iOS draws {@link systemImage} and ignores this.
   *
   * Metro carries the file, so there is no setup step, and the glyph's *size*
   * comes from {@link size} rather than from the file, which is why the box is
   * right before the bytes arrive. Artwork that cannot be resolved draws nothing.
   * `docs/components/button.md`, "Android icons", covers formats, sources and the
   * resource shrinker.
   */
  androidIcon?: AndroidIconProp | undefined;
  /** Called once per tap on the press form. Nothing fires while `disabled`. */
  onPress?: (() => void) | undefined;
  /** Visual style. Default: `'standard'`. */
  variant?: IconButtonVariant | undefined;
  /** Control size — the shared ladder. Default: `'medium'`. */
  size?: IconButtonSize | undefined;
  /**
   * Width for the rung. **Android only** (see {@link IconButtonWidth}).
   * Default: `'uniform'`.
   */
  width?: IconButtonWidth | undefined;
  /**
   * Corner: `'round'` (the default), `'square'`, or `null` for the default. It
   * repaints the control and does not resize it, so it is not part of the size
   * configuration.
   */
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
   * Access to the native Hybrid Object, for this repo's harness and benchmarks.
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
   * Instance id used by native perf marks (`nitroUiCore.drainPerf()`). Benchmark
   * only; `null` turns marks off for this view.
   *
   * @internal Benchmark and diagnostics only - not app API.
   */
  nuiPerfId?: number | null | undefined;
}

/**
 * What an IconButton does when the caller passed no `onPress`: Button's rule —
 * the callback prop is always sent, so a recycled view cannot keep the previous
 * mount's handler (Nitro treats `undefined` as "unset").
 */
function onPressNotProvided(): void {
  // Intentionally empty: the caller asked for nothing.
}

/**
 * The separator between the fields of an IconButton's `nuiSizingKey`, and the
 * escape that keeps a free-form value from forging one — Button's rule
 * (`\` -> `\\`, `|` -> `\|`).
 */
const FIELD_SEPARATOR = '|';

/** Escape one free-form value so it cannot forge a separator. */
function escapeField(value: string): string {
  return value.replace(/[\\|]/g, '\\$&');
}

/**
 * The size configuration of one IconButton, as the sizing engine sees it:
 * `variant|size|width|form|systemImage|androidIcon`.
 *
 * - `size` and `width` are the box on Android (Material's container tokens), and
 *   `size` is the box on iOS;
 * - `variant` changes the style, and on iOS the style's own padding;
 * - `form` is `press` or `toggle`, which of the two native controls this is. Not
 *   the *value* — see `checked` below — the form, and it is in the key because on
 *   iOS the two forms are two controls with two boxes: the same `tonal`/`large`
 *   configuration measured 31.67 × 30.00 pt as a `Button` and 41.67 × 30.00 pt as a
 *   `Toggle(.button)` in the first device run, and one cached size cannot be both.
 *   Android composes the same container for the two and is unaffected; it shares the
 *   field because the platforms read one key.
 * - `systemImage` is iOS's width — symbols differ, so the symbol is in the key;
 *   `androidIcon` cannot change an Android box (the glyph is sized by the rung),
 *   and it is here so both platforms read one key (Q9 C4);
 * - `checked`, `disabled` and `tintColor` repaint, they do not resize: measured on
 *   both platforms — a toggle's two states are one box, which is why no toggle has
 *   to re-key (`Chip.harness.tsx` measures the Android filter chip that *does*, and
 *   `icon-button` is not that control);
 * - `shape` repaints; the environment (text size, density, OS control size) is
 *   folded in by native through the epoch.
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

/** Resolve a caller's variant, defaulting anything unrecognised to `'standard'`. */
function resolveVariant(
  variant: IconButtonVariant | undefined
): IconButtonVariant {
  return variant != null && VARIANTS.includes(variant) ? variant : 'standard';
}

/** Resolve a caller's size, defaulting anything unrecognised to `'medium'`. */
function resolveSize(size: IconButtonSize | undefined): IconButtonSize {
  return size != null && SIZES.includes(size) ? size : 'medium';
}

/** Resolve a caller's width, defaulting anything unrecognised to `'uniform'`. */
function resolveWidth(width: IconButtonWidth | undefined): IconButtonWidth {
  return width != null && WIDTHS.includes(width) ? width : 'uniform';
}

/** Resolve a caller's corner: `null`/`undefined` and anything unrecognised are `'round'`. */
function resolveShape(shape: ButtonShape | null | undefined): ButtonShape {
  return shape != null && SHAPES.includes(shape) ? shape : 'round';
}

const warnedEmptyLabel = { done: false };

/**
 * Say once, in development, that an IconButton was given no name.
 *
 * Only for a control that actually has no name: the warning describes a mistake,
 * and a screen of named buttons is not one. Once per process rather than once per
 * render: ten unnamed buttons are one mistake, and a warning per render on a list
 * is a warning people learn to ignore. The type requires the prop; this catches
 * `accessibilityLabel=""`, which the type cannot.
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
 * The box is measured, not declared: the first IconButton of a configuration is
 * laid out at a fallback and corrected the turn it measures
 * (`docs/architecture/sizing.md`).
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

  // One string for native whichever form the caller used, resolved before the size
  // configuration below: the two spellings of one icon must not be two
  // configurations. Button's rules, including which answers are *not* name-checked
  // and why (`Button.tsx` states them).
  const resolvedAndroidIcon = resolveAndroidIcon(androidIcon);
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

  // The toggle form is on the event-count handshake (core.md §4). `useControlled`
  // answers `value: null` while uncontrolled, which is also the signal native needs
  // for "no selection" — but the *press* form must not look like an uncontrolled
  // toggle, so `isToggle` is what native is told and the value only flows in the
  // toggle form.
  // `defaultChecked` is read *raw*, with no destructuring default: a default of
  // `false` here would make this true for every IconButton, and the press form
  // would send a toggle's props and compose a toggle. The form is what the caller
  // wrote, not what this function defaults.
  const isToggle =
    checked !== undefined ||
    defaultChecked !== undefined ||
    onCheckedChange !== undefined;
  const controlled = useControlled<boolean>(
    isToggle ? checked : undefined,
    defaultChecked ?? false,
    onCheckedChange
  );

  // Always a function, so the callback prop is always sent - see
  // `onPressNotProvided`, and the cast is Button's (`useStableCallback` answers
  // `null` only when handed no handler, and a null callback prop is what D7b
  // forbids on a mounted view).
  const pressCallback = useStableCallback(
    onPress ?? onPressNotProvided
  ) as NitroCallbackProp<() => void>;
  // `useControlled` hands back the Nitro-wrapped half of the handshake, and it is
  // always a function: the press form never calls it, because native composes a
  // Button there and has nothing to report, and D7b wants a callback that is never
  // absent between two commits.
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
      // An uncontrolled toggle is seeded through `defaultChecked`; a press button
      // sends `null` for both so native composes a Button, not a Toggle, and has no
      // selection to display.
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

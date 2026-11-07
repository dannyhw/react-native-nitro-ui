import { type ColorValue, type ViewProps } from 'react-native';

import { warnAndroidIconName } from '../../iconName';
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
import { NativeNitroUiButton } from './NativeNitroUiButton';

/**
 * What {@link ButtonProps.androidIcon} accepts.
 *
 * Named here because it is app API — a caller writes the `require` or the name it
 * is given — even though the code that reads it is internal (`src/iconSource.ts`).
 */
export type { AndroidIconProp } from '../../iconSource';

/**
 * The button's visual style, named after the Material 3 roles.
 *
 * Both platforms get the closest *idiomatic* native style rather than a copy of
 * the other's: iOS has five button styles and Material has five button
 * components, and they do not line up one to one. `docs/components/button.md`
 * has the table.
 */
export type ButtonVariant =
  'filled' | 'tonal' | 'outlined' | 'text' | 'elevated';

/**
 * The button's size: one rung of the shared ladder (D42 item 4).
 *
 * On Android the rung *is* a Material 3 container-height token, and the five
 * rungs are the five Material publishes, so Material's own XS–XL button row is
 * this ladder under other names — `small`=XS, `medium`=S, `large`=M,
 * `xlarge`=L, `xxlarge`=XL. IconButton is documented in Material's names because
 * its tokens are Material's; `docs/components/button.md` carries the mapping for
 * both spellings.
 *
 * On iOS the rung picks a `.controlSize`, and iOS has fewer of those than the
 * ladder has rungs: `xlarge` and `xxlarge` both ask for the largest the platform
 * offers (`.extraLarge` on iOS 17+, `.large` before it), and iOS draws `.large` and
 * `.extraLarge` as one box for these controls — so on iOS the top three rungs are
 * one height where Android gives them three. Documented rather than invented,
 * because there is no taller iOS button to map to, and
 * `docs/components/button.md`, "Sizing", prints the five measured boxes on each
 * platform.
 */
export type ButtonSize = 'small' | 'medium' | 'large' | 'xlarge' | 'xxlarge';

/**
 * The button's corner.
 *
 * `'round'` is each platform's own default, so leaving the prop out, passing
 * `null` and passing `'round'` all draw the same control. `'square'` is Material
 * 3's `squareShape` on Android, and iOS's nearest border shape -
 * `.roundedRectangle(radius: 8)` - there, because iOS has no cornerless button.
 * Both morph on press on Android; iOS's border shape is static
 * (`docs/components/button.md`).
 */
export type ButtonShape = 'round' | 'square';

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
const SHAPES: readonly ButtonShape[] = ['round', 'square'];

/**
 * Props of {@link Button}.
 *
 * There are no children: v0.1 supports only leaf Hybrid Views
 * (`docs/architecture/core.md`), so the label is the `title` string.
 */
export interface ButtonProps extends ViewProps {
  /**
   * The button's text. Also its default accessibility label, and one of the
   * props that decide its size.
   */
  title: string;
  /** Called once per tap. Nothing fires while `disabled`. */
  onPress?: (() => void) | undefined;
  /** Visual style. Default: `'filled'`. */
  variant?: ButtonVariant | undefined;
  /** Control size. Default: `'medium'`. */
  size?: ButtonSize | undefined;
  /**
   * Corner shape: `'round'` (the default), `'square'`, or `null` for the default.
   * It repaints the control and does not resize it, so it is not part of the size
   * configuration.
   */
  shape?: ButtonShape | null | undefined;
  /** Disable interaction. Default: `false`. */
  disabled?: boolean | undefined;
  /**
   * Container colour: SwiftUI `.tint()` on iOS, the variant's container colour
   * on Android. Default: the platform accent / Material 3 scheme.
   */
  tintColor?: ColorValue | undefined;
  /**
   * Leading SF Symbol name. **iOS only** — Android has no SF Symbols, so the prop
   * is accepted there and draws nothing; give the drawable name in
   * {@link androidIcon} and each platform takes its own.
   */
  systemImage?: string | undefined;
  /**
   * Leading icon on Android: a vector drawable the app owns, passed as a Metro
   * asset (`androidIcon={require('./icons/share.xml')}`) or, for an app that
   * already ships drawables, as its Android resource name (`'share'` for
   * `res/drawable/share.xml`). **Android only** — iOS draws {@link systemImage}
   * and ignores this.
   *
   * Metro carries the file, so there is no setup step: a release build turns the
   * `.xml` into an ordinary drawable, and development loads it from the dev
   * server. The icon's *size* comes from the size ladder and never from the file,
   * which is why the box is laid out in development before the bytes arrive.
   * Artwork that cannot be resolved draws nothing and reserves no space, so the
   * Button is exactly its no-icon self.
   *
   * `docs/components/button.md`, "Android icons", has the file, where to get
   * Material Symbols, and `@expo/material-symbols` for Expo apps.
   *
   * Like {@link systemImage} this affects the control's width, so it is part of
   * the size configuration.
   */
  androidIcon?: AndroidIconProp | undefined;
  /**
   * Access to the native Hybrid Object, for this repo's harness and benchmarks.
   *
   * @internal Not app API (DECISIONS D14): props must flow through React, so a
   * direct write here runs the native setter off the UI thread and never commits.
   * Reading props and calling `measureContent()` is all it is for, and the
   * callback runs once, when the view mounts - a new function does not re-run it.
   *
   * The shape is written inline rather than named: it is the same read-only
   * handle as `NitroUiButtonHandle` in `NativeNitroUiButton.ts`, and naming it
   * here would make api-extractor demand that a v0.1-hidden native type be
   * exported from the entry point.
   */
  hybridRef?:
    | ((view: {
        readonly title: string;
        readonly variant: string;
        readonly size: string;
        readonly shape: string;
        readonly disabled: boolean;
        readonly tintColor: number | null;
        readonly systemImage: string | null;
        readonly androidIcon: string | null;
        readonly accessibilityLabel: string | null;
        measureContent(): { width: number; height: number };
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
 * What a Button does when the caller passed no `onPress`.
 *
 * A module-level constant, so it is referentially stable and the callback prop
 * is *always* sent. That is deliberate: Nitro treats `undefined` as "unset", so
 * a prop that goes away between two commits never reaches native, and a
 * recycled view would otherwise keep the previous mount's handler alive.
 */
function onPressNotProvided(): void {
  // Intentionally empty: the caller asked for nothing.
}

/**
 * The separator between the fields of a Button's `nuiSizingKey`.
 *
 * Same rule as Menu's trigger (which is this Button) and SegmentedControl's
 * option list: a free-form value may contain the separator, so the values are
 * escaped on the way in (`\` -> `\\`, `|` -> `\|`) and only an unescaped one
 * separates a field.
 */
const FIELD_SEPARATOR = '|';

/** Escape one free-form value so it cannot forge a separator. */
function escapeField(value: string): string {
  return value.replace(/[\\|]/g, '\\$&');
}

/**
 * The size configuration of one Button, as the sizing engine sees it.
 *
 * Everything that moves the control's size has to be in here, and nothing else
 * (`docs/architecture/sizing.md`, "Building `nuiSizingKey`"):
 * - `variant`, `size` and `systemImage` change the control's shape, and `title`
 *   is the control's width;
 * - `disabled` and `tintColor` repaint, they do not resize;
 * - the text size / density / OS control size are *not* here — native folds the
 *   environment in through the epoch, and repeating it would fragment the cache.
 *
 * Two Buttons with the same key share one cached size, so leaving `title` out
 * would give every Button the width of the first one measured. The free-form
 * values are escaped, not merely last: `['x|a' as image, 'b']` and
 * `['x' as image, 'a|b']` both used to join to `x|a|b`, and an escaped
 * separator inside either one cannot forge that boundary either
 * (`docs/architecture/sizing.md`, "Building `nuiSizingKey`").
 */
function sizingVariantFor(
  variant: ButtonVariant,
  size: ButtonSize,
  systemImage: string | undefined,
  androidIcon: string | undefined,
  title: string
): string {
  return [
    variant,
    size,
    escapeField(systemImage ?? ''),
    escapeField(androidIcon ?? ''),
    escapeField(title),
  ].join(FIELD_SEPARATOR);
}

/**
 * What a self-sizing control is laid out with, before any `style`.
 *
 * `alignItems: stretch` (the default in a column) otherwise decides a control's
 * width for it: Yoga gives a stretched child the row's width as an *exact*
 * constraint, so the measured size is never even asked for and a Button becomes
 * a 402 pt box with a small control in it. React Native's own `Switch` does the
 * same thing for the same reason. It is a base style, not a forced one: an
 * explicit `width`, `flex`, or `alignSelf: 'stretch'` in the caller's `style`
 * wins, because their styles are applied after this.
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

/** Resolve a caller's corner: `null`/`undefined` and anything unrecognised are `'round'`. */
function resolveShape(shape: ButtonShape | null | undefined): ButtonShape {
  return shape != null && SHAPES.includes(shape) ? shape : 'round';
}

/**
 * The platform button: SwiftUI `Button` with `.buttonStyle(...)` on iOS,
 * Material 3 `Button` / `FilledTonalButton` / `OutlinedButton` / `TextButton` /
 * `ElevatedButton` on Android.
 *
 * ```tsx
 * <Button title="Save" onPress={save} variant="tonal" size="small" />
 * ```
 *
 * It is the library's first control whose size comes from its props, so the box
 * is measured, not declared: the first Button of a configuration is laid out at
 * a fallback and corrected the same turn it measures
 * (`docs/architecture/sizing.md`).
 */
export function Button({
  title,
  onPress,
  variant = 'filled',
  size = 'medium',
  shape = 'round',
  disabled = false,
  tintColor,
  systemImage,
  androidIcon,
  testID,
  accessibilityLabel,
  hybridRef,
  nuiPerfId = null,
  style,
  ...restProps
}: ButtonProps) {
  // A name that cannot be a resource name is a typo the developer can fix right
  // now, and native's answer to it is indistinguishable from a missing file.
  // See `warnAndroidIconName` for why this is development-only and once per name,
  // and why neither of the two answers this file builds is checked here: a URL says
  // so itself when it is read, and a `res:` name was written by the bundler from
  // the asset's path, so `..` in a hoisted workspace reads as `__…` to a rule that
  // was written for names a human typed. Both are looked up as they are.
  // One string for native whichever form the caller used: an asset becomes a
  // dev-server URL or the drawable Metro files it under, and a name is
  // normalised. Resolved before the size configuration below, because the two
  // spellings of one icon must not be two configurations.
  const resolvedAndroidIcon = resolveAndroidIcon(androidIcon);
  if (
    resolvedAndroidIcon != null &&
    androidIconUrl(resolvedAndroidIcon) == null &&
    androidIconResourceName(resolvedAndroidIcon) == null
  ) {
    warnAndroidIconName('Button', 'androidIcon', resolvedAndroidIcon);
  }
  const resolvedVariant = resolveVariant(variant);
  const resolvedSize = resolveSize(size);
  const resolvedShape = resolveShape(shape);
  const processedTint = useProcessedColor(tintColor);
  // Always a function, so the callback prop is always sent - see
  // `onPressNotProvided`. `useStableCallback` keeps one wrapper per mounted view.
  // The cast states what the `??` above already guarantees: `useStableCallback`
  // answers `null` only when it was handed no handler, and a null callback prop
  // is what D7b forbids on a mounted view. `useControlled` casts for the same
  // reason.
  const pressCallback = useStableCallback(
    onPress ?? onPressNotProvided
  ) as NitroCallbackProp<() => void>;
  const hybridRefCallback = useStableCallback(hybridRef);
  const sizingId = useSizingId();

  return (
    <NativeNitroUiButton
      {...restProps}
      title={title}
      variant={resolvedVariant}
      size={resolvedSize}
      shape={resolvedShape}
      disabled={disabled}
      tintColor={processedTint}
      systemImage={systemImage ?? null}
      androidIcon={resolvedAndroidIcon}
      testID={testID ?? null}
      accessibilityLabel={accessibilityLabel ?? null}
      nuiPerfId={nuiPerfId}
      onPress={pressCallback}
      nuiSizingKey={sizingVariantFor(
        resolvedVariant,
        resolvedSize,
        systemImage,
        resolvedAndroidIcon ?? undefined,
        title
      )}
      nuiSizingId={sizingId}
      hybridRef={hybridRefCallback ?? undefined}
      style={[SELF_SIZING_BASE_STYLE, style]}
    />
  );
}

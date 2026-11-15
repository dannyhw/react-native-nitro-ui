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
import { useSelfSizingBaseStyle } from '../../core/useSelfSizing';
import { NativeNitroUiButton } from './NativeNitroUiButton';

/** What {@link ButtonProps.androidIcon} accepts. */
export type { AndroidIconProp } from '../../iconSource';

/**
 * The button's visual style, named after the Material 3 roles.
 *
 * Each platform draws its closest native style; the two sets do not line up one
 * to one.
 */
export type ButtonVariant =
  'filled' | 'tonal' | 'outlined' | 'text' | 'elevated';

/**
 * The button's size.
 *
 * On Android each value is one of Material 3's five button heights. iOS has
 * fewer control sizes: `large`, `xlarge` and `xxlarge` draw at the same height
 * there.
 */
export type ButtonSize = 'small' | 'medium' | 'large' | 'xlarge' | 'xxlarge';

/**
 * The button's corner.
 *
 * `'round'` is each platform's default. `'square'` is Material 3's square shape
 * on Android and a rounded rectangle with a small radius on iOS, which has no
 * cornerless button. The shape morphs on press on Android only.
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

/** Props of {@link Button}. The label is the `title` string; there are no children. */
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
  /** Corner shape: `'round'` (the default) or `'square'`. `null` means the default. */
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
   * An asset needs no setup step. The icon's size comes from the button's `size`,
   * never from the file. Artwork that cannot be resolved draws nothing and
   * reserves no space.
   */
  androidIcon?: AndroidIconProp | undefined;
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
   * Instance id for native performance marks; `null` turns them off for this view.
   *
   * @internal Benchmark and diagnostics only - not app API.
   */
  nuiPerfId?: number | null | undefined;
}

/**
 * Sent when the caller passes no `onPress`. The callback prop must always be
 * sent: Nitro treats `undefined` as "unset", so a recycled view would otherwise
 * keep the previous mount's handler.
 */
function onPressNotProvided(): void {
  // Intentionally empty: the caller asked for nothing.
}

/**
 * Separates the fields of a Button's `nuiSizingKey`. Free-form values are
 * escaped so they cannot contain a bare separator.
 */
const FIELD_SEPARATOR = '|';

/** Escape one free-form value so it cannot forge a separator. */
function escapeField(value: string): string {
  return value.replace(/[\\|]/g, '\\$&');
}

/**
 * The key two Buttons share when they are the same size. It holds every prop
 * that changes the size (`variant`, `size`, the icons, `title`) and none that
 * only repaint (`disabled`, `tintColor`). Text size and density are tracked
 * natively and must not be repeated here.
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

function resolveVariant(variant: ButtonVariant | undefined): ButtonVariant {
  return variant != null && VARIANTS.includes(variant) ? variant : 'filled';
}

function resolveSize(size: ButtonSize | undefined): ButtonSize {
  return size != null && SIZES.includes(size) ? size : 'medium';
}

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
 * It sizes itself to its title, icon, variant and size.
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
  const selfSizingBaseStyle = useSelfSizingBaseStyle();
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
    warnAndroidIconName('Button', 'androidIcon', resolvedAndroidIcon);
  }
  const resolvedVariant = resolveVariant(variant);
  const resolvedSize = resolveSize(size);
  const resolvedShape = resolveShape(shape);
  const processedTint = useProcessedColor(tintColor);
  // Always a function, so the callback prop is always sent. The cast is safe:
  // `useStableCallback` returns `null` only when it is handed no handler.
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
      style={[selfSizingBaseStyle, style]}
    />
  );
}

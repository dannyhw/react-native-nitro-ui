import { type ColorValue, type ViewProps } from 'react-native';

import type { NitroCallbackProp } from '../../core/useStableCallback';
import { useProcessedColor } from '../../core/useProcessedColor';
import { useSizingId } from '../../core/useSizingId';
import { useStableCallback } from '../../core/useStableCallback';
import { NativeNitroUiButton } from './NativeNitroUiButton';

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
 * The button's size: SwiftUI `.controlSize` on iOS, content padding plus label
 * typography on Android.
 */
export type ButtonSize = 'small' | 'medium' | 'large';

const VARIANTS: readonly ButtonVariant[] = [
  'filled',
  'tonal',
  'outlined',
  'text',
  'elevated',
];
const SIZES: readonly ButtonSize[] = ['small', 'medium', 'large'];

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
  /** Disable interaction. Default: `false`. */
  disabled?: boolean | undefined;
  /**
   * Container colour: SwiftUI `.tint()` on iOS, the variant's container colour
   * on Android. Default: the platform accent / Material 3 scheme.
   */
  tintColor?: ColorValue | undefined;
  /**
   * Leading SF Symbol name. iOS only in v0.1 — Android ignores it (documented
   * on `docs/components/button.md`), so it never affects the label's text.
   */
  systemImage?: string | undefined;
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
        readonly disabled: boolean;
        readonly tintColor: number | null;
        readonly systemImage: string | null;
        readonly accessibilityLabel: string | null;
        measureContent(): { width: number; height: number };
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
 * values come last so a `|` inside one of them cannot shift a fixed field.
 */
function sizingVariantFor(
  variant: ButtonVariant,
  size: ButtonSize,
  systemImage: string | undefined,
  title: string
): string {
  return `${variant}|${size}|${systemImage ?? ''}|${title}`;
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
  disabled = false,
  tintColor,
  systemImage,
  testID,
  accessibilityLabel,
  hybridRef,
  nuiPerfId = null,
  style,
  ...restProps
}: ButtonProps) {
  const resolvedVariant = resolveVariant(variant);
  const resolvedSize = resolveSize(size);
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
      disabled={disabled}
      tintColor={processedTint}
      systemImage={systemImage ?? null}
      testID={testID ?? null}
      accessibilityLabel={accessibilityLabel ?? null}
      nuiPerfId={nuiPerfId}
      onPress={pressCallback}
      nuiSizingKey={sizingVariantFor(
        resolvedVariant,
        resolvedSize,
        systemImage,
        title
      )}
      nuiSizingId={sizingId}
      hybridRef={hybridRefCallback ?? undefined}
      style={[SELF_SIZING_BASE_STYLE, style]}
    />
  );
}

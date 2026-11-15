import { type ColorValue, type ViewProps } from 'react-native';

import { useProcessedColor } from '../../core/useProcessedColor';
import { useSizingId } from '../../core/useSizingId';
import { useStableCallback } from '../../core/useStableCallback';
import { useSelfSizingBaseStyle } from '../../core/useSelfSizing';
import { NativeNitroUiProgress } from './NativeNitroUiProgress';

/**
 * The three things this component can draw: a bar, a ring, and Material 3
 * Expressive's morphing loading indicator (a circular `ProgressView` on iOS).
 */
export type ProgressVariant = 'linear' | 'circular' | 'loading';

/**
 * How an indicator is drawn: Material 3's flat bar/ring, or its wavy form.
 *
 * `'wavy'` is Android only. SwiftUI has no wavy indicator, so iOS accepts it and
 * paints flat.
 */
export type ProgressAppearance = 'flat' | 'wavy';

/**
 * Props of {@link Progress}.
 *
 * `value` is a fraction of the whole (`0...1`), which is what an indicator
 * shows; `null`/`undefined` means "indeterminate" rather than "empty".
 */
export interface ProgressProps extends ViewProps {
  /**
   * Which indicator to draw: a `'linear'` bar (the default), a `'circular'`
   * ring, or `'loading'` - Material 3 Expressive's morphing loading indicator,
   * which iOS draws as a circular `ProgressView`.
   *
   * Changing it remounts the native control. A Progress has no native state to
   * lose, so that is safe.
   */
  variant?: ProgressVariant | undefined;
  /**
   * `'flat'` (the default) or `'wavy'`: Material 3's wavy bar and ring on
   * Android, with Material's own amplitude, wavelength and speed.
   *
   * **iOS paints flat**: SwiftUI has no wavy indicator. `variant="loading"` has
   * no wavy form on either platform and ignores this. A wavy bar is thicker, and
   * a wavy ring larger, than the flat ones.
   */
  appearance?: ProgressAppearance | undefined;
  /**
   * Draw `variant="loading"` inside Material's tonal container
   * (`ContainedLoadingIndicator`) rather than on its own. Default `false`.
   *
   * Only `variant="loading"` reads it: a bar and a ring have no container, and
   * iOS has neither loading indicator, so elsewhere it is ignored.
   */
  contained?: boolean | undefined;
  /**
   * The fraction shown, `0...1`, or `null`/`undefined` for an **indeterminate**
   * indicator (the "working…" animation). Out-of-range values are clamped, and
   * `NaN` counts as 0.
   *
   * **iOS limits.** A `circular` indicator keeps spinning whatever fraction it is
   * given: the number reaches VoiceOver, and only a `linear` bar fills. With no
   * `value`, a `linear` bar shows an empty track and does not move. Android
   * draws the fraction and animates the indeterminate state in both shapes.
   */
  value?: number | null | undefined;
  /**
   * Colour of the indicator itself: SwiftUI `.tint()` on iOS, the M3 indicator
   * colour on Android. Default: the platform accent / Material 3 scheme.
   */
  tintColor?: ColorValue | undefined;
  /**
   * Colour of the track behind the indicator. Default: the platform's own track.
   *
   * **Android only**: SwiftUI's `ProgressView` has nothing that addresses its
   * track, so on iOS this is accepted and ignored.
   */
  trackColor?: ColorValue | undefined;
  /**
   * Read-only access to the native view, for this library's own tests and
   * benchmarks.
   *
   * @internal Not app API. A write through this handle bypasses React and never
   * commits. The callback runs once, when the view mounts.
   */
  hybridRef?:
    | ((view: {
        readonly variant: string;
        readonly appearance: string;
        readonly contained: boolean;
        readonly value: number | null;
        readonly tintColor: number | null;
        readonly trackColor: number | null;
        readonly accessibilityLabel: string | null;
        measureContent(): { width: number; height: number };
        nuiTestDisplayedValue(): string;
        nuiTestIsAnimating(): boolean;
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
 * The sizing key of a configuration. `variant`, `appearance` and `contained` are
 * the props that decide which control is built, and so its size. Each default
 * (`'linear'`, `'flat'`, `false`) adds no segment, so the default configuration
 * has the empty key. Leaving one out would give every later mount of the other
 * configuration the first one's cached size. The caller passes values already
 * normalised for the shape.
 */
function progressSizingKey(
  shape: ProgressVariant,
  look: ProgressAppearance,
  hasContainer: boolean
): string {
  return [
    shape === 'linear' ? '' : shape,
    look === 'wavy' ? 'wavy' : '',
    hasContainer ? 'contained' : '',
  ]
    .filter((segment) => segment !== '')
    .join('|');
}

/**
 * Anything outside the union reads as `'linear'`, as native reads it, so the
 * view key, the sizing key and the prop cannot disagree.
 */
function resolveVariant(variant: ProgressVariant): ProgressVariant {
  return variant === 'circular' || variant === 'loading' ? variant : 'linear';
}

/**
 * A linear bar is as wide as its box and measures only its height.
 * `alignSelf: 'stretch'` gives it that width: the measured width is replaced by
 * the box's only when the box has a finite width.
 */
const FILL_WIDTH_BASE_STYLE = { alignSelf: 'stretch' } as const;

/**
 * The platform progress indicator: SwiftUI `ProgressView` (`.linear` /
 * `.circular`) on iOS, Material 3 `LinearProgressIndicator` /
 * `CircularProgressIndicator` on Android.
 *
 * ```tsx
 * <Progress value={uploaded / total} />
 * <Progress variant="circular" />          // indeterminate
 * ```
 *
 * It is not interactive, so it has no callbacks: `value` always comes from
 * React. Whether a change of `value` animates is each platform's own choice.
 */
export function Progress({
  variant = 'linear',
  appearance = 'flat',
  contained = false,
  value = null,
  tintColor,
  trackColor,
  testID,
  accessibilityLabel,
  hybridRef,
  nuiPerfId = null,
  style,
  ...restProps
}: ProgressProps) {
  const selfSizingBaseStyle = useSelfSizingBaseStyle();
  const processedTint = useProcessedColor(tintColor);
  const processedTrack = useProcessedColor(trackColor);
  const hybridRefCallback = useStableCallback(hybridRef);
  // The three configuration props, resolved once: the view key, the sizing key
  // and the props sent to native all come from these, so the view cannot draw
  // one configuration while cached as another. This also normalises a value
  // from outside the union.
  const shape = resolveVariant(variant);
  const look: ProgressAppearance =
    appearance === 'wavy' && shape !== 'loading' ? 'wavy' : 'flat';
  const hasContainer = shape === 'loading' && contained;
  const sizingKey = progressSizingKey(shape, look, hasContainer);
  // The id belongs to the mount, so it follows `key={shape}` and not the sizing
  // key: `appearance` and `contained` change under a view that stays mounted,
  // and an id swapped in place would leave its native sizing entry behind.
  const sizingId = useSizingId(shape);

  return (
    <NativeNitroUiProgress
      {...restProps}
      // A shape change is a different control, so the view is keyed on it and
      // remounts. Android fixes its sizing policy (self-sized or fill-width)
      // when the composition is built and cannot switch in place.
      // `appearance` and `contained` change only the measured size, which
      // `nuiSizingKey` re-measures without a remount.
      key={shape}
      variant={shape}
      appearance={look}
      contained={hasContainer}
      value={value}
      tintColor={processedTint}
      trackColor={processedTrack}
      testID={testID ?? null}
      accessibilityLabel={accessibilityLabel ?? null}
      nuiPerfId={nuiPerfId}
      nuiSizingKey={sizingKey}
      nuiSizingId={sizingId}
      hybridRef={hybridRefCallback ?? undefined}
      style={[
        // A bar takes the box's width; the other shapes size themselves.
        shape === 'linear' ? FILL_WIDTH_BASE_STYLE : selfSizingBaseStyle,
        style,
      ]}
    />
  );
}

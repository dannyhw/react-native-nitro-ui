import { type ColorValue, type ViewProps } from 'react-native';

import { useProcessedColor } from '../../core/useProcessedColor';
import { useSizingId } from '../../core/useSizingId';
import { useStableCallback } from '../../core/useStableCallback';
import { NativeNitroUiProgress } from './NativeNitroUiProgress';

/** The two things this component can draw. */
export type ProgressVariant = 'linear' | 'circular';

/**
 * Props of {@link Progress}.
 *
 * `value` is a fraction of the whole (`0...1`), which is what an indicator
 * shows; `null`/`undefined` means "indeterminate" rather than "empty".
 */
export interface ProgressProps extends ViewProps {
  /**
   * Which indicator to draw: a `'linear'` bar (the default) or a `'circular'`
   * one.
   *
   * It is also this control's **size configuration** - the two shapes are
   * different sizes and use different sizing policies - so switching it at
   * runtime costs the same one-frame correction as a cold mount of the new
   * shape (see `docs/components/progress.md`).
   *
   * A change **remounts** the native control: the two shapes are two controls,
   * and Android in particular asks its toolkit a different sizing question per
   * shape, one it fixes when the composition is built
   * (`HybridNitroUiProgress.kt`). Nothing is lost by that - a Progress has no
   * native state to carry over - so treat it as free, not as a thing to avoid.
   */
  variant?: ProgressVariant | undefined;
  /**
   * The fraction shown, `0...1`, or `null`/`undefined` for an **indeterminate**
   * indicator (the "working…" animation).
   *
   * Out-of-range values are clamped natively rather than rejected, and `NaN`
   * counts as out of range (to 0) - progress that arrives from a download
   * callback overshoots, and an indicator that vanished because of it is worse
   * than one that looked full for a frame.
   *
   * **A `circular` indicator does not draw it on iOS.** SwiftUI's `.circular`
   * `ProgressView` keeps spinning whatever fraction it is handed, so
   * `variant="circular" value={0.4}` looks like the indeterminate ring there - the
   * number reaches VoiceOver (`accessibilityValue`) and the handle, and only a
   * `linear` bar fills on both platforms. Android draws the fraction either way.
   * `docs/components/progress.md` (Limits) says what was tried about it.
   *
   * The other iOS half of that limit is the missing *animation*: with no `value`,
   * a `linear` bar on iOS shows an **empty track and does not move** - UIKit's
   * `UIProgressView` has no indeterminate mode, so there is nothing for the style
   * to draw. Android animates an indeterminate bar in both shapes. Where the
   * motion carries meaning, use a ring (or a `linear` bar on Android).
   *
   * A plain `value`, not a controlled one: nothing on a Progress can be changed
   * by the user, so React always owns it and no `onValueChange` is needed
   * (`docs/architecture/core.md` §12). Writing it at 60 Hz costs one `number`
   * prop per commit.
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
   * **Android only today** - Material 3 gives every progress indicator a
   * `trackColor` and SwiftUI's `ProgressView` has nothing that addresses its
   * track, so on iOS this is accepted and ignored
   * (`docs/components/progress.md`).
   */
  trackColor?: ColorValue | undefined;
  /**
   * Access to the native Hybrid Object, for this repo's harness and benchmarks.
   *
   * @internal Not app API (DECISIONS D14): props must flow through React, so a
   * direct write here runs the native setter off the UI thread and never
   * commits. Reading props and calling `measureContent()` is all it is for (plus
   * the two test-only probes), and the callback runs once, when the view mounts
   * - a new function does not re-run it.
   *
   * The shape is written inline rather than named: it is the same read-only
   * handle as `NitroUiProgressHandle` in `NativeNitroUiProgress.ts`, and naming
   * a Hybrid View type would put it on the public surface (D14).
   */
  hybridRef?:
    | ((view: {
        readonly variant: string;
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
   * Instance id used by native perf marks (`nitroUiCore.drainPerf()`). Benchmark
   * only; `null` turns marks off for this view.
   *
   * @internal Benchmark and diagnostics only - not app API.
   */
  nuiPerfId?: number | null | undefined;
}

/**
 * The sizing **variant** of each shape.
 *
 * `variant` is the only prop that changes the control's size, so it is the whole
 * key. A linear Progress is the component's default configuration, so its key is
 * the empty string - which is what makes `prewarm(['NitroUiProgress'])` seed it
 * (`docs/architecture/sizing.md` §8), and what a Switch and a Slider do for their
 * single configuration. `'circular'` is the one other configuration there is.
 */
const LINEAR_SIZING_VARIANT = '';
const CIRCULAR_SIZING_VARIANT = 'circular';

/**
 * What a `fillWidth` control is laid out with, before any `style`.
 *
 * A linear bar's width *is* the box and the only size it measures for itself is
 * its height, so `alignSelf: 'stretch'` is what hands it that width - the
 * engine's `fillWidth` policy overrides the measured width with the box's, but
 * only when the box has a finite width, and `alignSelf` is the one thing that
 * decides a Yoga cross-axis size (`docs/architecture/sizing.md` §6).
 */
const FILL_WIDTH_BASE_STYLE = { alignSelf: 'stretch' } as const;

/**
 * What an `intrinsic` control is laid out with: the opposite guard, because a
 * circular indicator must *not* be stretched into its parent's width - it wants
 * its own square. Same reason `Switch` carries it.
 */
const SELF_SIZING_BASE_STYLE = { alignSelf: 'flex-start' } as const;

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
 * It is not interactive, so it has no callbacks and no event handshake: `value`
 * always comes from React, and one commit per render is all an update costs.
 * Interpolating between two values is the toolkits' choice, not ours - see
 * `docs/components/progress.md` for what each one animates.
 */
export function Progress({
  variant = 'linear',
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
  const processedTint = useProcessedColor(tintColor);
  const processedTrack = useProcessedColor(trackColor);
  const hybridRefCallback = useStableCallback(hybridRef);
  // `key`, the `variant` prop and the sizing configuration are the same value,
  // computed once: the native view is replaced exactly when the configuration
  // changes, and never otherwise (`useSizingId`'s `configuration` contract). The
  // spec types `variant` as a plain string, so the normalisation is what keeps a
  // JS caller that bypasses the union (`variant={'round' as ProgressVariant}`)
  // from minting an id - and leaking an engine entry - without a remount; see
  // `Progress · sizing id follows the key` in `src/__tests__/useSizingId.test.tsx`.
  // A variant change drops the old view, and the drop must not take the new
  // mount's ledger entry with it (the harness's
  // `re-measures a variant change that starts from a poisoned guess` is the oracle).
  const isCircular = variant === 'circular';
  const variantKey = isCircular ? 'circular' : 'linear';
  const sizingId = useSizingId(variantKey);

  return (
    <NativeNitroUiProgress
      {...restProps}
      // A variant change is a different control, not a repaint: the wrapper keys
      // the native view on it so the old one goes away and the new one is mounted
      // fresh. Android needs this - `NitroUiMeasuredRoot` decides between the
      // `intrinsic` and `fillWidth` question when the composition is built and
      // never re-asks it, so a composition that started circular would go on asking
      // an unbounded question of a linear bar (which has no width of its own to
      // answer with) for the rest of its life. iOS reads the policy live, so the
      // same key costs it nothing it did not already do.
      key={variantKey}
      variant={variantKey}
      value={value}
      tintColor={processedTint}
      trackColor={processedTrack}
      testID={testID ?? null}
      accessibilityLabel={accessibilityLabel ?? null}
      nuiPerfId={nuiPerfId}
      nuiSizingKey={
        isCircular ? CIRCULAR_SIZING_VARIANT : LINEAR_SIZING_VARIANT
      }
      nuiSizingId={sizingId}
      hybridRef={hybridRefCallback ?? undefined}
      style={[
        isCircular ? SELF_SIZING_BASE_STYLE : FILL_WIDTH_BASE_STYLE,
        style,
      ]}
    />
  );
}

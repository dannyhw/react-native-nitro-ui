import { type ColorValue, type ViewProps } from 'react-native';

import { useProcessedColor } from '../../core/useProcessedColor';
import { useSizingId } from '../../core/useSizingId';
import { useStableCallback } from '../../core/useStableCallback';
import { NativeNitroUiProgress } from './NativeNitroUiProgress';

/** The two things this component can draw. */
/**
 * The three things this component can draw: a bar, a ring, and Material 3
 * Expressive's morphing loading indicator (a circular `ProgressView` on iOS).
 */
export type ProgressVariant = 'linear' | 'circular' | 'loading';

/**
 * How an indicator is drawn: Material 3's flat bar/ring, or its wavy form.
 *
 * `'wavy'` is an Android drawing. SwiftUI has no wavy indicator, so iOS accepts
 * it and paints flat (`docs/components/progress.md`).
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
   * Which indicator to draw: a `'linear'` bar (the default) or a `'circular'`
   * one, or `'loading'` - Material 3 Expressive's morphing loading indicator,
   * which iOS answers with a circular `ProgressView`.
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
   * `'flat'` (the default) or `'wavy'`: Material 3's wavy bar and ring on
   * Android, with Material's own amplitude, wavelength and speed.
   *
   * **iOS paints flat.** SwiftUI has no wavy indicator and this library does not
   * fake one, so the prop is stored and round-trips through the handle there
   * (`docs/components/progress.md`). It says nothing about `variant="loading"`,
   * which has no wavy form on either platform, and is ignored there.
   *
   * A wavy bar is thicker, and a wavy ring larger, than the flat ones, so this is
   * part of the control's size configuration: changing it re-measures, the way
   * changing `variant` does, and does not remount.
   */
  appearance?: ProgressAppearance | undefined;
  /**
   * Draw `variant="loading"` inside Material's tonal container
   * (`ContainedLoadingIndicator`) rather than on its own. Default `false`.
   *
   * Only `variant="loading"` reads it: a bar and a ring have no container, and iOS
   * has neither loading indicator, so elsewhere it is stored and otherwise
   * ignored. Like the other two configuration props it is part of the sizing key,
   * even though both loading boxes measure the same square.
   */
  contained?: boolean | undefined;
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
   * Instance id used by native perf marks (`nitroUiCore.drainPerf()`). Benchmark
   * only; `null` turns marks off for this view.
   *
   * @internal Benchmark and diagnostics only - not app API.
   */
  nuiPerfId?: number | null | undefined;
}

/**
 * The sizing **key** of each configuration: the shape, the look and the container,
 * with the defaults left out.
 *
 * `variant`, `appearance` and `contained` are the three props that decide which
 * control is built and therefore which box it measures, so the key is those three
 * and nothing else (`value` never moves a box, and a colour never does). The
 * default of each - `'linear'`, `'flat'`, `false` - contributes no segment, so the
 * default configuration keeps the empty key: `''` is what a `linear` Progress is,
 * what it always was, and what makes `prewarm(['NitroUiProgress'])` seed it
 * (`docs/architecture/sizing.md` §8).
 *
 * Dropping any one of the three from this function is the R3 bug class: every
 * later mount of the other configuration inherits the first one's size for the
 * life of the process, which reads as a correct measurement rather than a bug.
 * `src/__tests__/progressSizingKey.test.tsx` is the guard, and the segments cannot
 * collide because the only names that reach them are the three shapes, `'wavy'`
 * and `'contained'` - none of which is another segment's default.
 *
 * Two of the three are only read by some shapes, and the key says so: `appearance`
 * means nothing for `'loading'` (no wavy form exists) and `contained` means
 * nothing for a bar or a ring (no container exists). Normalising them here is what
 * keeps a prop that cannot change the drawing from minting a cache entry for a
 * configuration that does not exist.
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
 * The shape a `variant` prop asks for, with anything outside the union reading as
 * the default - the same rule native applies, written once so the key, the `key`
 * and the prop cannot disagree about what `'round' as ProgressVariant` means.
 */
function resolveVariant(variant: ProgressVariant): ProgressVariant {
  return variant === 'circular' || variant === 'loading' ? variant : 'linear';
}

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
  const processedTint = useProcessedColor(tintColor);
  const processedTrack = useProcessedColor(trackColor);
  const hybridRefCallback = useStableCallback(hybridRef);
  // The three configuration props, resolved once. Everything below - the `key`, the
  // sizing key, and the three props sent to native - comes off these, so the view
  // can never be told to draw one configuration while being cached as another.
  // The spec types them as plain strings/bool, so the normalisation is also what
  // keeps a JS caller that bypasses the union
  // (`variant={'round' as ProgressVariant}`) from minting an id - and leaking an
  // engine entry - without a remount; see
  // `Progress · sizing id follows the view key` in
  // `src/__tests__/useSizingId.test.tsx`.
  const shape = resolveVariant(variant);
  const look: ProgressAppearance =
    appearance === 'wavy' && shape !== 'loading' ? 'wavy' : 'flat';
  const hasContainer = shape === 'loading' && contained;
  const sizingKey = progressSizingKey(shape, look, hasContainer);
  // The id belongs to the *mount*, so it follows `key={shape}` below rather than
  // the sizing key. `appearance` and `contained` move the sizing configuration
  // under a view that stays mounted, and an id swapped in place has no
  // `onDropView` coming to end the engine entry behind it (`core/useSizingId.ts`
  // is the rule). Those two travel on `nuiSizingKey`, the channel that
  // re-measures the live view.
  const sizingId = useSizingId(shape);

  return (
    <NativeNitroUiProgress
      {...restProps}
      // A shape change is a different control, not a repaint: the wrapper keys the
      // native view on the *shape* so the old one goes away and the new one is
      // mounted fresh. Android needs this - `NitroUiMeasuredRoot` decides between
      // the `intrinsic` and `fillWidth` question when the composition is built and
      // never re-asks it, so a composition that started circular would go on asking
      // an unbounded question of a linear bar (which has no width of its own to
      // answer with) for the rest of its life. iOS reads the policy live, so the
      // same key costs it nothing it did not already do.
      //
      // `appearance` and `contained` deliberately do **not** key the view: neither
      // moves the sizing question (a wavy bar is still `fillWidth`, a contained
      // loading indicator still `intrinsic`), both move the *answer*, and
      // `nuiSizingKey` below is the channel built for that - native answers it with
      // `noteSizingKeyChanged()`, which asks for the measure and lets the engine
      // file the new configuration's size under its new key. Remounting for them
      // would cost a dropped control, a new handle and a lost first frame to buy
      // what one measure pass already does.
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
        // A bar takes the box's width; every self-sized shape guards against a
        // stretching parent (`FILL_WIDTH_BASE_STYLE` / `SELF_SIZING_BASE_STYLE`).
        shape === 'linear' ? FILL_WIDTH_BASE_STYLE : SELF_SIZING_BASE_STYLE,
        style,
      ]}
    />
  );
}

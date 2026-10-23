import { type ColorValue, type ViewProps } from 'react-native';

import { useSizingId } from '../../core/useSizingId';
import { useControlled } from '../../core/useControlled';
import { useProcessedColor } from '../../core/useProcessedColor';
import { useStableCallback } from '../../core/useStableCallback';
import type { NitroCallbackProp } from '../../core/useStableCallback';
import { NativeNitroUiSlider } from './NativeNitroUiSlider';

/** The shape native gesture callbacks have, minus Nitro's `{ f: ... }` box. */
type SlideHandler = (value: number, eventCount: number) => void;

/**
 * Props of {@link Slider}.
 *
 * `value`/`defaultValue`/`minimumValue`/`maximumValue`/`step`/`disabled`/
 * `onValueChange`/`onSlidingStart`/`onSlidingComplete` follow
 * `@react-native-community/slider`, the de-facto naming for this control;
 * `tintColor` follows our own `Switch`, and everything else from `ViewProps`.
 */
export interface SliderProps extends ViewProps {
  /**
   * The value. Pass it to control the Slider; leave it `undefined` for an
   * uncontrolled one (native then owns the displayed value, and dragging costs
   * no React render).
   */
  value?: number | undefined;
  /**
   * Initial value of an uncontrolled Slider. Default: `minimumValue`.
   * Ignored while `value` is set.
   */
  defaultValue?: number | undefined;
  /** Lower bound of the range. Default: `0`. */
  minimumValue?: number | undefined;
  /** Upper bound of the range. Default: `1`. */
  maximumValue?: number | undefined;
  /**
   * Increment the value snaps to, in the Slider's own units. `0` (the default)
   * means continuous. Use e.g. `1` for whole numbers, or `0.1` for tenths.
   *
   * Quantising happens natively, before any event is emitted, so what JS is told
   * is always exactly what the thumb is showing — including when the range is not
   * a whole number of steps, where the maximum stays reachable.
   */
  step?: number | undefined;
  /** Disable interaction. Default: `false`. */
  disabled?: boolean | undefined;
  /**
   * Accent colour of the filled track and thumb: SwiftUI `.tint()` on iOS, the
   * M3 active track + thumb on Android. Default: the platform accent / Material
   * 3 colour scheme.
   */
  tintColor?: ColorValue | undefined;
  /**
   * During a drag, at most once per frame, with the value native now displays.
   *
   * Coalescing is native and deliberate: a touch stream samples faster than the
   * display draws, and every emission here is a JS entry plus the user's handler
   * plus a React render plus a props commit back (`docs/architecture/core.md`
   * §11). Use {@link onSlidingComplete} for the value a gesture settled on.
   */
  onValueChange?: ((value: number) => void) | undefined;
  /** When a drag begins, with the value it began at. */
  onSlidingStart?: ((value: number) => void) | undefined;
  /**
   * When a drag ends, always with the final value — even when the last frame
   * already emitted that value through {@link onValueChange}.
   */
  onSlidingComplete?: ((value: number) => void) | undefined;
  /**
   * Access to the native Hybrid Object, for this repo's harness and benchmarks.
   *
   * @internal Not app API (DECISIONS D14): props must flow through React, so a
   * direct write here runs the native setter off the UI thread and never commits.
   * Reading props and calling `measureContent()` is all it is for (plus the
   * test-only `nuiTestDrag`), and the callback runs once, when the view mounts —
   * a new function does not re-run it.
   *
   * The shape is written inline rather than named: it is the same read-only
   * handle as `NitroUiSliderHandle` in `NativeNitroUiSlider.ts`, and naming it
   * here would make api-extractor demand that a v0.1-hidden native type be
   * exported from the entry point.
   */
  hybridRef?:
    | ((view: {
        readonly value: number | null;
        readonly mostRecentEventCount: number;
        readonly disabled: boolean;
        readonly tintColor: number | null;
        readonly accessibilityLabel: string | null;
        measureContent(): { width: number; height: number };
        nuiTestDrag(to: number, steps: number, msPerStep: number): void;
      }) => void)
    | undefined;
  /**
   * Instance id used by native perf marks (`nitroUiCore.drainPerf()`). Benchmark
   * only; `null` turns marks off for this view.
   *
   * @internal Benchmark and diagnostics only — not app API.
   */
  nuiPerfId?: number | null | undefined;
}

/**
 * The size configuration of a Slider, as the sizing engine sees it.
 *
 * Every prop that can change a Slider's size has to appear in this variant
 * (`docs/architecture/sizing.md` §5). A Slider has none: `minimumValue`,
 * `maximumValue`, `step`, `value`, `disabled` and `tintColor` move the thumb or
 * repaint — none of them changes the *height*, and the width is the Yoga box
 * (`fillWidth`). The only thing that can change the height is the environment
 * (the OS control size, the text size), and native folds that in itself through
 * the environment epoch. So the variant is empty — one configuration, one cached
 * height for the whole app, and the one `prewarm(['NitroUiSlider'])` can
 * pre-warm, because an empty variant *is* the default configuration.
 */
const SIZING_VARIANT = '';

/**
 * What a `fillWidth` control is laid out with, before any `style`.
 *
 * A Slider is the opposite shape from a Switch: its width *is* the box, and the
 * only size it measures for itself is its height. `alignSelf: 'stretch'` is what
 * hands it that width — the sizing engine's `fillWidth` policy overrides the
 * measured width with the box's, but only when the box has a finite width, so a
 * control that is never stretched would fall back to a measured width instead.
 * `alignSelf` is the one thing that decides a Yoga cross-axis size
 * (`docs/architecture/sizing.md` §6), so it has to be the base style here.
 *
 * That is the opposite of `Switch`'s `{ alignSelf: 'flex-start' }`, and for the
 * same reason in reverse: a Switch must not be stretched, a Slider must be. An
 * explicit `width`, `flex` or `alignSelf` in the caller's `style` still wins,
 * because their styles are applied after this.
 */
const FILL_WIDTH_BASE_STYLE = { alignSelf: 'stretch' } as const;

/**
 * The handler a Slider installs when the app passed no `onSlidingStart` or
 * `onSlidingComplete`.
 *
 * Both callbacks are always sent, like every other prop here. Two reasons:
 *
 * - **D7b**: a callback prop may never become `null` while the view is mounted,
 *   and a prop that goes missing between commits is exactly how that happens
 *   (nitro#1184). `useControlled` does the same for `onValueChange`.
 * - **identity**: the wrapper `useStableCallback` returns changes when a handler
 *   is added or removed, so an absent handler and a present one are two
 *   different props. With one always-installed wrapper the prop never churns.
 *
 * Native emits `(value, eventCount)`; a handler taking fewer arguments is a
 * valid handler for more, so the arity difference needs no adapter - and the
 * count belongs to the handshake, not to the app. Only `onValueChange` is
 * echoed back (through `useControlled`), because only it changes what native
 * displays.
 */
const NO_SLIDE_HANDLER: (value: number) => void = () => {
  /* installed so the prop always has one stable identity */
};

/**
 * The platform Slider: SwiftUI `Slider` on iOS, Material 3 `Slider` on Android.
 *
 * ```tsx
 * const [volume, setVolume] = useState(0.5)
 * <Slider value={volume} onValueChange={setVolume} />
 * ```
 *
 * Native owns the displayed value during a drag, so the thumb tracks the finger
 * even when JS is slow; a `value` written by React while a drag is in flight is
 * reconciled per the event-count handshake (`docs/architecture/core.md` §11).
 */
export function Slider({
  value,
  defaultValue,
  minimumValue = 0,
  maximumValue = 1,
  step = 0,
  disabled = false,
  tintColor,
  testID,
  accessibilityLabel,
  onValueChange,
  onSlidingStart,
  onSlidingComplete,
  hybridRef,
  nuiPerfId = null,
  style,
  ...restProps
}: SliderProps) {
  // An uncontrolled Slider with no `defaultValue` starts at the bottom of its
  // own range, not at a literal 0 — `<Slider minimumValue={20} />` starting at 0
  // would show a thumb outside its track.
  const controlled = useControlled(
    value,
    defaultValue ?? minimumValue,
    onValueChange
  );
  const processedTint = useProcessedColor(tintColor);
  const hybridRefCallback = useStableCallback(hybridRef);
  // The cast states what `?? NO_SLIDE_HANDLER` above already guarantees:
  // `useStableCallback` answers `null` only when it was handed no handler, and
  // here it always is handed one - but its signature is one union for both
  // cases, so the always-wired half has to be said at each call site.
  const startCallback = useStableCallback(
    onSlidingStart ?? NO_SLIDE_HANDLER
  ) as NitroCallbackProp<SlideHandler>;
  const completeCallback = useStableCallback(
    onSlidingComplete ?? NO_SLIDE_HANDLER
  ) as NitroCallbackProp<SlideHandler>;
  const sizingId = useSizingId();

  return (
    <NativeNitroUiSlider
      {...restProps}
      value={controlled.value}
      defaultValue={controlled.defaultValue}
      mostRecentEventCount={controlled.mostRecentEventCount}
      minimumValue={minimumValue}
      maximumValue={maximumValue}
      step={step}
      disabled={disabled}
      tintColor={processedTint}
      testID={testID ?? null}
      accessibilityLabel={accessibilityLabel ?? null}
      nuiPerfId={nuiPerfId}
      onValueChange={controlled.onNativeChange}
      onSlidingStart={startCallback}
      onSlidingComplete={completeCallback}
      nuiSizingKey={SIZING_VARIANT}
      nuiSizingId={sizingId}
      hybridRef={hybridRefCallback ?? undefined}
      style={[FILL_WIDTH_BASE_STYLE, style]}
    />
  );
}

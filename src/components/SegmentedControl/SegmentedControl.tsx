import { type ColorValue, type ViewProps } from 'react-native';

import { useControlled } from '../../core/useControlled';
import { useProcessedColor } from '../../core/useProcessedColor';
import { useSizingId } from '../../core/useSizingId';
import { useStableCallback } from '../../core/useStableCallback';
import { NativeNitroUiSegmentedControl } from './NativeNitroUiSegmentedControl';

/**
 * What {@link SegmentedControlProps.onChange} reports: the index that was
 * selected, plus the option's text.
 *
 * Both are included because callers want both — `index` to address the model,
 * `value` to show or store the label — and the wrapper can supply `value` for
 * free from the `options` it is already rendering.
 */
export interface SegmentedControlChange {
  /** Position of the chosen option in `options`. */
  index: number;
  /** That option's label, read from the `options` rendered at event time. */
  value: string;
}

/**
 * Props of {@link SegmentedControl}.
 *
 * `selectedIndex`/`defaultSelectedIndex`/`onChange`/`disabled`/`tintColor`
 * follow the library's other controls (`Switch`, `Slider`); everything else
 * comes from `ViewProps`.
 */
export interface SegmentedControlProps extends ViewProps {
  /**
   * The segment labels, in order. The control is as wide as these labels, so
   * this is the prop that decides its size.
   *
   * Two options may share a label; the value of the control is always the
   * *index*, never the text.
   */
  options: string[];
  /**
   * Selected index. Pass it to control the control; leave it `undefined` for an
   * uncontrolled one (native then owns the displayed selection, and a tap costs
   * no React render).
   *
   * A value outside the current `options` is clamped into range (see
   * `docs/components/segmented-control.md`), on both platforms and in JS.
   */
  selectedIndex?: number | undefined;
  /**
   * Initial selected index of an uncontrolled control. Default: `0`. Ignored
   * while `selectedIndex` is set, and clamped to `options` when applied.
   */
  defaultSelectedIndex?: number | undefined;
  /**
   * Called after every user selection, with the new index and its label.
   *
   * Not called for a selection React itself made, and not called while
   * `disabled`.
   */
  onChange?: ((event: SegmentedControlChange) => void) | undefined;
  /** Disable interaction. Default: `false`. */
  disabled?: boolean | undefined;
  /**
   * Accent colour: SwiftUI `.tint()` on iOS, the selected segment's content and
   * border on Android. Default: the platform accent / Material 3 scheme.
   */
  tintColor?: ColorValue | undefined;
  /**
   * Access to the native Hybrid Object, for this repo's harness and benchmarks.
   *
   * @internal Not app API (DECISIONS D14): props must flow through React, so a
   * direct write here runs the native setter off the UI thread and never commits.
   * Reading props and calling `measureContent()` is all it is for, and the
   * callback runs once, when the view mounts - a new function does not re-run it.
   *
   * The shape is written inline rather than named: it is the same read-only
   * handle as `NitroUiSegmentedControlHandle` in
   * `NativeNitroUiSegmentedControl.ts`, and naming it here would make
   * api-extractor demand that a v0.1-hidden native type be exported from the
   * entry point.
   */
  hybridRef?:
    | ((view: {
        readonly options: string[];
        readonly selectedIndex: number | null;
        readonly mostRecentEventCount: number;
        readonly disabled: boolean;
        readonly tintColor: number | null;
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
 * The separator between options in `nuiSizingKey`.
 *
 * A label may contain it, so labels are escaped on the way in (`\` -> `\\`,
 * `|` -> `\|`) and only the unescaped ones separate. Without the escape,
 * `['a|b']` and `['a', 'b']` would build the same key and share one cached
 * size - one of which is wrong, for the whole life of the process.
 */
const OPTION_SEPARATOR = '|';

/** Escape one free-form label so it cannot forge a separator. */
function escapeOption(label: string): string {
  return label.replace(/[\\|]/g, '\\$&');
}

/**
 * The size configuration of one SegmentedControl, as the sizing engine sees it.
 *
 * The labels *are* the control's width on both platforms, so they are the whole
 * variant - and the count goes in front, because escaping alone cannot tell
 * `[]` from `['']` apart once joined (both join to nothing). `disabled` and
 * `tintColor` repaint, they do not resize, and the text size / density / OS
 * control size are *not* here: native folds the environment in through the
 * epoch, and repeating it would fragment the cache
 * (`docs/architecture/sizing.md`, "Building `nuiSizingKey`").
 */
function sizingVariantFor(options: readonly string[]): string {
  return `${String(options.length)}${OPTION_SEPARATOR}${options
    .map(escapeOption)
    .join(OPTION_SEPARATOR)}`;
}

/**
 * What a self-sizing control is laid out with, before any `style`.
 *
 * `alignItems: stretch` (the default in a column) otherwise decides the
 * control's width for it: Yoga gives a stretched child the row's width as an
 * *exact* constraint, so the measured size is never even asked for and a row of
 * three segments becomes a 402 pt box with three short buttons in it. Same rule
 * as `Switch` and `Button`; an explicit `width`, `flex` or
 * `alignSelf: 'stretch'` in the caller's `style` still wins.
 */
const SELF_SIZING_BASE_STYLE = { alignSelf: 'flex-start' } as const;

/** Clamp a caller's index into `options`, non-numerics going to the front. */
function clampToOptions(index: number, optionCount: number): number {
  if (!(optionCount > 0)) {
    return 0;
  }
  if (!Number.isFinite(index)) {
    return 0;
  }
  const rounded = Math.trunc(index);
  if (rounded < 0) {
    return 0;
  }
  return rounded > optionCount - 1 ? optionCount - 1 : rounded;
}

/**
 * The platform segmented control: SwiftUI `Picker` with `.pickerStyle(.segmented)`
 * on iOS, Material 3 `SingleChoiceSegmentedButtonRow` + `SegmentedButton` on
 * Android.
 *
 * ```tsx
 * const [index, setIndex] = useState(0)
 * <SegmentedControl
 *   options={['List', 'Grid', 'Board']}
 *   selectedIndex={index}
 *   onChange={(_event) => setIndex(_event.index)}
 * />
 * ```
 *
 * The selection is a number, so it goes through the event-count handshake
 * (`docs/architecture/core.md` §4): native paints a tap at once and reverts it
 * if the parent does not move `selectedIndex`.
 */
export function SegmentedControl({
  options,
  selectedIndex,
  defaultSelectedIndex = 0,
  onChange,
  disabled = false,
  tintColor,
  testID,
  accessibilityLabel,
  hybridRef,
  nuiPerfId = null,
  style,
  ...restProps
}: SegmentedControlProps) {
  // `options` may be `undefined` at runtime despite the type; treat that as no
  // options rather than throwing inside a render.
  const safeOptions = options ?? [];
  const optionCount = safeOptions.length;
  // The handshake works on the index. The public `onChange` also carries the
  // label, looked up from the `options` of *this* render: `useControlled` keeps
  // one native callback identity forever and swaps only the closure it reads, so
  // an event reports the labels that were on screen when the tap happened. If
  // `options` shrank between the tap and the event, the label is `''` - the
  // index is what the app gets, and it is the one that cannot be stale.
  const controlled = useControlled<number>(
    selectedIndex,
    clampToOptions(defaultSelectedIndex, optionCount),
    (index) => {
      onChange?.({ index, value: safeOptions[index] ?? '' });
    }
  );
  const processedTint = useProcessedColor(tintColor);
  const hybridRefCallback = useStableCallback(hybridRef);
  const sizingId = useSizingId();

  return (
    <NativeNitroUiSegmentedControl
      {...restProps}
      options={safeOptions}
      selectedIndex={
        controlled.value === null
          ? null
          : clampToOptions(controlled.value, optionCount)
      }
      defaultSelectedIndex={clampToOptions(defaultSelectedIndex, optionCount)}
      mostRecentEventCount={controlled.mostRecentEventCount}
      disabled={disabled}
      tintColor={processedTint}
      testID={testID ?? null}
      accessibilityLabel={accessibilityLabel ?? null}
      nuiPerfId={nuiPerfId}
      onValueChange={controlled.onNativeChange}
      nuiSizingKey={sizingVariantFor(safeOptions)}
      nuiSizingId={sizingId}
      hybridRef={hybridRefCallback ?? undefined}
      style={[SELF_SIZING_BASE_STYLE, style]}
    />
  );
}

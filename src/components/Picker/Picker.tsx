import { useState } from 'react';
import { type ColorValue, type ViewProps } from 'react-native';

import { useControlled } from '../../core/useControlled';
import { useProcessedColor } from '../../core/useProcessedColor';
import { useSizingId } from '../../core/useSizingId';
import { useStableCallback } from '../../core/useStableCallback';
import { NativeNitroUiPicker } from './NativeNitroUiPicker';

/**
 * What {@link PickerProps.onChange} reports: the index that was selected, plus
 * the option's text.
 *
 * Both are included because callers want both — `index` to address the model,
 * `value` to show or store the label — and the wrapper can supply `value` for
 * free from the `options` it is already rendering. Same shape as
 * `SegmentedControlChange`, which this control shares its data model with.
 */
export interface PickerChange {
  /** Position of the chosen option in `options`. */
  index: number;
  /** That option's label, read from the `options` rendered at event time. */
  value: string;
}

/** How the control presents its options. */
export type PickerVariant = 'menu' | 'wheel';

/**
 * Props of {@link Picker}.
 *
 * `selectedIndex`/`defaultSelectedIndex`/`onChange`/`disabled`/`tintColor`
 * follow the library's other controls (`Switch`, `Slider`,
 * `SegmentedControl`); everything else comes from `ViewProps`.
 */
export interface PickerProps extends ViewProps {
  /**
   * The choices, in order. A menu picker's button is as wide as the title it
   * shows, so this is the prop that decides its size.
   *
   * Two options may share a label; the value of the control is always the
   * *index*, never the text.
   */
  options: string[];
  /**
   * Selected index. Pass it to control the picker; leave it `undefined` for an
   * uncontrolled one (native then owns the displayed selection, and a choice
   * costs no React render).
   *
   * A value outside the current `options` is clamped into range (see
   * `docs/components/picker.md`), on both platforms and in JS.
   */
  selectedIndex?: number | undefined;
  /**
   * Initial selected index of an uncontrolled picker. Default: `0`. Ignored
   * while `selectedIndex` is set, and clamped to `options` when applied.
   */
  defaultSelectedIndex?: number | undefined;
  /**
   * Called after every user selection, with the new index and its label.
   *
   * Not called for a selection React itself made, for opening or closing the
   * menu, and not called while `disabled`.
   */
  onChange?: ((event: PickerChange) => void) | undefined;
  /**
   * `'menu'` (default) or `'wheel'`.
   *
   * A menu is a button that opens a list, sized by the title it shows. A wheel
   * fills its box's width and measures its own height — **on iOS only**:
   * Material 3 has no wheel, so `'wheel'` renders the menu control on Android
   * under the wheel's layout policy rather than a fake wheel.
   */
  variant?: PickerVariant | undefined;
  /**
   * A label for the control, shown where the platform shows one: Android draws
   * it as the Material 3 field's label, iOS uses it as the menu's title and for
   * accessibility and draws nothing next to the button. Default: none.
   */
  label?: string | undefined;
  /** Disable interaction. Default: `false`. */
  disabled?: boolean | undefined;
  /**
   * Accent colour of the control. Default: the platform's own.
   *
   * What it paints differs: on Android the field's active outline/label, on iOS
   * the menu picker's title (a SwiftUI menu `Picker` does take `.tint()`, unlike
   * a segmented one). Measured on both platforms in
   * `docs/components/picker.md`.
   */
  tintColor?: ColorValue | undefined;
  /**
   * Identifier for tests. iOS: RN's own `accessibilityIdentifier`. Android: the
   * host `View.tag`, which is what the harness and `findNodeByName` read.
   */
  testID?: string | undefined;
  /**
   * Accessibility label of the control. The options keep their own labels; this
   * names the control that opens them.
   */
  accessibilityLabel?: string | undefined;
  /**
   * Access to the native Hybrid Object, for this repo's harness and benchmarks.
   *
   * @internal Not app API (DECISIONS D14): props must flow through React, so a
   * direct write here runs the native setter off the UI thread and never commits.
   * Reading props and calling `measureContent()` is all it is for, and the
   * callback runs once, when the view mounts - a new function does not re-run it.
   *
   * The shape is written inline rather than named: it is the same read-only
   * handle as `NitroUiPickerHandle` in `NativeNitroUiPicker.ts`, and naming it
   * here would make api-extractor demand that a v0.1-hidden native type be
   * exported from the entry point.
   */
  hybridRef?:
    | ((view: {
        readonly options: string[];
        readonly selectedIndex: number | null;
        readonly mostRecentEventCount: number;
        readonly variant: string;
        readonly label: string | null;
        readonly disabled: boolean;
        readonly tintColor: number | null;
        readonly accessibilityLabel: string | null;
        measureContent(): { width: number; height: number };
        nuiTestSelect(index: number): void;
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
 * The separator between parts of `nuiSizingKey`.
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
 * The size configuration of one Picker, as the sizing engine sees it.
 *
 * Four things decide a picker's box, and all four are in the key:
 * - the **variant**, which is a different control with a different sizing policy
 *   (a menu is as wide as its title; a wheel is as wide as its box);
 * - the **option count and labels**, which a wheel renders and a menu's popup
 *   lists, and which decide the widest title the control may ever have to show;
 * - the **selected label**, because a menu button shows one title and a longer
 *   selection makes it wider (SegmentedControl deliberately leaves the selection
 *   out of *its* key: a segment row is the same width whichever segment is
 *   chosen. Copying that here would cache a narrow button against a wide one);
 * - the **label**, which on Android is part of the field's box.
 *
 * `disabled` and `tintColor` repaint, they do not resize, and the text size /
 * density / OS control size are *not* here: native folds the environment in
 * through the epoch, and repeating it would fragment the cache
 * (`docs/architecture/sizing.md`, "Building `nuiSizingKey`").
 */
function sizingVariantFor(
  options: readonly string[],
  selectedIndex: number,
  label: string | null,
  variant: string
): string {
  const selected = options[selectedIndex] ?? '';
  return [
    variant,
    String(options.length),
    ...options.map(escapeOption),
    `sel:${escapeOption(selected)}`,
    `lbl:${escapeOption(label ?? '')}`,
  ].join(OPTION_SEPARATOR);
}

/**
 * What a `menu` picker is laid out with, before any `style`: the control's own
 * fitting size, so a parent must not stretch it.
 *
 * `alignItems: stretch` (the default in a column) otherwise decides the
 * control's width for it: Yoga gives a stretched child the row's width as an
 * *exact* constraint, so the measured size is never even asked for. Same rule as
 * `Switch`, `Button` and `SegmentedControl`; an explicit `width`, `flex` or
 * `alignSelf: 'stretch'` in the caller's `style` still wins.
 */
const SELF_SIZING_BASE_STYLE = { alignSelf: 'flex-start' } as const;

/**
 * What a `wheel` picker is laid out with: `alignSelf: 'stretch'`, because the
 * wheel's width *is* the box's width and `alignSelf` is the only thing that
 * decides the cross axis (the trap `docs/architecture/sizing.md` §6 records).
 */
const FILL_WIDTH_BASE_STYLE = { alignSelf: 'stretch' } as const;

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
 * The platform picker: SwiftUI `Picker` with `.pickerStyle(.menu)` or `.wheel`
 * on iOS, Material 3's `ExposedDropdownMenuBox` on Android (both variants -
 * Material 3 has no wheel, and rendering the menu is what we ship rather than a
 * faked wheel).
 *
 * ```tsx
 * const [index, setIndex] = useState(0)
 * <Picker
 *   options={['Small', 'Medium', 'Large']}
 *   selectedIndex={index}
 *   onChange={(_event) => setIndex(_event.index)}
 * />
 * ```
 *
 * The selection is a number, so it goes through the event-count handshake
 * (`docs/architecture/core.md` §4): native paints a choice at once and reverts
 * it if the parent does not move `selectedIndex`.
 */
export function Picker({
  options,
  selectedIndex,
  defaultSelectedIndex = 0,
  onChange,
  variant = 'menu',
  label,
  disabled = false,
  tintColor,
  testID,
  accessibilityLabel,
  hybridRef,
  nuiPerfId = null,
  style,
  ...restProps
}: PickerProps) {
  // `options` may be `undefined` at runtime despite the type; treat that as no
  // options rather than throwing inside a render.
  const safeOptions = options ?? [];
  const optionCount = safeOptions.length;
  const nativeVariant = variant === 'wheel' ? 'wheel' : 'menu';
  // The handshake works on the index. The public `onChange` also carries the
  // label, looked up from the `options` of *this* render: `useControlled` keeps
  // one native callback identity forever and swaps only the closure it reads, so
  // an event reports the labels that were on screen when the choice happened. If
  // `options` shrank between the choice and the event, the label is `''` - the
  // index is what the app gets, and it is the one that cannot be stale.
  // `key`, the `variant` prop and the sizing configuration are one value, computed
  // once: the native view is replaced exactly when the variant changes and never
  // otherwise. Android needs it - its measured root decides between the `intrinsic`
  // and the `fillWidth` question when the composition is built and never re-asks, so
  // a menu that became a wheel at runtime would go on answering the unbounded
  // question for the life of the mount (G6 review M2) - and `useSizingId` takes it
  // for the reason on that hook: the dropped view's `onDropView` must not end the
  // ledger entry the new mount just filed. Same rule as `Progress.tsx`, which this
  // control's policy switch was copied from. iOS reads the policy live, so the key
  // costs it nothing it did not already do.
  //
  // Computed before the choice below, because the choice is stamped with the id: the
  // id is what makes "which mount made this choice" answerable.
  const variantKey = nativeVariant;
  const sizingId = useSizingId(variantKey);
  // What an uncontrolled control showed its user last.
  //
  // Native owns the displayed index (core.md section 4) and an uncontrolled choice
  // deliberately costs no React render - but this control's sizing key *names the
  // title*, so a key that never moved files every width the instance goes on
  // reporting against the configuration the choice replaced, and the cache entry of
  // the title that is no longer drawn ends up holding the new one's width (G6 review
  // M1). Tracking what native reported costs one render per choice, which is what a
  // discrete control costs everywhere else, and it is what lets the host answer the
  // new title's size under the new title's key.
  //
  // It is stored with the id of the mount that made it, because a variant change
  // remounts the native view and the fresh mount re-seeds from
  // `defaultSelectedIndex`: a choice from the old mount no longer names anything.
  // The id, and not the variant, is the thing to compare: a variant change that
  // comes back round re-creates a view whose variant *matches* while its content is
  // the seed again (G6 round-2 review N1), so a remembered choice then names a title
  // native is not painting, and the fresh mount's first width lands in the cache
  // entry of the title it replaced. `useSizingId` never reuses an id, so matching on
  // it can only ever match the mount that made the choice.
  const [lastChoice, setLastChoice] = useState<{
    readonly sizingId: number;
    readonly index: number;
  } | null>(null);
  const controlled = useControlled<number>(
    selectedIndex,
    clampToOptions(defaultSelectedIndex, optionCount),
    (index) => {
      if (selectedIndex === undefined) {
        setLastChoice({ sizingId, index });
      }
      onChange?.({ index, value: safeOptions[index] ?? '' });
    }
  );
  const processedTint = useProcessedColor(tintColor);
  const hybridRefCallback = useStableCallback(hybridRef);
  const chosenIndex =
    lastChoice !== null && lastChoice.sizingId === sizingId
      ? lastChoice.index
      : null;
  // The index the control will actually show, resolved once: native clamps the
  // same way in `afterUpdate()`, and the sizing key has to name the title the
  // control is about to paint, not a number out of range.
  const shownIndex = clampToOptions(
    controlled.value === null
      ? (chosenIndex ?? clampToOptions(defaultSelectedIndex, optionCount))
      : controlled.value,
    optionCount
  );

  return (
    <NativeNitroUiPicker
      {...restProps}
      // A variant change is a different control, not a repaint - see `variantKey`.
      // It also means an uncontrolled picker starts its new mount again from
      // `defaultSelectedIndex`, which `docs/components/picker.md` says.
      key={variantKey}
      options={safeOptions}
      selectedIndex={
        controlled.value === null
          ? null
          : clampToOptions(controlled.value, optionCount)
      }
      defaultSelectedIndex={clampToOptions(defaultSelectedIndex, optionCount)}
      mostRecentEventCount={controlled.mostRecentEventCount}
      variant={nativeVariant}
      label={label ?? null}
      disabled={disabled}
      tintColor={processedTint}
      testID={testID ?? null}
      accessibilityLabel={accessibilityLabel ?? null}
      nuiPerfId={nuiPerfId}
      onValueChange={controlled.onNativeChange}
      nuiSizingKey={sizingVariantFor(
        safeOptions,
        shownIndex,
        label ?? null,
        nativeVariant
      )}
      nuiSizingId={sizingId}
      hybridRef={hybridRefCallback ?? undefined}
      style={[
        nativeVariant === 'wheel'
          ? FILL_WIDTH_BASE_STYLE
          : SELF_SIZING_BASE_STYLE,
        style,
      ]}
    />
  );
}

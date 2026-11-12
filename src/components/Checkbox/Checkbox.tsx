import { type ColorValue, Platform, type ViewProps } from 'react-native';

import { useControlled } from '../../core/useControlled';
import { useProcessedColor } from '../../core/useProcessedColor';
import { useSizingId } from '../../core/useSizingId';
import { useStableCallback } from '../../core/useStableCallback';
import { useSelfSizingBaseStyle } from '../../core/useSelfSizing';
import { NativeNitroUiCheckbox } from './NativeNitroUiCheckbox';

/**
 * Which picture iOS draws for a Checkbox (DECISIONS D47).
 *
 * - `circle` (the default): Apple's checklist glyph - `checkmark.circle.fill` over
 *   `circle`, the one Reminders and Notes use. iOS has no checkbox control
 *   (`CheckboxToggleStyle` is unavailable there), so this is the platform's own
 *   `Toggle` with a style that draws Apple's own symbols.
 * - `square`: the same glyph squared (`checkmark.square.fill` over `square`).
 * - `switch`: the look this component shipped with - SwiftUI's `.switch` Toggle,
 *   which is what a Checkbox was under DECISIONS D38 item 1. Unchanged.
 *
 * Android ignores all three: Material 3 has a checkbox, so there is nothing to choose.
 */
export type CheckboxIosStyle = 'circle' | 'square' | 'switch';

const IOS_STYLES: readonly CheckboxIosStyle[] = ['circle', 'square', 'switch'];

/**
 * Props of {@link Checkbox}.
 *
 * There are no children: the label is the `label` string, as a Button's is its
 * `title` and a Chip's is its `label` (`docs/architecture/core.md`, leaf Hybrid
 * Views).
 */
export interface CheckboxProps extends ViewProps {
  /**
   * The checked state. Pass it to control the checkbox; leave it `undefined` for
   * an uncontrolled one (native then owns what is showing).
   *
   * A boolean on both platforms: three-state is {@link CheckboxProps.indeterminate},
   * not a third value here.
   */
  checked?: boolean | undefined;
  /** The initial state of an uncontrolled checkbox. Default: `false`. */
  defaultChecked?: boolean | undefined;
  /**
   * Called with the new state after every user toggle. A controlled checkbox whose
   * caller does not pass the value back reverts. Nothing fires while `disabled`.
   */
  onCheckedChange?: ((checked: boolean) => void) | undefined;
  /**
   * Show the third state (a dash in the box): Material 3's `TriStateCheckbox` on
   * Android, `minus.circle.fill` / `minus.square.fill` on iOS. It is a display, not a
   * value - a tap still asks for `checked: true`, and the event never carries
   * `'indeterminate'` (`docs/components/checkbox.md`).
   *
   * `checked` outranks it on both platforms: a box that is `indeterminate` *and*
   * checked draws the check mark. The one iOS style that reads it as off is
   * `iosStyle='switch'`, whose control has two positions (`iosStyle`).
   */
  indeterminate?: boolean | undefined;
  /**
   * Text beside the box, which is part of the control and of its size on both
   * platforms. It is also the checkbox's accessible name when
   * {@link accessibilityLabel} is unset - a bare Android checkbox has no name.
   */
  label?: string | undefined;
  /**
   * iOS only: which picture the checkbox draws - a circle (the default), a square, or
   * the switch this component shipped with. See {@link CheckboxIosStyle}.
   *
   * Android ignores it (Material 3 has a checkbox), and iOS still has no checkbox
   * *control*: the two glyph styles are SwiftUI's `Toggle` drawing Apple's own SF
   * Symbols, which is why the tap, the value and the accessibility element are the
   * same in all three.
   */
  iosStyle?: CheckboxIosStyle | undefined;
  /** Disable interaction. Default: `false`. */
  disabled?: boolean | undefined;
  /**
   * The "on" accent color: SwiftUI `.tint()` / Compose's checked colors, or
   * `undefined` for the platform default. Switch's convention.
   */
  tintColor?: ColorValue | undefined;
  /**
   * Access to the native Hybrid Object, for this repo's harness.
   *
   * @internal Not app API (DECISIONS D14): props must flow through React, so a
   * direct write here runs the native setter off the UI thread and never commits.
   * The callback runs once, when the view mounts.
   *
   * The shape is written inline rather than named, for the reason `ButtonProps`
   * gives: naming it would make api-extractor demand that a hidden native type be
   * exported from the entry point.
   */
  hybridRef?:
    | ((view: {
        readonly checked: boolean | null;
        readonly mostRecentEventCount: number;
        readonly label: string | null;
        readonly disabled: boolean;
        readonly indeterminate: boolean | null;
        readonly iosStyle: string;
        readonly accessibilityLabel: string | null;
        measureContent(): { width: number; height: number };
        nuiTestToggle(): void;
        nuiTestProbeAccessibility(): void;
        nuiTestStateReport(): string;
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
 * What a checkbox does when the caller passed no `onCheckedChange`: Button's rule
 * - the callback prop is always sent, so a recycled view cannot keep the previous
 * mount's handler.
 */
function onCheckedChangeNotProvided(): void {
  // Intentionally empty: the caller asked for nothing.
}

/**
 * The separator between the fields of a Checkbox's `nuiSizingKey`, and the escape
 * that keeps a free-form value from forging one - G10's rule for Button and Chip
 * (`\` -> `\\`, `|` -> `\|`).
 */
const FIELD_SEPARATOR = '|';

/** Escape one free-form value so it cannot forge a separator. */
function escapeField(value: string): string {
  return value.replace(/[\\|]/g, '\\$&');
}

/**
 * The size configuration of one Checkbox, as the sizing engine sees it:
 * `indeterminate|label` on Android and `0|iosStyle|label` on iOS.
 *
 * The rule is one sentence - a field goes in the key where it changes what is drawn,
 * and stays out where it does not - and each platform reads it about its own control.
 * What a field has to earn is a *box*: a field that only changes what is painted inside
 * a box that does not move buys a cold configuration, a correction, and a first frame at
 * the fallback, so it belongs out of the key.
 *
 * - `indeterminate` is Android's field: there it answers `TriStateCheckbox`, Material's
 *   own third control. On iOS it is written `0` for every style, the way `checked` is,
 *   because `minus.circle.fill`, `checkmark.circle.fill` and `circle` are one SF Symbol
 *   box - `Checkbox.harness.tsx` measures the dash and an unchecked row of the *same*
 *   label at one size, and measures that flipping `indeterminate` on a row already on
 *   screen costs no correction at all. D47 item 3 gave iOS the dash, and this is the
 *   field the dash does not earn: keyed, an app that grew a dash on a row it had already
 *   drawn would watch that row re-lay out at the fallback for a frame to repaint the
 *   same box;
 * - `iosStyle` is iOS's own field: three styles, three boxes. Android ignores the
 *   prop, so its key does not carry it - a prop that changes nothing that is drawn
 *   must not cost a cold configuration there, and that is the same reason the field
 *   is missing rather than constant. `Chip.tsx` keeps its iOS-only `systemImage` in
 *   both keys to stop the platforms drifting apart; here the drift is settled by the
 *   sizing test that measures each style's box, and Android's rows stay one per
 *   configuration;
 * - `label` is the content, escaped because it is free-form;
 * - `checked` is in neither key: no box on either platform changes size between
 *   checked and unchecked, which the harness measures (a checkbox grows only with its
 *   label, and `checkmark.circle.fill`, `minus.circle.fill` and `circle` are one
 *   symbol box), and `disabled` and `tintColor` repaint without resizing. The
 *   environment (text size, density) is folded in by native through the epoch.
 */
function sizingVariantFor(
  label: string,
  indeterminate: boolean,
  iosStyle: CheckboxIosStyle
): string {
  const android = Platform.OS === 'android';
  // `0` on iOS whatever `indeterminate` says - see the rule above. It stays a field of
  // the key rather than disappearing so one string shape describes both platforms and
  // Android's half of the key keeps its position.
  const indeterminateField = android && indeterminate ? '1' : '0';
  const fields = [indeterminateField];
  if (!android) fields.push(iosStyle);
  fields.push(escapeField(label));
  return fields.join(FIELD_SEPARATOR);
}

/**
 * Resolve a caller's iOS style, defaulting anything unrecognised to `'circle'` -
 * Chip's `resolveVariant` rule, and the reason the native prop is a plain `string`.
 */
function resolveIosStyle(
  iosStyle: CheckboxIosStyle | undefined
): CheckboxIosStyle {
  return iosStyle != null && IOS_STYLES.includes(iosStyle)
    ? iosStyle
    : 'circle';
}

/**
 * A name that is not a name, mapped to "none": `""` renders no text and names
 * nothing, so it is the bare box.
 *
 * Sending `""` is not harmless. iOS applies `accessibilityLabel(_:)` whenever the
 * name is non-nil (`OptionalAccessibility` in `HybridNitroUiCheckbox.swift`), and an
 * empty one *silences* the element instead of naming it; Android's merged row would
 * carry an empty `contentDescription` for the same reason. Normalising here, once,
 * before the sizing key and before both props, is what makes `label=""`,
 * `accessibilityLabel=""` and no label at all one configuration on both platforms —
 * which the wrapper test pins, because the device suite sees a zero-width label and
 * a missing one identically.
 */
function nameOrNull(value: string | undefined): string | null {
  return value == null || value === '' ? null : value;
}

/**
 * A checkbox: Material 3 `Checkbox` - `TriStateCheckbox` when `indeterminate` - on
 * Android, and on iOS a SwiftUI `Toggle(isOn:)` wearing a style that draws Apple's
 * checklist glyph (`checkmark.circle.fill` over `circle`), because iOS has no checkbox
 * control (`CheckboxToggleStyle` is unavailable there) and a Checkbox that looked like
 * a Switch read as the wrong component (DECISIONS D47). `iosStyle='switch'` is the
 * previous look - the `.switch` Toggle Expo's universal `Checkbox` renders - and it is
 * unchanged.
 *
 * ```tsx
 * const [terms, setTerms] = useState(false)
 * <Checkbox label="I accept the terms" checked={terms} onCheckedChange={setTerms} />
 * ```
 *
 * The box is measured, not declared: the first checkbox of a configuration is laid
 * out at a fallback and corrected the turn it measures
 * (`docs/architecture/sizing.md`).
 */
export function Checkbox({
  checked,
  defaultChecked = false,
  onCheckedChange,
  indeterminate = false,
  label,
  iosStyle = 'circle',
  disabled = false,
  tintColor,
  testID,
  accessibilityLabel,
  hybridRef,
  nuiPerfId = null,
  style,
  ...restProps
}: CheckboxProps) {
  const selfSizingBaseStyle = useSelfSizingBaseStyle();
  const sizingId = useSizingId();
  const tint = useProcessedColor(tintColor);
  // The value's own handshake (core-architecture §4): native shows a toggle at
  // once and echoes the count, and a `checked` write only lands once it has seen
  // that many of its own events.
  const controlled = useControlled<boolean>(
    checked,
    defaultChecked,
    onCheckedChange ?? onCheckedChangeNotProvided
  );
  const hybridRefCallback = useStableCallback(hybridRef);
  // Both names, before anything reads them: see `nameOrNull`.
  const labelText = nameOrNull(label);
  const nameText = nameOrNull(accessibilityLabel);
  // Resolved once, before the key and before the prop, so the configuration the key
  // names is the one native draws (`resolveIosStyle`).
  const resolvedIosStyle = resolveIosStyle(iosStyle);

  return (
    <NativeNitroUiCheckbox
      {...restProps}
      checked={controlled.value}
      defaultChecked={controlled.defaultValue}
      indeterminate={indeterminate ? true : null}
      mostRecentEventCount={controlled.mostRecentEventCount}
      label={labelText}
      iosStyle={resolvedIosStyle}
      disabled={disabled}
      tintColor={tint}
      testID={testID ?? null}
      accessibilityLabel={nameText}
      nuiPerfId={nuiPerfId}
      onCheckedChange={controlled.onNativeChange}
      nuiSizingKey={sizingVariantFor(
        labelText ?? '',
        indeterminate,
        resolvedIosStyle
      )}
      nuiSizingId={sizingId}
      hybridRef={hybridRefCallback ?? undefined}
      style={[selfSizingBaseStyle, style]}
    />
  );
}

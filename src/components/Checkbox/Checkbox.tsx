import { type ColorValue, Platform, type ViewProps } from 'react-native';

import { useControlled } from '../../core/useControlled';
import { useProcessedColor } from '../../core/useProcessedColor';
import { useSizingId } from '../../core/useSizingId';
import { useStableCallback } from '../../core/useStableCallback';
import { useSelfSizingBaseStyle } from '../../core/useSelfSizing';
import { NativeNitroUiCheckbox } from './NativeNitroUiCheckbox';

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
   * Android only: show Material 3's third state (a dash in the box). It is a
   * display, not a value - a tap still asks for `checked: true`, and the event
   * never carries `'indeterminate'`. iOS has no checkbox at all, so its switch
   * reads this as off (`docs/components/checkbox.md`).
   */
  indeterminate?: boolean | undefined;
  /**
   * Text beside the box, which is part of the control and of its size on both
   * platforms. It is also the checkbox's accessible name when
   * {@link accessibilityLabel} is unset - a bare Android checkbox has no name.
   */
  label?: string | undefined;
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
 * `indeterminate|label`.
 *
 * - `indeterminate` is `1` only where it changes what is drawn: on Android, whose
 *   `TriStateCheckbox` paints a third glyph. iOS draws a switch and reads it as
 *   off, so its key never carries it and turning it on there is not a cold
 *   configuration;
 * - `label` is the content, escaped because it is free-form;
 * - `checked` is in neither key: neither platform's box changes size between
 *   checked and unchecked, which the harness measures (a checkbox grows only with
 *   its label), and `disabled` and `tintColor` repaint without resizing. The
 *   environment (text size, density) is folded in by native through the epoch.
 */
function sizingVariantFor(label: string, indeterminate: boolean): string {
  const indeterminateField =
    Platform.OS === 'android' && indeterminate ? '1' : '0';
  return [indeterminateField, escapeField(label)].join(FIELD_SEPARATOR);
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
 * Android, and SwiftUI `Toggle(isOn:)` with the switch style on iOS, which has no
 * checkbox (`CheckboxToggleStyle` is unavailable there). That is what Expo's
 * universal `Checkbox` renders on iOS too, and it is why `indeterminate` is
 * documented as Android-only rather than faked with a drawn dash.
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

  return (
    <NativeNitroUiCheckbox
      {...restProps}
      checked={controlled.value}
      defaultChecked={controlled.defaultValue}
      indeterminate={indeterminate ? true : null}
      mostRecentEventCount={controlled.mostRecentEventCount}
      label={labelText}
      disabled={disabled}
      tintColor={tint}
      testID={testID ?? null}
      accessibilityLabel={nameText}
      nuiPerfId={nuiPerfId}
      onCheckedChange={controlled.onNativeChange}
      nuiSizingKey={sizingVariantFor(labelText ?? '', indeterminate)}
      nuiSizingId={sizingId}
      hybridRef={hybridRefCallback ?? undefined}
      style={[selfSizingBaseStyle, style]}
    />
  );
}

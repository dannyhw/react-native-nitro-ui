import { type ColorValue, Platform, type ViewProps } from 'react-native';

import { useControlled } from '../../core/useControlled';
import { useProcessedColor } from '../../core/useProcessedColor';
import { useSizingId } from '../../core/useSizingId';
import { useStableCallback } from '../../core/useStableCallback';
import { useSelfSizingBaseStyle } from '../../core/useSelfSizing';
import { NativeNitroUiCheckbox } from './NativeNitroUiCheckbox';

/**
 * Which picture iOS draws for a Checkbox.
 *
 * - `circle` (the default): Apple's checklist glyph - `checkmark.circle.fill` over
 *   `circle`, the one Reminders and Notes use.
 * - `square`: the same glyph squared (`checkmark.square.fill` over `square`).
 * - `switch`: SwiftUI's `.switch` Toggle.
 *
 * Android ignores all three: Material 3 has a checkbox, so there is nothing to choose.
 */
export type CheckboxIosStyle = 'circle' | 'square' | 'switch';

const IOS_STYLES: readonly CheckboxIosStyle[] = ['circle', 'square', 'switch'];

/** Props of {@link Checkbox}. The label is the `label` string; there are no children. */
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
   * `'indeterminate'`.
   *
   * `checked` outranks it on both platforms: a box that is `indeterminate` *and*
   * checked draws the check mark. With `iosStyle='switch'` iOS draws it as off,
   * because a switch has two positions.
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
   * a switch. See {@link CheckboxIosStyle}. Android ignores it.
   *
   * The tap, the value and the accessibility element are the same in all three.
   */
  iosStyle?: CheckboxIosStyle | undefined;
  /** Disable interaction. Default: `false`. */
  disabled?: boolean | undefined;
  /**
   * The "on" accent color: SwiftUI `.tint()` / Compose's checked colors, or
   * `undefined` for the platform default.
   */
  tintColor?: ColorValue | undefined;
  /**
   * Read-only access to the native view, for this library's own tests.
   *
   * @internal Not app API. A write through this handle bypasses React and never
   * commits. The callback runs once, when the view mounts. The shape is inline
   * because naming it would force an internal native type into the public exports.
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
   * Instance id for native performance marks; `null` turns them off for this view.
   *
   * @internal Benchmark and diagnostics only - not app API.
   */
  nuiPerfId?: number | null | undefined;
}

/**
 * Sent when the caller passes no `onCheckedChange`. The callback prop must always
 * be sent, so a recycled view cannot keep the previous mount's handler.
 */
function onCheckedChangeNotProvided(): void {
  // Intentionally empty: the caller asked for nothing.
}

/**
 * Separates the fields of a Checkbox's `nuiSizingKey`. Free-form values are
 * escaped so they cannot contain a bare separator.
 */
const FIELD_SEPARATOR = '|';

/** Escape one free-form value so it cannot forge a separator. */
function escapeField(value: string): string {
  return value.replace(/[\\|]/g, '\\$&');
}

/**
 * The key two Checkboxes share when they are the same size: `indeterminate|label`
 * on Android and `0|iosStyle|label` on iOS. A field is in the key only where it
 * changes the control's box:
 *
 * - `indeterminate` changes it on Android (`TriStateCheckbox`). On iOS the dash
 *   glyph has the same box as the other glyphs, so the field is always `0`;
 * - `iosStyle` changes it on iOS and is ignored by Android;
 * - `checked`, `disabled` and `tintColor` repaint without resizing. Text size and
 *   density are tracked natively.
 */
function sizingVariantFor(
  label: string,
  indeterminate: boolean,
  iosStyle: CheckboxIosStyle
): string {
  const android = Platform.OS === 'android';
  // Always `0` on iOS, where the dash does not change the box. The field stays so
  // it keeps its position in the key.
  const indeterminateField = android && indeterminate ? '1' : '0';
  const fields = [indeterminateField];
  if (!android) fields.push(iosStyle);
  fields.push(escapeField(label));
  return fields.join(FIELD_SEPARATOR);
}

function resolveIosStyle(
  iosStyle: CheckboxIosStyle | undefined
): CheckboxIosStyle {
  return iosStyle != null && IOS_STYLES.includes(iosStyle)
    ? iosStyle
    : 'circle';
}

/**
 * Maps `""` to `null`. An empty name is not harmless: iOS applies any non-nil
 * accessibility label, and an empty one silences the element instead of naming
 * it. Applied before the sizing key, so `label=""` and no label are one
 * configuration.
 */
function nameOrNull(value: string | undefined): string | null {
  return value == null || value === '' ? null : value;
}

/**
 * A checkbox: Material 3 `Checkbox` - `TriStateCheckbox` when `indeterminate` - on
 * Android. iOS has no checkbox control, so there it is a SwiftUI `Toggle` styled
 * to draw Apple's checklist glyph (`checkmark.circle.fill` over `circle`);
 * `iosStyle` picks a square glyph or a switch instead.
 *
 * ```tsx
 * const [terms, setTerms] = useState(false)
 * <Checkbox label="I accept the terms" checked={terms} onCheckedChange={setTerms} />
 * ```
 *
 * It sizes itself to its content.
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
  // Native shows a toggle at once and echoes its event count; a `checked` write
  // lands only once native has seen that many of its own events.
  const controlled = useControlled<boolean>(
    checked,
    defaultChecked,
    onCheckedChange ?? onCheckedChangeNotProvided
  );
  const hybridRefCallback = useStableCallback(hybridRef);
  const labelText = nameOrNull(label);
  const nameText = nameOrNull(accessibilityLabel);
  // Resolved before the key and the prop, so the key names the style native draws.
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

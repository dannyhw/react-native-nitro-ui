import { useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react';
import { type ViewProps } from 'react-native';

import { useControlled } from '../../core/useControlled';
import { useSizingId } from '../../core/useSizingId';
import {
  AUTO_CAPITALIZE,
  KEYBOARD_TYPES,
  resolveKeyboardOption,
  type TextFieldAutoCapitalize,
  type TextFieldKeyboardType,
} from '../../core/keyboard';
import {
  useStableCallback,
  type NitroCallbackProp,
} from '../../core/useStableCallback';
import {
  NativeNitroUiTextField,
  type NitroUiTextFieldHandle,
} from './NativeNitroUiTextField';

/**
 * The two keyboard types, published from `TextField` because that is where they
 * started; `SearchField` takes the same two props and the same
 * {@link ../../core/keyboard} module declares them.
 */
export type {
  TextFieldAutoCapitalize,
  TextFieldKeyboardType,
} from '../../core/keyboard';

/** The label of the Return key on a single-line field. */
export type TextFieldReturnKeyType =
  'default' | 'done' | 'go' | 'next' | 'search' | 'send';

/** What a `ref` to a {@link TextField} can do. */
export interface TextFieldHandle {
  /**
   * Give the field focus, which brings up the keyboard. Returns at once; the
   * field's `onFocus` fires when focus lands. Does nothing while the field is
   * not `editable`.
   */
  focus(): void;
  /** Take focus away from the field, which dismisses its keyboard. */
  blur(): void;
}

/**
 * Props of {@link TextField}.
 *
 * The names are React Native `TextInput`'s, for the subset a text field needs
 * first; everything else comes from `ViewProps`.
 */
export interface TextFieldProps extends Omit<ViewProps, 'onFocus' | 'onBlur'> {
  /**
   * The text. Pass it to control the field; leave it `undefined` for an
   * uncontrolled one (native then owns the text, and typing costs no React
   * render).
   */
  value?: string | undefined;
  /** Initial text of an uncontrolled field. Default: `''`. */
  defaultValue?: string | undefined;
  /**
   * Called with the new text after every edit the user makes. A controlled
   * field that does not take the new text keeps showing its `value`: the edit
   * is reverted.
   */
  onChangeText?: ((text: string) => void) | undefined;
  /** Text shown while the field is empty. */
  placeholder?: string | undefined;
  /**
   * Wrap and grow with the content instead of scrolling one line. Return then
   * inserts a newline, and `returnKeyType`, `secureTextEntry` and
   * `onSubmitEditing` do not apply. Default: `false`.
   */
  multiline?: boolean | undefined;
  /** The keyboard to show. Default: `'default'`. */
  keyboardType?: TextFieldKeyboardType | undefined;
  /** What the keyboard capitalises. Default: `'sentences'`. */
  autoCapitalize?: TextFieldAutoCapitalize | undefined;
  /** Whether the keyboard may autocorrect. Default: `true`. */
  autoCorrect?: boolean | undefined;
  /** Obscure the text, for a password. Single-line only. Default: `false`. */
  secureTextEntry?: boolean | undefined;
  /**
   * The longest text the field accepts, counted the way JavaScript counts
   * `string.length` (UTF-16 code units, as React Native does). An insertion
   * that would pass it is cut short, never through the middle of an emoji or
   * another composed character.
   */
  maxLength?: number | null | undefined;
  /** The Return key's label on a single-line field. Default: `'default'`. */
  returnKeyType?: TextFieldReturnKeyType | undefined;
  /**
   * Called when Return is pressed on a single-line field, with its text - the
   * string itself, where React Native's `TextInput` passes an event. The field
   * then loses focus, as React Native's does by default.
   */
  onSubmitEditing?: ((text: string) => void) | undefined;
  /**
   * `false`: the field shows its text but takes no focus and no input.
   * Default: `true`.
   */
  editable?: boolean | undefined;
  /** Called when the field gains focus. */
  onFocus?: (() => void) | undefined;
  /** Called when the field loses focus. */
  onBlur?: (() => void) | undefined;
  /** `focus()` and `blur()`; see {@link TextFieldHandle}. */
  ref?: Ref<TextFieldHandle> | undefined;
  /**
   * Access to the native Hybrid Object, for this repo's harness and benchmarks.
   *
   * @internal Not app API (DECISIONS D14). The shape is the handle
   * `NitroUiTextFieldHandle` in `NativeNitroUiTextField.ts`, written inline
   * (as `Switch.tsx` does) so api-extractor does not demand that an internal
   * native type be exported.
   */
  hybridRef?:
    | ((view: {
        readonly value: string | null;
        readonly mostRecentEventCount: number;
        readonly accessibilityLabel: string | null;
        measureContent(): { width: number; height: number };
        focus(): void;
        blur(): void;
        nuiTestState(): {
          text: string;
          focused: boolean;
          composing: boolean;
          nativeEvents: number;
          jsEvents: number;
          lastWrite: string;
          editable: boolean;
          multiline: boolean;
          secure: boolean;
          keyboardType: string;
          returnKeyType: string;
          autoCapitalize: string;
          autoCorrect: boolean;
          maxLength: number;
          placeholder: string;
          accessibilityLabel: string;
        };
        nuiTestSetMarkedText(text: string): void;
        nuiTestCancelMarkedText(): void;
        nuiTestPaste(text: string, at: number): void;
        nuiTestLifetimeReport(): string;
      }) => void)
    | undefined;
  /**
   * Instance id used by native perf marks (`nitroUiCore.drainPerf()`).
   *
   * @internal Benchmark and diagnostics only - not app API.
   */
  nuiPerfId?: number | null | undefined;
}

const RETURN_KEY_TYPES: ReadonlyArray<TextFieldReturnKeyType> = [
  'default',
  'done',
  'go',
  'next',
  'search',
  'send',
];

/**
 * `maxLength` as native receives it: a whole number of code units, or `null`.
 * A negative or non-finite limit is no limit, as it is for `TextInput`.
 */
function resolveMaxLength(maxLength: number | null | undefined): number | null {
  if (maxLength == null || !Number.isFinite(maxLength) || maxLength < 0) {
    return null;
  }
  return Math.floor(maxLength);
}

/**
 * The size configuration of one field, as the sizing engine sees it
 * (`docs/architecture/sizing.md`, "Building `nuiSizingKey`").
 *
 * - **Single-line**: `''`. The height is the font's line, whatever the text,
 *   width, keyboard or placeholder, and the width is the box (`fillWidth`). So
 *   every single-line field is one configuration - the default one, which is
 *   what `prewarm(['NitroUiTextField'])` warms.
 * - **Multi-line**: its height is its *content's* at its *width*, so no two
 *   fields may share an entry: one entry holds one height, and the engine
 *   corrects every instance laid out under a key with the size one of them
 *   reports (sizing.md §2). The text cannot be the key - it would add an entry
 *   per keystroke to a cache that is never evicted (Q2 §6) - so the key is the
 *   instance: `m|<sizingId>`, one entry that the field's own reports keep
 *   current as it grows. The width is not in it either. A width change is a
 *   bounds change, which re-measures and reports by itself; putting the width
 *   in the key would need an `onLayout` render per mount and would re-key a
 *   laid-out field into a configuration the engine has never seen, which draws
 *   the declared one-line height again before the correction (G13 report).
 */
function sizingVariantFor(multiline: boolean, sizingId: number): string {
  return multiline ? `m|${String(sizingId)}` : '';
}

/**
 * What a `fillWidth` control is laid out with before any `style`: the cross
 * axis is the one it wants filled (`Slider.tsx`'s `FILL_WIDTH_BASE_STYLE`).
 */
const FILL_WIDTH_BASE_STYLE = { alignSelf: 'stretch' } as const;

/** The handlers a field installs for callbacks the app did not pass (D7b). */
function onSubmitNotProvided(_text: string): void {
  // Intentionally empty: the caller asked for nothing.
}

/**
 * A single-line or multi-line text field: a `UITextField` (a `UITextView` when
 * `multiline`) on iOS, Compose `BasicTextField` on Android.
 *
 * ```tsx
 * const [name, setName] = useState('')
 * <TextField placeholder="Name" value={name} onChangeText={setName} />
 * ```
 *
 * It is undecorated on both platforms, like React Native's `TextInput`: the
 * text, the caret and the placeholder, in the platform's body font. A border
 * or a background is the caller's container.
 */
export function TextField({
  value,
  defaultValue = '',
  onChangeText,
  placeholder,
  multiline = false,
  keyboardType,
  autoCapitalize,
  autoCorrect = true,
  secureTextEntry = false,
  maxLength,
  returnKeyType,
  onSubmitEditing,
  editable = true,
  onFocus,
  onBlur,
  ref,
  testID,
  accessibilityLabel,
  hybridRef,
  nuiPerfId = null,
  style,
  ...restProps
}: TextFieldProps) {
  const controlled = useControlled(value, defaultValue, onChangeText);
  const sizingId = useSizingId();

  // The native view, for `focus()`/`blur()`. Nitro calls `hybridRef` once per
  // mount with that mount's view, so the ref always holds the live one. The
  // callback is always sent: the `ref` needs it whether or not the app (well,
  // this repo's harness) passed a `hybridRef` of its own.
  //
  // The view arrives *after* the parent's effects have run: `hybridRef` reaches JS
  // on a later turn than the commit that mounted the field. So a `focus()` or
  // `blur()` asked for before then - `useEffect(() => ref.current?.focus(), [])`,
  // the way to focus a field on mount - is held here, the newest ask winning, and
  // run as soon as the view is handed over.
  const nativeView = useRef<NitroUiTextFieldHandle | null>(null);
  const pendingFocus = useRef<'focus' | 'blur' | null>(null);
  // Whether this field is still mounted. Nitro can hand `hybridRef` to JS after the
  // unmount - React has run its cleanups by then, and the native view it names may
  // already be recycled into another field - so a queued ask is dropped at the
  // unmount and a late `hybridRef` is dropped here rather than acted upon.
  const mounted = useRef(true);
  const hybridRefCallback = useStableCallback(
    (view: NitroUiTextFieldHandle) => {
      if (!mounted.current) return;
      nativeView.current = view;
      const pending = pendingFocus.current;
      pendingFocus.current = null;
      if (pending === 'focus') view.focus();
      else if (pending === 'blur') view.blur();
      hybridRef?.(view);
    }
  ) as NitroCallbackProp<(view: NitroUiTextFieldHandle) => void>;

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        if (!mounted.current) return;
        if (nativeView.current != null) nativeView.current.focus();
        else pendingFocus.current = 'focus';
      },
      blur: () => {
        if (!mounted.current) return;
        if (nativeView.current != null) nativeView.current.blur();
        else pendingFocus.current = 'blur';
      },
    }),
    []
  );

  // A layout effect, so a parent's layout effect that focuses the field (they run
  // after their children's) finds it mounted - also when StrictMode or `<Activity>`
  // runs the cleanups and then the effects again. The native view is kept across
  // that: Nitro hands `hybridRef` over once per native view, not once per effect
  // run, and `mounted` alone keeps an unmounted field from acting on it.
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pendingFocus.current = null;
    };
  }, []);

  // One native callback for both edges, split here, and always sent (D7b).
  // `useStableCallback` keeps one identity and calls the newest closure.
  const focusChange = useStableCallback((focused: boolean) => {
    if (focused) onFocus?.();
    else onBlur?.();
  }) as NitroCallbackProp<(focused: boolean) => void>;
  const submitCallback = useStableCallback(
    onSubmitEditing ?? onSubmitNotProvided
  ) as NitroCallbackProp<(text: string) => void>;

  return (
    <NativeNitroUiTextField
      {...restProps}
      value={controlled.value}
      defaultValue={controlled.defaultValue}
      mostRecentEventCount={controlled.mostRecentEventCount}
      placeholder={placeholder ?? null}
      multiline={multiline}
      keyboardType={resolveKeyboardOption(
        keyboardType,
        KEYBOARD_TYPES,
        'default'
      )}
      autoCapitalize={resolveKeyboardOption(
        autoCapitalize,
        AUTO_CAPITALIZE,
        'sentences'
      )}
      autoCorrect={autoCorrect}
      secureTextEntry={secureTextEntry}
      maxLength={resolveMaxLength(maxLength)}
      returnKeyType={resolveKeyboardOption(
        returnKeyType,
        RETURN_KEY_TYPES,
        'default'
      )}
      editable={editable}
      testID={testID ?? null}
      accessibilityLabel={accessibilityLabel ?? null}
      nuiPerfId={nuiPerfId}
      onValueChange={controlled.onNativeChange}
      onFocusChange={focusChange}
      onSubmitEditing={submitCallback}
      nuiSizingKey={sizingVariantFor(multiline, sizingId)}
      nuiSizingId={sizingId}
      hybridRef={hybridRefCallback}
      style={[FILL_WIDTH_BASE_STYLE, style]}
    />
  );
}

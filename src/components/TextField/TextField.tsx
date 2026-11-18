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

/** The keyboard option types, shared with `SearchField`. */
export type {
  TextFieldAutoCapitalize,
  TextFieldKeyboardType,
} from '../../core/keyboard';

/** The label of the Return key on a single-line field. */
export type TextFieldReturnKeyType =
  | 'default'
  | 'done'
  | 'go'
  | 'next'
  | 'search'
  | 'send';

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
   * uncontrolled one, where typing causes no React render.
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
   * Read-only access to the native view, for this library's own tests and
   * benchmarks.
   *
   * @internal Not app API.
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
   * Instance id for native performance marks.
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
 * The sizing key of one field.
 *
 * - Single-line: `''`. The height is the font's line whatever the text, and the
 *   width is the box, so every single-line field shares one entry.
 * - Multi-line: `m|<sizingId>`, one entry per instance, because the height
 *   depends on the content and the width. The text is not in the key (it would
 *   add an entry per keystroke to a cache that is never evicted), and neither
 *   is the width: a width change already re-measures.
 */
function sizingVariantFor(multiline: boolean, sizingId: number): string {
  return multiline ? `m|${String(sizingId)}` : '';
}

/** The field is as wide as its box; `alignSelf` decides the cross-axis size. */
const FILL_WIDTH_BASE_STYLE = { alignSelf: 'stretch' } as const;

/** Sent when the app passes no `onSubmitEditing`: the callback prop is always sent. */
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

  // The native view, for `focus()`/`blur()`. `hybridRef` reaches JS on a later
  // turn than the commit that mounted the field, after the parent's effects have
  // run. A `focus()` or `blur()` asked for before then is held, the newest ask
  // winning, and run when the view arrives.
  const nativeView = useRef<NitroUiTextFieldHandle | null>(null);
  const pendingFocus = useRef<'focus' | 'blur' | null>(null);
  // Nitro can hand `hybridRef` over after the unmount, when the native view may
  // already be recycled into another field, so a late one is dropped.
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

  // A layout effect, so a parent's layout effect that focuses the field (parents
  // run after children) finds it mounted, also when StrictMode or `<Activity>`
  // re-runs effects. The native view is kept across that: Nitro hands over
  // `hybridRef` once per native view, not once per effect run.
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pendingFocus.current = null;
    };
  }, []);

  // One native callback for both edges, split here and always sent.
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

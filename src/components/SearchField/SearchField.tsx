import { useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react';
import { type ViewProps } from 'react-native';

import {
  AUTO_CAPITALIZE,
  KEYBOARD_TYPES,
  resolveKeyboardOption,
  type TextFieldAutoCapitalize,
  type TextFieldKeyboardType,
} from '../../core/keyboard';
import { useControlled } from '../../core/useControlled';
import { useSizingId } from '../../core/useSizingId';
import {
  useStableCallback,
  type NitroCallbackProp,
} from '../../core/useStableCallback';
import {
  NativeNitroUiSearchField,
  type NitroUiSearchFieldHandle,
} from './NativeNitroUiSearchField';

/** What a `ref` to a {@link SearchField} can do. */
export interface SearchFieldHandle {
  /**
   * Give the field focus, which brings up the keyboard. Returns at once; the
   * field's `onFocus` fires when focus lands. Does nothing while the field is not
   * `editable`.
   */
  focus(): void;
  /** Take focus away from the field, which dismisses its keyboard. */
  blur(): void;
}

/**
 * Props of {@link SearchField}.
 *
 * The names are TextField's, which are React Native `TextInput`'s. There is no
 * `multiline` and no `secureTextEntry`: a search field is one line, and its
 * Return key is always the Search key. `keyboardType`, `autoCapitalize` and
 * `autoCorrect` take the same values as TextField's.
 */
export interface SearchFieldProps extends Omit<
  ViewProps,
  'onFocus' | 'onBlur'
> {
  /**
   * The query. Pass it to control the field; leave it `undefined` for an
   * uncontrolled one, where typing causes no React render.
   */
  value?: string | undefined;
  /** Initial text of an uncontrolled field. Default: `''`. */
  defaultValue?: string | undefined;
  /**
   * Called with the new text after every edit the user makes, including the tap on
   * the clear button (which reports `''` and keeps focus). A controlled field that
   * does not take the new text keeps showing its `value`: the edit is reverted.
   */
  onChangeText?: ((text: string) => void) | undefined;
  /**
   * Text shown while the field is empty. Default: the platform's own localized
   * "Search".
   */
  placeholder?: string | undefined;
  /** The keyboard to show. Default: `'default'`. */
  keyboardType?: TextFieldKeyboardType | undefined;
  /** What the keyboard capitalises. Default: `'none'`. */
  autoCapitalize?: TextFieldAutoCapitalize | undefined;
  /** Whether the keyboard may autocorrect. Default: `true`. */
  autoCorrect?: boolean | undefined;
  /**
   * The longest query the field accepts, counted the way JavaScript counts
   * `string.length` (UTF-16 code units, as React Native does). An insertion that
   * would pass it is cut short, never through the middle of an emoji or another
   * composed character.
   */
  maxLength?: number | null | undefined;
  /**
   * `false`: the field shows its query but takes no focus and no input.
   * Default: `true`.
   */
  editable?: boolean | undefined;
  /**
   * Called when the keyboard's Search key is pressed, with the query - the string
   * itself, where React Native's `TextInput` passes an event. The field then loses
   * focus. An empty field never submits, on either platform.
   */
  onSubmitEditing?: ((text: string) => void) | undefined;
  /** Called when the field gains focus. */
  onFocus?: (() => void) | undefined;
  /** Called when the field loses focus. */
  onBlur?: (() => void) | undefined;
  /** `focus()` and `blur()`; see {@link SearchFieldHandle}. */
  ref?: Ref<SearchFieldHandle> | undefined;
  /**
   * Access to the native view, for tests and benchmarks.
   *
   * @internal
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
          maxLength: number;
          placeholder: string;
          accessibilityLabel: string;
          returnKeyType: string;
          keyboardType: string;
          autoCapitalize: string;
          autoCorrect: boolean;
          expanded: boolean;
          canClear: boolean;
          suggestions: string;
        };
        nuiTestClear(): void;
        nuiTestSubmit(): void;
        nuiTestLifetimeReport(): string;
      }) => void)
    | undefined;
  /**
   * Instance id for native performance marks, for benchmarks.
   *
   * @internal
   */
  nuiPerfId?: number | null | undefined;
}

/** The field takes its width from its box, so it is stretched by default. */
const FILL_WIDTH_BASE_STYLE = { alignSelf: 'stretch' } as const;

/**
 * Every prop that can change the control's size must appear in the sizing
 * key. A search field has none: it is always one line.
 */
const SIZING_KEY = '';

/** A module-level no-op, so `onSubmitEditing` is always sent. */
function onSubmitNotProvided(_text: string): void {
  // Intentionally empty: the caller asked for nothing.
}

/**
 * A search field: the system search text field on iOS, and Material 3's
 * search-bar input field on Android.
 *
 * ```tsx
 * const [query, setQuery] = useState('')
 * <SearchField
 *   value={query}
 *   onChangeText={setQuery}
 *   onSubmitEditing={run}
 *   placeholder="Search recipes"
 * />
 * ```
 *
 * It is one line, with a search glyph at the start and a clear button that
 * appears with the text. The Search key calls `onSubmitEditing` and dismisses
 * the keyboard; an empty field never submits.
 */
export function SearchField({
  value,
  defaultValue = '',
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize,
  autoCorrect = true,
  maxLength,
  editable = true,
  onSubmitEditing,
  onFocus,
  onBlur,
  ref,
  testID,
  accessibilityLabel,
  hybridRef,
  nuiPerfId = null,
  style,
  ...restProps
}: SearchFieldProps) {
  const controlled = useControlled(value, defaultValue, onChangeText);
  const sizingId = useSizingId();

  // Nitro hands over the native view after the parent's effects have run, so a
  // `focus()` or `blur()` asked for in a mount effect is held (the newest ask
  // wins) and run when the view arrives.
  const nativeView = useRef<NitroUiSearchFieldHandle | null>(null);
  const pendingFocus = useRef<'focus' | 'blur' | null>(null);
  const mounted = useRef(true);
  const hybridRefCallback = useStableCallback(
    (view: NitroUiSearchFieldHandle) => {
      if (!mounted.current) return;
      nativeView.current = view;
      const pending = pendingFocus.current;
      pendingFocus.current = null;
      if (pending === 'focus') view.focus();
      else if (pending === 'blur') view.blur();
      hybridRef?.(view);
    }
  ) as NitroCallbackProp<(view: NitroUiSearchFieldHandle) => void>;

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

  // A layout effect, so a parent's layout effect that focuses the field finds
  // it mounted - also when StrictMode runs the cleanups and the effects again.
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pendingFocus.current = null;
    };
  }, []);

  const focusChange = useStableCallback((focused: boolean) => {
    if (focused) onFocus?.();
    else onBlur?.();
  }) as NitroCallbackProp<(focused: boolean) => void>;
  const submitCallback = useStableCallback(
    onSubmitEditing ?? onSubmitNotProvided
  ) as NitroCallbackProp<(text: string) => void>;

  // A negative or non-finite limit is no limit, as it is for `TextInput`.
  const limit =
    maxLength == null || !Number.isFinite(maxLength) || maxLength < 0
      ? null
      : Math.floor(maxLength);

  return (
    <NativeNitroUiSearchField
      {...restProps}
      value={controlled.value}
      defaultValue={controlled.defaultValue}
      mostRecentEventCount={controlled.mostRecentEventCount}
      placeholder={placeholder ?? null}
      keyboardType={resolveKeyboardOption(
        keyboardType,
        KEYBOARD_TYPES,
        'default'
      )}
      autoCapitalize={resolveKeyboardOption(
        autoCapitalize,
        AUTO_CAPITALIZE,
        'none'
      )}
      autoCorrect={autoCorrect}
      maxLength={limit}
      editable={editable}
      testID={testID ?? null}
      accessibilityLabel={accessibilityLabel ?? null}
      nuiPerfId={nuiPerfId}
      onValueChange={controlled.onNativeChange}
      onFocusChange={focusChange}
      onSubmitEditing={submitCallback}
      nuiSizingKey={SIZING_KEY}
      nuiSizingId={sizingId}
      hybridRef={hybridRefCallback}
      style={[FILL_WIDTH_BASE_STYLE, style]}
    />
  );
}

import { useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react';
import { type ViewProps } from 'react-native';

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

/** What a `ref` to a {@link SearchField} can do - the two calls TextField's can too. */
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
 * `multiline`, no `secureTextEntry`, no `returnKeyType` and no keyboard prop: a
 * search field is one line, its Return key is the Search key, and Material 3's
 * search input field takes no keyboard options at all (D38 item 2). A field that
 * needs other keyboard options is a `TextField`.
 */
export interface SearchFieldProps extends Omit<
  ViewProps,
  'onFocus' | 'onBlur'
> {
  /**
   * The query. Pass it to control the field; leave it `undefined` for an
   * uncontrolled one (native owns the text then, and typing costs no React
   * render).
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
   * Access to the native Hybrid Object, for this repo's harness and benchmarks.
   *
   * @internal Not app API (DECISIONS D14). The shape is the handle
   * `NitroUiSearchFieldHandle` in `NativeNitroUiSearchField.ts`, written inline (as
   * `TextField.tsx` does) so api-extractor does not demand that an internal native
   * type be exported.
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
          expanded: boolean;
          canClear: boolean;
        };
        nuiTestClear(): void;
        nuiTestSubmit(): void;
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

/**
 * What a `fillWidth` control is laid out with before any `style`: the cross axis is
 * the one it wants filled (`Slider.tsx`'s `FILL_WIDTH_BASE_STYLE`).
 */
const FILL_WIDTH_BASE_STYLE = { alignSelf: 'stretch' } as const;

/**
 * The size configuration of a search field, as the sizing engine sees it
 * (`docs/architecture/sizing.md`, "Building `nuiSizingKey`").
 *
 * Always `""`: the default configuration, the one `prewarm(['NitroUiSearchField'])`
 * warms. Nothing an app sets changes the height - the field is always one line, with
 * no label and no multiline mode - so the text, the placeholder and `maxLength` are
 * all size-irrelevant and can share one entry. Text size and font scale reach the
 * height through the environment epoch, which is not part of a key by design.
 */
const SIZING_KEY = '';

/** The handler a field installs for a callback the app did not pass (D7b). */
function onSubmitNotProvided(_text: string): void {
  // Intentionally empty: the caller asked for nothing.
}

/**
 * A search field: UIKit's `UISearchTextField` on iOS, and Material 3's search-bar
 * input field - `DockedSearchBar` around `SearchBarDefaults.InputField`, held
 * collapsed - on Android.
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
 * It is one line, with a search glyph at the start and a clear button that appears
 * with the text. The keyboard's Search key calls `onSubmitEditing` and dismisses the
 * keyboard; an empty field never submits. The query is controlled through the same
 * event-count handshake as `TextField`, whose `maxLength`, IME guard and focus rules
 * it shares.
 */
export function SearchField({
  value,
  defaultValue = '',
  onChangeText,
  placeholder,
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

  // The native view, for `focus()`/`blur()`. Nitro calls `hybridRef` once per mount
  // with that mount's view, so the ref always holds the live one. The callback is
  // always sent: the `ref` needs it whether or not the app (well, this repo's
  // harness) passed a `hybridRef` of its own.
  //
  // The view arrives *after* the parent's effects have run, so a `focus()` asked for
  // in a mount effect is held here - the newest ask winning - and run as soon as the
  // view is handed over. `TextField.tsx` documents the same dance, including why
  // `mounted` has to gate a late `hybridRef`.
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

  // A layout effect, so a parent's layout effect that focuses the field finds it
  // mounted - also when StrictMode runs the cleanups and then the effects again
  // (`TextField.tsx` has the longer note).
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pendingFocus.current = null;
    };
  }, []);

  // One native callback for both focus edges, split here, and always sent (D7b).
  const focusChange = useStableCallback((focused: boolean) => {
    if (focused) onFocus?.();
    else onBlur?.();
  }) as NitroCallbackProp<(focused: boolean) => void>;
  // Always sent, so one identity per mount: a fresh closure per render is a fresh
  // native callback, which native would take as a re-registration mid-typing.
  const submitCallback = useStableCallback(
    onSubmitEditing ?? onSubmitNotProvided
  ) as NitroCallbackProp<(text: string) => void>;

  // `maxLength` as native receives it: a whole number of code units, or `null`. A
  // negative or non-finite limit is no limit, as it is for `TextInput`.
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

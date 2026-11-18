import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';
import type { NitroUiSize } from '../Switch/Switch.nitro';

/**
 * No prop is optional: Fabric sends `null` for a removed prop, which crashes
 * an optional one (nitro#1184). Callbacks are the exception: Nitro only
 * accepts a callback prop typed as a function, never `fn | null`.
 *
 * A `value` write that arrives during an IME composition is dropped, because
 * replacing the text under a composition destroys it. iOS hosts UIKit's
 * `UITextField` / `UITextView`, not SwiftUI's `TextField`: only UIKit can see
 * marked text.
 */
export interface NitroUiTextFieldProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  /** `null` while uncontrolled: native then keeps the text the user typed. */
  value: string | null;
  defaultValue: string | null;
  /** Native ignores a `value` sent with a count behind its own. */
  mostRecentEventCount: number;
  placeholder: string | null;
  /**
   * `false`: one line, Return submits. `true`: wraps and grows with its
   * content, Return inserts a newline.
   */
  multiline: boolean;
  /**
   * `'default' | 'number-pad' | 'decimal-pad' | 'numeric' | 'email-address' |
   * 'phone-pad' | 'url'`. Anything else is `'default'`.
   */
  keyboardType: string;
  /** `'none' | 'sentences' | 'words' | 'characters'`. */
  autoCapitalize: string;
  autoCorrect: boolean;
  /** Single-line only: ignored while `multiline`. */
  secureTextEntry: boolean;
  /**
   * In UTF-16 code units (`string.length`), or `null` for no limit. Never
   * splits a grapheme cluster, and is not enforced during an IME composition.
   */
  maxLength: number | null;
  /** `'default' | 'done' | 'go' | 'next' | 'search' | 'send'`; single-line. */
  returnKeyType: string;
  /** `false`: the field shows its text and takes no focus and no input. */
  editable: boolean;
  testID: string | null;
  accessibilityLabel: string | null;
  nuiPerfId: number | null;
  /**
   * Called for every user edit. On iOS, not for each step of an open
   * composition: only once its text is in the field.
   */
  onValueChange?: (value: string, eventCount: number) => void;
  /**
   * One callback for focus and blur, so its name cannot collide with the base
   * view's own `onFocus` / `onBlur` events.
   */
  onFocusChange?: (focused: boolean) => void;
  /** Return on a single-line field, with the text it holds. */
  onSubmitEditing?: (text: string) => void;
}

/** @internal The native field's state as applied, for tests. */
export interface NitroUiTextFieldTestState {
  text: string;
  focused: boolean;
  composing: boolean;
  nativeEvents: number;
  /** The `mostRecentEventCount` native has seen. */
  jsEvents: number;
  /** The last `value` write: `applied`, `stale`, `composing` or `none`. */
  lastWrite: string;
  editable: boolean;
  multiline: boolean;
  secure: boolean;
  keyboardType: string;
  returnKeyType: string;
  autoCapitalize: string;
  autoCorrect: boolean;
  /** `-1` for none. */
  maxLength: number;
  /** `''` for none. */
  placeholder: string;
  /** `''` for none. */
  accessibilityLabel: string;
  /**
   * The caret's UTF-16 offset in `text`; a selection reports its start. `-1` when there is
   * nothing to read.
   */
  caret: number;
  /**
   * What the keyboard in use is told about suggestions and autocorrections: `'offered'`,
   * `'refused'`, or `'unknown'` before anything has been read. iOS reads the field's own
   * autocorrection trait, so it answers whether or not a keyboard is up, and `'offered'` where
   * there is no control at all. Android reads the `EditorInfo` a focused field hands the IME,
   * once per keyboard configuration, and answers `'unknown'` while the field is not focused or
   * that read-back is still to come.
   */
  suggestions: string;
}

export interface NitroUiTextFieldMethods extends HybridViewMethods {
  /** Reads a cached size; safe to call from the JS thread. */
  measureContent(): NitroUiSize;
  /** Returns at once; `onFocusChange(true)` says when focus landed. */
  focus(): void;
  blur(): void;
  /** @internal Test-only. Reads a snapshot; never waits for the UI thread. */
  nuiTestState(): NitroUiTextFieldTestState;
  /**
   * @internal Test-only, iOS: opens an IME composition with `text` as its
   * marked text; `''` commits it. Needs a focused field. No-op on Android,
   * where no public API opens a composition outside an IME.
   */
  nuiTestSetMarkedText(text: string): void;
  /**
   * @internal Test-only, iOS: deletes the open composition, restoring the
   * text from before it began. No-op on Android.
   */
  nuiTestCancelMarkedText(): void;
  /**
   * @internal Test-only, iOS: pastes `text` at UTF-16 offset `at` through the
   * system paste action, which runs `shouldChangeCharactersIn` where
   * `insertText` does not. Needs a focused single-line field.
   */
  nuiTestPaste(text: string, at: number): void;
  /** @internal Test-only: `drops=<n> recycles=<m>` for this native object. */
  nuiTestLifetimeReport(): string;
}

/** @internal Exported for this repo's apps and tests; not semver surface. */
export type NitroUiTextField = HybridView<
  NitroUiTextFieldProps,
  NitroUiTextFieldMethods
>;

import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';
import type { NitroUiSize } from '../Switch/Switch.nitro';

/**
 * Native props of the `NitroUiTextField` Hybrid View.
 *
 * Same rules as every other component (DECISIONS D7/D7b): value props are
 * `T | null` or a plain value the wrapper always sends, and callbacks are
 * `fn?`, because Nitro only unwraps its `{ f: … }` wrapper for a prop whose
 * type *is* a function. `TextField.tsx` is the friendly API.
 *
 * iOS hosts a `UITextField` (a `UITextView` when `multiline`), not SwiftUI's
 * `TextField` (D34): only UIKit can see marked text, and the controlled-value
 * guard below needs to. Android hosts `BasicTextField(TextFieldState)`
 * (Q2's answer 1).
 *
 * The text is a controlled value on the event-count handshake
 * (`docs/architecture/core.md` §4) with one text-specific rule on top: a
 * `value` write that arrives while an IME composition is open (iOS
 * `markedTextRange`, Android `TextFieldState.composition`) is **dropped**, not
 * applied, because replacing the text under a composition destroys it. Like
 * every other refused write it is a drop rather than a queue: the next commit
 * decides again.
 */
export interface NitroUiTextFieldProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  /**
   * Controlled text, or `null` for an uncontrolled field - native then keeps
   * the text the user typed, and `defaultValue` seeded it.
   */
  value: string | null;
  /** Initial text of an uncontrolled field; ignored while `value` is set. */
  defaultValue: string | null;
  /**
   * The last event count JS has fully processed (core-architecture §4). Native
   * only applies a `value` write once it has seen at least this many of its
   * own events, which is what makes a rejected edit revert.
   */
  mostRecentEventCount: number;
  /** Text shown while the field is empty, or `null` for none. */
  placeholder: string | null;
  /**
   * `false`: one line, Return submits (`UITextField` / single-line
   * `BasicTextField`). `true`: wraps and grows with its content, Return inserts
   * a newline (`UITextView` / multi-line `BasicTextField`).
   */
  multiline: boolean;
  /**
   * `'default' | 'number-pad' | 'decimal-pad' | 'numeric' | 'email-address' |
   * 'phone-pad' | 'url'`, RN's spellings. Anything else is `'default'`.
   */
  keyboardType: string;
  /** `'none' | 'sentences' | 'words' | 'characters'`. */
  autoCapitalize: string;
  /** Whether the keyboard may autocorrect. */
  autoCorrect: boolean;
  /** Obscure the text. Single-line only: ignored while `multiline`. */
  secureTextEntry: boolean;
  /**
   * The longest text the field accepts, in UTF-16 code units (JavaScript's
   * `string.length`, as RN counts it), or `null` for no limit. Enforced
   * natively, never by cutting a grapheme cluster in half, and not while a
   * composition is open.
   */
  maxLength: number | null;
  /**
   * `'default' | 'done' | 'go' | 'next' | 'search' | 'send'`: the Return key's
   * label. Single-line only.
   */
  returnKeyType: string;
  /** `false`: the field shows its text and takes no focus and no input. */
  editable: boolean;
  /** Forwarded to the native view so tests and a11y tools can find it. */
  testID: string | null;
  /** Accessibility label of the field itself. */
  accessibilityLabel: string | null;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
  /**
   * Called on every edit the user makes, with the text native now displays
   * and native's event count (the wrapper echoes it as `mostRecentEventCount`).
   * Not called for a `value` write, and not for each step of an open
   * composition on iOS - only once its text is in the field.
   */
  onValueChange?: (value: string, eventCount: number) => void;
  /**
   * The field gained (`true`) or lost (`false`) focus. One callback for both
   * edges, so the native names stay clear of the base view's own `onFocus` /
   * `onBlur` events (`BaseViewEventEmitter`); the wrapper splits it.
   */
  onFocusChange?: (focused: boolean) => void;
  /** Return was pressed on a single-line field, with the text it holds. */
  onSubmitEditing?: (text: string) => void;
}

/**
 * What a TextField reports about itself, for this repo's harness.
 *
 * @internal Not app API (DECISIONS D14).
 */
export interface NitroUiTextFieldTestState {
  /** The text the native control holds right now. */
  text: string;
  /** Whether the control is first responder / holds Compose focus. */
  focused: boolean;
  /** Whether an IME composition (marked text) is open. */
  composing: boolean;
  /** Native's event count (`NitroUiControlledValue.nativeEvents`). */
  nativeEvents: number;
  /** The echo native has seen (`NitroUiControlledValue.jsEvents`). */
  jsEvents: number;
  /**
   * What happened to the last `value` write that differed from the text:
   * `applied`, `stale` (JS had not seen the newest edit), `composing`
   * (dropped under an open composition) or `none`.
   */
  lastWrite: string;
  /** Whether the control accepts input (`editable`, as applied). */
  editable: boolean;
  /** Whether the hosted control is the multi-line one. */
  multiline: boolean;
  /** Whether the text is drawn obscured. */
  secure: boolean;
  /** The keyboard type as applied (RN spelling). */
  keyboardType: string;
  /** The Return key as applied (RN spelling). */
  returnKeyType: string;
  /** The capitalisation as applied (RN spelling). */
  autoCapitalize: string;
  /** Autocorrect as applied. */
  autoCorrect: boolean;
  /** `maxLength` as applied, or `-1` for none. */
  maxLength: number;
  /** The placeholder the control shows, or `''`. */
  placeholder: string;
  /** The accessibility label on the control itself, or `''`. */
  accessibilityLabel: string;
}

export interface NitroUiTextFieldMethods extends HybridViewMethods {
  /**
   * The size of the hosted control, as measured on the UI thread during the
   * last layout/commit. Reads a cache, so it is safe from the JS thread.
   */
  measureContent(): NitroUiSize;
  /**
   * Give the field focus (and the keyboard). Hops to the UI thread and
   * returns at once; `onFocusChange(true)` says when it landed. Does nothing
   * on a field that is not `editable`.
   */
  focus(): void;
  /** Take focus away from the field. Hops to the UI thread, returns at once. */
  blur(): void;
  /**
   * TEMPORARY, test-only: the control's own state, snapshotted on the UI
   * thread after every change and read from here under a lock, so JS never
   * waits for the main thread.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestState(): NitroUiTextFieldTestState;
  /**
   * TEMPORARY, test-only (iOS): open an IME composition with `text` as its
   * marked text, through `UITextInput.setMarkedText(_:selectedRange:)` - the
   * call a Japanese or Chinese keyboard makes. `''` commits it
   * (`unmarkText()`). Needs a focused field. A no-op on Android, where no
   * public API opens a composition outside an IME.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestSetMarkedText(text: string): void;
  /**
   * TEMPORARY, test-only (task F6): `drops=<n> recycles=<m>` for this object,
   * as `NitroUiSwitchMethods.nuiTestLifetimeReport` describes.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestLifetimeReport(): string;
}

/**
 * The Hybrid View behind the `TextField` wrapper.
 *
 * @internal Not semver surface (DECISIONS D14); exported for this repo's
 * example, harness and bench apps.
 */
export type NitroUiTextField = HybridView<
  NitroUiTextFieldProps,
  NitroUiTextFieldMethods
>;

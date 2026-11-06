import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';
import type { NitroUiSize } from '../Switch/Switch.nitro';

/**
 * Native props of the `NitroUiSearchField` Hybrid View.
 *
 * Same rules as every other component (DECISIONS D7/D7b): value props are
 * `T | null`, callbacks are `fn?`, and `SearchField.tsx` sends every one of them
 * on every render.
 *
 * This is `NitroUiTextFieldProps` minus what a search field has no answer for
 * (D38 item 2): `multiline` (always one line), `secureTextEntry`,
 * `returnKeyType` (always Search) and the three keyboard props, which Material
 * 3's search input field does not take at all. What stays identical is the model
 * behind them: the two views share one text model, one handshake, one IME guard
 * and one `maxLength` implementation, so they cannot drift apart.
 */
export interface NitroUiSearchFieldProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  /**
   * Controlled text, or `null` for an uncontrolled field - native then keeps the
   * text the user typed, and `defaultValue` seeded it.
   */
  value: string | null;
  /** Initial text of an uncontrolled field; ignored while `value` is set. */
  defaultValue: string | null;
  /**
   * The last event count JS has fully processed (core-architecture §4). Native
   * only applies a `value` write once it has seen at least this many of its own
   * events, which is what makes a rejected edit revert.
   */
  mostRecentEventCount: number;
  /** Text shown while the field is empty, or `null` for the platform's own. */
  placeholder: string | null;
  /**
   * The longest text the field accepts, in UTF-16 code units (JavaScript's
   * `string.length`, as RN counts it), or `null` for no limit. Enforced natively,
   * never by cutting a grapheme cluster in half, and not while a composition is
   * open.
   */
  maxLength: number | null;
  /** `false`: the field shows its text and takes no focus and no input. */
  editable: boolean;
  /** Forwarded to the native view so tests and a11y tools can find it. */
  testID: string | null;
  /** Accessibility label of the field itself. */
  accessibilityLabel: string | null;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
  /**
   * Called on every edit the user makes - the clear button's tap included - with
   * the text native now displays and native's event count (the wrapper echoes it
   * as `mostRecentEventCount`). Not called for a `value` write.
   */
  onValueChange?: (value: string, eventCount: number) => void;
  /**
   * The field gained (`true`) or lost (`false`) focus. One callback for both
   * edges, so the native names stay clear of the base view's own `onFocus` /
   * `onBlur` events (`BaseViewEventEmitter`); the wrapper splits it.
   */
  onFocusChange?: (focused: boolean) => void;
  /**
   * The keyboard's Search key, with the text the field holds. An empty field
   * never submits, on either platform, and the field blurs after a submit.
   */
  onSubmitEditing?: (text: string) => void;
}

/**
 * What a SearchField reports about itself, for this repo's harness.
 *
 * @internal Not app API (DECISIONS D14).
 */
export interface NitroUiSearchFieldTestState {
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
   * `applied`, `stale` (JS had not seen the newest edit), `composing` (dropped
   * under an open composition) or `none`.
   */
  lastWrite: string;
  /** Whether the control accepts input (`editable`, as applied). */
  editable: boolean;
  /** `maxLength` as applied, or `-1` for none. */
  maxLength: number;
  /** The placeholder the control shows, or `''` when it shows none. */
  placeholder: string;
  /** The accessibility label on the control itself, or `''`. */
  accessibilityLabel: string;
  /** The Return key as applied - `search` on both platforms. */
  returnKeyType: string;
  /**
   * Whether the Android search bar is expanded. Always `false`: v1 holds it
   * collapsed (there is no results view to expand to), and a bar that expanded on
   * focus would grow the box mid-typing. iOS has no such state and says `false`.
   */
  expanded: boolean;
  /** Whether the control's own clear button would clear the field right now. */
  canClear: boolean;
}

export interface NitroUiSearchFieldMethods extends HybridViewMethods {
  /**
   * The size of the hosted control, as measured on the UI thread during the last
   * layout/commit. Reads a cache, so it is safe from the JS thread.
   */
  measureContent(): NitroUiSize;
  /**
   * Give the field focus (and the keyboard). Hops to the UI thread and returns at
   * once; `onFocusChange(true)` says when it landed. Does nothing on a field that
   * is not `editable`.
   */
  focus(): void;
  /** Take focus away from the field. Hops to the UI thread, returns at once. */
  blur(): void;
  /**
   * TEMPORARY, test-only: the control's own state, snapshotted on the UI thread
   * after every change and read from here under a lock, so JS never waits for the
   * main thread.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestState(): NitroUiSearchFieldTestState;
  /**
   * TEMPORARY, test-only: run the control's own clear button, so the harness
   * tests the path a tap takes (iOS's `textFieldShouldClear` and the
   * `editingChanged` it causes; Android's trailing `IconButton`) instead of a
   * write that bypasses both. No-op when `canClear` is `false`.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestClear(): void;
  /**
   * TEMPORARY, test-only: press the keyboard's Search key. Runs the same guard the
   * key itself has - an empty field submits on neither platform - and reports
   * nothing when that guard refuses.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestSubmit(): void;
  /**
   * TEMPORARY, test-only (task F6): `drops=<n> recycles=<m>` for this object, as
   * `NitroUiSwitchMethods.nuiTestLifetimeReport` describes.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestLifetimeReport(): string;
}

/**
 * The Hybrid View behind the `SearchField` wrapper.
 *
 * @internal Not semver surface (DECISIONS D14); exported for this repo's example,
 * harness and bench apps.
 */
export type NitroUiSearchField = HybridView<
  NitroUiSearchFieldProps,
  NitroUiSearchFieldMethods
>;

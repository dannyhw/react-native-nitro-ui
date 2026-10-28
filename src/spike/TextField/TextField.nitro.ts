/**
 * T18 — TextField **spike** spec. Not a component.
 *
 * Everything in `src/spike/` exists to answer the go/no-go lines of
 * `docs/tasks/Q2-textfield-research.md` §7 on real devices, and it is evidence
 * rather than shipped API: no `component.json`, no export from `src/index.ts`,
 * no docs page, no changeset. It lives inside the library's own tree — rather
 * than in a side module — because the questions it asks only have answers on
 * the real hosting path: `NitroSwiftUIHost` / `NitroComposeHost`, the
 * event-count handshake, the sizing engine, and the same Nitro view lifecycle a
 * shipped control has. A spike that hosted its control any other way would
 * measure a path nobody ships.
 *
 * Two shapes, one view, chosen per instance by `iosImplementation`: P1 is an
 * A/B of SwiftUI `TextField` against a hosted `UITextField` *inside the same
 * host*, because Q2 §3's deciding question is not only which control is better
 * but whether the two hosting shapes can coexist. Android has one shape
 * (`BasicTextField(TextFieldState)`, per the orchestrator's answer 1) and uses
 * that prop only to prove it is inert there.
 *
 * The prop rules are the shipped ones (DECISIONS D7/D7b + nitro#1184): every
 * prop is `T | null`, none optional, and the JS wrapper always sends all of
 * them. The one exception is the callbacks, which follow the same
 * "optional function prop" rule `Switch.nitro.ts` documents.
 */
import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';
import type { NitroUiSize } from '../../components/Switch/Switch.nitro';

/**
 * Native props of the `NitroUiSpikeTextField` Hybrid View.
 *
 * `docs/tasks/Q2-textfield-research.md` §1's v1 list, minus what the spike does
 * not measure: no `onSelectionChange` prop (selection is read back out of
 * `nuiTestState()`, which is what the composition vectors need anyway), no
 * `onEndEditing` / `onKeyPress` / `onContentSizeChange`, no input accessory, no
 * password rules.
 */
export interface NitroUiSpikeTextFieldProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  /**
   * Which iOS shape this instance hosts: `'swiftui'` or `'textfield'`.
   *
   * A string rather than a boolean because a third shape is plausible before
   * 0.5 (a `UITextView` arm for auto-grow), and a boolean would then have to be
   * replaced rather than extended. Android ignores it — there is one shape
   * there — and the spike asserts it is inert by running both values on
   * Android and requiring the same answer.
   */
  iosImplementation: string;
  /**
   * Controlled text, or `null` for uncontrolled.
   *
   * Q2 §2 is the whole reason this prop is interesting: a write is a *drop*
   * rather than a queue, and for text "the write equals what native already
   * displays" is the normal case rather than the edge case. Which is why
   * applying a programmatic write is a method (`nuiTestApplyWrite`) and never a
   * prop write reaching into UI-thread state.
   */
  value: string | null;
  /** Initial text of an uncontrolled field. */
  defaultValue: string | null;
  /** The echo (core-architecture §4). */
  mostRecentEventCount: number;
  /** Placeholder text, or `null`. */
  placeholder: string | null;
  /** `editable == false` on both platforms. */
  disabled: boolean;
  /**
   * Natively enforced maximum length, or `null` for none.
   *
   * Enforced by the control rather than truncated in JS (Q2 §1), and skipped
   * while a composition is open so truncation can never destroy an in-progress
   * IME session (Q2 §2.2).
   */
  maxLength: number | null;
  /**
   * Multiline: SwiftUI `axis: .vertical` (iOS 16+, ignored below), Compose
   * without the single-line flag.
   */
  multiline: boolean;
  /** Cap on visible lines; `null` or `0` for unbounded. The auto-grow cap. */
  maxLines: number | null;
  /**
   * Keyboard and IME behaviour as a bitfield (`src/spike/TextField/keyboard.ts`).
   *
   * One number rather than six props for Q2 §3's own reason: on the SwiftUI
   * shape these are *initialiser arguments*, not modifiers we can apply later,
   * and one argument is far easier to thread into a controller that is created
   * exactly once. Whether a shipped G8 API should keep the bitfield or take
   * strings (RN's `keyboardType="email-address"`) is a G8 decision; both are
   * priced in the report.
   */
  keyboardHints: number;
  /** Take focus on mount, synchronously where the platform can. */
  autoFocus: boolean;
  /** Accessibility label of the control itself. */
  accessibilityLabel: string | null;
  /** RN's `testID`, which Android stores as a view tag. */
  testID: string | null;
  /** Benchmark instance id for perf marks; `null` disables marks. */
  nuiPerfId: number | null;
  /**
   * Called with the text native now displays, plus native's event count.
   *
   * Fires on a committed edit only — not on every keystroke of a marked-text
   * composition — which is what makes the keystroke→commit number in P5 mean
   * "what JS sees", rather than "what the IME buffer holds".
   */
  onValueChange?: (value: string, eventCount: number) => void;
  /**
   * The field took focus (first responder / `onFocusChanged`).
   *
   * Two naming facts the spike established on a device, both of which a shipped TextField inherits:
   *
   * 1. **It cannot be `null` on the native side.** Nitrogen reads an optional callback with
   *    `ReactProp<std::optional<std::function<void()>>>::fromRawValue`, which has no null case — sending
   *    `null` throws `NitroUiSpikeTextField.onFocus: Value is null, expected an Object` during the first
   *    commit and the view never mounts. `Button.tsx:107`'s `onPressNotProvided` is the shipped answer and
   *    `SpikeTextField.tsx` copies it. (This is what the "prop that disappears" rule D7b already implies;
   *    it is just fatal for a callback in a way it is not for a number.)
   * 2. **`onFocus` / `onBlur` are also Fabric base-view event names**
   *    (`react/renderer/components/view/BaseViewEventEmitter.h:116`), so whether a Nitro callback prop may
   *    carry either name at all is a question about RN's props/events split rather than about Nitro. The
   *    spike runs the shipped RN names deliberately, on the real hosting path, so the answer is evidence
   *    rather than an assumption: if these fields mount, G8 can use RN's names; if a field only mounts once
   *    they are renamed, G8 has to pick names the base view does not own.
   */
  onFocus?: () => void;
  /** The field lost focus. Same two facts as `onFocus`. */
  onBlur?: () => void;
  /**
   * Return pressed while the field is focused, and `keyboardHints` says the
   * return key submits (Q2 §1: "who eats Return" is the whole content of
   * `submitBehavior` + RN's `blurOnSubmit` resolution).
   */
  onSubmitEditing?: () => void;
}

/**
 * Methods of the spike field.
 *
 * Threading is the shipped rule, not a spike exception (core-architecture §5):
 * a method callable from JS reads a **cached snapshot** that the UI thread
 * writes, and never touches SwiftUI/Compose/model state directly. `focus()` and
 * `blur()` are the only two that hop, and they hop asynchronously.
 */
export interface NitroUiSpikeTextFieldMethods extends HybridViewMethods {
  /** The fitting size, from the host's cache (never touches the UI thread). */
  measureContent(): NitroUiSize;
  /** Focus the field. Hops to the UI thread; returns immediately. */
  focus(): void;
  /** Resign first responder / clear focus. Hops; returns immediately. */
  blur(): void;
  /**
   * Everything the spike reads that an app cannot see, as one `key=value` line
   * of space-separated fields, rendered on the UI thread and cached for JS:
   *
   * ```
   * displayed=<text> nativeEvents=<n> jsEvents=<n> unreported=<0|1>
   * composing=<0|1> editable=<0|1> focused=<0|1> selection=<start>-<end>
   * lines=<measured line count> impl=<swiftui|textfield|compose>
   * equal=<0|1> cps=<codepoints of the JS-side string>
   * lastWrite=<none|applied|stale|composing|same>
   * ```
   *
   * What each field is for:
   * - `unreported` must stay `0` for the whole life of a field (Q2 §2.4) — a
   *   field that sets it makes a fast typist's writes permanently stale;
   * - `composing` is the IME flag both platforms read (iOS
   *   `markedTextRange`, Android `TextFieldState.composition`), and every
   *   composition vector asserts it goes to `1`;
   * - `equal`/`cps` together are the text-equality vector: native compares the
   *   two strings it holds with its own `==`, JS compares codepoints, and Q2
   *   §2.2's marked-text guard only works if the two agree;
   * - `lastWrite` is why applying a write is a *method*: the outcome of the last
   *   `nuiTestApplyWrite` is the measurement, and a prop write has no outcome.
   *
   * @internal Not app API.
   */
  nuiTestState(): string;
  /**
   * Apply a programmatic write the way a shipped field must: on the UI thread,
   * through the handshake, never while composing. The outcome lands in
   * `nuiTestState()`'s `lastWrite`, because the method itself cannot wait for
   * the main thread without a JS→main sync hop (core-architecture §5).
   *
   * @internal Not app API.
   */
  nuiTestApplyWrite(text: string): void;
}

/**
 * The Hybrid View behind the spike field, named for its autolinking key
 * (`nitro.json`) the same way `NitroUiSwitch` is named for its own — nitrogen
 * derives the Fabric component name from this type's name, so a name that does
 * not match the key fails codegen rather than producing a view nobody can
 * register.
 *
 * @internal Spike only: not exported from `src/index.ts`, and `package.json`'s `files` list has no
 * exclusion for this directory, so this spec would ride into the packed tarball if the branch merged.
 */
export type NitroUiSpikeTextField = HybridView<
  NitroUiSpikeTextFieldProps,
  NitroUiSpikeTextFieldMethods
>;

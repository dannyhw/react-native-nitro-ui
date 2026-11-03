# TextField

A single- or multi-line text field: a UIKit `UITextField` (a `UITextView` when
`multiline`) on iOS, Compose `BasicTextField(TextFieldState)` on Android. Both are
hosted by the core runtime (`docs/architecture/core.md`), so the editing, caret,
selection, autocorrect and IME behaviour are the platform's own.

```tsx
import { TextField } from 'react-native-nitro-ui';

const [name, setName] = useState('');
<TextField placeholder="Name" value={name} onChangeText={setName} />;
```

The prop names are React Native `TextInput`'s, for the subset a field needs
first. Like `TextInput` it is **undecorated**: the text, the caret and the
placeholder in the platform's body font, with no border, background or label. A
border or a background is the container you put it in.

Why UIKit on iOS rather than SwiftUI's `TextField` (DECISIONS D34): only UIKit
exposes `markedTextRange`, and the controlled value needs to know when an IME
composition is open (below). SwiftUI's field cannot tell anybody, so it cannot
implement that rule at all (T19).

## API

| Prop                 | Type                                   | Default       | Maps to |
| -------------------- | -------------------------------------- | ------------- | ------- |
| `value`              | `string \| undefined`                  | unset         | Controlled text. Omit it for an uncontrolled field. |
| `defaultValue`       | `string \| undefined`                  | `''`          | Initial text of an uncontrolled field. |
| `onChangeText`       | `(text: string) => void`               | —             | After every edit the user makes, with the text native shows. |
| `placeholder`        | `string \| undefined`                  | none          | `UITextField.placeholder` / a placeholder label; a decorator `Text` in `onSurfaceVariant`. |
| `multiline`          | `boolean \| undefined`                 | `false`       | `UITextView` instead of `UITextField` / `TextFieldLineLimits.MultiLine`. Grows with its text. |
| `keyboardType`       | `TextFieldKeyboardType \| undefined`   | `'default'`   | `UIKeyboardType` / Compose `KeyboardType` (table below). |
| `autoCapitalize`     | `'none' \| 'sentences' \| 'words' \| 'characters'` | `'sentences'` | `autocapitalizationType` / `KeyboardCapitalization`. |
| `autoCorrect`        | `boolean \| undefined`                 | `true`        | `autocorrectionType` and `spellCheckingType` / `autoCorrectEnabled`. |
| `secureTextEntry`    | `boolean \| undefined`                 | `false`       | `isSecureTextEntry` / `BasicSecureTextField` (reveals the last typed character). Single-line only. |
| `maxLength`          | `number \| null \| undefined`          | none          | Enforced natively, in UTF-16 code units (see below). |
| `returnKeyType`      | `'default' \| 'done' \| 'go' \| 'next' \| 'search' \| 'send'` | `'default'` | `returnKeyType` / `ImeAction`. Single-line only. |
| `onSubmitEditing`    | `(text: string) => void`               | —             | Return on a single-line field, with its text as a string (not RN's `{ nativeEvent: { text } }` event); the field then loses focus. |
| `editable`           | `boolean \| undefined`                 | `true`        | `false`: the text shows, but the field takes no focus and no input. |
| `onFocus` / `onBlur` | `() => void`                           | —             | First responder / Compose focus, gained and lost. |
| `ref`                | `Ref<TextFieldHandle>`                 | —             | `focus()` and `blur()`. |
| `style`              | `ViewStyle`                            | —             | The box (see Sizing). |
| `testID`             | `string \| undefined`                  | —             | iOS `accessibilityIdentifier` (RN's own), Android `View.tag`. |
| `accessibilityLabel` | `string \| undefined`                  | —             | The field's own name. |
| `hybridRef`          | `(view: handle) => void`               | —             | **Internal.** The native view, for this repo's harness and benchmarks. |
| `nuiPerfId`          | `number \| null \| undefined`          | `null`        | **Internal.** Instance id for perf marks. |

`TextField` is a `View`, so the other `ViewProps` apply to its box. A spelling it
does not know (`keyboardType="visible-password"`) is the default, and a negative
or non-finite `maxLength` is no limit, as it is for `TextInput`.

| `keyboardType`  | iOS                       | Android                |
| --------------- | ------------------------- | ---------------------- |
| `default`       | `.default`                | `KeyboardType.Text`    |
| `number-pad`    | `.numberPad`              | `KeyboardType.Number`  |
| `decimal-pad`   | `.decimalPad`             | `KeyboardType.Decimal` |
| `numeric`       | `.numbersAndPunctuation`  | `KeyboardType.Decimal` (Compose has no signed number keyboard) |
| `email-address` | `.emailAddress`           | `KeyboardType.Email`   |
| `phone-pad`     | `.phonePad`               | `KeyboardType.Phone`   |
| `url`           | `.URL`                    | `KeyboardType.Uri`     |

A secure field gets Android's password keyboard (`KeyboardType.Password`), or its
number-password keyboard (`KeyboardType.NumberPassword`) with `keyboardType="number-pad"`.
On iOS a change to `keyboardType`, `returnKeyType`, `autoCapitalize`, `autoCorrect`
or `secureTextEntry` while the field is focused reloads the keyboard that is up.

### `ref`: `focus()` and `blur()`

```tsx
const field = useRef<TextFieldHandle>(null);
<TextField ref={field} />;
field.current?.focus();
```

Both are native methods on the field's Hybrid View that hop to the UI thread and
return at once (`docs/architecture/core.md` §5), so focus lands a moment later and
`onFocus` says when. A `focus()` or `blur()` asked for before the native view has
reached JS - from a parent's mount effect, `useEffect(() => ref.current?.focus(), [])`,
which is how to focus a field on mount in v1 - is held by the wrapper (the newest ask
wins) and run when the view arrives; one that reaches a field not yet on screen is
applied when it gets a window (iOS) or a composition (Android). A field that is not
`editable` ignores `focus()`. This is the library's first imperative
API: `hybridRef` stays internal (D14), and `ref` is the public face of the two
methods.

## Platform mapping

| Concept          | iOS                                                      | Android                                                       |
| ---------------- | -------------------------------------------------------- | ------------------------------------------------------------- |
| Control          | `UITextField` (single-line), `UITextView` (multi-line)   | `BasicTextField(TextFieldState)`, `BasicSecureTextField` when secure |
| Host             | a `UIViewRepresentable` in `NitroSwiftUIHost`             | `NitroComposeHost`                                            |
| Font             | `UIFont.preferredFont(forTextStyle: .body)`, Dynamic Type | Material 3 `bodyLarge` in `onSurface`, cursor in `primary`    |
| Text storage     | the control; `NitroUiControlledValue<NitroUiText>` beside it | a model-owned `TextFieldState`; `NitroUiControlledValue<String>` beside it |
| User edit        | `editingChanged` / `textViewDidChange`                   | `snapshotFlow` over the state's text, plus a catch-up in `afterUpdate()` |
| JS write         | `text = …` in `afterUpdate()`                             | `TextFieldState.edit {}` in `afterUpdate()`                   |
| Composition flag | `markedTextRange != nil`                                 | `TextFieldState.composition != null`                          |
| `maxLength`      | `shouldChangeCharactersIn` / `shouldChangeTextIn`        | an `InputTransformation`                                      |
| Focus            | `editingDidBegin`/`End`, `becomeFirstResponder()`        | `onFocusChanged`, `FocusRequester`, `FocusManager.clearFocus()` |
| Return (single-line) | `textFieldShouldReturn` → submit, resign             | `onKeyboardAction` → submit, clear focus                      |

## The text, and the handshake

The text is a controlled value on the event-count handshake
(`docs/architecture/core.md` §4), exactly as a Switch's value is: native shows an
edit at once and reports `(text, eventCount)`; the wrapper echoes the count; a
`value` that differs from what native shows is applied only once native has seen
that many of its own events. So:

- **a refused edit reverts.** `value="frozen"` with an `onChangeText` that does not
  set it: each keystroke is reported, and the echo puts `frozen` back (measured
  with real keystrokes on both platforms, `real-input`).
- **a write in flight cannot overwrite a keystroke.** On Android, where a user edit
  reaches the model on the next snapshot apply rather than synchronously,
  `afterUpdate()` counts any edit the state holds before it judges a write, so a
  write that raced a keystroke is stale, not applied over it.
- **a JS write is not an edit.** It is never reported back to `onChangeText`.
- **typing in an uncontrolled field costs no React render**, and in a controlled
  one exactly one commit per keystroke (the app's `setState` and the echo land
  together): `TextField.perf-test.tsx` pins mount + 3 keystrokes + 2 unrelated
  parent renders at 6 commits.

Text is compared the way JavaScript compares it, UTF-16 code unit by code unit, on
both platforms. Swift's own `String ==` is canonical equivalence (a precomposed
`é` equals `e` + U+0301), so iOS compares through `NitroUiText`, whose `==` is the
UTF-16 one Kotlin and JS already use.

### Composition (marked text)

While an IME composition is open - the underlined text a Japanese, Chinese or
Korean keyboard is still building, and on Android also the word Gboard holds while
autocorrect is on - the text belongs to the IME. Replacing it destroys the
composition, so **a `value` write that arrives while one is open is held back**,
not applied (`lastWrite=composing` in the harness's report), and **decided again
when the composition ends**, whatever text it ends with: committed, the commit is an
edit and its echo decides; deleted, the text is what native already counted, so the
end itself re-runs the write.

What is reported during a composition differs per platform:

- **Android** counts and reports every step, as React Native does: a composing
  region that grows `h`, `he`, `hel` is three `onChangeText` calls, and `maxLength`
  cuts composing text too. A refused edit inside a composition is put back when the
  composition ends.
- **iOS** reports a composition once its text is in the field: marked text belongs
  to the IME until it commits (or is deleted), and `maxLength` is applied then.

Measured on iOS (`TextField.harness.tsx`, through `setMarkedText`/`unmarkText`, the
calls an IME makes): a write held back, and a held write landing after the
composition is deleted. On Android a composition opened from outside the IME does not
survive on the test emulator's keyboard, so the Android rules are held by
`TextFieldModelTest` on the JVM. Typed with the emulator's real Gboard, autocorrect
on, a word was reported key by key (`H`, `He`, … `Hello`); that Gboard drew no
composing region, so it did not exercise a composition.

### `maxLength`

Counted in UTF-16 code units - JavaScript's `string.length`, as React Native counts
it - so `text.length <= maxLength` holds for every string `onChangeText` reports.
When an insertion would pass the limit, the part that fits is kept, cut at a
grapheme boundary: an emoji (two units) at the last free unit is refused whole
rather than split into a lone surrogate, and a ZWJ family is never cut inside.
Text a JS write puts in the field is not truncated; a deletion from it is always
allowed.

On iOS the cut is made in `shouldChangeCharactersIn`, the delegate call every
keyboard and paste edit makes, with a backstop after the edit for text that reached
the field without it (a committed composition, `insertText`). Only the first keeps
the text after a mid-text insertion: pasting `xyz` at the middle of `ab··cd` under a
limit of 8 gives `ab xy cd`, where cutting the end would give `ab xyz c`
(`scripts/native-tests/text-limit.test.swift`, and the harness's paste case).

## Sizing

`fillWidth` (`docs/architecture/sizing.md` §5): the width is the parent's box, the
height is the field's own.

- **Single-line**: one line of the body font - **22 pt** on iOS 15 through 27,
  **24 dp** on Android (`bodyLarge`'s line height) at the default text size - and
  the same whatever the text, placeholder, keyboard or width. Every single-line
  field is therefore one sizing configuration, the default one, and
  `prewarm(['NitroUiTextField'])` makes a cold first mount exact. Those are also
  the declared fallbacks, and the conformance suite holds the measured height to
  them.
- **Multi-line**: the height of the text at the box's width, re-measured on every
  edit that can change it (`invalidateContentSize()` on iOS; Compose's own layout
  pass on Android) - auto-grow, one correction per growth step. Each multi-line
  field is its own sizing configuration (`m|<instance>`): one cache entry holds one
  height, and the engine corrects every instance under a key to the size one of
  them reports, so two fields of different lengths at the same width must not
  share one. The text cannot be the key - it would add an entry per keystroke to a
  cache that is never evicted (Q2 §6) - and the width is not in it: a width change
  is a bounds change, which re-measures by itself, while re-keying a laid-out field
  on its width would draw the one-line fallback again before the correction.
  `maxHeight` in `style` caps the growth; the field then scrolls inside its box.
- Under a parent that gives it no width at all (a row with no `flex`), a field is
  laid out at the declared **200** wide, like every `fillWidth` control.

## Inside a `<Host>`

Not yet: a `TextField` is in `UNHOSTABLE_CONTROLS`, so a `<Host>` refuses it with
an error naming it. A field inside a shared composition means IME sessions and
focus owned by the Host, and no round has measured that.

## Recycling and cleanup

A recycled field comes back with none of its previous owner: text, focus, the
handshake's counts, `secureTextEntry`, `maxLength`, keyboard and Return key all
reset (`TextField.harness.tsx`, and the X4 conformance probes, which leave typed
text behind on purpose and read it from the next owner). On iOS the UIKit control
outlives the mount with the hosting controller, so the reset clears its text and
resigns first responder, as React Native's own `TextInput` does on recycle; on
Android the composition is disposed and the next mount gets a fresh
`TextFieldState`, so no text, selection or undo history survives.

## Accessibility

The name is on the field the person types into. iOS: the `UITextField` /
`UITextView` itself carries `accessibilityLabel`, and VoiceOver reads it as a text
field (`real-input` a11y sweep: one element, at the control's box, trait `text
field`). Android: `BasicTextField` publishes its editable node (`EditText`, with
the text and the actions) and the label's node as its child, with the same box -
the shape Material 3's own `TextField` gives its label - and the sweep's rule reads
that as one named control. With no `accessibilityLabel`, the placeholder is what a
screen reader announces.

## Behaviour notes

- **Return** on a single-line field calls `onSubmitEditing(text)` - the text itself,
  a string, where React Native's `TextInput` passes an event - and then gives up
  focus - React Native's default `submitBehavior` for one line. On a multi-line
  field Return inserts a newline, and `returnKeyType` and `onSubmitEditing` do not
  apply.
- **Back** on Android hides the keyboard and leaves the field focused, which is the
  platform's behaviour; iOS has no Back.
- **`editable={false}`** while focused takes focus away.
- **`secureTextEntry` with `multiline`** is ignored, as in React Native.

## Limits

- No `autoFocus`, `selection` / `onSelectionChange`, `onKeyPress`,
  `onContentSizeChange`, `submitBehavior`, `textAlign`, text colour or font props
  yet (Q2 §1's "wait" list, and the follow-ups in the G13 report).
- No `TextInput.State` integration: `Keyboard.dismiss()` and RN's focused-input
  tracking do not see a `TextField` (Q2 §8).
- iOS keystroke latency is not measured: XCUITest's keystrokes do not reach the app
  as `UIEvent`s, so no in-app clock sees them arrive (T19, D34). Android's is in the
  G13 report.

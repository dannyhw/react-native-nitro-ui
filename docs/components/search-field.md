# SearchField

A search field: **one line**, the keyboard's Search key, a leading search glyph,
and a clear button that appears with the query. UIKit's `UISearchTextField` —
the field `UISearchBar` itself vends — on iOS, Material 3's search input field
(`SearchBarDefaults.InputField` in a `DockedSearchBar` held collapsed) on
Android. Both are hosted by the core runtime (`docs/architecture/core.md`), so
typing, caret, autocorrect and IME behaviour are the platform's own.

```tsx
import { SearchField } from 'react-native-nitro-ui';

const [query, setQuery] = useState('');
<SearchField placeholder="Search" value={query} onChangeText={setQuery} />;
```

The prop names are React Native `TextInput`'s, the same subset `TextField`
takes. `TextField` is the general field: it has `multiline`, `secureTextEntry`,
`keyboardType` and `returnKeyType`. `SearchField` has none of them, because a
search field has no answer for them — one line, no password, the default
keyboard, and a Return key that is always Search (D38 item 2, the same reason
Material 3's own input field takes no keyboard options). A field that needs
those is a `TextField`.

Why each platform's control rather than a styled `TextField`: a search field is
recognized by its shape, and the two shapes are not one shape — Android's is a
56 dp bar with a glyph in front and the framework's own word as its prompt, iOS's
is UIKit's 28 pt bordered field. A `TextField` with a glyph drawn over it is a
`TextField` with a glyph drawn over it. iOS could not use SwiftUI either: it has
no standalone search field, only the `searchable` modifier, which needs a
navigation container to attach to. `UISearchBar` itself was rejected because it
is the *delegate* of its own text field and reports through
`UISearchBarDelegate`, so the controlled-value half below would have been
rewritten rather than reused — and its `searchTextField` is this same class.

It is its own Hybrid View rather than `variant="search"` on `TextField` because
a declared fallback is keyed by component (`docs/architecture/sizing.md` §5): as
a variant, every cold SearchField would be laid out at TextField's 22 pt / 24 dp
line for one frame and then correct to a 28 pt / 56 dp bar — a jump at the top
of a search screen.

## API

| Prop                 | Type                       | Default | Maps to |
| -------------------- | -------------------------- | ------- | ------- |
| `value`              | `string \| undefined`      | unset   | Controlled query. Omit it for an uncontrolled field. |
| `defaultValue`       | `string \| undefined`      | `''`    | Initial query of an uncontrolled field. |
| `onChangeText`       | `(text: string) => void`   | —       | After every edit the user makes — the clear button's tap included — with the text native shows. |
| `placeholder`        | `string \| undefined`      | none on iOS, the framework's hint on Android | `UITextField.placeholder` / the input field's placeholder slot. |
| `maxLength`          | `number \| null \| undefined` | none | Enforced natively, in UTF-16 code units, as `TextField`'s. |
| `editable`           | `boolean \| undefined`     | `true`  | `false`: the query shows, but the field takes no focus, no input and no clear. |
| `onSubmitEditing`    | `(text: string) => void`   | —       | The Search key, with the query as a string; the field then loses focus. Never called for an empty query. |
| `onFocus` / `onBlur` | `() => void`               | —       | First responder / Compose focus, gained and lost. |
| `ref`                | `Ref<SearchFieldHandle>`   | —       | `focus()` and `blur()`. |
| `style`              | `ViewStyle`                | —       | The box (see Sizing). |
| `testID`             | `string \| undefined`      | —       | iOS `accessibilityIdentifier` (RN's own), Android `View.tag`. |
| `accessibilityLabel` | `string \| undefined`      | —       | The field's own name. |
| `hybridRef`          | `(view: handle) => void`   | —       | **Internal.** The native view, for this repo's harness and benchmarks. |
| `nuiPerfId`          | `number \| null \| undefined` | `null` | **Internal.** Instance id for perf marks. |

`SearchField` is a `View`, so the other `ViewProps` apply to its box. A negative
or non-finite `maxLength` is no limit, as it is for `TextInput`.

### `ref`: `focus()` and `blur()`

```tsx
const search = useRef<SearchFieldHandle>(null);
<SearchField ref={search} />;
search.current?.focus();
```

The same two calls `TextField` has, with the same rules: they hop to the UI
thread and return at once, `onFocus` says when focus landed, an ask made from a
parent's mount effect — before the native view reached JS — is held by the
wrapper and run when it arrives, and a field that is not `editable` ignores
`focus()`. Making a field non-editable while it is focused takes focus away.

## Platform mapping

| Concept              | iOS                                                            | Android                                                          |
| -------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------- |
| Control              | `UISearchTextField`                                             | `SearchBarDefaults.InputField(TextFieldState)` in a `DockedSearchBar` |
| Host                 | a `UIViewRepresentable` in `NitroSwiftUIHost`                   | `NitroComposeHost`                                               |
| Search glyph         | the control's own leading image                                 | `SearchBarDefaults.InputField`'s `leadingIcon`                   |
| Clear button         | `clearButtonMode = .whileEditing` (UIKit's own)                 | a trailing `IconButton` that appears with the query               |
| User edit            | `editingChanged`                                                | `snapshotFlow` over the state's text, plus a catch-up in `afterUpdate()` |
| JS write             | `text = …` in `afterUpdate()`                                   | `TextFieldState.edit {}` in `afterUpdate()`                      |
| Composition flag     | `markedTextRange != nil`                                        | `TextFieldState.composition != null`                             |
| `maxLength`          | `shouldChangeCharactersIn`                                      | an `InputTransformation`                                          |
| Focus                | `editingDidBegin`/`End`, `becomeFirstResponder()`               | `onFocusChanged`, `FocusRequester`, `FocusManager.clearFocus()`  |
| Search key           | `textFieldShouldReturn`, with `enablesReturnKeyAutomatically` on | the input field's `onSearch`                                      |
| Empty query          | UIKit disables the Return key                                   | `onSearch` returns without reporting                              |
| Prompt nobody asked for | nothing — UIKit sets no `placeholder` on the bare field       | the framework's `search_hint` string                             |
| Announcement         | the `.searchField` accessibility trait                          | the editable node under the field's name                         |

## The text, and the handshake

The query is a controlled value on the event-count handshake
(`docs/architecture/core.md` §4), on the *same model and the same code* as
`TextField`: `TextFieldModel`, the write/apply/revert bodies and the
`maxLength` limit are shared, not copied (they live in
`ios/components/TextField/NitroUiTextEditing.swift` and
`HybridNitroUiTextField.kt`). So the four things true of `TextField`'s text are
true here in the same way: a refused edit reverts, a write in flight cannot
overwrite a keystroke, a JS write is not reported back as an edit, and typing in
an uncontrolled field costs no React render. `maxLength` counts UTF-16 code
units and never cuts an emoji in half — see
[text-field.md](text-field.md#the-text-and-the-handshake).

What the two components fix differently is the keyboard: `SearchField` sets the
Return key to `search`, `keyboardType` to `default`, `autoCapitalize` to `none`
and `autoCorrect` on, and no prop moves them.

## The clear button

It appears with the query and is one edit:

- iOS uses UIKit's own clear button (`clearButtonMode = .whileEditing`). UIKit
  asks the delegate first — `textFieldShouldClear` refuses it on a field that is
  not `editable` — then empties the field and sends `editingChanged`, so
  `onChangeText('')` arrives through the same path as any other edit.
- Android has no built-in one, so the trailing slot holds an `IconButton` with
  Material's close glyph. It calls `TextFieldState.clearText()`, which the
  `snapshotFlow` above reports as the edit it is.

Either way focus stays: clearing a query is not leaving the field, and a clear
that also dismissed the keyboard would be a second thing to do. The harness runs
the control's own handler (`nuiTestClear`) rather than writing the text, and the
real-input suite taps the button from outside the app.

## The Search key

The keyboard's key is Search on both platforms and does three things: reports
`onSubmitEditing(query)`, then gives up focus — React Native's default
`submitBehavior` for a single line. **An empty query never submits**, which is a
rule stated on both sides rather than a coincidence of two defaults: iOS sets
`enablesReturnKeyAutomatically`, so UIKit disables the key while the field is
empty; Android's `onSearch` returns without reporting. `nuiTestSubmit()` runs the
same guard, so the rule is assertable rather than invisible inside UIKit, and
`real-input` presses the real key on both platforms.

The Android bar stays **collapsed** — v1 has no results view to expand into, and
a bar that grew on focus would move the box under the keyboard. `expanded` in the
test state is the composition's own answer, and the harness asserts the box does
not change height while focused.

## The placeholder

`placeholder` is the app's word, and what the field says without one differs by
platform — the first iOS run measured the difference rather than assuming it:

- **iOS draws no prompt.** `UISearchTextField` has no `placeholder` of its own —
  UIKit writes "Search" *inside a search bar*, as its own drawing, and never sets
  the property on the bare field. The control reads its own `placeholder` once at
  init and uses that as the default, so the day UIKit does set one, an unset
  `placeholder` starts saying the platform's word with no change here. Until then,
  pass `placeholder` if you want a word on iOS.
- **Android says the framework's word.** Material 3's input field leaves the prompt
  to the app, so the component reads the framework's `search_hint` string resource.
  That resource is private to the framework — `android.R.string` names only
  `search_go` of the family, checked against the android-35 stub — so it is resolved
  by name once per process, and an answer of 0 falls back to the English the
  platform itself uses.

Either way the library writes no search string of its own: an empty field is not
English in a German app. `SearchField.harness.tsx` asserts the two halves
separately — Android's word is non-empty, iOS's is empty — because "the platform's
own" is a claim you can only make one platform at a time.

## Sizing

`fillWidth` (`docs/architecture/sizing.md` §5): the width is the parent's box,
the height is the field's own — and the height is one number, because a search
field does not grow with its query, its prompt or its width:

- **28 pt** on iOS 27 (the height UIKit's `UISearchTextField` measures at the body
  font, and the height UIKit gives the field inside its own search bar) and
  **56 dp** on Android (`SearchBarDefaults.InputFieldHeight`) at the default text
  size. Both are measured on the devices the gates run on, not read out of a header.
- Those are also the declared fallbacks (200 × 28 pt, 200 × 56 dp — 200 being
  the width a `fillWidth` control draws under a parent that gives it none), so a
  cold first mount is the right height rather than a frame at something else.
  `prewarm(['NitroUiSearchField'])` makes it exact, and because the sizing key is
  a constant, one cache entry is every field.
- The two numbers are deliberately *not* `TextField`'s 22 pt / 24 dp, and
  `SearchField.harness.tsx` asserts the measured height is not TextField's: that
  assertion is what stops the component quietly becoming a `TextField` with a
  glyph on it. The conformance suite holds the measured box to the declaration,
  on a fallback poisoned to a size that belongs to nothing.

## Inside a `<Host>`

Not yet: a `SearchField` is in `UNHOSTABLE_CONTROLS`, so a `<Host>` refuses it
with an error naming it — the same answer `TextField` and `Chip` get. A field
inside a shared composition means IME sessions and focus owned by the Host, and
no round has measured that.

## Recycling and cleanup

A recycled field comes back with none of its previous owner: the query, focus,
the handshake's counts, `maxLength`, `editable`, the accessibility label and the
placeholder — which returns to whatever the platform shows by default (nothing on
iOS, the framework's hint on Android), not the last row's
(`SearchField.harness.tsx`'s recycle case, and the X4 conformance probes, which
leave typed text behind on purpose and read it back from the next owner). On iOS
the UIKit control outlives the mount with the hosting controller, so the reset
clears its text, resigns first responder and re-applies the search presets; on
Android the composition is disposed and the next mount gets a fresh
`TextFieldState`.

## Accessibility

The name is on the field a person types into, and the announcement is a search
field on both platforms:

- **iOS**: the `UITextField` carries `accessibilityLabel`, and
  `accessibilityTraits` gains `.searchField` — UIKit gives that trait to the
  field *inside* a `UISearchBar`, and standing alone it does not get it.
  `real-input`'s a11y sweep reads the element by that announcement
  (`iosTrait: 'search field'`), and its keystroke check goes through
  `app.searchFields`, so a field that lost the trait fails the check that types
  into it rather than only the a11y line.
- **Android**: the label is on the search input's own node, whose editable child
  carries the text — the shape `uiautomator dump` reports for the platform's own
  fields, and the shape `scripts/real-input/a11y.mjs` reads as one named control.
  The clear button is a separate named node, and `real-input` asserts that it has
  a name at all, because an unnamed button is one TalkBack cannot describe.

What automation does **not** cover: nobody has read this field with a screen
reader switched on — the sweep reads the tree a screen reader walks, not what it
says — and on Android the a11y rule is decided from a committed dump of this
screen, so what a device in another layout (a larger touch target, a different
font scale) publishes is unasserted. The clear button's *behaviour* is asserted
from outside the app; its announcement is asserted only as "non-empty".

## Behaviour notes

- **`editable={false}`**: the query shows, a tap does nothing, `focus()` does
  nothing, and the clear button is refused at the delegate rather than merely
  hidden — on Android the button is not even offered.
- **`Back`** on Android hides the keyboard and leaves the field focused, which is
  the platform's behaviour; iOS has no Back.
- **`onSubmitEditing`** takes the text as a string, not RN's
  `{ nativeEvent: { text } }` event, like `TextField`'s.
- Focus changes reach JS as one native callback (`onFocusChange(true|false)`) and
  the wrapper splits it into `onFocus` / `onBlur`, so the native names stay clear
  of the base view's own `onFocus` / `onBlur` events.

## Limits

- No results view, no suggestions, no Cancel button, no scope bar: this is the
  *field*, and the screen around it is the app's. The Android bar is held
  collapsed and every request to expand it is dropped.
- No `multiline`, `secureTextEntry`, `keyboardType`, `returnKeyType`,
  `autoFocus`, `selection`, `submitBehavior` or font/colour props.
- No `TextInput.State` integration: `Keyboard.dismiss()` and RN's focused-input
  tracking do not see a `SearchField` (same gap as `TextField`).
- No benchmark arm yet, and no `<Host>` support.

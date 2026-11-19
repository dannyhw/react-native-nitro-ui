# SearchField

A search field: one line, the keyboard's Search key, a leading search glyph, and a clear button
that appears with the query (on iOS only while the field is editing, which is UIKit's rule for a
search field). It is UIKit's `UISearchTextField`, the field `UISearchBar` itself vends, on iOS,
and Material 3's search input field (`SearchBarDefaults.InputField`, in a plain `Surface` shaped
like the bar's collapsed input field) on Android. Typing, caret, autocorrect and IME behaviour
are the platform's own.

```tsx
import { SearchField } from 'react-native-nitro-ui';

const [query, setQuery] = useState('');
<SearchField placeholder="Search" value={query} onChangeText={setQuery} />;
```

The prop names are React Native `TextInput`'s, the same subset `TextField` takes, including the
three keyboard props `keyboardType`, `autoCapitalize` and `autoCorrect`. `SearchField` has no
`multiline` and no `secureTextEntry`, and its Return key is always Search. A field that needs
those is a `TextField`.

The two platforms' search fields have different shapes: Android's is a 56 dp bar with a leading
glyph and the framework's own prompt, iOS's is UIKit's 28 pt bordered field. SwiftUI has no
standalone search field, only the `searchable` modifier, which needs a navigation container, so
iOS hosts the UIKit control.

`SearchField` is its own Hybrid View, not a variant of `TextField`, because a declared fallback
is per component: its cold first frame is its own 28 pt / 56 dp height, not TextField's 22 pt /
24 dp line.

## API

| Prop                 | Type                                   | Default                                      | Maps to                                                                                                                |
| -------------------- | -------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `value`              | `string \| undefined`                  | unset                                        | Controlled query. Omit it for an uncontrolled field.                                                                   |
| `defaultValue`       | `string \| undefined`                  | `''`                                         | Initial query of an uncontrolled field.                                                                                |
| `onChangeText`       | `(text: string) => void`               | —                                            | After every edit the user makes, the clear button's tap included, with the text native shows.                          |
| `placeholder`        | `string \| undefined`                  | none on iOS, the framework's hint on Android | `UITextField.placeholder` / the input field's placeholder slot.                                                        |
| `maxLength`          | `number \| null \| undefined`          | none                                         | Enforced natively, in UTF-16 code units, as `TextField`'s.                                                             |
| `keyboardType`       | `TextFieldKeyboardType \| undefined`   | `'default'`                                  | The keyboard the field opens. `TextField`'s values and mapping: see [the table there](text-field.md#api).              |
| `autoCapitalize`     | `TextFieldAutoCapitalize \| undefined` | `'none'`                                     | What the keyboard capitalises. A query is not a sentence, so the default is `'none'`, not `TextField`'s `'sentences'`. |
| `autoCorrect`        | `boolean \| undefined`                 | `true`                                       | Whether the keyboard may correct the query. `false` also asks Android's keyboard to show no suggestions (see The keyboard). |
| `editable`           | `boolean \| undefined`                 | `true`                                       | `false`: the query shows, but the field takes no focus, no input and no clear.                                         |
| `onSubmitEditing`    | `(text: string) => void`               | —                                            | The Search key, with the query as a string; the field then loses focus. Never called for an empty query.               |
| `onFocus` / `onBlur` | `() => void`                           | —                                            | First responder / Compose focus, gained and lost.                                                                      |
| `ref`                | `Ref<SearchFieldHandle>`               | —                                            | `focus()` and `blur()`.                                                                                                |
| `style`              | `ViewStyle`                            | —                                            | The box (see Sizing).                                                                                                  |
| `testID`             | `string \| undefined`                  | —                                            | iOS `accessibilityIdentifier` (RN's own), Android `View.tag`.                                                          |
| `accessibilityLabel` | `string \| undefined`                  | —                                            | The field's own name.                                                                                                  |
| `hybridRef`          | `(view: handle) => void`               | —                                            | Internal. The native view, for this repo's harness and benchmarks.                                                     |
| `nuiPerfId`          | `number \| null \| undefined`          | `null`                                       | Internal. Instance id for perf marks.                                                                                  |

`SearchField` is a `View`, so the other `ViewProps` apply to its box. A negative or non-finite
`maxLength` is no limit, as it is for `TextInput`.

### `ref`: `focus()` and `blur()`

```tsx
const search = useRef<SearchFieldHandle>(null);
<SearchField ref={search} />;
search.current?.focus();
```

The same two calls `TextField` has, with the same rules: they hop to the UI thread and return at
once, and `onFocus` says when focus landed. A call made from a parent's mount effect, before the
native view reached JS, is held by the wrapper and run when the view arrives. A field that is not
`editable` ignores `focus()`, and making a focused field non-editable takes focus away.

## Platform mapping

| Concept                 | iOS                                                                                                                        | Android                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Control                 | `UISearchTextField`                                                                                                        | `SearchBarDefaults.InputField(TextFieldState, SearchBarState)` in a `Surface`                  |
| Host                    | a `UIViewRepresentable` in `NitroSwiftUIHost`                                                                              | `NitroComposeHost`                                                                             |
| Search glyph            | the control's own leading image                                                                                            | `SearchBarDefaults.InputField`'s `leadingIcon`                                                 |
| Clear button            | `clearButtonMode = .whileEditing` (UIKit's own)                                                                            | a trailing `IconButton` that appears with the query                                            |
| User edit               | `editingChanged`                                                                                                           | `snapshotFlow` over the state's text, plus a catch-up in `afterUpdate()`                       |
| JS write                | `text = …` in `afterUpdate()`                                                                                              | `TextFieldState.edit {}` in `afterUpdate()`                                                    |
| Composition flag        | `markedTextRange != nil`                                                                                                   | `TextFieldState.composition != null`                                                           |
| `maxLength`             | `shouldChangeCharactersIn`                                                                                                 | an `InputTransformation`                                                                       |
| Focus                   | `editingDidBegin`/`End`, `becomeFirstResponder()`                                                                          | `onFocusChanged`, `FocusRequester`, `FocusManager.clearFocus()`                                |
| Keyboard                | `UIKeyboardType` / `UITextAutocapitalizationType` / `.autocorrectionType` + `.spellCheckingType`, as `TextField` sets them | `KeyboardOptions(capitalization, autoCorrectEnabled, keyboardType)` handed to `InputField`     |
| Search key              | `textFieldShouldReturn`, with `enablesReturnKeyAutomatically` on                                                           | the input field's `onSearch`, and `ImeAction.Search` Material merges over the keyboard options |
| Empty query             | UIKit disables the Return key                                                                                              | `onSearch` returns without reporting                                                           |
| Prompt when none is set | nothing: UIKit sets no `placeholder` on the bare field                                                                     | the framework's `search_hint` string, in the app's language                                      |
| Announcement            | the `.searchField` accessibility trait                                                                                     | the editable node under the field's name                                                       |

## The text, and the handshake

The query is a controlled value on the event count ([DESIGN.md](../DESIGN.md), section 3.5), on
the same model and code as `TextField`: `TextFieldModel`, the write/apply/revert bodies and the
`maxLength` limit are shared (`ios/components/TextField/NitroUiTextEditing.swift` and
`HybridNitroUiTextField.kt`). So what holds for `TextField`'s text holds here: a refused edit
reverts, a write in flight cannot overwrite a keystroke, a JS write is not reported back as an
edit, and typing in an uncontrolled field costs no React render. `maxLength` counts UTF-16 code
units and never cuts an emoji in half; see
[text-field.md](text-field.md#the-text-and-the-handshake).

The Return key is always `search` and has no prop.

## The clear button

Clearing is one edit. When the button is visible differs by platform:

- iOS uses UIKit's own clear button (`clearButtonMode = .whileEditing`), so it shows while the
  field is editing. A field with a query that has not been tapped into shows no button. UIKit
  asks the delegate first (`textFieldShouldClear` refuses on a field that is not `editable`),
  then empties the field and sends `editingChanged`, so `onChangeText('')` arrives like any other
  edit.
- Android has no built-in one, so the trailing slot holds an `IconButton` with Material's close
  glyph. It calls `TextFieldState.clearText()`, which is reported as an edit, and it shows as
  soon as the query is non-empty, focused or not.

Focus stays on the field after a clear.

## The Search key

The keyboard's key is Search on both platforms. It reports `onSubmitEditing(query)` and then the
field gives up focus, React Native's default `submitBehavior` for a single line. An empty query
never submits: iOS sets `enablesReturnKeyAutomatically`, so UIKit disables the key while the
field is empty, and Android's `onSearch` returns without reporting. A hardware Enter on Android
reaches the same `onSearch`.

The Android bar stays collapsed: there is no results view to expand into, and its box does not
change height while focused.

## The keyboard

`keyboardType`, `autoCapitalize` and `autoCorrect` are `TextField`'s props with `TextField`'s
mapping ([the table in text-field.md](text-field.md#api)). The submit key is Search whatever
keyboard is open; on Android `ImeAction.Search` is merged over the options handed to the field.

| Prop             | Default     | Why that default                                                                                                   |
| ---------------- | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| `keyboardType`   | `'default'` | The standard text keyboard.                                                                                        |
| `autoCapitalize` | `'none'`    | A query is not a sentence. `TextField`'s default is `'sentences'`; this is the only keyboard default that differs. |
| `autoCorrect`    | `true`      | The system's own answer on iOS (`.default`, and `.no` when refused), and Android's autocorrect flags.              |

A change while the field is focused reaches the keyboard that is already up, on both platforms.
On iOS a `UITextInputTraits` setter does not affect a visible keyboard, so the apply step calls
`reloadInputViews()` when a trait changed. On Android, Compose restarts the field's input session
when its keyboard options change while it has focus, so the IME gets the new keyboard without the
field losing focus.

`autoCorrect={false}` refuses correction in the way each platform's keyboard understands: iOS gets
`autocorrectionType = .no` and `spellCheckingType = .no`, and Android is sent
`TYPE_TEXT_FLAG_NO_SUGGESTIONS` along with no autocorrect flag, which asks the keyboard not to
draw a suggestion strip over the word at the caret - leaving the autocorrect flag out does not.
Most keyboards honour it; a keyboard may still ignore it. The flag belongs to Android's text input class,
so a number or phone keyboard is sent what it is sent with the default.

UIKit's `.numberPad` and `.decimalPad` have no Return key, so on iOS a field with
`keyboardType="number-pad"` or `"decimal-pad"` cannot be submitted from the keyboard. Android's
number keyboard keeps its action key, which is still Search. `"phone-pad"`, `"email-address"` and
`"url"` keep the key on both platforms.

## The placeholder

`placeholder` is the app's word. Without one the platforms differ:

- iOS draws no prompt. `UISearchTextField` has no `placeholder` of its own: UIKit writes "Search"
  only inside a search bar. The control reads its own `placeholder` once at init and uses that as
  the default. Pass `placeholder` if you want a prompt on iOS.
- Android shows the framework's word. Material 3's input field leaves the prompt to the app, so
  the component reads the framework's `search_hint` string resource. That resource is private to
  the framework, so it is resolved by name, and if it is not found the field falls back to the
  English the platform uses.

Both Android strings - the prompt and the clear button's screen-reader label, the framework's
`searchview_description_clear` - are read from the configuration the field draws in, so an app
shown in another language than the device's, including a per-app language on Android 13 and later,
gets its own words. After a language change they follow once the activity restarts, which is
Android's default.

The library ships no search string of its own.

## Sizing

The policy is `fillWidth`: the width is the parent's box, the height is the field's own. The
height does not change with the query, the prompt or the width:

- 28 pt on iOS 27 (what `UISearchTextField` measures at the body font) and 56 dp on Android
  (`SearchBarDefaults.InputFieldHeight`) at the default text size.
- Those are also the declared fallbacks (200 × 28 pt, 200 × 56 dp; 200 is the width a `fillWidth`
  control draws under a parent that gives it none), so a cold first mount is the right height.
  The sizing key is a constant, so one cache entry covers every field, and
  `prewarm(['NitroUiSearchField'])` seeds it.

## Inside a `<Host>`

Not supported: a `SearchField` is in `UNHOSTABLE_CONTROLS`, so a `<Host>` refuses it with an
error naming it, as it does `TextField` and `Chip`. A field inside a shared composition would
mean IME sessions and focus owned by the Host.

## Recycling and cleanup

A recycled field keeps nothing of its previous owner: the query, focus, the event counts,
`maxLength`, `editable`, the accessibility label and the placeholder are reset, and the
placeholder returns to the platform default (nothing on iOS, the framework's hint on Android).
On iOS the UIKit control outlives the mount with the hosting controller, so the reset clears its
text, resigns first responder and re-applies the search presets. On Android the composition is
disposed and the next mount gets a fresh `TextFieldState`.

## Accessibility

The name is on the field a person types into, and the announcement is a search field on both
platforms:

- iOS: the `UITextField` carries `accessibilityLabel`, and `accessibilityTraits` gains
  `.searchField`. UIKit gives that trait to the field inside a `UISearchBar`; standing alone it
  does not get it.
- Android: the label is on the search input's own node, whose editable child carries the text.
  The clear button is a separate named node.

Not covered by automation: what a screen reader speaks for the field, and what the Android tree
publishes at another font scale or touch-target size.

## Behaviour notes

- `editable={false}`: the query shows, a tap does nothing, `focus()` does nothing, and the clear
  button is refused at the delegate on iOS and not offered on Android.
- Back on Android hides the keyboard and leaves the field focused.
- `onSubmitEditing` takes the text as a string, not RN's `{ nativeEvent: { text } }` event, like
  `TextField`'s.
- Focus changes reach JS as one native callback (`onFocusChange(true|false)`), and the wrapper
  splits it into `onFocus` / `onBlur`.

## Limits

- No results view, no suggestions, no Cancel button, no scope bar: this is the field, and the
  screen around it is the app's. The Android bar is held collapsed.
- No `multiline`, `secureTextEntry`, `returnKeyType`, `autoFocus`, `selection`, `submitBehavior`
  or font/colour props.
- No `TextInput.State` integration: `Keyboard.dismiss()` and RN's focused-input tracking do not
  see a `SearchField` (as with `TextField`).
- No benchmark, and no `<Host>` support.

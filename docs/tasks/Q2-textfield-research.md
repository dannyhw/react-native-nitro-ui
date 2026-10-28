# Q2 — TextField pre-spike research (read-only, 2026-10-27)

Answers the T18 brief (`docs/tasks/Q-research-2026-10-27.md` §Q2) in advance, so the single spike round
only builds and measures. Nothing was run: no device, no build. Repo claims carry `file:line`; other repos
carry a version read on this machine — `react-native` 0.88.0 and `@expo/ui` 58.0.22 from the main
checkout's `node_modules` (min iOS 15.1, `node_modules/react-native/scripts/cocoapods/helpers.rb:83`);
`compose-bom:2026.06.01` (`android/build.gradle:116`) → foundation/ui **1.11.4**, material3 **1.4.0**
(that BOM's `.pom` in `~/.gradle/caches`, APIs confirmed by `javap` on the cached AARs);
`ronickg/react-native-nitro-input` @`0df4162` (v0.4.1), https://github.com/ronickg/react-native-nitro-input.
`RCTTextInputComponentView.mm:898`-style paths are under `node_modules/react-native/`; `@expo/ui/…` and
`@react-native-harness/…` under that package's root.

## 1. v1 scope

`TextInputProps` declares 47 props
(`node_modules/react-native/types_DEPRECATED/Libraries/Components/TextInput/TextInput.d.ts`).

| v1 — the spike must cover | Why |
| --- | --- |
| `value`/`defaultValue`/`onChangeText` + `mostRecentEventCount` | the whole handshake (§2) |
| `placeholder`, `editable`, `maxLength` | `maxLength` is natively enforced, not JS-truncated |
| `keyboardType`, `returnKeyType`, `submitBehavior` (+ RN's `blurOnSubmit` resolution) | keyboard type; who eats Return |
| `autoCapitalize`, `autoCorrect`, `secureTextEntry` | IME behaviour; secure is also a text-comparison hazard (§2) |
| `multiline` + auto-grow | sizing (§6) |
| `onFocus`/`onBlur`/`onSubmitEditing`, `focus()`/`blur()`, `autoFocus` | registry and first responder |
| `selection` in + `onSelectionChange` out | the only other state a field has; also what makes a write safe |
| `testID`/`accessibilityLabel` on the real element; fillWidth + key/id; recycle reset; fallback; `prewarm` | X4's a11y rule + `docs/architecture/core.md:460-537` |

Wait: `onKeyPress` (needs an `InputConnectionWrapper`, as RN does —
`ReactAndroid/.../ReactEditTextInputConnectionWrapper.kt:19-40`), `onEndEditing`, `onContentSizeChange`,
`inputAccessoryViewID`, `dataDetectorTypes`, `clearButtonMode`, `inlineImage*`, `lineBreakStrategyIOS`,
`passwordRules`, `showSoftInputOnFocus`, `contextMenuHidden`, RTL, worklet callbacks
(`docs/research/core-architecture.md:648-655`). Also out v1: `TextInput.State` interop (§5, §8).

## 2. Controlled text under the handshake

Today: native owns `displayed`, emits `(value, count)`; JS echoes `count` before the user's handler
(`src/core/useControlled.ts:104-110`); native applies a write only when
`unreported == nil && jsEvents >= nativeEvents && js != displayed`
(`ios/core/NitroUiModel.swift:77-84`, `android/.../core/NitroUiModel.kt:80-86`, `docs/architecture/core.md:180-206`).
Four text-specific breaks:

1. **A write is a drop, not a queue — and for text that is the normal case.** A keystroke's echo commit
   carries the string native already has, so `js != displayed` is false and `reconcile()` returns false.
   Proving a write *applied* therefore needs a `setValue`-shaped **method** with its own main hop, never a
   prop write off the UI thread (`docs/architecture/core.md:226`).
2. **IME composition.** Replacing text while marked/composing destroys the input session; RN compares
   plain strings exactly when `markedTextRange` is set (`RCTTextInputComponentView.mm:898`). So while a
   composition is open: apply no `value` write, and don't truncate to `maxLength`. nitro-input skips a
   prop write equal to the field's text while marked (`ios/NitroInputView.swift:1232`) and defers
   `maxLength`/transform to commit (`:2706`, `:1830`). `NitroUiControlledValue` has no "composing" slot —
   add it per-component, not in core, unless a second component needs it.
3. **Every keystroke is an emit.** In controlled mode `useControlled` sets state per event, so a
   controlled field costs a React render per character. Intended
   (`docs/architecture/core.md:594-616`), but a field emits at typing rate, not tap rate. Measure it; if
   the commit is the cost, fix it by suppressing *intermediate* counts, not by changing the handshake.
4. **`unreported` is the wrong guard here.** It exists for values sampled faster than frames
   (`docs/architecture/core.md:194`); a field's edits are discrete. Setting it per keystroke would make a
   fast typist's writes permanently stale. Prove a field does *not* set it.

RN gates a JS write on exact count equality in the command (`RCTTextInputComponentView.mm:595`) and `>=`
in state (`:363`; `ReactEditText.kt:736`). Its host component receives `text` — RN's own local state — not
`value`; a `value` that diverges from the last native text is pushed with a `setTextAndSelection` command
from a layout effect (`Libraries/Components/TextInput/TextInput.js:201-224,614`). Spike decision: keep our
prop write (D7: always send every prop) or copy the command? **Recommend the prop write**, because a
command breaks "props are the only channel".

## 3. iOS: SwiftUI `TextField`/`SecureField` vs a hosted `UITextField`

Unsaid constraint: `TextField` is *stateful UI*, not a passive control — it holds first responder and
marked text in the SwiftUI subtree, and our host creates the controller once and never assigns a new
`rootView` (`ios/core/NitroSwiftUIHost.swift:45-46`; perf contract `docs/architecture/core.md:525-537`).

- `@FocusState` works, and `safeAreaRegions = []` / `.ignoresSafeArea()`
  (`ios/core/NitroSwiftUIHost.swift:154`, `ios/core/NitroUIContent.swift:44`) already suppress SwiftUI's
  keyboard avoidance — RN keeps owning the keyboard. Good.
- Keyboard type / return key / autocaps / autocorrect are **view modifiers** in Expo's shape
  (`@expo/ui/ios/TextFieldView.swift` carries none; see the `keyboardType` modifier,
  `@expo/ui/src/swift-ui/modifiers/index.ts:1602`), which our API cannot express. They must be
  initialiser arguments; verify all six compile on iOS 15.1.
- Selection in/out is iOS 18+ (`@expo/ui/ios/TextFieldView.swift:86`, `:198-246`, incl. clamping stale
  selections because SwiftUI throws — expo issues 47434/48274). On min 15.1 that leaves the
  `UITextField` path, or an 18-gated feature.
- Multiline: `axis: .vertical` from iOS 16, `lineLimit` as the cap (`@expo/ui/ios/TextFieldView.swift:151-157`).

`UITextField` inside a `UIViewRepresentable` in the same SwiftUI body is the escape hatch, and it buys
`markedTextRange`, `selection`, keyboard types, `inputView` — and the deciding one: first responder that
`userEvent.type` can drive (`@react-native-harness/ui/ios/HarnessUI.mm:511`, `insertText:` on the
`UITextInput` first responder).

## 4. Android: `TextFieldState` vs `TextFieldValue`, focus, insets

- foundation 1.11.4 has both APIs; the `TextFieldValue` overloads are deprecated
  `"Maintained for binary compatibility"` (HIDDEN level, `javap -v` on `BasicTextFieldKt.class`) — Expo is
  on them (`@expo/ui/android/.../textfield/TextFieldShared.kt:253`). `TextFieldState` exposes
  `text`/`selection`/`composition` + `edit {}` + `rememberTextFieldState`, and `javap -p` shows no public
  IME-session hook (only an internal `NotifyImeListener`), so focus comes from `onFocusChanged`. The
  public `composition: TextRange` is the IME flag we need → **use `TextFieldState`**.
- `TextFieldState` *owns* the text, so a controlled write is `state.edit { replace(0, length, text) }`
  behind a per-instance `NitroUiControlledValue<String>` — beside it, not instead of it.
- **Typing oracle problem.** Compose drives the IME through `TextInputServiceAndroid` on a plain `View`
  (`BaseInputConnection`); `unzip -l` finds **no `EditText` in ui-android 1.11.4/1.12.1**, and
  `AndroidComposeView` implements `onCheckIsTextEditor`/`onCreateInputConnection` itself. So
  `userEvent.type` on Android only logs `No EditText is focused`
  (`@react-native-harness/ui/android/.../UIHelperImpl.kt:373,380`). **The spike must settle an Android
  typing oracle first**: `adb shell input text` in the real-input runner (it already uses `input tap` /
  `input keyevent`, `scripts/real-input/android.mjs:2328,2340`), or an `nuiTestInsertText` seam like
  Slider's `nuiTestDrag` — which would *not* prove IME paths.
- Insets: RN owns the keyboard; the example is `adjustResize`
  (`example/android/app/src/main/AndroidManifest.xml:19`). No `imePadding()` — it would fight Yoga.
- `inputType` changes disturb selection and `isSingleLine`; RN saves/restores both (`ReactEditText.kt:562-598`).

## 5. Prior art

| Source | Copy | Avoid |
| --- | --- | --- |
| `react-native-nitro-input` @`0df4162` | classic inputs underneath and why — pre-edit hook, caret geometry, field-owned first responder (`TEXTINPUT-PARITY.md:338-353`); marked-text guards (`ios/NitroInputView.swift:1232,2706`); synchronous autofocus from `didMoveToWindow` (`:1104`), which removed a 580 ms keyboard churn; echo state only when controlled (`src/NitroInput.tsx:1209,1600`) | the overlay/reflow engine; its `TextInput.State` patch + `NitroInputCommands.mm` (`:201,1119-1132`); two-phase sizing, rejected for us (`docs/research/core-architecture.md:111-127`) |
| `@expo/ui` 58.0.22 | little: its per-keystroke `userMutatingState` (`ios/TextFieldView.swift:131,176-185`) is our event count, weaker — JS writes are invisible to it | the host-registration machinery (`src/keyboard/index.tsx:82-138`); ours is one Fabric node per control. Its Android `TextFieldValue` dance + slot views (`BasicTextField.kt:39-56`) |
| RN core `TextInput` | composition-safe text comparison (`RCTTextInputComponentView.mm:873-905`); `maxLength` truncation that never splits a composed character (`:469-485`); recycle resigns first responder (`:386-399`) | its style-override sizing (`adopt` after async geometry) |

Cost, their bench/devices (`TEXTINPUT-PARITY.md:68-69,115,125-127`): 20 fields mount in 9.7 ms RN /
12.6 ms NitroInput / **91.4 ms `@expo/ui`**; focus→`onFocus` 53.7 ms RN vs 4.5 ms theirs vs 107.4 ms Expo.
Our floor is the Nitro view at ~0.6 ms/view, so a hosted field should land near `TextInput`, not Expo.

## 6. Sizing / multiline

`docs/architecture/sizing.md:320-324` already prescribes the case: a `fillWidth` control whose height
depends on width must put **the box width in `nuiSizingKey`**, since one entry holds one height
(`cpp/NitroUiSizingEngine.hpp:502`). Real risk: `cache_` has no eviction and only an environment bump
clears it (`cpp/NitroUiSizingEngine.cpp:216-219`, count at `:603`). Spike it through the existing
diagnostic — `nitroUiCore.sizingStats().cachedSizes` (`src/NitroUiCore.ts:47,69`;
`src/NitroUiCore.nitro.ts:24`) — reading it after re-keying one field across 20 widths and after hundreds
of width changes, and choose between engine eviction and a quantised width bucket in the key. Auto-grow
needs `noteContentSizeMayHaveChanged()` + `noteSizingKeyChanged()` per content change
(`ios/core/NitroSwiftUIHost.swift:271,295`; `android/.../core/NitroComposeHost.kt:1088`),
and `invalidateContentSize()` only once the view has a window (`docs/architecture/sizing.md:497-508`).
Declare a fallback that differs from the measured size (X4).

## 7. Spike plan and go/no-go

- **P1 iOS A/B** — `TextField`+`@FocusState` in `NitroSwiftUIHost` vs `UITextField` in a
  `UIViewRepresentable`: round-trip, `userEvent.type`, Japanese IME, keyboard types, focus/blur, a11y label.
- **P2 Android** — `BasicTextField(TextFieldState)` in `NitroComposeHost` behind our `ControlledValue<String>`;
  settle the typing oracle before anything else.
- **P3 Handshake** — rejected change reverts; two fast edits with JS slow (echo skips a count); a JS write
  mid-composition; `maxLength` with an emoji; secure field. Extend the three twins with string vectors
  (`src/__tests__/useControlled.test.tsx`, `scripts/native-tests/handshake.test.swift`,
  `android/src/test/.../NitroUiControlledValueTest.kt`).
- **P4 Sizing** — single-line intrinsic; multiline auto-grow with width in the key; `cachedSizes` curve.
- **P5 Cost** — bench arms (the component list is generated from `component.json`, `bench/src/types.ts:18-27`)
  plus keystroke→commit and focus latency.

**Go** (numbers in the report): typing works on both platforms through harness or real input; composition
survives a controlled write and `maxLength`; a rejected change reverts with no lost character at 10 keys/s;
first-keystroke→commit p95 ≤ RN `TextInput` × 1.5 in the same run; auto-grow converges in ≤1 correction
(D17); N=200 recycle/drop leak-free; the four X4 rules pass.
**No-go → 0.5** if: Android has no IME-level typing oracle without a new test hook; iOS needs the
`UITextField` path for anything core *and* the two hosting shapes can't coexist; keystroke latency > 2×
`TextInput`; width-keyed cache growth unbounded in practice.

## 8. Not verified

No device: real-device latency, keyboard churn across navigation, Gboard/SwiftKey behaviour, OEM
`inputType` quirks. Compose APIs were read from AAR bytecode, not compiled. Expo's focus-during-recycle
behaviour is unverified.

## Questions for orchestrator

1. Adopt Compose `TextFieldState` (composition range; `TextFieldValue` deprecated) though our docs and
   Expo speak text+selection? *Recommend yes.*
2. Accept an Android-only `nuiTestInsertText` as the typing oracle, or add `adb shell input text` to the
   real-input runner first? *Recommend the runner — one function.*
3. Is v1 without `TextInput.State`/`Keyboard.dismiss()` interop acceptable? *Recommend yes, as a 1.1 item.*
4. Width bucket in `nuiSizingKey` for multiline, or engine cache eviction (core change touching six shipped
   controls)? *Recommend the bucket; decide after P4.*

## Orchestrator answers (2026-10-28)

1. Yes: use `BasicTextField(TextFieldState)`.
2. Add IME-level typing (`adb shell input text` on the leased serial) to the real-input runner, and
   use it as T18's Android oracle. No test-only insert method.
3. The spike may skip `TextInput.State` / `Keyboard.dismiss()` integration. Whether G8 needs it goes
   to the owner with T18's go/no-go.
4. Decide after P4, leaning towards the width bucket over a sizing-engine change.

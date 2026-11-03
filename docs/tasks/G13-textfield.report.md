# G13 — TextField

**Branch:** `task/G13-textfield` (from `main` at `65ca0c2`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `G13-houpr` (sim `nitro-ui B` iPhone Air iOS 27.0 / `emulator-5570` `nitroui_b` API 35 / Metro `8293`)

## API (as built)

```ts
<TextField
  value?: string  defaultValue?: string = ''  onChangeText?: (text: string) => void
  placeholder?: string  multiline?: boolean = false
  keyboardType?: 'default'|'number-pad'|'decimal-pad'|'numeric'|'email-address'|'phone-pad'|'url'
  autoCapitalize?: 'none'|'sentences'|'words'|'characters' = 'sentences'  autoCorrect?: boolean = true
  secureTextEntry?: boolean = false      // single-line only
  maxLength?: number | null              // UTF-16 code units, never splits a grapheme
  returnKeyType?: 'default'|'done'|'go'|'next'|'search'|'send'   // single-line only
  onSubmitEditing?: (text: string) => void   // Return on single-line, then blur (RN default)
  editable?: boolean = true  onFocus?: () => void  onBlur?: () => void
  ref?: Ref<TextFieldHandle>             // { focus(): void; blur(): void }
  testID  accessibilityLabel  ...ViewProps />
```

Not in v1 (Q2's "wait" list, plus): `autoFocus`, `selection`, `onKeyPress`, `submitBehavior`, text style.

## Summary

iOS hosts a `UITextField` (a `UITextView` when `multiline`) through a `UIViewRepresentable` in the core
`NitroSwiftUIHost` (D34); Android hosts `BasicTextField` over a **model-owned** `TextFieldState`, so a React write is
an `edit {}` in `afterUpdate()`, in the same turn.

The text is a controlled value on the shipped handshake. Text-specific rules: a `value` write under an open IME
composition is dropped (`markedTextRange` / `TextFieldState.composition`); text compares as UTF-16 on both platforms
(iOS wraps `String` in `NitroUiText`, because Swift's `==` is canonical equivalence); Android counts any edit the state
holds before judging a write, so a write racing a keystroke is stale. `maxLength` counts UTF-16 units and cuts the
inserted part at a grapheme boundary, with a post-edit backstop.

Two decisions a reviewer should read first:

- **Multi-line sizing key is per instance (`m|<sizingId>`), not the width bucket the brief named.** One cache entry
  holds one height, and the engine corrects every instance under a key to one report, so two multi-line fields at one
  width must not share a key; red proof below. A width change is a bounds change and re-measures by itself. Re-keying
  on `onLayout` would cost a render and draw the one-line fallback again on a pre-filled field. Single-line is `''`.
- **`ref` is the library's first public imperative API** (`focus()`/`blur()` are Hybrid View methods; `hybridRef`
  stays internal, D14). Native focus callback is `onFocusChange(bool)`, clear of RN's base-view `onFocus`/`onBlur`.

TextField is in `UNHOSTABLE_CONTROLS`, as `HostChildren.ts` anticipated.

**X4 rule 1 (T19's 22.3 pt inside 21 pt): fixed, not reproduced.** The representable answers `sizeThatFits` with
`ceil(intrinsicContentSize.height)` = 22, so box, hosting view and `UITextField` are one 364×22 frame (iOS sweep:
"named on one element, at the control's own box, as the text field"). Android's label node is a child of the
`EditText` with the same box; the rule passes on the measured dump, and real-input reads the text off the `EditText`.

**Perf.** Keystroke-to-commit, 16 keys/arm interleaved, same IME-level call into both fields:
Android TextField p50 6.8/7.3 ms, p95 9.7/10.2 ms vs `TextInput` p50 19.0/19.0, p95 22.7/23.6 ms (**0.43×** p95, two
runs); iOS (`insertText`, a proxy: XCUITest keys still never reach the app as `UIEvent`s, D34) p50 5.9/6.5, p95 8.8/8.9
vs 9.0/4.6, 11.9/9.8 ms (**0.74×/0.91×**). Android release bench vs `TextInput` (N=50, busy host, load1 13): mount
presented **0.65×**, update 0.54×, UI CPU 1.14×, **memory 2.53×** (216 vs 86 KiB/instance; Appendix). Render count:
one commit per controlled keystroke (6).

## Gates

Round 1's generated table described code tree `50e0cd168131` (all five gates green), which fix round 1
replaced; the fresh table is in "Fix round 1" below, and `docs/tasks/G13/gates.jsonl` keeps every run of both
rounds.

## Red proofs

iOS harness (`TextField.harness.tsx`), each in a run where only its mutation was live:

- composition test -> `afterUpdate()` applies a write while `markedTextRange` is set -> `the dropped write never happened; last report {"text":"zzz",…,"composing":false}`
- maxLength/emoji test -> both composed-character cuts removed -> `the cap never happened; last report {"text":"abcd�"…}`
- insertion-cut test -> same mutation -> `the cut never happened; last report {"text":"ab👨‍�"…}`
- focus/blur test -> `focusMoved` emits only `true` -> `expected [ 'focus' ] to deeply equal [ 'focus', 'blur' ]`
- multi-line test -> sizing key shared (`m|0`) -> `expected 66 to be greater than 88` (the 4-line field got the other's height)
- recycle test -> `prepareForRecycle` keeps the handshake counts -> `expected 7 to be +0`
- round-trip test -> `userEdited` counts each key twice -> `the third echo never happened; … "nativeEvents":6`
- secure test -> `isSecureTextEntry` never set -> `the field to be drawn obscured never happened`
- single-line sizing test -> height + text length -> `expected 28 to be less than 1` (the first version of this test could not fail: a single-line field never re-measures on a text change; it now compares two fields measured independently)
- JS-write test -> `syncText()` dropped from `afterUpdate()` -> `the write never happened; last report {"text":""…}`
- not-editable test -> red on its first device run, before `canBecomeFirstResponder`/`textFieldShouldBeginEditing` existed -> `expected [ 'focus' ] to deeply equal []`

Android harness, same method:

- revert test -> reconcile only when the `value` prop changed -> `the revert never happened; last report {"text":"frozenx"…}`
- maxLength/emoji, insertion-cut -> `graphemeFloor` returns the raw limit -> `the cap never happened` / `{"text":"ab👨‍x"…}`
- focus/blur -> no blur emit -> `expected [ 'focus' ] to deeply equal [ 'focus', 'blur' ]`
- multi-line -> shared key -> `expected 72 to be greater than 96`
- recycle -> `reset()` keeps the counts -> `expected 7 to be +0`
- round-trip -> `catchUp` counts twice -> `"nativeEvents":6`
- single-line sizing -> `Modifier.height(24 + length)` -> `expected 28.19047619047619 to be less than 1`
- secure -> plain field drawn for a secure one -> `never obscured` (green until the report read what was composed, not the prop; fixed)
- JS write -> `syncText()` dropped from `afterUpdate()` -> `the write never happened`
- the Android not-editable and recycle tests were red on their first run on a real bug: a `defaultValue` that had not reached the `TextFieldState` was counted as a user edit (`its text never happened; … "nativeEvents":1`); `accounted` fixed it.

Conformance, real input, unit:

- `Conformance … TextField › shows none of its previous owner` (both platforms) -> counts kept on recycle -> `native events counted for this owner reads 1 where the props say 0`
- `… has its own declared fallback` (iOS) -> declared height 25 -> `the fallback 200x25 is not the measured 420x22`
- `real-input:android text-field` -> `maxLength` transformation disabled -> `timed out waiting for the capped text`
- `testRealInputTextField` -> `maxLength` dropped -> `("capped: abcdefg (7)") is not equal to ("capped: abcde (5)")`
- `textField.test.tsx` -> shared multi-line key; focus/blur swapped -> 2 failed
- `TextField.perf-test.tsx` -> an extra state update per echo -> `6 -> 10, mount+1 redundant[3,5,7]`
- `real-input-a11y.test.js` -> the measured fixture without its `EditText` node -> `passes the controls today’s code gets right` red
- not run: the latency test's structural half (every key commits); its duration half is D21's `expectTimingBudget`, reported and not gated without `HARNESS_TIMING=1`.

## Files changed

- `src/components/TextField/*` (spec, wrapper, host config, manifest, perf test), `src/index.ts`, `src/components/Host/HostChildren.ts`
- `ios/components/TextField/HybridNitroUiTextField.swift`; `android/…/HybridNitroUiTextField.kt`; registry-generated tables and `nitrogen/generated`
- `example/__tests__/TextField.harness.tsx`, `Conformance.harness.tsx`; `example/ios/…/RealInputTests.swift`; `example/android/…/NitroUiProbePackage.kt` (`imeInput`)
- `example/src/TextFieldScreen.tsx`, `example/src/stories/TextField.stories.tsx`, `example/src/readme-examples.tsx`; `README.md`; `docs/components/text-field.md`
- `scripts/real-input/{android,a11y,screens}.mjs`, `scripts/conformance-core.mjs`, `scripts/__tests__/*` and `scripts/__tests__/fixtures/a11y/text-field.xml`, `scripts/smoke/App.tsx`
- `bench/src/implementations/*` (TextField vs `TextInput` and `@expo/ui`), `bench/baselines/renders.json`; `etc/*`; `.changeset/text-field.md`

## Follow-ups

- text-field: `<Host>` support (now refused via `UNHOSTABLE_CONTROLS`).
- text-field: `autoFocus`, `selection`/`onSelectionChange`, `onKeyPress`, `submitBehavior`, text colour/font/alignment.
- text-field: `TextInput.State` interop (`Keyboard.dismiss()`, RN's focused-input tracking).
- text-field(Android): the composition guard is implemented but unmeasured; an `InputConnection` composition does not survive the emulator keyboard.
- text-field(iOS): the harness's `insertText` bypasses the `UITextField` delegate, so its typing cases exercise the post-edit backstop. Corrected in fix round 1: real input did *not* prove the delegate's cut (it types at the end, where both agree); host vectors and a mid-text paste now do.
- text-field(Android): the label's semantics node is a child of the `EditText` (same box); TalkBack's announcement is unverified on a device.
- sizing: per-instance multi-line keys add one cache entry per multi-line mount; the engine never evicts. Consider dropping instance-keyed entries on `forget`.
- text-field(iOS 15): the representable's `sizeThatFits` is iOS 16+; the iOS 15 fallback (`intrinsicContentSize`) has never run on a device.
- text-field(Android): 216 KiB per instance against `TextInput`'s 86 KiB (2.53×), the per-host Compose cost the README's Performance section already names for every control.
- bench: iOS release-build TextField cells not run (the brief asked for Android); `@expo/ui` TextField arms are committed but unmeasured.
- example: the TextField stories show RN's "Open debugger to view warnings" toast in Storybook mode on both platforms; not investigated.
- tooling: harness `console.log` still never reaches a gate log (T19's follow-up); the latency numbers came from a temporary throw.
- docs(README): the TextField screenshots come from the lease's iPhone Air simulator, not the iPhone 17 the other rows used.

## Questions for orchestrator

1. **Multi-line sizing key.** The brief said "width in the sizing key"; I keyed per instance (`m|<sizingId>`), because
   a shared width key lets one field's report resize another (red proof above). Options: (a) keep per-instance
   (recommended); (b) width bucket from `onLayout` as briefed (a render per mount, a fallback flash on pre-filled
   fields, still wrong across instances); (c) engine-side eviction of instance keys (core change, all controls).
2. **`ref` as public imperative API** (first in the library). Options: (a) keep `ref: Ref<TextFieldHandle>` with
   `focus()`/`blur()` over Hybrid View methods, `hybridRef` internal (recommended: RN's `TextInput` shape, and it
   leaves D14 intact); (b) hold the methods back until a cross-component imperative convention is decided.
3. **`hostable: false` for v1.** The Host refuses a TextField with an error naming it. Options: (a) keep for v1, a
   later round measures IME and focus inside a shared composition (recommended); (b) make it hostable now (the
   composable has no Host-specific code, but nothing has measured it).

## Appendix: Android release bench (`bun bench --platform android --plan quick --component text-field --only rn-core,nitro-ui`)

Results `bench/results/ac9a807-dirty-android-20261102T201357Z.*` (the dirty half was the plan cells, committed in
`96fc81e`); 4 launches × 20 iterations per cell, both arms interleaved, load1 13.4 at start (S2 active).

| Cell | Arm | presented | mounted | JS commit | JS CPU/op | UI CPU/op | bytes/inst |
| --- | --- | --- | --- | --- | --- | --- | --- |
| mount.text-field N=50 | rn-core | 82.87 ms | 68.31 ms | 3.20 ms | 3.67 ms | 29.93 ms | — |
| mount.text-field N=50 | nitro-ui | 52.26 ms | 42.69 ms | 2.35 ms | 3.19 ms | 33.64 ms | — |
| update.text-field N=50 | rn-core | 89.32 ms | 74.21 ms | 2.60 ms | 4.13 ms | 26.36 ms | — |
| update.text-field N=50 | nitro-ui | 47.85 ms | 15.20 ms | 1.57 ms | 1.92 ms | 10.94 ms | — |
| memory.text-field N=200 | rn-core | — | — | — | — | — | 85.6 KiB |
| memory.text-field N=200 | nitro-ui | — | — | — | — | — | 216.4 KiB |

Keystroke-to-commit (harness, debug build, `commits a keystroke about as fast as RN TextInput`; numbers read once
through a temporary throw, because a harness `console.log` never reaches a gate log). Two runs per platform after
both arms got the same 400 ms settle after focus; the first measurement gave only the RN arm that settle and read
TextField's first key of every block at 18–35 ms on iOS, which was the keyboard animating in.

| Platform | Arm | p50 (run 1 / 2) | p95 (run 1 / 2) |
| --- | --- | --- | --- |
| Android | TextField | 6.8 / 7.3 ms | 9.7 / 10.2 ms |
| Android | `TextInput` | 19.0 / 19.0 ms | 22.7 / 23.6 ms |
| iOS | TextField | 5.9 / 6.5 ms | 8.8 / 8.9 ms |
| iOS | `TextInput` | 9.0 / 4.6 ms | 11.9 / 9.8 ms |

## Fix round 1

All nine items done; every new test shown red (appendix).

- **Android composition:** edits are reported while composing, and `maxLength` cuts composing text, with a backstop. Only the `value` write is held back.
- **Held write:** decided again when the composition ends, on both platforms, whatever text it left.
- **Early focus:** the wrapper keeps the newest early `focus()`/`blur()` and runs it when the native view arrives.
- **iOS:** `reloadInputViews()` on a focused trait change; the cut moved to a UIKit-free file with host vectors and a mid-text paste case; the backstop only cuts text that grew.
- **Cheap fixes:** callbacks cleared before resign; secure toggle redraws; `NumberPassword`; `onSubmitEditing` docs.

The Android harness still can't hold a composition open, so `TextFieldModelTest` covers it on the JVM. Real Gboard (autocorrect on) reported `H`…`Hello` per key on both the fixed and pre-fix builds, with no composing underline, so it never composed here.

Not red-provable: `reloadInputViews` (no keyboard read-back) and the recycle order (`onDropView` clears callbacks first). One `harness:ios` run failed in HostControls (late Picker handle); it passed alone and on the rerun.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1668 tests / 64 suites | `351fe07229be` | 2 m 52 s | start 11.6 / med 11.6 / max 18.1 |
| `harness:ios` | **PASS** | 291 tests / 18 suites | `351fe07229be` (ios tree) | 5 m 22 s | start 6.6 / med 6.1 / max 8.0 |
| `harness:android` | **PASS** | 340 tests / 18 suites | `351fe07229be` (android tree) | 9 m 18 s | start 5.4 / med 4.1 / max 7.2 |
| `real-input:ios` | **PASS** | — | `351fe07229be` (ios tree) | 18 m 33 s | start 3.3 / med 7.3 / max 35.6 |
| `real-input:android` | **PASS** | — | `351fe07229be` (android tree) | 25 m 20 s | start 4.8 / med 4.6 / max 25.5 |
| `harness:android:Conformance` | stale | 50 tests / 1 suites | de8285a7348d (not this tree) | 1 m 46 s | start 4.8 / med 4.4 / max 5.5 |
| `harness:android:Conformance:-t:TextField` | stale | 1 failed of 50 tests / 1 suites | 0f1ba858cb60 (not this tree) | 17.8 s | start 6.7 / med 6.1 / max 6.7 |
| `harness:android:TextField` | stale | 16 tests / 1 suites | 4ba7b96778ce (not this tree) | 34.5 s | start 42.2 / med 34.2 / max 42.2 |
| `harness:android:TextField:-t:applies%20a%20JS%20write` | stale | 1 failed of 12 tests / 1 suites | 85a8d82fefe2 (not this tree) | 13.4 s | start 3.8 / med 3.9 / max 4.1 |
| `harness:android:TextField:-t:drops%20a%20JS%20write` | stale | 1 failed of 13 tests / 1 suites | cae4cc5c8f62 (not this tree) | 15.1 s | start 9.1 / med 8.6 / max 9.1 |
| `harness:android:TextField:-t:keystroke` | stale | 1 failed of 13 tests / 1 suites | 4559587e55a3 (not this tree) | 17.4 s | start 5.9 / med 5.0 / max 5.9 |
| `harness:android:TextField:-t:mount%20effect` | stale | 1 failed of 16 tests / 1 suites | 38585a488857 (not this tree) | 14.6 s | start 26.0 / med 24.0 / max 26.0 |
| `harness:android:TextField:-t:obscures` | stale | 1 failed of 12 tests / 1 suites | 85a8d82fefe2 (not this tree) | 13.3 s | start 3.8 / med 3.8 / max 3.8 |
| `harness:android:TextField:-t:pool` | stale | 1 failed of 12 tests / 1 suites | 0f1ba858cb60 (not this tree) | 9.0 s | start 6.2 / med 6.4 / max 6.7 |
| `harness:android:TextField:-t:round-trips` | stale | 1 failed of 12 tests / 1 suites | 8c4e0386b374 (not this tree) | 14.2 s | start 4.2 / med 4.3 / max 4.3 |
| `harness:android:TextField:-t:single-line%20field` | stale | 1 failed of 12 tests / 1 suites | 8c4e0386b374 (not this tree) | 8.7 s | start 4.6 / med 4.7 / max 4.9 |
| `harness:ios:Conformance` | stale | 50 tests / 1 suites | de8285a7348d (not this tree) | 1 m 46 s | start 3.1 / med 4.6 / max 5.3 |
| `harness:ios:Conformance:-t:TextField` | stale | 1 failed of 50 tests / 1 suites | 539b032e02b8 (not this tree) | 21.6 s | start 4.1 / med 4.2 / max 4.6 |
| `harness:ios:HostControls` | **PASS** | 11 tests / 1 suites | `351fe07229be` (ios tree) | 19.5 s | start 4.7 / med 6.6 / max 7.1 |
| `harness:ios:TextField` | stale | 1 failed of 16 tests / 1 suites | a9c73096f789 (not this tree) | 26.8 s | start 12.3 / med 10.7 / max 12.3 |
| `harness:ios:TextField:-t:applies%20a%20JS%20write` | stale | 1 failed of 12 tests / 1 suites | 378a298679a7 (not this tree) | 15.6 s | start 4.5 / med 4.5 / max 4.8 |
| `harness:ios:TextField:-t:composition%20is%20deleted` | stale | 1 failed of 16 tests / 1 suites | e7c676bd5194 (not this tree) | 15.3 s | start 6.0 / med 5.4 / max 6.0 |
| `harness:ios:TextField:-t:keystroke` | stale | 1 failed of 13 tests / 1 suites | 4559587e55a3 (not this tree) | 17.9 s | start 7.9 / med 6.9 / max 7.9 |
| `harness:ios:TextField:-t:mid-text%20paste` | stale | 1 failed of 16 tests / 1 suites | e7c676bd5194 (not this tree) | 10.7 s | start 4.5 / med 5.2 / max 6.0 |
| `harness:ios:TextField:-t:mount%20effect` | stale | 1 failed of 16 tests / 1 suites | e7c676bd5194 (not this tree) | 14.2 s | start 5.4 / med 5.6 / max 5.8 |
| `harness:ios:TextField:-t:obscures` | stale | 1 failed of 12 tests / 1 suites | 3d991b350151 (not this tree) | 14.1 s | start 12.6 / med 13.7 / max 14.9 |
| `harness:ios:TextField:-t:paste` | stale | 16 tests / 1 suites | 13bfea012ecf (not this tree) | 10.2 s | start 4.5 / med 4.4 / max 4.5 |
| `harness:ios:TextField:-t:pool` | stale | 1 failed of 12 tests / 1 suites | af5ba759f19a (not this tree) | 11.3 s | start 3.8 / med 4.2 / max 4.6 |
| `harness:ios:TextField:-t:round-trips` | stale | 1 failed of 12 tests / 1 suites | 3d991b350151 (not this tree) | 15.8 s | start 5.8 / med 12.6 / max 12.6 |
| `harness:ios:TextField:-t:single-line%20field` | stale | 1 failed of 12 tests / 1 suites | 853846df2617 (not this tree) | 10.6 s | start 6.4 / med 6.3 / max 6.4 |
| `real-input:android:--control:text-field` | stale | — | 9f3efe5aec0e (not this tree) | 5 m 31 s | start 4.5 / med 4.7 / max 8.2 |
| `real-input:ios:--control:text-field` | stale | — | 5fb226e019db (not this tree) | 6 m 13 s | start 3.0 / med 10.0 / max 20.1 |

`need --for review`: `need: review is satisfied on this code tree.`

## Appendix: fix round 1 red proofs and follow-ups

- `TextFieldModelTest` (JVM; `test:native:android` skips locally, run with `NITRO_UI_ANDROID_JVM_TESTS=1`) -> the round-0 `observe` (return while composing, no backstop, no settle) -> 4 of 7 red: `expected [h#1, he#2, hel#3, hello#4] but was [hello#1]`, `hel[lo]`, `abcd[😀]`, settled `0`; the other three -> settle on any end / backstop over a JS write / reset keeps `wasComposing` -> `expected 0 but was 1`, `abcde[fgh]`, `expected 0 but was 1`
- `text-limit.test.swift` -> no composed-character adjustment -> 5 failures (`"�"`, `"👨‍�"`, `"🇯�"` …); keep the whole insertion -> 6 failures (`got "xyz", want "xy"`)
- harness `keeps the part of a mid-text paste that fits` -> delegate cut off -> `ab xyz c` instead of `ab xy cd`
- harness `settles a write … when the composition is deleted` -> settle removed -> `"text":"abc"`, `"lastWrite":"composing"`
- harness `focuses from its parent’s mount effect` (iOS and Android) -> wrapper without the pending ask -> `focus from the mount effect never happened`
- `textField.test.tsx` early-ask cases -> round-0 wrapper -> 2 failed
- follow-up: the multi-line sizing cache grows by one entry per mount and `forget` never clears `cache_`; proposed: a component-marked instance key that `forget` erases.
- follow-up: a stale `focus()` request (iOS `focusWhenReady`, Android `focusTick`) never expires.
- follow-up: `syncText` moves the caret to the end on every JS write.
- follow-up: the Android secure toggle swaps `BasicTextField` for `BasicSecureTextField` and probably drops focus; verify on a device.
- follow-up: the iOS undo stack across a recycle is unverified.
- follow-up: the recycle test re-sends the trait props, so the trait resets are not proven.
- follow-up: iOS `reloadInputViews()` on a focused trait change has no read-back test.
- follow-up: iOS reports a composition at its commit, Android at every step; align iOS with RN (which emits during marked text) if wanted.
- follow-up: `HostControls … keeps the two window-opening controls live` once read a Picker handle before it arrived (`expected undefined to be 3`).

## Fix round 2

Three review findings on `1964d5a..8d809a9`, all fixed.

**iOS - the backstop cut the field, not the edit.** `NitroUiCommitDelta` (UIKit-free) recovers
the edit from the text before and after, walking the shared `Character` prefix and suffix so no
cluster splits, and `userEdited` caps only that edit: `abcd` with a `かき` commit after the `a`
keeps its `bcd`, and text a JS write left over the cap is kept while the new text is refused.

**Android - the backstop edited inside a composition.** `observe` defers it (`capOwed`) while
composing and applies it on the observation that reports the field once the composition has
ended; `reset` clears the debt.

**JS - a queued `focus()` outlived its field.** Cleared at the unmount; a `hybridRef` arriving
afterwards is dropped.

**README images** retaken from the rendered `States` story, light, iPhone Air (iOS 27, 3x) and
API 35: 804 and 720 px wide.

**Red proofs** (source mutated, then reverted; all green after the fix):

- `text-limit.test.swift` -> `clamped` back to a whole-field `truncate` -> 5 red: `aかきbc`,
  family -> `ab`, emoji -> `a😀bc`, JS write -> `abcde`, deletion -> `abcde`
- `TextFieldModelTest` -> cut unconditional again -> 3 red, incl.
  `theBackstopWaitsForAnOpenComposition` (`helloな` cut mid-composition)
- `textField.test.tsx` -> the round-1 wrapper -> `expect(focus).not.toHaveBeenCalled()`,
  `1: called with 0 arguments`

Marked text still cannot be driven on the lease devices (round 1: an `InputConnection`
composition is committed before the app sees it), so the JVM cases pass the flag as round 1's do.
`harness:android` flaked twice on `commits a keystroke…` (`maxLength` is null in that arm, so
this diff cannot reach it) and is green here.

Gates (`node scripts/gate.mjs table --for review`):

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1669 tests / 64 suites | `c399a86acd1a` | 2 m 43 s | start 12.2 / med 7.9 / max 12.2 |
| `harness:ios` | **PASS** | 291 tests / 18 suites | `c399a86acd1a` (ios tree) | 5 m 53 s | start 3.2 / med 35.1 / max 139.9 |
| `harness:android` | **PASS** | 340 tests / 18 suites | `c399a86acd1a` (android tree) | 9 m 17 s | start 5.6 / med 3.2 / max 5.7 |
| `real-input:ios` | **PASS** | — | `c399a86acd1a` (ios tree) | 18 m 19 s | start 4.3 / med 7.2 / max 23.4 |
| `real-input:android` | **PASS** | — | `c399a86acd1a` (android tree) | 25 m 09 s | start 5.5 / med 4.8 / max 11.5 |
| `harness:android:Conformance` | stale | 50 tests / 1 suites | de8285a7348d (not this tree) | 1 m 46 s | start 4.8 / med 4.4 / max 5.5 |
| `harness:android:Conformance:-t:TextField` | stale | 1 failed of 50 tests / 1 suites | 0f1ba858cb60 (not this tree) | 17.8 s | start 6.7 / med 6.1 / max 6.7 |
| `harness:android:TextField` | stale | 16 tests / 1 suites | 4ba7b96778ce (not this tree) | 34.5 s | start 42.2 / med 34.2 / max 42.2 |
| `harness:android:TextField:-t:applies%20a%20JS%20write` | stale | 1 failed of 12 tests / 1 suites | 85a8d82fefe2 (not this tree) | 13.4 s | start 3.8 / med 3.9 / max 4.1 |
| `harness:android:TextField:-t:drops%20a%20JS%20write` | stale | 1 failed of 13 tests / 1 suites | cae4cc5c8f62 (not this tree) | 15.1 s | start 9.1 / med 8.6 / max 9.1 |
| `harness:android:TextField:-t:keystroke` | stale | 1 failed of 13 tests / 1 suites | 4559587e55a3 (not this tree) | 17.4 s | start 5.9 / med 5.0 / max 5.9 |
| `harness:android:TextField:-t:mount%20effect` | stale | 1 failed of 16 tests / 1 suites | 38585a488857 (not this tree) | 14.6 s | start 26.0 / med 24.0 / max 26.0 |
| `harness:android:TextField:-t:obscures` | stale | 1 failed of 12 tests / 1 suites | 85a8d82fefe2 (not this tree) | 13.3 s | start 3.8 / med 3.8 / max 3.8 |
| `harness:android:TextField:-t:pool` | stale | 1 failed of 12 tests / 1 suites | 0f1ba858cb60 (not this tree) | 9.0 s | start 6.2 / med 6.4 / max 6.7 |
| `harness:android:TextField:-t:round-trips` | stale | 1 failed of 12 tests / 1 suites | 8c4e0386b374 (not this tree) | 14.2 s | start 4.2 / med 4.3 / max 4.3 |
| `harness:android:TextField:-t:single-line%20field` | stale | 1 failed of 12 tests / 1 suites | 8c4e0386b374 (not this tree) | 8.7 s | start 4.6 / med 4.7 / max 4.9 |
| `harness:ios:Conformance` | stale | 50 tests / 1 suites | de8285a7348d (not this tree) | 1 m 46 s | start 3.1 / med 4.6 / max 5.3 |
| `harness:ios:Conformance:-t:TextField` | stale | 1 failed of 50 tests / 1 suites | 539b032e02b8 (not this tree) | 21.6 s | start 4.1 / med 4.2 / max 4.6 |
| `harness:ios:HostControls` | stale | 11 tests / 1 suites | 351fe07229be (not this tree) | 19.5 s | start 4.7 / med 6.6 / max 7.1 |
| `harness:ios:TextField` | stale | 1 failed of 16 tests / 1 suites | a9c73096f789 (not this tree) | 26.8 s | start 12.3 / med 10.7 / max 12.3 |
| `harness:ios:TextField:-t:applies%20a%20JS%20write` | stale | 1 failed of 12 tests / 1 suites | 378a298679a7 (not this tree) | 15.6 s | start 4.5 / med 4.5 / max 4.8 |
| `harness:ios:TextField:-t:composition%20is%20deleted` | stale | 1 failed of 16 tests / 1 suites | e7c676bd5194 (not this tree) | 15.3 s | start 6.0 / med 5.4 / max 6.0 |
| `harness:ios:TextField:-t:keystroke` | stale | 1 failed of 13 tests / 1 suites | 4559587e55a3 (not this tree) | 17.9 s | start 7.9 / med 6.9 / max 7.9 |
| `harness:ios:TextField:-t:mid-text%20paste` | stale | 1 failed of 16 tests / 1 suites | e7c676bd5194 (not this tree) | 10.7 s | start 4.5 / med 5.2 / max 6.0 |
| `harness:ios:TextField:-t:mount%20effect` | stale | 1 failed of 16 tests / 1 suites | e7c676bd5194 (not this tree) | 14.2 s | start 5.4 / med 5.6 / max 5.8 |
| `harness:ios:TextField:-t:obscures` | stale | 1 failed of 12 tests / 1 suites | 3d991b350151 (not this tree) | 14.1 s | start 12.6 / med 13.7 / max 14.9 |
| `harness:ios:TextField:-t:paste` | stale | 16 tests / 1 suites | 13bfea012ecf (not this tree) | 10.2 s | start 4.5 / med 4.4 / max 4.5 |
| `harness:ios:TextField:-t:pool` | stale | 1 failed of 12 tests / 1 suites | af5ba759f19a (not this tree) | 11.3 s | start 3.8 / med 4.2 / max 4.6 |
| `harness:ios:TextField:-t:round-trips` | stale | 1 failed of 12 tests / 1 suites | 3d991b350151 (not this tree) | 15.8 s | start 5.8 / med 12.6 / max 12.6 |
| `harness:ios:TextField:-t:single-line%20field` | stale | 1 failed of 12 tests / 1 suites | 853846df2617 (not this tree) | 10.6 s | start 6.4 / med 6.3 / max 6.4 |
| `real-input:android:--control:text-field` | stale | — | 9f3efe5aec0e (not this tree) | 5 m 31 s | start 4.5 / med 4.7 / max 8.2 |
| `real-input:ios:--control:text-field` | stale | — | 5fb226e019db (not this tree) | 6 m 13 s | start 3.0 / med 10.0 / max 20.1 |

**Questions for orchestrator**: the story these images show is not mounted by the example app (no `.storybook`, `index.js` registers `src/App`), so it was rendered through a temporary Metro entry, since reverted. Should the example app grow a Storybook host so shots are reproducible?

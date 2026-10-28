# T18 — TextField spike: prototypes, measurements, go/no-go for 0.4

**Branch:** `task/T18-textfield-spike` (from `main` at `b943a3f`) · **Round:** 1 of 1 (spike, D19
cap — no fix rounds) · **Lease:** `T18-xnt0z` (pair-a: sim `F08675D3-A32B-4F88-BC81-02D7E0CB797E` /
`emulator-5574` / Metro `8295`) · **Machine:** `maintainer-mac-1`

## Summary

Both prototypes exist and both type through the operating system. Android runs
`BasicTextField(TextFieldState)` inside `NitroComposeHost` behind `NitroUiControlledValue<String>`;
iOS runs two arms in one host — SwiftUI `TextField` + `@FocusState`, and a `UITextField` in a
`UIViewRepresentable` — chosen by a prop frozen at mount. **The typing oracle is settled without a
test-only hook**: `adb shell input text` on the leased serial drives the IME on Android, XCUITest
`typeText` on iOS, and a 6-character burst produces 6 events on both — Q2 §7's first no-go trigger
is not hit.

Two of Q2 §7's four no-go triggers/lines are measured as failures. **Keystroke→commit on Android is
p95 78 ms against RN `TextInput`'s 26 ms — 3.00×**, above the >2× no-go line (iOS is 17.0 ms vs
71.0 ms = **0.24×**, so the Nitro handshake itself is not inherently slow). And **imperative
`focus()` does not land on either platform**: on iOS the ask reports `focus:no-field` — the model has
no control behind it at that moment, and a repeat run never built the arm-B control at all
(`no-control`) — while RN's own `TextInput`, asked the same way in the same app, focuses fine. So
P5's focus-latency number is `unmeasured`, and that scenario is red by design on both platforms
rather than reporting a zero.

Everything else measured lands: the controlled-write rules (`ignored`/`same`/`applied`, no event for
a refused write, `unreported=0` for a field's whole life — Q2 §2.4), a rejected edit reverting with
no lost character at 10 keys/s, auto-grow converging in ≤1 correction per bucket, `cachedSizes` flat
inside a width bucket (`growth_within_bucket=0`), 200 fields mounted and dropped retaining nothing
on Android, and mount cost at 0.79× RN (Android) / 1.02× (iOS) per field.

**Verdict: no-go for 0.4; TextField moves to 0.5** — reason below the table. Both fixes are named.

Three caveats a reviewer needs before the diff: the 3.00× sits inside a 750 ms `input text` round
trip on a debug build at load ~7/14 cores and is printed, not gated (D21); the composition guard is
implemented on both platforms but its branch never ran, because no composition can be opened from JS
and the brief forbids a fake one; and the spike's own files would ship if this branch were merged
(`etc/package-files.txt` gained 41 spike paths).

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 679 tests / 34 suites | `481417989f1b` | 2 m 20 s | start 10.3 / med 10.7 / max 15.4 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:android:TextFieldSpike` | **FAIL** | 1 failed of 8 tests / 1 suites | `481417989f1b` (android tree) | 1 m 08 s | start 7.4 / med 8.3 / max 9.6 |
| `harness:ios:TextFieldSpike` | **FAIL** | 1 failed of 8 tests / 1 suites | `481417989f1b` (ios tree) | 34.2 s | start 7.2 / med 6.8 / max 7.2 |
| `real-input:android:--control:spike-text-typing` | stale | — | aa6d15feb62e (not this tree) | 51.7 s | start 37.1 / med 25.8 / max 37.1 |
| `real-input:android:--control:spike-text-typing:--control:spike-text-coexist:--control:spike-text-reject:--control:spike-latency` | **PASS** | — | `481417989f1b` (android tree) | 2 m 45 s | start 6.0 / med 7.2 / max 10.0 |
| `real-input:ios:--control:spike-text-reject` | stale | — | 36f8c2f53c28 (not this tree) | 35.5 s | start 3.0 / med 3.5 / max 4.5 |
| `real-input:ios:--control:spike-text-typing:--control:spike-text-coexist` | stale | — | aa6d15feb62e (not this tree) | 2 m 16 s | start 101.9 / med 101.9 / max 137.8 |
| `real-input:ios:--control:spike-text-typing:--control:spike-text-coexist:--control:spike-text-reject:--control:spike-latency` | **PASS** | — | `481417989f1b` (ios tree) | 3 m 13 s | start 6.4 / med 98.1 / max 153.6 |
| `real-input:ios:--control:spike-text-typing:--control:spike-text-coexist:--control:spike-text-reject:--control:spike-text-latency` | stale | — | d5875c0ef80b (not this tree) | 0.1 s | start 23.6 / med 23.6 / max 23.6 |

`need --for review`: `need: 2 gate(s) missing for review: harness:ios, harness:android`.

The brief says the review bar does not apply to a spike, so what was actually run is: `check`
(green), the spike harness suite filtered to `TextFieldSpike` on both platforms (7 of 8 pass; the
one failure is `P5 focus latency`, red on purpose — see the table), and the four spike real-input
controls on both platforms (4/4 each). A filtered run records under its own name, which is why the
unfiltered `harness:ios` / `real-input:ios` rows read `missing`; the `stale` rows are earlier trees
of the same filters. No bench was run: bench arms are generated from `component.json` and the spike
deliberately has none, so P5's cost comparison runs in-process against RN's `TextInput` instead.

## Go / no-go

One row per Q2 §7 go line, then the four no-go → 0.5 triggers. Threshold is Q2's own; "measured" is
this branch's number, not a re-state of the threshold.

| Go line (Q2 §7) | Measured | Threshold | Pass/fail |
| --- | --- | --- | --- |
| Typing works on both platforms through harness or real input | Android `input text` → IME → Compose → Nitro → JS echo; iOS XCUITest `typeText`; 6-char burst = **6 events** on both; no test-only seam | typing works | **pass** |
| Composition survives a controlled write and `maxLength` | guard exists on both shapes and drops the write (`lastWrite=composing`, `HybridNitroUiSpikeTextField.swift:424`, `NitroSpikeTextFieldCompose.kt:221`); observability measured (`marked=1` on `UITextField`, `composition` read as 0 on Compose, none on SwiftUI); no composition was ever opened | survives | **not measured** — precondition only |
| A rejected change reverts with no lost character at 10 keys/s | iOS: ten `typeText` calls 100 ms apart, all ten counted (`nativeEvents=10`), then `displayed=frozen`, `typed=frozen`, `unreported=0`. Android: one `input text` burst of two keys, `nativeEvents=2`, same revert. The 10 keys/s half is iOS-measured | reverts, none lost | **pass** (Android at two keys, not at the named rate) |
| First-keystroke→commit p95 ≤ RN `TextInput` × 1.5, same run | **Android 78 ms vs 26 ms = 3.00×**; iOS 17.0 ms vs 71.0 ms = 0.24× | ≤1.5× | **fail on Android** (iOS passes) |
| Auto-grow converges in ≤1 correction (D17) | iOS 0.5 corrections/bucket (2 over 4 buckets), Android 1.0 (4 over 4) | ≤1 | **pass** |
| N=200 recycle/drop leak-free | Android `retained_after_drop_miB=0`, private-dirty 42.12 → 42.12 MiB after drop, 185 KiB/field while held; iOS has no heap probe | leak-free | **pass (Android)**, unmeasured (iOS) |
| The four X4 rules pass | Android: intrinsic height 18.7 > 0, `rebuild_on_prop=0`, `rebuild_on_text=0`, 30-field churn → ledger +1 / registry +1 / cache +0. iOS identical except both rebuild observables read `unobserved` | four rules | **pass (Android)**, 3 of 4 observed (iOS) |

| No-go trigger (Q2 §7) | Measured | Triggered? |
| --- | --- | --- |
| Android has no IME-level typing oracle without a new test hook | none needed — `input text` only, and the control goes red when delivery is removed | **no** |
| iOS needs the `UITextField` path for core **and** the two shapes cannot coexist | the `UITextField` path is needed (marked text, selection, first responder), but coexistence holds: `coexist=1`, and both arms type real keystrokes in one screen | **no** |
| Keystroke latency > 2× `TextInput` | **Android 3.00×** | **yes** |
| Width-keyed cache growth unbounded in practice | `growth_within_bucket=0` across 4 widths in one bucket, `growth_across_buckets=4` (one entry per bucket), `cache_delta=0` under 30-field churn | **no** |

**No-go for 0.4 → TextField goes to 0.5.** One no-go trigger is measured (Android keystroke→commit
3.00×, above the 2× line), and Q2's own rule is that a trigger is a decision, not a negotiation. The
second reason is not a threshold but is decisive for a v1 field: `focus()` does not land on either
platform, so the API's most-used method is unimplementable as shaped today.

Both have named fixes, and neither is the handshake:

- **Android latency.** iOS's 0.24× says the emit→echo→commit round trip is cheap. The Android
  number is inside a 750 ms `input text` round trip, a debug build, and a shared machine. The gaps
  (`[78,75,39,43,31,59,38]` vs `[26,1,17,19,17,12,17]`) put our per-keystroke floor near 31 ms where
  RN's reaches 1 ms, so it is a per-keystroke cost and not one stall — but why is not measured here.
  Re-measure in release with a bench arm before treating 3.00× as the real ratio; the spike may not
  assume it disappears.
- **Imperative focus.** On iOS `@FocusState` is private to the SwiftUI subtree, so arm A has no
  imperative path at all — `focus()` returns without touching anything when the arm is A
  (`ios/spike/HybridNitroUiSpikeTextField.swift:1021-1031`). That is a code reading, not a
  measurement: the assertion for it sits behind this round's early return. Arm B's `focus()` arrives at a
  model with no `UITextField` behind it (`focus:no-field`) — sometimes because the representable was
  never built for that mount (`no-control` in a repeat run). Android is stranger than a broken path:
  the probe's own boxed instance takes focus (`spike_plain=1 spike_boxed=1`), and an identically
  boxed field mounted later in the same suite never fires `onFocus` (its `focus` counter stayed 0).
  Which state decides it is unmeasured here. Q2 §5's prior art points at where both fixes live:
  field-owned first responder, focused from the view, not from the model.

If the owner disagrees with treating 3.00× as binding, the remaining measurements support shipping
the field — the typing path, the handshake vectors, sizing, cache growth and memory all pass.

## The numbers

Captured two ways, because the two platforms report differently: the Android lines are `logcat`
`ReactNativeJS` output collected during the recorded gate runs above; the iOS lines come from
receipt runs where `evidence()` was made to throw so the runner printed the line (that mutation is
reverted, the tree is back to `481417989f1b`, and the scenarios those lines belong to pass on it).
`app console.log` does not reach the iOS runner's stdout otherwise.

```
p1 (P1 both arms)         ios  armA=swiftui armB=textfield armB_live=1 armA_height=22.0 armB_height=22.0
                               armA_lines=-1 armB_lines=-1 armB_multiline=none coexist=1
                          droid armA=compose armB=compose armB_live=1 armA_height=18.7 armB_height=18.7
                               armA_lines=1 armB_lines=1 armB_multiline=compose coexist=1
p1_attach (how arm B got  ios  askedA=swiftui askedB=textfield frozenA=swiftui frozenB=textfield liveB=1
  its control)                  implB=textfield attached_by=mount specB=textfield
                          droid frozenA=compose frozenB=compose liveB=1 implB=compose attached_by=mount
p3 (handshake vectors)    both controlled_refuses=1 emoji_cps=4 emoji_utf16_units=8
                               maxlength_on_write_path=uncapped unreported=0 secure=hunter2
                               nfd_equal=1 nfd_cps=2 nfd_js_units=2
p3_marked_text            ios  shape_a=textfield marked=1 selection=0-0 composing=0 · shape_b=textfield
                               marked=1 selection=5-0 · swiftui_guard_impossible=1
                          droid shape_a=compose marked=0 selection=0-0 · shape_b=compose marked=0
                               selection=5-0 · swiftui_guard_impossible=0
p4 (sizing)               ios  heights=120:86.3,200:86.3,280:44.0,360:44.0 bucket=208 key_200=multi|4|w208
                               cache_before=2 growth_across_buckets=4 growth_within_bucket=0
                               corrections=2 corrections_per_bucket=0.5 measurements=11 lines=-1
                          droid heights=120:56.0,200:37.3,280:37.3,360:18.7 corrections=4
                               corrections_per_bucket=1 measurements=12 lines=3
p5_mount (N=50, one clock) ios spike_commit_ms=33.9 rn_commit_ms=33.3 ratio=1.02
                               spike_per_field_ms=0.68 rn_per_field_ms=0.67 all_reporting_ms=35.8
                          droid spike_commit_ms=1429.7 rn_commit_ms=1810.7 ratio=0.79
                               spike_per_field_ms=28.59 rn_per_field_ms=36.21
p5_focus                  both UNMEASURED — samples=0, rn_takes_focus=1, spike_plain_takes_focus=0,
                               plain_write=focus:no-field boxed_write=focus:no-field
                               reason="RN TextInput took focus on command and the spike field did not"
                               (one repeat printed plain_write=no-control: the control was never built)
                          focus_capability droid rn=1 spike_plain=1 spike_boxed=1 (probe), loop still red
p5_memory (N=200)         droid floorsMiB=0:13.94 50:18.6 100:26.13 150:36.58 200:50.08
                               per_field_kib=185 dropped_miB=43.69 empty_miB=43.69 retained_after_drop_miB=0
                          ios  unavailable — no heap probe in the example app
x4 (the four sizing rules) ios height=22.0 width=402.0 rebuild_on_prop=unobserved rebuild_on_text=unobserved
                               churn=30 ledger_delta=1 registry_delta=1 cache_delta=0
                          droid height=18.7 width=411.4 rebuild_on_prop=0 rebuild_on_text=0
                               churn=30 ledger_delta=1 registry_delta=1 cache_delta=0
real-input (OS keystrokes) droid burst=6 chars → 6 events · reject nativeEvents=2, displayed=frozen,
                               unreported=0 · p95 spike 78ms vs rn 26ms = 3.00× (input text RT 750ms floor)
                          ios  burst=6 chars → 6 events · typed "abc123" then "de" → abc123de, survives blur
                               · p95 spike 17.0ms vs rn 71.0ms = 0.24×
```

## Draft API (on this branch, not shipped)

`src/spike/TextField/TextField.nitro.ts:44` is the prop list a 0.5 field would start from:
`value`/`defaultValue`/`placeholder`/`maxLength`/`maxLines`/`accessibilityLabel`/`testID`/`nuiPerfId`
all typed `T | null` and always passed (no optional props — nitro#1184), `keyboardHints` as one bit
field whose layout is pinned by `src/spike/TextField/keyboard.ts` and `src/spike/TextField/__tests__/keyboard.test.ts`
because Swift and Kotlin each decode it by mask-and-compare, and the sizing key carrying the width
bucket (`sizingVariantFor`). Methods are at `src/spike/TextField/TextField.nitro.ts:153`:
`setValue`-shaped writes on their own main hop (Q2 §2.1 — a prop write cannot prove an applied write),
`focus`/`blur` (async, no JS→main sync hop), and `nuiTestState()` reading a cached mirror line on the
JS thread. `ios/spike/` and `android/.../NitroSpikeTextFieldCompose.kt` show the two hosting shapes
conforming to the perf contract: prop setters store + mark dirty, apply in `afterUpdate`, the hosted
root is set once, `prepareForRecycle` resets the branch too (a recycled view is a new mount), and
`onDropView` drops the host.

## RN keyboard interop (what it would take)

Q2's orchestrator answer 3 lets the spike skip this; the owner decides for the shipped field. What
the interop actually touches, read from `react-native` 0.88.0:

- `Keyboard.dismiss()` is `TextInputState.blurTextInput(TextInputState.currentlyFocusedInput())`
  (`node_modules/react-native/Libraries/Utilities/dismissKeyboard.js:18`), and
  `currentlyFocusedInput()` returns a JS-held ref (`TextInputState.js:23`) that only RN's own
  `TextInput` ever sets. A nitro-ui field is therefore **invisible to `Keyboard.dismiss()`** —
  dismiss would blur nothing, or the RN field behind ours.
- `TextInput.State.focusTextInput` gates on `currentlyFocusedInputRef !== textField &&
  textField.currentProps?.editable !== false` (`TextInputState.js:88-93`): participating means
  exposing a props mirror and an instance shape `isTextInput()` accepts, i.e. registering a
  stand-in that walks like RN's host component.
- `registerInput`/`unregisterInput` run from RN's `TextInput` lifecycle (`TextInputState.js:127`), so
  interop needs an equivalent mount/unmount hook and one owner for "who is focused" when both
  libraries have a field on screen.
- What does **not** need interop: keyboard geometry. `Keyboard.addListener` and
  `KeyboardAvoidingView` read `NativeKeyboardObserver` (`Keyboard.js:17,76`) — app-level
  notifications, not per-field — and RN keeps owning the keyboard (`adjustResize` in the example),
  so those keep working with a hosted field.
- Ours is async by contract, so "focus then read whether it landed" is answerable only from
  `onFocus` — which is exactly what this spike measured and could not get.
- Recommendation, as Q2 put it: ship without it, and say in the docs that `Keyboard.dismiss()` does
  not dismiss a nitro-ui field.

## Red proofs

`test -> mutation -> the line that went red`. Items 1–3 were run as controlled mutations this round
(logs `/tmp/t18-redproof-m1.log`, `/tmp/t18-redproof-m2.log`, and the typing run against
`emulator-5574` on tree `dcdb8343b590`); one mutation at a time, reverted, tree back to
`481417989f1b`. Items 5–7 are states the round measured while building the controls — recorded in
the commit messages, not deliberate mutations, and listed as such.

- `keyboard.test.ts` -> `KEYBOARD_SECURE 1 << 17 → 1 << 16` -> `Expected: 131072 / Received: 65536`,
  plus the gap test `Expected: 0 / Received: 65536` and the aliasing test `Expected: 13 / Received: 12`.
- `keyboard.test.ts` -> `WIDTH_BUCKET 16 → 4` -> `collapses a whole window drag into a handful of
  buckets: Expected: <= 14 / Received: 51`, and the key test `Expected: "multi|4|w208" / Received:
  "multi|4|w200"`.
- `real-input spike-text-typing` (Android) -> `typeText()` stops issuing `input text`
  (`scripts/real-input/android.mjs:2792`) -> `timed out waiting for the typed text to reach React:
  "typed" never read "abc123" (… events=0 nativeEvents=0 focused=1 impl=compose live=1)` — the oracle
  measures OS keystrokes, not a side channel, and the field stayed hosted and focused while it failed.
- `harness P5 focus latency vs RN TextInput` -> red on the final tree by itself, both platforms:
  iOS `expected true to be false` (RN took focus, our field did not), Android `expected 0 to be
  greater than or equal to 1` at `field.log.focus >= spikeAsks`. These are the two FAIL rows above.
- `awaitHostedField` / the focus probe -> no mutation needed: `focus:no-field` and `no-control` are
  what the probe writes when the ask finds nothing, and they are what the iOS runs printed.
- `real-input spike-text-reject` (iOS) -> the two-key burst form -> `nativeEvents=1` for two keys,
  because the revert races the second character (`866411d`); recorded as a finding about the arm, and
  the control now drives ten keys 100 ms apart, which is the rate Q2 §7 names. Android's twin still
  types one `input text qq` and asks for `nativeEvents=2`.
- `real-input spike-latency` (iOS) -> a tap aimed under a keyboard the previous field left open ->
  `Neither element nor any descendant has keyboard focus` (`866411d`, `01cdb72`).
- `real-input spike-text-coexist` (iOS) -> before `5752010`, `onFocus` reported `focus=1` while
  `nuiTestState()` still answered `focused=0`; the mirror now republishes on a focus change. Measured
  failure, not a mutation — and this is the coexist failure the previous session left open: it is
  fixed, and the control passes (4/4 above), with `coexist=1` in the harness line.
- Not mutated: the `displayed=frozen` revert assertion itself. Its ordering proof is that the same
  check first requires `nativeEvents=2`, so a snapshot that never moved cannot pass.

## Files changed

- `src/spike/TextField/` — prototypes: `TextField.nitro.ts` (props/methods), `SpikeTextField.tsx`,
  `NativeNitroUiSpikeTextField.ts`, `keyboard.ts` (bit layout + width bucket), and
  `src/spike/TextField/__tests__/keyboard.test.ts`.
- `ios/spike/HybridNitroUiSpikeTextField.swift`, `ios/spike/NitroSpikeTextMirror.swift` — the two iOS
  arms, the controlled-value path, the mirror, and the focus/blur/setValue methods.
- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiSpikeTextField.kt`,
  `NitroSpikeTextFieldCompose.kt` — `BasicTextField(TextFieldState)` behind
  `NitroUiControlledValue<String>`, with the composition/`maxLength` split.
- `example/src/SpikeTextFieldScreen.tsx`, `example/src/App.tsx` — the spike screen and its tab.
- `example/__tests__/TextFieldSpike.harness.tsx` — P1, P3, P4, P5, X4 on device.
- `scripts/real-input/{android,controls}.mjs`,
  `example/ios/NitroUiExampleUITests/RealInputTests.swift` — the typing oracle and the four spike
  controls on both platforms.
- `nitro.json`, `nitro-ui.sizing.json`, `etc/package-files.txt` — codegen and package manifests, kept
  consistent with the spike on the branch. **The spike files would ship if this branch merged**: 41
  spike paths are in `etc/package-files.txt` (plus three generated callback helpers, 44 lines added),
  and `check` ends with
  `package-files: tarball matches … (509 files)`. Deleting the spike is a merge-time task, and this
  branch is evidence — it is not meant to merge.

## Follow-ups

- `SpikeTextFieldContent`: the arm-B branch materialises late, which is the shape behind
  `focus:no-field`/`no-control`; a shipped field needs the control owned by the view (Q2 §5,
  nitro-input's field-owned first responder).
- X4's no-rebuild observable is focus, so it is `unobserved` wherever focus does not land — mirror a
  control identity instead and the rule becomes observable on iOS too.
- `p3_marked_text` on iOS compared two `UITextField` instances (`focusableArm` and the sibling are the
  same arm), so the A/B degenerated there; the SwiftUI `selection=-1--1` claim is carried by the
  real-input coexist control instead.
- iOS has no heap probe, so P5's memory line is Android-only; the bench host has the release-build
  instruments that would cover it.
- The NFD equality vector was written programmatically, so it proves transport, not the Swift-vs-Kotlin
  canonical-equivalence disagreement Q2 §2.4 is about; that needs a real IME (`spike-text-nfd`).
- No `spike-text-maxlength` control exists, so the emoji cap on the *typing* path is unmeasured; only
  `cps` counting (code points, no split surrogate) and "the cap is not on the write path" were.
- App `console.log` reaches the iOS harness runner's stdout only when a suite fails; harness tooling
  (R1 line), and it is why the iOS numbers needed receipt runs.
- Cold-start and host-cost effects on the 3.00× are unmeasured: the spike has no bench arm (bench arms
  are generated from `component.json`, `bench/src/types.ts:18-27`), so nothing here is a release-build
  number.
- Android's `focus()` is state-dependent rather than absent: it lands on the probe's instances and
  not on `P5 focus latency`'s field, on one tree, in one run. Only the failure is measured.

## Questions for orchestrator

1. Is Android's 3.00× binding as measured, or should a release-build re-measure (bench arm, no
   `input text` floor) decide 0.5's scope? *Recommendation: treat it as binding for this verdict —
   Q2 §7 says >2× is a decision, not a negotiation — and put the release re-measure in 0.5's first
   task rather than opening a T18 fix round.*
2. Should the two `TextFieldSpike` harness reds stay red on the branch as the evidence of the focus
   finding, or be marked `it.failing`/skipped so a future reader sees a green suite? *Recommendation:
   leave them red; they are the artifact, and a skip would make the ledger row read like a pass.*

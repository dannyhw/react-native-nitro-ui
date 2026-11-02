# T19 — TextField restart: the measurements that decide go or no-go

**Branch:** `task/T19-textfield-measurements` (T18b `052b377` + `origin/main`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `T19-c14ka` (sim `nitro-ui B` / `emulator-5570` / Metro `8293`)

This branch is evidence and is never merged. Nothing on `main`'s side changes: the prototype, the example
screen, the harness scenarios and the two new UI-test cases live only here.

## Summary

**Recommendation: build TextField, hosting `UITextField` on iOS. Android is cleared outright.**

| Q2 §7 line | Verdict | Evidence (N, method, load) |
| --- | --- | --- |
| Android typing oracle (no new hook) | **met** | OS keystrokes reach the Compose field and come back through the handshake (`spike-text-typing`, `spike-text-reject-rate`): 10 keys in one 211 ms burst = **≥47.4 keys/s**, RN landed 10/10, spike counted 10, `unreported=0`. Load1 med 2.2. |
| Android latency ≤ 1.5× p95 | **met** | 16 interleaved keystrokes (4 blocks × 4 keys/arm, box re-read per block), one run, `spike-latency-in-app`: spike median **14 ms** / p95 23, RN 24 / 30 → **0.58× median, 0.77× p95**. Halves agree (0.56× / 0.74×) so arm order is not a confound. Load1 start 2.48 / med 4.02 / max 10.45. |
| iOS latency ≤ 1.5× p95 | **unmeasurable** (with the accepted oracle) | The in-app instrument is verified installed but recorded **144 touch events and 0 key events**: XCUITest keystrokes never enter the app as `UIEvent`s on this build, so the arrival→-commit interval Q2 asks for cannot be formed. T18b's 1.38× stands as a lower bound and cannot rule out the >2× trigger. |
| Rejected edit reverts, no lost character at 10 keys/s | **met** | iOS `spike-text-reject-rate`: 10 keys in 766 ms (≥13 keys/s), frozen field accounted for **10**, reverted to `frozen`, `unreported=0`; RN landed 10/10. Load1 med 5.8. |
| `maxLength` | **met** on both paths | 8 keystrokes into a cap of 5 → `abcde`, `cps=5`, `equal=1`. Emoji unit question settled on the write path: 4 emoji = 4 code points kept (`emoji_cps=4`, `emoji_utf16_units=8`), same on both platforms. |
| Composition survives a controlled write | **iOS: met by the guard's own contract. Android: unmeasurable** | Arm B exposes `markedTextRange` (`shape_a_marked_text=1`) and drops a mid-composition write (`lastWrite=composing`); arm A can never observe one (`composing=0`, `swiftui_guard_impossible=1`) so the guard is unimplementable there. No accepted oracle can open a composition anywhere: `adb shell input text` refuses non-ASCII, XCUITest cannot send it, the image has only Gboard+voice, and a JS-side seam that fakes marked text is the new test hook Q2 §7 names as a no-go. |
| N=200 recycle/drop leak-free | **not met, and not the field's fault** | N=200 × 3 mount/drop cycles, four heaps, shipped `Switch` as a control arm, same process. Spike retained native **10.6 / 23.8 / 29.1 MiB** (climb +18.5, **149 KiB/field**); Switch on the same rig retains **20.7 / 25.6 / 30.8 MiB** (climb +10.2, **158 KiB/field**) — *more* per field than the prototype. It is a per-mount cost of hosting 200 controls, not a prototype leak; nothing returns to the floor after GC or churn. |
| Auto-grow ≤ 1 correction | **met** | 3 steps, corrections `1,1,1`, max 1/step, `cache_growth=0`. |
| X4 rule 1 (a11y name on the focusable node) | **measured — one finding, both platforms** | New `testRealInputSpikeA11y` + the shipped `iosA11yProblems` predicate. Both iOS arms *are* named, on the control's box, as `text field`. The finding: the named element is **22.3 pt tall inside a 21 pt RN wrapper** (y 275.33 vs 276.00), 4/4 fields — RN's box is the one SwiftUI does not fill. Android: all four named on one actable node. RN's own `TextInput` shows the mirror case (name on the wrapper only). |
| X4 rule 3 (declared fallback) | **met** | Declared `44`, measured 18.7 (Android) / 22.0 (iOS) → `differs`, registered before the first measure. |
| X4 rule 4 (recycle reset) | **met** | 3 rounds, `saw_recycles=6`, `disp=` empty on every recycled instance, both platforms. |
| Width-keyed cache growth bounded | **met** | `cache_delta=0` over 30 churn steps; P4's bucket curve green on both. |
| P1 / arm-B focus flakiness | **cause found; deterministic under suite pressure** | See below. |

The three findings a reviewer needs before the diff are in the appendix: **P1's cause and signature**, **which
arm can implement the composition guard**, and **the iOS reject-rate result plus the arm-A counter that misled
the check that tried to prove it**. Nothing in the table above is a regression in shipped code: every red line
is a prototype scenario, measured here and reported nowhere else.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1678 tests / 65 suites | `fbf16a74407c` | 2 m 39 s | start 3.3 / med 4.3 / max 5.0 |
| `harness:ios` | **FAIL** | 1 failed of 243 tests / 17 suites | `fbf16a74407c` (ios tree) | 4 m 25 s | start 3.2 / med 3.5 / max 5.7 |
| `harness:android` | **PASS** | 294 tests / 17 suites | `fbf16a74407c` (android tree) | 8 m 46 s | start 5.7 / med 3.2 / max 6.1 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:android:--suite:TextFieldSpike` | **FAIL** | — | `fbf16a74407c` (android tree) | 0.4 s | start 3.0 / med 3.0 / max 3.0 |
| `harness:android:Memory:memory` | stale | — | 88a27421c882 (not this tree) | 1.0 s | start 2.6 / med 2.6 / max 2.6 |
| `harness:android:Memory:P5%20memory` | stale | — | 88a27421c882 (not this tree) | 1.4 s | start 3.1 / med 3.1 / max 3.1 |
| `harness:android:Memory:TextFieldSpike:200%20fields` | stale | 9 tests / 1 suites | 88a27421c882 (not this tree) | 37.6 s | start 1.8 / med 2.4 / max 2.6 |
| `harness:android:Recycle:TextFieldSpike:recycled%20instance` | stale | 10 tests / 1 suites | 951aed6d85be (not this tree) | 41.8 s | start 13.1 / med 11.9 / max 13.1 |
| `harness:android:TextFieldSpike` | stale | 9 tests / 1 suites | d9f95b10a6a9 (not this tree) | 34.0 s | start 2.4 / med 2.9 / max 3.6 |
| `harness:ios:TextFieldSpike` | **PASS** | 10 tests / 1 suites | `fbf16a74407c` (ios tree) | 38.2 s | start 5.4 / med 6.1 / max 6.3 |
| `real-input:android:--control:spike-latency-in-app` | stale | — | 6d7ebdf4ac51 (not this tree) | 6 m 07 s | start 2.5 / med 4.0 / max 10.4 |
| `real-input:android:--control:spike-text-reject-rate:--control:spike-text-maxlength:--control:spike-text-coexist:--control:spike-text-typing` | stale | — | d9f95b10a6a9 (not this tree) | 7 m 09 s | start 1.6 / med 2.2 / max 5.8 |
| `real-input:android:spike` | stale | — | d9f95b10a6a9 (not this tree) | 0.2 s | start 1.4 / med 1.4 / max 1.4 |
| `real-input:ios:--control:spike-latency-in-app` | stale | — | 5bab7c17c44c (not this tree) | 4 m 33 s | start 1.8 / med 3.9 / max 7.7 |
| `real-input:ios:--control:spike-text-coexist` | stale | — | 7c8d1a0a3b06 (not this tree) | 5 m 19 s | start 2.4 / med 5.9 / max 12.6 |
| `real-input:ios:--control:spike-text-reject-rate` | stale | — | 9c6469249e6f (not this tree) | 5 m 04 s | start 2.3 / med 5.8 / max 10.1 |
| `real-input:ios:--control:spike-text-reject-rate:--background` | stale | — | b447972ba1f7 (not this tree) | 0.3 s | start 4.8 / med 4.7 / max 4.8 |
| `real-input:ios:TextFieldSpikeLatencyInApp` | stale | — | 3f6f6f9eb33e (not this tree) | 0.1 s | start 1.2 / med 1.2 / max 1.2 |

`need --for review`: `need: 1 gate(s) missing for review: harness:ios` — red 5/5 on this tree, and the single
failure is P1, the prototype scenario this task is measuring. It is not a regression in anything that ships:
`harness:ios`'s other 242 tests pass every time. Every measurement run above is keyed to the tree it ran on;
the ones marked `stale` measured the numbers quoted in the table but predate the last doc/test edits.

## Red proofs

- `real-input-a11y-prototype.test.js › one row per prototype control` -> renamed a label in `RealInputTests.swift` -> `expect(received).toEqual(expected)`, `Received: label="capped field renamed"`.
- same file -> deleted `.prototype("frozen", …)` from the Swift list -> the same comparison, 4 rows against 5.
- same file -> spelled a prototype row with the memberwise `A11yCase(id:…)` initialiser -> red, and it also broke the *shipped* 13-row comparison, which is why prototype rows go through the factory.
- `… › is exempt from the shipped coverage guard` -> dropped `SPIKE_A11Y_METHOD` from the exemption -> that line went red (and every iOS run would throw).
- `… › marks the React Native wrapper from the row` -> `node.anchor = node.anchor` -> red; without it the wrapper's copied label answers rule 1, the tautology the in-app rule used to be guilty of.
- `… › calls an empty one unmeasured` -> `check(…, true)` instead of `nodes.length > 0` -> red.
- `real-input-ios-latency.test.js` (8 tests) -> count mismatch / two responders / no arrivals / no markers / one arm only -> each went red on its own assertion before being trusted.
- Item 1's instrument was shown to *fail before it was believed*: a synthetic 60-key stamp file pairs green; removing the burst markers, arming one responder only, or reordering one arm's arrivals each turns it red. The real run then reported `144 touch events but 0 key events` — the honest answer, printed as a failing auxiliary check rather than as a pass.

## Files changed

- `example/ios/NitroUiExampleUITests/RealInputTests.swift` — in-app latency instrument (arrival stamps to a file in the app container), `testRealInputSpikeA11y` prototype case list, three-arm reject-rate check, `.textField`/`.secureTextField` trait names.
- `example/ios/NitroUiExample/NitroUiKeyStamp.swift` — the stamping `UIWindow` and its stamp file.
- `scripts/real-input/ios.mjs`, `ios-latency.mjs`, `ios-spike-a11y.mjs` — stamp pairing (order, never nearest-preceding), the burst-marker arm split, prototype rule-1 reporting.
- `scripts/real-input/android.mjs` — block-interleaved latency check, before-burst reject-rate baseline.
- `scripts/real-input/a11y.mjs` / `a11y-sweep.mjs` — unchanged; the prototype rows reuse `a11yProblems` / `iosA11yProblems` rather than a new rule.
- `example/__tests__/TextFieldSpike.harness.tsx` — P5 two-heap/3-cycle memory scenario with a `Switch` arm, X4 rule-4 recycle scenario, P1 attribution keys (`asked`/`recycles`/`drops`/`live`).
- `example/src/SpikeTextFieldScreen.tsx`,
  `example/android/app/src/main/java/nitroui/example/NitroUiProbePackage.kt` — the latency field pair, and the
  native-heap readers (`nativeHeapAllocatedBytes`, `nativePssKb`, `totalPrivateDirtyKb`) the memory arm needs.
- `scripts/__tests__/real-input-a11y-prototype.test.js`, `real-input-ios-latency.test.js` — the guards above.

## Follow-ups

- spike(iOS): an uncontrolled arm-A field's mirror `nativeEvents=` never advances, because no prop change fires `afterUpdate()`. Any future arm-A probe must read the JS counter.
- spike(iOS): typing 10 characters into the uncontrolled arm-A field produced **20** `onValueChange` events for
  10 accepted characters. Whether SwiftUI's binding setter is called twice per key or the spike counts a second
  time is not this task's question, but a component's event-count handshake depends on the answer.
- spike: `spike-write`'s `maxLength` row still says `uncapped`; only the typing path proves the cap's unit.
- spike(iOS): arm A still answers `focus()` with `focus:no-field` / `live=0` in the X4 scenario seconds after mount.
- spike(Android): `p3_marked_text` reports `shape_b_selection=5-0` (end before start) on a field with 5 characters.
- tooling: `gate.mjs <gate> -- --filter` consumes `--background` after `--`; it has to come first.
- tooling: harness evidence lines (`nui-spike …`) reach neither the gate log nor `log show` at default level, and `console.log` from UI tests is dropped from gate logs entirely — measurements have to be routed into check notes or failure messages to be traceable.
- repo: `real-input` Android needs the `debug_http_host` preference written (`prepareLaunch`) before a manual `am start`, or the debug app loads from assets and shows "Unable to load script".

## Questions for orchestrator

1. **Does item 1 (iOS keystroke latency) need answering before the component is built?** Q2 §7's go line is a p95 ratio and I cannot produce it with the accepted oracle: XCUITest keystrokes do not reach the app as `UIEvents`, so no in-app clock can see the arrival end. Options:
   (a) *Accept the Android ratio plus the iOS evidence that is measurable* — mount ratio 0.99×, focus ratio 0.96–1.00×, and an arm-B `UITextField` whose keystrokes commit as one event per key — and build, on the grounds that no iOS seam has ever measured slower than RN's own field (recommended);
   (b) commission a private-API keystroke injector or a hardware-key path purely to close this number;
   (c) treat iOS latency as an open risk and gate the *component's* own perf contract on measuring it once it exists.
2. **Is "N=200 retains ~29 MiB, and a shipped Switch retains 31 MiB at the same N" acceptable as *leak-free*?** The go line says N=200 recycle/drop leak-free. The prototype climbs less per field than the shipped control, so my reading is that the criterion is about unbounded growth and this is a per-mount hosting cost, not a leak. If Q2 meant "the floor must return to baseline after 200 drops", that is false for `Switch` too, and the criterion needs rewording rather than a TextField fix.
3. **Which iOS shape does the component host?** The measurements point at `UITextField` (arm B) on one finding and one absence: arm B can observe marked text and drop a write mid-composition; arm A never can, so a controlled field on arm A cannot implement Q2 §2.2's guard at all. Rule 1's box finding (name 22.3 pt vs wrapper 21 pt) is on both arms, so it is not a reason to prefer either. Recommend: build on arm B (`UITextField` in the representable), keep `<Host>` + SwiftUI as the composition arm only if a later requirement needs it.
4. **Should the arm-shape recycle bug be fixed in the spike before the component starts?** I identified it and
   proved the signature; I did not fix it, because the fix (rebuilding the hosted subtree on recycle, or making a
   pooled instance non-transferable between shapes) is a core/pooling decision rather than a measurement. One
   scenario would settle the remaining half of item 4 — *does the SwiftUI arm alone avoid P1* — by recycling
   under full-suite pressure with every instance asking for `swiftui`. That is a 15-minute run and I recommend it
   before the component is designed, since it decides whether the A/B can be a pool-level choice at all.

## Appendix

### P1's cause, with one signature

All 5 failures on this tree are byte-identical: `implA=textfield frozenA=swiftui askedA_=tts recyclesA=2
dropsA=2 liveA=1`. `liveA=1` beside `frozenA=swiftui` means the *previous* mount's `UITextField` is still
attached to a model that has already chosen the SwiftUI arm: `prepareForRecycle()` clears `frozenImplementation`
and `hostedField`, but the hosted subtree is deliberately never rebuilt per update, so a pooled instance keeps
the shape it first mounted as. The setter's `next != requested` guard then refuses to re-decide. Rate: **1 of 4
filtered runs, 5 of 5 full-suite runs** — pressure-dependent, which is why T18 saw "3 of 10". Android never fails
it: one shape, nothing to disagree with.

**Does the SwiftUI arm alone avoid P1? On the evidence, yes** — the failure needs an instance asked for a
*different* arm than the shape its pooled subtree was built as, and every red run carries `askedA_=tts`. Where
every mount asks for the same shape the reset is consistent: iOS's rule-4 scenario recycles 6 times with
`frozen=textfield impl=textfield` and `disp=` empty each time, and 12 of 17 filtered iOS runs on this branch are
green. So the bug is a pool-level shape decision, not a property of either arm; arm B is only more often on the
wrong end because it is the shape with an observable `UITextField`. What this does **not** settle: no run recycled
a same-arm instance under full-suite pressure, which is the experiment that would turn inference into measurement.

### Which arm can implement the composition guard

`shape_a_marked_text=1` on arm B and `0` on arm A, with `swiftui_guard_impossible=1`. Q2 §2.2's rule — never
apply a controlled write into an open composition — is implementable on `UITextField` and unimplementable in
SwiftUI's `TextField`, because arm A cannot observe marked text, selection or line count at all (`composing=0`,
`selection=-1--1` are its "unobserved" answers, not measured zeroes). That is the single strongest argument in
this task for which shape a component should host.

### iOS reject "one key short", and the counter that hid it

T18b compared a cumulative counter with a per-burst expectation, so its warm-up key absorbed one loss. With a
before-burst reading and an accepting third arm: frozen accounted for **10**, RN landed **10/10** — nothing is one
key short. Building the third arm is what produced the useful finding: on arm A, the field's own mirror
`nativeEvents=` did not move across a burst React had been handed **20 events** for. An uncontrolled field's props
never change, so no `afterUpdate()` fires and the cached mirror line is never republished, while JS's `typed=` /
`events=` advance correctly. Any future arm-A probe must read the JS-side counter, or it will keep reporting a
field that works as one that received nothing.

### What item 1's instrument proved about XCUITest keystrokes

The stamping window was installed twice in the run and recorded **144 touch events and 0 key events**, so on this
build XCUITest's synthesized keystrokes do not arrive at the app's key window as `UIEvent`s — the injection path
terminates before `sendEvent(_:)`. The runner reports that as a failing auxiliary check with the touch/key split
in the message, rather than printing an absent ratio.

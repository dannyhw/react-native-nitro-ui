# T18b — TextField follow-up: focus, latency, and the go lines T18 did not reach

**Branch:** `task/T18b-textfield-followup` (from `task/T18-textfield-spike` at `52e8579`, brief at
`0e66cdd`) · **Round:** 1 of 1 (spike, D19 cap — no fix rounds) · **Lease:** `T18b-d257u`
(pair-a: sim `F08675D3-A32B-4F88-BC81-02D7E0CB797E` / `emulator-5574` / Metro `8295`) ·
**Machine:** `maintainer-mac-1`

> **Read with the review.** `T18b-textfield-followup.review.md` accepts this report with
> corrections, and they override the text below. **Q2 §7's go is not reached.** No no-go trigger
> fired on Android, but five go lines are unmet or unmeasured: N=200 memory, composition, X4
> rules 1/3/4, iOS latency and iOS reject. Starting G8 in 0.5 is therefore the owner's call, not
> a result of this spike. "The design is settled" doesn't hold. Specifically:
> - The Android latency pass is real but not decisive. The arms always ran in the same order,
>   and over the first 18 samples of each arm the spike is 1.31–2.00× RN at the median (M2).
> - iOS 1.38× is a lower bound on the field's ratio, not an upper one. The >2× trigger isn't ruled
>   out (M3).
> - The iOS reject check counts the warm-up key: 8 of 10 burst keys arrived (M4).
> - iOS focus lands on the SwiftUI arm only. The `UITextField` arm still sometimes fails (M5).
> - Final-tree iOS numbers do exist, in the 21:21 full run (M6).
> - The red `harness:android` had four failing suites, two with assertion failures, not only
>   timeouts. It is still unrelated to this diff (M7).
> - P1 failed in 3 of 10 iOS runs (M8).
> - The G8 must-haves are missing (M9).
> - Auto-grow was measured with JS writes only (M10).
> - Several red proofs were not seen red at the check they guard, or never went red (M11).
>
> The review's answers to the three questions below recommend: the spike suite plus real-input
> as the Android evidence; finding P1's cause before it becomes a gate; and an in-app iOS latency
> instrument as G8's first task.

## Summary

T18's no-go rested on two measurements. Re-measured as Q2 §7 names them, both come out the other way.

**Focus was a test bug** — the review's premise, now measured. `resolveFocusCapability()` ran first,
and its own `render()` unmounts whatever is rendered, so `P5` asked `focus()` of a field the probe had
just dropped. Resolving the probe before any scenario has a tree to lose flips its own reading:
`spike_plain=0` → `spike_plain=1`. Focus then lands on both platforms, and the
later-mounted field T18 saw fail now both focuses and blurs. Its *cost* is not clean: `P5` is n=6, so
its p95 is its maximum — Android medians 35 ms against RN `TextInput`'s 26.5 (1.32×) where the p95
reads 109 against 37 (2.95×, one sample over one sample). iOS's own cost reading is the pre-fix tree's. Android needed one real fix: `View.clearFocus()` on the
ComposeView is a different focus system from Compose's, so `blur()` answers through the composable's
`LocalFocusManager`; the SwiftUI arm gained an imperative handle.

**Latency was the wrong quantity.** T18's 3.00× was `stamps[i] − stamps[i−1]` inside one injected
burst, n=7, debug. `spike-latency-first` times one keystroke into an *idle* field to the JS commit, in a **release** APK, 36 samples per arm, against an RN field doing the same work. Three
runs: p95 0.58×, 0.61×, 1.20×; medians 0.72×–1.13×. Inside §7's ≤1.5× every time.

Go lines reached on **both** platforms with real keystrokes: a rejected edit faster than the named 10
keys/s (Android ≥13.4, iOS ≥11.3) reverting with nothing unreported, RN's own field present to show how
many keys the injector really delivered; and `maxLength` on the typing path, capped in code points.
Auto-grow converges at ≤1 correction per step on both platforms, after one iOS line: a content change
had never said the content size might have changed. iOS first-keystroke→commit is 1.38× at
p95, inside the line, but over an injector that costs 500–600 ms a key: a bound, not a reading.
**Not met:** N=200 dropped stays ~30 MiB above its pre-mount floor. **Unmeasured:** composition, the
emoji half of `maxLength`, X4's rules 1, 3 and 4.

**Verdict: go for G8 in 0.5.** Both blockers were instrument errors, not properties of the field, and
the design is settled — field-owned focus on
both platforms, Compose `FocusManager`, SwiftUI `focusBinding`, a content-size note per content
change. A literal "every go line" reading is still unmet; the three carries are under the table.

## Go / no-go — Q2 §7 re-stated with this round's rows

| Go line (Q2 §7) | Measured on this branch | Line | Reading |
| --- | --- | --- | --- |
| Typing works on both platforms | T18's `spike-text-typing` (both platforms, `nativeEvents=6` for a 6-char burst); this round adds two more controls that type real keystrokes on Android, and the harness at 9/9 both platforms | works | **pass** |
| Composition survives a controlled write and `maxLength` | `spike-text-maxlength`, both platforms: cap held at `abcde` of `abcdefgh` typed, `cps=5`, `equal=1`, `unreported=0`. Composition still cannot be opened — no accepted oracle injects one (`input text` sends KeyEvents; `typeText` takes ASCII only) | both halves | **cap pass (both); composition unmeasured** |
| A rejected change reverts, none lost, at 10 keys/s | `spike-text-reject-rate`, both platforms: Android 10 keys in one 747 ms call = **≥13.4 keys/s**, field counted 11 edits, RN landed 10 of 10; iOS 10 keys in one 887 ms call = **≥11.3 keys/s**, field counted 9 edits, RN landed 9 of 10. Both `displayed=frozen`, `typed=frozen`, `unreported=0` | 10 keys/s | **pass (both platforms)** |
| First-keystroke→commit p95 ≤ RN × 1.5, same run | `spike-latency-first`. Android, release APK, n=36/arm: spike 24/33/84/89, RN 22/46/138/148 → **0.61× p95, 0.72× median** (round repeats: 0.58× and 1.20× at p95). iOS, Debug XCUITest, n=30/arm: spike 397/415/451/475, RN 290/303/326/369 → **1.38× p95, 1.37× median** — inside the line, over an injector costing 500–600 ms a key | ≤1.5× | **pass (Android decisive; iOS a bound, not a reading)** |
| Auto-grow converges in ≤1 correction (D17) | harness `P4b`, a fixed-width multiline field, three controlled writes that add a line each: Android `18.7 → 37.3 → 56.0 → 74.7`, `corrections=1,1,1`, `cache_growth=0`; iOS green on the same assertions after the content-size note (before it: `22.0,22.0,22.0,22.0`, `corrections=0,0,0`) | ≤1/step | **pass (both platforms)** |
| N=200 recycle/drop leak-free | pre-mount floor `14.2 MiB`, 200 fields `50.3` (36.1 held, 185 KiB/field), after the drop `43.9` → **`retained_vs_baseline_miB=29.9`**. T18's `dropped − empty` reading is printed beside it (`0`–`0.18`) and is vacuous, as the review said. Mount/drop only — no recycle seam | leak-free | **not met (Android)**; no heap probe on iOS |
| The four X4 rules | rule 1 a11y name: not in a JS harness; Android's real input finds the field by `accessibilityLabel` and the *tap* on it focuses it. rule 2: engine deltas (`ledger+1 registry+1 cache+0` over 30-field churn) + the memory half above. rule 3: declared 44 vs measured 18.7 — *reading* of the declaration, *measurement* of the difference. rule 4 recycle reset: **no seam in this runner** | all four | **1 of 4 measured here**; 3 unmeasured |

| No-go trigger (Q2 §7) | Measured | Triggered? |
| --- | --- | --- |
| Android has no IME-level typing oracle without a new test hook | unchanged from T18 (`input text` only), and three controls now depend on it; `spike-text-reject-rate` went red when the field stopped rejecting | **no** |
| iOS needs `UITextField` for anything core **and** the shapes cannot coexist | auto-grow is the SwiftUI arm's (`axis: .vertical`), so it needs neither; the hosted arm still has no multiline at all. Coexistence holds (`coexist=1`) | **no** |
| Keystroke latency > 2× `TextInput` | **1.20× p95 / 1.06× median** (release, n=36/arm, first keystroke into an idle field) | **no** — T18's 3.00× was an inter-commit gap, n=7, debug |
| Width-keyed cache growth unbounded in practice | `P4` unchanged (`growth_within_bucket=0`), and `P4b` adds `cache_growth=0` across three content changes | **no** |

**Go for G8 in 0.5.** The reason is that both of T18's blockers were instrument errors, not
properties of the field: focus lands on both platforms, and the keystroke path is at parity with RN's
own field in a release build — 0.61× p95 in the recorded run, 0.58× to 1.20× across three. iOS also
clears §7's line, at 1.38×, though its own injector costs 500–600 ms a key and cannot resolve better
than that. What is left is not a trigger — it is three named open items, all of which G8 can carry:

1. **The N=200 reading.** 29.9 MiB of the 36.1 MiB a 200-field mount took does not come back. That
   may be ART's heap pools rather than a leak, but it is not "leak-free", and G8 has to resolve it
   against `MountChurn`'s `floors[0]` shape (B1's) before the field ships — with a recycle seam,
   which this runner does not have.
2. **Composition.** Still unmeasured on both platforms: the accepted oracle cannot open a
   composition, and the brief forbids a fake one. G8 needs an IME-level vector or it ships the
   guard unproven (the guard is in the code on both platforms, read as a reading).
3. **X4's rules 1, 3 and 4**, which T18b's scenario names but cannot reach from JS.

Two things stay unmeasured rather than passing: composition (both platforms — no accepted oracle can
open one, and the brief forbids a fake), and the emoji half of `maxLength` (neither `input text` nor
`typeText` injects a non-ASCII character). The iOS focus *cost* is carried too: the iOS numbers under
"The numbers" come from the pre-fix tree, because the final-tree iOS run printed nothing a log capture
could read.

## Gates

`gate.mjs table` on the final code tree, and `need --for review` under it. The `stale` rows are
earlier trees, kept because the tool prints them; the rows that matter are the five device runs and
`check`.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 682 tests / 34 suites | `f4dcc1fc7285` | 4 m 02 s | start 3.1 / med 6.2 / max 19.8 |
| `harness:ios` | **PASS** | 174 tests / 14 suites | `f4dcc1fc7285` (ios tree) | 2 m 43 s | start 6.0 / med 9.6 / max 12.7 |
| `harness:android` | **FAIL** | 5 failed of 223 tests / 14 suites | `f4dcc1fc7285` (android tree) | 10 m 12 s | start 16.2 / med 11.5 / max 24.8 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:android:TextFieldSpike` | **PASS** | 9 tests / 1 suites | `1517cfc39734` (android tree) | 50.3 s | start 4.6 / med 5.2 / max 5.5 |
| `harness:android:TextFieldSpike:--background` | stale | — | 47fe04058ab8 (not this tree) | 0.7 s | start 9.1 / med 9.1 / max 9.1 |
| `harness:ios:TextFieldSpike` | **PASS** | 9 tests / 1 suites | `f4dcc1fc7285` (ios tree) | 30.1 s | start 4.1 / med 4.3 / max 4.5 |
| `real-input:android:--control:spike-latency-first` | **PASS** | — | `1517cfc39734` (android tree) | 1 m 34 s | start 10.1 / med 8.3 / max 10.1 |
| `real-input:android:--control:spike-latency-first:--control:spike-text-reject-rate` | stale | — | 16b22f0fe5ad (not this tree) | 2 m 01 s | start 5.5 / med 8.2 / max 10.2 |
| `real-input:android:--control:spike-latency-first:--control:spike-text-reject-rate:--control:spike-text-maxlength` | stale | — | ba3d3e346e79 (not this tree) | 2 m 40 s | start 7.1 / med 7.6 / max 8.2 |
| `real-input:android:--control:spike-text-reject-rate` | stale | — | 786c0da1b196 (not this tree) | 2 m 43 s | start 11.1 / med 13.3 / max 14.7 |
| `real-input:android:--control:spike-text-reject-rate:--control:spike-text-maxlength` | **PASS** | — | `1517cfc39734` (android tree) | 2 m 24 s | start 7.0 / med 7.0 / max 8.7 |
| `real-input:android:--control:spike-text-typing` | stale | — | 1bf4cdd81695 (not this tree) | 1 m 12 s | start 10.3 / med 11.8 / max 13.1 |
| `real-input:android:spike-latency-first` | stale | — | 950ccb3ab731 (not this tree) | 0.2 s | start 38.5 / med 38.5 / max 38.5 |
| `real-input:android:spike-text-reject-rate:--control:spike-text-maxlength` | stale | — | 950ccb3ab731 (not this tree) | 0.2 s | start 38.5 / med 38.5 / max 38.5 |
| `real-input:ios:--control:spike-latency-first:--control:spike-text-reject-rate:--control:spike-text-maxlength` | **PASS** | — | `f4dcc1fc7285` (ios tree) | 2 m 44 s | start 13.2 / med 7.6 / max 13.2 |

`need --for review`: `check` green, `harness:ios` green, `harness:android` red — `1 gate(s) missing for
review: harness:android`.

- `harness:ios` is green on the second full run of the same tree; the first failed in `P1`
  (`mirrorA.impl` read `textfield` where the scenario froze `swiftui`). One failure, one pass, no fix
  round spent attributing it.
- `harness:android` ran twice at this tree. The suites that fail are `MountChurn.harness.tsx` (B1) and
  `Host.harness.tsx` (F8), on 30 s per-test ceilings — neither touches the spike, and the spike suite
  was green in both Android runs (9/9). The run in the table started at **load1 16.2 on 14 cores**,
  above the harness's own 10 refusal line, and reported 5 failed of 223; that run is not a clean
  measurement of anything except a busy machine. The spike's own Android evidence is the filtered
  `harness:android:TextFieldSpike` row plus the three real-input controls.

## The numbers

Android harness evidence is `logcat ReactNativeJS` collected during the recorded `harness:android`
run on this tree; the real-input numbers are in the gate logs beside each control. The iOS harness
rows come from the same run's simulator log (`p5_focus`, `x4`); iOS prints nothing to the runner's
stdout otherwise (T18 §"The numbers").

```
focus_capability  android  rn=1 spike_plain=1 spike_boxed=1      <- after bd27213; before it, spike_plain=0
p4_auto_grow      android  heights=1:18.7,2:37.3,3:56.0,4:74.7  corrections=1,1,1  cache_growth=0
                  ios(pre-fix) heights=1:22.0,2:22.0,3:22.0,4:22.0 corrections=0,0,0
p5_focus          android  n=6 · spike p95 109 / median 35 (samples 109-35-35-33-66-28) ·
                          rn p95 37 / median 26.5 · the printed ratio 2.95 is p95-over-p95, one sample
                          over one sample; at the medians it is 1.32. focus_events=6 late_focus_lands=1
                          late_blur_ask1/2=1                                    <- tree f4dcc1fc7285
                  ios      spike p95 111 / median 82.5 · rn p95 176 / median 90.5 · 0.63 at p95, 0.91 at
                          the median · focus_events=6 · other arm (hosted UITextField) lastWrite=focus:no-field
                          <- tree f73d97b118b0, the last iOS run whose log capture answered. The final-tree
                          iOS run re-proved P5 and printed nothing capturable, so its numbers are absent.
p5_memory         android  floors 0:14.2 … 200:50.29 · dropped 43.9 · retained_vs_baseline 29.9
                          185 KiB/field while held · T18's dropped−empty reading: 0 – 0.18
x4                android  height=18.7 rebuild_on_prop=0 rebuild_on_text=0 rule3_fallback_vs_measured=differs
                          rule1_a11y=not measured here (Android: spike-text-typing) rule4_recycle_reset=not measured
spike-latency-first android release APK, n=36/arm, the recorded run
                  spike [min 24 · median 33 · p95 84 · max 89] · rn [22 · 46 · 138 · 148]
                  → 0.61× p95 / 0.72× median
                  round repeats of the same control: 0.58× and 1.20× at p95, 1.06×–1.13× at the median
                  injector wall clock 71–74 ms/call; commit−after-injector is negative, so the key lands
                  while the injector call is still running — the ratio, not the absolute, is the reading
                  ios Debug XCUITest, n=30/arm: spike [397 · 415 · 451 · 475] · rn [290 · 303 · 326 · 369]
                  → 1.38× p95 / 1.37× median. One `typeText` call costs 612 ms (spike) / 505 ms (rn) and
                  commit−after-send is −375…−186 ms: the injector's own IPC is most of both absolutes, so
                  this clears §7's line without resolving a 1.1× difference — and it is Debug, not release.
spike-text-reject-rate android 10 keys in one 747 ms call (≥13.4 keys/s) · the frozen field counted 11
                  edits (the 10 plus the warm-up key) · displayed=frozen typed=frozen unreported=0 ·
                  RN landed 10 of 10 from one 190 ms burst · warm-up call 112 ms
                  ios 10 keys in one 887 ms call (≥11.3 keys/s) · the frozen field counted 9 edits ·
                  reverted, unreported=0 · RN landed 9 of 10 from one 726 ms burst · warm-up call 832 ms.
                  The rate is proven from the injector's clock, and RN's own land count is the fidelity
                  bound the spike is judged against: XCUITest itself delivers 9 of 10.
spike-text-maxlength   android and ios, both: cap held abcde of abcdefgh · cps=5 · equal=1 · unreported=0
                  unmeasured: an emoji or composed character at the boundary (neither `input text` nor
                  `typeText` can inject a non-ASCII character), and composition itself
```

Two readings the report does *not* gate on, printed because they are on the same screens: focus
latency has no threshold in Q2 §7 (only a cost quoted in §5's prior art), and `p5_mount`'s harness
ratio swung between 1.94× and 2.43× here against the bench's 0.79× — different instruments measuring
different things, which is a follow-up, not a row.

## Red proofs

Each new control, mutated in the thing it guards (one run, three mutations, direct runner rather
than a gate; `/tmp/t18b-redproof.log`, tree hash back to `f73d97b118b0` afterwards):

- `spike-text-maxlength` -> `maxLength={5}` → `{8}` on the capped field -> `timed out waiting for the
  cap to hold while the user typed: "displayed" never read "abcde" … displayed=abcdefgh`.
- `spike-text-reject-rate` -> the frozen field adopts the edit instead of reverting (`value="frozen"`
  → `value={text}`, `setText('frozen')` → append) -> `timed out waiting for the frozen field to take
  focus … focused=0` (the field stops rejecting *and* the run cannot be driven).
- `spike-latency-first` -> the latency arm stops stamping (`setStamps(...)` → `void at;`) -> `no
  control with accessibilityLabel "latency spike field" in the accessibility tree` — with no stamps
  the echo collapses and the driver has nothing to aim at.
- `P4b auto-grow` -> not mutated: it went red on its own, on iOS, before any mutation
  (`expected 22 to be greater than 22`), which is the finding that produced the content-size fix. On
  Android it has had no mutation, so its Android half rests on the passing assertions.

The three iOS counterparts added this round (`testRealInputSpikeTextMaxlength`,
`testRealInputSpikeTextRejectRate`, `testRealInputSpikeLatencyFirst`) had **no mutation run**: the
round's clock went into measuring the go lines instead. They assert the same observables as the
Android controls above, on the same screen, and two of them earned their keep on the first attempt —
the latency case failed once for a missing `goToTab` (each case launches on the example's first tab,
so the spike screen is not in the tree until asked for) and green after that.

## Files changed

- `ios/spike/HybridNitroUiSpikeTextField.swift` — `afterUpdate()` notes a content-size change when a
  multiline field's text changed (auto-grow); arm A answers `focus()` through a `focusBinding` the
  body hands over, and arm B records `focus:no-field` / `focus:no-binding` as separate answers.
- `android/.../HybridNitroUiSpikeTextField.kt`, `NitroSpikeTextFieldCompose.kt` — `blur()` is
  answered by Compose's `FocusManager` (`force = true`) installed by the composable, not by
  `View.clearFocus()` on the host.
- `example/__tests__/TextFieldSpike.harness.tsx` — `P4b` is new; `P5` runs its focus loop on the arm
  that has an imperative path on both platforms and records the other arm as its own row; `X4`
  asks *and reads the answer of* a focus ask instead of assuming focus is observable; `P5 memory`
  reports retention against the pre-mount floor.
- `example/src/SpikeTextFieldScreen.tsx` — the `P5b` latency pair (same code path for both kinds),
  the `maxLength` typing field, and the stamp list the latency driver reads.
- `scripts/real-input/android.mjs`, `controls.mjs` — three new controls (`spike-latency-first`,
  `spike-text-reject-rate`, `spike-text-maxlength`) and the focus precondition on the RN calibration
  arm.
- `example/ios/NitroUiExampleUITests/RealInputTests.swift` — the iOS counterparts those three control
  ids need (the coverage test asks every registered row for a `func testRealInput<Pascal>(`), each
  asserting the same observable Android asserts, and printing the same notes.

## Follow-ups

- focus: the iOS focus *cost* has no final-tree reading. The harness prints it, but nothing on this
  round's iOS run captured stdout, so the numbers quoted are the pre-fix tree's. One capture flag on
  the next iOS run settles it.
- suite health: the first full-suite `harness:ios` this spike has had failed once in `P1`
  (`mirrorA.impl` read `textfield` where the scenario froze `swiftui`) and passed the next run, same
  tree. Unattributed — a fix round would have to run the suite twice, which this round spent on
  measurement. Before G8 trusts `P1` as a gate, that flake wants a cause.
- memory: `retained_vs_baseline_miB=29.9` after dropping 200 fields — compare against
  `MountChurn.harness.tsx`'s `floors[0]` shape with a recycle seam (B1's instrument).
- sizing: the iOS content-size note is gated on `multiline`; a single-line field whose font or
  writing direction changes height is still not noted. Say whether G8 keeps that gate.
- latency: `spike-latency-first` is Android-only — the iOS half needs a new XCUITest with per-key
  send stamps.
- typing: no oracle opens a composition, so Q2 §2.2's guard is unexercised on both platforms.
- maxLength: the emoji / composed-character boundary needs an injector that can type one.
- mount cost: the harness's `p5_mount` ratio (1.94×–2.43× on Android, 1.00× on iOS) disagrees with
  the bench's 0.79×; reconcile which one G8's numbers come from.
- reject-rate: the calibration arm needed a focus precondition this round; the same blind-tap pattern
  is still in `spike-text-coexist`'s RN half.
- packaging: unchanged from T18 — the spike's paths in `etc/package-files.txt` would ship on a merge.

## Questions for orchestrator

1. **The full `harness:android` bar cannot be cleared on this machine this round.** Two suites that
   have nothing to do with this diff — `MountChurn.harness.tsx` (B1, 200 Pickers with a menu open) and
   `Host.harness.tsx` (F8, re-framed hosted child) — exceed the harness's 30 s per-test ceiling in both
   full-suite runs here, at load1 8-11 on a 14-core host. The spike suite itself was green in both.
   Options: (a) accept the spike's own suite plus three real-input controls as this round's device
   evidence, as T18 did; (b) raise those two tests' ceiling or give them a quieter host, which is B1/F8
   work, not T18b's. Recommendation: (a), and let G8 run the full set on the bench host.
2. **`P1`'s arm-freezing assertion flaked on iOS** (`harness:ios` FAIL then PASS on one tree; the first
   full iOS run this spike has had). Worth a cause before G8 makes `P1` a gate — or before G8 inherits
   it as one. Recommendation: G8 runs `harness:ios` twice and attributes.
3. **Does a G8 "go" need an iOS latency number that resolves?** The iOS instrument costs 500-600 ms per
   injected key, so it can only say "not worse than 1.5×". Options: accept that as the iOS reading, or
   fund an iOS arm with a faster injector (a release-build XCUITest, or a keyboard-driven oracle).
   Recommendation: accept it, and put the faster injector in G8's instrument list.

# T18 — TextField spike: review

**Branch:** `task/T18-textfield-spike` · **Reviewed at:** `52e8579` (base `b943a3f`) · **Spike:** one
round, no fix rounds, branch not merged. The question is whether the report is a sound basis for the
owner's 0.4 go/no-go, not whether the code ships.

Read: the brief, Q2 (§7 and the orchestrator answers), the report, `docs/tasks/T18/gates.jsonl`, the
gate logs under `.gates/logs` for the final tree `481417989f1b`, the iOS runner's
`.real-input/ios/xcodebuild-test.log` from the final run, `/tmp/t18-redproof-m{1,2}.log`, and
`git diff b943a3f..HEAD`. No device gates were run. `bun run check` on `52e8579` (Node 24,
`NITRO_UI_MACHINE_LABEL=maintainer-mac-1`): see the last section.

## Verdict: ACCEPT WITH CORRECTIONS

**No-go for 0.4, TextField to 0.5** holds, and the evidence supports it more strongly than the report
says. Q2 §7's *go* needs every go line, and at HEAD four of them are unmet or unmeasured:
composition (never opened), reject at 10 keys/s (never driven at that rate), N=200 leak-free (the
assertion can't fail, and the numbers point to retention), and the X4 rules (not the rules X4
defines). On top of that, the Android latency proxy is above 2×. So "not go" doesn't depend on the
3.00× being exact.

The report's *reasons* need correcting before the owner relies on them. The second reason ("`focus()`
does not land on either platform, so the API's most-used method is unimplementable as shaped today")
is contradicted by a passing assertion at HEAD, and the Android red behind it is a bug in the test.
Three rows marked **pass** don't measure what they say. The latency caveat describes the wrong
quantity. The verdict quotes a rule Q2 doesn't contain. All the fixes are to the report (docs-only).
None needs a device run, and none changes the verdict.

## Go / no-go rows, checked

| Row | Source at HEAD | Threshold matches Q2? | Report says | Review |
| --- | --- | --- | --- | --- |
| Typing works, both platforms | `spike-text-typing` both platforms (final-tree logs, 4/4); iOS prints `events for a 6-character burst = 6` (xcodebuild-test.log:453) | yes | pass | **pass**, with N1 |
| Composition survives write + `maxLength` | guard code only (`HybridNitroUiSpikeTextField.swift:423-425`, `NitroSpikeTextFieldCompose.kt:221`) | yes | not measured | **not measured**, correct |
| Reject reverts, none lost, 10 keys/s | iOS `testRealInputSpikeTextReject`; Android `spike-text-reject` | yes | pass | **not measured at the rate** (M3) |
| First-keystroke→commit p95 ≤ 1.5× RN | `spike-latency` (`android.mjs:1894-1976`), `testRealInputSpikeLatency` (`RealInputTests.swift:1277-1327`) | the multiplier yes; the quantity no | fail Android / pass iOS | **proxy reading, Android >2×** (M2) |
| Auto-grow ≤1 correction (D17) | `P4 sizing` harness, evidence only, no assertion on corrections | yes | pass | **not measured as stated** (M5) |
| N=200 recycle/drop leak-free | `P5 memory` harness | yes | pass (Android) | **not shown; data suggests retention** (M4) |
| The four X4 rules | `X4 the sizing rules hold…` harness | different rules | pass (Android) | **mislabelled** (M6) |
| Trigger: no IME-level oracle | as row 1 | yes | no | **no**, correct |
| Trigger: iOS needs `UITextField` and no coexist | `P1` `coexist=1`, `spike-text-coexist` iOS pass | yes | no | **no**, correct |
| Trigger: keystroke latency > 2× | as row 4 | yes | yes | **yes, as a proxy** (M2) |
| Trigger: width-keyed growth unbounded | `P4` | yes | no | **no**, with N4 |

## Must (report fixes, docs-only)

**M1. The focus finding is wrong as stated, and the Android red is a test bug.**
`docs/tasks/T18-textfield-spike.report.md:20-24,91-93,103-111,225-227`.
- *Android:* `P5 focus latency` mounts its field and RN `TextInput`
  (`example/__tests__/TextFieldSpike.harness.tsx:1062`), then calls `resolveFocusCapability()`
  (`:1100`). That is the first call in the suite, so the probe runs and mounts its own trees through
  `render()`, and the harness's `render()` unmounts whatever is already rendered
  (`node_modules/@react-native-harness/runtime/src/render/index.ts:21-26`). The loop at `:1139` then
  calls `focus()` on a field that has been dropped, and waits for an `onFocus` that can't come
  (`expected 0 to be greater than or equal to 1`, final-tree log). The report's "an identically boxed
  field mounted later in the same suite never fires `onFocus`" (`:108-110`) describes this artefact.
  The field was mounted *earlier*, and the probe dropped it.
- *iOS:* `P3 which shapes can observe marked text` calls `field.handle()?.focus()` on the same arm
  (`focusableArm = 'textfield'`) and asserts `log.focus > 0` and `focused=1` (`:819-825`), then the
  same for the sibling. It **passes** on the final tree on both platforms (7 of 8; only P5 focus is
  red). So imperative focus lands on arm B, and on Android, in at least one scenario at HEAD.
  `focus:no-field` / `no-control` come only from the probe's instances, mounted right after a
  `render()` tore down the previous tree. Their cause is unmeasured.
- Fix: withdraw "does not land on either platform" and "unimplementable as shaped today". Say that
  focus is state-dependent on iOS with the cause unmeasured, that the Android P5 red comes from the
  probe dropping the scenario's own tree, and that `focus()` landed in `P3 marked text` on both
  platforms. Drop it as a verdict reason. Keep the arm-A no-op as a code reading (already labelled).
  Remove the P5 red from "Red proofs", or relabel it as a test defect: it doesn't show the field
  failing.

**M2. The latency number is an inter-commit gap, not keystroke→commit, and the caveat misplaces the
750 ms.** `report.md:17-19,34-35,78,87,97-102,162-164`.
- Both runners compute `stamps[i] - stamps[i-1]`: the gap between consecutive JS callback
  timestamps during one injected burst (`scripts/real-input/android.mjs:1945-1946`,
  `RealInputTests.swift:1333-1338`). No keystroke send time is in it, and nothing measures the
  *first* keystroke, which is the quantity Q2 §7 names. Under a burst that arrives faster than the
  field processes it, the gap is per-keystroke *throughput*. That is a fair cost proxy, but it isn't
  latency.
- The 750 ms `input text` round trip is **not** "inside both" (`android.mjs:1965`,
  `SpikeTextFieldScreen.tsx:104-106`, report `:34`, `:98`, `:162`). It is the adb call's wall clock,
  and gaps of 1–78 ms can't contain it. The real caveats are different: Android `input text` injects
  KeyEvents through `KeyCharacterMap`, so both arms take the hardware-key path, not an IME
  `commitText`. It is a debug build, a single run in a fixed order (spike first), and n=7 gaps, so
  nearest-rank p95 is the **maximum**.
- Were the arms measured the same way? The driver, the burst and the clock are the same. The
  callbacks are not: the spike's `onValueChange` also calls `refresh()` (a `nuiTestState()` read plus
  one more state, `SpikeTextFieldScreen.tsx:149-156`) and renders a longer echo, while RN's
  `onChangeText` sets state on the whole screen component (`:451-457`). The asymmetry runs both ways,
  so it doesn't explain a 3× difference, but the report should say so.
- The Android signal still holds as a proxy. Every spike gap (31–78 ms) is above every RN gap
  (1–26 ms), and the median ratio is 43/17 ≈ 2.5×, so the >2× reading doesn't hinge on the max. The
  iOS 0.24× is driven by one 71 ms RN outlier: spike gaps `[0,15,0,17,0,16,0]`, RN
  `[71,0,0,0,9,17,15]`, medians 0 vs 9. It measured the SwiftUI arm (`spike-type-target`). It can't
  carry "the Nitro handshake itself is not inherently slow" (`:19`, `:97`).
- Fix: rename the quantity (inter-commit gap under an injected burst), list the real caveats above,
  give the medians, and present the trigger as a proxy reading above 2× rather than a binding
  measurement. Question 1's recommendation (re-measure in 0.5's first task) then follows directly.

**M3. "Reject at 10 keys/s" was not driven at 10 keys/s, and the only faster reading lost a key.**
`report.md:77,230-233`. The iOS loop is `typeText("q")` plus a 0.1 s sleep
(`RealInputTests.swift:1226-1229`), and XCUITest's own timestamps put the keystrokes **0.62 s
apart** (t = 15.24 s … 20.82 s, xcodebuild-test.log), about 1.6 keys/s. Android types two keys in one
burst. The earlier iOS burst form (faster than 10 keys/s) answered `nativeEvents=1` for two keys:
UIKit dropped the keystroke a revert cancelled (`866411d`, and the report's own red-proof line).
Fix: mark the row **not measured at the named rate**, with the ~1.6 keys/s iOS figure, and cite the
burst-rate loss as a finding against the line, not as a red proof the reworked control superseded.

**M4. "N=200 leak-free" is vacuous as asserted, and the numbers point the other way.**
`report.md:29-30,80,154-155`. `retained_after_drop_miB` is `dropped − empty`, two GC'd heap reads
taken back to back after the same unmount (`TextFieldSpike.harness.tsx:1359-1382`), and the
private-dirty pair is the same. It reads 0 whether or not anything leaked. Against the pre-mount
floor, the post-drop Java heap is **43.69 MiB vs 13.94 MiB at 0 fields**: about 6 MiB of the
~36 MiB held by 200 fields came back. That may be a view pool or caches rather than a leak, but it
isn't "retaining nothing". The scenario also mounts and drops; it never recycles. Fix: mark the row
**not shown**, report baseline 13.94 → post-drop 43.69 MiB, and add a follow-up to compare against
`floors[0]` (the X4 / `MountChurn` shape).

**M5. The auto-grow row measures width-driven re-layout through a JS override, not auto-grow.**
`report.md:79`. `P4` keeps the text fixed and changes `layoutWidth` and `width` from the test
(`TextFieldSpike.harness.tsx:891-898`). No content change grows the field, which is the
`noteContentSizeMayHaveChanged()` path Q2 §6 names. `layoutWidth` also bypasses the shipping path,
`onLayout` → `setMeasuredWidth` → re-key (`src/spike/TextField/SpikeTextField.tsx:116-123`), which
costs a JS round trip per width change. Corrections are printed, not asserted. Fix: relabel it as
width-driven re-key convergence via override (0.5 / 1.0 per bucket), and mark content auto-grow
**not measured**.

**M6. "The four X4 rules" aren't X4's four rules.** `report.md:81`. X4's brief
(`docs/tasks/X4-conformance.md:27-40`) defines four rules: a11y name on the focusable node; no leak
on drop; declared fallback different from the measured size; recycle reset. The scenario checks
intrinsic height > 0, no rebuild on a prop or text change, and ledger/registry/cache deltas after
30-field churn. Only the engine half of "no leak on drop" matches. The fallback is declared on both
platforms (`HybridNitroUiSpikeTextField.kt:340-363`, `HybridNitroUiSpikeTextField.swift:702-712`)
but never asserted. Neither recycle reset nor the a11y node is tested. Fix: list what was checked
under its own names, and mark X4's rules 1, 3 and 4 **not measured**.

**M7. The verdict quotes a rule Q2 doesn't contain.** `report.md:91,293`: "Q2's own rule is that a
trigger is a decision, not a negotiation". Q2 §7 (`Q2-textfield-research.md:157-159`) lists the
triggers and nothing more, and the phrase appears nowhere in `docs/`. Fix: drop the quote. The
verdict follows from the go list being unmet plus a >2× proxy reading.

**M8. P3 "extend the three twins" was not done, and the report doesn't say so.** The brief (§Do 2,
P3) and Q2 §7 P3 ask for string vectors in `src/__tests__/useControlled.test.tsx`,
`scripts/native-tests/handshake.test.swift` and `NitroUiControlledValueTest.kt`. All three exist at
HEAD, and the diff touches none of them. The P3 numbers come from `nuiTestApplyWrite` on device
only. Fix: one line under Follow-ups or the P3 row saying the twins were not extended.

## Nice

- **N1.** `report.md:13`: "drives the IME". `adb shell input text` injects KeyEvents, not IME
  `commitText`. The orchestrator accepted it as the oracle (answer 2), so the row stands, but say
  what the path is. It also bears on M2.
- **N2. Red-proof provenance.** `report.md:210-213`: items 1–2 are in `/tmp/t18-redproof-m{1,2}.log`,
  and both match the quoted lines (3 and 4 failures). They are machine-local and not durable.
  Item 3 cites tree `dcdb8343b590`, which isn't in the ledger. The matching run is the ledger's
  `real-input:android:--control:spike-text-typing` FAIL at 14:35 (tree `aa6d15feb62e`, android half
  `926beb66…` ≠ the committed `a68f4c83…`), whose message is the one quoted. Cite that row.
- **N3.** The Q2 section numbers in new comments and the report are off. Composition is Q2 §2.2, not
  §2.4 (`NitroSpikeTextFieldCompose.kt:220`). Q2 has no NFD / canonical-equivalence claim at all
  (`report.md:277-278`, harness P3 comment). And `TextInputState.js:127` is inside `blurTextInput`:
  `registerInput` is at `:142` (`report.md:196`).
- **N4.** Cache growth was measured over 4 + 4 width changes, where Q2 §6 asked for 20 widths and
  hundreds of changes. "Bounded" rests on bucket arithmetic (`keyboard.test.ts`) plus revisits of a
  bucket already populated (208). Say so.
- **N5. Premises.** The harness P3 comment points the emoji-cap question at `spike-text-maxlength`,
  and the report points NFD at `spike-text-nfd` (`report.md:278`). Neither control exists at HEAD
  (the report says so for maxlength at `:279`). Mark both as proposed. Every other file the report
  and comments cite exists (`bench/src/types.ts:18-27`, `MountChurn.harness.tsx`, `NitroUiProbe`,
  the RN `Keyboard` / `TextInputState` / `dismissKeyboard` sources). Of the task IDs, B1 and R1 are
  merged; X4 is cited only through its brief, which exists on `main`.
- **N6. Draft API.** It isn't required on a no-go. Two notes if it stays. The callbacks are `?:` by
  design (`TextField.nitro.ts:115-142`, and the null-throw reason at `SpikeTextField.tsx:102-108`), so
  "no optional props" (`report.md:171`) should say "no optional non-callback props". And there is no
  `setValue` method, only `nuiTestApplyWrite` (`:195`), so "`setValue`-shaped writes" names a method
  0.5 would still have to add.

## Brief compliance and public-repo check

- No public export (`src/index.ts` untouched), no `component.json`, no docs page, no changeset. Pass.
  The report correctly discloses that the 41 spike paths in `etc/package-files.txt` would ship on a
  merge.
- The RN keyboard interop list is present and accurate apart from N3's line number. The draft API is
  present (N6).
- Committed files, including `docs/tasks/T18/gates.jsonl`: no home paths, emails, hostnames or
  personal device names. The ledger carries only the leased simulator UDID and `emulator-5574`, and
  its `logPath`s are repo-relative. Pass.

## `bun run check`

Green on `52e8579`: 679 tests / 34 suites, plus 7 / 7, and `package-files: tarball matches …
(509 files)`. The run used plain `bun run check`, not `gate.mjs`, so it wrote no ledger line. It
matches the report's `check` row.

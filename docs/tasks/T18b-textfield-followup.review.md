# T18b — TextField follow-up: review

**Branch:** `task/T18b-textfield-followup` · **Reviewed at:** `ee7eef7` (code tree `f4dcc1fc7285`; base
`52e8579`, brief `0e66cdd`) · **Spike:** one round, no fix rounds, branch-only evidence. The question is
whether the report is a sound basis for the owner's go/no-go on G8 in 0.5.

Read: AGENTS.md, ORCHESTRATOR.md (Reviewer), the brief, Q2 §5 and §7, T18's report (`246495c`) and review
(`57d63e5`), the report, `docs/tasks/T18b/gates.jsonl`, `git diff 0e66cdd..HEAD`, every gate log under
`.gates/logs`, the iOS runner's `.real-input/ios/xcodebuild-test.log` from the final iOS real-input run, and
`/tmp/t18b-redproof.log`. I ran no device gates and took no lease. The Android harness numbers the report
quotes come from logcat, which is not in any gate log, so I could not check them. Where this review relies on
them, it says so.

## Verdict: ACCEPT WITH CORRECTIONS

The evidence is mostly sound, and two of T18's blockers really were instrument errors:

- the focus probe tore down the scenario's own tree;
- the 3.00× was an inter-commit gap.

Three new Android measurements are solid: first-keystroke latency (release APK, n=36/arm, the device's
own clock), the reject burst, and `maxLength`. The Android latency line holds in all three runs even after
subtracting the largest possible shared injector cost (M2).

The report overstates what follows from that, and several statements are wrong:

- **Verdict.** "Go for G8 in 0.5" is not what Q2 §7 gives. Q2's go needs every go line, and at HEAD five
  are unmet or unmeasured (M1).
- **iOS latency.** The iOS ratio is framed backwards. 1.38× is a *lower* bound on the field's ratio, not an
  upper one, so the iOS reading cannot rule out the >2× trigger (M3).
- **iOS reject.** The iOS reject run counted one keystroke fewer than the calibration arm. An off-by-one in
  the check hides it (M4).
- **iOS focus.** "Focus lands on both platforms" holds for the SwiftUI arm only. Imperative focus on the
  hosted `UITextField` arm is still state-dependent at HEAD (M5).
- **Final-tree iOS numbers.** The report says it has none. It does (M6).
- **Gates.** The failing gate and the P1 flake are both described inaccurately (M7, M8).
- **Brief.** The brief's G8 must-haves section is missing (M9).

Every fix is to the report or to comments (docs-only) and needs no device run. With them, the report
supports a **conditional start**: no no-go trigger is measured as fired on Android, the iOS trigger is
undetermined, and the open items become G8's entry or exit gates. Whether that is enough to start G8 in 0.5
is the owner's call, not a reading of Q2.

## Go lines and no-go triggers, checked

| Row (Q2 §7) | Source at HEAD | Threshold as Q2? | Report | Review |
| --- | --- | --- | --- | --- |
| Typing works, both platforms | T18 `spike-text-typing`; this round's three controls type real keys | yes | pass | **pass** |
| Composition + `maxLength` | `spike-text-maxlength` both platforms (Android log 20:50:52, iOS xcodebuild-test.log:657 region); composition never opened | yes | cap pass, composition unmeasured | **correct**. ASCII only, so the emoji half is unmeasured, as the report says |
| Reject reverts, none lost, 10 keys/s | `spike-text-reject-rate` | yes | pass both | **Android pass. iOS not shown, likely one key lost (M4)** |
| First-keystroke→commit p95 ≤ RN × 1.5 | `spike-latency-first` (`android.mjs:2007`), `testRealInputSpikeLatencyFirst` | yes | pass; "Android decisive; iOS a bound" | **Android pass, with an arm-order confound (M2). iOS undetermined, and the bound points the other way (M3)** |
| Auto-grow ≤1 correction (D17) | harness `P4b` | yes | pass both | **pass for controlled JS writes. The user-typing path is unmeasured, and on iOS it is not noted, by reading (M10)** |
| N=200 leak-free | `P5 memory` vs `floors[0]` | yes | not met | **not met**, correctly reported. The single cycle can't tell a leak from a one-time pool (see Q&A) |
| X4's four rules | `X4` evidence row | yes (rules named) | 1 of 4 | **correct in substance**. The row and the summary disagree on which rule ran (N4) |
| Trigger: no IME-level oracle | as T18 | yes | no | **no** |
| Trigger: iOS needs `UITextField` and no coexist | `P1` | yes | no | **no, but P1 failed 3 of 10 iOS runs (M8)** |
| Trigger: latency > 2× | `spike-latency-first` | yes | no | **Android no. iOS undetermined (M3)** |
| Trigger: width-keyed growth unbounded | `P4`, `P4b` | yes | no | **no** (T18 review N4's caveat still applies) |

## Must (docs-only)

**M1. The verdict doesn't follow from Q2 §7.** `report.md:35-38,59-63`.

Q2's go needs every go line ("**Go** (numbers in the report): …", `Q2-textfield-research.md:150-155`). At
HEAD these are unmet or unmeasured:

- N=200 leak-free;
- composition;
- X4 rules 1, 3 (the declaration half) and 4;
- the iOS latency line (M3);
- the iOS reject line (M4).

None of the four no-go triggers is measured as fired on Android. Q2 says nothing about this middle case. The
report half-concedes it ("A literal 'every go line' reading is still unmet") and then heads the section **Go
for G8 in 0.5** anyway.

Two phrases also overreach:

- "Both blockers were instrument errors". True of T18's two, but iOS arm-B focus and iOS latency remain
  open (M3, M5).
- "the design is settled". The iOS arm is not chosen (M5).

Fix: head it **"Q2's go is not reached; no trigger measured as fired (iOS latency undetermined);
recommendation: start G8 in 0.5 with the items below as gates"**. Then list the open items as G8 entry or
exit criteria (M3, M4, M5, memory, composition, X4 1/3/4) rather than "three named items".

**M2. The Android latency pass is real but not "decisive", and the arm order is a confound.**
`report.md:22-24,47,59-61,142-147`.

What checks out (`android.mjs:2007-2141`, `SpikeTextFieldScreen.tsx` `LatencyField`):

- the release APK (`bundle: embedded in the APK` in all three logs);
- 36 samples per arm;
- one clock: device `date +%s%3N` against the app's `Date.now()`;
- both arms doing identical JS work;
- `percentile()` is nearest-rank, so p95 at n=36 is the 35th of 36 values, the second-largest. That is a
  real p95, though a thin one.

The shared injector cost is also not a problem. Subtracting the largest possible shared constant (each run's
minimum sample, 15/17/22 ms) leaves p95 ratios of 0.52×, 1.24× and 0.53×, all still inside 1.5×.

What the report doesn't say:

- The spike arm always runs first and RN second (`android.mjs:2064-2065`).
- In all three runs RN's samples change regime about halfway through. Run 20:02: the first 17 RN samples are
  15–20 ms, then 30–144 ms.
- Over the first 18 samples of each arm, the spike/RN medians are **2.00×, 1.62× and 1.31×**. Run 20:02's
  first-half p95 is 80 vs 40 = **2.00×**.
- The overall p95 ratios below 1 come from RN's late tail. The spike is not faster.
- The cause is unmeasured. Arm order, the growing text (no space in 36 characters) and RN's default IME
  options are candidates.

Fix: drop "decisive" and "at parity". State the fixed order, the first-half medians and the RN tail, and
label the three runs with their load:

| Run | Load (start / med / max) |
| --- | --- |
| 20:02 | 9.7 / 10.9 / 11.8 |
| 20:40 | 7.7 / 7.8 / 8.8 |
| 20:49 | 10.1 / 8.3 / 10.1 |

Say that G8 must alternate or interleave the arms. Also say how the release APK was built and stamped:
`build-app.mjs` only runs `assembleDebug` (`build-app.mjs:409`), the brief asks "say which", and the ledger's
`command` can't tell a release run from a debug one.

**M3. The iOS latency reading is framed backwards, so it cannot clear the >2× trigger.**
`report.md:30-31,47,56,62,148-151,249-252`.

Raw = commit − send-start. This includes XCUITest's pre-delivery overhead C, which is common to both arms.
For a spike that is slower, (C+x)/(C+y) < x/y. So 1.38× is a **lower** bound on the field's own ratio. It
does not support "not worse than 1.5×" (Q3).

The absolute numbers are large (`xcodebuild-test.log:580-582`):

- spike vs RN median: 415 vs 303 ms, **+112 ms per keystroke**;
- spike vs RN p95: 451 vs 326 ms;
- the spike arm's `typeText` call is 107 ms longer (612 vs 505 ms), which agrees.

RN's minimum is 290 ms, so C ≤ 290 ms. The trigger fires if C > ~190 ms: (415−C)/(303−C) > 2. This run
cannot exclude that.

It is also Debug, where the brief asked for release, and it measures arm B (`iosImplementation="textfield"`).

Fix: mark the iOS line **undetermined**, with the +112 ms absolute difference, and mark the latency trigger
"Android no; iOS undetermined". Rewrite Q3 accordingly (see answers).

**M4. iOS reject-rate: the check compares a cumulative count with a per-burst delta, and the iOS run is one
key short.** `report.md:26-27,46,155-158`; `RealInputTests.swift:1534,1580-1588`; `android.mjs:2182,2251`.

`nativeEvents` counts every user edit since mount, and the check takes no reading before the burst. The
warm-up `z` is therefore counted. The report itself says so for Android: "the frozen field counted 11 edits
(the 10 plus the warm-up key)" (`:152-153`).

On iOS the same counter read **9**: the warm-up plus **8** of the 10 burst keys. RN landed 9 of 10 from its
own burst. `spikeEvents >= rnLanded` passes (9 ≥ 9) only because of the warm-up. This is the same loss shape
T18 recorded (`866411d`: a revert racing the next key).

Fix:

- iOS row: **not shown; by the counter, one keystroke short of the calibration arm**.
- Android row: stays pass (11 = 10 + 1, RN 10/10).
- Follow-up: subtract a before-burst reading in both checks.
- The log line "counted 9 edits of its own from the same-shaped burst" is wrong, and so is the report's
  framing "XCUITest itself delivers 9 of 10".

**M5. iOS imperative focus lands on the SwiftUI arm only. On the hosted `UITextField` arm it is still
state-dependent.** `report.md:15-16,35-37,59-60`.

The final-tree iOS evidence (`.gates/logs/harness+ios-2026-10-28T21-21-36.353Z.log`, lines 16, 48 and 56):

| Arm-B instance | Focus |
| --- | --- |
| P5 loop, SwiftUI arm (`latencyArm`) | 6/6 |
| `late` arm B, boxed | lands |
| probe arm B, boxed | `spike_boxed=0 boxed_write=no-control` |
| P5 "other arm" B, unboxed | `focus:no-field`, now *asserted* (`TextFieldSpike.harness.tsx:1391`) |
| X4 arm B | `focus_ask=focus:no-field live=0` |

At 19:04 the P5 loop itself was red on arm B (`expected 0 to be greater than or equal to 1`), and the
response was to move the loop to the SwiftUI arm (`:81`).

That is T18's "state-dependent, cause unmeasured" finding, still true for arm B. Arm B is the arm T18 said
iOS needs for marked text and selection, and the arm this round's iOS real-input controls ran on.

Fix:

- Say focus lands on Android, and on the iOS SwiftUI arm through `focusBinding`.
- Say arm B's representable is sometimes never built (`live=0`), cause unmeasured.
- Name the iOS arm decision as open, or recommend one, and carry it as a G8 item. "The design is settled"
  should go.

Code comments to fix:

- `TextFieldSpike.harness.tsx:1318-1326` names arm B `swiftUIArm` and describes the SwiftUI binding, but
  mounts `textfield` on iOS.

**M6. The final-tree iOS numbers exist, and the report says they don't.** `report.md:18,76-78,123,134-137,
216-218`.

The failing full `harness:ios` run on `f4dcc1fc7285` printed every iOS evidence line
(`harness+ios-2026-10-28T21-21-36.353Z.log:16-60`):

- `p5_focus`: spike p95 110 / median 87.5, RN 126 / 109, **0.87×**, focus 6, blur 6, late focus 1, late blur
  1/1;
- `p4_auto_grow`: `22.0→44.0→66.0→86.3`, `corrections=1,1,1`;
- `x4` and `p5_mount`: 0.66×, not the "1.00×" at `:231`.

Fix: replace the pre-fix iOS rows with these, and drop the "iOS focus cost carried" item and its follow-up.

**M7. The red `harness:android` is misdescribed.** `report.md:112-117,239-245`.

The report says two suites failed (MountChurn and Host) on 30 s ceilings, at load 8–11. Here is what the
logs show.

*Run 21:29:45* (in the ledger and the table), started at load1 16.2. Four suites failed, five tests:

- `MountChurn` and `Host` (F8): timeouts;
- `HostControls` "follows mixed children…": timeout;
- `HostPopups`: two **assertion** failures (`expected 1 to be +0` at `:1202`, `expected +0 to be 1` at
  `:1248`).

*Run 21:35:44*, started at load1 10.6. It is **not in the committed `gates.jsonl`**: the export came before
it finished. Five suite failures, including Host's "native runtime disconnected" and `HostPopups` "opens
two popup owners…".

"Unrelated to the diff" holds:

- the diff touches only spike files (`git diff --stat 0e66cdd..HEAD`);
- the spike suite passed in both runs;
- `HostPopups` failed 10 tests on another branch on this machine the same day (F3 worktree, 12:48 run) and
  passed on rerun.

Fix: list the four suites and the assertion failures, give both runs and their loads, and re-export the
ledger.

**M8. The P1 arm-freezing failure is not a one-off, and it bears on a trigger row.** `report.md:109-111,
219-222,246-248,55`.

`expected 'textfield' to be 'swiftui'` at `TextFieldSpike.harness.tsx:658` appears in three of the ten
iOS runs that ran tests:

- 19:31:50 (`47fe04058ab8`), filtered;
- 19:35:06 (`950ccb3ab731`), filtered;
- 21:21:36 (`f4dcc1fc7285`), full.

The report says one failure and one pass. P1 is the coexistence scenario, the evidence behind "Coexistence
holds (`coexist=1`)".

Fix: give the 3/10 count, and qualify the trigger row: "no, but in 3 of 10 runs an arm frozen as `swiftui`
read `textfield`; cause unmeasured".

**M9. The brief's §Do 4 deliverable is missing.** The brief asks for "the G8 brief's must-haves (prop list,
`T | null` per the perf contract, events, methods, and the RN keyboard interop list from T18)". The report
has no such section. Fix: add it. Carrying T18's draft-API and interop sections over is enough, with T18
review N3/N6's corrections (`registerInput` is at `TextInputState.js:142`; callbacks are `?:` by design;
there is no `setValue`), plus this round's `focusBinding` and `FocusManager` design notes.

**M10. The auto-grow row covers controlled JS writes, not user typing.** `report.md:29-30,48`.

`P4b` grows the field through `field.set({ value })` with a `layoutWidth: 320` override
(`TextFieldSpike.harness.tsx:1002-1008`). The test title says "through onLayout", but the override bypasses
`onLayout`.

The iOS fix (`HybridNitroUiSpikeTextField.swift:985`) notes the content size only inside
`model.state.reconcile()`, which returns false when JS echoes what native already shows
(`ios/core/NitroUiModel.swift:78`). Neither the user edit path (`SpikeTextFieldCommit.user`, `:562`) nor the
echo makes the note. By reading, then, a user typing a newline into an iOS multiline field does not
re-measure.

Fix:

- Label the row "controlled writes".
- Mark the user-typing path **unmeasured**, with the reading above, as a G8 item.
- Rename the test, or drop "through onLayout".

**M11. Red proofs: two of three go red at a precondition, and the focus fixes' proofs are not in the
report.** `report.md:169-191`.

The three control proofs, checked against `/tmp/t18b-redproof.log`:

- `spike-text-maxlength` goes red at its own assertion (`displayed=abcdefgh`, log:7). Valid.
- `spike-text-reject-rate` goes red at "the frozen field to take focus … focused=0" (log:11), before any
  keystroke. The revert and no-loss assertions were never shown red, and M4 is the defect a "drop one key"
  mutation would have caught.
- `spike-latency-first` goes red at "no control with accessibilityLabel … latency spike field" (log:14), not
  at the commit-count or positive-sample checks. The report's explanation (the echo collapses, so the field
  disappears) doesn't follow, because the label belongs to the field.

The focus commits, against the ledger and logs:

- **4aadd6b** (Android blur through `FocusManager`) has a real red in the ledger: `expected '1' to be '0'`
  on the late field's blur at `ae0c564ca684`, `1bf4cdd81695` and `79787e22a03e` (17:33, 17:37 and 18:30).
  But the assertion that went red was later demoted to "recorded, not asserted", so it was never seen to
  turn green. The comments at HEAD still say "on Android `blur()` does not answer a field mounted later"
  (`TextFieldSpike.harness.tsx:1305,1386-1387`), which contradicts `report.md:16`'s "now both focuses and
  blurs". That claim rests on logcat (`late_blur_ask1/2=1`), which I couldn't check. By reading, the fix is
  correct and needed: `focusManager.clearFocus(force = true)` from `LocalFocusManager`, installed and
  restored in a `DisposableEffect`.
- **bd27213** (resolve the probe in `beforeAll`): T18's red is in this ledger (17:09, `481417989f1b`,
  `expected 0 to be greater than or equal to 1`) and the line is green after. Valid.
  - The report's "`spike_plain=0` → `spike_plain=1`" conflates platforms. T18 printed Android
    `spike_plain=1` already; the 0 was iOS. On Android the "before" value is not in any log.
- **5b29ee4** (SwiftUI `focusBinding`) was never run red. No iOS run timed the SwiftUI arm before it.
  T18's no-op assertion sat behind an early return, and this round's 19:04 red was arm B. Needed if G8 picks
  the SwiftUI arm. Correct by reading, with N2's recycle caveat.

Fix: say which proofs go red at a precondition, list 4aadd6b and bd27213 with their ledger rows, say that
5b29ee4 and the three iOS XCUITests have no red, and fix the stale comments.

## Nice

- **N1.** `report.md:227` and `controls.mjs:164-166` say `spike-latency-first` is Android-only and that iOS
  "would need a new XCUITest". It exists (`RealInputTests.swift`, `testRealInputSpikeLatencyFirst`) and it
  produced the 1.38×. Fix both.
- **N2.** `prepareForRecycle` clears `focusBinding` (`HybridNitroUiSpikeTextField.swift:1020`),
  and only the body's `onAppear` sets it again. If a recycled view's SwiftUI subtree doesn't re-appear,
  `focus()` answers `focus:no-binding` after recycle. This is unmeasured (X4 rule 4). Name it with the
  recycle item.
- **N3.** The Android reject burst took 747 ms on the frozen spike field against 190 ms on RN's field, for
  the same 10 keys (`input text` waits for the app). That is about 75 vs 19 ms per key on the reject path,
  an unexplained cost signal worth a follow-up line.
- **N4.** The X4 row says "1 of 4 measured", while the summary lists 1, 3 and 4 as unmeasured. So the
  measured one is rule 2, but the row describes rule 3's difference as measured. Make them agree. The X4
  citation `X4-conformance.md:33-39` starts mid-list: rule 1 is at `:28`.
- **N5.** Small arithmetic and wording slips:
  - 43.9 − 14.2 = 29.7, not 29.9 (`:49`). It is logcat-sourced, so give the unrounded floors.
  - "two more controls" should be three (`:44`).
  - Q1's "load1 8-11" vs the table's 16.2 start (`:241` vs `:90`).
- **N6.** `P5 memory` now asserts only `heldMiB > 0` (`TextFieldSpike.harness.tsx:1687`), which is fine for
  a spike. Say so in the row, so no reader takes the green suite as a memory check.
- **N7.** First-keystroke-into-idle is sampled 36 times at 150 ms spacing, so only sample 0 is the first
  keystroke after focus. Print sample 0 of each arm separately: that is the cold path Q2's wording most
  literally names.

## Premises

Everything cited exists at HEAD:

- `docs/tasks/T18-textfield-spike.report.md` (this branch's copy, without the review banner),
  `X4-conformance.md`, `B1-*`;
- `MountChurn.harness.tsx`, `Host*.harness.tsx`;
- `node_modules/@react-native-harness/runtime/src/render/index.ts:21-26` (matches);
- `ios/core/NitroSwiftUIHost.swift:259`;
- the fallback declarations at `HybridNitroUiSpikeTextField.kt:359-367` and `.swift:728-736` (both 44).

Quotes of Q2 §7 match the source ("a rejected change reverts with no lost character at 10 keys/s";
"first-keystroke→commit p95 ≤ RN `TextInput` × 1.5 in the same run"), and so does "focus latency has no
threshold in §7". The stale or contradictory comments are under M5, M11 and N1.

## Brief compliance and public-repo check

- The diff touches 10 files, all spike, test, runner or docs. Pass on all four:
  - `src/index.ts` is untouched;
  - no `component.json`;
  - no docs page;
  - no changeset.
- Committed files contain no home paths, emails, hostnames or personal device or app names, and neither
  does `gates.jsonl`. Its only `device` values are `emulator-5574` and the leased simulator UDID; its
  `logPath`s are repo-relative and its `command`s carry no paths. Gate logs under `.gates/` (not committed)
  carry home paths, as expected. Pass.
- Brief §Do 4 is not met (M9). §Do 1 asked for iOS "the same way" (release); iOS ran Debug, which the report
  discloses (M3).

## `bun run check`

Green on `ee7eef7` (Node 24, `NITRO_UI_MACHINE_LABEL=maintainer-mac-1`): 682 tests / 34 suites, plus 7 / 7,
and `package-files: tarball matches … (509 files)`. I ran plain `bun run check`, not `gate.mjs`, so it wrote no
ledger line. It matches the report's `check` row. As T18 disclosed, the spike's paths in
`etc/package-files.txt` would ship on a merge.

## Questions for orchestrator — recommendations

1. **The full `harness:android` bar.** Take (a): for a spike, accept the spike suite plus the real-input
   controls as device evidence. The failures are outside the diff, and `HostPopups` failed the same day on
   another branch on this machine. But the report has to describe them as they are (M7), and the four suites
   should get one `FOLLOWUPS.md` line against their owners (B1, F8, the Host popup work), since three
   different suites failing under load is a suite-health item in its own right. Don't raise ceilings in
   T18b.
2. **The `P1` flake.** It is 3 of 10 iOS runs, not 1 of 2 (M8), and it is the coexistence scenario. "Run it
   twice and attribute" is too weak. G8's first iOS step should run `P1` repeatedly (about 10 times,
   filtered) and attribute it before `P1` becomes a gate or carries the coexist trigger.
3. **An iOS latency number that resolves.** Yes, before G8 ships, because the current reading cannot
   exclude the >2× trigger (M3). It is not a reason to hold the start of G8. Make it G8's first instrument
   task, with a release build and a stamp taken at delivery inside the app rather than at the injector: for
   example, an event-time hook in the example app applied to both arms, so XCUITest's 300–600 ms drops out
   instead of compressing the ratio. The same instrument should interleave the arms on Android (M2).

N=200 memory (the report's carry 1) needs no question. Run `MountChurn`'s multi-cycle `floors[]` shape on
the spike before G8 claims leak-free: one cycle can't tell a one-time pool from a per-field leak, and
29.7 MiB of a 36.1 MiB mount is too much to assume either way.

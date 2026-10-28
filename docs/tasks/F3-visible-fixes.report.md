# F3 — Three consumer-visible fixes: `fillWidth` width, `builtBounds`, `tintColor`

**Branch:** `task/F3-visible-fixes` (from `main` at `b943a3f`) · **Round:** 1, plus fix round 1 (D19, up to 2) ·
**Lease:** `F3-zyn3n`, then `F3-63kbr` (iPhone Air iOS 27 sim `331EF109…8DC3` / `emulator-5570`
`nitroui_t01`, adb 5041, Metro 8293)

## Summary

All three `docs/tasks/Q4-followups-triage.md` rows are done: two fixes, and one documented
outcome reached by measurement rather than by repeating last round's claim.

**Row 10 — `fillWidth` handed an unbounded parent another instance's width.** Fixed in the
engine (`filedSizeLocked`), not in a component: a `fillWidth` report's width is a restatement
of the box about to replace it, so it is no longer filed and the component's *declared* width
is substituted instead. Two host expectations asserting the old "last box width wins" (`300`)
became the declared `328`.

**Row 46 — `DatePicker` rebuilt a calendar it did not need to.** The `.onAppear` recording
`builtBounds` sat *outside* `.id(_:)`, so it fired once per mount while the identity kept
changing, and iOS's escape clause compared the displayed value against bounds nobody was
showing. Recording inside the identity makes record and identity agree, and makes rebuilds
observable on both platforms; Android gained the same two fields so one test asserts the
mechanism, not one platform's quirk. Fix round 1 removed a second rebuild the review found:
widening a bound and moving the value out of the old one cost iOS two replacements.

**Row 27 — `tintColor` on iOS: still a no-op, now on evidence.** The prop's only reading was
a prop echo, which is how it reported a colour as applied for three releases. `docs` claimed
the knob was unreachable; on iOS 27 it is not — the new pixel probe finds a real
`UISegmentedControl` and writing its `selectedSegmentTintColor` paints 9253 px of magenta in a
102×31 pt control. It does not *stay* painted: after the first change of selection the colour
is off the screen while the property still reads back what was written, and neither of the two
re-write timings tried put it back. Measured on iOS 27 only. A tint that survives until the
first touch is worse than a prop that never did anything — so it stays documented
Android-only, and both platforms are now asserted that way.

**Spec surface:** the brief is patch-level, and this branch adds two methods to
`SegmentedControl.nitro.ts` (`nuiTestPixelProbe`/`nuiTestPixelReport`). They are test-only and
`@internal` — no app-visible prop changed shape (the api report diff is those two lines inside
the existing `hybridRef` type) — and they follow DatePicker's precedent. Every other reading
this control offers is a prop echo, so without a pixel oracle the docs cannot be contradicted,
which is the defect row 27 is about.

## Gates

Round 1's table, for the record: the fix commits replaced this tree, so read
`## Fix round 1`'s fresh table as the gate evidence.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 665 tests / 33 suites | `c047fa692f33` | 2 m 26 s | start 10.2 / med 16.5 / max 19.4 |
| `harness:ios` | **PASS** | 168 tests / 13 suites | `c047fa692f33` (ios tree) | 2 m 03 s | start 12.2 / med 8.4 / max 12.3 |
| `harness:android` | **PASS** | 217 tests / 13 suites | `c047fa692f33` (android tree) | 6 m 19 s | start 11.7 / med 10.8 / max 17.0 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:android:DatePicker` | stale | 14 tests / 1 suites | d16b552b6068 (not this tree) | 41.4 s | start 6.7 / med 8.2 / max 9.8 |
| `harness:android:HostPopups` | **PASS** | 24 tests / 1 suites | `c047fa692f33` (android tree) | 1 m 00 s | start 8.5 / med 10.7 / max 12.5 |
| `harness:android:SegmentedControl` | stale | 19 tests / 1 suites | 9522e90f25fc (not this tree) | 41.8 s | start 10.9 / med 13.4 / max 16.9 |
| `harness:android:Slider` | stale | 22 tests / 1 suites | e381a792ba30 (not this tree) | 36.9 s | start 9.7 / med 9.8 / max 10.1 |
| `harness:ios:Button%7CHostPopups` | **FAIL** | 1 failed of 16 tests / 2 suites | `c047fa692f33` (ios tree) | 19.0 s | start 6.4 / med 6.5 / max 6.7 |
| `harness:ios:DatePicker` | stale | 1 failed of 14 tests / 1 suites | 086cc2929bb4 (not this tree) | 22.7 s | start 6.7 / med 6.7 / max 6.7 |
| `harness:ios:DatePicker%7CHostPopups` | **FAIL** | 1 failed of 18 tests / 2 suites | `c047fa692f33` (ios tree) | 28.8 s | start 9.8 / med 8.8 / max 9.8 |
| `harness:ios:HostControls%7CHostPopups` | **FAIL** | 2 failed of 15 tests / 2 suites | `c047fa692f33` (ios tree) | 19.1 s | start 9.1 / med 8.8 / max 9.1 |
| `harness:ios:HostPopups` | **PASS** | 4 tests / 1 suites | `c047fa692f33` (ios tree) | 12.0 s | start 8.8 / med 8.9 / max 9.0 |
| `harness:ios:Picker%7CHostPopups` | **FAIL** | 1 failed of 42 tests / 3 suites | `c047fa692f33` (ios tree) | 40.8 s | start 6.8 / med 7.4 / max 8.2 |
| `harness:ios:Progress%7CHostPopups` | **PASS** | 17 tests / 2 suites | `c047fa692f33` (ios tree) | 15.7 s | start 6.7 / med 6.8 / max 6.8 |
| `harness:ios:SegmentedControl` | stale | 19 tests / 1 suites | 9522e90f25fc (not this tree) | 23.1 s | start 18.4 / med 15.6 / max 18.4 |
| `harness:ios:SegmentedControl%7CHostPopups` | **FAIL** | 1 failed of 23 tests / 2 suites | `c047fa692f33` (ios tree) | 25.7 s | start 8.0 / med 9.7 / max 10.2 |
| `harness:ios:Switch%7CHostPopups` | **PASS** | 19 tests / 2 suites | `c047fa692f33` (ios tree) | 16.3 s | start 8.8 / med 9.7 / max 9.8 |

`need --for review`: `need: review is satisfied on this code tree.` (three required gates
green: `check`, `harness:ios`, `harness:android`.)

How to read the rows above, because the table is not what it looks like:

- **The `harness:ios:*Popups` FAILs are not F3 failures.** Those are the paired-suite runs I
  used to *bisect a pre-existing iOS race*; they are left in the ledger on purpose. When
  `HostPopups.harness.tsx` runs after a suite that sorts before it, its first
  hosted-control `hybridRef` sometimes has not arrived: `No hybrid handle for "segmented
  row" - the control never mounted`. I reproduced it at the review base: `b943a3f`, same
  simulator, `harness:ios -- "Button|HostPopups"` → `1 failed of 16`, same line, same test;
  and the base's *full* run lost the same race on its sibling assertion —
  `HostControls.harness.tsx` › `expect(log.sliders['slide-0']).toBeDefined()` → `expected
  undefined to be defined`, 1 failed of 165. Both files' own comments already say a handle
  arriving is not what they mean to assert, so this is their race to fix, not a wait F3
  skipped. Suites that sort after `HostPopups` (`Progress`, `Switch`) never trigger it. The
  full suite hits it intermittently — three of my four full runs failed one test and the
  fourth was green — and the base failed the same way. It is out of scope for F3 (D19) and
  recorded as a follow-up. The green `harness:ios` row is this tree passing the full suite.
- **The `stale` rows, read correctly** (N8: this note first said "the three `stale` rows are
  the per-suite green runs", and both halves of that were wrong). The table has **five**. Four
  are green per-suite runs from commits inside this branch (`66cb343`…`e979146`) on trees the
  later report commits replaced; those suites are green again inside the full-suite rows, which
  are on this tree, and `need` does not ask for them. The fifth, `harness:ios:DatePicker`
  (tree `086cc2929bb4`, 1 failed of 14), is **red on purpose**: the `.onAppear`-order mutation
  from Red proofs below. The five `harness:ios:*Popups` FAIL/PASS rows are not stale at all —
  they are this tree's own bisect runs of the race above, and four of them are red by design.
- **`real-input:*` was left unrun**, and the reason printed here first ("no gate here drives a
  window the harness cannot reach") was wrong: that is true of the *review* bar only.
  `need --for merge` asks for both, and both are green on the fix round's tree (M5).

## Red proofs

- `scripts/native-tests/sizing.test.cpp` (row 10) → engine as shipped before `66cb343` →
  `got 200.000000x40.000000, want 328.000000x40.000000`.
- `Slider.harness.tsx` › *hands an unbounded parent its declared width…* (row 10) → `cpp/
  NitroUiSizingEngine.{cpp,hpp}` reverted to `66cb343~1`, Android device →
  `the unbounded Slider's box never became 240 wide (last=200.00x923.43, the other instance's
  box was 200, the guess was 240x12)`. Green on both platforms with the fix. Not run red on
  iOS: the engine is shared C++ and the red line above is the shared mechanism; the device
  case is the on-screen confirmation.
- `DatePicker.harness.tsx` › rebuild-count assertion (row 46) → old `.onAppear` order, iOS
  device → `expected 4 to be greater than 4` (the counter was blind to every rebuild).
- `DatePicker.harness.tsx` › record-vs-identity assertion (row 46) → same mutation, iOS
  device → `expected 1766232000000 to be 1768910400000` (`builtMaximum` frozen at the first
  build while React and the identity both said the widened one). Not mutated on Android: the
  two fields are new there, so pre-fix it reports the sentinel rather than a wrong bound, and
  the red leg is iOS's by construction.
- `SegmentedControl.harness.tsx` › *shows tintColor on the selected segment…* (row 27) → the
  iOS half asked for the colour instead of its absence, iOS device →
  `"painted" after tintColor="#FF00A0" (iOS): expected the probed colour to be present on
  screen, and the platform said … hits=0 mean=#8FAFB6EB closest=#9B9BA0` (that `mean` is the
  eight-digit overflow the fix round's N3 repairs; quoted as measured). That is the proof
  the oracle reads the screen: the same assertion, run against the version that *did* push a
  tint, read `hits=9253 … closest=#FF00A0`.
- `SegmentedControl.harness.tsx` › the probe's own control cases → nothing mutated: "absent
  before any tint was sent" and "absent on the untinted neighbour" both pass, so a probe that
  reported a hit whatever it saw would already be failing.
- **Not shown red:** the Android neighbour-safety assertion (`"plain" beside a tinted
  control`). I tried the `UISegmentedControl.appearance()` shape of bug — a process-wide leak
  of the last tint onto an untinted control — and the neighbour stayed on the scheme, because
  Compose does not re-read that control's colours when its neighbour's tint changes. So that
  assertion is a guard, honestly labelled, not a mutation-proven one.
- `HostPopups.harness.tsx` › `parseDateReport` field count → not a new test, and it went red
  on its own when row 46 appended two fields: `Date report is not six fields:
  "1778972400000|0|-1|-1|0|0|-1|-1"`, eleven gates, Android. Updated to eight and green.

## Files changed

- `cpp/NitroUiSizingEngine.{hpp,cpp}` — row 10's `filedSizeLocked`; `docs/architecture/sizing.md`
  §5, `docs/components/slider.md`, `docs/components/progress.md` and the four Slider/Progress
  declarations state the rule it now follows (fix round: M4, N5).
- `ios/components/DatePicker/HybridNitroUiDatePicker.swift`,
  `android/…/HybridNitroUiDatePicker.kt`, `src/components/DatePicker/DatePicker.nitro.ts` —
  row 46's `.onAppear` move, `builtMinimum|builtMaximum` on both platforms, report shape.
- `example/__tests__/DatePicker.harness.tsx` — the new assertions, the iOS rebuild half, and the
  one-rebuild assertion (14 tests, base 13).
- `ios/components/SegmentedControl/HybridNitroUiSegmentedControl.swift`,
  `android/…/HybridNitroUiSegmentedControl.kt`, `SegmentedControl.nitro.ts`,
  `SegmentedControl.tsx`, `NativeNitroUiSegmentedControl.ts`, `nitrogen/generated/**` — the
  pixel probe, and `OptionalSegmentedTint`'s measurements behind the iOS no-op.
- `example/__tests__/SegmentedControl.harness.tsx` — the pixel test (19 tests) and its
  `pixelProbe`/`expectPixels`/`tapSegment` helpers.
- `example/__tests__/Slider.harness.tsx` — the unbounded-parent case; `example/__tests__/
  HostPopups.harness.tsx` — the report's eight fields.
- `docs/components/segmented-control.md`, three `.changeset/*.md`,
  `etc/react-native-nitro-ui.api.md`, `docs/tasks/F3/gates.jsonl`,
  `docs/tasks/F3/base-race-gates.jsonl` (fix round: N2), this report.

## Follow-ups

- `example/__tests__/HostPopups.harness.tsx` + `HostControls.harness.tsx`: pre-existing iOS
  race where a hosted control's `hybridRef` has not arrived when the next test reads it,
  reproducible at `b943a3f` by running the suites in pairs (evidence committed at
  `docs/tasks/F3/base-race-gates.jsonl`, and measured again in the fix round). Worth its own
  task; the guard's message is already the right one, so the fix is the wait or the isolation.
- `real-input:ios`'s `switch`: one `("off") is not equal to ("on")` at load median 60, green
  alone (`--control switch`) and green in the full re-run. Same family as the race above, under
  XCUITest rather than the harness.
- `harness:android:Slider`'s `steps to the next legal value when a screen reader asks` failed
  once (`The accessibility step probe never reported`, tree `e381a792`, 12:43:53) between two
  greens on that tree at load1 9.7–12.4. A third sample of the busy-device family (N8).
- `DatePicker`: the escape clause's own case (a bound moving below the control's granularity)
  still costs one rebuild on the render after the bound moves, and no test covers it — it needs
  a sub-minute move on a `time` picker. `controlIdentity`'s comment states it; say the word if
  it should be asserted rather than documented.
- `SegmentedControl`: if iOS ever applies a per-instance tint, `shows tintColor…` goes red on
  the iOS half — that is the day the prop and the docs change, and the probe is already there.
- `SegmentedControl`: the probe's `mean=` field is asserted for shape only (fix round, N3/N9);
  a future round can assert a value now that the arithmetic is right.
- `DatePicker`: `builtMinimum|builtMaximum` are test-only fields in a permanent report shape;
  say whether they should be dropped once row 46's rule has held for a release.
- Perf contract: unchanged by construction (no props path changed), and `check`'s
  `perf:renders` is green; nothing here re-measures the G4 bench arms.


## Fix round 1

Review verdict FIX ROUND; all five M items and the cheap N items are done. M1 was a real
second rebuild, not a wording problem: widening a bound and moving the value out of the old one
in a single batch cost iOS two builds, because `builtBounds` is recorded by the new control's
appearance without republishing, so the identity on screen read `<granular>|outside` and the
next render of any prop read plain `<granular>` — a second `.id(_:)` change, and the page or
wheel position lost one render later than anyone would look. `controlIdentity` now skips the
suffix when the granular part has already moved on. The assertion the review named is enabled
on iOS and was red first: `expected 9 to be 8`. M2's iOS rebuild assertion is enabled and
proven by putting the handler back outside `.id(_:)` (`…still reports 2 builds, want more than
2`), which is the old comments' "measured not to move it" reproduced exactly — an artefact of
the pre-F3 instrument, and both comments are corrected. M3, M4 and N1–N10 are in the commits
named at the end.

### Gates on this tree

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 665 tests / 33 suites | `18da47b86583` | 2 m 11 s | start 3.2 / med 4.1 / max 4.8 |
| `harness:ios` | **PASS** | 168 tests / 13 suites | `18da47b86583` (ios tree) | 2 m 08 s | start 44.5 / med 62.8 / max 113.3 |
| `harness:android` | **PASS** | 217 tests / 13 suites | `18da47b86583` (android tree) | 5 m 60 s | start 6.7 / med 5.3 / max 8.2 |
| `real-input:ios` | **PASS** | — | `18da47b86583` (ios tree) | 8 m 09 s | start 3.0 / med 12.8 / max 112.9 |
| `real-input:android` | **PASS** | — | `18da47b86583` (android tree) | 11 m 53 s | start 5.2 / med 5.2 / max 88.4 |
| `harness:android:DatePicker` | stale | 14 tests / 1 suites | cb5193a17358 (not this tree) | 40.1 s | start 54.9 / med 40.1 / max 54.9 |
| `harness:android:HostPopups` | stale | 24 tests / 1 suites | c047fa692f33 (not this tree) | 1 m 00 s | start 8.5 / med 10.7 / max 12.5 |
| `harness:android:SegmentedControl` | stale | 19 tests / 1 suites | 9522e90f25fc (not this tree) | 41.8 s | start 10.9 / med 13.4 / max 16.9 |
| `harness:android:Slider` | stale | 22 tests / 1 suites | e381a792ba30 (not this tree) | 36.9 s | start 9.7 / med 9.8 / max 10.1 |
| `harness:ios:Button%7CHostPopups` | **PASS** | 16 tests / 2 suites | `18da47b86583` (ios tree) | 21.1 s | start 6.8 / med 11.9 / max 12.1 |
| `harness:ios:DatePicker` | stale | 14 tests / 1 suites | 33281f522ad9 (not this tree) | 44.0 s | start 136.4 / med 134.1 / max 141.9 |
| `harness:ios:DatePicker%7CHostPopups` | **PASS** | 18 tests / 2 suites | `18da47b86583` (ios tree) | 33.1 s | start 11.9 / med 15.1 / max 18.4 |
| `harness:ios:HostControls%7CHostPopups` | stale | 2 failed of 15 tests / 2 suites | c047fa692f33 (not this tree) | 19.1 s | start 9.1 / med 8.8 / max 9.1 |
| `harness:ios:HostPopups` | stale | 4 tests / 1 suites | c047fa692f33 (not this tree) | 12.0 s | start 8.8 / med 8.9 / max 9.0 |
| `harness:ios:Picker%7CHostPopups` | stale | 1 failed of 42 tests / 3 suites | c047fa692f33 (not this tree) | 40.8 s | start 6.8 / med 7.4 / max 8.2 |
| `harness:ios:Progress%7CHostPopups` | stale | 17 tests / 2 suites | c047fa692f33 (not this tree) | 15.7 s | start 6.7 / med 6.8 / max 6.8 |
| `harness:ios:SegmentedControl` | **PASS** | 19 tests / 1 suites | `18da47b86583` (ios tree) | 35.7 s | start 77.7 / med 114.6 / max 125.2 |
| `harness:ios:SegmentedControl%7CHostPopups` | **FAIL** | 1 failed of 23 tests / 2 suites | `18da47b86583` (ios tree) | 23.9 s | start 14.8 / med 13.8 / max 14.8 |
| `harness:ios:Switch%7CHostPopups` | stale | 19 tests / 2 suites | c047fa692f33 (not this tree) | 16.3 s | start 8.8 / med 9.7 / max 9.8 |
| `real-input:ios:--control:switch` | **PASS** | — | `18da47b86583` (ios tree) | 25.0 s | start 11.6 / med 10.2 / max 11.6 |

`need --for review`: `need: review is satisfied on this code tree.`
`need --for merge`: `need: merge is satisfied on this code tree.` — M5 done; round 1's sentence
about `real-input:*` not being required held only for the review bar.

**Reading the rows that are not PASS** (N8, correcting round 1's note, which said "three" and
implied all green): there are **ten** `stale` rows. Six are green per-suite runs from commits
inside this branch whose trees later commits replaced, and all six suites are green again inside
the full-suite rows above, which are on this tree; `need` does not ask for them. Four are the
round 1 race-bisect runs (`HostControls|HostPopups`, `Picker|HostPopups`, `HostPopups`,
`Switch|HostPopups`), two of them red on purpose. The one **FAIL** on this tree is deliberate
and is the race evidence: `harness:ios -- "SegmentedControl|HostPopups"` reproducing the
handle race on the final tree, discussed below. Left in rather than re-run away, because a
ledger that only shows greens is not evidence.

### Red proofs added this round

- `records the bounds…` › `afterFlips` on iOS (M1) → suppression removed from
  `controlIdentity` → `expected 9 to be 8`. A temporary per-step probe run before that read
  `built0=8 widened=9 afterFlips=10` with the extra build landing on the *first* flip's render;
  the probe is removed from the tree and its numbers live in this line and the test's comment.
- `keeps the live control…` › the iOS half the review asked for (M2) → `.onAppear` put back
  *outside* `.id(_:)` → `did not rebuild "fresh-dialog": "…" still reports 2 builds, want more
  than 2`, 2 failed of 14. That is the blindness the deleted comments mistook for a SwiftUI fact.
- `pixelProbe` › the report's own shape (N3) → iOS's alpha-weighted `mean` arithmetic put back →
  `reported a mean that is not six hex digits: n=1 size=102x31 want=#FF00A0 hits=0
  mean=#8FAFB6EB`, 1 failed of 19; green with the division fixed. So the field a later round was
  invited to assert on cannot silently break again.
- `real-input:ios` (M5) → not a mutation but a first-run failure worth recording: `switch`
  failed once, `XCTAssertEqual failed: ("off") is not equal to ("on") - one real tap should flip
  the Switch`, at load1 21 / median 60. Green alone (`--control switch`, 14.4 s) and green in
  the full re-run (13/13). Both merge gates green on this tree; it is a follow-up line, not a
  passing run I kept quiet about.

### M5, N1 and the race, with committed evidence

**M5.** `real-input:ios` and `real-input:android` both run on this tree: green, 13/13 controls
each. Round 1 left them unrun on a wrong reading of the bar.

**N1**, one line: `NitroComposeHost.kt:1537-1538`, the brief's pointer to `Constraints()` as the
measure block's last resort, is not the cause and was left alone — under Fabric that `Layout` is
always handed a bounded width, so the branch is a theoretical last resort; the width reaching
the screen came from the engine's cache, which is where the fix is.

**N2.** The base-run evidence lived only in this machine's `.gates/detached.jsonl` and would have
died with the worktree, so it is committed verbatim at `docs/tasks/F3/base-race-gates.jsonl`
(five gate lines, each with its log path). Re-running it, base and F3 back to back on the same
simulator with the machine otherwise idle:

| Tree | Full `harness:ios` runs | Paired runs |
| --- | --- | --- |
| base `b943a3f` (`35948172`) | 4: 1 fail, 3 pass | `Button\|HostPopups` → 15/16 fail, same test, same line |
| round 1 `461e21e` (`c047fa69`) | 4: 3 fail, 1 pass | 7 pairings: 3 pass, 4 fail |
| fix round (`18da47b8`) | 3: 0 fail, 3 pass | 5 runs: 4 pass, 1 fail (`SegmentedControl\|HostPopups`, 22/23) |

The commands are
`set -a && . /tmp/f3b.env && set +a && export NITRO_UI_MACHINE_LABEL=maintainer-mac-1 ANDROID_HOME="$HOME/Library/Android/sdk" && export HARNESS_APP_PATH=… && fnm exec --using 24 -- node scripts/gate.mjs harness:ios -- "Button|HostPopups"`,
the base's failing line is `No hybrid handle for "segmented row" - the control never mounted.`,
and at the base's own full run it is the sibling in `HostControls.harness.tsx`:
`expect(log.sliders['slide-0']).toBeDefined()` → `expected undefined to be defined`, 1 failed of
165. Both are re-runnable from the committed JSONL.

**Said plainly, as asked.** Round 1's 3-of-4 does look worse than base's 1-of-4 and I will not
wave that away. What I measured this round: **0 of 3 full runs failed on the final F3 tree, 1 of
4 on base** — and one of those three F3 runs ran at load1 44 / median 63 and still passed, so
"it only passes when the machine is quiet" is not the story either. Round 1's three failures all
happened while another task (T18) was building and running the iOS harness on this machine with
three further simulators booted, which is a plausible confound and not proof. What is not in
question is that F3 neither creates nor worsens it: the same pairing still fails on the final
tree exactly as it does at base, it fails on whichever hosted control reads a `hybridRef` first,
and the base failure was a Slider's handle. Adding `@internal` methods to a spec does not delay
`hybridRef`. It stays out of scope (D19) and keeps its follow-up line, now with data attached
instead of my word.

### Commits this round

- `ca515ea` fix(date-picker): a widen-plus-move batch costs one rebuild, not two — M1, M2, N6
- `9ec044d` docs(segmented-control): say only what iOS 27 was measured to do — M3
- `04b8fe3` docs(sizing): the declared width is what an unbounded parent draws, everywhere — M4, N4, N5
- `cdbf7d7` fix(segmented-control): make the probe's mean readable, and keep it that way — N3, N7, N9, N10
- this commit — M5 (both real-input gates), N1, N2, N8, and the report

**Skipped N items:** none. N1–N10 are all done; N2 and N8 are in this commit, and the two whose
fix was a wording correction (N4, N6) are in the commits above.

# G28 — ConfirmationDialog rows: Material 3 Expressive on Android

**Branch:** `task/G28-dialog-rows` (from `main` at `c3b26ac6`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `G28-fn0rg` (`pair-a`: `iPhone 17` / iOS 27 + `emulator-5574` / API 35 · Metro 8295)

## Summary

The confirmation sheet's Android rows are the Expressive segmented row: `SegmentedListItem` with
`ListItemDefaults.segmentedShapes(index, count)` — Q8 row 16's second candidate, adopted as D40's
pass 3 B for Dialog. **Both candidates were built and photographed on the leased device**
([segmented](G28/rows-segmented.png),
[interactive](G28/rows-interactive.png)): the segmented one reads as one card inset inside the
sheet — `CornerLarge`'s 16 dp at the group's outer corners, `CornerExtraSmall`'s 4 dp at the ends
facing the next row, material3's own 2 dp gap between segments, and a press that morphs the row —
while `ListItem(onClick, enabled, …)` is a
full-bleed row with no group. Nothing but the look separates them: with the interactive row swapped
in, only the shape assertion moved, the disabled-state and press checks stayed green — the call was
made on the device, not on the API.

`disabled` is now the row's own `enabled = false` rather than a `clickable` wrapper and a hand-picked
`0.38` alpha on the label: the row takes the press, says `disabled` to TalkBack and paints itself
faint. `destructive` and `tintColor` replace only the *enabled* content colour, so a disabled
destructive row is drawn disabled and `tintColor` still colours the action text. `DISABLED_CONTENT_ALPHA`
left the file. Order, cancel handling, `dismissible`, "an action always closes", `titleVisibility`,
hosting, recycling and the `AlertDialog` are untouched, on iOS as on Android.

The harness cannot press or read a second window, so the sheet can be asked for one row probe,
answered from inside it: `rows=` is each row's own merged accessibility node (`~` = disabled, the
mark `Menu`'s probe writes) and `radii=` each row's corner radius in dp off the sheet window's
pixels. It is asked by a reserved action id through `nuiTestPerformAction`, not by reading the
report - the read costs a bitmap draw of the window, so arming it on every poll was wrong (fix
round 1). Both halves are the component's own state, not the props behind it, and one mutation
proves `radii=` is measured: loosening the probe's colour tolerance collapses every corner to the
probe depth with nothing in the composition changed.

Real input does the part the harness cannot: the tree's `enabled="false"` is pressed. The log is
snapshotted **with the sheet down** (the sheet owns the dump while it is up — the first version of
this check aborted on exactly that), one tap on the disabled row, then the row count and the log
again: no action, sheet still up, and Back's close the only entry the sheet is allowed to add.
`confirmation-dialog-android.png` was retaken (720 px, light, Storybook) — the card is a visible
change from the full-bleed rows, and the README shows it.

## Gates

The one gate table in this report is the generated one at the end, under **Gates (fix round 1)**:
`gate.mjs table` prints one row per run recorded against the tree in front of the reader, and fix
round 1 replaced round 1's tree, so round 1's table can no longer be pasted beside it. Round 1's own
runs are untouched in the committed ledger — the twenty lines of
`docs/tasks/G28/gates.jsonl` whose branch is `task/G28-dialog-rows`, code tree `a21c6d004613` — with
a scrubbed excerpt of each failed run in `docs/tasks/G28/failures/`. Read from that ledger, round 1
was: `check`, `harness:ios`, `real-input:ios` and `real-input:android` green, and `harness:android`
red on one line that is not this task's.

`need --for review` exits 1 with one line — `need: 1 gate(s) missing for review: harness:android` —
and that row is not this branch's:

- **`harness:android`** — 617 passed, 1 failed: `Form (G24) › starts a recycled Form at the top of its
  own content`, `expected 200 to be less than or equal to 1` (`Form.harness.tsx:1266`). That is X23's
  brief verbatim, line number and all. `docs/tasks/STATUS.md` carries its cause (a recycled Android
  Form keeps its cached test report, so the case reads the previous Form's offset), the one-line reset
  in `prepareForRecycle` that fixes it, and PR #60 — none of which was on `main` yet at the time of
  writing (fix round 1 merged it, and the full suite is green on that tree). The same line
  went red in G26's, G27's and X22-fix1's full runs, none of which touched Dialog, and it goes red on
  this branch with `harness:android -- Form` (the filtered run named in the ledger above), where the Dialog suite never runs at
  all — so nothing in this diff is in its path. `Form.harness.tsx` is untouched here, X23 is not
  G28's to fix (D19), and re-running the suite cannot make it green.

The four gates this task can move are green on `a21c6d004613`: `check` (1993 tests), `harness:ios`
(565), `real-input:ios` (40 m 15 s) and `real-input:android` (58 m 13 s). The last one now presses the
sheet's disabled row and reads the sheet's rows back, green while the row honours `enabled`. The
filtered rows are the red proofs and the Form re-run; a filtered run satisfies nothing but its own
name. `gate.mjs export --task G28` puts the ledger and the failed runs' excerpts beside this report.

## Red proofs

Full data in `docs/tasks/G28/mutations.json`, with the tree digest
each run was keyed to. Each line is one source mutation restored afterwards; the last is fix round
1's single-hunk run, and round 1's first two are the two-hunk pair it reinterprets.

The new test - `Dialog.harness.tsx` › *reports the sheet rows as the component draws them, disabled
included*, and `CHECKS.dialog`'s new press of the disabled row:

- new harness test -> `enabled = !action.disabled` becomes `enabled = true`, and
  `if (action.disabled) return` leaves `DialogModel.performAction` ->
  `expected 'Locked,Go,Wipe' to be 'Locked~,Go,Wipe'` - the row stops saying it is disabled
- new harness test -> the rejected candidate: interactive `ListItem(onClick, enabled, …)` in place of
  the segmented row -> `expected '4/4,4/4,4/4' to be '16/4,4/4,4/16'` - only the shape assertion
  moved, which is what makes the candidate choice a look decision
- new harness test -> `ROW_PIXEL_TOLERANCE = 6` becomes `64`, so the sheet's background counts as the
  row's container -> `expected '1/1,1/1,1/1' to be '16/4,4/4,4/16'`, with nothing in the composition
  moved: `radii=` is measured off pixels, not restated from the shapes argument
- new real-input check -> the `enabled`/guard mutation again -> `a real tap on the disabled row leaves
  the sheet up - expected 1, saw 0` and `"and reports nothing: the log gained only Back's close" …
  saw … > action:locked-row > presented:false` - a finger, not a dump, caught it
- the shape probe's own fixture guard: the expected `16/4,4/4,4/16` is material3's
  `CornerLarge`/`CornerExtraSmall`, and neither mutation above reads it by accident - the swap reads
  `4/4,4/4,4/4` and the tolerance reads `1/1,1/1,1/1`

Two more lines, one of them not a red:

- `CORNER_PROBE_DEPTH_PX = 3` becomes `1` **stayed green** (31/31), because the inversion works from
  any depth and one pixel of anti-aliasing is inside the tolerance - recorded so `radii=` is not
  credited with a proof it does not have
- organic, and the bug the wait is for: the test's first run timed out on
  `probe=n=598 … radii=?-moving,?-moving,?-moving` (`harness:android:Dialog`, 08-43-25Z) - a sheet
  still on its way up measures below the window, so the probe refuses to guess. Sleeping past the
  slide-in and polling an answer with no `?` is what the test now does.

And the two existing checks the same mutation catches. Round 1 read these two lines as proof that
the row, rather than the model, was now the thing refusing a press. That was wrong and fix round 1
corrects it: this mutation deleted the guard in `DialogModel.performAction` as well, and every press
in the harness goes through `nuiTestPerformAction` → that guard, so nothing here isolated the row.
What the row's own `enabled` is proven by is the two *state* reads — the `~` in the accessibility
dump and the colour the label was painted with — and a press check proves only that nothing happens,
whichever layer stops it. The single-hunk run that separates them is the last row of
`docs/tasks/G28/mutations.json` (fix round 1): `enabled = true` alone reddens exactly those two
state lines, the alert half stays green, and no press line goes red at all.

- `takes no tap on a disabled action, and draws it disabled (alert)` -> same mutation ->
  `expected 'locked:action:locked,locked:presented…' to be ''` - the deleted guard, not the row, was
  the last thing between a disabled alert button and `onAction`
- the same test's confirmation half -> same mutation -> `expected '1,1,1' to be '1,0,1'` - the
  disabled row stops being drawn faint: read from what was drawn rather than from the flag, and the
  one line here that is the row's own

## Files changed

- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiDialog.kt`: the rows on
  `SegmentedListItem` with the row's own `enabled`; `DISABLED_CONTENT_ALPHA` gone; the row probe
  (`armRowProbe` / `RowProbeWitness` / `describeConfirmationRows`) and the `ROW_MARK` semantics key
- `example/__tests__/Dialog.harness.tsx`: one Android-only test that reads the open sheet back
- `scripts/real-input/android.mjs`: `CHECKS.dialog` presses the disabled row, and reads the log only
  with the sheet down
- `docs/components/dialog.md` (the Android column, the platform mapping row, the a11y paragraph),
  `.changeset/g28-dialog-rows.md` (minor — the disabled row is a visible change), and
  `docs/images/components/confirmation-dialog-android.png` retaken at 720 px
- `docs/tasks/G28/`: the two candidate screenshots and `mutations.json`

## Follow-ups

- AlertDialog and iOS were out of scope and were not looked at beyond keeping both iOS gates green.
- real-input: any dialog window owns `uiautomator dump`, so an echo is only readable with every
  window down — the next dialog check will rediscover this unless a helper says so.
- The row probe is harness-only code inside a shipped file, armed by a token. If a second component
  needs one, it belongs in core next to `NitroUiPerf` rather than as a second copy.
- `bun run task-ready` with no arguments reads the task id off the branch, so a fix branch named
  `task/G28-fix1` derives the id from the `-fix1` suffix, looks for a report named after the
  branch, and reports this task's own report as missing; passing `--task` is the escape hatch.
  Every fix round on such a branch rediscovers this unless the tool strips the suffix or a round
  names its report for the branch it is on.
- `describeConfirmationRows` still carries the comment justifying a row "flush with the sheet's
  edge" at `left = 0`. True as a reason to scan rightwards, but no row draws there now; it would
  read cleanly as the inset's own note, which is a comment-only change to a shipped file and so was
  not worth re-stamping three device gates for.
- `gate.mjs <device-gate> -- <filter> --background` sends `--background` to the runner as a filter
  and records a 1.4 s FAIL under a gate name with `--background` baked in. The flag belongs before
  the `--`; a runner that recognises its own launcher's flag after a filter separator would not
  leave the row in the ledger at all.

## Fix round 1

**Branch:** `task/G28-fix1` (`a2111f12` + `origin/main`, so X23's Form fix is in) ·
**Lease:** `G28-n0naq` (`pair-a`: iPhone 17 / iOS 27 + emulator-5574 / API 35 · Metro 8295)

**The group had no inset.** Flush to the sheet, its 16 dp outer corners cut grey wedges and the
segments touched. The rows now sit in their own `Column` with 16 dp horizontal padding — the
corners' radius — and material3's own `SegmentedGap`; title and message keep 24 dp. On the new
shot the card starts at x=42 px — 16 dp — with 5 px gaps. Retaken:
`docs/images/components/confirmation-dialog-android.png` (720 px) and
`docs/tasks/G28/rows-segmented.png`.

**Nothing tested the row refusing a press.** `enabled = true` alone — `performAction`'s guard left
in, one hunk — reddens exactly the two lines that read the row (`Dialog.harness.tsx:552`, `:624`),
keeps the alert half green (the single-hunk control) and reddens no press assertion. The row's own `enabled` is proven by the dump and the probe; a press check proves nothing happens,
whichever layer stops it. Recorded in `docs/tasks/G28/mutations.json`.

**Harness-only:** the report is a pure read again — the probe is armed by the reserved id
`__nui_probe_rows`, and `probePending` clears if the sheet leaves mid-answer; the changeset is cut to
two user-facing lines.

## Gates (fix round 1)

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2010 tests / 85 suites | `21fb7597f1e6` | 3 m 55 s | start 6.0 / med 107.8 / max 158.4 |
| `harness:ios` | **PASS** | 592 tests / 31 suites + isolated 6 tests / 3 suites | `21fb7597f1e6` (ios tree) | 14 m 46 s | start 10.6 / med 5.9 / max 17.5 |
| `harness:android` | **PASS** | 648 tests / 31 suites + isolated 6 tests / 3 suites | `21fb7597f1e6` (android tree) | 18 m 34 s | start 5.1 / med 7.1 / max 31.8 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | **PASS** | — | `21fb7597f1e6` (android tree) | 61 m 57 s | start 6.0 / med 4.4 / max 20.9 |
| `harness:android:Dialog` | stale | 2 failed of 31 tests / 1 suites | dce81fed31bc (not this tree) | 45.1 s | start 12.8 / med 10.5 / max 12.8 |
| `harness:android:Dialog:--background` | stale | — | dce81fed31bc (not this tree) | 1.4 s | start 5.8 / med 5.8 / max 5.8 |

`need --for review`: **review is satisfied on this code tree** — nothing owed. The two `harness:android:Dialog` rows are this round's red proof and the CLI mistake before it, each keyed to the tree it actually ran on; a filtered run satisfies nothing but its own name. `real-input:ios` is not owed by this round: its diff is one Android `.kt` file, the shared harness, the Android real-input runner and docs — no iOS code, and that harness file is green under `harness:ios` here. `need --for merge` does list it, because gate-core reads `example/__tests__/*` as both-platform; that line belongs to the merge run, which pays for the full harness plus real-input on the merged tree anyway.

# G28 — ConfirmationDialog rows: Material 3 Expressive on Android

**Branch:** `task/G28-dialog-rows` (from `main` at `c3b26ac6`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `G28-fn0rg` (`pair-a`: `iPhone 17` / iOS 27 + `emulator-5574` / API 35 · Metro 8295)

## Summary

The confirmation sheet's Android rows are the Expressive segmented row: `SegmentedListItem` with
`ListItemDefaults.segmentedShapes(index, count)` — Q8 row 16's second candidate, adopted as D40's
pass 3 B for Dialog. **Both candidates were built and photographed on the leased device**
([segmented](G28-dialog-rows/rows-segmented.png),
[interactive](G28-dialog-rows/rows-interactive.png)): the segmented one reads as one card inside the
sheet — 16 dp outer corners carrying the sheet's own radius, 4 dp where rows meet, the notched
boundary between rows, and a press that morphs the row — while `ListItem(onClick, enabled, …)` is a
full-bleed row with no group. Nothing but the look separates them: with the interactive row swapped
in, only the shape assertion moved, the disabled-state and press checks stayed green — the call was
made on the device, not on the API.

`disabled` is now the row's own `enabled = false` rather than a `clickable` wrapper and a hand-picked
`0.38` alpha on the label: the row takes the press, says `disabled` to TalkBack and paints itself
faint. `destructive` and `tintColor` replace only the *enabled* content colour, so a disabled
destructive row is drawn disabled and `tintColor` still colours the action text. `DISABLED_CONTENT_ALPHA`
left the file. Order, cancel handling, `dismissible`, "an action always closes", `titleVisibility`,
hosting, recycling and the `AlertDialog` are untouched, on iOS as on Android.

The harness cannot press or read a second window, so `nuiTestStateReport` now *arms* one row probe,
answered from inside the sheet: `rows=` is each row's own merged accessibility node (`~` = disabled,
the mark `Menu`'s probe writes) and `radii=` each row's corner radius in dp off the sheet window's
pixels. Both are the component's own state, not the props behind it, and one mutation proves `radii=`
is measured: loosening the probe's colour tolerance collapses every corner to the probe depth with
nothing in the composition changed.

Real input does the part the harness cannot: the tree's `enabled="false"` is pressed. The log is
snapshotted **with the sheet down** (the sheet owns the dump while it is up — the first version of
this check aborted on exactly that), one tap on the disabled row, then the row count and the log
again: no action, sheet still up, and Back's close the only entry the sheet is allowed to add.
`confirmation-dialog-android.png` was retaken (720 px, light, Storybook) — the card is a visible
change from the full-bleed rows, and the README shows it.

## Gates

One row is red and it is not this branch's:

- **`harness:android`** — 617 passed, 1 failed: `Form (G24) › starts a recycled Form at the top of
  its own content`, `expected 200 to be less than or equal to 1` (`Form.harness.tsx:1266`). That is
  X23's brief verbatim, line number and all: `docs/tasks/STATUS.md` records its cause (a recycled
  Android Form keeps its cached test report, so the case reads the previous Form's offset), the
  one-line reset in `prepareForRecycle` that fixes it, and PR #60 carrying it — none of which is on
  `main` yet. The same line went red in G26's, G27's and X22-fix1's full runs, none of which touched
  Dialog. It also goes red on this branch with `harness:android -- Form`, where the Dialog suite never
  runs at all, so nothing in this diff is in its path. `Form.harness.tsx` is untouched here, and a
  re-run of the whole suite cannot make it green: X23 is not G28's to fix (D19).

`need --for review`: <pasted below>.

## Red proofs

Full data in [`G28-dialog-rows/mutations.json`](G28-dialog-rows/mutations.json), with the tree digest
each run was keyed to. The first five lines are one source mutation each, restored between runs.

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

And the two existing checks that the `enabled` mutation catches, which is the evidence that the row
rather than the model is now the thing that refuses a press:

- `takes no tap on a disabled action, and draws it disabled (alert)` -> same mutation ->
  `expected 'locked:action:locked,locked:presented…' to be ''` - the deleted guard was the last thing
  between a disabled alert button and `onAction`
- the same test's confirmation half -> same mutation -> `expected '1,1,1' to be '1,0,1'` - the
  disabled row stops being drawn faint, read from what was drawn rather than from the flag

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
- `docs/tasks/G28-dialog-rows/`: the two candidate screenshots and `mutations.json`

## Follow-ups

- AlertDialog and iOS were out of scope and were not looked at beyond keeping both iOS gates green.
- real-input: any dialog window owns `uiautomator dump`, so an echo is only readable with every
  window down — the next dialog check will rediscover this unless a helper says so.
- The row probe is harness-only code inside a shipped file, armed by a token. If a second component
  needs one, it belongs in core next to `NitroUiPerf` rather than as a second copy.

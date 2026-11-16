# X45 — Android real-input: settle what e2e can do, drop what it already asserts

**Branch:** `task/X45-real-input-e2e-first` (from `66994249`) · **Round:** 1 of up to 3 ·
**Lease:** `X45-71ply` (`emulator-5570` / Metro `8293`)

## Summary

All five behaviour items are done. The ten device answers are in the table below; three of
them correct the context file.

- **Item 2.** `device-read.ts` gains `popupWindowCount()` beside `adbShell`. The
  `dumpsys window` parse moved out of `SweepDevice` into `scripts/real-input/popup-windows.mjs`,
  which both now call. `os-tree.ts`'s `tree({ unmerged: true })` passes `--raw`. Q1, Q5 and Q7
  show that this is the read that matches a dump node for node. A Material tooltip is a
  `Pop-Up Window` the app owns, so the count is a valid oracle for it (checked on device).
- **Item 3.** Of the 49 "Already in phase 1" lines, 30 are gone: 25 by deletion and 5 with the
  tooltip block. 19 stay:
  - **2 differ.** BG6 asserts the exact toggle set `bold,italic`, while phase 1 only checks
    `toContainText('italic')`.
  - **17 are the press that a later check needs.** B3, B7's press, D1, D3, G1, PO3a and PO3b
    open the window that the next stay-check reads. CH4, CB5 and S3 lost their outer
    `checkEquals` but keep the `tapUntilValue`, because CH6, CB6–CB8, S4 and S8 read the state
    it leaves.

  Before deleting, I read both sides of each line. For BG7, phase 2's tightest-clickable node
  and phase 1's tightest-checkable node were compared on a dump: they are the same node.
- **Item 4.** `stepper` and `tooltip` are e2e only; their blocks and entries are gone. Every
  row moved. ST1–ST2 are one new test (a 2 px, 1.4 s `screen.swipe`, Q3, then one re-read
  400 ms after the lift); TT1–TT13 are two tests, with "nothing opened" read from the popup
  count.
- **Item 5.** No context helper or module export lost its last caller. `ECHO` keeps
  `stepperHoldValue`, `tooltipPresses` and `buttonGroupPressedId`: it is a catalogue that
  mirrors the iOS `Echo` enum, and 50 of its keys already have no JS reader.
- **Cost of the two moves.** About 35 minutes of work, from reading the blocks to the last red
  proof. The device time was:
  - one run of the four tests: 68 s;
  - the three red-proof runs: about 2.5 min;
  - two incremental Kotlin rebuilds, in and out of the mutation (11 s for the first);
  - a `--control stepper --control tooltip` gate run: 11 min, almost all of it the whole-table
    a11y sweep, which runs on every gate run.

  The moved tests add 49 s to phase 1.

## Device answers

Driver: `agent-device` 0.21.37 through `e2e` 0.23.1 on a Pixel 9 profile, API 35. "Dump" is
`uiautomator dump` taken with the daemon stopped, on the same screen state as the driver
snapshot taken just before it; nodes are paired by class and bounds.

| # | Question | What was run | What was read | Answer |
| --- | --- | --- | --- | --- |
| Q1 | Is "`hittable` or `checked` present" the dump's "clickable or checkable or focusable"? | `agent-device snapshot --json --force-full --raw`, then the default mode, then the daemon stopped and a dump; Dialogs (alert up), Picker, Chip, Dates (twice), ContextMenu, Button group, List item, Segments, Host | Raw mode: equal on every paired node of all ten captures (54/54, 22/22, 3/3, 19/19, 15/15, 28/28, 12/12, 20/20, 11/11 actable). The one Host mismatch is the pairing of four stacked same-box wrapper Views, not a flag difference. Default mode: differs wherever a node is folded (date drums, radio and segment items). The disabled dialog action is `hittable` with `enabled:false`, as the dump's clickable `View` is. | **Yes, in `--raw` mode only.** The JSON prints `hittable`. R4, R5, C1, C3, G2 and BG2 can read it with no driver change, provided the read passes `--raw`. |
| Q2 | Does `AGENT_DEVICE_ANDROID_SNAPSHOT_HELPER_SESSION=0` let a dump run between driver steps? | CLI: dump with the session on and off. e2e: a test calling `adbShell(['uiautomator','dump',…])` before and after a locator tap, plus `chip.e2e.ts`, both with and without the variable | Session on: the helper process is resident and the dump exits 137 (killed), in the CLI and inside the test. Session off: both dumps succeed (about 2.1 s each), the tap and the assertion after it pass. `chip.e2e.ts` takes 19.9 s instead of 12.2 s, the dump test 23.4 s instead of 12.8 s | **Yes**, at about 60 % more time per test. The one-connection limit is ordering only once the helper is one-shot. |
| Q3 | Does a 2 px or 0 px `screen.swipe` lasting 1 000 / 1 400 ms act as a hold? | e2e: three swipes on the hold Stepper's plus half (2 px 1 400 ms, 0 px 1 400 ms, 2 px 1 000 ms); two on `ctx-target` at 30 %/40 % (2 px and 0 px, 1 000 ms) | Stepper value 5 → 6 → 7 → 8, events 1, 2, 3: one step per hold. The ContextMenu opened both times (`opens` 1, then 2), `press=0` | **Yes**, both distances. 0 px is not refused. |
| Q4 | Does the driver's tree carry the popup window's `android:id/content` node with the popup's box? | e2e: ContextMenu popup up, `getByTestId('android:id/content')` with `count()` and `boundingBox()` | One node, box x 350 y 756 316 × 613; the press was at 350.4, 756.2. The popup's rows are its descendants and the page is not in the tree | **Yes**: one node, the popup's own box, its top-start at the finger. |
| Q5 | Is `checked` printed only on checkable nodes? | The Q1 captures | Raw mode: checkable in the dump ⇔ `checked` present, on every paired node (43, 8, 6, 12 checkable on Dates, Chip, Picker, Segments). Default mode: a folded node carries its parent's `checked` under the child's class | **Yes in `--raw`**; in default mode the flag sits on the folded node. |
| Q6 | Is the driver's node order the dump's? | Host screen: index order of the section title, the three hosted Switches and the note, in both reads; inversions over every paired node in the Q1 captures | Same order in the dump, raw and default (title, switch 0, 1, 2, note); no inversion in raw mode on any screen | **Yes.** HS2 holds as written. |
| Q7 | Does `--raw` keep the `RadioButton` nodes, and does a Spinner read as `android.widget.Spinner` in default mode? | Segments and Picker, both modes | Raw: three `RadioButton` children per segmented control, as in the dump. Default: the third segment's item `View` is folded and reported as `RadioButton` with the item's box, its child dropped; the first two are not. The named picker node is `android.widget.Spinner` in both modes, with `contentDescription` the picker's name and `label` its value (`Mica`) | **Raw keeps them; default folds some.** S6a/S6b need `--raw`. PK24 and MN4 hold in either mode. |
| Q8 | Do `ownerNode` and tightest-clickable pick the same node for the disabled chips and list item? | Chip and List item screens: the dump's tightest clickable box around the label, and `os-tree.ts`'s `ownerNode` over the default snapshot | Both pick the same bounds, but `ownerNode` takes the outer `FrameLayout` (`enabled=true`) where the dump's clickable `View` reads `enabled=false`, for both disabled chips and the disabled item | **No.** `treeAnnounces({ enabled: 'false' })` would read `true` for all three. CH10a, CH10b and L2 do not hold as written. |
| Q9 | Does `pressSequentially('ab')` produce `typed:ab` before the popover's close? | e2e: open the field popover, tap the field, `pressSequentially('ab')`, tap the log's first line | Field value `ab`; log `typed:ab > field:presented:false` | **Yes.** PO5 holds as written. |
| Q10 | Are the wheel drum's rows in the driver's tree? | CLI: the time wheel revealed on Dates; default and raw snapshots and a dump | Inside the wheel's box: the wheel and three `SeekBar` columns (`Select hour`, `Select minutes`, `AM/PM`), no row text, in all three reads | **No.** T8, T10 and T13 stay skipped, as phase 2 skips them. |

Where the device corrects the context file: Q1's route needs `--raw`, which the context did not
say; in default mode a folded segment item is reported as a `RadioButton` with the item's box,
so S6a's count still reads three but not on the dump's nodes; and Q8's caveat is a real
difference, not a possible one.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1987 tests / 88 suites | `4cdd00fad042` | 1 m 30 s | start 17.7 / med 13.3 / max 18.9 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | **PASS** | 659 tests / 31 suites + isolated 6 tests / 3 suites | `4cdd00fad042` (android tree) | 18 m 07 s | start 7.0 / med 4.6 / max 16.3 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | **PASS** | — | `4cdd00fad042` (android tree) | 51 m 50 s | start 6.3 / med 4.0 / max 16.8 |
| `real-input:android:--control:stepper:--control:tooltip` | **PASS** | — | `4cdd00fad042` (android tree) | 10 m 41 s | start 6.4 / med 4.0 / max 7.1 |

`need --for review`: `harness:ios` only, which runs at merge. `real-input:android` took 51 m 50 s
on the final tree, against 54 minutes before; its phase 1 (28 files, 42 tests) took 17 m 42 s.

## Red proofs

- `stepper.e2e.ts` "a 1.4 s hold on the Stepper's plus half steps once, with no repeat" ->
  Android `StepperHalf` calls `onClick` every 150 ms once held for 500 ms ->
  `stepper.e2e.ts:74` `expect(value).toHaveText('6')`, observed `10`.
- `tooltip.e2e.ts` "a tap on the anchor of a closed tooltip opens nothing, and a tap outside or
  Back closes it once" -> `Tooltip.tsx` passes every close to `onIsPresentedChange` twice ->
  `tooltip.e2e.ts:99` `expect(log).toHaveText('presented:false')`.
- `tooltip.e2e.ts` "a real tap opens the tooltip, its action is reported before the close, and
  the anchor stays its own" -> `Tooltip.tsx` delivers `onAction` 300 ms late ->
  `tooltip.e2e.ts:65` `expect(log).toHaveText('action:ok > presented:false')`. The double-close
  mutation also turned this line red (`action:ok > presented:false > presented:false`).

## Files changed

- `scripts/real-input/android-tree-checks.mjs`: the item-3 deletions; the `stepper` and
  `tooltip` blocks and entries removed.
- `scripts/real-input/popup-windows.mjs`, `popup-windows.d.mts`: the popup-window parse;
  `a11y-sweep-device.mjs` calls it.
- `example/e2e/real-input/device-read.ts`: `popupWindowCount()`. `os-tree.ts`: `tree({ unmerged })`.
- `example/e2e/real-input/stepper.e2e.ts`, `tooltip.e2e.ts`: the moved rows.
- `example/e2e/README.md`: the device reads paragraph.

## Follow-ups

- `os-tree.ts` `ownerNode` picks the outer `FrameLayout` for a disabled chip and list item and
  reads `enabled=true` (Q8); CH10a–c and L2 need tightest-`hittable` over the unmerged tree.
- Phase-1 `treeAnnounces`/`itemAnnounces` read the default (folded) tree; with `--raw` they
  would read exactly the dump's nodes (Q1, Q5, Q7).
- Q2's switch would let the remaining `uiautomator` reads run inside e2e tests, at about 60 %
  more time per test.
- `android-tree-checks.mjs:1-6`, `a11y-sweep-device.mjs:1-6`, `reader.ts:83-84` and the e2e
  README still say the driver carries no `selected`/role and refuses a swipe that leaves its view.
- One `check` run died on a jest worker SIGSEGV in `scripts/__tests__/patch-nitrogen.test.js`
  (all 1 954 tests passed); the rerun did not repeat it.

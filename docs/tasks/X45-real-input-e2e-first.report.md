# X45 — Android real-input: settle what e2e can do, drop what it already asserts

**Branch:** `task/X45-real-input-e2e-first` (from `66994249`) · **Round:** 1 of up to 3 ·
**Lease:** `X45-71ply` (`emulator-5570` / Metro `8293`)

## Summary

In progress. The device answers to the ten questions are below; the code items follow.

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

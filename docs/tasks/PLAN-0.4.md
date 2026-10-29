# 0.4 plan (an ordering of work, not a scope promise: D31)

Fixed scope: a button-anchored **Menu**. The TextField spikes (T18, T18b) ran; per **D30** 0.4 ships
without TextField, and G8 moves to 0.5. New components start only after the groundwork below has merged (owner's
call). Per task: 1 implementation round plus at most 2 fix rounds (D19); spikes get one round.
Implementers use Apex `xhigh` (`EFFORT-eval-2026-10-27.md`). Every brief gets a context pack
(`ORCHESTRATOR.md` step 1b).

Not in 0.4: Stepper, the iOS glass Button style, Alert/Dialog, Toast/Snackbar, BottomSheet,
Form/List/Section containers (0.5 or later, the containers after their own spike), and a context
menu that wraps arbitrary RN children.

| Wave | Task | Platform | Depends on |
| --- | --- | --- | --- |
| 0 | **X3** component registry and codegen — merged | both | — |
| 0 | **X9** tooling: dry runs, warm caches, build slot, gate wait — merged | both | — |
| 0 | **A3** / **A4** this machine's bench baselines — both platforms minted | both | X8, X3/X9 off the devices |
| 1 | **X10** `check` throughput — merged | tooling | X3 |
| 1 | **X11** device throughput (emulator GPU, warm device pool) — merged | both | X9, A3 |
| 1b | **X4** conformance suite and `task-ready.mjs` (adds the report-path check), after X11 so two device tasks can overlap again | both | X3, X11 |
| 2 | **G7a** Menu: API, iOS SwiftUI `Menu`, Android Compose `DropdownMenu` anchored to a button, harness, sizing, a11y, Host support (Android) — merged `41e30c5` (owner rulings D32); X4's conformance covers it when it lands | both | X11 |
| 2 | **T18** / **T18b** TextField spikes — done on maintainer-mac-1, kept as unmerged branches (D30) | both | — |
| 3 | **G7b** Menu: bench arm, real-input case, Storybook story, smoke (brief `G7b-menu-finish.md`) | both | G7a |
| — | ~~**G8** TextField~~ — moved to 0.5 (D30) | — | — |
| 4 | Quiet bench re-runs (H2a, H2b, G5, G6, plus G7) in one exclusive window, then 0.4.0 through Changesets | both | A3, G7b |

G7a and T18 run in parallel, one device pair each. That is safe once X3's registry makes the
registration lists generated.

Also landed for 0.4: **F3**, three fixes visible to 0.3.x apps (merged from maintainer-mac-1, patch changesets), and
**F2**, the follow-ups sweep (PR #6, no changeset).

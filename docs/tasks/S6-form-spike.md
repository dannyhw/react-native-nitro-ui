# S6 — Form and Section spike: React Native rows in native grouped lists

**Worktree / branch:** named in your delegation message (`task/S6-form-spike`). **Round cap:** 1 round (a spike;
D19). The prototype is never merged: the report merges, the code stays on the branch. **Devices:** your lease
(`node scripts/lease.mjs acquire --task S6 --boot`). For the iOS 26 fidelity check, `--ios-runtime` (X20) if a 26.x
runtime is installed.

## Why

Q10 (`docs/tasks/Q10-form-list-research.report.md`) recommends Form and Section as native containers that hold
ordinary React Native rows: a UIKit inset-grouped list on iOS, and Material 3 Expressive segmented list shapes behind
rows kept in place on Android. That's better than @expo/ui on Android and easier to use on both, as long as the iOS
cell reparenting holds up. This spike answers whether it does, before anyone builds it.

## Read first

- AGENTS.md (red proofs, **never `pkill`/`killall`**, the lease rules, no GitHub writes).
- `docs/tasks/Q10-form-list-research.report.md`: **Appendix C1** (the design) and **Appendix E** (the seven questions
  and the go criteria). Where this brief and Q10 differ, the brief wins.
- `docs/DECISIONS.md` D23, D35, D36/D37, D38 item 1, D39.
- BottomSheet and ContextMenu, as they are on `main`: `scripts/patch-nitrogen.mjs`'s `CONTENT_CHILDREN_VIEWS`, the
  `onContentBox` round trip, and `NitroUiContextMenuViewManager.kt`.

## Do

Build the smallest prototype that answers Q10 Appendix E's seven questions on both platforms, following Appendix C1:
`Form`, `Section` (`title`, `footer`) and `Form.Row` (`onPress`, `accessory`). Then answer each question with
evidence: a harness test, a real-input check, screenshots or bench numbers, as the question needs.

- **iOS:** `UICollectionView` with `UICollectionLayoutListConfiguration(appearance: .insetGrouped)`, rows moved into
  `UICollectionViewListCell`s. Fidelity is compared against the same form in SwiftUI `Form`, in light, dark and the
  largest Dynamic Type size, at 1 pt.
- **Android:** rows in place with `SegmentedListItem` containers (`ListItemDefaults.segmentedShapes(index, count)`,
  `segmentedColors()`) drawn behind them; check them against material3 1.5.0-beta02.
- **Cost (question 6):** a `quick` bench plan, N = 20 and 50 mixed rows, against @expo/ui `Form` (iOS) and
  `FieldGroup` (Android). Say the machine and its load. If a full bench arm is too much for the round, measure it
  in the harness with the same probes and say so.

Screenshots of the prototype next to SwiftUI `Form` (iOS) go under `docs/tasks/S6/`. adb `-s <serial>` on your own
leased emulator is approved for screenshots. Undo `adb reverse` and the debug-host preference afterwards, and restore
any setting you change (read it first; never `cmd uimode`, not even to read: use `settings get secure ui_night_mode`).

## Output

`docs/tasks/S6-form-spike.report.md`: GO or NO-GO first (GO needs questions 1, 2, 3, 4's taps and 7), then a table
with each question, its result, the evidence and its go line. Then what G-Form must know: the answers to 4 (`measure`),
5 (keyboard) and 6 (cost), the API changes the prototype argues for, and the risks. If NO-GO on iOS reparenting, say
whether Q10's fallback C3 is worth trying. `## Questions for orchestrator` for anything the owner should decide.

## Not in scope

A shippable component, README rows, a `ListItem` content leaf (Q10 question C), a virtualized List (Q10 question B),
and anything else, which goes as one FOLLOWUPS line.

## Gates

`check` on your branch. Device gates on the prototype aren't required for a spike, but every claim in the report
needs its evidence. Export the ledger with `gate.mjs export --task S6`.

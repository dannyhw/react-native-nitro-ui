# G10 — Component follow-up sweep: Slider, Button, Progress and SegmentedControl

**Worktree / branch:** named in your delegation message, from `main`. **Round cap:** 1 round, plus at most 2 fix
rounds (D19). **Devices:** your lease (`lease.mjs acquire --task G10 --boot`).

The original component tasks left follow-ups that nobody has triaged since:
- G1 Slider: `docs/tasks/FOLLOWUPS.md`, "G1 Slider verifier follow-ups";
- G2 Button: `docs/tasks/G2-button.report.md`, "Follow-ups";
- G3 Progress: `docs/tasks/G3-progress.report.md` and `G3-progress.rereview.md`;
- G4 SegmentedControl: `docs/tasks/G4-segmented-control.report.md`, "Follow-ups", and the iOS `tintColor` line.

## Do

1. **Triage first.** Re-read every item against `main`, since much has changed since (sizing engine, recycling, F6,
   F8). Put a table in your report with one row per item and a status:
   - **fixed already**: say where;
   - **live correctness bug**;
   - **live test gap**;
   - **cosmetic or perf nit**;
   - **needs a decision**.
2. **Fix every live correctness bug and every live test gap,** each with a test shown red first. Add a patch
   changeset for anything apps can see. Keep within the perf contract.
3. **Leave cosmetic and perf nits as FOLLOWUPS lines,** one line each. Don't widen the task.
4. **Stop at "needs a decision"** (e.g. the iOS segmented `tintColor`, which needs another approach): put options
   and your recommendation under "Questions for orchestrator", and don't implement it.
5. Replace the four FOLLOWUPS lines with one line pointing at your report, plus whatever stays open.

## Not in scope

The X16 follow-ups (X17 runs them on maintainer-mac-1), F5 perf axes, and the A5 leak-slope line.

## Gates

`check`, both `harness:*` and both `real-input:*`, then `need --for review`. Report at
`docs/tasks/G10-component-followups.report.md`, with the ledger exported.

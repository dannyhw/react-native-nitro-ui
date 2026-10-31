# F6 — Recycling and drop-path gates

**Worktree / branch:** named in your delegation message (from `main`). **Round cap:** 1 round, plus at most 2 fix
rounds (D19). **Devices:** your lease (`lease.mjs acquire --task F6 --boot`). X15 holds the other pair. Product
code may change here; a change apps can see needs a patch changeset.

Read first:
- `docs/tasks/Q4-followups-triage.md`, row 41 and row T6 (what is still open, with file:line);
- `docs/tasks/B1-android-mount-oom.report.md` and its re-review;
- `docs/tasks/FOLLOWUPS.md`, the "B1 follow-ups" line and the four "X4 recycle rule" lines;
- `docs/tasks/X4-conformance.report.md` (the recycle-reset rule and its coverage matrix);
- AGENTS.md's perf contract on `RecyclableView`.

## Do

1. **Recycling is exercised, and leak-gated.**
   - `enableViewRecycling` appears nowhere in `src/` or `example/`. Turn it on where RN 0.88 allows, on the example
     screens the harness drives, so recycling actually happens.
   - Add a harness gate showing that a recycled control holds no previous owner's state and that recycling doesn't
     leak, on each platform where views recycle. Show each red with a broken reset or a retained reference.
   - X4's report says iOS recycles today (nitrogen's `RecyclableView`). Say what Android does, measured.
2. **Close the B1 drop-path items** that Q4 row 41 lists as open:
   - the post-drop composition guard;
   - the dead-observer re-capture;
   - screens-pop blanking;
   - the one remaining stale comment (`NitroComposeHost.kt:1503-1505`);
   - a red proof for M2.

   For each: fix it with a gate shown red, or show by measurement that it isn't reachable. Re-read each against
   `main` first, because some lines may have moved.
3. **The X4 recycle-rule blind spots.**
   - Give SegmentedControl a displayed-index read-out (`nuiTestDisplayedIndex`, beside Progress's and DatePicker's)
     so its recycle cell can fail, and flip the cell from **failing** to covered.
   - Give Picker's `didApplyDefault` reset line a probe whose second owner defaults to `2`, per the FOLLOWUPS recipe.
   - For Menu's popup-open residue, either add a read-out or record why none can exist.
   - Each flipped cell needs its red proof.

Remove each FOLLOWUPS line you close, and point it at this report.

## Not in scope

G1/Button/G3/G4 verifier leftovers (a later sweep). F4 and F5.

## Gates

`check`, both `harness:*`, both `real-input:*`, then `need --for review`. Report:
`docs/tasks/F6-recycling-gates.report.md`, with the ledger exported.

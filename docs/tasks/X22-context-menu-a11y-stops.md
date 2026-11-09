# X22 — iOS ContextMenu accessibility stops: 2 or 4

**Worktree / branch:** named in your delegation message (`task/X22-context-menu-a11y-stops`). **Round cap:** 1
round, plus at most 2 fix rounds (D19). **Devices:** your lease (`node scripts/lease.mjs acquire --task X22 --boot`).
Export the lease's environment before any device gate.

## The problem

Since 2026-11-09, `real-input:ios` is red on two lines for two unrelated branches (`task/G25-fix1`, Stepper, and
`task/G26-picker-radio`, Picker radio), neither of which touches ContextMenu:

- `a11y:context-menu` counts **4** accessibility stops under `ctx-accessible` where G16's exemption records **2**
  (`scripts/real-input/a11y.mjs`, the `ctx-accessible` case and the exemption near line 662);
- `a11y:ios-debt` then reports that exemption as stale.

G26 found that its base `a526807e` reads 2 on the same simulator, while both branches read 4 in every run today
(5 of 193 stored `real-input:ios` logs read 4; all five are today's). The evidence is in `docs/tasks/G26-picker-radio.report.md`
(its last section) and in the gate log store (`node scripts/gate.mjs logs --all --failed`).

## Do

1. **Find the cause** of 2 versus 4: which elements appear, and what in each branch's diff (or in the machine's state)
   makes them appear. Compare `main` as it is now, `a526807e`, `origin/task/G26-picker-radio` and
   `origin/task/G25-fix1`. Build each with `node scripts/build-app.mjs` and run the filtered gate
   (`gate.mjs real-input:ios -- --control:context-menu` or the narrowest filter the runner takes).
2. **Fix it at the cause**, on your branch from `main`:
   - if the sweep reads the tree before it has settled, make the settle compare the element set as well as the frames
     (G26's suggestion), with a red proof;
   - if 4 is what VoiceOver really gets now, that is a ContextMenu accessibility regression: fix it in the component
     and keep the exemption at 2;
   - if it is machine state (an accessibility setting, a simulator runtime), make the gate set or check it, and say so.
   Whatever the cause, a branch that doesn't touch ContextMenu must read the same as `main`.
3. Don't change the exemption's count to 4 to make it pass, and don't widen it.

## Tests

The fix shown red first. Then the full `real-input:ios`, green, on your tree, plus `check`.

## Not in scope

Anything else, which goes as one FOLLOWUPS line. Don't edit G25's or G26's branches.

## Gates

`check` and `real-input:ios`, then `need --for review` (the Android half may be untouched; say so if it is). Report at
`docs/tasks/X22-context-menu-a11y-stops.report.md`, cause first. Export the ledger with `gate.mjs export --task X22`.

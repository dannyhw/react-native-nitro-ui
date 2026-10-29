# F1 — re-review of fix round 1 (2026-10-29)

**Verdict: MERGE WITH FIXES.** The code holds up; the three must-fixes are wording, applied by the orchestrator in the commit that adds this file.

## Must-fix (applied)

1. `docs/tasks/F1/dwell-probe.md` said the suite's `pressDwell` became 0.12 s; it stays 0.15 s (`RealInputTests.swift:115`).
2. Report round-1 red-proof notes said "that same mutation is RED on both platforms". It isn't: round 1 swallowed the binding's first write (native never moves, so it goes green by design); the fix round's proof drops only `onChange` while native moves, green without the witness and red with it.
3. `scripts/real-input/dwell-probe.mjs` header said it writes no app stamp and installs nothing; it calls `recordBuild` and `simctl install`.

## Items

- M1 resolved: dwell ladder 0/0.03/0.05/0.08/0.12 s on busy and light screens, calm and loaded, with a negative control. Q1 ruled option 1 (a separate product task).
- M2 resolved: retry lines reach the gate log via `realInputLine`/`CheckLog.retried`; a store log shows `retried 1 press sequence(s)`. No iOS "every press swallowed" red was recorded through `gate.mjs`; that path is red by construction.
- M3 resolved: the iOS witness re-resolves its element per read, reads the inner `.switch`, fails if unarmed, and fires only after a second grace window; Android reads a fresh `uiautomator` dump and the tightest checkable box. Red excerpts on both platforms; no false reds on the final tree.
- N1–N7 resolved (`waitForNoDateWindows`, `waitForDialogGone`, doc comments, report counts, 10/10 runs, bounded lock-retry test, Node-major guard).

## New findings (low, not blocking; FOLLOWUPS)

- `HostPopups.harness.tsx:1274-1278`: the "hidden child leaves no window" gate now gives `presented` the full 12 s, so a flag lagging its window by seconds passes.
- `android.mjs:3026-3031`: the lost-event guard is skipped when a later native or echo read returns null; a lost event coinciding with a dump hiccup would retry to green.
- `ios-log.mjs:70`: `running` is never cleared at case end, so a tagged line between cases is charged to the previous case (nothing prints there today).
- Report red-proof tallies don't reconcile (four `android-tree` mutations, three counts; the `^` anchor mutation likely fails 5 `ios-log` tests, not 4).

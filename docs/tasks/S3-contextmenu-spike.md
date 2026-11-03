# S3 — ContextMenu spike

**Machine:** maintainer-mac-1, delegated from maintainer-mac-2 through the T3 link. **Round cap:** 1 round, no fix
rounds (D19's spike rule). **Devices:** your lease on this machine (`lease.mjs acquire --task S3 --boot`). Don't use
`--exclusive`; the owner may be using the machine.

## Workspace on this machine

- The project checkout here is the owner's own working copy. Don't edit it, switch its branch, stash, reset or
  clean it.
- Make your own worktree from `origin/main` on branch `task/S3-contextmenu-spike`, and run `bun install` there.
- Push only that branch: never `main`, tags or force, and don't open a PR. The prototype is never merged; only the
  report and ledger are, separately.

## Read first

AGENTS.md; `docs/DECISIONS.md` D32, D35 and **D36**; `docs/tasks/Q6-contextmenu-design.report.md` in full, especially
Appendices B (iOS), C (Android), D (gesture arbitration) and G (the spike table); the G14 report for the Android
children mechanism and touch root.

## Do

Build the minimal prototype Q6 Appendix G describes (rows as data, both platforms, no registry, docs or bench), and
answer the eight questions in Q6's spike table with the evidence it asks for: counts out of 10, load-stamped timings,
screenshots and a screen recording where it says so. Questions 1, 2, 3 and 5 decide GO; 4, 6, 7 and 8 inform the
build. Question 6 is a human screen-reader pass: do what can be done with VoiceOver/TalkBack on the simulator and
emulator, and say exactly what was and wasn't checked.

Real touches: use the real-input tooling (XCUITest on iOS, the lease's adb on Android, by serial) for long presses,
taps and drags; the harness cannot hold a press yet (D36 item 2).

## Output

`docs/tasks/S3-contextmenu-spike.report.md`: a table of the eight questions with **met / not met / unmeasurable** and
the evidence, an explicit **GO / NO-GO** for the build, what the build must change from Q6's design, and "Questions
for orchestrator". Commit the report and the exported ledger (`gate.mjs export --task S3`) on your branch and push it.

## Gates

`check` on your branch. Record every measurement run in the ledger (harness filters or `gate.mjs` runs) so the
numbers are traceable.

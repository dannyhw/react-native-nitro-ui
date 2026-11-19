# X57 — a quarantined Android real-input test is skipped, not red; icon fixtures in subfolders are checked

**Kind:** tooling · **Devices:** none · **Budget:** 2 h for round one (X54, a 3 h tooling task
with more surface)

## Goal

A flaky Android real-input test can be quarantined the way the flake skill says, and an icon
fixture kept in a subfolder is held to the same provenance check as every other.

## Why

Two gaps found on recent merges. The Android real-input runner counts every skipped test as a
failure (`scripts/real-input/android.mjs`, `recordResults`, "skipped, which is not a pass"), so
the quarantine the flake skill prescribes (`.claude/skills/flake/SKILL.md`: `test.skip` with a
`QUARANTINED <date>` comment, listed under "Quarantined tests" in `docs/tasks/FOLLOWUPS.md`)
turns the gate red, and a flaky test had to be deleted instead. The icon provenance test
(`scripts/__tests__/android-icons.test.js`, the loop over `EXAMPLE_ICON_DIRS`) lists each
folder one level deep, so a fixture in a subfolder is never checked.

## Behaviour

1. An Android real-input test that is skipped, has a `QUARANTINED <YYYY-MM-DD>` comment on the
   line above its `test.skip(`, and whose file and title appear under "Quarantined tests" in
   `docs/tasks/FOLLOWUPS.md`, is reported as quarantined: its own line in the gate log, and the
   run's verdict is decided by the other tests.
2. A skip missing either the comment or the FOLLOWUPS line stays red, with a line saying which
   is missing. A control whose file collects no test at all stays red, as now.
3. `--rerun-failed` does not treat a quarantined test as a failed unit.
4. The icon provenance test checks every file under each example icon folder, at any depth.

## Proof

- `node scripts/gate.mjs check` passes, and `node scripts/gate.mjs need --for review` prints
  nothing missing.
- Unit tests for 1–3 against e2e report fixtures (`scripts/__tests__/real-input-android-run.test.js`
  is the neighbour): a quarantined skip passes, a bare skip and a skip with no FOLLOWUPS line
  each fail with their reason. Each shown red by reverting the change.
- For 4: an unlisted `.xml` in a new subfolder of `example/src/assets/icons` turns the icon test
  red, and passes once removed. Red proof only; commit no such file.

## Out of scope

- Restoring the quarantined Form test: another task is replacing it.
- iOS real-input (XCUITest) and harness skip handling.
- Fetch targets for new icon fixtures.

## Decided already

- Both the comment and the FOLLOWUPS entry are required, so a skip cannot hide unlisted.
- The FOLLOWUPS match is on the test file name and the test title as written there in quotes.
- Docs: one line in `docs/agents/gates.md` where real-input verdicts are described; the flake
  skill already says what to do and needs no change unless a step there is now wrong.

## Context

`scripts/real-input/android.mjs` (`recordResults`, about line 313), `scripts/real-input/report.mjs`
(units file), `scripts/gate-core.mjs` (`realInputUnitsFromResults`, about line 2301),
`scripts/__tests__/android-icons.test.js` (has a recursive `walk()` already).

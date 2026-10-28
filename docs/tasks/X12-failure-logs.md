# X12 — Failure logs that outlive the worktree

**Worktree / branch:** named in your delegation message (from `main`, after X10 merges: both edit
`scripts/gate.mjs`). **Round cap:** 1 implementation round plus at most 2 fix rounds (D19).
Tooling only, no devices. The published package stays byte-identical.

## Why

Owner's request (2026-10-28): every failure should leave logs of what happened. Two gaps showed up
on 2026-10-27:

- `scripts/gate.mjs` writes each run's log to `.gates/logs/` inside the worktree (`gate.mjs` ~216).
  Removing a merged worktree deletes them. Q3, diagnosing three flaky tests, couldn't read the logs
  of the failing runs because the X3 worktree was already gone.
- `gate.mjs export --task <ID>` commits only the ledger lines (`docs/tasks/<ID>/gates.jsonl`), so a
  red row in the committed ledger has no evidence attached.

## Do

1. **Logs survive worktree removal.** Gate logs, and the background-gate records X9 added, live in a
   per-clone directory that every worktree shares: under `git rev-parse --git-common-dir`, for
   example `<common-dir>/nitro-ui-gates/<branch>/`. Keep `.gates/<branch>.jsonl` where it is unless
   moving it is simpler, and say which. `gate.mjs wait/status/table/need` keep working, as do the
   ledger's log paths (old relative paths still resolve, or are migrated). Add a size cap or age
   retention (state the rule), and a `gate.mjs logs [--branch b] [--failed]` that lists them.
2. **Failure evidence in the export.** `gate.mjs export --task <ID>` also writes, for every
   **failed** run in the exported ledger, a trimmed excerpt to `docs/tasks/<ID>/failures/<run>.log`:
   the failing test names, assertion messages, the last ~150 lines, and the load at the start and
   end. It never copies a passing run's log, and never a secret (state what is scrubbed, for example
   env dumps and tokens). The ledger line gets the excerpt's path.
3. **Device and run context on failure.** On a failed harness or real-input gate, the log also
   records `xcrun simctl list devices booted`, the attached `adb -s <leased serial> devices`, the
   lease list and load1. On Android, add the last ~500 lines of `logcat` for the app's pid from the
   leased serial only.
4. **Docs:** AGENTS.md "Report" says failure excerpts come from `gate.mjs export` and where full
   logs live. `ORCHESTRATOR.md` cleanup says removing a worktree no longer loses logs.

Tests in `scripts/__tests__/`, each shown red: logs written outside the worktree, survival across
`git worktree remove`, export writing excerpts only for failures, scrubbing, and retention.

## Out of scope

Bench missing-sample diagnostics (A4 does those). Changing which gates exist.

## Gates

`check`, then `need --for review`. Report: `docs/tasks/X12-failure-logs.report.md`, with the ledger
exported. Commit on your branch, don't push.

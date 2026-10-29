# <ID> — <one-line title>

<!--
  The short report format (docs/tasks/PROCESS-review-2026-10-26.md §3: "Report format: shrink
  it"). Copy this file to `docs/tasks/<ID>.report.md` and fill it in.

  Hard limits, all of them because the long format stopped being read:
  - Summary: <= 400 words. Everything past that is an appendix, and an appendix is optional.
  - Gate table: generated. `node scripts/gate.mjs table` prints it; paste it, do not type it.
    A gate you typed by hand is a claim; a row from the ledger is evidence, and a row whose
    code tree is not the current one prints `stale` instead of `PASS` for exactly that reason.
  - Red proofs: one line each, `test -> mutation -> the line that went red`. Recorded as data
    in `docs/tasks/<ID>/mutations.json` where a helper exists.
  - Follow-ups: one line each, no investigation. Anything that needs a paragraph is a task.
  - Questions: concrete, with a recommendation. Only where you genuinely cannot proceed
    (AGENTS.md "Asking for help").
  - Fix rounds: append a `## Fix round N` section of <= 200 words and do not rewrite the summary.
    Paste a **fresh** `node scripts/gate.mjs table` and the `need --for review` line into that
    section: the table is generated, so refreshing it is not re-reporting, and leaving round 1's
    table as the only gate evidence leaves the report showing a tree the fix round replaced.
    Gates the ledger still shows green on this code tree need no re-run.

  Device hygiene is not reported. Leases and the scripts enforce it (X1): a device gate runs
  under `scripts/lease.mjs`, refuses an unstamped app, and refuses the reserved emulator
  serial, so a report no longer has to say it did none of the bad things.

  Before the final commit, run `bun run task-ready`: it checks this file's citations against
  HEAD and its gate table against `gate.mjs table`, so a report cannot be handed in describing
  a tree it no longer matches.
-->

**Branch:** `task/<ID>` (from `main` at `<sha>`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `<lease-id>` (`<device>` / Metro `<port>`)

## Summary

<!-- <= 400 words. What shipped, and the one or two decisions a reviewer needs to read before
     the diff. No chronology, no prose about gates — the table below is the gate section. -->

## Gates

<!-- `node scripts/gate.mjs table` (add `--full` to cite the log path per row). Commit the
     ledger beside the report with `node scripts/gate.mjs export --task <ID>`. -->

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |

`need --for review`: <paste the line it prints, or note what is deliberately left for merge>.

## Red proofs

<!-- Every new test or gate, one line each: test -> mutation -> red line. If a mutation was
     not run, say so here rather than letting the test read as if it had been. -->

- `<test>` -> `<mutation>` -> `<the failing assertion or log line>`

## Files changed

<!-- One bullet per area. Paths, not narratives. -->

## Follow-ups

<!-- One line each. Not fixes you made. (D19: anything outside the brief stops here.) -->

- <area>: <one line>

## Questions for orchestrator

<!-- Delete the section if empty. Concrete options + your recommendation. -->

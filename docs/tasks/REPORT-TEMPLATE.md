# <ID> — <one-line title>

<!--
  Copy this file to `docs/tasks/<ID>.report.md` and fill it in.

  - Summary: 400 words or less. Anything past that is an appendix, and an appendix is optional.
  - Gate table: generated. `node scripts/gate.mjs table` prints it; paste it, do not type it.
    A row typed by hand is a claim; a row from the ledger is evidence, and a row whose code
    tree is not the current one prints `stale` instead of `PASS`.
  - Red proofs: one line each, `test -> mutation -> the line that went red`, written in this
    file. Ledgers, mutation records and screenshots stay local and are never committed, so the
    report cites none of them.
  - Follow-ups: one line each, no investigation. Anything that needs a paragraph is a task.
  - Questions: concrete, with a recommendation. Only where you cannot proceed (AGENTS.md "When
    you are stuck").
  - Fix rounds: append a `## Fix round N` section of 200 words or less and do not rewrite the
    summary. Paste a fresh `node scripts/gate.mjs table` and the `need --for review` line into
    that section. A gate the ledger shows green on this code tree needs no re-run.

  Device hygiene is not reported: leases and the scripts enforce it. Report an incident if one
  happened.

  Before the final commit, run `bun run task-ready`: it checks that every path this file cites
  exists in HEAD and that its gate table is the one `gate.mjs table` prints.
-->

**Branch:** `task/<ID>` (from `main` at `<sha>`) · **Round:** 1 of up to 3 ·
**Lease:** `<lease-id>` (`<device>` / Metro `<port>`)

## Summary

<!-- <= 400 words. What shipped, and the one or two decisions a reviewer needs to read before
     the diff. No chronology, no prose about gates — the table below is the gate section. -->

## Gates

<!-- `node scripts/gate.mjs table` (add `--full` to cite the log path per row). -->

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

<!-- One line each. Not fixes you made: anything outside the brief stops here. -->

- <area>: <one line>

## Questions for orchestrator

<!-- Delete the section if empty. Concrete options + your recommendation. -->

# Apex effort levels: one controlled comparison (2026-10-27)

**Question:** is `xhigh` always the right reasoning effort for Apex implementers (opencode
`callstack.ai/callstack/Apex`, option `variant`: `none` / `low` / `medium` / `xhigh`; `high` is not
offered)?

**Method:** the same brief (X8, per-machine bench baselines: a tooling change of about 15 files with
tests, red proofs and docs, and no devices) went to three Apex sessions at the same time. Each had
its own worktree from the same commit and the same delegation text, differing only in `variant`.
Each result went to a separate Claude Opus reviewer. The reviewers were not told the variant and
did not see the other branches, and each scored the same rubric from 1 to 5.

| Variant | Wall time | Diff | Review verdict | Must-fix | Corr. | Brief | Tests | Docs | Scope | Clarity | Mean |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `low` | ~20 min | 12 files, +664 | MERGE WITH FIXES | **code**: `run.mjs` (the live `--check` and mint path) duplicated the per-machine checks untested; two mutations there stayed green | 4 | 4 | 3 | 4 | 5 | 4 | 4.0 |
| `medium` | ~38 min | 14 files, +864 | MERGE WITH FIXES | report only: one red-proof count overstated | 5 | 5 | 4 | 4 | 4 | 4 | 4.33 |
| `xhigh` | ~45 min | 14 files, +1430 | **MERGE** | none | 5 | 5 | 4 | 4 | 5 | 4 | 4.5 |

`xhigh` was merged. Token cost was not measured (the provider doesn't report it per task).

## Reading

- `low` saved about 25 minutes but left a real gap in the path that gates. A fix round plus a
  re-review costs more than that (fix rounds averaged ~1.5 h in the 2026-10-26 process review).
- `medium` produced correct code about 15 % faster than `xhigh`, but needed a fix round to correct
  its own report. Even a small round outweighs that 15 %.
- `xhigh` ran its own mutations more widely (25 tests, 9 mutations; the reviewer reproduced its
  red proofs) and was the only one with nothing that had to be fixed.
- Most of the time in a device task is shell (builds, harness, benches), not model time, so the
  effort level's share of wall time is smaller still.

This is one task (n = 1). It is enough to keep the default, not enough to rank `medium` against
`xhigh` finely.

## Policy

- **Implementation and fix rounds: `xhigh`** (unchanged). Fix rounds continue in the implementer's
  own thread.
- **`medium`** only for doc-only or mechanical edits that are fully specified (for example,
  replacing a report table with numbers that a gate has already produced), where a missed nuance
  costs at most one small round.
- **`low` / `none`:** not for anything that is reviewed or merged.
- Record the variant in the STATUS row when it is not `xhigh`. Revisit if a `medium` task needs a
  fix round for something `xhigh` would likely have caught.

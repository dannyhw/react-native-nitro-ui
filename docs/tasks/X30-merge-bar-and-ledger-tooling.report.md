# X30 — Merge bar and ledger tooling: stop paying for re-runs nothing needs

**Branch:** `task/X30-merge-bar-and-ledger-tooling` (from `main` at `8201adc9`) ·
**Round:** 1 of up to 3 (D19) · **Lease:** none — tooling only, no device, Metro
port or adb server was touched, and every test runs in a temp checkout with stub
runners.

## Summary

Four rules changed, each with tests that were shown red first.

**1. Merge matches a device run on its platform's half.** `digestKeyFor` used to
return `full` for everything at merge, so `need --for merge` asked each of the four
device gates for a line whose whole code tree matched. A tooling-only commit
landing on `main` moved that tree under every branch gated before it and re-owed
all four — G29+X27's ~2.5 h for a test fixture. Device gates are keyed to
`trees.ios` / `trees.android` at **both** stages now; `check` stays on the whole
tree at both, because that run reads both platforms and the docs. Soundness is
where it was: a half is the full digest restricted to that platform's files, so
shared code (`src/`, `cpp/`) moves both halves, and a code path the mapping does
not claim is both halves by definition — unknown stays expensive. `AGENTS.md` and
CONTRIBUTING now state what a merge needs: one `check` on the whole tree, plus
`harness:ios` + `real-input:ios` on a matching iOS half and the Android pair on a
matching Android half.

**2. `export --task <ID>` merges.** It read only the current branch's ledger and
wrote that over `docs/tasks/<ID>/gates.jsonl`, dropping every line an earlier
round on another branch had committed. Existing lines are now kept byte-for-byte
in their existing order, this branch's are appended, and identity (ts + gate +
code tree) stops duplicates — `mergeLedgerExports` in `gate-core.mjs`, with
`ledgerPairs` keeping raw bytes beside the parse so a corrupt line stays corrupt.
A failure excerpt that is already committed is left alone: a red row's
`failureLogPath` and its file are a pair, and re-writing it from a store log that
another machine no longer has orphaned both.

**3. `-- --background` is a usage error.** Past the separator the arguments belong
to the gate, and `--background` is not one; it became a jest option or a gate
named `harness:android:--background` and the ledger recorded a red for code nobody
measured. It is refused before a runner, a log or a ledger line exists, and the
message spells the working command, filter included.

**4. `task-ready` reads the id off the branch.** `merge/X30` and
`refs/heads/task/X29-fix2` resolve to `X30` / `X29`; the leading token must contain
a digit, so a prose branch name still asks for `--task` rather than being pointed at
a report it never wrote.

## Gates

TABLE_PLACEHOLDER

## Red proofs

- `gate.test.js → the merge bar keys a device gate on its platform half` (5 of 7)
  → `digestKeyFor` back to `stage !== 'review' → 'full'` →
  `✕ a tooling-only commit on main re-owns check and no device run`
- `gate.test.js → the fix-round rule (M2) → an Android-only fix does not re-owe the iOS run`
  → same mutation → `expect(merge.missing).not.toContain('harness:ios')` (5 failures
  across the two describes, including `an iOS-only fix still re-ows Android`)
- `gate-logs.test.js → export merges the committed ledger` (4 of 6)
  → `const existingText = ''` (export ignores what is already committed) →
  `✕ keeps the lines another branch exported and adds this branch's`
- `gate-logs.test.js → export attaches failure evidence` (X12's own test) **and**
  two of X30's → write `lines` instead of the excerpt writer's `exported` →
  `✕ writes an excerpt for the failed run, none for the passed one, and points at it`
- `gate-logs.test.js → leaves a committed failure excerpt alone`
  → `const published = null` (never honour an existing pointer) →
  `✕ leaves a committed failure excerpt alone, even with its store log gone`
- `gate.test.js → refuses a misplaced --background` (2 of 3)
  → guard body behind `if (false)` →
  `✕ says so, for a device gate, without running anything` (status 1, a run
  recorded; the third test stays green under it, which is the "must not
  over-block" half)
- `task-ready.test.js → the task a branch name belongs to` (2 of 4)
  → branch parsing back to `/^task\/([A-Za-z0-9._-]+)$/` →
  `✕ reads the id off a fix round, a merge round, and any prefix`

## Files changed

- `scripts/gate-core.mjs`: `digestKeyFor` (platform halves at both stages),
  `ledgerPairs` / `ledgerLineIdentity` / `mergeLedgerExports`, header note.
- `scripts/gate.mjs`: `commandExport` merges and reports kept/added/duplicates,
  `exportFailureExcerpts` keeps a committed excerpt, misplaced-`--background`
  refusal, USAGE.
- `scripts/task-ready-core.mjs` / `scripts/task-ready.mjs`: `taskFromBranchName`,
  `taskIdFromBranch`; the CLI uses them and its error names the shapes.
- `scripts/__tests__/gate.test.js`, `scripts/__tests__/gate-logs.test.js`,
  `scripts/__tests__/task-ready.test.js`: the rules above, two M2 assertions
  corrected, and the CLI fixtures they need.
- `AGENTS.md`, `CONTRIBUTING.md`: what a merge needs, what an export does, where
  `--background` belongs, where a task id comes from.

## Follow-ups

- `scripts/gate-core.mjs:3221` carries a pre-existing `no-useless-escape` warning
  (the X28 lease message); left alone as out of scope.
- A branch with no digits in its leading token (`t3/…`, `dependabot/…`) still needs
  `--task` — by design, said in the error, not listed as a gap.

## Questions for orchestrator

- This round started from a clone whose `main` (`8201adc9`) had the X30 brief and no
  X30 work: no `docs/tasks/X30*.report.md`, no `gate.mjs` export merge, `origin/main`
  equal to it, and no `v0.9.0` tag on origin. A round-2 instruction arriving earlier
  in this thread named `task/X30-merge-bar-and-ledger-tooling` at `693b1164` with a
  published 0.9.0 — a history this clone cannot see (`git cat-file` has no such
  object, `git worktree list` shows one clone on this machine). If a broader X30
  (merge bar **plus** release tooling) exists on another machine, this branch is the
  four brief items only and the two will collide in `gate.mjs`/`gate-core.mjs`.
  Recommendation: treat this branch as the whole of X30 as briefed here, and say so
  before anything merges, rather than let two versions of the same file meet in a
  merge commit.

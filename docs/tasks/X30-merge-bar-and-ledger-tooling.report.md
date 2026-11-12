# X30 — Merge bar and ledger tooling: stop paying for re-runs nothing needs

**Branch:** `task/X30-merge-bar-and-ledger-tooling` (from `main` at `8201adc9`) ·
**Round:** 1 of up to 3 (D19) · **Lease:** none — tooling only, no device, Metro
port or adb server was touched, and every test runs in a temp checkout with stub
runners.

## Summary

Five rules changed, each shown red first.

**1. Merge matches a device run on its platform's half.** `digestKeyFor` returned
`full` for everything at merge, so each of the four device gates had to be re-run on
every new tree: a tooling-only commit landing on `main` moved that tree under every
branch gated before it and asked all four back — G29+X27's ~2.5 h for a test fixture.
Device gates now key to `trees.ios` / `trees.android` at **both** stages, and `check` stays on the
whole tree: that run reads both platforms and the docs.
Soundness is unchanged: a half is the full digest over that platform's files, so
shared code (`src/`, `cpp/`) moves both and an unclaimed path is both by definition —
unknown stays expensive. `AGENTS.md` and CONTRIBUTING now say what a merge needs:
`check` on the whole tree, the iOS pair on a matching iOS half, the Android pair on a
matching Android half.

**2. `export --task <ID>` merges.** It read only the current branch's ledger and
wrote that over `docs/tasks/<ID>/gates.jsonl`, dropping every line an earlier round on
another branch had committed. Existing lines stay byte-for-byte in their order,
this branch's are appended, and identity (ts + gate + code tree) stops
duplicates — `mergeLedgerExports` in `gate-core.mjs`, with `ledgerPairs` keeping raw
bytes beside the parse so a corrupt line stays corrupt. A committed failure excerpt is
left alone: a red row's `failureLogPath` and its file are a pair, and re-writing it
from a store log this machine no longer has orphaned both.

**3. `-- --background` is a usage error.** Past the separator the arguments belong to
the gate and `--background` is not one; it became a jest option or a gate named
`harness:android:--background`, and the ledger recorded a red for code nobody
measured. It is refused before a runner, a log or a ledger line exists, and the
message spells the working command.

**4. `task-ready` reads the id off the branch.** `merge/X30` and
`refs/heads/task/X29-fix2` resolve to `X30` / `X29`; the leading token needs a digit,
so a prose branch still asks for `--task` rather than a report it never wrote.

**5. `scripts/task-ready*.mjs` is check-only tooling.** An unclaimed path under
`scripts/` is both-platforms by design, so this diff owed two harness runs for editing
the hand-in checker. Listed with the other check-only tools; "no device run reads
them" is a `git grep` in the test, not a sentence.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2133 tests / 88 suites | `7010316fa575` | 2 m 50 s | start 8.7 / med 16.8 / max 30.0 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

All three `check` runs are in the committed ledger, and the export that added the
third printed `2 kept from the file, 1 from
task/X30-merge-bar-and-ledger-tooling, 2 already there` — item 2, running on its own
task: the earlier rounds' lines survived, and nothing was written twice.

`need --for review`: `need: review is satisfied on this code tree.` (exit 0) - the whole diff is check-only tooling, so no device gate is asked for. That is item 1 proving itself on its own task: the same diff used to owe two harness runs.

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
- `gate-check.test.js → TOOLING_FILES` (4 of 12) → the two `task-ready` entries
  removed from `TOOLING_FILES` →
  `✕ a commit that only changes the checker re-owns check and no device run`
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
- `scripts/gate-core.mjs` (`TOOLING_FILES`), `scripts/__tests__/gate-check.test.js`:
  the checker is check-only tooling, with the search that keeps that honest.
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

## Fix round 1

Items 1-8 on `task/X30-fix1` from `66e77bcf`. The table above is this round's;
`need --for review` is satisfied (a check-only tooling diff). Export:
`3 kept from the file, 2 from task/X30-fix1`.

Red proofs — break the guard, name the line that went red:

- `USAGE` truncated → no `logs` help, none in the `--background` refusal.
- Pre-fix file linted → 4 × "Expected an assignment or function call".
- Round 1's lookup → `X30-fix1.report.md or X30.report.md: not found`.
- Slug rule → 5 tests red, one over the real directory.
- Two-id branch → exit 2 naming `G25, G26`; chosen: `--task` per task.
- Same-second failure → committed `--01.log` rewritten, round 1's marker gone.
- Grouping back-mutated → `task/X30-round-1` credited with `task/X30-fix-1`'s pass.
- Widened guard → a `task-ready` mention in `scripts/harness.mjs` goes red.
- `(id, branch)` spread → now an order the two disagree on.

Also listed `eslint.config.mjs` as check-only: unclaimed, a lint rule owed two harness
runs.

Follow-up: committed-ledger `check` reuse looks unreachable — the export commit moves
`HEAD^{tree}` after the run it certifies.

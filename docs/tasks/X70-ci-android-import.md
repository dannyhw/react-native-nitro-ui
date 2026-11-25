# X70 — a merge can take `real-input:android` from a GitHub Actions run of the merge commit

**Kind:** tooling · **Devices:** none (CI fixtures; one optional local filtered run) ·
**Budget:** 4 h for round one (X65 and X66, gate-code tasks with new tests)

## Goal

A merge satisfies `real-input:android` with a hosted run of the exact merge commit, so the
local emulators are not tied up for the 40-minute Android suite.

## Why

A trial job (branch `task/X56-ci-android-real-input`, job `real-input-android` in
`.github/workflows/ci.yml`) has run the full Android suite on hosted runners for 18 rounds of
three jobs. Its failures were test-harness issues that are now fixed. `docs/agents/gates.md`
"Runs from other branches" says CI evidence is never read, so a merge still runs the suite
locally.

## Behaviour

1. `ci.yml` on main gets one `real-input-android` job, `workflow_dispatch` only. It is the trial
   job from X56 without its matrix and without the capture-timing probe, and it keeps the
   failure capture, the whole-run device log and the 63-minute CI ceiling in
   `scripts/real-input/android.mjs`. When the run is red with failed controls, the same job
   reruns only those controls once, the way `gate.mjs real-input:android --rerun-failed` does
   locally, and uploads both reports.
2. `node scripts/gate.mjs ci-import --run <id>` reads that run with `gh` (reads only) and
   writes one `real-input:android` line to this branch's ledger:
   - It refuses, and records nothing, when the run's head SHA is not `HEAD`, when the tree has
     uncommitted changes, when the run is not finished, or when the workflow or job is not the
     one above.
   - The run is judged from its uploaded report by the same code that judges a local run
     (units, quarantine lines, whole-run checks), not from the job's conclusion. A report that
     does not prove every control passed is red, even when the job succeeded.
   - An in-job rerun is recorded as a completion under the local rules ("Completing a red
     run").
   - The line names its source: run ID, job ID and URL. The line also counts as
     clone-wide evidence, under the same rules as a local run from another branch.
3. `table` and `status` show the row as `**PASS** (CI run <id>)`, or completed, or red.
   `need --for merge` treats it like a local run on that digest.
4. `docs/agents/gates.md` gets a "Runs on CI" section. The AGENTS.md definition of done and
   `.claude/skills/orchestrate/SKILL.md`'s merge steps say how a merge uses it: push the merge
   branch, dispatch, wait, `ci-import`. Pushing and dispatching stay with whoever is allowed
   GitHub writes, never with an implementer.
5. Every other gate, and a local `real-input:android` run, behave exactly as before.

## Proof

- Unit tests over fixtures cut down from a real green and a real red hosted artifact (kept
  small; the delegation message says where the samples are). Show each one red:
  - a SHA mismatch is refused;
  - a report with a failed control is red even with a successful job;
  - a completion whose red run would not count is not green;
  - a CI line on another branch's digest does not count.
- `node scripts/gate.mjs check` passes and `need --for review` asks for nothing.
- `ci-import --run 45685481262` from this branch is refused for its head SHA (`26715936…`), and
  says so. Paste what it printed. The first real import is the merge of this task.

## Out of scope

- The iOS suite on CI, and the harness jobs.
- The trial branch itself: it is retired after this merges.
- Running the suite on CI from the tool. `ci-import` reads; it never dispatches.

## Decided already

- `gh` is the client, and only reads (`gh run view`, `gh api`, `gh run download`).
- The rerun inside the job is once, never more, and only for named failed controls. A failure
  before the suite starts is not rerun.

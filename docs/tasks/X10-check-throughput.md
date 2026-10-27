# X10 — `check` throughput: parallel steps, per-step timing, merge reuse

**Worktree / branch:** named in your delegation message (from `main`, after X3 merges, because X3
adds `registry:check` to `check`). **Context pack:** `docs/tasks/X10/context.md`.
**Round cap:** 1 implementation round plus at most 2 fix rounds (D19). Tooling only, no devices: the
published package stays byte-identical.

## Why

`check` is a serial `&&` chain of about 16 steps (`package.json`), ~3 min on a 10-core machine. One
implementer ran it 4 times in one round (X3: ~12 min). Most steps don't depend on each other. After a
merge the orchestrator re-runs `check` even when the merged code tree equals a tree that already
passed.

## Do

1. **A `check` runner** (`scripts/check.mjs`; `bun run check` calls it). It runs the same steps as
   today's chain, no more and no fewer, as a small dependency graph: independent steps run
   concurrently, and steps that need the build (`prepare`) wait for it. Keep the step list as data in
   one place.
   - Concurrency defaults to a value derived from core count (say why); `--jobs N` overrides it.
   - Output: each step's log is buffered and printed whole when the step ends, never interleaved.
     A one-line summary per step gives the name, status and duration. On failure, print the failing
     step's full log last.
   - Exit codes: non-zero if any step fails. Fail fast: on the first failure, don't start new steps,
     let running ones finish, and report.
   - Steps that write to shared outputs (e.g. `lib/`, `.reassure`, temp dirs) must not race. Find
     them and serialise them, and say which.
   - `bun run check:serial` keeps today's chain for debugging.
2. **Per-step timing in the ledger:** `gate.mjs check` records each step's duration and status in
   its ledger line, and `gate.mjs table --full` prints them. Report the serial and parallel wall
   times for the same tree, from three runs each, as medians.
3. **Merge reuse:** `gate.mjs need --for merge` accepts a `check` that passed on a code tree identical
   to the merge result's code tree (the branch tip, when `main` gained nothing since the branch
   point). Device gates already follow the tree rules, so leave them. Document it in
   `ORCHESTRATOR.md` "The loop" step 5.
4. **CI:** `.github/workflows/ci.yml` runs `check` the same way, so CI and local agree. Keep the
   job's name and its required status.

Unit tests in `scripts/__tests__/` for the graph (ordering, fail-fast, no interleaving, step list
equal to the old chain's), the ledger timing and the merge rule. Each shown red. One test must fail
when someone adds a step to the old chain but not to the runner, or the reverse.

## Out of scope

Removing or speeding up individual steps, and jest/tsc configuration. Device gates (X11).
`gate.mjs wait` and other X9 items. If X9 has merged first, rebase on it.

## Gates

`node scripts/gate.mjs check` (through the new runner) and `need --for review`. The live proof is the
timing table above. Report: `docs/tasks/X10-check-throughput.report.md` (REPORT-TEMPLATE), with the
ledger exported. Commit on your branch, don't push.

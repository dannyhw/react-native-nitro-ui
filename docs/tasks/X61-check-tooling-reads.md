# X61 — `check`'s tooling tests never run while `prepare` regenerates `nitrogen/`

**Kind:** tooling · **Devices:** none · **Budget:** 1 h for round one (X57, a small tooling
task)

## Goal

`node scripts/gate.mjs check` no longer goes red on its own with ENOENT under
`nitrogen/generated/**` because two of its steps overlapped.

## Why

Workers saw `check` red once on `scripts/__tests__` with ENOENT on files under
`nitrogen/generated/**` (`patch-nitrogen.test.js` among them), then green on the next run of the
same tree. In `scripts/check-steps.mjs`, `test:tooling` declares `reads: []`, but tooling tests
read `nitrogen/` (`patch-nitrogen.test.js` and others that `git grep nitrogen/generated
scripts/__tests__` finds). Meanwhile `prepare` (bob build) deletes and regenerates `nitrogen/`
and does not need `test:tooling`, so the scheduler runs the two side by side.
`findOutputConflicts` cannot catch this because the read is undeclared.

## Behaviour

1. `test:tooling` declares the regions its tests read (`nitrogen/generated`, and `nitrogen` if
   any test reads the specs or config), and `prepare` waits for it the same way it waits for
   `test:library`.
2. `findOutputConflicts(CHECK_STEPS)` is still `[]`.
3. A step that reads a region another step writes, without declaring it, is caught by a test.
   For example, a test scans `scripts/__tests__` for paths under `nitrogen/` and requires
   `test:tooling` to declare them. Pick the narrowest check that would have caught this case.

## Proof

- `node scripts/gate.mjs check` passes, and `node scripts/gate.mjs need --for review` prints
  nothing missing.
- The new test goes red when `test:tooling`'s declared reads are put back to `[]`. Record it in
  the report as one red-proof line.
- `findOutputConflicts` goes red when `prepare` loses its need on `test:tooling`, with the
  reads declared. Record it in the report as one red-proof line.

## Out of scope

- Concurrent `bun install` or `bun run nitrogen` started by hand beside `check`. That is a
  worker's own ordering, not the scheduler's.
- Other steps' declarations, unless the new test finds them wrong. If it does, list them as
  follow-ups rather than fixing them.
- The default `--jobs` and the step list itself.

## Decided already

- Order the steps (`needs`). No copy of `nitrogen/` for the tests, no retry.

## Context

`scripts/check-steps.mjs` (`FINDINGS`, `CHECK_STEPS`, `findOutputConflicts`), `scripts/check.mjs`,
`scripts/__tests__/check-runner.test.js` (the existing conflict tests).

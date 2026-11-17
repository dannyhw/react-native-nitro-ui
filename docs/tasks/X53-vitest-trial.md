# X53 — do the root unit tests run faster on Vitest than on Jest?

**Kind:** research · **Devices:** none · **Budget:** 2 h for round one (a spike: one sitting)

## Goal

Nothing changes for people using the library: this answers whether moving the root unit tests
from Jest to Vitest shortens `check`, where Jest is about 71 s of 72 s, and what the move costs.

## Why

Owner request, after lint, format and type checks moved to faster tools and left Jest as almost
all of `check`.

## Behaviour

1. The report says where Jest's time goes today: the duration of every suite, the ten slowest,
   and how much is the runner (start-up, transform, module loading) against the test bodies.
2. The tooling suites (`scripts/__tests__`, 64 files, and `eslint-rules/__tests__`) run on Vitest
   and pass, asserting what they assert today.
3. The library suites (`src/__tests__`, 28 files, which use the React Native Jest preset) run on
   Vitest if a maintained setup for React Native exists and passes; otherwise the report says
   what blocks them and they stay on Jest.
4. The report has a time table, Jest against Vitest, for each of the two groups and for the whole
   `check`, median of three runs, with the load average beside each number.
5. The report ends with a recommendation: move everything, move the tooling suites only, or stay,
   with what each would save and what it would cost to keep.

## Proof

- The commands that ran each group on each runner, and their summary lines, in the report.
- One red proof per group on Vitest: change what a test guards, see that test fail.
- `node scripts/gate.mjs check` is run and its result reported.

## Out of scope

- The harness tests under `example/` and anything under `bench/`.
- Changing what any test asserts, deleting a test, or speeding up a slow test's body (report it).
- `scripts/gate-core.mjs`, the lease code, CI workflows.

## Decided already

- This branch starts from the X52 branch (oxlint, oxfmt, `bun check`), which is still being
  finished. It is not merged as it is: if the answer is "move", it becomes a pull request after
  X52 lands. Commit the work so the diff can be read, write the report, stop.
- A test that fails on Vitest for a difference between the runners is ported, not skipped. A test
  that cannot be ported is listed with the reason.
- Full-suite runs use every core. Before each one, run `node scripts/lease.mjs list`: while it
  shows a device of task S8 "in use", make no full-suite run (it would disturb a measurement on a
  simulator); do single-file work instead. If one is still in use when everything else is done,
  commit and report the timings as not taken.
- `bun test` is not part of this question.

## Context

`package.json` (`jest`, `scripts.test`), `babel.config.mjs`, `scripts/__tests__/helpers/`,
`scripts/check-steps.mjs` (the `test` step and its `jest` group), `src/__tests__/`,
`eslint-rules/__tests__/rules.test.js`.

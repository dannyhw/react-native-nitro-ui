# X58 — the e2e suite's own tree reads arrive whole

**Kind:** tooling · **Devices:** android · **Budget:** 2 h for round one (X57, a 2 h tooling task
of similar size)

## Goal

A real-input test that reads the Android accessibility tree through the driver's CLI gets the
whole answer, however large and however loaded the machine, instead of failing on cut-off JSON.

## Why

`tree()` in `example/e2e/real-input/os-tree.ts` runs the driver CLI (`agent-device snapshot
--json`) with `execFileSync` and parses its stdout from a pipe. The CLI waits at most 2 s for
stdout to drain and then calls `process.exit` (`node_modules/agent-device/dist/src/process-exit.js`,
`exitAfterFlush`), so a large answer on a loaded machine is cut short. Seen five times locally
("the driver answered with 524277 / 655354 bytes that are not a snapshot this suite can read"),
and on every run of a CI trial on a slower hosted runner (219–731 KB answers, DatePicker and
Picker tests).

## Behaviour

1. `tree()` returns the full snapshot when the driver's answer is several MB and the driver
   exits as soon as it has written it: no truncated JSON reaches the parser.
2. When the driver fails or answers with something that is not a snapshot, the error says so as
   it does now, with the byte count.
3. Nothing the read leaves behind persists: a temporary file is removed after each read, pass or
   fail, and none is written inside the repository.
4. Every other behaviour of `tree()` is unchanged: serial, session, `--raw`, timeout, the node
   shape it returns.

## Proof

- `node scripts/gate.mjs check` passes, and `node scripts/gate.mjs need --for review` prints
  nothing missing.
- A unit test with a fake driver binary that prints a multi-MB JSON snapshot to stdout and calls
  `process.exit` straight away: it passes with the change, and goes red when the read is put back
  on a pipe. Write the red proof line in the report.
- A filtered run on a leased emulator: `node scripts/gate.mjs real-input:android -- --control
  date-picker --control picker` passes.

## Out of scope

- The driver itself, and any GitHub activity on its repository.
- The iOS suite, and every read that goes through the e2e engine rather than the driver CLI.
- The SegmentedControl poll timeout seen in CI.

## Decided already

- The fix is on our side: the CLI's stdout goes to a file the read owns, not a pipe; a file write
  from Node is synchronous, so nothing is left buffered at exit. Use the OS temp directory.
- A test may need the binary path to be injectable; keep any override out of the suite's
  normal path (no new environment variable the gates set).

## Context

`example/e2e/real-input/os-tree.ts` (`tree`, `driverBinary`), `example/e2e/README.md` (the
`os-tree.ts` rows), `scripts/__tests__/` for where Vitest tests live.

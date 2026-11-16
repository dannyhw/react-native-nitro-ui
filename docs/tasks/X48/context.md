# X48 code map

Paths are from the repo root. Line numbers are as of the branch point.

## The ledger and its digests

- `scripts/gate-core.mjs`
  - `TOOLING_PREFIXES`, `TOOLING_FILES`, `isToolingPath` (44-117): check-only paths, in no
    platform half.
  - `platformMappingFor` (156): which half owns a path. Unmapped code counts as both.
  - `platformTreesFromEntries` (239): the two platform digests.
  - `requiredGatesFor` (129): what review and merge ask for.
  - `platformOfGate`, `digestKeyFor` (456-482): which digest a gate is keyed to. Today every
    device gate of a platform shares that platform's half.
  - `gateStateFor`, `gateRowFor` (503-593): green, red, stale or missing for a ledger line,
    including the fallback for a line that has no `trees`.
  - `decideNeed` (655), `renderGateTable` (852), `explainNeedRow` (1707).
  - `canonicalGateName`, `resolveGate` (1552-1700): a filtered run gets its own name. Real-input
    takes `-- --control <id>` (repeatable); harness takes suite names.
  - `LEDGER_VERSION` (20).
- `scripts/gate.mjs`
  - `readTrees` (1089), `changedCodePaths` (1131), `runGate` / `runGateUnclaimed` (1155, 1383),
    `metroPreflight` and `stopOwnMetro` (1197-1383), `commandStatus`, `commandNeed`,
    `commandTable` (1806-1990), `main` (2148).
- Tests: `scripts/__tests__/gate.test.js`, `gate-check.test.js`, `gate-logs.test.js`,
  `gate-lease-required.test.js`, `gate-runner.test.js`.
- `scripts/task-ready-core.mjs` reads the ledger for the hand-in checklist.

## What each device run reads

- Harness: `scripts/harness.mjs`, `scripts/harness-isolated.mjs`, `scripts/harness-run-state.js`,
  `scripts/harness-suite-timing.mjs`, `example/jest.harness.config.mjs`,
  `example/rn-harness.config.mjs`, `example/metro.config.js`, the 36 files in
  `example/__tests__/`. `example/index.js` imports `./src/App`; whether a harness run loads it
  is the open question in the brief. No file in `example/__tests__/` imports from `example/src/`.
- Real-input, iOS: `scripts/real-input/ios.mjs`, `ios-log.mjs`, the UI-test target under
  `example/ios/`, and the shared files below.
- Real-input, Android: `scripts/real-input/android.mjs`, `android-*.mjs`, `uiautomator.mjs`,
  `a11y-sweep*.mjs`, and everything under `example/e2e/` (`e2e.config.ts`, `real-input/*.e2e.ts`
  and their helpers).
- Real-input, shared: `scripts/real-input/controls.mjs`, `support.mjs` (`Suite` holds per-control
  results; `finish` prints the totals), `report.mjs`, `screens.mjs`, `a11y.mjs`, `tab-targets.mjs`,
  and the example screens in `example/src/`.

## Where a run's failed units are known

- Real-input: `Suite.results` in `scripts/real-input/support.mjs`, one entry per control with
  `missing` and `log.passed`; auxiliary checks (the accessibility pass, tab targets) are separate
  and ride every run, filtered or not.
- Harness: jest's per-suite results; `scripts/harness-suite-timing.mjs` already writes a per-suite
  file the gate reads back (`readSuiteTiming` in `scripts/gate.mjs`).

## Docs that state the rules

`docs/agents/gates.md`, `AGENTS.md` "Definition of done", CONTRIBUTING "Recording a gate run"
and "Running the real-input tests", `.claude/skills/brief/SKILL.md`,
`.claude/skills/orchestrate/SKILL.md` "Merging".

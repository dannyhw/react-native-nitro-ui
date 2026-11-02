# X16 — Tooling sweep 2

**Worktree / branch:** named in your delegation message, from `main`. **Round cap:** 1 round, plus at most 2 fix
rounds (D19). **Devices:** your lease (`lease.mjs acquire --task X16 --boot`). This host's iOS simulators work again
since its restart.

Four items from `docs/tasks/FOLLOWUPS.md`. Read each line first. Every fix needs a test or check that was shown red
first (AGENTS.md).

## Do

1. **`check` breaks in a shell that has sourced a lease env.** `gate.test.js`'s `runCli`/`spawnCli` hand the whole
   `process.env` to the child, and `gate-logs.test.js`'s `gitEnv` doesn't strip `METRO_PORT`. With a lease env
   sourced, 25 tests fail across `gate.test.js`, `gate-check.test.js` and `gate-logs.test.js`. Give every spawned
   CLI in the tests a scrubbed env: no `NITRO_UI_*`, `METRO_PORT`, `IOS_*`, `ANDROID_SERIAL` or lease variables,
   unless a test sets them on purpose. Show red by running `check`'s test step with a fake lease env exported.
2. **`lease.mjs acquire --exclusive --boot` ignores `--boot`.** The boot branch in `poolHandoff` is
   `if (!lease.exclusive)`. Make `--exclusive --boot` boot the leased pair, or the requested platform, after it powers
   the pool off. Test it.
3. **`gate.mjs bench --help` records a FAIL row in the ledger.** A help or usage probe shouldn't be recorded as a
   gate run. Test it.
4. **`real-input:ios` `a11y:switch` decides on one read** of the RN wrapper's accessibility frame. On
   maintainer-mac-1 it failed twice with the wrapper's box at exactly 1/3 of the switch's (the screen scale), then
   passed on re-run.
   - Make the check re-read until the frame is stable (two equal reads), with a bounded wait, before it compares.
   - Never wait for the expected value.
   - If a stable read still disagrees, fail as before.
   - If you can reproduce the ⅓-scale read and it turns out to be a real accessibility-frame bug in our view or in
     RN, STOP and report it rather than retrying around it.

Remove each FOLLOWUPS line you close, and point it at this report.

## Gates

- `check`;
- `real-input:ios`, because item 4 changes the iOS real-input runner; run it in full;
- `harness:*` only if you change harness-side code;
- then `need --for review`.

Report at `docs/tasks/X16-tooling-sweep-2.report.md`, with the ledger exported.

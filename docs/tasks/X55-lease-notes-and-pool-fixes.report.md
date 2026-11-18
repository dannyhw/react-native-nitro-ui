# X55 — a lease says what it will run next, and the pool stops pinning worktrees

**Branch:** `task/X55-lease-notes-and-pool-fixes` (from `main` at `9e4974df`) · **Round:** 1 of up
to 3 · **Lease:** none (no device used)

## Summary

All six behaviours are in place, each with a test shown red once.

1. **Lease note.** `acquire --note "<text>"` sets it. `note <lease-id|task> "<text>"` changes
   it, and `""` clears it. `list` prints it at the end of the lease's row, and `list --json`
   includes it as `note`. A note is one line of at most 200 characters. Running
   `acquire --note` for a task that already holds a lease changes that lease's note.
2. **Orchestrate skill, Merging.** A merge run takes its lease with a note listing its gates in
   order and which one needs a quiet machine. It updates the note when the plan changes, and
   reads the other leases' notes before each device step.
3. **Merge branch name.** The skill now names the merge branch `merge/<name>`. `classifyTask`
   takes HEAD's branch (`head`). When a `task/<ID>-...` branch of the task is the only thing
   keeping its records, the reason says HEAD is on it and names `merge/<name>`. A worktree or
   live branch elsewhere still takes precedence as the reason.
4. **Working directory.** `deviceOperations` runs every `adb` call and the emulator launch with
   `cwd` set to the pool's state directory (`home`, created if missing). An adb server forked by
   one of those calls inherits that directory.
5. **Stale rows.** `serialHolder` (in `device-pool.mjs`) finds the other row that holds a row's
   serial. That is a row with a live lease, or one with a run or boot in flight. Failing both,
   it is the row the pool recorded on that serial most recently. **Decision for the
   reviewer:** that last rule is how I read "a running device". It needs no device I/O, which
   `list` must not do (an adb query can start a server). It holds because a console port runs
   one emulator, and the pool deletes a row once its device is confirmed off. A row's own lease
   or run beats another row's newer record. Reap, exclusive acquires included, skips a stale
   row in the plan pass and again in the per-device re-check. `list` marks it `stale:`.
6. **Watchdog.** A `checkout` fact (`warn`, state `behind`) reports when HEAD lacks commits of
   `origin/main` as last fetched. Like every fact, it is said once, again on recovery, and
   always by `--status`.

`lease.mjs list` on this machine, run once:

```
pool                     avd:x16_avd                  emulator-5574            no lease             stale: emulator-5574 is avd:nitroui_a's (lease X54 holds it)
```

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2166 tests / 94 suites | `ecc543e3df91` | 1 m 30 s | start 56.5 / med 70.5 / max 89.3 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

`need --for review`: `3 gate(s) missing for review: check, harness:ios, harness:android`
(before `check` ran). It notes `scripts/device-pool.mjs` as "outside the known prefixes",
treated as both platforms. The harness gates were not run; see the question below.

## Red proofs

- `lease.test.js` "carries a note from acquire to list…" -> drop the note from the `list` row ->
  `expect(listedRow()).toContain(plan)` red.
- `task-records.test.js` "says when HEAD is on a branch of the task…" -> HEAD-branch rule
  disabled -> `expected { verdict: 'archive' } to deeply equal { verdict: 'keep' }`.
- `device-ops.test.js` "starts the emulator and adb in the pool state directory…" -> `cwd`
  removed from the emulator spawn -> `emu.cwd` is the checkout, not the state dir. With `cwd`
  removed from `adb` instead, `adb.cwd` is the checkout.
- `device-pool.test.js` "never acts through the other row when the serial has …" (lease, run,
  later record) -> plan-pass guard off -> `expected [] to deep equally contain { key:
  'avd:x16_avd' … }`.
- `device-pool.test.js` "rechecks the serial before each device…" -> re-check guard in
  `canActOnKey` off -> `expected [] to deep equally contain ObjectContaining{…}`.
- `lease-pool-cli.test.js` "marks a row stale in `list`…" -> `list` ignores `stale` -> the row
  does not contain `stale: emulator-5574 is avd:nitro-ui-a's …`.
- `watchdog.test.js` "warns when the checkout it runs from is behind origin/main…" ->
  `checkoutFact` left out of the facts -> `expected +0 to be 10`.

## Files changed

- Lease note: `scripts/lease.mjs`, `scripts/lease-core.mjs`, `scripts/__tests__/lease.test.js`
- Pool: `scripts/device-pool.mjs`, `scripts/__tests__/device-pool.test.js`,
  `scripts/__tests__/device-ops.test.js`, `scripts/__tests__/lease-pool-cli.test.js`
- Records: `scripts/task-records-core.mjs`, `scripts/task-records.mjs`,
  `scripts/__tests__/task-records.test.js`
- Watchdog: `scripts/watchdog.mjs`, `scripts/watchdog-core.mjs`,
  `scripts/__tests__/watchdog.test.js`
- Docs: `CONTRIBUTING.md`, `.claude/skills/orchestrate/SKILL.md`,
  `.claude/skills/watchdog/SKILL.md`

## Follow-ups

- Pool: nothing ever drops a stale row, so `x16_avd` stays in `pool.json` and keeps showing as
  stale. A reap could drop a stale row whose AVD `devices.json` does not name.
- Pool: `normalizeDevices` accepts two pairs on one `emulatorPort`.
- Gates: `scripts/device-pool.mjs` is not on the tooling list, so a pool-only change owes both
  harness gates for review.

## Questions for orchestrator

- `need --for review` wants `harness:ios` and `harness:android`, because it treats
  `scripts/device-pool.mjs` as touching both platforms. The brief says no device. Options:
  (a) the orchestrator runs both harness gates on this branch under its own lease, or leaves
  them to the merge run; (b) a device-capable fix round runs them. **Recommendation: (a), at
  merge.** The pool change touches only the `cwd` of adb and emulator calls and the reap
  decision, and neither changes a harness run on a healthy pool.

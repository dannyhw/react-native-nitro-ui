# X38 — Remove two lease-pool features nothing has used

**Worktree / branch:** `task/X38-lease-unused-features` (stacked on `task/W3-tooling-removal`).
**Round cap:** 1 round. **Devices:** none — no lease, no device gate (both pairs are in use by
other tasks; this change is exercised by every later device run).

## Goal

The device lease pool loses two features that have no recorded use, so there is less of it to keep
working.

## Why

An audit of the lease and pool code (20,600 lines) found two features with no evidence of use:

- Older-iOS-runtime simulators (about 905 lines of code and tests): built so one task could check a
  control on an older iOS; that task's report says the check was not done, and nothing has asked for
  it since. A hand-booted simulator and `IOS_SIM_UDID` do the same job.
- The app reset between tasks (about 1,030 lines): it clears the example app's storage when a pair
  changes hands. The audit found no case of inherited app state breaking a run.

## Behaviour when done

1. The older-runtime feature is gone: the `--ios-runtime` option and `NITRO_UI_LEASE_IOS_RUNTIME`,
   the look-lease refusal in `scripts/gate-core.mjs` that exists only for it, `iosRuntimes` in
   `scripts/devices.example.json`, the doctor checks for it, their tests, and the CONTRIBUTING
   section that describes it. The two FOLLOWUPS lines the audit names (about lines 151 and 205 of
   `docs/tasks/FOLLOWUPS.md` on main; find them by content) are deleted.
2. The between-task app reset is gone: the reset itself, `--no-reset`, their tests, and the
   CONTRIBUTING lines. Before deleting it, search the task reports and FOLLOWUPS that are still in
   the repository, and `git log --all --grep` for a run that inherited app state from another task
   and went wrong. If you find one, keep the reset, delete nothing of it, and report the evidence.
3. Everything else about leases behaves as before: `acquire`, `release`, `list`, `reap`, exclusive
   leases, the queue, `--boot`, the gate's lease check. Their tests pass unchanged, apart from
   deletions of tests for the two removed features.
4. No document or usage text mentions a removed option. `git grep` finds no reference to a removed
   symbol, flag or environment variable.

## Proof

- Every jest file under `scripts/__tests__` that touches leases, the device pool, doctor or the gate
  lease check passes. A deleted test is deleted because what it tests is gone.
- `node scripts/gate.mjs check` green.
- Do not acquire a lease and run no device gate: both device pairs are in use by other tasks, and
  this change is exercised by every later device run. `need --for review` will ask for harness runs
  because lease code is not on the check-only list; say so in the report and leave those runs to the
  merge.
- Do not run `lease.mjs`, `doctor.mjs` or `device-pool.mjs` against the real machine other than
  `lease.mjs list`: they can boot or power off devices that other tasks are using. The tests use
  fake stores and stubs.

## Out of scope

The idle reaper, build slots, the queue, exclusive leases, `doctor --prime`, the Node re-exec, the
duplicated CLI tests (audit rows 1, 2, 5 to 10): those wait for a decision on replacing the pool.
The gate system beyond the one refusal named above.

## Decided already

- If the audit was wrong that something is unused (a kept test or code path needs it), keep it and
  say so, as happened with `--boot-timeout-minutes` in the previous round.

## Budget

3 hours. At the budget, commit, write the report with what is and is not done, and stop.

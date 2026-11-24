# X65 — `real-input:ios` runs alone because the gate runner makes it

**Kind:** tooling · **Devices:** none · **Budget:** 2 h for round one (X61, a tooling task with no
device run)

## Goal

`real-input:ios` never shares the machine with another device gate from this clone, whichever
one starts first, so no run's taps are dropped because a second device run was loading the
machine.

## Why

`docs/agents/gates.md` says `real-input:ios` runs alone, but only the person starting it checks.
A merge script waits for a quiet machine before it starts the gate. A worker that leases a device
afterwards can start a harness or real-input gate beside it, and nothing stops that. A merge run
on 2026-11-24 dropped the first tap on a Switch with another worker's run beside it.

Separately, `scripts/__tests__/lease.test.js` "hands one stale lock to one stealer, and no pair
to both" went red once in `check` at load 45, with `expected [ +0, 2 ] to deeply equal [ +0, +0 ]`:
one acquire exited 2. The failure did not say why.

## Behaviour

1. A device gate (`harness:*`, `real-input:*`, `bench`) asked to start while a `real-input:ios`
   run from this clone is live, from any worktree, waits until that run ends and says what it is
   waiting for. It does not run beside it.
2. `real-input:ios` asked to start while any other device gate from this clone is live waits
   until they have ended, and says which ones it is waiting for.
3. A run whose process is gone counts as ended, so a crashed run cannot hold the machine.
4. The wait has a stated ceiling, and reaching it fails the gate with a message naming the run
   still live. A `--background` start and `wait` keep working as today.
5. When that lease test fails, its message carries each acquire's exit code and stderr.

## Proof

- `node scripts/gate.mjs check` passes, and `node scripts/gate.mjs need --for review` prints
  nothing missing.
- Unit tests for Behaviour 1–4 with stand-in live runs and no device. Show each new test red
  once by removing the wait.
- Show the lease test's new message once by breaking the stealer, then restore it.

## Out of scope

- Metro, simulators and emulators started outside a gate. Only gates are counted.
- Why HID taps are dropped. That stays the open follow-up.
- Fixing the stale-lock race in `scripts/lease.mjs` itself. Only make its failure say what
  happened.
- Gates from another clone or machine.

## Decided already

- Keep the change in `scripts/gate.mjs`, `scripts/gate-core.mjs` and `scripts/__tests__/`. Those
  are tooling paths and owe only `check` at merge. If you need `scripts/gate-runner.mjs` or
  `scripts/lease.mjs`, stop and say why in Questions first, because either one makes the merge
  owe device runs.
- The "live run" source is your call. Candidates: the lease state's per-gate claims (what
  `lease.mjs list` prints as `in use (<gate>)`), or the gate records `gate.mjs` keeps for
  `--background` runs. It must see runs started in other worktrees of this clone.
- `docs/agents/gates.md` "Running two gates at once" says the runner now enforces this.

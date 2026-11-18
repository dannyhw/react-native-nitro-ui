# X55 — a lease says what it will run next, and the pool stops pinning worktrees

**Kind:** tooling · **Devices:** none · **Budget:** 3 h for round one (X50 and X53, tooling tasks
with no device work, took about 3 h each)

## Goal

Nothing changes for people using the library: two orchestrators sharing the devices can see what
the other is about to run, a merged task's records archive at its merge, and old worktrees can be
removed while the pool's emulators are up.

## Why

Owner request, from one day of two orchestrators on one machine. One gave up its devices for two
hours because `lease.mjs list` shows the gate running now and nothing planned. A task's records
stayed on `main` because its merge branch was named `task/<ID>-merge`. Both pool emulators run
with a removed task's worktree as their working directory, which keeps 13 GB on disk. The pool
file holds a row for an AVD that no longer runs, on the serial a live pool emulator uses.

## Behaviour

1. A lease carries an optional note: `lease.mjs acquire --note "<text>"` sets it,
   `lease.mjs note <lease-id> "<text>"` changes it, and `lease.mjs list` prints it on the lease's
   row (and in `--json`). An empty note clears it.
2. The orchestrate skill tells a merge run to state in its lease note the gates it will run, in
   order, and whether one needs a quiet machine; and to read the other leases' notes before a
   device step.
3. The orchestrate skill names a merge branch `merge/<name>`. When `task-records.mjs` keeps a
   task because HEAD's own branch is a `task/<ID>-...` branch, its reason says so and names the
   `merge/<name>` form.
4. An emulator the pool boots, and an adb server the pool starts for it, run with a working
   directory outside every worktree (the pool's state directory).
5. A reap never shuts a device down through a pool row whose serial another row holds with a
   live lease or a running device, and `lease.mjs list` marks such a row as stale.
6. `watchdog.mjs` prints a warning line when the checkout it runs from is behind `origin/main`.

## Proof

- `node scripts/gate.mjs check` passes. `node scripts/gate.mjs need --for review` prints nothing
  missing.
- Unit tests for each line, each shown red once: the note round trip, the keep reason, the
  spawn options (working directory) of the emulator and adb calls, a reap over a fixture pool
  with two rows on one serial, the watchdog line on a fixture checkout that is behind.
- `node scripts/lease.mjs list` run once on this machine, its stale row quoted in the report.

## Out of scope

- Booting, restarting or shutting down any pool device, and editing the pool file by hand.
- A queue or scheduler for gates; the note is free text.
- Removing one named worktree with `worktrees.mjs`.

## Decided already

- No device is used. Line 4 is proven by the options the pool passes, not by a reboot; the
  emulators already running keep their old working directory until they are next restarted.
- The note is one line, at most 200 characters, stored with the lease.

## Context

`scripts/lease.mjs`, `scripts/device-pool.mjs` (the emulator spawn, `reap`),
`scripts/task-records-core.mjs` (`classifyTask`), `scripts/watchdog.mjs`,
`scripts/watchdog-core.mjs`, `.claude/skills/orchestrate/SKILL.md` ("Merging"), CONTRIBUTING
"Leasing a device or port".

# X9 — Tooling: dry runs, warm caches, one build at a time, gate waits

**Worktree / branch:** named in your delegation message (from `main`).
**Round cap:** 1 implementation round plus at most 2 fix rounds (D19). Tooling only: the published
package must stay byte-identical (`npm pack` = `etc/package-files.txt`, same contents).

**Context pack:** `docs/tasks/X9/context.md` (the files and symbols each item touches).

## Why

The 2026-10-27 run on the second machine:

- RECOVERY's first step (mint this machine's baselines) had two blockers that only reading the code
  revealed: baselines were not per machine (fixed by X8), and the iOS device key came from the
  simulator's name.
- The first native build on a fresh machine took ~9.5 min (iOS) and 4 m 43 s (Android), against
  138 s and 17 s warm (X6).
- On a 10-core machine, two app builds plus `check` pushed load to 13.
- `example/ios/Podfile.lock` stayed at `NitroUi 0.2.0` after the 0.3.x releases, so every iOS
  build dirtied the tree and invalidated a fresh `app.stamp`.
- Implementers poll background gates with `sleep N; tail` loops.

## Do

1. **`bun bench --dry-run`** (both platforms) prints, without booting, building or measuring
   anything: the device key, the machine label, the baseline path and whether it exists, the load
   ceiling and current load, and whether `--update-baseline` / `--check` would refuse before
   starting (reuse X8's refusal functions, don't copy them). It must not boot a simulator, so it
   reads `simctl list` only. For a stopped AVD it reads the API level and profile from the AVD's
   config. Exit 0 when a mint or check could start, 2 with the reasons when not.
2. **The lockfile follows releases.** After a Version Packages merge, `main`'s
   `example/ios/Podfile.lock` must not be stale.
   - Add a static guard to `check` that fails, naming the fix, when the lock's `NitroUi (x.y.z)` ≠
     `package.json` `version`.
   - Make the release path keep it true, for example a step that updates the lock in the
     Version Packages PR, but say how CI can do it on its runners (it runs no CocoaPods on Linux).
   - If no option keeps CI and `check` consistent without CocoaPods on CI, stop and ask (Questions
     for orchestrator) with options. Don't add a guard that turns the release PR red.
3. **Warm caches:** `node scripts/doctor.mjs --prime` runs `scripts/build-app.mjs` for both platforms
   in the main checkout, so ccache, Gradle and the module caches are warm before the first task.
   Doctor reports, as a warning, a machine whose caches look cold (your choice of signal, stated).
4. **One heavy native build at a time.** `build-app.mjs` takes a machine-wide build slot, reusing
   `lease-core.mjs`'s lock and state dir. The limit is `maxConcurrentBuilds` in
   `~/.nitro-ui/devices.json`, default 1. It waits with a one-line message naming the holder,
   and a stale holder (dead pid) is reclaimed. A stamp-fresh skip takes no slot.
5. **`gate.mjs wait`:** `gate.mjs <gate> --background` starts the gate detached, recording pid and
   log. `gate.mjs wait [--timeout-minutes N]` blocks, prints a progress line every minute (elapsed
   time and the log's last line), and exits with the gate's code, or with a distinct "still running"
   code at the timeout. The ledger records a backgrounded gate exactly as a foreground one.
   Document it in AGENTS.md "Quality bar" as the way to wait.
6. **Unowned devices:** `lease.mjs list` and doctor report a pool simulator or emulator that is
   booted while no lease holds it (a warning, never an action).

Each new behaviour gets unit tests in `scripts/__tests__/`, each shown red. Fixtures must not
coincide with the right answer.

## Out of scope

Per-step `check` timing and a parallel `check` (X10), warm device pools and emulator GPU mode (X11). Changing which steps `check` runs, any bench measurement, the conformance suite (X4), and CI harness
jobs.

## Gates

- `node scripts/gate.mjs check`, then `need --for review`. If it asks for device gates (for example
  because `build-app.mjs` or `lease.mjs` count as unmapped), run them on leased devices and say so.
- Live proofs, each one line in the report:
  - `--dry-run` on both platforms on this machine;
  - a second `build-app` waiting for the first;
  - `gate.mjs wait` on a real `check`.
- Report: `docs/tasks/X9-tooling-smoothing.report.md` (REPORT-TEMPLATE), with the ledger exported.
  Commit on your branch, don't push.

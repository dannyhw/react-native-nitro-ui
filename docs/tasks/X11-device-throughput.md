# X11 — Device throughput: emulator GPU, warm device pool, harness timing

**Worktree / branch:** named in your delegation message (from `main`, after X9 merges, because both
touch `scripts/lease*.mjs` and doctor). **Context pack:** `docs/tasks/X11/context.md`.
**Round cap:** 1 implementation round plus at most 2 fix rounds (D19). Devices from
`node scripts/lease.mjs acquire --task X11`. The published package stays byte-identical.

## Why

Measured on the 10-core machine (2026-10-27):

- The Android harness takes 455 s for 214 tests, against 149 s for iOS's 165.
- The harness starts the emulator with `-gpu swiftshader_indirect` (software rendering), while
  `scripts/real-input/android.mjs` uses `-gpu host`. So the GPU mode depends on whoever booted the
  emulator first.
- The harness logs "Hardware acceleration (KVM/HVF) appears unavailable", but `emulator -accel-check`
  exits 0 and reports Hypervisor.Framework. The harness looks for a phrase this emulator version
  doesn't print.
- Every iOS 27 simulator boot drives load1 to ~100–165, and it takes 4–6 min to fall below 5.
- Each task boots and shuts down its own devices.
- `scripts/real-input/ios.mjs` suggests `open -a Simulator`. On Xcode 27 that launches DeviceHub,
  which auto-boots its own default device.

## Do

1. **One emulator launch configuration.** All our launch paths (harness patch, real-input, the lease
   pool below) use the same args from one place, with `-gpu host` for harness and real-input. Benches
   keep whatever they use today, unchanged (baselines depend on it), and the code says so.
   - Prove it by running the Android harness under `swiftshader_indirect` and under `host`, same tree
     and same device, with full results both times. Report wall time and load median for each, and
     any test whose result differs.
   - If `host` changes a result, stop and ask (Questions) rather than re-baselining a test.
2. **Fix the false acceleration warning** in `patches/@react-native-harness%2Fplatform-android@1.6.0.patch`:
   treat `-accel-check` exit 0 or an `accel` / `Hypervisor.Framework` line as usable. Add a unit test
   on captured outputs, both this machine's and the "unusable" form.
3. **Per-suite timing:** `harness:<platform>` records per-suite durations in the ledger line, printed by
   `gate.mjs table --full`. Name the top 5 Android suites and whether their time is app restarts,
   waits or test bodies. Report only; fixes are a follow-up.
4. **Warm device pool.** The lease owns device lifecycle:
   - `acquire` boots the pair's devices if they're down, and waits until they're settled (load1 under
     the bench ceiling, or a timeout, then a warning). It resets the app between tasks: uninstall the
     example app, or the cheapest reset that is provably complete, with a test.
   - `release` leaves devices booted.
   - Devices with no lease are shut down after `idleShutdownMinutes` (devices.json, default 30), by
     `lease.mjs reap`. Run `reap` from `acquire`/`release`/`list`; no daemon.
   - `--exclusive` (benches) shuts down every non-leased pool device before it returns.
   - Never touch devices outside `devices.json`, nor `emulator-5560`.
   - Update AGENTS.md and CONTRIBUTING: tasks no longer shut down leased devices; the lease does.
     Remove the `open -a Simulator` hint.
5. **Concurrent harnesses, measured:** run `harness:ios` and `harness:android` at the same time on
   one lease after 1 and 4, against one after the other. Report wall time, load median and max, and
   failures for each. Recommend for or against in the report; don't change the default.
6. **Quieter iOS simulators (investigation, bounded to one attempt):** check whether the boot spike's
   heaviest daemons can be disabled inside a pool simulator, for example with
   `simctl spawn <udid> launchctl disable …` or a settings plist. Measure load1 for a boot with and
   without, and adopt it only if it is reversible and the harness still passes. Otherwise write one
   line in Follow-ups.

Unit tests for the launch-args source, the accel parser, pool reaping and reset, and the per-suite
ledger fields, each shown red.

## Out of scope

Bench methodology and baselines. Rewriting slow suites. CI harness jobs.

## Gates

`check`, then `need --for review`, which will ask for both harnesses. The measurements from items
1, 5 and 6 go in the report as tables. Report: `docs/tasks/X11-device-throughput.report.md`
(REPORT-TEMPLATE), with the ledger exported. Commit on your branch, don't push.

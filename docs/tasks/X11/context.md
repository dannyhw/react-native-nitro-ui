# X11 context pack: real paths (checked at `main` when the brief was written)

| Item | Files and facts |
|---|---|
| Emulator launch args | Harness: `node_modules/@react-native-harness/platform-android/dist/emulator-startup.js` (`COMMON_EMULATOR_ARGS` has `-gpu swiftshader_indirect`), patched by `patches/@react-native-harness%2Fplatform-android@1.6.0.patch` (it already adds `-port` from `EMULATOR_PORT`), wired in `package.json` `patchedDependencies`. Real-input: `scripts/real-input/android.mjs` around line 3147 (`-gpu host -no-window …`). Benches: `scripts/bench/` (leave as is) |
| Accel warning | the same harness file: `isAccelerationUsable` looks for "is installed and usable", while this machine's `emulator -accel-check` prints `accel` / `0` / `Hypervisor.Framework OS X Version …` and exits 0 |
| iOS hint | `scripts/real-input/ios.mjs` around line 140 (`xcrun simctl boot ${udid} && open -a Simulator`) |
| Harness gate | `scripts/harness.mjs` (the runner `gate.mjs harness:<p>` calls), `scripts/harness-timing-gate.js`, `scripts/gate.mjs` / `scripts/gate-core.mjs` for ledger fields; harness suites in `example/__tests__/*.harness.tsx` |
| Lease / pool | `scripts/lease.mjs`, `scripts/lease-core.mjs` (`withLock`, `stateHome`, `statePaths`, `decideAcquire`, `pruneExpired`), `scripts/devices.example.json`, machine-local `~/.nitro-ui/devices.json` (pairs: iOS `udid`, Android `avd`/`emulatorPort`/`adbPort`); doctor in `scripts/doctor.mjs` / `scripts/doctor-core.mjs` |
| Rules to update | `AGENTS.md` (Environment: "Shut down simulators/emulators you started"), `CONTRIBUTING.md` "Leasing a device or port" |
| Tests | `scripts/__tests__/lease.test.js`, `doctor.test.js`, `gate.test.js` |

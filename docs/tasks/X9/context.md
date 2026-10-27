# X9 context pack: real paths (checked at `main` when the brief was written)

| Item | Files and symbols |
|---|---|
| 1 dry run | `scripts/bench/run.mjs` (argv handling, R4 fail-fast before device resolution), `scripts/bench/baseline.mjs` (`labelPreFlightProblem`, `baselineFileFor`, `machineLabelFromEnv`, `machineLabelProblem`), `scripts/bench/devices.mjs` (`resolveIosDevice` boots a stopped sim, so don't call it; `iosDeviceKey`, `resolveAndroidDevice`, `avdHardwareProfile`), `scripts/bench/lib.mjs` (`loadCeiling`, `loadBlocker`), `scripts/bench/machine.mjs` |
| 2 lockfile | `example/ios/Podfile.lock` (`NitroUi (x.y.z)` under PODS, plus its SPEC CHECKSUMS line), `NitroUi.podspec` (`s.version = package["version"]`), `package.json` (`release:version` = `changeset version`), `.changeset/config.json`, `.github/workflows/release.yml`, `.github/workflows/changeset-status.yml`, `.github/workflows/release-tag.yml` |
| 3 warm caches | `scripts/doctor.mjs`, `scripts/doctor-core.mjs` (pure, unit-tested in `scripts/__tests__/`), `scripts/build-app.mjs` |
| 4 build slot | `scripts/build-app.mjs`, `scripts/app-stamp-core.mjs` (stamp-fresh skip), `scripts/lease-core.mjs` (`withLock`, `stateHome`, `statePaths`), `scripts/devices.example.json`, `~/.nitro-ui/devices.json` (machine-local, not in the repo) |
| 5, 6 gates | `scripts/gate.mjs`, `scripts/gate-core.mjs` (`TOOLING_PREFIXES`, `TOOLING_FILES`, `requiredGatesFor`), `package.json` `check` |
| 7 unowned devices | `scripts/lease.mjs` (`list`), `scripts/lease-core.mjs`, `scripts/doctor.mjs` |

Tests for all of these live in `scripts/__tests__/` (for example `lease.test.js`, `gate.test.js`, `doctor.test.js`, `bench-baseline-machine.test.js`, `bench-device-key.test.js`).

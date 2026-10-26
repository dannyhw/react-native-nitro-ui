# X1 — Dev tooling: CI checks, fresh-build helper, device lease

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/X1` (branch `task/X1-dev-tooling`, from `main`).
**Round cap (D19):** 1 + 2 fix rounds. Do not push. No personal info (D25). From the process review
(`docs/tasks/PROCESS-review-2026-10-26.md` §4, items 6, 7, 8 and 10) — read it first.

1. **GitHub CI, checks only.** The repo is public, so standard GitHub-hosted runners are free. Make
   `.github/workflows/ci.yml` run `bun run check` (ubuntu, Node from `.nvmrc`, bun 1.4) and an
   Android `assembleDebug` of the example, on push to `main` and on pull requests. Leave the
   harness/iOS/bench/smoke/release jobs out of the triggered set (keep the files, `workflow_dispatch`
   only). Fix anything that only passes on this Mac: missing files, path assumptions, macOS-only tools
   in `check` — make those steps skip cleanly on Linux with a printed reason, or run them in a macOS
   job if they truly need it (the native ASan tests). Validate the workflow locally with `actionlint`
   if available. Do **not** re-enable workflows on GitHub (`gh workflow enable`) — the orchestrator does
   that after merge.
2. **`scripts/build-app.mjs --platform ios|android`** — one fresh build of the example app per
   worktree: fixed output path (`-derivedDataPath` under the worktree for iOS; Gradle `--rerun` on
   `packageDebug` when the dex lacks a registered component), writes `app.stamp` (code tree hash
   excluding `docs/`, per-component symbol/dex counts). The harness and real-input entry scripts read
   the stamp and refuse (clear message) when the tree hash differs from `HEAD`'s code tree or a
   registered component is missing from the binary. Show the refusal red once (stale app) and green
   after a rebuild. Document in CONTRIBUTING; set `HARNESS_APP_PATH` from it.
3. **`scripts/lease.mjs acquire|release|list`** — device/port leases per machine in
   `~/.nitro-ui/leases.json` with a file lock: hands out simulator UDID, AVD, emulator port, adb port
   and Metro port from a per-machine config `~/.nitro-ui/devices.json` (document its shape; ship an
   example file in `scripts/`), enforces max 2 device leases and an `--exclusive` lease (bench,
   baselines) that waits for all others to end. Prints an env file the scripts can `source`. The
   reserved serial `emulator-5560` can never be leased. Unit tests for the lock and the limits.
4. **Small fixes:** device scripts re-exec under `.nvmrc`'s Node via fnm when the running Node is
   wrong (instead of refusing); `scripts/bench/build.mjs` and the smoke scripts use one pod-install path
   that doesn't churn the `COCOAPODS:` stamp in `Podfile.lock`; `--update-baseline` prettier-formats
   its output.

Gates: `bun run check`; a full harness suite on one platform launched through `build-app.mjs` +
a lease, to prove the wiring (use the devices in the delegation message). Report in
`docs/tasks/X1-dev-tooling.report.md` — keep it under 600 words plus a gate table.

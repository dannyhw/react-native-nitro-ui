# T01 — Repo scaffold, toolchain and static guardrails

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/T01` (branch `task/T01-scaffold`, already created from `main`)
**Devices:** iOS simulator `iPhone 17` UDID `F08675D3-A32B-4F88-BC81-02D7E0CB797E`.
Android: create your own AVD `nitroui_t01` from `system-images;android-35;google_apis;arm64-v8a`
(`avdmanager create avd -n nitroui_t01 -k "system-images;android-35;google_apis;arm64-v8a" -d pixel_9`),
boot it on port 5570 (`emulator -avd nitroui_t01 -port 5570 -no-snapshot-save`). Metro port 8091.
**Reasoning budget:** this is foundational — be careful and verify everything by running it.

## Goal

Turn this repo into a working library monorepo following `docs/research/setup-decisions.md`
(sections 1–3, 5, 6 "Static guardrails", 7, 8, "Target repo layout"). Other tasks build on this,
so the commands and layout you establish become the contract (document them in `CONTRIBUTING.md`).

A verified spike scaffold exists at `/tmp/nitro-ui-setup-spike/crnl/react-native-nitro-ui/`
(and `/tmp/nitro-ui-setup-spike/` logs). Prefer re-running the generator per §1 for a clean result,
then port the spike's fixes; copy from the spike where it is already right. The patch script +
header are also preserved at `docs/research/spike-artifacts/`.

## Scope

1. **Scaffold** at the repo root with `create-react-native-library@0.64.0 --type nitro-view
   --languages kotlin-swift --example vanilla` (see §1 for exact flags), keeping existing
   `docs/`, `AGENTS.md`. Package name `react-native-nitro-ui`, description "Native SwiftUI and
   Jetpack Compose components for React Native, built on Nitro Modules", author
   `Daniel Williams <me@dannyhw.com>`, repository `https://github.com/dannyhw/react-native-nitro-ui`,
   license MIT. Apply all §1 post-scaffold edits (bun hoisted, example paths, `hermesCommand`,
   `react { jsRootDir = file("../src/") }`, etc.).
2. **Package shape** per §2: single package, root export, peers `react`, `react-native >=0.86`,
   `react-native-nitro-modules ^0.37.1`; Compose fully contained in library `android/build.gradle`
   (compose compiler plugin + BOM per §2); podspec uses `min_ios_version_supported`.
3. **Replace the template demo view** with one internal HybridObject `NitroUiCore` (C++ or Swift/Kotlin,
   your call — C++ preferred) exposing `now(): number` (monotonic ns→ms clock:
   `CACurrentMediaTime` / `SystemClock.elapsedRealtimeNanos` equivalents) — the first piece of the
   core module (core-architecture §5). Export a JS accessor. No UI components yet (T10 does those).
   Make sure an empty-ish library still has a Hybrid View pipeline ready: keep the Compose and
   SwiftUI build configuration in place even without a view (T10 adds the first view).
4. **Nitrogen + patch**: `bun run nitrogen` = nitrogen + `scripts/patch-nitrogen.mjs` (the
   nitro#1655 base-ViewProps fix, §3) with `cpp/NitroUiPropsCompat.hpp`. Script must hard-fail if
   anchors are missing, and must be a no-op when no views exist. Commit `nitrogen/generated/`.
   Add `bun run nitrogen:check` (drift check: regenerate into temp and diff).
5. **Static guardrails** (§6 "Static guardrails"): ESLint flat config with local rules:
   - no inline `callback(...)` inside JSX attributes (must come from a stable helper/memo);
   - in `*.nitro.ts`: no `AnyMap`, no string props named `*Json`/`*JSON`, no optional (`?:`)
     members in Hybrid View props interfaces;
   with RuleTester unit tests. Prettier, `tsc`, Jest (template preset), publint, committed tarball
   manifest check (`etc/package-files.txt` vs `npm pack --dry-run`). api-extractor report is
   optional — include only if quick.
   Aggregate: `bun run check` runs typecheck, lint, format check, unit tests, nitrogen:check,
   publint + manifest.
6. **Harness**: react-native-harness 1.6.0 in `example/` (§5). One harness test asserting
   `NitroUiCore.now()` is monotonic and close to `performance.now()` deltas. Scripts
   `bun run harness:ios` / `bun run harness:android` (document required device/env).
7. **CI** workflow files per §7 (`.github/workflows/ci.yml`: js checks, android build + harness,
   ios build + harness). You can't run them; keep them correct and minimal. Release config per §8
   (release-it + conventional changelog in package.json, `release.yml` workflow_dispatch) — do not run.
8. **Docs**: concise `README.md` (what it is, install, status "pre-release") and `CONTRIBUTING.md`
   (setup, all scripts, how to run example/harness on iOS/Android, gates). Keep the template's
   CODE_OF_CONDUCT/LICENSE (copyright Daniel Williams).

## Out of scope

Bench app + BenchProbe (T02), consumer smoke scripts (T03), any UI component or hosting base
classes (T10), intrinsic sizing (T11).

## Acceptance (run all, paste results into the report)

- `bun install` from clean; `bun run check` passes.
- `bun run nitrogen:check` passes (no drift); patch script is idempotent.
- Example app builds and launches: iOS debug on the assigned simulator; Android debug on `nitroui_t01`.
- Harness test passes on both platforms.
- `npm pack --dry-run` file list matches `etc/package-files.txt`; publint clean.
- Commit everything on `task/T01-scaffold`; write `docs/tasks/T01-scaffold.report.md`.
- Shut down the simulator/emulator and Metro you started.

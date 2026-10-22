# T03 — Consumer smoke tests (fresh Expo + RN CLI apps)

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/T03` (branch `task/T03-smoke`, from `main`)
**Devices:** iOS sim `iPhone 17e` `C5CD4A7F-9079-4FAB-9EE3-88BC0754CB85`; Android AVD
`nitroui_t03` on port 5574 (create from `system-images;android-35;google_apis;arm64-v8a`).
Release builds only (no Metro).
**Depends on:** T01 (merged). Read `CONTRIBUTING.md`.

## Goal

Prove "simple setup when installed in a project": the packed library installs and runs in a
freshly generated Expo SDK 58 app and a fresh React Native CLI 0.88 app with no manual native
changes. See `docs/research/setup-decisions.md` §2 "What users do" and §4 "Smoke scripts"
(commands verified in the spike).

## Scope

1. `scripts/smoke/pack.sh` — builds and `npm pack`s the library into an output dir.
2. `scripts/smoke/expo.sh` (env `SDK=58` default) and `scripts/smoke/rn-cli.sh` (env `RN=0.88.0`
   default, also try `0.86.3`) — create the consumer app in a temp dir (outside the repo), install
   with **npm** (not bun), copy `scripts/smoke/App.tsx`, build Release for iOS sim and Android,
   install, launch, wait for the app's ready log line, take a screenshot, assert no fatal crash
   (logcat FATAL / iOS crash). Both platforms selectable via `PLATFORM=ios|android|both`.
3. `scripts/smoke/App.tsx` renders every exported component once with testIDs and logs a
   `NITRO_UI_SMOKE_READY` line after mount. Today only `NitroUiCore` exists (call `now()` and log
   it); structure it so each new component adds one line (document this in CONTRIBUTING.md).
4. `bun run smoke:expo` / `bun run smoke:rn-cli` scripts; a `smoke.yml` GitHub workflow
   (workflow_dispatch + nightly) — write it, don't run it.
5. Record the exact user-facing install steps that worked into `README.md` "Installation".

## Acceptance

- Both smoke scripts pass locally on iOS and Android (paste timings + screenshots under
  `docs/tasks/T03-smoke/`). RN 0.86.3 variant: at least Android; report iOS if time permits.
- Scripts are re-runnable and clean up temp dirs (keep logs on failure).
- No consumer-side native edits were needed. If any were, STOP and report under
  "Questions for orchestrator" — that is a product bug to fix in the library, not in the script.

## Notes from the T01 review

- `npm pack` regenerates `nitrogen/`; keep temp/output paths free of spaces.
- Device env: `IOS_SIM_UDID`, `ANDROID_AVD` — set to the values above. Follow `docs/DECISIONS.md`.

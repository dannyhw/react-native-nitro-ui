# X6 — Faster local/agent builds (no change for library users)

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/X6` (branch `task/X6-build-speed`, from `main`).
**Round cap (D19):** 1 + 2 fix rounds. Do not push. No personal info (D25). Priority task: the owner
wants the dev loop as fast as possible **without any effect on the end user**: nothing in the
published package changes (`android/build.gradle`, `NitroUi.podspec`, `src/`, `ios/`, `cpp/`,
`nitrogen/`, `package.json` `files` stay as they are; `npm pack` file list and contents identical to
`main`'s — prove it with a sha256 / file-list diff). Only the example app, the bench app, scripts,
CI and docs change.

1. **Measure first** (both platforms, the example app via `scripts/build-app.mjs`, and the bench app
   build): cold build in a fresh worktree, warm rebuild with no change, rebuild after a one-line
   change in `cpp/`, in a Kotlin file and in a Swift file. Record wall time and CPU (`/usr/bin/time
   -l`) and the load at the start. Keep it to one run per cell — this is a before/after, not a bench.
2. **Android: build only the ABI you run.** Local/agent builds default to the host ABI
   (`arm64-v8a` on Apple Silicon) via `-PreactNativeArchitectures` from `build-app.mjs`, the
   harness/real-input/smoke/bench build paths; an env/flag overrides it. CI jobs set what their
   runner needs (x86_64 on hosted ubuntu emulators; the release build keeps all four). Leave
   `example/android/gradle.properties`' list as the full default only if a script always overrides
   it; otherwise change the default and say so.
3. **Gradle caches:** `org.gradle.caching=true` and the configuration cache
   (`org.gradle.configuration-cache=true`) in the example and bench apps, so every worktree shares
   `~/.gradle/caches` (same user). Fix whatever the configuration cache rejects, or scope it off for
   that task and say why. The X1 stamp's tree hash and the `--rerun` safety net must still hold.
4. **ccache for C/C++/ObjC++** on both platforms: install with Homebrew if missing (record the
   version; document it in CONTRIBUTING prerequisites); iOS via React Native's Podfile
   `:ccache_enabled => true` in the example and bench Podfiles; Android via CMake
   `CMAKE_C(XX)_COMPILER_LAUNCHER=ccache` for the app/library native builds the example compiles.
   Set `CCACHE_BASEDIR` (repo root of each worktree / `~/Developer/oss`) and `hash_dir = false`
   so the same file in a different worktree is a hit; keep `ccache -s` output in the report. Must be
   a no-op when ccache isn't installed (CI, other contributors).
5. **Skip the build when nothing changed:** `build-app.mjs` exits early (prints "fresh, not
   rebuilt") when the existing `app.stamp` matches the current code tree and the artifact hash, unless
   `--force`. Test it.
6. **Measure again** — same cells, plus a **second fresh worktree building the same commit** (the
   cross-worktree cache case). Report the before/after table and cache hit rates.

Gates: `bun run check`; one full harness suite per platform through `build-app.mjs` + a lease;
`npm pack` identical to main's. Report in `docs/tasks/X6-build-speed.report.md` (≤ 500 words +
the timing table).

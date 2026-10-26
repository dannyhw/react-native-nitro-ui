# X6 — faster local/agent builds (round 1)

**What a library user installs did not change.** `npm pack` here and on `main` produce the same
tarball: same 465 files, same sha256 per file, identical tarball bytes
(`aab33665ce583257e598e7828a7789b27b8ae7dac24039baedd144039f6756dc`). Only scripts, the example,
bench and CI build paths and docs changed.

## Timing — wall seconds, one run per cell, `/usr/bin/time -l`

| cell | main | X6 |
| --- | --- | --- |
| example Android: fresh worktree, cold | 179.95 | 119.46 |
| example Android: no change | 7.37 | **0.56** (skipped) |
| example Android: 1-line `cpp/` change | 9.72 | 6.79 |
| example Android: 1-line Kotlin change | 9.84 | 5.86 |
| example iOS: fresh worktree + `pod install` | 540.24 | 315.86 |
| example iOS: no change | 17.17 | **0.86** (skipped) |
| example iOS: 1-line Swift change | 220.29 | 194.91 |
| example iOS: 1-line `cpp/` change | 214.91 | **54.83** |
| **2nd fresh worktree, same commit — Android** | 179.95 | **17.31** |
| **2nd fresh worktree, same commit — iOS** | 540.24 | **137.72** |
| bench Android: cold (`prebuild` + `assembleRelease`) | 341.85 | **27.04** |
| bench Android: `--rebuild` | 9.79 | 6.30 |
| bench Android: no change | 0.06 | 0.05 |
| bench iOS: cold | 224.34 | 167.62 |
| bench iOS: `--rebuild` | 34.38 | 17.07 |
| bench iOS: no change | 0.64 | 0.49 |

Start-of-run load averaged 5–60 in the `main` column and 20–190 in `X6` (tasks share this
machine), so `X6` is if anything pessimistic. The `main` cold cells were themselves fresh
worktrees, which is why they serve as the "before" of the second-worktree rows.

## Cache hit rates

- **Gradle build cache**, Android example, one cold build: main reused 0 of 366 tasks; X6 had 36
  `FROM-CACHE` + 231 up-to-date; a second worktree 24 + 268 — 74 tasks did work out of 366.
- **ccache** (Homebrew 4.14.2): bench Android after the example built 129/129 = 100%; iOS rebuild
  after a `cpp/` change 234/236 = 99%; second-worktree iOS 884/890 = 99%; the first full iOS pass,
  which populates it, 236/890 = 27%. Session cumulative 602/2134 = 28%, counting from empty.

## Two bugs that only measurement could see

1. `CCACHE_HASH_DIR=false` is not a variable ccache reads — the real one is `CCACHE_NOHASHDIR` —
   so `hash_dir` stayed on and the second worktree's Android build logged 140 cacheable calls, 0
   hits. Fixed, and `build-app.mjs` reads `ccache --show-config` back once and warns when
   `base_dir`/`hash_dir` did not take: a wrong name here changes nothing but timings.
2. iOS: `:ccache_enabled => true` was set and `xcodebuild -showBuildSettings` named RN's wrapper as
   `CC`, yet rebuilding 236 C++ files moved `ccache -s` by nothing. RN's wrapper ends in
   `exec $CCACHE_BINARY clang`, and RN passes that path as an Xcode *build setting*, which Xcode
   does not put in the compiler's environment — it ran plain clang, silently. The scripts now export
   the path they resolved; the same rebuild registers those 236 calls.

`example/android/gradle.properties` keeps its four-ABI default (a hand-run gradle build and the
release job are unchanged); the scripts pass this machine's ABI, overridable by `--arch` /
`NITRO_UI_ANDROID_ARCH`. The skip prints `<platform> example app is fresh, not rebuilt`; `--force`,
`--clean` and `--no-stamp` still build.

## Gates

- `bun run check` — PASS (typecheck through publint, manifest and readme checks).
- The X1 stamp and the `packageDebug --rerun` safety net held with both gradle caches on: every
  build recorded its tree and `8 components, 4..10 mentions` from the APK inspection, and the rerun
  never had to fire.
- **The two on-device harness suites were not run.** The only pair this task may use (pair-a) was
  held by H2b with 201 minutes of ttl left and pair-b's emulator is X2's, so nothing ran on a
  device X6 had not leased. When pair-a is free:

```
node scripts/lease.mjs acquire --task X6 --platform both --out /tmp/x6-lease.env
source /tmp/x6-lease.env
node scripts/build-app.mjs --platform ios     && bun run harness:ios
node scripts/build-app.mjs --platform android && bun run harness:android
node scripts/lease.mjs release --task X6
```

Those two builds should say `fresh, not rebuilt` and take a second each.

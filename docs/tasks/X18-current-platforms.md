# X18 — Current platforms: RN 0.88 floor, Compose 1.12, material3 1.5, the Expressive theme

**Worktree / branch:** named in your delegation message (`task/X18-current-platforms`). **Round cap:** 1 round, plus
at most 2 fix rounds (D19). **Devices:** your lease (`lease.mjs acquire --task X18 --boot`).

## Read first

AGENTS.md (never `pkill`/`killall`; README is for app developers), `docs/DECISIONS.md` **D39** (and the D8 it
supersedes), `android/build.gradle`, `core/NitroComposeHost.kt` (`NitroUiTheme`, `NitroUiColorSchemes`).

## Do

1. **Floor:** `peerDependencies.react-native` to `>=0.88.0`; README "Requirements" (RN, Expo SDK 58, compileSdk/AGP
   the app needs) in user-facing words; CONTRIBUTING; the smoke workflow drops the RN 0.86.3 row and its notes
   (keep what an RN 0.88 / Expo SDK 58 consumer run needs); remove other RN < 0.88 notes you meet.
2. **Android dependencies:** the newest Compose BOM, with `material3` pinned to **1.5.0-beta02** (explicit version if
   the BOM lags), compileSdk 37 / AGP 9.1 as required (library, example, bench module), Kotlin/Gradle as the AGP needs.
   Fix every deprecation or behaviour change the bump surfaces; no component may regress.
3. **The Expressive theme (D39 item 3):** `NitroUiTheme` uses `MaterialExpressiveTheme` (expressive motion scheme and
   shapes, the existing dynamic/default colour schemes kept) by default. Add one app-level opt-out to the baseline M3
   theme — decide the API (e.g. a `nitroUiCore` setter, or a gradle/manifest flag) by what works across every Hybrid
   View's own composition and Host, with no per-control prop; document it in user-facing words.
4. **Screenshots:** every Android README screenshot that visibly changes under the Expressive theme is retaken
   (CONTRIBUTING "README screenshots", 720 px).
5. Tests: the opt-out shown working both ways (harness), each shown red first; full gates prove no regression.
6. A **minor** changeset describing the floor raise and the Expressive default for app developers.

## Not in scope

Component-level Expressive variants (Q8 maps them; later tasks build them). Anything else: one FOLLOWUPS line.

## Gates

`check`, both `harness:*`, both `real-input:*`, then `need --for review`. Report at
`docs/tasks/X18-current-platforms.report.md`, ledger exported.

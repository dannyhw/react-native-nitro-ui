# T12 — Android Compose host performance

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/T12` (branch `task/T12-android-perf`, from `main`)
**Devices / env:** assigned in the delegation message (D13).
**Depends on:** T02 (bench) and T10 (core + Switch) merged.

## Why

First real bench numbers (docs/tasks/T02-bench.report.md "Round 3"), 50 Switches, Android API 35
emulator, ratios: nitro-ui vs `@expo/ui` shared-host = **1.95× UI CPU, 2.67× memory on mount**,
**1.51× UI CPU on update** (5.16× vs RN core). iOS already beats both Expo arms. D15 target:
≤ 1.0× expo-ui-shared-host on mount presented, UI CPU and memory. Known contributors:

1. `propsApplied` fires **2.00× per instance on mount** (iOS 1.00×): `afterUpdate()`/`commit()`
   runs twice per Switch (see T02 review "Rounds 2–3 verification" for the root-cause analysis).
2. One Composition + `AndroidComposeView` owner per control (Expo shared-host has one tree).
3. Unknown per-instance allocations: theme/ColorScheme computed per instance? CompositionLocals,
   interaction sources, semantics, ripple, `remember` misses.

## Scope

1. **Profile first** (release bench build): Perfetto / `simpleperf` / Compose composition tracing
   (`androidx.compose.runtime:runtime-tracing`) / Android Studio memory dumps on the bench mount
   N=50/200 and update scenarios. Write the breakdown (where the UI CPU and bytes go) into the
   report before optimising.
2. Fix the double props application on mount.
3. Reduce per-instance cost without breaking idiom or correctness, e.g.: process-wide cached
   `ColorScheme`/theme objects (recomputed only on configuration/dark-mode change), hoisted stable
   lambdas, `@Stable`/`@Immutable` models so recomposition is scoped to the changed field, avoid
   per-instance allocations in `Content()`, cheaper composition strategy, baseline profile
   (`androidx.profileinstaller` + `baseline-prof.txt`) and `prewarm` (core-architecture §3) — measure
   each change separately and keep only what helps.
4. Evaluate (don't necessarily ship) a structural option if per-instance cost can't reach target:
   e.g. one shared Compose host per window rendering many controls (a "virtual control" model) —
   write up cost/benefit and risk; recommend.
5. Keep iOS untouched unless a shared-core change is needed (then re-run iOS harness + bench).

## Acceptance

- `bun run check` green; Android harness green (and iOS if touched).
- Bench quick plan on Android before/after for each optimisation (table in report) and the final
  ratios vs both Expo arms and rn-core. State plainly whether D15 is met; if not, what remains and
  the recommended next step.
- `docs/architecture/core.md` updated with any new rules (e.g. "never allocate theme per instance").

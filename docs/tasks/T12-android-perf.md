# T12 — Android Compose host performance

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/T12` (branch `task/T12-android-perf`, from `main`)
**Devices / env:** assigned in the delegation message (D13).
**Depends on:** T02 (bench) and T10 (core + Switch) merged.

## Why

First real bench numbers (docs/tasks/T02-bench.report.md "Round 3"), 50 Switches, Android API 35
emulator, ratios: nitro-ui vs `@expo/ui` shared-host = **1.95× UI CPU, 2.67× memory on mount**,
**1.51× UI CPU on update** (5.16× vs RN core). iOS already beats both Expo arms. D15 target:
≤ 1.0× expo-ui-shared-host on mount presented, UI CPU and memory. Known contributors:

1. `propsApplied` fires **2.00× per instance on mount** (iOS 1.00×). Root cause (T02 review
   "Rounds 2–3 verification"): RN calls the view manager's `updateState` twice per new view —
   once at create (`ViewManager.java:231-236`) and again at insert
   (`FabricMountingManager.cpp:760-766`) — and Nitro's generated manager re-applies props on each.
   Not a library double-commit, but every repeat runs a full `afterUpdate()`/`commit()`.
2. One Composition + `AndroidComposeView` owner per control (Expo shared-host has one tree).
3. Unknown per-instance allocations: theme/ColorScheme computed per instance? CompositionLocals,
   interaction sources, semantics, ripple, `remember` misses.

## Scope

1. **Profile first** (release bench build): Perfetto / `simpleperf` / Compose composition tracing
   (`androidx.compose.runtime:runtime-tracing`) / Android Studio memory dumps on the bench mount
   N=50/200 and update scenarios. Write the breakdown (where the UI CPU and bytes go) into the
   report before optimising.
2. Make the second `updateState` cheap: skip the commit when the state/props are identical to
   the last applied (identity or a version stamp), or count it separately; measure the effect.
   If the fix belongs in Nitro's generated manager, patch via `scripts/patch-nitrogen.mjs` and
   record it in `docs/upstream.md` (D11).
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

## Orchestrator answers to round 1 (Phase 1 report at `task/T12-android-perf` 034b94f)

- **Sequencing:** option (a). Hold Phase 2 until T11 is merged, then rebase onto main and re-take
  the "before" numbers on the post-T11 code (T11 rewrites the sizing path you attributed).
- **N5 (double `updateState`):** don't implement the generator short-circuit. Record it as
  quantified-negligible (<1 ms/launch, with evidence) in `docs/upstream.md` and core.md perf notes.
- **`SwitchDefaults.colors()` per recomposition:** fix it first in Phase 2 (remember/hoist; a
  process-wide cache keyed by colour inputs) and measure it alone.
- **Baseline profile:** ship it as a library `baseline-prof.txt` (AAR-merged, covers only
  `com.margelo.nitro.nitroui` classes), so other arms' code is unaffected. Compile the bench app
  the same way for every run (e.g. `cmd package compile -m speed-profile -f` after install, or the
  profileinstaller path, applied identically to all arms) and report it as its own before/after
  row. Document what consumers get by default.
- **Shared composition / §2 one-host-per-view contract:** do the per-instance reductions (A + B)
  first. Then write up the structural option with the measured residual and its cost/risk
  (including cheaper intermediate steps such as a shared parent `CompositionContext`, and reducing
  the retained views per control). Do not build the spike in this task; the human decides.
- **D15 outcome:** a documented miss is acceptable for 0.1 if the residual is architectural,
  with an explanation and a follow-up item (D15 already allows this; the reviewer decides).
- **Added scope (from T11 round 3):** Android's cold-batch sizing flush applying 200 corrections
  takes 84–125 ms on the UI thread (iOS 8.5 ms) — several dropped frames on a cold 200-control
  mount. Attribute it (per-instance cost of the JNI push / state update / measure) and reduce it,
  or cap instances per flush so no single frame exceeds the budget while D17's rule still holds.
  Measure before/after with the T11 cold-batch harness test (`lastFlushMs`).

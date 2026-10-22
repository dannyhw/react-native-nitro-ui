# nitro-ui — master plan

Real SwiftUI (iOS) and Jetpack Compose (Android) controls for React Native, built on
Nitro Modules Hybrid Views. Goal: Expo UI–class native fidelity, measurably faster,
zero-config install in Expo (dev build / CNG) and bare React Native CLI apps.

Status of each phase/task lives in `docs/tasks/STATUS.md` (maintained by the orchestrator).

## Principles

1. **Idiomatic native**: each component maps to the real platform control (SwiftUI `Toggle`,
   Compose `Switch`, ...). Prop names follow the platform where they differ; a small shared
   cross-platform API is the default export.
2. **Performance is a feature with guardrails**: every component ships with benchmarks and
   must not regress against the committed baseline. See "Guardrails".
3. **Simple install**: `npm i <pkg> react-native-nitro-modules` + pod install / prebuild.
   No config plugin, no app-level Gradle/Podfile edits, no patch-package for consumers.
4. **Small, self-contained tasks**: each task has a brief in `docs/tasks/<id>.md` with
   everything needed (context, files to touch, acceptance criteria, commands).
5. Follow `docs/research/nitro-patterns.md` (Nitro constraints + patterns from the best libs).
   Architecture decisions: `docs/research/setup-decisions.md`, `docs/research/core-architecture.md`.

## Phases

### Phase 0 — Research & decisions (orchestrator + research agents)
- `setup-decisions.md`: scaffolding, package shape, RN/Expo versions, example app, tests,
  benchmarks, CI, release.
- `core-architecture.md`: sizing strategy, SwiftUI/Compose hosting, events/controlled values,
  core base classes, containers later.

### Phase 1 — Repo scaffold & guardrails (one implementation task, then review)
- Monorepo: library package + example app (dev + benchmark + harness tests).
- Lint/format/typecheck, nitrogen codegen + drift check, static perf lint rules.
- Test infra: Jest (JS), react-native-harness (on-device).
- Benchmark infra: native timing HybridObject, benchmark runner screen, results JSON,
  baseline compare script with thresholds.
- Consumer smoke test script (pack -> fresh Expo app + fresh RN CLI app -> build).
- CI workflows (may be run locally until pushed).

### Phase 2 — Core runtime + tracer-bullet component
- Shared core: SwiftUI host base (persistent ObservableObject model, root set once,
  afterUpdate batching, recycling), Compose host base (ComposeView, mutableStateOf model,
  lifecycle), sizing system, stable-callback helpers, controlled-value handshake,
  perf instrumentation hooks.
- Tracer bullet: **Switch/Toggle** end-to-end (API, iOS, Android, tests, benchmarks vs RN
  `Switch` and `@expo/ui`), docs page.

### Phase 3 — Component groups (parallel, one worktree per task)
- G1 Slider (+ Stepper on iOS)
- G2 Button (platform styles; iOS glass where available)
- G3 Progress (linear/circular, determinate/indeterminate) + ActivityIndicator
- G4 SegmentedControl + Picker (menu/wheel styles)
- G5 DatePicker (date/time, inline/compact)
Later (not in first release): Menu/ContextMenu, Alert/Dialog, BottomSheet, Toast/Snackbar,
Form/List/Section/stacks (container architecture), TextField.

### Phase 4 — Release readiness
- README + per-component docs, example screenshots, benchmark report.
- Consumer smoke test green on iOS + Android (Expo + bare).
- License (MIT), changelog, release tooling configured. **Hand back to the human before
  creating a public GitHub repo or publishing to npm.**

## Task workflow (per task)

1. Orchestrator writes `docs/tasks/<id>.md` brief.
2. Implementer agent (Apex) works in its own git worktree/branch `task/<id>`,
   runs all gates locally, writes `docs/tasks/<id>.report.md` (what was done, gate results,
   benchmark numbers, open questions), commits on its branch.
3. Reviewer agent (Opus) reviews the diff against the brief, `nitro-patterns.md`, and the
   guardrails; writes findings.
4. Implementer fixes; repeat until reviewer has no blocking findings.
5. Orchestrator merges into `main`.

If an implementer needs information it cannot get (web research, a decision), it stops
and lists questions under `## Questions for orchestrator` in its report.

## Guardrails (definition of done for any component)

- Typecheck, lint (incl. perf lint rules), format, unit tests pass.
- nitrogen codegen is up to date (no drift).
- iOS + Android example app build (debug) succeeds; harness tests pass on iOS sim + Android emu.
- Perf contract (reviewed):
  - setters only mark dirty; one commit in `afterUpdate`; no per-update view recreation
    (no `rootView =` / `setContent` in update paths);
  - callbacks stable (no inline `callback()`), no JSON-string or AnyMap props;
  - `RecyclableView` implemented with full reset; `onDropView` cleanup; no main-thread
    blocking from JS; no redundant main-queue hops;
  - controlled values use the event-count handshake.
- Benchmarks (release build): mount N=1/50/200, prop-update latency, memory per instance;
  compared against RN core equivalent (if any) and `@expo/ui` equivalent in the same run;
  no regression > threshold vs committed baseline.
- Docs page for the component.

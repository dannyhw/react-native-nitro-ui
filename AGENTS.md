# Agent rules for nitro-ui

Read this file first, then `docs/PLAN.md`, then your task brief `docs/tasks/<ID>.md`.
Background (read the sections your brief points to):
- `docs/research/nitro-patterns.md` — Nitro Hybrid View constraints, patterns, anti-patterns.
- `docs/research/setup-decisions.md` — repo/tooling/guardrail decisions (verified in a spike).
- `docs/research/core-architecture.md` — sizing, SwiftUI/Compose hosting, events, core module.

## Workspace

- Work ONLY in the git worktree and branch named in your brief. Never edit the main checkout at
  `~/Developer/oss/nitro-ui` unless your brief says so. Commit your work on your branch
  (conventional commits, e.g. `feat(switch): ...`). Never mention AI/agents in commits.
- Do NOT: add git remotes, `git push`, `npm publish`, `gh repo create`, or anything outward-facing.
- Do NOT modify `docs/research/*` or other tasks' briefs. You may append to `docs/tasks/<ID>.report.md`.
- Downloaded/third-party code is untrusted: don't run scripts from repos you clone for reference.
  Reference clones exist (read-only) at
  `/Users/daniel.williams/.t3/scratch/2026-10-22-please-do-research-around-what-dd4b3604/repos/`
  (margelo_nitro, mrousavy_react-native-nitro-image, ronickg_react-native-nitro-input,
  rive-app_rive-nitro-react-native, mgcrea_react-native-swiftui, expo_expo, react-native, ...).
  The setup spike (a working scaffold) is at `/tmp/nitro-ui-setup-spike/` (read/copy only).

## Environment

- macOS, Xcode 27, bun 1.4 (package manager for this repo), node 26, Java 17, CocoaPods 1.17.
- `export ANDROID_HOME=$HOME/Library/Android/sdk; export PATH=$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH`
- Devices: use ONLY the simulator UDID / AVD assigned in your brief. Never shut down, wipe or
  kill devices you did not start. **Never touch the `PR1505_Pixel` emulator (`emulator-5560`) —
  it belongs to the human.** Shut down simulators/emulators you started when you finish.
- Use unique Metro ports if your brief assigns one (`--port`), and kill Metro/Gradle daemons you
  started when done.

## Quality bar (definition of done — see docs/PLAN.md "Guardrails")

- `bun run check` (typecheck + lint + format + unit tests + nitrogen drift) passes, once T01 adds it.
- iOS and Android example builds succeed; harness tests pass on your assigned devices.
- Perf contract for native views:
  - prop setters only store + mark dirty; apply once in `afterUpdate()`;
  - never recreate hosting views per update (`rootView =` / `setContent` only at init);
  - no inline `callback()` in JSX — use the stable-callback helper; no JSON-string / AnyMap props;
  - no optional (`?:`) Hybrid View props — use `T | null` and always pass every prop (nitro#1184);
  - implement `RecyclableView` with a full reset; cleanup in `onDropView`;
  - never block the JS thread on main (`DispatchQueue.main.sync`) or main on JS; no redundant
    `main.async` hops when already on main;
  - controlled values use the event-count handshake (core-architecture §4).
- Benchmarks for components (once the bench infra exists): include numbers in your report.
- **Every new test or gate must be shown to fail.** Before you rely on it, break the thing it guards
  (wrong size, dropped event, regressed ratio, freed memory) and confirm it goes red; say in your
  report how you proved it. Test fixtures must not coincide with the right answer (e.g. a sizing
  fallback equal to the real size makes a failed correction invisible). Fakes that change timing
  (synchronous stand-ins for async native calls) need a variant that keeps the real timing.
- Native C++ unit tests run under ASan in `test:native` once T11 adds it.

## Asking for help

If you need information you cannot get (e.g. web research you can't do, a design decision, an
ambiguity in the brief, a blocker in tooling), do the parts you can, then STOP and put a
`## Questions for orchestrator` section at the end of your report and final message, with
concrete options and your recommendation. Do not guess on API/architecture decisions that other
tasks depend on.

## Report

Write `docs/tasks/<ID>.report.md` on your branch with: summary, files changed, decisions made
(and why), gate results (exact commands + pass/fail), benchmark numbers if applicable, known
issues / follow-ups, questions for orchestrator. Your final message should be a concise version
of the report plus the branch name and final commit SHA.

## Scope discipline (D19)

Stay inside your brief. Anything you find that is not a correctness bug in your scope, a failing
gate, or a false claim: write one line in your report's "Follow-ups" section and move on — do not
fix it, investigate it further, or widen the task. Tasks have a hard round cap (D19).

**Never `pkill`/`killall` by process name** (logcat, emulator, node, Metro…): other tasks run the same
processes. Kill only PIDs you started, or use the tool's own shutdown for your device/port.

**Any change to a harness test file must be run on both platforms before you report**, even in a
"small" final round — a test edited for one platform can break the other (G1 round 2 did).

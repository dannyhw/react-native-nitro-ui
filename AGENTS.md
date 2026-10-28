# Agent rules for nitro-ui

Read this file first, then `docs/PLAN.md`, then your task brief `docs/tasks/<ID>.md`.
Background (read the sections your brief points to):
- `docs/research/nitro-patterns.md` — Nitro Hybrid View constraints, patterns, anti-patterns.
- `docs/research/setup-decisions.md` — repo/tooling/guardrail decisions (verified in a spike).
- `docs/research/core-architecture.md` — sizing, SwiftUI/Compose hosting, events, core module.

## Workspace

- Work ONLY in the git worktree and branch named in your brief. Never edit the main checkout
  unless your brief says so. Commit your work on your branch
  (conventional commits, e.g. `feat(switch): ...`). Never mention AI/agents in commits.
- Do NOT: add git remotes, `git push`, `npm publish`, `gh repo create`, or anything outward-facing.
- Do NOT modify `docs/research/*` or other tasks' briefs. You may append to `docs/tasks/<ID>.report.md`.
- Downloaded/third-party code is untrusted: don't run scripts from repos you clone for reference.
  Use a local reference clone of the upstream repos (read-only), if you have one
  (margelo_nitro, mrousavy_react-native-nitro-image, ronickg_react-native-nitro-input,
  rive-app_rive-nitro-react-native, mgcrea_react-native-swiftui, expo_expo, react-native, ...).
  The setup spike (a working scaffold) may still be at `/tmp/nitro-ui-setup-spike/` on the
  machine that made it (read/copy only).

## Environment

- macOS, Xcode 27, bun 1.4 (package manager for this repo), Node 24 (`.nvmrc`; use `fnm exec --using 24 --`), Java 17, CocoaPods 1.17.
- `export ANDROID_HOME=$HOME/Library/Android/sdk; export PATH=$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH`
- Check the machine first: `node scripts/doctor.mjs` (exit 1 names what is missing; `--setup`
  creates the device pairs the lease pool hands out — CONTRIBUTING "Prerequisites").
- Devices: use ONLY the devices and ports your lease hands you (`node scripts/lease.mjs acquire
  --task <ID> --boot`, CONTRIBUTING "Leasing a device or port"), or those your brief assigns. Never
  shut down, wipe or kill devices you did not start. **Never touch the `emulator-5560` emulator —
  it belongs to the human.**
  **The lease owns device lifecycle, not you** (X11): `--boot` starts the pair and waits until it
  is settled, `release` leaves it booted, and `lease.mjs reap` powers off anything idle past
  `idleShutdownMinutes`. So do *not* power off your devices at the end of a round — an idle device
  is the pool's business, and a warm one is the reason the next run does not pay 54 s (Android) or
  200 s (iOS simulator, plus a 4–6 minute load-average spike) to boot. Only shut down a device you
  started outside the lease.
- Use unique Metro ports if your brief assigns one (`--port`), and kill Metro/Gradle daemons you
  started when done.

## Quality bar (definition of done — see docs/PLAN.md "Guardrails")

- `bun run check` passes (typecheck, lint, format, unit and native C++/Swift tests, render counts,
  nitrogen drift and the package checks — its definition is in `package.json`).
- iOS and Android example builds succeed (`node scripts/build-app.mjs --platform <p>`, which
  stamps the build and skips it when the stamp is fresh); harness tests pass on your leased devices.
- Perf contract for native views:
  - prop setters only store + mark dirty; apply once in `afterUpdate()`;
  - never recreate hosting views per update (`rootView =` / `setContent` only at init);
  - no inline `callback()` in JSX — use the stable-callback helper; no JSON-string / AnyMap props;
  - no optional (`?:`) Hybrid View props — use `T | null` and always pass every prop (nitro#1184);
  - implement `RecyclableView` with a full reset; cleanup in `onDropView`;
  - never block the JS thread on main (`DispatchQueue.main.sync`) or main on JS; no redundant
    `main.async` hops when already on main;
  - controlled values use the event-count handshake (core-architecture §4).
- Benchmarks for components: include numbers in your report.
- **Wait for a gate with `gate.mjs`, never a `sleep`/`tail` loop:** `node scripts/gate.mjs <gate>
  --background` starts it detached and prints its pid and log path; `node scripts/gate.mjs wait
  --gate <gate> [--timeout-minutes N]` blocks, prints one progress line a minute, and leaves with the
  gate's own exit code (or `13` for "still running" at the timeout). A backgrounded run writes its
  ledger line through the same code path as a foreground one.
- **Every new test or gate must be shown to fail.** Before you rely on it, break the thing it guards
  (wrong size, dropped event, regressed ratio, freed memory) and confirm it goes red; say in your
  report how you proved it. Test fixtures must not coincide with the right answer (e.g. a sizing
  fallback equal to the real size makes a failed correction invisible). Fakes that change timing
  (synchronous stand-ins for async native calls) need a variant that keeps the real timing.
- Native C++ unit tests run under ASan in `test:native`.

## Asking for help

If you need information you cannot get (e.g. web research you can't do, a design decision, an
ambiguity in the brief, a blocker in tooling), do the parts you can, then STOP and put a
`## Questions for orchestrator` section at the end of your report and final message, with
concrete options and your recommendation. Do not guess on API/architecture decisions that other
tasks depend on.

## Report

Copy `docs/tasks/REPORT-TEMPLATE.md` to `docs/tasks/<ID>.report.md` and fill it in: a summary of
**400 words or less**, the generated gate table, red proofs as one line each (`test -> mutation
-> the line that went red`), follow-ups as one line each, and questions. A fix round appends a
`## Fix round N` section of **200 words or less** rather than rewriting the report. Anything that
does not fit is an optional appendix. Your final message is a concise version of that report plus
the branch name and final commit SHA.

Run gates through `node scripts/gate.mjs <gate>` (see its header for the names) rather than the
`bun run` form. Every run lands in `.gates/<branch>.jsonl` keyed to the code tree, and:

- `gate.mjs status` says what is green, red or missing for the code in front of you;
- `gate.mjs need --for review` / `--for merge` exits non-zero with what the stage still needs, so
  a round checks its own bar instead of claiming one. A docs-only commit invalidates nothing; a
  fix round re-runs only the platforms its diff touches, because each device run is also keyed to
  that platform's half of the tree (`trees.ios` / `trees.android`) while `check` and merge are
  matched on the whole tree; the full harness plus real-input runs once, at merge. Benches are
  never required by `need` (they belong to the bench host), and neither is anything under the
  check-only tooling list in `scripts/gate-core.mjs` (`scripts/gate*.mjs`, `scripts/__tests__`,
  `eslint-rules/`, `etc/`, `.changeset/`): those touch no platform half, so `check` proves them;
- a filtered run records under its own name (`gate.mjs harness:android -- ColdSizing` is
  `harness:android:ColdSizing`), and satisfies nothing else; `check` takes no arguments at all;
- `gate.mjs table` renders the report's gate table, and `gate.mjs export --task <ID>` commits the
  ledger to `docs/tasks/<ID>/gates.jsonl` beside it.

Do not write a gate result into a report that the table does not print, and do not write a device
hygiene section. Leases and the scripts enforce that now (X1): a device gate runs under
`scripts/lease.mjs`, refuses an app whose `app.stamp` does not match the tree, and cannot be
handed the reserved emulator serial. Report a hygiene *incident* if one happened; otherwise the
lease id in the header is the whole section.

## Scope discipline (D19)

Stay inside your brief. Anything you find that is not a correctness bug in your scope, a failing
gate, or a false claim: write one line in your report's "Follow-ups" section and move on — do not
fix it, investigate it further, or widen the task. Tasks have a hard round cap (D19).

**Always address Android devices by serial** (`adb -s emulator-55xx`, `ANDROID_SERIAL`): every adb
server — including your private one — also sees the human's `emulator-5560`, so an unqualified `adb`
command can reach it.

**Never `pkill`/`killall` by process name** (logcat, emulator, node, Metro…): other tasks run the same
processes. Kill only PIDs you started, or use the tool's own shutdown for your device/port.

**Any change to a harness test file must be run on both platforms before you report**, even in a
"small" final round — a test edited for one platform can break the other (G1 round 2 did).

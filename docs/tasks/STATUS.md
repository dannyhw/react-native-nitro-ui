# Task status

| ID | Task | Implementer | Reviewer | State |
|---|---|---|---|---|
| T01 | Repo scaffold, toolchain, static guardrails | Apex | Opus | merged (2 rounds) |
| T02 | Bench app + BenchProbe + runner/report | Apex | Opus | merged (4 rounds) |
| T03 | Consumer smoke scripts (Expo + RN CLI) | Apex | Opus | merged (2 rounds) |
| T10 | Core hosting runtime + Switch tracer bullet | Apex | Opus | merged (3 rounds) |
| T11 | Intrinsic sizing shadow node (P0/P1) | Apex | Opus | merged (4 rounds) |
| T12 | Android Compose host performance | Apex | Opus | merged (3 rounds; D15 Android miss on UI CPU/memory, see §P2f) |
| T13 | Shared Compose owner services (`ComposeViewContext`) spike | Apex | — | done — not shipped: services are already shared per window; report only merged, code kept on branch `task/T13-compose-view-context` (0a7e8a2) |
| G1 | Slider | Apex | Opus | merged (1 impl + 2 fix rounds) |
| T14 | Register declared fallbacks before first measure (cold fillWidth height-0 frame) | Apex | Opus | merged (1 impl + 1 fix round) |
| FIX1 | iOS Slider disabled a11y probe (main iOS harness red since 381b1f2) | Apex | — | merged |
| G3 | Progress | Apex | Opus | merged (1 impl + 1 fix round; re-review MERGE) |
| G2 | Button (owns R3 sizing test) | Apex | Opus | merged (1 impl + 1 fix round) |
| T15 | Real-input verification (OS taps/drags on Switch, Slider; Button added after G2 merges) | Apex | — | merged (runner) |
| FIX2 | Stale Yoga measurement after a correction (iOS Switch at 0 width after `value` update, found by T15) | Apex | Opus | merged (1 impl + 1 fix round; iOS+Android Sizing 24/24, real input 3/3 both) |
| G4 | SegmentedControl (Picker → 0.2, D19) | Apex | Opus | merged (1 impl + 1 fix round; fix round comment-only in native) |
| T15b | Add Button to the real-input runner + fix the Android Slider drag/JS-write test (red on main) | Apex | — | merged (real input 3/3 both platforms) |
| G5 | DatePicker | Apex | Opus | merged (1 impl + 2 fix rounds; final re-review MERGE) |
| R1 | Release readiness: gate hygiene (D21 timing tag, real-input Metro bug, Node 26 check) | Apex | Opus (orchestrator) | merged |
| R2 | Release readiness 2: README + component docs, smoke with all 5 components, pack check, D18 baselines | Apex | orchestrator | merged (1 round; baselines measured but not minted — runner needs a full plan) |
| S1 | React Native Storybook in the example app (showcase/tester) | Apex | orchestrator | merged (1 round; disabled bundle byte-identical, harness 99/99 + real-input 4/4 both) |
| T16 | Spike: shared `<Host>` on Android, Switch only, bench vs expo shared host | Apex | orchestrator | done — Host beats expo shared host on Android mount memory (2.75x→0.87x) and UI CPU (1.50x→0.80x, noise-flagged), JS CPU 1.10x; report merged, code on branch `task/T16-host-spike` (b93b41b) |
| A2 | Phase A: deferred small fixes (useSizingId leak, smoke per-control check, pack count, Storybook dark panel, progress docs) | Apex | orchestrator | merged (1 round) |
| A1 | Phase A: committed bench baselines (full plan, 8 launches, both platforms, quiet machine) | Apex | orchestrator | done — not minted: iOS refused (busy, load 10.5); Android blocked by OOM at N=200 → B1 |
| B1 | Android OutOfMemoryError mounting 200 controls repeatedly (found by A1) | Apex | Opus | merged (1 impl + 1 fix round; re-review MERGE) — 0.1 Android host leaked every mounted control until Activity destroy; fixed |
| P1 | iOS mount-cost profiling (0.2 wave 1) | Apex | orchestrator | done — iOS mount cost is the synchronous T11 first measure (UI thread), not hosting-controller creation or JS; H3 iOS Host no-go |
| A1b | Overnight baselines retry | Apex | orchestrator | merged — **Android baseline minted** (load 2.39, 1120/1120); iOS refused 7.60 vs 7.0 at run end → R4 then one more overnight attempt |
| R4 | Bench load guard samples the whole run (median/≥10 % rule) | Apex | orchestrator | merged (1 round) |
| C1 | Android intrinsic content wider than its box fits instead of clipping (0.2 wave 1) | Apex | Opus | merged (1 impl + 1 fix round; re-review MERGE-AFTER-SMALL-FIXES, report corrected by orchestrator) |
| G6 | Picker (0.2 wave 2) | Apex | Opus | merged (1 impl + 2 fix rounds + merge-main pass; harness iOS 140/141 (1 skip), Android 142, real-input 6/6 both) |
| H1 | Android `<Host>` for Switch (0.2 wave 3) | Apex | Opus | merged (1 impl + 1 fix round; re-review MERGE WITH FOLLOW-UPS; Host vs shared host: memory 0.86x, mount UI CPU 0.87x, JS CPU ~1.2x) |
| R5 | Publish prep 0.1.0 | Apex | orchestrator | merged (1 round; smoke Expo 58 + RN 0.88 both platforms, RN 0.86 Android; RN 0.86 iOS n/a on iOS 27) — **published 2026-10-26** (`v0.1.0`) |
| R6 | Changesets + staged npm trusted publishing | Apex | Opus | merged (1 impl + 1 fix round); first automated release 0.1.1 shipped 2026-10-26 |
| X1 | Dev tooling: CI checks, fresh-build stamp, device leases | Apex | Opus | merged (1 impl + 1 fix round; re-review MERGE WITH FOLLOW-UPS) |
| H2a | Android `<Host>` for Slider, Progress, Button (+ N4) | Apex | Opus | merged (1 impl + 1 fix round; review MERGE WITH FIXES; bench indicative, busy machine) |
| H2b | Android `<Host>` for SegmentedControl, Picker, DatePicker (popups/dialogs) | Apex | Opus | merged (1 impl + 1 fix round; review MERGE WITH FIXES; check 460, harness iOS 165 / Android 214, real-input 13/13 both) |
| X2 | Gate ledger (`scripts/gate.mjs`, per-platform code trees) + short report template | Apex | Opus | merged (1 impl + 1 fix round; review FIX ROUND, M1-M4 fixed; check 415 tests, Android harness 187/187) |
| X6 | Build speed: stamp-fresh skip (ABI-aware), arm64-only local Android, Gradle build + configuration cache, ccache (own iOS module cache) | Apex | Opus | merged (1 impl + 2 fix rounds; 2nd-worktree Android 180→17 s, iOS 540→138 s; no-change rebuild <1 s; check 451, harness iOS 159 / Android 187, real-input 10/10 both) |
| X7 | Machine doctor (`scripts/doctor.mjs`, `--setup`) + orchestrator playbook (`ORCHESTRATOR.md`) | orchestrator | — | merged (14 unit tests; setup proven against a scratch state dir) |
| D2 | Docs pass for 0.3.0 (README, component/architecture docs, CONTRIBUTING, AGENTS, plans) | Opus | orchestrator | merged (patch changeset → 0.3.1) |
| T17 | iOS `<Host>` spike | Apex | — | report merged; not better (D23) — iOS `<Host>` is a passthrough |
| X8 | Bench baselines per machine (`bench/baselines/<label>/<deviceKey>.json`, label refusals, iOS key from the simulator's device type) | Apex (xhigh; low/medium arms in `EFFORT-eval-2026-10-27.md`) | Opus | merged (1 impl + 1 fix round; review MERGE; tooling-only, check 496) |
| X3 | Component registry + codegen (`component.json` per control, `bun run registry`/`regen`, `registry:check`, `merge=union` on nitrogen output) | Apex | Opus | merged (1 impl + 1 fix round; re-review MERGE WITH FIXES, text fixes by orchestrator; all five merge gates green; merge test: 19 conflicted files vs 22, 0/104 entries lost after the recipe) |
| A3 | Second machine's bench baselines (`--exclusive`) | Apex | orchestrator | merged: **Android minted** (1848/1848, load median 1.47, 0 over; `--check` green, doctored copy red); **iOS refused** on completeness (two `@expo/ui` DatePicker N=200 `presentedNs` cells, 55/160 and 87/160; load quiet) |
| X9 | Tooling: `bench --dry-run`, lockfile follows releases (macOS `version` job), `doctor --prime`, one build at a time, `gate.mjs --background`/`wait`, unowned-device warnings | Apex | Opus | merged (1 impl + 1 fix round; review MERGE WITH FIXES; tooling-only merge exception, round-1 harnesses green) |
| Q1–Q4, F0 | Read-only research during the mint: Menu design, TextField pre-spike, flaky-test diagnosis, FOLLOWUPS triage; F0 pruned FOLLOWUPS (Apex medium) | Apex | orchestrator | merged |
| X10 | Parallel `check` runner (`scripts/check.mjs`, `check:serial`), per-step timings in the ledger, exact-full-tree merge reuse, dev-only scripts on the tooling list | Apex | Opus | merged (1 impl + 2 fix rounds; review and re-review FIX ROUND, the docs-read analyser was replaced by exact-tree reuse; 1.13× faster, `test` alone is 140 s; tooling-only merge exception) |
| X12 | Failure logs outlive the worktree (shared store under the git common dir, retention), failure excerpts exported with the ledger (scrubbed, redacted for a public repo), device context on failed gates | Apex | Opus | merged (1 impl + 2 fix rounds; review FIX ROUND, re-review MERGE WITH FIXES; orchestrator privacy scan clean; tooling-only) |
| F3 | Fixes visible to 0.3.x (Android `fillWidth` under an unbounded parent, iOS DatePicker `builtBounds`, iOS SegmentedControl tint) — maintainer-mac-1 | Apex | Opus | merged (review MERGE WITH FIXES, M1 fixed; M2/N1 in FOLLOWUPS; all five merge gates green on mac-1) |
| T18 | TextField spike — maintainer-mac-1 | Apex | Opus | done, branch only (`246495c`); review ACCEPT WITH CORRECTIONS (its no-go reasons were measurement errors) |
| T18b | TextField follow-up spike — maintainer-mac-1 (Codex Apex) | Apex | Opus | done, branch only (`052b377`); review ACCEPT WITH CORRECTIONS; go bar not reached, no no-go trigger; TextField → 0.5 (D30) |
| X11 | Device throughput: one emulator launch config with `-gpu host` (Android harness load median 6.97 → 3.42), warm device pool with explicit-only reaping and live identity checks, real app resets, per-suite harness timing (ledger v6) | Apex | Opus | merged (1 impl + 2 fix rounds + merge-main pass; review and re-review FIX ROUND on device safety; harness both green; real-input owed to F1) |
| A4 | Why the iOS mint lost frames (2 s JS wait and 2 s native backstop vs ~3 s first frames for 200 `@expo/ui` DatePickers), iOS-only 8 s wait, comparison-arm rule (owner), per-iteration missing-sample reasons; **iOS baseline minted** for maintainer-mac-2 | Apex | Opus | merged (1 impl + 1 fix round; review MERGE WITH FIXES; Android unchanged by design) |
| X13 | Release lock refresh churned every pod on CI: json 2.7 vs ≥2.8 `pretty_generate` empty-array bytes changed 87/96 path-pod checksums; release job pins json 2.18.0 (asserts what loads), podspec-serialisation probe refuses an unknown format | Apex | Opus | merged (1 impl + 1 fix round; review MERGE WITH FIXES; harness:ios red only on the Picker flake F1 fixes — merge exception) |
| F2 | Follow-ups sweep: comments, docs, three tooling fixes (lease-TTL assertion, harness platform labels, `--clean` removes pod inputs) — maintainer-mac-1 PR #6 | Apex | Opus | merged `d80bbc1` (review MERGE WITH FIXES, fix round 1; mac-2 merge gates green except `real-input:ios` Switch, F1's) |
| F1 | Determinism: native-state tap witness before any retry (iOS, Android), retry counts in every gate log, dwell probe, four flaky tests fixed | Apex | Opus | merged `2d58ca6` (review FIX ROUND; fix round 1; re-review MERGE WITH FIXES, wording applied; all five merge gates green on mac-2) |
| G7a | Menu: button-anchored native menu (iOS SwiftUI `Menu`, Android `DropdownMenu` via `menuAnchor`), sections and one submenu level, iOS-only `primaryAction` — maintainer-mac-1 PR #7, fix round 2 on mac-2 | Apex | Opus | merged `41e30c5` (review FIX ROUND, re-review MERGE WITH FIXES; D32 rulings; all five merge gates green on mac-2) |
| F7 | Quick taps on a busy screen: measured (no-lookup presses, no-RN UISwitch/Toggle arms, Android), not the library's; busy-screen 12/12 guard with no retry | Apex | Opus | merged (review MERGE WITH FIXES, fix round 1; all five merge gates green on mac-2) |
| G7b | Menu finish: bench arm (all arms, no mint), real-input both platforms (whole Android open/select/close echo, iOS trigger label), `menuAnchor` gap bound proven by a window-moving mutant, stories and smoke; iOS open/close spike measured, not shipped | Apex | Opus | merged `268859b` (review FIX ROUND, fix round 1; re-review MERGE WITH FIXES, applied; all five merge gates green on mac-2) |
| X4 | Conformance suite (a11y, recycle-reset, sizing fallback and coverage tables read from every manifest; Menu covered) and `task-ready.mjs` | Apex | Opus | merged `a31ad90` (review FIX ROUND, two fix rounds; re-review 2 MERGE WITH FIXES, docs applied; all five merge gates green on mac-2) |
| D3 | Docs pass for 0.4.0: README gains Menu (table, import list, Usage + checked example, Host, limitations), the workflow claims match `gh workflow list`, stale control counts and header comments | Apex | Opus | merged `8c42ce8` (1 round; review MERGE WITH FIXES, wording applied by the orchestrator; all five merge gates green on mac-2) |
| A5 | Quiet bench window on maintainer-mac-2: full `--check` both platforms, quiet numbers into the H2a/H2b/G5/G6/G7b reports and README | Apex | orchestrator | merged `4f67da0` (1 round + fix round 1; re-review MERGE WITH FIXES, applied; docs-only, check green) |
| X14 | Bench: add one component's cells to a machine's baseline (merge mint with comparability guards), so a new component costs ~40 min a platform, not a full window | Apex | Opus | merged `386a511` (review FIX ROUND, 2 fix rounds; re-review MERGE WITH FIXES, applied in round 2). Merge gates green except one `harness:ios` Menu flake, pushed before it was read; it then passed 3/3 plus a full run on `main` |
| X15 | Tooling and test hygiene: lease/Metro port pre-flight, `test:native:android` runs automatically, Menu iOS read-back race, bench ledger platform, render label, readme-examples mapping, CONTRIBUTING CI runner | Apex | Opus | merged (`5bc783b`) |
| F6 | Recycling and drop-path gates: `enableViewRecycling` exercised and leak-gated, B1 drop-path items, X4 recycle blind spots (SegmentedControl, Picker, Menu) | Apex | Opus | merged (`611fd66`) |
| A6 | maintainer-mac-1's Menu baseline cells by merge mint, both platforms; first task delegated to a linked machine (INV-0391) | Apex (on mac-1) | Opus | merged: Android (`b86faaa`), iOS by A6b (`fa99b05`, PR #13) |
| F4 | CI green on every trigger: no cancelled `main` runs, dispatched harness jobs fixed, release-pipeline nits, X1 leftovers, iOS < 26 fallback row | Apex | Opus | merged (`072ed4c`) |
| F8 | The two harness jobs green on GitHub's hosted runners: the 8 iOS failures classified and fixed, the Android emulator boot | Apex | Opus | merged (`e011d8e`, PR #12) |
| F8b | F8's sizing-engine fix finished: no in-window eviction from the held set, one false red proof moved, flush prunes, changeset trimmed | Apex | Opus | merged with F8 (`e011d8e`) |
| G8 | Android visual fixes from the README screenshots: inline DatePicker clipped, Menu dropdown truncating labels | Apex | Opus | merged (`b52435e`, PR #18) |
| G9 | iOS Menu drops an untitled destructive group (run on maintainer-mac-1 via the T3 link) | Apex (on mac-1) | Opus | merged (`baf9811`, PR #17) |

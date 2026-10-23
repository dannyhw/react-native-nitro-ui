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
| G3 | Progress | Apex | Opus | in progress |
| G2 | Button (owns R3 sizing test) | Apex | Opus | merged (1 impl + 1 fix round) |
| T15 | Real-input verification (OS taps/drags on Switch, Slider; Button added after G2 merges) | Apex | — | merged (runner) |
| FIX2 | Stale Yoga measurement after a correction (iOS Switch at 0 width after `value` update, found by T15) | Apex | Opus | merged (1 impl + 1 fix round; iOS+Android Sizing 24/24, real input 3/3 both) |
| G4 | SegmentedControl (Picker → 0.2, D19) | Apex | Opus | in progress |
| T15b | Add Button to the real-input runner + fix the Android Slider drag/JS-write test (red on main) | Apex | — | merged (real input 3/3 both platforms) |
| G5 | DatePicker | — | — | moved to 0.2 (D19) |

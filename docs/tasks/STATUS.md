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
| G1 | Slider | Apex | Opus | fix round 1 of 2 (handshake race, rounding, a11y, bench honesty) |
| T14 | Register declared fallbacks before first measure (cold fillWidth height-0 frame) | — | — | planned (after G1, bug fix per D19) |
| G3 | Progress | — | — | planned (after T02 + T11) |
| G2 | Button (owns R3 sizing test) | Apex | Opus | in progress |
| G4 | SegmentedControl (+ Picker only if time, D19) | — | — | planned (after G2) |
| G5 | DatePicker | — | — | moved to 0.2 (D19) |

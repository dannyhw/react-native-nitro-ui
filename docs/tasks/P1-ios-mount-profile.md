# P1 — iOS mount-cost profiling (one round, decides an iOS `<Host>`)

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/P1` (branch `task/P1-ios-mount-profile`, from `main`).
**Devices / env:** assigned in the delegation message. **Round cap:** one round; report is the
deliverable, code changes only for instrumentation (merge only if cheap and useful).

## Question

iOS `mount mounted` is 2.0–5.3x `expo-ui-shared-host` (R2), and iOS memory misses by +44…+80 KiB per
instance on Slider, Button and Progress. Two attributions disagree (FOLLOWUPS): R2 says per-instance
`UIHostingController` creation on the UI thread; T16 says commit/JS side. Which is it, and would a
shared iOS host (one `UIHostingController`, N SwiftUI children) remove it?

## Scope

1. Profile a Release bench build mounting 50 of each of Switch, Slider, Button (Instruments Time
   Profiler + Allocations, or `os_signpost` around host creation / first layout / commit), on the
   canonical iPhone 17. Attribute the `mounted` time and the per-instance bytes: hosting controller,
   SwiftUI graph, Fabric/Nitro view, sizing entry, JS commit.
2. Estimate (from those numbers) what a shared host would save per instance, and what it can't.
3. Cheap per-instance reductions you find (e.g. a hosting-controller option, avoiding a redundant
   layout pass) — measure, list; implement only if trivially safe, otherwise list as follow-ups.

Report: the breakdown table, the answer (UI-thread hosting vs JS/commit), a go/no-go recommendation
for H3 (iOS `<Host>`) with expected ratios, and cheap wins.

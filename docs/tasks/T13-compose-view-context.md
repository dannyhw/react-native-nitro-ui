# T13 — Shared Compose owner services (`ComposeViewContext`) spike

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/T13` (branch `task/T13-compose-view-context`, from `main`)
**Devices / env:** assigned in the delegation message (D13). Android only.
**Depends on:** T12 merged. Read `docs/tasks/T12-android-perf.report.md` (§P2f and the Phase 2
tables), its review, `docs/architecture/core.md` §2 (one host per native view), D8, D15, D17.

## Why

After T12, Android vs `expo-ui-shared-host` (50 Switches, ART-primed): mount presented 1.01×,
UI CPU 1.35×, memory 2.52×. The residual is per-control Compose owner cost (~134 KiB, 0.18 ms per
control vs 53 KiB, 0.13 ms). All hosts already share the window Recomposer; each control adds a
`Composition` + an `AndroidComposeView` owner and its services. Compose UI 1.11.x ships an
experimental `ComposeViewContext` / `createComposition(ComposeViewContext)` that shares per-owner
services across Compose views, keeping one host per native view (no public API change).

## Scope

1. Read the Compose UI sources for the version our BOM pin (D8) resolves to: what
   `ComposeViewContext` shares, its lifecycle, threading, and how it interacts with
   `AbstractComposeView`, `ViewTreeLifecycleOwner`, window attach/detach, recycling and
   `disposeComposition` (core.md recycling rules), RN Modals (second window), and
   accessibility/semantics.
2. Prototype it behind an internal flag in `NitroComposeHost` (one context per window, created
   lazily, released when the last host detaches). Keep the old path as default until measured.
3. Measure (ART-primed per benchmarks.md): bench quick plan, mount N=50/200 + update, before/after,
   plus T12's heap-per-control attribution and the T11 cold-batch harness (`lastFlushMs`, stale=0).
4. Correctness: Android harness green with the flag on, including Modal, recycling, dark-mode
   switch, font-scale change (D17 tests), a11y node tree sane.
5. Recommend: ship on (with the experimental-API risk and an opt-out), keep off, or drop. If it
   reaches D15, say so plainly.

## Acceptance

`bun run check` green; Android harness green with the flag on and off; before/after tables; risk
section (API stability across BOM bumps, what breaks if the API changes, how we'd detect it).

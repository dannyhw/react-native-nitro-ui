# F3 — Fixes visible to 0.3.x apps

**Machine:** maintainer-mac-1 (`NITRO_UI_MACHINE_LABEL=maintainer-mac-1`). **Worktree / branch:** named
in your delegation message (from `main`). **Round cap:** 1 implementation round plus at most 2 fix
rounds (D19). **Devices:** that machine's lease (`node scripts/lease.mjs acquire --task F3`).

Source: `docs/tasks/Q4-followups-triage.md`, rows 10, 27 and 46, and the matching lines in
`docs/tasks/FOLLOWUPS.md`. Row 45 (the a11y audit) is not yours: X4's conformance suite covers it.

## Do

1. **`fillWidth` under an unbounded width (row 10, Android).** The measure block's last resort keeps
   the cached width (`android/.../NitroComposeHost.kt` ~1537-1538, `Constraints()`), so a
   `fillWidth` control inside an unbounded-width parent draws one frame at a stale width. Fix it,
   and bring `docs/architecture/sizing.md` (~317) in line. Write a harness case that reproduces the
   stale frame first (shown red), then passes.
2. **DatePicker `builtBounds` (row 46, iOS).** `builtBounds` is recorded from an `.onAppear` outside
   `.id(_:)` (`ios/components/DatePicker/HybridNitroUiDatePicker.swift` ~219-223, ~602-603), so a
   rebuild can report the previous build's bounds. Move it inside, and make the rebuild assertion
   provable: a test that fails before the move.
3. **iOS SegmentedControl `tintColor` (row 27).** SwiftUI ignores `.tint` on a segmented `Picker`
   (`ios/components/SegmentedControl/HybridNitroUiSegmentedControl.swift` ~122-131). Find a
   per-instance approach that doesn't touch the global `UISegmentedControl.appearance()`. Test it
   with a pixel or AX check that fails today. If no per-instance approach exists on iOS 15.1+, keep
   it documented and say why.

Each fix gets a changeset (patch). Keep the perf contract.

## Gates

`check`, then `need --for review` (expect both harnesses), with real-input if a fix touches input.
Report: `docs/tasks/F3-visible-fixes.report.md` (REPORT-TEMPLATE), ledger exported. Commit on your
branch, don't push.

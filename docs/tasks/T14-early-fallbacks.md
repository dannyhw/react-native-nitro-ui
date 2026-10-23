# T14 — Register declared fallbacks before the first measure

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/T14` (branch `task/T14-early-fallbacks`, from `main`)
**Devices / env:** assigned in the delegation message (D13). **Depends on:** G1 merged.
**Round cap (D19):** one implementation round + at most two fix rounds.

## Bug

A component's declared fallback size (`NitroUiSizing::setFallback`) is registered by its first
native *view*, but Fabric measures the shadow node before it creates that view. So the first
instance of a configuration is measured with no fallback: a cold first `fillWidth` instance (Slider,
linear Progress) lays out at height 0 for one frame, and a cold first `intrinsic` instance (Switch)
gets the engine default. See G1 review question 5 and D17.

## Fix (reviewer's sketch, ~60–120 lines + docs + test)

Every wrapper already calls `nitroUiCore.nextSizingId()` during render, before any shadow node is
measured. Register each component's per-platform/per-OS native fallback table there (or at an
equally early, once-per-process native point — e.g. module load), so the first measure finds it.
Keep `setFallback` semantics (D16/D17: declared fallbacks survive environment bumps; provisional
until a report). No JS-visible API change.

## Acceptance

- Harness test on both platforms: a cold first Slider and a cold first Switch lay out at the
  declared fallback on frame 1 (not 0 / not engine default), with a poisoned-fallback variant
  proving the correction still lands. Show the test fails on main.
- Update D17's wording proposal in the report (orchestrator edits DECISIONS), sizing.md §5.
- `bun run check` green; harness green on both platforms.

## Also (from G1 fix round 1)

Try to reproduce the flaky Android `Sizing › sizes a control inside a Modal` failure
(`corrections=0`, FOLLOWUPS.md). If T14's change touches the cause, fix it; otherwise one line in the
report — don't chase it past one attempt (D19).

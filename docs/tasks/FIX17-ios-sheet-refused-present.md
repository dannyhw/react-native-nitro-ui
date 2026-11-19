# FIX17 — An iOS BottomSheet that UIKit refused to present can present again

**Kind:** bugfix · **Devices:** ios ·
**Budget:** 2.5 h for round one (one iOS state fix with a harness case; FIX13's iOS fix took 2 h)

## Goal

On iOS, if UIKit silently refuses to present a `BottomSheet`, the next time the app sets
`isPresented` to `true` the sheet presents; it is never stuck closed for the rest of that mount.

## Why

`docs/tasks/FOLLOWUPS.md` "G14 (review): iOS, a present UIKit refuses after it was issued". In
`ios/components/BottomSheet/HybridNitroUiBottomSheet.swift`, `presentIfPossible` sets `sheet`
before presenting. When UIKit refuses the present after it was issued (no completion, and the
controller never gets a `presentingViewController`), `sheet` stays set, and `sync()` returns early
on any `sheet`, so that mount never presents again.

## Behaviour

1. A present that UIKit refused leaves the BottomSheet able to present again: the next `true`, or
   the same `true` once the presenter chain is free, presents the sheet.
2. What JS hears is consistent: a refused present does not report the sheet as shown, and if JS still
   asks for it, it is reported closed (or presented later) exactly once, never twice.
3. A sheet that is on screen, rising or leaving behaves as today; a present that is merely slow (its
   completion still to come) is not mistaken for a refused one.
4. Android is unchanged.

## Proof

- A harness case on iOS that forces a refused present (for example presenting while another
  controller is mid-transition past the wait budget, or through a test seam that drops the present)
  and then asks for the sheet again; red against today's code (the second ask never presents), green
  with the fix. Plus a case that a slow present is not forgotten.
- `harness:ios` and `harness:android` green (the harness file is shared), `check` and
  `need --for review` clean; a patch changeset.

## Out of scope

- Other BottomSheet lines in FOLLOWUPS, including the Android rising-sheet drag.
- `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/`, and the shared e2e helpers.

## Decided already

- Recover by forgetting a controller that never got a presenter, as the FOLLOWUPS line suggests:
  decide "refused" from UIKit's own state at a moment the present must have taken effect (for
  example the next run loop turn after `present` returned, or the transition coordinator ending),
  not from a timer guess. Say in the report which signal you used and why it cannot fire for a slow
  present.

## Context

`ios/components/BottomSheet/HybridNitroUiBottomSheet.swift` (`sync`, `presentIfPossible`,
`sheetIsUp`, `presentation`), `NitroUiPresenterChain`, `example/__tests__/BottomSheet.harness.tsx`,
`docs/components/bottom-sheet.md`.

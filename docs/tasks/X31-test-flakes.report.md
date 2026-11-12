# X31 — Three test flakes and one missing assertion

**Branch:** `task/X31-test-flakes` (from `main` at `8201adc9`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `X31-ptfed` (pair-a: iPhone 17 / `emulator-5574` / Metro `8295`)

## Summary

Four claims were graded on the wrong thing. Each is fixed by measuring the claim, not by
widening a tolerance or lengthening a budget.

**1 · `real-input:android` `hosted-picker`.** The check asserted `row.y1 >= anchor.y1`, which is
only true while the page has come to rest with the anchor on the upper fold. Material measures
the room under an anchor and opens *above* it when there is none — correct behaviour, red check
(X24 and its merge round, both with the anchor at `42,2242 → 777,2410` of a 2 424 px window: 14
px under it, 159 px of menu). Two changes. The check now *positions* the anchor (`centreOnScreen`,
the same instrument `positionWheel` uses) instead of accepting it wherever an earlier check
happened to leave it, so the room under it is not a lottery. And the placement is judged by
`judgeMenuAnchoring` (`scripts/real-input/menu-placement.mjs`): the menu must open on the side
that has room, and its near edge must be against the box the Host drew — with overlap allowed,
because an open Material menu brings the selected row onto the field. Distance is therefore the
gap between the two boxes, not between two chosen edges: on the measured above-placement an
edge-to-edge rule lands 1 px inside the 20 dp allowance, which is a flake with a new name. The
brief's "not at the top of the screen" is still caught, by both halves at once.

**2 · Form give-ups.** `giveUps` counts an iOS cell or band provider answering a stale index path
with a blank, and nothing read it. The E1, E4 and churn cases assert the *symptoms* a give-up used
to produce, and those went quiet as soon as the give-up was answered well enough for the layout to
recover — which is what X25 and X29 made it do. `expectNoGiveUps` now grades the count on the
cases that walk those paths on purpose, at every churn settle as well, where the counter belongs
to the mount that just ended. iOS-only: Android's Form has no cells to answer with a blank.

**3 · The refused-press message.** `No view found at point (0.00, 0.00)` prints the arguments the
JS side sends, not the point the native side resolved; X29's two red runs — a press on a
neighbouring row and a press off-window — printed the same two zeros. `pressAimed`
(`example/__tests__/aimedPress.ts`) keeps upstream's sentence verbatim and appends the `testID`,
its `nativeId` and the centre read from the box that identifier answers for now. The harness is a
dependency (and a patched one), so this sits on our side of the boundary; a new case refuses a
press 6 000 pt down, on purpose, and grades the message it gets.

**4 · The 2 s CI budget.** The case graded a wall-clock ceiling between a healthy ~2 s and an
unbounded ~26 s, and `check`'s own load put the healthy 2 s — process starts, nothing else — over
it (twice on X29). It now times the *same body* against a tool that answers and against one that
hangs and grades the difference, in `sleep 1` units: the unit `bounded()` counts its patience in,
so the allowance stretches with the machine instead of fighting it.

## Gates

GATE_TABLE_PLACEHOLDER

## Red proofs

- `real-input-menu-placement.test.js` (8 cases) -> remove the side rule -> `rejects a menu that
  flips up when there is room under the anchor` and `rejects a menu that runs off the bottom of
  the window`.
- same file -> restore the pre-X31 edge-to-edge gap -> `accepts the menu opening above an anchor
  with no room below` (the measured X24 box), on `detail` containing `0 px off its edge`.
- same file -> remove the distance rule -> `rejects a menu parked at the top of the window` and
  the 1-px boundary case.
- `ci-workflows.test.js` "does not wait forever" -> `bounded()` prints its complaint but does not
  kill the tool -> `expect(patienceMs).toBeLessThan(8 * sleepUnitMs)` with
  `patience=38980ms allowance=8096ms` — and the guard's own words, `printedRest` and status all
  still correct, which is exactly what the old budget could not see.
- same case -> typo the bounded command (`-accel-chekc`) -> `gaveUpOnTheTool: false`, so the case
  cannot pass on a bound applied to something else.

RED_PROOFS_DEVICE_PLACEHOLDER

## Files changed

- `scripts/real-input/menu-placement.mjs`, `scripts/real-input/android.mjs` — the placement judge,
  and a check that positions its anchor before it taps.
- `scripts/__tests__/real-input-menu-placement.test.js` — new: the judge against measured boxes.
- `scripts/__tests__/ci-workflows.test.js` — the accel deadline, measured as a difference.
- `example/__tests__/aimedPress.ts` — new: `pressAimed` and the message it builds.
- `example/__tests__/Form.harness.tsx` — `expectNoGiveUps`, `pressAimed` at every aimed press,
  and the case that grades a refused press.

## Follow-ups

- `@react-native-harness/platform-apple`: the fix belongs upstream in `HarnessUI.mm:277`; this
  repo already patches that package, so changing the text at source is an option if the wrapper
  is judged too indirect.

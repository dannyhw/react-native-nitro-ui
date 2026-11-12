# X31 — Three test flakes and one missing assertion

**Branch:** `task/X31-test-flakes` (from `main` at `8201adc9`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `X31-ptfed` (pair-a: iPhone 17 `49D5024D…` / `emulator-5574` / Metro `8295`)

## Summary

Four claims were graded on the wrong thing. Each is fixed by measuring the claim; nothing was
loosened to make a run pass, and one rule I wrote too tight went red on a correct menu and was
then measured (item 1).

**1 · `real-input:android` `hosted-picker`.** The check asserted `row.y1 >= anchor.y1`, which
only holds while the page has come to rest with the anchor on the upper fold. Material measures
the room under an anchor and opens *above* it when there is none — right behaviour, red check
(`docs/tasks/FOLLOWUPS.md:298`, X24 fix round 1 and its merge, both with the anchor at
`42,2242 → 777,2410` of a 2 424 px window: 14 px under it). Two causes, two fixes. The anchor's
position was whatever the previous check left behind, so the check now *positions* it
(`centreOnScreen`, the instrument `positionWheel` already used). And the placement is judged by
`judgeMenuAnchoring`: the menu must open on the side that has room, and its box must be against
the box the Host drew — overlap allowed, because an open Material menu brings the selected row
onto the field. That distance is between the two **boxes**, not two chosen edges: on the measured
above-placement an edge rule passes with one pixel to spare, which is a flake with a new name.
The band itself is measured too — this run printed a healthy menu 58 px (22 dp) under its anchor,
so the allowance is 32 dp; my first draft was a guessed 20 dp and went red on that healthy menu.

**2 · Form give-ups.** `giveUps` counts an iOS cell or band provider answering a stale index path
with a blank, and nothing read it (`docs/tasks/FOLLOWUPS.md:303`). The E1, E4 and churn cases
assert the *symptoms* a give-up used to produce, and those went quiet as soon as the give-up was
answered well enough for the layout to recover — which is what X25 and X29 made it do.
`expectNoGiveUps` grades the count on the cases that walk those paths on purpose, at every churn
settle, where the counter belongs to the mount that just ended. iOS only: Android's Form has no
cells to answer with a blank.

**3 · The refused-press message.** `No view found at point (0.00, 0.00)` prints the arguments the
JS side sends, not the point the native side resolved; X29's two red runs — a press on a
neighbouring row and a press off-window — printed the same two zeros
(`docs/tasks/X29-form-e4-pair-a.report.md:129`). `pressAimed` keeps upstream's sentence verbatim
and appends the `testID`, its `nativeId` and the centre read back from the box that identifier
answers for. The harness is a dependency, so this sits on our side of the boundary; a new case
refuses a press 6 000 pt down on purpose and grades the message it gets.

**4 · The 2 s CI budget.** The case graded a wall-clock ceiling between a healthy ~2 s and an
unbounded ~26 s, and `check`'s own load put the healthy 2 s — process starts, nothing else — over
it (`docs/tasks/FOLLOWUPS.md:119`, twice on X29). It now times the *same body* against a tool that
answers and against one that hangs and grades the difference, in `sleep 1` units — the unit
`bounded()` counts its patience in, so the allowance stretches with the machine instead of
fighting it.

## Gates

GATE_TABLE_PLACEHOLDER

`need --for review`: NEED_LINE_PLACEHOLDER

Two ledger rows are mine and are junk, not findings: `real-input:android:hosted-picker` and
`real-input:android:hosted-picker:--background` (0.2 s and 0.4 s) are one mistyped filter — the
runner got `hosted-picker` and `--background` as positional arguments and refused them. The
filtered run that means is `real-input:android:--control:hosted-picker`.

## Red proofs

- `real-input-menu-placement.test.js` (8 cases) -> side rule removed (`wanted = side`) ->
  `rejects a menu that flips up when there is room under the anchor`, `rejects a menu that runs
  off the bottom of the window`.
- same file -> pre-X31 edge-to-edge gap restored -> `accepts the menu opening above an anchor
  with no room below`, on the `0 px off its edge` of the measured box.
- same file -> distance rule removed -> `rejects a menu parked at the top of the window`,
  `rejects a menu a little way off the box it was opened from`.
- same file -> `MENU_NEAR_GAP_DP` back to the guessed 20 -> `accepts the menu below its anchor,
  as the device placed it` (the run's own 58 px), plus the boundary case.
- `real-input:android:--control:hosted-picker` -> the check handed `{y1: 0, y2: 172}` as the
  anchor instead of the Host's box -> `✗ the menu sits against the box the Host drew … parked:
  menu 1517..1822, anchor 0..172 … 1 345 px from the anchor's box` (log
  `real-input+android+--control+hosted-picker-2026-11-12T18-54-21.465Z.log`, recorded under the
  mutated tree, so it satisfies nothing — as intended).
- `ci-workflows.test.js` "does not wait forever" -> `bounded()` prints its complaint but does not
  kill the tool -> `expect(patienceMs).toBeLessThan(8 * sleepUnitMs)` with
  `patience=38980ms allowance=8096ms`, and the guard's own words, `printedRest` and exit status
  all still correct — the shape the old budget could not see.
- same case -> typo the bounded command (`-accel-chekc`) -> `gaveUpOnTheTool: false`, so the case
  cannot pass on a bound applied to something else.

- `Form.harness.tsx` `expectNoGiveUps` (4 call sites) -> restore the give-up:
  `if model == nil { giveUps += 1 }` where the cell provider is asked about a row whose Section
  has gone -> `Form (G24) survives a Form scrolled, reduced and torn down in a loop (X25)`:
  `expected 8 to be 0` at `expect(num(report, 'giveUps')).toBe(0)`. E1 and E4 stayed green under
  this mutation: the churn's teardown is what really walks the stale-cell window, and their calls
  are guards for the other three counters rather than witnesses today.
- `Form.harness.tsx` "names the aim when a press is refused (X31)" -> `pressAimed` rethrows the
  cause unchanged -> `expected 'No view found at point (0.00, 0.00)' to contain
  'aimed-off-window'`. The case refuses a press 6 000 pt down on purpose and fails by name if the
  platform ever *accepts* it, so it cannot pass by having nothing to grade.

Both were run as one filtered `harness:ios:Form.harness` against an app rebuilt from the mutated
tree (log `harness+ios+Form.harness-2026-11-12T20-38-41.735Z.log`), and the tree was restored and
rebuilt before the green runs.

## Files changed

- `scripts/real-input/menu-placement.mjs` — new: the placement judge and its two dp allowances.
- `scripts/real-input/android.mjs` — `centreOnScreen`, and the hosted-picker check judged by the
  judge instead of by `y1 >= y1`.
- `scripts/__tests__/real-input-menu-placement.test.js` — new: the judge against measured boxes.
- `scripts/__tests__/ci-workflows.test.js` — the accel deadline, measured as a difference.
- `example/__tests__/aimedPress.ts` — new: `pressAimed` and the message it builds.
- `example/__tests__/Form.harness.tsx` — `expectNoGiveUps`, `pressAimed` at every aimed press,
  and the case that grades a refused press.

## Follow-ups

- `real-input:android` `search-field`: one full run of the pre-X31 tree lost
  `timed out waiting for the prop to change (search-switching-echo="switching: number-pad")`
  while every other search-field check passed; not this round's code, and no second sample yet.
- `scripts/real-input/*.mjs` and `example/__tests__/*` are outside the platform prefixes in
  `gate-core.mjs`, so an edit to `scripts/real-input/android.mjs` — read by exactly one gate —
  re-owes all four device gates. Same class as the merge-bar note at `docs/tasks/FOLLOWUPS.md:302`;
  mapping the runner scripts to their own platform would be the cheap half of that fix.
- `@react-native-harness/platform-apple`: the real fix for item 3 is upstream in
  `HarnessUI.mm:277`, and this repo already patches that package — the wrapper is the indirect
  route the brief asked for.
- `MENU_ROOM_SLOP_DP` is a false-red guard, not a graded rule: no fixture sits in the band it
  widens (removing it keeps all 8 cases green), which is deliberate — a fixture there would grade
  Material's exact flip decision, which is not this check's claim.

# X31 — Three test flakes and one missing assertion

**Branch:** `task/X31-test-flakes` (from `main` at `8201adc9`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `X31-ptfed` (pair-a: iPhone 17 `49D5024D…` / `emulator-5574` / Metro `8295`) — the third
`real-input:ios` attempt ran on `X31-839dx`, a re-acquired lease on the same pair-a pair.

## Summary

Four claims were graded on the wrong thing. Each is fixed by measuring the claim, not by loosening a
tolerance; one rule I wrote too tight went red on a correct menu and is now measured.

**1 · `real-input:android` `hosted-picker`.** The check asserted `row.y1 >= anchor.y1`, which holds
only while an earlier check left the anchor on the upper fold: Material opens a menu *above* an
anchor with no room under it — right behaviour, red check (`docs/tasks/FOLLOWUPS.md:298`: 14 px of
window left under the anchor). The check now *positions* the anchor (`centreOnScreen`) and
`judgeMenuAnchoring` grades it: the side with room, and against the box the Host drew — overlap
allowed, an open menu brings the selected row onto the field. The distance is between the two
**boxes**, not two edges: on the measured above-placement an edge rule passes one pixel inside its
allowance. The 32 dp band is a healthy menu's own 58 px (22 dp) with half again; the guessed 20 dp
before it went red on that menu.

**2 · Form give-ups.** `giveUps` counts an iOS cell or band provider answering a stale index path
with a blank, and nothing read it (`docs/tasks/FOLLOWUPS.md:303`). E1, E4 and the churn assert the
*symptoms* a give-up used to produce, which went quiet once X25 and X29 made the layout recover.
`expectNoGiveUps` grades the count on the cases that walk those paths on purpose, at every churn
settle — where the counter belongs to the mount that just ended. iOS only.

**3 · The refused-press message.** `No view found at point (0.00, 0.00)` prints the arguments JS
sends, not the point native resolved — X29's red runs, a press on a neighbouring row and one
off-window, printed the same two zeros (`docs/tasks/X29-form-e4-pair-a.report.md:129`).
`pressAimed` keeps upstream's sentence and adds the `testID`, its `nativeId` and the centre read
back from that identifier's box. The harness is a dependency, so that is our side to fix.

**4 · The 2 s CI budget.** The case graded a wall-clock ceiling between a healthy ~2 s and an
unbounded ~26 s, and `check`'s own load put the healthy 2 s over it (`docs/tasks/FOLLOWUPS.md:119`,
twice on X29). It now times the *same body* against a tool that answers and one that hangs, grading
the difference in `sleep 1` units — the unit `bounded()` counts patience in — so the allowance fits
the machine.
## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2101 tests / 89 suites | `2501a6f37e89` | 2 m 54 s | start 4.2 / med 26.1 / max 71.2 |
| `harness:ios` | **PASS** | 629 tests / 32 suites + isolated 6 tests / 3 suites | `2501a6f37e89` (ios tree) | 15 m 09 s | start 6.6 / med 7.3 / max 18.9 |
| `harness:android` | **PASS** | 685 tests / 32 suites + isolated 6 tests / 3 suites | `2501a6f37e89` (android tree) | 18 m 59 s | start 6.7 / med 5.3 / max 10.8 |
| `real-input:ios` | **PASS** | — | `2501a6f37e89` (ios tree) | 47 m 45 s | start 5.8 / med 7.8 / max 25.2 |
| `real-input:android` | **PASS** | — | `2501a6f37e89` (android tree) | 72 m 18 s | start 4.3 / med 5.5 / max 15.4 |
| `harness:ios:Conformance.harness` | **PASS** | 110 tests / 1 suites | `2501a6f37e89` (ios tree) | 3 m 29 s | start 9.1 / med 9.1 / max 15.7 |
| `real-input:android:--control:hosted-picker` | **PASS** | — | `2501a6f37e89` (android tree) | 11 m 32 s | start 4.4 / med 5.2 / max 14.2 |

(`gate.mjs table` prints the newest row per gate; `docs/tasks/X31/gates.jsonl` keeps every attempt,
the two red iOS runs below among them, plus the three junk rows in the next paragraph and the stale
`harness:ios:Form.harness` row — the mutated-tree red proof from Red proofs.)

`need --for review` and `need --for merge`: **both satisfied on this code tree** — `check`, both
`harness:*` and both `real-input:*` green on `2501a6f37e89`.

`real-input:ios` took three attempts, and the table shows only the one that fit. The 22:33Z run lost
`IconButton` ("tab `tab-iconbutton` is still outside the window") and `Popover` (three real taps on
`popover-short-anchor`, each leaving `0 row(s) named "Do the thing"`); the 23:24Z run had those two
green and lost `A11y` on the same sentence for `tab tab-contextmenu`, with the other 28 controls
green; the 00:13Z run — a fresh lease on the same pair, so `lease.mjs` cleared the app's state
first — was **28/28 controls and 25/25 auxiliary checks, with no input sequence needing a retry**.
No control failed twice across the three, and the red two recorded load up to 40.3 against 25.2 for
the green one: the host dropping real input under load rather than this round's code, which is also
what the rest of the evidence says — nothing that `scripts/real-input/ios.mjs` imports moved since
the 16:38Z green run (the one runner module added here, `menu-placement.mjs`, is imported by
`android.mjs` alone), and `real-input:android` — the runner that *did* change, 72 m 18 s — is green
along with its `--control:hosted-picker` filter.

Three ledger rows are mine and are junk, not findings: `real-input:android:hosted-picker`,
`real-input:android:hosted-picker:--background` (0.2 s and 0.4 s) and
`harness:ios:Conformance.harness:--background` (1.5 s) are two mistyped filters — the runner got
the filter and `--background` as positional arguments and refused them. The filtered runs that
mean something are `real-input:android:--control:hosted-picker` and
`harness:ios:Conformance.harness`.

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

The four judge mutations were re-run on the restored tree at `9a2bd29` before this round trusted
them, and each turned the named cases red and the file green again on restore: 2 red with the side
rule out, 3 with the pre-X31 edge-to-edge gap, 2 with the distance rule out, 2 with the band back
to the guessed 20 dp — the last also trips the boundary case's `expect(NEAR_GAP).toBe(84)`, which
is why that line is there. The accel case was re-run too: `patience=38975ms allowance=8120ms`
with `kill -KILL` taken out of `bounded()` (38 975 ms is the stub's own 40 s, which is the
unbounded body), and `gaveUpOnTheTool: false` with the command the guard names typo'd.

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

- `harness:ios` needed six attempts on this host tonight to go green on this tree; five reds are
  in the gate log store. Two lost the app mid-run with no crash report (`Sizing`, then
  `ButtonGroup`) on a host with 735 MiB of 17.4 GiB swap free, five simulators and three emulators
  booted; one was `Form row boxes (X29 r2) · hands no row back as a loss across 400 pt scrolls`
  timing out on a scroll that never moved the list (`offset=226.67` unchanged, `losses=0`,
  `giveUps=0`); two were `Conformance · ButtonGroup · no-leak-on-drop: 1 ledger entry survived 50
  drops`. `harness:ios:Conformance.harness` on its own is 110/110 in 209 s on the same app, so the
  extra entry is cross-suite state or a deallocation losing to a slow host rather than a
  `NitroUiSizing::forget` that never ran — and `ios/`, `cpp/`, `src/`, `example/` are byte-for-byte
  the tree whose `harness:ios` went green at 16:19Z (only `scripts/` and `docs/` moved since). If
  `no-leak-on-drop` goes red again on a quiet machine it is a ButtonGroup leak to chase, not an
  X31 flake.
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
- ~~`MENU_ROOM_SLOP_DP` is a false-red guard, not a graded rule~~ — **wrong, and fixed in fix
  round 1.** The band it widens is where the check is genuinely uncertain, so it is graded: two
  fixtures sit on its edges now, and removing the slop turns both red. What round 1 wrote there
  described a rule that added the slop to the room (`roomBelow + slop >= menuHeight`), which is the
  wrong direction: it hid the ~300 px in which Material's surface does not fit although the rows do.
  See `MENU_ROOM_SLOP_DP` and `### Red proofs (fix round 1)`.
- Real input on iOS is load-sensitive in two specific places, and they are worth one owner rather
  than five task rediscoveries: the a11y sweep's `tab <x> is still outside the window` wait and the
  popover's three-tap retry. Three different controls failed across tonight's two red `real-input:ios`
  runs and no control failed twice; the green third run, on the same pair with the app reinstalled,
  needed no retry at all. Neither has a line in `docs/tasks/FOLLOWUPS.md` yet.

## Fix round 1

**1 · The room slop ran the wrong way.** `roomBelow + roomSlopPx >= menuHeight` asked whether the
room *plus* an allowance covered the rows, so it took the slop off what Material needs. Material
opens below only when its whole surface fits under the anchor — the rows plus their padding,
shadow and M3's 48 dp window margin — so there was a band about 300 px wide in which a correct
above-placement read as `wrongSide`, and `centreOnScreen`'s give-up-after-4-scrolls anchor can sit
in it. Three ranges now: under the menu's own height means above, the height plus the slop means
below, and between them either side is accepted and the check says nothing. Both edges are
fixtures, and the band's case grades *both* placements inside it, so this is not a failure moved
somewhere else.

**2 · The judge graded a box the tap did not use.** The check keeps `aimed` — the box its own
`requireControlAt` last returned, which is the one `tapNode` pressed — and hands that to the judge
and to the note beside it. `centreOnScreen` now returns only a box two consecutive dumps agree on,
and an anchor that never came to the middle says how far off it was in the graded line, not in a
note two lines above.

**3 · The E1 and E4 calls are guards, and now say so** — with the distinction next to the counter
and at each call: the churn case is the witness, `giveUpCell`'s only call site is the `else` of a
guard on a one-case enum, and E1 removes a row, never a Section.

**4 ·** The accel allowance is half the hanging stub's life and is called a fixed allowance, because
a `sleep 1` is a timer and obeys no law the guard does; `pressAimed` passes the refusal as
`{ cause }` when the box lookup itself throws; and `wrongSide` is one sentence naming both numbers
it weighed.

### Red proofs (fix round 1)

- `real-input-menu-placement.test.js` (10 cases) -> round 1's one-line rule restored
  (`roomBelow + slop >= menuHeight`) -> `accepts either side when the room below fits the rows but
  not the menu's surface`: `expected false to be true` at `expect(up.ok).toBe(true)`, and `rejects a
  menu that opened below with a pixel less room than the menu needs`: `expected true to be false` at
  `expect(seen.ok).toBe(false)`. The other 8 stayed green, which is the difference between a band
  and a failure moved somewhere else. Restored: 10/10.
- `ci-workflows.test.js` "does not wait forever" -> `kill -KILL "$pid"` taken out of `bounded()` in
  `.github/workflows/ci.yml`, so the guard prints its complaint and then waits for the tool ->
  `expect(patienceMs).toBeLessThan(allowanceMs)` with `patience=39000ms allowance=20120ms`, while
  `gaveUpOnTheTool`, `printedRest` and the exit status above it all held. The healthy run reads
  `patience=992ms`, so widening the line to half the stub's life costs nothing a working guard pays.
- `Form.harness.tsx` E1 and E4 -> `giveUps += 1` on the line every cell ask runs, not on a
  stale-Section branch -> `harness:ios:Form.harness`: `expected 9 to be 0` at
  `expect(num(report, 'giveUps')).toBe(0)` for **both E1 calls and for E4**, with the churn at
  `expected 8 to be 0`. E3 also went red (its row-height wait never satisfied, `giveUps=9`), which
  is why this grades the *wiring* of those calls and not a branch they reach — said so in the
  comment above them.
- `real-input:android:--control:hosted-picker` -> the check scrolls 300 px between the centre read
  and the tap, and hands the judge the box from before the drift ->
  `✗ the menu sits against the box the Host drew … (wrongSide: menu 1212..1517, anchor 1319..1487,
  window 2424: a menu of 305 px opened above its anchor with 937 px of window under it … it should
  have opened below)`, next to the runner's own `moved from 42,1319 → 777,1487 to 42,986 → 777,1154
  - the tap is aimed at the new box`. Graded against the box the tap used those same numbers are 58
  px, inside the 84 px band — so the red is the stale box and not the scroll. This run is also the
  first real-device sighting of the new `wrongSide` sentence.
- Not claimed: `pressAimed`'s `{ cause }` has no red proof. Nothing makes `queryByTestId` throw in
  any case here — the change is that when it does, upstream's refusal survives as the cause instead
  of becoming the whole message.

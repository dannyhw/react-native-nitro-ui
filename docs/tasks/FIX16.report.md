# FIX16 - Prove the Android rising-sheet drag fix and get its gates green

**Branch:** `task/FIX16-bottom-sheet-rising-drag-proof` (from `task/FIX12-bottom-sheet-rising-drag`
at `09cbe18c`) - **Round:** 1 of up to 3 - **Lease:** `FIX16-cm9sb` (`emulator-5570` / Metro
`9293`)

## Summary

No library change. One case changed, and what it claims changed with it.

The reads decide this task. The first read of a fit sheet that has just been opened finds its field at
`y=1493` against a settled `y=1514` - about 20 px, and on the far side, because the sheet overshoots
its place and comes back to it. Everything else follows: FIX12's case was red because it aimed at the
top edge of a box read and the sheet came home over the press, and no press aimed from a read can be
placed inside the rise, because the rise is inside the tap that starts it.

`example/e2e/real-input/bottom-sheet.e2e.ts` therefore accepts any read within one field-height of
where the field settles - measured reads are several times inside that - and presses the middle of it,
the one point a settling field cannot move out from under the finger. The case is renamed to what it
proves: a drag that starts on the `TextInput` is the field's own and the sheet does not close to
answer it, witnessed by the field's own press-in. No assertion was loosened and no wait lengthened;
the reads it looked at now travel in the failure message. `example/src/BottomSheetScreen.tsx` is back
to the field height `main` gives it - no taller field was needed once the aim was the middle.

Behaviours 3 and 4 are **not proven**, and the measurement above is why. `RisingDragMeasurement` is
alive only while the sheet is rising, so by the time a gesture can be aimed at it, there is nothing
left to measure. Removing only the `claimedByChild` guard left the field case green, 14/14. The
view-local revert of the screen-space measurement produced no red on this tree at all; the one case
that went red under an earlier run of that mutation has since been green under the same mutation and
red under the unrelated one, so it is intermittent and no witness, and both held-press cases stayed
green under it. Reaching either guard needs a witness for the sheet's animation phase that is not the
accessibility tree.

`check` and `harness:android` are green and `need --for review` is satisfied on this tree. Owed: a
second consecutive filtered green, the plain `--control bottom-sheet` key, one full
`real-input:android`, and `real-input:ios -- --control bottom-sheet`. The budget went into the
measurement above, which is what the case now rests on.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2178 tests / 96 suites | `521c56af2e3c` | 57.2 s | start 5.7 / med 8.1 / max 9.1 |
| `harness:ios` | **PASS** (from `task/FIX13-button-group-text-spacing`) | 611 tests / 30 suites + isolated 6 tests / 3 suites | `85cf285d0ecf` (harness:ios digest) | 14 m 26 s | start 11.2 / med 5.8 / max 11.2 |
| `harness:android` | **PASS** | 669 tests / 31 suites + isolated 6 tests / 3 suites | `521c56af2e3c` (harness:android digest) | 18 m 11 s | start 5.1 / med 5.6 / max 11.7 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `real-input:android:--control:bottom-sheet` | stale | 2 failed of 15 tests / 1 suites | eafc8af5521a (not this tree) | 14 m 04 s | start 6.4 / med 5.8 / max 19.4 |
| `real-input:android:--control:bottom-sheet:--a11y:switch` | **PASS** | 14 tests / 1 suites | `521c56af2e3c` (real-input:android digest) | 4 m 41 s | start 4.6 / med 7.2 / max 12.4 |

`need --for review`: ✓ check — green; ✓ harness:android — green on its own digest; note: treated as both platforms (outside the known prefixes): example/e2e/real-input/bottom-sheet.e2e.ts, example/src/BottomSheetScreen.tsx; need: review is satisfied on this code tree.

## Red proofs

None obtained this round. In detail:

- the field drag case -> remove only the `claimedByChild` guard -> **no red**: `Tests 14 passed
  (14)`, on the tree one step before the final one, whose aim pressed nearer the field's leading edge
  than the final aim does.
- that case, both held-press cases and the slide-out case -> `RisingDragMeasurement` read in view
  coordinates again (`rawX`/`rawY` back to `x`/`y`, and the velocity tracker losing its offset to the
  screen) -> **no red from the mutation**: `Tests 13 passed | 1 failed (14)`, the one failure that
  tree's own aim throwing, with the slide-out case green under it. The slide-out case's red under an
  earlier run of the same mutation is the flake named under Follow-ups, not a witness.
- the re-aimed case was itself seen red, one tree earlier: `real-input: no read of the rising fit
  sheet caught its TextInput between 100 px and its own height 431 px short of the resting y=1514 it
  settles at` - the reads in that message are where the 20 px figure comes from.

FIX12's two red proofs, for the guards it did prove, are unchanged. Mutation runs are recorded against
the tree they ran on, which is not a commit on this branch, so their rows print `stale`.

## Files changed

- `example/e2e/real-input/bottom-sheet.e2e.ts`
- `example/src/BottomSheetScreen.tsx`
- `docs/tasks/FIX16.report.md`

## Follow-ups

- `example/e2e/real-input/bottom-sheet.e2e.ts`: the slide-out case ("a drag down during the rise
  slides the sheet out...") is intermittent - three reds and two greens across this branch's runs,
  independent of which mutation was in.
- The example screen's Notes field is 56 dp with a list under it; a case that must read it mid-rise
  has no room in the reads to do so.

## Questions for orchestrator

The two guards that need a press inside the rise cannot be reached from the harness as it is. Options:
(a) the sheet reports its animation phase somewhere a test can read, and the two cases aim by that;
(b) merge with the guards unproven, on FIX12's two existing red proofs plus this report's measurement;
(c) give the test a slower rise to aim at. Recommendation: (b) now, (a) as its own task.

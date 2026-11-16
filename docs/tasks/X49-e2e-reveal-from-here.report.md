# X49 — the Android real-input suite stops scrolling from the top for every control

**Branch:** `task/X49-e2e-reveal-from-here` (from `main` at `6635e80e`) · **Round:** 1 of up to 3 ·
**Lease:** `X49-q7ssb` (`emulator-5574` / Metro `9295`)

## Summary

The e2e phase of a full `real-input:android` run went from **1862.5 s to 1641.6 s (−220 s,
3.7 min)**, 70/70 tests green, every assertion and the band definition unchanged.

The brief's model of where the time went was only partly right. Most tests make one reveal on a
freshly opened screen, so the rewind rarely ran. The real cost was `boundingBox()`: on a node that
is not in the tree it waits the whole 30 s action timeout before it refuses. A scroll search reads
an off-screen control several times, so a Host-screen test spent ~90 s in three such waits before
its second drag.

What changed, all in `example/e2e/real-input/support.ts`:

1. **Reads that do not wait.** `reveal`, `settleIntoBand`, `liftIntoBand` and `isShown` ask
   `count()` first and treat 0 as absent at once. The exported `boxOf` is unchanged, because tests
   use it to wait for a node.
2. **The first read on a just-opened screen still waits**, as before. A tab tap can return before
   the new screen is in the tree. An absent first read then dragged down a page that was about to
   show the control. This made `hosted-slider` red in two full runs: the drags that followed put
   a gesture on the hosted slider before the test's own drag.
3. **Direction.** `reveal` starts from where the page is. A box above the band travels towards
   the top; a box below, or none on a page known to be at its top, travels down. It rewinds only
   when the control is out of the tree on a page that has left its top. A control already in the
   band costs no drag.
4. **The drag back towards the top is sized to the distance**, capped at one stride, so a control
   just above the band is not flung past it.

Per-file numbers are in "Before and after" below.

Where the rest goes: across the final run, `app.open` took 131 s and the wait for the tab strip
267 s. A control that is off-screen when its screen opens still pays one 30 s wait (item 2).

Two red full runs came before the green one, both on `hosted-slider` (`real-input:android`
started 21:16 and 21:56 UTC). The second run's other files were slowed by `app.open` and
strip waits of 8–22 s under host load, so it is not used for timing.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2054 tests / 91 suites | `abe2a50ebd87` | 1 m 31 s | start 6.8 / med 8.4 / max 9.3 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | **PASS** | — | `abe2a50ebd87` (real-input:android digest) | 39 m 31 s | start 8.0 / med 7.8 / max 27.6 |
| `real-input:android:--control:hosted-picker` | stale | — | d9121de7280a (not this tree) | 12 m 04 s | start 8.8 / med 7.2 / max 20.9 |
| `real-input:android:--control:hosted-picker:--control:picker:--control:form:--control:button-group:--control:menu:--control:list-item` | stale | — | fd6e0c4a5015 (not this tree) | 19 m 07 s | start 11.0 / med 6.8 / max 24.9 |

`need --for review`: need: review is satisfied on this code tree.

## Before and after

Per file, before (M10 full run, 2026-11-16 18:45; the newest M10 Android log is a filtered
bottom-sheet run, so the newest full one is used) and after (this branch's final full run, JSON
report), in seconds:

| File | Before | After | Δ |
| --- | --- | --- | --- |
| bottom-sheet | 112.0 | 115.7 | +3.7 |
| button | 12.1 | 15.6 | +3.5 |
| button-group | 43.9 | 50.1 | +6.2 |
| checkbox | 24.3 | 28.3 | +4.0 |
| chip | 25.7 | 30.0 | +4.3 |
| context-menu | 106.9 | 115.6 | +8.7 |
| date-picker | 66.0 | 70.2 | +4.2 |
| dialog | 33.2 | 36.6 | +3.4 |
| form | 128.0 | 135.8 | +7.8 |
| hosted-button | 20.3 | 22.5 | +2.2 |
| hosted-date-picker | 222.0 | 117.4 | −104.6 |
| hosted-mixed | 98.2 | 100.9 | +2.7 |
| hosted-picker | 112.4 | 58.6 | −53.8 |
| hosted-segmented | 109.7 | 57.7 | −52.0 |
| hosted-slider | 26.5 | 31.8 | +5.3 |
| hosted-switch | 35.5 | 39.1 | +3.6 |
| icon-button | 48.0 | 58.7 | +10.8 |
| list-item | 160.4 | 110.6 | −49.8 |
| menu | 62.1 | 33.1 | −29.0 |
| picker | 119.2 | 124.0 | +4.8 |
| popover | 69.2 | 69.3 | +0.0 |
| search-field | 46.1 | 47.3 | +1.1 |
| segmented-control | 34.7 | 35.4 | +0.7 |
| slider | 16.2 | 15.5 | −0.7 |
| stepper | 39.3 | 35.8 | −3.5 |
| switch | 14.9 | 14.1 | −0.8 |
| text-field | 40.3 | 39.1 | −1.2 |
| tooltip | 34.1 | 32.0 | −2.1 |
| **total** | **1861.2** | **1640.8** | **−220.4** |

## Red proofs

All in `scripts/__tests__/real-input-reveal.test.js`, against a fake page that drops off-screen rows from the tree:

- `travels up to a control above the band without going down first` -> the towards-top rule replaced by `false` (look only downwards) -> `real-input: the control was never in the tappable band after 12 drags along content column 97%`
- `costs no drag for a control already in the band` -> the old unconditional `if (downDrags > 0) await rewindToTop(screen)` restored -> `toEqual([])` received nine lines of drags
- `brings a control just above the band back by its distance, not a full stride` -> `dragContentFraction(screen, -CONTENT_STEP)` -> `Expected: < 1000, Received: 1296`
- `waits on an off-screen control only at the first read of a screen` -> `boxOf` on every read -> `Expected: 1, Received: 2`
- `lets a screen still mounting show the control before it drags` -> `boxNow` on the first read too -> the test went red, and the wait test beside it read `Expected: 1, Received: 0`

## Files changed

- `example/e2e/real-input/support.ts`: reads that do not wait, the mount wait, direction, sized drag back
- `scripts/__tests__/real-input-reveal.test.js`: unit tests for the above

## Follow-ups

- real-input: most files that make no long search are 2–10 s slower; likely the extra `count()` snapshot per read, not measured.
- example app: a "screen mounted" marker would let the first read stop waiting 30 s for an off-screen control (needs an `example/src` edit, so iOS gates).
- real-input: `openScreen` (app launch, strip wait and strip swipes) is now the largest fixed cost per test.
- gate: `need` treats `example/e2e/real-input/support.ts` as both platforms ("outside the known prefixes"), unlike the brief's "no iOS gate owed by an edit under `example/e2e/`".
- budget: the round took about 3 h 5 min including three full runs.

# FIX15 — Bring back the Android Form keyboard opt-out proof

**Branch:** `task/FIX15-form-keyboard-opt-out-case` (from `main` at `4cf99e54`) ·
**Round:** 1 of up to 3 · **Lease:** `FIX15-a6mmq` (`emulator-5570` + iPhone Air, Metro 9293/8293)

## Summary

Android's scroll view scrolls for a focus or rectangle request whatever the Form's own view
answers: `View.requestRectangleOnScreen` walks every ancestor and ORs the results without stopping
at one that handled the request, so the Form's `requestChildRectangleOnScreen` cannot turn it down
- which is why FIX10's forward-blocking guard could not have worked. The switch is the scroller's,
so `Form.tsx` now passes `scrollsChildToFocus={keyboardAvoidance}`: opted out, React Native's
scroll view stops moving its content for a focused row, which is what an app means when it says
the Form must leave its content alone. The cost is in the prop's doc comment - while opted out,
Android also stops scrolling a focused row into view for d-pad, Tab and TalkBack focus. The
default path is untouched, and nothing else about the Form moved.

`nuiTestCommand` on Android answers two commands now - `ime:<dp>` reports an inset to the Form as
the window listener does, `rect:<row>` asks the scroller to show a row - and the report gained
`contentH=`, `rectReqs=` and `rectBelow=`. The new cases mount a Form of twelve 160 dp rows,
report a 300 dp keyboard and ask for the last row, a screen below the viewport: opted out, the
scroll offset and the content height hold to 1 dp across two asks a second apart (a scroll view
asked to show a row may animate it there); with the default, the same ask moves the offset by
about 1056 dp and grows the content by the reservation. `rectBelow` is 1 in both, which is the
case's own premise - the ask is one a Form that avoids the keyboard has to answer.

The real-input case is **not** restored. Its two recorded failures are not this hole: a request
moves a row only as far as the scroller's own viewport needs, which for a row parked at y 1954 in
a viewport ending at 2424 px is nowhere, and in both runs the Note row was absent from the dump
with no keyboard on screen after `expectKeyboard()` had passed and `form-avoid-echo` reading `no`.
The case reads the box of a row it parks behind the keyboard; that reading is what failed, and the
helpers behind it are out of scope here. What a restored case needs is in the FOLLOWUPS line.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2178 tests / 96 suites | `88b05385bf83` | 1 m 05 s | start 3.5 / med 13.4 / max 16.4 |
| `harness:ios` | **PASS** | 613 tests / 30 suites + isolated 6 tests / 3 suites | `88b05385bf83` (harness:ios digest) | 14 m 26 s | start 4.7 / med 7.0 / max 18.3 |
| `harness:android` | **PASS** | 671 tests / 31 suites + isolated 6 tests / 3 suites | `88b05385bf83` (harness:android digest) | 18 m 13 s | start 4.7 / med 6.3 / max 18.3 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:android:Form` | stale | 1 failed of 113 tests / 2 suites | 4a9ce1fdbea1 (not this tree) | 3 m 23 s | start 10.1 / med 7.2 / max 12.5 |

The `harness:android:Form` row is a filtered red-proof run, on the mutated tree
`4a9ce1fdbea1`; a filtered run satisfies no gate, which is why it reads stale here.

`node scripts/gate.mjs need --for review`: *need: review is satisfied on this code tree.*

## Red proofs

All three are filtered runs - `node scripts/gate.mjs harness:android -- Form`, which is
gate `harness:android:Form` - each red on its own mutation, green before and after.

- "leaves an opted-out Form alone when a row below the viewport is asked to be shown" -> delete
  `scrollsChildToFocus={keyboardAvoidance}` from the Form's scroll view -> `an opted-out Form
  scrolled 1056 dp to show a row it was asked about (…"scroll":"1055.6"…"rectBelow":"1"…):
  expected 1055.6 to be less than or equal to 1`.
- same case -> report the keyboard padding on `imeInset > 0` instead of
  `keyboardAvoidance && imeInset > 0` -> `an opted-out Form grew its content by 299.8 dp for a 300
  dp keyboard it was told to leave alone (…"contentH":"2280.0"…): expected 299.79 to be less than
  or equal to 1`.
- "scrolls a Form that keeps the focused row visible when the same row is asked for" -> pass
  `scrollsChildToFocus={false}` to every Form, not only an opted-out one -> `Form report never
  satisfied "the Form scrolling the row it was asked about into view" - last was
  …scroll=0.0;contentH=2280.0;rectReqs=1;rectBelow=1;keyboard=rn;ime=299.81…` - so the control
  case dies when the switch is off everywhere, and the opt-out case dies when it is on.

## Files changed

- `src/components/Form/Form.tsx` — `scrollsChildToFocus={keyboardAvoidance}`, and the prop doc
  says what opting out also switches off.
- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiForm.kt` — the `ime:`/`rect:` test
  commands, `contentH=`/`rectReqs=`/`rectBelow=` in the report, counters cleared on recycle.
- `example/__tests__/Form.harness.tsx` — the tall Form and the two cases.
- `.changeset/form-keyboard-opt-out-stops-the-scroll-view.md`, `docs/tasks/FOLLOWUPS.md`, this file.

## Follow-ups

- Form (Android): the two `requestChildRectangleOnScreen` forwards are no-ops — the ancestor walk
  already carries the request to every scroller, and their comments say they route it.
- e2e (Android): `form-list-geometry` echoes the Form's geometry on iOS only; an Android echo of
  `scroll=`/`ime=` would give real-input checks a reading no keyboard can stand in front of.

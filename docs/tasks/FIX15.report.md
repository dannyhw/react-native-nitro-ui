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
Android also stops scrolling a focused row into view for Tab, the keyboard's Next key and a
`focus()` from code; d-pad and TalkBack mostly keep scrolling, as the review's Q2 reads it. That
cost is why fix round 1 withdrew the switch: see "Fix round 1" below.

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
| `check` | **PASS** | 2178 tests / 96 suites | `d584f833efe6` | 1 m 08 s | start 8.7 / med 11.8 / max 14.2 |
| `harness:ios` | **PASS** | 615 tests / 30 suites + isolated 6 tests / 3 suites | `d584f833efe6` (harness:ios digest) | 16 m 26 s | start 12.3 / med 8.1 / max 18.1 |
| `harness:android` | **PASS** | 673 tests / 31 suites + isolated 6 tests / 3 suites | `d584f833efe6` (harness:android digest) | 18 m 15 s | start 20.4 / med 8.3 / max 20.4 |
| `real-input:ios` | **PASS** (from `merge/FIX13`) | — | `85cf285d0ecf` (real-input:ios digest) | 44 m 12 s | start 3.8 / med 6.0 / max 17.5 |
| `real-input:android` | missing | — | — | — | — |
| `harness:android:Form` | stale | 4 failed of 115 tests / 2 suites | 6353d4dc2b46 (not this tree) | 3 m 08 s | start 10.1 / med 8.7 / max 13.7 |
| `harness:android:Form.harness` | **PASS** | 27 tests / 1 suites | `d584f833efe6` (harness:android digest) | 30.3 s | start 7.1 / med 7.1 / max 7.1 |

The table is fix round 1's, regenerated at the final commit: round 1's own rows are gone from
it, since its switch is gone from the tree. The two `harness:*:Form*` rows are filtered runs,
which satisfy no gate - the `Form` row is the first run of the rewritten cases, which caught a
`num()` read of a text field, and `Form.harness` is the same file green.

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

- `src/components/Form/Form.tsx` — round 1 passed `scrollsChildToFocus={keyboardAvoidance}`; fix
  round 1 withdrew it, so this file is back to what `main` has.
- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiForm.kt` — the `ime:`/`rect:` test
  commands, `contentH=`/`rectReqs=`/`rectBelow=` in the report, counters cleared on recycle.
- `example/__tests__/Form.harness.tsx` — the tall Form and the cases.
- `docs/tasks/FOLLOWUPS.md`, `docs/components/form.md`, `.changeset` (empty), this file.

## Follow-ups

- Form (Android): the two `requestChildRectangleOnScreen` forwards may be dead code - Android's
  walk up the ancestors carries the same ask to every view above it, and nothing has shown that
  the forward adds a scroll of its own. The comment now says the walk is there; deleting the two
  overrides, and the copies in `HybridNitroUiFormSection.kt`, wants one green Form harness run
  with them gone.
- e2e (Android): `form-list-geometry` echoes the Form's geometry on iOS only; an Android echo of
  `scroll=`/`ime=` would give real-input checks a reading no keyboard can stand in front of.

## Fix round 1

**Lease:** `FIX15-d84ig` (`emulator-5574` + iPhone 17, Metro 9295/8295). Gates above.

The switch is gone, doc text with it: opting out of the Form reserving the keys is no ask for
its scroll view to stop answering Tab, the keyboard's Next key or a `focus()` from code, and per
Q1 it buys nothing on an edge-to-edge window. `Form.tsx` is back to `main`, so the changeset is
empty.

The cases read what the Form itself does: field focused in row 8, Form parked at 700 dp, a 300 dp
inset reported. Opted out, `contentH=` and `scroll=` hold to 1 dp; by default the content grows
299.8 dp and the field lifts 178 dp clear. Two more ask the scroller for row 11 - it moves either
way the prop says, the behaviour round 1 turned off. `focus=` is the premise: nothing focused,
nothing revealed.

Five filtered `Form.harness` runs (27 tests, ~30 s), each red on one mutation, green either side:

- pad on any inset -> `grew its content by 299.8 dp …: expected 299.79 … less than or equal to 1`.
- reveal without the opt-out check -> `lifted its focused field 178 dp off the spot it was parked
  at: expected 177.9 … less than or equal to 1`.
- `avoidsKeyboardForIme` answers `false` -> `still parked at 699.8 dp: expected 699.8 … greater
  than 700.8`.
- never pad -> `only 0.0 dp, not the 300 dp it was asked to reserve: expected 1980.2 … greater
  than or equal to 2278.2`.
- switch restored -> never satisfied `the scroller showing the row it was asked about, last parked
  at 699.8 dp` (`rectReqs":"1`, `rectBelow":"1`).

# X22 — iOS ContextMenu accessibility stops: 2 or 4

**Branch:** `task/X22-context-menu-a11y-stops` (from `main` at `2eb10a28`) · **Round:** 1 of up to
3 (D19) · **Lease:** `X22-inlap` (pair-a: iPhone 17 / iOS 27.0 + `nitroui_a` on `emulator-5574`) /
Metro `8295`

## Summary

**Cause: the sweep compared boxes, and the finding turns on membership.** `a11y:context-menu`
counts the accessibility elements XCUITest walks under `ctx-accessible`. React Native publishes
each of them **twice**, so the "stop" count is twice the number of child `Text`s whose
accessibility elements the app has published at the instant of the read — nothing else. The two
shapes differ in membership alone: `Grace Hopper` sits at `(25, 459.67, 352×17)` in both, and the
4-stop reading is that tree plus the second `Text`'s pair. No frame ever differs, and
`A11yFrameStability` compared frames only — so two reads of two different trees agree with each
other, the wait reports `settled`, and the pass prints whichever tree it landed on. Whether the
exemption's `: 2 element(s) …` anchor then matched stopped being a property of `ContextMenu`.
Measured today on pair-a: `main` reads 3 elements, both branches 5 — with the component, its
screen and the sweep's read of this case byte-identical across all three.

The XCUIElement handle is not the variable. 30 freshly resolved subtree walks and window-rooted
`label ==` queries over 24 s agreed with the captured handle every time, and all said the second
`Text` is not in the tree on `main`. What varies is what React Native has
**published** — accessibility elements are published on the JS thread — which is why the reading
follows what the pass mounted before it rather than the code under test.

**Fix, at the wait.** `settle` now takes an identity channel — a sorted multiset of
trait|name|value, duplicates kept because the duplicates *are* the finding — so agreement means
"the same elements", not "the same boxes". For the shape where a merge is what the finding turns
on (`mergedChildrenInQuestion`: a named wrapper that still lists a differently named text inside
it), the agreeing pair has to survive a **confirmation read** taken a window later: the pair is
~3 s apart, which is a snapshot-rebuild window, not one in which a JS-thread publication can
happen. A tree that never holds still is still printed unsettled under the same cap — nothing is
retried toward a green. `confirmed` keeps that designed third read out of the report while a fourth
still reaches it. Cost: 6 of 22 cases ask, ~+50 s on the a11y pass. The exemption stays at 2, the
component is untouched, and `main` still reads 3 elements — the exempt 2 stops.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1993 tests / 84 suites | `f0181b2daf18` | 2 m 52 s | start 4.8 / med 6.8 / max 11.2 |
| `harness:ios` | **PASS** | 564 tests / 30 suites + isolated 6 tests / 3 suites | `f0181b2daf18` (ios tree) | 14 m 14 s | start 17.2 / med 5.5 / max 17.3 |
| `harness:android` | **PASS** | 620 tests / 30 suites + isolated 6 tests / 3 suites | `f0181b2daf18` (android tree) | 18 m 24 s | start 5.0 / med 7.3 / max 65.5 |
| `real-input:ios` | **PASS** | — | `f0181b2daf18` (ios tree) | 40 m 16 s | start 9.0 / med 6.2 / max 90.4 |
| `real-input:android` | missing | — | — | — | — |

`need --for review` exits 0 on this code tree (`need: review is satisfied on this code tree.`). The
shipping half of the diff is iOS-only — the two UITest files — and `harness:android` is asked for only
because `scripts/native-tests/a11y-frame-stability.test.swift` sits outside the known prefixes, so
`need` reads the diff as both platforms; it ran and passed, and nothing under `android/` changed.
`real-input:android` belongs to the merge bar, not the review bar, so it is missing here by design.
The three device gates ran serially on lease `X22-inlap`.

The row that carries this fix is `real-input:ios`: its `testRealInputA11y` method took 449.7 s against
the 395 s it took before the fix, and inside it `a11y:context-menu` read the exempt **2 stops** — two
static texts `Grace Hopper` at (25, 459.67, 352, 17) under `ctx-accessible`, 3 nodes in the walk — and
printed no stability line. The healthy reading is unchanged with the confirmation reads running, and
`a11y:ios-debt` calls the exemption live rather than stale.

## Red proofs

- `a11y-frame-stability.test › a same-boxed, swapped-membership pair is not agreement` ->
  `identitiesAgree` returns `true` (membership stops being compared) ->
  `FAIL … (got 2 reads)`, plus 5 sibling checks including
  `duplicates count: two of one element is not one of each`.
- `a11y-frame-stability.test › and pays one confirmation read for it` -> the confirmation branch
  in `settle` never taken -> `FAIL … (got 2)` and
  `the confirmation is a window (120 ms), not the 120 ms snapshot pause`, plus 5 siblings.
- No device mutation: the 4-stop shape would not reproduce on this tree (see Questions), so the
  device evidence here is that the healthy reading is unchanged — `nodes=3`, no stability line —
  with the confirmation reads running.

## Files changed

- `example/ios/NitroUiExampleUITests/A11yFrameStability.swift`: `identitiesAgree`, the
  `identitiesOf` / `confirmationNeeded` / `confirmMs` parameters, `Outcome.confirmed`, and
  `shouldReport` treating a designed confirmation read as quiet.
- `example/ios/NitroUiExampleUITests/RealInputTests.swift`: `A11ySnapshot.identities` and
  `mergedChildrenInQuestion`, wired into the sweep's one `settle` call.
- `scripts/native-tests/a11y-frame-stability.test.swift`: items 4b/4c (membership is part of
  agreement; the confirmation read, its window, its cost guard and its disagreement), and the
  `shouldReport` pair for a confirmed outcome — all in `bun run test:native`.

## Follow-ups

- real-input: `testRealInputA11y` was killed twice in diagnostic runs at ~390–420 s of method time
  with "Restarting after unexpected exit, crash, or test timeout"; no one owns that ceiling.
- real-input: the gate refuses a leased Metro port held by this task's own `Metro` and names the
  pid, but does not say "that one is yours, kill it".
- a11y: the `separate`-count rule grades React Native's *duplicated* elements, so any change to
  that duplication invalidates every exemption anchored to a count.
- scripts: `gate.mjs logs` keeps only the summary lines of a `real-input:ios` run, not the raw
  `real-input a11y …` lines — the per-case tree is invisible after the fact.
- lease: the pool also carries a stale `avd:x16_avd` row on `emulator-5574`, the serial pair-a boots
  `nitroui_a` on and no lease holds it, so an override reap keyed on that row would power off a live device.

## Questions for orchestrator

1. **The mechanism is established; the reproduction is not.** Mounting 8 more Pickers plus text
   rows on the screen the sweep walks 15 cases before `contextmenu` did not move `main` off 3
   elements, and building the G26 tree needed `pod install` for its new file, which I did not spend
   the round on. Options: (a) **recommended** — land this and re-run `real-input:ios` on G25/G26 at
   merge: the merge bar runs it anyway, and it is the direct test of the claim; (b) I build G26's
   tree in a scratch checkout with this fix applied on top and run it there (one more round).

## Fix round 1

**Cause.** One component, three walk histories, iOS 27: a fresh app walked straight to the
case reads **one** element — wrapper labelled, subtree hidden, no stops; the same tree walked in
the middle of `main`'s sweep reads **2** stops; on the merged Stepper + Picker-radio tree,
whose sweep has one more case before this one, **4**. Boxes identical, no instability line,
and the 21 cases the two sweeps share are byte-identical in both logs. Not XCUITest echoing: the sweep's probe finds one labelled
child under the wrapper and one under *that* — React Native vends two nested elements per
`Text`. The window: the wrapper hides its subtree once React Native has stored `accessible` on the
component view, and read from this view's getter, that store is still **false inside
`afterUpdate()`** (`value="exp:hostElements:acc=n"`).

**Fix.** The authorised fallback: that measurement says a component fix keyed on the prop
there is a silent no-op (both probes ran; neither is a claimed failure). Any count is
excused when every stop is one of the wrapper's own Texts *and* the sentence names the
publication; the unnamed container box — the real D37 item 2 regression — stays red.
Corrected the exemption comment, `FOLLOWUPS.md` and `context-menu.md`, which repeated G16's
wrong count rule. Gates and proofs below.

## Fix round 1 appendix

**Both directions.** `ios-context-menu.log` (2 stops) and `ios-context-menu-four-stops.log`
(measured 4) → `failures: []`, `known: 1`; `ios-context-menu-not-an-element.log` (the
wrapper's element forced false) → `failures: 1`, `exempt: false`. Red proof of the separator:
`unnamed.length > 0` → `unnamed.length > 1` → `goes red on the measured tree of a wrapper that
is not one element` and `reports both shipped readings as its recorded debt, and only those`
both failed; restored, 51 pass.

**A branch that does not touch ContextMenu reads as `main`.** The new sentence sits in the
`control.wrapperIsControl === true` branch, which only ContextMenu sets in `A11Y_CONTROLS`,
and the row is keyed `context-menu`/`ios`; every iOS fixture verdict for every other control
is byte-identical to `origin/main`'s rule (both modules imported and compared), and on device
the 21 non-ContextMenu cases the two sweeps share read byte-identically in those logs (the
merged log's extra `stepper` case reads 3 nodes).

**The 2-vs-4 bisect.** Not a case's identity: the same tree, same build, sweep narrowed to
`context-menu` alone reads `nodes=1` (03:29Z); with all 20 of `main`'s predecessors it reads
`nodes=3` (03:37Z, `NUI_CTX_A11Y` armed but a no-op); `task/G25-G26-merge`, one case longer, read
`nodes=5`. Late re-reads 3, 6 and 9 s after the settled read never changed the count in any
run, so the shape is latched by the time the rule sees it and the settle is right to trust it.
`windowStaticTexts=0` in the 1-node reading: the second Text is nowhere in the a11y tree, not
merely outside the wrapper.

**Real fix, for whoever closes G16's debt** (measured, not shipped): the one-element tree is
the natural reading, so what must be prevented is UIKit *keeping* children published during
the window before `accessible` lands. The only lever that looks able is invalidating the
published children after the answer flips (a layout-changed notification on the component
view once `isAccessibilityElement` answers true — not inside `afterUpdate()`). Proof would be
the full sweep reading `nodes=1`, a ~9-minute run plus `check`, `harness:ios`,
`harness:android` and `real-input:ios`; the lease was granted at 02:45Z and that did not fit
the round.

**Follow-ups (round 1)**

- real-input: the a11y sweep's own probe (`kind=diag`/`kind=late`/`kind=probe`) answered
  questions the fixture could not; it is not in the tree — worth a permanent, cheap version.
- a11y: `A11Y_EXEMPTIONS` rows anchored on a count are anchored on walk history; the two
  Android `hosted-*` rows are the next candidates for the same treatment.

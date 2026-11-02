# G11 — AlertDialog and ConfirmationDialog

**Branch:** `task/G11-dialogs` (from `main` at `3a9e259`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `G11-30rj7` (iPhone 17 iOS 27.0 `F08675D3` / `nitroui_t03` `emulator-5574` / Metro `8295`)

## Summary

`AlertDialog` and `ConfirmationDialog` ship as two exports over one Hybrid View,
`NitroUiDialog`, with Appendix B's API unchanged: `isPresented` behind the event-count
handshake, `onAction(id)` before `onIsPresentedChange(false)` (D32), a refused dismissal
presents again with one dev warning (D33), `sizing: null`, hostable. iOS builds a
`UIAlertController` (`.alert` / `.actionSheet`, implicit localised Cancel on a dismissible
sheet with none); Android composes M3 `AlertDialog` or a `ModalBottomSheet` of rows from a
`0 × 0` `NitroComposeHost` that composes on attach (B3's first open question: it does, no
core flag needed).

**Spike (brief item 1), every case green on both platforms** (`Dialog.harness.tsx`): plain
view; inside an RN `Modal`; over a `pageSheet` Modal mid-slide; a second dialog over the
first; JS `false` mid-entry; unmount at 0/80/150/1000 ms; the Modal under an open dialog
closing; react-native-screens `formSheet` (present, sheet closes under it) and a screen push
(measured with `react-native-screens@4.30.1` on a commit reverted next). Two platform
differences, both pinned: a **full-screen** Modal over the dialog's screen closes it and
reports on iOS (UIKit takes the presenter's views out of the window) and leaves it up on
Android; a push closes and reports on both.

**Decision a reviewer must read — iOS presents from its own window, not B2's in-chain
presenter.** The first iOS run presented in the chain and failed one case: RN closes a
Modal with `dismissViewControllerAnimated` on the Modal's controller, which with a dialog
on top dismissed the dialog and stranded the Modal (`topPresented=RCTFabricModalHostViewController`
after close). `ios/core/NitroUiPresentation.swift` (factored from DatePicker's popover, B2)
now also presents in a `UIWindow` at `.alert + 1` — React Native's own `RCTAlertController`
pattern. DatePicker uses the helper's in-chain path, unchanged; its suites are in the full
harness below. Question 1 asks whether BottomSheet should inherit the own-window path.

**Tooling.** A manifest may name several public components (`exports`), so the Host
import, `HOSTABLE_CONTROLS` rows and the barrel check run per export. The conformance rules
gained their presentation-aware form (Q5 follow-up): `A11Y_PRESENTATIONS` makes the
real-input check the a11y rule for a box-less component (held to `sizing: null` +
`realInput: true`), and the in-app suite's `selfSizing: false` (held to the manifest both
ways) prints the matrix's reason for the fallback/leak rules while the recycle rule runs a
real residue probe (a left-over native event count refuses the second owner's present).

Example screen, stories, `docs/components/dialog.md`, README section and a minor changeset
are in. Bench arms (B8) are a follow-up: no scenario can stamp a presentation yet.

## Gates

Round 1's generated table described code tree `91c20699519c`, which fix round 1 replaced;
the fresh table is in "Fix round 1" below, and `docs/tasks/G11/gates.jsonl` keeps every
run of both rounds.

In round 1's table the `stale` rows were the red-proof runs, on mutated trees, and
`real-input:ios` was its second run on that tree: the first lost one of twelve 0.15 s presses
on the untouched Switch screen (`dropped 1 of 12 presses`, the F7 quick-tap class) and passed
Dialog and all 14 a11y cases. Round 1's `need --for review` was satisfied on that tree.

## Red proofs

Device reds were run on mutated trees (rows marked `stale` below are those runs); unit reds
with `jest -t`. Each mutation was reverted before the gates above.

- `Dialog.harness` "reports an action before the close it causes" (iOS and Android) -> `onAction` moved after the close -> `expected 'act:presented:false,act:action:delete' to be 'act:action:delete,act:presented:false'`
- `Dialog.harness` "takes no tap on a disabled action" (iOS) -> `isEnabled` forced true (build and in place) -> `expected '1,1,1' to be '1,0,1'`
- `testRealInputDialog` -> the same -> `XCTAssertFalse failed - a disabled action should be a button that is not enabled (twin "Delete draft" isEnabled=true)`
- `CHECKS.dialog` (Android) -> `TextButton(enabled = true)` -> `✗ a disabled action is a node that is not enabled — expected false, saw true`
- `CHECKS.dialog` (Android) -> `dismissOnBackPress`/`dismissOnClickOutside` forced true *and* the model's `!dismissible` guard dropped -> `✗ Back leaves the sticky alert up — expected 1, saw 0`, `✗ and so does a tap outside — expected 1, saw 0`. The mapping alone stayed green: the model refuses the dismissal too, so Back is defended twice.
- `Dialog.harness` "leaves no window when dropped 80/150 ms after presenting" (iOS) -> teardown stops carrying the dismissal -> `never reached nothing presented ... no dialog window left`, report `live=1;…;windows=1`
- `Dialog.harness` drop tests (iOS) -> **`hideImmediately` removed -> stayed green.** They assert the end state, which the carried dismissal still cleans up; the flash it prevents is unguarded (follow-up).
- `Dialog.harness` "presents from inside a <Host>" (Android) -> `Component()` returns early when hosted -> `never reached up from inside the Host`, `kind=none;hosted=1`
- `Dialog.harness` "leaves no Modal behind when the RN Modal under an open dialog closes" (iOS) -> B2's in-chain presenter (the first implementation) -> `topPresented=RCTFabricModalHostViewController` after the Modal closed
- `Dialog.harness` "gives a recycled view none of the open dialog" (iOS) -> before `alert = nil` on recycle (first implementation) -> the reused view reported the old title
- Conformance "Dialog › shows none of its previous owner" (iOS) -> `prepareForRecycle` keeps the handshake counts -> `the dialog the second owner asked for is presented reads 0 where the props say 1` (and 13 of 20 `Dialog.harness` tests red: recycled views refuse presents, `presented=0;js=1`)
- Conformance "Dialog › is named on its own box" (iOS) -> wrapper passes `accessibilityLabel={title}` -> `expect(labelled).toBeNull()` got a box
- `registry.test.js` exports: duplicate-export guard off -> `toThrow /duplicate export "ConfirmationDialog"/`; per-export barrel loop skipped -> `received ""`; distinctness check off -> `received ""`
- `conformance.test.js` presentation case: sizing / realInput / both-tables guards off -> each `received ""`; `selfSizing` guards off (missing, abused) -> each `received ""`
- `host.test.tsx` "has an opinion on every control" -> manifest `exports` ignored -> `arrayContaining ["AlertDialog","ConfirmationDialog"]` received directory names

Not individually mutated: the spike's context tests (inside/over a Modal, two at once,
mid-entry false, formSheet, push) and refusal / mount / in-place tests; they were written
against measured behaviour and several failed during development before the fix landed.

## Files changed

- `src/components/Dialog/*` (new): wrapper, nitro spec, manifest, view config; `src/index.ts`.
- `ios/core/NitroUiPresentation.swift` (new), `ios/components/Dialog/HybridNitroUiDialog.swift` (new), `ios/components/DatePicker/HybridNitroUiDatePicker.swift` (helper).
- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiDialog.kt` (new); nitrogen output and generated tables (`bun run regen`).
- `scripts/registry-core.mjs` (`exports`), `scripts/conformance-core.mjs`, `scripts/real-input/{a11y,android}.mjs` and their tests; `src/__tests__/host.test.tsx`.
- `example/__tests__/{Dialog,Conformance}.harness.tsx`, `example/ios/NitroUiExampleUITests/RealInputTests.swift`, `example/src/{DialogScreen,readme-examples}.tsx`, `example/src/stories/Dialog.stories.tsx`.
- `docs/components/dialog.md`, `README.md`, `.changeset/dialogs-alert-confirmation.md`, `etc/package-files.txt`, `docs/tasks/FOLLOWUPS.md`.

## Follow-ups

The eight `G11` lines appended to `docs/tasks/FOLLOWUPS.md`, one line each there:

- Bench: the `mount`, `memory`, `leak` and `present` dialog scenarios are not built (no presentation stamp exists).
- Spike: the UIKit-vs-SwiftUI screenshot and the iOS 26/27 sheet-placement arms were not run.
- iOS: DatePicker's in-chain popover keeps the RN Modal stranding hazard the Dialog spike measured.
- Tests: no permanent react-native-screens gate; Android's detach close path is covered only by that spike.
- iOS: a non-dismissible sheet with a `cancel` action still closes on an outside tap (UIKit routes it to the cancel).
- Docs: no README screenshots for the dialogs.
- Conformance: no shared presentation-aware leak rule (BottomSheet will want one).
- Tests: `hideImmediately` (the flash after a mid-entry drop) is unguarded by the drop tests.

## Questions for orchestrator

1. **Own-window presentation as the core default (B2 deviation).** Options: (a) keep it
   Dialog-only and leave DatePicker in-chain; (b) move DatePicker's popover to the own
   window too and make it the helper's only path for S2/BottomSheet; (c) revert to B2's
   in-chain presenter and document the RN Modal hazard. Recommendation: (a) now, (b) as
   BottomSheet's first step — a sheet inside an RN Modal hits the same stranding, and a
   `UISheetPresentationController` in its own window needs its own spike.

## Fix round 1

All six review items, two code commits.

**1.** The refusal warning fires only in the commit whose echoed count moved, so open,
cancel, `false`, `true` stays quiet. **2.** `NitroUiPresentation` keeps the entry transition
and carried dismissal per controller; each completion dismisses its own controller and
window (DatePicker's one controller takes the same path). **3.** `titleVisibility` JSDoc
matches iOS. **4.** A disabled sheet row gets Material's disabled colour (M3 1.4 has no
`ListItem(enabled)`); the harness reads each label's drawn colour (`drawn=`), both
variants. **5.** The window root forwards the status bar and orientations of the app's top
controller, captured at present. **6.** Closing a key window hands key back and posts
`.screenChanged`; iOS 27 already restores key, so that test is proved by mutation.

Red proofs:

- `dialog.test.tsx` quiet reopen -> pre-fix wrapper -> `Expected: 0, Received: 1`
- swap ×6 (iOS) -> pre-fix helper, and `entering = [key: …]` -> `expected '2' to be '1'`, `live=2;…;windows=2`
- disabled, confirmation (Android) -> pre-fix row -> `expected '1,1,1' to be '1,0,1'`
- status bar (iOS) -> pre-fix root -> `expected '0,0,30' to be '0,0,2'`
- key window (iOS) -> `close()` keeps the window, releasing its root -> `key=other`

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1655 tests / 63 suites | `6470cdb9f93f` | 2 m 02 s | start 7.2 / med 10.7 / max 13.8 |
| `harness:ios` | **PASS** | 267 tests / 17 suites | `6470cdb9f93f` (ios tree) | 4 m 42 s | start 8.9 / med 5.9 / max 8.9 |
| `harness:android` | **PASS** | 317 tests / 17 suites | `6470cdb9f93f` (android tree) | 8 m 35 s | start 5.0 / med 4.5 / max 5.6 |
| `real-input:ios` | **PASS** | — | `6470cdb9f93f` (ios tree) | 15 m 06 s | start 4.9 / med 6.1 / max 77.4 |
| `real-input:android` | **PASS** | — | `6470cdb9f93f` (android tree) | 22 m 53 s | start 6.2 / med 4.5 / max 6.2 |
| `harness:android:Dialog` | **PASS** | 28 tests / 1 suites | `6470cdb9f93f` (android tree) | 37.6 s | start 4.8 / med 4.2 / max 4.8 |
| `harness:ios:Conformance` | stale | 2 failed of 45 tests / 1 suites | 48152bc52ff9 (not this tree) | 1 m 39 s | start 4.7 / med 5.4 / max 6.9 |
| `harness:ios:Dialog` | **PASS** | 29 tests / 1 suites | `6470cdb9f93f` (ios tree) | 59.4 s | start 3.7 / med 4.4 / max 5.7 |
| `harness:ios:Dialog:-t:key%20window` | stale | 1 failed of 29 tests / 1 suites | 2e565f3cc127 (not this tree) | 19.1 s | start 11.9 / med 11.7 / max 11.9 |
| `harness:ios:Dialog:-t:recycled%20view%20presents%20again` | stale | 6 failed of 29 tests / 1 suites | e923506e7221 (not this tree) | 1 m 15 s | start 7.6 / med 6.9 / max 7.6 |
| `harness:ios:Dialog:-t:status%20bar%7Ckey%20window` | stale | 1 failed of 29 tests / 1 suites | b91da82a05b2 (not this tree) | 12.3 s | start 4.8 / med 4.8 / max 4.8 |
| `real-input:android:--control:dialog` | stale | — | 1ae6b9e02309 (not this tree) | 6 m 02 s | start 3.6 / med 4.1 / max 5.3 |
| `real-input:ios:--control:dialog` | stale | — | 48152bc52ff9 (not this tree) | 4 m 46 s | start 6.5 / med 15.2 / max 55.8 |

`need --for review`: `need: review is satisfied on this code tree.` The `stale` rows are the
red-proof runs on mutated or pre-fix trees.

## Fix round 2

**1.** A teardown that meets a dismissal already under way hands its ticket and window to
that dismissal's transition coordinator, or releases them at once if there is none. The
iOS action seam now has the alert dismiss itself, as a tap does: going through the helper
hid the leak. **2.** The window root keeps a weak app window and finds the top controller
on every ask. **3.** The mid-entry swap wait needs `title === 'Mount b'`. **4.** A teardown
gives up a present UIKit never took (no red proof; FOLLOWUPS).

Red proofs (iOS):

- drop 100 ms into an action's close -> pre-fix early return -> `live=1;…;windows=1;…;key=ours`. JS-`false` barrier green alone.
- screen changes under the dialog -> answer pinned at first ask -> `expected '0,0,30' to be '0,0,2'`

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1655 tests / 63 suites | `08f9b4d6f976` | 2 m 03 s | start 7.0 / med 10.7 / max 13.5 |
| `harness:android:Dialog` | **PASS** | 30 tests / 1 suites | `08f9b4d6f976` (android tree) | 39.9 s | start 8.7 / med 7.4 / max 8.7 |
| `harness:ios:Dialog` | **PASS** | 32 tests / 1 suites | `08f9b4d6f976` (ios tree) | 1 m 04 s | start 11.7 / med 8.9 / max 11.7 |
| `harness:ios:Dialog:-t:close%20of%20a%20JS%20false` | stale | 32 tests / 1 suites | e3d2e689be5b (not this tree) | 8.7 s | start 9.1 / med 9.0 / max 9.1 |
| `harness:ios:Dialog:-t:close%20of%7Ckeeps%20answering` | stale | 3 failed of 32 tests / 1 suites | e3d2e689be5b (not this tree) | 27.6 s | start 13.8 / med 12.0 / max 13.8 |

Stale rows: the red-proof runs. The full gates ran on `task/G11-merge`, whose code tree is this one.

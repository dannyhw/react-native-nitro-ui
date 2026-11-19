# FIX17 — An iOS BottomSheet that UIKit refused to present can present again

**Branch:** `task/FIX17-ios-sheet-refused-present` (from `main` at `20e70ca9`) ·
**Round:** 1 of up to 3 ·
**Lease:** `FIX17-k1uo2` (simulator `3AE7EE8D-543D-445D-BC4A-C7A6CDFF5646` / Metro `8293`)

## Summary

On iOS `presentIfPossible` stored the sheet's controller before handing it to UIKit, and `sync()`
returns early whenever `sheet` is set. UIKit refuses a present it will not carry out — the
"already presenting" race with a chain whose transition the 50 ms check just missed — without
running the completion or giving the controller a presenter, so nothing was ever coming to clear
`sheet`, and that mount stayed closed for the rest of its life.

The fix decides "refused" from UIKit's own state one run loop turn after `present` returned.
`present` installs a presentation before it returns, so `presentingViewController` is already set
for a present that is merely slow — its transition running, its completion still to come — and is
still nil for one UIKit refused. That is the signal, and it cannot fire for a slow present.
`NitroUiPresentation.forgetUnstarted` reads it and drops the entry it was carrying, so a
completion that arrives after all ends the presentation uncounted, as a teardown's already does.
`forgetRefusal` then lets the controller go — callbacks, content, `sheet` — reports
`onIsPresentedChange(false)` once with no `onDismiss` (nothing was on screen to go), and the next
`isPresented = true` presents a new controller. The refused controller is released, so no
controller or touch-root count stays behind; `refusedPresents` is a new report field.

The two new harness cases force a refusal through `nuiTestRefuseNextPresent()`, which presents a
clear controller from the presenter about to be asked — the race itself, not a stub: UIKit really
does refuse the sheet, and the blocker goes away with the refusal it caused. Android is unchanged
apart from a no-op for that seam, since there is no presentation there for UIKit to refuse.

Not done: `harness:android`, owed because the harness file is shared — see Follow-ups.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2180 tests / 96 suites | `7457e2ce106f` | 56.8 s | start 8.3 / med 10.9 / max 13.0 |
| `harness:ios` | **PASS** (completed: 1 of 30 units re-run, attempt 1) | 22 tests / 1 suites | `7457e2ce106f` (harness:ios digest) | 56.1 s + full run 16 m 26 s | start 11.8 / med 11.8 / max 14.5 |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:ios:BottomSheet` | stale | 23 failed of 29 tests / 1 suites | 03e04e940eaa (not this tree) | 3 m 38 s | start 6.0 / med 5.7 / max 14.7 |

`need --for review`: `1 gate(s) missing for review: harness:android` — `check` and
`harness:ios` are green on `7457e2ce106f`.

The full `harness:ios` run passed 594 of 595 tests and died in `Tooltip.harness.tsx` with
"the app process exited, but no crash log lines were found"; `--rerun-failed` re-ran that one
suite green, which is the `completed` above. Nothing in that suite touches a BottomSheet, and
another task's run was on the machine at the same time.

## Red proofs

- `BottomSheet.harness.tsx` "a present UIKit refused › lets it go, reports it once, and presents
  the next ask" -> `presentIfPossible` stops calling `forceRefusal(from:)` and
  `watchForRefusal(_:)`, which is today's code -> red at
  `never saw "refused:presented:false"; events=[]` (`example/__tests__/BottomSheet.harness.tsx:330`),
  with `refusedPresents` never leaving 0: 1 failed, 28 passed.
- `BottomSheet.harness.tsx` "a present UIKit refused › keeps a present whose completion is still
  to come" -> `NitroUiPresentation.forgetUnstarted` decides from the completion instead
  (`guard entering[key] != nil`, no `presentingViewController` check), so every present is
  forgotten one turn after it is issued -> red at
  `"slow" never reached the present taken and its completion still to come`
  (`example/__tests__/BottomSheet.harness.tsx:197`), its report reading
  `refusedPresents=1;onScreen=0` with `events=[slow:presented:false]`. That mutation took 23 of
  the file's 29 cases red, which is the point: the presenter, not the completion, is the signal.

## Files changed

- `ios/core/NitroUiPresentation.swift`: `forgetUnstarted(_:)`, the one reader of UIKit's own
  answer about a presentation that never began.
- `ios/components/BottomSheet/HybridNitroUiBottomSheet.swift`: watch for the refusal, let the
  controller go and report the close once; `refusedPresents` in the report; the
  `nuiTestRefuseNextPresent()` seam and its blocker.
- `src/components/BottomSheet/{BottomSheet.nitro.ts,NativeNitroUiBottomSheet.ts,BottomSheet.tsx}`,
  `nitrogen/generated/**`, `etc/react-native-nitro-ui.api.md`: the seam in the spec, handle and
  API report.
- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiBottomSheet.kt`: a no-op
  for the seam.
- `example/__tests__/BottomSheet.harness.tsx`: the two cases; `staysUp` takes an `up` predicate so
  a second sheet on screen does not read as a fall; `countEvents` counts a reported close.
- `docs/components/bottom-sheet.md`, `.changeset/ios-sheet-refused-present.md`.

## Follow-ups

- `harness:android` is owed for this branch (the harness file is shared): on an Android
  lease, `node scripts/build-app.mjs --platform android` then
  `node scripts/gate.mjs harness:android`. This task's lease was iOS-only and another
  merge held the machine with its `real-input:ios`, which runs alone, for the second
  half of the round.
- `Dialog`, `Popover`, `Tooltip` and `DatePicker` present through the same
  `NitroUiPresentation.present` and can be refused the same way; only BottomSheet recovers.
  `forgetUnstarted` is ready for them.
- `docs/tasks/FOLLOWUPS.md`'s G14 line about a refused present can be retired once this merges.

## Orchestrator notes at merge

- Review N3: the first red proof removed the test seam with the fix, so nothing was refused; per
  the review's reading, removing only `watchForRefusal` turns the same line red. Not rerun.
- Follow-ups from review: bound re-presents per ask and mute the "dismissed by the user" warning
  for a refusal (N2); assert no `refused:dismiss` event right after the refusal (N4); the unused
  `up` parameter on `staysUp`; no harness case for the own-window refusal path.

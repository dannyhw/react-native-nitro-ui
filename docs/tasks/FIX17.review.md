MERGE WITH FIXES

# FIX17 review — iOS BottomSheet after a refused present

Branch `task/FIX17-ios-sheet-refused-present` at `45ab7af8`. No M findings; 9 N. `harness:android`
is still owed (see N9). `check` was not run here: `lease.mjs list` shows X57 `in use (real-input:ios)`.
PR #108 has no CodeRabbit inline comments.

## Answers

1. **Signal.** The claim rests on observation. Apple's documentation for `present(_:animated:completion:)`
   and `presentingViewController` does not say when the property is set, and does not promise that a
   refused present never runs later. The evidence is strong, though: every present on both paths now
   goes through `watchForRefusal`, the full `harness:ios` run (595 tests, own-window/Modal-host cases
   such as `own-fit` included) stayed green, and mutation 2 shows that a present whose completion is
   still to come already has its presenter one turn later. `dismissForTeardown` already relied on the
   same signal (`ios/core/NitroUiPresentation.swift:226-238`). An interactive dismissal of the top
   controller never reaches `present`: `isBusy` (`NitroUiPresenterChain.swift:46-49`) holds it in the
   wait loop. If UIKit ever queued a present instead of refusing it, the late completion ends it
   through `dismissNow(animated: false)` (`NitroUiPresentation.swift:103-107`). That leaves a bounded
   glitch (an empty sheet flashes in and out after JS heard `false`), not a stuck mount. See N1.
2. **What JS hears.** An app that updates `isPresented` hears `false` once and no `onDismiss`
   (`HybridNitroUiBottomSheet.swift:944-948`). The content is moved back home and hidden
   (`restoreContent`, :942), the wrapper unmounts it through `onDismissed(false)`, and the next present
   adopts it again. The harness checks this (`inSheet=0`, then `isUp` with `children>=1`). An app that
   keeps `isPresented` true behaves differently (N2).
3. **Races.** A late completion finds no entry and ends uncounted. A recycle or drop bumps
   `mountGeneration`, so the check stands down, and `dismissForTeardown` drops the unstarted entry. A
   JS `false` before the check is a no-op in `sync` (sheet set, not up), and the check then settles the
   debt without an event. A JS `false` then `true` before the check reports `false` against a newest
   JS `true`, which matches what is on screen. Two presents in a row cannot happen: `sheet` and
   `presentScheduled` gate them. The main queue is FIFO, so the check runs before a
   `windowChanged(false)` step queued later. I found no race bug.
4. **Seam.** `nuiTestRefuseNextPresent` is a hybrid method, not a prop, so the `?:` rule does not
   apply, and nitrogen output matches the spec. In production its only cost is the `refusalArmed`
   guard in `forceRefusal`. `refusalArmed` and `refusalBlocker` are reset in `teardown()`, and
   `refusedPresents` in `prepareForRecycle()`. The Android no-op is harmless. The handle stays
   `@internal`, like the other `nuiTest*` methods.
5. **Tests.** The refusal is real: presenting from a controller that is already presenting is refused
   by UIKit. Nothing was loosened. Two N findings follow (N3, N4). Flake sighting (N8).
6. **Docs.** Comments follow AGENTS.md. No forbidden paths are touched, there is one author address,
   and I found nothing personal. Doc gaps are N5 and N6.

## Findings

- **N1** `ios/core/NitroUiPresentation.swift:166-180`, report:16. The doc comment and report state
  "`present` installs the presentation before it returns" as UIKit fact. It is observed behaviour.
  Say so in the report, and keep the comment as a constraint ("observed: ...").
- **N2** `HybridNitroUiBottomSheet.swift:944-946` with `NitroUiModel.swift:57-62` and
  `src/components/BottomSheet/BottomSheet.tsx:329-385`. Take an app that keeps `isPresented` true
  (no `onIsPresentedChange`, or one that ignores `false`). The echo of the `false` event is a JS write
  of `true` at the current count, so `reconcile` presents again with no new ask. That is good for a
  one-off refusal. For a refusal that persists while `isBusy` says the chain is free, it becomes an
  unbounded cycle: a new controller, a refused present, `onIsPresentedChange(false)` and a re-render,
  every few frames. That breaks brief Behaviour 2 ("never twice") for that app. In development, the
  first cycle also triggers the "dismissed by the user but `isPresented` is still true" warning,
  which is wrong for a refusal. Suggest bounding re-presents per JS ask, like `presentWaits`, and
  muting the warning for a refusal. This is speculative today (no known persistent refusal), so it
  is a follow-up, not a blocker.
- **N3** report:54-57. Red proof 1's mutation removes the seam (`forceRefusal`) together with the fix
  (`watchForRefusal`), so the test goes red because nothing was refused, not because the fix is
  missing. Reading the code, keeping `forceRefusal` and dropping only `watchForRefusal` turns the same
  line red (`harness.tsx:330`, no `presented:false`). Restate the proof as that mutation, or rerun
  it.
- **N4** `example/__tests__/BottomSheet.harness.tsx:871-878`. "No `onDismiss` for a refusal" is only
  checked by the final `countEvents('refused:dismiss') === 1`. A wrong `onDismiss` at refusal would
  satisfy the later `waitForEvent('refused:dismiss')` at once, and the count could be read before the
  real one lands. Add `expect(countEvents('refused:dismiss')).toBe(0)` after the `refused` report.
- **N5** `docs/components/bottom-sheet.md:134-138`. The bullet gives the app developer an
  implementation rationale ("UIKit installs a presentation before `present` returns, so one turn
  later..."). It does not say what an app that keeps `isPresented` true sees (presented again at once,
  N2), and the "What happened / What the app is told" table at :116-123 has no row for it. Add the row
  "UIKit refuses the present (iOS) | `onIsPresentedChange(false)`, no `onDismiss`", and drop the
  rationale.
- **N6** `.changeset/ios-sheet-refused-present.md:5-8`. True, but like the doc, "the next
  `isPresented={true}` presents" leaves out the keep-true case.
- **N7** `example/__tests__/BottomSheet.harness.tsx:263-268`, report:80. The new `up` predicate on
  `staysUp` is never passed (every call has three arguments), so the report's reason for it ("a
  second sheet on screen") does not apply. Drop the parameter or the claim.
- **N8** Flake sighting: one full `harness:ios` run lost `Tooltip.harness.tsx` to "the app process
  exited, but no crash log lines were found". `--rerun-failed` was green, and another task's run was
  on the machine. Record it; nothing in this diff touches Tooltip.
- **N9** `harness:android` is owed: `need --for review` lists it missing, and the shared harness file
  changed (the new cases return early on Android after render, handle and report). Run it before
  merge. The own-window refusal path (`prepare: armRefusal`, `HybridNitroUiBottomSheet.swift:874-890`)
  has no harness case either. It is a follow-up and cheap to add next to the in-app case.

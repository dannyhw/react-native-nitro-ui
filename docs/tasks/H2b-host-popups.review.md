# H2b review — Android `<Host>` for SegmentedControl, Picker, DatePicker

**Reviewed:** `task/H2b-host-popups` at `3d6e2ea` (`git diff main...HEAD`, merge-base `94dab9b`),
against the brief, the report and `docs/tasks/H2b/gates.jsonl`. No device was used: every claim
below comes from the code, the test sources, the ledger and the local bench result
(`bench/results/72315db-dirty-android-20261027T025136Z.{json,md}`, re-checked here with
`report.mjs --check`).

## Verdict: **MERGE WITH FIXES**

The design holds up. A hosted control's popup or dialog is composed by the Host's composition,
so disposal is what takes it down. I traced each teardown path:

- **Child removal:** `onDropView` → `onChange = null`, and the group leaves at the Host's next
  recomposition.
- **Host drop:** the Host's composition is disposed.
- **Disable:** both controls close their window.

Nothing can emit after unmount. `onChange` is nulled before the window goes, so a row or OK
click in the frame between `onDropView` and the Host's recomposition reaches a null callback.
The native allowlist and the JS table agree: seven `isHostable` overrides match the seven
`HOSTABLE_CONTROLS` rows. "mounts all seven hosted" checks the native half on a device by
asserting a `0 × 0` own box for each kind, and the `isHostable = false` mutations went red for
all three new controls. `NitroComposeHost` is untouched, so the B1 contract (`strategyArmed`,
`drop()`, `PreDrawWatch`) and N4 are unchanged for every control. The two G5 fixes are right.
Each is local to `afterUpdate` or the dialog subtree, and each is gated with a red proof.

Three things must be fixed first. One hosted-DatePicker path can bring back a closed window.
The hosted dialog has no coverage of its own dismissals. The README and `host.md` say two things
the code and the bench don't support. Each is bounded: one Kotlin line plus one harness case, one
real-input case, and doc edits. Only `harness:android` and `real-input:android` need to be re-run.

## M — must fix

### M1. A hosted DatePicker whose child is hidden while its dialog is open reopens the dialog when shown again

`android/.../HybridNitroUiDatePicker.kt:1120` (the `Presentation` `DisposableEffect`) and
`android/.../core/NitroUiHost.kt:272`.

`HostedChildren` skips a child with `isHiddenByReact`. Setting `display: 'none'` on a hosted
DatePicker while its dialog is up therefore disposes the `Presentation` subtree, and the dialog
goes away. Nothing resets `model.presented`:

- `setVisibility` only calls `hostedChildVisibilityChanged()` (`NitroComposeHost.kt:424-431`);
- the `DisposableEffect` only decrements `livePresentations`.

The report then reads `presented=1` with `live=0` and no window.

**Failure scenario.** The app shows the field again (`display: 'flex'`). `if (presented)`
composes the dialog again, over the screen, with nobody having asked for it. Its provisional
selection is lost, because `rememberDatePickerState` is rebuilt.

The Picker already guards this exact case. `MenuWitness`'s `onDispose` writes
`model.expanded = false`, and its KDoc gives the reason in so many words ("a hosted child that
left and re-entered … would open a window nobody asked for again"). The DatePicker has no
equivalent.

The same gap applies to a reorder, if a reorder disposes the group rather than moving it. The
report says a reorder closes a hosted menu even with `anchorMoved` stubbed out, which points to
disposal. The dialog would then flash and stay open.

**Fix.** In that `DisposableEffect`, add `model.setPresented(false)` to `onDispose`, matching
`MenuWitness`. It is a no-op on every path that already closed the dialog (dismiss, OK,
`onDropView`, disable). Add a `HostPopups` case: open the dialog, hide the child, show it again,
and expect `presented === false` and `livePresentations === 0`.

### M2. The hosted DatePicker's own open and dismiss paths have no coverage, and a test comment claims coverage that doesn't exist

`example/__tests__/HostPopups.harness.tsx:1028-1041` and `scripts/real-input/android.mjs`
(there is no `hosted-date-picker` case).

Every hosted-dialog gate opens the dialog with `nuiTestPresent()` and closes it by disabling the
field or dropping the Host. As a result:

- no gate shows that a press on the hosted `compact` field opens the dialog;
- no gate covers OK, Cancel, Back or an outside tap closing it;
- no gate covers a day pick + OK reaching JS through the Host;
- no gate covers the a11y tree of the hosted dialog.

Brief item 3 asks for "the same open, dismiss, remove, drop and a11y cases as the Picker". The
dismiss and a11y halves are missing, and so is child removal on its own (only "a sibling leaves"
and Host drop are gated). The comment at `:1036` says dismissal is gated "on a real Back press in
`scripts/real-input`". No such case exists, and the report says so itself ("A hosted
`DatePicker`'s dialog has no real-input case on either platform").

**Is the missing real-input case acceptable? No, on Android.** The report says it "was not
attempted, so this report makes no claim about whether `input tap` … could drive a Material
dialog reliably". But the unhosted `date-picker` case in the same file already drives the same
Material dialog with real taps, every gate run: `openAndPick` (`android.mjs:1613`), `dayGrid`
and `isConfirmLabel`. The infrastructure exists and is proven, and the hosted case is close to a
copy.

**Failure scenario.** A regression in how the Host's composition routes a press to the hosted
field's `OutlinedButton`, or how it delivers the dialog's OK click back to `applyUserSelection`,
passes every H2b gate. Nothing ever presses either one.

**Fix.**
1. Add `hosted-date-picker` to `scripts/real-input/android.mjs`. It needs a hosted DatePicker
   with an echo on `HostScreen`. The case should check that:
   - a real tap opens one window;
   - the day cells are in the uiautomator tree (the a11y witness);
   - a day + OK reaches JS;
   - a reopen + Back leaves `popupWindowCount() === 0`.
2. Add a harness case that removes only the DatePicker child while its dialog is open.
3. Remove the duplicated paragraph at `:1033-1041` and its false pointer.

iOS can stay without a case: the Host is a passthrough there (D23). The report should say that
this is the reason.

### M3. The README and `host.md` state things the code and the bench don't support

- **`README.md:457-459`:** "the three controls that each own a window — `SegmentedControl`,
  `Picker` and `DatePicker`". A SegmentedControl owns no window. Its own KDoc
  (`HybridNitroUiSegmentedControl.kt:279-288`) and the real-input check "a SegmentedControl opens
  no window of its own" both say so. `docs/components/host.md:196-198` has the same error and
  contradicts itself in one sentence: "Three of the seven … present something outside their own
  box: a `SegmentedControl` presents nothing".
- **`README.md:479-483`:** the new paragraph says the run "reads as quiet". It never says what the
  brief made the caveat: **one `quick` run, on a shared machine, so the numbers are indicative**.
  The same run's own evidence argues against "quiet". Its load max was 27.77 on a ceiling of 7.
  Run against the committed baseline, `node scripts/bench/report.mjs <run> --check` **fails 13
  unhosted `nitro-ui` cells**, including Switch, Slider and Progress mount JS/UI at 1.3–1.9×, on
  code H2b did not touch. The report contradicts itself in the same way: it says
  "`machine.quiet` is true" in Bench and "this machine was not quiet" in Follow-ups
  (`report.md:110`). Rewrite the paragraph to match the first-four paragraph above it: one
  `quick` run, a shared machine, indicative, quiet re-run pending. Say in the report that
  `--check` fails on untouched cells. The numbers themselves match the result file; I checked
  every cell in the new table against `…T025136Z.md`.
- **`docs/components/host.md:202-208`:**
  - The doc says hosted popups "fall out rather than need engineering". But the PR adds
    engineering for exactly this case: `dropOpenMenu`, `noteCompositionOrigin` and the
    `placedViewOf` listener. The doc doesn't say what that rule does to a user: **an open hosted
    menu closes when the Host is moved by layout** (a sibling above it resizes, content is
    inserted). Say it.
  - The "Host is scrolled" row cites a gate that moves the Host with a spacer, which is a layout
    move and not a scroll (see N8). The row should claim "opens under the drawn anchor wherever
    the Host is", which real-input covers after a scroll, plus "closes if the Host is moved by
    layout while open".

## N — nice to have

- **N1. Surviving mutation 1 (Picker disabled while open): the gap doesn't matter, but the
  explanation is incomplete and the mutated line is dead code.**
  `HybridNitroUiPicker.kt:1265` duplicates the `disabled` setter's pre-existing
  `model.expanded = false` (`:1127`), so mutating `:1265` had to stay green whatever Material
  does. Its rationale, "`enabled` and the open flag can arrive in one batch", is false for both
  controls. Neither Picker nor DatePicker has a JS open prop: `expanded` and `presented` are
  native-only. The outcome is covered three ways (setter, `afterUpdate`, M3). Delete the
  `afterUpdate` copy, or keep it and fix the comment. For the DatePicker, `afterUpdate` is the
  only route, and its mutation went red, which is correct.
- **N2. Surviving mutation 2 (reorder with `anchorMoved = false`): the gap doesn't matter.** The
  anchor-follow gate is the witness for `dropOpenMenu`, and it went red. The reorder gate is an
  honest outcome gate. Its comment (`HostPopups.harness.tsx:1480-1483`, "The popup has one signal
  available — its anchor's box") is the opposite of what the mutation showed, so reword it.
- **N3. The unhosted Picker changes too, and that isn't documented.** `placedViewOf` + the
  `OnLayoutChangeListener` (`HybridNitroUiPicker.kt:709-728`), the anchor's
  `onGloballyPositioned`, and `dropOpenMenu` all run for an **unhosted** Picker as well. An
  unhosted Picker's open menu now closes when its RN view is moved by layout. That is probably
  the same stale-window bug fixed, not a regression. But `picker.md` and the changeset don't
  mention it, and the brief asked for unhosted behaviour to be unchanged. On cost, the unhosted
  `mount`/`update`/`memory.picker` cells pass `--check`, so mount cost is unaffected. Scroll-time
  cost is not measured: `onGloballyPositioned` fires on every window-position change. Write the
  behaviour up in `picker.md`, or scope the rule to the hosted case.
- **N4. The hosted Picker's controlled refusal is untested, yet `host.md` claims it.** The
  "refusal" in "a row closes it, the handshake holds, and a refusal still closes it" (`:812`) is a
  pick of the row already shown, not a parent that rejects the change. `host.md:209` says "A
  refused choice still closes the menu and leaves the value where React kept it". `SegRows`
  already has a `refuse` fixture. Add one to `PopupHost`, or rename the test and the doc row.
- **N5. `followTimeValueInDialog` (`HybridNitroUiDatePicker.kt:1395`) has no gate and no red
  proof.** The time/datetime test only opens the dialog and drops it. One case that writes a
  value while the time dialog is open would cover it.
- **N6. Outside-tap dismissal of a hosted menu is claimed but not driven.** Real-input covers a
  row and Back. The popup is focusable, so hosting is unlikely to change this, but one tap
  outside the menu in `hosted-picker` would make the claim true.
- **N7. Wrong file pointers.** The `isHostable` KDoc for Picker (`HybridNitroUiPicker.kt:635`)
  and DatePicker (`HybridNitroUiDatePicker.kt:915`) cites `HostControls.harness.tsx` for
  measurements that live in `HostPopups.harness.tsx`.
- **N8. "The spacer is the scroll stand-in" (`HostPopups.harness.tsx:424`) isn't quite true.** A
  spacer changes layout: the `OnLayoutChangeListener` fires and `dropOpenMenu` runs. A real
  scroll changes neither, so scrolling while the menu is open is a different, untested path.
  Opening after a scroll is covered by real-input. Reword the comment.
- **N9. `PickerModel.reportLock` (`:216`) guards nothing.** The writers never take it, so the
  "formatted under a lock" claim in `readMenuReport`'s KDoc overstates what it does. The code is
  test-only and harmless, but either take the lock in the writers or drop it.
- **N10. Report accuracy:**
  - The ledger has **two** failed rows the table doesn't show, not one. The second is
    `real-input:ios` at 49 ms, the `IOS_UDID`/`IOS_SIM_UDID` follow-up.
  - The bench run is `machine: unlabelled`, though the brief said "label the run".
  - The `--check` result (M3) is not mentioned.
- **N11. The hosted SegmentedControl's a11y is checked only by name.** Real-input finds the
  control node by its label. Nothing checks that the segments carry their selected state through
  the Host's tree (the brief's "TalkBack" item for this control). Hosting is low-risk here; one
  uiautomator assertion would close it.

## Public repo

I found nothing personal: no home paths, emails, hostnames or user names in the diff. The ledger
carries emulator serials, a simulator UDID and the lease id, as `docs/tasks/X6/gates.jsonl` on
`main` already does. The comments name the project's own AVD (`nitroui_t03`), as earlier code
does with `nitroui_t01`. The bench result that records the host CPU model is git-ignored.

## Checked and fine

- The changeset is `minor`, and its text matches the user-visible change.
- `HostChildren.ts`: `UNHOSTABLE_CONTROLS` is empty. The stand-in test in `host.test.tsx`
  restores both tables in a `finally`, so the refusal sentence is still exercised.
- G5 follow-ups:
  - `followValueInDialog` is keyed on `model.displayed`. A provisional pick never moves that
    value, and an accepted echo doesn't either, so the user's in-dialog selection is only
    overwritten by a real programmatic change. That is the intended rule.
  - The unhosted G5 case in `DatePicker.harness.tsx` was correctly inverted, and it now pins
    "not rebuilt" with the build count instead of the page.
- The menu witness (`liveMenus` read from a *different* control after a drop) proves the leak
  claims, and "presses where the witness says" stops the rect gates from passing on two zeroes.

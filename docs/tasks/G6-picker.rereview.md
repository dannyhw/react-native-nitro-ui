# G6 Picker: re-review of fix round 1 (`0be0d31..1719a7b`)

Worktree `~/Developer/oss/nitro-ui-worktrees/G6`, branch `task/G6-picker` @ `1719a7b`. Read-only. I reviewed only what the round touched: `Picker.tsx`, the Swift and Kotlin Picker hosts, `NitroComposeHost.kt`, the harness, MountChurn, real-input and the JVM test, plus the docs and report claims. I also read the kept fix-round logs and dumps in `/tmp/g6fix*` and `/tmp/g6-*.xml`. I did not run any simulator, emulator, Metro or harness.

## Verdict: **MERGE-AFTER-SMALL-FIXES**

M1–M4 are substantially fixed:

- The hold and release design is sound.
- The core hook is inert for every other component.
- The reds are real, and the "cannot be shown red" statements are honest.

Three small must-fixes remain: one JS, one Kotlin (Picker file only, not core), and one text-only.

## Gate

`fnm exec --using 24 -- bun run check` on `1719a7b`: **exit 0**.

- jest 188/188 (12 suites);
- `perf:renders` 6/6 (Picker 6, mount+0 redundant);
- nitrogen, autolinking, api-extractor, publint, manifest (375) and readme all pass.

`git status` was clean afterwards. Log: `/tmp/G6-rereview-check.log`.

## M1–M4

**M1: verified, with two holes (N1, N2).**

- **Controlled pick:**
  - iOS no longer measures at pick time. The echo re-keys, and `layoutSubviews` measures under the new key.
  - Android holds, then `afterUpdate` releases the held size under the new key; the stamp matches.
- **Uncontrolled pick:** `setLastChoice` re-renders with the new key, and the release is the same. The handshake is undisturbed: the batch sends `selectedIndex: null` and count 0, so `reconcile()` returns early (`NitroUiModel.kt:81`).
- **Rejected pick:**
  - Android: the stamp index differs from `displayed`, so the held size is dropped, and the rollback re-reports under the unchanged key.
  - iOS: the rollback re-measures through `shown != beforeShown`.

Lifecycle and core behaviour:

- `prepareForRecycle()`/`drop()` clear the hold, and `model.reset()` clears `pickStamp`. B1 is respected: there are no new listeners or registrations.
- C1 is untouched: `overWidePlacement` and the key-change arming in `onLayout` are as before.
- **The hook is inert for others.** Only `PickerHost.choose` holds, `releaseSizingReports` returns early when nothing is held, and `recordMeasuredSize` is unchanged when not held. `applyModelWrites` is called only by the test hook.

**M2: verified.** `variantKey` feeds `key=`, the `variant` prop and `useSizingId(variantKey)`, exactly as in `Progress.tsx:181-196`.

- The old view's `onDropView` → `drop()` → `releaseSizingInstance()` forgets the old id once (idempotent on recycle). The new mount gets a fresh id.
- The two harness cases rerender one instance. They were red on Android against `0be0d31` and green on iOS, as stated.

**M3: behaviour verified; claims not true (N3).** `clearAndSetSemantics` on the anchor gives one node:

- `android.widget.Spinner`, clickable;
- `content-desc` = the name, `text` = the title;
- `enabled=false` when disabled.

Step 8 is green in `/tmp/g6fix2-GREEN-final-android.log` (one named node for each of the enabled and disabled pickers), and 5 of its 6 assertions are red on the pre-fix APK. So there is no second stop carrying the name.

**M4: verified.** The reds are real:

- the hold mutant reds the hold test on Android only, which is stated;
- the M2 pair was red on Android;
- the churn case fails with `host.drop()` skipped (`/tmp/g6fix-churn-RED-leak.log`);
- the C1 pair was red.

The "not provable" statements are honest: the iOS leak (R4-f), the on-device recycle (R4-d, guarded by the JVM test instead), and the real-input window table (R4-e). The harness test was renamed to what it actually asserts.

**Test hooks (check 5): OK.** `nuiTestSelect` is a spec *method*, not a prop, so D7 does not apply. It is reachable only through the `@internal` `hybridRef`, the same as the G5 precedent. The production row path is unchanged apart from the hold.

## New must-fixes

**N1 (JS, both platforms): a choice survives a variant round-trip, so the key names a title native is not painting.**

- **Where:** `src/components/Picker/Picker.tsx:282-313`. `lastChoice` is matched on `variant`, but mount identity is per `sizingId`.
- **Scenario:** an uncontrolled `menu`, user picks 2 (`lastChoice = {menu, 2}`). The parent switches to `wheel`: remount, and the key correctly names the default. The parent switches back to `menu`: native remounts and re-seeds `defaultSelectedIndex` (0), but `lastChoice.variant === 'menu'` matches again. So the key says `sel:<option 2>` while native paints option 0. The fresh host's first measure files option 0's width under option 2's key, which is exactly M1's cache poison.
- **Fix:** store `{ sizingId, index }` and match on `sizingId`. It is minted on every `variantKey` change and never reused. Alternatively, reset `lastChoice` during render when `variantKey` changes.
- **Test (red first):** an uncontrolled pick, then menu → wheel → menu. Assert that the sent `nuiSizingKey` names the default title. A jest render test is enough.

**N2 (Kotlin, Picker only): a pick that changes nothing holds reports with no batch coming to release them.**

- **Where:** `HybridNitroUiPicker.kt:393-394`. `choose()` calls `holdSizingReports()` *before* `applyUserSelection` runs its refusals (`:225` disabled, `:229` `chosen == displayed`).
- **Scenario:** re-tapping the row already shown is common, and real-input step 2 does exactly that. It closes the menu, emits nothing, and causes no re-render and so no batch. The host stays held indefinitely: every size it measures goes to `heldContentSize` and never reaches the engine. When an unrelated batch finally arrives, `pickStamp` is null, so the held size is dropped and never filed.
- **Impact:** any size change that arrives without a props batch is lost for that mount, for example an in-process configuration change in an app that handles `fontScale`/`density` itself (`onConfigurationChanged` relies on the next measure being reported). The instance stays at a stale or fallback box. The same applies to `nuiTestSelect` on a disabled picker.
- **Fix:** hold only when the pick emits. Have `applyUserSelection` return `Boolean`, and in `choose()` call `holdSizingReports()` only when it returns true. That is safe because no measure can run before the click handler returns, and `nuiTestSelect` applies writes after `choose`. Alternatively, call the hold from inside the emit path, before `displayed` is written.
- **Test:** a JVM case asserting the return value is false on both refusals and true on a real pick. If the host itself cannot be unit-tested, say so in the report.

**N3 (text only): the "RN host container" explanation that the round wrote in is contradicted by its own dumps.**

- **The evidence:** the pre-fix dumps (`/tmp/g6-d3.xml`, `/tmp/g6-pickerscreen.xml`) nest the named `android.view.View` *inside* the `EditText` node. That makes it a Compose virtual node: the RN host `FrameLayout` would be an ancestor, not a child. After the fix, step 8 asserts that exactly **one** node carries `content-desc="Real-input enabled picker"`, and `PickerScreen.tsx:381/388` passes that name as `accessibilityLabel`. If RN had copied it onto the host, there would be two.
- **What to fix:**
  - `scripts/real-input/android.mjs:600-610`
  - `docs/components/picker.md:255-270`, including "the host view still gets RN's `contentDescription`"
  - the report's M3 section, Corrections #3 (`:584`), the "Core ticket (SF2)" follow-up (`:615`) and Question 2.
- **Fix:** say that the second node was the separate Compose semantics node, and that why it reported `enabled=true` was not established. Drop the SF2 core ticket, or re-scope it to "confirm with one Switch dump" without asserting the mechanism.
- **Note:** this wrong mechanism originated in the round-0 review's M3, not with the implementer.

## Non-blocking (one line each)

- **Stale-batch race (both platforms).** Two picks inside one JS round trip, A then B with the batches not merged, give a batch keyed A while native shows B. On Android `pickIsStillShown` is true (it compares with `displayed`), so B's width is filed under A's key; iOS `layoutSubviews` does the same. This is rare. The fix is to stamp the event count and release only once the batch has caught up.
- **iOS exact-equality corner.** A native pick to a cold key whose fallback frame equals the old box exactly gets no `layoutSubviews` re-measure, and nothing else measures, so the mount stays at the fallback. Android files the held size instead. It is very unlikely.
- **Pre-existing:** an uncontrolled `defaultSelectedIndex` changed after mount moves the wrapper's key, but native keeps the seed. Same poison class, not introduced by this round.
- **Android, unlabelled picker:** `contentDescription = title` plus `stateDescription = title` likely makes TalkBack read the title twice. Omit `contentDescription` when there is no label.
- **MountChurn Picker case.** It never checks that the press actually opened the menu; if it misses, the case silently becomes a plain churn. Its red proves a `drop()` omission, which is the realistic popup-leak path.
- **`nuiTestSelect` after drop.** Android `View.post` on a detached host runs on the next attach, possibly of a recycled mount; the iOS `main.async` has the same issue. This is test-only.
- **No jest coverage.** There is no jest case for Picker's `variantKey`/`sizingId` (as `useSizingId.test.tsx` has for Progress) or for the uncontrolled key; jest is still at 188.
- **Orphaned comment.** The "A list that shrank under an open popup…" comment in `afterUpdate` (`HybridNitroUiPicker.kt` ~838) now sits above the release code.
- **Not in the gate.** `PickerModelTest` is still not run by `check`, and the bench was not re-run. Both are stated in the report.

## Are the must-fixes native?

- **N1:** JS only.
- **N2:** Kotlin, in `HybridNitroUiPicker.kt` only. No core change, roughly 3 lines plus a JVM test.
- **N3:** docs, comments and the report.

N2 touches native code, so under D19 the orchestrator decides whether that needs another Opus look. A spot-check of the diff is enough, because no core or shared code changes. Harness runs on both platforms are needed only if the N1 test goes in the harness rather than jest.

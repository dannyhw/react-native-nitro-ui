**Verdict: FIX ROUND** (small, Android-only: one assertion, one mutant run, three text corrections)

Reviewed `55ed239...78a1202`. `gate.mjs need --for review` is satisfied on code tree `43816d4c80ef`. All five required gates are green, and I checked the ledger and every failure excerpt against the report. Shipped-source changes are comments only (`HybridNitroUiMenu.kt`/`.swift`), so no changeset is needed, which is correct. X4 is not on `main`, so item 7 does not apply.

Item by item:
1. **Manifest and regen:** done.
2. **Bench arm:** done. The cells match Picker's, and the report has numbers with their load.
3. **Real-input:** done on both platforms. The iOS a11y red proof is real: ledger run `00-11-18Z` fails at `RealInputTests.swift:2032` with `("Actions") is not equal to ("Real-input menu")`, and the identifier guard stops a reading of the RN wrapper from passing. The iOS `buttonStyle` claim also holds. I looked at `/tmp/g7b-menu-open.png` and it shows plain rows under the trigger.
4. **Android `menuAnchor` upper bound:** the bound is added, but it has no real red run (M2).
5. **Story and smoke:** done.
6. **iOS open/close spike:** done and honestly negative. The excerpt `23-45-03Z` reads `open > select bravo`, and nothing was shipped.

## Must-fix

**M1. The Android D32 order check reads only the last three events, so it would miss a duplicate `open`.**
- Where: `scripts/real-input/android.mjs`, step 4 (`lastEvents(..., 3)`) and the `lastEvents` helper.
- What is wrong: the first real run printed the whole echo as `open > close > open > select bravo > close` (excerpt `23-33-43Z`), and that string is deterministic. Keeping only the tail means `open > open > select bravo > close` also passes.
- Why it matters: that duplicate `open` is the failure step 3's own comment names ("the anchor and `menuAnchor`'s own handling both reporting one gesture"). It is also what a retried `tapUntilUp` would produce. This is the brief's headline D32 assertion, and the check passes on exactly the event it exists to catch.
- Fix: assert the full string `open > close > open > select bravo > close`. Also assert the full echo after the twin pick, so the disabled-row gesture's open/close pairing is pinned too. Delete `lastEvents`. Show it red by doubling `appendEvent('open')` in `MenuScreen`, then re-run `real-input:android` (the test file change counts as both platforms, so `need` will ask for iOS too).

**M2. The `gap < 48` bound has never failed because the popup moved.**
- Where: `example/__tests__/Menu.harness.tsx:1604`.
- What is wrong: its only red run (`23-21-12Z`, `expected 16 to be greater than 400`) inverted the assertion. That shows the value is read live. It does not show the bound catches a misplaced popup, which is AGENTS' "break the thing it guards". All four mutants passed.
- Why it matters: the "300 dp offset" mutant reportedly left the gap unchanged, but the report does not say how the offset was applied. If it was `Modifier.offset` on the list content, the popup window never moved, and the witness reads the window (`MenuWitness` → `getLocationOnScreen`). So it is not established that anything this bound reads can move.
- Fix: run one mutant that moves the window itself. For example, use a plain `DropdownMenu(offset = DpOffset(0.dp, 64.dp))` or the equivalent window offset, confirm `gap < 48` goes red, revert, and keep the failed line in the exported ledger. In the report, say how the 300 dp offset was applied.

**M3. Three claims are not backed by the evidence.**
- `Menu.harness.tsx:1597-1598` says "all three measured a popup at the trigger, and the report records the numbers". The report records no gap numbers for any mutant, and the passing mutant logs (`f025b9e4`, `65eb4741`, `492b0d17`) don't print them either. Record the numbers or drop the clause. The same sentence in the `.kt` comment and in `menu.md` ("the hosted test read the popup at the trigger") rests on those unlogged readings.
- Report § Gates says `harness:android:Menu` "shows five `fail` lines". The ledger has six: one `hosted-removal` failure, four stale-app refusals and the inverted bound. The real-input fail at `23-23-53Z` is not explained anywhere. That is a full `real-input:android` run in which Picker's `cycle 2 … real-input-drop-gone` timed out. Neither is the SIGTERM'd `harness:ios` at `23-46-36Z`. Add one line each.
- The report's file list says "F1's witness pattern on every retry". On iOS, neither `tapUntilOption` nor `tapOptionUntilValue` gets a `nativeState` witness. The guard is the presented rows plus the "row gone, don't re-press" rule. That is the same as Picker and is acceptable, because the full-string iOS echo assertions back it up, but the report should say that rather than claim F1's guard. The Android check states its version honestly.

## Should-fix / follow-ups to record

**S1. Missing follow-up: the Android popup swallows the first dismissal after a disabled-row tap.**
- In run `23-33-43Z`, Back did not close the popup within 8 s.
- In the final run (`00-35-09Z` log), the scrim tap left it up and only the second dismissal worked: "after a scrim tap left it up".
- The check now logs this rather than asserting it, which is fine for scope, but it may be a user-facing bug: the menu stays up after a tap on a disabled row. It belongs in Follow-ups and FOLLOWUPS.md.
- `tapScrim`'s doc comment says it is the dismissal "a menu needs" when that run shows it did not dismiss. Reword it.

**S2. A fixture comment now claims invented data was measured.**
- Where: `scripts/__tests__/smoke-ready-line.test.js:49-52`.
- The comment says `READY_LINE_FRACTIONAL` is "what the two platforms actually printed". It now contains an invented `menu=97.619049072265625x48`, and no smoke run exists in the ledger or the log store.
- Fix: run the smoke once and paste the real token, or say in the comment that the menu token was added by hand. The smoke app's Menu line has never run on a device. The brief does not require it, but the report should not imply it has.

## Nits

- The iOS test writes `/tmp/g7b-menu-open.png` on every `real-input:ios` run. That path is task-named and shared, so concurrent tasks collide on it. Use an `XCTAttachment` (or the gate's log directory) and commit the screenshot under `docs/tasks/G7b/`, since it is the only evidence for the `buttonStyle` decision.
- The iOS tap-away is hardcoded at normalized (0.5, 0.25). Today that lands on the screen's description text, but it will silently land elsewhere if `MenuScreen` changes above the real-input block. Add a comment that ties it to the layout, or aim at the section header element.
- The report says "nothing is bolded", but the full-plan table bolds cells. The summary is 402 words against a 400 limit.
- The `MenuScreen.tsx` comment quotes `select Bravo`, but the echo uses ids (`select bravo`).
- `Menu.stories.tsx` uses inline arrow callbacks (`:447-448`, `:482-484`). This matches `Picker.stories.tsx` and lint passes, so leave it unless stories are meant to follow the perf contract.
- `bench:--help` FAIL: the report explains it adequately. The follow-up to make `gate.mjs bench` refuse `--help` is right.

## What holds up

- Real-input on iOS: the full-string echo assertions (`select bravo`, then `select bravo > select alpha`) back up the immediate post-tap read in step 4. The disabled row has its twin as a barrier on both platforms.
- The step-ordering bug the first iOS run found (`select alpha > select bravo`) was diagnosed correctly and fixed in the test, not hidden by a retry.
- Registry and coverage tests cover the `bench: false` direction for Menu.
- The bench arms are fair (iOS Expo uses `menuStyle(button)`/`borderedProminent` to match), and the module-level `MENU_GROUP`/`menuItems` keep prop identity stable.
- D32 is respected, and the iOS spike was reported and not shipped.

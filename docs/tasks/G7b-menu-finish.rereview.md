**Verdict: MERGE WITH FIXES** (text-only: two stale comments, two report lines, one commit message)

Re-reviewed `ae2ec53..786f2b8`. `gate.mjs need --for review` is satisfied on code tree `7e566bda08a6`. All five device and check gates are green on this tree, and the worktree is clean. The only shipped-source change is a comment in `HybridNitroUiMenu.kt`, so no changeset is needed.

## Review items

- **M1: fixed.** `CHECKS.menu` now compares the whole echo with exact string equality twice, and `lastEvents` is gone.
  - The comparison cannot pass a duplicated or reordered event.
  - It does not depend on a retry. `pressUntil` re-presses only when the window witness never rose, so an undelivered tap adds no event. A late-delivered tap followed by a retry would add events and go red.
  - The expected string holds for both dismissal paths: the scrim closed the popup at 01:49:39Z, and Back closed it at 02:06:14Z. Both produce `open > close`.
  - The red run (`01-49-40Z` excerpt) shows the doubled `open` on all three lines. `noteRealOpen` is single again, so the mutation was reverted.
  - The green 02:06:14Z log prints the full 10-event string with "no retries".
- **M2: fixed.** The excerpt `01-48-49Z` reads `expected 168 to be less than 48` at the `gap` line. The 16 px to 168 px change matches 64 dp at density 2.625. `HybridNitroUiMenu.kt` uses `ExposedDropdownMenu` and has no `DpOffset`, so the mutant was reverted.
- **M3: fixed.** The tally (six plus two) is corrected. The 23:23:53Z run and the SIGTERM'd run are both explained, and the excerpt confirms the `no "undefined" tab` line and the Picker cycle-2 line. The iOS guard wording is honest. The "report records the numbers" clause is gone.
- **S1: fixed.** The FOLLOWUPS entry is added and the `tapScrim` doc comment is reworded.
- **S2: fixed.** The fixture comment now says the `menu=` token was written by hand.
- **Nits: fixed.**
  - The screenshot is an `XCTAttachment` plus a file in the sandbox temp directory.
  - The PNG shows only the app and the status bar. Its XMP carries only "Screenshot", with no path.
  - The tap-away point is tied to the layout.
  - `select bravo` is lower-case.
  - The summary is 398 words.
- **D25:** the new files and comments contain no home paths, hostnames or emails. `maintainer-mac-*` labels already appear in FOLLOWUPS. The failure excerpts show only this lease's own device.

## Should-fix

**S1. The report describes the twin assertion wrongly.**
- Where: `docs/tasks/G7b-menu-finish.report.md:374`.
- The report says the twin assertion is `open > close > open > select alpha > close`. The code asserts the whole 10-event history: `open > close > open > select bravo > close > open > close > open > select alpha > close`.
- Fix: quote the real string.

**S2. One red proof line was run against an expected string that was later changed.**
- Where: the report's red-proofs entry for M1 (`report.md:94-99`).
- The third `✗` in the 01:49:39Z run expected an **8-event** string, `… > close > open > select alpha > close`, which leaves out the disabled-row `open > close`. That string would have failed even without the mutation. The final 10-event string was never run against the mutant.
- This is not a gap in coverage. The de-doubled mutant echo equals the final string, and the green run at 02:06:14Z reads it exactly. But the report counts it as "three ✗ lines" without saying this.
- Fix: add one clause saying the whole-echo expectation was corrected after the mutant run, and that the final string is proven by the green 02:06:14Z run plus the de-doubled mutant echo.

**S3. A pre-round commit message contains a machine path (D25).**
- Commit `93d2991`'s body is `MSG; tail -c 150 /var/folders/x4/<hash>/T/opencode/g7b/bench-ios-full.log`. A `merge:` commit would carry it into `main`. The first review missed it.
- Fix: reword the commit before merge (nothing has been pushed yet), or squash the branch.

## Nits

- **Duplicated comment block.** In `scripts/real-input/android.mjs:1053-1058`, a stale first paragraph sits in front of its replacement at `:1059-1066`. The stale one is also wrong: the tap on "Locked row" did not open a window, and the suite performs five gestures, not four. Delete `:1053-1058`.
- **Unsupported "measured" claim.** `android.mjs:1065` says the shape was "measured, both halves at 30 Oct 00:35:09Z". That run printed only the old three-event tail (`saw open > select bravo > close`) and no second-half echo. Cite 02:06:14Z instead.
- **Fallback the code does not have.** `android.mjs:989-992` says the order is "scrim, then Back, then re-aiming at the trigger". The code has no re-aim fallback. If both dismissals fail, the next `tapUntilUp` presses the trigger's coordinates under a standing popup. That produces a red result, not a false pass, but the comment should describe what the code actually does.
- **FOLLOWUPS overstates the S1 follow-up.** `docs/tasks/FOLLOWUPS.md:65` says the menu "will not dismiss", but Back or the scrim always got it down in the end. The final green run at 02:06:14Z also had the scrim leave it up and could be cited. Reword to "needs a second dismissal".

## Merge note

Every fix above is text. However, `android.mjs` counts as both platforms, so a comment edit there makes both platforms' harness runs stale. Apply the android.mjs nits at merge, when the full harness and real-input runs happen anyway. The report fixes (S1, S2) are docs-only and invalidate nothing. S3 needs a reword of history, which does not change any tree.

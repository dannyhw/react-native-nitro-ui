MERGE WITH FIXES

# FIX5 review (tip b1d9df8a, base 589733b6)

No must-fix finding. The test and doc are sound; the fixes below are small doc, comment and
report edits that need no device run.

Verified:
- `git diff 589733b6..HEAD -- android ios src cpp` is empty, so cc458e4d is fully backed out.
- `MenuRows.kt:301` passes `enabled = groupEnabled && !item.disabled` to Material's own row.
  The e2e reader maps `enabled=false` to `states.disabled`
  (`@e2e-dev/mobile/dist/nodes.js:521`), and `isDisabled` reads that state. So the
  Locked-row assertion can fail, and red proof 1 matches this path.
- `onDismissRequest` -> `setOpen(false)` (`HybridNitroUiMenu.kt:534`). `setOpen` drops a
  repeated close, so the echo strings at `menu.e2e.ts:103,136,171` match what
  `MenuScreen.tsx` writes (`appendEvent` joins with " > ", `'select ' + id`). Red proofs 2
  and 3 fit: the first open in test 1 closes through `applyPick`, not `onDismissRequest`,
  so only the Back after the disabled tap is swallowed.
- The outside tap: the page has 16 dp padding (`MenuScreen.tsx:397`), the trigger is the
  first item of its row, and the popup uses `Below` positioning. So `box.x - 12px` at the
  trigger's middle lies outside the popup window on any width. Material's popup is
  focusable (touch-modal), so a tap outside it reaches the popup as an outside touch, not
  the page. The `open > close` echo would also catch a stray trigger press.
- Dropping the three-Back loop tightens the test. The old loop also passed when the
  disabled tap closed the popup by itself (its first round waited with no Back). The new
  test fails that case at `:122-126`.
- The backout reason holds. `closeQuietly` in cc458e4d switched to `userEvent.pressAt`,
  and the stale `harness:android:Menu` run on that tree had 5 failures.
- The gate table in the report matches `node scripts/gate.mjs table` now.
- No task ids or history in the comments. No AI mentions in the commits.

## Must fix

None.

## Nice to have

N1. `docs/tasks/FIX5.report.md:13` says the defect did not reproduce, but not how often it
    was tried. The brief asks for that count ("report how often the defect was tried").
    Only one green `--control menu` run is in the table. Add the number of attempts (Back
    and outside tap) and the device/API level.

N2. Red proofs cover 3 of the new assertions. Not shown red: "the tap on the disabled row
    took the popup down by itself" (`menu.e2e.ts:123-126`, `:159-162`), the enabled-row
    check (`:110-113`) and the echo strings. The brief's Proof asks for each one. The
    popup-stays-up check is the one that guards Behaviour 1. A mutation such as making
    `MenuRow` call `onPick` for a disabled row would show it red cheaply at the next
    device run.

N3. `menu.e2e.ts:110-113`: `isEnabled()` is `states.disabled !== true`
    (`e2e/dist/locator/screen.js:400`). It is true for any node without a disabled state,
    including the wrong node, so this check only catches "every row disabled". This is
    fine as a pairing check, but it does not prove `rowOf` found Alpha's own node.

N4. `docs/components/menu.md:96` lists "the back gesture" as a way to dismiss, in a line
    that is not marked Android. An iOS menu has no back gesture. Write "on Android the
    back gesture" (the existing line 141 has the same wording).

N5. `docs/components/menu.md:357`: "`menu.e2e.ts` reads one row of each from the tree of an
    open menu" is test-infrastructure detail an app developer does not need. Other
    component docs do cite harness files, so drop it or shorten it to "tested on Android".

N6. `docs/components/menu.md:142`: "A press on a `disabled` row closes nothing" does not
    hold for the Android test hook. `nuiTestSelectRow` -> `applyPick` still closes the
    popup for a disabled row (`HybridNitroUiMenu.kt:365-381`), and that hook is on the
    exported spec (`src/components/Menu/Menu.nitro.ts:83`). The report already lists this
    as a follow-up. The doc should either say "a tap" or note the hook's difference.

N7. `menu.e2e.ts:119`: "swallows its own press, and the menu with it" reads as if the menu
    closes, which is the opposite of what the next lines assert. Use "and the menu stays
    up". Also, the `besideThePopup` doc comment (`:32-38`) is 6 lines, against the 1 to 3
    line rule in AGENTS.md.

N8. `docs/tasks/FIX5.report.md:18`: "one that is doubled ... read red" overstates it.
    `setOpen` already drops a second close, so the echo cannot show a doubled dismissal.
    What the echo does catch is a reopen or a pick.

Commands run in this review:
- `node scripts/gate.mjs check`: PASS, 17 passed, 0 failed (118.6 s).
- `node scripts/gate.mjs need --for review`: "review is satisfied on this code tree" (check
  green; no harness run asked for).

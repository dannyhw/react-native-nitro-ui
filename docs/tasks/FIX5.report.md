# FIX5 — An Android Menu closes on the first dismissal after a tap on a disabled row

**Branch:** `task/FIX5-menu-disabled-row` (from `main` at `589733b6`) · **Round:** 1 of up to 3 ·
**Lease:** `FIX5-swtdg` (`emulator-5570` / Metro `9293`)

## Summary

Two `FOLLOWUPS.md` lines about the Android `Menu` and a disabled row, both measured on
material3 1.4 and re-measured here on 1.5.0-beta02 with Compose 1.12.1. Neither is a library
defect on 1.5, so what shipped is the two tests that say so, and the docs line that was wrong.

**The dismissal.** One Back after a tap on a disabled row brings the popup down, and in a
separate open one tap outside does the same, with `onClose` reported once. The defect did not
reproduce. What was hiding it was the test: `menu.e2e.ts` pressed Back up to three times after
that tap and asked only that the popup eventually fell, so a control that owed two dismissals
passed. The retry loop is gone. Each case now asks for one dismissal, counts the popup windows
the app has, and reads the control's whole `open > select > close` echo, so a dismissal that is
swallowed and one that is doubled both read red.

**The announcement.** `docs/components/menu.md` said every Android menu row reports
`enabled="true"`, a disabled one included. It does not: `MenuRow` hands Material
`enabled = groupEnabled && !item.disabled`, Material's own row publishes that as its disabled
state, and the row is read back `disabled` from the tree of an open menu. No library change was
needed, and none was made — the row keeps Material's own element, as the brief decided. The
check reads the row, not the words inside it: `getByText` resolves to the `Text` Material draws
within the row's node, and that node carries no state, which is why the first version of this
assertion read red over nothing.

**One change backed out.** `MenuModel.applyPick` reported nothing for a disabled row, an unknown
id or a disabled control, and closed the popup for all three. A real press on such a row closes
nothing, so the hook and a finger gave an app two answers for one row. Making the hook answer
nothing leaves `Menu.harness.tsx` with no way to close a popup at all: `userEvent.pressAt` is
delivered into the app's own window and never into the popup's, so the pick path was the only
close in the file — five Menu tests then waited on a popup that never came down. `1f29ddb4`
backs that out; the hook needs a dismiss path of its own, which is a follow-up.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2098 tests / 93 suites | `f71e9313da19` | 1 m 59 s | start 20.5 / med 20.5 / max 23.7 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:android:Menu` | stale | 5 failed of 59 tests / 2 suites | 48da6e795e8a (not this tree) | 2 m 38 s | start 26.7 / med 12.2 / max 26.7 |
| `real-input:android:--control:menu` | **PASS** | — | `f71e9313da19` (real-input:android digest) | 10 m 55 s | start 11.6 / med 14.0 / max 31.4 |

`need --for review`: `check` green, and review asks for no harness run because the diff moves only `real-input:android`: `need: review is satisfied on this code tree.`

## Red proofs

- `menu.e2e.ts` "the disabled row of an open menu does not report itself disabled" ->
  `MenuRows.kt` `val enabled = groupEnabled && !item.disabled` -> `val enabled = groupEnabled`
  -> `ASSERTION_FAILED: the disabled row of an open menu does not report itself disabled: a
  person is offered a row that will not answer: expected false to be true`.
- `menu.e2e.ts` "the popup stood through the Back that followed a disabled-row tap" ->
  `HybridNitroUiMenu.kt` `onDismissRequest` made to swallow the first dismissal of every open
  (`if (!model.oweOneDismissal()) model.setOpen(false)`) -> `ASSERTION_FAILED: expect.poll(…)
  timed out after 8000 ms / the popup stood through the Back that followed a disabled-row tap /
  last: expected 1 to be 0`.
- `menu.e2e.ts` "the popup stood through the tap outside that followed a disabled-row tap" ->
  the same mutation -> `ASSERTION_FAILED: expect.poll(…) timed out after 8000 ms / the popup
  stood through the tap outside that followed a disabled-row tap / last: expected 1 to be 0`.

## Files changed

- `example/e2e/real-input/menu.e2e.ts`: one Back and one outside tap after a tap on a disabled
  row, the row's own enabled state read off its node, and the three-Back retry loop gone.
- `docs/components/menu.md`: what a press on a `disabled` row does, and how the row is
  announced; the `enabled="true"` claim is gone.
- No library, harness or spec change: `1f29ddb4` backs out the pick-path change it tried first.

## Follow-ups

- menu: `MenuModel.applyPick` answers nothing for a row that cannot be picked and still closes
  the popup, so the test hook and a real press give an app two answers for one row; a fix needs
  a dismiss hook, because no harness press reaches the popup's window.
- context-menu: `ContextMenuModel.applyPick` has the same shape; its row code is the shared
  `MenuRow`, untouched here, so nothing moved for its rows.
- picker, button-group overflow and the split trigger draw their rows through that same
  `MenuRow`, so nothing moved for them either.
- a11y: what TalkBack says out loud about a row the tree marks disabled is still untested; the
  docs now say that plainly.

# G8 — Android visual fixes from the README screenshots

**Branch:** `task/G8-android-visual-fixes` (from `main` at `3f28384`) · **Rounds:** 2 of up to 2 (D19) ·
**Leases:** `G8-ty8hr` (`emulator-5574`, round 0), `G8-6ih23` (`emulator-5570`, round 1)

## Summary

Both README defects were the Android platform's own sizing rules, applied where the code assumed otherwise.

**Menu.** `ExposedDropdownMenu` defaults `matchAnchorWidth = true`, and the modifier that flag drives sets `minWidth = maxWidth = anchorWidth`. Every row was measured against the button's box, so a label longer than the title lost its tail — "AirDrop" rendered as "AirDr". The call site's comment claimed `exposedDropdownSize()` was not in use; it is, inside Material, so the claim held and the bug stayed. The call now passes `false`, leaving the list at Material's content sizing: nothing under the 112 dp floor or over the 280 dp a row's content caps at, aligned with the trigger's start edge so it still opens under it.

**DatePicker.** Material lays the calendar's seven weekday columns out with `Arrangement.SpaceEvenly` and sizes each to `LocalMinimumInteractiveComponentSize` — 48 dp by default — so the grid wants 7 × 48 + 2 × 12 = 360 dp. An `inline` picker is `fillWidth`, so Compose is asked what it wants *at* the box's width and `Modifier.size` enforces that maximum: the columns on the right lost width instead of the box growing. Measured in the story's 320 dp box: header columns `126 ×6, 20` — Saturday at 7.6 dp — over day rows of `126 ×6, 73`, so the last column's cell (27.8 dp) was narrower than the 40 dp disc it draws. The inline calendar now provides **40 dp**, the token the disc is drawn at, but only in a box narrower than the 360 dp where 48 dp stops fitting (fix round 1; round 0 provided it everywhere), so the grid needs 304 dp and 320 fits with every column equal. What 40 dp costs is stated in the changeset and the component docs; `date-picker-ios.png` puts iOS's columns on a 42.8 pt pitch in its 320 pt box, so the platforms agree there. Below 304 dp it is still clipped; `compact` is untouched — its dialog is a window of its own.

**Where the guard could not live.** A harness test cannot see the calendar: `measureContent()` returned the box width at 240, 320 and 361 dp alike, and the cells are Compose nodes, not `View`s. So the rule reads a `uiautomator` dump of the weekday header row — `scripts/real-input/android-calendar.mjs`, applied by `CHECKS['date-picker']` on Android-only fixtures, unit-tested against real dumps. The Menu's popup window the witness already reports, so that is guarded in `Menu.harness.tsx`.

Both screenshots re-taken from the same stories, device and appearance, cropped to the story content at the same 720 px width and size.

## Gates

Round 0 measured `check` at `8342fd0bb41b` and both device gates at `0b1dbaf71795`; every run
of every round is in the exported ledger (`docs/tasks/G8/gates.jsonl`). The generated table
for the code this branch now carries is the one at the end of `## Fix round 2`, so each gate
is stated once with the ledger's own numbers. `harness:ios` and `real-input:ios` ran on
maintainer-mac-1 against `8c4d2fd`; fix round 2's diff is Android-only plus check-only tests
and docs, so that half of the tree is byte-identical and those runs still speak for this tip
(that is `trees.ios` in the ledger, not a claim about how the runs went).

## Red proofs

Recorded as data in `docs/tasks/G8-android-visual-fixes/mutations.json`, which carries both
rounds. The line numbers below are round 0's, against the test file as it then was; round 1
rewrote that file, so they do not resolve in it any more — the assertions themselves still do.

- `Menu.harness.tsx · gives the list the width its items need, not the trigger's` -> shipped code, before the fix -> `expect(popupWidth).toBeGreaterThan(triggerWidth)` — popup 216 px, trigger 216 px, on a "Move" trigger beside a "Move into a folder" row.
- `Menu.harness.tsx · keeps Material's 112 dp floor on a list of short items` -> shipped code, before the fix -> a two-row list of "Up"/"Down" measured 65.5 dp against the 112 dp floor.
- `real-input:android · the 320 dp inline calendar lays out a whole week` -> `LocalMinimumInteractiveComponentSize provides 40.dp` reverted to Material's 48 dp default, same gate -> `✗ … 7 columns of 126px, 126px, 126px, 126px, 126px, 126px, 20px … the narrowest column is 7.6 dp …; columns differ by 106 px`. Green on the shipped tree at `105px ×7 … narrowest 40.0 dp`.
- `real-input-calendar.test.js · refuses a grid that lost its last column` -> `if (grid.columns.length < DAYS_IN_WEEK)` -> `if (false)` -> `toEqual` at `scripts/__tests__/real-input-calendar.test.js:178`, the six-column dump reports no problems.
- `real-input-calendar.test.js · names the clipped calendar the dump showed before the fix` -> `DAY_CELL_MIN_DP = 40` -> `= 5` -> `toEqual` at `scripts/__tests__/real-input-calendar.test.js:165`, the 7.6 dp complaint disappears. Same line goes red for the same assertion when the floor check itself is replaced with `if (false)`.
- `real-input-calendar.test.js · catches a squeeze that never reaches the 40 dp floor` -> `COLUMN_ROUNDING_PX = 2` -> `= 200` -> `toEqual` at `scripts/__tests__/real-input-calendar.test.js:193`, the 8 px spread is no longer reported.
- `real-input-calendar.test.js · calls a clipped header missing rather than measuring a week of day cells` -> `if (node.clickable === 'true') { continue }` -> `if (false)` -> the day row is returned as the grid (`columns[0].x1 === 22`, height 123) instead of `null`. This one needed the extra test: the fixture's original two day cells let the mutant fall back to the header and stay green.
- `real-input-calendar.test.js · refuses a grid that lost its last column` -> `MIN_COLUMNS_TO_BE_A_WEEK = 5` -> `= 7` -> `Received: null`, i.e. a clipped calendar is reported as "no calendar here" rather than as broken.

## Files changed

- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiMenu.kt` — `matchAnchorWidth = false`; the stale comment about `exposedDropdownSize()` corrected; `MENU_CONTENT_MAX_DP` moved above `MenuHost`'s doc so the class has its doc back (round 2).
- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiDatePicker.kt` — `LocalMinimumInteractiveComponentSize` of 40 dp around the inline calendar, provided only below `CALENDAR_WIDE_MIN_DP` (round 1); the comments around that wrapper corrected, and its two wrong measurements replaced with the dumps' own numbers (round 2).
- `example/__tests__/Menu.harness.tsx` — the popup-width, floor and header-cap tests.
- `example/src/DatePickerScreen.tsx` — the Android-only "Wide inline calendar" and 320 dp "Narrow inline calendar" fixtures.
- `scripts/real-input/android-calendar.mjs`, `scripts/__tests__/real-input-calendar.test.js` — the grid rule, its width-dependent floor, and its 13 tests; the day-cell fixture carries the dump's real widths and names its cells on purpose (round 2).
- `scripts/real-input/android.mjs` — `density()`, `checkInlineCalendarGrids()` in `CHECKS['date-picker']`.
- `docs/components/date-picker.md`, `docs/components/menu.md` — the Android width behaviour, stated as behaviour; the height measured not to depend on width (round 2).
- `docs/images/components/date-picker-android.png`, `menu-android.png` — re-taken; `.changeset/g8-*.md` — two patch entries, the DatePicker one corrected to "a calendar 360 dp or wider is unchanged" (round 2).
- `docs/tasks/FOLLOWUPS.md` — the two closed lines replaced by one pointing here; the iOS Menu line left open; three lines added across rounds 1 and 2.

## Follow-ups

- date-picker: below 304 dp the inline calendar is clipped rather than scaled; only the 320 dp case is guarded, since nothing smaller is a usable touch target to benchmark. Round 1 re-measured that box (`105 ×5, 41`, no seventh column).
- real-input: the two calendar fixtures are mid-page, not the page's last row — the reason is documented at the call site — and one downward scroll pass now collects both.
- The two wording/number fixes that could not go in this round are in `docs/tasks/FOLLOWUPS.md` with their reasons: `Menu.harness.tsx` says "either platform" where it means iOS (that file is frozen while the iOS gates run), and the calendar module's day-cell table describes widths that dump does not contain (that file maps to both platforms).
- tooling: recorded properly in `docs/tasks/FOLLOWUPS.md` — `check` cannot run in a shell with a sourced lease env (25 failures across `gate.test.js`, `gate-check.test.js` and `gate-logs.test.js`); the workaround is to unset the lease env for `check` and source it for device gates.

## Fix round 1

Round 2 of 2 · lease `G8-6ih23` (`emulator-5570`) · merged `origin/main` (`5c4b39d`, G9), both suites kept.

**The 40 dp cut is width-conditional.** `BoxWithConstraints` — no modifier, so the host still measures the calendar, not the box — provides 40 dp only under `CALENDAR_WIDE_MIN_DP` = 360 dp; above it, the inherited 48 dp. One provider, not `if`/`else`, so crossing the threshold mid-measure cannot rebuild a mounted calendar. The month buttons and year toggle read the same local and shrink too; the changeset and `date-picker.md` say so, placing 40 dp above WCAG 2.2 AA's 24 px, below Material's 48 dp. `real-input` measures a 411 dp calendar at 48 dp and a 320 dp one at 40 dp, each asserting its own premise. `MenuHeader` is capped and the wide popup must beat the floor list.

Red (`mutations.json`): `narrow = true` -> the 411 dp row refuses 40 dp targets, 320 dp green; `expectedColumnDp` always-40 or `= 400`; tolerance `0`; `width(112.dp)`; no header `widthIn`. A start-edge assertion was **removed** — `offset(x = 12.dp)` left the window's rect unchanged, 19 green; kept as a negative control.

This round's own gates are the generated table at the end of `## Fix round 2`; it measured
`check` and both Android device gates at `d3be8bf7c71b` after the round's last commit.

## Fix round 2

Round 3 of 3 · lease `G8-clgez` (`emulator-5574`) · **no shared TS touched** (two Kotlin files, one check-only test, docs), so `trees.ios` is unchanged and mac-1's iOS runs still speak for this tip.

**Item 1: the height does not move with the width.** In-app `measureContent()` puts an `inline` and a `wheel` calendar at **512.00 dp tall, both at 320 dp and at 411.43 dp wide** — `date` and `datetime`, and a four-row month (Feb 2026) beside a six-row one (May 2026). Twelve reads, one number, so the key stays `${variant}|${mode}`: sizing.md §5 wants the width in the key only where height follows it. The `uiautomator` boxes (198.86 vs 246.10 dp) are viewport clipping, not the control; `date-picker.md` carries the numbers.

Also: the wrapper's cost is a recomposition of its own lambda, not a measure of the calendar, and its no-modifier reason is not that `fillMaxWidth()` throws (a no-op unbounded); `MENU_CONTENT_MAX_DP` back above `MenuHost`'s doc; the changeset's 360 dp. Two more invented measurements surfaced there — fixed where reachable, one left as a FOLLOWUPS line because that file is both-platform.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1603 tests / 60 suites | `d3be8bf7c71b` | 2 m 34 s | start 2.4 / med 4.1 / max 4.6 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | **PASS** | 284 tests / 16 suites | `d3be8bf7c71b` (android tree) | 8 m 10 s | start 2.9 / med 2.4 / max 3.0 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | **PASS** | — | `d3be8bf7c71b` (android tree) | 21 m 49 s | start 3.9 / med 2.4 / max 3.9 |
| `harness:android:Menu` | stale | 19 tests / 1 suites | 5a87eea76d84 (not this tree) | 20.2 s | start 2.4 / med 2.3 / max 2.4 |
| `harness:android:Menu:--background` | stale | — | 3ec81511c2fa (not this tree) | 0.5 s | start 2.9 / med 2.9 / max 2.9 |
| `real-input:android:--control:date-picker` | stale | — | fa50a01394c8 (not this tree) | 8 m 15 s | start 2.8 / med 2.0 / max 2.9 |
| `real-input:android:date-picker:--control:date-picker` | stale | — | ffbfe429f7ce (not this tree) | 0.2 s | start 2.8 / med 2.8 / max 2.8 |

`need`: `1 gate(s) missing: harness:ios`. `stale` rows are rounds 1–2's filtered runs and one gate name I mis-typed (a usage error, not a measurement).

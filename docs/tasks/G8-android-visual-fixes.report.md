# G8 — Android visual fixes from the README screenshots

**Branch:** `task/G8-android-visual-fixes` (from `main` at `3f28384`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `G8-ty8hr` (`emulator-5574` / Metro `8295`)

## Summary

Both README defects were the Android platform's own sizing rules, applied where the code assumed otherwise.

**Menu.** `ExposedDropdownMenu` defaults `matchAnchorWidth = true`, and the modifier that flag drives sets `minWidth = maxWidth = anchorWidth`. Every row was measured against the button's box, so a label longer than the title lost its tail — "AirDrop" rendered as "AirDr". The comment at the call site claimed `exposedDropdownSize()` was not in use; it is, inside Material, so the claim held and the bug stayed. The call now passes `matchAnchorWidth = false`, leaving the list at Material's content sizing: nothing under the 112 dp floor, nothing over the 280 dp a row's content caps at, left edge unchanged so it still opens under its trigger.

**DatePicker.** Material lays the calendar's seven weekday columns out with `Arrangement.SpaceEvenly` and sizes each to `LocalMinimumInteractiveComponentSize` — 48 dp by default — so the grid wants 7 × 48 + 2 × 12 = 360 dp. An `inline` picker is `fillWidth`, so Compose is asked what it wants *at* the box's width and `Modifier.size` enforces that maximum: the columns on the right lost width instead of the box growing. Measured in the story's 320 dp box: header columns `126 ×6, 20` — Saturday at 7.6 dp, each day's 40 dp disc wider than the cell holding it. The inline calendar now provides **40 dp**, the token the disc is drawn at, so the grid needs 304 dp and 320 fits with every column equal. A squeezed cell was neither 48 nor 40 dp, so nothing was conceded; `date-picker-ios.png` puts iOS's columns on a 42.8 pt pitch in its 320 pt box, so the platforms now agree. Below 304 dp it is still clipped and `docs/components/date-picker.md` says so; `compact` is untouched, its dialog being a window of its own.

**Where the guard could not live.** A harness test cannot see the calendar: `measureContent()` returned the box width at 240, 320 and 361 dp alike, and the cells are Compose nodes, not `View`s. So the rule reads a `uiautomator` dump of the weekday header row — `scripts/real-input/android-calendar.mjs`, applied by `CHECKS['date-picker']` on a new Android-only 320 dp fixture, unit-tested against both real dumps. The Menu popup's window the witness already reports, so that is guarded in `Menu.harness.tsx`.

Both screenshots re-taken from the same stories, device and appearance, cropped to the story content at the same 720 px width and size.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1599 tests / 60 suites | `8342fd0bb41b` | 2 m 33 s | start 1.8 / med 4.1 / max 5.5 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | **PASS** | 282 tests / 16 suites | `0b1dbaf71795` (android tree) | 8 m 11 s | start 2.9 / med 2.0 / max 3.0 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | **PASS** | — | `0b1dbaf71795` (android tree) | 21 m 36 s | start 2.3 / med 2.2 / max 4.0 |

`need --for review`: `need: 1 gate(s) missing for review: harness:ios`. The two iOS gates are the host's known gap (FOLLOWUPS: this machine's simulators cannot launch apps); the diff is Android-only plus tooling and tests, and the brief leaves those two to CI.

## Red proofs

Recorded as data in `docs/tasks/G8-android-visual-fixes/mutations.json`.

- `Menu.harness.tsx · gives the list the width its items need, not the trigger's` -> shipped code, before the fix -> `expect(popupWidth).toBeGreaterThan(triggerWidth)` — popup 216 px, trigger 216 px, on a "Move" trigger beside a "Move into a folder" row.
- `Menu.harness.tsx · keeps Material's 112 dp floor on a list of short items` -> shipped code, before the fix -> a two-row list of "Up"/"Down" measured 65.5 dp against the 112 dp floor.
- `real-input:android · the 320 dp inline calendar lays out a whole week` -> `LocalMinimumInteractiveComponentSize provides 40.dp` reverted to Material's 48 dp default, same gate -> `✗ … 7 columns of 126px, 126px, 126px, 126px, 126px, 126px, 20px … the narrowest column is 7.6 dp …; columns differ by 106 px`. Green on the shipped tree at `105px ×7 … narrowest 40.0 dp`.
- `real-input-calendar.test.js · refuses a grid that lost its last column` -> `if (grid.columns.length < DAYS_IN_WEEK)` -> `if (false)` -> `toEqual` at `scripts/__tests__/real-input-calendar.test.js:178`, the six-column dump reports no problems.
- `real-input-calendar.test.js · names the clipped calendar the dump showed before the fix` -> `DAY_CELL_MIN_DP = 40` -> `= 5` -> `toEqual` at `scripts/__tests__/real-input-calendar.test.js:165`, the 7.6 dp complaint disappears. Same line goes red for the same assertion when the floor check itself is replaced with `if (false)`.
- `real-input-calendar.test.js · catches a squeeze that never reaches the 40 dp floor` -> `COLUMN_ROUNDING_PX = 2` -> `= 200` -> `toEqual` at `scripts/__tests__/real-input-calendar.test.js:193`, the 8 px spread is no longer reported.
- `real-input-calendar.test.js · calls a clipped header missing rather than measuring a week of day cells` -> `if (node.clickable === 'true') { continue }` -> `if (false)` -> the day row is returned as the grid (`columns[0].x1 === 22`, height 123) instead of `null`. This one needed the extra test: the fixture's original two day cells let the mutant fall back to the header and stay green.
- `real-input-calendar.test.js · refuses a grid that lost its last column` -> `MIN_COLUMNS_TO_BE_A_WEEK = 5` -> `= 7` -> `Received: null`, i.e. a clipped calendar is reported as "no calendar here" rather than as broken.

## Files changed

- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiMenu.kt` — `matchAnchorWidth = false`; the stale comment about `exposedDropdownSize()` corrected.
- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiDatePicker.kt` — 40 dp `LocalMinimumInteractiveComponentSize` around the inline calendar only.
- `example/__tests__/Menu.harness.tsx` — the two popup-width tests.
- `example/src/DatePickerScreen.tsx` — the Android-only 320 dp "Narrow inline calendar" fixture.
- `scripts/real-input/android-calendar.mjs`, `scripts/__tests__/real-input-calendar.test.js` — the grid rule and its 9 tests.
- `scripts/real-input/android.mjs` — `density()`, `checkNarrowCalendarGrid()` in `CHECKS['date-picker']`.
- `docs/components/date-picker.md`, `docs/components/menu.md` — the Android width behaviour, stated as behaviour.
- `docs/images/components/date-picker-android.png`, `menu-android.png` — re-taken; `.changeset/g8-*.md` — two patch entries.
- `docs/tasks/FOLLOWUPS.md` — the two closed lines replaced by one pointing here; the iOS Menu line left open.

## Follow-ups

- date-picker: below 304 dp the inline calendar is clipped rather than scaled; only the 320 dp case is guarded, since nothing smaller is a usable touch target to benchmark. (Round 1 re-measured that box: see the table in the module's header and `## Fix round 1`.)
- real-input: the two calendar fixtures are mid-page, not the page's last row — the reason is documented at the call site — and one downward scroll pass now collects both.
- tooling: recorded properly in `docs/tasks/FOLLOWUPS.md` — `check` cannot run in a shell with a sourced lease env (25 failures across `gate.test.js`, `gate-check.test.js` and `gate-logs.test.js`); the workaround is to unset the lease env for `check` and source it for device gates.
## Fix round 1

Round 2 of 2 · lease `G8-6ih23` (`emulator-5570`) · merged `origin/main` (`5c4b39d`, G9), both suites kept.

**The 40 dp cut is width-conditional.** `BoxWithConstraints` — no modifier, so the host still measures the calendar, not the box — provides 40 dp only under `CALENDAR_WIDE_MIN_DP` = 360 dp; above it, the inherited 48 dp. One provider, not `if`/`else`, so crossing the threshold mid-measure cannot rebuild a mounted calendar. The month buttons and year toggle read the same local and shrink too; the changeset and `date-picker.md` now say so, placing 40 dp above WCAG 2.2 AA's 24 px, below Material's 48 dp. `real-input` measures a 411 dp calendar at 48 dp and the 320 dp one at 40 dp, each asserting its own width premise.

Red (`mutations.json`): `narrow = true` -> the 411 dp row refuses 40 dp targets, 320 dp green; `expectedColumnDp` always-40 or `= 400`; tolerance `0`; `width(112.dp)` on the popup; no header `widthIn`. `MenuHeader` is capped and the wide popup must beat the floor list. One start-edge assertion was **removed, not shipped**: `offset(x = 12.dp)` left the window's rect unchanged, 19 green — kept as a negative control.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1603 tests / 60 suites | `aecd47415e31` | 2 m 33 s | start 2.1 / med 4.2 / max 6.5 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | **PASS** | 284 tests / 16 suites | `aecd47415e31` (android tree) | 8 m 11 s | start 2.7 / med 2.1 / max 2.9 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | **PASS** | — | `aecd47415e31` (android tree) | 21 m 46 s | start 3.0 / med 2.2 / max 3.7 |

`need --for review`: `1 gate(s) missing: harness:ios`.

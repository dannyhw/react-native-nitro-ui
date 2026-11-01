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

Round 0's own runs are in the ledger (`docs/tasks/G8/gates.jsonl`); the table at the end of
`## Fix round 1

Round 2 of 2 · lease `G8-6ih23` (`emulator-5570`) · merged `origin/main` (`5c4b39d`, G9), both suites kept.

**The 40 dp cut is width-conditional.** `BoxWithConstraints` — no modifier, so the host still measures the calendar, not the box — provides 40 dp only under `CALENDAR_WIDE_MIN_DP` = 360 dp; above it, the inherited 48 dp. One provider, not `if`/`else`, so crossing the threshold mid-measure cannot rebuild a mounted calendar. The month buttons and year toggle read the same local and shrink too; the changeset and `date-picker.md` say so, placing 40 dp above WCAG 2.2 AA's 24 px, below Material's 48 dp. `real-input` measures a 411 dp calendar at 48 dp and a 320 dp one at 40 dp, each asserting its own width premise.

Red (`mutations.json`): `narrow = true` -> the 411 dp row refuses 40 dp targets, 320 dp green; `expectedColumnDp` always-40 or `= 400`; tolerance `0`; `width(112.dp)`; no header `widthIn`. Also: `MenuHeader` capped, the wide popup must beat the floor list. A start-edge assertion was **removed, not shipped** — `offset(x = 12.dp)` left the window's rect unchanged, 19 green; kept as a negative control.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1603 tests / 60 suites | `aecd47415e31` | 2 m 33 s | start 2.1 / med 4.2 / max 6.5 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | **PASS** | 284 tests / 16 suites | `aecd47415e31` (android tree) | 8 m 11 s | start 2.7 / med 2.1 / max 2.9 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | **PASS** | — | `aecd47415e31` (android tree) | 21 m 46 s | start 3.0 / med 2.2 / max 3.7 |
| `harness:android:Menu` | stale | 19 tests / 1 suites | 5a87eea76d84 (not this tree) | 20.2 s | start 2.4 / med 2.3 / max 2.4 |
| `harness:android:Menu:--background` | stale | — | 3ec81511c2fa (not this tree) | 0.5 s | start 2.9 / med 2.9 / max 2.9 |
| `real-input:android:--control:date-picker` | stale | — | fa50a01394c8 (not this tree) | 8 m 15 s | start 2.8 / med 2.0 / max 2.9 |

The `stale` rows are this round's filtered proof and measurement runs, each on a tree a
later commit replaced. `need --for review`: `1 gate(s) missing: harness:ios`.

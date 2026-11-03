# D4 — Every component in the README, with screenshots, and a check that keeps it so

**Branch:** `task/D4-readme-screenshots` (from `main` at `057e953`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `D4-tsbe3` (iPhone 17 + `nitroui_a` @ `emulator-5574` / Metro `8295`)

## Summary

Every component the README lists now has to be shown, and `check` says so.

`scripts/__tests__/readme-components.test.js` walks the value exports of `src/index.ts` that come out
of `./components/*` and requires of each one: a row in the Components table, the name in the README's
import block, an `<img>` for both platforms at `width="300"` with alt text, and the PNG on disk at
804 px (iOS) or 720 px (Android) — read out of the IHDR chunk, so a renamed or re-encoded file cannot
satisfy it. `Host` is the only exemption, reason beside it: a container with no look of its own.

Two decisions to read before the diff. The Components table is parsed as its own section: the first
version scanned the whole file and stayed green with the `Switch` row deleted, because the Performance
table has a row that starts identically. And every pattern — exports, import block, table rows — is
asserted non-empty, so a regex that stops matching reports "found nothing" instead of passing every
component; problems are collected, so one run names everything a README round has to fix.

`AlertDialog` and `ConfirmationDialog` are why: G11 shipped their section without pictures. Both pairs
are here — the alert from `Dialog`'s Playground (default args are the title, the message, a cancel and
a destructive action), the sheet from `Dialog`'s Confirmation story — so no story needed adding. Sizes:
`804x440`, `720x427`, `804x747`, `720x549`. Both dialogs are wider than the documented crop (the iOS 27
alert card is ~970 px at 3x), so each band is scaled to 804 / 720 rather than cut, which is now the
written rule. CONTRIBUTING gained "README screenshots" with the recipe that produced them; the Usage
intro states the convention instead of one device name; AGENTS.md gained the definition-of-done line.

Nothing under `src/`, `ios/`, `android/` or `example/` changed: four pictures and prose, plus the test.

Two things worth knowing. The leased Android emulator went away mid-session and came back through
`acquire --boot` (195 s), so one lease covers two boots of the same pair — an incident, not a habit.
And `agent-device` does drive the iOS 27 simulator, which the note at
`example/ios/NitroUiExampleUITests/RealInputTests.swift:14` says it cannot; it is still not what
real-input taps with, and CONTRIBUTING says so.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1659 tests / 64 suites | `ba1ca976388f` | 2 m 50 s | start 3.7 / med 8.0 / max 14.9 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

`need --for review`: `need: review is satisfied on this code tree.` — the code diff is tooling
(check-only) only: `scripts/__tests__/readme-components.test.js`, so no device gate is asked for
beyond `check`. Ledger exported to `docs/tasks/D4/gates.jsonl`.

## Red proofs

- `readme-components` -> the real gap, before the four PNGs existed -> `AlertDialog: docs/images/components/alert-dialog-ios.png does not exist`
- `readme-components` -> delete the `| Switch |` row from README's Components table -> `Switch: no row in the README's Components table`
- `readme-components` -> move `docs/images/components/switch-ios.png` away -> `Switch: docs/images/components/switch-ios.png does not exist`
- `readme-components` -> rewrite `switch-android.png`'s IHDR width 720 -> 640 (still a valid PNG) -> `Switch: docs/images/components/switch-android.png is 640 px wide, and the convention says 720 for android`
- `readme-components` -> point README's `switch-ios.png` `<img>` at a path that is not there -> `Switch: the README has no <img src="docs/images/components/switch-ios.png"> for ios`
- `readme-components` -> rename `AlertDialog,` in the README import block -> `AlertDialog: not named in the README's import block`
- the guard's own first draft -> the same dropped-`Switch`-row mutation, run against a whole-file scan -> **stayed green** (`| Switch | 1.00× |` in the Performance table matches too), which is why the section is scoped

The first line is the gap the task exists to close; the rest are mutations of already-pictured
components, run against a tree where the guard was otherwise green. The width mutation restores the
file byte-identically (`git status` clean afterwards).

## Files changed

- `scripts/__tests__/readme-components.test.js` — the guard: exports, import block, both `<img>`s, both PNG widths, the `Host` exemption and its reason.
- `README.md` — the two dialog tables; the Usage intro states the convention rather than one device name.
- `CONTRIBUTING.md` — "README screenshots": the convention, the widths, and the recipe (Metro, `initialSelection`, the warnings banner, how to present a dialog, how to measure a crop).
- `AGENTS.md` — the quality-bar line a new component now owes.
- `docs/images/components/alert-dialog-ios.png` (`804x440`), `alert-dialog-android.png` (`720x427`), `confirmation-dialog-ios.png` (`804x747`), `confirmation-dialog-android.png` (`720x549`).

## Follow-ups

- Screenshots are not tied to a build: a stale PNG passes the guard forever. A harness screenshot fixture would close that, and would also settle "how does a presentation get presented for a photo".
- `lease.mjs list` still pairs the stale `x16_avd` record with `emulator-5574`, which is the serial pair-a's AVD boots on; both pool emulators went down within the same few minutes this round, from outside this task.
- Nothing records which device a picture came from; the eight older pairs are pair-a's iPhone 17, and pair-b's iPhone Air would crop differently.
- `example/ios/NitroUiExampleUITests/RealInputTests.swift:14` carries a stale claim that `agent-device` cannot tap the iOS 27 simulator. True for real-input's purposes, wrong as a general statement — it is why nobody tried it for a screenshot.

## Fix round 1

Retaken `confirmation-dialog-ios.png`. iOS 27 draws a confirmation as a popover over the dialog's
own box, so on a populated page the card hides the copy - the old crop sat 4 px from content at the
left edge with 228 px of blank below. `Dialog`'s `Confirmation Plain` story now puts one trigger low
on an empty page: the card opens upward, its arrow points back down at the button, both stay whole.
The picture is 804x866 with 94-97 px of margin per side, measured off the trimmed content box; shot
on the leased pair (iPhone Air, iOS 27, `agent-device` tap, `simctl` screenshot). The README alt says
"popover anchored to its button"; CONTRIBUTING records the trap and the story to shoot from. No new
test, so the only new red proof is the guard's width mutation on the retaken file. `lease.mjs list`'s
stale `x16_avd` pairing is now in `docs/tasks/FOLLOWUPS.md`.

- `readme-components` -> rewrite the retaken PNG's IHDR width 804 -> 634 (still a valid PNG) -> `ConfirmationDialog: docs/images/components/confirmation-dialog-ios.png is 634 px wide, and the convention says 804 or 803 for ios`

Gates on the final tree (`fd8aa780b782`, lease `D4-vge5e`) - the merge set, printed by `gate.mjs table`:

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1659 tests / 64 suites | `fd8aa780b782` | 3 m 19 s | start 14.9 / med 18.9 / max 44.1 |
| `harness:ios` | **PASS** | 270 tests / 17 suites | `fd8aa780b782` (ios tree) | 5 m 02 s | start 9.4 / med 5.8 / max 9.6 |
| `harness:android` | **PASS** | 319 tests / 17 suites | `fd8aa780b782` (android tree) | 8 m 54 s | start 4.6 / med 3.4 / max 7.2 |
| `real-input:ios` | **PASS** | — | `fd8aa780b782` (ios tree) | 17 m 33 s | start 2.3 / med 5.3 / max 42.5 |
| `real-input:android` | **PASS** | — | `fd8aa780b782` (android tree) | 23 m 40 s | start 2.6 / med 4.7 / max 10.9 |

`need --for merge`: `need: merge is satisfied on this code tree.` (exit 0). Ledger re-exported to
`docs/tasks/D4/gates.jsonl`; no failed run, so no failure excerpt.

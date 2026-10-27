# H2b — Android `<Host>` for SegmentedControl, Picker, DatePicker

**Branch:** `task/H2b-host-popups` (from `main` at `1944052`, `main` merged in at `94dab9b`) ·
**Round:** 1 of up to 3 (D19), fix round 1 · **Leases:** `H2b-qd5qe` (round 1), `H2b-62piq`
(fix round; pair-a, iOS + Android, Metro `8295`)

## Summary

`<Host>` now composes all seven controls this library ships on Android: `SegmentedControl`,
`Picker` and `DatePicker` join `Switch`, `Slider`, `Progress` and `Button`. iOS stays the
documented passthrough (D23), so every popup case asserts on Android and passes through on iOS.

The brief's central question was whether a Host may hold a window owner at all. It may. A Compose
`Popup`, an `ExposedDropdownMenu` or a `Dialog` opened from inside the Host's composition is a
window **of that composition**, attached to its `AndroidComposeView` — the same thing that happens
for the same control in a single-control composition. Nothing Host-specific was built to carry
menus: the anchor's box is read from the composition, dismissal is the ordinary
`onExpandedChange`/`onDismissRequest`, and teardown is composition disposal — which is why removing
a child, reordering it, and `onDropView` each leave no window behind. `UNHOSTABLE_CONTROLS` is
therefore empty; it stays because it is the row the *next* control goes on, and
`src/__tests__/host.test.tsx` proves the check still bites by putting a stand-in in that table. A
React Native `Modal` child is still refused: that window is RN's sibling, not the composition's
child.

Two things were measured rather than assumed. `Picker.nuiTestMenuReport()`
(`src/components/Picker/Picker.tsx:135`) answers the anchor's screen rect, the menu's own window
rect, the rows it listed, and a process-wide count of composed menus. So "the menu sits under the
box the Host drew" is a delta between two rects, asserted twice with the Host moved in between (an
absolute offset would just state where Material insets things), and "nothing is left behind" is
`live === 0` read from a **different** control, because a dropped mount cannot report its own leak.
Every gate that opens a menu presses at the rect the witness reported, so each of those gates is
also proof the rect was measured and not read off React Native's decorative frame.

The two G5 follow-ups that live on that path are fixed here rather than recorded: an open dialog
follows a value React writes while it is up, and disabling a field takes its dialog down. Both are
gated.

One limit a reviewer should not have to rediscover in the diff: two of the new gates are **outcome
gates**, not witnesses for a particular line — said where it matters, in Red proofs.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 460 tests / 25 suites | `0b711fba39f3` | 2 m 12 s | start 5.0 / med 4.7 / max 5.0 |
| `harness:ios` | **PASS** | 165 tests / 13 suites | `0b711fba39f3` (ios tree) | 1 m 55 s | start 4.2 / med 3.8 / max 4.2 |
| `harness:android` | **PASS** | 212 tests / 13 suites | `0b711fba39f3` (android tree) | 5 m 48 s | start 3.6 / med 6.2 / max 8.2 |
| `real-input:ios` | **PASS** | — | `0b711fba39f3` (ios tree) | 8 m 40 s | start 2.1 / med 6.0 / max 39.8 |
| `real-input:android` | **PASS** | — | `0b711fba39f3` (android tree) | 10 m 24 s | start 6.8 / med 5.4 / max 19.3 |

`need --for review`: `need: review is satisfied on this code tree.` ·
`need --for merge`: `need: merge is satisfied on this code tree.`


The exported ledger has **two** rows this table does not show. An earlier `harness:ios` run
**failed** (5 tests): this task's own two device runs overlapped in one worktree —
`real-input:android` was in flight, both shared `harness-timing/state.json` and a Metro port,
and the harness read a machine-state file `published for Metro port 8295, not this run's
8296`, so it refused to judge four duration gates. Nothing pointed at the code: the same tree,
run alone, is the green row above. The second row is `real-input:ios` ending in 49 ms, before
it launched anything — `scripts/real-input/ios.mjs` reads `IOS_UDID` while `scripts/lease.mjs`
exports `IOS_SIM_UDID`, which is the tooling follow-up below. The ledger keeps both, so the
report says both.

Real input (`12 / 12` on both platforms) adds the two cases the brief names: a real tap on a
hosted `SegmentedControl` segment, and a real tap that opens a hosted `Picker`'s menu and picks a
row. **A hosted `DatePicker`'s dialog has no real-input case on either platform** (superseded
by Fix round 1) — it was not
attempted, so this report makes no claim about whether `input tap` or XCUITest could drive a
Material dialog reliably. That path is gated in the harness instead, where the dialog is opened by
a press aimed at the witnessed rect and its contents are read from the composition.

## Red proofs

All run on this task's tree (`0b711fba39f3`) on the leased emulator, each as
`break -> rebuild the APK -> run the guarded test alone -> revert`, invoked directly so no red run
entered the ledger. Six of eight went red.

- `HostPopups` "takes a real press on a segment, through the Host's composition" -> `SegmentedControl.isHostable = false` -> `No answer for "first row press" within 8000ms - the press never reached JS.`
- `HostPopups` "anchors under the box the Host drew, and follows it when it moves" -> `Picker.isHostable = false` -> `expected -1 to be greater than or equal to 0` (no anchor box, because the control is not composed)
- `HostPopups` "anchors under the box the Host drew, and follows it when it moves" -> `anchorMoved(…) = false` -> `Menu report never matched within 12000ms; last read "expanded=1;live=1;anchor=0,441,735,609;menu=0,609,735,1029;rows=3"` (menu window left where the row used to be)
- `HostPopups` "opens its dialog as a window of the Host's composition" -> `DatePicker.isHostable = false` -> `Date report never matched within 12000ms; last read "1778972400000|1|-1|-1|0|0"`
- `HostPopups` "follows a value React writes while the dialog is open (G5)" -> `followValueInDialog(model, state)` commented out -> `Date report never matched within 12000ms; last read "1825200000000|1|1777593600000|1|1|1"`
- `HostPopups` "closes when the control is disabled while the dialog is open (G5)" -> `if (false && !model.enabled && model.presented)` -> `Date report never matched within 12000ms; last read "1778972400000|1|1777593600000|1|1|1"`

Two mutations survived, and both say the same thing about their gate:

- `HostPopups` "closes when the control is disabled while the menu is open" -> `if (false && !model.enabled && model.expanded)` -> **stayed green**. Material 3's `ExposedDropdownMenuBox` stops composing a menu whose `menuAnchor(enabled = …)` went false, so a disabled Picker loses its window by two routes. The gate is an outcome gate — "a disabled control is not showing a list of choices" — and not a witness for that write. Recorded in the KDoc at `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiPicker.kt:1111`.
- `HostPopups` "takes a hosted menu down when a reorder moves the row under it" -> `anchorMoved(…) = false` -> **stayed green**, while the gate above it went red on the same mutation. Reordering the row takes the window down through the composition as well, so this gate witnesses the outcome, not `dropOpenMenu`. The anchor-follow gate above is the one that witnesses that line.

## Files changed

- **Hostability:** `src/components/Host/HostChildren.ts` (three rows in, refused list emptied),
  `src/components/Host/Host.tsx` (doc), `android/.../HybridNitroUiSegmentedControl.kt`,
  `android/.../HybridNitroUiPicker.kt`, `android/.../HybridNitroUiDatePicker.kt` (`isHostable`, the
  Host-moves-the-anchor rule, the two G5 fixes).
- **Popup witness:** `src/components/Picker/Picker.tsx`, `Picker.nitro.ts`,
  `NativeNitroUiPicker.ts` and the generated spec (`nuiTestMenuReport`), plus
  `ios/components/Picker/HybridNitroUiPicker.swift` answering `-1` — iOS reports nothing because it
  measures SwiftUI's own menu, which a passthrough Host does not own.
- **Device tests:** `example/__tests__/HostPopups.harness.tsx` (new, 22 tests),
  `HostControls.harness.tsx` and `Host.harness.tsx` (mixed cases over all seven),
  `DatePicker.harness.tsx`.
- **Real input:** `scripts/real-input/android.mjs`, `controls.mjs`,
  `example/ios/NitroUiExampleUITests/RealInputTests.swift`.
- **Bench:** `scripts/bench/lib.mjs` (`ARM_SCOPES['nitro-ui-host']` for seven controls),
  `bench/src/implementations/nitroUi.tsx`, `index.ts`, `scripts/__tests__/bench-gate.test.js`.
- **Docs / example / changeset:** `docs/components/host.md`, `README.md`,
  `docs/architecture/benchmarks.md`, `example/src/HostScreen.tsx`,
  `example/src/stories/Host.stories.tsx`, `.changeset/host-composes-popups.md` (`minor`),
  `etc/react-native-nitro-ui.api.md`.

## Follow-ups

- bench: a quiet re-run of the seven-control Host arm — this machine was not quiet, so it mints no baseline.
- tooling: `scripts/real-input/ios.mjs` reads `IOS_UDID` while `scripts/lease.mjs` exports `IOS_SIM_UDID`, so `gate.mjs real-input:ios` fails from a leased env until the alias is added.
- example (iOS): `testRealInputSwitch` intermittently misses its real tap — red at `527552116ea6`
and once at `f6bf3f8ead07`, green at `0b711fba39f3`, `d6851b858aad` and on the retry. An 8 s echo
window on a case H2b does not touch; it is not the Host's to fix.
- docs: the README's published `<Host>` performance table is still the 0.1.0 Switch-only one; the next quiet run should replace it rather than this indicative one.

## Bench

One run: `--platform android --plan quick`, head `72315db` (code tree `0b711fba39f3`), results
`bench/results/72315db-dirty-android-20261027T025136Z.json`, exit 0, `problems: []`, 4 launches,
ART `speed-profile` (primed, 1 attempt), `durationMs` 3 120 222 (52 min). The `-dirty` in the label
is this report file, written after the build: no file under `src/`, `ios/`, `android/`,
`example/src/`, `bench/src/` or `scripts/` is newer than the build, so the app that was measured is
this tree's source.

Load, recorded the way R4 does: 500 samples against a ceiling of 7 on 14 cores — median 4.56,
p90 6.43, max 27.77, **41 over (8.2 %)**. That is under `LOAD_OVER_CEILING_FRACTION`, so the
tool writes `machine.quiet: true`. The label is the tool's and not a claim: `loadavg1` at
launch was already 7.50 on 14 cores, the peak sample was 27.77, and other tasks plus this
task's own builds shared the machine throughout. `machine.hostname` is `"unlabelled"` — the
brief asked for a label and this run has none. It is a `quick` plan at 4 launches, and it
mints no baseline.

It is also not a clean sheet, and the round-1 draft did not say so: `node
scripts/bench/report.mjs bench/results/72315db-dirty-android-20261027T025136Z.json --check`
**exits 1**, on 13 `FAIL` cells — `mount`/`update:50` JS commit and JS/UI CPU,
`mount.slider:50`, `mount.progress:50`, and three `segmented-control` presented/UI cells. All
13 are on the unhosted `nitro-ui` arm, which H2b does not reprice: the only H2b line in that
file's own render path is the `val isHostable` the unhosted arm never reads. Whether that is
the machine or something real is unexplained here; what belongs in this report is that
`--check` is red.

### Hosted vs unhosted vs `expo-ui-shared-host`

Mount memory (KiB per instance, N=200) and mount UI / JS CPU per op (ms, N=50), for **all seven**
controls from this one run — each control's own cell, not an extrapolation from the `Switch`:

| Control             | no `<Host>`          | in `<Host>`            | `expo-ui-shared-host` | mem (host ÷ shared) | mem (host ÷ no Host) | UI (host ÷ no Host) |
| ------------------- | -------------------- | ---------------------- | --------------------- | ------------------- | -------------------- | ------------------- |
| `Switch` (aggregate)| 143.2 / 9.45 / 2.03 | 45.0 / 3.99 / 1.92     | 52.8 / 5.22 / 1.86    | **0.85x**(1%)       | **0.31x**(0%)        | **0.42x**(4%)       |
| `Slider`            | 155.7 / 11.35 / 2.26 | 62.8 / 5.94 / 2.37     | 63.0 / 6.90 / 2.15    | 1.00x(1%)           | **0.40x**(4%)        | **0.52x**(4%)       |
| `Progress`          | 130.7 / 8.63 / 1.82  | 33.7 / 3.55 / 1.93     | 87.9 / 8.25 / 2.75    | **0.39x**(3%)       | **0.26x**(2%)        | **0.42x**(3%)       |
| `Button`            | 203.8 / 11.72 / 1.77 | 58.8 / 6.50 / 2.05     | 77.1 / 7.55 / 3.04    | **0.76x**(1%)       | **0.29x**(1%)        | **0.55x**(5%)       |
| `SegmentedControl`  | 334.3 / 21.41 / 2.02 | 161.3 / 15.69 / 2.06   | 283.6 / 16.88 / 6.87  | **0.57x**(0%)       | **0.48x**(2%)        | **0.72x**(3%)       |
| `Picker`            | 289.9 / 29.86 / 2.22 | 156.4 / 16.15 / 2.23   | 318.7 / 20.33 / 12.91 | **0.50x**(1%)       | **0.54x**(1%)        | **0.54x**(2%)       |
| `DatePicker`        | 188.5 / 15.51 / 2.25 | 92.3 / 8.87 / 2.31     | — no Android cell     | —                   | **0.49x**(1%)        | **0.58x**(8%)       |

`Switch` is this run's readability check: its memory ratio to the shared host is 0.85x(1%), where
the published 0.1.0 figure is 0.86x and H2a's busy run read 0.88x, and `Slider` lands on 62.8 KiB
against H2a's 62.2 KiB. On that footing the three new arms say: hosting halves a
`SegmentedControl` (0.48x), a `Picker` (0.54x) and a `DatePicker` (0.49x), and takes UI-thread work
down with it (0.72x / 0.54x / 0.58x). A popup costs nothing measurable on the UI thread — the arm
mounts and updates the anchor row and **never opens a window**, so no menu or dialog memory is in
these numbers, and none of them is a claim about a menu being open.

JS CPU per op, hosted ÷ unhosted: `Switch` 0.94x(3%) · `Slider` 1.03x(8%) · `Progress` 1.06x(7%) ·
`Button` **1.16x**(4%) · `SegmentedControl` 1.01x(2%) · `Picker` 1.00x(3%) · `DatePicker` 1.02x(9%).
Only `Button` pays more than about a twentieth for being hosted, and it pays that on the unhosted
side of the arithmetic too. Against `expo-ui-shared-host` our hosted JS is far cheaper on the two
new popup controls (`Picker` 2.23 ms against its 12.91 ms, `SegmentedControl` 2.06 ms against
6.87 ms) while `Switch` is level (1.92 against 1.86 ms); read those absolutes, not the ratio alone.

### What this run cannot say

- **The unmount cells carry no verdict.** Hosted ÷ unhosted `unmountMainNsPerOp` is 0.21x (15%
  spread) for `SegmentedControl`, 0.94x (13%) for `Picker` and 0.14x (14%) for `DatePicker` — each
  over the 10% spread rule. `Picker`'s 19.45x(5%) against `rn-core` is a real reading but not a
  Host effect: the unhosted `Picker` reads 20.99x(13%) on the same axis, so it is a `Picker`
  property.
- **`DatePicker` has no shared-host comparison at all.** No Android `expo-ui-*` arm has DatePicker
  cells (`ARMS_WITHOUT_COMPONENT`), so its row is hosted-vs-unhosted only.
- **`Slider` at 1.00x(1%) is a denominator story**, not a tie: hosting halves our own footprint
  (155.7 → 62.8 KiB) onto a shared-host `Slider` that measures 63.0 KiB in this run.
- **The popup controls are cheaper than the published `Switch` JS figure**, and that is not the
  same measurement: the published 1.18x is a ratio to `rn-core` from the 0.1.0 run, and the number
  above is hosted ÷ unhosted within this one. Do not read one as the other.

## Fix round 1

Review `23e6717` — MERGE WITH FIXES — against `main` at `94dab9b`.

**M1.** The dialog's `onDispose` writes `model.setPresented(false)`
(`HybridNitroUiDatePicker.kt:1151`), so a field hidden by `display: 'none'` mid-dialog no
longer reopens a window when shown again. **M2.** Android real input gained
`hosted-date-picker`: a press opens the dialog, 31 clickable year-named day cells cover its
a11y tree, a picked day reaches JS, and OK, Cancel, Back and removing only that child each
leave nothing behind; the harness gates child-only removal, and the Back-press comment is now
true. iOS drives the same JSX, which is all D23 asks of a passthrough. **M3.** README: a
`SegmentedControl` owns no window, and the bench says what one `quick` run on a shared machine
is; `host.md` states the layout-move rule, `picker.md` the unhosted half. N1, N2, N7, N8 done,
N10 corrected above — and two comments rewritten for naming measurements nobody took, hence
the re-runs.

### Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 460 tests / 25 suites | `f6bf3f8ead07` | 2 m 12 s | start 2.0 / med 4.0 / max 7.4 |
| `harness:ios` | **PASS** | 165 tests / 13 suites | `f6bf3f8ead07` | 1 m 55 s | start 4.7 / med 4.9 / max 6.4 |
| `harness:android` | **PASS** | 214 tests / 13 suites | `f6bf3f8ead07` | 5 m 52 s | start 6.4 / med 6.4 / max 8.9 |
| `real-input:ios` | **PASS** | — | `f6bf3f8ead07` | 7 m 56 s | start 2.2 / med 3.0 / max 3.8 |
| `real-input:android` | **PASS** | — | `f6bf3f8ead07` | 11 m 31 s | start 8.1 / med 4.9 / max 9.4 |
| `harness:android:HostPopups` | stale | 2 failed of 24 tests / 1 suites | 0f13d91bbd95 (not this tree) | 51.1 s | start 2.6 / med 5.5 / max 7.7 |

`need --for merge`: `need: merge is satisfied on this code tree.`

Two rows the table does not print. `real-input:ios` went red once at this tree on `switch`:
`testRealInputSwitch`, which no H2b file touches, missed a tap in the eighth minute of a full
suite — as at `527552116ea6`, green above and at `d6851b858aad`. An 8 s echo window on someone
else's case, so reported, not fixed. The stale `harness:android:HostPopups` row is the M1 proof
below, and the reds at `d6851b858aad` are two of my own device jobs overlapping.

### Red proofs

- `HostPopups` "does not reopen a dialog that a hidden child left behind" -> delete
  `model.setPresented(false)` from the dialog's `onDispose` -> `expected true to be false`, and
  "comes down with its row, and leaves nothing when the Host is dropped" timed out reading
  `1778972400000|1|1777593600000|1|1|2` (`presented=1`, `live=1`).
- `hosted-date-picker` day-reaches-JS -> make OK commit only when nothing was picked ->
  `a real tap on a dialog day ("no pick reported") reaches JS through the Host as a new day`,
  with the case's other eleven checks green.
- iOS anchor bound -> the one-sided version it replaced went red in a gate run at
  `527552116ea6`: `the popover opened at y 213.67 while the field ends at 587.00 - it is not
  anchored to the control that presented it`. The 220 pt displacement was never built, so the
  comment calls that half arithmetic.

### N items skipped

- **N4** `host.md`'s hosted-Picker "refusal" is a re-pick of the row already shown, not a
  parent rejecting a change; `SegRows` already has a `refuse` fixture to copy into `PopupHost`.
- **N5** `followTimeValueInDialog` (`HybridNitroUiDatePicker.kt:1397`) still has no gate.
- **N6** No outside tap is ever pressed on a hosted Android menu or dialog; the harness comment
  now names that gap instead of claiming the dismissal.
- **N9** `PickerModel.reportLock` still guards nothing.
- **N11** A hosted `SegmentedControl`'s selected state is checked by label, not uiautomator.

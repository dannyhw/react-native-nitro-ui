# G15 — Checkbox

**Branch:** `task/G15-checkbox` (from `main` at `3afdf5d4`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `G15-69l63` (pair-a — `nitro-ui A` (iOS 27) / `emulator-5574` (API 35) / Metro `8295`)

## Final API

```ts
// src/components/Checkbox/Checkbox.tsx  —  exported from the package root
export function Checkbox(input: CheckboxProps): JSX.Element;

export interface CheckboxProps extends ViewProps {
  /** Controlled state. Leave unset for an uncontrolled checkbox. */
  checked?: boolean | undefined;
  /** Initial state of an uncontrolled checkbox. Default: false. */
  defaultChecked?: boolean | undefined;
  /** The new state, after every user toggle. Nothing fires while `disabled`. */
  onCheckedChange?: ((checked: boolean) => void) | undefined;
  /** Android only: Material 3's third glyph. A display, not a value. */
  indeterminate?: boolean | undefined;
  /** Text beside the box: part of the control, of its size, and of its name. */
  label?: string | undefined;
  disabled?: boolean | undefined;
  /** The "on" accent: SwiftUI `.tint()` / Compose's checked colors. */
  tintColor?: ColorValue | undefined;
  // @internal — harness/benchmark handles, not app API (D14): hybridRef, nuiPerfId
}
```

`etc/react-native-nitro-ui.api.md` is the record; the native props
(`src/components/Checkbox/Checkbox.nitro.ts`) are the same set with `T | null` and no
optionals, and every one is always sent. Sizing key `indeterminate|label`; declared
fallback 61 × 28 pt on iOS (51 × 31 before iOS 26), 40 × 40 dp on Android. `hostable` is
false and `bench` is false (see Follow-ups).

## Summary

**What shipped.** `Checkbox` renders Material 3's `Checkbox` — `TriStateCheckbox` while
`indeterminate` — on Android, and SwiftUI's `Toggle(isOn:)` with the switch style on iOS,
which has no checkbox (`CheckboxToggleStyle` is unavailable). Expo's universal `Checkbox`
renders the same switch, so `indeterminate` is documented as Android-only rather than faked
with a drawn dash, and the harness pins that iOS answers `0` and never `mixed` — the day
SwiftUI gains a real checkbox, this suite goes red instead of quietly lying.

**Three decisions a reviewer needs.** First, a press asks for the opposite of what the box
shows, on both platforms, through the path a real tap takes: "request checked" would make a
checked box impossible to uncheck, which is what four of the nine harness cases and
real-input's second tap measure (`docs/tasks/G15/mutations.json` rows 1–2, red on both).
Second, on Android a labelled checkbox is **one** semantics node: the `Row`
carries `mergeDescendants` with `Role.Checkbox` and its `ToggleableState`, and the box is
presentational (plus `minimumInteractiveComponentSize`, so the merged node is still 48 dp
tall). Compose refused to merge a clickable box with a clickable label before that — the
name landed on two nodes, one inert, and the row's centre fell in the 8 dp gap — G5 M2 and
G6 M3's shape, found again by the a11y sweep. Third, on iOS the **row** is the tap target:
a switch-style `Toggle` answers touches on its glyph only (measured — a press on a labelled
box's label moved no value and fired no event), so the row carries an overlay that asks
through `press()`, once per tap, and real-input asserts its aim is on the label's side of
the glyph.

**Hosting and the bench arm.** `hostable: false` — Chip's ship-until-measured rule, not
Switch's hosting: no measurement of a checkbox inside a `<Host>` exists yet. `bench: false`,
as the brief allowed.

**Sizes.** `48.00 × 48.00` dp bare, `131.05 × 48.00` dp labelled, and the third state
costs nothing (`131.05 × 48.00`) on both platforms. On iOS: `61.00 × 28.00` pt bare,
`145.00 × 28.00` pt labelled. `checked` is in neither sizing key, and the harness measures
a checked and an unchecked box of one label side by side to keep that honest; the bare iOS
box is the one measurement equal to its own fallback, which is why every sizing case
poisons the cache with a size no checkbox has (`11.5 × 57.5`) before mounting.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1714 tests / 67 suites | `e387b7318a67` | 2 m 37 s | start 3.2 / med 3.6 / max 5.2 |
| `harness:ios` | **PASS** | 354 tests / 21 suites + isolated 2 tests / 1 suites | `e387b7318a67` (ios tree) | 8 m 30 s | start 4.5 / med 2.8 / max 5.4 |
| `harness:android` | **PASS** | 403 tests / 21 suites + isolated 2 tests / 1 suites | `e387b7318a67` (android tree) | 12 m 00 s | start 3.6 / med 2.0 / max 3.7 |
| `real-input:ios` | **PASS** | — | `e387b7318a67` (ios tree) | 20 m 47 s | start 1.0 / med 3.7 / max 17.1 |
| `real-input:android` | **PASS** | — | `e387b7318a67` (android tree) | 30 m 57 s | start 2.8 / med 1.9 / max 3.6 |
| `harness:android:Checkbox` | **PASS** | 9 tests / 1 suites | `4a42e52bec96` (android tree) | 14.3 s | start 4.7 / med 4.6 / max 4.7 |
| `harness:android:Checkbox:--background` | stale | — | 65bb883e7002 (not this tree) | 1.1 s | start 6.0 / med 5.9 / max 6.0 |
| `harness:android:Slider` | **PASS** | 24 tests / 1 suites | `67237032bddc` (android tree) | 19.9 s | start 1.6 / med 1.7 / max 1.8 |
| `harness:ios:Checkbox` | stale | 3 failed of 10 tests / 1 suites | 65797517990f (not this tree) | 14.7 s | start 8.4 / med 8.7 / max 8.9 |
| `real-input:android:--control:checkbox` | stale | — | 17625b929c7d (not this tree) | 6 m 06 s | start 5.0 / med 2.7 / max 5.0 |
| `real-input:android:checkbox` | stale | — | 4ca21d507382 (not this tree) | 0.3 s | start 3.7 / med 3.7 / max 3.7 |
| `real-input:ios:--control:checkbox` | **PASS** | — | `e387b7318a67` (ios tree) | 5 m 24 s | start 1.8 / med 4.5 / max 7.7 |

The five unsuffixed rows are this tree and all passed; the suffixed ones are filtered runs —
red proofs, isolations and the `--control checkbox` runs that reproduced and then checked the
iOS row-tap fix — on this or earlier trees, and they satisfy nothing but their own name.

`need --for review`: `need: review is satisfied on this code tree.`

## Red proofs

Recorded as data in `docs/tasks/G15/mutations.json`. Organic reds — a test that
went red against the real bug before the fix landed — are marked as such; they are the
stronger evidence and both devices produced them.

- `example/__tests__/Checkbox.harness.tsx › follows a controlled checked in both directions` -> `press()` asks for `true` whatever the box shows (Android `press(true)`, iOS `userToggle(to: true)`) -> `expected [ Array(2) ] to deeply equal [ 'controlled:true', …(1) ]` — on both platforms.
- `… › applies a value written from JS, and keeps its own when uncontrolled` -> same press mutation -> `expected [ 'free:true' ] to deeply equal [ 'free:false' ]` — on both platforms.
- `… › lays out bare and labelled at the size the control measured` -> `label` dropped from `sizingVariantFor` -> `testID "bare" (bare) never reached 48.00x48.00 - last box 131.05x48.00, control measured 48.00x48.00.`
- `real-input:android --control checkbox` -> organic: labelled branch named a presentational `View` as well as the `CheckBox` -> `✗ NitroUiCheckbox: 2 nodes carry the name "Real-input checkbox" … | the node that carries "Real-input checkbox" is not actionable, and nothing whose box is the control's is either`.
- `… › is one node with the label as its name when a label is shown` -> organic: same branch, in-process probe -> `merged=2` where the assertion is `merged='1'`.
- `… › lays out bare and labelled …` -> organic: labelled branch without `minimumInteractiveComponentSize` -> `expected 24 to be less than 0.6` (labelled measured 24 dp tall beside a 48 dp bare box).
- `… › draws the third state on Android, and off on iOS` -> organic: `recordDrawn` read `indeterminate` before `displayed` -> `"mixed" never drew displayed=1 - it reports "displayed=mixed;probes=0;merged=none;a11y=none"`.
- `scripts/__tests__/real-input-a11y.test.js › goes red when a labelled checkbox splits its name across two nodes` -> delete the `named.length > 1` branch of `a11yProblems` -> `Expected substring: "2 nodes carry the name" / Received string: ""`.
- `src/__tests__/viewConfigs.test.ts › NitroUiCheckboxConfig.json matches nitrogen output` -> drift the checked-in copy's `uiViewClassName` -> `- "uiViewClassName": "NitroUiCheckbox" / + "uiViewClassName": "NitroUiCheckboxDrifted"`.
- `scripts/__tests__/component-coverage.test.js` -> delete `src/components/Checkbox/component.json` -> `scripts/real-input/a11y.mjs: the case "checkbox" guards "Checkbox" and no manifest declares that control`.
- `scripts/__tests__/conformance.test.js › coverage` -> same manifest removal -> the registry list diff `- "Checkbox"`.
- `scripts/__tests__/smoke-ready-line.test.js` -> remove the `SMOKE-checkbox` view from `scripts/smoke/App.tsx` -> `Expected substring: "testID=\"SMOKE-checkbox\""`.
- `scripts/__tests__/readme-components.test.js › ships each screenshot as a PNG of the documented width` -> before the two pictures existed -> `Checkbox: docs/images/components/checkbox-ios.png does not exist` (and the Android twin).
- `real-input:ios › testRealInputCheckbox` -> organic: the `Toggle` as first shipped, with no row tap target -> `the real tap that checks the box: 3 real presses on the controlled Checkbox (real-input-checkbox) left it at "off". Its own state never moved either, so on the evidence here the touch was never delivered` — the run's own tree dump said why (a press at the row's middle, over the label, changed nothing; one on the glyph toggled).
- `… › the row's aim is on the label's side of the glyph` -> drift the fixture's label from `"Real input"` to `"x"`, so the row's middle moves onto the box -> `the switch glyph starts at x=32.666666666666664 and the row's middle is at x=54.83333206176758 - a press at the middle has to land on the label's side of the glyph, or these taps prove nothing about the label`.

## Files changed

- `src/components/Checkbox/` — spec, wrapper, Fabric config, `component.json`; `src/index.ts`, `src/components/Host/HostChildren.ts`.
- `ios/components/Checkbox/HybridNitroUiCheckbox.swift`, `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiCheckbox.kt` — the two implementations; fallbacks registered in `NitroUiDeclaredFallbacks.{swift,kt}` and `nitro-ui.sizing.json`.
- `nitro.json`, `nitrogen/generated/**` — regenerated (`nitrogen:check`: no drift).
- `example/__tests__/Checkbox.harness.tsx` (new, 9 cases), `example/__tests__/Conformance.harness.tsx` (Checkbox fixture + the regenerated shared table).
- `scripts/real-input/{controls,screens,a11y,android}.mjs`, `example/ios/NitroUiExampleUITests/RealInputTests.swift` — the real-input scenario on both platforms; `scripts/__tests__/fixtures/a11y/checkbox.xml` measured off the emulator.
- `example/src/CheckboxScreen.tsx`, `example/src/stories/Checkbox.stories.tsx`, `example/src/{App.tsx,readme-examples.tsx}`.
- `README.md`, `docs/components/checkbox.md`, `docs/images/components/checkbox-{ios,android}.png`, `.changeset/g15-checkbox.md`, `etc/*` (API report, package file list).

## Follow-ups

- bench: `bench: false` in the manifest — Checkbox has no bench arm, so its render counts are unmeasured; the bench host owes them (a leaf view with no animation, so it should read like Switch's).
- iOS real-input: `waitForNativeSwitchState` duplicates `waitForChipState` one function away; worth one shared helper when someone next touches that file.
- iOS real-input: the disabled element's `isEnabled == false` is deliberately not asserted — unmeasured, and an unmeasured XCUITest predicate is a claim, not a test.
- `harness:android`: Slider's `steps to the next legal value when a screen reader asks` failed this task's first full Android run (`expected 3 to be +0`) and was green both in isolation and on the re-run of the same tree — the flake already on record at `docs/tasks/FOLLOWUPS.md:56`, recorded here so the row exists.
- `scripts/conformance/make-a11y-fixtures.mjs`: no `--only <id>` filter, so regenerating one fixture re-dumps all seventeen (≈6 min of device time).
- `Checkbox` is `hostable: false`: a checkbox inside `<Host>` is untested territory, as it is for Switch and Chip.

## Incident: one command of mine powered off every device on this machine

While cleaning up a Metro server I had started, I ran `pkill -P 1` (intending to signal a
job that shell did not have). On macOS that matches every process whose parent is
launchd, so it took down: both of my leased devices, the other pool pair's booted
simulator (`nitro-ui B`) and emulator (`nitroui_b`), the maintainer's own booted `iPhone
Air` simulator, `emulator-5560` if it was up, and every Metro/Gradle process on the box —
including any other task's running device work. I only had a right to stop two PIDs.

What I repaired, and did not: `lease.mjs acquire --task G15 --boot` brought **my** pair
back (209 s boot wait; the lease reset its own app data). I deliberately did not boot
anything I do not hold — `nitro-ui B`, `nitroui_b`, the maintainer's simulator and
`emulator-5560` are left off, on the rule that an idle device is the pool's business and
the human's emulator is nobody else's to start. `doctor.mjs` reports the pool healthy
("every booted pool device is held by a lease"), because there is nothing booted to
disagree with. Whoever owns the other running tasks should expect a dead Metro or a
powered-off device at roughly 2026-11-03 06:20 UTC and re-acquire.

## Questions for orchestrator

- **The device incident: who powers the pair back on?** My `pkill -P 1` left `nitro-ui B`,
  `nitroui_b` and the maintainer's `iPhone Air` simulator off (and any other task's Metro).
  Options: (a) leave them — the next `lease.mjs acquire --boot` pays one boot (209 s
  measured on this box for my pair) and the maintainer's simulator is theirs to start;
  (b) I boot the pool pair. **Recommend (a)** — I have released `G15-69l63`, and an idle
  device is the pool's business.
- **Keep the iOS row-wide tap target?** It is what makes a labelled Checkbox behave like
  Android's merged `Row` and like the docs' "a label is part of the control", and it is
  what `365a0acb` shipped. The alternative is iOS's native glyph-only behaviour with the
  difference documented, which costs the overlay, the caveat's middle half, and the aim
  guard in `testRealInputCheckbox`. **Recommend keeping it**; the mutation record (rows
  13–14) is the evidence either way.

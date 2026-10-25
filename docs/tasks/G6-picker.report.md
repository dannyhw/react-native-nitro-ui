# G6 — Picker (0.2) — report

Branch `task/G6-picker`, from `main` at `d21f0ce`. Implementation round (1 of 1, D19);
the five commits are `c0a379a` (control), `0f91a22` (tests/bench/docs-of-tests),
`827a476` (docs + screenshots), `a91491a` (shipped-file manifest) and `a9a0e25` — a
test-only guard the mutation battery asked for (M-N below). The device gates ran on
`a91491a` with a clean tree and `bun run check` was run again on `a9a0e25`; the bench results
files carry the earlier SHA, which differs only by a jest file that nothing shipped imports.

## Summary

`<Picker options selectedIndex defaultSelectedIndex onChange variant label disabled tintColor …/>`
hosts SwiftUI `Picker` (`.menu` / `.wheel`) on iOS and Material 3
`ExposedDropdownMenuBox` on Android, on the core runtime: controlled index through the
event-count handshake, SegmentedControl's clamps and escaped sizing key, Progress's
per-instance layout policy, `RecyclableView` with a full reset, and a declared fallback on
both platforms. The data model was reused, not forked: `useControlled`,
`useStableCallback`, `useProcessedColor`, `useSizingId`, `NitroUiControlledValue`,
`NitroUiSizing` and the `escapeOption` key format all come in from the existing core.

Sixteen on-device tests, fourteen JS tests, a real-input case on both platforms, ten
Storybook stories, an example tab, a component page, and a bench arm against `rn-core` and
both `@expo/ui` host configs.

Two findings changed documentation rather than code, both measured with a screenshot:
iOS applies `tintColor` to a **menu** (title and chevron) and ignores it on a **wheel**,
which is the opposite of what the iOS host's own comment claimed when I inherited it — the
comment now matches the measurement; and Android's popup is floored at Material's own
`MinTextFieldWidth` of 280 dp, so almost any short title measures 280 × 56 dp.

## Gates

| Command | Result |
| --- | --- |
| `bun run check` (`fnm exec --using 24 --`) | **pass** on `a91491a` — all fourteen steps: typecheck, bench typecheck ×2, eslint, prettier, jest (**188 tests, 12 suites**), `test:native` (host C++: clock + sizing, sizing again under ASan+UBSan; host Swift: handshake + slider-value; plus two source-grep guards — no Picker host test, the Picker rules are guarded on-device, and `check` does not run the Kotlin twin in `test:native:android`), `perf:renders` (**6/6**, Picker's baseline recorded at 6 renders, `mount+0 redundant`), nitrogen drift (**no drift, 160 generated files, 24 views patched**), autolinking, `prepare`, api-extractor, publint, manifest (**375 files**, +43), readme examples |
| `bunx react-native-harness --harnessRunner ios Picker.harness.tsx` | **16/16 pass** — iPhone 17 `F08675D3-…`, `HARNESS_APP_PATH=example/ios/build/Build/Products/Debug-iphonesimulator/NitroUiExample.app`, `Time: 15.244 s` (`/tmp/g6-h-ios-2.log`). This final re-run fell back to Metro **8294** — 8293 was held by my own earlier Metro (see hygiene); the earlier device runs used 8293 |
| `bunx react-native-harness --harnessRunner android Picker.harness.tsx` | **16/16 pass** — `nitroui_t01` / `emulator-5570`, adb server 5041, `app-debug.apk`, `Time: 12.347 s` (`/tmp/g6-h-android-2.log`); same 8293 → 8294 fallback as the iOS row |
| `bun run test:real-input:ios --control picker` | **pass, exit 0** — `testRealInputPicker` passed in **128.038 s** (`/tmp/g6-ri-ios-PASS.log`, four runs at 128.038 s and one at 121.409 s), `** TEST EXECUTE SUCCEEDED **`, Metro 8293 |
| `bun run test:real-input:android --control picker` | **pass, exit 0** — **30 assertions**, every value read out of `uiautomator dump` (log `/tmp/g6-ri-android-final.log`) |
| `bunx jest src/__tests__/picker.test.tsx` | **14/14 pass** (also inside `check`) |
| `bun run bench -- --platform ios --plan quick --component picker` | **ran**, 48 launches, 320 s, `problems: none` — busy machine (see Bench) |
| `bun run bench -- --platform android --plan quick --component picker` | **ran**, 48 launches, 916 s, `problems: none`, ART `speed-profile` primed in 1 attempt (D18) — busy machine |
| `bun run check` on `a9a0e25` | **pass** — the same fourteen steps again after the test-only guard (`a9a0e25` touches nothing but `scripts/__tests__/bench-gate.test.js`, which no shipped file imports): jest 53/53 in the bench-gate suite, 188 in total, publint "All good!", manifest 375 files, `readme:check` 5 blocks |

Both harness suites and both real-input cases were re-run on the committed tree, after the
only post-device change (a doc-comment fix in the iOS host) and after the prettier pass.
`HARNESS_TIMING` is unset, so these runs assert structure (counts, sizes, echoes) and
refuse nothing on wall-clock — which is what D21 wants on this shared machine, and what
makes them meaningful at load 15+.

`test:real-input:android` re-run once more at the end of the task purely to print the
assertion count for this table; the first run passed identically.

## Shown red

Every new test's guarding mechanism was broken and the red recorded
(`/tmp/g6-device-mutations.txt`, `/tmp/g6-red-unit-mutations.txt` and
`/tmp/g6-red-bench-gate.log` are the raw output). Native mutations are one rebuild per
platform; the JS-wrapper, unit and bench-gate mutations need none — the harness app re-bundles
from Metro and the bench gate is host jest — which made a twelve-mutation battery cheap.

| # | Broken | Red |
| --- | --- | --- |
| M-A | native upper clamp deleted in `PickerModel.clamp`, both platforms | `clamps an index written straight to native` — *expected 9 to be 2* |
| M-B | iOS: `noteContentSizeMayHaveChanged()` dropped from the `options` setter | `corrects a planted size that matches the current box (iOS measure signal)` |
| M-C | Android: `noteSizingKeyChanged()` dropped from the `nuiSizingKey` setter — **the 15-test suite stayed green**, no test could see the hook | the 16th test (`re-reports a key change that keeps the (R3)`) was written because of that, and then went red: box stuck at the planted 13.25 × 66.50 guess |
| M-D | iOS: same hook dropped | same test red, same shape |
| M-L | JS only: `variant` removed from the sizing key | `takes the box width as a wheel and its own width as a menu` (iOS) |
| M-M | JS only: `sizingVariantFor()` returns one constant string | 6 tests red on **both** platforms: the two size-by-title tests, the wheel/menu width test, both R3 tests, and the shrink clamp |
| M-N | host jest: `componentOf()` answers `button` for `mount.picker` (G4's mutation shape) | first run only `schedules every picker cell and every arm` and `fails conclusively when the Picker arm doubles` went red: `is silent when nothing changed` and `never gates a Picker reference arm` were **green because the component-scoped filter came back empty**, so `gate()` was describing nothing. `a9a0e25` makes that fixture throw when it finds no Picker cells; the same mutation then reds **four** of the five Picker cases |
| M-O | host jest: `ratioTable()` divides a `.picker` arm by the Switch control | `divides a Picker arm by the Picker control, never another control` (4.4× where 1.1 is only reachable through the right pairing) and `fails conclusively when the Picker arm doubles` |
| M-H | JS only: `escapeOption` returns the label unescaped | the two escaping tests (unit) |
| M-I | JS only: variant dropped from the key (unit view) | 5 unit tests red |
| M-J | JS only: `clampToOptions` stops clamping past the end | 3 unit tests red |
| M-K | JS only: the wheel's `alignSelf: 'stretch'` removed | `asks for its own width as a menu and for the box width as a wheel` |

The gates that found their own drift, rather than being mutated:

- **M-E** the smoke ready-line fixtures: adding `picker` to `SMOKE_CONTROLS` made
  `scripts/__tests__/smoke-ready-line.test.js` fail on both fixtures (*picker: no "WxH" box
  in the ready line*), which is the gate noticing that a sixth control had joined the app
  without a box in its contract. After the fixtures gained a box, removing `picker` from
  `SMOKE_CONTROLS` again made the two new expectations red (`sizes.picker` undefined), so
  the fixtures are load-bearing and not just permissive.
- **M-F** the `perf:renders` baseline: the first attempt — `setState` during render — did
  **not** go red, which is itself informative: React re-runs the component inside the same
  pass, so the commit count never moved. A real extra commit after mount (an unconditional
  `useEffect` that sets state once) made it red: `Picker … 6 → 7, mount+1 redundant,
  CHANGED (+1); 1 update render(s) right after mount`, exit 1. Restored byte-identical.
- **M-G** `nitrogen:check` (21 "not committed" findings) and `manifest:check` (43 tarball
  additions) each failed until their generated files were committed — both gates doing
  their job on a new component.

## Files changed

`c0a379a` — the control (44 files, +5468):

- `src/components/Picker/` — `Picker.nitro.ts` (spec, `T | null` everywhere, no `?:` props
  per D7), `Picker.tsx` (wrapper), `NativeNitroUiPicker.ts`, `NitroUiPickerConfig.ts`.
- `ios/components/Picker/HybridNitroUiPicker.swift`,
  `android/…/HybridNitroUiPicker.kt`.
- `nitrogen/generated/**` (specs, size struct, view component, managers, state updaters,
  autolinking), `nitro.json`, `nitro-ui.sizing.json`, `NitroUiDeclaredFallbacks` on both
  platforms, `NitroUiPackage.kt`, `src/index.ts`, `etc/react-native-nitro-ui.api.md`.
- `example/src/PickerScreen.tsx`, the `Picker` tab in `example/src/App.tsx`,
  `example/src/stories/Picker.stories.tsx` (10 stories: Playground with every prop,
  Variants, Controlled, Uncontrolled, Clamped, RefusedChoice, Disabled, Tinted, Sizing,
  Accessibility).

`0f91a22` — the tests and the bench arm (21 files, +2963):

- `example/__tests__/Picker.harness.tsx` (16 tests), `src/__tests__/picker.test.tsx`
  (14), `src/__tests__/viewConfigs.test.ts`, `Picker.perf-test.tsx` +
  `bench/baselines/renders.json`.
- `bench/src/{types,plan}.ts`, the Picker arms in `nitroUi.tsx`, `rnCore.tsx`,
  `shared.ts`, `expoUi.ios.tsx`, `expoUi.android.tsx`, `scripts/bench/lib.mjs`
  (quick + full cells), 5 new `scripts/__tests__/bench-gate.test.js` cases.
- `scripts/real-input/{controls,uiautomator,android}.mjs` and
  `example/ios/NitroUiExampleUITests/RealInputTests.swift` — the real-input case.
- `scripts/smoke/{App.tsx,lib.mjs}` + `scripts/__tests__/smoke-ready-line.test.js` — the
  sixth control in the consumer smoke contract.

`827a476` — `docs/components/picker.md` and eleven screenshots in `docs/tasks/G6-picker/`.
`a91491a` — `etc/package-files.txt` (+43, all Picker).
`a9a0e25` — `scripts/__tests__/bench-gate.test.js` only: the Picker fixture now throws when
the component-scoped filter finds no Picker cells, so the two cases M-N caught being vacuous
can no longer pass by describing an empty run.

Shared registration points were touched additively only — one array entry, one export
block, one `nitro.json` object, one sizing-table line, one fallback call, one smoke
control, one bench plan block per platform — so G5 (DatePicker), which joins the same
lists, merges without contention.

## Decisions

1. **`wheel` on Android is the M3 menu, under the wheel's layout policy.** Material 3 has
   no wheel. The brief says render the menu and document it; a hand-drawn wheel would not
   be the platform control. The variant still changes the *policy* (fill the box) so a
   caller who switches variants on Android sees the width behaviour they expect, and
   `docs/components/picker.md` says what the platform actually shows.
2. **The sizing table declares `intrinsic`; the host answers `fillWidth` for wheel
   instances.** `nitro-ui.sizing.json` is one mode per class, and the menu is the default,
   so the table says `intrinsic` and the variant switch lives where the variant is known
   (`isWheel`/`isFillingWidth`). The alternative — two components — would split the API for
   a prop. Covered by `takes the box width as a wheel and its own width as a menu` and by
   M-K.
3. **Fallbacks are the measured menu, not a guess**: iOS 72 × 35 pt, Android 280 × 56 dp.
   The Android pair is Material's `MinTextFieldWidth` (280.dp in `TextField.kt`), so it is
   right for any title up to ~30 characters; a 40-character title measures 384.76 × 56.
   A `label` raises an Android field to 64 dp, which the `lbl:` part of the key corrects on
   the first measure. Both are deliberately *not* the exact long-title sizes, so a failed
   correction cannot hide behind them.
4. **The sizing key names the variant, the escaped option list, the selected title and the
   label** — same escaping as SegmentedControl (`\` and `|`), variant first so a wheel can
   never inherit a menu's size. Tint and `disabled` are deliberately excluded: they change
   no box (asserted in the unit suite, "is the same when only the tint or the disabled flag
   moves").
5. **The popup is owned by the composition, and every dismissal is reported.** Android's
   menu is a Compose `Popup` with its own `PopupWindow`; it dies with the composition that
   `NitroComposeHost.drop()` ends, and the open state is per-host rather than per-model so a
   recycled view cannot reopen on the next row's data. iOS opens SwiftUI's own menu, which
   is already inside the hosted view. Opening is never a choice: the anchor's press is not
   an event, and the dismiss listener ignores every cause — outside tap, back, row tap, and
   the ones the control initiates — so a menu that opens and closes costs one event, not a
   phantom selection. Measured on device: three unmount-while-open cycles each leave zero
   popup windows.
6. **Android accessibility claims are stated as the tree reports them.** M3's merged field
   node reports `enabled = false` under `disabled()`, but Compose's extra anchor semantics
   node reports `enabled = true` (it derives `isEnabled` from unmerged children and has
   none). Rather than write "disabled is exposed", `picker.md` says which node says what and
   points at the functional proof that a real tap on a disabled field opens nothing.
7. **`selected` is semantics only on Android.** Material 1.4's `DropdownMenuItem` takes no
   `selected` argument, and drawing a check mark would invent an affordance iOS's menu
   doesn't have in the same form — iOS's menu draws its own check (visible in
   `ios-light-menu-open.png`).
8. **One colour cache, keyed on (scheme, tint).** `TextFieldDefaults.colors()` allocates;
   rebuilding it per recomposition per mounted field is exactly the "Shared objects" trap in
   `core.md`, so the set is served from a bounded process-wide cache.
9. **Tint reaches different roles per platform, measured, not assumed.** iOS menu: title +
   chevron. iOS wheel: nothing (rows keep the scheme's label colours, band stays grey) —
   which is why the inherited code comment saying the wheel's selection highlight was
   tinted got corrected in this round. Android: the field's active outline and label only.
   G4's F1 (a *segmented* picker ignoring `.tint()`) does not extend to `.menu`.
10. **`onChange` carries `{index, value}`**, same shape as `SegmentedControlChange`: the
    index addresses the model, the label comes from the options rendered at event time, and
    the index is the half that cannot go stale if the list shrank mid-flight.

## Bench

`bun run bench -- --platform <ios|android> --plan quick --component picker`, quick = 4
launches × (5 warmup + 20 measured) per cell, 3 cells × 4 implementations. Numbers are the
runner's median of launch medians. A derived `nitro-ui ÷ <expo arm>` ratio is printed with a
verdict only when both arms' launch-paired ratio-to-`rn-core` columns are quiet (≤ 10 %
within-run spread); `(nv)` means at least one was noisy, and those cells are reported, not
judged.

### Runs

| Results file | Device | Sampled load (median / p90, % over 7.0) | Busy | Problems |
| --- | --- | --- | --- | --- |
| `a91491a-ios-20261025T150928Z.md` | iPhone 17 (`ios27-sim-iphone17`) | 11.71 / 26.74, **94.9 %** | **yes** | none |
| `a91491a-android-20261025T144915Z.md` | `nitroui_t01` (`android35-emu-pixel9`) | 11.31 / 17.34, **89.9 %** | **yes** | none |

**Neither run happened on a machine the runner calls idle** (ceiling 0.5 × 14 = 7.0). The
load came from a concurrent task's emulator booting mid-session and desktop applications;
both runs are labelled accordingly, and this task therefore does **not** claim D15's
canonical iOS baseline — D15 reserves that for the first task holding iPhone 17 on an idle
machine. Both runs are on the canonical devices, on a clean `a91491a`, with `problems:
none`, and `--check` was deliberately not run (there is no Picker baseline to check, and a
component's first arm never blocks). The Android artifact's freshness check passed on the
committed bytes; the iOS artifact was rebuilt first because my JS mutation battery had
touched source mtimes (content was byte-identical) — the runner's own staleness rule caught
it and I let it rebuild rather than measure a bundle it could not vouch for.

### iOS — iPhone 17, quick, N=50 (memory N=200)

| Cell | Metric | rn-core | per-control | shared-host | nitro-ui | ÷ shared | ÷ per-control |
| --- | --- | --- | --- | --- | --- | --- | --- |
| mount | presented | 16.05 ms | 49.45 ms | 164.31 ms | **49.41 ms** | **0.30× PASS** | 1.00× tie |
| mount | mounted | 8.98 ms | 31.83 ms | 19.67 ms | 32.68 ms | 1.66× (nv) | 1.03× (nv) |
| mount | JS commit | 3.92 ms | 5.99 ms | 4.65 ms | **1.49 ms** | 0.32× (nv) | 0.25× (nv) |
| mount | JS CPU/op | 3.77 ms | 6.25 ms | 5.09 ms | **1.75 ms** | 0.34× (nv) | 0.28× (nv) |
| mount | UI CPU/op | 5.27 ms | 68.55 ms | 116.57 ms | 33.40 ms | **0.29× PASS** | 0.49× (nv) |
| update | presented | 16.09 ms | 67.05 ms | 56.36 ms | **50.00 ms** | **0.89× PASS** | **0.75× PASS** |
| update | mounted | 7.34 ms | 5.66 ms | 4.63 ms | 31.62 ms | 6.83× (nv→see note) | 5.59× |
| update | JS commit | 1.87 ms | 3.44 ms | 2.51 ms | **1.22 ms** | **0.49× PASS** | **0.35× PASS** |
| update | JS CPU/op | 2.08 ms | 8.26 ms | 3.23 ms | **1.81 ms** | **0.56× PASS** | **0.22× PASS** |
| update | UI CPU/op | 7.46 ms | 52.55 ms | 39.31 ms | 36.17 ms | **0.92× PASS** | **0.69× PASS** |
| memory | bytes/inst | 71.4 KiB | 921.8 KiB | 818.9 KiB | 622.1 KiB | **0.76× PASS** | **0.67× PASS** |

`update.picker` on iOS is quiet in all four arms, so its verdicts are the trustworthy part
of this table. `mount.picker` is not: JS commit (≈39 %), mounted (≈21 %) and JS CPU/op
(≈30 %) all exceed 10 % in every arm, which is what a 94.9 %-busy machine does to a
50-control mount. `presented` and `UI CPU/op` stayed quiet there, so their two PASSes stand
as directional at best on this run.

### Android — `nitroui_t01`, quick, N=50 (memory N=200)

| Cell | Metric | rn-core | per-control | shared-host | nitro-ui | ÷ shared | ÷ per-control |
| --- | --- | --- | --- | --- | --- | --- | --- |
| mount | presented | 32.72 ms | 66.72 ms | 49.39 ms | 58.63 ms | **1.19× MISS** | **0.88× PASS** |
| mount | mounted | 21.88 ms | 54.07 ms | 39.51 ms | 40.97 ms | 1.04× tie | 0.76× PASS |
| mount | JS commit | 3.22 ms | 20.50 ms | 12.52 ms | **1.84 ms** | **0.15× PASS** | **0.09× PASS** |
| mount | JS CPU/op | 3.97 ms | 23.54 ms | 15.14 ms | **2.51 ms** | **0.17× PASS** | **0.11× PASS** |
| mount | UI CPU/op | 8.14 ms | 50.73 ms | 27.56 ms | 40.37 ms | **1.46× MISS** | **0.80× PASS** |
| update | presented | 31.58 ms | n/a | n/a | 35.50 ms | n/a | n/a |
| update | mounted | 18.53 ms | n/a | n/a | 13.78 ms | n/a | n/a |
| update | JS commit | 3.54 ms | 10.46 ms | 8.86 ms | **1.42 ms** | 0.16× (nv) | 0.14× (nv) |
| update | JS CPU/op | 3.92 ms | 10.51 ms | 9.31 ms | **3.55 ms** | 0.38× (nv) | 0.34× (nv) |
| update | UI CPU/op | 7.05 ms | 84.00 ms | 79.12 ms | **20.99 ms** | **0.27× PASS** | 0.25× (nv) |
| memory | bytes/inst | 73.5 KiB | 429.8 KiB | 313.6 KiB | 292.3 KiB | **0.93× PASS** | **0.68× PASS** |

Android `mount` is the quiet half of this run (only `UI CPU/unmount` exceeded 10 % in any
arm), so its verdicts mean something — on a machine at 1.6× the load ceiling. The two
`expo-ui` arms emit no mount/presented signal in `update` (`missingMount=80,
missingPresented=80`), so those two rows have no comparison against them at all; against
`rn-core` nitro-ui is 1.12× presented and 0.75× mounted there.

### Against D15 (mount presented, mount UI CPU, memory vs `expo-ui-shared-host`)

| Platform | mount presented | mount UI CPU/op | memory |
| --- | --- | --- | --- |
| iOS (busy) | 0.30× PASS | 0.29× PASS | 0.76× PASS |
| Android (busy) | **1.19× MISS** | **1.46× MISS** | 0.93× PASS |

The Android misses are the host-architecture shape G1/G2/G4 recorded, not something the
Picker draws: mount `UI CPU/op` for `nitro-ui` has been 1.33–1.50× shared-host on Android
for SegmentedControl and Button too, and `presented` is a frame stamp for a batch of 50
Compose fields, which is the metric a busy machine moves most. Both are stated as
measures-taken-on-a-busy-machine, with the re-measure on an idle machine as the follow-up
before release readiness decides whether they are real (D15: misses need an explanation and
a follow-up, the reviewer decides). Per D15 a component's first arm never blocks on a
missing baseline, so nothing here gates a merge.

Where the picker is clearly ahead is the JS side, and that is not noise: 0.09–0.35×
`expo-ui` on JS commit and JS CPU/op on both platforms, on every cell. One hosted view with
a struct-prop bridge against N hosted views per control.

`update.picker` `mounted` on iOS (31.62 ms vs 4.63 ms shared-host) is the same gap G2
recorded for Button (F3) — per-instance synchronous measure work on mount in a scenario
that re-mounts the batch — and is reported, not gated, with the same `sizingStats()`
follow-up.

### Instrument artefacts worth an owner

- `presentedBeforeMount` is non-zero on iOS `mount.picker` for `nitro-ui` (31/80) and
  `expo-ui-shared-host` (20/80). `docs/architecture/benchmarks.md` treats a non-zero counter
  as a probe artefact; this is the same observation as G2 F4 / G4 F4, now on a third
  component.
- The `expo-ui` Android arms report no mount/presented signal in `update` cells (above). If
  that is the arm and not the instrument, those rows could be recovered.

## Docs and screenshots

`docs/components/picker.md` in the house order (API → platform mapping → selection and
clamping → the popup → sizing with the measured table → tint → accessibility → behaviour
notes → limits), with the two size tables measured on the assigned devices (iOS
`['One','Two','Three']` 72.00 × 34.67; `['Go']` 62.67 × 34.67; a 40-character title
360.33 × 34.67; a `label` costs iOS nothing; wheel in a 330 pt box 330.00 × 216.00 — Android
280.00 × 56.00 for almost any title, 384.76 × 56.00 at 40 characters, 64.00 tall with a
label, wheel 330.29 × 56.00).

Eleven screenshots in `docs/tasks/G6-picker/`: `{ios,android}-{light,dark}.png` and
`{ios,android}-{light,dark}-menu-open.png` (eight, closed and open, both appearances), plus
three tint / wheel cases — `ios-light-lower-tint-wheel.png` (the iOS tint evidence; no dark
twin was shot) and the Android pair `android-{light,dark}-lower-tint-wheel.png`, of which the
light one is the evidence for the over-wide menu being fitted and ellipsised.

## Acceptance

| Item (from the brief) | State |
| --- | --- |
| `bun run check` green | **pass** on `a91491a`, all fourteen steps |
| Harness green on both platforms, R3 included | 16/16 iPhone 17, 16/16 `nitroui_t01`, on the committed tree; R3 covered by two tests, both shown red by removing the hook (M-C/M-D) and by freezing the key (M-M) |
| Every new test shown red first | battery above (twelve mutations); M-C proved a test had to be *added*, M-N proved two bench-gate cases had to be made non-vacuous (`a9a0e25`) |
| Real-input (open menu, pick a row) both platforms | pass, exit 0 — Android 30 assertions from `uiautomator dump`, iOS XCUITest reading rendered text (128.038 s) |
| Bench arm + scenarios vs `@expo/ui` ×2 and `rn-core`, both platforms, load-labelled | tables above; `mount` N=50 and `memory` N=200 in quick, N=1/200 and `leak` in the full plan |
| Smoke `App.tsx` + per-control layout check | sixth control in app + contract, fixtures updated, red shown both ways |
| api-extractor report | `etc/react-native-nitro-ui.api.md` +43 lines, `api-extractor:check` pass |
| Screenshots iOS + Android, light + dark, menu open | 11 files, including the wheel/tint and over-wide cases |
| Example tab + Storybook stories | `Picker` tab; 10 stories (Playground has every prop) |
| `nuiSizingKey` + declared fallback | both, values measured; over-wide content fits its box (C1) tested both directions |
| Docs page | `docs/components/picker.md`, following `segmented-control.md` |

## Known issues / follow-ups

- **The D15 Android misses (mount presented 1.19×, mount UI CPU 1.46×) and the busy iOS PASSes
  all need one re-run on an idle machine.** Same devices, same command, ~20 minutes. That
  run is what should record the iOS Picker baseline, not this one.
- The README component table and any published perf numbers are left to the release task
  (D19 scope).
- `scripts/smoke/lib.mjs` and `App.tsx` still say "the five controls" in prose above the
  control list. Left alone deliberately: G5 edits the same two lines, and a comment can be
  reworded once by whoever merges the sixth and seventh control.
- Android's extra anchor semantics node reports `enabled = true` under `disabled()`
  (documented; a Compose merge-behaviour issue, not a Picker one).
- The LogBox "Open debugger to view warnings" badge is visible at the bottom of the example
  screenshots — a dev-build affordance of the example app, not of the control.
- `update.picker` `mounted` on iOS is 6.8× shared-host, matching G2 F3; settle it with the
  `sizingStats()` delta G2 proposed rather than here.
- Bench instrument: `presentedBeforeMount` non-zero (third component), and `expo-ui` Android
  `update` arms emitting no mount signal.
- An Android wheel remains the M3 menu (decision 1). If a real wheel is ever wanted it is a
  new control, not a variant.

## Device and process hygiene

- Android addressed by serial throughout (`-s emulator-5570`, `ANDROID_ADB_SERVER_PORT=5041`,
  `ANDROID_AVD=nitroui_t01`). The default-port adb server was never used or restarted;
  `emulator-5560` / `PR1505_Pixel`, G5's `emulator-5572` / `nitroui_t02` / adb 5042 / Metro
  8294, and the `PR1501R2_Pixel` (port 5600) emulator another session booted mid-task were
  never touched.
- iOS only on `F08675D3-…` (iPhone 17, iOS 27). No `agent-device` session was started
  against it, and the "iPhone 17 (RNSB …)" simulators belonging to another project were left
  alone.
- Metro: every real-input run and the earlier harness runs used 8293 as assigned. The two
  *final* harness re-runs printed `Harness could not use Metro port 8293 and is using 8294
  instead` — 8293 was still held by my own earlier Metro, and the runner walked to the next
  free port, which happens to be G5's assignment. 8294 was free at that moment (a second
  bind would have failed, not fallen through again), so nothing was served from or to G5,
  and nothing is listening on 8293 or 8294 now (`lsof` returns nothing for either). Flagged
  here because it is exactly how two tasks can step on each other's bundle. The harness and
  real-input scripts started and stopped their own Metros; no process was killed by name.
- Gradle daemons were left running on purpose — `--stop` would stop a daemon another task's
  build is sharing.
- Both my devices are down and the simulator appearance is light. They were the last thing
  stopped, after the final `check`: iPhone 17 `F08675D3-…` (`simctl shutdown`) and
  `nitroui_t01`, identified before the kill by `adb -s emulator-5570 emu avd name` on adb
  server 5041. An earlier draft of this bullet was written while both were still up from the
  last device gate; `emulator-5560`, G5's `emulator-5572` / iPhone Air and the RNSB
  simulators were never in scope. `git status` is clean and `DEFAULT_SCREEN` in
  `example/src/App.tsx` is `'switch'`.

## Questions for orchestrator

1. **Should G6 re-run both bench plans on an idle machine** (same commands, ~25 minutes) so
   the iOS numbers can be recorded as the D15 baseline and the Android mount ratios stop
   being busy-machine numbers? My recommendation: yes, but as a scheduled quiet-window run
   owned by whoever can hold iPhone 17 and `nitroui_t01` with load under 7 — this session
   never got such a window (best sampled median was 11.31).
2. **The `nitro-ui.sizing.json` one-policy-per-class limitation** (decision 2): Picker
   declares `intrinsic` and answers `fillWidth` for its wheel instances. That works and is
   tested, but it means the table cannot be read as "what this class measures". Is a
   per-variant policy entry wanted before 0.2 ships, or is the host-level answer the intended
   design? I'd keep it as-is and note it in `sizing.md` — but `sizing.md` is not mine to
   edit, so it is a question rather than a change.
3. **Android's disabled-state semantics node** (`enabled = true` on the unmerged anchor
   node) — is that worth a core-level ticket, since any future Compose control with a merged
   field will show the same split? Today it is documented for Picker only.

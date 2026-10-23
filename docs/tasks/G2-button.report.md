# G2 — Button · implementation report

Branch `task/G2-button` from `e9e2448`. SwiftUI `Button` + `.buttonStyle(...)` on
iOS, the five Material 3 button composables on Android, both hosted by the T10
core and sized by the T11 engine. Button is the library's first control whose size
comes from its props, so this task also delivers the R3 verification D16 assigns to
it.

## What shipped

**Component**

- `nitro-ui.nitro.ts` + `src/components/Button/Button.nitro.ts` — the Hybrid View
  spec (`title`, `variant`, `size`, `disabled`, `tintColor`, `systemImage`,
  `accessibilityLabel`, `onPress`) and the `NitroUiButtonSize` record.
- `src/components/Button/Button.tsx` — the wrapper: variant/size resolution,
  `useStableCallback` for `onPress`, `nuiSizingKey = variant|size|systemImage|title`,
  `alignSelf: 'flex-start'` base style.
- `src/components/Button/NativeNitroUiButton.ts`, `NitroUiButtonConfig.ts`.
- `ios/components/Button/HybridNitroUiButton.swift` — `ButtonContent`, the
  variant→`buttonStyle` switch, the four size-affecting setters that call
  `noteContentSizeMayHaveChanged()`, the declared fallback.
- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiButton.kt` — the
  composable, `ButtonColorsCache`, `ButtonLabelStyles`, per-scale
  `contentPadding`, the declared fallback.
- Registration: `NitroUiPackage.kt`, `nitro-ui.sizing.json`
  (`"HybridNitroUiButton": "intrinsic"`), `src/index.ts`, nitrogen output,
  `src/__tests__/viewConfigs.test.ts`.

**Tests**

- `example/__tests__/Button.harness.tsx` — 11 on-device tests (see below).
- `src/components/Button/Button.perf-test.tsx` + `bench/baselines/renders.json` —
  the D9 reassure scenario, baseline 6 renders.
- `scripts/__tests__/bench-gate.test.js` — 5 new tests for the `--component button`
  arm set.

**Bench**

- `bench/src/implementations/rnCoreButton.tsx`, `expoUiButton.ios.tsx`,
  `expoUiButton.android.tsx`, plus the Button arm in `nitroUi.tsx` and the shared
  row/title/press helpers in `shared.ts`.
- `scripts/bench/lib.mjs` — the `--component` dimension (`COMPONENTS`,
  `SWITCH_IMPLEMENTATIONS` / `BUTTON_IMPLEMENTATIONS`,
  `controlImplementation`, `isControlImplementation`), `run.mjs`/`render.mjs` for
  the control arm being named per component.

**Example + docs**

- `example/src/ButtonScreen.tsx`, a Switch/Button tab in `example/src/App.tsx`
  (`INITIAL` stays `'switch'`), one `<Button>` in `scripts/smoke/App.tsx`.
- `docs/components/button.md`, screenshots in `docs/tasks/G2-button/`.

## Design notes worth keeping

- **The variant switch is the only branch.** `buttonStyle` takes a concrete
  `PrimitiveButtonStyle`, so the style must be a compile-time branch; everything
  shared (`controlSize`, `disabled`, `tint`, `accessibilityLabel`) sits outside the
  switch so a variant change costs one style, not a different modifier chain.
- **No `ButtonDefaults.*colors()` per recomposition.** M3 colours and the derived
  `labelLarge` at 18 sp come from `ButtonColorsCache` (keyed by
  `scheme × variant × tint`) and `ButtonLabelStyles` (keyed by `Typography`
  identity), mirroring `SwitchColors`. Building either inline is a per-frame
  allocation for every visible button (`docs/architecture/core.md` "Shared
  objects").
- **Every size-affecting setter says so** (sizing.md §5.5): `title`, `variant`,
  `size` and `systemImage` each call `host.noteContentSizeMayHaveChanged()` beside
  `markDirty()`. `NitroSwiftUIHost` only re-measures on a commit-after-first, a
  bounds change or a trait change, so without that call the control would repaint
  at its new size inside the old box and the engine would never be told.
- **`onPress` is always sent.** Nitro reads `undefined` as "unset", so a prop that
  disappears never reaches native and a recycled view would keep the previous
  mount's handler; the wrapper substitutes a module-level no-op.
- **One declared fallback pair, not five.** The engine keys fallbacks per
  component, so Button declares the middle of its measured table — `77 × 35` pt
  (iOS) and `91 × 48` dp (Android) — both measured rather than guessed, and both
  larger than a `text` button rather than smaller than a `large` one, because a
  box smaller than the control is the failure mode `core.md` §7 documents.

## Tests, and what each is shown to fail on

`bunx react-native-harness --harnessRunner <ios|android> Button.harness.tsx` —
**11/11 on iPhone Air (iOS 27) and on `nitroui_t02` (API 35)**. Fix round 1 added the
key-change test, so the suite is **12/12** there now; see **Fix round 1**.

| Test | Proves |
| --- | --- |
| lays each variant out at the size the control measured | box = `measureContent()` for all five variants, poisoned first, ≥5 corrections |
| fires `onPress` once per tap and nothing when disabled | the event, not just the geometry (Android: a real synthetic tap; iOS: the native-held callback, see Known issues) |
| re-measures when the title changes (R3) | short → long → short, the box reaching each new fitting size; frame-exact for the warm half via `warm.corrections == 0` |
| re-measures when the size changes (R3) | `small` → `large` → `small` warm: 0 corrections needed, box still moves |
| re-measures a title change the engine has an answer for already | the only test that can see `noteContentSizeMayHaveChanged()` |
| reports a configuration change that keeps the same size (R3, fix round 1) | the box leaves the fallback when the new key measures what the old one did — see **F1** |
| gives two titles in one row two different widths | cache-key correctness (`title` in `nuiSizingKey`) |
| re-measures after an environment change, mounted or fresh | the epoch path, mounted and fresh instances |
| keeps a caller width in charge and truncates the label | `style.width` wins; the label truncates instead of painting outside |
| sizes 200 distinct titles, each at its own size | 200 configurations, each correct (`corrections ≥ 200`, `cachedSizes ≥ 200`) |
| survives remounts with the size of each mount | recycling / re-seeding |
| reports the drawn box of a button, not a stale one | `measureContent()` is not a stale value |

Deliberately absent: a `beforeAll` warm-up mount. It hides exactly the
first-mount-of-a-process behaviour G1 found on another suite.

### Gate proofs (each red before it was green)

1. **Render-count gate (D9).** Injected a `useEffect` + `setState` force-render
   into `Button.tsx`:

   ```console
   $ bun run perf:renders
   FAIL Button: mount, 3 title changes, 2 unrelated parent renders — expected 6, got 10
        mount+1 redundant[3,5,7]
   ```

   Switch unaffected; reverted → 6/6 green.
2. **Cache-key gate.** Dropped `title` from `nuiSizingKey`
   (`src/components/Button/Button.tsx:136`): three iOS failures —
   `key-short … never reached 47.67x34.33 - last box 207.00x34.33` and the 200-row
   test reporting `199/200 still wrong … corrections 200, cached 1`.
3. **iOS measure-notify gate.** Deleted
   `host.noteContentSizeMayHaveChanged()` from the `title` setter: **the ten tests
   that existed then stayed green** — the only test that noticed is the eleventh
   (`"notify" … still measures 53.67x34.33 after the change … so it never
   re-measured`). That is why the eleventh exists: `NitroSwiftUIHost` re-measures
   whenever its frame moves, so any test whose poisoned size also changes the box
   cannot see a missing notify.
4. **Bench pairing gate** (proved on the pre-merge harness). Hardcoding the
   Button control arm to `'rn-core'` turned three of the new `bench-gate.test.js`
   tests red (`pairs each Button arm…`, `fails conclusively when the Button arm
   doubles`, `schedules one complete arm set…`); restored → 33/33 green. Fix round
   1 ported these onto main's scenario-cell mechanism, where the same gate is
   `divides a Button arm by the Button control, never the Switch control`,
   `fails conclusively when the Button arm doubles` and `schedules one complete
   component per --component, never a mix`.

## Bench

`bun run bench --plan quick --component button`. **The numbers below are measured on
the pre-merge harness**, where this task added a `--component` dimension that named the
control arm per component (`rn-core-button`, `expo-ui-host-per-control-button`,
`expo-ui-shared-host-button`, `nitro-ui-button`). Fix round 1 merged main and ported
Button onto main's mechanism instead: the component is part of the scenario cell
(`mount.button`, `update.button`, `memory.button`) and the arms keep their plain names.
The command is unchanged and still runs the same nine Button cells; the tables are kept
as measured rather than re-run, because no fix in round 1 touches a measured path.
Every cell is 4 launches × 20 measured iterations. Android is primed to
`speed-profile` for `com.nitroui.bench` per D18, which the run header records.

Numbers are the runner's *median of launch medians*. A derived `nitro-ui ÷
expo-ui-shared-host` ratio carries a verdict only when both arms' launch-paired
ratio-to-`rn-core` columns are quiet (≤ 10 % MAD). Where either is noisy the cell is
printed **without** a verdict and gates nothing; those cells are reported, not judged.

### Runs

`bench/results/` is gitignored, so these six files are the raw evidence and are not in
the tree.

| Report | Device | Load avg 1/5 | Problems | Role |
| --- | --- | --- | --- | --- |
| `9b88217-dirty-android-20261023T131914Z.md` | `nitroui_t02` (API 35) | 5.36 / 6.82 | none | **Android, primary** (quiet) |
| `4341247-dirty-ios-20261023T133922Z.md` | iPhone 17 (canonical) | 13.94 / 12.80 **(busy)** | none | **iOS, primary** |
| `9b88217-dirty-ios-20261023T132628Z.md` | iPhone 17 (canonical) | 8.72 / 16.50 **(busy)** | none | iOS, complete repeat |
| `e9e2448-dirty-ios-20261023T122905Z.md` | iPhone Air (non-canonical) | 3.17 / 13.09 | none | iOS, the only *quiet* complete run |
| `9b88217-dirty-ios-20261023T130358Z.md` | iPhone 17 (canonical) | 6.65 / 21.27 | 2 lost launches | iOS, partial |
| `e9e2448-dirty-android-20261023T123343Z.md` | `nitroui_t02` | 9.25 / 20.79 **(busy)** | none | superseded by the quiet run |

Stated plainly: no iOS run here happened on a machine the runner calls idle. Both
complete canonical runs are busy-flagged, and the one quiet complete iOS run is on the
non-canonical iPhone Air, so per D15 the canonical iPhone 17 iOS baseline is **not**
established by this task. Android is canonical and quiet. The two complete canonical
iOS runs agree with each other, so the busyness costs verdicts rather than direction.

### iOS — canonical iPhone 17, primary run

| Cell | Metric | rn-core | per-control | shared-host | nitro-ui | ÷ shared | ÷ per-control |
| --- | --- | --- | --- | --- | --- | --- | --- |
| mount N=50 | presented | 15.99 ms | 24.29 ms | 32.63 ms | **15.99 ms** | 0.49× PASS — probe-suspect | 0.66× (nv) |
| mount N=50 | mounted | 6.40 ms | 16.67 ms | 4.83 ms | 14.17 ms | 2.93× (nv) | 0.85× (nv) |
| mount N=50 | JS commit | 4.51 ms | 2.20 ms | 1.10 ms | 1.04 ms | 0.95× (nv) | 0.47× (nv) |
| mount N=50 | JS CPU/op | 4.14 ms | 3.90 ms | 1.49 ms | 1.32 ms | 0.89× (nv) | 0.34× (nv) |
| mount N=50 | UI CPU/op | 1.84 ms | 32.39 ms | 11.90 ms | 13.86 ms | 1.16× (nv) | 0.43× (nv) |
| update N=50 | presented | 16.11 ms | 16.14 ms | 16.10 ms | 16.12 ms | **1.00× tie** | 1.00× tie |
| update N=50 | mounted | 2.70 ms | 5.58 ms | 2.99 ms | 10.33 ms | **3.45× MISS** | 1.85× (v) |
| update N=50 | JS commit | 1.88 ms | 1.59 ms | 889 us | 906 us | 1.02× (v) | 0.57× (v) |
| update N=50 | JS CPU/op | 2.03 ms | 5.37 ms | 1.24 ms | 1.09 ms | **0.88× PASS** | 0.20× PASS |
| update N=50 | UI CPU/op | 2.92 ms | 15.32 ms | 7.30 ms | 10.49 ms | **1.44× MISS** | 0.68× PASS |
| memory N=200 | bytes/inst | 49.2 KiB | 270.8 KiB | 152.7 KiB | 206.9 KiB | **1.35× MISS** | **0.76× PASS** |

`(nv)` = no verdict because one of the two columns was noisy within the run; `(v)` =
verdictable but not a D15 gate metric.

### Android — `nitroui_t02`, quiet

| Cell | Metric | rn-core | per-control | shared-host | nitro-ui | ÷ shared | ÷ per-control |
| --- | --- | --- | --- | --- | --- | --- | --- |
| mount N=50 | presented | 117.88 ms | 251.89 ms | 97.41 ms | 108.03 ms | 1.11× (nv) | 0.43× (nv) |
| mount N=50 | mounted | 69.69 ms | 147.75 ms | 67.06 ms | 78.21 ms | 1.17× (nv) | 0.53× (nv) |
| mount N=50 | JS commit | 16.60 ms | 55.59 ms | 11.66 ms | **6.19 ms** | 0.53× (nv) | 0.11× (nv) |
| mount N=50 | JS CPU/op | 18.24 ms | 56.29 ms | 15.66 ms | **7.86 ms** | 0.50× (nv) | 0.14× (nv) |
| mount N=50 | UI CPU/op | 39.79 ms | 179.89 ms | 43.19 ms | 58.58 ms | 1.36× (nv) | 0.33× (nv) |
| update N=50 | presented | 67.14 ms | 128.13 ms | 104.91 ms | 71.40 ms | **0.68× PASS** | **0.56× PASS** |
| update N=50 | mounted | 51.14 ms | 50.13 ms | 45.30 ms | 50.67 ms | 1.12× (nv) | **1.01× tie** |
| update N=50 | JS commit | 13.52 ms | 18.22 ms | 11.30 ms | **8.28 ms** | **0.73× PASS** | 0.45× PASS |
| update N=50 | JS CPU/op | 12.30 ms | 20.21 ms | 12.63 ms | **8.93 ms** | 0.71× (nv) | 0.44× PASS |
| update N=50 | UI CPU/op | 19.00 ms | 81.03 ms | 30.31 ms | 45.51 ms | 1.50× (nv) | 0.56× (nv) |
| memory N=200 | bytes/inst | 76.7 KiB | 222.5 KiB | 81.6 KiB | 164.5 KiB | **2.02× MISS** | **0.74× PASS** |

The whole Android `mount` cell is noisy (nitro-ui `presented` spread 24.3 % MAD), so
nothing in it is gated; its ratio-to-`rn-core` for `presented` is 0.95×, i.e. the same
as plain React Native.

### Against D15 (mount presented, UI CPU, memory)

| Run | mount presented | mount UI CPU/op | memory |
| --- | --- | --- | --- |
| iPhone 17, primary | 0.49× PASS — probe-suspect | 1.16× (nv) | **1.35× MISS** |
| iPhone 17, repeat | 0.49× PASS — probe-suspect | 1.05× (nv) | **1.36× MISS** |
| iPhone 17, partial | 0.66× (nv) | **1.22× MISS** | **1.39× MISS** |
| iPhone Air, quiet | 0.65× (nv) | 1.20× (nv) | **1.34× MISS** |
| `nitroui_t02`, quiet | 1.11× (nv) | 1.36× (nv) | **2.02× MISS** |

- **mount presented: not demonstrably met.** It is below shared-host everywhere it was
  measured and verdictable at 0.49× in both complete canonical runs, but the nitro-ui
  column carries `presentedBeforeMount = 11/80`, and `docs/architecture/benchmarks.md`
  calls a column with a non-zero counter a broken probe rather than a result. So the
  runner's PASS stands as printed, and it is labelled **probe-suspect** here: treat the
  0.49× as a direction, not as a met gate metric. Against per-control it is 0.43–0.66×,
  also unrated for the same reason.
- **UI CPU: missed where measurable.** The one verdictable mount value is 1.22×
  (from the run that lost two launches); every other mount cell was too noisy to
  judge, and the two canonical ones point the same way (1.16×, 1.05×). `update`
  UI CPU is verdictable at 1.44× iOS. Against per-control every UI CPU cell is well
  below (0.33–0.68×).
- **memory: missed against shared-host wherever it is verdictable** — 1.34–1.39× on
  iOS, 2.02× on Android — and met against per-control (0.74–0.78×).
- Not gated by D15, but worth reading: JS commit and JS CPU/op sit at or below
  shared-host in every cell (0.53–1.02× and 0.50–0.89×), and the real structural gap
  on iOS is
  `update mounted` at 3.10–3.45× shared-host.

**So Button does not meet D15**: no gate metric is demonstrably met — memory misses
everywhere it can be judged, mount UI CPU misses where measurable, and mount presented's
only verdictable value comes from a probe-suspect column. All three are
below `expo-ui-host-per-control`. Per D15 and D19 this comes with an explanation and
follow-up items for the reviewer, and is not chased further in this task.

### Why the numbers are what they are

- `expo-ui-shared-host` amortises **one** hosting subtree across all N buttons.
  nitro-ui gives every button its own Hybrid View: a Fabric shadow node, its own
  `UIHostingController` / `AbstractComposeView`, its own view model and sizing-cache
  entry. Memory and UI CPU/op are exactly the columns that bill for that, so the gap
  is T10's architecture measured rather than hidden. Read the same trade the other way
  and per-control costs 1.3× (memory) to 5× (update JS CPU/op) what nitro-ui costs.
- The iOS `mounted` gap (14.17 ms for 50 buttons, and the same shape in `update`) is
  **not** the first-frame fallback → correction round-trip. `bench/src/runner.ts` runs
  five warmups before it measures, the sizing cache is process-global and outlives the
  mounts, and the `mount` cell holds `value` constant while `update` only toggles
  `'Save'`/`'Saved'` — so every *measured* iteration hits an exact cache entry and makes
  **zero** corrections. Nothing in the measured window pays for a fallback.
- What is left is the per-instance synchronous measure, as a **hypothesis** (not
  measured): on update each of the 50 buttons runs `layoutIfNeeded` + `sizeThatFits`
  inside `commit()` — that is what `noteContentSizeMayHaveChanged()` buys — and then a
  second `sizeThatFits` from `layoutSubviews`, because the bounds moved
  (`NitroSwiftUIHost.swift:165-172`); on mount, the measure in `didMoveToWindow` costs
  the same. shared-host lays out natively in one pass and never pays it. Neither T14's
  early fallback registration nor `prewarmKeys` removes any of this, so neither is
  expected to close the gap. The way to settle it is a `sizingStats()` delta per launch
  (recorded as a follow-up).
- The declared fallback is one size for five variants, so a *cold* mount of anything
  that is not the middle-sized variant is corrected on a later frame. That is the D17
  contract, and it is spent on the warmups rather than inside the measured window.

## Acceptance

| Item | State |
| --- | --- |
| `bun run check` | green on the final tree - all thirteen steps: typecheck, bench typecheck, lint, format, unit tests, native ASan, `perf:renders` (Button 6/6, Switch 6/6), nitrogen, autolinking, prepare, api-extractor, publint, manifest |
| Harness green on both platforms, including R3 | 11/11 iPhone Air, 11/11 `nitroui_t02` at round 0; 70/70 per platform (Button 12/12) on the fix-round-1 tip |
| Bench tables in report | both platforms, above |
| Screenshots iOS + Android, light + dark | `docs/tasks/G2-button/` |
| `nuiSizingKey` + `setFallback` per sizing.md | done |
| R3 test owned by G2 (D16) | done, both platforms |
| Example screen + smoke app + api-extractor report | done |

## Known issues and follow-ups

**Known issues**

- **The iOS press is asserted at the callback, not at the screen.** The harness
  synthesises a `UITouch` with no HID event behind it: RN's `RCTTouchHandler` accepts
  that (the test's `Pressable` barometer fires on the same call) and SwiftUI's `Toggle`
  accepts it, but SwiftUI's `Button` gesture environment rejects it in all four styles
  this control uses. Android's half uses a real synthetic tap and does reach Compose. A
  HID-level tap was attempted with `agent-device` 0.21.18 against the example app on
  iPhone 17 — press by ref, by `testID`, and by coordinate — and none of them changed
  app state, not even the RN tab `Pressable` or the hosted SwiftUI `Toggle`. So this
  environment cannot press a button at all, and a human confirmation of a real tap on
  the example screen is still outstanding.
- **`presentedBeforeMount = 11/80` on the nitro-ui iOS mount cell** (per-control
  27/80). No samples were dropped (`n = 80`), so the runner still gates the column, but
  `docs/architecture/benchmarks.md` treats a non-zero counter as a probe artefact: the
  mount `presented`/`mounted` pair is one measurement here, not two. A native host can
  present before JS reports mounted, which is the ordering this counter exists to catch.
- **No iOS verdict is canonical-quiet.** Both complete iPhone 17 runs are busy-flagged
  (load 13.94 and 8.72 against the runner's 7.0 ceiling), so D15's "first task that
  holds that device on an idle machine" condition was never satisfied. The numbers are
  consistent across the two runs and across the quiet iPhone Air run; only their
  verdict status suffers.
- **One declared fallback for five variants** (`77 × 35` pt / `91 × 48` dp), measured
  and deliberately the middle of the table. Anything that is not the middle-sized
  variant is corrected on a later frame; that is the D17 contract, not a bug, but it is
  the reason the first frame is never the final one.

**Follow-ups (recorded per D19, not chased)**

- Memory and per-op UI CPU against `expo-ui-shared-host`: closing the D15 gap needs
  host sharing or batching across siblings, which is an architecture task (T10's shape),
  not a Button task. The reviewer decides whether it blocks the 0.1 bar.
- Record memory per host object (Fabric shadow node vs hosting controller vs view model
  vs sizing entry) in the bench, so the wrapper cost is separable from the
  SwiftUI/Compose cost. Without that split this column cannot be acted on.
- iOS `mounted`: re-measure the `mounted`/UI CPU gap with a `sizingStats()` delta per
  launch to confirm the mechanism above before optimising it. The measured iterations
  make zero corrections, so `prewarmKeys` (D16) and T14's early fallback registration
  are not expected to move the 3.10–3.45×.
- The canonical iPhone 17 iOS perf baseline is still unrecorded (D15). Whoever next
  holds that device on an idle machine should record Button and Switch in one pass.
- Android's `mount` cell was noisy end-to-end (nitro `presented` 24.3 % MAD); a re-run
  on a cold emulator would let those arms carry verdicts.
- Manual HID tap confirmation on iOS (see Known issues), ideally as a harness capability
  rather than a human step: a touch injector that sets an HID event.

Recorded from the G2 review (one line each, not chased):

- The sizing key joins free-form fields with `|`, so two field splits can collide
  (`Button.tsx:132`); length-prefixing the free-form parts would close it.
- iOS runs two `sizeThatFits` per size-affecting change — one in `commit()`, one from
  `layoutSubviews` after the bounds move (`NitroSwiftUIHost.swift:166-173`), and for
  `intrinsic` the second one is not needed.
- Android allocates `PaddingValues` (`HybridNitroUiButton.kt:331-339`),
  `Modifier.semantics` (`:367`) and `Modifier.heightIn` (`:372`) per recomposition;
  hoist them to constants.
- Android's `onClick` captures `model.onPress` at composition
  (`HybridNitroUiButton.kt:388`, used at `:392` onwards); read it at click time as iOS does.
- iOS `outlined`'s `Capsule().strokeBorder` overlay takes hits on its 1 pt ring — it needs
  `.allowsHitTesting(false)` (`HybridNitroUiButton.swift:102-105`).
- The "keeps a caller width in charge and truncates the label" test asserts the width and
  never asserts the truncation (`Button.harness.tsx:891`).
- The iOS press is still asserted at the callback rather than on screen; T15 owns the
  real-input check.
- Settle F2's mechanism by re-measuring the iOS `mounted`/UI CPU gap with `sizingStats()`
  deltas per launch.
- Per-`(variant, size)` declared fallbacks rather than one size for all five variants,
  now that T14 registers fallbacks at startup.

Recorded in fix round 1 (one line each, not chased):

- F1's reset is armed at the key change and fires at the layout that carries the new box,
  so a key change whose new configuration measures the *current* box never fires it; the
  engine has no reason to move the box, so nothing is stale, but the dedupe still holds
  the previous configuration's size.
- `Sizing.harness.tsx:319` reads `measureContent()` synchronously right after
  `waitForTestId` while the sibling tests poll; it went red once at load average 17 and
  green on every rerun. It should poll like them (T11's suite, not this task's).
- The harness accepts an `HARNESS_APP_PATH` older than the sources, which silently tests
  the previous tree; a freshness check like bench's `locateArtifact` would have caught
  the stale-app trap below.

## Fix round 1

The review returned MERGE-AFTER-SMALL-FIXES with five fixes. The review file was
uncommitted, so it went in first (`d2059bc`), then F5's merge (`c186e3c`), then F1–F4.

### Step 0 — the merge (F5)

`c186e3c` merges `main` (`7d3c5c1`) in: Slider (G1), FIX1, T14's startup-registered
declared fallbacks, the Android flush `postInvalidateOnAnimation()` draw request, and the
amended D17. Two places needed judgement rather than a text resolution:

- **The bench `--component` collision, resolved by porting, not by keeping.** Main
  encodes the component in the scenario cell (`mount.slider`, `componentOf`/`scenarioFor`,
  `splitScenario`, `--component` filtering cells); this branch encoded it in the arm name
  (`nitro-ui-button`, `COMPONENTS`, `controlImplementation`). Button now uses main's
  mechanism: `mount.button`, `update.button` and `memory.button` cells, the four arms
  dispatch on `component`, and the `-button` arms plus `COMPONENTS` and
  `controlImplementation` are deleted. The five bench-gate tests came across as the
  scenario form: `divides a Button arm by the Button control, never the Switch control`,
  `is silent when nothing changed`, `fails conclusively when the Button arm doubles`,
  `never gates a Button reference arm`, and `schedules one complete component per
  --component, never a mix`. All 33 `bench-gate` tests are green in `bun run check`. `pod install` and both native builds were re-run afterwards.
- **T14's `NitroUiDeclaredFallbacks` registers Button's fallback on both platforms**
  (`HybridNitroUiButton.declareFallback()` on both platforms, each reached from
  `NitroUiDeclaredFallbacks.registerAll()`, with `init` left as the backstop) — which is
  what retired the "the first Button of a process lays out at 0×0" comments the review
  listed as a follow-up — the behaviour they described is now the declared fallback, and
  the comments say so.

Bench numbers in this report are **measured on the pre-merge harness** and are labelled as
such where they appear; none of F1–F4 touches a measured path, so no cell was re-run.

### The required fixes

| # | Fix | Notes |
| - | --- | ----- |
| F1 | **A key change that keeps the size left the box at the fallback, on both platforms.** Each host skips a report within 0.5 of the last size it reported, and nothing reset that on a key change, so the report that would undo the fallback was the one skipped. | One harness test, `re-reports a key change that keeps the size (R3)`, shown red on both platforms; the host work is under **F1** below. |
| F2 | **The iOS `mounted` explanation was wrong.** It blamed the first-frame fallback → correction round-trip. `bench/src/runner.ts` warms up 5 iterations before measuring and the sizing cache is process-global, so every *measured* iteration hits an exact entry and makes **zero** corrections. | Rewrote both bullets: the round-trip is spent in the warmups, and what is left (per-instance synchronous measure: `layoutIfNeeded` + `sizeThatFits` in `commit()`, a second `sizeThatFits` from `layoutSubviews`, the `didMoveToWindow` measure on mount) is stated as a **hypothesis** with `sizingStats()` deltas named as the way to settle it. The follow-up no longer claims that is where the 3.1–3.45× should go. |
| F3 | **"mount presented: met" rested on a column the bench docs call a broken probe** (`presentedBeforeMount = 11/80`). | The three `0.49× PASS` cells are now `0.49× PASS — probe-suspect`, the per-run summary says "not demonstrably met", and the verdict reads **no gate metric is demonstrably met**. The overall "does not meet D15" stands. |
| F4 | **Stale doc claims.** The R3 title row implied frame-exactness the test does not assert; `button.md` said Android is never stale for a prop change; two line refs pointed at the wrong lines. | Title row now says the box *reaches* each size and that frame-exactness is only the warm half via `warm.corrections == 0`. `button.md` now states staleness per *configuration* (cold may show the fallback for one frame, warm shows none) plus a paragraph on the key-change reset. Refs fixed to `Button.tsx:126-133` + `:215` and `:146`. |
| F5 | **Merge, and register Button's fallback with T14's mechanism.** | Above, `c186e3c`. |

### F1 — what the fix actually had to be

The review's shape — a small hook off the `nuiSizingKey` setter that clears the host's
`lastReportedSize`, with iOS also setting its may-have-changed flag — was built first and
measured on both platforms. It is enough on one platform and not on the other:

- **iOS: green as written.** `12 passed` with the immediate reset
  (`/tmp/G2r1-literal-ios.log`).
- **Android: green for F1, red for two tests that already existed.** `2 failed, 10
  passed`, both R3 warm tests, `expected 4 to be +0` on `warm.corrections`
  (`/tmp/G2r1-literal-android.log`). A key change cannot make Compose re-measure, so the
  first report after the reset comes out of a measure taken while the engine still holds
  the *previous* key's box — and that is a correction charged against a configuration
  that was already exact, which D17 forbids.

So the hook keeps the review's call site but *arms* rather than acts, and each host acts
when the layout carrying the new key's box arrives. Both platforms take the deferred form
so the hosts share one rule; iOS is not obliged to, and is measured to pass either way.

- **iOS** — `NitroSwiftUIHost.noteSizingKeyChanged()` sets `sizingKeyChangePending`
  (guarded: an instance that has never measured has reported nothing to reset), and
  `layoutSubviews()` consumes it inside the existing `hostedView.frame != bounds` branch,
  where the measure is already armed, clearing `lastReportedSize` alongside it. Cleared in
  `prepareForRecycle()`.
- **Android** — the same flag, consumed in `onLayout` under `changed`. `changed` matters
  twice: it proves the engine answered, and a key change that moved no box has nothing to
  correct. Cleared in `prepareForRecycle()`.

**Android needs a measure as well as a reset — measured, not assumed.** `onLayout` also
bumps `remeasureToken`, a `mutableIntStateOf` that `NitroUiMeasuredRoot` reads inside its
measure block; observing snapshot state there is what marks the node measure-dirty,
because Compose leaves a mounted control alone when only its box moved (T14's finding) and
a report only ever comes out of a measure. With that bump removed and nothing else
changed, the new test fails on its own — `1 failed, 11 passed`
(`/tmp/G2r1-notoken.log`) — while both warm R3 tests stay green: the box moved, Compose
noticed nothing, and there was no report for the reset to let through.

### Every round-1 test shown to fail

Three trees were measured, each built fresh on both platforms and each artifact checked
against its sources (`stat` for the APK, and
`strings -a …debug.dylib | grep -c sizingKeyChangePending` for the iOS app, which is how
the stale-app trap below was found):

| Shape | Platform | Result |
| ----- | -------- | ------ |
| **no fix** — the four native files stashed, test and docs left in place | iOS iPhone 17 (app 16:23, 0 matches for the new symbol) | **FAIL** — `re-reports a key change that keeps the size (R3)`, `expected true to be false` at `expect(sameSize(box, WRONG_SIZE)).toBe(false)`; `1 failed, 11 passed` (`/tmp/G2r1-verify-ios-RED.log`) |
| no fix | Android `nitroui_t01` (APK 16:23) | **FAIL** — the same assertion, same counts (`/tmp/G2r1-verify-android-RED.log`) |
| **the review's literal shape** — clear `lastReportedSize` in the setter, iOS also setting may-have-changed | iOS | **PASS** — `12 passed`, so iOS needs no deferral (`/tmp/G2r1-literal-ios.log`) |
| the review's literal shape | Android | **FAIL on two existing tests** — `re-measures when the title changes (R3)` and `re-measures when the size changes (R3)`, `expected 4 to be +0` on `warm.corrections`; `2 failed, 10 passed` (`/tmp/G2r1-literal-android.log`) |
| **shipped shape minus the re-measure bump** | Android | **FAIL on the new test alone** — `1 failed, 11 passed`, both warm R3 tests green (`/tmp/G2r1-notoken.log`) |
| **shipped shape** | iOS | **PASS** — `12 passed` (`/tmp/G2r1-verify-ios-GREEN.log`) |
| shipped shape | Android | **PASS** — `12 passed` (`/tmp/G2r1-verify-android-GREEN.log`) |

The test poisons three configurations (`filled`/`elevated`/`filled`+`star`) with
`12.5 × 71.5`, mounts `filled` "Sticky", waits for its own size, then rerenders to the
reviewer's per-platform repro — `variant="elevated"` on iOS, `systemImage="star"` on
Android — and asserts the box is not the poisoned guess, is the measured size, and that at
least one correction happened. Both repros keep the *size* and move only the
configuration, which is precisely what makes the dedupe apply.

### Gates on the final tip

| Gate | Result |
| ---- | ------ |
| `bun run check` | **exit 0** — typecheck, bench typecheck, lint, format, 117 Jest tests (8 suites, 33 of them `bench-gate`), `test:native` (`sizing.test` 187 checks plain and 187 under ASan + UBSan, plus `clock.test`, `handshake.test` and `slider-value.test`), `perf:renders` (Button 6/6, Slider 6/6, Switch 6/6, no redundant renders), nitrogen no drift (101 generated files, 12 patched views), autolinking, bob build, api-extractor, publint, manifest |
| `bun run test:native:android` | **36 tests, 0 failures** — `NitroUiSliderValueTest` 12, `SliderModelTest` 12, `NitroUiControlledValueTest` 9, `NitroUiWeakKeyTest` 3 |
| iOS harness | **70 passed, 5 suites** (Button 12, Switch, Slider, Sizing, ColdSizing) on iPhone 17, app 16:30 — newer than every iOS source, and carrying the fix (`/tmp/G2r1-final-ios-full.log`); the same 70 also passed on an earlier rebuild (`/tmp/G2r1-ios-full.log`) |
| Android harness | **70 passed, 5 suites** on `nitroui_t01`, APK 16:30 — newer than every Android source (`/tmp/G2r1-final-android-full.log`); also 70 on an earlier build (`/tmp/G2r1-android-full.log`) |
| Bench | not re-run — F1 changes the report path only for a key the engine cannot answer, and no bench cell changes a configuration mid-iteration; numbers stay labelled pre-merge harness |

One iOS `Sizing` run in this round went red — `intrinsic (T11) › lays a cold Switch out at
the size the control measures`, `expect(content).not.toBeNull()` at
`example/__tests__/Sizing.harness.tsx:319`. It is not this task's suite (`Sizing.harness.tsx`
is byte-identical to main), the sizing trace in that same run is correct
(`box=61.00x28.00`, `laidOut → drew → corrected → drew`, `measurements: 2`,
`corrections: 1`), the failure is a synchronous `measureContent()` read that polls in every
sibling test, and it passed on every rerun including the 70/70 full suite above (load
average was 17 with T15 running). Recorded as a follow-up rather than fixed, since touching
it means a both-platform change to another task's suite.

### Gotcha worth recording

`bun run build:ios` writes to DerivedData, not to `example/ios/build`. A
`HARNESS_APP_PATH` pointing at the latter keeps running a **stale app**: one red/green pair
in this round was worthless because both runs exercised a pre-merge binary. Check the
artifact is newer than the sources, and confirm a new symbol reaches the binary with
`strings -a "$APP/NitroUiExample.debug.dylib" | grep -c <newSymbol>` before believing any
iOS red or green.

### Device discipline

iOS ran on the assigned iPhone 17 (`F08675D3…`), which was already booted when this round
started and was left running. Android ran on the assigned `nitroui_t01`
(`emulator-5570`, adb server 5041, `METRO_PORT=8293`), which this round started and shut
down with `adb -s emulator-5570 emu kill`. T15's iPhone Air and `nitroui_t02` (adb 5042,
Metro 8294) and `emulator-5560` were not touched, and no `adb kill-server` was run on the
default port. No process was killed by name.

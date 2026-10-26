# R2 — Release readiness 2: v0.1 docs, smoke, baselines: report

**Branch:** `task/R2-release-0.1` (from `main` at `5966064`) · **Devices:** iPhone 17
`F08675D3-A32B-4F88-BC81-02D7E0CB797E` (the canonical iOS bench device) and AVD
`nitroui_t01` (`emulator-5570`, private adb server `5041`), Metro `8293` for the device
suites — both booted by hand for this task and shut down at the end. iPhone Air,
`nitroui_t02` and `emulator-5560` were not touched. · **Platforms:** both.
· **Not done, deliberately:** no push, no tag, no publish, no repo creation.

## Verdict

All six brief items are done, and the one that could not be closed is item 5 in the way D18
wants it closed: **every bench run refused to mint a baseline, for a reason that has nothing
to do with this machine** — `baselineBlockers()` requires `--plan full` with ≥ 8 launches, so a
quick plan can never be a baseline however quiet the machine is. Ten quiet, complete,
verdict-carrying quick runs are in `bench/results/`, the final ratio table is below and the
README now quotes it, and committing baselines needs one `--plan full --launches 8` device
hold that this task's brief does not authorise (`--force` was not used).

1. **README rewritten** for someone installing 0.1 (pitch, component table, requirements,
   install + consumer table, five usage examples, Sizing, Performance, Known limitations), and
   the examples are now *gated*: `bun run readme:check` fails when a README block stops being
   byte-identical to the typechecked `example/src/readme-examples.tsx`.
2. **Docs audited.** All five `docs/components/*.md` props tables match `src/` exactly (checked
   mechanically, §2); `CHANGELOG.md` starts at `0.1.0`; three speculative or self-referencing
   claims were removed from `progress.md`, and `switch.md` / `button.md` gained the
   `Accessibility` section the other three docs already had.
3. **Consumer smoke green on every row the README ticks**, re-run for this release on my
   devices: Expo SDK 58 both platforms (355 s), RN CLI 0.88.0 both (175 s), RN CLI 0.86.3
   Android (82 s). §3 says what the smoke test actually asserts — a ready line, not a testID
   query, which is the pre-existing contract in `scripts/smoke/App.tsx`.
4. **Packaging clean:** 332 files in `npm pack`, zero matches for `example` / `bench` / `docs` /
   tests / build output, and everything that must ship does ship. §4 also records a real
   ordering trap found here: `manifest:check` counts 333 because `lib/typescript/src/tsdoc-metadata.json`
   is emitted by api-extractor, not by bob, so a pack that does not run api-extractor ships one
   file less than the manifest says.
5. **Baselines: measured, not minted** (10 runs, all `problems: 0`, Android `speed-profile`
   primed in all five artifacts with 1 attempt each; refusal text verbatim in §5).
6. **Gates green:** `bun run check` (exit 0, with `readme:check` appended), 99 harness tests on
   each platform, real-input 4/4 on each platform (Android needed a second attempt; §6 says why).

## 1. README (`README.md`)

Rewritten in place, keeping the parts that were already verified (Requirements, the two install
routes, the 0.86.3-iOS caveat) and dropping the pre-release banner. Structure now: pitch →
Components → Requirements → Installation (+ consumer table) → Usage → Sizing → Performance →
Known limitations → How it works → Contributing → License.

The Performance section is **this task's own measurements** (§5), per the brief, and it says
what is a verdict and what is not:

- iOS `mount presented` never carries a verdict on any component (the frame probe reports
  frames latched before the mount on every arm), so 0.31× is printed as a measurement;
- the Android memory miss is stated as the consistent failure (1.09–2.74×, Switch 141 KiB vs
  52 KiB per instance) with the one-host-per-control reason (T12/T13) and the 0.2 shared-`<Host>`
  decision (D19);
- the old line "we are below `expo-ui-host-per-control` on **every** gated metric" is gone: it
  is true for presented / UI CPU / memory, but mount `mounted` is 1.12–1.41× that arm on iOS.
  Saying so is cheaper than having a reviewer find it.

Usage examples: five blocks, each fenced ` ```tsx name=<region> `, each byte-identical to a
`// #region <region>` block in `example/src/readme-examples.tsx`, a file `tsconfig.json`
already covers via `example/src`. `bun run typecheck` therefore typechecks the documentation,
and `scripts/readme-examples-check.mjs` (new, wired into `check` after `manifest:check`) keeps
the two copies equal. Prettier preserves the `tsx name=…` fence info string, so formatting does
not break the equality.

Proof the gate can fail — run against the committed README and reverted:

1. rename `onValueChange` → `onChange` in the README Switch block only →
   `README examples drifted (1): switch`, first differing line quoted, exit 1;
2. replace the Progress block with a stub → drift reported for `progress`, exit 1;
3. restore → `README examples: 5 blocks match example/src/readme-examples.tsx`, exit 0.

`CONTRIBUTING.md` gained a `readme:check` row, the updated `check` chain, and a short
"Changing a README example" subsection.

## 2. Component docs and CHANGELOG

Props tables were compared mechanically against the declared interfaces (extract every
`prop?:` from `src/components/<Name>/<Name>.tsx`, extract every `` | `prop` `` row from the
doc's `## API` table):

| Doc | Props in TS | Rows in doc | Missing in doc | Extra in doc |
| --- | --- | --- | --- | --- |
| `switch.md` | 8 | 11 | none | `style`, `testID`, `accessibilityLabel` |
| `slider.md` | 12 | 15 | none | same three |
| `progress.md` | 6 | 9 | none | same three |
| `button.md` | 9 | 12 | none | same three |
| `segmented-control.md` | 8 | 11 | none | same three |

The three "extras" are inherited `ViewProps` rows the docs document on purpose. The one real
drift was `switch.md` missing the internal `nuiTestWidth` prop, added. All five docs have the
same six headings (API / Platform mapping / Sizing / Accessibility / Behaviour notes / Limits);
`switch.md` and `button.md` were missing `## Accessibility` and gained one written from what
those docs already state elsewhere. `progress.md` also lost three claims the G3 re-review
flagged: two "(see the next bullet)" self-references, and the guess that iOS
`UIProgressView`'s indeterminate stripes "need more height" — replaced with what is actually
true and measurable (`isIndeterminate` is read-only and never true, so the style never
animates), and its platform-mapping table row corrected to say the track renders empty.

`CHANGELOG.md` is new: `0.1.0 — 2026-10-24`, the five components, the core they sit on, and a
"Not in 0.1" list (Picker, DatePicker, shared `<Host>`) so the next release has somewhere to
move from.

## 3. Consumer smoke (brief step 3)

`scripts/smoke/App.tsx` already renders all five components, each with a `SMOKE-` testID —
G3 added `SMOKE-progress` and G4 added `SMOKE-segmented-control` (`430a9e7`, `aa06711`), so
there was nothing to add and the app is byte-unchanged here. **What the smoke assertion is**:
one log line (`NITRO_UI_SMOKE_READY`, plus a core-call line), a crash check, and a screenshot.
The testIDs are *not* queried — the runner has no hierarchy query on either platform, and the
contract in the file's header says the ready line is the readiness signal on both platforms.
Making the assertions read testIDs would be a harness change on both platforms and is recorded
as a follow-up rather than done half-way here. The five components are still covered by it:
they render inside a `ScrollView` that has to complete a frame before the ready colour paints,
and a component that throws on mount never turns the screen red.

Runs, all on my assigned devices, Release builds, `npm`, from the packed tarball:

| Run | Result | Timings (s) | Artifacts |
| --- | --- | --- | --- |
| `smoke:expo` SDK 58, `PLATFORM=both` | **PASSED** | create 7 · install 14 · prebuild+pod 83 · ios-build 97 · ios-run 11 · android-build 133 · android-run 3 · **total 355** | `expo-20261024-014032-72822` (`expo-58-ios.png`, `expo-58-android.png`) |
| `smoke:rn-cli` RN 0.88.0 cli 20.2.0, `PLATFORM=both` | **PASSED** | init 3 · install 22 · pod 19 · ios-build 46 · ios-run 6 · android-build 70 · android-run 3 · **total 175** | `rn-cli-20261024-014636-79250` (2 screenshots) |
| `smoke:rn-cli` RN 0.86.3, `PLATFORM=android` | **PASSED** | init 2 · install 7 · android-build 65 · android-run 3 · **total 82** | `rn-cli-20261024-014945-81356` |

The first Expo attempt (`expo-20261024-013435-71151`) stops mid-`prebuild` with no error in its
log: the shell session running it was closed, so that artifact is an aborted run, not a failed
one. The row above is the complete re-run of the identical command.

The 0.86.3 Android row used the same tarball as the 0.88.0 run (`SKIP_PACK=1`) because nothing
in `src/`, `ios/`, `android/` or `cpp/` changed after it was packed — only docs. iOS 0.86.3
remains `n/a`: a fresh 0.86.3 app hangs at launch on this machine's iOS 27 runtime with or
without this library, so that row is CI-only and the README says so instead of ticking it.
The README's consumer table now ticks exactly these three runs.

## 4. Packaging check (brief step 4)

`bun run smoke:pack` → `/tmp/nitro-ui-smoke/tarballs/react-native-nitro-ui-0.1.0.tgz`, 5 s,
exit 0. Listing kept at `/tmp/R2-tarball-final.txt`. **332 files**, 277 kB packed / 1.4 MB
unpacked:

| Top level | Files | | Top level | Files |
| --- | ---|---| --- | --- |
| `nitrogen/` | 138 | | `ios/` | 13 |
| `lib/` | 118 | | `cpp/` | 9 |
| `src/` | 29 | | `package.json`, `nitro.json`, `nitro-ui.sizing.json`, `README.md`, `NitroUi.podspec`, `LICENSE` | 6 |
| `android/` | 19 | | | |

- Nothing forbidden ships: `grep -E 'example|bench|docs/|__tests__|__mocks__|__fixtures__|build/|node_modules|\.test\.|\.perf-test\.|\.harness\.'` over the listing returns **0** matches —
  no `example/`, no `bench/`, no `docs/` (so no `docs/tasks/`), no test sources, no build output.
- Everything required ships: `nitrogen/generated`, `cpp/`, `ios/`, `android/` (source only), `lib/`,
  the podspec, `nitro.json`, and the sizing table `nitro-ui.sizing.json`.
- `etc/package-files.txt` did not need updating: the two files this task adds
  (`scripts/readme-examples-check.mjs`, `example/src/readme-examples.tsx`) are outside the
  published `files` list, which the check confirms.

**Ordering trap found (pre-existing, recorded not fixed):** `bun run manifest:check` on its own
fails right after a pack — `-lib/typescript/src/tsdoc-metadata.json is in the manifest but not
in the tarball`. Cause, proven here: that file is written by **api-extractor**, not by bob, and
`npm pack` runs `prepare` (bob), which wipes `lib/typescript` and rebuilds it without it. Run
api-extractor and `manifest:check` passes at 333 files; run `smoke:pack` (prepare + `npm pack`)
and the tarball has 332. `bun run check` is green because api-extractor runs earlier in the same
chain, and the release path runs `check` (`.github/workflows/ci.yml:33`, `release.yml:62`), so
the gate holds today — but the manifest is asserting a file that only exists in a tree where
api-extractor ran last. Follow-up filed in §Follow-ups.

## 5. Baselines (brief step 5, D18)

Ten quick runs, one per platform per component, last in the task order so the machine was as
quiet as it gets; every one passed `--update-baseline` so the guard's answer is on the record.
Node is the `.nvmrc` pin, tree clean (`8e80850`), no Metro, Release builds, Android ART primed
by the runner.

| Platform | Component | Plan/launches | Load1/5 at guard | ART | Incomplete launches | Duration | Results file |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ios | switch | quick/4 | 4.89/8.63 quiet | — | 0 | 270 s | `8e80850-ios-20261024T010650Z` |
| ios | slider | quick/4 | 4.58/6.24 quiet | — | 0 | 266 s | `8e80850-ios-20261024T011208Z` |
| ios | button | quick/4 | 3.43/4.92 quiet | — | 0 | 262 s | `8e80850-ios-20261024T011636Z` |
| ios | progress | quick/4 | 3.81/4.65 quiet | — | 0 | 261 s | `8e80850-ios-20261024T012059Z` |
| ios | segmented-control | quick/4 | 4.83/4.65 quiet | — | 0 | 305 s | `8e80850-ios-20261024T012520Z` |
| android | switch | quick/4 | 7.80/12.13 **busy** | `speed-profile`, primed, 1 attempt | 0 | 206 s | `8e80850-android-20261024T013258Z` |
| android | slider | quick/4 | 5.68/8.77 quiet | `speed-profile`, primed, 1 attempt | 0 | 205 s | `8e80850-android-20261024T013633Z` |
| android | button | quick/4 | 5.31/6.86 quiet | `speed-profile`, primed, 1 attempt | 0 | 208 s | `8e80850-android-20261024T014000Z` |
| android | progress | quick/4 | 5.52/4.54 quiet | `speed-profile`, primed, 1 attempt | 0 | 896 s | `8e80850-android-20261024T014329Z` |
| android | segmented-control | quick/4 | 4.00/4.42 quiet | `speed-profile`, primed, 1 attempt | 0 | 223 s | `8e80850-android-20261024T015828Z` |

Command shape (iOS shown; Android used `ANDROID_AVD=nitroui_t01 ANDROID_ADB_SERVER_PORT=5041`
and dropped `IOS_SIM_UDID`):

```sh
IOS_SIM_UDID=F08675D3-A32B-4F88-BC81-02D7E0CB797E \
  bun bench --platform ios --plan quick --component switch --update-baseline
# subsequent components on the same artifact: --skip-build
```

### The refusals, verbatim

Nine of ten printed exactly two reasons; the Android `switch` run — the first Android run,
measured seconds after its own Gradle build — additionally hit the busy-machine guard:

```
--update-baseline refused (pass --force to override):
  - the run used plan "quick", and a baseline needs "full" - quick-plan numbers are local feedback
  - the run used 4 launches per cell, and a baseline needs at least 8
```

```
--update-baseline refused (pass --force to override):
  - the run used plan "quick", and a baseline needs "full" - quick-plan numbers are local feedback
  - the run used 4 launches per cell, and a baseline needs at least 8
  - the machine was busy: load average 7.80 over 14 cores (ceiling 7.0)
```

The first two reasons are structural (`scripts/bench/lib.mjs:52-53`: `BASELINE_PLAN = 'full'`,
`BASELINE_LAUNCHES = 8`), so **no quick run can ever mint a committed baseline** no matter how
quiet the machine is. Per the brief: one attempt per platform per component, refusals recorded,
no retry loops, and `--force` not used. `bench/baselines/` still holds only `README.md` and
`renders.json`; getting D18's committed ratio baselines needs one dedicated
`--plan full --launches 8` hold per platform (~2× the launch count across every component, plus
the N=1/200 and leak cells), which is a scheduling decision for the human, not something to
squeeze into a release-readiness task. `--check` was then run offline (`report.mjs` re-renders a
results file without a device) against the last run of each platform, and both exit 1:

```
$ node scripts/bench/report.mjs bench/results/8e80850-ios-20261024T012520Z.json --check
--check: no baseline at bench/baselines/ios27-sim-iphone17.json. Create it with --update-baseline.

$ node scripts/bench/report.mjs bench/results/8e80850-android-20261024T015828Z.json --check
--check: no baseline at bench/baselines/android35-emu-pixel9.json. Create it with --update-baseline.
```

### Final ratio table

nitro-ui ÷ control, launch-paired medians computed with the runner's own
`pairedLaunchRatios()`; `mount` is N=50 and `memory` N=200.
ᴺ = the ratio's own launch spread is over 10 % (`NOISE_REL_SPREAD`), so the cell carries no
verdict. ᴾ = the frame probe counted frames latched **before** the mount in one of the two
cells, which is the runner's own signal that `presented` is measuring the wrong thing.
The target is ≤ 1.0×.

**iOS** — iPhone 17 simulator, iOS 27, `ios27-sim-iphone17`

| Component | ÷ `expo-ui-shared-host` presented / UI CPU / memory | ÷ `expo-ui-host-per-control` presented / UI CPU / memory | ÷ `rn-core` presented / UI CPU / memory |
| --- | --- | --- | --- |
| `switch` | 0.31ᴾ / **0.74** / **0.99** | 0.19ᴺ / **0.38** / **0.67** | 0.99ᴾ / 5.07 / 2.48 |
| `slider` | 0.34ᴾ / **0.81** / 1.44 | 0.27ᴾ / **0.43** / **0.87** | 1.00ᴾ / 20.88ᴺ / 39.55 |
| `progress` | 0.45ᴾ / 1.11 / 1.36 | 0.34ᴾ / **0.47** / **0.77** | 1.00ᴾ / 9.64ᴺ / 8.37 |
| `button` | 0.49ᴾ / 1.23ᴺ / 1.35 | 1.00ᴾ / **0.49** / **0.77** | 1.01ᴾ / 7.31ᴺ / 4.19 |
| `segmented-control` | 1.00ᴺ / **0.68** / **0.83** | 0.33ᴺ / **0.53** / **0.66** | 1.01ᴾ / 3.46 / 2.34 |

**Android** — `nitroui_t01`, API 35, `android35-emu-pixel9`, ART `speed-profile`

| Component | ÷ `expo-ui-shared-host` presented / UI CPU / memory | ÷ `expo-ui-host-per-control` presented / UI CPU / memory | ÷ `rn-core` presented / UI CPU / memory |
| --- | --- | --- | --- |
| `switch` | **1.00** / 1.64 / 2.74 | **0.94** / **0.56** / **0.76** | 1.00 / 1.55 / 2.63 |
| `slider` | 1.01 / 1.56 / 2.57 | **0.90** / **0.60** / **0.82** | 1.00 / 6.21 / 10.74 |
| `progress` | **0.95** / **0.93** / 1.61ᴺ | **0.75** / **0.40** / **0.56** | 1.00 / 2.80 / 2.60 |
| `button` | 1.01 / 1.52 / 2.50 | **0.66** / **0.41** / **0.81** | 1.00 / 1.75 / 2.46 |
| `segmented-control` | 1.31 / 1.28 / 1.09 | **0.72** / **0.52** / **0.67** | 1.02 / 1.34 / 1.25 |

Bold = meets the ≤ 1.0× target *and* carries a verdict. Nothing marked ᴺ/ᴾ is upgraded to a
pass anywhere, in this report or in the README.

What the numbers say, without spin:

- **iOS `mount presented` is un-verdictable everywhere**, on every control and against every
  arm, because `presentedBeforeMount` is non-zero in the nitro-ui cell in 39–80 of 80 samples
  (G4 measured the same on `segmented-control`, and the same probe counters are why G1/G2/G3
  refused to call 0.3× a pass). The direction is favourable; it is not a result.
- **Android mount UI CPU (1.28–1.64×) and memory (2.50–2.74× on three controls) are the
  standing misses**, exactly as T12 found and as the README says: Switch costs 141.4 KiB per
  instance where the shared host costs 52.0 KiB, Slider 161.4 vs 62.3 KiB, Button 187.6 vs
  75.3 KiB. Progress (130.7 vs 81.5 KiB) is the one whose ratio the runner noise-flagged
  (12.2 % launch spread), so it is not a verdict.
- **iOS memory is per-control, not uniform**: Switch is at parity (263.7 vs 265.0 KiB, 0.99×),
  SegmentedControl is 17 % *below* the shared host (362.8 vs 439.7 KiB — reproducing G4's 0.82×
  on the canonical device this time, which G4 could only measure on iPhone Air), and
  Slider / Button / Progress cost +44 to +80 KiB per instance more than the shared host.
- **Android `Progress` mount cells now meet** (0.95× / 0.93×, low spread) where G3's run had
  them all un-verdictable; the *update* cells are still not comparable — `missingMount=80,
  missingPresented=80` on `update.progress` for both Expo arms, so the runner prints `n/a` and
  its launch-paired ratio column for that row means "arbitrary work over nothing". Recorded,
  not quoted as a result, same as G3.
- **`mount mounted` is the axis that runs the wrong way on iOS**: 2.00–5.28× the shared host on
  all five, and 1.12–1.41× the per-control arm on the four cells that carry a verdict (Button's
  pair is noise-flagged, reading 3.06× shared-host / 0.91× per-control — so it is the one control
  where this axis may not be a miss at all). That is per-instance
  `UIHostingController` creation, already a follow-up from the G1 review, and it is why the
  README no longer claims we are below the per-control arm on every metric.
- **Update path is fine on both platforms** for presented (1.00× parity on iOS, 0.43–1.02× on
  Android, where Slider's 1.02× is the single miss) and for iOS UI CPU (0.73–0.87× except Button
  1.48×). Android update UI CPU is still above the shared host on all four controls whose update
  cell is comparable (1.01–1.87× — `Progress`'s update row is not comparable, see above), the
  same bill as mount.
- Against **`rn-core`** we are above the floor on UI CPU and memory everywhere, which is the
  expected shape (rn-core hosts nothing and draws fewer pixels); presented is 0.99–1.02× there,
  i.e. the frame budget is the same wall for everyone.

## 6. Gates (brief step 6)

All from a clean tree at `8e80850`, Node 24.18.0 (`.nvmrc`), the harness/real-input
entry points refuse Node 26 as of R1.

| Gate | Command | Result |
| --- | --- | --- |
| Static + unit + native | `bun run check` | **exit 0** — typecheck, bench:typecheck, lint (0 warnings), format, jest, perf:renders, `test:native` (ASan, both platforms' C++), nitrogen:check, autolinking:check, bob, api-extractor, publint --strict, manifest:check (333 files), **readme:check (new)** |
| iOS harness | `cd example && IOS_SIM_UDID=F08675D3-… METRO_PORT=8293 HARNESS_APP_PATH=$PWD/ios/build/Build/Products/Debug-iphonesimulator/NitroUiExample.app bun run harness:ios` | **7 suites / 99 tests passed**, 56.995 s |
| Android harness | `cd example && ANDROID_AVD=nitroui_t01 ANDROID_ADB_SERVER_PORT=5041 METRO_PORT=8293 HARNESS_APP_PATH=$PWD/android/app/build/outputs/apk/debug/app-debug.apk bun run harness:android` | **7 suites / 99 tests passed**, 58.211 s |
| iOS real-input | `IOS_UDID=F08675D3-… METRO_PORT=8293 bun run test:real-input:ios` | **4/4 controls passed** — switch 20.3 s, slider 36.8 s, button 22.2 s, segmented-control 35.0 s (XCUITest, OS-synthesised touches) |
| Android real-input | `ANDROID_AVD=nitroui_t01 ANDROID_ADB_SERVER_PORT=5041 METRO_PORT=8293 bun run test:real-input:android` | **4/4 controls passed** on the second attempt; the first attempt exited 1 (see below) |

Both harness runs printed `wall-clock gates off (HARNESS_TIMING=unset)` with load1 9.01 / 7.28,
so D21's timing budgets were reported and not judged; they also sit below the runner's own
refusal threshold (load1 ≥ 10). The suite count is the same 99 tests R1 saw — Button, Progress
and SegmentedControl suites are inside those 7 files.

**The Android real-input first attempt, in full:** every check reads on-screen `Text` from
`uiautomator dump`, and the dump the failing attempt left behind has `android:id/content`
containing a single empty `FrameLayout` — the app process was up (package
`nitroui.example`) but had not rendered, because the debug build was still waiting on its
first dev bundle from the runner's own Metro (log shows `BUNDLE ./index.js` started, then the
runner's SIGTERM). So the suite reported its first check missing, not a control misbehaving.
An immediate re-run of the identical command, with the Metro cache warm, passed 4/4 (151 s).
One retry, not a loop; the underlying flake is that the suite has no "first frame rendered"
wait before its first check, which is a follow-up.

## Files changed

- `README.md` — rewritten for 0.1 (brief step 1); Performance and the consumer table now quote
  this task's own runs.
- `CHANGELOG.md` — new, `0.1.0`.
- `CONTRIBUTING.md` — `readme:check` row, `check` chain, "Changing a README example".
- `docs/components/switch.md` — internal `nuiTestWidth` prop row, `## Accessibility`.
- `docs/components/button.md` — `## Accessibility`.
- `docs/components/progress.md` — three G3 re-review doc corrections.
- `example/src/readme-examples.tsx` — new: the five usage examples, typechecked, `#region` per block.
- `scripts/readme-examples-check.mjs` — new gate; `package.json` — `readme:check` + appended to `check`.
- `docs/tasks/R2-release-0.1.report.md` — this file.

## Decisions made

1. **README examples live twice, and a script holds them together** rather than one generated
   from the other. The typechecked file is the source of truth in review terms, but the README
   stays the file a human edits; the gate prints the first differing line and which side to copy.
2. **No baseline was forced.** `--force` would have written a quick-plan, 4-launch baseline
   under `bench/baselines/`, which is precisely the artifact D9/D18 refuse to treat as sound.
   The refusals are the result.
3. **The README quotes R2's numbers, not the merged reports'.** The brief says the Performance
   section uses the final ratio table, and mixing two commits' measurements in one table is how
   a doc stops being checkable. Where R2 disagrees with a merged report (Android `Progress`
   mount cells now meeting; `segmented-control` Android `presented` reading 1.31× against G4's
   0.88× PASS) the difference is stated in §5 instead of quietly picking the better number.
4. **`Progress` and `SegmentedControl` were not added to the smoke app** — they have been there
   since G3/G4. Editing them again would have churned a file whose contract says "add a
   component = add one line", and the missing thing (testID assertions) is a both-platforms
   harness change, recorded instead.
5. **iOS 0.86.3 stays `n/a`, Android 0.86.3 was re-run and ticked.** The Android row is cheap to
   re-verify (82 s) and it is a support claim in the README; the iOS row cannot be verified on
   this runtime at all, so labelling it is the honest move the README already made.

## Known issues

- Nothing is red. `bun run check`, both harness suites and both real-input suites are green on
  my devices; the two device baselines remain un-minted (structural, §5).
- `manifest:check` is order-dependent (§4): it asserts a file that only api-extractor writes, and
  `smoke:pack` (which runs bob via `prepare` immediately before packing) does not contain it.
- Android real-input has no wait for the app's first rendered frame, so a cold Metro cache turns
  into a check failure rather than a skip (§6).

## Follow-ups (not in scope, all observed here)

- **D18 still needs a device hold:** one `bun bench --platform <ios|android> --plan full
  --launches 8 --update-baseline` per device key to mint `ios27-sim-iphone17` and `android35-emu-pixel9`
  ratio baselines; quick plans cannot do it by design, and `--check` will keep saying "no
  baseline" until someone blocks that time.
- **`manifest:check` vs a real `npm pack`:** have `scripts/smoke/pack.sh` run api-extractor before
  packing, or run `manifest:check` with the same script set bob uses, or drop
  `lib/typescript/src/tsdoc-metadata.json` from `etc/package-files.txt`. Today the gate passes
  only because `check` runs api-extractor first in the same chain.
- **Real-input: wait for the first rendered frame** on Android (and iOS, same class) before the
  first check — e.g. poll `uiautomator dump` until `android:id/content` has a child — so a cold
  dev bundle cannot be read as a control failing.
- **Smoke assertions could read the five `SMOKE-` testIDs** (uiautomator / `simctl` hierarchy)
  instead of only the ready line; that is a both-platforms harness change.
- **`real-input` has no `Progress` coverage** — the suite asserts on rendered text and Progress
  renders none, so there is no check kind for it. It needs a render-check primitive, not a new control entry.
- **`useSizingId` leaks its ref entry on unmount, `Progress.tsx:168` passes a raw variant
  string where the union is expected, and `useSizingId` has no unit test of its own** — all three
  are from the G3 re-review, deliberately untouched here (R2 is docs/gates only), and all three
  are still open.
- **`nuiTestWidth` is now deletable**: G2's R3 test exercises a width constraint through public
  props, so the internal test prop in `switch.md` no longer earns its place in the API surface.
- **`HARNESS_TIMING` numbers only surface when an assertion fails**; D21 wanted them reported on
  every run, and today a green run prints only the header line.
- Android `SegmentedControl` `mount presented` is 1.31× here (quick plan, AVD `nitroui_t01`)
  against G4's **0.88× PASS** (full plan, AVD `nitroui_t02`, same `android35-emu-pixel9` device
  key). One quick run against one full run on a different AVD instance is not a regression claim,
  but 0.2's shared-`<Host>` work should re-measure that cell on the full plan rather than trust
  either number.

## Release notes draft

> ## react-native-nitro-ui 0.1.0
>
> First release with components. Five native controls — real SwiftUI and Jetpack Compose
> views hosted inside Nitro Hybrid Views, laid out by Yoga, with the platform control's own
> accessibility — plus the shared native core they are built on.
>
> **Components**
>
> - `Switch` — SwiftUI `Toggle(.switch)` / Compose Material 3 `Switch`. Controlled or
>   uncontrolled, `tintColor`, intrinsic size by default.
> - `Slider` — SwiftUI `Slider` / Material 3 `Slider`. `min`/`max`/`step`, `onSlidingStart` /
>   `onValueChange` / `onSlidingComplete`, step and range labels in the platform's locale.
> - `Progress` — `ProgressView` / Material 3 indicators. Linear or circular, determinate or
>   indeterminate, `trackColor` on Android.
> - `Button` — SwiftUI `Button` with five `buttonStyle`s / the five Material 3 button
>   composables. Filled / tonal / elevated / bordered / plain, three sizes, `systemImage` on iOS.
> - `SegmentedControl` — SwiftUI segmented `Picker` / `SingleChoiceSegmentedButtonRow`. A parent
>   decides whether to accept a selection, and the control snaps back when it does not.
>
> Also exported: `nitroUiCore` (one monotonic clock on both platforms) and `prewarm` (adopt a
> component's declared size so its first mount needs no layout correction).
>
> **Install** — `npm install react-native-nitro-ui react-native-nitro-modules`, then autolinking.
> No config plugin, no Podfile or Gradle edits. Verified green for this release on Expo SDK 58
> (RN 0.88) and React Native CLI 0.88.0, both platforms, and on RN CLI 0.86.3 on Android
> (iOS 0.86 is not yet verified: it hangs on the iOS 27 simulator even without this library). RN ≥ 0.86 with the new architecture; iOS at RN's floor; Android
> `minSdkVersion` 24. Expo Go is not supported — Nitro Modules needs a dev build.
>
> **Performance** — measured against the same controls reached through `@expo/ui`, one shared
> host, in Release on both platforms: Android mount latency lands within 1 % of the shared host on
> four of five controls (0.95–1.01×), meeting the target on `Switch` and `Progress`; iOS mount UI
> CPU is at or below the shared host on three of five, and iOS `SegmentedControl` memory is 17 %
> below it. The consistent misses are Android mount memory
> (2.5× — 141 KiB vs 52 KiB per `Switch`) and Android mount UI CPU (1.28–1.64×), and iOS memory on
> `Slider`, `Button` and `Progress` (+44…+80 KiB per instance). One cause: every control owns a
> hosting controller / Composition, where `expo-ui` amortises one across the batch. Numbers,
> the cells our harness refuses to call a pass, and the reasoning are in the README and
> `docs/architecture/benchmarks.md`.
>
> **Known limitations in 0.1** (full list per control in `docs/components/`): Android clips a row
> or button that is wider than its box instead of truncating it; iOS `SegmentedControl` ignores
> `tintColor`; a determinate circular `Progress` draws a spinner on iOS; `trackColor` is
> Android-only and `systemImage` iOS-only; accessibility props belong on the control, not on a
> wrapping box; `testID` lands on the host view on Android.
>
> **Not in 0.1:** `Picker`, `DatePicker`, and the shared `<Host>` container that would close the
> per-control memory gap — all planned for 0.2.

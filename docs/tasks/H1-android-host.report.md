# H1 — Android `<Host>` productionised (Switch): report

Branch `task/H1-android-host`, from `main` at `915e73c`. Brief: `docs/tasks/H1-android-host.md`.
Device: AVD `nitroui_t01` (`emulator-5570`, adb server 5041, Metro 8293). iOS regression on
iPhone Air `331EF109…`. Nothing pushed.

## Summary

`<Host>` is now a shipped component, not a spike. It gives its nitro-ui children **one**
Compose composition instead of one each, is opt-in, and refuses in development the children
it cannot compose. `Switch` is the hosted control; every other control and every React
Native view is a dev-time throw, on both platforms, so the rule is not learned later on the
platform that was not tested (D23).

- **Device numbers reproduce the spike.** 200 hosted Switches cost **0.85×** `expo-ui-shared-host`
  on mount memory and **0.81×** on mount UI CPU per op, where the same Switches unhosted cost
  2.68× and 1.38× — from one clean run (`problems: none`, sampled load median 2.99).
- **It pays on the JS thread, and now for more than the spike did**: mount JS CPU per op is
  **1.26×** the shared host against the spike's 1.10×. Reported, not smoothed (follow-up 1).
- **Placement was a real defect and is fixed.** T16's host centred its content in the box RN
  gave it, which is right for one control and wrong for a container: a Host 60 tall holding
  three Switches put the *second* row under a finger at the top of the box. Children now start
  at the top-leading edge, clipped at the bottom.
- **D24 is what the device said, not what the design assumed** (see Decisions).
- **iOS is a documented passthrough** while T17 runs, and it is a tested one: the iOS suite
  exercises the same JSX, the same child rule and the real-input path.

## D24 — what a hosted control's box is

The rule, in two sentences: a hosted control never measures its content and never reports to
the sizing engine — no cache entry, no correction, so D17's first-frame rule has nothing to
apply to — while its React Native frame still exists, is still the engine's answer, still
feeds the Host's box, and is purely decorative. The Host places its children itself: one
Compose `Column`, in mount order, top-leading at the Host's width, clipped to the Host's box,
where that box is the Host's own `style` or, with no height, the sum of its children's engine
boxes.

What each clause is measured against (`example/__tests__/Host.harness.tsx`, Android):

| Measured | Result |
| --- | --- |
| Host `{width: 260, height: 140}` holding 288 of children | box stays **260 × 140**; `onLayout` agrees (±0.19, dp↔px) |
| Host `{width: 260}`, children `height: 24` (Compose draws 144) | height **72** — the sum of the children's engine boxes |
| Host 60 tall vs 240 tall, same three rows | the short one clips its lower rows; **neither centres them** |
| Child `height: 96` vs `height: 20`, same Host | presses answer at **identical** offsets |
| Eight hosted Switches, cache invalidated | reports **0**, cache entries **0**, corrections **0** |
| The same eight unhosted | reports **16**, cache entries **1** |
| `measurements`, hosted vs unhosted | **8 and 8** — Yoga still asks, the engine answers from cache/fallback |
| A hosted child's own Android view | found by `testID`, and **0 × 0**: it is `GONE` while the Host draws |

Three things the spike's design assumed and the device did not agree with:

1. **Centring.** Fixed as described above; `centersContent` is now a `protected open val` on
   `NitroComposeHost` that `NitroUiHostView` overrides to `false`.
2. **"A hosted child reports nothing, so it is never measured."** Half true. It never
   *reports*, and the engine never *corrects* — but Yoga still issues one measure per child,
   8 for 8 children, exactly as many as unhosted. The count is not the difference; the cache
   entry is.
3. **"The child rule can be decided from the React element."** It cannot, on its own: React
   flattens components out of the native tree, so a wrapper that renders a `Switch` *is* a
   direct child. The check therefore judges what it can see (an element whose type is a hosted
   control: pass; a known RN view or one of our other controls: refuse) and hands everything
   else to the native Host, which composes it or logs what it skipped in a debuggable build.

`docs/architecture/sizing.md` §10 and `docs/DECISIONS.md` D24 carry the same rule;
`docs/components/host.md` carries it with the measurements.

## Ratio table

One run: `bun bench --platform android --plan quick`, all five arms, 4 launches × 5 warmup +
20 measured iterations, `System.nanoTime`, ART `speed-profile` (primed in 1 attempt), device key
`android35-emu-pixel9`, **sampled 418× → median 2.99 / p90 3.97 / max 9.66, 1.2 % over 7.0,
`problems: none`**, duration 2794 s. Results file
`bench/results/94e3fad-android-20261026T073843Z.json`. Ratios are the runner's own
launch-paired `pairedLaunchRatios()` (D9) via `bench/tools/arm-ratios.mjs --arm=…`; the
parenthesised number is that ratio's launch spread, and **ᴺ** marks a spread over 10 %
(`NOISE_REL_SPREAD`) — reported, no verdict. Bold = ≤ 1.0× **and** a verdict.

### Switch, mount N=50 — absolutes (median of launch medians)

| Arm | presented | mounted | JS commit | JS CPU/op | UI CPU/op | UI CPU/unmount |
| --- | --- | --- | --- | --- | --- | --- |
| `rn-core` | 32.38 ms | 22.71 ms | 2.48 ms | 2.98 ms | 8.95 ms | — |
| `expo-ui-host-per-control` | 33.04 ms | 25.27 ms | 7.52 ms | 8.19 ms | 15.36 ms | — |
| `expo-ui-shared-host` | 32.04 ms | 20.99 ms | 2.35 ms | 3.29 ms | 7.60 ms | — |
| `nitro-ui` | 32.29 ms | 24.56 ms | 2.02 ms | 2.48 ms | 10.85 ms | 0.79 ms |
| `nitro-ui-host` | 31.89 ms | 20.47 ms | 3.35 ms | 4.03 ms | 6.19 ms | 0.15 ms |

### Switch — launch-paired ratios to `expo-ui-shared-host` (the D15 question)

| Cell | Arm | presented | mounted | JS commit | JS CPU/op | UI CPU/op | memory (N=200) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| mount | `nitro-ui` (today) | 1.02x(1%) | 1.17x(1%) | 0.78x(16%)ᴺ | 0.78x(4%) | 1.38x(3%) | 2.68x(1%) |
| mount | `nitro-ui-host` | 1.00x(1%) | **0.98x**(3%) | 1.27x(9%) | 1.26x(3%) | **0.81x**(3%) | **0.85x**(1%) |
| update | `nitro-ui` | 0.98x(1%) | 1.00x(1%) | 1.06x(19%)ᴺ | 0.98x(18%)ᴺ | 1.32x(10%) | — |
| update | `nitro-ui-host` | 1.00x(18%)ᴺ | **0.95x**(3%) | 1.22x(25%)ᴺ | 1.19x(19%)ᴺ | 0.96x(24%)ᴺ | — |

`nitro-ui-host` vs `nitro-ui`, same run: memory **0.32×**, mount UI CPU **0.59×**, mounted
**0.83×**, mount JS CPU **1.62×**, UI CPU/unmount 0.22×.

### memory N=200 — bytes per instance

| Arm | bytes/inst | ÷ `expo-ui-shared-host` |
| --- | --- | --- |
| `rn-core` | 54.1 KiB | n/a — see below |
| `expo-ui-host-per-control` | 177.2 KiB | 3.44x(4%) |
| `expo-ui-shared-host` | 53.3 KiB | — |
| `nitro-ui` (today) | 142.9 KiB | 2.68x(1%) |
| `nitro-ui-host` | **45.3 KiB** | **0.85x**(1%) |

Only printed ratios go in that column: `arm-ratios.mjs` pairs launches and prints a row per
numerator, and it prints no memory row with `rn-core` as numerator. Read the other way round
(`--arm=expo-ui-shared-host`), the same run puts the shared host at **0.98×(0%)** `rn-core` and
**0.29×(4%)** `expo-ui-host-per-control` — the denominator sits where the 0.1 reports say it
sits.

Against T16's spike, cell for cell: memory 0.87× → **0.85×**, mount UI CPU 0.80× → **0.81×**,
mounted 0.96× → **0.98×**, presented 0.99× → **1.00×**, mount JS CPU/op 1.10× → **1.26×**,
JS commit 1.21× → **1.27×**. The native side reproduces; the JS side got 0.16× more expensive,
which is the one number in this report that moved the wrong way (follow-up 1).

Two honesty notes on this run:

- The `update` cells for `nitro-ui-host` all have launch spreads over 10 %, so none of them is
  a pass — they are measurements. The `mount` cells are all ≤ 9 %.
- The quick plan's `--component=switch` filter did not restrict the run: it measured all 21
  cells × 5 arms (that is what the 2794 s bought). The Switch rows above are the plan's
  unnamed cells. The extra components' arms are in the results file and are untouched by H1.

## Gates

Every command below was run from the worktree root (harness commands from `example/`), Node 24
via `fnm exec --using 24 --`, `HARNESS_TIMING` unset, `ANDROID_ADB_SERVER_PORT=5041`,
`ANDROID_SERIAL=emulator-5570`, `ANDROID_AVD=nitroui_t01`, Metro 8293.

| Gate | Command | Result |
| --- | --- | --- |
| Unit: the child rule, the warning, the config table | `bunx jest src/__tests__/host src/__tests__/hostLayoutWarning src/__tests__/viewConfigs` | **26 passed** (3 suites) |
| Host suite on the device | `bunx react-native-harness --harnessRunner android Host.harness` | **14/14 passed** |
| Hosted churn (leak gate, B1's shape) | `bunx react-native-harness --harnessRunner android MountChurn.harness` | **3/3 passed** |
| Android harness, full | `bunx react-native-harness --harnessRunner android` | **157/157 passed** in 123.2 s (load 6.91/6.00) |
| iOS harness, full | `IOS_SIM_UDID=331EF109… bunx react-native-harness --harnessRunner ios` | **148 passed, 1 skipped** in 87.6 s (iPhone Air) |
| Real input, Android | `bun run test:real-input:android` | **7/7 passed**, incl. `hosted-switch` |
| Real input, iOS | `IOS_UDID=331EF109… bun run test:real-input:ios` | **6/7** — `hosted-switch` **PASS**; `picker` FAIL under load, **PASS** alone (see below) |
| Everything | `bun run check` | **green** (exit 0) — typecheck, bench typecheck, lint, format, 218 unit tests, `test:native` (ASan), `perf:renders` 7/7, `nitrogen:check`, `autolinking:check`, `prepare`, `api-extractor:check`, `publint`, `manifest:check` (464 files), `readme:check` |
| Bench | `bun bench --platform android --plan quick` + `node bench/tools/arm-ratios.mjs --arm=…` | the tables above, `problems: none` |

Two gate stories that are not just numbers:

- **The iOS run was red first, and one of the failures was real.** The first full iOS pass
  reported 6 failures. Five were the runner refusing to trust its own timing state: a Metro I
  had left listening on 8293 pushed the harness onto 8294, where an earlier run's
  `harness-timing/state.json` was still parked — the harness caught it and said *"fix the run
  rather than removing the assertion"*, which is exactly the behaviour that gate is for. With
  that Metro stopped, all five went green unaided.
- **The sixth was H1's bug.** `finds a hosted child by testID` asserted the child's box is
  `0 × 0` on both platforms. That claim is Android's — the view is `GONE` because the Host draws
  it — and on iOS the passthrough gives the child a real view, so the suite found a real box
  (expected 0, got 61) and was right to. The test now asserts what each platform owes: `0 × 0`
  on Android, a laid-out non-zero box on iOS, with the exact box left to the passthrough suite
  so nothing is measured twice. Android re-run: 14/14.

`test:real-input:ios`'s picker failure is a load story: the suite ran while this session's own
Xcode and Gradle builds put `load1` at 22–37 on 14 cores, and the check's 10-second budget for
an armed unmount to land while a menu is up is a timing budget. Run alone at `load1` ≈ 3 it
passed in 120.8 s. The Android full suite showed the same shape earlier in the round: one
`Slider` accessibility-step probe failed at `load1` ≈ 142 and passed 21/21 when its file was
re-run alone.

## Files changed

- **JS API** — `src/components/Host/{Host.tsx,HostChildren.ts,NativeNitroUiHost.ts,Host.nitro.ts,NitroUiHostConfig.ts}`,
  `src/index.ts`. `HostProps extends ViewProps`; the child rule is a `Map` keyed by component
  identity, with the library's own controls and RN's views named in the refusal.
- **Android** — `android/.../core/NitroUiHost.kt` (the host view), `NitroComposeHost.kt`
  (`centersContent`, the hosted-child measure path), `HybridNitroUiHost.kt`,
  `NitroUiHostViewManager.kt`, `NitroUiPackage.kt`.
- **iOS** — `ios/components/Host/HybridNitroUiHost.swift` and the generated spec: a
  passthrough that still enforces the same child rule.
- **Bench** — `bench/src/implementations/nitroUi.tsx` (`nitro-ui-host` arm), `bench/src/plan.ts`,
  `bench/src/types.ts`, `scripts/bench/lib.mjs` (per-cell arm scopes), `bench/tools/arm-ratios.mjs`
  (`--arm`).
- **Tests** — `src/__tests__/{host.test.tsx,hostLayoutWarning.test.tsx,viewConfigs.test.ts}`,
  `example/__tests__/{Host.harness.tsx,MountChurn.harness.tsx}`,
  `example/ios/NitroUiExampleUITests/RealInputTests.swift`, `scripts/real-input/{controls,android}.mjs`.
- **Example app** — `example/src/HostScreen.tsx` (the real-input fixture: three hosted
  Switches, a 24-Switch batch that flips between hosted and unhosted, and the two echoes the
  suite reads), `example/src/App.tsx`, `example/src/stories/Host.stories.tsx`.
- **Docs** — `docs/components/host.md` (new), `docs/DECISIONS.md` (D24),
  `docs/architecture/sizing.md` §10, `README.md`, plus regenerated
  `etc/react-native-nitro-ui.api.md` and `etc/package-files.txt`.

## Decisions and why

**D24 (recorded in `docs/DECISIONS.md`)** is the sizing rule above. It was written *after* the
measurements, not before them: the brief's expectation was that a hosted child would be
"measured but never drawn", and the device said it is never measured for real, never reports,
and is still asked. `sizing.md` §3–§7 are unchanged for unhosted controls, and every case in
them still runs.

**Placement moved from centred to top-leading**, which is a behaviour change against T16's
spike and so is called out here rather than shipped quietly. Centring a control inside the box
the sizing engine gave *it* is correct; centring a *container's* content in the container's box
puts the middle of a list under a finger when the list is taller than the box. Measured: a Host
60 tall with three Switches (144 of content) put row 1 at y = −42. Top-leading is what RN means
by a container, what `@expo/ui`'s host does, and what makes an over-tall Host clip its far half
instead of its near half. `centersContent` is an override point, not a fork: every control still
centres.

**The child rule judges what it renders, not what it is called.** Keyed by component identity,
so an app's own `Switch` is refused rather than composed blind; components are transparent
because React flattens them, so a wrapper is a direct child; and a component the check cannot
see through is not refused but handed to the native Host, which composes it if what it renders
is a hostable control and logs a warning in a debuggable build when it cannot.

**`Host` is not a default and not a `FlatList`.** No `count`/`renderItem`, no virtualisation: it
is a container that changes who composes its children, and the JS-thread cost measured above is
why an app opts in deliberately.

## Red proofs

Every new assertion was shown to fail when the behaviour it guards is removed. The first eight
were proven as they were written, in the earlier rounds of this task; the last is this round's.

| Mutation | Went red |
| --- | --- |
| `assertHostChildren` not called from `Host` | the refuse-children unit tests |
| Refusal `throw` changed to `return` | the same tests, both platforms |
| Zero-height warning conditioned on `width >= 0` | the layout-warning test (it stops being a *zero-height* warning) |
| The once-per-instance `useRef` guard removed | the layout-warning test's "says it once" case |
| The native component renamed away from `NitroUiHost` | `viewConfigs.test.ts` and the app |
| An arm's bench scope widened per cell | `bench-gate.test.js` (a cell with no host arm cannot be skipped silently) |
| `HOSTABLE_CONTROLS` narrowed to `[]` / a row dropped from `UNHOSTABLE_CONTROLS` | `host.test.tsx`, which walks `src/components` and demands a row per control |
| `HOSTABLE_CONTROLS` keyed by component *name* instead of identity | the lookalike-component case in `host.test.tsx` |
| **`centersContent = false` override deleted from `NitroUiHostView`** (this round) | **7 of 14** in `Host.harness`: `draws every hosted child, in mount order`, `ignores a hosted child style height when placing the drawing`, `clips its content to its own box`, `lets a hosted child ask for the full width without moving the drawing`, and three behaviour cases — `lets a real touch reach a hosted Switch…`, `snaps a hosted Switch back when JS rejects the change`, `follows children that are added, removed and reordered`. Restored → 14/14. |

The last row is worth reading twice: the placement fix is not only geometry. With centring,
presses land on the wrong *child*, so the touch, the reject-revert and the add/remove/reorder
cases all fail. A Host that draws the wrong row is not a cosmetic bug.

Both builds in that proof were verified fresh (Gradle executed 28 and 26 tasks, APK mtime and
size changed) rather than trusted from `packageDebug UP-TO-DATE`, and the iOS app was verified
by symbol count (`NitroUiExample.debug.dylib`, 737 `nitroui` symbols, including
`HybridNitroUiHost`) — the stale-artifact trap that caught the previous task.

## Follow-ups

1. **Hosted JS CPU per op is 1.26× the shared host where the spike was 1.10×.** Profile the JS
   side of the hosted path (child bookkeeping per render, the `key(child)` scope) before a second
   component is hosted.
2. Hosted churn is Android-only by `MountChurn.harness.tsx`'s own convention (the iOS side
   reports a pending test); worth an iOS twin when T17 lands a real composition.
3. Our Android control publishes no toggle role or state to accessibility — `checkable=false`,
   `checked=false`, hosted *and* unhosted — so TalkBack reads the label and says nothing about
   on/off. A `Switch` semantics item, not a Host one.
4. A `<Host>` inside a `<Host>` is not refused; it composes as a child of the outer Host. Ask
   whether that is a supported thing to do.
5. `bun bench --component=switch` did not restrict the quick plan (all 21 cells ran).
6. `SafeAreaView` deprecation warnings in the example app, unrelated to H1.

## Questions for orchestrator

1. Top-leading placement is decided and measured (above). If T17's iOS Host inherits the same
   rule, the two platforms agree; if it centres, `docs/components/host.md` needs a per-platform
   caveat — flagging so T17 can decide deliberately.
2. Is `1.26×` shared-host mount JS CPU acceptable for shipping `Host` as opt-in in 0.2 (T16's
   condition 3 said the JS cost has to be *stated*, which it now is), or should follow-up 1 gate
   the announcement?
3. Nested `<Host>`: refuse it in dev like every other unhostable child, or document it as
   "composes as a child of the outer Host"?
4. The Slider a11y-step probe and the iOS picker unmount both flake under heavy load. Both are
   this library's gates on a shared machine — do you want a load ceiling enforced before those
   two specific checks, or is the re-run-alone convention good enough evidence?

## Commits

| SHA | Subject |
| --- | --- |
| `5f089be` | feat(host): port T16's shared Compose `<Host>` onto current main |
| `13cf7cb` | feat(host): refuse unhostable children and say when there is no box |
| `42dd621` | fix(host): place hosted children at the box edge, judge them by what they render |
| `3998f9a` | test(host): on-device suite for hosting, placement and the sizing engine |
| `1cb8906` | docs(host): write D24 against what the device said |
| `29e4cfb` | test(host): put a hosted batch on the gates that use real input |
| `39f9daf` | docs(host): write the Host doc, with what the accessibility tree says |
| `94e3fad` | chore(host): regenerate the API report and the package manifest |
| `810dfb0` | test(host): let the iOS passthrough keep its children's boxes |
| `f6a8587` | chore(bench): format the host arm-scope helpers |
| `e0afbd4` | fix(host): end the zero-height warning on its full stop |

The commit that adds this report also carries the measured numbers into `README.md` and
`docs/components/host.md`, and the regenerated `etc/package-files.txt` (four entries that
`HostChildren` added to the published output). The bench results file is named for `94e3fad`,
the commit that was checked out when the run started.

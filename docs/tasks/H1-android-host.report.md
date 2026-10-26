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

- **Device numbers reproduce the spike.** 200 hosted Switches cost **0.86×** `expo-ui-shared-host`
  on mount memory (44.5 KiB against 51.9 KiB) and **0.87×** on mount UI CPU per op, where the
  same Switches unhosted cost 2.75× and 1.39× — from one clean run (`problems: none`, sampled
  load median 2.96). Fix round 1's numbers, from the run with the leak in it gone; round 1's
  0.85× / 0.81× and its flattering 0.25× unmount are in the review.
- **It pays on the JS thread, and now for more than the spike did**: mount JS CPU per op is
  **1.18×** the shared host against the spike's 1.10×, where round 1 measured 1.26×. The spread
  between runs of the same code is that wide, so it is stated as *roughly 1.2×* and worth
  re-measuring (follow-up 1).
- **Placement was a real defect and is fixed.** T16's host centred its content in the box RN
  gave it, which is right for one control and wrong for a container: a Host 60 tall holding
  three Switches put the *second* row under a finger at the top of the box. Children now start
  at the top-leading edge, clipped at the bottom.
- **D24 is what the device said, not what the design assumed** (see Decisions).
- **iOS is a documented passthrough, permanently** (D23's T17 outcome: the iOS Host measured
  worse and is not built). It is a tested passthrough: the iOS suite exercises the same JSX, the
  same child rule and the real-input path.

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
| A hosted child's own Android view | found by `testID`, and **0 × 0**: laid out at zero inside the Host, because the Host draws it — not `GONE`, which Fabric re-asserts away each layout (fix round S1) |

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

One run, taken after the M1 fix: `bun bench --platform android --plan quick`, all five arms, 4
launches × 5 warmup + 20 measured iterations, `System.nanoTime`, ART `speed-profile` (primed in 1
attempt), device key `android35-emu-pixel9`, **sampled 418× → median 2.96 / p90 5.27 / max 13.98,
4.3 % over 7.0, `problems: none`**, `load1` 2.54 over 14 cores at start, `quiet: yes`, duration
2795 s. Results file `bench/results/68a660b-android-20261026T095335Z.json`.

Round 1's table (from `94e3fad-android-20261026T073843Z.json`) is superseded rather than wrong: it
measured a Host that never ran `drop()` on unmount, so its unmount column (0.25×) was a container
that did not unmount at all, and its memory and mount-UI columns were flattered by the same
retained work. Everything below is one run of the code that ships. Ratios are the runner's own
launch-paired `pairedLaunchRatios()` (D9) via `bench/tools/arm-ratios.mjs --arm=…`; the
parenthesised number is that ratio's launch spread, and **ᴺ** marks a spread over 10 %
(`NOISE_REL_SPREAD`) — reported, no verdict. Bold = ≤ 1.0× **and** a verdict.

### Switch, mount N=50 — absolutes (median of launch medians)

| Arm | presented | mounted | JS commit | JS CPU/op | UI CPU/op | UI CPU/unmount |
| --- | --- | --- | --- | --- | --- | --- |
| `rn-core` | 32.15 ms | 22.13 ms | 2.67 ms | 3.00 ms | 8.56 ms | 0.33 ms |
| `expo-ui-host-per-control` | 33.04 ms | 25.15 ms | 8.58 ms | 8.89 ms | 15.53 ms | 0.86 ms |
| `expo-ui-shared-host` | 32.13 ms | 21.21 ms | 2.86 ms | 3.51 ms | 7.45 ms | 0.58 ms |
| `nitro-ui` | 32.46 ms | 24.36 ms | 1.92 ms | 2.55 ms | 10.45 ms | 0.71 ms |
| `nitro-ui-host` | 31.66 ms | 20.61 ms | 3.60 ms | 3.92 ms | 6.53 ms | 0.37 ms |

### Switch — launch-paired ratios to `expo-ui-shared-host` (the D15 question)

| Cell | Arm | presented | mounted | JS commit | JS CPU/op | UI CPU/op | memory (N=200) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| mount | `nitro-ui` (today) | 1.01x(2%) | 1.13x(2%) | **0.64x**(4%) | **0.73x**(6%) | 1.39x(4%) | 2.75x(1%) |
| mount | `nitro-ui-host` | **0.99x**(1%) | **0.97x**(5%) | 1.18x(8%) | 1.18x(4%) | **0.87x**(2%) | **0.86x**(1%) |
| update | `nitro-ui` | 0.80x(21%)ᴺ | **0.98x**(2%) | 0.76x(17%)ᴺ | 0.80x(14%)ᴺ | 1.12x(21%)ᴺ | — |
| update | `nitro-ui-host` | 0.98x(18%)ᴺ | **0.95x**(3%) | 1.27x(31%)ᴺ | 1.16x(22%)ᴺ | 0.82x(28%)ᴺ | — |

The unmount column is a first for the Host: **0.78x(16%)** the shared host (0.37 ms against
0.58 ms), and the first unmount number this task can quote, because it is the first run where a
Host unmount was the work of disposing a composition rather than the work of not doing it.

`nitro-ui-host` vs `nitro-ui`, same run: memory **0.31×**, mount UI CPU **0.61×**, mounted
**0.83×**, mount JS CPU **1.54×**, UI CPU/unmount 0.50×.

### memory N=200 — bytes per instance

| Arm | bytes/inst | ÷ `expo-ui-shared-host` |
| --- | --- | --- |
| `rn-core` | 54.6 KiB | n/a — see below |
| `expo-ui-host-per-control` | 188.8 KiB | 3.63x(6%) |
| `expo-ui-shared-host` | 51.9 KiB | — |
| `nitro-ui` (today) | 143.5 KiB | 2.75x(1%) |
| `nitro-ui-host` | **44.5 KiB** | **0.86x**(1%) |

Only printed ratios go in that column: `arm-ratios.mjs` pairs launches and prints a row per
numerator, and it prints no memory row with `rn-core` as numerator. Read the other way round
(`--arm=expo-ui-shared-host`), the same run puts the shared host at **0.95×(1%)** `rn-core` and
**0.28×(6%)** `expo-ui-host-per-control` — the denominator sits where the 0.1 reports say it
sits.

Against T16's spike, cell for cell: memory 0.87× → **0.86×**, mount UI CPU 0.80× → **0.87×**,
mounted 0.96× → **0.97×**, presented 0.99× → **0.99×**, mount JS CPU/op 1.10× → **1.18×**,
JS commit 1.21× → **1.18×**. The native side reproduces. The JS side is roughly 1.2× and has moved
in both directions between three runs of near-identical code (1.26× → 1.18× against a 1.10×
spike), which is why `README.md`, `host.md` and `HostProps` all state it with that spread rather
than as a single figure (follow-up 1).

Two honesty notes on this run:

- Every `mount` cell for `nitro-ui-host` has a launch spread ≤ 8 %, so those are verdicts. The
  `update` cells all carry spreads over 10 % except `mounted` (3 %), so they are measurements.
- The quick plan's `--component=switch` filter did not restrict the run again: it measured all 21
  cells × 5 arms (that is what the 2795 s bought). The Switch rows above are the plan's unnamed
  cells. The extra components' arms are in the results file and are untouched by H1.

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
  `0 × 0` on both platforms. That claim is Android's — the child is laid out at zero because the
  Host draws it — and on iOS the passthrough gives the child a real view, so the suite found a real box
  (expected 0, got 61) and was right to. The test now asserts what each platform owes: `0 × 0`
  on Android, a laid-out non-zero box on iOS, with the exact box left to the passthrough suite
  so nothing is measured twice. Android re-run: 14/14.

`test:real-input:ios`'s picker failure is a load story: the suite ran while this session's own
Xcode and Gradle builds put `load1` at 22–37 on 14 cores, and the check's 10-second budget for
an armed unmount to land while a menu is up is a timing budget. Run alone at `load1` ≈ 3 it
passed in 120.8 s. The Android full suite showed the same shape: one `Slider`
accessibility-step probe (`steps to the next legal value when a screen reader asks`) has failed
in two full-suite runs of this task — once at `load1` ≈ 142, once at `load1` ≈ 5 — and passed
21/21 every time its file ran alone, including at that same low load. So it is a shared-machine
flake, but load is not its only trigger and `load1` ≈ 5 does not rule it out, which is worth
knowing for question 4. `Slider.harness.tsx` is untouched by H1 (`git diff 915e73c..HEAD` on it
is empty).

### Re-run at the final commits

The last five commits are one `Host.tsx` line, a bench-script format, a test-only platform
branch, the package manifest and these docs — so the cheap gates and the Android device gates
were re-run from `c844d8a`, to make the commit that ships the commit that was measured. Against
an APK that Gradle called `packageDebug UP-TO-DATE` and that was therefore checked by *content*
rather than trusted: its dex carries `centersContent` (1 hit) and `NitroUiHostView` (18), which
exist only after the placement fix.

| Gate | Result at `c844d8a` |
| --- | --- |
| `bun run typecheck`, `bun run lint`, `bun run test` | green, green, **218 passed** (14 suites) |
| `manifest:check`, `api-extractor:check`, `readme:check`, `format` | green (the manifest was four `HostChildren` entries short → `9872c78`) |
| `Host.harness`, Android | **14/14** (wall-clock gates off; load 12.5 from the build that ran just before) |
| Android harness, full | **157/157** in ~121 s at load 3.6; the run before it was 156/157 on the `Slider` probe above |
| `test:real-input:android` | **7/7** — `hosted-switch` flipped on a real tap, flipped back on the second, and the Host reported 2 changes |

iOS was not rebuilt or re-run here: this machine is running T17's bench, and an Xcode build is
not a polite way to ask it to wait. Its two rows stand as measured, and what they were measured
against (`810dfb0`) is a test-only platform branch — Android asserts the `0 × 0` that the Host
owns, iOS asserts a laid-out child.

## Files changed

- **JS API** — `src/components/Host/{Host.tsx,HostChildren.ts,NativeNitroUiHost.ts,Host.nitro.ts,NitroUiHostConfig.ts}`,
  `src/index.ts`. `HostProps extends ViewProps`; the child rule is a `Map` keyed by component
  identity, with the library's own controls and RN's views named in the refusal.
- **Android** — `android/.../core/NitroUiHost.kt` (the host view), `NitroComposeHost.kt`
  (`centersContent`, the hosted-child measure path), `HybridNitroUiHost.kt`,
  `NitroUiHostViewManager.kt`, `NitroUiPackage.kt`.
- **iOS** — `ios/components/Host/HybridNitroUiHost.swift` and the generated spec: a no-op
  passthrough. The child rule it appears to enforce is held in JS (`HostChildren.ts`), which is
  why the same JSX is refused on both platforms; the Swift class itself is never instantiated.
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
   reports a pending test). Not worth an iOS twin: T17's outcome says no iOS composition is coming,
   so the iOS passthrough has no Host lifecycle to churn.
3. Our Android control publishes no toggle role or state to accessibility — `checkable=false`,
   `checked=false`, hosted *and* unhosted — so TalkBack reads the label and says nothing about
   on/off. A `Switch` semantics item, not a Host one.
4. A `<Host>` inside a `<Host>`: round 1 composed it silently. Answered in the review —
   refused — and it is now refused on both sides (`HostChildren.ts` table, and `isHostable` is
   false for `NitroUiHostView`). See the fix-round section.
5. `bun bench --component=switch` did not restrict the quick plan (all 21 cells ran).
6. `SafeAreaView` deprecation warnings in the example app, unrelated to H1.
7. N4 from the review: a hosted child still arms a `DisposeOnLifecycleDestroyed` observer and a
   first-frame pre-draw listener at attach, for a composition it never builds. 200 children means
   200 pairs of registrations per batch. Real, small, and measurable in the mount cell.
8. N5 from the review: the Host keys children by `View` identity. Correct for `Switch`; a future
   control that implements `RecyclableView` would keep the old mount's `remember` state across a
   recycle, and needs keying by Fabric tag instead.
9. Two probes on this machine are load-sensitive and were left alone rather than gated (the
   orchestrator declined load ceilings for 0.2): `Slider.harness.tsx`'s accessibility-step check
   (`steps to the next legal value when a screen reader asks`) and
   `real-input/ios`'s `picker` unmount budget. Both are untouched by H1; both have failed inside a
   full suite at loads from 5 to 142 and passed every time their own file ran.
10. N6 from the review: `pointerEvents` on a `Host` is inert, now documented with the other styles
    that do not reach the drawing.

## Questions for orchestrator

Asked in round 1; all four answered in the fix-round brief and acted on. Kept here with the answer
so the round-1 text is not read as still open.

1. *Will T17's iOS Host inherit top-leading placement?* Answered: there is no iOS Host. T17
   measured the shape (mount UI CPU 1.40×, unmount 6.27×) and D23's rule refuses it, so iOS stays
   the passthrough and no per-platform caveat is needed. (Q1 of the review, answered the same way.)
2. *Is the ~1.2× shared-host mount JS CPU a gate on 0.2?* Answered: no. It does not gate 0.2, and
   it stays stated next to the win in `README.md`, `host.md` and `HostProps` (T16 condition 3).
3. *Nested `<Host>`?* Answered: refused. Implemented natively (`isHostable`) and in JS, with a
   harness case.
4. *Load ceilings for the two flaky probes?* Answered: not this round; they are recorded as
   follow-up 9.

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
| `9872c78` | chore(pack): list the Host child-rule modules in the manifest |

`c844d8a` adds this report and carries the measured numbers into `README.md` and
`docs/components/host.md`. The four `HostChildren` entries the published-output manifest was
missing went in on their own, in `9872c78`, because `manifest:check` was red without them. The
re-run section above is a commit of its own, on top of the report. The bench results file is
named for `94e3fad`,
the commit that was checked out when the run started.

---

# Fix round 1 (D19)

The review (`docs/tasks/H1-android-host.review.md`, verdict **FIX ROUND**) found two native
defects and a set of claims the device does not support. `main` was merged in first (`dc0693c`) so
D24 sits after D23 *and* its outcome, then every finding was fixed and the gates re-run on the
final tree. T17's result (no iOS Host) means nothing here is provisional: iOS `<Host>` is a
permanent, documented passthrough.

The orchestrator's four answers, applied: the ~1.2× JS CPU does **not** gate 0.2 and stays stated
next to the win; a nested `<Host>` is **refused**; there is no iOS Host to ask about; no load
ceilings are added this round, and the two load-sensitive probes are recorded in Follow-ups 9.

## M1 — the Host leaked on every unmount (B1's bug, one level up)

`HybridNitroUiHost` had no `onDropView`, so `host.drop()` never ran when Fabric dropped a Host. The
`DisposeOnLifecycleDestroyed` observer armed at attach stays on the activity's `LifecycleRegistry`,
which holds observers strongly: `activity → LifecycleRegistry → observer → ComposeContent → Host`
retained the Host, its composition, its slot table and — for a Host that died before its first
frame — its `PreDrawWatch`, for the life of the activity. The override is the whole fix; `drop()`
already did the work.

**Red proof, the way B1's was done.** A new churn cycle (`HostChurn` in
`example/__tests__/MountChurn.harness.tsx`) mounts many small Hosts per cycle, which the
one-Host-per-cycle cycle round 1 inherited cannot see: it gates at 2 MiB per cycle, so a leak of
one Host per cycle sat two orders of magnitude under it, which is exactly how round 1 stayed green.
With the `onDropView` override removed it measures **10.98 MiB per cycle** against that 2 MiB
bound; with the override it is **0**. The older one-Host cycle passes either way — the new cycle is
the gate. (`f790f76`.)

**What it did to the numbers.** The bench mount/memory cells for Switch were re-run (one `quick`
run, all five arms, 4 launches, `problems: none`, `quiet: yes`, load sampled median 2.96, 4.3 % of
samples over 7.0, `bench/results/68a660b-android-20261026T095335Z.json`):

| Cell | Round 1 (leak in it) | Fix round | `expo-ui-shared-host` |
| --- | --- | --- | --- |
| memory / instance | **0.85×** (45.3 KiB) | **0.86×** (44.5 KiB) | 51.9 KiB |
| mount UI CPU / op | **0.81×** | **0.87×** | 7.45 ms |
| mount JS CPU / op | 1.26× | **1.18×** | 3.51 ms |
| mounted | **0.98×** | **0.97×** | 21.21 ms |
| unmount UI CPU / op | 0.25× (flattered) | **0.78×** | 0.58 ms |

Round 1's 0.25× unmount was not a container that unmounted quickly; it was a container that did not
unmount at all. 0.78× is the first honest unmount figure, and `docs/components/host.md` now says
that next to the number rather than in a footnote. `README.md`, `host.md`, `HostProps` and this
report's ratio table all carry the new run (`d1c9f14`, `6a130ea`). The JS column moved 1.26× →
1.18× against the spike's 1.10×, so it is stated as *roughly 1.2× with a spread*, not as a single
figure.

## M2 — "Switch only" is held natively, and JS cannot be walked around

`NitroComposeHost.isHostable` is the native allowlist: `false` on the base class, `true` only on
`SwitchHost`. `HostedChildren` composes nothing else, and `NitroUiHostView` is not hostable, so a
nested `<Host>` cannot be composed either. JS refuses a nested `<Host>` too, in the same table that
refuses every other control (`e31899a`). A `Picker` behind `memo`, `forwardRef` or a plain user
component — the shapes JS cannot see through — is now skipped by the native rule and reported,
instead of being composed into a container it was never measured for (`f790f76`, harness cases
`will not compose a control behind a component, and tells JS` and
`will not compose a Host behind a component either`).

## Finding → commit → evidence

| Finding | Fix | Evidence |
| --- | --- | --- |
| M1 Host leak on unmount | `e31899a` (`onDropView`) | `f790f76` churn: 10.98 MiB/cycle red, 0 green; re-run bench `68a660b-…` |
| M2 native allowlist + nested refusal | `e31899a` | two harness cases; `host.test.tsx` JS cases |
| S1 the `GONE` claim was false | `e31899a` code, `d2e884b` docs | Fabric re-asserts `VISIBLE` each layout; D24, `sizing.md`, `host.md`, harness comments, this report |
| S2 `display: 'none'` honoured | `e31899a` | `does not draw a hosted child RN hid with display: none` |
| S3 padding forwarded, inert styles named | `e31899a` | `insets its drawing for its own padding`; `host.md`/D24 list; dev warning lists them (`Host.tsx`) |
| S4 dev `onLayout` only in `__DEV__` | `e31899a` | release builds attach the caller's handler or none |
| S5 refusal reaches JS in dev | `e31899a` | device event → `console.error` (`HostChildren.ts`), asserted by the refusal cases |
| S6 three cases proved nothing | `f790f76` | JS-write presses and reads the drawn state; disabled re-enables to show something was drawn; add/remove/reorder really adds `list-d` |
| S6 real-input TalkBack order | `f6962d6` | hosted labels sit between the RN siblings, in mount order — 7/7 Android |
| S7 stale docs and spike wording | `68a660b`, `d2e884b`, `6a130ea` | `index.ts`, `Host.nitro.ts`, `App.tsx`, bench arm, iOS header, `HostProps`, `host.md` `onLayout` claims |
| S8 `testID` → 0 × 0 for E2E | `d2e884b` | `host.md` says drive hosted controls by `accessibilityLabel` |
| lint warnings from the new cases | `efa9a16` | `bun run lint` back to no new warnings |
| report's own false claims | `6a130ea` | Summary, ratio table, `GONE` rows, iOS Files-changed row |

Two of these are worth a sentence because they were not what they looked like:

- **S1 changed the mechanism, not just the prose.** The child was never `GONE`: Fabric's
  `SurfaceMountingManager.updateLayout` re-asserts `VISIBLE` on it every layout pass, so the child
  lived as `VISIBLE`, laid out at `0 × 0` by our own measure gate. `applyHostedVisibility` became
  `applyHostedDrawFlag`, and the rule that actually matters is written down: a child laid out at
  zero is neither a hit target nor visible-to-user, which is *why* `testID` reads back a zero box
  (S8) and why a real finger reaches it only through the Host's composition.
- **The real-input ordering check went red for the wrong reason** (`f6962d6`). The tree had every
  node in the right place; the screen's `textTransform: 'uppercase'` heading meant the check
  searched for JSX's spelling, got `-1`, and reported a wrong order when the truth was "this node
  is not in the tree". The check now distinguishes the two and prints the positions it found.

## Gates on the final tree

Same rig as round 1: worktree root (harness from `example/`), Node 24 via `fnm exec --using 24 --`,
`ANDROID_ADB_SERVER_PORT=5041`, `ANDROID_SERIAL=emulator-5570`, `ANDROID_AVD=nitroui_t01`, Metro
8293, iOS on iPhone Air `331EF109…`, `HARNESS_TIMING` unset (wall-clock gates off).

| Gate | Command | Result |
| --- | --- | --- |
| Everything, at the final commit | `bun run check` at `f780554` | **green** (exit 0) — typecheck, bench typecheck, lint, format, **226** unit tests, `test:native` (ASan), `perf:renders` 7/7, `nitrogen:check`, `autolinking:check`, `prepare`, `api-extractor:check`, `publint`, `manifest:check` (464 files), `readme:check` |
| Android harness, full | `bunx react-native-harness --harnessRunner android` | **161 passed, 0 failed** (1 pending, and not in either Host file: both Host suites run alone with no pendings) in 839.5 s at `load1` 2.4 |
| Host suites alone, Android | `… android Host.harness` / `… android MountChurn.harness` | **18/18** and **4/4**, no pendings — every fix-round case runs, `HostChurn` included |
| iOS harness, full | `IOS_SIM_UDID=331EF109… bunx react-native-harness --harnessRunner ios` | **148 passed, 1 skipped, 0 failed** in 98.9 s — the skip is `MountChurn`'s documented "Android-only" pending test |
| Real input, Android | `bun run test:real-input:android` | **7/7** at `load1` 3.51, `hosted-switch` included with the ordering checks |
| Real input, iOS | `IOS_UDID=331EF109… bun run test:real-input:ios` | **7/7**, including `picker` (121 s) — round 1's load flake did not reappear at `load1` 2.2 |
| Bench | `bun bench --platform android --plan quick` | the M1 table above, `problems: none` |

What each gate was measured against: the last line of code moved at `efa9a16` (11:30), so the
Android and iOS harness runs, both real-input suites and the two targeted Host runs all serve JS
from a tree at or after it and install the native build described below; `check` was then re-run at
the final commit, and everything after `efa9a16` is documentation. The bench is from `68a660b`, and
nothing after it touches native code or the app's JS — only this report, `README.md`, `host.md`,
`Host.tsx`'s doc comment and test files.

Build freshness, checked rather than assumed:

- **Android**: no Kotlin changed after the 09:42 APK, and the compiled class carries the fix —
  `javap` on `android/build/…/debug/…/HybridNitroUiHost.class` lists `public void onDropView();`.
  The installed APK was re-verified the same way by content (`NitroUiHostView` 18 hits,
  `centersContent` 1) before the harness run.
- **iOS**: `bun run build:ios` was run again (it reported success and nothing to do — the trap
  round 1 noted), so freshness was proven by content instead: every `.swift`/`.mm`/`.h` under
  `ios/` and `example/ios/` predates the binary (newest 10:48 vs binary 11:11), the app carries 925
  `NitroUiHost` symbols, and `NitroUiExample.app` has no embedded `main.jsbundle`, so JS came from
  Metro at 8293.

## Orchestrator note (on merge)

Re-review (`docs/tasks/H1-android-host.rereview.md`): MERGE WITH FOLLOW-UPS, M1/M2 fixed, no regressions
outside a Host. Fixed on merge (`fix(host): …`): F1 — unhosted mount memory vs the shared host is
**2.75x** (2.63x was the ratio to `rn-core`) in README / host.md / Host.tsx / sizing.md; F2 —
`ImageBackground` and `SafeAreaView` dropped from the JS refusal table (reading them at module load
made RN log deprecation warnings in every app importing `Host`; the native check still refuses them);
host.md's T17 sentence (it won on memory, lost on UI CPU); the churn-gate comment (~11 MiB/cycle red).
`bun run check` green after. Remaining follow-ups in FOLLOWUPS.

# T16 — Shared `<Host>` spike (Android, Switch): report

**Branch:** `task/T16-host-spike` · **Device:** AVD `nitroui_t02` (`emulator-5572`, private adb server
5042, Metro 8294) · **Platform:** Android only (D13). One round, no fix rounds (D19).
Bench run id `7d665f4-dirty-android-20261024T105128Z` (`quick`, started 2026-10-24T10:51:28Z, 264 s)
— the tree it measured is this branch's code (`2f2f0af`), reported under the sha it ran with.
**The raw `{json,md,ndjson}` artefacts are not on disk.** `bench/results/*` is gitignored
(`.gitignore:102`), so the only copy lived in this task's worktree, and that checkout was pruned
after the tree went clean. Nothing this report quotes is lost — every figure is transcribed into the
tables below, and no committed baseline was touched — but the tables, not a file, are the record.

## Summary

**Yes — on the two metrics Android actually misses, a shared `<Host>` does not just match Expo's
shared host, it beats it**, and it costs JS-thread time to do it.

`nitro-ui-host` ÷ `expo-ui-shared-host`, launch-paired:

| Metric | `nitro-ui` today | with `<Host>` |
| --- | --- | --- |
| mount memory (N=200) | 2.75x | **0.87x** |
| mount UI CPU/op | 1.50x | **0.80x** (cell flagged) |
| mount `mounted` | 1.15x | **0.96x** |
| mount `presented` | 1.01x | **0.99x** |
| update UI CPU/op | 1.28x | 0.76x (noise-flagged) |
| mount JS CPU/op | 0.85x | 1.10x |
| mount JS commit | 1.01x (flagged) | 1.21x (flagged) |

The memory and UI-CPU columns are the standing 0.1 misses (`R2-release-0.1.report.md`: Android
memory 2.50–2.74x, mount UI CPU 1.28–1.64x). A Host closes both, in one run, with low spread on the
memory row (1%) and 8% on the UI-CPU row. What it pays with is JS: a hosted control is still an RN
view with a Fabric node, a Yoga box and prop plumbing, *plus* a Compose child of someone else's
composition, so JS commit and JS CPU/op move against us (1.10x / 1.21x vs the shared host).

**Recommendation: ship it in 0.2 as an opt-in container for dense lists, Switch first — not as a
default, and with the "this is Compose content, not an RN view" contract in the type doc.** Details
and the API shape in [Recommendation](#recommendation-for-02).

## Ratio table

One run, `quick` plan, 4 launches × 20 measured iterations, 5 warmup, `System.nanoTime`, ART
`speed-profile` (D18), `deviceKey android35-emu-pixel9`, **machine load 3.83 over 14 cores, runner
label `quiet yes`, `problems: none`**. All five arms in the same run. Ratios are the runner's own
launch-paired `pairedLaunchRatios()` (D9), via `bench/tools/arm-ratios.mjs --arm=…`; the parenthesised
number is that ratio's own launch spread. **ᴺ** = that spread is over 10% (`NOISE_REL_SPREAD`), so the
cell is reported and carries no verdict. No `n/v` anywhere is upgraded to a pass. `presented` carries
no ᴾ: the frame probe reported "no out-of-order samples" in every cell.

Bold = meets the ≤ 1.0x target **and** carries a verdict.

### mount N=50 — absolutes (median of launch medians)

| Arm | presented | mounted | JS commit | JS CPU/op | UI CPU/op | UI CPU/unmount |
| --- | --- | --- | --- | --- | --- | --- |
| `rn-core` | 31.96 ms | 20.54 ms | 1.48 ms | 2.18 ms | 7.26 ms | 0.29 ms |
| `expo-ui-host-per-control` | 33.28 ms | 25.77 ms | 7.77 ms | 8.42 ms | 16.49 ms | 0.97 ms |
| `expo-ui-shared-host` | 32.41 ms | 20.54 ms | 1.51 ms | 2.44 ms | 5.98 ms | 0.52 ms |
| `nitro-ui` | 32.79 ms | 24.55 ms | 1.66 ms | 2.12 ms | 10.11 ms | 0.87 ms |
| `nitro-ui-host` | 31.89 ms | 20.09 ms | 1.92 ms | 2.71 ms | 5.20 ms | 0.19 ms |

### mount N=50 — launch-paired ratios to `rn-core`

| Arm | presented | mounted | JS commit | JS CPU/op | UI CPU/op |
| --- | --- | --- | --- | --- | --- |
| `expo-ui-host-per-control` | 1.04x(1%) | 1.25x(3%) | 4.99x(30%)ᴺ | 3.95x(26%)ᴺ | 2.26x(10%) |
| `expo-ui-shared-host` | 1.02x(1%) | 1.00x(8%) | 1.02x(27%)ᴺ | 1.19x(28%)ᴺ | 0.84x(10%) |
| `nitro-ui` | 1.02x(1%) | 1.19x(7%) | 1.13x(27%)ᴺ | 1.03x(30%)ᴺ | 1.37x(13%)ᴺ |
| `nitro-ui-host` | **0.99x**(2%) | **0.98x**(8%) | 1.37x(10%) | 1.32x(14%)ᴺ | 0.73x(17%)ᴺ |

### mount N=50 — launch-paired ratios to `expo-ui-shared-host` (the D15 question)

| Arm | presented | mounted | JS commit | JS CPU/op | UI CPU/op | memory (N=200) |
| --- | --- | --- | --- | --- | --- | --- |
| `nitro-ui` (today) | 1.01x(1%) | 1.15x(4%) | 1.01x(22%)ᴺ | 0.85x(13%)ᴺ | 1.50x(10%) | 2.75x(2%) |
| `nitro-ui-host` | **0.99x**(1%) | **0.96x**(2%) | 1.21x(11%)ᴺ | 1.10x(3%) | **0.80x**(8%)* | **0.87x**(1%) |
| `expo-ui-host-per-control` | 1.04x(2%) | 1.25x(6%) | 4.86x(20%)ᴺ | 3.28x(13%)ᴺ | 2.58x(12%)ᴺ | 190.7 KiB abs. |

\* The paired ratio for this cell is 8%, under the 10% bar. The runner's *within-cell* advisory for
the same cell is different and stricter: it flags UI CPU/op at 16.5%, JS CPU/op at 13.8% and UI
CPU/unmount at 37.2% inside `nitro-ui-host`'s mount cell, and says those metrics "are reported but
cannot carry a verdict". Both readings are printed here rather than the convenient one being chosen;
the absolutes (5.20 ms against 5.98 ms, and 0.19 ms against 0.52 ms on unmount) point the same way.

### update N=50 — launch-paired ratios to `expo-ui-shared-host`

| Arm | presented | mounted | JS commit | JS CPU/op | UI CPU/op |
| --- | --- | --- | --- | --- | --- |
| `nitro-ui` (today) | 0.79x(22%)ᴺ | 0.99x(1%) | 1.02x(7%) | 0.96x(6%) | 1.28x(6%) |
| `nitro-ui-host` | 0.98x(17%)ᴺ | **0.96x**(2%) | 1.18x(24%)ᴺ | 1.17x(12%)ᴺ | 0.76x(19%)ᴺ |
| `expo-ui-host-per-control` | 0.80x(21%)ᴺ | 0.98x(2%) | 1.91x(13%)ᴺ | 1.63x(8%) | 1.22x(15%)ᴺ |

Absolutes for the row that matters: update UI CPU/op is **3.94 ms** (`nitro-ui-host`) against
**5.24 ms** (`expo-ui-shared-host`) and 5.76 ms (`nitro-ui`); every cell reports "no out-of-order
samples".

### memory N=200 — bytes per instance

| Arm | bytes/inst | native heap/inst | java heap/inst | ÷ shared host |
| --- | --- | --- | --- | --- |
| `rn-core` | 52.9 KiB | 40.1 KiB | 10.7 KiB | 1.01x(0%) |
| `expo-ui-host-per-control` | 190.7 KiB | 69.7 KiB | 103.3 KiB | 3.63x(7%) |
| `expo-ui-shared-host` | 52.6 KiB | 9.2 KiB | 29.5 KiB | — |
| `nitro-ui` (today) | 144.0 KiB | 59.7 KiB | 76.2 KiB | 2.75x(2%) |
| `nitro-ui-host` | **45.6 KiB** | 14.2 KiB | 20.4 KiB | **0.87x**(1%) |

## What is still per child, and where the rest goes

Per hosted control the spike keeps: **one Fabric node + one C++ component descriptor instance, one
Android `View` (the `NitroComposeHost` itself, kept as `GONE`/`setWillNotDraw`), one Hybrid Object +
one model + the prop plumbing, one Yoga node with a frame nothing reads, and one `key(child)` group
(its own slot subtree + semantics node) inside the Host's composition.** What is gone is exactly the
list T12 §P2f named as the residual: the `Composition` and slot table, the `AndroidComposeView`
owner with its LayoutNode root and delegates, and the per-control native view tree.

The split says the residual is now RN's, not Compose's: 14.2 KiB native + 20.4 KiB java per
instance, where Expo's shared host is 9.2 + 29.5. Our native number is ~5 KiB higher than Expo's —
the extra Fabric node and the extra `View` per control, which Expo's arm does not pay because its
children are Compose content with no RN box. Our java number is ~9 KiB lower.

Two consequences worth naming:

- **The bench arm is deliberately handicapped.** `nitro-ui-host` renders inside the *same*
  `stackStyle` box the `expo-ui-shared-host` arm uses and keeps each child's `rowStyle` and stable
  handler (`bench/src/implementations/nitroUi.tsx:105`), so the cell prices only *where the control
  composes*. Expo's children carry no Yoga node at all. Dropping the children's boxes would buy the
  remaining JS commit / JS CPU gap and part of the native-heap difference — but by removing intrinsic
  sizing from the comparison, which is why the arm does not do it.
- **JS went up, and this run does not attribute it.** Candidates, in the order I would test them:
  the 50 extra Yoga nodes and their measure/layout calls that Expo never makes; `isHostedByParent`
  being read on every attach/measure/layout; and the child-set version bump +
  `Snapshot.sendApplyNotifications()` per Host during mount. A flame graph of the mount would settle
  it; that is outside a one-round spike.

## How Expo does it, from the source

Read in the read-only clone: `packages/expo-ui/android/src/main/java/expo/modules/ui/HostView.kt` and
`packages/expo-modules-core/android/src/compose/expo/modules/kotlin/views/ExpoComposeView.kt`.

- **One class, two roles, decided by a constructor flag.** `ExpoComposeView(context, appContext,
  withHostingView: Boolean)`. A control that is meant to be hosted is constructed with
  `withHostingView = false`, and in `init` that branch does exactly two things:
  `visibility = GONE` and `setWillNotDraw(true)` (`ExpoComposeView.kt:227-230`). It never creates a
  `ComposeView` and never becomes a composition host at all — it is a plain `ExpoView` whose only
  Compose artefact is its `ComposableScope.Content()` method.
- **The host owns the only real Compose view.** `withHostingView = true` adds an
  `androidx.compose.ui.platform.ComposeView` as a MATCH_PARENT child (`addComposeView()`,
  `:233`), pins its composition to the **Activity** lifecycle so RN-screens detaching an inactive
  screen does not kill it, and gives it a unique `rememberSaveable` namespace so two Hosts do not
  collide on one key. `shouldUseAndroidLayout = withHostingView` — only the host takes part in
  Android measure/layout, and its `onLayout` re-lays that `ComposeView` over its own box (`:108-117`).
- **Children are composed by the parent, one keyed group each.** `Children(composableScope)`
  (`:152-169`) walks `getChildAt(i) as? ExpoComposeView`, skips any child that hosts itself, and for
  the rest runs `key(child) { with(child) { Content() } }` inside the host's composition. `Host`'s
  own `Content()` is where that call lives, inside the `MaterialTheme`/`CompositionLocalProvider` it
  builds.
- **Two invalidation paths, both through the child's captured scope.** `Children()` stores
  `recomposeScope = currentRecomposeScope` while inside the child's own `key` group, so a prop write
  calls `recomposeScope?.invalidate()` and recomposes that one child. Child add/remove reaches the
  same place from `onViewAdded` / `onViewRemoved` (`:300-313`).
- **The direct-parent rule is enforced, and it is loud.** `onAttachedToWindow` calls
  `validateHostingAncestor()` for non-hosting children (`:120-150`): the *immediate* parent must be an
  `ExpoComposeView` or a `ComposeView`, because a plain RN `View` in between breaks the composition
  boundary even if a `<Host>` is further up. On failure it logs a `MissingHostException` to the JS
  logger — a warning, not a crash.

**What stays per child in Expo** is therefore the same list as ours, minus the Yoga box: Fabric node,
`ExpoView`, the `props` object, the `key` group. **Where the spike differs:** the flag is fixed at
construction there and read from the view tree here (so a control can move into or out of a Host and
ends up composed in exactly one place); Expo's child never was a composition host, ours is one with
composition suppressed by three gates (`shouldCreateCompositionOnAttachedToWindow`, declining
`onMeasure`, declining `onLayout`) — GONE alone is not enough, because `addView` attaches a GONE
child and `AbstractComposeView` composes eagerly on attach; and Expo invalidates via a captured
`recomposeScope`, we bump a version and let the snapshot system route it, which is the shape
`commit` already uses.

## What a Host costs as a product

One composition is **one rectangle in one place in the view tree** (T12 §P2f's feasibility
constraint). Concretely, for a control inside a `<Host>`:

- **It is not a box Yoga knows.** The Host's box is the only thing measured; children stack in a
  Compose `Column` and their RN frames are decorative. **Tested**: in the example screen, a hosted
  Switch and an unhosted Switch coexist and the hosted ones are placed by Compose.
- **T11 intrinsic sizing does not apply inside a Host, and cannot.** A hosted control never measures,
  so it has no report to make: `onLayout` returns before the sizing-key block. Anything D17 decides
  about intrinsic sizing is a decision about controls *outside* Hosts; a hosted control's size is
  whatever the Host's `Column` gives it. If 0.2 ships a Host, that has to be in the same sentence as
  D17, not in a footnote.
- **No interleaving with RN views.** `HostedChildren` composes `NitroComposeHost` children and skips
  everything else, and the Host lays out nothing it does not compose. An RN `View` between a Host and
  a control also silently un-hosts the control (ours renders its own composition; Expo logs
  `MissingHostException`). **Reasoned from the code, not tested** — no interleaving case was built.
- **Not scrolled, clipped or transformed by RN ancestors,** and no `Modal`: RN hands the Host one
  rectangle, and everything inside it is Compose's. `removeClippedSubviews` and any list recycling
  that detaches children therefore act on a GONE view whose composition the Host still owns — the
  Host's `Column` iterates `childCount`, so a detached-but-still-child control stays composed.
  `onDetachedFromWindow` restores visibility only when the parent is no longer a Host, precisely so a
  re-attach elsewhere cannot inherit a hidden view. **Reasoned.**
- **Accessibility order changes shape.** A hosted control's `View` leaves the Android a11y tree (that
  is part of why `GONE` is the right flag — one control per row, not an empty container around it),
  and its semantics live in the Host's `AndroidComposeView`. So traversal order *within* a Host
  follows Compose order (which is RN mount order, keyed per child), and the whole Host reads as one
  block at the Host's position relative to RN views around it. **Reasoned; not measured** — the
  spike did not run an a11y-tree capture on a Host.
- **Recycling is per RN node, not per composition.** The existing `RecyclableView` reset still runs on
  the child, but the child's Compose state now lives in someone else's slot table, so a recycled
  hosted control must be re-composed by the Host rather than re-hosted. `hostedVersion` covers add
  and remove; it does not currently distinguish "same child, new model", which is what a recycler
  does. **Reasoned; the spike's `reset()` is a no-op for a Host, which has no props.**
- **Everything is Android-only.** iOS `<Host>` is a plain `View` (`src/components/Host/Host.tsx:35`)
  and a documented no-op native class (`ios/components/Host/HybridNitroUiHost.swift`), which exists
  only because nitrogen refuses to generate a Hybrid View with no native implementation on a
  platform. A control inside a `<Host>` on iOS renders exactly as it does outside one.

**Lines of code.** 556 handwritten lines added on this branch, of which **554 are the library**
(134 `core/NitroUiHost.kt` + 121 the hosted-mode block in `core/NitroComposeHost.kt` + 82 the view
manager + 38 the Hybrid Object + 33/43/24/29 the spec, component, native-view and config TS + 31 the
iOS no-op + 4 package registration + 5 export + 10 `nitro.json`) and 2 are the new test entry. Plus
1,127 lines of nitrogen-generated code, 126 lines of bench arm and 187 lines of example screen.
The child-side change is in the shared base class, not per component.

**What every other component would need.** No per-component code for the plumbing — the child-side
gates live in `NitroComposeHost`. What each component must *survive* is rendering `Component(model)`
without its own `NitroUiMeasuredRoot` and its own `NitroUiTheme` (the theme comes from the Host), so
per component it is: (1) prove the composable is identical when rendered bare inside a Host — a
harness run per component, both platforms if iOS ever gets one; (2) decide what its intrinsic size
means inside a Host, since it reports nothing; (3) exclude any component that owns a window or a
dialog — `Modal` cannot be hosted at all; (4) for components with children of their own, decide
whether the direct-parent rule recurses. `Switch` needed none of (1)-(4) as a question, which is why
it was the right control to spike.

## iOS estimate (estimate only — not built)

Recorded iOS memory ÷ `expo-ui-shared-host` in 0.1 (`R2-release-0.1.report.md`, final ratio table):
`switch` **0.99x**, `segmented-control` **0.83x** (17% *below* Expo), and `slider` **1.44x**,
`progress` **1.36x**, `button` **1.35x** — +44…+80 KiB per instance more than the shared host.

A shared `UIHostingController` with N SwiftUI children would amortise one hosting controller, one
UIKit view, one SwiftUI rendering root and one environment/theme resolution across the batch. What it
cannot amortise is the N SwiftUI view trees themselves — and on iOS those are a much larger share of
the per-control cost than Android's `Composition` + `AndroidComposeView` owner are, which is exactly
why iOS per-control memory sits at 1.35–1.44x where Android sat at 2.5–2.74x.

So, expected effect if built:

- `slider` / `button` / `progress`: the miss is the hosting-controller overhead, and a shared host is
  the thing that removes it. Best case they land near **1.0–1.1x** (Android went 1.50x → 0.80x on UI
  CPU and 2.75x → 0.87x on memory, but with a bigger per-control artefact to remove). Treat "closes
  the +44…+80 KiB" as the realistic ceiling, not "beats rn-core".
- `switch` and `segmented-control`: **nothing to gain and something to lose** — they are at 0.99x and
  0.83x already. iOS `UIHostingController` per control is not the problem those controls have.
- **It does not touch the axis iOS actually misses.** iOS `mount mounted` is 2.00–5.28x the shared
  host and iOS `presented` is un-verdictable everywhere; both are commit/JS-side, and Android's Host
  made those *worse*, not better. An iOS Host would most likely cost iOS JS time for a memory win on
  three of five controls.
- Same product costs, plus iOS-specific ones: `UIHostingController` inside a Fabric-managed view
  tree means hand-writing the layout and lifecycle bridge Expo does not need, and the sizing
  correction (T11) would have to be reconciled with a hosting controller that owns its own intrinsic
  size.

**Recommendation for iOS: do not build one for perf.** The iOS memory story is two controls at or
below parity and three controls ~35–45% over, on an axis iOS is not failing.

## Recommendation for 0.2

**Ship an opt-in `<Host>`, Switch first, as a dense-list container — with the contract written down
before the component count grows.**

For: it is the only thing measured so far that clears Android mount memory (2.75x → 0.87x, below
both reference arms) and mount UI CPU (1.50x → 0.80x, below rn-core) at the same time; the API is
5 lines of TS plus one container view; nothing outside a Host changes; T13 showed the cheaper
intermediate (shared owner services) was already amortised per window, so this is the only lever left
for those two metrics.

Against: it is a new public container whose contents stop being RN views, and the costs above —
`ScrollView`, interleaving, clipping/transforms, `Modal`, and intrinsic sizing (D17) — are permanent,
not implementation debt.

Conditions I would attach:

1. **Switch only in 0.2**, with `Host` documented as "nitro-ui controls, direct children, dense
   lists", and the unsupported list (RN views, `ScrollView`, clip/transform, `Modal`, intrinsic
   sizing) in the `HostProps` doc comment, not in a footnote.
2. **Decide D17 and a Host in the same breath.** A hosted control reports no size. If 0.2 wants
   intrinsic sizing to be a headline, the Host must say what a hosted control's box means.
3. **Keep the JS cost honest.** JS CPU/op at 1.10x vs the shared host is a real regression on the
   thread that hosts business logic; it should be in the README's perf section, next to the win.
4. **One arm per component before it is claimed** — the `nitro-ui-host` arm and the
   `component !== 'switch'` throw in `bench/src/implementations/nitroUi.tsx:120` are the pattern for
   refusing to claim a control that was not measured.

**API shape, if yes** (this is what the spike already implements, so it is a proposal to keep):

```tsx
<Host style={styles.list}>          {/* android: one composition; ios: a View */}
  <Switch value={v} onValueChange={setV} />
  <Switch value={w} onValueChange={setW} />
</Host>
```

`HostProps extends ViewProps` — layout props and nothing else. Direct-children-only, stated in the
doc comment. No `count`, no `renderItem`, no virtualisation, no per-child options: those are the
things that would make it a second list component, and this is a container. The name is Expo's, which
means a reader who knows `@expo/ui` arrives at the right mental model for free — including the part
where `<Host>` is required for the controls to render at all, which for us is opt-in instead.

## Gates

| Command | Result |
| --- | --- |
| `bun run check` | **green** (`CHECK_EXIT=0`, all 18 stages) on the tree these commits contain — typecheck, bench typecheck (+ android tsconfig), eslint, prettier, jest 133/133, `test:native` (ASan+UBSan: sizing, handshake, clock), `perf:renders` 5/5 with `mount+0 redundant`, nitrogen drift (`no drift`, 156 files / 21 views patched), autolinking drift, `prepare`, api-extractor, publint, manifest, readme. It took three runs to get there and each red was a real omission, not flake: **(1)** `nitrogen:check` — 17 "is not committed" issues, because the generated `NitroUiHost` bindings existed only as untracked files; **(2)** `api-extractor:check` — `etc/react-native-nitro-ui.api.md` had to gain `Host` / `HostProps` (`bun run api-extractor`); **(3)** `manifest:check` — 41 published files not in `etc/package-files.txt` (`bun run manifest:update`; every added entry is a Host file). Stages 1-7 were green on every run. The green run predates this task's two documentation commits (`etc/*` was in it) by minutes; neither changes compiled code or a checked file. |
| Android harness, Switch suite | **15/15 passed**, 7.8 s — `cd example && ANDROID_AVD=nitroui_t02 ANDROID_SERIAL=emulator-5572 ANDROID_ADB_SERVER_PORT=5042 METRO_PORT=8294 HARNESS_APP_PATH=…/app-debug.apk fnm exec --using 24 -- bunx react-native-harness --harnessRunner android Switch.harness`, on a debug APK built from this branch at 12:33. This is the regression net for "nothing outside a Host changes": `NitroComposeHost.kt` is the shared base class. |
| Android harness, sizing suites | **24/24 passed** in 2 suites, 17.7 s (same command, `Sizing.harness`). Run because the measure/layout gates are exactly what a hosted control skips, so an unhosted control must prove it still measures. `HARNESS_TIMING` was unset, so these are the structural assertions only — the wall-clock gates were off (load was ~81 over 14 cores from another task's iOS build, which is the case the gate refuses at). |
| new assertion in `src/__tests__/viewConfigs.test.ts` shown to fail | **red as intended**: renaming `NitroUiHost` in `src/components/Host/NitroUiHostConfig.ts` → `1 failed, 7 passed` on `covers every generated config (add the copy + an entry here)`; reverted, working tree clean. |
| real tap toggles a Switch inside a Host | **pass** — `docs/tasks/T16-host-spike/host-tap-before.png` / `host-tap-after.png`: the first hosted Switch is off with "first switch, as JS sees it: off" and "changes JS has accepted: 0"; after one real tap it is on with "on" and **1**. So the hit lands on the Host's `AndroidComposeView`, the event reaches JS, and the controlled handshake completes. The third hosted Switch stays off in the same frame, which is the per-child `key` scope doing its job. `host-second-switch.png` and `host-js-write.png` cover the second control and a JS→native write. |
| `bun bench --platform android --plan quick` | one run, all five arms, `problems: none`, `quiet yes`, load 3.83/14. Labelled above. Not repeated (D19). |
| `node bench/tools/arm-ratios.mjs --arm=nitro-ui-host bench/results/<run>.json` (and again with `--arm=nitro-ui`, `--arm=expo-ui-shared-host`, `--arm=expo-ui-host-per-control`, `--arm=rn-core`) | the paired-ratio tables above. `--arm` was added for this question: the D15 target is a ratio to `expo-ui-shared-host`, which the gate's rn-core ratios cannot be divided into after the fact. |

## Files changed

- `android/…/core/NitroUiHost.kt` *(new)* — the Host view: `Column` of keyed children, child-set
  version, hosted-visibility comment.
- `android/…/core/NitroComposeHost.kt` — hosted mode: `isHostedByParent`, `HostedContent()`,
  `applyHostedVisibility()`, `shouldCreateCompositionOnAttachedToWindow`, measure/layout gates,
  stale-composition drop on attach under a Host.
- `android/…/NitroUiHostViewManager.kt`, `HybridNitroUiHost.kt`, `NitroUiPackage.kt` — the view
  manager (children need a `ReactViewGroup`-compatible `addView` path), the Hybrid Object, registration.
- `ios/components/Host/HybridNitroUiHost.swift` *(new)* — documented no-op, see the file header.
- `src/components/Host/` *(new)* — `Host.nitro.ts`, `Host.tsx`, `NativeNitroUiHost.ts`,
  `NitroUiHostConfig.ts`; `src/index.ts` export; `src/__tests__/viewConfigs.test.ts` entry.
- `nitro.json`, `nitrogen/generated/**` — spec + regenerated bindings.
- `bench/src/…` — `nitro-ui-host` arm (`NitroUiHostList`), plan/types wiring so it is Switch-only;
  `bench/tools/arm-ratios.mjs` `--arm`; `scripts/bench/lib.mjs` pairing helper.
- `example/src/HostScreen.tsx`, `example/src/App.tsx` — three hosted Switches + one outside, real
  handlers, a JS→native flip, and the counters behind the screenshots.

## Follow-ups

1. `expo-ui-shared-host`'s update `presented` (1.27x, 20% spread) and `nitro-ui-host`'s (1.24x, 21%)
   are both noise-flagged and both look like the same frame-stamp effect; someone who cares about
   update `presented` should re-record it rather than read either number.
2. The Host's child-set observation invalidates the whole hosted block on any add or remove. Expo has
   the same property. Fine at N=50 in this run; unknown in a virtualised list that adds and removes
   continuously.
3. No a11y-tree capture was run against a Host (T13 has the harness for the per-window case). If a
   Host ships, an a11y-order test for hosted siblings vs surrounding RN views belongs with it.
4. `example/src/HostScreen.tsx` is a spike screen, not a demo; if the component ships it should be
   rebuilt as part of the docs work.
5. The run's raw artefacts are gone for the reason above, so these numbers cannot be re-tabulated
   from disk — only re-measured, which needs the `nitro-ui-host` arm that exists only on this branch.
   Re-run `bun bench --platform android --plan quick` on a quiet machine if 0.2 builds on them.

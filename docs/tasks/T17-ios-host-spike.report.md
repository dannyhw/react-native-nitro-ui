# T17 — Shared `<Host>` spike (iOS, Switch + Slider): report

**Branch:** `task/T17-ios-host-spike` (from `main` @ `0c961b4`) · **Device:** iPhone 17 simulator
`F08675D3-A32B-4F88-BC81-02D7E0CB797E`, iOS 27 (`deviceKey ios27-sim-iphone17`) · **Platform:** iOS
only (Android's twin is `task/T16-host-spike`, not merged). One round, no fix rounds (D19).
Code: `a4f84ca`. Bench run: `bench/results/a4f84ca-ios-20261026T055450Z.{json,md,ndjson}` — not
dirty, `problems: none`, 78 measured cells × 4 launches, 1979 s. Not pushed; only this report merges.

## Summary

**No. On iOS the Host is not better than nitro-ui without it — it is a different trade, and it is
Expo's trade.** `nitro-ui-host` ÷ `nitro-ui`, launch-paired:

| Metric | Switch | Slider |
| --- | --- | --- |
| mount memory (N=200) | **0.92x** | **0.75x** |
| mount `mounted` | **0.14x** | **0.13x** |
| mount UI CPU/op | 1.40x | 0.83x ᴺ |
| mount `presented` | 2.06x ᴺ | 1.00x |
| mount UI CPU/unmount | 6.27x | 4.90x |
| mount JS CPU/op / JS commit | 1.16x / 1.21x | 0.98x / 0.97x |
| update UI CPU/op | **0.91x** | **0.87x** |

Better on three metrics (memory, `mounted`, update UI CPU), worse on three (mount UI CPU on Switch,
unmount UI CPU on both, `presented` on Switch), parities elsewhere. D23's rule — *if the Host is
better, nitro-ui ships it* — is not met.

Against `expo-ui-shared-host` the shape is more interesting: the Host **closes the two standing iOS
misses** — `mounted` goes 4.39x → **0.62x** (Switch) and 4.38x → **0.55x** (Slider), and Slider
memory 1.46x → **1.09x** — and it does it by converging us onto Expo's numbers rather than beating
them. Every cell where we give ground to our own current code is a cell where Expo pays the same
price: mount UI CPU 0.94x, `presented` 1.00x, unmount 1.00x (Switch). The Host does not make us
better than Expo overall; it makes us *as expensive as Expo on the axes where we currently lead*
(UI CPU 0.67x → 0.94x, unmount 0.16x → 1.00x) in exchange for `mounted` and memory.

**Recommendation: do not ship iOS `<Host>` in 0.2.** Keep `<Host>` as the Android-only container from
T16 and keep the iOS no-op. The one cell worth buying — `mounted` at 0.13–0.14x of today — is the
T11 first-measure leaving the mount turn, which P1 §6 reason 2 already prices as a one-line deferral
that does not cost a composition. Detail in [Recommendation](#recommendation-for-02).

## Ratio table

One run, `quick` plan, 4 launches × 20 measured iterations, 5 warmup, `CLOCK_UPTIME_RAW`,
**machine load1 4.63 over 14 cores, runner label `quiet NO` (busy)**, `problems: none`. All five arms
in the same run. `uptime` at the start of the bench window was 3.24 (gate is load1 > 7 → wait), so no
wait was taken; the run is labelled, not repeated (D19). Another task was loading the machine during
the run: the runner sampled load 426×, median 4.08 / p90 10.08 / max 50.37, 12.4 % of samples over
7.0. Treat the absolute milliseconds as "busy-machine iOS" and the paired ratios as the answer.

Ratios are the runner's own launch-paired `pairedLaunchRatios()` (D9) via
`bench/tools/arm-ratios.mjs --arm=…`; the parenthesised number is that ratio's own launch spread.
**ᴺ** = spread over 10 % (`NOISE_REL_SPREAD`) → the cell is reported and carries **no verdict**. No
`n/v` is upgraded to a pass anywhere. `presented` carries no ᴾ: the frame probe reported "no
out-of-order samples" in every cell. The twelve cells for the four un-spiked components (Button,
Progress, SegmentedControl, DatePicker) report `skipped: implements switch, slider only` rather than
a number.

The two arms lay children out differently and it matters for reading these rows: our Host gives each
child the Yoga box RN gave its shell (`.frame().position()`), while Expo's own bench arm puts its
children in a SwiftUI `VStack` (`bench/src/implementations/expoUi.ios.tsx:271`), so Expo's children
are laid out by SwiftUI. Same controller count, different layout owner.

Bold = meets the ≤ 1.0x target **and** carries a verdict.

### Switch — mount N=50, absolutes (median of launch medians)

| Arm | presented | mounted | JS commit | JS CPU/op | UI CPU/op | UI CPU/unmount |
| --- | --- | --- | --- | --- | --- | --- |
| `rn-core` | 16.15 ms | 4.76 ms | 820.09 µs | 1.00 ms | 4.03 ms | 2.98 ms |
| `expo-ui-host-per-control` | 107.14 ms | 16.67 ms | 2.14 ms | 2.41 ms | 63.74 ms | 30.84 ms |
| `expo-ui-shared-host` | 33.04 ms | 4.68 ms | 1.18 ms | 1.35 ms | 29.63 ms | 30.46 ms |
| `nitro-ui` | 16.16 ms | 20.51 ms | 1.08 ms | 1.29 ms | 19.93 ms | 4.95 ms |
| `nitro-ui-host` | 33.22 ms | **2.89 ms** | 1.31 ms | 1.49 ms | 27.70 ms | 30.99 ms |

### Switch — mount N=50, launch-paired ratios

| Arm | presented | mounted | JS commit | JS CPU/op | UI CPU/op | UI CPU/unmount |
| --- | --- | --- | --- | --- | --- | --- |
| `nitro-ui` (today) | 1.00x (0%) | 4.26x (1%) | 1.33x (1%) | 1.28x (0%) | 4.91x (1%) | 1.66x (3%) |
| `nitro-ui-host` vs `rn-core` | 2.06x (51%) ᴺ | 0.61x (0%) | 1.60x (2%) | 1.49x (4%) | 6.88x (8%) | 10.26x (3%) |
| `nitro-ui-host` vs `expo-ui-host-per-control` | 0.31x (51%) ᴺ | 0.17x (2%) | 0.59x (2%) | 0.60x (2%) | 0.43x (8%) | 1.02x (19%) ᴺ |
| **`nitro-ui-host` ÷ `expo-ui-shared-host`** | 1.00x (34%) ᴺ | **0.62x** (2%) | 1.12x (2%) | 1.10x (2%) | **0.94x** (5%) | 1.00x (1%) |
| **`nitro-ui-host` ÷ `nitro-ui`** | 2.06x (51%) ᴺ | **0.14x** (2%) | 1.21x (1%) | 1.16x (4%) | 1.40x (8%) | 6.27x (4%) |
| `nitro-ui` ÷ `expo-ui-shared-host` | 0.66x (51%) ᴺ | 4.39x (2%) | 0.93x (2%) | 0.95x (2%) | 0.67x (4%) | 0.16x (2%) |

### Switch — update N=50 and memory N=200

| Cell / ratio | presented | mounted | JS commit | JS CPU/op | UI CPU/op | bytes/inst |
| --- | --- | --- | --- | --- | --- | --- |
| update absolutes: `nitro-ui` → `nitro-ui-host` | 16.12 → 16.11 ms | 1.57 → 1.31 ms | 945.80 µs → 1.08 ms | 1.11 → 1.19 ms | 6.35 → 5.83 ms | — |
| **update `nitro-ui-host` ÷ `nitro-ui`** | 1.00x (0%) | 0.81x (9%) | 1.11x (11%) ᴺ | 1.05x (8%) | **0.91x** (7%) | — |
| update `nitro-ui-host` ÷ `expo-ui-shared-host` | 1.00x (0%) | **0.49x** (8%) | 1.25x (7%) | 1.15x (4%) | **0.73x** (8%) | — |
| memory absolutes (KiB/inst): `rn-core` 105.7 · `expo-per-control` 392.9 · `expo-shared` 264.5 · `nitro-ui` 263.3 · **`nitro-ui-host` 242.7** | | | | | | |
| **memory `nitro-ui-host` ÷ `nitro-ui`** | | | | | | **0.92x** (1%) |
| **memory `nitro-ui-host` ÷ `expo-ui-shared-host`** | | | | | | **0.92x** (1%) |
| memory `nitro-ui` ÷ `expo-ui-shared-host` | | | | | | 0.99x (1%) |

### Slider — mount N=50, absolutes

| Arm | presented | mounted | JS commit | JS CPU/op | UI CPU/op | UI CPU/unmount |
| --- | --- | --- | --- | --- | --- | --- |
| `rn-core` | 16.15 ms | 1.24 ms | 568.28 µs | 946.30 µs | 839.67 µs | 0.51 ms |
| `expo-ui-host-per-control` | 16.17 ms | 16.96 ms | 2.13 ms | 2.38 ms | 43.77 ms | 42.25 ms |
| `expo-ui-shared-host` | 16.16 ms | 5.17 ms | 1.06 ms | 1.28 ms | 21.81 ms | 28.44 ms |
| `nitro-ui` | 16.16 ms | 22.25 ms | 1.29 ms | 1.51 ms | 21.37 ms | 4.92 ms |
| `nitro-ui-host` | 16.17 ms | **2.82 ms** | 1.27 ms | 1.48 ms | 19.30 ms | 23.95 ms |

### Slider — mount N=50, launch-paired ratios

| Ratio | presented | mounted | JS commit | JS CPU/op | UI CPU/op | UI CPU/unmount |
| --- | --- | --- | --- | --- | --- | --- |
| **`nitro-ui-host` ÷ `nitro-ui`** | 1.00x (0%) | **0.13x** (4%) | 0.97x (1%) | 0.98x (5%) | 0.83x (17%) ᴺ | 4.90x (7%) |
| **`nitro-ui-host` ÷ `expo-ui-shared-host`** | 1.00x (0%) | **0.55x** (1%) | 1.22x (2%) | 1.21x (4%) | 0.95x (22%) ᴺ | 0.84x (13%) ᴺ |
| `nitro-ui-host` ÷ `rn-core` | 1.00x (0%) | 2.24x (13%) ᴺ | 2.20x (20%) ᴺ | 1.66x (37%) ᴺ | 20.22x (32%) ᴺ | 53.49x (15%) ᴺ |
| `nitro-ui` ÷ `expo-ui-shared-host` | 1.00x (0%) | 4.38x (3%) | 1.26x (1%) | 1.23x (5%) | 1.09x (20%) ᴺ | 0.18x (3%) |

### Slider — update N=50 and memory N=200

| Cell / ratio | presented | mounted | JS commit | JS CPU/op | UI CPU/op | bytes/inst |
| --- | --- | --- | --- | --- | --- | --- |
| update absolutes: `nitro-ui` → `nitro-ui-host` | 16.13 → 16.13 ms | 1.54 → 1.18 ms | 1.01 → 1.02 ms | 1.11 → 1.09 ms | 7.47 → 6.41 ms | — |
| **update `nitro-ui-host` ÷ `nitro-ui`** | 1.00x (0%) | 0.82x (8%) | 1.00x (6%) | 1.00x (6%) | **0.87x** (8%) | — |
| update `nitro-ui-host` ÷ `expo-ui-shared-host` | 1.00x (0%) | **0.38x** (6%) | 1.15x (6%) | 1.09x (5%) | **0.59x** (5%) | — |
| memory absolutes (KiB/inst): `rn-core` 6.5 · `expo-per-control` 299.6 · `expo-shared` 176.6 · `nitro-ui` 259.0 · **`nitro-ui-host` 193.6** | | | | | | |
| **memory `nitro-ui-host` ÷ `nitro-ui`** | | | | | | **0.75x** (2%) |
| **memory `nitro-ui-host` ÷ `expo-ui-shared-host`** | | | | | | 1.09x (1%) |
| memory `nitro-ui` ÷ `expo-ui-shared-host` | | | | | | 1.46x (1%) |

## Plain answer per metric (D23)

"is the Host better than nitro-ui without it?" asked per metric, with the D15 question next to it.
Verdict column: ✅ better with a verdict, ❌ worse with a verdict, ⚪ verdict-quality parity, ᴺ the
spread forbids a verdict.

| Metric | Switch | Slider | Verdict vs `nitro-ui` | vs `expo-ui-shared-host` |
| --- | --- | --- | --- | --- |
| mount memory (N=200) | 242.7 vs 263.3 KiB | 193.6 vs 259.0 KiB | ✅ 0.92x / 0.75x — real bytes, low spread | Switch ✅ 0.92x; Slider ❌ 1.09x (still above Expo) |
| mount `mounted` | 2.89 vs 20.51 ms | 2.82 vs 22.25 ms | ✅ 0.14x / 0.13x — the biggest measured effect in the spike | ✅ 0.62x / 0.55x; closes a 4.4x standing miss |
| mount UI CPU/op | 27.70 vs 19.93 ms | 19.30 vs 21.37 ms | ❌ 1.40x on Switch; ᴺ (0.83x, 17 %) on Slider | 0.94x Switch / ᴺ Slider — parity, not a win |
| mount `presented` | 33.22 vs 16.16 ms | 16.17 vs 16.16 ms | ❌ one extra frame on Switch (ᴺ-flagged, but 2 × 16.6 ms is unambiguous); ⚪ parity on Slider | 1.00x both — Expo pays the same frame |
| mount JS CPU/op | 1.49 vs 1.29 ms | 1.48 vs 1.51 ms | ❌ 1.16x Switch; ⚪ 0.98x Slider | ❌ 1.10x / 1.21x |
| mount JS commit | 1.31 vs 1.08 ms | 1.27 vs 1.29 ms | ❌ 1.21x Switch; ⚪ Slider | ❌ 1.12x / 1.22x |
| mount UI CPU/unmount | 30.99 vs 4.95 ms | 23.95 vs 4.92 ms | ❌❌ 6.27x / 4.90x, both with verdicts | 1.00x Switch / 0.84x ᴺ Slider — Expo pays the same teardown |
| update UI CPU/op | 5.83 vs 6.35 ms | 6.41 vs 7.47 ms | ✅ 0.91x / 0.87x | ✅ 0.73x / 0.59x |

**3 up, 3 down, 2 parity — and the two downs are the two that hurt a dense list**: the per-op UI cost
of mounting Switches goes up 40 %, and the cost of throwing them away goes up 6.3x. `unmount` is
measured in its own bracket, symmetric across arms (`bench/src/runner.ts:149`), so this is not a
bracket artefact.

Two facts make the "worse" cells readable rather than damning. First, **any** shared host pays them:
Switch mount UI CPU is 29.63 ms for `expo-ui-shared-host` vs our 27.70 ms, and Switch unmount is
30.46 ms vs our 30.99 ms — with `expo-ui-host-per-control` at 30.84 ms too, the ~30 ms teardown is a
property of putting N SwiftUI controls in compositions at all, not of our implementation. Second, the
`mounted` win is not the composition's merit: nitro-ui's 20.5 ms is our own choice to run T11's first
measure inside the mount turn, and a hosted control simply never measures. The Host buys the
deferral by deleting the measurement, which P1 §6 already noted is available without a Host.

**Where this leaves the standing iOS misses** (`R2-release-0.1.report.md`, P1): memory was 1.00x
Switch / 1.44x Slider and `mounted` 5.17x / 4.47x. The Host takes memory to 0.92x / 1.09x and
`mounted` to 0.62x / 0.55x. Slider memory is still above 1.0x. iOS `presented` and mount UI CPU were
**leads** (0.30x / 0.34x and 0.70x / 0.84x) and the Host spends them.

## Byte attribution (`vmmap -summary`, batch of 200 held mounted)

Same artifact the bench ran (`a4f84ca`, release, embedded bundle), same device, captured after the
bench, load ~3.2. Per cell: 3 launches × 3 samples, median of 9, taken while the 200 controls are
held mounted. Raw samples: `docs/tasks/T17-ios-host-spike/vmmap-peak.tsv`.

| Control | Arm | phys footprint | Default dirty / bytes / allocs | `AttributeGraph` bytes / allocs | AG graph data | QuartzCore |
| --- | --- | --- | --- | --- | --- | --- |
| Switch | `nitro-ui` | 76.1 M | 52.2 M / 43.8 M / 283 592 | 3519 K / 93 000 | 712 K / 4 000 | 1980 K / 19 482 |
| | `nitro-ui-host` | 72.6 M | 50.0 M / 42.9 M / 308 171 | 2133 K / 49 791 | 541 K / 2 408 | 1905 K / 18 696 |
| Slider | `nitro-ui` | 75.3 M | 51.6 M / 44.2 M / 309 747 | 3813 K / 108 800 | 1244 K / 6 600 | 1861 K / 19 474 |
| | `nitro-ui-host` | 62.3 M | 40.6 M / 34.0 M / 262 899 | 2420 K / 64 994 | 1073 K / 5 008 | 1786 K / 18 688 |

Deltas per instance (host − nitro-ui, ÷200, KiB):

| Control | Δ footprint | Δ `DefaultMallocZone` bytes | Δ allocs/inst | Δ `AttributeGraph` | Δ AG data | Δ QuartzCore | AG + AG data per inst |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Switch | **−17.9** | −4.6 | +123 | −6.9 | −0.9 | −0.4 | 21.2 → 13.4 (−37 %) |
| Slider | **−66.6** | −52.2 | −234 | −7.0 | −0.9 | −0.4 | 25.3 → 17.5 (−31 %) |

**The bench's `bytesPerInstance` is corroborated by absolute footprint**: Δ footprint/200 is −17.9 KiB
(Switch) and −66.6 KiB (Slider) against the runner's own −20.6 and −65.4 KiB/inst. Two independent
ledgers, same answer, same sign and size.

**These `nitro-ui` rows reproduce P1 §5's ledgers**, which is the check that the capture is the same
measurement P1 made: Switch `DefaultMallocZone` bytes 43.8 M (P1: 43.8 M), `AttributeGraph`
3519 K / 93 000 (P1: identical), QuartzCore 1980 K / 19 482 (P1: 1980 K / 19 480); Slider zone bytes
44.2 M and AG 3813 K / 108 800, both identical to P1. Footprints differ (76.1 vs 84.1 M Switch,
75.3 vs 76.4 M Slider) — footprint is the loosest ledger in this bench, as P1 noted.

Three things this converts from inference to measurement:

1. **P1's "one `UIHostingController` + its root view is the memory lever" is right, and the size is
   control-dependent**: −66.6 KiB/inst for Slider but only −17.9 KiB/inst for Switch. P1's estimate
   (−80 KiB/inst, taken from Expo's 200-hosts-vs-1-host experiment) over-read our Switch case by ~4x —
   our per-control controller is cheaper than Expo's, so there was less to amortise. This is why
   Switch memory was already 0.99x and Slider was 1.46x.
2. **The per-child `AttributeGraph` floor is real but not immutable.** A shared root removed 37 %
   (Switch) and 31 % (Slider) of the AttributeGraph zone — better than the ~26 % P1 measured for
   Expo's shared host — yet it still leaves **13.4 / 17.5 KiB/inst** of SwiftUI graph that belongs to
   the views, not the hosts. Against `rn-core` (Switch 105.7 KiB/inst total, Slider 6.5) the floor is
   still the wall: a Host does not get us near it.
3. **Zone accounting and footprint disagree on Switch** (−4.6 KiB zone bytes vs −17.9 KiB footprint,
   and the host *increases* allocation count by 123/inst while shrinking Slider's by 234). The zone
   holds native and Hermes allocations together, so as in P1 the zone rows describe shape, not cause.
   The footprint delta and the bench's own per-instance number are the two to quote.

## What is still per child, if it misses

A hosted control is not a lightweight child. Per hosted instance, still allocated and still live:

- the **Fabric shadow node + component descriptor** (unchanged — RN still mounts N children);
- the **RN component view** (`RCTViewComponentView`) with its Yoga box, still in the view tree;
- the **Hybrid View** and its `NitroSwiftUIHost` `UIView` — created, added, then hidden and made
  touch-deaf by `hostAdopt`, so it exists and costs but neither draws nor receives touches;
- the **model object + prop plumbing + event wiring**, including the controlled-value handshake, all
  of which stays per child (this is the 1.10–1.21x JS we measured);
- the **per-child SwiftUI view and its `AttributeGraph` nodes** — measured above at 13.4 KiB/inst
  (Switch) and 17.5 KiB/inst (Slider) even with one root.

What the batch saves is exactly one `UIHostingController`, one hosting root view, one SwiftUI
rendering root, one environment/theme resolution. That is the whole product, and it is worth 18–67
KiB/inst and one synchronous measure out of the mount turn.

## How Expo does it, from the source

Reference clone `repos/expo_expo` (`@expo/ui` 58.0.22; the clone and `node_modules` agree), read-only.
`Host` on iOS is `HostView.swift`, which composes its children's content in **one** `AnyLayout` over
a `ZStackLayout`, applies a `FillAlignmentModifier` and `fixedSize`, and hosts the result in a
`UIHostingController<AnyView>` (`SwiftUIHostingView.swift`).

The load-bearing detail is `SwiftUIVirtualView`
(`packages/expo-modules-core/ios/Core/Views/SwiftUI/SwiftUIVirtualView.swift`): it is **an `NSObject`,
not a `UIView`** — its own comment calls it "a fake `UIView` for `RCTMountingManager`". So in
production Expo does **not** allocate a `UIView` per hosted child. Per child it keeps: the Fabric
shadow node + descriptor, that virtual-view `NSObject`, one `Props: UIBaseViewProps`
`ObservableObject` whose `@Field`s carry the props, the child's SwiftUI content struct, and a
`ShadowNodeProxy` — the object through which RN's Yoga box is pushed *into* SwiftUI
(`setStyleSize` / `setContentOrigin`).

That is the same shape we shipped, with one difference worth naming: Expo's `ShadowNodeProxy` pushes
the Yoga box into a SwiftUI layout the host then runs (and its bench arm nests a `VStack`), while our
container reads the box off the child's RN shell and applies `.frame().position()` directly. Expo
gives up one `UIView` per child; we do not, because RN's `RCTViewComponentView.currentContainerView`
is the component view itself, so the child's shell and its `NitroSwiftUIHost` view are already there
and hiding them is cheaper than unmounting them.

## Public-API check (P1's caveat)

**There is no public `UIHostingView` in the iOS 27 SDK, so P1 §6 reason 3 and "cheap win 2" are
void.** Answered from
`iPhoneSimulator27.0.sdk/…/SwiftUI.swiftmodule/arm64-apple-ios-simulator.swiftinterface`, not from
memory: all 12 `UIHostingView` occurrences are underscored — `_UIHostingView<Content>: UIView`
(L27793, SPI by underscore despite `public`), `_makeUIHostingView<Content> -> NSObject` (L3077),
`_UIHostingViewable` (L30631), plus three `@available(…, deprecated: …)` message strings. The
non-underscored public hosting types are `UIHostingController<Content>: UIViewController` (L28043)
and `UIHostingConfiguration` (L13183), which is a `UIContentConfiguration` — it only exists as a list
cell's content, not as a general container. So the only public path to one SwiftUI root for N children
is a hosting **controller**, which is what this spike builds on and what Expo builds on
(`UIHostingController<AnyView>`). Nothing here depends on an SPI type; nothing here is available
"for free" via a lighter-weight root than the one we already pay for.

## What a Host costs as a product (iOS)

T16's list, restated for what this spike actually does, plus what only iOS has. All of it is permanent
product surface, not implementation debt.

- **No interleaving with RN views.** The container composes nitro-ui children and nothing else. An RN
  `View` between a `<Host>` and a control un-hosts the control silently (ours renders its own
  controller, as it does today; Expo logs `MissingHostException`). **Reasoned from the code.**
- **Two-hop rule.** A control nested inside an RN view inside a `<Host>` is not composed — resolution
  is one sibling-hop (`NitroSwiftUIHost.resolveHosting()`). Direct children only, and that has to be
  in the doc comment.
- **Not scrolled, clipped or transformed by RN ancestors, and no `Modal`.** RN hands the Host one
  rectangle; everything inside it is SwiftUI's. A `ScrollView` will not move hosted content, and
  `removeClippedSubviews` or list recycling that detaches a child acts on a view the Host has already
  hidden. **Reasoned; the spike did not build these cases.**
- **Sizing / D17, in the same sentence:** a hosted control has no box of its own for Yoga, so
  `measureContent()` reports 0×0 for it and `onLayout` has nothing to report. Anything D17 decides
  about intrinsic sizing is a decision about controls *outside* Hosts; a hosted control's size is the
  Yoga box its shell had when the Host adopted it, applied inside SwiftUI.
- **Child boxes are a snapshot.** The container re-reads the child set (ids and frames) from the view
  tree, coalesced per runloop turn, and re-reads when the Host's own bounds change. A layout pass that
  moves one child without changing the Host can go stale until the next change. **Reasoned; not
  stress-tested.** This is the sharpest implementation risk if a Host ever ships on iOS.
- **Accessibility order changes shape.** A hosted control's own `UIView` is hidden and touch-deaf, so
  traversal inside the Host follows SwiftUI order (which is our mount order, keyed per child), and the
  Host reads as one block against RN views around it. For Slider specifically, our
  `NitroUiSliderAccessibilityElement` is replaced by SwiftUI's own element — different labels and
  actions, not merely a different position. **Reasoned; no a11y-tree capture was run.**
- **`presented` gains a frame on Switch** (measured: 16.16 → 33.22 ms) and **teardown concentrates in
  the Host** (measured: 4.95 → 30.99 ms/op). Both are shared-host properties — Expo pays both — but
  they are ours to explain once we ship the container.
- **A standalone instance recycled into a Host keeps an unused controller**, and vice versa a hosted
  instance moved out gets a fresh one (`createHosting()` is lazy, `hostRelease()` reverses adoption).
  Correct, and wasteful in a recycler.

## Lines of code

1,280 hand-written non-doc lines on this branch, of which **733 are the library**:

- **iOS 550** — `ios/core/NitroUiHost.swift` 306 (the container view: child-set diff, adoption,
  per-child frames, release), `ios/core/NitroSwiftUIHost.swift` +198 (the child side:
  `resolveHosting()`, `hostAdopt` / `hostRelease`, lazy controller creation, zero-size `measureContent`
  for a hosted child), `ios/components/Host/HybridNitroUiHost.swift` 46;
- **JS 135** — `src/components/Host/Host.tsx` 47, `Host.nitro.ts` 35, `NitroUiHostConfig.ts` 29,
  `NativeNitroUiHost.ts` 24; plus 5 export lines in `src/index.ts` and 10 in `nitro.json`;
- **Android 33** — a no-op Hybrid View, because nitrogen refuses to generate a view with no native
  implementation on a platform.

Plus 139 lines of bench arm (`bench/src/implementations/nitroUi.tsx` +61 and the `nitro-ui-host`
plan/cell wiring), 9 runner/gate lines (`scripts/bench/lib.mjs`, `scripts/__tests__/bench-gate.test.js`),
232 example screen (`example/src/HostSpikeScreen.tsx` 218) and 165 lines of real-input UI tests —
1,280 hand-written in total. Outside it: 1,127 nitrogen-generated lines and 50 in `etc/`
(api-extractor + package-files).

The child-side change is in the shared base class (`NitroSwiftUIHost`), not per component — same as
T16 on Android.

**What every other component would need** before it can claim `<Host>` on iOS: (1) prove the SwiftUI
view is identical when composed by the Host instead of its own controller — a harness run per
component; (2) say what its intrinsic size means inside a Host, since it reports nothing (D17);
(3) exclude anything that owns a window or a presentation — `Modal` cannot be hosted at all;
(4) for components with children of their own, decide whether the one-hop rule recurses;
(5) re-check any custom `UIAccessibilityElement` it installs, since hosting replaces it. Switch and
Slider needed none of these as an open question, which is why they were the right controls to spike.

## Recommendation for 0.2

**Do not ship iOS `<Host>`. H3 stays a no-op on iOS; keep the container Android-only (T16).** D23's
rule is "if the Host is better, nitro-ui ships it", and measured against nitro-ui-without-a-Host it
is better on 3 metrics and worse on 3, with the losses exactly where a dense list is most sensitive:
**mount UI CPU/op 1.40x and unmount UI CPU/op 6.27x on Switch**. On Android the same container was a
clean sweep of both standing misses (T16: memory 2.75x → 0.87x, UI CPU 1.50x → 0.80x); on iOS the
architecture has no equivalent headroom because iOS was not paying per-controller UIView/Fabric
subtrees — it was paying a measure call we chose to put in the mount turn.

The case for shipping is real and I want it on the record: **`mounted` 0.13–0.14x of today and 24 KiB
Switch / 65 KiB Slider per instance fewer, both at 1–4 % spread.** That is the largest single
improvement anyone has measured on iOS mount, and it is what a shared composition buys.

Why it still loses:

1. **The `mounted` win is the deferral, not the composition.** nitro-ui's 20.5 ms `mounted` is T11's
   first measure running inside the mount turn; a hosted control never measures, which is why it drops
   to 2.9 ms. P1 §6 reason 2 says the same effect is available as a deferral without a Host. The spike
   did not build the deferral (out of scope, one round), so treat "0.14x is buyable for one line" as
   P1's claim, tested for its *upper bound* here, not as a measured equivalence.
2. **It converts leads into parities to fix parities.** Today iOS beats Expo on mount UI CPU
   (0.67x Switch), unmount (0.16x) and `presented` (0.66x ᴺ). With the Host those become 0.94x,
   1.00x and 1.00x ᴺ. The 4.4x `mounted` gap closes, and the 1.46x Slider memory gap closes to 1.09x —
   real, but Slider memory still misses.
3. **The per-child floor is untouched.** 13.4 / 17.5 KiB/inst of `AttributeGraph` survives one root,
   plus a Fabric node, a component view, a hidden `UIView`, a Hybrid Object and a model per instance.
   "A host gets iOS to `rn-core`" is as false here as P1 found for Expo.
4. **The product cost is not repaid on iOS.** T16's Host bought Android two metrics it had no other
   route to. On iOS the same cost — no interleaving, no `ScrollView`, no clip/transform, no `Modal`,
   no reported size (D17), changed a11y order, snapshot boxes — buys a metric with a cheaper route.

Conditions I would attach if the orchestrator overrules this and ships it anyway:

1. **Both controls or neither, and only these two** — the API is `<Host>` with
   `HostProps extends ViewProps`, direct children only, identical to Android; anything un-spiked throws
   in the bench arm rather than publishing an unasked-for number (`nitroUi.tsx`).
2. **Say `presented` and unmount out loud in the perf docs**, with these numbers, because both are
   regressions a user of a recycling list will feel, and both are currently only in this file.
3. **Stress the box snapshot before ship** (one child relaid out without the Host resizing), since
   that is the one known correctness-shaped risk and this round did not test it.
4. **Fix the `AttributeGraph` per-child floor before claiming iOS memory parity on Slider** — the Host
   gets Slider from 1.46x to 1.09x and no further.

The better next experiment on iOS, in priority order: (a) the T11 first-measure deferral without a
Host, measured in the same 5-arm shape so `mounted` can be compared to this 0.13–0.14x directly;
(b) a per-instance `AttributeGraph` reduction (P1's floor is the real wall); (c) revisit an iOS Host
only if (a) turns out not to move `mounted`.

## Gates

| Command | Result |
| --- | --- |
| `bun run check` | **green** on the tree these commits contain (`CHECK_EXIT=0`) — the run recorded for `a4f84ca` covered typecheck, bench typecheck, eslint, prettier, jest, `test:native`, `perf:renders`, nitrogen drift, autolinking drift, `prepare`, api-extractor, publint, manifest and readme. It predates this docs-only commit, which touches no compiled or checked file. |
| new assertion in `src/__tests__/viewConfigs.test.ts` shown to fail | **red as intended**, then green: the generated-config coverage entry for `NitroUiHost` fails with `covers every generated config (add the copy + an entry here)` when the config copy is renamed, and passes as committed. Same gate T16 used. |
| real tap toggles a hosted Switch | **pass** — `testHostedSwitchAnswersARealTap` in `example/ios/NitroUiExampleUITests/RealInputTests.swift`, run on the iPhone 17 simulator: `Executed 4 tests, with 0 failures` and `** TEST EXECUTE SUCCEEDED **` in `docs/tasks/T17-ios-host-spike/xcodebuild-host.log`. The hit lands on the Host's hosting view, the event reaches JS, the controlled handshake completes. |
| real drag moves a hosted Slider | **pass** — `testHostedSliderAnswersARealDrag` in the same run. `testRealInputSwitch` / `testRealInputSlider` (unhosted) cover the same paths outside a Host, so the run proves both branches. |
| iOS harness, Switch + Slider suites | **36/36 passed** — the regression net for "nothing outside a Host changes": `NitroSwiftUIHost.swift` is the shared base class for every nitro-ui control on iOS. |
| iOS harness, sizing suites | **24/24 passed** (`Sizing.harness`) plus **4/4** `ColdSizing.harness`. Run because the measure/layout gates are exactly what a hosted control skips, so an unhosted control must prove it still measures. |
| screenshot pair | `docs/tasks/T17-ios-host-spike/host-screen.png` — hosted Switches and a hosted Slider alongside standalone ones: the hosted controls keep their Yoga boxes and are visually indistinguishable from the standalone controls. |
| `bun bench --platform ios --plan quick` | **one run**, all five arms, `problems: none`, `sha a4f84ca`, `dirty false`, 90 cells (78 measured, 12 skipped), 4 launches each, 1979 s. Frame probe: "no out-of-order samples" in every cell. Not repeated (D19). |
| `node bench/tools/arm-ratios.mjs --arm=nitro-ui-host` (and `--arm=nitro-ui`, `expo-ui-shared-host`, `expo-ui-host-per-control`, `rn-core`) | the paired-ratio tables above. |
| `vmmap -summary` at N=200 | 3 launches × 3 samples per cell for `nitro-ui` and `nitro-ui-host`, Switch and Slider, on the bench artifact; §5. Raw rows in `docs/tasks/T17-ios-host-spike/vmmap-peak.tsv`. |

## Files changed

- `ios/core/NitroUiHost.swift` *(new)* — the container: child set re-read from the view tree,
  coalesced per runloop turn, id+frame diff, `hostAdopt` / `hostRelease`, one `UIHostingController`.
- `ios/core/NitroSwiftUIHost.swift` — child side: `resolveHosting()` (find the container among the
  shell's siblings), hide + touch-deafen + zero sizing on adoption, lazy controller creation,
  `measureContent()` reports zero for a hosted child.
- `ios/components/Host/HybridNitroUiHost.swift` *(new)* — the iOS Hybrid View for `<Host>`.
- `android/…/HybridNitroUiHost.kt` *(new)* — no-op; exists so nitrogen generates the view on Android.
- `src/components/Host/*` *(new)* + `src/index.ts` — public `<Host>`, `HostProps extends ViewProps`.
- `nitrogen/generated/**` — the generated bindings for the new view; `etc/` — api-extractor + manifest.
- `bench/src/implementations/nitroUi.tsx`, `bench/src/{plan,types,BenchApp}.ts(x)`,
  `bench/tools/arm-ratios.mjs`, `scripts/bench/lib.mjs` — the `nitro-ui-host` iOS arm (Switch + Slider
  only; other components report `skipped: implements switch, slider only`).
- `example/src/HostSpikeScreen.tsx`, `example/src/App.tsx` — the example tab.
- `example/ios/NitroUiExampleUITests/RealInputTests.swift`, `src/__tests__/viewConfigs.test.ts` —
  real-input coverage and the config-coverage gate.

## Follow-ups

1. **T11 first-measure deferral, no Host** — the experiment that decides whether `mounted` can be
   bought at the root. Bench it in the same 5-arm shape so it can be compared to this 0.13–0.14x.
2. If a Host is ever shipped on iOS: the box-snapshot staleness case, an a11y-tree capture
   (especially Slider's replaced element), and a `ScrollView`/clip/`Modal` matrix — none of which this
   round built (D19).
3. `Host` remains a documented no-op on iOS in the public API. That is a trap for a reader who knows
   Expo, and it should be named in the docs until either it works or it is Android-only in the types.

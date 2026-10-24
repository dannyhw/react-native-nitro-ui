# P1 — iOS mount-cost profiling — report

**Branch:** `task/P1-ios-mount-profile` · **Base:** `bc8fd7c` · **One round, no fix round.**
**Deliverable:** this report. **No product code changed** — no instrumentation was needed; the
answer came from a stock Time Profiler template plus `vmmap`.

## 1. Summary — the answer

- **Thread: UI thread, not JS/commit.** In the traced mount loop the main thread spends **3612 ms**
  and the Hermes JS thread **144 ms** (25:1). Bench `JS commit` and `JS CPU/op` are at parity with
  `expo-ui-shared-host` on all three controls (1.11–1.27× / 0.99–1.20×).
- **But it is not `UIHostingController` creation.** `NitroSwiftUIHost.init` is **0.3 %** of the
  mount transaction and every frame named `UIHostingController` together is **0.8 %** of the
  mount-window main-thread CPU. R2's README attribution (per-instance hosting-controller creation)
  is right about the thread and wrong about the cause.
- **The cost is our own T11 sizing contract: the first measure forces SwiftUI's entire first
  layout synchronously inside the mounting transaction.**
  `NitroSwiftUIHost.didMoveToWindow() → refreshContentSize() → measureFittingSize() →
  -[UIView layoutBelowIfNeeded]` = **44.8 % of the transaction / 33.5 % of all main-thread CPU in
  the mount window** (1208 ms of 2698 ms / 3612 ms).
- **The shared host does the same work, just outside the transaction.** `expo-ui-shared-host`
  spends **7.0 %** of its mount-window main CPU inside `performTransaction:` and **81.7 %** in
  SwiftUI's own update sequence afterwards (`__CFRunLoopDoSource1 → UC::DriverCore::continueProcessing
  → _UIUpdateSequenceRunNext`). nitro-ui's share in that sequence is **0.4 %** — the work is
  relocated, not duplicated. Hence `mounted` 4.58 ms but `UI CPU/op` 32.69 ms for the shared host
  against our 23.68 ms / 22.99 ms (Switch N=50): **we do 30 % less main-thread work and report it
  as a 5.2× miss, because our number is all inside the measured window and theirs is not.**
- **The per-instance bytes *are* host-attributable** (vmmap zone deltas, §5): the Slider/Button miss
  is ~80–84 % default-heap bytes + ~12–17 % `AttributeGraph` — the same shape as a controlled
  host-count experiment inside `@expo/ui` (200 hosts → 1 host = 119–122 KiB/instance, ~80 % of it
  zone-accounted heap).
- **H3 (iOS `<Host>`): no-go.** It cannot reduce per-child SwiftUI work (the axis we already win or
  tie), it risks the `presented` advantage we hold for a reason we cannot measure, and the memory
  win it *would* buy has two cheaper routes (§7). `mounted` is a metric-placement artefact, and
  fixing it by deferring the measure trades away review S5's first-frame guarantee for zero CPU
  saving.

## 2. Environment, load, and how to reproduce

| | |
| --- | --- |
| Build | `bc8fd7c`, Release bench app, `--skip-build` for every run below |
| Device | iPhone 17 simulator `F08675D3-A32B-4F88-BC81-02D7E0CB797E`, iOS 27.0 (`ios27-sim-iphone17`) |
| Host | 14-core M4 Pro, **busy all session** — load 1 = 6.5 … 32.1 |
| Bench | `bun bench --platform ios --plan quick --only <arm…> --component <c> --skip-build`, 4 launches, 20 measured iterations |
| Time Profiler | `xcrun xctrace record --device <udid> --attach <pid> --template 'Time Profiler' --all-processes --time-limit …` |
| Bytes | `xcrun simctl spawn <udid> /usr/bin/vmmap -summary <pid>` while `memory.<c>:<arm>:200` holds the batch mounted |

Load at the runner's guard, per results file (all three `(busy)`):

| Component | Results file | load1 / load5 | Incomplete launches |
| --- | --- | --- | --- |
| Switch | `bench/results/bc8fd7c-ios-20261024T183039Z.md` | 12.04 / 24.59 | 0 |
| Slider | `bench/results/bc8fd7c-ios-20261024T183520Z.md` | 32.11 / 23.41 | 0 |
| Button | `bench/results/bc8fd7c-ios-20261024T184000Z.md` | 10.99 / 22.43 | 1 (`update.button:rn-core:50` launch 3/4 exited early) |

Every absolute number below is therefore **only comparable inside its own row**. Ratios in this
report are quotients of cell medians (the runner's `pairedLaunchRatios()` needs `--compare`, not
run at this load). Within-run spread on `mounted` was 25–26 % on the Switch run, so treat the
*magnitude* of the ratios as soft and the *direction* as solid — the direction is what R2/A1
published and it reproduced.

Traces (not committed; Xcode bundle dirs): `/tmp/p1-nitro-mount200.trace`,
`/tmp/p1-expo-shared200.trace`, `/tmp/p1-expo-perctrl200.trace` (last one recorded, not analysed —
the two arms that matter are the first two). Exports `/tmp/tp-nitro.xml`, `/tmp/tp-expo-shared.xml`.
Analysis scripts `/tmp/p1-tree4.py`, `/tmp/p1-sub.py`, `/tmp/p1-sym.py`, `/tmp/p1-threads.py`.
Numbers quoted from **launch 2** of each trace (launch-1 stacks are unsymbolicated), filtered to one
thread and one wall-clock window: nitro main `0xc5bef7`, 35.0–41.0 s; shared-host main `0xc60eba`,
34.5–44.5 s. Traced cell: `mount:nitro-ui:200` / `mount:expo-ui-shared-host:200` — **Switch** (bare
action = Switch per `bench/src/plan.ts`; confirmed in-stack by
`-[HybridNitroUiSwitchComponent updateProps:]`). The two traces are not swapped: `NitroSwiftUIHost`
frames carry 1208 ms in the nitro trace and 28 ms in the shared-host trace, `ExpoSwiftUI` frames
0 ms and 305 ms respectively. Slider/Button share `NitroSwiftUIHost` verbatim and were not
separately traced (D19).

## 3. Bench numbers (N=50 mount, N=200 memory)

| Component | Arm | presented | mounted | JS commit | JS CPU/op | UI CPU/op | bytes/inst |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Switch | `rn-core` | 15.95 ms | 6.69 ms | 1.39 ms | 1.43 ms | 5.51 ms | 106.8 KiB |
| | `expo-ui-host-per-control` | 125.91 ms | 16.57 ms | 2.07 ms | 2.43 ms | 87.62 ms | 392.9 KiB |
| | `expo-ui-shared-host` | 52.90 ms | **4.58 ms** | 1.05 ms | 1.38 ms | 32.69 ms | 264.8 KiB |
| | **nitro-ui** | 16.11 ms | **23.68 ms** | 1.20 ms | 1.48 ms | **22.99 ms** | 263.8 KiB |
| Slider | `rn-core` | 15.97 ms | 2.14 ms | 0.96 ms | 1.12 ms | 1.21 ms | 6.8 KiB |
| | `expo-ui-host-per-control` | 64.04 ms | 17.67 ms | 2.14 ms | 2.51 ms | 57.05 ms | 300.2 KiB |
| | `expo-ui-shared-host` | 47.76 ms | **5.43 ms** | 1.09 ms | 1.37 ms | 28.10 ms | 180.5 KiB |
| | **nitro-ui** | 16.11 ms | **24.26 ms** | 1.38 ms | 1.65 ms | **23.51 ms** | 260.7 KiB |
| Button | `rn-core` | 16.00 ms | 6.64 ms | 4.24 ms | 4.01 ms | 2.08 ms | 50.4 KiB |
| | `expo-ui-host-per-control` | 30.51 ms | 17.01 ms | 2.16 ms | 4.07 ms | 36.99 ms | 272.8 KiB |
| | `expo-ui-shared-host` | 32.47 ms | **4.55 ms** | 1.04 ms | 1.44 ms | 11.21 ms | 154.4 KiB |
| | **nitro-ui** | 16.10 ms | **15.12 ms** | 1.16 ms | 1.43 ms | **14.62 ms** | 212.2 KiB |

nitro-ui ÷ `expo-ui-shared-host` (medians):

| Component | mounted | JS commit | JS CPU/op | **UI CPU/op** | presented | memory |
| --- | --- | --- | --- | --- | --- | --- |
| Switch | 5.17× | 1.14× | 1.07× | **0.70×** | 0.30× ᴾ | 1.00× |
| Slider | 4.47× | 1.27× | 1.20× | **0.84×** | 0.34× ᴾ | 1.44× |
| Button | 3.32× | 1.12× | 0.99× | **1.30×** | 0.50× ᴾ | 1.37× |

ᴾ = the frame probe counts frames latched before the mount, so iOS `presented` carries no verdict
(R2/A1's finding, reconfirmed here: our `presented` is 16 ms against the shared host's 47–53 ms and
still cannot be claimed). ÷ `expo-ui-host-per-control` for `mounted`: 1.43× / 1.37× / **0.89×** —
Button is below the per-control arm, agreeing with R2's note that Button's pair may not be a miss.
The memory ratios (1.00 / 1.44 / 1.37) reproduce R2 (0.99 / 1.44 / 1.35) and A1 (0.99 / 1.45 / 1.36).

## 4. The breakdown table (Switch, `mount:nitro-ui:200`, launch 2, main thread, 6.0 s window)

Window totals: main thread **3612 ms** Running (1 ms samples), JS thread **144 ms**; the mounting
transaction is **2698 ms = 74.7 %** of it.

| Slice of `performTransaction:` | ms | % of transaction | % of window CPU |
| --- | --- | --- | --- |
| **our eager first measure** — `NitroSwiftUIHost.didMoveToWindow()` → `refreshContentSize()` → `measureFittingSize()` → `-[UIView layoutBelowIfNeeded]` → `CA::Layer::update_if_needed_` → `-[CALayer layoutSublayers]` | 1208 (1178 at `layoutBelowIfNeeded`) | **44.8 %** (43.7 %) | **33.5 %** (32.6 %) |
| UIKit `_didMoveFromWindow:` cascade for the rest of the subtree (SwiftUI's own window transition + deeper views) | 460 | 17.0 % | 12.7 % |
| `unmountChildComponentView:` — teardown of the *previous* batch, in the same transaction | 434 | 16.1 % | 12.0 % |
| Fabric mount bookkeeping outside `addSubview:` (component-view alloc/init, props) | 243 | 9.0 % | 6.7 % |
| Other UIKit frames in the `addSubview:` cascade (shared cache, unsymbolicated) | 235 | 8.7 % | 6.5 % |
| Other work in the transaction (depth-2 siblings) | 107 | 4.0 % | 3.0 % |
| the transaction closure itself | 11 | 0.4 % | 0.3 % |

Rows are an exact decomposition of 2698 (1208 + 460 + 434 + 243 + 235 + 107 + 11); 1903 ms of the
transaction is `-[UIView _addSubview:positioned:relativeTo:]` → `_postMovedFromSuperview:` →
`_didMoveFromWindow:`, and 1208 + 460 + 235 of it is the window-did-move cascade above.

Named slices measured over the whole window (inclusive), to settle the disputed attributions:

| Frame / pattern | ms | % of window main CPU |
| --- | --- | --- |
| `NitroSwiftUIHost.init` (creating `UIHostingController` + root view) | 12 | **0.3 %** |
| any frame named `UIHostingController` | 28 | **0.8 %** |
| any frame named `HostingView` | 58 | 1.6 % |
| `-[HybridNitroUiSwitchComponent updateProps:]` (Nitro prop marshalling, incl. `afterUpdate` → `NitroSwiftUIHost.commit`) | 31 | 0.9 % |
| `NitroSwiftUIHost.commit` | 16 | 0.4 % |
| sizing-engine bookkeeping (`NitroUiSizing.report` path) | 6 | 0.2 % |
| `-[UIView layoutSublayers]` (all layout, whole window) | 1206 | 33.4 % |
| `__CFRunLoopDoSource1` / `continueProcessing` / `_UIUpdateSequenceRunNext` (SwiftUI's post-transaction update sequence) | 13 / 0 / 1 | **0.4 % / 0 % / 0 %** |

**Counterpart — the same template on `mount:expo-ui-shared-host:200`** (main `0xc60eba`, 10.0 s
window): main thread **7412 ms**, JS thread **132 ms**; `performTransaction:` **518 ms = 7.0 %**;
`__CFRunLoopDoSource1` **5740 ms = 77.4 %**, `_UIUpdateSequenceRunNext` **6052 ms = 81.7 %**;
`UIHostingController` 11 ms (0.1 %), `didMoveToWindow` 28 ms (0.4 %), `layoutBelowIfNeeded` 240 ms
(3.2 %).

Read together, the two columns are one sentence: **both arms pay for one SwiftUI first
layout+render per control; we pay it inside the mounting transaction because our sizing contract
asks for a measured size in the same turn as the mount (`refreshContentSize`'s comment: measuring in
`layoutSubviews` lands after the sizing flusher, so the first frame would draw at the fallback —
review S5), and the shared host pays it in SwiftUI's update sequence, one turn later.** That is the
whole 5.17×. There is no duplicated layout: our update-sequence share is 0.4 %, i.e. the forced
pass consumed the work rather than adding to it.

## 5. Byte attribution (`vmmap -summary`, batch of 200 held mounted)

Per-arm process totals (load 6.5–7.9 during captures; memory is the tightest metric in this bench —
A1 measured a 257–263 KiB spread over 8 launches):

| Control | Arm | phys footprint | Default dirty / bytes / allocs | `AttributeGraph` bytes / allocs | AG graph data | QuartzCore |
| --- | --- | --- | --- | --- | --- | --- |
| Slider | nitro-ui | 76.4 M | 48.7 M / 44.2 M / 310 298 | 3813 K / 108 800 | 1244 K / 6,600 | 1861 K / 19 472 |
| | expo-ui-shared-host | 60.8 M | 37.1 M / 32.7 M / 254 762 | 2211 K / 55 777 | 1002 K / 4,630 | 1640 K / 17 479 |
| | expo-ui-host-per-control | 84.6 M | 54.2 M / 49.2 M / 372 251 | 5377 K / 145 800 | 1956 K / 10 000 | 1789 K / 18 871 |
| Button | nitro-ui | 65.7 M | 40.3 M / 37.5 M / 216 184 | 4988 K / 132 208 | 1472 K / 5,800 | 555 K / 5,259 |
| | expo-ui-shared-host | 55.6 M | 30.7 M / 28.5 M / 181 690 | 2983 K / 65 924 | 1374 K / 5,230 | 323 K / 3,066 |
| | expo-ui-host-per-control | 78.8 M | 48.1 M / 45.1 M / 300 154 | 6147 K / 156 820 | 2328 K / 10 600 | 483 K / 4,658 |
| Switch | nitro-ui | 84.1 M (repeat: 84.2 M) | 49.8 M / 43.8 M / 284 136 | 3519 K / 93 000 | 712 K / 4,000 | 1980 K / 19 480 |
| | expo-ui-shared-host | 82.4 M | 52.4 M / 46.2 M / 340 467 | 2327 K / 49 573 | 809 K / 4,030 | 1759 K / 17 489 |
| | expo-ui-host-per-control | 111.0 M | 70.8 M / 62.7 M / 458 476 | 5500 K / 139 400 | 1762 K / 9,400 | 1909 K / 18 881 |

**The bench's `bytesPerInstance` is corroborated by absolute footprint.** Δ(footprint)/200 vs the
runner's own per-instance numbers: Slider nitro−shared 78 KiB vs +80.2 measured; Button 51 KiB vs
+57.8; and the *only* controlled host-count experiment available — `@expo/ui` per-control (200
hosts) vs `@expo/ui` shared-host (1 host), same controls, same JS library: Slider 119 KiB vs +119.7
measured, Button 119 KiB vs +118.4, Switch 146 KiB vs +128.1.

That experiment is the answer to "what would a shared host amortise", measured rather than
estimated, in KiB per instance (÷200):

| Control | Δ footprint | `DefaultMallocZone` bytes | `AttributeGraph` | AG graph data | QuartzCore | zone sum | heap share of zone sum |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Slider | 122 | 84.5 | 15.8 | 4.8 | 0.7 | 105.8 | 80 % |
| Button | 119 | 85.0 | 15.8 | 4.8 | 0.8 | 106.4 | 80 % |
| Switch | 146 | 84.5 | 15.9 | 4.9 | 0.8 | 106.1 | 80 % |

And our own miss has the **same shape** (nitro − shared host): footprint Δ **+80 KiB/inst
Slider**, **+52 Button**, +9 Switch (zone bytes and footprint are different ledgers — `Default
bytes` is allocated, footprint is dirty + VM — so the zone deltas below do not sum to the
footprint Δ, which is why the controlled experiment above is the one to quote):

| Control | heap bytes | `AttributeGraph` | AG graph data | QuartzCore | heap share of the zone delta |
| --- | --- | --- | --- | --- | --- |
| Slider | +58.9 | +8.0 | +1.2 | +1.1 | 84 % |
| Button | +46.1 | +10.0 | +0.5 | +1.2 | 80 % |
| Switch | −12.3 | +6.1 | −0.5 | +1.1 | — (the bench calls this cell parity) |

What a shared host **cannot** reclaim: `AttributeGraph` scales with SwiftUI *views*, not hosts. The
shared host still pays 2211 K + 1002 K for Slider's 200 children (**16.1 KiB/inst**) and 2983 K +
1374 K for Button's (**21.8 KiB/inst**) — sharing one controller removed only ~26 % of the
`AttributeGraph` zone. The per-child SwiftUI graph is the floor, and it is far above `rn-core`
(6.8 / 50.4 KiB), so "a host gets us to the floor" is false.

**Caveat, stated plainly:** the `DefaultMallocZone` holds native *and* Hermes allocations, so zone
shares cannot separate "our `UIHostingController` + its view/layer" from "our per-instance Nitro/JS
wrapper". What is measured is the *shape and size* of the host cost (the `@expo/ui` experiment) and
that our miss matches that shape; what is inferred is that our heap portion is host-shaped. A
before/after `vmmap` on any candidate (§7) converts that to a measurement.

## 6. H3 (iOS `<Host>`) — recommendation: **no-go**

Expected nitro ÷ `expo-ui-shared-host` **if an iOS `<Host>` were built**, from the shares above:

| Axis | today | with a shared host | why |
| --- | --- | --- | --- |
| `mount mounted` | 5.17 / 4.47 / 3.32× | **~1.0–1.5×** (wide) | the transaction loses N UIView/Fabric subtrees *and* the per-control `measureFittingSize` loses its home — but if T11's first-frame guarantee survives, N children's first layout is still inside the turn, so this could also land near 2×. Unresolvable without building it. |
| `mount UI CPU/op` | **0.70 / 0.84 / 1.30×** | ≈ unchanged | per-child SwiftUI render work does not amortise, and the shared host's own total is *higher* than ours on Switch/Slider (32.69 vs 22.99; 28.10 vs 23.51): there is no headroom to gain. |
| `presented` | 0.30 / 0.34 / 0.50× ᴾ | **risk of regression** toward 47–53 ms | the shared host's presented latency is 3× ours in every run; the frame probe still cannot verdict it, so we could lose this and not know. |
| memory | 1.00 / 1.44 / 1.37× | Switch ≈1.0× (nothing to gain), Slider/Button 1.0–1.1× | −80 / −58 KiB/inst is the ceiling, bounded below by 16–22 KiB/inst of per-child `AttributeGraph` that a shared root still pays. |
| JS | 1.11–1.27× | worse | T16's point: per-child identity/props through one root. |

Three further reasons, in order of weight:

1. **The sizing contract gets harder, not cheaper.** Per-child intrinsic sizes are reported to the
   sizing engine from `measureFittingSize()`, which asks *one* `UIHostingController`
   (`hostingController.sizeThatFits(in:)`) / `systemLayoutSizeFitting` on its root. With N children
   in one root, measuring each child means forcing the shared root's layout N times over a growing
   tree — the exact synchronous-layout cost we are blaming, possibly superlinear. T16 already flagged
   that the host "owns its own intrinsic size"; this is what that costs.
2. **The `mounted` gap is not work.** It is our choice to measure in the mount turn (S5). The lever
   on the metric is the deferral, and the deferral is available today without a host — so a host
   would be paying a hand-written Fabric layout/lifecycle bridge (T16) to buy a switch.
3. **The real memory lever is per-instance, not per-batch.** ~80 % of the zone-accounted host cost
   (84.5 of 106 KiB, identically on all three controls) is `DefaultMallocZone` bytes attached to one
   `UIHostingController` + its root view; `UIHostingView` (iOS 18+) is that same root without the
   controller.

If the orchestrator still wants `mounted` ≤1.2× on iOS, the cheap route is one line, not a host,
and §7 prices it honestly.

## 7. Cheap wins

1. **Re-scope the iOS `mounted` gate (zero code).** Report `UI CPU/op` (total main-thread work in
   the mount window) as the primary iOS axis and note in `docs/architecture/benchmarks.md` that
   `mounted` is placement-sensitive: an arm that defers first layout into the next runloop source
   wins the metric while doing **20–42 % more total main-thread work** (Switch 32.69 vs our 22.99 ms,
   +42 %; Slider 28.10 vs 23.51, +20 %). Today's gate rewards moving work out of the measured
   window.
2. **`UIHostingView` instead of `UIHostingController` (candidate, needs a before/after).** Removes
   the per-instance controller and its view/parenting bookkeeping, i.e. the target is the
   46–59 KiB/inst default-heap share of the Slider/Button miss. Needs `if #available(iOS 18, *)`
   with the current controller as fallback, per the documented floor policy
   (`docs/research/setup-decisions.md` §iOS deployment target). Measure with
   `vmmap -summary` on `memory.slider:N:200` / `memory.button:N:200`, exactly as §5 — that
   reproduces the bench number to within 7 KiB, so it will show a real change.
3. **Defer the first measure for `sizingPolicy == .intrinsic` — available, and I recommend against
   it.** Removes 44.8 % of the Switch transaction (23.68 → ≈13 ms, ≈2.9× the shared host: *still
   not parity*, because the residual 55 % is per-control UIKit/Fabric work the shared host does not
   pay). It saves **no main-thread CPU** (§4: our update-sequence share is 0.4 %, so the work is not
   duplicated) and it reintroduces exactly what review S5 removed: the first frame drawn at the
   declared fallback instead of the measured size. `fillWidth` controls (Slider, linear Progress)
   cannot defer at all — a cold instance's height starts at 0 and the measure is what turns it into
   a height (`ios/core/NitroSwiftUIHost.swift:381-396`, `docs/architecture/sizing.md` §5).
4. **Already checked, not a win:** VC containment is off for all five shipped controls
   (`needsContainment = false`, `NitroSwiftUIHost.swift:65`), so there is no per-instance
   `addChild`/`didMove(toParent:)` to remove. `signposts` (`--perf-marks`) were not needed: a stock
   Time Profiler template gives thread- and frame-level attribution with no instrumentation to
   merge.

## 8. Files changed, gates

- `docs/tasks/P1-ios-mount-profile.report.md` — this file. Nothing else; `bench/results/*` are
  gitignored, and `docs/tasks/FOLLOWUPS.md` was deliberately **not** edited to avoid a concurrent
  write against B1 on the same file (contents are in §9 instead).
- **Gates: none run.** No source, spec, fixture, script or harness file changed, so `bun run check`
  and the harness would be measuring `bc8fd7c`, which is already green on `main`. Deliberately not
  run to avoid the appearance of a gate passed on a documentation-only diff.

## 9. Known issues & follow-ups (D19 — recorded, not investigated)

- The 44.8 % share is measured on **Switch only**. Slider/Button run the same
  `NitroSwiftUIHost` path and their `mounted`/`UI CPU/op` shape matches, but nobody has traced
  them; if a fix round touches sizing, re-run `/tmp/p1-sub.py` on `mount.slider:nitro-ui:200`.
- **Button and Progress have a genuine total-CPU miss**, not just placement: A1 absolute
  `UI CPU/op` Button 15.1 vs 12.9 ms, Progress 21.0 vs 15.0 ms (this run: 14.62 vs 11.21). That is
  per-child work a host will not amortise — worth one profile before anyone cites it as host
  evidence.
- `mounted` **includes** the previous batch's teardown (`unmountChildComponentView:` = 16.1 % of the
  transaction here), even though the runner also reports `UI CPU/unmount` separately. Confirm the
  arms are symmetric on this before reading `mounted` as pure mount cost.
- `update.button`: nitro `mounted` 10.82 ms vs shared host 3.20 ms and `UI CPU/op` 12.32 vs
  7.83 ms at load 11. Same placement hypothesis, unprofiled, and R2 already flags Button's update
  UI CPU at 1.48×.
- iOS `presented` remains un-verdictable on every cell (probe counts frames latched before the
  mount), which is why our single biggest favourable axis (0.30–0.50×) cannot be claimed. Known
  since R2/A1; reconfirmed, no new cause found.
- Tooling, for whoever profiles next: `xctrace export` cannot dump the Allocations instrument's
  tables on Xcode 27 (schema names are not exported) — `vmmap -summary` is the byte tool.
  Time Profiler times are trace-relative and two launches share one trace, so filter by thread id;
  launch-1 stacks come out unsymbolicated; shared-cache frames (SwiftUI/UIKit) export as hex
  addresses, so attribute by `binary` rather than by name for those.
- Leftovers I could not delete (sandbox blocks `rm -rf`): `/tmp/p1-alloc-nitro.trace`,
  `/tmp/p1-alloc4.trace`, `/tmp/p1-*.trace`, `/tmp/tp-*.xml` (~320 MB). Safe to remove manually.
- Device hygiene: only `F08675D3-A32B-4F88-BC81-02D7E0CB797E` was used; it is shut down at the end
  of this task. `emulator-5570`/`nitroui_t01`, iPhone Air `331EF109…`/`nitroui_t02` and
  `emulator-5560` were not touched.

## 10. Questions for orchestrator

None — the brief's question is answered and the H3 decision is decidable from this report.

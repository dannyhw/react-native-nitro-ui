# Performance

The full record behind the README's [Performance](../README.md#performance) summary: every
cell, the run and the machine it came from, how the two machines' readings compare, and how
the committed baselines gate a change. How to run the benchmark, what each metric is and how
the numbers are read is [architecture/benchmarks.md](architecture/benchmarks.md).

`maintainer-mac-1` and `maintainer-mac-2` below are the labels of the two machines that have
committed baselines (`bench/baselines/<machine-label>/`). Both ran the same two devices: an
iPhone 17 simulator on iOS 27 and an API 35 Pixel 9 emulator.

## What is compared

`bun bench` ([architecture/benchmarks.md](architecture/benchmarks.md)) measures this library against
three arms in the same run, on the same device, in Release builds:

- `rn-core` — the pure-JS answer (row of `Pressable`s, stock `ActivityIndicator`,
  …). A floor, not a peer: it draws fewer pixels and hosts nothing.
- `expo-ui-host-per-control` — the same SwiftUI / Compose controls through
  `@expo/ui`, one hosting view per control.
- `expo-ui-shared-host` — the same controls through `@expo/ui`, one hosting view
  for all of them. This is the arm worth being measured against, and the target
  is ≤ 1.0× on mount latency, UI CPU and memory.

## `maintainer-mac-1`'s baseline runs

The numbers below are from the runs that produced `maintainer-mac-1`'s committed
baselines in `bench/baselines/`: one `--plan full --launches 8` run per platform, on a
clean tree and an idle machine — an iPhone 17 simulator (iOS 27) at `c9548f6` and an
API 35 Pixel 9 emulator with ART primed to `speed-profile` at `3533d64`. Each
cell is the launch-paired median ratio of nitro-ui to `expo-ui-shared-host`;
mount is at N=50, memory at N=200. `✓` meets the ≤ 1.0× target, `✗` misses it,
`n/v` means that cell's spread across launches was over 10 %, so the harness
gives it no verdict, and no mark means the run is at parity within rounding.

| Component          | iOS presented | iOS UI CPU  | iOS memory | Android presented | Android UI CPU  | Android memory  |
| ------------------ | ------------- | ----------- | ---------- | ----------------- | --------------- | --------------- |
| `Switch`           | 1.00×         | 0.88× ✓     | 1.00×      | 1.01×             | 1.51× `n/v`     | 2.72× ✗         |
| `Slider`           | 1.00×         | 1.07× `n/v` | 1.48× ✗    | 1.02× ✗           | 1.52× ✗         | 2.42× ✗         |
| `Progress`         | 0.47× ✓       | 1.20× `n/v` | 1.38× ✗    | 1.00×             | 1.02×           | 1.44× ✗         |
| `Button`           | 1.00×         | 1.13× `n/v` | 1.34× ✗    | 1.01× ✗           | 1.59× `n/v`     | 2.46× ✗         |
| `SegmentedControl` | 0.24× `n/v`   | 0.66× ✓     | 0.83× ✓    | 0.89× ✓           | 1.39× `n/v`     | 1.10× ✗         |
| `DatePicker`       | 1.00×         | 0.08× ✓     | 0.70× ✓    | not in this run   | not in this run | not in this run |

Two things are missing from that table. `maintainer-mac-1` measured no `Picker`
at all, and the Android `DatePicker` has no `@expo/ui` arm to divide by on any
machine (`ARMS_WITHOUT_COMPONENT` in `scripts/bench/lib.mjs`), so that ratio
cannot exist. `maintainer-mac-2`'s baselines do carry `Picker` on both platforms,
and its quiet re-run of both platforms on 2026-10-30 — one `--plan full
--launches 8` each, at `abe68a1`, `problems: []` — carries `Picker` and `Menu` on
both platforms; its per-cell tables are in
[`A5-quiet-bench-mac2.report.md`](tasks/A5-quiet-bench-mac2.report.md).
That machine is an Apple M1 Max with 10 cores and a load ceiling of 5.0, where
`maintainer-mac-1` is an M4 Pro with 14 cores and a ceiling of 7.0, so a cell from
one is not a repeat of the other — read the two together for the shape, and a
cell against its own machine's baseline for a verdict. `Menu` has no committed
cell on either machine yet, because a mint replaces a whole baseline file and
G7b's run covered only Menu (X14 adds the merge mint that fixes that); its
numbers are in [`G7b-menu-finish.report.md`](tasks/G7b-menu-finish.report.md)
and in A5's tables, quoted under [the Host](#host-on-android) below.

## `maintainer-mac-2`'s quiet run

The same plan on `maintainer-mac-2`, both platforms quiet, adds the two controls
the run above does not have and re-reads the six it does:

| Component          | iOS presented | iOS UI CPU    | iOS memory | Android presented  | Android UI CPU     | Android memory     |
| ------------------ | ------------- | ------------- | ---------- | ------------------ | ------------------ | ------------------ |
| `Switch`           | 0.80× ✓       | 0.75× ✓       | 0.99× ✓    | 1.12× ✗            | 1.80× ✗            | 2.84× ✗            |
| `Slider`           | 0.63× ✓       | 0.90× ✓       | 1.46× ✗    | 1.23× ✗            | 1.77× ✗            | 2.37× ✗            |
| `Progress`         | 0.40× ✓       | 1.13× ✗       | 1.35× ✗    | 0.96× ✓            | 0.92× ✓            | 1.70× ✗ `n/v`      |
| `Button`           | 1.00×         | 1.38× ✗       | 1.36× ✗    | 1.25× ✗            | 1.77× ✗            | 2.45× ✗            |
| `SegmentedControl` | 0.27× ✓       | 0.57× ✓       | 0.84× ✓    | 1.19× ✗            | 1.43× ✗            | 1.15× ✗            |
| `DatePicker`       | 2.24× ✗ `n/v` | 0.10× ✓ `n/v` | 0.90× ✓    | not on any machine | not on any machine | not on any machine |
| `Picker`           | 0.21× ✓       | 0.29× ✓       | 0.76× ✓    | 1.03× ✗            | 1.47× ✗            | **0.91× ✓**        |
| `Menu`             | 2.04× ✗ `n/v` | 1.28× ✗       | 1.34× ✗    | 0.98× ✓            | 1.26× ✗            | **0.85× ✓**        |

## Reading the two together

Three things follow from reading the two together. The Android memory miss is
real and it is _not_ universal — `Switch` 2.84×, `Button` 2.45×, `Slider` 2.37×,
`Progress` 1.70× `n/v` and `SegmentedControl` 1.15× are above the shared host, while
`Picker` (0.91×) and `Menu` (0.85×) are _below_ it — not because ours are
lighter (292.2 and 213.1 KiB are heavy), but because `@expo/ui`'s `Picker` and
`Menu` cost 320.0 and 250.4 KiB, against 50.6–77.4 KiB for its `Switch`, `Slider`,
`Progress` and `Button` there. Mount latency moves the other way with the machine: on
`maintainer-mac-1` `SegmentedControl` was the one control under the shared host
(0.89×), on `maintainer-mac-2` it is 1.19× and `Progress` (0.96×) and `Menu`
(0.98×) hold the line instead. And the iOS memory miss survives a whole machine
change (1.34–1.46× on `Slider`, `Progress`, `Button` and `Menu`, parity on
`Switch`), which is the strongest evidence yet that DECISIONS D23's "no known
fix" is about the shape, not the tuning.

Reading it honestly — these read the `maintainer-mac-1` run above, cell by cell:

- **Android memory is the consistent miss.** Every control in that run costs more
  than the shared host per instance — `Switch` 142.7 KiB against 52.1, `Button`
  188.5 against 77.0 — because each control owns its own Compose composition.
  `maintainer-mac-2` reverses the word _every_: its `Picker` and `Menu` land
  below the shared host (0.91×, 0.85×) because `@expo/ui`'s `Picker` and `Menu` are
  heavy, not because ours are light. Mount
  UI CPU is 1.39–1.59× on four controls; `Progress` is at 1.02×, just over the
  line. `SegmentedControl` is the one control that beats the shared host on
  mount latency (0.89×). On the update path Android `presented` is 0.32–0.61×,
  while update UI CPU is above the shared host on `Switch` (1.24×) and `Button`
  (1.94×) and below it on `SegmentedControl` (0.74×).
- **iOS `presented` at N=50 mostly measures the frame — on that machine.** On
  `Switch`, `Slider`, `Button` and `DatePicker` every arm lands in the same 16 ms
  frame, so 1.00× is the frame floor, not a result. `Progress` and
  `SegmentedControl` are the two cells where the shared host spans more frames and
  the ratio means something. `maintainer-mac-2`, which is slower per mount, shows
  how much of that is the machine: there only `Button` is on the floor for both
  arms (16.10 ms against 16.13), while `Switch` reads 49.4 ms against 61.6,
  `Slider` 35.0 against 55.2, `SegmentedControl` 45.2 against 171.0 and `Picker`
  42.3 against 198.9 ms — several frames each, so the same ratios do carry a
  verdict there. On the update path nitro-ui itself is on the floor on both
  machines for `Switch`, `Slider`, `Button` and `Progress` (16.1 ms either side),
  while the arm beside it is not always: `DatePicker`'s shared host takes 119.9 ms
  to push a new value on this machine, and `Picker` (62.9 against 65.5 ms) and
  `Menu` (32.8 against 16.1 ms) are several frames for one arm or the other.
- **iOS UI CPU** is below the shared host on `Switch`, `SegmentedControl` and
  `DatePicker`, and above it on `Slider`, `Progress` and `Button` (1.07–1.20×,
  all three too noisy for a verdict). On the update path iOS UI CPU is below the
  shared host on every control except `Button` (1.52×). Nothing is reversed by
  `maintainer-mac-2`, but one reading moves: its `Slider` cell is 0.90× — below —
  where this run's 1.07× had no verdict because it was `n/v`, and `Progress`
  (1.13×) and `Button` (1.38×) do carry one there. The update path reads the same
  way on both: below on everything except `Button` (1.65×, and `Menu` at 2.19×).
- **iOS memory is at parity on `Switch` and below on `SegmentedControl` and
  `DatePicker`, and it misses on `Slider`, `Progress` and `Button`** — 1.34–1.48×,
  or +47 to +85 KiB per instance (`Slider` 263.1 KiB against 178.0). That gap is
  one hosting controller and its SwiftUI graph per control, where `@expo/ui`
  shares one across all of them. **There is no known fix for it.** A shared iOS
  host was built and measured: it narrowed the memory gap (Slider still missed)
  but made mount and unmount UI CPU worse, so it did not ship (DECISIONS D23); and the
  lighter public hosting-view type that might have cut the per-instance bytes
  does not exist in the iOS 27 SDK.
- **iOS `mounted`** (time spent inside the mount transaction, not in the table)
  is several times the shared host's. That is the library measuring each control
  synchronously while it mounts, so the first frame is laid out at the right
  size, where `@expo/ui` does the equivalent SwiftUI work after the transaction;
  total main-thread work per mount — the UI CPU column — is the fairer
  comparison.

## Against one hosting view per control

Against `expo-ui-host-per-control` — the same one-host-per-control shape,
reached through `@expo/ui` — nitro-ui is below it on every cell that carries a
verdict: iOS presented 0.16–0.45×, UI CPU 0.04–0.48×, memory 0.67–0.98×; Android
presented 0.51–0.88×, UI CPU 0.45–0.84×, memory 0.49–0.82×. Both ranges are
`maintainer-mac-2`'s quiet run's, over the cells that carry a verdict — the iOS
presented range therefore skips `DatePicker`'s 0.05× and `Menu`'s 0.29×, both `n/v`.
8 components on iOS, 7 on Android (no Android `DatePicker`), each ratio
launch-paired within that run.

## `<Host>` on Android

`<Host>` is the one place the Android memory bill is paid the other way.
Measured on the same emulator (one `--plan quick` run, all five arms including a
hosted `nitro-ui-host` arm, ART `speed-profile`, no problems reported),
Switches inside one Host against `expo-ui-shared-host` — memory at N=200, the
rest at N=50:

|                       | `Switch` without a Host | `Switch` in a `<Host>` |
| --------------------- | ----------------------- | ---------------------- |
| Mount memory (N=200)  | 2.75×                   | **0.86×**              |
| Mount UI CPU per op   | 1.39×                   | **0.87×**              |
| Mount `mounted`       | 1.13×                   | **0.97×**              |
| Mount `presented`     | 1.01×                   | **0.99×**              |
| Mount JS CPU per op   | 0.73×                   | 1.18×                  |
| Unmount UI CPU per op | 1.31×                   | 0.78× `n/v`            |

That is 44.5 KiB per hosted Switch against the shared host's 51.9 KiB. The axis
it loses on is the JS thread — roughly 1.2× the shared host, where the unhosted
control is below it — because a hosted control is still a React Native node
_and_ a child of somebody else's composition. That is why `Host` is something an
app opts into for a dense list rather than what every container does. On iOS
`Host` is a passthrough `View` (DECISIONS D23). `maintainer-mac-2`'s quiet full
plan reads that hosted column on its own emulator as 0.91× memory (46.0 KiB
against the shared host's 50.6), 0.84× UI CPU, 0.97× `mounted`, 1.01×
`presented`, 1.17× JS CPU and 0.57× `n/v` unmount: the shape reproduces on a
different machine, and the memory cell is 0.05 closer to the shared host than the
figure above (0.91× against 0.86×); the runs differ in machine, plan and code, so
the gap is not attributed. The JS axis is the same ~1.2×.

0.2.0 extends the same mechanism to `Slider`, `Progress` and `Button`, and 0.3.0
to `SegmentedControl`, `Picker` and `DatePicker`; `Menu` joined them in 0.4.0, so
a Host holds all eight. Three of those last four present something outside their
own box: a `Picker` opens a menu, a `DatePicker` a dialog and a `Menu` its list,
and all three belong to the Host's composition once hosted. A
`SegmentedControl` owns no window at all; it is on the list because it
draws itself, which is the question a Host asks. All seven controls with a Host
arm were then re-priced on `maintainer-mac-2` by one **quiet** `--plan full
--launches 8` run — 2 128 launches, 2 825 load samples against a ceiling of 5.0,
median 1.43, one over (0.04 %), `problems: []`, ART `speed-profile` — so these
replace the indicative `quick`-plan tables those runs published. Against
`expo-ui-shared-host`, and against the same control with no Host:

|                                         | `Switch`  | `Slider`  | `Progress`  | `Button`  |
| --------------------------------------- | --------- | --------- | ----------- | --------- |
| Mount memory (N=200)                    | **0.91×** | 1.02×     | 0.45× `n/v` | **0.80×** |
| Mount UI CPU per op                     | **0.84×** | **0.85×** | **0.40×**   | **0.88×** |
| Mount JS CPU per op                     | 1.17×     | 1.11×     | **0.77×**   | **0.69×** |
| Unmount UI CPU per op                   | `n/v`     | `n/v`     | `n/v`       | `n/v`     |
| Memory vs the same control with no Host | **0.32×** | **0.43×** | **0.26×**   | **0.33×** |
| Mount UI CPU vs no Host                 | **0.46×** | **0.47×** | **0.44×**   | **0.50×** |
| Mount JS CPU vs no Host                 | 1.20×     | 1.05×     | 1.32×       | 1.12×     |

The `Switch` row lands near where H1's published 0.86× / 0.87× sits (0.91× / 0.84×
on this machine), which is what makes the rest of the run readable. What it shows:
the UI-thread win holds on all four, `Progress` most of all (0.40×); the memory win
holds on `Switch` and `Button`, `Progress` reads 0.45× but `n/v`, and `Slider` is
level at 1.02×; JS costs 1.17× on `Switch` and 1.11× on `Slider`,
while `Progress` (0.77×) and `Button` (0.69×) are below the shared host, as unhosted
(0.59×, 0.62×) — and the unmount cells are still spread too wide for any claim at
all, on this machine and at 8 launches.

The other four cost nearly the same shape ([`A5's
tables`](tasks/A5-quiet-bench-mac2.report.md) have every cell). `SegmentedControl`'s
hosted mount UI CPU is the one verdict that moves here: 1.00× — parity — where the
indicative run published 0.92×:

|                                         | `SegmentedControl` | `Picker`  | `DatePicker`    | `Menu`    |
| --------------------------------------- | ------------------ | --------- | --------------- | --------- |
| Mount memory (N=200)                    | **0.56×**          | **0.53×** | no Android cell | **0.31×** |
| Mount UI CPU per op                     | 1.00×              | **0.78×** | —               | **0.57×** |
| Mount JS CPU per op                     | **0.30×**          | **0.18×** | —               | **0.22×** |
| Memory vs the same control with no Host | **0.49×**          | **0.58×** | **0.49×**       | **0.36×** |
| Mount UI CPU vs no Host                 | **0.70×**          | **0.53×** | **0.58×**       | **0.45×** |
| Mount JS CPU vs no Host                 | 1.02×              | 1.05×     | 1.11×           | 1.09×     |

No Android `@expo/ui` arm has `DatePicker` cells, so that column is hosted-vs-unhosted
only. Every cell above carries a verdict except the unmount ones and `Progress`
memory: read against this machine's own baseline, `--check` on the same run **fails
nothing** — 159 rows within tolerance, 33 noisy, and the only over-threshold row that
is not noisy is `update:nitro-ui:1` UI CPU at 1.26× with a 95 % CI of 0.98–1.38× that
covers 1.05, so it is reported and not conclusive. And **no number here is about an
open window**: the bench arm mounts the anchor row and never presses it, so no menu or
dialog is composed while these are read. What the run does show is that a control
which can own a window hosts like the others — memory roughly halved or better,
UI thread down, and JS CPU per op up 2–11 %.

`Menu` is the clearest case in the set: 77.6 KiB per hosted Menu against the
shared host's 250.4 (0.31×) and `rn-core`'s 76.3, with mount UI CPU at 0.57× and
JS CPU at 0.22×. Unhosted it is 213.1 KiB (0.85×) — the one control besides
`Picker` whose own composition already costs less than the shared host's. On iOS,
where a Host is a passthrough, Menu is the usual per-control story: 352.8 KiB
against the shared host's 263.6 (1.34×), presented 33.0 ms against 16.1 (`n/v`),
UI CPU 1.28×. No run composed a popup — the arm never opens a menu.
[G7b's tables](tasks/G7b-menu-finish.report.md) and
[A5's](tasks/A5-quiet-bench-mac2.report.md) have the whole set.

## Baselines and gating

Baselines are committed per machine as well as per device —
`bench/baselines/<machine-label>/<deviceKey>.json` — because a ratio to `rn-core`
only cancels drift inside the machine that measured it. Both machines that have
minted one have both canonical devices
(`bench/baselines/maintainer-mac-1/`, `bench/baselines/maintainer-mac-2/`), so
`bun bench --check` gates on both platforms there; a machine without its own
directory refuses rather than reading another's. Each baseline stores ratios to
`rn-core`, not absolute times; see
`bench/baselines/README.md` for the rules a baseline run has to meet. Measurement
details — absolutes, per-launch spreads, noise flags and the update cells — are in the
reports for the
[iOS baseline](tasks/A1c-baselines.report.md),
[Android baseline](tasks/A1b-baselines.report.md) and
[`<Host>`](tasks/H1-android-host.report.md) runs and its
[H2a](tasks/H2a-host-more-controls.report.md) and
[H2b](tasks/H2b-host-popups.report.md) follow-ups.

# G7b — Menu: bench arm, real-input, story, smoke, and what G7a left open

**Branch:** `task/G7b-menu-finish` (from `main` at `55ed239`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `G7b-27pum` (pair-b: `nitro-ui B` / `emulator-5570`, adb server 5041 / Metro 8293)

## Summary

Menu now carries the four things a component needs to count as finished: a bench arm in every
plan, a real-input case on both platforms, a Storybook story, and a line in the consumer smoke
app. `component.json` flipped to `bench`/`smoke`/`realInput` and `bun run regen` is clean; the
cells are Picker's — `mount`/`update`/`memory` quick, plus `leak` in the full plan — and all seven
have a Menu equivalent, so none is dropped. What has no cell is a popup gesture: no arm can price
one across three runtimes, so the cells measure the mounted control, and `memory`/`leak` are the
closest thing to a leak story. A Menu's box is its trigger's box, so it joins the self-sizing set
and `update.menu` flips the trigger title, the sizing key (D16). The `nitro-ui-host` arm is
Android-only because iOS `<Host>` is a passthrough (D23), so iOS has four arms where Android has
five.

Two decisions a reviewer needs before the diff:

1. **The iOS check found a real trap, and it is now in the test.** SwiftUI presents this menu
   *over its own trigger*, so a press aimed at the trigger while the menu is up lands on whichever
   row covers it — the first real run measured `select alpha > select bravo` where one pick was
   expected. The case now measures what a tap on the disabled row does to the presentation, puts the
   menu away through a point that cannot be a row, and waits. That run's screenshot also settles
   G7a's styling question: the trigger's `.buttonStyle` does not follow the rows, so no
   `.buttonStyle(.plain)` was added.
2. **The `menuAnchor` red proof did not go as the brief expected** (item 4). Four round-1 mutants
   that remove the anchor, replace it with a plain `DropdownMenu`, or offset its content all still
   measured the popup at the trigger. The fix round moved the popup's *window*
   (`DropdownMenu(offset = DpOffset(0.dp, 64.dp))`) and the `gap < 48` bound went red, so the guard
   is proven; `menuAnchor` stays on Material's contract, not on an observed misplacement, and the
   three places that claimed otherwise now say what was measured.

Item 6, the iOS open/close spike, is a decisive no: a `.onAppear`/`.onDisappear` sentinel reported
**one** open across two presentations and **no** close, not even for the pick that visibly dismissed
the menu. Not shipped; D32 stands. Item 7 does not apply — X4 is not merged.

## Gates

| Gate                             | Result   | Counts                       | Code tree                    | Duration  | Load                           |
| -------------------------------- | -------- | ---------------------------- | ---------------------------- | --------- | ------------------------------ |
| `check`                          | **PASS** | 1165 tests / 45 suites       | `43816d4c80ef`               | 2 m 35 s  | start 2.4 / med 3.1 / max 4.2  |
| `harness:ios`                    | **PASS** | 183 tests / 14 suites        | `43816d4c80ef` (ios tree)    | 4 m 21 s  | start 5.2 / med 3.3 / max 5.2  |
| `harness:android`                | **PASS** | 232 tests / 14 suites        | `43816d4c80ef` (android tree) | 6 m 29 s  | start 5.3 / med 3.6 / max 6.3  |
| `real-input:ios`                 | **PASS** | —                            | `43816d4c80ef` (ios tree)    | 12 m 58 s | start 6.8 / med 4.3 / max 25.5 |
| `real-input:android`             | **PASS** | —                            | `43816d4c80ef` (android tree) | 16 m 07 s | start 3.2 / med 3.2 / max 5.0  |
| `bench:--help`                   | **FAIL** | —                            | `43816d4c80ef`               | 0.1 s     | start 2.3 / med 2.3 / max 2.3  |
| `harness:android:Menu`           | stale    | 15 tests / 1 suites          | 58d861fab92c (not this tree) | 20.3 s    | start 2.2 / med 2.5 / max 2.7  |
| `real-input:android:--control:menu` | **PASS** | —                          | `e030c74c4537` (android tree) | 1 m 12 s  | start 2.6 / med 2.7 / max 2.9  |
| `real-input:ios:--control:menu`  | stale    | —                            | b13dde9a2150 (not this tree) | 2 m 07 s  | start 2.2 / med 14.0 / max 17.4 |
| `real-input:ios:--control:menu:--background` | stale | —                        | cdde3752f6f3 (not this tree) | 0.2 s     | start 7.5 / med 7.5 / max 7.5  |

`need --for review` was satisfied on round 1's code tree (`43816d4c80ef`), and so was
`need --for merge` — all five required gates green on that tree, which the table above is copied
from. The fix round's own table is at the end of this file. The ledger prints no per-component
counts for the real-input
gates, so the Menu share is here rather than in the table: `Menu.harness.tsx` is 15 tests on each
platform inside the harness suites above (and 183/232 totals), `testRealInputMenu` carries 14
assertions, and `CHECKS.menu` logs 18 checks with 10 measured notes (the run at 02:06:14Z). Three
rows below need reading, not re-running:
- **`bench:--help` FAIL is my own mistake, not a gate.** I typed `node scripts/gate.mjs bench
  --help` to learn the bench gate's form; `gate.mjs` resolved it as `bench:--help`, launched
  `scripts/bench/run.mjs --help`, and the runner printed its usage and exited 2. Nothing in the
  tree is involved — the same command run directly is the intended way to read that usage. Benches
  are never required by `need` (they belong to the bench host), so this row asks for nothing, but it
  does sit in the exported ledger, which is why it is explained rather than deleted.
- **`harness:android:Menu`** and **`real-input:ios:--control:menu`** are filtered runs, which
  `gate.mjs` records under their own name as evidence for nothing but themselves. Their ledger
  history is the mutation battery, and `gate.mjs logs` still has every log: the iOS row printed
  above (tree `b13dde9a2150`) is the **`.accessibilityLabel` mutation** — the brief's red proof —
  while the two earlier failures on that name are the step-ordering bug (`("select alpha > select
  bravo") is not equal to ("select bravo")`) and the iOS spike (`("open > select bravo")`). Before
  those, two runs died on their own bookkeeping: the tree moved while `xcodebuild` read it, and one
  launch put `--background` after `--`, which the runner rejects as an unknown argument. That name
  shows six round-1 `fail` lines: one `hosted-removal` timeout (the mutant with no `menuAnchor`,
  which also stops the anchor reporting its own dismissal), the inverted `gap` bound, and four
  stale-app refusals where the APK predated the edit — the guard working, not a test failing. The
  fix round adds two of its own: the window-moving mutant below, and a 0.8 s
  `harness:android:Menu:--background` row from my putting `--background` after `--` again.
- Two other red lines in the ledger need naming, because neither is a Menu failure. The full
  `real-input:android` at 29 Oct 23:23:53Z died on `real-input: no "undefined" tab` — that run
  predates `c720a48`, which added the `goToScreen` entry for `menu`, so the suite could not reach the
  Menu screen at all; the line above it in the same log is `hosted-picker` cycle 2 timing out on
  `real-input-drop-gone`, the drop picker's unmount teardown, which has not repeated on the two green
  full Android runs since. The `harness:ios` at 23:46:36Z is mine killing a run whose tree still had
  the spike file in it (`The app bridge disconnected`, then SIGTERM), immediately followed by the
  green `harness:ios` on the reverted tree at 23:51:39Z.
- The iOS a11y red proof and the menuAnchor red proof (below) are deliberately left as red
  **runs**, then reverted: their ledger lines are the stale ones.

## Red proofs

- `scripts/real-input/android.mjs` `CHECKS.menu` (the D32 order assertions) → fire `open` twice per
  gesture in `example/src/MenuScreen.tsx` (`noteRealOpen` calls `appendEvent('open')` twice) →
  `real-input:android --control menu` at 30 Oct 01:49:39Z, three `✗` lines: `expected open > close,
  saw open > open > close`, the pick line `saw open > open > close > open > open > select bravo >
  close`, and the whole-echo line. Both new assertions are needed: the round-1 tail check would have
  passed the middle one. Reverted; the green full run at 02:06:14Z reads the exact strings.
- `Menu.harness.tsx` "opens under its own button" → `ExposedDropdownMenu` replaced by
  `DropdownMenu(expanded, offset = DpOffset(0.dp, 64.dp), onDismissRequest)` (Material's own offset,
  handed to its position provider, so the `PopupWindow` moves) and built with
  `node scripts/build-app.mjs --platform android` → `harness:android:Menu` at 30 Oct 01:48:49Z:
  `expected 168 to be less than 48` at `Menu.harness.tsx:1604`, with the baseline 16 px. So the bound
  catches a moved popup, and the witness reads the window. The arithmetic is exact, which is what
  makes it a clean mutant: this AVD's density is 2.625 (the 48 dp trigger measures 126 px in the same
  logs), so 64 dp is 168 px, and the popup's window top landed 168 px below the anchor's bottom —
  flush against the anchor plus the requested offset, with Material's 16 px exposed-menu inset gone
  because a plain `DropdownMenu` does not apply it. Reverted.
- `real-input:ios --control menu` (the a11y assertion the brief asks for) → remove
  `.modifier(OptionalMenuAccessibility(label:))` from `MenuContent.body` → `RealInputTests.swift:2032:
  ("Actions") is not equal to ("Real-input menu")`, and the guard above it
  (`trigger.identifier != anchor.identifier`) is what makes reading the RN wrapper unable to pass.
- `Menu.harness.tsx` "opens under its own button" → invert the new bound on the same measured
  number (`expect(gap).toBeGreaterThan(400)`) → `Menu.harness.tsx:1599: expect(gap)
  .toBeGreaterThan(400)` with `gap` printed as its real small value.
- `Menu.harness.tsx` (the same test) → **four mutants that the brief expected to go red, and did
  not**: `menuAnchor` dropped inside the box; `clickable` + plain `DropdownMenu`; that pair inside
  a `fillMaxSize` Box; `ExposedDropdownMenu` offset 300 dp. All four were built and run on
  `emulator-5570` and every one reported the popup at the trigger. What round 1 did not keep is the
  recipe for the last one — the ledger logs name the run, not the diff — so the honest statement is
  that whatever it was, it did not move the rect the witness reads (`MenuWitness` →
  `getLocationOnScreen` on the popup's view); the window mutant above is what establishes that this
  reading can move at all. Recorded because it is the finding, not a failure to run the proof: see
  item 4 in the Summary and the corrected claims.
- `Menu.harness.tsx` hosted-removal half → the earlier `menuAnchor`-less mutant, which is the run
  that went red **elsewhere** instead: `Menu report for "hosted-removal" never matched within
  12000ms … {"expanded":false,…,"rows":0}` — no `menuAnchor` also means nothing reports the
  anchor's own dismissal, which is the second thing the modifier is for.
- `scripts/__tests__/registry.test.js` (the host-arm region test) → flip `menu` back to
  `"bench": false` in its manifest → `✕ the tree in front of us is in step with its manifests` and
  `✕ the host-arm regions list the hostable *and* benched controls`, the latter being the new
  half: it asserts `menu` is in both lists **and** that a `bench: false` flip removes it, which is
  the direction G7a left untested (its commit message is the other half of that claim).
- `scripts/__tests__/component-coverage.test.js` → rename the `menu` branch in
  `bench/src/implementations/expoUi.android.tsx` → `✕ bench/src/implementations/
  expoUi.android.tsx handles every component in each of its render paths`.
- `scripts/__tests__/smoke-ready-line.test.js` → drop `menu=76x34` from the ready-line fixture →
  `✕ passes on one non-zero box per control` (`Expected: true, Received: false`), so a control
  added to the smoke app cannot pass on a line that never measured it.
- The bench flip's own proof: `registry.test.js` also asserts `menu` is present in the registry
  list and that a `Menu.bench = false` removes it, which is the direction the earlier tasks'
  tests did not cover.

## Bench

**Superseded by A5.** The four runs below are what this task measured and they stay for the record.
A5's exclusive window on `maintainer-mac-2` has since covered Menu inside the full plan on both
platforms — `--plan full --launches 8` at `abe68a1`, all eight components in one run each,
`problems: []`, ART `speed-profile` primed: iOS 1 792 launches with 15 of 2 387 load samples over
the 5.0 ceiling (0.6 %), Android 2 128 launches with one of 2 825 over (0.04 %). The quiet cells,
same table rules:

### iOS — `ios27-sim-iphone17`, full plan, quiet — `abe68a1-ios-20261030T104437Z.*`

| Cell | Metric | rn-core | expo per-control | expo shared-host | nitro-ui | ÷ shared | ÷ per-control |
| --- | --- | --- | --- | --- | --- | --- | --- |
| mount N=50 | presented | 16.07 ms | 115.06 ms | 16.12 ms | 32.95 ms | 2.04× _(nv)_ | 0.29× _(nv)_ |
| mount N=50 | mounted | 8.71 ms | 36.59 ms | 20.32 ms | 34.07 ms | 1.68× | 0.93× |
| mount N=50 | JS commit | 5.41 ms | 6.41 ms | 4.87 ms | **2.52 ms** | **0.52×** | **0.39×** |
| mount N=50 | JS CPU/op | 5.50 ms | 8.80 ms | 5.10 ms | **2.68 ms** | **0.53×** | **0.30×** |
| mount N=50 | UI CPU/op | 3.27 ms | 73.40 ms | 27.53 ms | 35.08 ms | 1.28× | **0.47×** |
| mount N=50 | UI CPU/unmount | 7.63 ms | 27.73 ms | 20.02 ms | **8.96 ms** | **0.45×** | **0.32×** |
| update N=50 | presented | 16.14 ms | 15.65 ms | 16.12 ms | 32.79 ms | 2.03× | 2.10× |
| update N=50 | mounted | 4.24 ms | 8.38 ms | 5.38 ms | 18.69 ms | 3.45× | 2.23× |
| update N=50 | JS commit | 2.46 ms | 3.15 ms | 1.94 ms | **1.44 ms** | **0.74×** | **0.46×** |
| update N=50 | JS CPU/op | 2.59 ms | 8.65 ms | 2.47 ms | **2.41 ms** | **0.96×** | **0.28×** |
| update N=50 | UI CPU/op | 4.34 ms | 21.82 ms | 10.99 ms | 23.92 ms | 2.19× | 1.12× |
| memory N=200 | bytes/inst | 61.5 KiB | 360.2 KiB | 263.6 KiB | 352.8 KiB | 1.34× | 0.98× |

### Android — `android35-emu-pixel9`, full plan, quiet — `abe68a1-android-20261030T155310Z.*`

| Cell | Metric | rn-core | expo per-control | expo shared-host | nitro-ui | nitro-ui-host | ÷ shared | ÷ per-control |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mount N=1 | presented | 31.82 ms | 32.08 ms | 31.57 ms | 31.45 ms | 31.47 ms | 0.99× | 0.98× |
| mount N=1 | JS commit | 0.45 ms | 1.93 ms | 1.92 ms | **0.71 ms** | 0.95 ms | 0.38× | 0.43× |
| mount N=50 | presented | 32.58 ms | 97.93 ms | 49.61 ms | **49.32 ms** | **35.83 ms** | **0.98×** | **0.51×** |
| mount N=50 | mounted | 25.79 ms | 58.09 ms | 40.73 ms | 39.30 ms | **27.61 ms** | **0.98×** | **0.68×** |
| mount N=50 | UI CPU/op | 11.51 ms | 60.10 ms | 23.81 ms | 30.00 ms | **13.48 ms** | 1.26× | **0.50×** |
| mount N=50 | JS CPU/op | 5.45 ms | 25.85 ms | 16.17 ms | **3.29 ms** | 3.60 ms | **0.20×** | **0.13×** |
| mount N=200 | presented | 55.71 ms | 481.48 ms | 131.37 ms | 157.88 ms | **61.04 ms** | 1.20× _(nv)_ | **0.33×** |
| mount N=200 | mounted | 41.07 ms | 208.41 ms | 114.87 ms | **89.07 ms** | **43.51 ms** | **0.78×** | **0.43×** |
| mount N=200 | UI CPU/op | 28.07 ms | 407.92 ms | 76.80 ms | 135.32 ms | **31.33 ms** | 1.76× | **0.33×** |
| mount N=200 | JS commit | 15.79 ms | 96.63 ms | 55.17 ms | **9.35 ms** | 9.49 ms | **0.17×** | **0.10×** |
| update N=50 | presented | 31.15 ms | 46.38 ms | 64.19 ms | **22.93 ms** | 47.32 ms | **0.36×** | **0.50×** |
| update N=50 | UI CPU/op | 5.68 ms | 19.07 ms | 5.45 ms | 15.05 ms | **7.05 ms** | 2.77× | **0.79×** |
| memory N=200 | bytes/inst | 76.3 KiB | 437.5 KiB | 250.4 KiB | 213.1 KiB | **77.6 KiB** | **0.85×** | **0.49×** |

The two findings this task made both reproduce on a quiet machine at 8 launches. **N=1 is free**:
31.45 ms presented against `rn-core`'s 31.82 ms, every arm inside 2 %, and the shared-host
comparator 0.99× of it. **N=200 splits the shapes**: hosted presents in 61.0 ms — `rn-core` is
55.7 ms, the shared host 131.4 ms, the per-control arm 481.5 ms — while the standalone arm takes
157.9 ms. That is the same 2.6× host-over-standalone gap this report quoted from the non-quiet run
(64.8 ms against 168.9 ms), which is the strongest thing the quiet run confirms. iOS is the usual
per-control story and unchanged in kind: 352.8 KiB against the shared host's 263.6 (1.34×), 0.98×
the per-control arm. The `update.presented` 2.03× on iOS and the memory miss are now cells with a
machine and a load stamp rather than a quick-plan number.

What changed status: this task's tables came from a `quick` plan where Menu had no committed cell
on any machine, so it could print no verdict. `Menu` is still unminted — `--update-baseline`
replaces a whole baseline file and a `--component menu` run would drop the other 196 cells, so
X14 owns the mint — but the ratios above are now quiet-run readings, and `--check` on them reports
every `menu` row as `not measured in base` (28 on iOS, 35 on Android) rather than as a failure.

The `leak` cells moved, and the move is worth the follow-up line it gets. G7b read
`leakMonotonic: false` on every arm of `leak.menu` and concluded "printed, not judged". A5's quiet
run agrees for the unhosted arms on both platforms (iOS 363 KiB/c and Android 417 KiB/c, both
non-monotonic), but on Android **four `nitro-ui-host` cells are monotonic**: `leak.menu` 695,
`leak.slider` 578, `leak.date-picker` 602 and `leak.button` 512 KiB/cycle, each over 8 launches
with `heapCollected: true`. Under the runner's own rule (§6 of setup-decisions: fail on a
monotonic increase) those four are the first slopes in this machine's bench history that qualify
as growth rather than drift, and they are all on the Host arm. They gate nothing — a committed
baseline stores no leak slope, so `--check` cannot see them — and A5 has no room to chase them;
see its report's follow-ups.

Four runs are reported: the two quick plans (both `problems: none` on the canonical devices, and
both stamping the machine `quiet: true`, so comparable in kind with A3's baseline runs on this
machine rather than with the busy runs G6 had to report), the Android full plan, which is not
quiet and says so where it is quoted, and the iOS full plan, which the fix round added. Load for
each is sampled against a 5.0 ceiling for 10 cores:
iOS quick median 3.30 / p90 4.20, 0 of 58 over; Android quick median 4.17 / p90 4.67, 2 of 70 over;
Android full median 4.03 / p90 5.35, 25 of 176 over; iOS full median 3.93 / p90 4.48, 5 of 146
over. The first three were clean-tree runs (`dirty:
false`): the two quicks on `2dd8dd7`, the Android full plan on `705f651`; the iOS full plan ran on a
dirty tree whose only diff was this report. The commits between them are report and docs files,
which no bench arm imports, and the artifacts keep their own SHAs so the
numbers can be traced to the tree that produced them. **No baseline was minted and `--check` was
not run**, per the brief. `nitro-ui-host` has no iOS cell at all (`ARM_SCOPES`: iOS `<Host>` is a
passthrough), which is why iOS has 12 quick cells and Android 15.

Medians of launch medians, ratios derived from them, and `(nv)` where either arm of that ratio has
a within-run spread over 10 % (the spread is across the four launch medians of that metric, so a
noisy arm marks every ratio that uses it). No verdict is claimed: no baseline exists for this
component, so `(nv)` is the only mark a row can carry, and D15's PASS/MISS table is the
orchestrator's to mint. The Android N=200 table bolds the cells the paragraph under it quotes; the
bold marks a quiet cell, not a verdict.

### iOS — `nitro-ui B` (`ios27-sim-iphoneair`), quick — `2dd8dd7-ios-20261030T005218Z.*`

| Cell | Metric | rn-core | expo per-control | expo shared-host | nitro-ui | ÷ shared | ÷ per-control |
| --- | --- | --- | --- | --- | --- | --- | --- |
| mount | presented | 16.05 ms | 116.41 ms | 16.13 ms | 49.48 ms | 3.07× | 0.43× |
| mount | mounted | 8.98 ms | 34.63 ms | 17.12 ms | 31.89 ms | 1.86× _(nv)_ | 0.92× _(nv)_ |
| mount | JS commit | 5.57 ms | 5.69 ms | 3.86 ms | 1.89 ms | 0.49× _(nv)_ | 0.33× _(nv)_ |
| mount | JS CPU/op | 5.88 ms | 9.29 ms | 4.37 ms | 2.24 ms | 0.51× _(nv)_ | 0.24× _(nv)_ |
| mount | UI CPU/op | 2.80 ms | 79.00 ms | 26.76 ms | 32.07 ms | 1.20× _(nv)_ | 0.41× _(nv)_ |
| update | presented | 16.11 ms | 15.51 ms | 16.11 ms | 32.78 ms | 2.03× _(nv)_ | 2.11× _(nv)_ |
| update | mounted | 4.25 ms | 8.08 ms | 5.65 ms | 19.27 ms | 3.41× _(nv)_ | 2.38× _(nv)_ |
| update | JS commit | 2.41 ms | 3.28 ms | 2.07 ms | 1.49 ms | 0.72× _(nv)_ | 0.45× |
| update | JS CPU/op | 2.61 ms | 8.51 ms | 2.64 ms | 2.31 ms | 0.88× _(nv)_ | 0.27× _(nv)_ |
| update | UI CPU/op | 4.41 ms | 22.03 ms | 11.51 ms | 23.37 ms | 2.03× _(nv)_ | 1.06× _(nv)_ |
| memory | bytes/inst | 61.9 KiB | 358.5 KiB | 262.0 KiB | 346.3 KiB | 1.32× | 0.97× |

Only two iOS rows are quiet in every arm, and they are the two worth quoting: `mount.presented`
(all arms ≤ 1 % spread) puts nitro-ui's Menu at 49 ms against `@expo/ui`'s 116 ms per-control and
16 ms shared-host, and `memory.bytes/inst` (≤ 4 %) at 346 KiB against 358 / 262 / 62 KiB.
Everything else exceeds 10 % in at least one arm — `mount.jsCommit` and `mount.mounted` worst, at
19–112 % across launch medians — so those ratios are reported, not judged. The direction the noisy
rows still agree on is that nitro-ui's Menu is cheap on the JS thread (0.24–0.51× of either
`@expo/ui` arm on JS commit and JS CPU per op) and dearer on wall-clock mount than `@expo/ui`'s
shared host, which is one SwiftUI tree for all 50 controls while this control's trigger is a
Button-shaped one. No cross-machine comparison is made here: G6's Picker numbers came from
`maintainer-mac-1` on a different simulator, and the runner's own D15 rule is what reserves those
rows.

### Android — `nitroui_b` (`android35-emu-pixel9`), quick — `2dd8dd7-android-20261030T005723Z.*`

| Cell | Metric | rn-core | expo per-control | expo shared-host | nitro-ui | nitro-ui-host | ÷ shared | ÷ per-control |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mount | presented | 32.77 ms | 98.93 ms | 50.40 ms | 49.44 ms | 32.83 ms | 0.98× _(nv)_ | 0.50× |
| mount | mounted | 24.65 ms | 60.10 ms | 43.29 ms | 39.67 ms | 26.36 ms | 0.92× _(nv)_ | 0.66× |
| mount | JS commit | 3.58 ms | 25.16 ms | 13.11 ms | 2.36 ms | 2.45 ms | 0.18× _(nv)_ | 0.09× _(nv)_ |
| mount | JS CPU/op | 4.23 ms | 26.35 ms | 15.49 ms | 2.97 ms | 3.01 ms | 0.19× _(nv)_ | 0.11× _(nv)_ |
| mount | UI CPU/op | 9.73 ms | 65.35 ms | 24.49 ms | 30.31 ms | 12.20 ms | 1.24× | 0.46× |
| update | presented | 30.93 ms | 53.90 ms | 64.41 ms | 22.31 ms | 47.16 ms | 0.35× _(nv)_ | 0.41× _(nv)_ |
| update | mounted | 18.04 ms | 21.55 ms | 15.82 ms | 9.36 ms | 15.33 ms | 0.59× | 0.43× _(nv)_ |
| update | JS commit | 2.69 ms | 10.37 ms | 6.93 ms | 1.82 ms | 1.82 ms | 0.26× _(nv)_ | 0.18× _(nv)_ |
| update | JS CPU/op | 2.82 ms | 10.72 ms | 7.34 ms | 2.90 ms | 2.20 ms | 0.40× _(nv)_ | 0.27× _(nv)_ |
| update | UI CPU/op | 5.56 ms | 21.66 ms | 5.54 ms | 17.66 ms | 7.40 ms | 3.18× _(nv)_ | 0.82× _(nv)_ |
| memory | bytes/inst | 76.3 KiB | 440.6 KiB | 248.6 KiB | 217.9 KiB | 77.5 KiB | 0.88× | 0.49× |

Android is where the shape pays. The quiet rows: `mount.UI CPU/op` at 30.3 ms against `@expo/ui`'s
65.4 ms per-control (0.46×, and 1.24× its shared host), `update.mounted` at 0.59× the shared host,
`mount.presented`/`mounted` against the per-control arm at 0.50× and 0.66×, and
`memory.bytes/inst` at 218 KiB against 441 KiB — with `nitro-ui-host` at 77.5 KiB, within noise of
`rn-core`'s 76.3 KiB. The ratios against the shared host in `mount.presented`/`mounted` are marked
`(nv)` only because *that* arm was noisy there (27 % and 15 % across its launch medians), not
nitro-ui's, which held 3 % and 5 %. A Compose popup is not composed until it opens, so this
control is a Button-shaped tree plus a model, which is also why the Host arm costs almost nothing
over a plain `Pressable`. Unlike `update.picker` and `update.progress`, this cell loses no signal
on any arm (`missing: null`, every metric `reportable` in all five), so it does not add to the
FOLLOWUPS line about Android reference arms.

### Android — `nitroui_b`, full plan — `705f651-android-20261030T010235Z.*`

`--plan full --component menu` is the seven cells Picker has: `mount` at N=1, 50 and 200, `update`
at N=1 and 50, `memory` and `leak` at N=200. This run finished after the report's first draft, so
it is the second Android run on this component — 35 cells, `problems: []`, artifact
`705f651-android-20261030T010235Z.*`. It is **not** a quiet run: load sampled median 4.03 / p90
5.35 / max 6.32 against the 5.0 ceiling, 25 of 176 samples over (the quick run above was the quiet
one). The new cells, same rules as the tables above:

| Cell | Metric | rn-core | expo per-control | expo shared-host | nitro-ui | nitro-ui-host | ÷ shared | ÷ per-control |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mount N=1 | presented | 31.92 ms | 32.36 ms | 32.53 ms | 31.79 ms | 32.02 ms | 0.98× | 0.98× |
| mount N=1 | mounted | 16.89 ms | 18.54 ms | 18.88 ms | 17.39 ms | 17.37 ms | 0.92× _(nv)_ | 0.94× _(nv)_ |
| mount N=1 | JS commit | 0.45 ms | 1.15 ms | 1.14 ms | 0.38 ms | 0.42 ms | 0.34× _(nv)_ | 0.33× _(nv)_ |
| mount N=200 | presented | 65.54 ms | 532.03 ms | 140.03 ms | 168.88 ms | **64.82 ms** | 1.21× _(nv)_ | **0.32×** |
| mount N=200 | mounted | 44.39 ms | 229.81 ms | 123.94 ms | 95.98 ms | **45.70 ms** | **0.77×** | **0.42×** |
| mount N=200 | JS commit | 14.17 ms | 105.69 ms | 57.33 ms | **8.86 ms** | **8.76 ms** | 0.15× _(nv)_ | 0.08× _(nv)_ |
| update N=1 | presented | 30.41 ms | 47.13 ms | 64.17 ms | **31.36 ms** | 47.06 ms | **0.49×** | **0.67×** |
| update N=1 | mounted | 14.88 ms | 14.45 ms | 14.53 ms | 15.16 ms | 14.20 ms | 1.04× _(nv)_ | 1.05× |
| update N=1 | JS commit | 0.35 ms | 0.57 ms | 0.54 ms | 0.36 ms | 0.36 ms | 0.66× | 0.63× |
| leak N=200 | leak slope | 306 KiB/c | 1251 KiB/c | 982 KiB/c | 365 KiB/c | 692 KiB/c | 0.37× _(nv)_ | 0.29× _(nv)_ |

What the two sizes add: **N=1 is free** — a Menu costs what a `Pressable` costs when there is only
one of them (31.79 ms vs 31.92 ms presented, all arms within 5 %), which is the batch overhead
showing that the N=50 gap mostly is. **N=200 is where the two shapes split**: the Host arm presents
in 64.8 ms, indistinguishable from `rn-core`'s 65.5 ms and 8.2× faster than the per-control arm's
532 ms, while the standalone arm takes 168.9 ms — over its shared-host comparator (1.21×, on a cell
where that arm itself swung 10 %) and 3.1× under `@expo/ui`'s per-control cost. That is D24's
result repeating for an eighth control, and it says the honest thing about `Menu` at scale: 200 of
them in one `<Host>` is the shape this library is fast at, and the standalone shape pays per
control like everyone else's.

The `leak.menu` cell measured a slope on every arm but `leakMonotonic: false` on all five, which is
the runner's own signal that the growth is run-to-run drift rather than retained memory per cycle —
`comparableMetrics` drops a non-monotonic slope, and the report prints `not monotonic (not gated)`.
So the slopes are printed and not judged: 365 KiB/cycle for nitro-ui against 306 for `rn-core` and
982/1251 for the two `@expo/ui` arms is consistent with the `memory.bytes/inst` result in the quick
table, and no more than that.

### iOS — `nitro-ui B`, full plan — `ae2ec53-dirty-ios-20261030T012442Z.*`

The run the first draft refused to quote finished during the fix round: 28 cells, 4 launches,
`problems: []`, sampled 146× at median 3.93 / p90 4.48 / max 5.54 with 3.4 % over the 5.0 ceiling —
under the runner's busy bar, though the artifact carries no `quiet: true` stamp to quote. It is the
**dirty** tree at `ae2ec53`, whose diff is docs and report files no arm imports. The four
`memory`/`leak` cells at N=200 log `0 iterations`, which is what those two scenarios do: they ask for
`bytesPerInstance`/`leakSlope` rather than per-iteration timings, so `samples: 0` against `expected:
0` is whole, and their memory half did measure (4 of 4 launches). The Android full plan logs the same
`0 iterations` on its five `memory`/`leak` cells, and round 1 quoted those slopes, so the line is not
a failure signal. `leak.menu` records `bytesPerInstance:
null` by the same rule. No iOS `nitro-ui-host` arm exists, so 28 cells where Android's full plan has
35.

| Cell | Metric | rn-core | expo per-control | expo shared-host | nitro-ui | ÷ shared | ÷ per-control |
| --- | --- | --- | --- | --- | --- | --- | --- |
| mount N=200 | presented | 16.13 ms | 438.50 ms | 135.51 ms | 179.41 ms | 1.32× _(nv)_ | 0.41× |
| mount N=200 | mounted | 18.44 ms | 150.60 ms | 64.88 ms | 123.33 ms | 1.90× _(nv)_ | 0.82× _(nv)_ |
| mount N=200 | JS commit | 11.17 ms | 21.27 ms | 15.52 ms | 8.05 ms | 0.52× _(nv)_ | 0.38× _(nv)_ |
| mount N=200 | JS CPU/op | 11.41 ms | 65.67 ms | 16.33 ms | 8.41 ms | 0.51× _(nv)_ | 0.13× _(nv)_ |
| mount N=200 | UI CPU/op | 13.47 ms | 386.56 ms | 102.91 ms | 149.66 ms | 1.45× _(nv)_ | 0.39× _(nv)_ |
| update N=1 | presented | 15.91 ms | 16.08 ms | 16.02 ms | 16.02 ms | 1.00× | 1.00× |
| update N=1 | mounted | 1.26 ms | 0.66 ms | 1.19 ms | 2.48 ms | 2.07× _(nv)_ | 3.72× _(nv)_ |
| update N=1 | JS commit | 0.93 ms | 0.29 ms | 0.65 ms | 0.47 ms | 0.72× _(nv)_ | 1.62× _(nv)_ |
| memory N=200 | bytes/inst | 62.1 KiB | 357.5 KiB | 261.6 KiB | 355.7 KiB | 1.36× | 1.00× |
| leak N=200 | leak slope | −119 KiB/c | −2021 KiB/c | −1507 KiB/c | 356 KiB/c | −0.24× | −0.18× |

What this adds to the iOS story is the same two findings Android has: **N=1 is free** (`update N=1`
presents at 16.02 ms against `rn-core`'s 15.91 ms, the only row here with no `(nv)` on either ratio)
and **N=200 splits the shapes** — the standalone arm at 179 ms against its shared-host comparator's
136 ms, where `rn-core` needs 16 ms. `memory.bytes/inst` at 356 KiB repeats the quick plan's 346 KiB
to within 3 %, the least noisy cross-run agreement this component has shown. The `leak.menu` slopes
are printed, not judged: `leakMonotonic: false` on all four arms and three of them negative, so those
ratios are not a leak claim — the same conclusion Android's `leak` cells reached, and one more data
point for the FOLLOWUPS line that the `leak *:N=200` cells need re-scoping. Nothing here is minted,
and `--check` was not run against it.

## Files changed

- `src/components/Menu/component.json` — `bench`/`smoke`/`realInput` true, `realInputTitle`,
  `benchUnsuffixed: false`; `bun run regen` clean (8 components, 15 generated files).
- `bench/src/implementations/{shared,nitroUi,rnCore,expoUi.ios,expoUi.android}.tsx|ts`,
  `bench/src/{plan,types}.ts`, `scripts/bench/lib.mjs` — the Menu arm in all five arms, the
  module-level `MENU_GROUP`/`menuTitle` flip, and the cells in both plans.
- `example/src/MenuScreen.tsx`,
  `example/ios/NitroUiExampleUITests/RealInputTests.swift`, `scripts/real-input/{android.mjs,controls.mjs}`
  — the real-input case on both platforms: one ordered event echo (`real-input-menu-events`) so
  D32's ordering is assertable from the same screen on either, `goToScreen`'s `menu` entry, and on
  Android F1's rect-witnessed presses. iOS has no `nativeState` witness on the menu taps: what
  guards those is the presented-rows check plus the "row gone, don't press it again" rule (the same
  shape `Picker`'s case uses), and the full-string echo assertions are what make the immediate
  post-tap read provable rather than hopeful.
- `example/__tests__/Menu.harness.tsx` — the hosted popup's upper bound, and the comment that
  records what the four anchor mutants measured.
- `example/src/stories/Menu.stories.tsx` — Playground (every public prop) plus 9 showcase stories.
- `scripts/smoke/App.tsx` and the generated `scripts/smoke/lib.mjs` — the eighth control in the
  ready-line contract: one `Menu` in the consumer app, its box reported beside the other seven.
- `scripts/__tests__/{registry,bench-gate,smoke-ready-line}.test.js` — the expectations the flips
  move: `menu` in the registry and host-arm lists (plus the new `bench: false` direction), the plan
  counts and shared-Host scope in `bench-gate`, and a `menu=WxH` token in both ready-line fixtures.
- `ios/components/Menu/HybridNitroUiMenu.swift`,
  `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiMenu.kt`,
  `docs/components/menu.md`, `docs/tasks/FOLLOWUPS.md` — the spike's answer, the corrected
  anchor claims, and the follow-ups below. No shipped API changed, so no changeset:
  `component.json` is excluded from the tarball (`package.json` → `"!**/component.json"`),
  `Menu.harness.tsx` is under the ignored `**/__tests__`, and `.changeset/
  menu-button-anchored.md` already covers Menu.

## Follow-ups

- Menu Android: after a tap on a **disabled** row the popup stays up and the first dismissal usually
  does nothing either — Back timed out at 29 Oct 23:33:43Z, and the scrim tap left it up at 30 Oct
  00:35:09Z and 02:06:14Z (it worked at 01:49:39Z). The check logs which dismissal won instead of
  asserting one, so this is a user-facing bug the suite tolerates. In `FOLLOWUPS.md`.
- Smoke: the `menu=97.619049072265625x48` token in `smoke-ready-line.test.js`'s fractional fixture is
  **hand-written**, and no device has printed a Menu line in a smoke run. The parser is covered; the
  measurement is not. Running `smoke:rn-cli` once and pasting the real line closes it.
- Menu Android a11y: a disabled `DropdownMenuItem` reports `enabled="true"` in `uiautomator dump`
  while the control refuses the pick — what TalkBack announces is unverified and possibly wrong.
- Real-input tooling: `scripts/real-input/android.mjs`'s `goToScreen` takes a hand-written
  `screen → {label, anchor}` map, so a new control's manifest row silently produces an
  `undefined` tab lookup; it should read the generated `controls.mjs` row instead.
- Bench gates: `gate.mjs bench --help` resolves to a real bench launch that exits 2 and lands a
  FAIL row in the ledger; `bench` should refuse `--help` the way `check` refuses arguments.
- Bench leak cells: A5's quiet full plan is the first run here with **monotonic** leak slopes —
  Android `nitro-ui-host` on `menu` (695 KiB/cycle), `date-picker` (602), `slider` (578), `button`
  (512), 8 launches each, `heapCollected: true`, every unhosted arm still non-monotonic. Setup
  decisions §6 says fail on a monotonic increase, and no gate can see it because a committed
  baseline stores no leak slope. Wants an owner with a heap dump.
- X4's Menu coverage is a duplicate `real-input-menu` block: `task/X4-conformance` added
  `testID="real-input-menu"` to `MenuScreen.tsx` independently of this task's block, so merging
  the two will need the a11y case repointed at one screen (or its fixture regenerated).
- `Menu.stories.tsx`: `group` has no Controls row (the on-device panel cannot type a tree), so the
  Playground switches between five item lists on chips — a `MenuGroup` editor would be a storybook
  feature, not a story.

## Questions for orchestrator

None blocking. Two notes for whoever merges:

- **X4 is not merged**, so item 7 (conformance) was not applicable here; X4's own branch already
  adds a Menu a11y case and fixture, and its follow-up line says its recycle-reset half is a
  `blindSpot` on iOS. When both land, the `real-input-menu` screen exists twice (see Follow-ups) —
  my recommendation is to keep this task's block, since it carries the pick and event echoes the
  real-input case reads, and repoint X4's fixture generator at it.
- **D15's canonical baselines**: the two quick runs are `quiet: true` on this machine, in the same
  state A3's baselines were minted in, but a per-component quick plan is not a mint. If the
  orchestrator wants `menu` in `bench/baselines/maintainer-mac-2/*`, it should come from your
  exclusive window; I have not touched the baseline files.

## Fix round 1

The review's three must-fixes, two should-fixes and the nits, green on code tree `7e566bda08a6`.

**M1.** `CHECKS.menu` asserts the whole echo twice — `open > close > open > select bravo > close`
after the pick, then the whole ten-event history after the twin — and `lastEvents` is gone. Red:
`MenuScreen` firing `open` twice, run `01:49:39Z`, three `✗` lines (the third against an earlier
expected string that left out the disabled row's `open > close`; the final string is that run's
output with the doubled `open`s removed, and reads green at `02:06:15Z`).
**M2.** `DropdownMenu(offset = DpOffset(0.dp, 64.dp))` moves the popup's window; `gap` 16 px →
168 px (64 dp at this AVD's 2.625 density), red at `01:48:49Z`. Both mutants reverted.
**M3.** The `harness:android:Menu` tally is six round-1 lines plus two from this round; the
23:23:53Z Picker timeout and the SIGTERM'd `harness:ios` each have a line; the iOS "witness" claim
now describes the presented-rows check and the don't-re-press rule. **S1.** The unreliable dismissal
after a disabled-row tap is in `FOLLOWUPS.md` and here, and `tapScrim` says what the runs show.
**S2.** The smoke fixture's `menu=` token is marked hand-written. Nits: the screenshot is an
`XCTAttachment` plus a sandbox path and committed at `docs/tasks/G7b/menu-open-ios.png`; the
tap-away point is tied to the layout; "nothing is bolded" is gone; `select bravo` is lower-case; the
summary is 394 words. The iOS full-plan bench is quoted above: `0 iterations` is what `memory` and
`leak` always log, and their memory half measured.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1165 tests / 45 suites | `7e566bda08a6` | 2 m 45 s | start 2.2 / med 5.3 / max 7.0 |
| `harness:ios` | **PASS** | 183 tests / 14 suites | `7e566bda08a6` (ios tree) | 2 m 19 s | start 4.2 / med 4.2 / max 8.2 |
| `harness:android` | **PASS** | 232 tests / 14 suites | `7e566bda08a6` (android tree) | 6 m 53 s | start 5.2 / med 4.8 / max 29.1 |
| `real-input:ios` | **PASS** | — | `7e566bda08a6` (ios tree) | 12 m 55 s | start 3.5 / med 4.2 / max 20.9 |
| `real-input:android` | **PASS** | — | `7e566bda08a6` (android tree) | 16 m 23 s | start 9.0 / med 4.0 / max 9.0 |
| `bench:--help` | stale | — | 43816d4c80ef (not this tree) | 0.1 s | start 2.3 / med 2.3 / max 2.3 |
| `harness:android:Menu` | stale | 1 failed of 15 tests / 1 suites | 03e53c145b6f (not this tree) | 19.7 s | start 4.6 / med 4.2 / max 4.6 |
| `harness:android:Menu:--background` | stale | — | 03e53c145b6f (not this tree) | 0.8 s | start 4.6 / med 4.6 / max 4.6 |
| `real-input:android:--control:menu` | stale | — | 5f50123e35e2 (not this tree) | 1 m 14 s | start 3.1 / med 3.9 / max 4.3 |
| `real-input:ios:--control:menu` | stale | — | b13dde9a2150 (not this tree) | 2 m 07 s | start 2.2 / med 14.0 / max 17.4 |
| `real-input:ios:--control:menu:--background` | stale | — | cdde3752f6f3 (not this tree) | 0.2 s | start 7.5 / med 7.5 / max 7.5 |

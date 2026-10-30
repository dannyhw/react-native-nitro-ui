# G7b — Menu: bench arm, real-input, story, smoke, and what G7a left open

**Branch:** `task/G7b-menu-finish` (from `main` at `55ed239`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `G7b-27pum` (pair-b: `nitro-ui B` / `emulator-5570`, adb server 5041 / Metro 8293)

## Summary

Menu now carries the four things a component needs to count as finished: a bench arm in every
plan, a real-input case on both platforms, a Storybook story, and a line in the consumer smoke
app. `component.json` flipped to `bench`/`smoke`/`realInput` and `bun run regen` is clean; the
cells are Picker's — `mount`/`update`/`memory` quick, plus `leak` in the full plan — because a
Menu's box is its trigger's box, so it joins the self-sizing set and `update.menu` flips the
trigger title, the sizing key (D16). **No cell opens a popup**: no arm can price a real popup
gesture across three runtimes, so the cells measure the mounted control, and `memory`/`leak` are
the closest thing to a leak story. The `nitro-ui-host` arm is Android-only because iOS `<Host>`
is a passthrough (D23), so iOS has four arms where Android has five.

Two decisions a reviewer needs before the diff:

1. **The iOS check found a real trap, and it is now in the test.** SwiftUI presents this menu
   *over its own trigger*, so a press aimed at the trigger while the menu is up lands on whichever
   row covers it — the first real run measured `select alpha > select bravo` where one pick was
   expected. The case now measures what a tap on the disabled row does to the presentation, puts the
   menu away through a point that cannot be a row, and waits. That run's screenshot also settles
   G7a's styling question: the trigger's `.buttonStyle` does not follow the rows, so no
   `.buttonStyle(.plain)` was added.
2. **The `menuAnchor` red proof did not go as the brief expected** (item 4). The upper bound is in
   place, and inverting it is what goes red — but four mutants that remove the anchor, replace it
   with a plain `DropdownMenu`, or offset the list all still measured the popup at the trigger. So
   this bound guards behaviour `menuAnchor` provides; it is not a reproduction of a mis-anchored
   popup, and the three places that said otherwise (`HybridNitroUiMenu.kt`, the test's own comment
   in `Menu.harness.tsx`, `docs/components/menu.md`) now say what was measured.

Item 6, the iOS open/close spike, is a decisive no: a `.onAppear`/`.onDisappear` sentinel on the
menu content reported **one** open across two presentations and **no** close, not even for the pick
that visibly dismissed the menu. Not shipped; D32 stands. Item 7 does not apply — X4 is not merged.

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

`need --for review` is satisfied on this code tree, and so is `need --for merge` (all five
required gates green on `43816d4c80ef`). Three rows above need reading, not re-running:

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
  launch put `--background` after `--`, which the runner rejects as an unknown argument.
  `harness:android:Menu` shows five `fail` lines: one `hosted-removal` timeout (the mutant with no
  `menuAnchor`, which also stops the anchor reporting its own dismissal), the inverted `gap` bound,
  and three stale-app refusals where the APK predated the edit — the guard working, not a test
  failing. Everything there is superseded by the full gates above on this tree.
- The iOS a11y red proof and the menuAnchor red proof (below) are deliberately left as red
  **runs**, then reverted: their ledger lines are the stale ones.

## Red proofs

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
  `emulator-5570` and every one reported the popup at the trigger (the offset run reported the
  unchanged gap, so the offset never reached the rect the test reads). Recorded because it is the
  finding, not a failure to run the proof: see item 4 in the Summary and the corrected claims.
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

`NITRO_UI_MACHINE_LABEL=maintainer-mac-2 bun bench --platform <p> --plan quick --component menu`.
Quick = 4 launches × (5 warmup + 20 measured) per cell. Both runs are `problems: none` on the
canonical devices and both stamp the machine `quiet: true` (load sampled against a 5.0 ceiling for
10 cores: iOS median 3.30 / p90 4.20, 0 of 58 samples over; Android median 4.17 / p90 4.67, 2 of 70
over), so they are comparable in kind with A3's baseline runs on this machine rather than with the
busy runs G6 had to report. Numbers are load-stamped in the artifacts
(`2dd8dd7-ios-20261030T005218Z.*`, `2dd8dd7-android-20261030T005723Z.*`); **no baseline was minted
and `--check` was not run**, per the brief. `nitro-ui-host` has no iOS cell at all (`ARM_SCOPES`:
iOS `<Host>` is a passthrough), which is why iOS has 12 cells and Android 15.

Medians of launch medians, ratios derived from them, and `(nv)` where either arm of that ratio has
a within-run spread over 10 % (the spread is across the four launch medians of that metric, so a
noisy arm marks every ratio that uses it). No verdict is claimed and nothing is bolded: no
baseline exists for this component, so `(nv)` is the only mark a row can carry, and D15's PASS/MISS
table is the orchestrator's to mint.

### iOS — `nitro-ui B` (`ios27-sim-iphoneair`), quick

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

### Android — `nitroui_b` (`android35-emu-pixel9`), quick

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

### Full plan

`--plan full --component menu` adds `mount` at N=1 and N=200, `update` at N=1, and `leak.menu` at
N=200 — the same seven cells Picker has, on the same sizes. `--dry-run` on this lease resolves it
as "7 cells × 5 implementations × 4 launches = 140 launches… Dry run: OK". The Android full run
was still in flight when this was written; if its numbers exist they are in
`bench/results/2dd8dd7-android-<later>-*.md`, and they are not quoted here because I will not
report a table I have not read. The iOS full plan was not run: this task adds no iOS bench code
beyond the arm, and the quick plan covers the three cells the D15 table reads.

## Files changed

- `src/components/Menu/component.json` — `bench`/`smoke`/`realInput` true, `realInputTitle`,
  `benchUnsuffixed: false`; `bun run regen` clean (8 components, 15 generated files).
- `bench/src/implementations/{shared,nitroUi,rnCore,expoUi.ios,expoUi.android}.tsx|ts`,
  `bench/src/{plan,types}.ts`, `scripts/bench/lib.mjs` — the Menu arm in all five arms, the
  module-level `MENU_GROUP`/`menuTitle` flip, and the cells in both plans.
- `example/src/MenuScreen.tsx`,
  `example/ios/NitroUiExampleUITests/RealInputTests.swift`, `scripts/real-input/{android.mjs,controls.mjs}`
  — the real-input case on both platforms: one ordered event echo (`real-input-menu-events`) so
  D32's ordering is assertable from the same screen on either, F1's witness pattern on every
  retry, and `goToScreen`'s `menu` entry.
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

- Menu Android a11y: a disabled `DropdownMenuItem` reports `enabled="true"` in `uiautomator dump`
  while the control refuses the pick — what TalkBack announces is unverified and possibly wrong.
- Real-input tooling: `scripts/real-input/android.mjs`'s `goToScreen` takes a hand-written
  `screen → {label, anchor}` map, so a new control's manifest row silently produces an
  `undefined` tab lookup; it should read the generated `controls.mjs` row instead.
- Bench gates: `gate.mjs bench --help` resolves to a real bench launch that exits 1 and lands a
  FAIL row in the ledger; `bench` should refuse `--help` the way `check` refuses arguments.
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
- **D15's canonical baselines**: this is the first bench on a machine the runner calls quiet, but
  it is a per-component quick plan, not a mint. If the orchestrator wants `menu` in
  `bench/baselines/maintainer-mac-2/*`, it should come from your exclusive window; I have not
  touched the baseline files.

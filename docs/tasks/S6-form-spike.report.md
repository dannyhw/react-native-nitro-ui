# S6 — Form and Section spike: React Native rows in native grouped lists

<!--
  The short report format (docs/tasks/PROCESS-review-2026-10-26.md §3: "Report format: shrink
  it").
-->

**Branch:** `task/S6-form-spike` (from `main` at `5922b8e0`) · **Round:** 1 of 1 (D19, a spike) ·
**Lease:** `S6-mpdf2` (pair-b — iOS `nitro-ui B` / iPhone Air 27.0, Android `emulator-5570`, Metro 8293)

## Summary

**NO-GO.** Not because a behaviour failed — because one of the five measurements GO rests on
was not taken. Questions 1, 2, 3 and 7 pass on both platforms. **Question 4's iOS taps are
unmeasured**, so the iOS row-press path this round had to *invent* is unproven. Everything else
G-Form needs is below.

The prototype is `Form` / `Form.Section` / `Form.Row`: on iOS a `.insetGrouped` `UICollectionView`
that adopts Fabric's row views into `UICollectionViewListCell`s; on Android rows stay put with M3
`SegmentedListItem` shapes behind them.

Two bugs, invisible to the harness and found only by OS-level taps — and the Android fix
has a visible cost:

- **iOS: the list wins every touch.** Fabric's `RCTSurfaceTouchHandler.mm` returns `NO` from
  `shouldRecognizeSimultaneouslyWithGestureRecognizer:`, and UIKit's selection recognizer claims the
  touch at touch-down, so content in a row never sees the release. The prototype sets
  `allowsSelection = false` and gives each cell a
  `UILongPressGestureRecognizer(minimumPressDuration: 0)` with `cancelsTouchesInView = false`
  (`NitroUiFormRowCell.pressGesture`). **Not yet
  measured** — see `docs/tasks/S6/real-input.md`.
- **Android: the chrome host ate every touch.** `addReactChild` kept the full-size Compose host
  *last* — top of the z-order — between a finger and every row. It now stays at index 0. Same
  driver, before and after: `outside=43 rows=0 pressable=0` →
  `rows=20 pressable=10 switches=10 outside=10 orphans=0` (`real-input.md`) — question 7's 10/10
  from `adb shell input tap`.
- **The fix has a cost.** A section's header is Compose text drawn *in that same layer*, so at
  index 0 the first row of each section paints over its lower half — the `Sound` and `About`
  headers in `docs/tasks/S6/form-android.png`. Topmost, the overlap was invisible, and no assertion
  reads Android header geometry.

Also hard: an iOS row is laid out at the Form's origin, so its `measure`/`measureInWindow` is the
Form's box, not the row's — harness-aimed taps in a row reach nothing (0/10, asserted). G-Form must
not aim at a row's measured box on iOS.

**Cost (question 6) is a harness number, not a bench**: with no `@expo/ui` in the example app, the
same probes ran against a plain RN column — Android `N=20` 93 ms vs 69 ms, `N=50` 131 ms vs 73 ms.
Expo was never measured, so its go line stands untouched.

Gaps: fidelity ran in one appearance at default text size, not the brief's three; `radius` reads
0.00 on both sides; and nothing focused a `TextField`, so
question 5 is untested.

## Questions

| # | Question | Result | Evidence | Go line |
| --- | --- | --- | --- | --- |
| 1 | Reparenting holds | **PASS** | `Form.harness` E1 ×2: 9 rows/9 items, `orphans=0`, `where=cell`, `stale=0`; then an insert, a removal and 50 scrolls with `orphans=0`, `reclaims>0`, `reparents>0` | 10/10 harness ✓ |
| 2 | Fidelity vs SwiftUI `Form` | **PASS with two gaps** | `FormFidelity` table: 9 of 12 metrics identical to 0.00 pt (`listW 420`, `x 20`, `w 380`, `sep 20`, `headerX 20`, `headerY 0`, `headerH 40.33`, `footerH 29.67`); row box 60.00 vs 52.00. Gaps: row box is 8 pt off by a padding constant, and `radius=0.00` both sides = blind probe; light only, no dark / largest Dynamic Type | within 1 pt — **met except the row box (8 pt) and radius (unmeasured)** |
| 3 | Sizing | **PASS** | `Form.harness` E3: row height = content + a constant chrome delta; a row that grows grows on its next frame and its neighbours move ≤ 1 pt | right on the first frame ✓ |
| 4 | Touch + `measure` | **Android PASS / iOS UNMEASURED**; `measure` documented | OS taps: `rows=20 pressable=10 switches=10 outside=10 orphans=0` (`real-input.md`). iOS taps: not taken (no second XCUITest session). iOS `measure` is the Form's box, not the row's — asserted 0/10 | taps 10/10 — **not met on iOS** |
| 5 | Keyboard | **NOT MEASURED** | the prototype has `avoidsKeyboard` wiring and a `keyboard=` field, but no case focuses a `TextField` near the bottom | visible both platforms — untested |
| 6 | Cost | **harness proxy only** | `S6 COST` N=20 `form=93ms plain=69ms`, N=50 `form=131ms plain=73ms` (Android); `orphans=0`, `alive==N`, iOS `items==N` and `inCells<N`. No `@expo/ui` arm, no CPU/memory | ≤ Expo and ≤1.2× — **not measured** |
| 7 | Android press without stealing touches | **PASS** | the driven run: `rows=20 pressable=10 switches=10 outside=10 orphans=0` — a row's own press, its content's press and 10 `Switch` changes, all from `adb shell input tap`, M3 pressed state shown | both 10/10 ✓ |


| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1843 tests / 74 suites | `1d944cc1ca50` | 2 m 43 s | start 4.1 / med 6.5 / max 10.2 |
| `harness:ios` | **PASS** | 462 tests / 28 suites + isolated 4 tests / 2 suites | `6f4a4afe2416` (ios tree) | 15 m 26 s | start 6.0 / med 6.1 / max 26.8 |
| `harness:android` | **PASS** | 518 tests / 28 suites + isolated 4 tests / 2 suites | `6f4a4afe2416` (android tree) | 19 m 43 s | start 4.5 / med 4.6 / max 8.9 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:android:Form.harness` | stale | 2 failed of 5 tests / 1 suites | daea778313b9 (not this tree) | 13.4 s | start 7.2 / med 7.2 / max 7.2 |
| `harness:android:FormFidelity` | **PASS** | 1 tests / 1 suites | `6f4a4afe2416` (android tree) | 18.9 s | start 4.0 / med 4.5 / max 4.6 |
| `harness:android:FormFidelity:FormFidelity` | **PASS** | 1 tests / 1 suites | `1d944cc1ca50` (android tree) | 18.5 s | start 5.8 / med 5.7 / max 5.8 |
| `harness:android:FormTouch` | **FAIL** | — | `1d944cc1ca50` (android tree) | 1.0 s | start 14.1 / med 14.1 / max 14.1 |
| `harness:android:FormTouch:FormTouch` | **PASS** | 1 tests / 1 suites | `1d944cc1ca50` (android tree) | 21.5 s | start 4.7 / med 4.2 / max 4.7 |
| `harness:android:FormTouch:FormTouch:--background` | stale | — | f26c3fa50135 (not this tree) | 0.9 s | start 6.0 / med 6.0 / max 6.0 |
| `harness:ios:Form` | stale | 80 tests / 2 suites | 09503b17a7cd (not this tree) | 2 m 45 s | start 15.2 / med 7.5 / max 15.2 |
| `harness:ios:Form.harness` | stale | 5 tests / 1 suites | f8a0afceafbb (not this tree) | 18.9 s | start 3.9 / med 4.5 / max 4.8 |
| `harness:ios:FormFidelity` | **PASS** | 1 tests / 1 suites | `6f4a4afe2416` (ios tree) | 31.0 s | start 5.1 / med 5.3 / max 6.6 |
| `harness:ios:FormTouch` | stale | 1 tests / 1 suites | 13c0c95af31d (not this tree) | 4 m 18 s | start 6.7 / med 6.6 / max 9.5 |
| `harness:ios:FormTouch:--background` | stale | — | e48bcb2acb5b (not this tree) | 1.4 s | start 6.0 / med 6.0 / max 6.0 |

Two rows in that table are this round’s own tooling, not the code:
`harness:android:FormTouch` failed in 1.0 s because the stale-app guard refused it — the manifest
refresh moved the code tree and the APK had not been rebuilt yet, so no test ran; the row below it
is the same case, driven, green on the new tree. The `--background` keys and
`harness:ios:FormTouch` are earlier mis-invocations of the same case. They stay in the ledger
because a filtered run satisfies nothing else. One note for G-Form: `FormTouch` cannot be run
without its driver — the case waits 240 s for taps while jest stops a test at 30 s, so an
undriven run times out instead of reaching its own `if (!driven) return;`.


`need --for review`: review is satisfied on this code tree.

## Red proofs

- `harness:ios:Form.harness` -> `NitroUiFormRowContainer.adopt()` returns early, so a row never
  reaches its cell -> `expected 'holding' to be 'cell'`, twice.
- `harness:android:Form.harness` -> the section report's shape count off by one
  (`shapes=${rects.size - 1}`) -> `expected 3 to be 4` and `expected 2 to be 3`.
- `harness:ios:FormFidelity` -> `ROW_BOX_BOUND_PT = 0` -> `question 2: 3 field(s) out of bounds
  (1 pt container, 0 pt row box)`, with `h0/h1/h2 60.00 52.00 8.00` in the table it prints. Note
  what did *not* go red: `CONTAINER_BOUND_PT = 0` passes, because every container field measures
  the same to 0.00 — the row-box bound is the only live comparison in that case today.
- `harness:android:FormTouch` -> the pre-fix tree, Compose host last in the z-order ->
  `expected 'outside=43 rows=0 pressable=0 …' to be 'all ten'`: the control outside the Form
  answered 43 taps, nothing inside it answered one.
- `harness:android:FormTouch` -> reading `nuiTestFormReport()` once instead of polling ->
  `orphans=-` with all four counters green. Both platforms answer a report with whatever main
  published last (answering now would block the JS thread on main), so one read is `pending`, and
  a case that reads once can call a clean run an orphan. `readReport()` now polls.
- `check`'s own guards caught the spike, which is what they are for: `registry.test.js` and
  `host.test.tsx` (a component directory with no manifest), `android-icons.test.js`
  (`HybridNitroUiFormSection.kt`: six "a path command" lines), `patch-nitrogen.test.js` (two
  `expect(result.status).toBe(0)` → `1`, because the fixture tree no longer generated every view
  the content-children list names). Each is answered below, and each answer is a decision.
- **Not run, and it matters:** `NitroUiFormRowCell.pressGesture` has no red proof and no green
  one. Both need OS-level iOS taps, which this round could not take.

## Files changed

- `example/__tests__/Form.harness.tsx`, `FormFidelity.harness.tsx`, `FormTouch.harness.tsx` — the
  seven questions on device; the fidelity table; the OS-input case; `readReport()`.
- `ios/components/Form/HybridNitroUiForm.swift`, `NitroUiFormViews.swift` — `allowsSelection` off,
  `pressGesture` on the cell, `rowPressed`, and a footer probe that asks every section (the last
  one usually has no footer, which is how the reference lost `footerH`).
- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiFormSection.kt` — the chrome host at index 0; the hand-drawn accessory
  caret deleted (D43).
- `scripts/__tests__/patch-nitrogen.test.js` — the scratch tree declares and generates every view
  on `CONTENT_CHILDREN_VIEWS`, read from the script, so it is a tree and not a fragment.
- `scripts/__tests__/registry.test.js`, `src/__tests__/host.test.tsx` — `Form` named where `<Host>`
  is named: no manifest, so no registry control, example tab, bench arm or README row.
- `etc/package-files.txt` — `bun run manifest:update`: the Form sources and their nitrogen output
  are 81 added, 0 removed. A manifest refresh, not a decision — but it moved the code tree, and the
  stale-app guard then refused a run until the app was rebuilt, which is the guard working.
- `docs/tasks/S6-form-spike.report.md`, `docs/tasks/S6/` — this report, `real-input.md`, and the
  three screenshots at CONTRIBUTING's widths (804 px iOS, 720 px Android).

## Follow-ups

- Android: give the section header its own layer above the rows, or stop drawing it in the chrome
  host — as it stands `form-android.png` has two of three headers half-painted-over, and the fix
  that made rows tappable is what uncovered it.
- iOS: put the FormTouch case into `real-input:ios` (example screen + registry + Swift case) — the
  only way question 4's iOS taps and `pressGesture` ever get measured.
- D43: the Android `accessory` needs a chevron/check from
  `scripts/icons/fetch-material-symbols.mjs`; `FormListMetrics.TrailingPadding` already reserves
  the room, and iOS has `UICellAccessory` today, so the platforms differ until someone does it.
- G-Form: mint the row-box padding constant so 60 → 52 instead of sitting on an `8 > 8` bound, and
  read the card's corner radius from the cell background or drop the blind `radius` field.
- Question 5 is untested: `keyboardAvoidance` is wired, and nothing focused a `TextField`.
- Bench: question 6 still has no `@expo/ui` `Form` / `FieldGroup` arm, and `S6 COST` prints
  `<missing>` on Android because the section report has no `applies` field to name.
- Spike code stays on this branch (D19): no `ListItem` content leaf, no virtualized List.

## Questions for orchestrator

1. **How should question 4's iOS taps be closed?** (a) a second spike round to port the case into
   `real-input:ios` — an example screen, a `screens.mjs` entry, a Swift case, and `Form` rendering
   outside the harness bundle; (b) fold it into G-Form round 1, where that screen exists anyway.
   *Recommend (b)* — but do not brief G-Form as though the iOS press path had been measured; this
   round only proved the mechanism it replaces is broken.
2. **Do `Form`'s iOS rows ship unmeasurable?** `measure()` on a reparented row returns the Form's
   box. Accepted as documented (rows are addressed through their content, and G-Form aims nothing
   at a row's measured point), or does G-Form owe a pass that mirrors the cell's frame back into
   Yoga? *Recommend documenting it* and revisiting if a real control needs it.
3. **Row box 60 pt vs SwiftUI's 52 pt.** Match 52 now by minting the padding constant, or ship the
   prototype's 60 and let the bound move? *Recommend 52* — it is the only number in the fidelity
   table a reader would notice.
4. **Who draws an Android section header?** The prototype draws it as Compose text inside the same
   layer as the section shapes, and that layer has to sit under React Native's content or it eats
   every touch — so the header ends up half-painted-over, as `form-android.png` shows.
   Options: (a) a second Compose layer added above the rows, sized to the header band only;
   (b) the header as ordinary React Native content, which loses the one place the spike showed
   Compose text and Yoga metrics agreeing on a height; (c) keep it where it is and let the first row
   clip it. *Recommend (a)* — same measured height, nothing above the rows but the rows.

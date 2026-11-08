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

---

## Round 2 — S6b: the iOS taps, the keyboard and `measure`

<!-- S6b (docs/tasks/S6b-form-spike-ios.md). Every number is from the run named beside it. -->

**Branch:** `task/S6b-form-spike` (S6's prototype `a8a8da22` plus this round) · **Round:** S6b, 1 of 1 (D19) ·
**Lease:** `S6b-44a80` (pair-a — iOS `nitro-ui A` iPhone 17 / 27.0, Android `emulator-5574` API 35, Metro 8295) ·
**Devices:** lease only, Android by serial

### Verdict

**NO-GO**, on one item. The two things S6 could not ship without — real iOS taps in reparented cells,
and a `measure` that says where a row is — are measured and right. The keyboard item is now measured on
Android too, and it is red: a real tap focuses the note field, a full keyboard comes up, and the field
stays under it. That is one gap with a named fix, not a shape that does not work.

| # | Item | Result | Go line |
| --- | --- | --- | --- |
| 1 | iOS real taps in reparented cells | MET — 10/10 on every case, one read per tap | 10/10 each — met |
| 2 | Keyboard over a field near the bottom | iOS MET (field bottom 496 pt, keyboard top 590 pt). **Android MEASURED AND RED** — keyboard top 1399 px, field bottom 2301 px | visible on both — **not met** |
| 3 | `measure()` of a row on iOS | MET — right at rest and after a 180 pt scroll, on both platforms | right on 10/10 rows after a scroll — met |
| 4 | S6's two answers, applied | MET — 52 pt row box and a reserved header band, both fidelity gates green, screenshots retaken (one deviation, question 1) | met |

### What was wrong before anything could be measured

S6b's first pass had never been compiled and nothing in it had run on a device. Eight things were wrong on
the way in:

- Four of them were ordinary: `scrollOffsetDp()` dividing an `Int` by a `Float` and returning a `Double`
  (only `check`'s `test:native:android` compiles the library); an `override func setFrame(_:)` that is not an
  override, because UIKit imports `frame` as a property; E7 adding the scroll offset on the wrong side of the
  comparison; and the Android fidelity case reading `headerBand`/`footerText` out of the *Form's* report, where
  they have never existed. A fifth was `RealInputTests.swift` calling `meanLuminance` from a background closure
  without `self` — nothing in `check` or `build-app.mjs` builds the UI-test bundle, so `xcodebuild
  build-for-testing` first is what found it.
- **A cell never knew which Form it belonged to.** `formOwner` is the only back-reference a
  `UICollectionViewCell` has (UIKit gives it none) and was set only as a side effect of `rowResized` —
  which a row reaches *through* it. So every question a cell asks its Form was dropped, including the width
  the Form tells JS to lay a row out at. The Form's only report was its pre-layout fallback, the list's own
  box — the window's width, 402 pt on a 370 pt cell — so every row laid its right-aligned content 64 pt
  outside its cell, and UIKit stops hit-testing at the cell's edge. That is the whole of S6's 0-of-10
  `Switch`: not the press path, not the reparenting, a width. The witness is now in the report and the gate
  (`boxW`/`boxReports` against `width`) and printed the bug before it was fixed: `the Form lays rows out at
  0 pt and draws them at 338 pt (cell 370 pt, list 402 pt, 0 cell report(s))`.
- **The Android keyboard witnesses could not say "yes".** `imeShown()` passed the `adb` result *object* to
  `RegExp.test`, which coerces it, so it asked whether `"[object Object]"` contains `mInputShown=true` —
  false for a keyboard that is up (pre-existing, `3a13cee2`; it also made `hideKeyboard()` never press
  Back). And the keyboard's edge was read from `Window{… InputMethod}` in the window service, which is the
  whole floating IME layer: on the lease's API 35 AVD its `Frames: frame=` measured `[0,142][1080,2424]`
  *identically with GBoard up and dismissed*, so read as an edge it always says `top=142`. Round 2's first
  run therefore said the input view was *not* on screen and, from the same device, asserted
  `a full software keyboard … occupies 2282 px of a 2424 px window` — the real band is 1025 px — and then
  failed the field for sitting "below" a keyboard whose top it had placed at 142 px. Both are fixed: the edge is the service's own
  `Last computed insets` → `visibleTopInsets` (1399 px with GBoard up, its `touchableRegion`
  `SkRegion((0,1399,1080,2156))`) and is read **only** while `mInputShown=true`, because that line is the
  *last computed* one — with the keyboard down it still prints, `2156` with an empty region, which is
  exactly the stale value a band must not be built from. Control: the same AVD raises the same keyboard for
  the system's own search field, so the device and GBoard were never the question.

### 1. iOS real taps (question 4)

`Form` now renders outside the harness bundle (`example/src/FormScreen.tsx`, a `form` control in
`scripts/real-input/controls.mjs`, a `screens.mjs` entry, `RealInputTests.testRealInputForm`). Every claim
is **one tap, then one read** — ten taps read once at the end is also what two double-fires and eight drops
look like.

| Check | Witness | Result |
| --- | --- | --- |
| a row with `onPress`, ten taps | `form-row-presses` 1…10, one read per tap | 10/10 |
| a `Pressable` inside a row, ten taps | `form-inner-presses` 1…10 | 10/10 |
| a hosted `Switch` in a row, ten taps | `form-switch-changes` 1…10, `form-switch-value` flipping | 10/10 |
| a row with no `onPress`, ten taps | counters that must not move | 0 fires |
| a tap outside any row | `form-outside-presses` | 0 fires |
| the cell highlight under a held press | row luminance rest 0.9608 → held 0.8767, sampled 1.65 s into a 2.5 s press | darker while held |

**Met** — `real-input:ios --control form` PASS, `testRealInputForm` inside the run. The press path S6
invented survived unchanged: `allowsSelection = false` plus a `UILongPressGestureRecognizer`
(`minimumPressDuration: 0`, `cancelsTouchesInView = false`) on the cell. It needed nothing; the width did.

### 2. The keyboard (question 5)

**iOS — met.** The Form learns the keyboard's height from `keyboardWillChangeFrame` and puts it in its
report, so the case has a witness whether or not the simulator exposes a keyboard window; a correct
avoidance leaves the row above `listBottom − inset`, a line the field cannot reach by accident. Running it
found something the brief did not ask about: **a Form row is not in the accessibility tree until the list
draws it.** Every other `real-input` screen can `required(...)` an off-screen element; the note field was
not there at all until the list was swiped to it. And `hasKeyboardFocus` on the element the app named
answers `nil` for a hosted input, whose focused element is a `TextField` descendant — the dump said
`Keyboard Focused` while the case insisted nothing had focus. Neither is the Form; both had to be fixed to
measure it: `real-input form keyboard: field=(44.0, 468.0, 314.0, 28.0) keyboardTop=590.0 (from window)
inset=99.0 focused=yes` — field bottom 496 pt against a keyboard window top of 590 pt, the Form's UIKit
inset as the second witness.

**Android — measured, and it fails.** `real-input:android --control form` FAIL (724.2 s) on the final tree,
every tap check green, then:

```
✓ the IME says its input view is on screen
✓ a full software keyboard, not a toolbar: it occupies 1025 px of a 2424 px window
· field box 2238..2301 px, keyboard top 1399 px
✗ the focused field is still on screen above the keyboard (field bottom 2301, keyboard top 1399)
```

A real tap does focus the field (`✓ … saw yes`) and a full keyboard — not the hardware-keyboard toolbar,
1025 px of band — does come up. Nothing in between moves the field: the case prints its box twice, at
`105,2238 → 975,2301` before the tap and again with the keyboard up — identical, entirely inside the
keyboard's own `touchableRegion` (1399..2156) and the navigation bar below it. `HybridNitroUiForm.kt:139` reports `keyboard=rn`, and the file's header comment credits RN
with "keyboard scrolling for free". That freebie is what is missing: Android's scroll-to-focused-view only
knows a `ScrollView`'s *direct* children, and here the focused view is a hosted `EditText` deep inside the
one ComposeView the RN `ScrollView` sees, so nothing asks the list to move. The hosted list did not resize
out of the way either.

*What G-Form has to do:* own the IME inset the way iOS already does — observe
`WindowInsetsCompat.Type.ime()` in the Form's hosting view, add it as the list's bottom inset, and scroll
the focused row above it. The witness, the case and the red line are in `real-input` already, so this is a
build-round task with its own gate, not another spike. A consumer cannot work around it: the Form *is* the
scroller, so `KeyboardAwareScrollView` has nothing to wrap.

### 3. `measure()` on iOS (question 4's other half)

Read out of the installed 0.88.0 sources, not from memory. `measure`/`measureInWindow` are one shared C++
path (`UIManagerBinding.cpp:649`/`:689` → `DOM.cpp:527` → `computeRelativeLayoutMetrics`,
`LayoutableShadowNode.cpp:82`) which per ancestor does two things and nothing else: add the Yoga
`frame.origin` and the ancestor's `getContentOriginOffset(true)`. **No platform view, no scroll offset** —
which is why one row measured as the Form on iOS and as its layout on Android. RN's own `ScrollView` answers
it by overriding that one hook (`ScrollViewShadowNode.cpp:67`, fed from `scrollViewDidScroll`).

The fix shipped here corrects the shadow tree and only the shadow tree: the Form publishes where each row's
cell came to rest (`publishRowFrames`, driven by the scroll-settle delegate and `nuiTestScrollTo`), `Form.tsx`
writes it into the row's absolute `top`/`left`, and `NitroUiFormRowHostView` refuses to let UIKit obey it —
Fabric writes the component view from `layoutMetrics.frame` and the content view from `getContentFrame()` on
the next statement, and the host takes the origin back off the first. It is a *settle-time* answer: the list
moves cells every frame and JS cannot be told about each one.

E7 (`example/__tests__/Form.harness.tsx`) compares `measureInWindow` against what UIKit says, per row, at
rest and after a 180 pt scroll, bounded at 14 comparisons to fit the suite's 30 s budget: **6/6 PASS on iOS
(17.4 s) and Android (16.6 s)**, `scrolledBy 0` on both. The Android half is the interesting one: a
throwaway diagnostic showed that after a 180 dp scroll (`scroll=179.8`) the row measures
`0.0,-178.7,411.4,56.0` on Android and `0.0,-178.7,411.4,56.0` on iOS — identical, because the Android
Form's scroller *is* an RN `ScrollView`, whose shadow node already carries the offset. The published cell
frames are what iOS needs, and they cost the Android side nothing.

**The better shape for the shipped Form:** `scripts/patch-nitrogen.mjs` already repoints the
shadow-node/state/descriptor aliases for the views in `nitro-ui.sizing.json`, so the shipped Form can carry
a hand-written shadow node overriding `getContentOriginOffset()` to `-contentOffset`: one state update per
settle instead of one per row, right for every descendant rather than only rows that opted in, per-frame if
a consumer ever needs it. It deletes the `top`/`left` writes and the UIKit re-pin. Not in this round — this
path was already written, compiling and measured, and a second unmeasured rewrite was the wrong risk with no
device in sight. **Recommendation: G-Form ships the shadow-node version and keeps E7 as its gate.**

### 4. S6's two answers, applied

**Row box = SwiftUI's 52 pt.** `NitroUiFormRowCell.rowChrome` (4 pt) is the cell's whole vertical chrome;
the container is pinned `rowChrome` from each edge instead of the margins guide, which had been adding 8 pt
top and bottom. `ROW_BOX_BOUND_PT` went from 8 — the width of the bug, which is how it shipped — to 0.5, so
a chrome that drifts back is a red gate, not a pass.

**Android header band — a deviation from the answer as written.** The answer was "its own Compose layer
sized to the header band"; this round sized the *band* and left the text where it is: `onSizeChanged` moved
outside the header's padding so Yoga reserves the band and not the glyph box, and the fidelity case asserts
`headerBand − headerText ≥ 8` dp. A second composition per section is the cost the shared layer exists to
avoid (2.75× the mount memory, 1.39× the mount UI-thread CPU per op — `docs/components/host.md`), and rows
painted over the header because the *reservation* was short, not because of the layer's place in the
z-order. Question 1 puts the choice with the owner.

**Screenshots retaken:** `docs/tasks/S6b/form-prototype-ios.png` (804 px) and `docs/tasks/S6b/form-android.png`
(720 px), each the prototype mid-hold during its own `FormFidelity` run. Against S6's pair the difference is the
Android header band: `Connectivity`, `Sound` and `About` are whole, with their space below them, where S6's had
each header's lower half under the first row's card.

### What G-Form must know

- **A row that is not on screen has no view**, and `measure` is right only at rest: absent, not `null`-sized —
  no UIKit view, no accessibility element, nothing for `measure` or a Tooltip/ContextMenu anchor to read, and
  the published frames lag the list while it moves. A shipped Form needs a scroll-to/realise step, and anchors
  that re-read after the list settles.
- **The cell's back-reference to its Form is load-bearing** for chrome *and* geometry. It is set where the
  cell is configured, and the fidelity case refuses a Form whose reported width and drawn width disagree.
- **Android's keyboard avoidance is not free from RN** for a hosted input (above), and the Form cannot be
  wrapped out of it by a consumer.
- The Android press path from S6 (chrome host kept at index 0) is unchanged and now has a real-input run behind
  it. A header layer, if the owner insists, has to go *above* the rows — the one arrangement that cannot eat a
  touch.

### Red proofs

Each is `test -> mutation -> the line that went red`; `mutate.mjs` applied and reverted each, and the tree
went back to the reported commit every time.

- `harness:ios:FormFidelity` -> delete `cell.formOwner = self` (the cell's only back-reference to its Form)
  -> `question 4: the Form lays rows out at 0 pt and draws them at 338 pt (cell 370 pt, list 402 pt, 0 cell
  report(s))`.
- `harness:ios:FormFidelity` -> `rowChrome` 4 pt -> 8 pt (the chrome S6 shipped) -> `question 2: 3 field(s)
  out of bounds (1 pt container, 0.5 pt row box).`
- `harness:android:FormFidelity` -> size the header's *glyphs* instead of the band -> `expected 0 to be
  greater than or equal to 8` (the `headerBand − headerText ≥ 8` dp assertion in the case).
- `harness:ios:Form.harness` (E7) -> short-circuit `publishRowFrames()` so the shadow tree keeps rows at the
  section's origin -> `expected [ …(14) ] to deeply equal []` — all 14 comparisons wrong, not one.

The keyboard witness has no mutation run: what it guards is broken on the tree being reported, so it is red
in the reported run itself (`✗ the focused field is still on screen above the keyboard`), and its two
halves were shown to answer both ways on the lease's AVD — `imeShown() true / imeTopPx() 1399` with GBoard
up, `false / null` with it down, where the window record still reported a full-screen "keyboard". The
`imeFrameBottom` mutation S6b wrote for the old parser went with it.

### Gate table

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1882 tests / 76 suites | `75da3209ff58` | 2 m 47 s | start 3.5 / med 10.0 / max 20.8 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:android:Form.harness` | **PASS** | 6 tests / 1 suites | `75da3209ff58` (android tree) | 16.6 s | start 12.6 / med 11.4 / max 12.6 |
| `harness:android:FormFidelity` | **PASS** | 1 tests / 1 suites | `75da3209ff58` (android tree) | 19.1 s | start 10.8 / med 10.3 / max 10.8 |
| `harness:ios:Form.harness` | **PASS** | 6 tests / 1 suites | `75da3209ff58` (ios tree) | 17.4 s | start 13.2 / med 12.6 / max 13.2 |
| `harness:ios:FormFidelity` | **PASS** | 1 tests / 1 suites | `75da3209ff58` (ios tree) | 29.1 s | start 11.4 / med 10.8 / max 11.4 |
| `real-input:android:--control:form` | **FAIL** | — | `75da3209ff58` (android tree) | 11 m 57 s | start 6.3 / med 4.7 / max 9.6 |
| `real-input:ios:--control:form` | **PASS** | — | `75da3209ff58` (ios tree) | 12 m 50 s | start 9.2 / med 16.3 / max 132.9 |

Nothing under `need --for review` beyond the table: `real-input` and the Form harnesses ran filtered to the
Form (`--control form`, `Form.harness`, `FormFidelity`), and a filtered run satisfies nothing else — the
whole-suite runs belong to the merge, and this prototype is never merged. `real-input:android` is red by
design on this tree: it is item 2's answer. `docs/tasks/S6b/gates.jsonl` is the exported ledger and
`docs/tasks/S6b/failures/` an excerpt of every failed run on the branch — which includes the four deliberate
red proofs (`06-05-31`, `06-06-54`, `06-07-31`, `06-08-55`) and the `check` that stopped on prettier
(`06-09-20`) before the tree was final.

### Follow-ups (round 2)

- `imeShown()` being always false also made `hideKeyboard()` a no-op, so every `real-input` case that ended
  with one left the keyboard up. Now fixed, the TextField/SearchField runs are the ones whose timing moves;
  whoever owns G13 should re-run them.
- The IME parsing lives inside `DeviceHarness`, so proving it needs a device. A pure exported parser with a
  unit-testable signature would put the keyboard witness's own tests under `check`.
- In the Android screenshot the first section's *footer* text paints behind the first row's card: the band
  reservation the gate asserts is right, the footer's paint position is not. Not item 4's answer, so not
  touched here.
- `nuiTestFormReport()` is polled by an example screen for the keyboard inset. A shipped Form should publish
  the inset as a prop or an event rather than have a screen read a test method on a timer.
- `radius` is still `0.00` on both sides of the fidelity table — a blind probe S6 left, out of scope here.
- Fidelity still runs in one appearance at the default text size; the brief's three were out of scope for S6
  and still are.
- Neither `check` nor `build-app.mjs` compiles the UI-test bundle, so a broken `real-input` Swift case is
  found only after a device is leased. A `build-for-testing` step in `check`, or behind
  `build-app.mjs --tests`, would move it off the device.
- `pressOnce` names every missing element "the uncontrolled Switch" (a borrowed description from the helper
  it grew out of).
- `real-input:ios` died once in 1.6 s with `Error: setTypeOfService EINVAL` from undici inside Node 24
  (`node:net:975`, on a fetch to Metro). Re-ran and it went; recorded because it will be misread as a
  harness bug.

### Questions for orchestrator (round 2)

1. **Does the Android keyboard gap block the brief, or belong to the build?** It is the only red go-line, and
   the fix is a build-round task with a gate that already exists. *Recommend* briefing it as G-Form's first
   item and treating S6b as answered, rather than spending a spike round on it.
2. **The Android header: take the deviation, or make G-Form pay for a layer?** The answer was "its own Compose
   layer sized to the band"; this round sized the band instead, so the text stays in the section's shared
   composition and Yoga reserves the whole band — same visible result, no second composition per section.
   *Recommend accepting it*, with the caveat that it puts the header *under* the rows: correct only while the
   reservation is exact, which is what the fidelity assertion says. If the header must never be coverable, the
   layer goes above the rows.
3. **Which `measure` fix ships: the shadow node or the per-row publish?** *Recommend* the shadow node at
   G-Form time (the seam already exists), with E7 as the gate that stays green — no re-spike.
4. **Is a settle-time `measure` good enough?** The alternative is a per-frame publish (a JS round trip per
   scroll frame), which no anchor needs. *Recommend* settle-time, written into the docs as a limit.
5. **Do shipped rows need to exist while off screen?** This round proved they do not. If Tooltip/Popover/
   ContextMenu anchors must work on any row, the answer is a scroll-to step or a non-virtualized mode — a design
   decision, not a bug.

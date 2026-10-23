# G2 — Button · review (D19: the one full review)

Branch `task/G2-button` @ `83c612d`, from `e9e2448`. I reviewed `git diff e9e2448..HEAD` against
the brief, AGENTS.md, D7/D14–D19, `core.md`, `sizing.md`, `button.md` and the four screenshots.
No simulator or emulator was used. Native findings come from reading the code paths.

## Verdict: **MERGE-AFTER-SMALL-FIXES**

The component is well built. Setters store and mark dirty, there is one commit per update, the
host is never recreated, the recycle reset is complete, the colour and typography caches are sound,
the variant mapping is idiomatic, and the tests are mostly real. Before merge it needs one real
sizing bug fixed, a few report claims corrected, and the bench dimension rebuilt in main's shape.
Fix 1 changes native code, so D19 calls for a re-review after the fix round.

## Gate

`bun run check`: **green** on `83c612d`. That covers typecheck, bench typecheck, lint, format,
116/116 jest, native ASan, `perf:renders` (Button 6/6, Switch 6/6), nitrogen drift, autolinking,
build, api-extractor, publint and the manifest. The tree was still clean afterwards.

## Findings that must be fixed

### F1 — correctness (R3, both platforms): a config change whose new size matches the old one never reports, so the box stays at the fallback

When a prop change moves an instance to a configuration that is not cached and has no guess, the
engine lays it out at the **declared fallback**. A state entry from the old key does not count
(`cpp/NitroUiSizingEngine.cpp:345-360`). Only a report can correct that box. But both hosts skip a
report that is within 0.5 of the *last reported size*:

- iOS: `ios/core/NitroSwiftUIHost.swift:373-378`
- Android: `android/.../core/NitroComposeHost.kt:480-486`

That dedupe is never reset on a key change, only in `releaseSizingInstance()` and Android's
`onConfigurationChanged`. So whenever the new configuration measures the same size as the old one,
the host measures (the bounds moved to the fallback), the report is swallowed, and the instance
stays at `77×35` pt / `91×48` dp with the real control centred inside it. It stays there until
another instance with the same key happens to report.

Deterministic repros:

- **iOS:** change `variant` from `filled` to `elevated` at runtime. Both are `.borderedProminent`
  (`HybridNitroUiButton.swift:91`, `:113`), so the size is identical and the key is new.
- **Android:** set or change `systemImage` at runtime. It is in the key but not rendered
  (`HybridNitroUiButton.kt:566-574`). Changing `filled` to `tonal` or `elevated` also works, since
  they have the same padding and minimums.
- Title changes that keep the width also hit it, e.g. Roboto's tabular digits (`"Item 1"` to
  `"Item 2"`).

No current test changes a config while keeping its size.

**Fix:**

- Reset the dedupe whenever the sizing key changes. In each platform's `nuiSizingKey` setter
  (`HybridNitroUiButton.swift:341-344`, `HybridNitroUiButton.kt:612-618`), call a small host hook
  that clears `lastReportedSize`. On iOS that hook also sets the may-have-changed flag.
  Alternatively, iOS can clear it inside `noteContentSizeMayHaveChanged()`, but Android still
  needs its own hook.
- Add one harness test, shown red before the fix:
  - mount `filled` "Save";
  - rerender as `elevated` (iOS) or with `systemImage="star"` (Android);
  - assert box ≈ `measureContent()` after a settle, and ≥ 1 correction.

### F2 — false claim (bench): the iOS `update mounted` 3.10–3.45× is not a first-frame fallback → correction round-trip

`bench/src/runner.ts:253-284` runs 5 warmups before measuring. The `mount` cell keeps `value`
constant and `update` toggles `'Save'`/`'Saved'` (`shared.ts`, `buttonTitle`). The sizing cache is
process-global and outlives the mounts. So every **measured** iteration hits an exact cache entry
and makes **zero corrections**.

The likelier cost is the per-instance synchronous measure:

- On update, each of the 50 buttons runs `layoutIfNeeded` + `sizeThatFits` in `commit()`
  (that is what `noteContentSizeMayHaveChanged` buys).
- Then a second `sizeThatFits` runs from `layoutSubviews`, because the bounds moved
  (`NitroSwiftUIHost.swift:165-172`).
- On mount, the measure in `didMoveToWindow` costs the same way.

Neither T14 nor `prewarmKeys` removes any of this.

**Fix (doc only):**

- Rewrite `G2-button.report.md:242-249`.
- Drop or reword the follow-up at `:300-303` ("this is where the 3.1–3.45× should go").
- State the mechanism as a hypothesis unless it is measured, e.g. with a `sizingStats()` delta per
  launch.

### F3 — over-claim (bench): "mount presented: met" comes from a column the bench docs call a broken probe

The iOS nitro-ui mount cell has `presentedBeforeMount = 11/80` (`report.md:277-281`).
`docs/architecture/benchmarks.md:191-193` says a column with non-zero counters "is a broken probe,
not a regression". The runner still printed PASS, because no samples were dropped. Even so, the
headline at `report.md:169`, `:208-209` and `:214-216` cannot treat 0.49× as a met target.

**Fix (doc only):** label the cell "runner PASS, probe-suspect (`presentedBeforeMount` ≠ 0)" and
say D15 is not demonstrably met on any gate metric. The overall verdict at `:229`, "does not meet
D15", is correct and stays.

### F4 — false/stale claims in the docs (small)

- `report.md:89` says "short → long → short, each frame equal to the new fitting size". The test
  polls until the box *eventually* matches. Frame-exactness is only implied for the warm half,
  through `warm.corrections == 0` (`Button.harness.tsx:544`). Reword to say exactly that.
- `button.md:148-152` says Android "is never stale for a prop change" and iOS has none for a prop
  change. That is false while F1 stands, and it is untested for cold changes. After F1, restate it
  per D17: a cold configuration may show the fallback for one frame; a warm one shows none.
- Stale line refs. `button.md:109` points at `Button.tsx:136`, but the key is built at `:126-133`
  and `:215`. `button.md:160` points at `Button.tsx:150`, but the base style is at `:146`.

### F5 — merge with main: the bench `--component` dimension conflicts by design, not just by text

Main (G1, Slider) encodes the component in the **scenario**:

- `mount.slider`, with `componentOf` / `scenarioFor` in `lib.mjs`;
- `ComponentName` and `BenchListProps.component` in `types.ts`;
- `splitScenario` in `plan.ts`;
- `--component` filtering cells, with `null` meaning all.

G2 encodes it in the **implementation name** instead:

- arms named `*-button`;
- `COMPONENTS`, `controlImplementation` and `isControlImplementation` (`lib.mjs:70-116`);
- `--component` choosing an arm set, defaulting to `switch`.

`git merge-tree main HEAD` reports textual conflicts in:

- `scripts/bench/run.mjs` (both `--component` parsers);
- `bench/src/implementations/nitroUi.tsx`;
- `bench/baselines/renders.json`;
- `example/src/App.tsx` (both added tabs);
- `scripts/smoke/App.tsx`, `src/__tests__/viewConfigs.test.ts`;
- `nitro.json`, `nitro-ui.sizing.json`, `NitroUiPackage.kt`, `etc/package-files.txt`;
- all generated nitrogen autolinking/bridge files.

`lib.mjs`, `plan.ts` and `types.ts` **auto-merge** into a tree that has both mechanisms. Do not
take that result. **Resolve by porting Button onto main's shape:**

1. Add `'button'` to `ComponentName`, `SUFFIXED_COMPONENTS` and the `ScenarioName` template.
2. Add `mount.button`, `update.button` and `memory.button` to `PLANS.quick`, plus the full-plan
   cells.
3. Make the four existing arms dispatch on `component` (`rnCore.tsx` → `RnCoreButtonList`, and so
   on).
4. Delete the `-button` implementation names, `COMPONENTS`, `controlImplementation` and
   `isControlImplementation`.
5. Port the 5 new `bench-gate.test.js` tests to the scenario form.
6. Regenerate nitrogen, the API report and the manifest.

Then `bun run check`. The report's numbers can stay, marked "measured on the pre-merge harness, same
arms". No re-run is needed for merge.

Main's shared-core changes need nothing from G2:

- `NitroUiControlledValue.unreported` (`ios/core/NitroUiModel.swift`);
- the `fillWidth` proposal and gate in `NitroSwiftUIHost.swift`;
- `sameSizeForPush` in the engine.

Button doesn't touch `ios/core`, `android/.../core` or `cpp`. It uses no `NitroUiControlledValue`,
and the `intrinsic` paths are byte-for-byte unchanged. So there is no textual or semantic conflict
there. F1's host fix will be the first G2 edit in `ios/core`/`android/core`, so it should go on top
of main's `NitroSwiftUIHost.swift`.

## Checked and fine (no action)

**Sizing key and notify**

- `variant|size|systemImage|title` with all four setters calling
  `noteContentSizeMayHaveChanged()` (`HybridNitroUiButton.swift:234-305`) is correct.
- Android rightly needs no notify.
- `disabled` and `tint` are not in the key, which is right.

**The notify test can fail**

- `Button.harness.tsx:633-700` seeds the new key with the current box, so no bounds change and no
  `layoutSubviews` happen. Only the setter's notify can make `commit()` measure. That matches the
  report's red proof.
- Spot-check 2: `:702-749` collapses to a single cached width when `title` is dropped from the key,
  as reported.

**Events (iOS code path)**

- `Button(action:)` → `model.onPress?()` is read at tap time, and `.disabled` is native.
- `RCTSurfaceTouchHandler` uses `cancelsTouchesInView = NO`, `canPreventGestureRecognizer → NO`,
  and lets descendant recognizers win (`RCTSurfaceTouchHandler.mm:156-158`, `:381-409`). RN does
  not cancel the hosted button's touches, and an RN `ScrollView` pan cancels them the normal UIKit
  way.
- No `.allowsHitTesting`/`contentShape` problem, apart from the follow-up below.
- The Android press test uses real synthetic taps with a barrier.
- Pressed, hover and focus states belong to the native controls on both platforms.

**Perf**

- `ButtonColorsCache` and `ButtonLabelStyles` are keyed on scheme/typography identity.
- Dark mode and configuration changes produce a new scheme identity (`NitroUiColorSchemes.forContext`
  keys on `dark`/`uiMode`, and is invalidated in `onConfigurationChanged`), and `adopt()` then
  clears the cache.
- They hold only colour longs and `TextStyle`s, with no `Context`, so nothing leaks. They are
  synchronized, and tinted entries are capped at 24.
- `Typography` is M3's static default, so it has one identity.
- No hosting recreation. `afterUpdate` → one `commit()`.

**Variant mapping**

- iOS: `.borderedProminent` / `.bordered` / `.bordered`+capsule stroke / `.borderless`.
- Android: the five M3 composables with Material's own colours.
- Both are idiomatic and match the `button.md` table and the screenshots in light and dark.
- `filled` and `elevated` being identical on iOS is documented.

**Fallback**

- One measured fallback per component (iOS `77×35`, Android `91×48`) is the right call while the
  engine keys fallbacks by component. Height is the part that matters, and widths depend on the
  title and can't be known up front.

**Bench verdict**

- `(nv)` and verdict handling follow the runner rules. Busy load suppresses only baseline minting,
  not verdicts (`benchmarks.md:268-277`).
- The final "does not meet D15" is honest. Only F2 and F3 need correcting.

## Follow-ups (one line each, for `docs/tasks/FOLLOWUPS.md`)

- Sizing key: two free-form fields can collide (`systemImage="a|b",title="c"` vs `"a"`,`"b|c"`). It
  needs an invalid symbol containing `|`, but length-prefixing would close it (`Button.tsx:132`).
- iOS: two `sizeThatFits` per size-affecting change (in `commit()`, and again in `layoutSubviews`
  after the bounds move). For `intrinsic`, a bounds change doesn't need a re-measure
  (`NitroSwiftUIHost.swift:165-172`).
- Android: `PaddingValues` is allocated per recomposition for small/large, and `Modifier.heightIn`
  and `Modifier.semantics` likewise (`HybridNitroUiButton.kt:326-339`, `:364-370`). Hoist them to
  constants.
- Android: `onClick` captures `model.onPress` at composition time (`.kt:360`, `:386`). Read it at
  click time, as iOS does.
- iOS `outlined`: the overlay `Capsule().strokeBorder` takes hits on its 1 pt ring. Add
  `.allowsHitTesting(false)` (`.swift:102-105`).
- The first Button of a process lays out at 0×0, not at the declared fallback (it is declared in
  `init`, after the first measure). `.swift:184-186` and `.kt:464-465` say otherwise. T14 fixes the
  behaviour, so update the comments then.
- The "keeps a caller width in charge and truncates the label" test asserts only the width, not the
  truncation (`Button.harness.tsx:813-830`).
- The iOS press path is still asserted at the callback only. T15 owns the real-input check.
- Re-measure the iOS `mounted`/UI CPU gap with `sizingStats()` deltas per launch to confirm F2's
  mechanism.
- Per-(variant,size) fallbacks once T14 or `prewarmKeys` land.

## Fix round 1 verification

Tip `4b1cabf`. I read `449524f` (F1), `4b1cabf` (docs), `c186e3c` (merge resolution only) and
`fbafb2d` (manifest). No devices were used. The harness claims (iOS 70/70, Android 70/70, and the
red/literal/no-token runs) agree with the implementer's `/tmp/G2r1-*.log` files, and the four
native files in `/tmp/G2r1-final-shape/` are byte-identical to the tip.

### Verdict: **MERGE-AFTER-SMALL-FIXES** (doc only, so per D19 no re-review is needed)

1. `G2-button.report.md:482` (the Bench row in "Gates on the final tip") is false. It says
   "F1 changes the report path only for a key the engine cannot answer, and no bench cell changes
   a configuration mid-iteration". But `update.button` toggles `title` between `'Save'` and
   `'Saved'` (`shared.ts:136`), and `title` is in the key, so every measured update is a key change
   that moves the box. The armed reset fires on **warm** key changes too, whenever the box moves.
   On every update, each instance then sends one more report that the dedupe would otherwise have
   skipped. On iOS that is one extra engine call. On Android it is one extra JNI report plus a
   `scheduleSizingFlush()` (a pre-draw listener and `postInvalidateOnAnimation()`). The engine
   drops the report, so no correction results. Fix: reword the row to say this, and say the
   `update.button` numbers predate it.
2. `G2-button.report.md:439` says iOS clears `sizingKeyChangePending` in `prepareForRecycle()`.
   The code clears it in `drop()` (`NitroSwiftUIHost.swift:337`). The behaviour is right, because
   the generated `.mm` runs `notifyOnDropView` before every `prepareForRecycle`. Fix: correct the
   sentence.

### F1: correct on both platforms

- **iOS.** The setter arms the flag. `commit()` measures, and for a same-size change the dedupe
  correctly skips that report. The engine then lays the new key out at the fallback, which moves
  the bounds. In `layoutSubviews`, the bounds-change branch consumes the flag, clears
  `lastReportedSize`, and runs the measure that `contentSizeNeedsMeasure` already requested. The
  report then goes out and the box is corrected.
- **Android.** `onLayout(changed)` resets the dedupe and bumps `remeasureToken`, which marks the
  measure block dirty. The next measure is unbounded for `intrinsic`, so it reports the real size
  even inside the fallback box. That rules out the warm prop-time report the literal fix produced,
  and `literal-android.log` (`expected 4 to be +0` ×2) supports the reason given for deviating.
- **Hot path (Switch, Slider): no extra work.** Only `HybridNitroUiButton` calls
  `noteSizingKeyChanged()`, on both platforms, so for other controls the flag never arms and the
  token is never written. Reading a state that is never written invalidates nothing. What remains
  is one snapshot-read observation per measure, which is negligible. `IntState` is the same object
  across recompositions, so the new parameter of `NitroUiMeasuredRoot` adds no recomposition.
- **Recycle and drop.** On Android the flag is cleared in `prepareForRecycle()`; `drop()` disposes
  the composition, and a dropped host is either dead or recycled next. On iOS it is cleared in
  `drop()`, which always runs first. `releaseSizingInstance()` clears `lastReportedSize` on both
  platforms. The `contentSize == nil` guard keeps a fresh or recycled mount from arming.
- **No stuck state at the fallback.** A key change whose box does not move leaves the flag armed
  until the next bounds change (iOS) or the next size or position change (Android). The cost is
  one later report that the engine drops. For the fallback to be stuck, the box must have moved,
  and any move consumes the flag. One edge case: the old size equals the fallback exactly. Then
  nothing moves, the box is already right, and the only loss is that this instance does not seed
  the new key's cache entry.

### F5: merge resolution is right

- Button uses main's scenario encoding: `mount.button`, `update.button` and `memory.button` in
  `quick`, plus the full-plan cells and `leak.button`. `'button'` is in `ComponentName` and in the
  `ScenarioName` template.
- The four arms dispatch on `component`. `git grep` finds no `controlImplementation`,
  `isControlImplementation`, `COMPONENTS` or `-button` arm names outside docs and the untracked
  results.
- All 5 gate tests are ported to the scenario form (`bench-gate.test.js:915-1045`).
- `NitroUiDeclaredFallbacks.registerAll()` registers `HybridNitroUiButton.declareFallback()` on
  both platforms with the right per-OS numbers: iOS `77×35` pt and Android `91×48` dp, both
  `intrinsic` and both named `"NitroUiButton"`. `init` stays as the backstop, the Android
  `AtomicBoolean` and the Swift lazy static make the call idempotent, and the stale "0×0 first
  Button" comments are gone.
- `nitro-ui.sizing.json` has all three components.
- **Manifest (`fbafb2d`):** `etc/package-files.txt` is a strict superset of main's. Nothing of
  main's is missing, and every extra line is a Button source or a generated Button output.
- Against main, G2 touches `ios/core`, `android/.../core` and `cpp` only for F1 and the
  registration line.

### F2–F4: done and true

- **F2:** rewritten as a hypothesis, with a `sizingStats()` follow-up, and the "this is where
  3.1–3.45× goes" claim is gone.
- **F3:** the three cells are labelled `probe-suspect`, and the report says "no gate metric is
  demonstrably met".
- **F4:** the title row is reworded and `button.md` is restated per configuration. The line refs
  `Button.tsx:126-133`, `:215` and `:146` match the source.

### Gate

`bun run check` on `4b1cabf`: **exit 0**. That includes 117/117 jest (33 `bench-gate`), native
plus ASan, `perf:renders`, no nitrogen drift and the manifest (251 files). The tree was clean
afterwards.

### FIX2 (iOS controlled Switch at 0 width after a `value` update)

- **No conflict.** G2's iOS change only acts when the flag is armed, and only Button arms it.
  Switch's behaviour is unchanged.
- **Related family.** Both problems are a box that disagrees with the control while the host stays
  silent. A Switch box at width 0 fails `layoutSubviews`' `bounds.width > 0` guard, so it never
  re-measures, and the same-size dedupe would swallow a repeat report anyway.
- **Textual overlap only.** If FIX2 resets `lastReportedSize` or reports again whenever the box
  diverges, it edits the same `layoutSubviews` branch, and a general rule like that could replace
  G2's key-change flag. Whichever lands second should rebase on the other.

### Follow-ups (one line each)

- `G2-button.report.md:262` cites `NitroSwiftUIHost.swift:165-172`, which is now `:166-181`.
- Android: a warm key change that moves the box costs one redundant report and flush schedule per
  instance. Could skip when the new box already equals the last report.
- Android `HybridNitroUiButton.kt` fallback KDoc says "five-letter title" but measured "Cancel"
  (six), and says `nitroui_t02`, while the iOS comment says six-letter.

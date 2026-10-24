# G4 — SegmentedControl · review (D19: the one full review)

Branch `task/G4-segmented-control` @ `415afb3`, from `340e521`. I reviewed `git diff 340e521..415afb3`
(9 commits, 70 files) against the brief, AGENTS.md, D7/D14–D21, `core.md`, `sizing.md`, the Switch,
Slider and Button implementations, the G1/G2 reviews and the four screenshots. No simulator or
emulator was used. Native findings come from reading the code, plus what the committed screenshots
show.

## Verdict: **MERGE-AFTER-SMALL-FIXES**

The component is solid where the earlier tasks went wrong:

- The handshake matches Switch exactly.
- The clamp runs in `afterUpdate()` on both platforms and uses the same rule on both.
- The sizing key is injective.
- Both size hooks are wired, and the fallbacks are registered at startup.
- The recycle reset is complete, and the M3 colours are cached.
- No host is recreated.

What it needs before merge:

- Two platform behaviours are documented as the opposite of what the shipped screenshots show: the
  iOS tint and Android truncation.
- One merge conflict, in `support.mjs`.
- A set of report claims that are false or overstated.
- The missing red runs for the tests that guard the iOS re-measure and the snap-back.

**No must-fix below requires a native change** if the recommended doc-only route is taken for F1
and F2. Under D19 that fix round would then merge on green gates with no re-review. If the
orchestrator chooses the native route for F1 or F2, that triggers a re-review.

Note for the orchestrator: main has **not** "gained FIX2 since" this branch. FIX2 (`9c29c90`) is an
ancestor of the base `340e521`, and G4 already contains D20 and `requiresFreshMeasure`. Since the
base, main has gained only R1 (D21 timing gate, Metro-log fix, Node check) and docs. No native or
sizing-engine files changed.

## Gate

`bun run check` on `415afb3`: **exit 0**. That covers:

- typecheck, bench typecheck ×2, eslint, prettier;
- jest 131/131 in 9 suites;
- `test:native` under ASan (262 checks);
- `perf:renders` (SegmentedControl 6/6, no redundant renders);
- nitrogen drift (none), autolinking, `bob build`, api-extractor, publint, manifest (294 files).

The one eslint **warning** is new from this branch: `no-shadow` at `example/__tests__/SegmentedControl.harness.tsx:915`.
The worktree was clean afterwards.

## Findings that must be fixed

### F1 — false claim (iOS): `tintColor` has no visible effect, but the docs say it paints the selected segment

- **Where:**
  - `ios/components/SegmentedControl/HybridNitroUiSegmentedControl.swift:99` and `:124-135` apply
    `.tint(Color(color))` to the segmented `Picker`.
  - `docs/components/segmented-control.md:33`, `:50-51` and `:225-228` all say the tint paints the
    selected segment.
  - So do the JSDoc at `src/components/SegmentedControl/SegmentedControl.tsx:63-67` and
    `SegmentedControl.nitro.ts:57-61`, and the report's Decisions section.
- **Failure:** the example's "Tinted" row uses `tintColor="#FF5733"` (`example/src/SegmentedControlScreen.tsx:249-251`).
  In `docs/tasks/G4-segmented-control/ios-light.png` and `ios-dark.png` it is pixel-for-pixel the
  same style as the untinted rows: a white or grey selected capsule, with no orange anywhere.
  - A SwiftUI segmented `Picker` (backed by `UISegmentedControl`) ignores `.tint` / `.accentColor`.
  - The only per-control knob is `UISegmentedControl.selectedSegmentTintColor`, and SwiftUI does
    not expose it. `UISegmentedControl.appearance()` would change it process-wide.
  - The harness's `reads back what React sent` only reads the prop value back, so nothing on device
    can catch this.
- **Fix (doc-only, recommended):**
  - State that `tintColor` has no effect on iOS (SwiftUI segmented `Picker` ignores `.tint`).
  - Update the API table, the platform-mapping row, Limits, both JSDoc blocks, the regenerated
    `etc/react-native-nitro-ui.api.md` if the JSDoc moves, and the report's "one role per platform"
    decision.
  - Keep the modifier, or drop it. Either way it must not be described as working.
  - Add a follow-up: per-instance iOS segmented tint (UIKit introspection, or a custom segmented
    style).
- **Native alternative:** reaching the hosted `UISegmentedControl` is a hack and is not recommended
  for 0.1. It would trigger a re-review.

### F2 — false claim (Android): a row wider than its box is clipped at both ends, not truncated

- **Where:**
  - `docs/components/segmented-control.md:164-166`: "a `width` narrower than the labels truncates
    them (one line, tail) instead of painting outside".
  - The test name `keeps a caller width in charge and truncates the labels`
    (`SegmentedControl.harness.tsx:726-743`), which asserts only `box.width == 140`.
  - The report's test table ("labels truncate").
- **Mechanism:**
  - For `intrinsic` components, Android measures the content with `Constraints()` (unbounded) and
    places it centred in Yoga's box (`android/.../core/NitroComposeHost.kt:801-848`).
  - The engine clamps the box to the parent's available width (`cpp/NitroUiIntrinsic.hpp:212`,
    `layoutConstraints.clamp(size)`).
  - So the M3 row never sees a narrower constraint. The `maxLines = 1, overflow = Ellipsis` at
    `HybridNitroUiSegmentedControl.kt:340` never triggers. The row is drawn at its natural width,
    centred, and both ends are cut off.
  - The parts of the outer segments that fall outside the box are clipped and cannot be tapped.
- **Concrete failure, in the task's own screenshots:** the "Uncontrolled" row
  `['Small','Medium','Large','Extra large']` (`SegmentedControlScreen.tsx:229`) in `android-light.png`
  and `android-dark.png`.
  - The row is about 396 dp wide. Its box is about 379 dp (411 dp screen minus the padding).
  - Both rounded end caps are cut off, about 9 dp at each end.
  - The timer set `['Yes','No','Maybe','Ask again later']` (`:40`) is far worse with equal shares,
    roughly 4 × 145 dp.
  - The harness author hit the same thing: `SegmentedControl.harness.tsx:313-316` records
    "417.14 dp on Android against a 411.43 dp screen, and Yoga clamped the box". The fixture was
    then changed instead of the claim.
  - iOS is fine here, because the hosting view proposes the box to SwiftUI and the `Picker`
    compresses its segments.
  - The same host behaviour applies to Button, which makes the same claim (G2 listed it as
    non-blocking). For a segmented row it is common rather than an edge case, because four or more
    labels on a phone routinely exceed the width.
- **Fix (doc + test, recommended for this round):**
  - Correct `segmented-control.md` Sizing and Limits. On Android, a box narrower than the row clips
    it centred, and callers must keep option lists within the available width. iOS truncates.
  - Rename the harness test to what it asserts ("keeps a caller width in charge").
  - Shorten the example's "Extra large" and "Ask again later" sets so the screenshots stop showing
    the defect as normal, or caption the row as the limit.
  - Correct the report's test table.
  - Add a FOLLOWUPS item. Core host: record the intrinsic size via `maxIntrinsicWidth/Height`, which
    is not a second `measure()`, and measure for placement with the box's bounded constraints, so
    that `intrinsic` content truncates inside a smaller box. This is a shared `NitroUiMeasuredRoot`
    change, and it affects Switch and Button.
- **Native alternative:** do that host change now. It is core code, needs every harness suite on
  both platforms, and triggers a re-review. I recommend the follow-up instead.

### F3 — merge conflict: `scripts/real-input/support.mjs`. Take main's version and drop G4's

- **The conflict:** `git merge-tree 340e521 2779668 415afb3` gives **one** textual conflict, in
  `ensureMetro()` (`support.mjs:~95-115`). `android.mjs` and `ios.mjs` merge cleanly.
- **Main's version is the right one.** R1 (`eb59576`) fixed the same bug by giving Metro a raw fd
  and appending the exit line with `appendFileSync`.
- **G4's fix (`dcc0397`) still has a race.** It uses `pipe(out, { end: false })` and then
  `out.write()` + `out.end()` in the child's `'exit'` handler. Node fires `'exit'` before the
  child's stdio streams are guaranteed to be drained. Any Metro output still buffered after
  `out.end()` is then piped into an ended stream. That raises the same unhandled `'error'`
  (`ERR_STREAM_WRITE_AFTER_END`), and Node exits 1 after a pass. The window is narrower, but it is
  the same failure mode.
- **Other suites:** G4's version also uses one shared stream for both pipes, which is the exact
  pattern R1 removed. Keeping G4's hunk would revert R1's fix for the Switch, Slider and Button
  checks.
- **Fix:** resolve to main's `support.mjs` verbatim. Re-run `test:real-input:{ios,android} --control segmented-control`
  once after the merge. Correct the report section "Fix round 1" (see the claims below).

### F4 — required red runs are missing (AGENTS.md "Every new test or gate must be shown to fail")

The report shows red runs for only **2 of the 14** harness tests: native clamp and
`noteSizingKeyChanged`. Two of the unproven tests make explicit "this fails without X" claims:

- **iOS re-measure (R3, the brief's core requirement).** `corrects a planted size that matches the current box`
  (`harness.tsx:1023-1089`) says it "is what this test fails without (iOS)" for
  `host.noteContentSizeMayHaveChanged()` (`HybridNitroUiSegmentedControl.swift:235`). That was
  never shown.
  - Required: delete that call and run the iOS suite. The planted-size test (and probably
    `re-measures when the options change`) must go red.
- **Snap-back.** `snaps back a selection React does not accept` was never shown red.
  - Required: make `reconcile()`'s result unused in `afterUpdate()` on one platform, or skip the
    reconcile entirely. Then show `['rejected:1','rejected:1']` failing.
- These are test-only runs (revert the mutation afterwards). No code change ships.
- Correct two test comments that claim more than the tests do:
  - `clamps an index written straight to native` (`:601-640`) exercises the `selectedIndex`
    **getter's** clamp (`.swift:244`, `.kt:449`), not the `afterUpdate()` clamp. With the
    `afterUpdate()` clamps (`.swift:359-362`, `:379-383`; `.kt:575-580`, `:599-604`) removed, all
    14 tests stay green. The shrink test cannot see them either, because the JS wrapper already
    sends the clamped index. The only path that is purely native, an *uncontrolled* selection under
    a shrinking `options`, is untested. Say so in the report and add a follow-up. A new test is not
    required this round.
  - `survives remounts` (`:985-1020`) says "a model that is not reset would also show up as a wrong
    selection". It only reads the controlled `selectedIndex`, which is `null`. Reword it.

## Report claims that need correcting (doc-only)

1. **Merge note.** The note "main moved from `340e521` to `e99e237` … FIX2 round 2 work on
   `ios/core/NitroSwiftUIHost.mm`" (Known issues, F5) is false.
   - There is no commit `e99e237` in the repository, and no file `NitroSwiftUIHost.mm` (the host is
     `.swift`).
   - FIX2 is already in the base.
   - Replace this with: main gained R1 only. Re-run the suite after merging because of R1's harness
     config and the `support.mjs` resolution, not because of a host change.
2. **"Fix round 1 (1 of the 2 D19 allows)".** This happened inside the implementation round, not as
   a D19 fix round. Relabel it, so the task still has two fix rounds.
   - Also, "which is why T15 never saw it" is contradicted by base `docs/tasks/FOLLOWUPS.md:21`,
     which already records this crash from T15b.
   - "support.mjs is untouched by this branch's commits" is true only for the commits before
     `dcc0397`.
3. **"giving each control its own host … costs 1.83× the memory and 2.56× the mount UI CPU that nitro-ui pays".**
   Those are per-control ÷ **rn-core** (memory 462.3/253.4, UI CPU 44.38/17.25). Measured against
   nitro-ui they are **1.48×** memory and **1.83×** UI CPU.
4. **"Everything is well below `expo-ui-host-per-control` … met on both platforms."**
   - On iOS, only memory (0.66×) carries a verdict. Mount presented and UI CPU against per-control
     are `(nv)`, by the report's own labels.
   - The quoted 0.95× is Android `mounted`, which is not a gate metric and is not "well below".
   - Restate it as: met on Android for all three gate metrics; on iOS, memory only.
5. **The `update` cells are not like-for-like, and they are not what the brief asked for.**
   - The brief asks for "update K selection changes". The bench `update.segmented-control` flips
     `options` with a constant `SEGMENTED_SELECTION` (`bench/src/implementations/shared.ts`). That
     is a defensible choice (it prices a re-measure), but the report must name it as a deviation.
     A selection-update cell becomes a follow-up.
   - Both `expo-ui` arms key their children by **label** (`<Text key={label}>`,
     `<SegmentedButton key={label}>`), so every flip unmounts and remounts three children there,
     while nitro-ui updates in place.
   - Drop the "PASS" on `update UI CPU/op` (0.81× / 0.71×), or re-key the arms by segment index
     and re-run.
6. **"Every prop is `T | null`".** Not true for `options`, `defaultSelectedIndex`,
   `mostRecentEventCount` and `disabled`, which are plain `T`. The accurate statement is "no `?:`
   except the callback (D7/D7b)".
7. **Unreproduced Android harness failures (Observations).** The report says 4 failures were seen
   once and are "unreproduced and unattributed", but it does not record which tests they were.
   - Name them from the log.
   - Several G4 tests assert after a fixed `settle(500/600)`. Examples: `re-reports a key change`
     at `:487` and `corrects a planted size` at `:1069`. At load 200+ those tests are the likely
     candidates.
8. **Android fallback KDoc.** `HybridNitroUiSegmentedControl.kt:393-395` says "411.43 dp for four
   long ones". 411.43 dp is this AVD's screen width, i.e. the clamped box (see F2), not a measured
   width.
9. **Docs aside.** `segmented-control.md:57-59` points the `.menu` Picker at
   `docs/tasks/G5-datepicker.md`. Picker is not G5. Point it at the 0.2 Picker instead.
10. **Sizing-key example.** The docs and report use `['a|b']` vs `['a','b']` as the case the
    escaping prevents. Those two lists are already told apart by the count prefix. The case that
    actually needs the escaping is a same-count pair, such as `['aa|bb','c']` vs `['aa','bb|c']`,
    which the jest test correctly uses. Use that pair in the prose.

## Checked and fine (no action)

- **Sizing key.** `"<count>|" + labels`, escaping `\`→`\\` and `|`→`\|`, joined with `|`. A
  brute-force check of 2,380 lists over `{'', a, |, \, a|, a\, \|, |\, 1, 1|, ||, \\, a|b}`, up to
  3 labels, found no collisions.
  - `[]`→`0|`, `['']`→`1|`, `['','']`→`2||`.
  - A trailing backslash is unambiguous (`['a\\','b']`→`2|a\\\\|b`).
  - The count cannot be forged, because digits contain no `|`.
  - The engine hashes `(component, '|', key)` with a double FNV check, so string length is not an
    issue.
  - The harness rebuilds the key independently (`harness.tsx:271-276`), which is the right
    precaution.
- **Handshake.** It is identical to Switch on both platforms: `user()`, the echo before the handler
  (`useControlled`), and `reconcile()` with the `jsEvents >= nativeEvents` guard.
  - A rapid double tap, a rejection, an accepted change and the mode-switch seed all behave
    correctly.
  - Android suppresses a tap on the already-selected segment (`.kt:310`). That keeps event parity
    with SwiftUI's binding and makes the real-input snap-back oracle sound.
- **Clamping rules.** They match the docs table, and JS, Swift and Kotlin agree on every class of
  input (past the end, negative, fractional, `NaN`, `±Inf`, huge values). JS truncates, Swift
  floors and Kotlin `toInt()` truncates; for negatives all three end at 0. A `-0` from JS is
  harmless.
- **Disabled.** iOS uses `.disabled()`. Android passes `enabled` into M3 `SegmentedButton` →
  `Surface(selectable(enabled = …))`, so the disabled semantics survive. This is not the G1/G2 bug
  class. The harness covers the disabled path, and the barometer makes that coverage meaningful.
- **Accessibility, Android.** Each segment has `Role.RadioButton` and `selected` inside the row's
  `selectableGroup()`, and the label is on the row. The extra `Modifier.semantics { selected }` is
  redundant but harmless.
- **RTL.** M3 `itemShape(index, count)` uses start/end corners, and both platforms mirror.
- **Dark mode.** `SegmentedColorsCache` is keyed on scheme identity and cleared on a scheme change,
  bounded at 24, and `@Synchronized`.
- **Perf contract.** Setters store and mark dirty (and Android's `options` setter compares
  content). There is one `commit()` per `afterUpdate()`, no `setContent` or `rootView` after init,
  and no per-update theme or colour allocation. Callbacks are stable through `useControlled` and
  `useStableCallback`. There are no `?:` props except `onValueChange` (D7b). Reassure shows 6/6
  renders.
- **Size hooks.**
  - iOS: the `options` setter calls `noteContentSizeMayHaveChanged()`, and the `nuiSizingKey`
    setter calls `noteSizingKeyChanged()`, guarded on change.
  - Android: `noteSizingKeyChanged()`, and Compose re-measures by itself.
  - `disabled` and `tint` are correctly left out of the key, and `selectedIndex` correctly does not
    resize (no check icon).
- **Fallbacks.** iOS 165×31 pt and Android 256×48 dp are registered in `NitroUiDeclaredFallbacks`
  on both platforms, with `init` as the backstop. The harness poisons the cache, so a fallback that
  equals the real size cannot hide a missing correction.
- **Recycle and drop.**
  - The model is fully reset on both platforms. Android resets through `host.prepareForRecycle()`
    → `model.reset()`, plus `tag` and `perfInstanceId`. iOS resets the model and calls
    `host.prepareForRecycle()`.
  - `onDropView` nils the callback and drops the host. Android disposes the composition.
  - The sizing id is released on both platforms, and the next mount's key setter cannot arm,
    because `contentSize` is `nil`.
  - The fresh `nuiSizingId` comes from `useSizingId` per React instance.
- **D21.** The G4 harness has no wall-clock thresholds, only poll timeouts, so nothing needs
  `expectTimingBudget`. After the merge, run it once under main's new `rn-harness.config.mjs`.
- **Bench plumbing.** `componentOf` and the quick and full plans are right. The four new
  `bench-gate` cases are real (mutation 4 in the report is credible). The bench tables' ratios
  match the medians within paired-vs-median rounding.
- **Real-input check.** The Android and XCUITest checks mirror each other, the two-tap snap-back
  oracle is sound, and the fractions avoid the end caps.

## Non-blocking (one line each, for `docs/tasks/FOLLOWUPS.md`)

- Core: Android `intrinsic` content larger than its box draws centred and clipped instead of fitting. Record via intrinsics, place with bounded constraints (G4 F2; also Button).
- iOS: per-instance segmented tint (SwiftUI ignores `.tint` on a segmented `Picker`) (G4 F1).
- SegmentedControl: no test covers the native-only clamp (an uncontrolled selection while `options` shrinks).
- SegmentedControl iOS: the fallback is not OS-versioned (31 pt measured on iOS 27 only; pre-26 heights are unverified, D14).
- SegmentedControl iOS: an `accessibilityLabel` on a segmented `Picker` is unverified with VoiceOver. No test reads it from the a11y tree.
- SegmentedControl iOS: empty `options` with selection 0 logs SwiftUI's "selection is invalid" warning on every body evaluation.
- SegmentedControl: switching controlled→uncontrolled applies `defaultSelectedIndex` late (`didApplyDefault` is still false). This mode switch is unsupported, but the jump is surprising.
- SegmentedControl harness: replace `settle(N)` + assert with `pollUntil` in `re-reports a key change` and `corrects a planted size` (load tolerance).
- SegmentedControl harness: fix the `no-shadow` lint warning at `:915`. The `reads back what React sent` comment says "Uncontrolled" for a controlled control.
- Bench: add an `update.segmented-control` selection-change cell (the brief's ask), and key the `expo-ui` segmented arms by index.
- Example: the Android screenshots show a LogBox warning ("Open debugger to view warnings") on the Segments tab. Identify it.
- F1 canonical iOS segmented baseline (iPhone 17, quiet machine). F2 Android D15 misses (mount UI CPU 1.33×, memory 1.10×). Both are host architecture, as for G1/G2.
- F3 settle the iOS `mounted` 2.1–3.6× hypothesis with per-launch `sizingStats()` deltas (same as G2).
- F4 `presentedBeforeMount` non-zero on every iOS segmented arm, including rn-core 64/80. Look at the bench instrument.

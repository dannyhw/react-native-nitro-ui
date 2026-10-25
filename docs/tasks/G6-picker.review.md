# G6 — Picker · review (D19: the one full review)

Branch `task/G6-picker` @ `0be0d31`, from main `d21f0ce`. I reviewed `git diff d21f0ce..0be0d31` against:

- the brief;
- AGENTS.md, D7, D14–D22;
- `core.md` (§3, §4, §6, §7);
- `sizing.md` (§4, §5, Policies);
- SegmentedControl and Progress, as the templates;
- the four prior reviews, including today's G5 review.

I also read the report, the screenshots, the harness and real-input code, and the kept logs and dumps in `/tmp/g6-*`. I checked two behaviours against the bytecode of the artifacts the example app resolves: Material 3 `ExposedDropdownMenu` against `material3-android-1.4.0`, and Compose accessibility `enabled` against `ui-android-1.11.4`. No simulator, emulator, Metro, harness or bench was run.

## Verdict: **NEEDS-WORK**

A lot of this is good:

- **Handshake and clamps.** The handshake is wired correctly on both platforms. The clamps match SegmentedControl's exactly (JS `Math.trunc`, Swift `rounded(.down)`, Kotlin `toInt()`, with the same edge results).
- **Prop handling.** Setters store raw values and interpret them in `afterUpdate()`. The recycle reset is complete.
- **Android popup.** It is owned by the composition. Back and outside-tap dismiss it, and disabling while it is open closes it.
- **Colour cache.** The `TextFieldColors` cache is process-wide, bounded and keyed on the scheme's identity.
- **iOS tint.** The claim is measured and true: the menu takes the tint and the wheel does not (`ios-light-lower-tint-wheel.png`, where the tinted wheel is `#34C759` and draws untinted).
- **Bench-gate.** The new cases are real. `a9a0e25` fixes the vacuous filter.
- **Real-input oracles.** These are sound: the Android window table and the tap-twice snap-back.

But four things must be fixed before merge:

1. **M1.** The headline sizing idea, a key that names the selected title, poisons the size cache on every pick.
2. **M2.** A runtime `variant` change on Android keeps asking the old measure question. Picker copies Progress's two-policy switch but not the remount that makes that switch work.
3. **M3.** On Android, the accessible name is not on the node TalkBack focuses. The report's explanation of `enabled=true` is wrong, and the kept dumps show what is really happening.
4. **M4.** Several tests that guard brief requirements were never shown red. Among them are the popup leak (unmount while open), recycling and C1. The harness leak test cannot see a leak, and the B1 MountChurn pattern is absent.

M1–M3 change native code (Swift, Kotlin, and one small Android core hook for M1). Per D19 the fix round needs an Opus re-review, and per AGENTS.md every harness change runs on both platforms.

## Gate

`bun run check` on `0be0d31`: **exit 0**. All fourteen steps passed:

- typecheck ×3, eslint, prettier;
- jest 188/188 in 12 suites;
- `test:native`;
- `perf:renders` 6/6;
- `nitrogen:check`, autolinking, prepare, api-extractor, publint, manifest, README examples.

`git status` was clean afterwards. Log: `/tmp/g6rev-check.log`.

## Findings that must be fixed

### M1 — sizing (D17, both platforms): every user pick files the new title's size under the old title's key, so the cache holds another title's width

**How it happens.** `nuiSizingKey` names the selected title (`Picker.tsx:170-184`, `:279-284`). A pick paints a new title before any props batch arrives, and both hosts then measure and report:

- **iOS** measures on purpose, one turn later: `HybridNitroUiPicker.swift:273-275` (`onSelectionPaintedByUser` → `invalidateContentSize()`).
- **Android** measures automatically: the recomposition after the row's `onClick` (`HybridNitroUiPicker.kt:427-429`) runs the measured root, which reports.

The engine files a report under the instance's **ledger key** (`cpp/NitroUiSizingEngine.cpp:519`), which is the key of the last shadow measure, so the *old* title's key. On disagreement it writes `cache_[key] = measured` as authoritative (`:711`). For an uncontrolled picker the key never changes at all: the wrapper sends `sel:<default>` for the whole mount (`Picker.tsx:280-282`, and `useControlled` never renders in uncontrolled mode).

**Scenario 1: controlled iOS picker, options `['Red','Greenish blue','A considerably longer colour name']`, user picks index 2.**

1. Native paints the long title. Next turn it reports W_long under `…|sel:Red|…`, so `cache[sel:Red] = W_long`, and the instance is corrected to W_long.
2. The JS echo arrives with `sel:A considerably…`. That key is cold, so the instance is laid out at the **72 × 35 fallback** for a frame and then corrected again.

So one accepted pick costs two corrections and a fallback-sized flash.

**Scenario 2: what that leaves behind.** Every later mount of that configuration at index 0 is laid out at W_long, which the cache marks exact. This breaks D17's "an exact cache entry lays out exact on its first frame (0 stale)". The mount then corrects back to W_red. Picking back and forth makes the two entries swap widths on every pick.

**Scenario 3: uncontrolled (the real-input case itself).** Step 4 of both real-input scripts proves the box grew after a pick with "no render to ask for". That growth can only come from the report above, so the passing test *is* the pollution: `cache[…|sel:Onyx|…]` now holds the 34-character title's width. Android shows it only for titles over the 280 dp floor (about 30 characters); iOS shows it for every title.

**Why no test saw it.** The harness cannot press a popup row. The controlled R3 test (`Picker.harness.tsx:630`) moves `selectedIndex` from JS, so no native pre-measure happens. Real-input checks only the final width.

**Fix.** The rule is that a report may only reach the engine under a key that names the title being painted. Recommended:

- **(a) JS: make the key follow the shown index in both modes.**
  - In uncontrolled mode, keep the last native index in wrapper state. Set it inside the handler passed to `useControlled`, *before* the user's handler.
  - Build `shownIndex` from that state, clamped like native's shrink rule.
  - The cost is one render per uncontrolled pick, which is acceptable for a discrete control. Document it, and update `perf:renders` if a scenario covers it.
- **(b) Native: hold reports between a pick and the next props batch.**
  - **iOS:** delete `onSelectionPaintedByUser` and its `main.async`. The echo batch re-keys, and `noteSizingKeyChanged()` plus the bounds change measure under the right key. A *rejected* pick already re-measures through `shown != beforeShown` (`:494`), under the unchanged key, for the content that key names.
  - **Android:** needs a small host hook, for example `holdSizingReports()` set in the row `onClick`. While held, `recordMeasuredSize` keeps `contentSize` but skips `NitroUiSizing.report`. `afterUpdate()` releases it and calls `noteSizingKeyChanged()` so the held size is reported under the new key.
- **Alternative (needs a product call):** take `sel:` out of the key and make the menu's width independent of the selection (widest option). That avoids the hook but changes how the control looks on iOS.

**Test (red first on the current code).** Add an `@internal` test hook that runs the *exact* row path: the iOS binding `set` closure, or the Android `onClick` body. Give it an explicit main/UI hop (core.md §5), like G5's `nuiTestSelect`. Then, in the harness:

- **Pick test:** a controlled pick to a cold long title costs ≤ 1 correction, and no laid-out size equals the fallback (use `setSizingTraceEnabled`).
- **Remount test:** unmount, mount a fresh picker of the original configuration, and assert 0 corrections with the box equal to `measureContent()` on the first read.
- **Uncontrolled twin:** the same two checks for an uncontrolled picker.

### M2 — sizing (Android): a runtime `variant` change keeps the old measure question for the life of the mount

**The cause.** `NitroComposeHost.kt:312` passes `unbounded = … sizingPolicy == POLICY_INTRINSIC` into `NitroUiMeasuredRoot` from `Content()`. `sizingPolicy` is a plain field, and `Content()` reads no state that changes, so the question is fixed when the composition is built. Progress hit exactly this. It **keys the native view on the variant and takes `useSizingId(variantKey)`** (`Progress.tsx:180-195`, whose comment explains why). Picker says it makes "the same two-policy switch Progress makes" (`picker.md:127-128`, report decision 2, header comments in both hosts) but has neither: `Picker.tsx:275` and `:287`.

**What breaks.**

- **`menu` → `wheel` at runtime.** The field keeps being asked the unbounded question. `fillMaxWidth()` under infinite constraints is a no-op, so it reports its own width (280 dp) with the `fillWidth` flag. Yoga gives it the box, and the "wheel" is drawn as a 280 dp field centred in a full-width box.
- **`wheel` → `menu` at runtime.** The menu is asked the bounded `fillWidth` question at its box width. A 40-character title in the 280 dp fallback box measures 280, matches the box, and is **confirmed**. The box stays truncated, and `cache[menu|…]` records 280 instead of 384.76 as authoritative.

The harness test `takes the box width as a wheel and its own width as a menu` mounts the two variants separately, so it cannot see this. iOS reads the policy live and is not affected.

**Fix.** Copy Progress:

- `const variantKey = nativeVariant;`
- `useSizingId(variantKey)`
- `key={variantKey}` on `NativeNitroUiPicker`

Document that a variant change remounts, so an uncontrolled picker re-seeds from `defaultSelectedIndex`. Fix the "same as Progress" sentences.

**Test (red first).** Rerender one instance inside a 330 box:

- `menu` → `wheel`: `measureContent().width ≈ 330`.
- `wheel` → `menu` with `LONG_TITLE`: `measureContent().width` is the unclamped long width, not the box.

Run it on both platforms. It is red on Android without the key.

### M3 — accessibility (Android): the name is not on the node TalkBack focuses, and the `enabled=true` explanation is wrong (SF2 again)

**The dumps.** The kept dumps (`/tmp/g6-pickerscreen.xml`, `/tmp/g6-d3.xml`) show two nodes per picker, with identical bounds:

- **The focusable, clickable field:** class `android.widget.EditText`, `text` = the selected option, **`content-desc=""`**, and `enabled="false"` when disabled.
- **The node that carries the label:** class `android.view.View`, `content-desc="Real-input disabled picker"`, `clickable=false`, `focusable=false`, and **`enabled=true` even on the disabled picker**.

**Why the label node cannot be Compose's.** In `ui-android-1.11.4`, `AndroidComposeViewAccessibilityDelegateCompat_androidKt.enabled(SemanticsNode)` is exactly `!config.contains(SemanticsProperties.Disabled)`. A Compose node carrying the `disabled()` from `HybridNitroUiPicker.kt:360-362` therefore cannot report `enabled=true`. It also is not the anchor's node: when enabled, `menuAnchor` adds `expandable`'s `onClick` there (`material3-1.4.0`, `ExposedDropdownMenuKt.expandable`), which would make it clickable.

**What the label node is.** It is the RN host view. `accessibilityLabel` is both a Nitro spec prop and an RN base view prop, and it is in `NitroUiPickerConfig.validAttributes`. So RN's `BaseViewManager.setAccessibilityLabel` also puts it on the host `FrameLayout` as `contentDescription`. The generated manager is a `SimpleViewManager` (`HybridNitroUiPickerManager.kt:23`). RN knows nothing of `disabled`, hence `enabled=true`.

**Consequences.**

- The control TalkBack lands on reads the value with no name.
- The name sits on the container, which is a likely second focus stop. That is the bug `core.md` §3 / SF2 forbids.
- The report's mechanism ("Compose derives `isEnabled` from unmerged children") is false, and it is repeated in `HybridNitroUiPicker.kt:351-359`, `scripts/real-input/android.mjs:599-604`, `picker.md:222-228` and report decision 6.

**Fix (Picker).**

- Make the anchor one semantics node that carries the name, the value, the role and the state. For example, `Modifier.clearAndSetSemantics { contentDescription = spokenLabel ?: selectedText; stateDescription = selectedText; role = Role.DropdownList; if (enabled) onClick { model.expanded = true; true } else disabled() }` on the anchor modifier, keeping `menuAnchor` for pointer input.
- Verify it with a uiautomator dump in `CHECKS.picker`:
  - the **focusable** node has `content-desc` = the label;
  - it shows the selected title;
  - it has `enabled=false` on the disabled picker.
- Correct the four texts above.

**Fix (core, follow-up, not this task).** The RN host `contentDescription` affects every control with an `accessibilityLabel` spec prop. See Q3 below.

### M4 — tests and false claims: several brief-required tests were never shown red; the leak test cannot see a leak; no MountChurn case

AGENTS.md requires every new test to be shown red. The report says "Every new test's guarding mechanism was broken and the red recorded".

**Harness tests with no recorded red** (`/tmp/g6-device-mutations.txt`, `/tmp/g6-js-mutations.txt`):

- `re-measures when the selection moves to a longer title`
- `clamps a selection the caller sends out of range`
- `reads back what React sent`
- `keeps a caller width in charge…`
- **both C1 tests**: `fits an over-wide menu…` and `re-fits when the caller narrows…` (the brief says "test it")
- `survives remounts…` (the recycle case)
- `does not treat opening as a choice, and survives going away while open`

**Real-input steps with no recorded red** on either platform: the snap-back, the three unmount-while-open cycles, and the disabled refusal.

**The leak test.** The harness test "survives going away while open" asserts only that a *different* picker mounts and measures afterwards. A popup that outlived its view would pass it, and its own comment says so. `picker.md:120-123` and the report still cite it as the unmount-while-open coverage.

The real-input window count (Android `popupWindowCount()`) *can* see a leak, which is better than G5. It was never shown red.

**MountChurn.** The brief's "B1 `MountChurn` gate pattern applies" has no Picker case. `MountChurn.harness.tsx` is Switch-only, yet the Kotlin header (`HybridNitroUiPicker.kt:51-55`) says MountChurn keeps the popup case true.

**Fix.**

- **Popup leak, Android.** Mutate `onDropView` to skip `host.drop()`. Show `CHECKS.picker` step 6 red (window count 1 after the unmount).
- **Popup leak, iOS.** Show a twin red (for example, skip `host.drop()`/containment detach), or say plainly that iOS cannot be shown red and why.
- **MountChurn.** Add an Android Picker case: churn pickers, press one anchor open per cycle (the harness *can* press the anchor, as `pressAnchor` already does), unmount, and assert the post-GC floor. Show it red with the same `onDropView` mutation.
- **The harness leak test.** Rename and re-document it to claim only what it asserts ("opening is not a choice; the next mount sizes normally").
- **Remaining tests.** Record a red for the C1 pair, the recycle test (for example, drop `didApplyDefault = false` from the reset) and the M1/M2 tests. List any test left without one in the report rather than claiming all.

## Non-blocking (one line each)

- **iOS binding guards.** The binding setter (`HybridNitroUiPicker.swift:158-173`) neither checks `model.disabled` nor bounds-checks `requested` against `options.count`. A menu that stays open while `disabled` flips or `options` shrinks can emit while disabled, or emit an index past the end with `value: ''`, which contradicts `PickerProps.onChange` and `picker.md:80-82,100`. Guard both.
- **iOS cold wheel.** A cold `wheel` lays out at the menu's fallback (35 pt tall against 216) with the `intrinsic` flag for its first frame, then pays one correction per epoch. D17 allows that, but `picker.md` Limits mentions only long-title menus. Document it, or make a per-variant fallback a follow-up.
- **iOS `main.async`.** The pick-time `main.async` can run after `onDropView`/`prepareForRecycle` in the same turn. It then measures a reset host and leaves `contentSize` non-nil on a pooled host, which defeats `noteSizingKeyChanged`'s fresh-mount guard. M1(b) removes it.
- **Copied helpers.** `escapeOption`/`OPTION_SEPARATOR`/`clampToOptions` are copied from `SegmentedControl.tsx`, not shared. The brief says "reuse them, don't fork them", so move them to `src/core`. The native `clamp` copies are the same story.
- **iOS value announcement.** The closed iOS picker's announced value is never asserted. Read `hostedControl(...).value` in `testRealInputPicker`. The "Choice, Choice" wrapper label noted at `RealInputTests.swift` also suggests the label is read twice.
- **iOS containment.** `needsContainment = true` adds every Picker's hosting controller as a child view controller on mount, which is 200 `addChild` calls in a list. It is worth a `sizingStats`/Instruments look before 0.2 (D15 mount UI CPU).
- **iOS key fragmentation.** `lbl:` is in the key on iOS even though iOS draws no caption. This fragments the cache harmlessly. Leave it unless it is cheap to drop per platform.
- **Bench re-run.** After M1/M2, `update.picker` will change shape on both platforms. Re-run the quick plan in the idle-machine window (report Q1).

## Report claims to correct

1. **"Every new test shown red first" / the Acceptance row.** This is false for the tests listed in M4.
2. **Decision 5.** "The open state is per-host rather than per-model" is false: `expanded` is `PickerModel` state (`.kt:91`). `picker.md:114` has it right. "Three unmount-while-open cycles each leave zero popup windows" is a measurement, not a shown-red gate.
3. **Decision 6, Known issues and Q3.** The `enabled=true` mechanism is false (M3). The same text is in `.kt:351-359`, `android.mjs:599-604` and `picker.md:222-228`.
4. **Decision 2, `picker.md:127-128` and both host headers.** "The same two-policy switch Progress makes" is false without Progress's variant key (M2).
5. **Decision 4, `picker.md:128-131` and `:177-182`.** The key "names the selected title" only until the first pick (M1). `picker.md:181`'s "That path is what the `update` benchmark cell … exercise[s]" is false: the bench arm drives `selectedIndex` from JS (`nitroUi.tsx`, `pickerSelection`), so no native pick happens.
6. **`picker.md:120-123`.** The harness test does not test unmount-while-open (M4).
7. **Summary: "The data model was reused, not forked … the `escapeOption` key format all come in from the existing core".** These are copies.
8. **Files changed: "G5 … merges without contention".** A trial `git merge-tree` of G5 `d773658` with G6 `0be0d31` reports **28 conflicting files**. All are both-sides-append, but they are conflicts (see Merge).
9. **`HybridNitroUiPicker.kt:51-55`.** It cites `MountChurn.harness.tsx` as guarding the popup, but MountChurn has no Picker case.

**Honest and fine as written:**

- both bench runs are labelled busy;
- D15 is not claimed;
- the Android D15 misses carry a follow-up;
- the Metro 8293→8294 fallback is disclosed;
- `check` not running the Kotlin twin is disclosed.

One process note on the Metro fallback: 8294 is G5's assigned port. Next time, fail rather than fall through, by passing a fixed port, or by checking it is free and refusing otherwise.

## Answers to the implementer's questions

**Q1 — Re-run both benches on an idle machine?** Yes, but after the fix round, because M1/M2 change what `update.picker` and the first mounts do. It is not a merge blocker: D15's first arm never blocks. Record it as a scheduled quiet-window run, and let that run mint the iOS baseline if it is the first idle iPhone 17 run.

**Q2 — `fillWidth` for wheel instances against one policy per class in `nitro-ui.sizing.json`: is that correct with the engine?** Yes. The table entry does not mean what the question fears:

- **What the table controls.** `patch-nitrogen.mjs` uses it only to choose the intrinsic shadow-node templates. The policy string ends up only in a comment (`HybridNitroUiPickerComponent.hpp:111`).
- **Where the policy actually lives.** In the flags on `setFallback` (per component) and on each `report` (per instance). The shadow node applies the flags of whatever answered (`NitroUiIntrinsic.hpp` `measureContent`).
- **Precedent.** Progress already declares `fillWidth` in the table while its circular instances report `intrinsic`. `sizing.md` Policies and `NitroUiSizing.hpp:28` already list "wheel Picker" as `fillWidth`.

**How it plays with the engine:**

- **Cache keys.** `variant` leads the key, so menu and wheel entries never share a cache entry or a guess.
- **D17 counters.** `sameSizeForPush` compares flags first, so a cold wheel laid out from the `intrinsic` fallback always pays exactly **one** correction per configuration per epoch. That is D17's permitted first-instance cost, and warm wheels cost 0.
- **The declared fallback.** One pair per component can only be right for one variant. On iOS a cold wheel's first frame is 35 pt tall against 216 (non-blocking above). On Android both variants are 56 dp tall, so it is accurate.

**What does break is a runtime variant change on Android (M2), not the table.** Keep the host-level answer and add one sentence to `sizing.md` §5 (orchestrator's file): "the table selects the intrinsic shadow node and names the default policy; the policy that applies is the one the host reports (Progress, Picker)". A per-variant fallback can be a follow-up if the wheel's first frame matters.

**Q3 — Android `enabled=true` on a disabled field's a11y node: Picker bug or core-level?** Both, and not for the reason the report gives.

- **The `enabled=true` node is the RN host view.** RN's `BaseViewManager` gives the host a `contentDescription` because every component's spec names its label prop `accessibilityLabel`, an RN base prop that is in each `validAttributes`. RN has no idea about `disabled`.
- **Compose is not the cause.** Compose reports `enabled = !config.contains(Disabled)` in 1.11.4, so a Compose node carrying `disabled()` cannot say `true`.
- **Core-level part (ticket warranted).** Every Android control very likely also has its name on the container (SF2) and a possible extra TalkBack stop. Confirm it with one uiautomator dump of the Switch screen. Options: rename the spec prop (for example `nuiAccessibilityLabel`) so RN never maps it; or have `NitroComposeHost` keep its own `contentDescription` null / `importantForAccessibility = no` while the Compose child stays accessible; then re-verify with a dump.
- **Picker-level part (M3).** The focusable `EditText` carries no name, which is fixed in Picker's own semantics.

## Merge (main and G5)

**With main.** Main is at `93e7b52`, which is docs-only on top of `d21f0ce`. `git merge-tree` reports no conflicts.

**With G5 (merges first).** These 34 files overlap:

- **Registration:** `nitro.json`, `nitro-ui.sizing.json`, `NitroUiPackage.kt`, both `NitroUiDeclaredFallbacks`, `src/index.ts`.
- **API and tests:** `etc/react-native-nitro-ui.api.md`, `etc/package-files.txt`, `src/__tests__/viewConfigs.test.ts`.
- **Bench:** `bench/src/{types,plan}.ts`, all four bench arms, `shared.ts`, `bench/baselines/renders.json`, `scripts/bench/lib.mjs`, `scripts/__tests__/bench-gate.test.js`.
- **Smoke:** `scripts/smoke/{App.tsx,lib.mjs}`, `scripts/__tests__/smoke-ready-line.test.js`.
- **Real-input:** `scripts/real-input/{controls,android,uiautomator}.mjs`, `RealInputTests.swift`.
- **Example app:** `example/src/App.tsx`.
- **Generated:** the aggregate `nitrogen/generated` files (`nitrouiOnLoad.cpp`, `nitroui+autolinking.cmake`, the Swift–C++ bridge, umbrella and autolinking `.mm`/`.swift`).

28 of them conflict textually, all by appending at the same point. To merge G6 after G5:

1. **Hand-resolved files: keep both sides.** This covers the arrays, enums, `ComponentName` and `ScenarioName` unions, `PLANS` blocks, the `SMOKE_CONTROLS` order, the tab list and the real-input `CHECKS`. In `uiautomator.mjs`, both branches add `selected` (G6 also adds `checkable`/`checked`), so keep one `selected`. In `bench-gate.test.js`, update the component-set and `button.length * N` assertions to include both `date-picker` and `picker` (7 components).
2. **Regenerated files: never hand-merge them.** Run `bun run nitrogen` (it applies `patch-nitrogen.mjs`) and then `bun run nitrogen:check`.
3. **API and manifest.** Re-run `bun run api-extractor` and `bun run manifest:update`, and check that `etc/package-files.txt` is a superset of both branches.
4. **Baselines.** Re-run `bun run perf:renders`; `renders.json` needs both entries.
5. **Gate.** Run `bun run check`. Then run harness and real-input on both platforms, because the shared real-input files and `RealInputTests.swift` changed for both controls.
6. **Core overlap.** The only core overlap is G5's additive `containingViewController` accessor in `NitroSwiftUIHost.swift`, which G6 does not touch. If M1(b) adds an Android host hook, re-check it against anything G5's fix round adds to `NitroComposeHost.kt`.

## Do the must-fixes change native code?

**Yes.**

- **M1:** Swift (delete the pick-time measure), Kotlin (hold reports across a pick) plus a small `NitroComposeHost` hook, the JS wrapper, and a native test hook on both platforms.
- **M2:** JS only (`key`/`useSizingId`). Its test runs on both platforms.
- **M3:** Kotlin semantics, plus real-input changes.
- **M4:** Tests and docs. The MountChurn case is a harness change, so it runs on both platforms.

Per D19 the fix round needs an Opus re-review, because it changes native and core code. This review is round 1 of the cap, so G6 has two fix rounds left.

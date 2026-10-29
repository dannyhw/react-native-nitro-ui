# G7a — Menu: review

**Branch:** `task/G7a-menu` at `6313c41` (base `747debc`). **Reviewer lease:** `G7a-review-3fp5w`
(iPhone 17 / iOS 27 + `emulator-5574` / API 35), released.

## Verdict: FIX ROUND

The control is sound. The SwiftUI and Compose halves follow the brief: setters store and mark
dirty, `afterUpdate()` commits once, nothing recreates a hosting, and `group` identity is stable.
The popup engineering is H2b's and drop-while-open is witnessed with a delta. The red-proof
battery is unusually thorough. The fix round is needed for six small items: four harness
assertions break the brief's own test rules (one names a11y and tests only prop read-back, two
waits accept a wrong answer, and one leak read is absolute), and the docs and spec make three
false or contradictory claims. Separately, three D29/Q1 deviations need an owner decision before
merge whatever the round does (see "Owner decisions needed").

### What I ran (tip `6313c41`, code tree `1515f2ab3b65`)

| Run | Result |
| --- | --- |
| `gate.mjs check` | PASS, 16/16 steps, 115 s |
| `gate.mjs harness:android -- Menu` | PASS, 15/15 |
| `gate.mjs harness:ios -- Menu` | PASS, 15/15 |
| `gate.mjs harness:android -- Host` at the tip | FAIL, 4 failed / 24 skipped / 41 passed of 69 (load1 108 at start) |
| `gate.mjs harness:android -- Host` at **base `747debc`** (throwaway detached worktree, built from scratch) | FAIL, **the same 4** failed / 24 skipped / 41 passed of 69 (load1 47 at start, median 9.8). Log: `<store>/detached/harness+android+Host-2026-10-29T05-28-11.725Z.log` |

**The android harness failures were already there at base.** The report is right, and it
understates the case. All four failures, including `HostControls › follows mixed children…`,
reproduce at `747debc` on this emulator with the same messages: two F8/HostControls timeouts,
`expected 1 to be +0` and `expected +0 to be 1`. The report says the fourth "passed in a 3-suite
run both at the base and at this head". My runs contradict that, and so does the implementer's own
`04-23-42Z` Host log. The Menu diff cannot be the cause: it touches `HybridNitroUiButton.kt` only to
extract `NitroUiM3Button`, and I read that extraction as behaviour-identical. It touches
`HybridNitroUiPicker.kt` only to widen two helpers' visibility. The one shared Host file change is
one new `HOSTABLE_CONTROLS` row. These failures are not intermittent here, either. They failed in
6 of 6 runs (4 of the implementer's, 2 of mine) at load 3–6 and above. That is a
machine/emulator-state problem on mac-1's `nitroui_t03` (note the constant 24 skipped, against
X3/X11's 0 skipped at 214/214). It is a different shape from Q3 §2's load-dependent race. **This is
acceptable for G7a**, given the base evidence above. The Host suites need their own task on mac-1.

## Must fix (M)

- **M1 — the a11y test does not test a11y.** `example/__tests__/Menu.harness.tsx:1632-1684` asserts
  only that the `hybridRef` getters echo the props. It would pass if `OptionalMenuAccessibility`
  (`ios/components/Menu/HybridNitroUiMenu.swift:223`) were deleted, and its red proof (getters answer
  null) proves the round-trip, not the label. The house pattern for iOS is
  `harnessUi.queryByAccessibilityLabel(...)` plus a box check (`Progress.harness.tsx:803-811`,
  `Slider.harness.tsx:1420`). Add it on iOS for `'Open the actions'`, and for `'Plain'` falling back
  to `title`. Show it red by dropping the modifier. Android stays documented as unreachable from the
  harness, as Progress does.
- **M2 — two waits accept a wrong answer (brief item 5, Q3 §1).** `waitForRemeasure`
  (`Menu.harness.tsx:344-360`) copies the zero hole Q3 §1 documents:
  `size != null && !sameSize(size, previous)` is satisfied by `0×0`. Add
  `size.width > 0 && size.height > 0`. Separately, in the remount test, `waitForMeasured('recycle', …)`
  (`:1326`) can be answered by the *previous* mount's handle, because `handles` is not cleared
  between the two renders inside the test. Capture `stale = handles.get('recycle')` before
  `unmount()` and refuse it, as Q3 §1's `waitForFreshMeasure` does. Both currently fail safe, because
  a later assertion goes red. But they do so on the wrong line, and the brief forbids the shape.
- **M3 — an absolute leak count.** `Menu.harness.tsx:980` waits for `r.live === 0`. Every other
  `live` read in the file is a delta. Use `liveBefore`. The brief and Q3 §2 say why: a leftover from
  an earlier gate turns this red with the wrong blame.
- **M4 — false claims about recycle order.** Q1 §5 asks for "full `reset()` with `expanded` first",
  and three places say that is what shipped: `HybridNitroUiMenu.kt:482` ("First among the rest"),
  the `prepareForRecycle` comment at `HybridNitroUiMenu.kt:1076-1077` ("the first field it clears is
  `expanded`"), and `docs/components/menu.md:201` ("resets the open state first, then the rows, then
  the trigger"). In fact `expanded = false` is the eleventh write (`:484`), and iOS has no open state
  at all. Move the write to the top of `reset()` and make the doc sentence platform-true.
- **M5 — the spec contradicts the behaviour on `onClose`.** `src/components/Menu/Menu.nitro.ts:160`
  says `onClose` is "Called when the menu closes **without a pick** having been reported for it".
  The Android implementation fires it on a pick (`MenuModel.applyPick` → `setOpen(false)`,
  `HybridNitroUiMenu.kt:452`), the harness asserts that (`Menu.harness.tsx:963`), and
  `docs/components/menu.md:108,119` documents it. Make all of them say the same thing once the owner
  rules on decision 3. Also state the order: today `onClose` fires *before* `onSelect`.
- **M6 — `disabled` while open is documented as closing the menu on both platforms, and iOS does
  not.** `docs/components/menu.md:41,102,127`, `Menu.tsx:94` and `Menu.nitro.ts:101-103` state it
  without a platform caveat. The Swift setter's own comment (`HybridNitroUiMenu.swift:520-526`) says
  iOS cannot honour it, and it rests on "`docs/components/menu.md` says what iOS does". No such
  sentence exists. Add the iOS behaviour (not guaranteed, unobservable) to the table and to Limits,
  so the code comment's premise holds. This item tracks owner decision 2.

## Nice to have (N)

- **N1** — `groupSignature` (`Menu.tsx:243-256`) joins unescaped fields with `' '`, so
  different menus can share a signature. One action titled `"T     b action U"` and two actions `T`
  and `U` (ids `a`, `b`) produce the same string, and the cache then hands native the old rows.
  This is contrived but free to fix: reuse `escapeField` with a separator, or `JSON.stringify`.
- **N2** — `MenuModel.reportLock` (`HybridNitroUiMenu.kt:261,429`) is taken only by the reader, so it
  guards nothing. This is H2b review N9's pattern copied (FOLLOWUPS:54). The report's Item 4 says
  `nuiTestMenuReport` "runs inline when already on the main thread and otherwise posts". It does
  neither on either platform; it reads directly, and on iOS that means `model.entries` off main
  (`HybridNitroUiMenu.swift:743-745`). Correct the sentence. Fixing the lock is optional.
- **N3** — `keeps the trigger when only the list changes` (`Menu.harness.tsx:757-763`) claims to
  prove "the big list is really the one the control holds". On Android it asserts `rows === 0`, which
  the closed popup answers whether or not the second render arrived. Open it and read
  `rows === BIG_PICKABLE`, or drop the claim.
- **N4** — `carries no old state across a remount` (`:1283`) is a remount test. Fabric is not
  forced to recycle, and its red proof is the witness-decrement mutation, not a `reset()`
  mutation. That matches the house limit (Picker's remount test says the same), but the report
  should say that brief item 5's "recycle reset" is covered as remount freshness only.
- **N5** — the `menuAnchor` deviation rests on "measured, the list opened at the Host's edge", and
  no committed run shows it. The first half of the hosted test does not discriminate either:
  `mTop + 24 >= aBottom` (`:1454`) also holds for a popup under the whole Host. Add an upper bound
  such as `mTop - aBottom < 48 px` (the post-move half already has one at `:1488`) and cite a red
  run with a plain `DropdownMenu`.
- **N6** — the new `hostArm()` rule (`scripts/registry-core.mjs:619`) has no case in
  `scripts/__tests__/registry.test.js`. `component-coverage.test.js` was changed to match it rather
  than to pin it. Add one case: a `hostable: true, bench: false` manifest is absent from both
  `host-arm-components` regions.
- **N7** — `stateDescription` is hard-coded English `"expanded"`/`"collapsed"`
  (`HybridNitroUiMenu.kt:624`). `Role.DropdownList` makes TalkBack say "drop down list" for what is
  a menu button. Q1 §3 prescribed it, so this is a note for G7b's TalkBack pass, not a fix here.
- **N8** — the Android `disabled` setter fires `onClose` synchronously inside the props batch
  (`HybridNitroUiMenu.kt:919`), not from `afterUpdate()`. That is Picker's precedent and is
  documented, but it is a setter doing more than store and mark dirty.
- **N9** — there is no coverage at all for `primaryAction`/`hasPrimaryAction`, not even a
  read-back: the handle type at `Menu.harness.tsx:89-100` and in `Menu.tsx:131-153` omits
  `hasPrimaryAction`. iOS cannot tap a SwiftUI control here, but a read-back would still catch
  the flag not arriving.
- **N10** — `docs/components/menu.md:216-217` ("a destructive row is announced as such on iOS, and
  a disabled row is not focusable") is a reading. No run opened an iOS menu. Label it as such, as
  the Limits section already does for row chrome.
- **N11** — report accuracy, besides the HostControls point above. Q3's "same family, not this
  task's" covers `HostControls` and emulator start, not F8 or the time/datetime dialog. The base
  run quoted as `3 failed / 190 passed / 217` has no committed log; this review's base run is the
  evidence. The changeset says "iPhoneOS 27.0 SDK" while Q1 cites 27.1. The 27.0 SDK on this
  machine does match the Swift comment's line numbers.
- **N12** — `NitroUiM3Button`'s `when (variant)` body in `HybridNitroUiButton.kt` kept the old
  method's indentation. This is cosmetic.

## The report's questions and deviations

| # | Item | Assessment |
| --- | --- | --- |
| Q1 | `harness:android` red | **Acceptable** on the evidence above: base reproduces all four. Orchestrator call, not owner: accept G7a on `check` + `harness:ios` + `harness:{ios,android}:Menu`, and file a mac-1 Host-suite task. |
| Q2/Q7 | `onOpen`/`onClose` and disabled-while-open unobservable on iOS | **Owner decision** (1 and 2 below). D29 states both without a platform split. |
| Q3 | a pick fires `onClose` | **Owner decision** (3). It contradicts Q1 §5's wording, and the spec doc (M5) says the opposite of the code. |
| Q4 | `menuAnchor` instead of `clickable` + plain `DropdownMenu` | **Owner sign-off** (4). Technically sound and documented at `menu.md:143-153`. Evidence is thin (N5). |
| Q5 | `hostArm()` = `hostable && bench` | **Acceptable, no owner decision.** It is a generic rule, not Menu-shaped: an arm can only be scoped for components that have cells. `hostable`'s real reader (`HostChildren.ts`) is unchanged. Wants a test (N6). |
| Q6 | `realInput: false` | **Acceptable.** `realInput: true` requires `realInputTitle` and generates a `scripts/real-input/controls.mjs` row with a check behind it (`registry-core.mjs:161-168,266-268`), which is G7b's real-input case. The registry's validation would refuse it now. G7b must flip it. |

## Owner decisions needed

1. **iOS `onOpen`/`onClose`.** D29: "Open state is uncontrolled and observed through
   `onOpen`/`onClose`." On iOS both never fire (SDK 27.0 `Menu` has no expansion binding;
   confirmed in the swiftinterface). Options: (a) accept as Android-only and amend D29; (b) have G7b
   try `.onAppear`/`.onDisappear` on the menu content, a common SwiftUI workaround that this review
   did **not** verify; (c) a UIKit `UIContextMenuInteraction` trigger, a different control from Q1
   §2's. Recommend (a), with (b) as a G7b spike.
2. **iOS `disabled` while open.** D29 says it closes the menu. On iOS it is neither enforced nor
   observable. Recommend: accept as a documented iOS limit and amend D29 (M6 adds the docs).
3. **Does a pick fire `onClose`, and in which order?** Q1 §5 says "never for a pick". The code fires
   it, before `onSelect`. Recommend keeping the pairing, because an unpaired open is worse for
   listeners. Amend Q1, and choose the order explicitly (`onSelect` then `onClose` reads more
   naturally to an app).
4. **`menuAnchor`/`ExposedDropdownMenuBox` on Android**, reversing Q1 §3's explicit "no
   `menuAnchor`". Recommend accept, with N5's discriminating bound added.

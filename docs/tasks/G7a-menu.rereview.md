# G7a — Menu: re-review after fix round 1

**Branch:** `task/G7a-menu` at `e6cf340` (base `747debc`; first review `7d9df2d`; round
`7d9df2d..e6cf340`). **Reviewer lease:** `G7a-rereview-6w0d6` (iPhone 17 / iOS 27 +
`emulator-5574` / API 35), released.

## Verdict: MERGE WITH FIXES

The round fixed what the review asked for in code. M2–M6 and N6 are closed, and the new
assertions were shown red where it matters. The `reset()` reorder and the `applyPick` order
introduce no regression. What remains is three false sentences in comments and docs, and no
code change. Two of them overstate what the round's own measurements show (M1 and M3 below).
The third cites a test that does not exist (M2). The orchestrator can fix them under D19
without another round, and they need no device re-run because only comments and docs change.
The four owner decisions still stand. They are listed at the end, with #3 and #4 amended.

### What I ran (tip `e6cf340`, code tree `84f0fd365c1c`, worktree clean)

| Run | Result |
| --- | --- |
| `gate.mjs check` | PASS, 16/16 steps, 114.7 s |
| `gate.mjs harness:ios -- Menu` | PASS, 15/15 (load1 6.8 at start) |
| `gate.mjs harness:android -- Menu` | PASS, 15/15 |
| `gate.mjs harness:android -- Menu HostPopups` | FAIL, 1 failed / 38 passed of 39. The only failure is `HostPopups › comes down with its row…` `expected 1 to be +0` (Q3 §2's case). Menu 15/15. HostPopups ran **first** (`harness+android+Menu+HostPopups-2026-10-29T06-57-31.880Z.log`) |
| `gate.mjs need --for review` | `1 gate(s) missing for review: harness:android`. `check` and `harness:ios` are green on this tree |

## Status of the first review's items

| Item | Status | Basis |
| --- | --- | --- |
| M1 a11y | **Fixed in the test, overclaimed in the prose** (see new M1) | The iOS assertion (`Menu.harness.tsx:1831-1835`) reads the tree and went red at `06-20-03Z` with all six getters green. That red is credible: the excerpt shows `expected null not to be null` on this assertion (excerpt `:1824`, tip `:1833`). |
| M2 waits | **Fixed** (comment wrong, see new M3) | `waitForRemeasure` refuses zero (`:412-417`). `waitForFreshMeasure` (`:365-391`) refuses an old title *and* zero. Reds: `05-56-58Z` (zero), `06-14-44Z` and `06-20-03Z` (title, on the `NeverGiven` assertion: excerpt `:1448`, tip `:1453`). |
| M3 absolute leak read | **Fixed, acceptable unproven** | See (b) below. |
| M4 reset order | **Fixed** | `HybridNitroUiMenu.kt:476` is now `reset()`'s first write. `NitroComposeHost.kt:596` calls `model.reset()` first, so the `prepareForRecycle` comment (`HybridNitroUiMenu.kt:1076-1079`) is true now. `menu.md:215-218` is platform-true. |
| M5 `onClose` on a pick | **Fixed** | `Menu.nitro.ts:163-173`, `menu.md:119-127` and the new `orderLog` assertion (`Menu.harness.tsx:1034-1038`) agree. Red at `05-59-57Z`: `expected [ 'open:events', …(2) ] to deeply equal [ 'open:events', 'close:events', …(1) ]`. |
| M6 disabled-while-open | **Fixed** | `Menu.nitro.ts:105-107`, `Menu.tsx:94-97`, `menu.md:41,102-103,135-143` and Limits `:261-263`. The Swift comment's quote (`HybridNitroUiMenu.swift:525-528`) now matches `menu.md:261` word for word. |
| N6 `hostArm()` | **Fixed** | `registry.test.js:617-660`. Red `1 failed / 36` at `:643` with `menu` present. N2 below covers a small vacuity gap. |
| N10 | **Fixed** | `menu.md:232-256` separates what is measured from what is only read. |
| N1–N5, N7–N9, N11, N12 | Not addressed, which is allowed for N | They carry to `FOLLOWUPS.md`, N5 especially (owner decision 4). |

### (a) Does the remount wait still refuse a stale answer on Android?

**Yes. Two independent rules refuse it, and the rule that does the refusing in practice is the
zero rule.** The `06-13-58Z` probe read the torn-down Android handle as `title="Recycled"
size=0.00x0.00`, so on Android the stale handle fails both guards. A stale *size* with the new
title cannot get through either, because both teardown paths null the cache the handle answers
from. `drop()` does it at `NitroComposeHost.kt:653` and `prepareForRecycle()` at `:602`, and
iOS does the same at `NitroSwiftUIHost.swift:333` and `:313`. A recycled view that already says
`Renamed` therefore answers `0×0` until it re-measures. The title rule matters on its own where
identity fails. The `06-02-21Z` excerpt shows iOS answering the remount through the *same*
handle object (`the handle that answers is the old mount, measureContent() says 96.00x34.33`),
and the `05-56-58Z` excerpt says the same of Android. The `NeverGiven` probe
(`Menu.harness.tsx:1438-1453`) proves the title rule red on both platforms. The test comments
describing this are wrong, though: see M3.

### (b) M3's delta, "measured, not red-proven": acceptable

The before-and-after pair is what M3 asked for. With a leftover `live: 1` planted, the old
`=== 0` read goes red at `05-56-58Z` (`never matched … "live":1`), and the delta stays green at
`05-58-32Z`, where the test is absent from the failures. The delta can still go red for Menu's
own leak: a popup that does not come down leaves `live === liveBefore + 1`, and the line at
`:1057-1060` then times out. That is the same arithmetic the earlier delta at `:1020-1023` uses,
and that earlier line was proven by the witness-decrement mutation (`05-07-32Z`). Running a
separate mutation for this line would add nothing.

### (c) M1: is the a11y test still meaningful?

**Partly. It guards less than its comments say.** HarnessUI's iOS query walks `UIView`s and
matches `view.accessibilityLabel` (`node_modules/@react-native-harness/ui/ios/ViewQueryHelper.mm:64-65`),
and it does so regardless of `isAccessibilityElement`. SwiftUI's accessibility elements are not
`UIView`s, so the walk can only ever find RN's container
(`HybridNitroUiMenuComponent : RCTViewComponentView`, whose props extend `react::ViewProps`, with
`[super updateProps:]` at `HybridNitroUiMenuComponent.mm:219`). That explains why deleting the
SwiftUI modifier is not discriminating. The `06-02-21Z` excerpt matches this: `:1783` (named)
passed and `:1785` (fallback) went null. The excerpt cannot show that the modifier was deleted
in that run, but the mechanism makes it the expected result.

What the test still guards is that the `accessibilityLabel` prop reaches the native view at the
trigger's box. That is a different path from the six getters, and it is red-proven. What it does
not guard is what VoiceOver hears. `Menu.tsx` sends no `accessible`, so the RN container is not
an accessibility element, and VoiceOver reads the SwiftUI element inside it. That element's name
comes from `OptionalMenuAccessibility` (`HybridNitroUiMenu.swift:223`), which no test reaches.
This VoiceOver behaviour is a reading of UIKit's container rules, not a measurement. The test is
worth keeping, with its claim narrowed (new M1). The SwiftUI modifier belongs to G7b's VoiceOver
pass.

## Must fix (M) — comments and docs only

- **M1 — the a11y prose claims the reader's name.** `example/__tests__/Menu.harness.tsx:1845-1847`
  says the assertion holds "the user-visible promise - the name a reader gets sits on the element
  at the trigger's box - not which of the two paths put it there". `docs/components/menu.md:239-240`
  says the same ("*the name is where the trigger is* and not which of the two paths"). The element
  the walk finds is RN's container. It is not an accessibility element (no `accessible` prop), so
  it is not what a reader gets, and only one of the "two paths" reaches VoiceOver. That path is
  the SwiftUI modifier, which nothing tests. Reword both to say the assertion holds "the prop
  reaches the native view at the trigger's box", and add a G7b follow-up line: VoiceOver's name
  for the trigger, which is `OptionalMenuAccessibility`, is unguarded until real input.
- **M2 — `docs/components/menu.md:125` cites a test that does not exist.** It names
  `Menu.harness.tsx`, "reports the open and the close". The test that holds the pair and its
  order is `opens once, closes once, and pairs every open with a close` (`Menu.harness.tsx:965`).
- **M3 — the remount test's comments contradict their own measurements.**
  `Menu.harness.tsx:1390-1393` says the torn-down handle "is still answering. A wait that accepted
  'some handle has a size' would be satisfied here". `:1415-1418` says "What does the refusing
  differs by platform". Both are false on the round's evidence. The torn-down handle answers
  `0.00x0.00` on Android (`06-13-58Z`). On iOS, with the title guard deleted, the previous-mount
  probe was still refused: `06-20-03Z` goes red on the `NeverGiven` line (excerpt `:1448`, tip `:1453`), not on the previous-mount line (tip `:1419`), which ran first and passed, because `drop()` nils
  the host's size (`NitroSwiftUIHost.swift:333`). Say what holds instead: the leftover answers its
  old title and `0×0` on both platforms, so both rules refuse it; the title rule's own red is the
  `NeverGiven` probe.

## Nice to have (N)

- **N1 — one Android failure has no base evidence, and the report's description of it is
  wrong.** `harness+android-06-29-15Z` also failed
  `HostPopups › opens its dialog as a window of the Host's composition` with
  `expected -1 to be 1777593600000`. That is a value read, not a counter, so the report's "the
  `HostPopups` counter cases" (`G7a-menu.report.md:176`) does not describe it. It is absent from
  the review's base run, which filtered the Host suites only, and absent from `06-38-53Z` and from
  this review's `06-57-31Z`. It failed in 1 of 3 tip runs. In that run Menu's file ran *before*
  HostPopups in the same process (`resetEnvironmentBetweenTestFiles: 'runtime'`,
  `example/rn-harness.config.mjs:273`, so process-wide Kotlin state survives), at load max 16.5.
  In the two runs where HostPopups ran first, it passed. Nothing implicates Menu, whose counters
  are per-model and whose suite asserts its own `live` back to baseline. But it is the one red
  this branch cannot point at base for. Name it in the Host-suite task.
- **N2 — `registry.test.js:652-655`** asserts `switch` *leaves* the regions after the flip, but
  never asserts that it was in them before. It is there today (`bench/src/implementations/index.ts:72`,
  `scripts/bench/lib.mjs:407`), so the check passes for the right reason. One
  `ids.includes('switch') === true` line in the shipped loop would keep it from passing
  vacuously if Switch ever left the arm.
- **N3 — report Item 4 (`G7a-menu.report.md:118`)** still says both test hooks "run inline when
  already on the main thread and otherwise post". That is true of Android `nuiTestSelectRow`
  (`HybridNitroUiMenu.kt:1126-1130`). It is false of `nuiTestMenuReport`, which reads directly on
  both platforms. (The first review's N2 overstated this as "neither".)
- **N4 — public doc comments point at internal review files.** `Menu.nitro.ts:170-173` and
  `menu.md:126-127,143` cite "`docs/tasks/G7a-menu.review.md` decision 3/2" as open. When the
  owner rules, replace these with the ruling, or the shipped spec will keep saying the behaviour
  is undecided.

## Regressions: none found

- **`reset()` reorder.** `expanded` is a plain `mutableStateOf` (`HybridNitroUiMenu.kt:221`)
  written directly, not through `setOpen` (`:294` documents why), so moving it fires no
  `onClose` from inside a recycle. Nothing below it in `reset()` reads it. iOS's
  `prepareForRecycle` is untouched.
- **`applyPick` order.** The round did not change it (`setOpen(false)` at `:452`, then
  `onSelect` at `:465`). The round documented it and pinned it with `orderLog`, which is cleared
  in `afterEach` and in the remount test. The assertion sits after iOS's early return
  (`:995-1000`), so iOS is unaffected.
- The test file changed, and it was run on both platforms at this tree: the implementer ran it
  at `06-21-47Z` and `06-23-26Z`, and this review re-ran it.

## Is accepting with `need --for review` short only on `harness:android` justified?

**Yes, for review.** The ledger (`docs/tasks/G7a/gates.jsonl` plus this checkout's
`.gates/task/G7a-menu.jsonl`) shows the following on tree `84f0fd365c1c`:

- `check` and `harness:ios` are green, and `harness:{ios,android}:Menu` are green (15/15 each,
  twice).
- `harness:android` is red twice: `06-29-15Z` with 5 failures and `06-38-53Z` with 3. Every
  failure is in `Host`, `HostControls` or `HostPopups`, and none is in `Menu.harness.tsx`.
- Four of the five test names reproduce at base `747debc`, with the same messages
  (`<store>/detached/harness+android+Host-2026-10-29T05-28-11.725Z.log`, first review).
- The round's Android diff is one moved line in `MenuModel.reset()`.

The fifth failure (N1) is intermittent, in the same file, and not tied to Menu.

**For merge, `need --for merge` will also be short**, on the full harness and on
`real-input:*`, which belongs to G7b. The orchestrator should accept that explicitly on the same
basis and open the mac-1 Host-suite task. A merge should not be read as a green full harness.

## Owner decisions needed

1. **iOS `onOpen`/`onClose`: confirmed as written.** The SDK 27.0 `Menu` has no expansion
   binding. Recommend (a): accept as Android-only, amend D29, and make the
   `.onAppear`/`.onDisappear` attempt a G7b spike.
2. **iOS `disabled` while open: confirmed.** The docs now carry the limit (`menu.md:135-143,261`).
   Recommend accepting it and amending D29's third bullet.
3. **A pick fires `onClose`: amended.** The pairing and the order (`onClose` then `onSelect`)
   are no longer just the code's behaviour. They are now *documented* in the shipped spec
   (`Menu.nitro.ts:168-169`) and *pinned* by `orderLog`. Rule before merge, so the spec does not
   ship saying "open with the owner". Keeping the pairing is still recommended. If the owner
   chooses `onSelect` first, the change is a two-line reorder in `MenuModel.applyPick`, the
   `orderLog` expectation and the doc sentences, followed by `harness:android:Menu`.
4. **`menuAnchor`/`ExposedDropdownMenuBox`: amended.** The first review's N5 was not done. The
   hosted test's first half still does not discriminate, and no plain-`DropdownMenu` comparison
   is committed. Recommend accepting, with the sign-off conditional on G7b adding the upper bound
   (`mTop - aBottom < 48 px`) and a committed red run with a plain `DropdownMenu`. Record that in
   `FOLLOWUPS.md` rather than in the approval itself.

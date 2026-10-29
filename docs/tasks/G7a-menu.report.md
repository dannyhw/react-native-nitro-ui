# G7a - Menu (button-anchored): native control, harness, sizing, a11y, Host

**Branch:** `task/G7a-menu` (from `main` at `747debc`) - **Round:** 1 of up to 3 (D19) -
**Lease:** `G7a-wpvyy` (iPhone 17 / iOS 27 + `emulator-5574` / API 35, Metro `8295`)

## Summary

A Menu is a Button's box with a system menu behind it, shipped as D29 describes: open state is native-owned (no `open()`/`close()`), content is a nested `group` with one submenu level, `primaryAction` is iOS-only, and `disabled` while open closes the menu. Registered through X3: `component.json` + `bun run regen` for the spec, autolinking, sizing, API report and pack manifest. Hand-written: `Menu.nitro.ts`, `Menu.tsx` (Button's sibling, no `useControlled`, a memoised `group` so props diff by identity), `NativeNitroUiMenu.ts`, SwiftUI and Compose implementations, `docs/components/menu.md`, the example screen, a minor changeset. The `group` is deliberately *not* in the sizing key: a longer list must not re-lay-out the trigger - a claim a Button cannot make.

Two decisions to read before the diff.

**Android anchors with `menuAnchor`, which Q1 section 3 ruled out.** A bare `DropdownMenu` positions on the composition, and inside a `<Host>` the composition is the Host's rect - measured, the list opened at the Host's edge, not under its button. `ExposedDropdownMenuBox` + `menuAnchor` makes "opens under its own button" true plain and hosted; H2b's dismissal-on-move handling rides the same chain (`placedViewOf`, widened to `internal` in `HybridNitroUiPicker.kt` so both popup controls walk it identically).

**`onOpen`/`onClose` are Android-only, and documented as such.** A SwiftUI `Menu` hands its list to the system, so the composition owns no window: iOS returns `-1` for open state, live count and both rects, as `HybridNitroUiPicker` does, and `docs/tasks/G2-button.report.md` measured that a synthesised touch reaches no SwiftUI button style. So open/close counts, `disabled`-while-open and inline-vs-nested are Android assertions; iOS asserts the box, picks, a11y read-back and the `-1`s.

The trigger's chrome was found broken and fixed, not shipped right first time: the first iOS build set `.menuStyle(.button)` with no `.buttonStyle`, leaving the trigger at the *label's* text box - 53.33 x 20.33 pt against Button's 77.33 x 34.33, read out of a probe - and every sizing gate stayed green, because each only requires a box to be *earned*. `e660e8a` applies Button's per-variant style; `fc844fd` adds the gate that would have caught it. Heights now equal Button's (iOS 34.33 pt regular / 20.33 text / 28.00 small / 50.33 large; Android 48.00 dp, 50.29 large) - on Android because one `NitroUiM3Button`, extracted from `HybridNitroUiButton.kt`, backs both controls.

`harness:android` is red and not from Menu: 4 failures of 232, none in `Menu.harness.tsx`, whose own suite is 15/15 on both platforms. Three reproduce at the base commit here - see under the table.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1112 tests / 42 suites | `1515f2ab3b65` | 1 m 55 s | start 5.2 / med 7.7 / max 10.3 |
| `harness:ios` | **PASS** | 183 tests / 14 suites | `1515f2ab3b65` (ios tree) | 5 m 47 s | start 7.1 / med 4.1 / max 7.1 |
| `harness:android` | **FAIL** | 4 failed of 232 tests / 14 suites | `1515f2ab3b65` (android tree) | 9 m 14 s | start 2.7 / med 3.6 / max 9.0 |
| `real-input:ios` | missing | - | - | - | - |
| `real-input:android` | missing | - | - | - | - |
| `harness:android:Host` | stale | 3 failed of 69 tests / 3 suites | 7ac4d0bd4961 (not this tree) | 4 m 37 s | start 3.8 / med 3.9 / max 4.9 |
| `harness:android:Menu` | **PASS** | 15 tests / 1 suites | `1515f2ab3b65` (android tree) | 29.9 s | start 2.9 / med 4.8 / max 5.5 |
| `harness:android:Menu:Menu` | stale | 2 failed of 13 tests / 1 suites | 27009f2a63ac (not this tree) | 29.7 s | start 3.8 / med 5.1 / max 5.3 |
| `harness:ios:Menu` | **PASS** | 15 tests / 1 suites | `1515f2ab3b65` (ios tree) | 15.6 s | start 5.6 / med 5.1 / max 5.6 |

`need --for review`: `need: 1 gate(s) missing for review: harness:android` (`check` green,
`harness:ios` green on the ios tree, `harness:android` red). The two `stale` rows are the
witness/`Host` diagnostic runs made on the pre-parity tree; every row that matters is at
`1515f2ab3b65`. `real-input:*` is missing because the brief puts Menu's real-input case in G7b.

**Why `harness:android` cannot go green here.** The 4 failures are
`Host > lays a re-framed hosted child at its Yoga frame (F8)` and
`HostControls > follows mixed children that are removed and added` (both
`Test timed out after 30000ms`), plus
`HostPopups > comes down with its row, and leaves nothing when the Host is dropped`
(`expected 1 to be 0`) and
`HostPopups > presents a dialog for the time and datetime modes too`
(`expected 0 to be 1`). None is Menu. All four fail **at the base commit on this
machine**: the review checked `747debc` into a throwaway worktree, built it from scratch and
ran the Host suites there — `4 failed / 24 skipped / 41 passed of 69`, the same four
messages, store log `detached/harness+android+Host-2026-10-29T05-28-11.725Z.log` — so this is
not a G7a regression. The `3 failed / 190 passed / 217` base run quoted here in round 1 has no
committed log and is withdrawn: the review's run is the evidence, and it says `HostControls`
fails at the base too. Nor is this load — the review counted these four failing in 6 of 6 runs
here at load 3 and above, with a constant 24 skipped where X3 and X11 saw none. The house
record agrees on the mechanism: `docs/tasks/Q3-flaky-tests.md` section 2 documents
that HostPopups case as `expected 1 to be 0` from the process-wide
`DatePickerModel.livePresentations` assertion, and its follow-ups say the other Host
observations "are the same family, not this task's"; `docs/tasks/FOLLOWUPS.md` lists
HostPopups among the mac-2 intermitcents. Counters are per component
(`MenuModel.liveMenus` vs `DatePickerModel.livePresentations`) - a reading, and the reason
Menu cannot move that number. Recommendation in Questions.

## Red proofs

No `mutations.json` helper exists at this base, so each line names a run by the timestamp
in its exported log name (`05-06-34Z` is
`docs/tasks/G7a/failures/2026-10-29T05-06-34Z--harness+android+Menu--01.log`). All 15
tests were shown red; the mutation is the smallest thing that removes the behaviour the
test claims.

- `lays each configuration out at the size the control measured` -> `sizingVariantFor` returns a constant -> `testID "cfg-filled" (cfg-filled) never reached 92.57x48.00 - last box 108.57x50.29, control measured 92.57x48.00` (`03-16-46Z`)
- the same gate's correction half -> corrections counter faked `+100` -> `expected 7 to be greater than or equal to 107`, both platforms (`03-35-02Z`, `03-35-55Z`) - so `>= 7` cannot be satisfied by cached hits
- `re-measures when the title changes (R3)` -> `sizingVariantFor` returns a constant -> `expected 1 to be greater than or equal to 2` (`03-16-46Z`)
- `takes exactly the box its Button twin takes` -> iOS: `styledMenu` dropped from `MenuContent.body` (the state `e660e8a` replaced) -> `expected false to be true`, 1 failed / 14 passed (`04-43-37Z`); Android: the trigger's `variant = model.variant` pinned to `ButtonVariant.Text` -> same line, 1 failed / 14 passed (`04-44-37Z`)
- `keeps the trigger when only the list changes` -> `group` folded into the sizing key -> `expected 1 to be +0` (a fresh cache entry for the same box), Android `03-33-28Z` and iOS `03-34-38Z`
- `reports one onSelect per pick and nothing for a row that cannot be picked` -> `applyPick` stops consulting `row.disabled` -> `expected [ 'pick:paste' ] to deeply equal []`, Android `03-21-30Z` and iOS `03-24-45Z`
- `opens once, closes once, and pairs every open with a close` -> `onOpen?.invoke()` removed -> `"the open" reported 0 of 1 expected events within 8000ms: nothing.` (`03-20-42Z`); and -> `MenuWitness` not composed -> `last read {"expanded":true,"live":0,...}`, 9 failed of 14 (`03-29-50Z`)
- `closes when it is disabled while the menu is open` -> `onOpen?.invoke()` removed -> `expected [ 'disable:close' ] to deeply equal [ 'disable:open', 'disable:close' ]` (`03-20-42Z`)
- `renders a submenu inline on Android and nested on iOS` -> `Menu.tsx`'s `flattenGroup` stops emitting a submenu's children -> `expected 4 to be 6`, 5 failed of 13 (`03-17-39Z`)
- `relays the rows when the group changes while it is open` -> the `rows` setter applies only while the model's rows are empty -> `Menu report for "shrink" never matched within 12000ms; last read {"expanded":true,"live":1,...,"rows":6}` (`05-06-34Z`)
- `leaves nothing behind when a Menu with an open menu is dropped`, `comes down when its hosted child leaves the Host`, `carries no old state across a remount` -> `live.decrementAndGet()` removed from `MenuWitness`'s `onDispose` -> `Menu report for "hosted-survivor" never matched within 12000ms; last read {"expanded":false,"live":9,...}` and `expected 7 to be 6`, 9 failed of 15 (`05-07-32Z`)
- `opens under its own button, and follows it when the Host moves` -> `noteCompositionOrigin` records its box without `dropOpenMenu()` -> the anchor moved to `y=315` while its window stayed at `142`: `Menu report for "hosted-menu" never matched within 12000ms; last read {"expanded":true,"live":1,"anchor":[0,315,245,441],"menu":[0,142,245,1094],...}`, 1 failed of 14 (`03-28-24Z`)
- `takes its window down when its button moves inside the Host` -> `noteAnchorBox` records without `dropOpenMenu()` -> `Menu report for "pair-menu" never matched within 12000ms; last read {"expanded":true,"live":1,...}`, 1 failed / 13 passed (`03-50-17Z`)
- `reports what React sent, and what the trigger is for a screen reader` -> the a11y read-back getters always answer null -> `expected null to be 'Open the actions'`, Android `03-31-57Z` and iOS `03-33-08Z`

The measurements in the Summary are probes, not tests: each was read out of a temporary
throwing assertion (`expected 'SIZES cfg-filled=53.33x20.33 ...' to be 'PROBE'`, iOS
`03-38-11Z`; `cfg-filled=92.57x48.00`, Android `03-37-12Z`) and reverted.


Added by fix round 1, each from a run on the branch:

- `reports what React sent, and what the trigger is for a screen reader` -> clear
  `accessibilityLabel` off the component view in `afterUpdate()`, leaving the prop, the model
  and the SwiftUI element alone -> `expect(namedElement).not.toBeNull()` red with all six
  getters green (`…ios+Menu-06-20-03.611Z`).
- `carries no old state across a remount` -> drop `|| handle.title !== wantTitle` from
  `waitForFreshMeasure` -> `expected 'answered' to contain 'never answered as
  "NeverGiven"'` (`…android…06-14-44.443Z`, `…ios+Menu-06-20-03.611Z`).
- `re-measures when the title changes (R3)` -> plant `measureContent()` answering `0x0`
  mid re-measure -> the wait times out naming `0.00x0.00` (`…android+Menu-05-56-58.091Z`).
- `opens once, closes once, and pairs every open with a close` -> report the pick before
  closing the popup in Kotlin `applyPick` -> only `expect(orderLog)` red
  (`…android…-t+opens+20once-05-59-57.018Z`). **Superseded by D32**: that order is what
  ships now, so round 2 pinned the opposite with `MenuModelTest` — see Fix round 2.
- the host-arm case -> drop `&& m.bench === true` from `hostArm()` -> `registry.test.js:643`
  red with `menu` present in the region (`1 failed / 36`).
- Not a red proof, recorded because it is what M3 was for: with a leftover `live: 1` planted,
  the old absolute `live === 0` read goes red (`05-56-58Z`) and the `liveBefore` delta stays
  green (`05-58-32Z`).

## Item 4 - the perf contract

A **reading**, no new code and no measurement: every setter stores then marks the host
dirty, and `afterUpdate()` performs one `host.commit()`; nothing calls `setContent` or
reassigns a `rootView`, so no recycling path recreates a hosting; `useMenuRows` keys its
cache on the signature so `group` identity is stable across re-sends; both
`prepareForRecycle()`s enumerate every model field (checked against the declarations, not
counted); `onDropView` nulls the four callbacks and drops the host. The two hooks
`nuiTestMenuReport` and `nuiTestSelectRow` run inline when already on the main thread and
otherwise post, which is why the suite's counts are exact rather than eventually.

## Files changed

- Spec, wrapper, registry: `src/components/Menu/component.json`, `Menu.nitro.ts`, `Menu.tsx`, `NativeNitroUiMenu.ts`, `NitroUiMenuConfig.ts`, `src/index.ts`, `scripts/registry-core.mjs`, `src/components/Host/HostChildren.ts`, `nitro.json`, `nitro-ui.sizing.json`, generated `nitrogen/generated/**`
- iOS: `ios/components/Menu/HybridNitroUiMenu.swift`, `ios/core/NitroUiDeclaredFallbacks.swift`
- Android: `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiMenu.kt`, `HybridNitroUiButton.kt` (the shared `NitroUiM3Button`), `HybridNitroUiPicker.kt` (two helpers widened to `internal`), `NitroUiPackage.kt`, `NitroUiDeclaredFallbacks.kt`
- Harness and example: `example/__tests__/Menu.harness.tsx` (15 tests), `example/src/MenuScreen.tsx`, `example/src/App.tsx`
- Docs and packaging: `docs/components/menu.md`, `etc/react-native-nitro-ui.api.md`, `etc/package-files.txt`, `.changeset/menu-button-anchored.md`, `scripts/__tests__/component-coverage.test.js`, `src/__tests__/viewConfigs.test.ts`
- Evidence: `docs/tasks/G7a/gates.jsonl`, `docs/tasks/G7a/failures/*.log`

## Follow-ups

- G7b: bench arm, real-input case, Storybook story and smoke, all per the brief; flipping `bench: true` in `component.json` is what returns Menu to the Host bench arm (see Questions 5).
- G7b: iOS row chrome - whether the trigger's `.buttonStyle` leaks into the system-presented rows is unmeasurable here; if the real-input screenshot says it does, the one-line fix is `.buttonStyle(.plain)` on the row content.
- `README.md`'s component table has no Menu row; adding one needs a version number this release does not have yet.
- Q3-family: the four Host/DatePicker Android tests need their own task (Summary and Questions).
- Two lint warnings predate this task and were left alone: `no-shadow` in `scripts/__tests__/registry.test.js:651`, unused `join` in `scripts/harness-suite-timing.mjs:25`.
- Fix round 2 changed `Menu.harness.tsx`'s `orderLog` expectation without a device run (both lease pairs busy), so `harness:ios` and `harness:android` at merge are what prove the new order on-device; `MenuModelTest` proves it off-device meanwhile.

## Questions for orchestrator

1. **`harness:android` is unreachable on this machine, not merely unrun.** All four of its failures reproduce at `747debc` here - including `HostControls`, which round 1 of this report wrongly said had passed at the base; see the correction in Gates. Options: accept G7a on `check` + `harness:ios` + `harness:android:Menu` (15/15) + the base-run evidence; or open a fix task for the Q3-family tests first; or move G7a to another machine. **Recommend accept here and file the task** - a third machine has the same house-documented intermittents.
2. **iOS `onOpen`/`onClose` cannot be observed**, for the two measured reasons in the Summary, so both props are Android-only today and `docs/components/menu.md` says so. Options: accept; or ship an own-drawn UIKit trigger with `UIContextMenuInteraction` to keep observation (a different control from the one Q1 section 2 chose); or drop the props. **Recommend accept + the documentation as written.**
3. **A pick fires `onClose`.** Q1 section 5 says `onOpen`/`onClose` "exactly once each and never for a pick". A pick dismisses the popup, and the popup's teardown is what reports the close, so refusing to fire would leave the open unpaired - which is worse for a listener than an extra close. The suite asserts the pairing (`['events:open', 'events:close']`) and says so at `example/__tests__/Menu.harness.tsx:960`. **Recommend keeping the pairing and amending Q1.**
4. **`menuAnchor` deviation from Q1 section 3** - documented at `docs/components/menu.md` and above. Needs sign-off, since it is the one place the implementation visibly contradicts the design document rather than filling a gap in it.
5. **Registry decoupling.** `hostArm()` in `scripts/registry-core.mjs:619` now reads `hostable && bench` rather than `hostable`, because Menu is `hostable: true, bench: false` and regenerating the bench arm under the old rule would have claimed an arm that does not exist. G7b's `bench: true` restores it. **Recommend confirming this is the right factoring rather than a Menu-shaped special case.**
6. **`realInput: false` against Q1 section 5**, which lists `realInput: true` in the same sentence as "makes X4's four rules". The brief gates this task with no real-input case, and X4 exists at this base only as `docs/tasks/X4-conformance.md` plus a context pack - there is no conformance suite to run - so nothing silently under-runs today. **Recommend confirming `realInput: true` is G7b's commit, not this one's.**
7. **`onClose` on `disabled`-while-open** is asserted on Android only (same observability limit as 2). If a reviewer wants that guarantee on iOS too, it needs the UIKit trigger from 2, not a smaller change.

## Fix round 1

**Round:** 1 of 2 (D19) · review `docs/tasks/G7a-menu.review.md` at `7d9df2d`, verdict FIX
ROUND. Lease `G7a-424pv`.

| Item | Commit | What it became |
| --- | --- | --- |
| M1 | `02eac4f` | the a11y test reads the tree, Progress/Slider's pattern |
| M2 | `48fe182` | both remeasure waits refuse a wrong answer, and prove it |
| M3 | `22f02a1` | the leftover-menu read is a `liveBefore` delta |
| M4 | `0f4954a` | `expanded = false` is the reset's first write |
| M5 | `7162f87` | spec + docs + an `orderLog` assertion: a pick fires `onClose`, first |
| M6 | `322059c` | `disabled`-while-open documented as an Android-only limit |
| N | `b817df2` | `hostArm()` pinned by a registry case |
| docs | `25d1dba` | the a11y section split measured from read (review N10 inside) |

Two measurements narrowed M1 and M2, and `9a6dc90`/`4a601f3` are superseded on both. The iOS
a11y walk lands on the RN component view, which RN labels itself, so the read holds "the name
is on the element at the trigger's box" and nothing about the SwiftUI modifier; iOS's remount
answers through the *same* JS handle object, so the wait asks for a title instead of an
identity. Both refusals are now asserted in the test, not described in a comment. The new red
proofs are in the section above.

**The base claim is corrected above** — in the Gates prose and in Question 1. The review built
`747debc` from scratch and all four Android Host failures reproduce there, `HostControls`
included; round 1's `3 failed / 190 passed / 217` base run was never committed as a log and is
withdrawn. Question 1's recommendation stands, on stronger evidence.

**`need --for review`**: `need: 1 gate(s) missing for review: harness:android` - `check` green and `harness:ios` green on this tree, `harness:android` red on it, `real-input:*` deliberately absent (G7b). Two full `harness:android` runs landed here, **5 failures then 3** - `F8`, `HostControls` and `HostPopups` cases in different combinations (the `HostPopups` counter cases, plus "opens its dialog as a window of the Host's composition" once, which has no base run to compare against; re-review N1), `harness+android-06-29-15Z` and `-06-38-53Z`. The count moves, the family does not, and neither run has a Menu failure: both `harness:*:Menu` suites were 15/15 on the same tree.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1113 tests / 42 suites | `84f0fd365c1c` | 1 m 59 s | start 10.0 / med 11.2 / max 14.4 |
| `harness:ios` | **PASS** | 183 tests / 14 suites | `84f0fd365c1c` (ios tree) | 2 m 10 s | start 7.6 / med 5.4 / max 7.8 |
| `harness:android` | **FAIL** | 3 failed of 232 tests / 14 suites | `84f0fd365c1c` (android tree) | 9 m 37 s | start 3.9 / med 4.7 / max 5.7 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:android:Host` | stale | 4 failed of 69 tests / 3 suites | 1515f2ab3b65 (not this tree) | 5 m 35 s | start 108.6 / med 18.3 / max 108.6 |
| `harness:android:Menu` | **PASS** | 15 tests / 1 suites | `84f0fd365c1c` (android tree) | 35.3 s | start 5.3 / med 6.2 / max 6.4 |
| `harness:android:Menu:-t:opens%20once` | stale | 1 failed of 15 tests / 1 suites | d3ac5d7c66a9 (not this tree) | 19.8 s | start 4.5 / med 4.5 / max 4.6 |
| `harness:android:Menu:-t:remount` | stale | 1 failed of 15 tests / 1 suites | d5625f3ef35e (not this tree) | 16.2 s | start 4.5 / med 4.8 / max 4.8 |
| `harness:android:Menu:Menu` | stale | 2 failed of 13 tests / 1 suites | 27009f2a63ac (not this tree) | 29.7 s | start 3.8 / med 5.1 / max 5.3 |
| `harness:ios:Menu` | **PASS** | 15 tests / 1 suites | `84f0fd365c1c` (ios tree) | 16.9 s | start 6.5 / med 6.5 / max 6.5 |

## Owner decisions

Four points change what D29 or Q1 promise rather than filling a gap in them, so they go to the
owner rather than being decided here. Nothing below edits `docs/DECISIONS.md` or
`docs/tasks/Q1-menu-design.md`.

**Ruled since, in D32** (2026-10-29): 1 and 2 as recommended — `onOpen`/`onClose` are
Android-only and iOS never fires them, and `disabled`-while-open closes the menu on
Android only, both as documented platform limits. 3 was ruled the other way from what
this section describes as shipping: **a pick fires `onSelect` first, then `onClose`**,
and every open is paired with one close including a pick's. 4 is still open. Fix round 2
below carries the change.

1. **iOS `onOpen`/`onClose`.** D29 says open state is "observed through `onOpen`/`onClose`",
   with no platform split. iPhoneOS SDK 27.0 gives SwiftUI's `Menu` no expansion binding
   (checked in the swiftinterface), so neither ever fires on iOS and the harness asserts the
   `-1` answer. Options: accept as Android-only and amend D29; have G7b try
   `.onAppear`/`.onDisappear` on the menu content, a workaround this task did not verify; or a
   UIKit `UIContextMenuInteraction` trigger, which is a different control from Q1 §2's.
   **Recommend accept + amend, with the `.onAppear` attempt as a G7b spike.**
2. **A `disabled` that arrives while the menu is open.** D29 says it closes the menu; iOS
   neither enforces nor observes it, for the same SDK reason, so an iOS menu can stay on screen
   over a disabled trigger. **Recommend accept as a documented iOS limit and amend D29** —
   "Limits" in `docs/components/menu.md` now says it.
3. **A pick fires `onClose`, before `onSelect`.** Q1 §5 words the pair as "exactly once each
   and never for a pick". The popup's teardown is what reports the close, so not firing would
   leave an unpaired open, which is worse for a listener than an extra close. **Recommend keep
   the pairing and amend Q1, and choose the order on purpose.** What shipped at round 1 was
   `onClose` first (set in `MenuModel.applyPick`, held by the `orderLog` assertion); **D32
   rules the other order** — `onSelect` first, then `onClose` — which fix round 2 implements.
4. **`menuAnchor` / `ExposedDropdownMenuBox` on Android**, reversing Q1 §3's explicit "no
   `menuAnchor`". **Recommend accept**, with the review's N5 caveat attached: the evidence is
   thin — the plain-`DropdownMenu` comparison was measured and not committed, and the hosted
   test's first half does not discriminate — so the sign-off rests on the reasoning written at
   `docs/components/menu.md:143` until a committed comparison exists.

## Fix round 2 (maintainer-mac-2)

**Round:** 2 of 2 (D19) · re-review `docs/tasks/G7a-menu.rereview.md` (`e6cf340`). No
lease: both pairs busy; device gates run at merge.

| D32 ruling | What changed |
| --- | --- |
| `onOpen`/`onClose` Android-only — iOS never fires them | Spec, `Menu.tsx`, `src/index.ts`, `menu.md` (those rows read "never", not "no"), changeset, example screen. Docs only. |
| `disabled` while open closes on Android only | Same documents, as an accepted limit, not an open question. Docs only. |
| A pick fires `onSelect`, then `onClose` | `MenuModel.applyPick` reports, then `setOpen(false)` — this round's only behaviour change. Its KDoc, the iOS `applyPick` comment, the spec, `menu.md` and the harness `orderLog` (`open`, `select`, `close`) follow. |

The close still happens on every path — pick, disabled control, disabled row, submenu
header, unknown id.

**Red proof.** That order needs a device, so it is pinned off-device too: new
`MenuModelTest.kt` (4 tests, `test:native:android` — not in `check`), each red then
reverted. Pre-D32 order restored -> `expected <[select:copy, close]> but was
<[close, select:copy]>`, the close-on-every-path test still green; a refusal
returning early -> `row "paste" … expected <[close]> but was <[]>`; `setOpen` dropped ->
all 4. Final: 58 JVM tests, 0 failures. M1–M3 and N1–N3 stay open.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1163 tests / 45 suites | `0b60a6a10edd` | 2 m 36 s | start 2.5 / med 4.0 / max 5.7 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

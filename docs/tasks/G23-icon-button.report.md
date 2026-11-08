# G23 — IconButton

**Branch:** `task/G23-icon-button` (from `main` at `b8b6ef1c`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `G23-zcs2m` (`iPhone Air` / iOS 27 + `emulator-5570` / API 35 · Metro 8293)

## API

```tsx
<IconButton
  accessibilityLabel="Search"   // required: the control's only name (empty warns in dev)
  systemImage="magnifyingglass" // iOS: the SF Symbol
  androidIcon={require('./icons/search_24px.xml')} // Android: Metro asset or drawable name (D43)
  onPress={openSearch}
  variant="standard" | 'filled' | 'tonal' | 'outlined'
  size="medium"                 // small … xxlarge — the shared ladder (D42 item 4)
  width="uniform"               // Android only: narrow | uniform | wide
  shape="round" | 'square' | null
  disabled={false}
  tintColor={…}
  testID="…"
/>

// The toggle form, chosen by which of these three is present — never by a default:
checked / defaultChecked / onCheckedChange   // the event-count handshake (§4)
```

Every native prop is always passed (no optional Hybrid View props, nitro#1184). The size
configuration is `variant | size | width | form | systemImage | androidIcon`.

## Summary

IconButton ships on both platforms: Material's four `…IconButton` composables and the four
matching `…IconToggleButton`s, with the `shapes` overloads and colours cached per scheme;
on iOS a `Button` plus `Label(…).labelStyle(.iconOnly)`, or
`Toggle(…).toggleStyle(.button)`, with `outlined` a hairline over `.bordered` — iOS has
none. The glyph goes through G19's icon path — one resolver, one cache.

Two measurements decided the native shape, both against Material's artifact:

- **Android asks for the rung on the control's own modifier.** Each composable builds its
  Box as `minimumInteractiveComponentSize().size(<token>)` and `Modifier.size` coerces into
  the constraints it is given, so a container asked for *inside* the content is measured
  under the `small` token — the first device run brought `48.00x48.00` for all fifteen
  configurations. The laid-out box is `max(token, 48)` per axis, asserted against Material's
  tokens; the docs page prints token and box side by side.
- **iOS sizes the symbol.** `.controlSize` alone turned five rungs into two boxes
  (15.33 × 15.00 and 17.67 × 16.00), so the rung sets the symbol's point size to Material's
  glyph token: the ladder is the *glyph* ladder, so `medium` and `large` (24 pt both) are
  one box, which the docs print rather than hide. The declared fallback is the measured
  **25 × 23 pt**; the first row's off-device 32 × 32 went red on it. (Superseded in fix round
  1: the declared fallback is the 44 pt target, which every rung is laid out at.)

`form` (press or toggle) is in the size key: different native controls — one configuration
is 31.67 × 30.00 pt as a `Button` and 41.67 × 30.00 pt as a `Toggle(.button)`. (Superseded in
fix round 1: both of those are under the 44 pt target, so at that rung they lay out as one box;
the form test moved to `xxlarge`, where the two configurations are two numbers again.)

The a11y sweep's one finding is recorded, not fixed: the name is on the right element —
`button`, enabled, hittable — 2 px off the box, because SwiftUI keeps a `Button`'s own
integral width inside a host React Native laid out at 39.67 pt. The exemption quotes the
measured numbers, so a moved name stays red and the row retires itself when they change;
the device's tree is a fixture and the matrix marks the cell failing. (Superseded in fix round
1: the 44 pt target made that inset *bigger* rather than retiring the row, and the fractional
width was never the cause — the appendix has the re-measurement.)

Also: the registry entry, stories, both README screenshots, the docs page, a changeset,
`<Host>` refusing the control by name, and two fixes the work needed — the story's Metro
asset path (a wrong `require` killed the Storybook entry) and the fixture tool, which could
not reach a tab past the strip's end.

**Bench:** `mount.icon-button` arms are in for all three libraries; the bench is minted at
merge (X14), so there are no numbers to report.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1897 tests / 77 suites | `fe51f826b4c3` | 2 m 43 s | start 3.4 / med 6.2 / max 7.1 |
| `harness:ios` | **PASS** | 483 tests / 26 suites + isolated 4 tests / 2 suites | `fe51f826b4c3` (ios tree) | 11 m 25 s | start 6.3 / med 4.2 / max 8.2 |
| `harness:android` | **PASS** | 539 tests / 26 suites + isolated 4 tests / 2 suites | `fe51f826b4c3` (android tree) | 15 m 55 s | start 5.7 / med 4.0 / max 12.9 |
| `real-input:ios` | **PASS** | — | `fe51f826b4c3` (ios tree) | 30 m 45 s | start 3.8 / med 6.3 / max 57.2 |
| `real-input:android` | **PASS** | — | `fe51f826b4c3` (android tree) | 45 m 47 s | start 3.7 / med 3.5 / max 10.8 |
| `harness:android:IconButton` | stale | 1 failed of 10 tests / 1 suites | 2544115e860d (not this tree) | 33.4 s | start 7.7 / med 9.8 / max 10.8 |
| `harness:ios:--:IconButton` | stale | 0 tests / 1 suites | 651e8b4370d0 (not this tree) | 2.5 s | start 13.9 / med 14.4 / max 14.8 |
| `harness:ios:Conformance` | stale | 1 failed of 85 tests / 1 suites | 95f0b1ddd95a (not this tree) | 2 m 49 s | start 36.3 / med 13.5 / max 36.3 |
| `harness:ios:IconButton` | stale | 1 failed of 10 tests / 1 suites | 492cc25ac10f (not this tree) | 15.2 s | start 8.0 / med 7.3 / max 8.0 |
| `real-input:android:--control:icon-button` | stale | — | 7c3724206844 (not this tree) | 11 m 07 s | start 4.1 / med 5.9 / max 40.4 |
| `real-input:ios:--control:icon-button` | stale | — | eed76b19d532 (not this tree) | 8 m 35 s | start 5.8 / med 9.3 / max 22.9 |
| `real-input:ios:--control:icon-button:--background` | stale | — | a934074ba03b (not this tree) | 0.6 s | start 12.2 / med 11.9 / max 12.2 |
| `real-input:ios:icon-button` | stale | — | d736daa2ed97 (not this tree) | 0.5 s | start 17.4 / med 17.4 / max 17.4 |

Fix round 1 re-ran the whole bar on one code tree, `fe51f826b4c3`, with all five gates green on
it; `need --for review` is satisfied on it. The stale rows are this round's filtered and mutation
runs — the two `IconButton` harness rows are the glyph/form mutations, `harness:ios:IconButton`
also carries the throwaway assertion that measured the two forms at `xxlarge`, and
`real-input:ios:--control:icon-button` is the run that measured the a11y inset with the debt row
deleted. They stay in the ledger because a round's red lines are evidence, not noise. The merge round's table is in "Merge round" below.

## Red proofs

Thirty-one rows (ten added in fix round 1), each with the verbatim `before`/`after` text and
the failing line, in `docs/tasks/G23/mutations.json`. The short form (`test -> mutation -> red line`):

- `harness:android` ladder -> `width` leaves the size key -> `rung-medium-narrow … never reached
  48.00x48.00 - last box 52.19x48.00`
- `names the control…` -> the `contentDescription` leaves the composition -> `expected
  'role=Checkbox,selected=none,toggle=Of…' to contain 'label=Bookmark this'`
- `reverts a toggle JS refused…` -> the flip is reported with a constant event count ->
  `"refusing" never drew displayed=0` (the same mutation on iOS, same red line)
- `draws the glyph in the control content colour…` -> the tint is a constant, `disabled` included
  -> `expected 642 to be +0`
- the missing-glyph case -> an unresolvable painter throws instead of drawing nothing -> `Test
  suite failed to run: The app bridge disconnected during test execution`
- `aRecycledModelHandsOnAnEmptyGlyphSlot…` -> `iconSlot.reset()` removed from the model reset ->
  `AssertionError at IconButtonModelTest.kt:190`; the slot's `generation` bump removed -> the same
  test at `:203`
- `a11y:icon-button` (XCUITest) -> the `Label`'s title becomes a constant -> `no element other
  than the React Native wrapper is announced as "Real-input icon button"`
- the iOS real-input case -> a press fires twice -> `XCUITest reported "failed" for
  testRealInputIconButton`, and in the harness `expected [ 'press-once:press', …(3) ] to deeply
  equal [ 'press-once:press', …(1) ]`
- the Android real-input case -> a tap fires twice -> `3 real taps left
  real-input-icon-button-presses at "6" rather than "1"`
- `the iOS debt rows` (a11y) -> the new `icon-button` debt row matches `/^/` ->
  `expect(moved.failures).toHaveLength(1)` received `0`: a row that matches anything
  excuses a name that has genuinely moved
- the same row -> matches a sentence the rule never prints -> `expect(shipped.failures)`
  `.toEqual([])` received the measured finding, and the row's own `matches` test went red
- the same row -> pins the vertical coordinate too ->
  `row.matches.test(sentence("16.50, 412.67, 39, 39", DRAWN))` `toBe(true)` received false
- the same row -> deleted -> the measured finding is a failure again, and the debt list is
  one row short in `real-input-a11y` *and* in the matrix's two views of it
  (`conformance.test.js`, `component-coverage.test.js`)
- the barrier step, organic again -> the helper's own guard against this callsite: the step
  waited on the toggle's `"on"` and passed `atLeast`, a counter-only option -> `icon-button:
  FAIL (no retries) — failed: the barrier tap on the enabled toggle: atLeast needs a counter,
  and "on" is not one`. Fixed by dropping `atLeast`; green in
  `real-input:android:--control:icon-button` as `expected on, saw on`.
- organic, i.e. the test red against the real bug before its fix: the iOS glyph ladder
  (`expected 15 to be greater than 15`), the Android container asked for inside the content
  (`expected 48 to be greater than 48`), `form` missing from the key
  (`state-press … never reached 31.67x30.00 - last box 41.67x30.00`), the declared fallback
  (`the fallback 32x32 is not the measured 25x23`), and `check` red while the component was prose
  (missing screenshots, missing a11y fixture).


Fix round 1 (`"round": 1` in the same file):

- `harness:ios:IconButton` -> the latch back (`defaultChecked != nil || model.isToggle`) ->
  `"form-off" never drew displayed=none - it reports "displayed=1;…;control=40.67x38.00"`.
- `harness:android:IconButton` -> the same latch in Kotlin -> the same `displayed=1` line, one run
  shared with the two glyph rows below.
- `harness:ios:IconButton` -> `minimumTouchTarget = 0` -> `small: the glyph measures
  20.33x19.00 … so the box is 44.00x44.00 and not 20.33x19.00`.
- `real-input:ios:--control:icon-button` -> the tappable layer behind a bordered control removed
  -> `RealInputTests.swift:3418 … should be laid out at the 44 pt target before a corner is aimed
  at, got 39 x 39`.
- `harness:android:IconButton` -> the glyph pinned to `mediumIconSize` ->
  `expected 1 to be greater than 1.5` (the span line, asserted first on purpose).
- `harness:android:IconButton` -> `XLarge -> mediumIconSize` -> `large -> xlarge … (642 -> 642):
  expected 1 to be greater than 1.05` — only the step loop sees a single flattened rung.
- `harness:android:IconButton` -> the dev-server URL an imported drawable loads from points at
  nothing -> `an androidIcon the app requires drew nothing … expected 0 to be greater than 0`.
- `real-input:ios:--control:icon-button` -> organic: the debt row deleted, which is what the 44 pt
  target was supposed to make unnecessary -> `a11y:icon-button: failed: … is announced by the
  element at (18.67, 269.67, 38.67, 38.67) while the control is drawn at (16, 267, 44, 44)`.
- `jest real-input-a11y-ios` -> the row's element width moved by 2 pt -> `expect(shipped.failures)
  .toEqual([]);` (`scripts/__tests__/real-input-a11y-ios.test.js:491`).
- `jest real-input-a11y-ios` -> the row made permissive -> `expected false, received true` at
  `scripts/__tests__/real-input-a11y-ios.test.js:530`, the case where the two boxes agree.

## Files changed

- `src/components/IconButton/*`, `nitrogen/generated/*`, `ios/components/IconButton/*`,
  `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiIconButton.kt` — the control.
- `example/__tests__/IconButton.harness.tsx`, `android/src/test/…/IconButtonModelTest.kt`,
  `example/src/IconButtonScreen.tsx`, `example/ios/…/RealInputTests.swift`,
  `scripts/real-input/*` — the tests, and the measured a11y subtree in
  `scripts/__tests__/fixtures/a11y/icon-button.xml` and its iOS counterpart
  `ios-icon-button.log` (re-measured, with the row, in fix round 1).
- `docs/components/icon-button.md`, `README.md`, `docs/images/components/icon-button-*.png`,
  `.changeset/*` — the docs page, the README row, the pair, the changeset.
- `example/src/stories/IconButton.stories.tsx` — the asset path that broke the Storybook bundle.
- `scripts/conformance/make-a11y-fixtures.mjs` — scroll the tab bar before giving up on a tab.
- `scripts/real-input/android.mjs` — the icon-button check, and the `atLeast`-on-a-state
  misuse its first full run went red on.
- `bench/src/*` — the `mount.icon-button` arms.

## Follow-ups

- `src/components/IconButton/IconButton.tsx`: the `IconButtonSize` doc comment names only
  `.controlSize` for iOS; it is now half the story (the glyph size is the other half).
- `scripts/conformance/make-a11y-fixtures.mjs`: my change reaches tabs that are one swipe away;
  the run still stops at `textfield`, which suggests the tab label or the strip's end is wrong for
  the tail of the list. The fixtures after `icon-button` are therefore untouched.
- `check`: nothing bundles the Storybook entry, which is why a `require` that Metro cannot resolve
  reached a device before anything complained.
- `A11Y_EXEMPTIONS`: adding a row is a four-place edit — the row, `real-input-a11y`'s
  expected findings, and the matrix's two views of it (`conformance`, `component-coverage`).
  All four go red together, which is the right guardrail, but nothing says so where the
  table is: a CONTRIBUTING line would save the next task a red `check`.
- Bench: `mount.icon-button` needs the merge mint (X14) — arms ready, numbers absent.
- `docs/components/host.md`: `<Host>` refuses an IconButton by name; hosting one is still an
  unmeasured question.

## Questions for orchestrator

**iOS's touch target is the glyph.** The rung sizes the symbol, so `standard`/`small` measures
20.33 × 19.00 pt and even `xxlarge` is 40.67 × 38.00 pt — under Apple's 44 pt guideline, where
Android's `minimumInteractiveComponentSize()` means no rung there is ever below 48 dp. Options:
(a) ship as measured, and keep the limit printed on the docs page (what this round did);
(b) give the iOS control a minimum hit area wider than its visible box, which changes the size the
sizing engine reports and so belongs to the ladder (D42), not to this control;
(c) floor the iOS boxes at 44 pt, which collapses the bottom three rungs into one box and makes the
ladder a lie. **Recommendation: (a)** for now, and (b) as a decision for D42 — it is the same
decision `Button`'s icon-only controls would want, and it is one place rather than four.

**Answered in fix round 1:** the orchestrator chose (c) — floor the iOS box at 44 x 44 pt and
keep the glyph at its rung, mirroring Android's `max(token, 48 dp)`. The ladder (glyph size) is
unchanged, so it is not a D42 change; what grows is the target, which is a different thing from
what the layout was reporting, and the floor turned out to need a hit-testable layer rather than
a bigger frame. `## Fix round 1` below has what it measured.

## Fix round 1

**The form switches off.** `isToggle` now derives in `afterUpdate()` from
`defaultChecked != null` on both platforms, not latched in a setter; iOS re-measures on the flip. The new harness case renders a toggle, re-renders with only `onPress`, and wants one
press and `displayed=none` — `displayed=1` with the latch.

**iOS's target is 44 pt** — the review's decision: every box is `max(glyph, 44)`,
artwork at its rung, centred. `.borderless` floors its label; bezel styles and the toggle
get a clear tappable layer behind the control. Real input taps a box corner (press and toggle), the fallback is 44 x 44, and the form test moved to `xxlarge`.

**The a11y row did not retire.** The sweep reads the name on the drawn control —
`(18.67, 269.67, 38.67, 38.67)` inside the `(16, 267, 44, 44)` host `measureContent()` asked for
— because the target is a layer *behind* it. Both ways of moving the stop onto the box doubled
the name, so the row came back re-measured and the fractional-width explanation died.

**Also:** the glyph probe covers five rungs and a `require`'d drawable; the false claims now say what was measured; harness prose moved to CONTRIBUTING; the screenshot is retaken.

## Merge round

`origin/main` (Popover, G22) merged in from `4cead7b5`. Both components stay in every shared list:
the README Components table, import block and `<Host>` prose, the example's screen tabs,
`viewConfigs.test.ts`, `controls.mjs` and `nitro.json`; `FOLLOWUPS.md` keeps both sides' lines.
`nitro.json` was resolved by hand, every generated file regenerated — codegen, `bun run regen`,
`api-extractor`, `manifest:update` — which caught two hand-merge faults: nitrogen's registries
left the IconButton registration unclosed, and `controls.mjs` had folded the popover row into the
icon-button row, so real input would have tapped sixteen controls, never an IconButton. The
README's `<Host>` section named seven refused controls where `HostChildren` names nine; it names
nine now. `registry:check`, `nitrogen:check`, `readme:check` and `manifest:check` are clean; the
merge changes no platform source.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1927 tests / 80 suites | `b820d8ee4628` | 2 m 55 s | start 9.0 / med 12.4 / max 22.2 |
| `harness:ios` | **PASS** | 518 tests / 27 suites + isolated 6 tests / 3 suites | `b820d8ee4628` (ios tree) | 13 m 24 s | start 28.6 / med 5.7 / max 28.6 |
| `harness:android` | **PASS** | 574 tests / 27 suites + isolated 6 tests / 3 suites | `b820d8ee4628` (android tree) | 16 m 48 s | start 5.9 / med 4.5 / max 36.5 |
| `real-input:ios` | **PASS** | — | `b820d8ee4628` (ios tree) | 33 m 46 s | start 3.6 / med 9.8 / max 42.1 |
| `real-input:android` | **PASS** | — | `b820d8ee4628` (android tree) | 49 m 32 s | start 3.1 / med 3.4 / max 28.8 |
| `real-input:android:--control:menu` | **PASS** | — | `b820d8ee4628` (android tree) | 10 m 29 s | start 2.8 / med 3.4 / max 7.0 |

All five green on `b820d8ee4628` (lease `G23-xcdn8`, pair-a); `need --for merge` is satisfied. The
first Android sweep took the `menu` read race already in `FOLLOWUPS.md` — 23/24 controls, with
`icon-button` and `popover` PASS — and the re-run of the same tree is green, its excerpt
committed. Those rows and the fix round's stay in the ledger with the 63 earlier lines. One hygiene
note: an unowned `adb reverse tcp:8080` on the leased device was removed.

## Appendix: the iOS a11y stop, measured

`real-input:ios` (lease `G23-g3zrq`, pair-a, iOS 27) reads the tree VoiceOver walks. For
`real-input-icon-button` (`filled`, `medium`) it reports the React Native wrapper at
`(16, 267, 44, 44)` — `measureContent()` answers with the target, so the box is integral — and
one named element, the SwiftUI `Button`, at `(18.67, 269.67, 38.67, 38.67)`: the style's own box,
centred inside the target, because the 44 pt area is a `Color.clear` layer *behind* the control.
Round 0's row explained a 39.67 pt host as fractional layout; an integral 44 pt host kept the
inset and grew it, so that explanation is gone. Two constructions were measured trying to move
the stop onto the target — `.accessibilityElement(children: .combine)` on the box, and hiding the
control while naming the box — and both leave the name on two elements, which real input already
treats as a finding of its own. The row in `A11Y_EXEMPTIONS` is anchored to the numbers above
(`docs/tasks/FOLLOWUPS.md` owns the fix), so the tree that fixes it retires the row and any other
box mismatch stays red. The same run's `icon-button: PASS` says the corner taps press and flip
once each: the target is real, only the stop is smaller than it.

## Appendix: the two forms at the top rung

Moving the form test to `xxlarge` rests on the two forms being two measurements there, which the
shipped suite does not assert (it asserts one box per *state*). It was measured instead, with a
throwaway assertion that carries the boxes in its failure message: iOS `tonal`/`xxlarge` lays out
the press control at 70.67 x 68.00 pt and the toggle at 80.67 x 68.00 pt — the same 10 pt the
`large` pair differed by, and both past the 44 pt target. The probe was reverted; the numbers are
now in `docs/components/icon-button.md`.

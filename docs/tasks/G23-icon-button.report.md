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
  **25 × 23 pt**; the first row's off-device 32 × 32 went red on it.

`form` (press or toggle) is in the size key: different native controls — one configuration
is 31.67 × 30.00 pt as a `Button` and 41.67 × 30.00 pt as a `Toggle(.button)`.

The a11y sweep's one finding is recorded, not fixed: the name is on the right element —
`button`, enabled, hittable — 2 px off the box, because SwiftUI keeps a `Button`'s own
integral width inside a host React Native laid out at 39.67 pt. The exemption quotes the
measured numbers, so a moved name stays red and the row retires itself when they change;
the device's tree is a fixture and the matrix marks the cell failing.

Also: the registry entry, stories, both README screenshots, the docs page, a changeset,
`<Host>` refusing the control by name, and two fixes the work needed — the story's Metro
asset path (a wrong `require` killed the Storybook entry) and the fixture tool, which could
not reach a tab past the strip's end.

**Bench:** `mount.icon-button` arms are in for all three libraries; the bench is minted at
merge (X14), so there are no numbers to report.

## Gates

<!-- `node scripts/gate.mjs table` — pasted below, not typed. -->

## Red proofs

Twenty-one rows, each with the verbatim `before`/`after` text and the failing line, in
`docs/tasks/G23/mutations.json`. The short form (`test -> mutation -> red line`):

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

## Files changed

- `src/components/IconButton/*`, `nitrogen/generated/*`, `ios/components/IconButton/*`,
  `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiIconButton.kt` — the control.
- `example/__tests__/IconButton.harness.tsx`, `android/src/test/…/IconButtonModelTest.kt`,
  `example/src/IconButtonScreen.tsx`, `example/ios/…/RealInputTests.swift`,
  `scripts/real-input/*` — the tests, and the measured a11y subtree in
  `scripts/__tests__/fixtures/a11y/icon-button.xml`.
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

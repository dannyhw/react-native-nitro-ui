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

IconButton ships on both platforms: Material's `IconButton` / `FilledIconButton` /
`FilledTonalIconButton` / `OutlinedIconButton` and the four matching
`…IconToggleButton`s with the `shapes` overloads and colours cached per colour scheme (Button's
pattern), and on iOS a `Button` plus `Label(…).labelStyle(.iconOnly)`, or
`Toggle(…).toggleStyle(.button)` for the toggle, with `outlined` as a hairline over `.bordered`
because iOS has no outlined button style. The glyph goes through G19's icon path — one resolver,
one cache, no second icon implementation.

Two measurements decided the shape of the native code, both against Material's artifact rather
than against a guess:

- **Android asks for the rung on the control's own modifier.** Every one of those composables
  builds its Box as `modifier.minimumInteractiveComponentSize().size(<token>)`, and `Modifier.size`
  coerces into the constraints it is given — so a container asked for *inside* the content is
  measured under the `small` token, and the first device run brought back `48.00x48.00` for all
  fifteen rung × width configurations. The laid-out box is `max(token, 48)` on each axis, asserted
  against Material's own tokens; `docs/components/icon-button.md` prints the token and the box
  side by side, because the token is not the box.
- **iOS sizes the symbol.** `.controlSize` alone turned five rungs into two boxes
  (15.33 × 15.00 and 17.67 × 16.00), so the rung sets the symbol's point size to Material's glyph
  token for that rung. That makes the iOS ladder the *glyph* ladder, with the token's own repeat:
  `medium` and `large` are both 24 pt and therefore one box, which the docs page prints instead of
  hiding. The declared fallback is the default configuration's measured **25 × 23 pt** — the first
  row said 32 × 32 from an off-device estimate and conformance went red against the real number.

`form` (press or toggle) is in the size key: they are different native controls, and one
configuration measured 31.67 × 30.00 pt as a `Button` and 41.67 × 30.00 pt as a `Toggle(.button)`.

Also in this round: the registry entry, stories, both README screenshots, the docs page, a minor
changeset, `<Host>` refusing the control by name, and two fixes outside the component that the
work needed — the story's Metro asset path (a wrong `require` killed the whole Storybook entry)
and the fixture tool, which could not reach a tab past the end of the strip.

**Bench:** `mount.icon-button` arms are in for all three libraries; the bench itself is minted at
merge (X14), so there are no numbers to report here and `need` never asks for one.

## Gates

<!-- `node scripts/gate.mjs table` — pasted below, not typed. -->

## Red proofs

Sixteen rows, each with the verbatim `before`/`after` text and the failing line, in
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
- `bench/src/*` — the `mount.icon-button` arms.

## Follow-ups

- `src/components/IconButton/IconButton.tsx`: the `IconButtonSize` doc comment names only
  `.controlSize` for iOS; it is now half the story (the glyph size is the other half).
- `scripts/conformance/make-a11y-fixtures.mjs`: my change reaches tabs that are one swipe away;
  the run still stops at `textfield`, which suggests the tab label or the strip's end is wrong for
  the tail of the list. The fixtures after `icon-button` are therefore untouched.
- `check`: nothing bundles the Storybook entry, which is why a `require` that Metro cannot resolve
  reached a device before anything complained.
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

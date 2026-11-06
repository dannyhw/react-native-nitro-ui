**Branch:** `task/G17-search-field` (from `main` at `6f84bebf`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `G17-auva6` (pair-a: `nitro-ui A` / `emulator-5574` / Metro `8295`)

## Final API

```tsx
import { SearchField, type SearchFieldHandle } from 'react-native-nitro-ui';

<SearchField
  value={query}
  defaultValue=""
  onChangeText={setQuery}
  placeholder="Search"
  maxLength={8}
  editable
  onSubmitEditing={(text) => search(text)}
  onFocus={() => {}}
  onBlur={() => {}}
  ref={fieldRef}
  testID="search"
  accessibilityLabel="Product search"
/>
```

`value` / `defaultValue` / `onChangeText` / `placeholder` / `maxLength` / `editable` /
`onSubmitEditing` / `onFocus` / `onBlur`, plus `ref`, `testID` and `accessibilityLabel` — that is
the whole app surface. `SearchFieldProps extends Omit<ViewProps, 'onFocus' | 'onBlur'>` and adds
no `multiline`, `secureTextEntry`, `keyboardType` or `returnKeyType`: a search field is one line
and its Return key is always Search, so those props have no answer — the same reason Material 3's
own input field takes no keyboard options. `SearchFieldHandle` is `{ focus(): void; blur(): void }`,
the same two calls `TextField`'s handle has. `hybridRef` and `nuiPerfId` are `@internal`, for this
repo's harness and benchmarks.

`maxLength` counts UTF-16 code units the way `TextInput` does and cuts the insertion, never
through a composed character. `onSubmitEditing` gets the query itself where `TextInput` passes an
event; the field then blurs, and an empty field never submits on either platform. The clear
button reports one empty edit and keeps focus; a field that is not `editable` refuses the clear.
`placeholder` defaults to the platform's own localized word on Android and to nothing on iOS —
`UISearchTextField` has no prompt (measured, not assumed).

Settled from Appendix B: its own Hybrid View rather than `variant="search"` on `TextField`,
because a declared fallback is keyed by component and a variant would lay every cold SearchField
out at TextField's 22 pt / 24 dp line for one frame; iOS is `UISearchTextField` — the field
`UISearchBar` vends — since SwiftUI has no standalone search field and `UISearchBar` reports
through its own delegate protocol; Android is `SearchBarDefaults.InputField` in a `DockedSearchBar`
held collapsed.

## Summary

`SearchField` ships as its own Nitro Hybrid View on both platforms, hosted by the core runtime
like every other control, and it reuses `TextField`'s editing model rather than a copy of it:
`NitroUiTextEditing.swift` and the Kotlin `TextFieldModel` now carry both controls, so the
controlled-value handshake, the `maxLength` rule, the clear button and the Return-key body are
one implementation with two thin owners. The platform half is `UISearchTextField` on iOS and
Material 3's search input field on Android, which is what makes the caret, the IME, autocorrect
and the localized default prompt the platform's own.

Two behaviours are stated rather than inherited, because the platforms do not agree without
help. An empty field never submits: iOS gets that from `enablesReturnKeyAutomatically`, Android
from a guard on the Search handler, and the test seam runs that same guard on both — which is
what makes the rule assertable instead of invisible inside UIKit. `maxLength` counts UTF-16 code
units and cuts the insertion, which is React Native's rule and not either platform's default.

The perf contract is met the way `TextField` meets it: prop setters only store and mark dirty,
`afterUpdate()` applies once, the hosted control is built in `init` and never rebuilt, the
controlled value rides the event-count handshake, and `prepareForRecycle` hands the next owner a
model with none of the previous one's props. Every prop is passed on every render, none optional,
and there is no inline callback in the wrapper's JSX.

The first device run contradicted two claims in the design, and the docs now say what was
measured instead: iOS's `UISearchTextField` shows no prompt at all (Android shows the framework's
own word), and iOS's field measures 28 pt rather than the 30 pt Appendix B assumed. The declared
fallbacks (28 pt / 56 dp) are read off the components' own sources.

Accessibility was exercised by automation only (D37 item 4): the harness reads the control's own
reported state, the a11y sweep runs the real reader tree on both platforms, and the real-input
run types, clears and submits with real key events. Not exercised: VoiceOver/TalkBack navigation
by hand, and any locale but the pinned `en-US`.

`SearchField` ships `bench:false` — a bench arm needs a row in each of the four `bench/**` plan
files and iOS has no standalone search field to compare against, so the pair would be
Android-only. That is a decision for the orchestrator, recorded in `FOLLOWUPS.md`.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1734 tests / 67 suites | `ced91e96df1e` | 2 m 42 s | start 2.7 / med 6.3 / max 12.1 |
| `harness:ios` | **PASS** | 358 tests / 21 suites + isolated 2 tests / 1 suites | `ced91e96df1e` (ios tree) | 8 m 45 s | start 3.1 / med 7.8 / max 40.9 |
| `harness:android` | **PASS** | 407 tests / 21 suites + isolated 2 tests / 1 suites | `ced91e96df1e` (android tree) | 12 m 03 s | start 22.1 / med 4.3 / max 22.1 |
| `real-input:ios` | **PASS** | — | `ced91e96df1e` (ios tree) | 22 m 01 s | start 2.1 / med 7.3 / max 64.2 |
| `real-input:android` | **PASS** | — | `ced91e96df1e` (android tree) | 31 m 06 s | start 11.6 / med 3.2 / max 11.6 |
| `harness:android:SearchField` | stale | 9 failed of 13 tests / 1 suites | 4ff334b44287 (not this tree) | 48.9 s | start 92.6 / med 57.7 / max 92.6 |
| `harness:ios:SearchField` | stale | 4 failed of 13 tests / 1 suites | 4ff334b44287 (not this tree) | 59.2 s | start 10.1 / med 95.2 / max 108.7 |
| `harness:ios:SearchField:--background` | stale | — | 4aa9b2927e43 (not this tree) | 1.0 s | start 4.7 / med 4.7 / max 4.7 |

## Red proofs

Device reds ran on mutated trees as filtered runs (the `harness:ios:SearchField` and
`harness:android:SearchField` rows in the ledger); every mutation was reverted and both apps were
rebuilt from the clean tree before the full gates above.

- `SearchField > holds maxLength in UTF-16 units` (iOS) -> `NitroUiTextLimit.fitting` counts
  `current.count` instead of `NSString.length` -> `expected 'ab👍cd' to be 'ab👍c'`
- `SearchField > cuts an insertion at a grapheme boundary` (iOS + Android) -> the composed-character
  floor removed (`rangeOfComposedCharacterSequence` / `graphemeFloor` returns the raw limit) ->
  `expected '👩‍' to be ''`
- `reports the clear button as one empty edit and keeps the focus` -> the clear handler takes focus
  down -> `expected [ 'change:', 'blur' ] to deeply equal [ 'change:' ]` (iOS),
  `expected false to be true` (`focused`, Android)
- `refuses to clear a field that is not editable` -> iOS drops `nuiAllowsClear` *and* the
  `textFieldShouldClear` early return, Android drops `model.editable &&` -> `expected '' to be
  'shown'`. iOS needed both guards gone: with only the first removed the test stayed green.
- `submits on the Search key, then blurs - and never on an empty field` -> the empty-query guard
  replaced by `true` -> `expected [ 'focus', 'submit:', 'blur' ] to deeply equal [ 'focus' ]`
- `round-trips typed text to JS` + `reverts an edit JS refuses` (both) -> `useControlled`'s echo
  stops advancing `mostRecentEventCount` -> `expected +0 to be 3`, and the refused edit stays
- `focuses from its parent's mount effect` (both) -> the wrapper drops a `focus()` held while the
  view is still arriving -> `the focus asked for in a mount effect never happened`
- `comes back from the pool with none of its previous owner` (Android) -> `prepareForRecycle`
  skips the model reset -> second owner inherits `text:"firstdue"`, `focused:true`,
  `nativeEvents:13`
- `viewConfigs.test.ts` -> the `NitroUiSearchFieldConfig.json` copy deleted -> `covers every
  generated config` red, and `gen-registry` names the file
- `DECLARED_FALLBACKS` -> SearchField's row deleted -> `no DECLARED_FALLBACKS row for
  NitroUiSearchField, so the suite cannot name the fallback it expects`
- a11y rule -> `'search-field'` dropped from the known-good list -> `passes the controls today's
  code gets right` red; and red again when the measured fixture's
  `content-desc="Typing search field"` is emptied, so the fixture is load-bearing
- `smoke-ready-line.test.js` -> `search-field=310x37` deleted from the ready line -> both
  ready-line tests red
- `readme-components.test.js` -> the Components row renamed `SearchFieldX` -> `has a Components
  row, an import line and an img for every screenshot` red
- `manifest:check` -> found, not manufactured: the published-files manifest still described the
  tree before SearchField existed, so `check` was red until `manifest:update` named 44 files

**Not shown red:** the `maxLength` UTF-16 claim on **Android** (the grapheme-count mutation left
the measured answer unchanged — a second path enforces the cap there and I did not find it); the
iOS `prepareForRecycle` nil-ing of `placeholder`/`maxLength`/`accessibilityLabel` (the recycled
view came back clean without them, so those lines are defensive); `sizes itself to its parent
width`, `keeps its box while focused`, `shows the placeholder it was given`, and `lays out at its
declared fallback and corrects to what it measures` — the last stayed green with the component's
own constant changed to 22 pt / 44 dp, because the table that test reads is not written from that
constant.

## Files changed

- Component: `src/components/SearchField/` (wrapper, spec, native config, `component.json`),
  `src/index.ts`, `src/components/Host/HostChildren.ts`.
- iOS: `ios/components/SearchField/HybridNitroUiSearchField.swift`, with the editing body moved
  out of `TextField` into `ios/components/TextField/NitroUiTextEditing.swift` and shared.
- Android: `HybridNitroUiSearchField.kt` on the shared `TextFieldModel` and `NitroUiTextLimit`.
- Generated: `nitrogen/generated/**`, `nitro.json`, both `NitroUiDeclaredFallbacks`.
- Tests: `example/__tests__/SearchField.harness.tsx` (13 tests), the SearchField rows in
  `Conformance.harness.tsx`, `RealInputTests.swift`, `scripts/real-input/{android,a11y,controls,
  screens}.mjs`, the measured a11y fixture, and the registry/conformance/smoke/readme lists.
- Docs: `docs/components/search-field.md`, the README row + import + Usage + both screenshots,
  the example screen, the stories, `.changeset/search-field.md`, `etc/react-native-nitro-ui.api.md`,
  `etc/package-files.txt`.

## Follow-ups

- bench: `SearchField` is `bench:false`; a pair would be Android-only until iOS has a standalone
  search field to compare against — needs a decision, not a patch.
- Android: the `maxLength` cap has a second enforcing path I did not find, so the unit is
  unproven there by mutation.
- iOS: `prepareForRecycle`'s nil-ing of `placeholder`/`maxLength`/`accessibilityLabel` is
  unproven — the view comes back clean without it.
- Android: the default prompt reads the framework's private `search_hint` resource, so a future
  Material that renames it silently changes the default word.
- real-input Android: the clear button is located by geometry (the one clickable node in the
  field's right half) because Material 3 gives it no stable `resource-id`.
- gate.mjs: a device gate started with no lease in its environment lets the harness pick a device
  of its own and shut one down on the way out. It happened this round: the two filtered proof
  runs used the harness's own scratch AVD `nitroui` and its own simulator rather than the leased
  pair. No pool device and no `emulator-5560` was touched, and both leased devices were still
  booted afterwards. A device gate should refuse to start with no `NITRO_UI_LEASE_ID`.
- `scripts/conformance/make-a11y-fixtures.mjs` keeps its own tab-label table; it could read
  `SCREEN_TAB` now, and `SCREEN_TAB` is unmapped in `gate-core.mjs`, so any change to it owes
  both platforms' device runs.

## Fix round 1

`real-input:android` died before its SearchField case ran: `no "undefined" tab in the
accessibility tree`. The runner reached a screen through two hand-written maps in
`goToScreen` — tab label, arrival echo — and SearchField's screen arrived after both. iOS taps a tab by its `testID`, which an Android `uiautomator` tree does not
carry, so only Android needed the label.

One row per screen now lives in `scripts/real-input/screens.mjs` as `SCREEN_TAB` (echoes moved too), `screenTab()` names a missing row rather than returning undefined, and
`component-coverage.test.js` proves every control row resolves against the label `App.tsx`
draws and an anchor the app renders.

Reaching the case found a second, real bug: the clear button's name was on the Compose
glyph, leaving the node TalkBack presses unnamed. It is on the button now, glyph
decorative; iOS needed nothing, as UIKit names its own clear button.

Reds, each reverted:

- guard -> `SCREEN_TAB.searchfield` deleted -> `screen "searchfield" has no row in SCREEN_TAB`
- guard -> label `'Search '` -> `Expected: "Search" / Received: "Search "`
- guard -> echo renamed `search-typing-echoo` -> `nothing in example/src draws "search-typing-echoo"`
- `the clear button names itself` -> red on the unmutated tree until the Kotlin fix

## Merge round (part 1)

`origin/main` (Checkbox, ContextMenu, material3 1.5.0-beta02) and X19's tab bar (`d310fc45`)
merged; generated conflicts settled by `bun run regen`. X19 owns tab lookup, `SCREEN_TAB` holds
arrival anchors only (plus `checkbox`, `contextmenu` and X19's `checkbox*` echoes), and the
guard matches tab **ids**, not labels. The merged `RealInputTests.swift` compiles — nothing
else typechecks it.

`DockedSearchBar` and `SearchBarDefaults.InputField` stay under a narrow `@Suppress`: 1.5's
`SearchBar(state, inputField)` wraps the field in `DisableSoftKeyboard`. iOS's
`textFieldShouldReturn` refuses an empty query — a hardware Return used to submit `''`. Full
harness runs stay owed to the merge, once G18 lands here.

### Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1771 tests / 70 suites | `000f16e23f48` | 2 m 42 s | start 5.0 / med 6.0 / max 8.8 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:android:SearchField` | **PASS** | 14 tests / 1 suites | `000f16e23f48` (android tree) | 18.6 s | start 8.0 / med 7.0 / max 8.0 |
| `harness:android:SearchField:--background` | stale | — | 07e2e266dba4 (not this tree) | 0.8 s | start 3.0 / med 3.0 / max 3.0 |
| `harness:ios:SearchField` | **PASS** | 14 tests / 1 suites | `000f16e23f48` (ios tree) | 20.3 s | start 7.0 / med 7.0 / max 7.0 |

Lease `G17-yhpqr` (pair-b), released.

### Reds, each reverted

- iOS guard -> `takes no submit from a Return …` -> `expected ['submit:', 'blur'] to equal []`
  (`SearchField.harness.tsx:514`)
- `onExpandedRequest` stores `next` -> `expanded` red (`…:596`), heights green: a docked bar
  keeps its height
- taller focused minimum -> heights red (`…:597`, 33.9 dp), `expanded` green
- both `@Suppress`es out -> 2 deprecation warnings; back in -> none
- `SCREEN_TAB.searchfield` deleted -> `no row in SCREEN_TAB`; an `App.tsx` id renamed -> the
  guard names it

### Follow-up

- `--background` past `--` becomes a filter, filed under its own gate name.

## Merge round (part 2)

`origin/main` (E2 menus, G18 Tooltip) merged at `b6d7ba8f` (lease `G17-bqluz`). Six conflicts,
five keep-both: FOLLOWUPS, `App.tsx`'s generated regions, the control rows,
`viewConfigs.test.ts`, and main's tab-target test, which invents only components lacking a
manifest, so it stops inventing SearchField. The sixth, `android.mjs`, had main re-extend the
anchor maps this branch had moved to `screens.mjs`: its `ECHO` stayed deleted, and `SCREEN_TAB`
gained `tooltip` — the merge's one fix: without it the Tooltip check dies a device-run late.
Part 1 held (`@Suppress("DEPRECATION")`, the iOS empty-Return guard, README alt text); regen, the
Conformance table, api-extractor and `manifest:update` needed no hand edits. No gate was red;
`real-input:android` refused to start once — `real-input:ios` still held Metro 8293: the port
guard, not a flake.

### Reds, each reverted

- `SCREEN_TAB.tooltip` out -> `tooltip's screen can be reached on Android` -> `no row in SCREEN_TAB`
- `tooltip-log` -> `tooltip-logg` -> `nothing in example/src draws "tooltip-logg"`

### Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1774 tests / 70 suites | `ce2f7aabe967` | 2 m 43 s | start 17.1 / med 12.8 / max 17.5 |
| `harness:ios` | **PASS** | 440 tests / 25 suites + isolated 4 tests / 2 suites | `ce2f7aabe967` (ios tree) | 10 m 48 s | start 7.6 / med 4.9 / max 10.4 |
| `harness:android` | **PASS** | 489 tests / 25 suites + isolated 4 tests / 2 suites | `ce2f7aabe967` (android tree) | 14 m 57 s | start 9.8 / med 3.5 / max 15.5 |
| `real-input:ios` | **PASS** | — | `ce2f7aabe967` (ios tree) | 28 m 09 s | start 3.2 / med 5.7 / max 31.3 |
| `real-input:android` | **PASS** | — | `ce2f7aabe967` (android tree) | 40 m 38 s | start 4.3 / med 3.0 / max 7.4 |

`need --for merge`: satisfied on this code tree.

### Follow-up

- The tab-target test invents nothing now both its names landed; its registry-adds-a-tab
  case reads real manifests until a fresh name joins.
- `gate.mjs wait`'s `passed (Ns)` is its own elapsed, not the run's — `634 s` for a 40 m run.

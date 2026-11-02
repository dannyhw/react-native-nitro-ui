# G12 — Chip

**Branch:** `task/G12-chip` (from `main` at `98c3eed`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `G12-h83ki` (iPhone 17 iOS 27.0 `F08675D3` / `nitroui_t03` `emulator-5574` / Metro `8295`)

## API (settled before building)

```tsx
import { Chip } from 'react-native-nitro-ui';

<Chip label="Vegan" selected={vegan} onSelectedChange={setVegan} />;   // filter (default)
<Chip variant="assist" label="Add to calendar" systemImage="calendar" onPress={add} />;
```

| Prop               | Type                                     | Default    | Notes |
| ------------------ | ---------------------------------------- | ---------- | ----- |
| `label`            | `string`                                 | required   | The text, the default a11y label, and part of the sizing key. |
| `variant`          | `'filter' \| 'assist'`                   | `'filter'` | Unknown strings resolve to `'filter'` (Button's rule). |
| `selected`         | `boolean \| undefined`                   | unset      | Filter only. Controlled, through Switch's event-count handshake. |
| `defaultSelected`  | `boolean \| undefined`                   | `false`    | Filter only. Initial value of an uncontrolled chip. |
| `onSelectedChange` | `(selected: boolean) => void`            | —          | Filter only. Every user toggle, with the value native shows. |
| `onPress`          | `() => void`                             | —          | Assist only. One per tap. |
| `disabled`         | `boolean \| undefined`                   | `false`    | Native `.disabled` / `enabled = false`. |
| `systemImage`      | `string \| undefined`                    | —          | Leading SF Symbol, iOS only, ignored on Android: Button's convention. |
| `testID`, `accessibilityLabel` | `string \| undefined`        | —          | As Button; the label falls back to `label`. |
| `hybridRef`, `nuiPerfId` | internal                           | —          | As Button (D14). |

Decisions inside the brief's latitude:

- **v1 is filter and assist only.** `variant` is a string union, so `input` and `suggestion` can be added
  without a breaking change. An unknown variant is `filter`, not an error, so an app written against a later
  version still renders.
- **No `tintColor` in v1.** It is not in the brief's list; the iOS tint and the M3 selected-container colour map
  cleanly, so it is a follow-up rather than a design question.
- **The sizing key is `variant|selected|systemImage|label`**, with `systemImage` and `label` escaped as G10 did for
  Button. `selected` is a real field on Android, where M3's selected filter chip gains a leading check, and
  always `0` on iOS, where `Toggle(.button)` keeps its size (asserted in the harness, so the iOS half is
  measured rather than assumed). An assist chip's `selected` field is always `0`.
- **An uncontrolled filter chip re-renders once per toggle on Android**, so the key follows what native paints.
  It is Picker's rule (G6 review M1), for the same reason: a key that names the previous selection would file
  the new width under the old configuration. iOS keeps Switch's zero-render uncontrolled toggle.
- **`hostable: false`, `bench: false`.** Every other control is hostable, but that needs Host coverage the brief
  does not ask for. A `<Host>` refuses a Chip with its usual dev error until a follow-up adds it. Bench arms are a
  follow-up (below).

## Summary

Chip ships on both platforms as the API above. A filter chip is SwiftUI `Toggle(isOn:).toggleStyle(.button)`
or M3 `FilterChip`; an assist chip is a bordered capsule `Button` or M3 `AssistChip`. The registry entry
(`intrinsic`, `hostable: false`, `bench: false`) regenerates the tables; the conformance fixture, a11y case,
example screen, stories, `docs/components/chip.md`, README section and a minor changeset are in.

Two findings shaped the native code:

- **M3's chip animates its leading icon** (`AnimatedVisibility` on `leadingIcon != null`). The host stops
  reporting while content is wider than its box, so a toggled chip settled short (106.29 against 107.43,
  label cut). The chip now always passes a leading slot (an empty `Spacer` when unselected): one correction
  straight to the selected width, and no check slide-in (documented as a limit).
- **The iOS harness tap reaches no SwiftUI chip** (measured on both variants). iOS harness presses go
  through `nuiTestPress()`, which runs the same `press()`; real taps and the iOS a11y role/state are
  asserted by `real-input:ios` (XCUITest reports the filter chip as a `switch` with `value` 0/1).

Measured sizes (iPhone 17 / iOS 27, Android 15 at 2.625): "Measured" 88×28 pt / 94.10×48 dp; "Sized"
58×28 pt both states, 66.29 → 84.19 dp when selected on Android.

Changes outside Chip, each in scope as a failing gate or a false test:

- **HostControls/HostPopups**: the `hybridRef` race in FOLLOWUPS:115. Chip's conformance fallback test made
  it fail 3 of 3 full iOS runs (bisected: Chip's fixture alone reproduced it; without Chip, 2 of 2 passed).
  The two sites now use `waitForHandle`, as `handles.ts` prescribes.
- **Conformance controlled probe**: Switch's shape (second owner controlled at `false`) stayed green on
  Android with the counter reset deleted, because `reset()` also writes `displayed = false`. Chip's probe
  now leaves `false` and controls at `true`, and is red on both.
- **`nativeEnabled`** in `android-tree.mjs`: a disabled M3 chip publishes `enabled="false"` on its touch
  target, not on the labelled node.

The Android README screenshot is missing (question 2). Bench arms are a follow-up.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1661 tests / 63 suites | `5d984fea21a2` | 2 m 09 s | start 11.1 / med 18.2 / max 23.5 |
| `harness:ios` | **PASS** | 285 tests / 18 suites | `5d984fea21a2` (ios tree) | 5 m 10 s | start 15.9 / med 7.1 / max 15.9 |
| `harness:android` | **PASS** | 334 tests / 18 suites | `5d984fea21a2` (android tree) | 8 m 59 s | start 5.6 / med 6.5 / max 8.8 |
| `real-input:ios` | **PASS** | — | `5d984fea21a2` (ios tree) | 16 m 31 s | start 5.1 / med 9.3 / max 95.7 |
| `real-input:android` | **PASS** | — | `5d984fea21a2` (android tree) | 24 m 52 s | start 6.7 / med 6.1 / max 16.5 |
| `harness:android:Chip` | stale | 4 failed of 10 tests / 1 suites | ff06eef20479 (not this tree) | 46.1 s | start 9.7 / med 9.0 / max 9.9 |
| `harness:android:Conformance` | stale | 1 failed of 50 tests / 1 suites | 65fdd5da9754 (not this tree) | 1 m 39 s | start 8.8 / med 8.9 / max 13.1 |
| `harness:ios:Chip` | stale | 4 failed of 10 tests / 1 suites | ff06eef20479 (not this tree) | 50.1 s | start 10.8 / med 10.8 / max 12.2 |
| `harness:ios:Chip%7CHostControls` | stale | 21 tests / 2 suites | a28d2fe556ca (not this tree) | 22.1 s | start 5.0 / med 5.3 / max 5.5 |
| `harness:ios:Conformance` | stale | 1 failed of 50 tests / 1 suites | 65fdd5da9754 (not this tree) | 1 m 41 s | start 8.8 / med 8.5 / max 10.2 |
| `harness:ios:Conformance%7CHostControls` | stale | 1 failed of 16 tests / 2 suites | 01e53f4d7438 (not this tree) | 19.0 s | start 6.3 / med 6.7 / max 7.2 |
| `harness:ios:HostControls` | stale | 11 tests / 1 suites | a28d2fe556ca (not this tree) | 19.2 s | start 4.7 / med 4.8 / max 5.1 |
| `real-input:android:--control:chip` | stale | — | 0eb7ba6d99f0 (not this tree) | 7 m 12 s | start 28.6 / med 45.0 / max 101.9 |
| `real-input:ios:--control:chip` | stale | — | 6afcf3ff6cff (not this tree) | 5 m 27 s | start 5.8 / med 18.4 / max 81.0 |

The stale rows are the filtered red-proof and bisect runs, each on its mutated tree.

`need --for review`: `need: review is satisfied on this code tree.`

## Red proofs

- `Chip.harness › re-keys a toggle` (Android) -> M3's animated leading icon (the first build) -> `testID "toggled" … never reached 107.43x48.00 - last box 106.29x48.00, control measured 106.67x48.00`
- `re-keys a toggle` (Android) -> wrapper drops `setLastChoice` -> `… never reached 107.43x48.00 - last box 89.52x48.00`
- `lays both variants out at the size the control measured` (both) -> wrapper style `{ width: 80 }` -> `testID "filter" never reached 88.00x28.00 - last box 80.00x28.00` (iOS), `94.10x48.00 … 80.00x48.00` (Android)
- `keeps its size when selected on iOS, and grows by the check on Android` -> iOS label `Font.body.bold()` when selected -> `testID "off" never reached 62.00x30.33 - last box 64.00x30.33`; Android check never shown -> `expected 66.28571428571429 to be greater than 74.28571428571429`
- `re-measures when the label changes` (both) -> key without the label, plus iOS setter without `noteContentSizeMayHaveChanged` / Android setter dropping the write -> `"label" (the long label) still measures 57.67x28.00 - it never re-measured` (iOS), `48.00x48.00` (Android)
- `follows a controlled selection in both directions` (both) -> wrapper sends `selected={null}` -> `expected null to be false`
- `reverts a toggle JS refused` (both) -> wrapper sends `mostRecentEventCount={0}` -> `"refused" never drew displayed=0 - it reports "displayed=1;probes=0;a11y=none"`
- `presses an assist chip once per press` (both) -> `onPress` called twice per press -> `expected [ Array(4) ] to deeply equal [ 'assist:press', 'assist:press' ]` (iOS passed this mutation until `waitForEvents` waited out a surplus)
- `takes no press while disabled` -> iOS press guard and `.disabled` removed -> `expected [ 'disabled-filter:false', …(3) ] to deeply equal [ 'barrier:press' ]`; Android guard removed, `enabled = true` -> `"disabled-filter" never drew displayed=1`
- `tells accessibility what it is` (Android) -> wrapper sends `accessibilityLabel={null}` -> `… to contain 'label=Get directions'`; `enabled = true` -> `… to contain 'disabled=true'`
- Conformance › Chip recycle, controlled probe (both) -> `state` reset line removed -> `the first press on the controlled second mount reports reads conformance-chip:true where the props say conformance-chip:false` (Android stayed green on the Switch-shaped fixture; rewritten)
- Conformance › Chip recycle, uncontrolled probe (both) -> `didApplyDefault = false` removed -> `expected [ 'conformance-chip:true' ] to deeply equal [ 'conformance-chip:false' ]` (the residue reached the probe's own first owner)
- `real-input:ios` chip -> press guard and `.disabled` removed -> `XCTAssertFalse failed - the disabled filter chip's element should announce itself dimmed`
- `real-input:android` chip -> press guard removed, `enabled = true` -> `a tap on the disabled filter chip to be refused: real-input-chip-events went to "3" when it should have stayed "2"`
- `a11y:chip` (iOS sweep) -> expected trait `toggle` before measuring -> `"Real-input chip" is announced as a switch and not as a toggle`
- `real-input-android-tree.test › nativeEnabled` -> read the labelled node's `enabled` -> 3 failed, `Expected: "false" Received: "true"`
- `host.test › names the Chip` -> `UNHOSTABLE_CONTROLS` emptied -> `Expected - 3 / Received + 1`
- Not red-provable: the iOS half of `tells accessibility…` asserts only that the in-app probe reports `unavailable`; iOS role and state are the real-input lines above.

## Files changed

- Chip: `src/components/Chip/*`, `ios/components/Chip/HybridNitroUiChip.swift`, `android/…/HybridNitroUiChip.kt`, `nitrogen/generated/**`, `src/index.ts`
- Registry outputs: `nitro.json`, `nitro-ui.sizing.json`, declared-fallback tables, `NitroUiPackage.kt`, `example/src/App.tsx`, smoke lists, `scripts/real-input/controls.mjs`; `UNHOSTABLE_CONTROLS` by hand
- Tests: `example/__tests__/Chip.harness.tsx`, `Conformance.harness.tsx` (fixture + shared table), `HostControls`/`HostPopups.harness.tsx` (`waitForHandle`), `src/__tests__/host.test.tsx`, `scripts/__tests__/{registry,conformance,real-input-a11y,real-input-android-tree,smoke-ready-line}.test.js`, `scripts/__tests__/fixtures/a11y/chip.xml`
- Real input: `RealInputTests.swift` (`testRealInputChip`, a11y case), `scripts/real-input/{android,android-tree,a11y,screens}.mjs`, `scripts/conformance-core.mjs`, `scripts/conformance/make-a11y-fixtures.mjs`
- Example and docs: `example/src/ChipScreen.tsx`, `example/src/stories/Chip.stories.tsx`, `example/src/readme-examples.tsx`, `scripts/smoke/App.tsx`, `docs/components/chip.md`, `README.md`, `docs/images/components/chip-ios.png`, `.changeset/chip-filter-assist.md`, `etc/*`

## Follow-ups

- Chip: bench arms (mount, toggle) against Switch/Button; `bench: false` for now.
- Chip: hosting inside `<Host>` on both platforms; `hostable: false` and a Host refuses it by name.
- Chip: `tintColor`, and Material's input/suggestion chips.
- Chip (iOS): a disabled selected chip draws as unselected (SwiftUI's disabled bordered style drops the fill).
- Host sizing (Android): content that animates its intrinsic width settles short, because over-wide placement stops reporting; Chip avoids M3's case, any other animating control would hit it.
- `real-input:android` full run: the assist chip's barrier tap stalled 8 s and landed with the retry (presses 1 -> 3 -> 4); chip-only reruns 2 of 2 green.
- Conformance (Android): Switch's controlled recycle probe may share Chip's coincidence (second owner `false` equals `reset()`'s `displayed = false`); not checked.
- Conformance (iOS): why Chip's fallback test slows `hybridRef` delivery for later suites is not established; the two Host sites no longer depend on it.
- `make-a11y-fixtures.mjs`: today's switch/button/menu dumps differ from the committed fixtures; only `chip.xml` was taken.
- `app.stamp` hashes `etc/`, which the gate ledger treats as check-only, so an API-report update forces app rebuilds.

## Questions for orchestrator

1. **Should Chip be hostable?** Every other control is, and the README said a Host "holds every control the
   library ships" (reworded). Options: (a) a follow-up task adds Host coverage on both platforms
   (recommended); (b) ship as `hostable: false` permanently.
2. **The Android README screenshot.** The T3 device tool lists `nitroui_t03` as not booted (the lease runs it
   on a private adb server), so opening it would boot a second copy of a leased AVD, and ad-hoc `adb
   screencap` is outside the device rules. Options: (a) the orchestrator takes it from Storybook
   `Chip/States`, cropped like `chip-ios.png` (recommended); (b) allow `adb -s emulator-5574 exec-out
   screencap` on the lease. The README cell says it is to come.
3. **iOS trait for a filter chip.** The a11y table expects `switch`, which is what XCUITest reports for
   `Toggle(.button)` (no toggle-button type exists). Recommend accepting it.

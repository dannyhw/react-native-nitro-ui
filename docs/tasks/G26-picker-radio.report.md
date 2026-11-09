# G26 — Picker `variant="radio"`

**Branch:** `task/G26-picker-radio` (from `main` at `a526807e`); fix round 1 on `task/G26-fix1`
(from `ff129968` with `origin/main` merged in) · **Round:** 2 of up to 3 (D19) ·
**Lease:** round 1 `G26-6r1z9` (pair-a, Metro `8295`); fix round 1 `G26-o4dni` (pair-b: iPhone
Air / iOS 27.0 + `nitroui_b` on `emulator-5570`) / Metro `8293`

## Summary

`Picker` gains `variant="radio"`: every option on screen at once on Android, the menu
again on iOS. Value, clamps, handshake, `onChange`, `label`, `disabled` and `tintColor`
are untouched — the variant only changes what is drawn and what the sizing key names.

`real-input:ios` is red on two accessibility-sweep lines about `ContextMenu`, not the
Picker — see Red gate below.

Android draws Material 3's own pattern: a `Column(selectableGroup())` of rows, each
`selectable(selected, enabled, Role.RadioButton)` around a `RadioButton(onClick = null)`
and a one-line ellipsized label. The row is the press target and measures 48 dp
(`heightIn(min = 48.dp)`, Material's own minimum touch target), so
a group is its option count — 144 dp tall for three options, 240 for five, asserted at
±1 dp on the emulator. The tint goes through
`pickerRadioColors`, a bounded `(scheme, tint)` cache beside the menu's field colours.
A pick is `applyUserSelection`, the one place a choice is applied, so the no-op row, the
disabled group and the rollback handshake are the menu's rules, not new code to drift.

iOS has no radio-group picker style — `RadioGroupPickerStyle` is
`@available(iOS, unavailable)` — so per D38 item 4 the variant renders the menu instead of
an imitation, and `picker.md` sends apps that need every choice visible to
`SegmentedControl`.

**The decision to read before the diff: JS resolves the variant, not SwiftUI.**
`Picker.tsx` decides the native prop, the size policy and `nuiSizingKey` in one place,
because a key must name the control that is actually drawn — a `radio` key whose width
follows a title is G6 review M1's poisoned cache wearing another name. Android's radio key
is `radio|count|labels…`: neither `sel:` nor `lbl:` — a group paints every label at once
and draws no `label` at all, so neither a pick nor a rename moves its box (measured: 0
corrections, 0 cached sizes). iOS files its radio sizes under the menu key, both fields
and all. The cold first frame is still the menu's 280 × 56 dp box — one declared
fallback per component, D17 — corrected the turn the group measures; every radio case
mounts from a poisoned entry, so that correction is load-bearing.

That iOS rule is unreachable from a device run — the wrapper resolves the name before the
prop is sent — so it moved to `NitroUiPickerVariant.swift` and
`scripts/native-tests/picker-variant.test.swift` runs its vectors on the host. The Kotlin
twin keeps the other answer and its own JVM test.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1997 tests / 84 suites | `3ec823676277` | 2 m 48 s | start 5.6 / med 7.5 / max 10.4 |
| `harness:ios` | **PASS** | 571 tests / 30 suites + isolated 6 tests / 3 suites | `3ec823676277` (ios tree) | 14 m 11 s | start 6.0 / med 10.7 / max 166.1 |
| `harness:android` | **PASS** | 627 tests / 30 suites + isolated 6 tests / 3 suites | `3ec823676277` (android tree) | 17 m 51 s | start 8.2 / med 6.9 / max 20.0 |
| `real-input:ios` | **FAIL** | — | `3ec823676277` (ios tree) | 38 m 50 s | start 5.4 / med 6.5 / max 65.5 |
| `real-input:android` | **PASS** | — | `3ec823676277` (android tree) | 60 m 40 s | start 5.0 / med 6.0 / max 90.4 |
| `harness:android:Form.harness` | **PASS** | 14 tests / 1 suites | `3ec823676277` (android tree) | 18.8 s | start 5.5 / med 6.1 / max 6.1 |
| `harness:android:Form.harness:--background` | **FAIL** | — | `3ec823676277` (android tree) | 1.3 s | start 5.5 / med 5.5 / max 5.5 |
| `harness:android:Picker.harness` | stale | 1 failed of 46 tests / 2 suites | b9cea81d2864 (not this tree) | 48.7 s | start 7.7 / med 6.7 / max 7.8 |

The last two rows are not results to read: `…Form.harness:--background` is one mis-typed
invocation of mine (`--background` landed after the `--`, so jest got an unknown argument and
the run died in 1.3 s), and `harness:android:Picker.harness` on tree `b9cea81d2864` is the
`lbl:` mutation proof — red by design, on a tree that no longer exists.

`need --for review`: review is satisfied on this code tree — `check`, `harness:ios`,
`harness:android` and `real-input:android` all green on `3ec823676277`. `need --for merge`
still wants `real-input:ios`, which is the red row above.

The filtered rows are diagnosis, not gates: `harness:android:Form.harness` is G24's
recycled-Form suite run alone at load1 5.5 (green, which is what says the two full-run reds
were load), and `harness:android:Picker.harness` is the `lbl:` mutation proof. A filtered run
records under its own name and satisfies nothing; they stay in the ledger because a round's
red lines are evidence.

## Red gate: `real-input:ios`

Red on every run of this task — three on round 1's tree, one on fix round 1's — in one place
only: the accessibility sweep's ContextMenu case and the debt row that guards it. Every XCUITest case passed and
`context-menu: PASS (no retries)` — the two red lines are a read of the tree, not a
control that stopped working.

```
a11y:context-menu: NitroUiContextMenu: 4 element(s) under "ctx-accessible" are stops of
  their own ("Grace Hopper" x2, "One element for screen readers..." x2)
a11y:ios-debt: the ios entry for "context-menu" matched no problem this run
```

`ContextMenu` is not in this diff: what reaches the sweep is one title string in
`scripts/real-input/controls.mjs` and two `ECHO` ids in `scripts/real-input/screens.mjs`,
and the wrapper is still the named element in every read (`other id="ctx-accessible"
label="Message from Grace"`, the box identical to the base's). Measured, not assumed:

- The branch's base `a526807e`, same simulator and Metro port, reads **2 stops and 0
  failures in 2 of 2** probe runs (`node scripts/real-input/ios.mjs --control …`, off the
  ledger — a filtered run records under its own name and satisfies nothing).
- Of 197 `real-input:ios` logs in the gate store, 96 record the exempt 2-stop shape and 7
  record 4 — and all seven are today: this task's four and `task/G25-fix1`'s three (its
  `--control stepper` run at 15:29 and full sweeps at 16:08 and 19:04), on another
  tree, another device pair and another Metro port, with no ContextMenu or Picker file in
  its diff either. Two unrelated branches are blocked by the same two lines.
- The two shapes differ in **which elements exist and never in a frame** — "Grace Hopper"
  sits at `(25, 459.67, 352, 17)` in both. `A11yFrameStability` settles on frames, so a
  read taken before SwiftUI merged the wrapper's children agrees with itself and prints.

This branch mounts two more hosted Pickers on `picker`, the screen the sweep walks fifteen
cases before `contextmenu`, which is the kind of load that shape is sensitive to. The merge
bar re-runs real-input anyway; if it is still red it belongs to whoever owns the G16
exemption row and X21's recurring-flakes item — most plausibly a settle that also compares
the element set, not only the frames.


## Red proofs

`test -> mutation -> the line that went red`. Every device proof below is a *filtered*
harness run (`gate.mjs harness:android -- Picker`, recorded under its own name, satisfying
nothing), reverted after; the mutation is in the shipping file, not in the test.

- `picker.test.tsx › is a radio group on Android and the menu on iOS` -> `resolveVariant`
  answers `'radio'` on iOS -> `Expected: "menu" / Received: "radio"`.
- `picker.test.tsx › treats an iOS variant change between menu and radio as no change at
  all` -> same mutation -> sizing id `Expected: 31 / Received: 32` (iOS would remount).
- `picker.test.tsx › keeps a radio selection out of the key and a menu selection in it` ->
  `sel:` put back into the radio key -> `radio|3|One|Two|Three|sel:One|lbl:`.
- `PickerModelTest.theVariantResolvesToTheThreeControlsThisComponentHas` -> the
  `"radio" -> "radio"` arm removed from `resolvedVariant` -> `ComparisonFailure` at
  `PickerModelTest.kt:218`.
- `PickerModelTest.aRadioPickMeansTheSameThingAsAMenuPick` -> `applyUserSelection` no longer
  writes `expanded = false` -> `aRadioPickMeansTheSameThingAsAMenuPick FAILED` alongside the
  pre-existing `aPickClosesThePopupPaintsItsTitleAndStampsItsConfiguration` (fix round 1:
  the first round's claim of "two siblings" was wrong, and its version of this proof was
  vacuous — `expanded` starts `false`, so the write had to be primed with `expanded = true`
  before the pick for the assertion to be able to fail).
- `picker-variant.test.swift` (new host vectors) -> `NitroUiPickerVariant.resolved` passes
  `radio` through -> `FAIL radio falls back to the menu: "radio" -> "radio", want "menu"`,
  exit 1.
- `Picker · radio variant › costs no correction when a pick moves the selection` -> `sel:`
  back in the radio key (`Picker.tsx`) -> `expected 1 to be +0` at
  `expect(after.corrections).toBe(0)` — one correction per pick, exactly what the key is
  there to avoid.
- `…measures a radio group as its option count`, `…answers menu on the platform with no
  radio group` and the pre-existing `Picker · G6 › goes on reporting its size after a
  re-tap of the row already shown` -> Kotlin: `RadioRowMinHeight = 56.dp`, and
  `applyUserSelection` stripped of its `enabled` and already-chosen guards -> 4 red,
  including `radio › reports nothing for the row already chosen, or for a disabled group`.
- `…goes back to a menu when the variant changes, with no leftovers` -> `radioIsRadioGroup()`
  returns `false`, so Android stops resolving the variant -> `radio-switch … never reported
  a size of its new mount - measureContent() says 280.00x56.00, was 280.00x56.00 before the
  rerender`.
- `CHECKS.picker` step 9 -> `the disabled group's row "Gabbro" says it is not enabled` ->
  `selectable(enabled = true)` on the radio row (the row stops honouring `disabled`) ->
  `expected false, saw true` for all three locked rows, while the enabled group's three
  rows — asserted through the same helper — still read `true`. The first draft of this
  assertion read whichever dump node carried the option's words, and Compose keeps a
  disabled row's state on the row and the words on their own node, so it reported every
  disabled row as enabled; `android-tree.mjs`'s tightest-containing-node lookup is the
  fix, and the positive control is what stops it passing on a lookup that answers
  nothing.
- **Not mutated, and why: the Kotlin variant-setter latch (an early return while the
  variant is `radio`) stays green, because the wrapper keys the native view on the variant —
  the change is a remount by construction and the setter never sees it. The variant-change
  case's proof is the `radioIsRadioGroup()` mutation above. Likewise `let next = newValue`
  in `HybridNitroUiPicker.swift` (dropping the D38 guard) leaves the *device* suite green —
  verified, the filtered iOS run passed with it dropped — which is why that rule is a host
  test and not a harness claim.

## Files changed

- `src/components/Picker/Picker.tsx`, `Picker.nitro.ts`, `NativeNitroUiPicker.ts`:
  `PickerVariant`, `resolveVariant` / `radioIsRadioGroup`, the `sel:`-free radio key.
- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiPicker.kt`: `RadioGroup`,
  `pickerRadioColors`, the three row
  constants, `PickerModel.resolvedVariant` / `isRadio`, the variant/policy branch.
- `ios/components/Picker/NitroUiPickerVariant.swift` (new), `HybridNitroUiPicker.swift`:
  the iOS resolution, now host-testable.
- `scripts/native-tests/picker-variant.test.swift` (new), `scripts/native-tests.sh`: its
  vectors, in `bun run test:native`.
- `src/__tests__/picker.test.tsx`,
  `android/src/test/java/com/margelo/nitro/nitroui/PickerModelTest.kt`,
  `example/__tests__/Picker.harness.tsx` (six cases): the tests above.
- `scripts/real-input/{android,screens,controls}.mjs`, `example/src/PickerScreen.tsx`:
  `CHECKS.picker` step 9 — a real row tap, the `checked` read-back, disabled rows.
- `README.md`, `example/src/readme-examples.tsx`, `example/src/stories/Picker.stories.tsx`,
  `docs/components/picker.md`, `etc/react-native-nitro-ui.api.md`,
  `etc/package-files.txt`, `.changeset/g26-picker-radio.md`.

**Screenshot:** `docs/images/components/picker-{ios,android}.png` were **not** retaken.
Picker already has both shots on `main` and the radio rows are not the story's first
screen; a `Radio` story was added to `Picker.stories.tsx` instead, so the variant is
reachable from Storybook on both platforms. Say the word if the Android shot should show
the group instead.

## Follow-ups

- a11y: `A11yFrameStability` settles on frames alone, so a read taken before the ContextMenu
  wrapper's children have merged agrees with itself — the sweep cannot tell the exempt
  2-stop shape from the 4-stop one its own row is anchored against.
- sizing: per-variant declared fallbacks would remove a cold radio group's correction
  entirely; the engine holds one pair per component (D17), so the frame stays.
- real-input: the iOS `picker` check does not exercise the radio fallback — the harness
  asserts it, and on iOS there is no distinct control to tap.
- scripts: `waitForOption`'s failure text says "no popup row labelled" even when the node
  it wants is a row in the app's own window.
- pool: `lease.mjs list` reports two Booted simulators (`91C5B477…`, `C7D6D8F4…`) held by no
  lease — not mine to power off, flagging for whoever owns the pool.
- gate: `gate.mjs wait` on this host prints its progress lines only when it exits, so a long
  run looks silent; the log store is current.
- a11y (fix round 1, automation gap): the spoken "2 of 3" is untested — `uiautomator` prints
  no collection info, so nothing in this repo reads a node's `CollectionInfo`. A
  `UiAutomation` read of `CollectionInfo` beside `CHECKS.picker` step 9 would close it;
  `picker.md` claims only what the dump proves until then.

## Fix round 1

Merged `origin/main` first. The two must-fixes: the duplicated clause in `docs/components/
picker.md` is deleted, and `lbl:` is out of the Android radio key — `radio|count|labels…`, as
the brief and Q7 D2 ask. The new harness case renames a warm group and pays nothing; with `lbl:`
put back it goes red — `expected 1 to be +0` at `after.corrections`, the box unmoved at
133.33x144.00, 45 others green.

The silence case now ends with a real pick (`['radio-noop:1']`), so a recorder that never armed
cannot pass it; the refused pick reads its painted index back, the `checked` read staying
real-input's. The Kotlin proof, re-run with `expanded` primed:
`aRadioPickMeansTheSameThingAsAMenuPick` fails at `PickerModelTest.kt:249` beside the
pre-existing `aPickCloses…` at `:101` — never "two siblings". The spoken "2 of 3" is an
automation gap, not a claim; the changeset is three user-facing bullets.

Two gates were load, not code: `harness:android` red on G24's recycled-Form case at load1 15.1
and 10.8, green at 6-9 (Form's files are identical to G24's green tree; the suite passes alone
here at 5.5). `real-input:ios` is still red on the two ContextMenu a11y lines X22 owns — the
sweep's only two `✗`, with all picker checks green.

## Questions for orchestrator

`need --for merge` wants one thing this branch cannot turn green on its own: `real-input:ios`,
red on the two ContextMenu accessibility lines above. `task/G25-fix1` is red on the same two,
so the bar is blocked for a second, unrelated branch at the same time.

1. **Recommended — re-run at merge, and merge through the red if it stays.** The merge bar
   runs the full harness plus real-input anyway. A green there closes the question; a red
   there is two branches deep and cannot be this Picker's, whose diff has no ContextMenu file
   and whose own `context-menu` check and 27 XCUITest cases pass.
2. **Fix the sweep first.** Give `A11yFrameStability` a comparison that includes the element
   set, not only frames, then re-run both branches. It is the right fix for the shape and it
   edits another task's file, which is why it is not in this round.
3. **Hold G26.** Costs a round for no new information.

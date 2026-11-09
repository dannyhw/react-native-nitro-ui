# G26 — Picker `variant="radio"`

**Branch:** `task/G26-picker-radio` (from `main` at `a526807e`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `G26-6r1z9` (pair-a: iPhone 17 / iOS 27.0 + `nitroui_a` on `emulator-5574`) / Metro `8295`

## Summary

`Picker` gains `variant="radio"`: every option on screen at once on Android, the menu
again on iOS. Value, clamps, handshake, `onChange`, `label`, `disabled` and `tintColor`
are untouched — the variant only changes what is drawn and what the sizing key names.

Android draws Material 3's own pattern: a `Column(selectableGroup())` of rows, each
`selectable(selected, enabled, Role.RadioButton)` around a `RadioButton(onClick = null)`
and a one-line ellipsized label. The row is the press target and measures 48 dp
(`heightIn(min = 48.dp)`, Material's own minimum touch target, spelled as a constant), so
a group is its option count — 144 dp tall for three options, 240 for five, asserted at
±1 dp on the emulator rather than copied from Q7. The tint goes through
`pickerRadioColors`, a bounded `(scheme, tint)` cache beside the menu's field colours.
A pick is `applyUserSelection`, the one place a choice is applied, so the no-op row, the
disabled group and the rollback handshake are the menu's rules with no new code to drift.

iOS has no radio-group picker style — `RadioGroupPickerStyle` is
`@available(iOS, unavailable)` — so per D38 item 4 the variant renders the menu instead of
an imitation, and `picker.md` sends apps that need every choice visible to
`SegmentedControl`.

**The decision to read before the diff: JS resolves the variant, not SwiftUI.**
`Picker.tsx` decides the native prop, the size policy and `nuiSizingKey` in one place,
because a key must name the control that is actually drawn — a `radio` key whose width
follows a title is G6 review M1's poisoned cache wearing another name. Android's radio key
is `radio|count|labels…|lbl:` with **no `sel:` term**: a group paints every label at once,
so which row is chosen moves nothing and a pick costs no correction (measured: 0
corrections, 0 cached sizes, the box unmoved). iOS files its radio sizes under the menu key,
`sel:` and all. The cold first frame is still the menu's 280 × 56 dp box — one declared
fallback per component, D17 — corrected the turn the group measures; every radio case
mounts from a poisoned entry, so that correction is load-bearing and not decorative.

That iOS rule is unreachable from a device run — the wrapper resolves the name before the
prop is sent — so it moved to `NitroUiPickerVariant.swift` and
`scripts/native-tests/picker-variant.test.swift` runs its vectors on the host. The Kotlin
twin keeps the other answer and its own JVM test.

## Gates

<!--GATE-TABLE-->

`need --for review`: <!--NEED-LINE-->

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
- `PickerModelTest.aRadioPickMeansTheSameThingAsAMenuPick` (+ its two siblings) ->
  `applyUserSelection` left `expanded = true` for a radio pick -> the group's pick reported
  an open popup.
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
- `android/.../HybridNitroUiPicker.kt`: `RadioGroup`, `pickerRadioColors`, the three row
  constants, `PickerModel.resolvedVariant` / `isRadio`, the variant/policy branch.
- `ios/components/Picker/NitroUiPickerVariant.swift` (new), `HybridNitroUiPicker.swift`:
  the iOS resolution, now host-testable.
- `scripts/native-tests/picker-variant.test.swift` (new), `scripts/native-tests.sh`: its
  vectors, in `bun run test:native`.
- `src/__tests__/picker.test.tsx`, `android/src/test/.../PickerModelTest.kt`,
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

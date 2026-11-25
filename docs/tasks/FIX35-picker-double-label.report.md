# FIX35 — VoiceOver says an iOS Picker's name once

**Branch:** `task/FIX35-picker-double-label` (from `main` at `b93d3b60`) · **Round:** 1 of up to 3 ·
**Lease:** `FIX35-16qjw` (`nitro-ui A` / Metro `8295`)

## Summary

Measured first, on `main`, against the tree XCUITest reads. The doubling is real, on the control's
own element: a menu `Picker`'s element is a `button` whose name is SwiftUI's label content **followed
by** the `accessibilityLabel` we apply — `ProbeU4a, ProbeU4b` for `label="ProbeU4a"` with
`accessibilityLabel="ProbeU4b"`. So it doubles for `label` alone too, and `accessibilityLabel` only
read correctly because there was then no label content to concatenate. Hosted and unhosted trees are
the same, so `<Host>` is not the cause; the two are in the table below.

The fix gives SwiftUI no label content, so `.accessibilityLabel(accessibilityLabel ?? label)` is the
only name the element can carry. That is what `docs/components/picker.md` already promised (`.menu`
draws no caption; a `label` costs nothing on iOS; iOS gets
`.accessibilityLabel(accessibilityLabel ?? label)`), and a `label` that is unset already passed
`EmptyView`, so a Picker with neither prop has the tree it had. After: one name in every
combination, the `button` trait kept, and the chosen option still announced — on a menu the choice is
a sibling `static text` element (`ProbeOne`, `Beta`), on a wheel it is the element's own `value`;
neither changed. A labelled wheel measured 330.00 × 216.00, the box the docs record for a wheel with
no `label`, so the label content that went away drew nothing. Android is untouched: the diff is one
iOS file and one docs file.

The brief's second proof — a harness test that reads the label and value through a test-only native
read — is not achievable, and this repo already carries that answer four times over (Checkbox, Chip,
ButtonGroup and IconButton each answer `unavailable`). Measured here with a throwaway walk of the
host's view tree on main: `elements=0` for all eight combinations — 8 views visited, deepest 6, one
of them answering an empty element list. A SwiftUI hosting view vends its accessibility elements to
an accessibility client and to nothing in-process, and XCUITest is the client. The guard is therefore
the a11y rule that already exists, quoted before and after in Red proofs; the two
`scripts/real-input/a11y.mjs` lines that belong with this fix are under Follow-ups, `scripts/` being
out of this brief's scope.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2262 tests / 105 suites | `76e542574bae` | 54.3 s | start 2.5 / med 6.0 / max 6.8 |
| `harness:ios` | **PASS** | 622 tests / 30 suites + isolated 6 tests / 3 suites | `76e542574bae` (harness:ios digest) | 14 m 30 s | start 11.1 / med 4.8 / max 11.6 |
| `harness:android` | **PASS** | 681 tests / 31 suites + isolated 6 tests / 3 suites | `76e542574bae` (harness:android digest) | 18 m 40 s | start 11.1 / med 4.3 / max 11.6 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:ios:A11yProbe` | stale | 1 failed of 1 tests / 1 suites | fe258652663e (not this tree) | 10.8 s | start 5.2 / med 5.3 / max 5.5 |
| `real-input:ios:--a11y:hosted-picker` | stale | — | 9b70b63ecae3 (not this tree) | 1 m 38 s | start 6.5 / med 6.4 / max 8.9 |
| `real-input:ios:--a11y:hosted-picker:--a11y:probe-u1:--a11y:probe-u2:--a11y:probe-u3:--a11y:probe-u4:--a11y:probe-h1:--a11y:probe-h2:--a11y:probe-h3:--a11y:probe-h4` | stale | — | 93e56f57b40e (not this tree) | 2 m 33 s | start 3.1 / med 3.5 / max 4.6 |
| `real-input:ios:--a11y:probe-u1:--a11y:probe-u2:--a11y:probe-u3:--a11y:probe-u4:--a11y:probe-h1:--a11y:probe-h2:--a11y:probe-h3:--a11y:probe-h4` | stale | — | af0a48fc2a11 (not this tree) | 1 m 28 s | start 3.7 / med 3.9 / max 4.6 |
| `real-input:ios:--a11y:probe-wheel` | stale | — | 862b526e1155 (not this tree) | 1 m 09 s | start 2.2 / med 3.3 / max 4.8 |

`need --for review`: need: review against .gates/task/FIX35-picker-double-label.jsonl; code diff base b93d3b6 touches ios + android
  ✓ check — green
  ✓ harness:ios — green on its own digest
  ✓ harness:android — green on its own digest
need: review is satisfied on this code tree.

`real-input:ios` is deliberately not run on this branch: it is a merge gate, and its
`a11y:hosted-picker` half is quoted above from the filtered runs the brief's Proof names.

## Red proofs

- `a11y:hosted-picker` (XCUITest) -> on `main`, with no change -> the tree reads the stutter and the
  pass is granted only by its debt row:
  `known failing (X4 a11y: a hosted Picker announces its label twice): NitroUiPicker: the element
  under "host-picker" announces the control's name twice (button "Hosted picker, Hosted picker" at
  (16, 1097.67, 75.33, 34.33))`, then `✓ … 1 of its problems match a debt row`.
- `a11y:hosted-picker` -> the fix -> `✓ NitroUiPicker is named on one element, at the control's own
  box, as a control`, and `a11y:ios-debt` goes red instead: `✗ A11Y_EXEMPTIONS: the ios entry for
  "hosted-picker" (X4 a11y: a hosted Picker announces its label twice) matched no problem this run —
  the control passes the rule now, so delete the exemption and let the rule guard it`. That is the
  repo's self-clearing debt rule: the run that clears a piece of debt goes red until the row is
  deleted, which is why this branch cannot go green on `real-input:ios` before the line under
  Follow-ups lands.
- The eight combinations -> before the fix, unhosted and hosted, on throwaway cases graded by the
  same rule -> `✗ NitroUiPicker: the element under "probe-u3" announces the control's name twice
  (button "ProbeU3, ProbeU3" …)` and, for the two-prop case, `✗ … no element other than the React
  Native wrapper is announced as "ProbeU4b"` -> after the fix every one of them reads
  `✓ … named on one element, at the control's own box, as a control`.
- No new test ships, so no mutation of a fixture was run: the guard is the existing a11y rule, and
  the lines above are its own output from the runs before and after the fix.

## Readings

Control element = the `button` the tree vends under the control's `testID`; "choice" is the sibling
`static text` element. Trait `button` and `value=""` in every row, before and after.

| Combination (hosted = inside `<Host>`) | Name before | Name after | Choice, before and after |
| --- | --- | --- | --- |
| `label="ProbeU1"`, unhosted | `ProbeU1, ProbeU1` | `ProbeU1` | `ProbeOne` |
| `accessibilityLabel="ProbeU2"`, unhosted | `ProbeU2` | `ProbeU2` | `ProbeOne` |
| both, equal `ProbeU3`, unhosted | `ProbeU3, ProbeU3` | `ProbeU3` | `ProbeOne` |
| `label="ProbeU4a"` + `accessibilityLabel="ProbeU4b"`, unhosted | `ProbeU4a, ProbeU4b` | `ProbeU4b` | `ProbeOne` |
| `label="ProbeH1"`, hosted | `ProbeH1, ProbeH1` | `ProbeH1` | `ProbeOne` |
| `accessibilityLabel="ProbeH2"`, hosted | `ProbeH2` | `ProbeH2` | `ProbeOne` |
| both, equal `ProbeH3`, hosted | `ProbeH3, ProbeH3` | `ProbeH3` | `ProbeOne` |
| `label="ProbeH4a"` + `accessibilityLabel="ProbeH4b"`, hosted | `ProbeH4a, ProbeH4b` | `ProbeH4b` | `ProbeOne` |
| `host-picker` on the Host screen, `label` = `accessibilityLabel` = "Hosted picker" | `Hosted picker, Hosted picker` | `Hosted picker` | `Beta` |
| `variant="wheel"`, `label="ProbeW"`, 330 pt box | not measured before | `ProbeW`, on the picker element | its `value` = `ProbeMedium` |

The wheel row is a layout check as much as an announcement one: the box read 330.00 × 216.00 after
the fix, which is the box `docs/components/picker.md` records for a wheel with no `label`, so the
label content that went away drew no caption and no size moves. On the wheel the choice is the
element's own `value`; on the menu it is the sibling `static text`, in both cases as before.

The RN wrapper (the element carrying the `testID`) carries `accessibilityLabel` itself, before and
after — React Native puts it there, and the a11y rule deliberately does not count it. For the
`label`-only rows the wrapper stays unnamed, before and after: React Native never sees `label`.
A Picker with neither prop has the tree it had, by construction — `label` unset already passed
`EmptyView` — and row `accessibilityLabel` only, measured twice, is byte-for-byte the same element
before and after.

## Files changed

- `ios/components/Picker/HybridNitroUiPicker.swift` — the `Picker`'s `label:` content becomes
  `EmptyView()`; `OptionalPickerAccessibility` (`accessibilityLabel ?? label`) is the only name.
- `docs/components/picker.md` — the two cells that said iOS is "passed the `Picker`'s label": on iOS
  a `label` is now only the control's a11y name, on neither style drawn.

## Follow-ups

- `scripts/real-input/a11y.mjs`: delete the `A11Y_EXEMPTIONS` row `{control: 'hosted-picker',
  platform: 'ios', followups: 'X4 a11y: a hosted Picker announces its label twice'}` and give the
  `hosted-picker` case `iosTrait: 'button'` (measured, this branch). Both belong with this fix;
  `scripts/` is out of the brief's scope. `docs/tasks/FOLLOWUPS.md`'s X4 row can go with them.
- `real-input:ios` on this branch is red at `a11y:ios-debt` for exactly that stale row, so the merge
  branch needs the two `a11y.mjs` lines before its `real-input:ios` run can be green.
- Other controls' announcements are untouched, as the brief says: `Picker`'s neighbouring findings
  (Slider/Stepper announced as `other`) stay where they are.

## Fix round 1

Three text-only changes, no behaviour change.

- `src/components/Picker/Picker.tsx:70` — the `label` JSDoc told app developers iOS uses it as
  "the menu's title and for accessibility". The menu's title is the selected option. It now says
  Android draws it as the Material 3 field's label, iOS draws nothing for it and names the
  control for accessibility when `accessibilityLabel` is not set.
- `src/components/Picker/Picker.nitro.ts:31` — the same sentence in the internal prop doc, now
  "Android's field label. iOS never draws it: there it is only the a11y name."
- `ios/components/Picker/HybridNitroUiPicker.swift:21` and `:253` — the model comment no longer
  says the label is drawn where the platform draws one, and the sizing comment no longer claims a
  label can change the width; it names what does decide the box, the sizing key. `markDirty()` and
  `noteContentSizeMayHaveChanged()` stay.

No generated file or the API report carries prop doc text (Nitro specs hold signatures only), so
nothing needed regenerating. The two Swift comments moved the iOS platform tree, so
`need --for review` asked for both harness gates beside `check`; both ran under one lease after both
builds. The review's optional guard and the `scripts/real-input/a11y.mjs` line were left alone, as instructed.

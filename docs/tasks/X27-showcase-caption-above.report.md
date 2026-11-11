# X27 — Examples: the caption above the control, and every README screenshot retaken to match

**Branch:** `task/X27-showcase-caption-above` (from `main` at `619e3af6`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `X27-9hhlb` (pair-a — simulator `nitro-ui A` / `emulator-5574` / Metro 8295)

## Summary

`Row` in `example/src/stories/showcase.tsx` laid a caption and its controls out side by side, so half the
README pictures looked broken: Stepper's longest caption pushed the control off
the right margin, IconButton's "each one disabled" and "the toggle form" turned a strip of four
buttons into a column beside the label, and Picker's wheel and Menu's trigger sat behind the text
that described them. `Row` now puts the caption on its own line with the controls in a wrapping row
underneath — the reading `Column`, `Frame` and the Slider and ButtonGroup stories already had. That
is the whole change: 19 added and 13 removed lines in one file, no component code, and no story had
worked around the old layout.

`Row`, `Column` and `Frame` share one captioned container, and `captioned` is the old `column` rule
unchanged (`gap: 6`), so any story that does not use `Row` renders pixel-identically. That settles
the retake set: the seven pairs whose photographed story contains a `Row` — Button `Variants`,
IconButton `Variants`, Stepper `States`, Switch `States`, Progress `States`, Picker `Variants`,
Menu `RowDetails` — and none of the other fifteen (Appendix: the story each pair photographs).
SegmentedControl's `OptionSets` was re-shot on the leased emulator as a control for that argument: it
matches its committed picture to RMSE 0.02 once that picture's 33 px of extra crop headroom is
removed.

Two judgement calls, both reversible:

- **Progress no longer fits one screen.** With every item two lines tall, `States` runs past the
  bottom of both leased devices even with React Native's warnings banner dismissed, so the pair
  stops after the contained-loading row — a clean group boundary, the way Button's pair stops after
  the `LARGE` size it describes — and both alt texts now read "linear, circular, loading and
  tinted".
- **Android's Picker pair is photographed closed.** Material anchors the popup to the first row, so
  open it covers the second row's new caption and the story's note bleeds out beside it. Both
  platforms now show the same two triggers, as iOS always did.

Every crop is measured: the band starts 24 px above the first photographed row
and ends 24 px below the last, so no picture trails a line of the story's note. An earlier
pass did, and a row of pale disabled buttons had hidden that boundary from a row-mean scan; the
bands now come from a per-column ink scan.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2018 tests / 85 suites | `baf64c171dca` | 2 m 58 s | start 18.0 / med 18.0 / max 34.6 |
| `harness:ios` | **PASS** | 598 tests / 31 suites + isolated 6 tests / 3 suites | `baf64c171dca` (ios tree) | 15 m 10 s | start 10.7 / med 13.4 / max 33.1 |
| `harness:android` | **PASS** | 654 tests / 31 suites + isolated 6 tests / 3 suites | `baf64c171dca` (android tree) | 18 m 35 s | start 13.4 / med 6.1 / max 13.4 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

`need --for review`: review is satisfied on this code tree. `real-input:ios` and
`real-input:android` stay missing: they run once at merge, with the full harness.

## Red proofs

- none added: X27 adds no test or gate. The guard that keeps the README pairs honest,
  `scripts/__tests__/readme-components.test.js`, already runs inside `check`, and every retaken PNG
  was re-measured at its documented width (804 iOS / 720 Android) before it was committed.

## Files changed

- `example/src/stories/showcase.tsx`: caption above the controls; `Row`/`Column`/`Frame` share
  `styles.captioned`; `Row`'s controls get a wrapping centred row (`gap: 12`).
- `README.md`: five alt texts re-worded to what the retaken pictures show (Progress ×2, Picker
  Android, Menu ×2).
- `docs/images/components/`: 14 PNGs — `button`, `icon-button`, `menu`, `picker`, `progress`,
  `stepper`, `switch`, both platforms.
- `docs/tasks/X27-showcase-caption-above/before-after-ios.png` and
  `docs/tasks/X27-showcase-caption-above/before-after-android.png`: the before/after strips — rows
  top to bottom Button, IconButton, Menu, Picker, Progress, Stepper, Switch; left = before, right =
  after.

## What the pictures still show

- Menu (both platforms): with the menu open, the story's `Note` text still shows beside the popup.
  Pre-existing, and unavoidable while the popup is anchored over the note — see Follow-ups.
- Picker iOS: SwiftUI's `.wheel` reserves 220 pt and centres its rows, so its caption sits a clear
  line above the visible text. Inherent to the control, not to the helper.
- Progress: the `appearance="wavy"` rows are no longer in the README pair (Summary, first bullet).
- IconButton Android: the disabled `outlined` circle keeps its enabled outline colour where iOS dims
  it — a component bug, not a layout one.
- Nothing else: no clipped, squeezed or overlapping control left in the seven pairs.

## Follow-ups

- Menu/Picker stories: a story whose presentation is photographed should keep its `Note` out of the
  popup's way (CONTRIBUTING's `Dialog`/`Confirmation Plain` rule) so the pair can be cropped clean.
- Progress `States`: with a caption on its own line it no longer fits one screen; consider splitting
  the `appearance="wavy"` rows into their own story.
- IconButton (Android): disabled `outlined` keeps its enabled outline colour.
- lease-core: `scripts/lease-core.mjs:1111` exports `IOS_SIM` as the simulator *name* (`CONTRIBUTING.md:960`), and
  pair-a exports `iPhone 17` while its own pool simulator is named `nitro-ui A` and a *third*, non-pool simulator that
  was already booted is literally named `iPhone 17` — so an early `agent-device --device "$IOS_SIM"` bound that one and
  an app launch/terminate landed there (nothing was powered off, wiped or killed; every later run pinned `--udid`).
  Drive by `--udid`, or export the UDID-shaped value instead.
- merge: this branch is from `619e3af6` and `main` has moved on since; merging here would re-stamp
  every gate and app build, so the merge (and its `regen`) belongs to the integrator, not this round.

## Questions for orchestrator

- Progress: accept the pair that ends after the contained-loading row (shipped, alt texts updated),
  or split the wavy rows into a separate story and photograph four shorter stories? Recommendation:
  accept for now, split as its own task.
- Picker (Android): closed pair (shipped) or the old open-menu picture that covers the row below it?
  Recommendation: keep it closed; re-open it only if the story's note moves.

## Appendix: the story each pair photographs

Fifteen of the twenty-two pairs could move under this change, because their component's story file
uses showcase `Row` somewhere. The seven that were retaken are exactly the ones whose *photographed*
story uses it; the other eight use `Row` only in stories nobody photographs:

| Pair             | Photographed story | Containers there                            |
| ---------------- | ------------------ | ------------------------------------------- |
| Slider           | `Steps`            | `Column` only                               |
| ButtonGroup      | `Appearances`      | `Column` only                               |
| SegmentedControl | `OptionSets`       | `Column` only                               |
| DatePicker       | `Variants`         | `Frame` only                                |
| SearchField      | `States`           | `Column` only                               |
| BottomSheet      | `FitsItsContent`   | `Column` only                               |
| ContextMenu      | `Conversation`     | its own chat bubbles, no showcase container |
| Form             | `Playground`       | no showcase import in `Form.stories.tsx`    |

The remaining seven pairs (`AlertDialog`, `ConfirmationDialog`, `Chip`, `Checkbox`, `TextField`,
`Tooltip`, `Popover`) photograph stories in files that never mention showcase `Row`. The story each
picture comes from is the one its README alt text describes, since nothing in the repo records it.

One width question has no picture to defend it: a `fillWidth` control
(Progress, Slider, TextField, SearchField, ButtonGroup) is measured against the line's width, so a
`Row` holding one fills the page under its caption as it did beside it. Nothing needed a per-story
width to keep that true. And nothing on this branch's base worked around the old `Row` — X24's
Stepper caption column has not landed on `main` — so no story needed unwinding.

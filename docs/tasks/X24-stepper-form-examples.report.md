# X24 — Stepper and Form: examples and screenshots that lay out properly

**Branch:** `task/X24-stepper-form-examples` (from `main` at `404eaad3`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** none — `acquire --task X24 --boot --wait-minutes 240` timed out twice, ≈5 h queued (see "Device half pending")

## Summary

**Was Form's misalignment a component bug? Not horizontally, and the vertical half is not
`Form.Row`'s either.** `Form.Row` is `flexDirection: 'row'` with `alignItems: 'center'`, at the
cell's content width (`src/components/Form/Form.tsx:581`, `:590`), so the README's
`<Text style={{ flex: 1 }} /><Switch />` pair does reach the row's trailing edge. The `Sections`
story never used `flex: 1` at all: it put a plain `<Text>` beside the `Switch`, so the picture
was not the code the README prints.

The vertical half is real and general: 14 components carry `{ alignSelf: 'flex-start' }` as
their base style (React Native's own `Switch` has the same defence, and it is load-bearing — a
stretched box decides an intrinsic control's size, so the measurement is never asked). A child's
`alignSelf` beats its parent's `alignItems`, so in any row taller than its content — every Form
row is, at `minHeight: 44` / `56` — the control sticks to the row's top edge while the label
centres. That is why the examples and `docs/components/form.md` now wrap a row's content in
`{ alignItems: 'center', flex: 1, flexDirection: 'row' }`: the box hugs its content, so the two
rules have no leftover room to disagree about. A component-level fix is cross-cutting, so it is
a question below, not a guess.

**The squashed Android steppers are a starved box, not a clipped drawing bug.** In
`showcase.tsx`'s `Row` the caption may not shrink and the content wrapper is the only thing
allowed to, so a long caption leaves the Stepper a box narrower than the width the engine
measured. iOS paints outside that box (sizing.md §9 — SwiftUI refuses to shrink); Android's
C1 placement pass re-measures the content *under* the box width, `Modifier.size()` clamps to
the constraints, and the two `FilledTonalIconButton`s come out as ellipses. The story now
gives the caption a column and the control `flexShrink: 0`.

The Stepper `States` and Form `Sections` stories read as one settings list each, and README,
`readme-examples.tsx` and `form.md` agree with each other. **What did not happen is the
photography and the device gates:** with no pair, the four PNGs are still the ones on `main` and
the new case has never run, so the claims above rest on the components' styles rather than a
measurement, and the red proof is un-run too. The other twenty pairs are swept below; that part
needed no device.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2013 tests / 85 suites | `c6648f07c513` | 2 m 55 s | start 13.8 / med 19.6 / max 25.3 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

`need --for review`: 2 gate(s) missing for review: harness:ios, harness:android — `check` green
on `c6648f07c513`, the whole device half outstanding.

## Before / after

What the README shows today, from `main`, byte-identical to `docs/images/components/`:

| | iOS | Android |
| --- | --- | --- |
| Stepper | ![Stepper iOS before](X24/before/stepper-ios.png) | ![Stepper Android before](X24/before/stepper-android.png) |
| Form | ![Form iOS before](X24/before/form-ios.png) | ![Form Android before](X24/before/form-android.png) |

There is no `after` row yet: the retake needs a simulator and an emulator, and the committed
`docs/images/components/{stepper,form}-{ios,android}.png` are these same four files. Every
defect the brief describes is visible here — iOS's steppers overlap their own captions and run
off the right edge, Android's `+` halves are ellipses at three rows in five, and each Form
switch sits against its label instead of at the trailing edge.

## Red proofs

None run: `Form row content (X24)` has never been on a device, because there was never a lease.
The mutations are chosen, so one filtered run each proves them — `gate.mjs harness:ios -- Form`
and `harness:android -- Form`, which record as `harness:*:Form` and satisfy nothing:

- `TrailingEdgeForm`'s row two, drop the box (label and control become the row's children and
  the control's wrapper carries `x24SelfSizing`) → expect `the control is centred at y=… while
  its label is centred at y=…`.
- `x24Styles.label` from `{ flex: 1 }` to `{}` → expect `the control ends at x=… while the
  row's content ends at x=…`, and the same for the box-less row-three pair.

The fixture is what gets broken, not `Form`, because the claim is about what a row gives its
content: a mutation inside `Form` cannot redden the boxed pair, since the box hugs its content
and so the row's `alignItems` moves the pair without moving it — which is the same reason the
boxed pattern is the advice. The case's own `X24 BARE pair` / `X24 BOX pair` lines carry the
numbers the summary is missing.

## Files changed

- `example/src/stories/Form.stories.tsx`, `example/src/readme-examples.tsx`, `README.md`,
  `docs/components/form.md` — a Form row's content goes in a box that fills the row and
  centres what it holds; the three copies of the example are the same code again.
- `example/src/stories/Stepper.stories.tsx` — `States` becomes a caption column with the
  controls on one trailing edge (`flexShrink: 0` keeps a control its measured width).
- `example/__tests__/Form.harness.tsx` — `Form row content (X24)`: a probe row measures the
  row's content box, and the case asserts the trailing edge and the label's middle.
- `docs/tasks/X24/before/` — the four shots that are on `main`, copied so an `after` can be read
  against them. `docs/images/components/{stepper,form}-{ios,android}.png` are unchanged: the
  retake is what a device pair still owes.

## Sweep of the other pairs

The other twenty pairs reviewed at README width and at full size. No other control is clipped or
squashed by a component; what is wrong is either a crop or `showcase.tsx`'s `Row`:

- `icon-button-{ios,android}`: "each one disabled" and "the toggle form" hand four controls
  to `Row`, whose content box is a *column*, so the strip is four tall and its caption
  floats alone at the left; on Android the strip runs to the crop's bottom edge.
- `button-group-android`: the crop ends across the last caption ("each variant at the
  medium ring"), so its row is below the fold.
- `confirmation-dialog-android`: the trigger is sliced across its top edge by the crop.
- `date-picker-android`: a band of calendar background with no dates in it under the last
  row, inside the dashed frame — a measured height larger than what the calendar draws.
- `checkbox-ios`: the picture is iOS `Switch`es, because iOS's Checkbox *is* a switch-style
  `Toggle` today — already decided as D47 and being changed by G31, which owes this pair a
  retake.
- `menu`, `picker`, `popover`, `context-menu`: a presentation drawn over the caption under
  its trigger. Inherent to photographing a presentation on a populated page, and the
  CONTRIBUTING note about `Confirmation Plain` is the recipe for avoiding it.
- Root cause for the two the brief sent me: `Row`'s `content: { flexShrink: 1 }` with a
  caption that may not shrink. 13 story files use `Row`; the one-line change
  (`label: { flexShrink: 1 }`, `content: { flexShrink: 0 }`) is honest but retakes about ten
  pairs, so it is not mine to make from a screenshots task.

## Device half pending

One pair, in this order — everything here is scripted, so it is ~45 min of device time:

1. `node scripts/build-app.mjs --platform <p>`: both artifacts are already stamped for
   `c6648f07c513`, so this is a no-op unless a story changes on the way.
2. Retake the four PNGs by CONTRIBUTING's recipe (`stepper--states`, `form--…`). For the Form
   pair pick **one** story and shoot both platforms from it: `form--sections` renders `push` /
   `sound` uncontrolled (both switches off) while the README's state is `useState(true)` /
   `useState(false)`, and the pair on `main` already mixes the two — the iOS half reads like
   `form--playground` (first switch on) and the Android half like `form--sections` (both off).
   `form--playground` on both is the closer match to the README code, and its
   `quiet-hours presses:` line sits under a 420 pt form, below the crop.
3. `harness:ios`, `harness:android`, `real-input:ios`, `real-input:android` — the brief asks for
   all four because `example/__tests__/Form.harness.tsx` changed.
4. The red proofs above, last: a mutated fixture changes the code tree, so the app gets rebuilt
   for them and the stamp stops matching the round.
5. Undo the scratch `initialSelection`, `RCT_jsLocation`, `debug_http_host` and the
   `tcp:<port>` reverse; then `gate.mjs table`, `export --task X24` and `task-ready`.

Worth 30 s while the pair is up: `form--sections` on iOS. If iOS really draws the *first*
uncontrolled `Switch` on and the second off, that is a component question, not a story one, and
the `main` pair hints at exactly that.

## Follow-ups

- pool: three device tasks (G29, G30, G31, then X24) against `maxDeviceLeases: 2`; X24 queued
  ≈5 h and twice watched a pair released and re-taken by another task within seconds.
- docs/images: the Form pair on `main` is two different stories — one switch on in the iOS half,
  none on in the Android half — so the two halves are not the same example.
- sizing/Android: an `intrinsic` control whose box is narrower than its measured width is
  laid out *inside* that box by the C1 placement pass, and `Modifier.size()` clamps — a
  fixed-shape control (Stepper's two icon buttons) draws squashed where iOS overflows. A
  min-size for fixed-shape content, or an opt-out of the placement pass, would match iOS;
  `clipChildren` means the drawing is clipped either way, so the app-side layout rule is
  what users actually need.
- showcase: `Row` lets its content wrapper shrink under a caption that cannot (13 story
  files, ~10 README pairs affected if changed).
- docs/images: `button-group-android` and `confirmation-dialog-android` are cropped inside
  content; `date-picker-android` shows a calendar band it does not draw into.
- docs/images: `checkbox-ios` needs a retake when G31's checkmark lands (D47).

## Questions for orchestrator

- **Where should a control in a `Form.Row` be centred?** The fact, from the styles: a self-sizing
  control directly in a row takes the row's top edge while its label centres, because its base
  `{ alignSelf: 'flex-start' }` beats the row's `alignItems: 'center'` (the new case logs the
  delta in dp on both platforms; it has not run yet, so the number belongs to the next round).
  Options: (a) leave it and document the content box — what this round did, because it
  matches React Native, costs nothing, and touches no other component's layout;
  (b) give `Form.Row` an internal content wrapper — fixes the bare pattern too, but adds a
  Yoga node per row (Form is benched at N=200) and quietly changes what a row's `style`
  applies to; (c) change `SELF_SIZING_BASE_STYLE` to `{ alignSelf: 'center' }` — fixes every
  row, but left-aligns nothing in a column any more, so every control in a settings column
  moves to the middle and every screenshot pair moves with it. Recommendation: (a) now, and
  if the owner wants the bare pattern to centre, (b) as its own task with a Form benchmark
  run — G31 and G30 (`ListItem`) are both in row layout right now and would want the same
  answer.
- **How does X24 get an hour of device time?** The code, docs and the new case are committed and
  `check` is green on `c6648f07c513`; what is missing is a screenshot session and four device
  gates, and `need --for review` cannot pass without the two harness runs. Options: (a) re-run
  the device half as a fix round when a pair is free — recommended, nothing has to be redone;
  (b) an `--exclusive` lease out of hours, which waits for both other tasks to end and then
  holds the machine; (c) `maxDeviceLeases: 3` on this box, which buys capacity with the load
  that D21 kept two leases for. Recommendation: (a) now, and (c) only if the queue stays three
  deep.

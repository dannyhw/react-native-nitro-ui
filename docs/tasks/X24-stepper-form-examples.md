# X24 — Stepper and Form: examples and screenshots that lay out properly

**Worktree / branch:** named in your delegation message (`task/X24-stepper-form-examples`). **Round cap:** 1 round,
plus at most 2 fix rounds (D19). **Devices:** your lease (`node scripts/lease.mjs acquire --task X24 --boot`). Export
the lease's environment before any device gate.

## The problem (owner, 2026-11-10)

The README screenshots for Stepper and Form look broken:

- `docs/images/components/stepper-{ios,android}.png`: each row puts a long caption and a stepper on one line. The
  steppers don't line up, on iOS they overlap the captions and run off the right edge, and on Android some `+`
  buttons are squashed or clipped.
- `docs/images/components/form-{ios,android}.png`: each switch sits right after its label instead of at the row's
  trailing edge, and it is not vertically centred on the text, on both platforms. The README's own example gives the
  label `flex: 1`, which should push the switch to the trailing edge, so **this may be a real `Form.Row` layout bug**,
  not only a story problem.

## Do

1. **Form first: is it the component?** Render the README's `form` example exactly as written. If the switch doesn't
   sit at the trailing edge, vertically centred, find why in `Form.Row`/`Form.Section` (the row's content not
   stretching to the row's width, a missing `alignItems`, the cell's content view on iOS, the in-place row on Android)
   and fix it in the component, with a harness test shown red first (the trailing control's right edge equals the
   row's right inset; its centre equals the text's centre within a point). A row's content should lay out the way a
   React Native `View` with `flexDirection: 'row'` at the row's full content width would, and the docs say what the
   row gives its children.
2. **Squashed Android steppers:** if a Stepper shrinks below its measured width when its row runs out of room, that is
   a sizing bug (an intrinsic control should not be squeezed into a clipped drawing); fix it (e.g. the wrapper's
   `flexShrink: 0`, or whatever the sizing engine's intrinsic contract says) with a red test, or say why not.
3. **Stories and README examples:** rework the Stepper and Form stories so the screenshot reads like a real settings
   screen: captions on their own line or a label column with the controls aligned to the trailing edge, consistent
   spacing, nothing clipped or overlapping, on both platforms. Keep the README usage code and the stories consistent
   (the screenshot should be what the README code draws).
4. **Retake** all four PNGs (iOS 804 px, Android 720 px, light, Storybook, per CONTRIBUTING).
5. **Sweep:** look at every other `docs/images/components/*.png` for the same kinds of problem (misalignment, clipping,
   overlap, missing spacing). List what you find in the report; fix the stories and retake shots only for clear layout
   bugs in examples, and report component bugs as FOLLOWUPS lines rather than fixing them here.

adb `-s <serial>` on your own leased emulator is approved for screenshots. Undo `adb reverse` and the debug-host
preference afterwards, and restore any setting you change (read it first; never `cmd uimode`, not even to read).

## Gates

`check`, plus both `harness:*` and both `real-input:*` if any component or harness code changes, then
`need --for review`. Report at `docs/tasks/X24-stepper-form-examples.report.md`, with before/after images.
Export the ledger with `gate.mjs export --task X24`.

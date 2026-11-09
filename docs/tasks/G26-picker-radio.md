# G26 — Picker `variant="radio"`

**Worktree / branch:** named in your delegation message (`task/G26-picker-radio`). **Round cap:** 1 round, plus at
most 2 fix rounds (D19). **Devices:** your lease (`node scripts/lease.mjs acquire --task G26 --boot`). Export the
lease's environment before any device gate.

## Read first

- AGENTS.md: the perf contract, the event-count handshake, red proofs, **never `pkill`/`killall`**, the README rule
  (D4).
- `docs/DECISIONS.md` D16, D17, **D38 item 4** (radio falls back to the menu on iOS), D39 and D40.
- `docs/tasks/Q7-next-components-2.report.md` **Appendix D** (the design, build-ready).
- Picker as it is on `main` (`docs/components/picker.md`, `src/components/Picker/Picker.tsx`,
  `HybridNitroUiPicker.kt`, E2's Picker rows), and the sizing engine's declared fallbacks.

## Do

Build Appendix D on Picker:
1. **`variant: 'menu' | 'wheel' | 'radio'`**, with the value, clamps, handshake, `onChange`, `label`, `disabled` and
   `tintColor` unchanged.
2. **Android:** Material's radio-group pattern: a `selectableGroup()` column of 48 dp rows, each `selectable` with
   `Role.RadioButton`, a `RadioButton(onClick = null)` and the label; the tint through a bounded colour cache like
   `PickerColorsCache`; picking the selected row reports nothing.
3. **iOS:** `radio` renders `menu`. The docs say so, and point apps that want every option visible to
   SegmentedControl for up to about five options.
4. **Sizing (D17):** `intrinsic` on Android, key `radio|count|labels…` with no selection term, one-line labels with an
   ellipsis, variant changes remount. Measure the 48 dp rows on the device rather than copying Q7's numbers. The cold
   first frame uses the component's declared fallback and is corrected, as Q7 says; document it.
5. **Accessibility:** one node per row with its selected state, and TalkBack's "1 of N" from `selectableGroup()`.
6. **Docs:** `picker.md` (the variant, the iOS fallback and the cold-frame note), the README Picker usage block, a
   story, and a minor changeset. Retake `picker-android.png` only if the story's first screen should show the radio
   variant; say what you chose.

## Tests, each shown red first

Q7 D3's harness list (three and five options measured from a poisoned fallback; a pick costs 0 corrections, red with
`sel:` put back in the key; `nuiTestSelect`; a refused pick snaps back; picking the selected row reports nothing;
disabled sends nothing; iOS reports `style=menu`; recycling from `radio` to `menu` resets), plus real input on Android:
a tap on row 2 echoes it, and the dump shows only the selected row checked and disabled rows `enabled="false"`.

## Not in scope

Real Android wheels (a separate task), Dialog rows, and anything else, which goes as one FOLLOWUPS line.

## Gates

`check`, both `harness:*` and both `real-input:*`, then `need --for review`. Report at
`docs/tasks/G26-picker-radio.report.md`. Export the ledger with `gate.mjs export --task G26`.

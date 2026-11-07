# S6b — Form spike, round 2: the unmeasured iOS taps, the keyboard and `measure`

**Worktree / branch:** named in your delegation message (`task/S6b-form-spike`, from S6's prototype). **Round cap:** 1
round (a spike; D19). The prototype is never merged: the report merges, the code stays on the branch. **Devices:**
your lease (`node scripts/lease.mjs acquire --task S6b --boot`). Export the lease's environment before any device
gate.

## Why

S6 (`docs/tasks/S6-form-spike.report.md`) came back NO-GO only because some of what GO rests on was never measured.
Reparenting, fidelity, sizing and the Android press all passed. Still missing:
- **real iOS taps** on a `Switch` and a `Pressable` inside reparented cells, and on a row with `onPress`;
- the **keyboard** (question 5);
- **`measure()` on iOS**, which returns the Form's box instead of the row's.

Taps are the one thing a Form cannot ship without, and a wrong `measure()` breaks anything anchored to a row (Tooltip,
Popover, ContextMenu). These need answers before a three-round build is briefed.

## Read first

AGENTS.md, `docs/tasks/S6-form-spike.md`, the S6 report (all of it, especially question 4, "Files changed" and the
questions), and Q10 Appendix C1 and E. The prototype is on `task/S6-form-spike` (`a8a8da22`).

## Do

1. **iOS real taps (question 4):** add a Form screen to the example app outside the harness bundle, a `screens.mjs`
   entry and an XCUITest case in `real-input:ios`, following how other controls are added there. Over 10 runs: a
   `Switch` in a row toggles once per tap, a `Pressable` in a row fires once, a row with `onPress` fires once and shows
   the cell highlight, and a tap outside any row does nothing. *Go:* 10/10 each. If the press path S6 invented is
   broken, fix it in the prototype and say what it had to be.
2. **Keyboard (question 5), both platforms:** a `TextField` row near the bottom of a long form is focused by a real
   tap and stays visible above the keyboard (Android with a full software keyboard, not the hardware-keyboard
   toolbar). *Go:* visible on both.
3. **`measure()` / `measureInWindow` of a row on iOS:** find why it returns the Form's box. Try to make the shadow
   tree agree with where the cell really is (for example, rows laid out at their cell frames through the Form's
   state), so `measure` is right after scrolling too. *Go:* right on 10/10 rows after a scroll, or a written reason
   it can't be, with what anchors in rows would then need.
4. **S6's two answers, applied:** the row box matches SwiftUI's 52 pt (not 60), and the Android section header gets
   its own Compose layer sized to the header band, so rows no longer paint over it. Retake both screenshots.

## Output

Append `## Round 2` to `docs/tasks/S6-form-spike.report.md` (S6b's report lives there): GO or NO-GO first, then
each item's result, evidence and go line, then what G-Form must know. GO needs items 1 and 2, and item 3 either right
or explained with a plan. `## Questions for orchestrator` for anything the owner should decide.

## Not in scope

The cost bench (G-Form's job), a `ListItem` leaf, a virtualized List, and anything else, which goes as one FOLLOWUPS
line.

## Gates

`check` on your branch. Every claim needs its evidence. Export the ledger with `gate.mjs export --task S6b`.

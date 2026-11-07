# E5 — Slider: a real drag start on Android, and the real-input drag flake

**Worktree / branch:** named in your delegation message (`task/E5-slider-drag-start`). **Round cap:** 1 round, plus
at most 2 fix rounds (D19). **Devices:** your lease (`node scripts/lease.mjs acquire --task E5 --boot`).

## Read first

- AGENTS.md: the perf contract, the event-count handshake, red proofs, **never `pkill`/`killall`**.
- `docs/DECISIONS.md` D17, D39 and D40.
- `docs/tasks/Q8-expressive-and-holdbacks.report.md`: Appendix C row 9 (Slider) and the "pass (Slider)" row (around
  line 258).
- `docs/components/slider.md`, especially Limits ("Android start events are inferred").
- `HybridNitroUiSlider.kt` as it is on `main`: X18 already moved it to the state-based `Slider(state = …)`, so the
  move itself is done. What's left is the start event.
- `scripts/real-input/android.mjs` and `scripts/real-input/report.mjs` (X20's `runCheck`).

## Do

1. **A real drag start on Android.** Today `onSlidingStart` fires on the first value change, so a touch that never
   changes the value reports nothing.
   - Drive the start from the control's own interaction: the `interactionSource` (`DragInteraction.Start` /
     `PressInteraction.Press`) or `SliderState`'s drag state, whichever material3 1.5.0-beta02 makes reliable. Say
     which you chose and why.
   - A touch-down on the thumb or track fires `onSlidingStart` once, and its release fires `onSlidingComplete`
     once, even when the value didn't change. A drag fires start, then the value changes, then complete, in that
     order.
   - A screen-reader step (an accessibility action) stays as today: it reports what iOS reports for the same action.
     Write the rule in `slider.md`.
   - JS writes during a drag, the frame pump and the event-count handshake are unchanged.
   - Update `slider.md`'s event table and Limits to match.
2. **The real-input drag flake on Android.** `hosted-slider` has failed alone on several branches (E4, and others
   before it) and passed on a re-run: the drag reached about 0.43 where the check wants more than 0.7. E4 traced it
   to `scripts/real-input/android.mjs` settling the echo right after `swipe`, so an in-flight gesture can settle
   mid-drag, and drags have no retry where press sequences do.
   - Find the real cause from the logs (`gate.mjs logs --failed --all` and the committed failure excerpts under
     `docs/tasks/*/failures/` that name `hosted-slider`), and fix it so a drag waits for its gesture to finish.
   - Don't fix it by loosening the threshold. A retry is acceptable only alongside a fix of the cause, and it must
     be reported in the run's retry count the way press retries are.

## Tests, each shown red first

- **Harness, Android:** a touch-down with no value change fires one `onSlidingStart` and one `onSlidingComplete`; a
  drag's events arrive in order; a JS write mid-drag is still handled as today.
- **Harness, iOS:** unchanged; the existing tests stay green.
- **Real-input, Android:** a real touch on the thumb with no movement echoes start and complete; a real drag echoes
  start, the value changes, then complete. Show the drag-settle fix red first: for example, settle at the old point
  under a slowed swipe and see the old failure.
- **Real-input, iOS:** still green.

## Not in scope

Icons (D43 is being designed), `VerticalSlider`/`CenteredTrack` (Q8 says skip unless asked), and anything else,
which goes as one FOLLOWUPS line.

## Gates

`check`, both `harness:*` and both `real-input:*`, then `need --for review`. Report at
`docs/tasks/E5-slider-drag-start.report.md`. Export the ledger with `gate.mjs export --task E5`.

# E4 — Material 3 Expressive, pass 2: Progress `variant="loading"` and `appearance="wavy"`

**Worktree / branch:** named in your delegation message (`task/E4-progress-loading-wavy`). **Round cap:** 1 round, plus
at most 2 fix rounds (D19). **Devices:** your lease (`node scripts/lease.mjs acquire --task E4 --boot`).

## Read first

- AGENTS.md: the perf contract, red proofs, **never `pkill`/`killall`**, the README rule (D4) and CONTRIBUTING's "README
  screenshots" (804/720 px, Storybook, light). The README is for app developers only.
- `docs/DECISIONS.md` D17 (measured sizing), D39 and D40.
- `docs/tasks/Q8-expressive-and-holdbacks.report.md`: Appendix C row 10 (Progress), Appendix D rows 3 and 5, and
  Appendix E "Pass 2" (around line 290). Where this brief and Q8 differ, the brief wins.
- `docs/components/progress.md` and the Progress source on both platforms, as it is on `main`: the two variants, the
  remount on a `variant` change, the declared fallbacks, and "the indeterminate animation stops when nobody can see
  it" (`nuiTestIsAnimating`).

## Do

1. **`appearance: 'flat' | 'wavy'`** (default `'flat'`), for both `linear` and `circular`.
   - **Android:** `'wavy'` draws `LinearWavyProgressIndicator` / `CircularWavyProgressIndicator`, determinate and
     indeterminate, with Material's defaults for amplitude, wavelength and speed. Check in the material3
     1.5.0-beta02 jar that both are stable, and say so in the report.
   - **iOS:** has no wavy indicator, so it draws flat. Document it; don't fake a wave.
2. **`variant: 'loading'`**, Material's LoadingIndicator (the morphing shape), with **`contained: boolean`** (default
   `false`) for `ContainedLoadingIndicator`.
   - **Android:** `LoadingIndicator` / `ContainedLoadingIndicator`, determinate when `value` is set and
     indeterminate otherwise. They are `@ExperimentalMaterial3ExpressiveApi`: opt in at the narrowest scope (one
     file), and write in the report what the opt-in risks at material3 1.5.0 stable.
   - **iOS:** a circular `ProgressView()`, which is the closest native control. Document it.
   - `appearance` doesn't apply to `loading`; say what a `wavy` + `loading` combination does (ignored, documented).
3. **Sizing (D17).** Each configuration has its own box: wavy bar 10 dp against flat 4, wavy ring 48 against flat
   40, and loading 48 dp around a 38 dp shape (Q8's numbers; measure them, don't copy them).
   - The sizing key carries `variant`, `appearance` and `contained`.
   - Each configuration gets a declared fallback and a conformance rule, against a fixture that doesn't coincide
     with the real size.
   - A change of any of the three re-measures, the way a `variant` change does today. Keep the remount only if the
     report shows it's needed.
4. **The animation invariant.** `nuiTestIsAnimating()` holds for every new configuration: an indeterminate wavy or
   loading indicator animates while visible and stops when hidden, detached or recycled.
5. **Accessibility.** Same semantics as today: a progress bar with a value, or indeterminate. `loading` reads as
   indeterminate when it has no value. Say what TalkBack and VoiceOver read for each new configuration.
6. **Recycling.** The reset clears `appearance` and `contained`.
7. **Docs and README.** `progress.md` gets the new props, the platform table, the sizes table and the iOS
   fallbacks. README: add `loading` and `wavy` to Progress's usage block, and retake `progress-android.png` /
   `progress-ios.png` if the story's first screen should show them (say what you chose). Add Storybook stories for
   each configuration. Changeset: a minor.

   adb `-s <serial>` on your own leased emulator is approved for screenshots. Undo `adb reverse` and the
   debug-host preference afterwards, and restore any setting you change (read it first; don't use `cmd uimode
   night`).

## Tests, each shown red first

- **Harness, both platforms:** each configuration's measured size against its fallback; a change of `appearance`,
  `variant` or `contained` re-measures; the animation invariant per configuration; the recycle reset.
- **Harness, Android:** the wavy and loading configurations draw the intended composable, shown through the node
  tree or a pixel probe (`core/NitroUiPixelProbe.kt` lands with G19; if it hasn't merged when you start, use the
  node tree).
- **Unit:** the sizing key includes all three props (a test that fails when one is dropped).
- **Real-input:** no new input. Both real-input gates must stay green.
- **Bench:** none needed. If you think the wavy animation's cost needs one, add a FOLLOWUPS line.

## Not in scope

Icons of any kind (D43 is being designed), Slider, and anything else, which goes as one FOLLOWUPS line.

## Gates

`check`, both `harness:*` and both `real-input:*`, then `need --for review`. Report at
`docs/tasks/E4-progress-loading-wavy.report.md`, with the API and the platform mapping at the top. Export the ledger
with `gate.mjs export --task E4`.

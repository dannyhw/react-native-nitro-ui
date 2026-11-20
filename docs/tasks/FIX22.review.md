FIX ROUND

FIX22 review of b395b3c3 against task/FIX21-search-field-app-language. Scope is clean: five files, no library, tooling or shared-helper changes, one author address,
nothing personal. `check` was not run: lease FIX21 shows a simulator `in use (real-input:ios)`.

## Must fix

M1. `example/e2e/real-input/slider.e2e.ts:10`: `ECHO_SETTLES_MS = 20_000` is a raised timeout. The
file's usual timeout is the config's `assertionTimeout: 10_000` (`example/e2e/e2e.config.ts:37`),
which the same test already uses at `:55` (`toHaveText('0.250')`). The brief's "Decided already"
says "the file's usual timeout ... never a longer timeout", and the report says "no timeout was
raised" (`FIX22.report.md:32`), which is false for this wait. Its stated reason does not
hold: the 1.7 s CI swipe is awaited inside `drag()` before the budget starts. Fix: give the wait 10 s (the config value), correct the
report sentence, and rerun `real-input:android -- --control slider`.

## Notes

N1. `settledValue` (`slider.e2e.ts:21-39`) is two parts. "Moved off `before`" is a real signal: the
echo is JS state, and its changing means the drag's change reached JS. "Two reads 250 ms apart
agree" is a guess based on time, not a completion signal. It returns the first plateau. A delivery
gap longer than about 250 ms plus one read can return a value from mid-delivery, and drift slower
than 0.001 per read looks settled. Neither passes a broken slider: the bounds are unchanged and a
drag that moves nothing fails at the wait. The cost is a false red (a plateau of 0.5 or less, or an
unfinished first-drag tail read as `back`). The brief allows "two equal reads", so this is not an M. A real completion signal
exists in the library: `onSlidingComplete`. The Phases slider shows it as `complete=N`
(`example/src/SliderScreen.tsx:171`), and `hosted-slider.e2e.ts:50` waits on it. A follow-up could
add the same count beside the Controlled slider and wait on it.

N2. `HostPopups.harness.tsx:199`: `indexReached` uses the file's own `waitForAnswer` default
(8000 ms, `:155`). That is the usual timeout, not a raised one. The getter returns `state.js`,
the last write from React (`HybridNitroUiPicker.kt:1087-1091`), so the wait is on the prop
arriving, as the old read was. The `toBe` after it is a tautology (the helper returns the expected
value or throws); the throw is the check, and the red proof shows it fails. The expected indices are unchanged
at `:776`, `:796` and `:820`.

N3. SearchField `jsEvents === nativeEvents` means what the report says, on both platforms.
`useControlled.ts` sets the echo, then calls `onChange` in the same handler, so the commit that
carries `jsEvents` reaches native only after the test's `log` push. Native counts text changes
only, and publishes before `onChange`: iOS at `NitroUiTextEditing.swift:347-353`, Android at
`HybridNitroUiTextField.kt:153-156`. Focus, blur and submit are not counted. Both platforms
republish `jsEvents` in `afterUpdate`. On Android, `afterUpdate` runs `catchUp()` first
(`HybridNitroUiSearchField.kt:577-583`), and the snapshot's text is read live from `textState`, so
no snapshot shows `''` with the clear uncounted. Each assertion is still independent of the wait:
the log equals `['change:']`, `nativeEvents === typed + 1`, and focus and no-blur are checked. The
wait uses `stateWhen`'s default of 5000 ms, which is unchanged.

N4. Red proofs match their mutations, and the mutation sites exist. The SearchField proofs ran
on Android only. The iOS meaning is covered by N3 and by the green
`harness:ios`. The "recleared" proof turns red at the new wait, not on the guarded empty submit.
The guarding assertions (`SearchField.harness.tsx:609-611`) are unchanged, so they still catch it.

N5. Flake sighting to record: `Form section drawing (E2, Android) > reserves a band with its
padding and draws into a layer as tall as its section (E2)`, `harness:android` started
2026-11-20 00:05:05Z. It failed once in 678 and passed alone on the one allowed rerun:
sequence-dependent, unrelated to this diff.

N6. The comment at `slider.e2e.ts:9` ("CI has taken seconds for a swipe") gives a reason that
does not apply (see M1) and reads as history. Reword it with M1. Also, `:56` reads `start` straight
after asserting the literal `'0.250'` at `:55`, which is redundant but harmless.

# FIX25 — When the Android Form keyboard case fails, it records why

**Branch:** `task/FIX25-form-keyboard-diagnostics` (from `main` at `4ee96b56`) ·
**Round:** 1 of up to 3 · **Lease:** `FIX25-duhri` (`emulator-5574` / Metro `9295`) — granted after ~55 min in the queue
behind two held pairs and `FIX24`; both Form runs then went on it.

## Summary

The keyboard case in `example/e2e/real-input/form.e2e.ts` now catches the one read it cannot
explain — `fieldAboveKeyboard`, whose helper is shared and unchanged — and rethrows it with the
evidence that says which of two things happened. Nothing new runs when the case is green: every
read sits in the `catch`.

Under the driver's own message the failure carries: the window manager's `ime` inset for this
app's window, through the same reader the helper measures against; the input method service's own
lines (`mInputShown`, `mInputEditorInfo`, `visibleTopInsets`), printed rather than parsed — whether
a keyboard is on screen for a person and whether the IME still holds this field's editor; the
app's focus and avoidance echoes; what the driver resolves for that locator and for any `textbox`;
the driver's own snapshot, with the boxes of its editable nodes; and the raw `uiautomator dump`'s
node the caret is in — bounds, `visible-to-user`, focus, and the labels of the nodes inside it. The
block is headed by the question the brief asks for: *did the keyboard close while the field stayed
focused?* `mInputShown` against `focus yes` answers it; the last two lines answer the alternative —
a focused, editable node the locator will not name, which is the CI signature.

Two decisions:

- The error comes back with its message extended, not wrapped, so the trace still headlines
  `LOCATOR_NOT_FOUND` with the driver's per-filter candidate counts. Each read is guarded on its
  own: a read that fails says why instead of replacing the failure.
- The Form's own `ime=` and `scroll=` are not readable from outside the app on Android —
  `example/src/FormScreen.tsx` polls `nuiTestFormReport()` on iOS only — so the block carries the
  window manager's `ime` inset, the number the Form is measured against anyway, and the field's
  box from the tree. See "Questions".

Both filtered runs ran on the leased device: the mutated one went red with the block under the
`LOCATOR_NOT_FOUND`, the unmutated one is green with the keyboard case at 49.5 s, unchanged in
shape. One thing the brief asked for cannot be read from inside a test: a `uiautomator` dump is
refused while the driver holds the device's one accessibility connection, so that line reports its
own failed read. Follow-ups and Questions carry what that leaves open.

No shared helper, no library file and no `scripts/` file changed; the quarantined opt-out case is
untouched.

## Gates

<!-- `node scripts/gate.mjs table` -->

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2200 tests / 99 suites | `4c3ac7826979` | 57.5 s | start 8.8 / med 11.8 / max 14.3 |
| `harness:ios` | **PASS** (from `merge/FIX20-FIX21`) | 620 tests / 30 suites + isolated 6 tests / 3 suites | `a8bf12cd96b6` (harness:ios digest) | 16 m 30 s | start 9.1 / med 5.7 / max 12.1 |
| `harness:android` | **PASS** (from `merge/FIX20-FIX21`) | 678 tests / 31 suites + isolated 6 tests / 3 suites | `a8bf12cd96b6` (harness:android digest) | 18 m 12 s | start 9.1 / med 5.7 / max 12.1 |
| `real-input:ios` | **PASS** (from `merge/FIX20-FIX21`) | — | `a8bf12cd96b6` (real-input:ios digest) | 45 m 37 s | start 3.4 / med 6.9 / max 23.5 |
| `real-input:android` | missing | — | — | — | — |
| `real-input:android:--control:form` | **PASS** | 7 tests / 1 suites | `4c3ac7826979` (real-input:android digest) | 12 m 42 s | start 4.4 / med 24.7 / max 53.6 |

`need --for review`: satisfied on this code tree — `check` green, and the diff touches only files
the harness never reads, so no harness run is asked for. The full `real-input:android` is the
merge-time gate; the filtered run above is the one the brief names, and the red-proof run before
it is recorded under the same gate name with its own code tree.

## Red proofs

- `form.e2e.ts` "a field the keyboard would cover is moved clear of it" -> the guarded read asks
  for `editableField(screen, 'Note nobody wrote')` instead of the Note field, which hides the
  field from the locator at that read only and leaves the tap, the focus echo and the premise
  check real -> `LOCATOR_NOT_FOUND: locator matched no nodes within
  getByRole("textbox").or(getByRole("searchbox")).filter({ has: getByLabel("Note nobody wrote")
  })`, and under it `Did the keyboard close while the field stayed focused?` with the seven reads:
  `top at 1541 px` for the window manager's ime inset, `mInputShown=true` with
  `mInputEditorInfo:` from the IME service, `the app's focus echo: yes`, `the app's avoidance
  echo: yes`, the driver resolving the real field to 1 node and its snapshot holding `385 node(s),
  1 of them editable: android.widget.EditText focusable=true bounds=[105,1445][975,1520]`, and the
  raw dump line naming its own failed read. The other six Form cases passed in that same run.

The mutation is one line at `example/e2e/real-input/form.e2e.ts:174`; it is reverted before this
report is committed.

## Files changed

- `example/e2e/real-input/form.e2e.ts` — the guarded read, and the failure-path evidence behind
  it.

## Follow-ups

- example app: `nuiTestFormReport()` is polled on iOS only, so the Form's Android `ime=` and
  `scroll=` are nowhere a check can read; echo them the way `form-list-geometry` does.
- `scripts/real-input/ime-frame.d.mts`: `imeServiceShown`, `imeServiceTopPx` and `imeEditorInfo`
  have no declarations, so a typed caller prints the dump's lines instead of reading them.
- CI artifacts: run 44653752776 failed two cases in one job and its `after-failure` dump is the
  Context screen, so there is no accessibility dump of the Form screen at that failure — part of
  why these reads live inside the test.
- real-input: a `uiautomator` dump is unavailable while the driver holds the device's one
  accessibility connection, so a raw-node read inside a test can only report its own failure;
  the dump in the CI artifacts also writes no `visible-to-user` attribute.

## Questions for orchestrator

- The brief asks the failure to carry the Form's own `ime=`/`scroll=` on Android. Reading them
  needs `example/src/FormScreen.tsx` to poll `nuiTestFormReport()` on Android and echo it, which
  changes the Form screen — and with it both platforms' screenshots — so it is outside a
  tests-only round. Options: (a) keep the device-side inset and the tree box, as shipped;
  (b) a short follow-up task that adds an Android echo row and then puts `ime=`/`scroll=` into
  this evidence block. Recommendation: (b) as its own task, because the row needs screenshots.
- The raw accessibility node is the one thing the brief asked for that a test cannot read, for
  the reason above. Options: (a) accept the driver's snapshot as the node's witness, as shipped;
  (b) a harness-side dump taken after the run with the driver down, which is outside the test and
  cannot sit beside the failure message. Recommendation: (a), with the harness's existing
  after-failure artifacts as the second witness.

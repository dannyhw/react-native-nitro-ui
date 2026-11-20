# FIX24 — The Android ContextMenu bottom-edge case reads the popup it opened, once

**Branch:** `task/FIX24-context-menu-bottom-edge` (from `main` at `4ee96b56`) · **Round:** 1 of
up to 3 · **Lease:** `FIX24-dtjye` (`emulator-5570` / Metro `8293`)

## Summary

The case had two ways to fail, and in neither of them was the menu at fault.

**The read** (`example/e2e/real-input/context-menu.e2e.ts`): `popupBox` asked
`getByText("Bottom one")` for exactly one node in the first tree after the hold. A tree taken
during the window change carries the open menu's subtree twice, and a locator that expects one
node answers `LOCATOR_AMBIGUOUS` and stops — it does not wait. That is CI run 44653752776: the
read 51 ms after the hold matched two, and the settled read a few hundred ms later, the
screenshot, and the page's own echo all say one menu. The case now asks the window manager
whether a window came up (`popupWindowUp`), which is the question "did the menu open" asked of
the one thing that cannot be mid-transition, and then takes the popup's box from a read that
only a settled tree can satisfy — `toHaveCount(1)` on a menu row, where a doubled subtree counts
as two. Two popup windows is still red, and says two windows: that is a library fault, not a
slower read of one menu.

**The hold**: the point was the row's centre, 73 px above the screen's bottom edge, inside the
strip the system keeps for its gesture handle; the app never saw the touch (`bottom=0`, 224
reads over 30 s found no menu). The hold is now the lowest point inside the row that is above
the app's own bottom inset, read out of its window's `InsetsState` the same way the keyboard's
edge is read: the strip is 150 px in one navigation mode and something else in another, so a
hardcoded line would be a guess about the system image. The example's row is 96 dp rather than
56 so that such a point exists at all; its bottom edge is still the screen's bottom edge.

The premise is now asserted, not assumed: the menu's measured height has to exceed the space
below the finger, so the case fails if the hold ever stops being one that leaves the menu one
way to go. Nothing here sleeps a fixed time, retries, or widens a timeout.

The race itself did not recur here. It is in the CI artifact, and the fix removes the read that
could see one, not the timing that made it.
No library fault was seen, so no library code changed.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2200 tests / 99 suites | `ebfc0642b4d4` | 57.8 s | start 5.7 / med 10.3 / max 11.7 |
| `harness:ios` | **PASS** (from `merge/FIX20-FIX21`) | 620 tests / 30 suites + isolated 6 tests / 3 suites | `a8bf12cd96b6` (harness:ios digest) | 16 m 30 s | start 9.1 / med 5.7 / max 12.1 |
| `harness:android` | **PASS** (from `merge/FIX20-FIX21`) | 678 tests / 31 suites + isolated 6 tests / 3 suites | `a8bf12cd96b6` (harness:android digest) | 18 m 12 s | start 9.1 / med 5.7 / max 12.1 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `real-input:android:--control:context-menu` | **PASS** | 8 tests / 1 suites | `ebfc0642b4d4` (real-input:android digest) | 12 m 51 s | start 5.2 / med 6.0 / max 9.8 |
| `real-input:android:--control:context-menu:--a11y:context-menu` | stale | 1 failed of 8 tests / 1 suites | aef92e134c6c (not this tree) | 4 m 04 s | start 9.2 / med 6.2 / max 9.2 |

`need --for review`: `need: review is satisfied on this code tree.` — `check` green; the diff moves only `real-input:android`, so review asks for no harness run. The brief's Proof also asks for three green runs of the filtered gate: `real-input:android -- --control context-menu` was run three times on this code tree, and the table prints one row per gate.

## Red proofs

- The case -> `HybridNitroUiContextMenu.kt:347` `expanded = model.expanded` changed to
  `expanded = false`, so the menu never opens -> `example/e2e/real-input/context-menu.e2e.ts:123`
  went red: `ASSERTION_FAILED: expect.poll(...).toBeGreaterThan(...) timed out after 8000 ms`,
  message `the hold put no popup window up: the ContextMenu never opened, so no placement was
  ever asked for`.
- The case -> `MenuRows.kt`'s `NitroUiMenuPopup` given a position provider that always returns
  `IntOffset(anchorBounds.left, anchorBounds.bottom)`, so the popup opens below its anchor ->
  `example/e2e/real-input/context-menu.e2e.ts:496` went red: `ASSERTION_FAILED: the popup
  {"x":324,"y":1973,"width":316,"height":388} reaches below the finger at 2308: expected 2361 to
  be less than or equal to 2308`.
- The premise assertion has no mutation of its own, and cannot have one that reaches it on its
  own: it is false exactly when the menu fits below the finger, and a menu that fits below opens
  below, which the placement assertion one line above catches first. It is the message for the
  day the library stops going upwards, not a second gate.

## Files changed

- `example/e2e/real-input/context-menu.e2e.ts`: the bottom-edge case waits for its window,
  reads one settled popup, holds clear of the system's strip, and asserts its own premise.
- `example/src/ContextMenuScreen.tsx`: the bottom row is 96 dp with its label at its top, so a
  hold can land inside it above the system's strip.

## Follow-ups

- real-input:android: `support.ts`'s `tapBand` bottom is the content view's bottom, which on an
  edge-to-edge app is the screen's bottom — inside the system's gesture strip, where a tap may
  never reach the app.

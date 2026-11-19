# X59 — the e2e suite reads Android action flags off the released driver

**Branch:** `task/X59-driver-action-flags` (from `main` at `073ab8e2`) · **Round:** 1 of up to 3 ·
**Lease:** `X59-o0p5w` (`emulator-5570` + iPhone Air sim / Metro `9293` and `8293`)

## Summary

The installed driver is `agent-device` 0.21.40, through an `overrides` entry in the root
`package.json`; `bun.lock` carries the override and the registry's integrity hash.
`@e2e-dev/mobile` stays at 0.12.7.

The e2e suite now makes the five assertions the `uiautomator` pass made: the accessible
ContextMenu is long-clickable and focusable, `ctx-bottom` is neither, each of the four ButtonGroup
titles sits inside a clickable node within its group's box, and the enabled Picker's named node
is clickable. `android-tree-checks.mjs` drops them, with the ButtonGroup and Picker checks whole
and the helper only they used. The ContextMenu hold-then-drag stays, so `TREE_CHECK_IDS` is now
`context-menu` alone. `tree()` reads the driver as on `main`.

`scrollable`: the driver prints the four flags only with `--raw` (the unmerged tree). Its merged
snapshot strips them (`e.options.raw ? a.raw : po(a)` in its `mechanics.js`). So `asTreeNode`
takes the flag when present, and the class-name guess only when it is absent: in practice the
merged reads behind `screenReaderFacts`. A new unit test,
`scripts/__tests__/real-input-os-tree.test.js`, pins that, the three action flags and the
Spinner name mapping. `asTreeNode` is exported for it.

`task/X58-driver-snapshot-via-file` is merged in (no conflict): `tree()` and `driverReason` are
X58's, `asTreeNode` and the flags are this branch's. Its `scripts/__tests__/os-tree-read.test.js`
passes beside the new test.

The full `real-input:android`, run before that merge, was red with two causes:
- `segmented-control`: `tree()` got a cut-off answer ("1572861 bytes that are not a snapshot"),
  the pipe cut-off X58 fixes. 0.21.40's raw nodes carry four more fields, so a raw snapshot is
  larger and more likely to hit it.
- `bottom-sheet` two-detent drag: the header did not move (1391 to 1391), the flake
  `docs/tasks/FOLLOWUPS.md` already lists, with the same reading.

A `--rerun-failed`, started before the plan changed, re-ran both green on the pre-merge tree.
The merged tree's full run is the X58+X59 merge run, which completes this one.

The brief's lease command asked for Android only, but `need --for review` also lists
`harness:ios`, so the lease is for both platforms (one pair either way). No `real-input:ios` was
run. Device runs waited for FIX17's real-input:ios, as the orchestrator asked.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2200 tests / 99 suites | `dce4f26ddb92` | 1 m 10 s | start 8.2 / med 21.0 / max 23.1 |
| `harness:ios` | **PASS** | 615 tests / 30 suites + isolated 6 tests / 3 suites | `290fd6040f26` (harness:ios digest) | 14 m 36 s | start 3.7 / med 8.9 / max 31.9 |
| `harness:android` | **PASS** | 673 tests / 31 suites + isolated 6 tests / 3 suites | `dce4f26ddb92` (harness:android digest) | 18 m 31 s | start 6.0 / med 6.8 / max 45.3 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | stale (completed: 2 of 52 units re-run, attempt 1) | 7 tests / 2 suites | 290fd6040f26 (not this tree) | 12 m 09 s + full run 38 m 51 s | start 7.0 / med 11.8 / max 17.9 |
| `real-input:android:--control:context-menu:--control:button-group:--control:picker` | stale | 4 failed of 14 tests / 3 suites | 6a63e56b6457 (not this tree) | 15 m 35 s | start 4.9 / med 5.7 / max 12.3 |

`need --for review`: `need: review is satisfied on this code tree.` The `real-input:android` row
is the pre-merge full run (red: `segmented-control` on the cut-off read, `bottom-sheet` on the
known flake) and its green completion; the X58+X59 merge run is the full run on this tree. The
filtered row is the mutation run behind the first four red proofs, red as intended.

## Red proofs

- context-menu `an accessible menu is a stop TalkBack can double-tap and hold` -> `accessible` removed from the `ctx-accessible` ContextMenu in `example/src/ContextMenuScreen.tsx` -> `android.view.ViewGroup "Message from Grace" clickable=false long-clickable=false focusable=false … expected {"longClickable":"false","focusable":"false"} to equal {"longClickable":"true","focusable":"true"}` (both the long-clickable and the focusable assertion)
- context-menu `a menu that is not accessible offers TalkBack no long-click and no stop` -> `accessible` added to the `ctx-bottom` ContextMenu -> `android.view.ViewGroup "" clickable=false long-clickable=true focusable=true … expected {"longClickable":"true","focusable":"true"} to equal {"longClickable":"false","focusable":"false"}`
- button-group `one real tap per direction toggles one item once…` -> `.not.toBeNull()` flipped to `.toBeNull()` -> `"Copy" sits inside no clickable node of "Real-input disabled group": title on android.widget.TextView "Copy" … tightest clickable around it: android.view.View "" clickable=true … to be null`
- picker `a real tap picks one radio row…` -> `.toBe('true')` flipped to `.toBe('false')` -> `the name is parked on a node a tap is not aimed at: android.widget.Spinner "Real-input enabled picker" clickable=true … expected "true" to be "false"`
- `real-input-os-tree.test.js` "takes scrollable from the flag…" -> class guess applied whether or not the flag is printed -> `AssertionError: expected 'true' to be 'false'`
- `real-input-os-tree.test.js` "falls back to the class only when the driver leaves the flag off" -> fallback replaced by `'false'` -> `AssertionError: expected 'false' to be 'true'`
- `real-input-os-tree.test.js` "keeps the action flags as printed…" -> each flag read off another's field, one at a time (`longClickable` from `focusable`, `clickable` from `longClickable`, `focusable` from `clickable`) -> `AssertionError: expected { clickable: 'true', …(2) } to deeply equal { clickable: 'true', …(2) }` (and the same failure for the other two)
- `real-input-os-tree.test.js` "keeps a Spinner's own name apart…" -> the Spinner mapping undone (`textInLabel = false`) -> `AssertionError: expected { text: '', contentDesc: 'Mica' } to deeply equal { text: 'Mica', …(1) }`

## Files changed

- `package.json`, `bun.lock`: an `overrides` entry pins `agent-device` to 0.21.40
- `example/e2e/real-input/os-tree.ts`: the four flags off the driver's node, the Spinner name
  mapping, `pressableItem` / `actionFlags`, and the class-name `scrollable` guess only for a node
  with no flag; `asTreeNode` exported for its unit test
- `example/e2e/real-input/context-menu.e2e.ts`, `example/e2e/real-input/button-group.e2e.ts`,
  `example/e2e/real-input/picker.e2e.ts`: the five assertions
- `scripts/real-input/android-tree-checks.mjs`: the five assertions removed, with the ButtonGroup
  and Picker checks and the helper only they used; the hold-then-drag stays
- `example/e2e/README.md`: what the tree checks still do
- `scripts/__tests__/real-input-os-tree.test.js`: the mapping's flags, `scrollable` fallback and
  Spinner name

## Follow-ups

- bottom-sheet: the two-detent drag flake listed in FOLLOWUPS came back on this branch's full run (header top 1391 both times), green on `--rerun-failed`.
- check: red once, right after `bun install` rebuilt `nitrogen/` (`patch-nitrogen.test.js` ENOENT on `HybridNitroUiFormComponent.hpp`), green on the next run.
- android-tree-checks: `makeContext` now keeps more helpers that nothing calls (`requireControl`, `requireControlOnScreen`, `nodesNamed`, among others).
- lease: a brief that names a one-platform lease cannot run the other platform's harness gate `need --for review` lists.

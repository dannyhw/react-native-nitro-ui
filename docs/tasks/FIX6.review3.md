MERGE WITH FIXES

# FIX6 review of fix round 2: `task/FIX6-form-row-press` at `200afe66` (`c1e73383..HEAD`)

No M. The fixes are wording (N1-N3) plus the device proofs below, which nothing has run yet.
`check` was not run here: `lease.mjs list` showed `emulator-5570` `in use (harness:android)`
under FIX7's lease. The report's `check` PASS is the only run on this tree.

## M3: closed (by reading; no device has run it)

- **Android.** At `HybridNitroUiFormRow.kt:304` the first `NitroComposeHost` above the deepest
  view decides, and the row gives the tap up only when `!pressOwnedByRow`. The base is `false`
  (`NitroComposeHost.kt:61`). The one override, `ListItemHost` (`HybridNitroUiListItem.kt:270`),
  returns `model.insideRow`. That is a `mutableStateOf` the setter writes at once (`:755-761`)
  and `reset()` clears (`:237`, via `prepareForRecycle` -> `model.reset()`,
  `NitroComposeHost.kt:302`). A `ListItem` has no React Native slots, so no host sits under one.
- **iOS.** A hosted view answers `!pressOwnedByRow` and its subtree is not searched
  (`NitroUiFormViews.swift:325-327`). `NitroSwiftUIHost` forwards to `model.pressOwnedByRow`
  (`NitroSwiftUIHost.swift:467-468`): the base returns `false` (`NitroUiModel.swift:18`) and
  `ListItemModel` overrides it with `insideRow` (`HybridNitroUiListItem.swift:31`). The setter
  writes the model directly (`:815-821`) and `prepareForRecycle` resets it (`:905`).
- **Compiles: yes.** `NitroUiModel` is non-final with the computed `var` in its class body, so
  the `final` subclass's `override var` is legal; `Content.Model: NitroUiModel`
  (`NitroUIContent.swift:7`) makes `model.pressOwnedByRow` a vtable call to the override; the
  generic host's extension satisfies the requirement, so the protocol-extension default is
  shadowed (never used). Precedent: `NitroUiTextControl` (`NitroUiTextEditing.swift:99`), a
  `: UIView` protocol with property requirements, already compiles; the app is on
  `SWIFT_VERSION = 5.0`. The Kotlin `open val` override reading `protected val model` is fine.
- **Who answers true.** Only a `ListItem` with `insideRow` (any `ListItem` under a `Form.Row`);
  every other host inherits `false`. An item with `onPress` in a plain row: the row is pressable
  (`Form.tsx:514,569`), the item has no `clickable` (`:406`) or recognizer (`.swift:322`), so the
  row presses once. `Form.Row onPress` around an item without `onPress`: the row presses. A
  standalone item: no cell asks, so nothing changes. A disabled item in a plain row:
  `fromItem` is `null` (`Form.tsx:513`), nothing presses, as on `main`.

**Risk 2: Switch and the other controls are unchanged.** Every other hosted view inherits `false`, so `hostedControlAt` and `holdsHostedControl` answer
as in round 1. A disabled Switch is drawn with SwiftUI `.disabled` / Compose `enabled`, and its
host keeps alpha 1 and stays visible. It still takes the tap and the row stays quiet, as the new
`form.md` clause says.

## Risk 3: the checks that catch M3

- **`testRealInputListItem`**: `RealInputTests.swift:5402` runs `assertOnePressPerTap` ×5 on the
  `ListItem`'s own testID in a plain `Form.Row` (`ListItemScreen.tsx:146-155`). On the round-1
  tree the echo stays `0` and it fails with "it is behind". On this tree it should pass, with
  `assertRowShowsCellHighlight` (`:5408`) agreeing.
- **`list-item.e2e.ts:44`** (`pressPaintsFeedback` on the in-form item): on the round-1 tree
  `pending` is never set, so no ink is drawn and it fails. On this tree it should pass.
- **The mutation that shows the fix red.** `HybridNitroUiFormRow.kt:304` back to `return true`,
  as the report plans. The iOS twin is `NitroUiFormViews.swift:327` -> `return true`. Deleting
  the `ListItem` override reds both platforms at once.

**Docs, changeset, comments.** `form.md:79-87` and the changeset are true on both platforms and
say nothing internal. No new comment cites a task or history.

## Findings

**N1. The Kotlin comment names the wrong subject.** `HybridNitroUiListItem.kt:268` says "The
row's cell installs no `clickable` for an item inside it". The item installs none
(`ownsClick = pressable && !insideRow`, `:406`); the cell does press. Suggested: "Inside a row
the item installs no `clickable` and the row presses for it."

**N2. The iOS comment states a UIKit behaviour nobody has verified.**
`NitroUiFormViews.swift:303` says "UIKit asks this of the cell for the recognizers it owns as a
cell". The cell is the delegate of `pressGesture` only (`:263`), and nothing has shown UIKit
asking otherwise. The guard is harmless; say only what is known, or drop the sentence.

**N3. One `form.md` line runs past the wrap.** Line 87 is about 100 characters where the
paragraph wraps at about 88. Reflow.

**N4. Two cases have no device test.** Nothing tests `Form.Row onPress` around a `ListItem`
without `onPress`, and Android checks the in-form item's ink but not its press count (the ink
does imply the press: `pending` drives both). Follow-up.

**N5. `pointerEvents="none"` subtrees** (CodeRabbit on `HybridNitroUiFormRow.kt:326` and
`NitroUiFormViews.swift:330`; valid when checked against the code; this is round-1 code).
`deepestChildAt` ignores `pointerEvents`, so an overlay above a control makes the row press as
well. `holdsHostedControl` ignores `isUserInteractionEnabled`, so a `none` wrapper around a
Switch leaves a dead spot. Rare; follow-up. CodeRabbit's other comments at `200afe66` are on code
that round 2 did not change.

The rereview's N1, N5, N6 and N7 are addressed. For N7, the second loop (`RealInputTests.swift:6085`)
does park the field at the list's end.

**Scope and hygiene.** The 11 files the round touches are all in scope. Nothing changed under `scripts/`, `.claude/`,
`AGENTS.md`, `docs/agents/` or the shared e2e helpers. All 34 commits have one author address.
No AI or agent mention, home path, email, hostname or device name appears.

## What the device proofs at merge must show

1. `harness:ios` and `harness:android` green on this tree. This is also the first build of the
   new Swift since `main` was merged.
2. `real-input:android -- --control list-item` red with `HybridNitroUiFormRow.kt:304` ->
   `return true` (on "a held press on an item inside a Form row draws the Form ink"), then green.
3. `real-input:ios -- --control list-item` green, with `real-input-listitem-in-form` at 5/5.
4. `-- --control form` green on both platforms (Switch, beside-switch, RN content, ContextMenu
   wrapper, opt-out), as round 1 left them.
5. The full `real-input` run that `need --for merge` lists.

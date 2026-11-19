# X59 review, round 1

**Verdict: approve.** No blocking findings. Three non-blocking ones below.

Reviewed: `git diff origin/main...HEAD`, limited to X59's own changes (`package.json`, `bun.lock`,
`os-tree.ts` `asTreeNode` / `pressableItem` / `actionFlags`, the three `.e2e.ts` files,
`android-tree-checks.mjs`, `example/e2e/README.md`, `scripts/__tests__/real-input-os-tree.test.js`)
and how they sit on X58's `tree()` / `driverReason`. Run here: `node scripts/gate.mjs check` PASS
(18 passed, 64 s); `node scripts/gate.mjs need --for review` reports review satisfied on
`dce4f26ddb92`; `bun install --frozen-lockfile --dry-run` is clean.

## What holds

- **Behaviour 1.** The root `package.json` `overrides` pins `agent-device` to `0.21.40`.
  `bun.lock` carries the same override and a single `agent-device@0.21.40` entry. Its integrity
  (`sha512-7UlxZ2L6…QePg==`) matches `npm view agent-device@0.21.40 dist.integrity`. The
  installed copy is 0.21.40, with no nested copy under `@e2e-dev/mobile` (which pins 0.21.37
  exactly). No other dependency changed.
- **Behaviour 2.** `context-menu.e2e.ts:360-387`, `button-group.e2e.ts:88-92` and
  `picker.e2e.ts:204-210` make the five assertions. All of them read through `tree({ unmerged:
  true })`, which is the only tree where the driver prints the flags. I confirmed this in the
  installed driver: `po()` in `dist/src/mechanics.js` strips `clickable`, `focusable`,
  `longClickable` and `scrollable` from merged nodes. A flag the driver leaves out maps to `''`,
  so a missing flag or a missing node cannot satisfy `'true'`/`'false'`/`not.toBeNull()`. None of
  the five expected values is a default that would come out right when the read is broken. The
  ButtonGroup loop covers the same four (group, title) pairs as the removed check. It is also
  stricter, because the clickable node must lie inside the group's box.
- **Behaviour 3.** `buttonGroupChecks`, `pickerChecks` and ContextMenu block 2 are gone, along
  with `contextReveal` and the `tightestFlaggedNode` import, which only that code used. The
  hold-then-drag check stays whole at `android-tree-checks.mjs:772-796`, and `TREE_CHECK_IDS` is
  `['context-menu']`. `android.mjs:513-520` still reports a missing tree check for that id.
  Nothing the dump pass guarded is lost: each removed check has an e2e assertion that reads the
  same node (`contentDesc` / `resource-id`) for the same flags.
- **Behaviour 4.** `os-tree.ts:218-221` uses `SCROLLER_CLASS` only when `node.scrollable ===
  undefined`, and nothing else in `example/e2e/real-input` guesses from the class. Raw nodes
  always carry a boolean `scrollable` (`scrollable:e.scrollable===!0` in the driver), so the
  guess applies only to merged reads. `real-input-os-tree.test.js` pins both directions.
- **Behaviour 5.** `textInLabel` (`os-tree.ts:195-203`) puts a Spinner's `label` in `text` and
  its description in `contentDesc`. It is unit-tested, along with the plain label-only case.
- **X58 interaction.** `asTreeNode` runs on X58's file-read `answer`, and `driverReason` is
  untouched. The four extra raw fields make snapshots larger, and the file read is what handles
  that. `os-tree-read.test.js` passes beside the new test.
- **Unit-test red proofs** are plausible for the code. Applying the class guess regardless of
  the flag fails test 1 (`'true'` vs `'false'`). Replacing the fallback with `'false'` fails
  test 2. For the cross-wired flags, the second fixture (`clickable: true, longClickable:
  false`) breaks the coincidence for `longClickable`←`focusable`, and the first breaks it for the
  other two. `textInLabel = false` gives `{ text: '', contentDesc: 'Mica' }`. The two ContextMenu
  e2e proofs are behaviour mutations (`accessible` removed and added). The 4-failure filtered run
  in the ledger matches the four e2e mutations.
- **Comments.** None of the new comments contains a task ID, history or document reference.

## Findings

1. **Non-blocking: two e2e red proofs flip the assertion instead of breaking what it guards, and
   `pressableItem`'s group-box rejection is never shown red.**
   `example/e2e/real-input/os-tree.ts:443-445`, `button-group.e2e.ts:88-92`,
   `picker.e2e.ts:204-210`. The ButtonGroup proof (`.not.toBeNull()` → `.toBeNull()`) and the
   Picker proof (`.toBe('true')` → `.toBe('false')`) show that the value is read and is right
   today. They do not show that a broken item or picker turns the test red. In particular,
   `insideBox(found.group, clickable)` is new logic that no run exercises.
   Failure scenario: delete that condition and every gate stays green. Then a regression that
   strips the item's own clickable node, while a clickable ancestor wider than the group (a
   pressable row or card around it) still holds the title, passes the ButtonGroup assertion.
   The brief told the implementer to repeat S7's mutations, which were these same flips, so this
   is not a fix-round item.
   Follow-up: write a unit test through `tree()`'s stand-in `driver` parameter, with fixtures
   for three cases:
   - the title in no clickable node gives `node === null`;
   - the tightest clickable node lying outside the group gives `null`;
   - `actionFlags` on a node with no flags gives `''`.

2. **Non-blocking: no full `real-input:android` run on this tree.** Brief Proof, line 3. The only
   full run is pre-merge, on `290fd6040f26`: red on the cut-off pipe read and the known
   bottom-sheet flake, then completed green with `--rerun-failed`. That tree had the new mapping,
   so the change from the class-guessed `scrollable` to the driver's flag reached every control's
   `ownerNode` on the unmerged tree. That change matters wherever a scroller class reports
   `isScrollable=false` (content that fits), or a non-scroller class reports true. The merged
   X58+X59 tree has not had a full run. The report says so plainly and points to the merge run,
   which is the right place for it.

3. **Non-blocking (follow-up, not X59's): old comments around the change.** These lines were
   already on `main`:
   - `android-tree-checks.mjs:759-762`: the section header says "the one this gate made before
     the e2e suite existed", which tells history.
   - `android-tree-checks.mjs:800`: an orphan doc comment, "What a screen reader is offered
     around a `<Host>`…", sits above the `TREE_CHECKS` doc comment and describes nothing.

   With the ButtonGroup and Picker checks gone, more of `makeContext` is unused. The report's
   follow-ups already list that.

**Verdict: approve. Blocking findings: 0.**

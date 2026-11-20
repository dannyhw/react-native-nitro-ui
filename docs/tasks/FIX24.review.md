MERGE WITH FIXES — drop the `revealInScroll(screen, 'ctx-bottom')` line from df826453 (M1), then run `check` and the filtered context-menu gate on the final tree.

# FIX24 review (task/FIX24-context-menu-bottom-edge at df826453)

M1. `example/e2e/real-input/context-menu.e2e.ts:407`: the line df826453 adds breaks "a menu that
is not accessible offers TalkBack no long-click and no stop". `ctx-bottom` is not inside
`ctx-scroll`. It is the ScrollView's sibling, after `</ScrollView>`
(`example/src/ContextMenuScreen.tsx:253-261`), and the ScrollView's default `flexGrow: 1` fills the
space above it. `revealInScroll` (`:172-195`) returns only when
`node.y + node.height <= view.y + view.height - 8`. A row that starts at the ScrollView's bottom
edge never passes that check, so the helper makes 8 drags and throws "never came wholly inside
ctx-scroll". Nothing has run on this tree (6b598c3e52b6): the three green 8-test runs are on
ebfc0642b4d4, which does not have the line. The row is always on screen, so `actionFlags` needs
no reveal. If a merge run showed a reason for one, record it and wait on a real signal instead.

N1. Waits (Q1): every new wait rests on a real signal, and nothing is loosened.
`popupWindowUp` (`:114-130`) polls the window count (`> 0`), then requires exactly 1. Its 8 s is
the file's existing window constant and replaces a 30 s `waitFor`, so it is shorter, not raised.
`toHaveCount(1)` (`:492`) polls with the default 10 s and counts a doubled subtree as 2. The case
still checks placement above the finger, one open (exact `bottom` count), one close
(`popupsReach(0)`) and two-windows-is-red. No sleep, no retry. The two-window check is one
sample; a late second window still fails the case through `popupsReach(0)` or the exact count.

N2. Hold point (Q2): the minimum top over visible `navigationBars` and `mandatorySystemGestures`
is the taller strip in either mode. With three buttons (48 dp bar) the hold is about 60 dp up;
with gestures it is the gesture strip plus 12 dp. Both land inside the 96 dp row, and the 388 px
menu still cannot fit below, so the claim holds. Unproven: the green runs used one emulator and
one mode (finger at 2308, a strip of about 60 px), not the CI image where the 73 px hold was
lost. That the CI strip shows up as a visible `mandatorySystemGestures` source is inferred. If it
does not, the case fails loudly through `lowestHoldInRow` or the window wait. It does not pass
falsely.

N3. Premise (`:498-504`): it can fail and is not redundant. The report assumes the library
measures the space below to the content view's bottom, but the popup is placed inside its own
window's bounds. A shorter menu, or a provider that prefers above, passes placement and fails
this check, which is what a validity guard is for. Change the report's "cannot have a mutation"
line.

N4. Example row (Q3): nothing else reads `ctx-bottom`, its label or its position. Checked:
`RealInputTests.swift` (uses `ctx-target`/`ctx-inner`/`ctx-disabled-target` and relative drags),
the a11y sweep (anchor `ctx-accessible`), harness ContextMenu tests (they do not render this
screen), the conformance fixtures, and `docs/components/context-menu.md:165` (still true). The
viewport is 40 dp shorter. On Android, three green runs of the whole file and the a11y auxiliary
(04:15 run) include the new row. Nothing ran on iOS, and no iOS test depends on viewport height.

N5. Red proofs (Q4) match. `expanded = false` (`HybridNitroUiContextMenu.kt:347`): the 03:51 run
is red at `:123`, "the hold put no popup window up". A below-anchor provider in `MenuRows.kt`
`NitroUiMenuPopup`: the 04:15 run is red at placement, `{"y":1973,"height":388}` against finger
2308.

N6. Comments (Q5): "it has carried the open menu's subtree twice" (`:111`) narrates history.
"the way the keyboard's edge is read" (`:426`) leans on other code. Both are minor.

N7. Scope and identity are clean: only the example screen, this e2e file and the FIX24 docs.
Nothing under `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/`, shared helpers or library
code. One author address, nothing personal. Follow-up: the inset regex is inline in a test file,
while the keyboard read goes through a shared parser.

CodeRabbit on PR #121: rate-limited, no review. `check`: not run (lease FIX22 `in use (real-input:ios)`).

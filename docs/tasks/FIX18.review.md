MERGE (no M findings; `harness:android` is owed and must be run at merge, the harness file is shared)

# FIX18 review — branch `task/FIX18-button-group-disabled-refit` at `5bc69147`

`check` run once here: PASS, 18 of 18, 61.7 s (no real-input:ios lease or run at the time).
`need --for review` still lacks `harness:android`. PR #109 has no inline review comments.

## Answers

1. Same candidate. `overflowControl` (Swift:544-553) draws `Button(action: {}) { overflowLabel() }`
   or `Menu { … } label: { overflowLabel() }`. Neither gets `controlSize`, `buttonStyle`,
   `labelStyle`, `tint` or a variant: those go on each item (Swift:478-501), and the control sits
   beside the `ControlGroup` in the `HStack`, never inside it (Swift:402-409). Both inherit one
   environment, so both draw the same `Label` through the automatic (borderless) button style at
   every `size`, `labelStyle`, `variant` and Dynamic Type size, connected or not. The screenshot
   agrees: in the 220 pt well both rows show Day, Week, "… More", ending in the same column.
   Measured evidence covers one configuration only (see N1).
2. The placeholder's action is empty and it is `.disabled(true)`, and `model.press`/`toggle` still
   guard on `disabled` (Swift:148, 160), so nothing fires. VoiceOver gets a dimmed button named by
   the same `Label`. On `disabled` the `if/else` takes the `Menu` out of the tree, the same thing
   that closed an open popup before. Re-enabling builds a new `Menu`, with no state kept. Dropping
   `model.disabled ||` from the menu rows (Swift:573, 578) is safe: the `Menu` exists only while
   enabled, and the press path refuses anyway.
3. Every earlier `overflow=` read (harness:341, 388, 421, 652, 902, 953, 999) is of an enabled
   row, so it means what it meant. `bg-close` (harness:666-684) and `bg-recycle` (harness:1002)
   read `menu`, which still reads `none` when disabled and when no control is drawn. Outside the
   harness nothing parses this report: `RealInputTests.swift` reads echoes and XCUI elements,
   `Conformance.harness.tsx` reads only sizing and presses for ButtonGroup, and `scripts/` has no
   reader. Android's `menu=` (open/closed) is unchanged.
4. Red proof is valid: old code gives `visible=3 … overflow=0` against `visible=2 … overflow=1`,
   and the fixture (2 fit) does not match the bug's answer (3). The wait in `rowWhenDisabled`
   polls `menu`, which only `placeSubviews` writes, so it waits for a placement after the prop
   change, and then `probeRow` publishes it. No existing assertion is loosened. The 2 pt ink
   tolerance belongs to a new assertion and comes with its reason. Perf: the `disabled` setter
   stores the value and calls `markDirty` (Swift:861-866). No hosting view is rebuilt and no new
   props.
5. The changeset is true. The doc bullet's behaviour is true (see N4 on its rationale). Comments
   follow AGENTS.md. Nothing touches `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/` or the
   e2e helpers. One author address. Nothing personal (the report's `iPhone Air` is a simulator
   model).

## Findings

N1. `example/__tests__/ButtonGroup.harness.tsx:686-846`: equal widths are measured only for
    `filled`/`medium`/`automatic`/standard at the default Dynamic Type size, with a 2 pt ink
    tolerance, at a width (220 pt) that is not near a candidate boundary. A placeholder up to
    ~2 pt narrower would pass and could still refit a row at a boundary width. The code makes the
    widths equal by construction. A sharper test would set the well to the enabled row's own
    minimum width for k items, so that any narrower placeholder fits k+1.
N2. `docs/tasks/FIX18.report.md:36`: "A real tap on a disabled control, and what VoiceOver calls
    it, belong to `real-input:ios`, at merge" is not true of the suite.
    `testRealInputButtonGroup` ends right after the disable (`RealInputTests.swift:2702-2736`) and
    never taps the disabled overflow placeholder or reads its element. The `button-group`
    `A11yCase` targets the actions row (`RealInputTests.swift:364`). Brief behaviour 2 (no tap,
    reported disabled) has no automated proof for the placeholder. Correct the sentence, or file a
    follow-up for a real-input tap and element read on it.
N3. `ios/components/ButtonGroup/HybridNitroUiButtonGroup.swift:397`: `overflowPresents` is
    computed from `model.disabled` read when `placeSubviews` runs, not from what this body drew.
    So `menu=none` is a function of the prop: `harness:782` and `harness:845` cannot fail for any
    drawing, including a regression back to `Menu.disabled(true)`. Capturing
    `let presents = !model.disabled` in `candidate` at body time would make the field describe the
    drawn tree. The older `!model.disabled` witness had the same property.
N4. `docs/components/button-group.md:199-201`: the iOS sentence explains an implementation choice
    ("a `Menu` would keep an open popup while its group is disabled") that no test or upstream
    citation backs, and an app developer does not need it. The behaviour clause before it is
    enough.
N5. `harness:android` is owed (the shared harness file changed; the new case returns early on
    Android). The report's option (a), letting the merge run settle it, is sound. It must be green
    before merge.

# X66 — the real-input suite finds a field by its name whether the driver nests the name or not

**Kind:** tooling · **Devices:** android · **Budget:** 2.5 h for round one (X64, a real-input
tooling task with one filtered device run)

## Goal

On a slow Android machine, the Form keyboard case reads the field it focused for the whole
time the keyboard is up, instead of losing it while the form moves the field clear.

## Why

On GitHub-hosted runs, `form.e2e.ts` "a field the keyboard would cover is moved clear of it"
failed four times in about 24 runs with `LOCATOR_NOT_FOUND` on `editableField(screen, 'Note')`
(`example/e2e/real-input/support.ts`). It never fails on this machine. In each failure the
same locator had just tapped the field successfully, and then failed in `keyboard.ts`'s
`boundingBox()` loop while the field moved.

`editableField` is `getByRole('textbox').or(getByRole('searchbox')).filter({ has: getByLabel(label) })`.
It needs the node named "Note" to be a descendant of the editable node. A `uiautomator dump` of
the library on this machine shows that nesting in every state: `EditText` [105,1445][975,1520],
with a child `View desc="Note"` [105,1445][975,1508]. On CI, the driver's screen at failure
reports them as siblings, `#n… textbox [focused]` followed by `#n… group "Note"` at the same
depth. Its own snapshot has the "Note" `View` at [105,346][975,409] inside the `EditText` at
[105,346][975,421]. The library's tree is correct (a screen reader reads the child's
description with its focusable parent), so the locator relies on a nesting the driver does not
always report.

Evidence: run 45470393466, job "Real input (Android) 2", artifact `real-input-android-2`.
`example/e2e/.e2e/android/results/form-a-field-the-keyboard-would-cover-*/trace.md` and
`attempt-1/` hold the steps, the screen at failure, and the screenshot. Read with
`gh run download` (reading is allowed; no GitHub writes).

## Behaviour

1. `editableField(screen, label)` resolves to the one editable node the field named `label`
   types into, whether the driver reports the named node inside it or beside it with its box
   inside the editable node's box.
2. It still resolves to nothing when no editable node holds a node with that name, and to an
   error (not a guess) when two editable nodes could each be the one.
3. Every caller of `editableField` keeps working, Form and the other screens that use it.
4. No assertion, timeout or retry setting changes.

## Proof

- `node scripts/gate.mjs check` passes, and `node scripts/gate.mjs need --for review` prints
  nothing missing.
- A unit test over stand-in trees, nested and sibling shapes, with fixtures taken from the CI
  trace above rather than written to fit. Show it red with today's `editableField`.
- `node scripts/gate.mjs real-input:android -- --control form --control text-field --control search-field`
  passes on this machine. Use `git grep editableField` to add any other control that calls it.

## Out of scope

- The library (`src/`, `android/`, `ios/`). The node shape is correct.
- `agent-device` and `@e2e-dev/mobile`: read them, change neither.
- The Form keyboard case's own assertions and evidence lines.

## Decided already

- Fix it in the suite's helpers (`example/e2e/real-input/support.ts`, or a pure helper beside it
  that the unit test imports). Geometry (the name's box inside the field's box) is the fallback
  when nesting is missing.
- If the locator API cannot express this, resolving the label node and then the editable node
  whose box contains it is acceptable, as long as the result is a `Locator` that re-resolves on
  every read, not a box frozen at one moment.

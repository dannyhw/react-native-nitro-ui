# G27 — SearchField v2: keyboard props

**Worktree / branch:** named in your delegation message (`task/G27-search-field-keyboard`). **Round cap:** 1 round,
plus at most 2 fix rounds (D19). **Devices:** your lease (`node scripts/lease.mjs acquire --task G27 --boot`). Export
the lease's environment before any device gate.

## Read first

- AGENTS.md: the perf contract, red proofs, **never `pkill`/`killall`**, the README rule (D4).
- `docs/DECISIONS.md` D38 item 2 (why v1 had no keyboard props) and D40.
- `docs/tasks/Q8-expressive-and-holdbacks.report.md` row 14 and Appendix E pass 3 B, and FOLLOWUPS' G17 review line
  ("move Android SearchField to material3 1.5's stateful `InputField` in a plain `Surface`, not `SearchBar`, which
  wraps the field in `DisableSoftKeyboard`").
- SearchField and TextField as they are on `main` (`docs/components/search-field.md`, `text-field.md`, both
  components' native files). TextField already maps every keyboard prop below on both platforms; reuse its mapping
  rather than writing a second one.

## Do

1. **Props:** `keyboardType`, `autoCapitalize` and `autoCorrect` on SearchField, with TextField's types, values and
   platform mapping. The defaults stay what v1 fixes today (`default`, `none`, and v1's autocorrect behaviour), so an
   app that passes nothing sees no change. Every native prop always passed. The Return key stays Search.
2. **Android:** material3 1.5's stateful `SearchBarDefaults.InputField(textFieldState, …, keyboardOptions, …)` as
   the G17 review line says, so `keyboardOptions` reaches the field. Keep v1's box, focus, clear, submit, `Back` and
   recycling behaviour; any visible change to the field goes in the report with a screenshot.
3. **iOS:** the field's `keyboardType`, `autocapitalizationType`, `autocorrectionType` and `spellCheckingType`, as
   TextField sets them.
4. **Changing a prop while focused** applies it to the open keyboard on both platforms (TextField's rule), or the docs
   say what happens instead.
5. **Docs:** `search-field.md` (the props table, the Limits line about keyboard props removed or narrowed), the README
   usage block if it changes, and a minor changeset. No screenshot retake unless the field visibly changes.

## Tests, each shown red first

- Harness, both platforms: each prop reaches the native field (read back from the field or the IME's `EditorInfo` /
  the text input traits), the defaults equal v1's, recycling resets them.
- Real input, both platforms: with `keyboardType="number-pad"` focused, the number keyboard is what opens (as TextField
  proves it), and the Search key still submits.

## Not in scope

`secureTextEntry`, `returnKeyType`, `multiline` (SearchField stays a one-line search field) and anything else, which
goes as one FOLLOWUPS line.

## Gates

`check`, both `harness:*` and both `real-input:*`, then `need --for review`. Report at
`docs/tasks/G27-search-field-keyboard.report.md`. Export the ledger with `gate.mjs export --task G27`, keeping any
earlier lines.

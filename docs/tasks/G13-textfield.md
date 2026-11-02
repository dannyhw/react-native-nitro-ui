# G13 — TextField

**Worktree / branch:** named in your delegation message, from `main`. **Round cap:** 1 round, plus at most 2 fix
rounds (D19). **Devices:** your lease (`lease.mjs acquire --task G13 --boot`). S2 holds the other pair on this host.

## Read first

- AGENTS.md (the perf contract, red proofs, the controlled-value handshake);
- `docs/DECISIONS.md` D30, D31 and D34;
- `docs/tasks/Q2-textfield-research.md`, the design research: API, handshake, composition, sizing, P1–P5;
- `docs/tasks/T19-textfield-measurements.report.md` and its prototype branch `origin/task/T19-textfield-measurements`.
  The prototype is evidence: reuse what it proved, but don't merge it;
- the most recent components (`docs/components/dialog.md`, Chip in progress) for the current registry, conformance
  and docs conventions.

## Do

1. **Settle the API first,** from Q2.
   - Write it at the top of your report: single-line and multiline, `value`/`onChangeText` through the
     controlled-value handshake for strings, `placeholder`, `keyboardType`, `autoCapitalize`, `autoCorrect`,
     `secureTextEntry`, `maxLength`, `returnKeyType`/`onSubmitEditing`, `editable`, focus and blur events, and
     imperative `focus()`/`blur()` through the hybrid ref.
   - Keep v1 lean; Q2 lists what can wait.
   - If a choice would affect other components' conventions, stop and ask.
2. **Build it:**
   - iOS hosts `UITextField`, plus `UITextView` for multiline if Q2 calls for it (D34). The JS-write guard drops a
     write that arrives mid-composition (marked text).
   - Android uses `BasicTextField(TextFieldState)` behind `ControlledValue<String>`.
   - Sizing: single-line intrinsic, and multiline auto-grow with the width in the sizing key (Q2 P4).
   - Registry and component.json entries, the conformance rules, an example screen and Storybook stories, docs
     (`docs/components/text-field.md`), a README section with screenshots, and a minor changeset.
3. **Tests, red first:**
   - harness on both platforms: typing round-trip, a reject reverting, `maxLength` with an emoji, a JS write
     mid-composition dropped on iOS, secure entry, focus and blur, sizing and auto-grow, and recycle-reset;
   - real-input typing and focus on both platforms;
   - the X4 conformance rules. Rule 1's 22.3 pt name inside a 21 pt wrapper was found on both arms in T19: fix it
     or explain it.
4. **Perf:** bench arms for mount and keystroke-to-commit, against RN `TextInput`, on Android. On iOS, measure
   keystroke latency if any route works; otherwise record why not, per D34.

## Gates

`check`, both `harness:*` and both `real-input:*`, then `need --for review`. Report at
`docs/tasks/G13-textfield.report.md`, with the ledger exported.

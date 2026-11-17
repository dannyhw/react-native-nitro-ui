# X52 — lint, format, type checks and the e2e suite on faster tools, with the time measured

**Branch:** `task/X52-faster-js-tooling` (from `main` at `589733b6`) · **Round:** 1 of up to 3 ·
**Lease:** `X52-vpa91` (`emulator-5574` / Metro `9295`)

## Summary

- **Lint → oxlint 1.94.0.** `.oxlintrc.json` turns on the rules `@react-native/eslint-config`
  turned on, at the same severities, options and file scopes; every other oxlint category is off.
  It reports what ESLint reported, rule for rule (no-shadow 11, no-unused-vars 5, no-bitwise 5,
  no-void 3, no-useless-escape 3, no-regex-spaces 1, dot-notation 1, no-deep-imports 2), plus 13
  `no-path-concat` warnings ESLint's version did not raise. Warnings still do not fail `lint`.
- **JS plugins:** the four `nitro-ui/*` rules load from `eslint-rules/index.js` unchanged, on
  the same globs. `@react-native/no-deep-imports` and
  `eslint-comments/no-aggregating-enable`/`no-unused-enable` load unchanged from their packages.
  `dot-notation` (no type information), `consistent-this` and `no-undef-init` are small rules in
  `eslint-rules/core.js`. ESLint and `@typescript-eslint/parser` stay only for the rules'
  `RuleTester` test: oxlint's is ESM-only and the Jest config was out of scope.
- **Format → oxfmt 0.79.0** with Prettier's options, reading `.prettierignore` and `.gitignore`.
  It rewrote **10 files** (`style: apply oxfmt`), all one divergence: a long union type alias
  breaks onto leading-`|` lines. Changesets formats with oxfmt.
- **Type checks → `bun check`.** Byte-identical errors to `tsc` on the clean tree and on injected
  errors in `src/`, `example/src`, `example/e2e`, `scripts/smoke` and `bench/`, including a
  `moduleSuffixes` error only the Android bench pass sees. It exits 1 where `tsc` exits 2, and
  checks with bun's bundled TypeScript (7), not the installed 6, so a bun upgrade can move it.
- **bun pinned to 1.4.4**; `doctor` fails an older bun.
- **`TOOLING_FILES`** names `.oxlintrc.json` and `.oxfmtrc.jsonc` in place of `eslint.config.mjs`.
- **e2e on bun:** `scripts/real-input/android.mjs` starts the e2e CLI with `bun` (`bun <cli file>` runs it on bun whatever its shebang). The filtered run passed on both runtimes, 10 of 10 tests and 25 of 25 auxiliary checks each; e2e's own report records `node v24.21.0` and `bun v1.4.4`. The e2e phase took 212.6 s on Node and 185.3 s on bun, but load differed (see the table), so most of that gap is device and load time, not the runtime.

**Removed:** `prettier`, `@eslint/compat`, `@eslint/eslintrc`, `@eslint/js`,
`@react-native/eslint-config`, `eslint-config-prettier`, `eslint-plugin-ft-flow`,
`eslint.config.mjs`. `react-native/no-inline-styles` is dropped on purpose (8 warnings gone).
Left out, no oxlint equivalent: `no-catch-shadow`, `no-octal` and `no-octal-escape` (the parser
rejects both in module code), `no-restricted-modules` (on with no modules: a no-op),
`react/jsx-uses-react` and `react/jsx-uses-vars` (oxlint's `no-unused-vars` counts JSX use),
`ft-flow/define-flow-type` and `ft-flow/use-flow-type` (no Flow here). Mapped by another name:
`no-negated-in-lhs`, `no-new-object`, `handle-callback-err`, `no-mixed-requires`,
`no-new-require`, `no-path-concat`, `eslint-comments/no-unlimited-disable`,
`eslint-comments/no-unused-disable`.

### Time

Median of three; load average (1 min) at each run's start. Before at `589733b6`.

| Command                                       | Before | Load       | After  | Load        |
| --------------------------------------------- | ------ | ---------- | ------ | ----------- |
| `lint`, native rules only                     | 6.54 s | 4.5–4.7    | 0.25 s | 11.5–12.9   |
| `lint`, final (with the JS-plugin rules)      | 6.54 s | 4.5–4.7    | 0.52 s | 11.5–12.9   |
| `format`                                      | 5.50 s | 5.7–9.5    | 0.09 s | 3.4         |
| `typecheck`                                   | 3.18 s | 7.6–7.8    | 0.11 s | 3.4         |
| `bench:typecheck`                             | 2.04 s | 7.3        | 0.14 s | 3.2         |
| pre-commit, one staged `.tsx`, native only    | 3.21 s | 5.7–5.9    | 0.22 s | 3.2         |
| pre-commit, one staged `.tsx`, final          | 3.21 s | 5.7–5.9    | 0.26 s | 8.5         |
| `check`, every step                           | 88.7 s | 5.7–14.9   | 90.6 s | 10.5–21.9   |
| e2e CLI `--version` (Node → bun)              | 0.15 s | 10.3       | 0.07 s | 10.9        |
| e2e CLI `list`, loads `e2e.config.ts`         | 0.47 s | 10.2       | 0.33 s | 10.2        |
| e2e phase, filtered run (Node → bun)          | 212.6 s | 48.6 → 13  | 185.3 s | 9.0 → 34.0 |
| whole filtered `real-input:android` gate      | 892.7 s | 48.6 → 13  | 845.3 s | 9.0 → 34.0 |

The two `lint` rows were measured side by side, twice. `check` is Jest-bound: the 15 s it loses
in lint, format and type checks is inside Jest's ~70 s, and the after run's load was higher (on a
quieter machine, at load 3–14 but with one red test, it took 72.1 s). Measured only: `bob build`
2.40 s (load 7); root Jest 73.0 s with a cold transform cache, 71.1 s warm (load 7–12).

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2127 tests / 93 suites | `8da36a855286` | 1 m 29 s | start 3.9 / med 11.8 / max 20.8 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `real-input:android:--control:switch:--control:context-menu:--control:text-field` | **PASS** | — | `8da36a855286` (real-input:android digest) | 14 m 05 s | start 9.0 / med 9.9 / max 34.0 |

`need --for review`: `need: 2 gate(s) missing for review: harness:ios, harness:android` (see Questions). The filtered `real-input:android` row is the bun run; the Node run (same filter, before the runner commit) passed in 892.7 s.

## Red proofs

- `bun run lint` -> `export const x = 1; x = 2;` in `src/` -> `error eslint(no-const-assign): Unexpected re-assignment of const variable x`, exit 1
- `nitro-ui/no-inline-callback-in-jsx` -> `<Switch onValueChange={callback(() => {})} />` in `src/` -> `error nitro-ui(no-inline-callback-in-jsx)`; the same file under `scripts/` is not flagged
- `nitro-ui/no-anymap-in-spec` -> `config: AnyMap` in a `src/*.nitro.ts` -> `error nitro-ui(no-anymap-in-spec)`
- `nitro-ui/no-json-string-prop` -> `configJson: string` in a `src/*.nitro.ts` -> `error nitro-ui(no-json-string-prop)`
- `nitro-ui/no-optional-view-props` -> `label?: string` in a `HybridViewProps` interface -> `error nitro-ui(no-optional-view-props)`
- `@react-native/no-deep-imports` -> oxlint over the tree -> `src/__tests__/iconSource.test.ts:16:11: warning @react-native(no-deep-imports)` (and :26), the two ESLint reported
- `eslint-comments/no-aggregating-enable` -> two `eslint-disable` comments closed by one `/* eslint-enable */` -> `warning eslint-comments(no-aggregating-enable): This eslint-enable comment affects 2 eslint-disable comments`
- `eslint-comments/no-unused-enable` -> `/* eslint-enable no-alert, no-debugger */` after disabling only `no-alert` -> `warning eslint-comments(no-unused-enable): 'no-debugger' rule is re-enabled but it has not been disabled`
- `dot-notation` test -> `VALID_IDENTIFIER.test(value)` replaced by `false` -> `✕ a['b'];`
- `consistent-this` test -> the unexpected-alias branch disabled -> `✕ function f() { const self = this; }` `Should have 1 error but had 0`
- `no-undef-init` test -> only `var` bindings checked -> `✕ let a = undefined;` `Should have 1 error but had 0`
- `bun run format` -> `export const a = {b:1}` in `src/` -> `Format issues found in above 1 files`
- `bun run typecheck` -> `export const x52a: number = 'not a number'` in `src/core/keyboard.ts` -> `TS2322 Type 'string' is not assignable to type 'number'`, exit 1
- `bun run bench:typecheck` -> `export const x52f: number = null` in `bench/src/types.ts` -> `src/types.ts(329,14) TS2322 Type 'null' is not assignable to type 'number'`, exit 1
- `gate.test.js` "the linter is set to catch the shape of the bug itself" -> `no-unused-expressions` set to `warn` in `.oxlintrc.json` -> `Expected: "error" Received: "warn"`
- `doctor.test.js` bun case -> the older-than-pin branch removed from `bunStatus` -> `Expected: "fail" Received: "ok"`

## Files changed

- Lint: `.oxlintrc.json`, `eslint-rules/core.js`, `eslint-rules/__tests__/rules.test.js`,
  `eslint-rules/index.js` (header comment), `eslint.config.mjs` (deleted)
- Format: `.oxfmtrc.jsonc`, `.prettierignore`, `.changeset/config.json`
- Scripts and pins: `package.json`, `bun.lock`, `bench/package.json`, `lefthook.yml`,
  `scripts/check-steps.mjs`, `scripts/doctor-core.mjs`, `scripts/gate-core.mjs` (`TOOLING_FILES`),
  `scripts/real-input/android.mjs`
- Tests: `scripts/__tests__/gate.test.js`, `scripts/__tests__/gate-check.test.js`,
  `scripts/__tests__/changesets.test.js`, `scripts/__tests__/doctor.test.js`
- Docs: `CONTRIBUTING.md`, `docs/upstream.md`
- Formatter rewrite (own commit): 10 files in `src/`, `bench/src/`, `scripts/real-input/`

## Follow-ups

- `lefthook.yml`: unmapped, so editing it owes both platforms' device gates.
- `docs/agents/gates.md`: still names `eslint.config.mjs` as check-only tooling.
- lint rules: their test runs on ESLint's AST while oxlint runs them on its own; oxlint's `RuleTester` needs an ESM test runner.
- `eslint-comments/no-aggregating-enable` under oxlint reports at the last `eslint-disable` (4:10), ESLint at the `eslint-enable` (5:0).
- `package.json` `create-react-native-library.tools` still lists `eslint` (template metadata).

## Questions for orchestrator

1. `need --for review` asks for `harness:ios` and `harness:android`: the formatter touched `src/`,
   and `package.json`/`bun.lock` are unmapped. The brief allowed an Android lease only, and the
   lease queue left no time for either harness run within the budget. Options: (a) run both at
   merge, which runs them anyway on this tree's digests; (b) a short fix round that runs them
   under one lease for both platforms. **Recommend (a)**: nothing here changes app code beyond
   the formatter's line breaks in type aliases.

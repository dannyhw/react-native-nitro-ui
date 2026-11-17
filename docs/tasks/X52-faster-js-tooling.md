# X52 — lint, format, type checks and the e2e suite on faster tools, with the time measured

**Kind:** tooling · **Devices:** android · **Budget:** 3 h for round one (X51, a tooling task of
similar width, took 2 h)

## Goal

Nothing changes for people using the library: contributors and gates wait less for lint, format,
type checks and the Android e2e suite, and the report says by how much.

## Why

Owner request: move the e2e suite to the bun runtime, ESLint to oxlint, Prettier to oxfmt, try
`bun check` in place of `tsc` for type checks, and report whether each saves time.

## Behaviour

1. `bun run lint` runs oxlint. The four `nitro-ui/*` rules still run on the files they cover today
   and still fail on what their tests feed them.
2. `bun run format` and `bun run format:write` run oxfmt, configured to reproduce today's
   formatting as closely as it can.
3. `bun run typecheck` and `bun run bench:typecheck` run `bun check` over the same files as today,
   if it reports the same errors as `tsc` on this tree and on a file with a type error; otherwise
   they stay on `tsc` and the report shows the disagreement.
4. The Android real-input gate starts its e2e phase on the bun runtime, if a filtered run passes
   that way; otherwise it stays on Node and the report says what failed.
5. `check`, the git hooks, CI and the contributor docs name the new tools, and a tool that no
   command uses any more is removed from the dependencies.

## Proof

- `node scripts/gate.mjs check` passes; `node scripts/gate.mjs need --for review` prints nothing
  missing.
- Red proofs, one line each: a lint error oxlint must catch; each `nitro-ui/*` rule on its own
  failing fixture; an unformatted file; a type error in `src/` and one in `bench/`.
- The report lists every ESLint rule that was on and has no oxlint equivalent, and how many files
  the formatter changed.
- A time table in the report, median of three runs on a quiet machine, before and after: `lint`,
  `format`, `typecheck`, `bench:typecheck`, the whole `check`, and the pre-commit hook on one
  staged `.tsx` file.
- e2e: `node scripts/gate.mjs real-input:android -- --control switch --control context-menu
  --control text-field` once on Node and once on bun, with the e2e phase's duration from each.

## Out of scope

- Babel, Jest and the library build: measure only (see below), change nothing.
- The iOS real-input tests; the e2e tests themselves; the e2e HTML reporter.
- `scripts/gate-core.mjs`, the lease code, and any rule about how gates run.

## Decided already

- One pull request. The formatter's rewrite of existing files is one commit that contains nothing
  else; every other commit leaves formatting alone.
- The custom rules keep running. Use oxlint's own plugin support if it runs them unchanged; if it
  cannot, keep ESLint for those four rules only and say what that costs.
- TypeScript stays installed: the library build and the API report use it.
- Pin a bun version the e2e runner accepts (1.4.3 or newer) wherever the repo pins bun, and make
  `scripts/doctor.mjs` refuse an older patch version.
- The device step comes last. Before it, run `node scripts/lease.mjs list`. While a lease for
  task X51M is held, start no device run: a merge run needs a quiet machine. If it is still held
  when everything else is done, commit, report the e2e proof as not done, and stop.
- Also measure, without changing anything: how long `bob build` takes, and how long the root
  Jest run takes with a cold and a warm transform cache. These go in the report as numbers.

## Context

`package.json` (scripts, `prettier`, `jest`), `eslint.config.mjs`, `eslint-rules/`,
`.prettierignore`, `lefthook.yml`, `scripts/check-steps.mjs`, `scripts/check.mjs`,
`scripts/doctor.mjs`, `scripts/real-input/android.mjs` (where the e2e binary is started),
`example/e2e/`, `bench/package.json`, `.github/workflows/`, `CONTRIBUTING.md`.

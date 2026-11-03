# D5 — A README for the people who use the library

**Worktree / branch:** named in your delegation message (`task/D5-readme-for-users`). **Round cap:** 1 round, plus at
most 1 fix round. **Devices:** none.

## Why

The owner (2026-11-03): "remove anything from the readme that isn't useful for the end user, for example we shouldn't
be mentioning mac-1 or things specific to our setup. If something like that needs to be recorded it can go somewhere
else."

The README's reader is an app developer deciding whether to use nitro-ui and how. It now carries a lot written for
the maintainers: machine labels (`maintainer-mac-1`/`-2`), per-machine bench narratives and baseline/gating mechanics,
links into `docs/tasks/*` reports, `DECISIONS D23/D32/D33…` references, CI workflow internals, and smoke-test history
told from "this machine".

## Do

1. Go through `README.md` section by section and keep only what an app developer needs: what the library is, the
   components (table, screenshots, usage), requirements, installation (including from a clone, trimmed to the
   commands and what they need), sizing behaviour they will see, performance **in brief**, known limitations that
   affect apps, how it works (short), a contributing pointer, license.
2. **Nothing internal stays:** no machine labels or "this machine", no task IDs or `docs/tasks/*` links, no
   `DECISIONS Dnn` references (state the user-facing reason in plain words, or link the component doc that explains
   it), no workflow names or which ones are disabled, no bench plan flags, baseline files or gating rules.
3. **Move, don't lose.** Anything removed that is a real record goes elsewhere, verbatim where possible, with links
   fixed:
   - the full performance write-up (per-machine tables, readings, baselines and gating) → `docs/performance.md`
     (new), linked once from README's short Performance section;
   - consumer smoke-test results and which workflows run → CONTRIBUTING (its existing smoke-test / CI sections);
   - anything else to the closest existing doc (`docs/architecture/`, `docs/components/*`, CONTRIBUTING).
   The README's own Performance section becomes a short, honest summary a user can act on: what is compared
   (nitro-ui vs RN core and Expo UI, Release builds, same device), the headline results with the device/OS they came
   from (no machine label), the main caveat, and the link.
4. Keep everything `check` enforces: every component's Components row, import-block name and both screenshot
   `<img>`s (`scripts/__tests__/readme-components.test.js`), and the typechecked example blocks (`readme:check`
   matches ` ```tsx name=… ` blocks to `example/src/readme-examples.tsx` — don't change a named block's code).
5. The README describes what ships on npm now (0.6.0: TextField, Chip, BottomSheet included). Fix stale statements
   you meet (e.g. "eight controls", a Status column saying `next` for released components) — check `package.json`
   and the changelog for what's released.

## Not in scope

The component docs and CONTRIBUTING's own content beyond receiving moved text. Code. Anything else: one FOLLOWUPS line
(e.g. if `docs/components/*.md` carry the same internal references).

## Gates

`check` (docs-only otherwise). Report at `docs/tasks/D5-readme-for-users.report.md` (summary, what moved where, a
before/after line count), ledger exported (`gate.mjs export --task D5`).

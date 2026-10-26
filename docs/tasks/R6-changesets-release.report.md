# R6 — Changesets + trusted publishing — report

**Branch:** `task/R6-changesets-release` (from `main` at `f92ccac`) · **Devices:** none ·
**Node:** `v24.22.1` via `fnm exec --using 24 --`, bun 1.4.0, npm 11.19.1.
**Not done, deliberately:** no push, tag, `npm publish` (only `--dry-run`), `npm login`
or GitHub/npm settings — the owner does the setup below.

## Verdict

1. Changesets now versions this package (`bun run release:version` cuts
   `0.1.0 → 0.1.1` with a changelog entry) and `npm publish --dry-run` packs it;
   `release.yml` drives both from Actions with no npm credential.
2. Two things blocked that, one inherited (§1).
3. `bun run check` exit 0, tree clean afterwards; both workflows `actionlint`-clean.
4. `ci.yml` untouched (X1 owns it) — the PR reminder is `changeset-status.yml`.

## 1. What stopped Changesets

Package discovery (`@manypkg/get-packages`) walks the workspace globs only, so with
`workspaces: ["example", "bench", "bench/modules/bench-probe"]` this package is
invisible — under Changesets v2 and v3 alike — and `changeset version` aborted:
`Error: Found changeset … for package react-native-nitro-ui which is not in the
workspace`. Adding `"."` lists four packages, root first, and bun resolves the same
tree: no new lockfile entries, no self-link in `node_modules`. The earlier read
that Changesets v3 cannot do this was wrong — it works once the root is a workspace —
so the repo stays on `@changesets/cli@^3.0.3` and `changesets/action@…# v2.1.2`.

At `bf8edd1` the lockfile still listed the release-it devDependencies, so
`bun install --frozen-lockfile` failed (`lockfile had changes, but lockfile is frozen`)
— CI would be red for anyone rebasing on it. This branch relocks.

## 2. Changelog generator

`@changesets/changelog-github` throws before writing anything unless a personal access
token sits in `GITHUB_TOKEN` ("Please create a GitHub personal access token … add it as
the GITHUB_TOKEN environment variable", `@changesets/get-github-info`), and calls
GitHub's API per entry. Replaced by the bundled `@changesets/changelog-git`: entries
read `- <sha>: summary` rather than linking pull requests. Under v3,
`format: "prettier"` runs *this* repo's prettier 3.9.10, so generated files pass
`bun run format`; v2 bundles prettier 2.

## 3. Release workflow

`changesets/action@ae32849d…# v2.1.2`, `version-script` / `publish-script`. Gates first
(`bun run check`, committed-codegen diff, clean-tree assert): the action commits
whatever the tree holds. Commits, tags and releases go through the GitHub API (that
action's default), so the checkout keeps no credentials. npm is pinned to 11.19.1
(trusted publishing needs ≥ 11.5.1). `NPM_CONFIG_PROVENANCE=true` is required because
`changeset publish` runs
`npm publish --access public --tag latest` with no provenance flag of its own, passing
env through. No `NPM_TOKEN`/`NODE_AUTH_TOKEN` anywhere. ubuntu is fine: `npm publish`
runs `prepare` (bob → nitrogen → patch script), all Node; `test:native` is macOS-only
and self-skips there — the macOS CI job covers it.

## 4. Proof without publishing

Scratch branch, then discarded. `changeset status --since=…` exits 1 for a library
change with no changeset, 0 with one (`Packages to be bumped: - patch -
react-native-nitro-ui`). `bun run release:version` touched exactly `package.json`,
`CHANGELOG.md` (`## 0.1.1` above `## 0.1.0 — 2026-10-26`) and deleted the changeset;
`bun.lock` and the `example`/`bench`/`bench-probe` versions untouched; prettier clean on
both generated files. `bun run prepare && npm publish --dry-run` →
`react-native-nitro-ui@0.1.1`, 465 files, 439.1 kB, `CHANGELOG.md` inside, matching
`manifest:check`. Shown red then green: dropping `"."` or one `ignore` entry fails 2 of
the 14 assertions in the new guard test.

## 5. Gate results

`bun run check` exit 0: typecheck/lint/format, jest 240 tests / 16 suites,
`test:native: PASS`, `perf:renders` 7, nitrogen no drift, autolinking, bob build,
api-extractor, `publint --strict` "All good!", manifest 465, README examples 8;
`git status --porcelain` empty afterwards. `actionlint` clean on both Changesets
workflows. Follow-ups: `docs/upstream.md` still describes the template's release-it
option; changelog PR links would need a token, deliberately not taken.

## Owner setup checklist

1. npmjs.com → `react-native-nitro-ui` → Settings → **Trusted publisher** → GitHub
   Actions: owner `dannyhw`, repository `react-native-nitro-ui`, workflow name
   `release.yml`, no environment name (the job uses none).
2. Same page: **Require 2FA and disallow tokens**.
3. GitHub → `dannyhw/react-native-nitro-ui` → Settings → Actions → General → tick
   **Allow GitHub Actions to create and approve pull requests**, or the Version
   Packages PR cannot be opened.
4. `gh workflow enable Release` and `gh workflow enable "Changeset status"`.
5. First smoke: merge a PR with a changeset, review the Version Packages PR, merge it,
   then `npm view react-native-nitro-ui version` (npm may show a staged placeholder
   first). Nothing publishes until 1 and 3 are done.

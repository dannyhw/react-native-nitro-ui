# R6 — Changesets + automated release with npm trusted publishing

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/R6` (branch `task/R6-changesets-release`, from
`main`). **Round cap (D19):** 1 + 2 fix rounds. No devices needed. Do not push, tag, publish or change
GitHub/npm settings. No personal info (D25).

The owner's call (D27): future versions are released by **Changesets** from GitHub Actions, published
with **npm trusted publishing** (OIDC, `id-token: write`) — no npm token anywhere. 0.1.0 was published
by hand (D26) and is the starting point.

1. **Replace release-it with Changesets.** Remove `release-it`, `@release-it/*`, the `release-it`
   config and the `release` script; add `@changesets/cli` (and `@changesets/changelog-github` if you
   want PR/author links). `.changeset/config.json`: base branch `main`, the `example`, `bench` and
   `bench/modules/bench-probe` workspaces ignored / private (never versioned or published), public
   access. Keep the existing hand-written `CHANGELOG.md` content; new entries are prepended above
   `## 0.1.0` in a compatible format. Add `CHANGELOG.md` to `package.json` `files` (update
   `etc/package-files.txt` / `manifest:check`).
2. **`.github/workflows/release.yml`**: on push to `main`, `changesets/action` (pinned by SHA like the
   other actions) either opens/updates the "Version Packages" PR or, when that PR has been merged,
   publishes. Before publishing it runs the same gates as CI (`bun run check`, committed-codegen
   check). Publishing: Node from `.nvmrc`, npm ≥ 11.5.1 (trusted publishing), `registry-url`, **no**
   `NPM_TOKEN`/`NODE_AUTH_TOKEN` secret; provenance comes from OIDC automatically. The action creates
   the `vX.Y.Z` tag and a GitHub release from the changeset notes. Permissions: `contents: write`,
   `pull-requests: write`, `id-token: write` only. Concurrency: one release at a time. The publish
   step runs `prepare` (bob → nitrogen) on the runner — make sure that works on ubuntu (bun + Node 24),
   or run the release job on macOS if it can't, and say why.
3. **CI integration** (coordinate with X1, which owns `ci.yml` and may land first): a
   `changeset status --since=origin/main` check on pull requests that touch `src/`, `ios/`,
   `android/`, `cpp/` or `nitrogen/` — warn (not fail) when a PR has no changeset; put it in
   `release.yml` or a tiny separate workflow so it doesn't conflict with X1.
4. **Docs:** CONTRIBUTING "Releasing" section: `bunx changeset` per change, what the Version Packages
   PR is, what merging it does, that npm may stage the version for its automated scan before it goes
   live, and how to recover (re-run the job; `npm deprecate` — never `unpublish`). The one-time owner
   setup goes in the report, not done by you: on npmjs.com → package → Settings → Trusted publisher →
   GitHub Actions: owner `dannyhw`, repo `react-native-nitro-ui`, workflow `release.yml` (+ environment
   if you use one); then "Require 2FA and disallow tokens"; on GitHub → Settings → Actions → General →
   "Allow GitHub Actions to create and approve pull requests"; `gh workflow enable Release`.
5. **Proof without publishing:** `bunx changeset` + `bunx changeset version` on a scratch branch
   produce the right bump/CHANGELOG (show the diff in the report, then discard); `npm publish
   --dry-run` from the versioned tree; `actionlint` on the workflows if available; a test that the
   ignored workspaces are never bumped.

Gates: `bun run check`. Report in `docs/tasks/R6-changesets-release.report.md`, ≤ 600 words plus the
owner setup checklist.

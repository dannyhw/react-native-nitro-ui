# R6 — Changesets + trusted publishing — review

**Branch:** `task/R6-changesets-release` (`a59e527`, 6 commits over `main`).
**Verdict: FIX ROUND.** The shape is right: push-only trigger, SHA pins, no npm token,
API-mode commits, gates before the action. But the first real release would fail in
three separate ways. M1 and M3 each stop 0.1.1 from publishing at all, and M2 tags it
with the wrong name. All three fixes are small.

## What I verified (no worktree changes; scratch clone in `/tmp/r6-review/scratch`)

- **SHA pins.** `changesets/action@ae32849…` is `v2.1.2` (I dereferenced the annotated tag
  `66d7d1d`). `checkout@3d3c42e` is v7.0.1, `setup-node@949feb2` is v7.1.0,
  `setup-bun@0c5077e` is v2.2.0. `actionlint` is clean on both workflows.
- **Versioning.** I added a changeset and ran `bun run release:version` in scratch. It
  touched only `package.json` (0.1.0 → 0.1.1) and `CHANGELOG.md`, and deleted the
  changeset. `## 0.1.1` / `### Patch Changes` / `- <sha>: …` lands below the intro
  paragraph and above `## 0.1.0 — 2026-10-26`. The `example`, `bench` and `bench-probe`
  workspaces were not bumped, and `bun run format` stayed clean.
- **Publish path.** In the versioned tree, `npm publish --dry-run --json --access public --tag latest`
  is the exact argv `changeset publish` uses. It ran `prepare` → bob → "Running
  npm-cli.js run nitrogen" → patch script, and packed `react-native-nitro-ui@0.1.1`:
  465 files, 439 kB, `CHANGELOG.md` included, matching `manifest:check`.
- **Package manager for publish.** Changesets v3 publishes with npm for a bun
  workspace: `getPublishTool` falls back to the npm implementation for anything that
  is not pnpm or yarn.
- **OIDC.** npm 11.19.1 exists, Node is 24.22.1 (npm needs ≥ 11.5.1 and ≥ 22.14). npm's
  `oidc.js` writes the exchanged token with `config.set('<reg>:_authToken', …, 'user')`,
  which overrides the `XXXXX-…` placeholder `NODE_AUTH_TOKEN` that `setup-node`'s
  `registry-url` exports. The action passes `GITHUB_TOKEN` only through its input, so
  there is no env conflict. Provenance would be attached automatically (public repo,
  and `repository.url` matches), so `NPM_CONFIG_PROVENANCE=true` is redundant but harmless.
- **Linux runner.** CI's `Checks` job (`bun run check` on `ubuntu-latest`) succeeded on
  2026-10-24 (run 40093077581). `test:native` skips itself off Darwin
  (`scripts/native-tests.sh:19`). So ubuntu is fine for the release job.
- **`"."` in `workspaces`.** No self-link appears in `node_modules`, the lockfile only
  changes the dependencies, and the tarball gains only `CHANGELOG.md`. I ran
  `react-native-monorepo-config` (used by `example/metro.config.js`) with and without
  `"."`: the blockList, `extraNodeModules` and `watchFolders` come out **identical**,
  because it already adds the root package by name. `bench/metro.config.js` does not
  read `workspaces`. There is no less invasive option: manypkg drops the root package
  whenever `workspaces` exists, and Changesets has no "include root" setting. Keep it.
- **Personal data.** None in the new or changed files. `dannyhw` appears only as the
  public GitHub owner in the trusted-publisher fields.
- **Gates.** `bun run check` on the branch head (scratch): see the end of this file.

## Must-fix

### M1. The guard test makes the first release fail its own gate
`scripts/__tests__/changesets.test.js:73-80` asserts that the first `## ` heading in
`CHANGELOG.md` is `0.1.0` and that there is exactly one.

- **Scenario.** The Version Packages PR prepends `## 0.1.1`. Nothing runs on that PR,
  because PRs opened with `GITHUB_TOKEN` trigger no workflows (see N3). After it merges,
  the `Release` run executes `bun run check` → jest → this test fails → the job stops
  before `changesets/action`. `main` is left at 0.1.1 with nothing published, and every
  later push fails the same way.
- **Reproduced in scratch** after `release:version`: `Expected pattern: /^0\.1\.0/ —
  Received string: "0.1.1"`, 1 failed / 13 passed.
- **Fix.** Assert the invariant that actually matters:
  - the **last** h2 is `0.1.0 — …`;
  - every h2 above it matches `^\d+\.\d+\.\d+`, newest first (semver-descending).

  Then prove the fix by running the test against a tree versioned with `release:version`.

### M2. Tags and GitHub releases come out as `react-native-nitro-ui@0.1.1`, not `v0.1.1`
`release.yml:94-102`; the comments at `:27` and `:99`, `CONTRIBUTING.md:546` and report §3
all say `vX.Y.Z`.

- **Cause.** Changesets names tags with `tool.type !== "root" ? `${name}@${version}` :
  `v${version}`` (`@changesets/cli/dist/gitTags.mjs`). Adding `"."` to `workspaces`
  makes manypkg report `tool.type === "bun"`, not `root`. I checked:
  `getPackages()` → `bun`, and `buildGitTag` → `react-native-nitro-ui@0.1.1`.
- **Reproduced in scratch.** `changeset tag` created `react-native-nitro-ui@0.1.1`
  next to the existing `v0.1.0`.
- **Effect.** The action creates the ref through the API under that name, and the release
  is titled `react-native-nitro-ui@0.1.1` (`createRelease({ name: tagName })`). The
  existing release is tag `v0.1.0`, titled "react-native-nitro-ui 0.1.0". Changesets has
  no tag-format option.
- **Fix.** Set `push-git-tags: false` and `create-github-releases: false` on the action.
  Keep the CLI's local tags, because the action's `published` output depends on them.
  Then add an idempotent step, with values passed through `env`, never inlined:

  ```yaml
  - name: Tag and release
    if: steps.release.outputs.has-changesets == 'false'
    env:
      GH_TOKEN: ${{ github.token }}
    run: |
      version=$(node -p "require('./package.json').version")
      tag="v$version"
      npm view "react-native-nitro-ui@$version" version >/dev/null || exit 0  # not live (yet)
      gh release view "$tag" >/dev/null 2>&1 && exit 0                        # already done
      node scripts/changelog-entry.mjs "$version" > "$RUNNER_TEMP/notes.md"   # small helper
      gh release create "$tag" --target "$GITHUB_SHA" \
        --title "react-native-nitro-ui $version" --notes-file "$RUNNER_TEMP/notes.md"
  ```

  This step keys on "the version is live and has no release", not on "this run published".
  That also fixes S3. Add a test asserting the two action inputs and the `v` tag step.

### M3. The owner checklist misses the trusted publisher's "Allowed actions", so `npm publish` would be rejected
Report "Owner setup checklist" step 1, and `CONTRIBUTING.md:582-585`.

- **Cause.** npm's trusted-publisher docs say configurations created after 2026-09-03
  **default to `npm stage publish` only**, and "direct publishing is opt-in per
  configuration". On a stage-only publisher, `npm publish` from the workflow is rejected.
- **Scenario.** The owner registers `release.yml` today with the defaults. `changeset
  publish` → `npm publish` fails auth, the job goes red, and nothing is tagged.
- **Fix.** Step 1 must say: under **Allowed actions**, tick **`npm publish`** (staging
  stays allowed regardless).
- **If the owner prefers staging** (0.1.0 went through it: the registry shows
  `0.0.0-stage` at 14:41 and `0.1.0` at 14:45), the pipeline needs a different design.
  `npm stage publish` exits 0 before approval, so with the current workflow:
  - the action would tag and release a version that is not live;
  - `npm info` does not list a staged version, so a re-run would stage a second one.

  That is an owner decision; record it in DECISIONS either way.

## Should-fix

### S1. Third-party dev tooling runs while the job holds `id-token: write` and write tokens
`release.yml:26-29` (workflow-level permissions), and steps `:65-71` and `:92-107`.

- **Exposure.** `ACTIONS_ID_TOKEN_REQUEST_URL/TOKEN` are in every step's environment.
  `bun run check` executes jest, eslint and its plugins, tsc, prettier, api-extractor,
  reassure and the rest. The action also exports `GITHUB_TOKEN` (contents and
  pull-requests write) into the publish script, so `prepare` (bob, babel, nitrogen) runs
  with it too. Any compromised devDependency on `main` could mint an npm OIDC token and
  publish: npm matches on the workflow file, not the step.
- **Fix.**
  1. Set top-level `permissions: {}`.
  2. Run the gates in a `check` job with `contents: read` only.
  3. Make the `release` job `needs: check`, and grant `contents: write`,
     `pull-requests: write` and `id-token: write` only there.
  4. Better still, use Changesets v3's pack-then-publish: `changeset pack` in the
     read-only job, upload the artifact, then `changeset publish --from-pack-dir` in the
     privileged job, so no build code runs while it holds the OIDC token. The action
     ships a `pack` sub-action for this.
  5. Optionally bind the privileged job to a GitHub environment (e.g. `npm`) restricted
     to `main`, and set that environment name in the trusted publisher.

### S2. Main is unprotected, so a direct version bump publishes with no review
I checked the GitHub API: `main` has no branch protection or rulesets, and agents push
directly to it.

- **Pushing a changeset to main** is fine: it only opens or updates the Version Packages
  PR.
- **Pushing a version bump to main** (`package.json` at an unpublished version, no
  pending changesets) puts the next run in publish mode, and it publishes immediately.
  Running `bun run release:version` locally and pushing does the same.
- **Fix.** Either add a ruleset on `main` that requires a PR for `package.json` /
  `CHANGELOG.md`, or put the publish job behind a required-reviewer environment (S1,
  item 5). Add whichever you choose to the owner checklist.

### S3. "Re-run the failed job" does not recover a publish whose tag or release failed
`CONTRIBUTING.md:562-565`.

- **Cause.** Changesets only emits `git-tag` events for packages it published in *this*
  run. On a re-run, npm already has the version, the plan is empty ("No unpublished
  projects to publish"), so the action creates neither the tag nor the release.
- **Silent failure.** `pushTag` failures are only a warning ("Assuming it was manually
  pushed").
- **Fix.** The idempotent step in M2 covers this. Otherwise, document the manual recovery
  (`gh release create vX.Y.Z --target <sha> …`).
- **What the doc gets right:** a re-run *after an npm failure* is safe. `changeset publish`
  checks `npm info` first and treats "cannot publish over the previously published
  version" as a skip.

### S4. The staged-placeholder paragraph is wrong for this pipeline
`CONTRIBUTING.md:559-561`.

- **What it says:** the new version may briefly show as `0.0.0-stage…` while npm scans it.
- **What actually happens:** `0.0.0-stage` is the placeholder npm creates when a package
  that does not exist yet is put through `npm stage publish`. That is how 0.1.0 went out.
  A trusted-publisher `npm publish` goes live directly.
- **Fix.** Replace the paragraph with the M3 note (stage-only rejects `npm publish`), and
  say what changes if the owner ever moves to staging.

### S5. The concurrency comment is wrong, and a cancelled run can strand a version
`release.yml:20-24`.

- **Cause.** GitHub keeps at most **one pending run per group** and cancels the older
  pending one when another push arrives. `cancel-in-progress: false` only protects the
  run that is already executing.
- **Scenario.** A run is in progress. The Version PR merges, and its run goes pending.
  Then a PR with a changeset merges. The pending publish run is cancelled, and the new
  run enters version mode, because changesets are present. 0.1.1 never publishes, and
  the next Version PR bumps to 0.1.2 over an unreleased 0.1.1 entry.
- **Fix.** Correct the comment, and document "re-run the cancelled run; re-runs use its
  original SHA". Or add a step before the action that runs `changeset publish` whenever
  `package.json`'s version is not on npm, regardless of pending changesets.

## Nits

- **N1. `changeset-status.yml:11-14` comment is inaccurate.** The job *does* run PR code:
  the `./.github/actions/setup` composite and the `changeset` script both come from the
  PR's tree. That is safe because `pull_request` from a fork gets a read-only token and
  no secrets, which is the real reason. Also, on `pull_request`, `origin` is the base
  repository, so `origin/main` is upstream `main`, not the fork's.
- **N2. "Changeset status" will run as soon as this merges.** A newly added workflow file
  is enabled by default. `Release` stays `disabled_manually` (checked through the API),
  so merging does not start publishing. Fix `CONTRIBUTING.md:9-11` and drop
  `gh workflow enable "Changeset status"` from checklist step 4 (it is a no-op).
- **N3. The Version Packages PR gets no checks.** It is opened with `GITHUB_TOKEN`, so no
  `pull_request` workflows run on it, and the post-merge `Release` run is its only gate
  (which is why M1 bites). Say so in "Releasing". If required status checks are ever
  added on `main`, that PR cannot merge without a GitHub App token.
- **N4. The changelog entries do not link anything.** `.changeset/README.md:9-10` and
  `CONTRIBUTING.md:549-550` say entries "link the commit". `changelog-git` writes a plain
  short SHA, which GitHub autolinks in a release body but not in a rendered
  `CHANGELOG.md`.
- **N5. The changelog-github rationale is off.** `CONTRIBUTING.md:551-556` and report §2
  say it needs a PAT. Inside Actions, the action exports `GITHUB_TOKEN` (the automatic
  token, not a secret anyone creates) to the version script, so `changelog-github` would
  work in CI. Only a local `release:version` needs a token. Keeping `changelog-git` is
  fine; correct the reason.
- **N6. The changelog header and the new entries disagree.** `CHANGELOG.md`'s header
  promises Keep a Changelog, but new entries are `## 0.1.1` / `### Patch Changes` with no
  date. They are compatible enough to parse (the action's `getChangelogEntry` matches
  the bare version). Either reword the header or accept the mixed style.
- **N7. The SHA-pin test checks too little.**
  `scripts/__tests__/changesets.test.js:151` only checks `release.yml`. Include
  `changeset-status.yml` and `.github/actions/setup/action.yml`.
- **N8. The lockfile refresh in `release:version` does nothing useful.**
  `bun install --no-frozen-lockfile` changed nothing in scratch (`bun.lock` untouched),
  and it lets the resolver pull fresh registry data inside a write-token job. Drop it,
  or use `--frozen-lockfile`.
- **N9. Small workflow hygiene in `release.yml`.**
  - Add `package-manager-cache: false` on `setup-node`; npm's docs say "never use caching
    in release builds".
  - Add `timeout-minutes` to the job.
  - Make the `Report` step `if: always()`, so a failed publish still writes the summary.
- **N10. The owner setup lives in a task report.** `CONTRIBUTING.md:582-585` points
  contributors at `docs/tasks/R6-…report.md`. Put the (corrected) checklist in
  CONTRIBUTING itself.
- **N11. Every push to `main` runs the full gate.** That includes the frequent docs-only
  pushes, about 10+ minutes each, with OIDC rights until S1 is fixed. Acceptable, but
  worth knowing.

## Report claims, checked

- **Confirmed:** `bun run check` and the tree state (below), the actionlint result, the
  changeset-version diff, the dry-run (465 files / 439 kB, `CHANGELOG.md` inside), and
  `"."` being required.
- **"tags `vX.Y.Z`":** false (M2).
- **"provenance … NPM_CONFIG_PROVENANCE is required":** not required, because trusted
  publishing auto-enables provenance. It is harmless.
- **The changelog-github PAT claim:** partly wrong (N5).
- **The staged-placeholder explanation:** wrong (S4).
- **Owner checklist:** incomplete (M3, S2).

## Gate result (scratch clone at `a59e527`)

`bun run check` exited 0:
- jest: 16 suites, 240 tests;
- `test:native`: PASS;
- `perf:renders`: 7/7;
- `publint`: "All good!";
- `manifest:check`: 465 files;
- README examples: 8 blocks.

`git status --porcelain` was empty afterwards. The R6 worktree is untouched (`git status --porcelain` is empty there too).

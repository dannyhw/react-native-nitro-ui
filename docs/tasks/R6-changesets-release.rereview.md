# R6 — Changesets + staged release — re-review of fix round 1

**Branch:** `task/R6-changesets-release`, fix round `a59e527..306b07f` (6 commits).
**Verdict: MERGE WITH FOLLOW-UPS.**

The staged-only redesign holds up:
- only `stage` holds `id-token`, and it runs no repository code;
- the sha256 travels as a job output, which no other job can rewrite;
- `run:` bodies contain no `${{ }}`;
- every action is pinned by SHA;
- both tag paths are keyed on state.

I found no defect that makes the first run fail. Two things must still happen at merge time, and neither is a code change:
- resolve the `docs/DECISIONS.md` conflict;
- get `Release` enabled, because it is `disabled_manually` today.

The open first-run risks are on npm's side: the OIDC exchange, provenance under staging, and whether a staged publish counts as the validating publish. Nothing local can settle them. They are on the watch-list below.

## What I checked (no changes to the worktree; scratch in `/tmp/r6-rereview/`)

**Tests and lint**
- `actionlint` is clean on `release.yml`, `release-tag.yml` and `changeset-status.yml`.
- On `306b07f`, typecheck, lint, format and jest all pass: 17 suites, 260 tests.
- I did not re-run the full `bun run check` (native/perf/bob). Round 0 and the implementer both ran it with exit 0.

**First-run simulation**
- I ran `bun run release:version` in scratch. It touched only `package.json` (0.1.1) and `CHANGELOG.md`, and deleted the changeset.
- `## 0.1.1 / ### Patch Changes` lands above `## 0.1.0 — 2026-10-26`.
- The guard and catch-up suites pass on that versioned tree (34/34). **M1 is proven fixed.**
- `npm pack` on that tree gives `react-native-nitro-ui-0.1.1.tgz` (439,110 B).
- npm 11.19.1 `stage publish <tgz> --access public --tag latest --provenance --dry-run` was run from an empty directory, with a setup-node-style `.npmrc` and `NODE_AUTH_TOKEN=XXXXX-XXXXX-XXXXX-XXXXX`. It printed `Staging to https://registry.npmjs.org/ with tag latest and public access (dry-run)` and `+ react-native-nitro-ui@0.1.1 (staged)`, exit 0.

**npm 11.19.1 source** (`lib/commands/stage/publish.js` extends `publish.js`)
- `npm stage publish` goes through the same `#publish`, which calls `oidc()` before reading credentials.
- `oidc()` writes the exchanged token with `config.set(<reg>:_authToken, …, 'user')`, which overrides the setup-node placeholder.
- `oidc()` also switches on provenance for a public repo and package, so `--provenance` is redundant but consistent.
- **The OIDC failure path is silent.** It logs at `verbose` only, then falls through to the placeholder token and an `E401`.

**The setup-node placeholder token, tested live**
- `npm view react-native-nitro-ui@0.1.0 version` → `0.1.0`, exit 0.
- `@0.1.1` → E404, exit 1.
- `npm stage list` → E401, which `|| true` absorbs.
- So `registry-url` does not break the stage job's reads, and `npm install -g npm@11.19.1` (also anonymous) is unaffected.

**changesets/action v2.1.2** (`src/index.ts`)
- With no changesets and no `publish-script`, it logs "Not publishing because publish-script is not set" and returns.
- With changesets, it runs `runVersion` and sets `pr-number`.
- `push-git-tags` and `create-github-releases` are real inputs.

**GitHub state** (read-only API)
- `Release`, `CI`, `Bench` and `Smoke` are all `disabled_manually`.
- `can_approve_pull_request_reviews: true`, so the PR-creation setting is already on.
- Release `v0.1.0` exists and is the only tag.
- Main's current `release.yml` is the old release-it workflow, `workflow_dispatch` only.

**Catch-up script**
- `--dry-run` at 0.1.0 against the real repo → `v0.1.0 already has a release — nothing to do.`
- I drove `runCatchUp` with real git over the versioned scratch history, and with npm and `gh` mocked to "live, no release". It targets the Version Packages commit and takes the right notes.
- One exception is N-2 below.

**Merge with main**
- `git merge-tree main HEAD` → **CONFLICT in `docs/DECISIONS.md`**, and only there.

## Round-0 findings

| ID | Status | Note |
| -- | ------ | ---- |
| M1 | **Fixed** | `0.1.0` is asserted last, and the headings above it are versions, newest first. Verified green on a tree written by `release:version`. |
| M2 | **Fixed** (by redesign) | The action's tags and releases are off. `release-tag.yml` + `release-catch-up.mjs` create `vX.Y.Z` once the version is live. Target choice has a follow-up (N-2). |
| M3 | **Answered** | The owner chose staged-only. `stage` runs `npm stage publish`, and the checklist says leave `npm publish` unticked. |
| S1 | Fixed | `permissions: {}` at the top. `pack` has `contents: read`, `stage` has `id-token: write` only, `version` has contents + PR write. |
| S2 | Answered | Approval with 2FA is now the control. The CONTRIBUTING wording has a factual error (N-6). |
| S3 | Fixed | The catch-up is state-keyed and idempotent (tested, and simulated above). |
| S4 | Fixed | |
| S5 | Fixed | The comment is accurate. The recovery wording is slightly off (N-6). |
| N1–N11 | Fixed or documented | N8: `release:version` is bare `changeset version`. N9: all three hygiene items are present. |

## New findings

### Must happen at merge (process, not code)

**P-1. `docs/DECISIONS.md` conflicts with main, and D28 duplicates main's "D27 amendment".** Branch `docs/DECISIONS.md:244-262` vs. main's D27 amendment.
- Both append at the same spot, so `git merge-tree` reports a content conflict.
- They record the same decision: staged-only, CI stages, the owner approves with 2FA, a catch-up job tags, and only staging gets `id-token`.
- They do not contradict each other. D28 adds the Changesets tag-naming reason and the `npm stage list` limitation.
- **Fix when resolving:** keep one record. Either:
  - fold D28's two extra paragraphs into the D27 amendment and change the "D28" references (`release.yml:3`, `release-tag.yml:3`, `release-catch-up.mjs:5`, CONTRIBUTING "Releasing"); or
  - keep D28 and replace the amendment with a one-line "see D28".

  Don't keep both.
- D28's line 255 says re-runs rely on "npm's own semver-uniqueness rejection". That is only half verified; see N-3.

**P-2. `Release` is `disabled_manually`, so the merge push starts no run.**
- Where: CONTRIBUTING.md:691-694 ("After merging … enable `Release` … if inactive"), and report first-run step 3 ("Merge this branch… The first `Release` run is in version mode").
- **Scenario:**
  - The owner merges and waits for run 1, but nothing happens, because a disabled workflow ignores the push.
  - Enabling it afterwards does not retro-trigger anything.
  - The Version Packages PR only appears after a manual dispatch or the next push.
  - With the 2026-10-28 deadline, that is a day lost to confusion.
- **Fix:**
  - Run `gh workflow enable Release` **before** merging. That is safe: main's `release.yml` is dispatch-only until the merge replaces it.
  - Or, after merging, run `gh workflow enable Release && gh workflow run release.yml --ref main`.
  - Put that in CONTRIBUTING step 4 and in the report's first-run steps.
- `Release tag` and `Changeset status` are new files and will be active on merge.

### Follow-ups (none block the first run)

**N-2. `release-catch-up.mjs` tags the newest commit carrying the version, not the commit that bumped it.** Medium. `scripts/release-catch-up.mjs:75-80`, `:121-134`.
- `findVersionCommit` walks `git log -- package.json` newest-first and returns the first commit whose version matches.
- Any later commit that touches `package.json` without changing the version (a devDependency bump, a script edit) therefore takes the tag. The doc comment at `:70-74` promises the opposite.
- **Reproduced in scratch.** Version commit `edd1a77`, then a `del-cli` bump `b6a5c0b`, with npm and `gh` mocked to "live, no release" → `gh release create v0.1.1 --target b6a5c0b…`.
- The test's "newer 0.1.2 commit is passed over" case cannot happen in practice, because HEAD's version is the one being looked up.
- **Scenario:** 0.1.1 is staged. Before the owner approves, someone lands a dependency bump. `v0.1.1` then points at a tree that is not what was staged.
- **Fix:**
  - Keep walking while the version matches, and return the **oldest** commit of that newest contiguous run (the commit right after the version last differed).
  - Add a test with `[c_dep(0.1.1), c_bump(0.1.1), c_prev(0.1.0)]` → `c_bump`.
- **First run:** safe as long as nothing touches `package.json` between the Version PR merge and `Release tag`.

**N-3. During the approval window, a re-run or a later push to `main` re-stages, and the "already known" branch is unverified for staged versions.** Low–medium. `release.yml:184-217`.
- The client-side `You cannot publish over the previously published versions` check (`publish.js:175-177`) reads the **packument**, which does not include staged versions. So on a re-run, the POST to `/-/stage/package/…` does go out.
- npm's `npm-stage.md` says staged and published versions share one unique index, so the registry should reject the duplicate. **No double-stage**, which is good.
- But the server's message is not known. If it is not that exact phrase, the grep at `:214` misses it, and the run goes **red** (`Staging failed`).
- Agents push docs to `main` directly, so this is likely: every push during the window would produce a red `Stage on npm`.
- **Fix after the first real run:**
  - Read the actual error from a re-run while 0.1.1 is staged, and add it to the match (e.g., also `E409` or its text).
  - Or only stage when the push changed `package.json`'s version (compare `github.event.before`), with `workflow_dispatch` for recovery.
- Correct CONTRIBUTING.md:606 and D28:255 to "expected", not "known".

**N-4. OIDC failures are invisible in the stage log.** Low, but cheap and useful for the deadline. `release.yml:201-202`.
- npm logs the exchange failure (`Failed token exchange request with body message: …`) at `verbose` only, then fails with a generic `E401 Unable to authenticate`, because the setup-node placeholder token is still configured.
- **Fix:** add `--loglevel verbose` to the `npm stage publish` line. npm redacts tokens in its logs.
- I recommend doing this in the merge commit, or as a one-line follow-up before the first staging run, so a misconfigured publisher shows its reason the first time.

**N-5. Stage and version jobs have no `main` guard on `workflow_dispatch`.** Low. `release.yml:28`, `:125-136`, `:223-233`.
- Anyone with write access can dispatch `Release` on a feature branch. `stage` would then stage that branch's version, and `version` would open a Version PR against that branch.
- The trusted publisher matches the workflow file, not the ref.
- The owner's 2FA approval contains the damage, but a stray staged version is noise.
- **Fix:** `if: github.ref == 'refs/heads/main'` on `stage` and `version`.

**N-6. Doc inaccuracies in CONTRIBUTING.**
- `:695-697` — "The only commits that touch `package.json` and `CHANGELOG.md` are the Version Packages ones". False: this branch, dependency bumps and script edits all touch `package.json`. That is exactly the N-2 trigger. Reword.
- `:640` — "run dropped before `stage` → nothing: the next run stages it". The "next run" only exists if someone pushes again. Say "run `Release` from **Run workflow**".
- `:606` — see N-3.

**N-7. The release build restores a shared `node_modules` cache.** Low. `release.yml:64-65` → `.github/actions/setup/action.yml` (`actions/cache/restore` + `save`).
- The `pack` job builds the tarball from a `node_modules` cache that is shared with CI, Smoke and Bench on `main`.
- npm's guidance (quoted in the workflow at `:145`) is no caching in release builds.
- Poisoning needs a main-scoped writer. Bench's `issue_comment` path saves from main's lockfile before `gh pr checkout`, and all of those workflows are disabled today. The approval step limits the damage.
- **Fix:** give `pack` an uncached install (`bun install --frozen-lockfile --ignore-scripts`), or add a `cache: false` input to the composite.

**N-8. Nits.**
- `release-tag.yml:26`: cron `'0 * * * *'`. GitHub delays or drops top-of-hour schedules under load; use an off-minute such as `'17 * * * *'`.
- Scheduled workflows auto-disable after 60 days without repo activity. Worth one line in CONTRIBUTING.
- The `stage` job does not cross-check that the tarball's `package/package.json` name and version equal the `pack` outputs. The sha covers transport, not a confused `pack`.
- `npm install -g npm@11.19.1` runs in the OIDC job. It is version-pinned but not integrity-pinned. Acceptable.
- Release notes are `## 0.1.1\n### Patch Changes…`. The heading repeats the release title, and there is no blank line after it. Cosmetic.

## Security summary (Q2)

- **Triggers.** `push` to `main`, plus `workflow_dispatch` (N-5). No `pull_request*`, so no PR can run `release.yml`. `release-tag.yml` runs on `schedule` / `workflow_dispatch`, from default-branch code only.
- **Permissions.** Top level is `{}`. Only `stage` has `id-token: write`. `stage` has no checkout, no install and no repo script; it is setup-node, the npm pin, download-artifact and two bash steps.
- **Artifact handoff.** Artifacts are per-run, and `download-artifact` without `run-id` reads only this run, so another workflow or a PR cannot plant one.
- The parallel `version` job runs repo code with the runtime token, so in principle it could overwrite the artifact. It cannot change `needs.pack.outputs.sha256`, so a swap fails `sha256sum --check`.
- The sha is only as trustworthy as `pack`, which runs the whole dev toolchain. That is inherent, and the owner's 2FA approval is the backstop.
- **Injection.** No `${{ }}` in any `run:` body; everything goes through `env:`. The catch-up uses `spawnSync` argv arrays with `shell: false`.
- **Pins.** All actions are SHA-pinned (checkout, setup-node, upload- and download-artifact, cache, setup-bun, changesets/action). The suite asserts this across all four files.
- **Concurrency.** No run is lost permanently, because state is the registry. A replaced pending run can mean 0.1.1 is packed from a later commit than the bump (README or docs drift into the tarball). That is acceptable; N-2 makes the tag side consistent.
- **Hourly `contents: write`.** Runs only checkout, setup-node and a dependency-free Node script from `main`. Acceptable.

## First-run correctness (Q3)

**Run 1** (merge, 0.1.0 live, one changeset). Provided `Release` is enabled (P-2):
- `pack` → 0.1.0 tarball.
- `stage` → `npm view` succeeds, then "already on the registry". No OIDC call is made.
- `version` → opens the PR. The PR setting is already on.

**Run 2** (Version PR merge):
- `pack` packs 0.1.1.
- `stage` → `npm view` gets E404, `stage list` gets E401 (absorbed), then `npm stage publish`.
- The flags are fine: `--tag latest` explicit, `--access public`, `--provenance` (also auto-set).
- npm is 11.19.1 on Node 24.22.1.
- The placeholder token does not interfere, because OIDC overrides it on success.

**"Already on the registry → success"**
- Correct, and idempotent after approval.
- Before approval, see N-3.

**Catch-up**
- Correct target and section in the normal flow; N-2 otherwise.
- A version not yet approved → `npm view` fails → no-op.

**PR opened by `GITHUB_TOKEN` gets no checks**
- Harmless here: CI is disabled anyway, and the post-merge `pack` job is the gate.
- The merge itself is a user push, so it does trigger `Release`.

## Personal data (Q5)

None. Grep over the branch diff for home paths, emails and device names hit only lockfile hashes and `@callstack/reassure-*` package names.

## First-run watch-list

1. **Before merge:**
   - run `gh workflow enable Release`;
   - confirm the trusted publisher is `dannyhw` / `react-native-nitro-ui` / `release.yml`, no environment, staged only;
   - resolve the DECISIONS conflict.
2. **Run 1, `Check and pack`:** `bun run check` is green, then `Packed **react-native-nitro-ui@0.1.0**` and a sha256 line.
3. **Run 1, `Stage on npm`:** "is already on the registry — nothing to stage". Anything else means `npm view` is misbehaving.
4. **Run 1, `Version Packages pull request`:** the summary shows a PR number. The PR diff should be `package.json` 0.1.1, one `CHANGELOG.md` entry above `## 0.1.0`, and the changeset deleted.
5. **Run 2, `Stage on npm`:**
   - `Verified the tarball's sha256.`;
   - then `Staging to https://registry.npmjs.org/ with tag latest and public access`;
   - then `+ react-native-nitro-ui@0.1.1 (staged with id …)`.
6. **Failure shapes in run 2:**
   - `E401 Unable to authenticate` or `ENEEDAUTH` → the OIDC exchange failed (publisher fields, Allowed actions). Re-run with `--loglevel verbose` (N-4) to see npm's reason.
   - A sigstore or provenance error → add `--provenance=false`. Merely dropping the flag is not enough, because `oidc()` auto-enables it.
7. **Do not push to `main` between staging and approval** if you can avoid it (N-3). If a run does go red with a duplicate-version message, capture the text for the N-3 fix.
8. **After approval:**
   - `npm view react-native-nitro-ui version` → `0.1.1`;
   - on npmjs.com, check that the trusted publisher no longer reports "pending validation". That is the 2026-10-28 deadline. If it still does by 10-27, escalate to npm or the owner.
9. **`Release tag` (Run workflow):**
   - expect `created v0.1.1 at <sha>`, where `<sha>` is the Version Packages commit (N-2);
   - a second run → `v0.1.1 already has a release`.

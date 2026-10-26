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

## Fix round 1

Round 1 of D19. The verdict was FIX ROUND: the shape was right, but M1 and M3 each
stopped 0.1.1 from ever appearing, M2 tagged it with the wrong name, and the owner
checklist was missing the box that decides the whole design. Then the owner made
that decision: **the trusted publisher will not allow `npm publish`** — staged
publishing only — so the pipeline was rebuilt around staging (D28).

| Finding | What was wrong | What runs now |
| ------- | -------------- | ------------- |
| M1 | The changelog guard asserted `0.1.0` was the first and only heading, so the first Version Packages merge failed the gate that stages it | `scripts/__tests__/changesets.test.js` asserts `0.1.0` **last**, every heading above it a version, newest first, and the suite includes the shape that merge writes |
| M2 | Changesets tags `react-native-nitro-ui@0.1.1`, not `v0.1.1` | `push-git-tags: false`, `create-github-releases: false`; `.github/workflows/release-tag.yml` + `scripts/release-catch-up.mjs` make `vX.Y.Z` and the release once the version is live |
| M3 | `npm publish` would be rejected by a stage-only publisher | the `stage` job runs `npm stage publish` on the packed tarball over OIDC; the owner approves on npmjs.com; the checklist says leave `npm publish` unticked |
| S1 | One job held `id-token: write` while jest, bob and nitrogen ran | three jobs, `permissions: {}` at the top: `pack` (`contents: read`) checks and packs, `stage` (`id-token: write` only) stages, `version` (`contents`+`pull-requests: write`) opens the PR |
| S2 | `main` unprotected, and a direct version bump publishes | not fixable from a workflow: branch protection is now an optional owner step, with the bypass note for the accounts that push to `main` directly |
| S3 | A re-run could not recover a tag or release that failed | the catch-up is keyed on state (registry + release exists), so the hourly run, a manual run and a re-run all do what is still missing |
| S4 | The `0.0.0-stage` paragraph was wrong | CONTRIBUTING says it is npm's placeholder for a package _name_ that did not exist yet, and what a staged version really looks like |
| S5 | The concurrency comment promised more than `cancel-in-progress: false` does | the comment says GitHub still replaces a pending run, and the jobs key on `package.json` vs. the registry so a dropped run loses nothing |
| N1 | The status workflow claimed it ran none of the PR's code | comment corrected: it does, and the reason that is safe is the read-only token and absent secrets on fork runs; `origin` is the base repo |
| N2 | The checklist asked to enable a workflow that enables itself | CONTRIBUTING's intro and checklist step 4 now say a new workflow file is enabled by the merge that adds it |
| N3 | The Version Packages PR having no checks was unexplained | documented, with the GitHub App token caveat for required status checks |
| N4 | The docs said entries link commits | documented: `changelog-git` writes a plain short sha, autolinked in a release body only |
| N5 | The changelog-github reason (needs a PAT) was wrong | corrected in CONTRIBUTING and in the test comment: the action exports a token in CI; a laptop is the problem |
| N6 | The changelog header promised Keep a Changelog | reworded to what the file is: newest first, 0.1.0 by hand, everything above it written by Changesets |
| N7 | Only `release.yml` was checked for unpinned actions | all four: `release.yml`, `release-tag.yml`, `changeset-status.yml`, `.github/actions/setup/action.yml`, plus a per-action check that each pin names its release |
| N8 | `release:version` ran `bun install --no-frozen-lockfile` for no change | the script is now `changeset version`; `release:publish` is gone with `M3` |
| N9 | No `timeout-minutes`, no `package-manager-cache: false`, `Report` skipped on failure | all three in `release.yml` |
| N10 | The owner checklist lived in a task report | it is in CONTRIBUTING's "Owner setup, once", corrected for stage-only |
| N11 | Every push to `main` runs the gate | documented as the cost of staging only what was checked |

The review's npm claims were checked against npm 11.19.1 itself rather than taken on
trust: `npm stage` exists with `publish|list|view|approve|reject|download`,
`npm stage publish` takes a tarball path and `--dry-run`, and it needs no 2FA —
which is why CI can stage and only the approval is human. One of the brief's steps
had to bend: **`npm stage list` is not available to a trust token** ("shortlived
tokens issued through trust relationships can only be used with `npm stage publish`
and `npm publish`"), so the staging job's staged-check is best effort and npm's own
semver-uniqueness rejection is what makes a re-run idempotent. The workflow says so
where it does it, and CONTRIBUTING says so where it explains recovery.

## What changed, commit by commit

- `9d7c222` — `release.yml` rewritten as `pack` → `stage` + `version`;
  `release:publish` deleted; `release:version` is now bare `changeset version`;
  the `Changeset status` comment tells the truth about running PR code.
- `778fdcd` — `scripts/release-catch-up.mjs` and `.github/workflows/release-tag.yml`.
- `1ed20de` — the changelog guard fixed (M1), the split asserted, the catch-up
  covered by 12 mocked cases; the catch-up script takes its entry path from `argv`
  so Jest can import it.
- `6cf483f` — CONTRIBUTING's Releasing section and the changelog header.
- final commit — the `0.1.1` changeset, and `.changeset/README.md` corrected for
  N4 and for what merging the Version Packages PR now does.

Everything the round-0 report claimed about **`npm publish`, `vX.Y.Z` tags cut at
publish time, `release:publish`, and the changelog guard** is superseded by this
section. What still holds: the SHA pins (plus `upload-artifact@cf430e0` v7.0.2 and
`download-artifact@37930b1` v7.0.0, both peeled from their tags), `"."` in
`workspaces` being load-bearing, ubuntu being enough, and the tarball being 465
files / 439 kB with `CHANGELOG.md` inside.

## Proofs

- **`actionlint`** clean on `release.yml`, `release-tag.yml` and
  `changeset-status.yml`. `ci.yml` is untouched (X1 owns it).
- **M1, red then green.** Scratch branch, one patch changeset, `bun run
  release:version` → `package.json` 0.1.1 and `CHANGELOG.md` headings
  `["0.1.1", "0.1.0 — 2026-10-26"]`. Against that tree the old assertions fail:
  `first heading starts with 0.1.0 → FAIL -> 0.1.1` and `exactly one heading →
  FAIL -> 2 headings`. The new suite passes on it: 17 suites, 260 tests, and
  `bun run check` **exit 0** — typecheck through `readme:check`, `test:native:
  PASS`, `nitrogen-check: no drift`, `publint` "All good!", manifest 465, README
  8 blocks, tree clean afterwards. The same run on the branch head is also exit 0.
- **Staging is a real npm command.** `npm pack` on the 0.1.1 tree →
  `react-native-nitro-ui-0.1.1.tgz`, 465 files, 439.1 kB, sha256
  `c37cc8de2348514b6b72e8b91d50bcf76318900a5f6e70c20fec8e95759600ef`. Then, on
  Node 24 / npm 11.19.1, the exact argv the job uses:

  ```
  npm stage publish <tarball> --access public --tag latest --dry-run
  → npm notice Staging to https://registry.npmjs.org/ with tag latest and public access (dry-run)
  → + react-native-nitro-ui@0.1.1 (staged)
  → npm notice stage package react-native-nitro-ui@0.1.1 has been staged with tag latest
  exit=0
  ```

  `--provenance` on the same command is accepted too (exit 0). The 0.1.0 tarball
  instead ends with `npm error You cannot publish over the previously published
  versions: 0.1.0.` — which is the branch the job treats as success, and the
  reason a re-run cannot double-stage.
- **The catch-up is idempotent with npm and GitHub mocked** —
  `scripts/__tests__/release-catch-up.test.js`, 12 cases: not live ⇒ no `gh` call
  at all; live + release exists ⇒ no create; live + missing ⇒ creates `v0.1.1` at
  the commit that set the version (a newer 0.1.2 commit is passed over) with
  `--notes` from that version's changelog section; **running the job three times
  creates exactly one release**; dry run creates nothing; no matching commit and
  no `GITHUB_REPOSITORY` both refuse loudly; a failing `gh` surfaces as an error.
- **Nothing reaches a shell by interpolation.** The suite walks every `run:` block
  in the four CI files and asserts no `${{` appears in any of them; every dynamic
  value arrives through `env:`. Action pins are checked in all four files.
- **Package surface unchanged** by the redesign: 465 files, `release:publish` gone,
  and `bun run check` green.

## What cannot be proven without a real run

A dry run never authenticates, so these are open until the first real staging:

1. **Whether a staged publish satisfies npm's own deadline.** npm wants one publish
   through the new trust configuration before 2026-10-28. `npm stage publish` is
   issued over the same OIDC exchange, and npm's docs treat staging as the
   publisher's normal mode — but nothing local proves the registry counts a staged
   publish as that validating publish. **Ask npm, or stage early and check that the
   publisher stops reporting "pending validation".** If npm insists on a real
   `npm publish` inside the window, that is the owner's call to make, not
   something this pipeline can do.
2. **Whether the OIDC exchange accepts this job at all** — it matches on
   `ownerWorkflow`/`repositoryWorkflow`/`workflowName` (`release.yml`), and a
   mismatch, an environment on the job, or "Allowed actions" left without staged
   all look like an auth error. Staging a tarball (`npm stage publish <path>`) is
   documented and accepted by `--dry-run`, but the trust check happens on the POST.
3. **Provenance under staging.** The flag parses; whether npm mints a build
   attestation for a staged package, or rejects the combination, only shows on a
   real call. If it errors, dropping `--provenance` from the one line is the fix.
4. **What an anonymous `npm stage list` reports from a CI runner.** Expected: an
   empty list, since trust tokens may not run it. The job treats it as best effort
   and relies on npm's duplicate-version rejection, so a wrong answer here cannot
   double-stage anything.
5. **Whether `npm view` hides a staged-but-unapproved version.** Expected: yes, it
   404s until approval, which is what makes the stage job re-runnable. If npm ever
   listed staged versions, the job would skip — safe, just needs the comment fixed.
6. **`gh release create --target <sha>` creating the tag itself** (rather than
   needing the tag first), and `changesets/action` opening a PR under this repo's
   settings. Both are ordinary API behaviour, unverified here because nothing was
   pushed.
7. **How long a staged version survives unapproved.** Unknown; approve the same day.

## First run, step by step, and what to read in the logs

The branch's last commit adds the `0.1.1` changeset, so the merge itself is step 1.

1. Owner confirms the publisher: GitHub Actions, owner `dannyhw`, repository
   `react-native-nitro-ui`, workflow `release.yml`, no environment, **Allowed
   actions: staged only — `npm publish` not ticked** — and "Require 2FA and
   disallow tokens". Confirm the pending-validation wording (item 1 above).
2. GitHub → Settings → Actions → General → **Allow GitHub Actions to create and
   approve pull requests**.
3. Merge this branch to `main`. The first `Release` run is in **version** mode:
   in `Check and pack`, look for `bun run check` passing, then
   `Packed **react-native-nitro-ui@0.1.0** …` and the sha256 line. In `Stage on
   npm`, expect `**react-native-nitro-ui@0.1.0** is already on the registry —
   nothing to stage.` (proof that the live check works). In `Version Packages
   pull request`, expect a `pr-number`. If that job says nothing was created, the
   PR-creation setting is off.
4. Review and merge the Version Packages PR (0.1.0 → 0.1.1, one changelog entry,
   changeset deleted). It arrives with no checks — normal for a `GITHUB_TOKEN` PR.
5. The next `Release` run stages 0.1.1. Watch `Stage on npm`: the `sha256sum
   --check` step, then the `npm stage publish` output ending in `has been staged`.
   Failure shapes: `E401`/`ENEEDAUTH`/"not allowed"/"trusted publisher" → the
   publisher config (workflow name, environment, Allowed actions); `provenance` →
   drop the flag; a sha256 mismatch → the artifact, which should be impossible.
   A re-run that prints `already known to the registry` is the idempotent branch,
   not a failure.
6. Owner approves: `npm stage list react-native-nitro-ui`, then
   `npm stage approve <id>` (or the **Staged Packages** tab), then
   `npm view react-native-nitro-ui version` → `0.1.1`.
7. Run `Release tag` from **Run workflow** (or wait ≤ 1 h). Its log should end
   `created v0.1.1 at <sha>`. `... is not on the registry yet` means the approval
   has not landed; `refusing to guess a target` means the checkout did not carry
   the bump's history — then create it by hand with `gh release create`.
8. Re-run `Release tag` once to see the no-op (`v0.1.1 already has a release`) —
   that is the guarantee the hourly schedule rests on.

## Owner setup checklist (final, staged-only)

1. npmjs.com → `react-native-nitro-ui` → Settings → **Trusted publisher** → GitHub
   Actions: owner `dannyhw`, repository `react-native-nitro-ui`, workflow
   `release.yml`, **no environment**. Under **Allowed actions**, leave staged
   publishing only — **do not tick `npm publish`**. The pipeline is designed so
   that no run can put a version live.
2. Same page: **Require 2FA and disallow tokens**.
3. GitHub → Settings → Actions → General → tick **Allow GitHub Actions to create
   and approve pull requests**.
4. After merging, `gh workflow list`: `Changeset status` is enabled by the merge
   that adds it (no action needed); enable `Release` and `Release tag` if either
   shows inactive — `Release tag` needs to be enabled for the hourly schedule.
5. Optional: branch protection on `main`. Not needed for release safety here,
   since only Version Packages commits touch `package.json`; a rule that requires
   pull requests also needs a bypass for the accounts that push to `main`
   directly, or those pushes start failing.
6. Each release: approve the staged version (Staged Packages, or
   `npm stage approve <id>`), then let or run `Release tag`.

Nothing in this round was pushed, tagged, published, or approved: no `git push`,
no tags, `npm publish`/`npm stage publish` with `--dry-run` only, and no GitHub or
npm setting was touched.

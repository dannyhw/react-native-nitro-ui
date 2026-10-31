# F4 — CI green on every trigger

**Branch:** `task/F4-ci-green` (from `main` at `35d687a`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `F4-on9yl` (pair-a: `nitro-ui A` / `emulator-5574` / Metro `8295`)

## Summary

**The Android harness failure was not what row 55 guessed.** Reading the job log for run
40382254368: `Load React Native Harness Configuration` printed
`Failed to load configuration file … bun run harness:ios: no app to test`, wrote no `config`
output, and the next step then failed at the action's own `action.yml:308`
(`Error reading JToken from JsonReader`). Cause: the action **imports `example/rn-harness.config.mjs`
to read it**, from a step that runs `harness ci load-config` — a command line with no runner in
it, so the config guessed iOS and refused over an `.app` an Android job never builds. The empty
JSON was the consequence; the relative `app:` was a second, independent bug (what A2 lost three
runs to as an opaque `AbortError`). `Harness (iOS)` in that run was `cancelled`, never proven
green.

The decision moved into `selectHarnessApp` (`scripts/app-stamp-core.mjs`), so it is testable with
a fake command line and filesystem: runner from argv, then `HARNESS_RUNNER` / `INPUT_RUNNER`
(both set by the pinned action's steps), then `ios`; a `harness ci <known-subcommand>` read is not
a device run and gates nothing (the list is compared against the installed CLI, so the excuse
cannot widen); an explicit `HARNESS_APP_PATH` becomes absolute against `example/`, falling back to
the repo root. Verified locally by importing the config with each CI step's real argv and env.

Also: `cancel-in-progress` is now `${{ github.ref != 'refs/heads/main' }}` (every push to `main`
reaches a conclusion, PR runs still cancel); `pack` installs with no cache through a new
`package-manager-cache` input that gates both cache steps; the catch-up cron moved to minute 17;
`--clean`'s help names both things it deletes; and the iOS < 26 question is answered with the
manifests: **no label CI can schedule on ships a runtime below iOS 26**, so no new CI row —
`docs/ci-runner-images.md` records what would change that.

Six items the brief listed were already closed on `main`, and are not re-fixed: the
`19HybridNitroUiSwitch` table (`7c1dfbb`), the lease TTL assertion (`9366f25`), the
platform-correct `harness:*` label (`156df11`), `--clean` dropping the pod-inputs record
(`8a7401c`), `release-catch-up`'s wrong commit (`ea621e7`) and the dual npm wordings — each now
has a guard where it previously had only a fix, which is the part F4 actually adds.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1533 tests / 57 suites | `24426ca64a8a` | 2 m 39 s | start 2.9 / med 5.0 / max 5.8 |
| `harness:ios` | **PASS** | 227 tests / 16 suites | `24426ca64a8a` (ios tree) | 5 m 57 s | start 1.7 / med 3.2 / max 4.7 |
| `harness:android` | **PASS** | 278 tests / 16 suites | `24426ca64a8a` (android tree) | 8 m 25 s | start 10.4 / med 4.3 / max 10.4 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

`need --for review`: `need: review is satisfied on this code tree.` (both harness gates are owed
and run because `example/rn-harness.config.mjs` and `scripts/app-stamp-core.mjs` changed;
`real-input:*` is merge-stage only.) Ledger: `docs/tasks/F4/gates.jsonl`.

Two failures on the way, both evidence rather than noise: the first `check` was red because
prettier had rewritten the `--clean` help literal with double quotes and my new guard matched only
single quotes (fixed, rows 19–20 re-run against the formatted source); the first
`harness:android` died because the APK had been built for `x86_64`, CI's ABI, while this machine's
emulator is `arm64-v8a` — the stamp gate and `INSTALL_FAILED_NO_MATCHING_ABIS` between them said
exactly what to rebuild. `harness:ios` then refused a stale `.app` after I amended a commit, which
is the gate working.

## Red proofs

20 mutations, recorded as data in `docs/tasks/F4/mutations.json` with an audit probe confirming
every `before` occurs verbatim at HEAD (20 rows, 0 drifted). One line each:

- `does not cancel an in-progress run of main` -> `cancel-in-progress: true` -> `expect(cancelsFor(value,'refs/heads/main')).toBe(false)` received `true`
- `still cancels a superseded run on a pull request or feature branch` -> `cancel-in-progress: false` -> same helper, `refs/pull/9/merge` received `false`
- `passes an absolute app: path…` -> `app: android/app/build/…apk` -> `expect(app).toMatch(/^\$\{\{ github\.workspace \}\}\//)`
- `every job that runs check … fetches the full history` -> `fetch-depth: 1` -> `problems` received `["ci.yml job "checks" runs bun run check"]`
- `the catch-up cron does not start on the hour` -> `cron: '0 * * * *'` -> `Expected ArrayContaining [StringNotMatching /^0$/], received ["0"]`
- `packs the publish artifact without a restored node_modules` -> `package-manager-cache: true` -> `expect(…['package-manager-cache']).toBe(false)`
- `the composite can install without caching…` -> drop `if:` from `cache/restore` -> `ungated` received `["Restore dependencies"]`
- `a staged-but-not-approved version is recognised from both npm wordings` -> guard reduced to one wording, both directions -> the missing `Expected substring`
- `CONTRIBUTING documents the escape hatch…` -> hatch renamed to prose -> `Expected substring: "NITRO_UI_ALLOW_UNSTAMPED"`
- `the no-app refusal does not advertise a path…` -> old two-line message restored -> matched `point HARNESS_APP_PATH at an app built another way`
- `the claim about an older iOS runtime cites a runner manifest…` -> doc claims iOS 18 works -> `neither image this repo uses can run an ios 18 simulator` missing
- `asks gh for the bump commit…` + `does not name the dependency bump…` -> `findVersionCommit` reverted to first-match -> 3 failed of 31 across both suites, `--target` = the dependency bump
- `reads INPUT_RUNNER / HARNESS_RUNNER when argv does not name a runner` -> `runnerFromEnv` dropped (the pre-F4 code) -> 2 failed, `runner: "ios"`
- `harness ci <subcommand> gates nothing` (×4) -> `ciStep = false` -> 6 failed, the cache steps gate a stamp
- `understands a path written from the repository root…` -> `parentDir` lookup removed -> 1 failed
- `resolves a path relative to the project root…` (+3) -> explicit path passed through verbatim -> 4 failed
- `keeps an absolute path exactly as given` (+2) -> `joinPath` forgets absolutes -> received `/repo/example//repo/example/android/…`
- `names what --clean deletes…` -> help back to the one-liner -> `Expected pattern: /DerivedData/`
- `names what --clean deletes…` -> a third target (`Pods/`) added silently -> received `["/repo/example/ios/Pods"]`

**A false green my own test had, found and fixed:** `staged-but-not-approved` stayed green with
the guard reduced to one wording, because the comment *above* that line quotes the E409 text. The
case now reads the `grep -qiE '…'` itself and ignores shell comments, and both directions go red
(rows 8–9).

## Files changed

- `scripts/app-stamp-core.mjs` — `selectHarnessApp`, `runnerFromEnv`, `resolveAppPath`,
  `HARNESS_CI_SUBCOMMANDS`.
- `example/rn-harness.config.mjs` — consumes it; `ciStep` branch prints what it skipped; reworded
  no-app refusal (X1 F3).
- `.github/workflows/ci.yml` — concurrency, absolute `app:` ×2, the iOS-floor comment.
- `.github/workflows/release.yml`, `release-tag.yml`, `.github/actions/setup/action.yml` — pack
  cache-off, cron minute 17, the `package-manager-cache` input.
- `scripts/build-app.mjs` — `--clean` help.
- `scripts/__tests__/ci-workflows.test.js` (19), `ci-harness-config.test.js` (19),
  `build-speed.test.js` (+1) — new guards; `js-yaml` added as a devDependency for the first.
- `docs/ci-runner-images.md`, `CONTRIBUTING.md`, `docs/tasks/FOLLOWUPS.md` — the iOS floor, the
  unstamp hatch, main-concurrency, the follow-up line.

## CI to dispatch

Nothing here can be pushed by me, so this is what to start on `task/F4-ci-green` and what each
should show.

1. **Pull request → `ci.yml`** (push + PR to `main`): `Checks`, `Native tests (host, ASan)`,
   `Build Android (debug)` green, and the three dispatch-only jobs **skipped** — `if: github.event_name == 'workflow_dispatch'` is untouched. This is the row that proves the new concurrency
   expression is valid YAML/Actions syntax: GitHub rejects the whole workflow otherwise, so a
   run that *starts at all* is the first proof.
2. **`ci.yml`, workflow_dispatch on `task/F4-ci-green`** — the one that matters. Expected:
   `Harness (Android)` **green**, where run 40382254368 failed at `action.yml:308`; `Load React
   Native Harness Configuration` should print `app.stamp: not checked - this step reads the
   config to plan a cache, it is not a device run.` instead of `Failed to load configuration
   file`; `Run E2E tests` should print `app is fresh: …/app-debug.apk (tree <current>, 9
   components registered)`. `Harness (iOS)` should be **green on first try** — it has never been
   proven (that run cancelled it), so treat a red here as new information, not a regression.
   `Build Android (release)` and both Metro snapshot/restore steps should stay quiet no-ops.
3. **`release.yml`, workflow_dispatch on the branch**: `pack` green and its `Setup` step shows
   `Restore dependencies` **skipped** plus a real `bun install` (that is item 2 of row 53 in the
   log); `Stage on npm` skipped (`if: github.ref == 'refs/heads/main'` — dispatching from a
   branch must not stage); `Version Packages pull request` green with "No pending changesets"
   (`.changeset/` is empty), so it opens nothing.
4. **`release-tag.yml`, workflow_dispatch on the branch**: `Tag and release a live version`
   green as a no-op — `package.json` says `0.4.1`, npm's registry has `0.4.0` as `latest`, so the
   script should report the version is not live and create nothing. Dispatch it again after the
   next staged version is approved, which is the run that actually exercises the `--target` fix.
5. **`release-tag.yml`, scheduled**: its next cron tick is `17 * * * *` — a run at :17 past the
   hour rather than :00 is the whole proof for row 53's cron item.

## Follow-ups

- iOS 18 runtime: the only hosted series with one is `macos-15` (18.5/18.6) and no workflow here
  uses that label; recorded in `docs/ci-runner-images.md` + `FOLLOWUPS.md`.
- `smoke.yml`'s skipped RN 0.86 **iOS** row is testable on `macos-26` (iOS 26.2/26.4/26.5) — a
  cheaper win than the iOS-18 question, and F5/smoke's, not F4's.
- `js-yaml@5.5.0` is now a devDependency purely to parse workflows in tests; if a future lint rule
  ever forbids a YAML parser outside the lockfile-critical path, `yaml` is the interchangeable one.
- `ci.yml`'s `harness-ios` still runs on GitHub's preview `xcode-27` label; a pulled preview image
  would read as a hung job. Unchanged by this task, and deliberately out of scope.

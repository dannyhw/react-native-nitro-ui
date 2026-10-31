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
should show. (Round 0's list, kept because the expectations still hold; fix round 1's results and
the remaining re-dispatch list are in the two sections at the end.)

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

## Fix round 1

Five findings, one root cause: round 1's guards matched YAML text instead of evaluating what
Actions does. `package-manager-cache: false` reaches a composite action as the string `'false'`,
which is truthy, so `pack` restored and saved a cache it had asked not to — the input was inert,
and `type: boolean` is not a key composite inputs support. Both cache steps now compare
`!= 'false'`, and the guard evaluates them. Second: `cancel-in-progress: false` is one rule of
two; GitHub keeps one running plus one pending run per group and drops the pending one
regardless, so `main` gets a group per commit while other refs keep the branch group. The guards
now share one Actions-expression evaluator that throws on unknown syntax; 13 new mutations,
including the 3 that killed my first versions of them (2 were false greens). Item 5 was not a
ledger gap but a run launched without lease env, re-run clean under `F4-ral3b`. Runner docs now
quote the arm64 manifests; the iOS 18/Xcode 26 claim is gone. CI dispatch at `183b04e` is in its
own section below: `release.yml` green, `ci.yml` running both harness jobs, 8 iOS failures and an
Android emulator stall recorded as follow-ups, not fixed here.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1538 tests / 57 suites | `115bf375d0e8` | 2 m 35 s | start 1.7 / med 2.9 / max 3.8 |
| `harness:ios` | **PASS** | 227 tests / 16 suites | `115bf375d0e8` (ios tree) | 3 m 50 s | start 2.4 / med 2.4 / max 3.5 |
| `harness:android` | **PASS** | 278 tests / 16 suites | `115bf375d0e8` (android tree) | 8 m 09 s | start 3.5 / med 2.8 / max 8.0 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

`need --for review`: `need: review is satisfied on this code tree.` The three rows above are
lease `F4-ral3b` runs on tree `115bf375d0e8`; the round-0 rows at `24426ca64a8a` are stale for
this tree and are no longer the evidence.

Commits: `615d937` (`js-yaml: ^4`), `9475edc` (runner-image docs), `2e76dc0` (both workflow fixes
+ the evaluator), `9995b8f` (the mutation rows).

#### Fix round 1 red proofs (appendix)

13 mutations, same protocol, `before` read from the files as they ship at `2e76dc0` (audit probe:
33 rows, 0 drifted). One line each:

- `packs…` + `the composite can install without caching…` -> both `if:` back to
  `inputs.package-manager-cache` truthiness -> 2 failed
- same two -> only the **save** step reverted -> 2 failed (the half-mutant matters: an
  `if:` that is right on restore and wrong on save still writes a cache)
- `the composite can install without caching…` -> `type: boolean` added back -> `Received: "boolean"`
- same test -> `default: true` (YAML boolean) -> `Expected: "true" Received: true`
- `gives every push to main its own concurrency group` + `loses no commit…` -> group back to
  `${{ github.workflow }}-${{ github.ref }}` -> `Expected: not "ci.yml-refs/heads/main"` and the
  queue model reports `["bbb2222"]` lost
- `gives every push to main its own concurrency group` -> `github.run_id` instead of `github.sha`
  -> same `Expected: not` (per attempt is not per commit)
- `still puts every push to one pull request in the same group` -> condition inverted -> the two
  PR pushes land in different groups
- `CONTRIBUTING states both rules…` -> paragraph back to flag-only + "never cancelled" -> the
  group expression is missing from the paragraph it documents
- same test -> group documented but the sentence still says "never cancelled by the next one" ->
  `Expected pattern: not /never cancelled by the next one/`
- `the claim about an older iOS runtime…` -> the "Apple does not offer an iOS 18 runtime for
  Xcode 26" sentence returns -> `Expected pattern: not /apple does not offer…/`
- same test -> the Intel manifest's image id quoted for the arm64 label -> `20261026.0455.2` missing
- same test -> arm64 manifest filenames dropped from the citation -> `macos-26-arm64-Readme.md` missing
- same test -> the unproven paragraph loses its boot/Xcode clause -> `Expected pattern: /boot/i`
  against the paragraph, not the file

**Two false greens my own round-1 guards had, found and fixed:** the first versions of the last
two rows stayed green — one whole-file regex was satisfied by `boot`/`macOS 15` in *other*
paragraphs while the caveat itself was deleted, and the Apple-sentence regex could not match a
wrapped line. They now assert on the whitespace-collapsed `Unproven` paragraph and on
whitespace-collapsed text, and both mutants go red.

## CI dispatch results

Both dispatched at `183b04e` (round 1's tree, before these fixes), on
`dannyhw/react-native-nitro-ui`.

**`release.yml` — run 41230850854, green.** `Check and pack` and `Version Packages pull request`
success, `Stage on npm` **skipped** as designed. Its `Setup` step is the real-world proof for
item 1: the caller passed `package-manager-cache: false` and the runner still ran `Restore
dependencies` and `Cache dependencies` (job log lines 209 and 267 — the restore prints `Cache not
found for input keys: Linux-bun-b4dbf2a5861a…`, i.e. a genuine miss, then `Run bun install`, then
a `save` of the key it was told not to write). Round 1's text-only guard read that `if:` as
correct. Fixed at `2e76dc0`; the next dispatch should show both steps skipped.

**`ci.yml` — run 41230848294.** `Checks`, `Native tests (host, ASan)`, `Build Android (debug)`
and `Build Android (release)` all green. Both dispatch-only harness jobs **ran**, which is the
proof F4 was written for: the action's `Load React Native Harness Configuration` step now prints
`app.stamp: not checked - this step reads the config to plan a cache, it is not a device run.`
instead of failing with the `action.yml:308` config error, and `Run E2E tests` prints `app is
fresh: … (tree a221cc9f62ad, 9 components registered)` on both platforms. So the config/runner
fix and the absolute `app:` paths work on a hosted runner, and what is left in those two jobs is
new information rather than the bug this task fixed.

`Harness (iOS)`: 217 passed, 8 failed, 2 skipped, image `xcode-27-arm64` `20261026.0314.1` — 3
cores with load1 29 at start and 152–380 mid-run, Xcode 27.1 (`iphonesimulator27.1`), an iOS 27
runtime where every local gate has been iOS 27.0 on 10 quiet cores. Per failure, with my best
classification (all eight are follow-ups for the separate task, none fixed here):

- `conformance · DatePicker · has its own declared fallback` — declared `103x36.33`, measured
  `107x36.33`: **real cross-runtime finding, not flake.** The failure is exactly 4 pt in width
  only; a declared-fallback table that is right at one OS version and wrong at another is the
  class of bug the assertion exists to catch, so it should be triaged as a possible bug rather
  than excused by load.
- `conformance · DatePicker · shows none of its previous owner` — recycle-reset: an uncontrolled
  second owner reads `1799971200000` where props say `1740787200000`, and a presentation left
  open reads `1`: **possibly real.** Recycle state is not timing-sensitive in a way load explains,
  but the `DatePicker` handle problems below mean the control could not have published its own
  state — classify after those.
- `conformance · DatePicker · is named on its own box` — `no hybridRef handle for
  "conformance-date-picker"`: **environment, most likely.** A missing handle is a mount that never
  completed; the same suite's `DatePicker` `recycle-reset` then read stale state from the previous
  fixture, which is what a dropped mount produces. Needs a rerun at low load to confirm.
- `conformance · Menu · leaves the engine where it started` — 1 sizing-ledger entry survived 50
  drops: **real, and cheap to check.** The counter is explicit `forget()` pairing; load cannot
  leave an entry behind, though a dropped mount (see above) can. Same triage as the handle case.
- `DatePicker · G5 · round-trips an instant across a DST boundary` — `expected +0 not to be +0`:
  **environment, certainly.** The runner's local time zone observes no DST (a UTC runner), and the
  test's own comment says the assertion is there because "the device is not observing DST, so
  nothing here crosses a boundary". This is the test refusing an unsuitable environment; the
  follow-up is to set a DST zone (or skip with a printed reason) rather than to fail.
- `Switch · core runtime · keeps the control inside its default box` — `content` is `null`:
  **environment, probably.** It is a view-hierarchy query that found no content node inside a
  found box, which is what a partly-rendered host looks like; needs a low-load rerun.
- `Sizing · T14 · has a declared height ready for the first Slider this process measures` and
  `still corrects a Slider whose declared height is wrong` — `Cannot read property 'nuiSizingId'
  of undefined`, after the file itself printed `t14 NOT COLD process (on entry):
  measurements=1090`: **environment, and self-diagnosed.** Both T14 cases require a fresh process
  and got a warm one, so the handle they need was never theirs; a runner that restarts the app per
  file differently (or reuses one) makes them fail by design. The follow-up is either an
  explicit skip when the process is not cold or a per-file restart on hosted runners.

`Harness (Android)`: **failed at emulator startup, suites ran 0 of 16.** Sequence from the job
log: KVM was present and world-writable (`crw-rw-rw- 1 root kvm 10, 232 … /dev/kvm`), the AVD
cache missed on a first run (`avd-nitroui-x86_64-bdac12b8…`), the harness installed
`emulator` + `system-images;android-35;default;x86_64`, printed `Creating Android emulator
nitroui...` at 18:49:56, and 14.5 minutes later the run died with `The platform did not become
ready within 900000ms` — the `platformReadyTimeout` this repo sets for CI. What makes this
diagnosable rather than mysterious is which boot that timeout covered: `HARNESS_AVD_CACHING` is
`true` and `~/.android/avd` was empty, so the CLI took its `clean-snapshot-generation` path —
create the AVD, then boot it with `-no-snapshot-load` and wait for `sys.boot_completed` before it
can save the snapshot. That is the single slowest legitimate Android emulator boot there is, on a
4-core runner whose own core budget caps the AVD at 4 vCPU (`getDeviceCoreBudget(4)` → 2) with
`swiftshader_indirect` GL, and 900 s is a cold-boot budget, not a cold-*snapshot-generation*
budget. The residual uncertainty is honest: `emulator -accel-check`'s verdict is only logged at
debug level, so the log cannot fully exclude KVM not being usable despite `/dev/kvm` being
perm-readable; no `Hardware acceleration … unavailable` warning appeared, which argues against
software emulation but is not proof. So the cause is clear enough to name, and the fix is a
one-line change to a timeout or an env flag — which is a device-behaviour question on a hosted
runner, not a CI-plumbing bug, and I have recorded it as a follow-up instead of guessing at a
number. For the next dispatch of that job, `HARNESS_DEBUG=1` plus one run whose AVD cache is
already warm (a second dispatch of the same commit) separates the two hypotheses without any code
change: if the warm run passes, the timeout is the fix; if it still stalls, the log names the
accelerator.

**The queue finding, confirmed in the wild.** Main's `concurrency` at `35d687a` was
`cancel-in-progress: true`, and the push history shows a run **cancelled with no conclusion**:
41223182509 (`dec41c2`, created 17:09:57, cancelled 17:10:51, superseded by 41223237759 for
`35d687a`). That commit has no CI result on `main`, exactly as item 2's model predicts. My own
branch's fix at `e2ef269` stopped that: after `16:01` there is no cancelled `main` push.

## Follow-ups

- Android on a hosted runner: the cold-snapshot-generation boot does not fit `platformReadyTimeout
  = 900_000` on `ubuntu-latest` (41230848294). Either raise the CI value for a first AVD, or seed
  `~/.android/avd` once so the cheap `snapshot-reuse` boot is the norm; re-dispatch the same commit
  with `HARNESS_DEBUG=1` to see the `-accel-check` verdict before choosing.
- iOS on `xcode-27` (8 failures above): the three `DatePicker`/`Menu` findings about a declared
  `103x36.33` fallback, a missing `hybridRef` handle and a leaked sizing-ledger entry need a
  low-load rerun before they can be called environment; the declared-vs-measured width is 4 pt on
  an iOS 27.1 runtime and may be a real cross-runtime mismatch.
- `DatePicker · G5` DST round-trip fails on a runner in a non-DST time zone by design: it should
  skip with a printed reason, or set a DST zone for that job.
- Sizing T14 requires a cold process and CI hands it a warm one (`measurements=1090` on entry): it
  needs an explicit skip, or a per-file app restart on hosted runners.
- iOS 18 runtime: the only hosted series with one is `macos-15` (18.5/18.6) and no workflow here
  uses that label; recorded in `docs/ci-runner-images.md` + `FOLLOWUPS.md`.
- `smoke.yml`'s skipped RN 0.86 **iOS** row is testable on `macos-26` (iOS 26.2/26.4/26.5) — a
  cheaper win than the iOS-18 question, and F5/smoke's, not F4's.
- `js-yaml` is a devDependency purely to parse workflows in tests, pinned `^4` at `615d937` so it
  matches the version `@eslint/eslintrc` and `@expo/xcpretty` already hoist; if a future lint rule
  ever forbids a YAML parser outside the lockfile-critical path, `yaml` is the interchangeable one.
- `ci.yml`'s `harness-ios` still runs on GitHub's preview `xcode-27` label; a pulled preview image
  would read as a hung job. Unchanged by this task, and deliberately out of scope. Run
  41230848294 got an `xcode-27-arm64` image and did schedule, so the worry is about the label being
  pulled one day, not about it never existing.

## What to re-dispatch after fix round 1

All four are on `task/F4-ci-green` at `9995b8f` or later. The results I have are from `183b04e`,
which is *before* the cache and concurrency fixes, so items 1 and 2 below are the new evidence.

1. **`ci.yml`, workflow_dispatch** — one dispatch proves the new `group:` expression parses (a
   syntax error rejects the whole file) and that both harness jobs still behave as in the results
   above. It cannot prove item 2 on its own: this branch is not `main`, so its runs still share one
   group and cancel each other, which is the intended half of the rule. **Item 2's real proof is
   two commits pushed to `main` a minute or two apart after merge** — both runs must exist and both
   must have a conclusion, where 41223182509 is the counter-example on today's `main`. Add
   `HARNESS_DEBUG=1` to `Harness (Android)` if you want the `-accel-check` verdict in the log.
2. **`release.yml`, workflow_dispatch** — `pack`'s `Setup` step should now show `Restore
   dependencies` and `Cache dependencies` **skipped**, where run 41230850854 ran both. That is
   item 1's fix observed rather than asserted.
3. **`release-tag.yml`, workflow_dispatch** — unchanged by this round; still a no-op at `0.4.1`
   (npm's `latest` is `0.4.0`), and still the run to repeat after the next approved bump.
4. **`release-tag.yml`, scheduled** — the next `17 * * * *` tick is the cron proof; nothing changed.

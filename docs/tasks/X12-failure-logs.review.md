# X12 review — failure logs that outlive the worktree

**Branch:** `task/X12-failure-logs` @ `6236833` (diff `main...HEAD`, 9 files) · **Reviewer:** code review,
read-only except this file.

**Verdict: FIX ROUND.** The store location is right: logs land under `<git-common-dir>/nitro-ui-gates/`,
survive `git worktree remove`, and are never in a tracked path. Excerpts are written only for failed
lines, passing lines are copied byte-for-byte, and the adb probes only ever take the env serial. But
moving the background records into one store that every worktree shares breaks `wait`/`status` when
two worktrees run gates at the same time, which is the normal case. `logs --branch` cannot find a
removed worktree's logs, the migration runs once per clone instead of once per worktree, and every
excerpt commits a home path by construction. Each M below was reproduced in a scratch clone under
`/tmp` (cleared `GIT_*`, `GIT_CONFIG_GLOBAL=/dev/null`, with a fake `bun`) or by running the function.
All mutations were reverted with `git checkout -- .`, and the worktree is clean.

## Must fix

**M1. `wait` and `status` follow other worktrees' background runs.** `scripts/gate.mjs:1037`
(`listBackgroundRecords` now walks the whole store) and `:959` (`commandWait` filters by gate name
only and takes the newest `startedAt`). Before X12 each worktree read only its own `.gates/logs/`.
Repro: start `check --background` in worktree C (passes after 8 s), then one second later in worktree B
(fails with exit 7 after 3 s). `gate.mjs wait --gate check` **in C** printed
`wait: check (pid 10288)` with the `task/b/...` log, `check failed with exit 7`, and **exited 7**,
while C's own ledger line says `pass`. `status` in C also listed both running checks as its own. With
several agents running `check --background` and then `wait` at the same time, a gate can be reported
red or green for the wrong code. Fix: filter records to this checkout (store `repoRoot` or the branch
in the record, or match the `<branch>/` prefix of `record.logPath`), and add a test with two worktrees
that run concurrently. The report's "`wait`/`status`/`table`/`need` behave as before from any
worktree" is false until then.

**M2. `logs --branch <b>` and `logs --branch <b> --failed` return nothing once the worktree is gone,
which is the Q3 case.** `scripts/gate.mjs:2078` `branchOfStoredLog` can only attribute a log to a
branch it knows. It learns branches from this checkout's ledgers (`:2053`) plus the store's
**top-level** directories (`:2060`), and for `task/a` the top-level directory is `task`. So
`task/a/check-….log` is attributed to `task`. Repro: run a failing check in worktree `task/a`, where
`logs --branch task/a` lists 2 files, then `git worktree remove`. From the main checkout,
`logs --branch task/a` now says `0 log file(s) for task/a` and only `--all` shows them. `--failed`
also reads only local ledgers (`:2033`), and a removed worktree's ledger is gone, so it returns 0
silently. `ORCHESTRATOR.md:106` tells the orchestrator to use exactly `--branch <b> --failed`. Fix:
attribute by the path prefix (`relative.startsWith(`${branch}/`)` for the requested branch). For
`--failed`, also read the committed `docs/tasks/*/gates.jsonl`, or say "no ledger for <b>, cannot
tell failed from passed" instead of printing 0. Add a removed-worktree test for `--branch`.

**M3. The legacy migration runs once per clone, not once per worktree.** `scripts/gate.mjs:312`: the
marker is `<store>/.migrated`, and the store is shared. The first worktree that has a legacy
`.gates/logs/` migrates and writes the marker, and every other worktree is skipped forever. Repro: two
worktrees A and B, each with a legacy log, each runs `check`. The store holds only
`.gates/logs/…-wtA.log`, and `.migrated` names only wtA. B's pre-X12 logs still die with B, which is
the loss X12 exists to prevent (the live worktrees `A4` and `X11` have legacy logs today). The report's
"the first run in a worktree copies its legacy directory" describes the intent, not the code. Fix: key
the marker per worktree (for example `.migrated-<hash of repoRoot>`, or a marker inside the worktree's
`.gates/logs/`), and test with two worktrees. Once it runs per worktree, two worktrees' same-named
legacy logs collide in `<store>/.gates/logs/` (the size-differs branch overwrites); see N4.

**M4. Every excerpt commits a home path and the lease-file path, in a public repo.**
`scripts/gate-core.mjs:1910` writes `Full log: … (<absolute store path>)`, and `gate.mjs:1914` passes
`found.file`, so on this machine it is `/Users/<user>/Workspace/oss/react-native-nitro-ui/.git/…`.
The device block writes `lease file: <home>/.nitro-ui/…` (`gate.mjs:703`), and jest/xcodebuild stack
traces in the tail carry absolute paths too. `ORCHESTRATOR.md` "Rules that are easy to break" says
(D25): "Never write home paths, emails, hostnames … into it". The report and AGENTS.md hand this to the
reader ("read an excerpt before you push"), but the header line produces a home path in **every**
excerpt by construction, and the test pins it there (`gate-logs.test.js:604`). Fix: in
`renderFailureExcerpt`, after scrubbing, replace `repoRoot` → `<repo>`, the store → `<store>`,
`os.homedir()` → `~`, `os.userInfo().username` and `os.hostname()` → `<user>`/`<host>`, across the
header, the context and the tail. Keep the store-relative `logPath`, change the test to assert the
placeholder, and add a test that the excerpt does not contain `os.homedir()`.

**M5. The scrubber leaves `Authorization:` credentials and `.npmrc` `_auth=` in place.**
`scripts/gate-core.mjs:1756-1770`: the assignment rule replaces only the first bare token after the
separator, which is the auth scheme. Run against `scrubSecrets`:
- `Authorization: Bearer abcdef0123456789secret` → `Authorization: [scrubbed] abcdef0123456789secret`
- `Authorization: Basic dXNlcjpwYXNzd29yZA==` → base64 creds kept
- `curl -H 'Authorization: token 0123…'` → kept
- `//registry.example.com/:_auth=dXNlcjpwYXNz` → unchanged, 0 replaced (`_auth` misses `CREDENTIAL_KEY`)

`:1783` says `<auth>…</auth>` is what `.npmrc` writes. It is not: `.npmrc` is INI (`_auth=`,
`_authToken=`, `_password=`), and AGENTS.md/the report repeat the claim. Fix: for
`authorization`/`proxy-authorization`/`cookie` keys, scrub to end of line or closing quote. Add
`_auth` (any `[_-]?auth` key) to `CREDENTIAL_KEY`. Add these four cases to the scrub test. The
`Cookie:` and JSON forms are already handled.

## Nits / should fix

**N1. Retention "applied on every run" is untested.** Removing both `pruneLogStore()` calls
(`runGate`, `startBackgroundGate`) left `gate-logs` + `gate` at 121/121 green. The retention CLI test
goes through `logs`, which prunes by itself.

**N2. The running-background-gate grace is untested.** `gate.mjs:424`: changing the extension to
`Math.max(grace, 0)` stayed green in the same run. This rule is what keeps a long `--background`
bench's `.gate.json` (mtime = start) from a size sweep. Add a CLI test that ages a running record past
2 h with a store over the cap. Separately, a *foreground* run that prints nothing for more than 2 h is
protected only by mtime, so it is sweepable under the size cap. That is low odds; one line in the
docs is enough.

**N3. The migration test's "old line resolves" check is vacuous.** `gate-logs.test.js:528`: the
fixture ledger has no line that names the legacy log (only a passing `check`), so
`export --out` resolves nothing and exits 0 regardless. Write a failed `.gates/logs/…` line, remove the
worktree copy, and assert the export finds the store copy. Also, `'pw-not-hunter'` (`:711`) is asserted
absent but was never in the input.

**N4. Migrated copies don't keep their mtime.** `copyFileSync` at `gate.mjs:357`: the migrated
file's mtime was the copy time in the repro. Old logs get a fresh 35-day clock, and the size cap sorts
them as new. Use `fs.utimesSync(target, from.atime, from.mtime)`. For the M3 fix, also avoid
cross-worktree name collisions under `<store>/.gates/logs/`.

**N5. `adb -s <serial> devices` doesn't do what the comment says.** `gate.mjs:577` and the docblock
at ~`:497`: `devices` is a host-side adb query and, as far as I know (not run here, no devices), it
ignores `-s` and lists every attached device. That includes `emulator-5560`, whose line would then be
committed in the excerpt. Nothing is sent *to* that device, so this is not a hygiene breach, but the
"asked of the leased serial" claim is false. Use `adb -s <serial> get-state`, or keep only the leased
serial's line.

**N6. Serial selection is looser than the comment.** `gate.mjs:564`:
`env.ANDROID_SERIAL ?? device`, where the comment says "both are checked so a hand-set environment
cannot smuggle a different one in". Nothing compares them, and nothing requires `NITRO_UI_LEASE_ID` or
a lease that holds the serial. A failed **iOS** gate run from a shell with a leftover
`ANDROID_SERIAL` probes that serial. Gate the adb/logcat probes on `platform === 'android'` and a live
lease, and note "no lease" otherwise.

**N7. A legacy root in `backgroundOptions` writes a different file.** `gate.mjs:2323` with
`:1211`: when `NITRO_UI_GATE_LOG` points into `.gates/logs/`, `logPath` is computed relative to that
root, but `runGate` joins it onto the store. The runner writes `<store>/<name>`, while the launcher's
record and the reader expect `.gates/logs/<name>`. This only happens with an old launcher and a new
runner. Either accept only the store, or keep the root.

**N8. Test env hygiene.** `runCli` inherits every `NITRO_UI_*` from the test runner
(`NITRO_UI_GATE_LOG_STORE`, `NITRO_UI_EXAMPLE_BUNDLE_ID`, `NITRO_UI_GATE_LOG` under a backgrounded
check). `GIT_*` clearing and the toplevel guard are correct. Delete `NITRO_UI_*`, `ANDROID_SERIAL` and
`IOS_SIM*` in `gitEnv`, so a dev shell under a lease cannot change the results.

**N9. Small accuracy items.**
- `ledgerLogCandidates` docs (`gate-core.mjs:1558`) say a log may sit in a leftover
  `.git/worktrees/<n>/` after removal. Nothing writes there and git deletes it, so drop the candidate
  or the claim.
- `failureExcerptName` drops the milliseconds, so two failed runs of one gate in the same second share
  one excerpt file.
- On an app crash, `pidof` is empty and no logcat is captured, which is the case where it matters
  most. This one is a follow-up line, not a fix: the brief says "for the app's pid".

## Checked and fine

- The store is under `--git-common-dir` and is never tracked. The fallback is the gitignored `.gates/logs`.
- Logs survive `git worktree remove`, and the test proves it.
- Old `.gates/logs/` paths resolve while their worktree exists.
- Excerpts are written only for `result: 'fail'`, and passing and corrupt lines are copied verbatim.
- A missing log yields a note and `failureLogPath: null`.
- The reserved serial is refused for both adb commands.
- No serial means no adb at all.
- Device probes run only for gates with a platform.
- `LEDGER_VERSION` 5 gates nothing.
- Every file and symbol named in the report exists.
- I spot-checked three of the report's red proofs (the excerpt's failure section, the missing-log
  pointer, logcat `-s`) against the tests, and they guard what they claim.

## Verdict: FIX ROUND

- M1 `wait`/`status` follow another worktree's background run (`gate.mjs:959,1037`); repro'd `wait` exiting 7 for a passing run.
- M2 `logs --branch <b>` (and `--failed`) find nothing after worktree removal (`gate.mjs:2078,2060,2033`); ORCHESTRATOR's advice fails.
- M3 Legacy migration marker is per clone, so only the first worktree's legacy logs are migrated (`gate.mjs:312`).
- M4 Every excerpt commits an absolute home path, plus the lease-file path (`gate-core.mjs:1910`, `gate.mjs:703`); D25.
- M5 Scrubber leaves `Authorization: Bearer|Basic|token <cred>` and `.npmrc _auth=`; `.npmrc` `<auth>` claim false (`gate-core.mjs:1756,1783`).
- N1 Retention-on-every-run untested (mutation green).
- N2 Running-background grace untested (mutation green); silent foreground run sweepable under the cap.
- N3 Migration test's "old line resolves" check is vacuous; `pw-not-hunter` dead assertion.
- N4 Migrated copies lose mtime; legacy name collisions once M3 is fixed.
- N5 `adb -s X devices` lists all devices; the comment's claim is false; use `get-state`/filter.
- N6 Serial not tied to the lease; iOS failures probe a leftover `ANDROID_SERIAL`.
- N7 `backgroundOptions` legacy root and the runner's store join disagree on the file.
- N8 Tests inherit `NITRO_UI_*`/`ANDROID_SERIAL` from the runner's env.
- N9 `.git/worktrees` candidate claim, excerpt name collision within one second, no logcat on crash (follow-up).

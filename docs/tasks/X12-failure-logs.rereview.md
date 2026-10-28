# X12 re-review — fix round 1

**Branch:** `task/X12-failure-logs` @ `336685c` (fix round = `b2e1011..336685c` after the review `60ebba9`)
· **Reviewer:** code re-review, read-only except this file (not committed).

**Verdict: MERGE WITH FIXES.** All five must-fixes are fixed as claimed, and so are most nits.
`wait`/`status` are scoped by worktree *and* branch. `logs --branch`/`--failed` work for a removed
worktree's **new** logs. The migration runs per worktree and keeps mtimes. Excerpts carry no home,
repo, store, scratch or lease path. `Authorization`/`Cookie`/`_auth=` are scrubbed whole. The adb
probes use the lease's serial and nothing else. Nothing left is a must-fix. But N9 is claimed fixed
and isn't, migrated legacy logs (A4/X11 have them today) are invisible to `logs --branch`, and the
scrubber is quadratic on long word runs. Each is a few lines to fix and should land with the merge.

How this was checked: `gate-logs`, `gate` and `gate-check` ran green under Node 24 (204/204). I
applied 11 mutations to `gate-logs` (and three of them also to `gate`/`gate-check`), each reverted
with `git checkout -- .`. Repros ran in scratch clones under `/tmp/x12-rr/` with cleared `GIT_*`,
`GIT_CONFIG_GLOBAL=/dev/null` and no `NITRO_UI_*`, and were deleted afterwards. `need --for review`
in the worktree is satisfied. No devices, builds or leases were used. The worktree is clean apart from
this file.

## Fix-round claims, checked

| Item | Status | Evidence |
| --- | --- | --- |
| M1 scoping | fixed | Dropping the `worktree` comparison (`gate-core.mjs:2494`) fails "does not adopt a sibling worktree's background run" (the fixture is two worktrees on **one** branch). Two branches are separated by `worktree` too. |
| M2 `--branch`/`--failed` after removal | fixed for new logs | Taking the branch from the first segment fails 4 tests. A scratch repro after `git worktree remove` lists the run as failed. See N1 for migrated logs. |
| M3 per-worktree migration | fixed | There is no marker gate any more, and the copy is branch-keyed. |
| M4 paths | fixed | Dropping `tmpDir` from the redactions fails the D25 test. The committed `failures/…--check--01.log` has only `<repo>`/`<tmp>`/`<store>` and no `/Users`, `/var/folders`, hostname or email. `gates.jsonl` is clean. |
| M5 scrubber | fixed | Removing `[_-]?auth` fails 2 tests. Adversarially: JSON `"Authorization":"Bearer …"`, `Basic`, `curl -H 'Authorization: token …'`, `Proxy-Authorization`, `Cookie`/`set-cookie`, `.npmrc` `_auth=`/`_authToken=`/`_password=`, `NPM_CONFIG__AUTH`, `NODE_AUTH_TOKEN`, `X-Auth-Token`, `x-api-key` and `gh auth status … Token:` are all scrubbed. |
| N1, N2, N4, N5 | fixed | Mutations to `pruneStoredLogs` (per the report), the grace (`Math.max(grace,0)`), `utimesSync` and the reserved-serial refusal each go red. |
| N6 | partly tested | The lease side is tested. The *Android-only* half is not (N4 below). |
| N9 excerpt name collision | **not fixed for real lines** | See N2 below. |
| Retention vs a running gate | holds for background runs | The grace covers the oldest live record from any worktree. `pid: null` counts as alive (`kill(0,0)`), which errs safe. A silent foreground run older than 2 h can be swept under the size cap; that is documented and accepted. |
| Probes | ok | Only `adb -s <lease serial> get-state`/`shell pidof`/`logcat -d --pid`. No `adb devices` call. `emulator-5560` is refused in one place. A run with no live lease asks nothing. |
| `need`/`table`/`export`/merge reuse | no regression | `gate-check` + `gate` are green. `need --for review` is satisfied on the current tree. Export adds `failureLogPath` only to failed lines, and other lines are byte-verbatim. The branch is 2 docs commits behind `main`, and `git merge-tree` is clean. |
| Premises | ok | Every symbol in the report exists. The red-proof line numbers predate `eddce4c` and are off by 4–10 (`:990` is now `:994`, `:1024` is now `:1028`, `:1458` is now `:1468`). |
| Commit identity | ok | Every commit is the repo's configured `user.email`. |

## Must fix

None.

## Nits / should fix (the first three before merge)

**N1. Migrated legacy logs can't be found by `logs --branch`, and `--failed` can't judge them.**
`scripts/gate.mjs:2466-2477` says a migrated log "has no branch in its path", but
`migrateWorktreeLogs` writes to `<store>/.gates/logs/<branch>/…` (`:412-420`), so the branch *is* in
the path. On top of that, `outcomeOfStoredLogs` (`:2425`) keys runs by `logPath`
(`.gates/logs/check-….log`), while the stored file's relative path is
`.gates/logs/task/a/check-….log`, so even a live ledger line saying `fail` never matches.
Repro: worktree `task/a` has a legacy failing log plus its ledger line, and runs one new failing
`check`. `logs --branch task/a --failed` lists only the new run, both before and after
`git worktree remove`, and prints no "could not be judged" note. `--all --failed` calls the legacy
log unjudgeable even while its ledger says fail. That is review M2's silent-0 for the logs that exist
today (A4 and X11 have legacy `.gates/logs/`). Fix: in `branchOfStoredLog`, strip a leading
`.gates/logs/` and take the rest; in `outcomeOfStoredLogs`, also key migrated records and lines by
`.gates/logs/<branch>/<name>`. Add a removed-worktree test for a migrated log.

**N2. Review N9 isn't fixed: two failed runs in the same second still share one excerpt.**
`scripts/gate.mjs:2267` keys the sequence on the raw `ts`, which carries milliseconds
(`"2026-10-28T14:18:31.128Z"` in the committed ledger), while `failureExcerptName` strips them
(`gate-core.mjs:2162`). Repro: two failed `check` lines at `…09:00:00.100Z` and `…09:00:00.900Z` both
export to `2026-10-28T09-00-00Z--check--01.log`. The file holds only the second run's log, and *both*
lines' `failureLogPath` point at it, so the first run's evidence is silently replaced in a commit. The
test (`gate-logs.test.js:1468`) uses a ts with no milliseconds, which is why it passes. Fix: key on
`failureExcerptName(entry, 0)` (the second-granular name), and add milliseconds to the test fixture.

**N3. `scrubSecrets` is quadratic on long `[\w.-]` runs, and it scrubs the whole log.**
In `gate-core.mjs:1806` (the header rule's `(?:[\w.-]*[-_.]?)?authorization` / `[\w.-]*cookie`) and
`:1834` (`\b[\w.-]{3,}`), every `.`/`_`/`-` boundary restarts an unbounded scan. Measured under Node 24:
- `"a.".repeat` at 40 KB takes 12.6 s, and at 160 KB 199 s;
- random base64url at 400 KB takes 32 s.

`renderFailureExcerpt` (`:2035`) scrubs the *entire* log (up to 200 MiB, `gate.mjs`
`EXCERPT_MAX_LOG_BYTES`) even though it keeps only the failure lines and the 150-line tail. So one
long data-URI, base64url or dotted line in a failing log can hang `export` for minutes to hours. Fix:
bound the key prefixes (`[\w.-]{0,64}`), and scrub only the lines the excerpt keeps (or skip lines over
64 KiB). Add a timing test on a 1 MB `a.` line.

**N4. Three guards stay green when broken.**
- `asksAdb = platform === 'android'` (`gate.mjs:744`): changing it to `true` keeps `gate-logs`,
  `gate` and `gate-check` all green. Nothing tests that a failed **iOS** gate with a live lease
  (whose pair has an emulator) asks adb nothing.
- `ownRunningGates`' `foreground !== true` filter (`gate.mjs:1076`): removing it stays green. Without
  it, `wait --gate X` returns a newer *foreground* run's exit code as if it were the background run.
- The branch comparison in `ownBackgroundRecords` (`gate-core.mjs:2495`): removing it stays green. It
  is the only thing keeping another branch's migrated legacy record (which has `branch` and no
  `worktree`) out of `wait`.

**N5. The excerpt still lets some identifying strings through.** These are not tokens, but D25 lists
hostnames and emails.
- `localPathRedactions` (`gate-core.mjs:1966`, called at `gate.mjs:2209`) matches exact strings only.
  It misses the bare username (`ssh <user>@…`, `whoami`; review M4 asked for `<user>`), a lowercased
  hostname or one without `.local` (`daniels-macbook-pro.local`, `Daniels-MacBook-Pro`), and
  `/var/folders/<hash>/C/…` (only `…/T` is redacted, while Xcode/SwiftPM caches print `…/C`).
- The scrubber has no email rule (`.npmrc` `email=`, `Author: … <…>`). It leaves `curl -u user:pass`
  untouched, scrubs only the first word of `password: correct horse battery`, and has no shapes for
  `sk-ant-`/`sk_live_`/`glpat-`/`AIza`.

Fix: add `os.userInfo().username` (≥3 chars), a case-insensitive hostname with and without its
domain, and `dirname(realpath(tmpdir))`. Add an email rule and a `-u user:pass` rule.

**N6. `simctl list devices booted` commits every booted simulator.** It runs for any failed device
gate, with or without a lease (`gate.mjs:731`). Its UDIDs and names end up in the excerpt, including
other tasks' simulators and the maintainer's. Meanwhile the excerpt header claims (`gate-core.mjs:2055`)
"Device identifiers appear only when the run recorded its own lease", which is false, and
`claimedDevice` computes `out.udid` (`gate.mjs:875`) and never uses it. The brief asked for this probe,
so the fix is to keep only the lease UDID's line in the log, or to correct the header claim.

**N7. Legacy logs older than 35 days are re-migrated and re-pruned on every run.**
`migrateWorktreeLogs` + `pruneStoredLogs` (`gate.mjs:1113-1114`, `:1515-1516`): the copy keeps the old
mtime, retention deletes it, and the next run copies it again. Repro: 3 runs printed
`retention removed 1 stored log file(s) (age)` 3 times, and `.gates/logs/.migrated` grew by 2 lines
per run. That contradicts the comment at `:469`. Fix: skip copying a file whose mtime is already past
`LOG_RETENTION_DAYS`.

**N8. `NITRO_UI_GATE_LOG` validation now accepts any `.log` in the shared store** (`gate.mjs:293`),
including another worktree's or another branch's run, where before it accepted only this checkout's
`.gates/logs/`. An inherited variable would then merge into, and mark done, that other run's record.
The odds are low because the runner deletes the variable for its children, but check that the path
lies under `<store>/<currentBranch>/` or in the legacy directory.

**N9. Report accuracy.** The red-proof line numbers are stale (see the table). The fix-round summary
says "N9 … excerpts sequenced", which N2 shows is false for real ledger lines. And the `gate.test.js`
race fix raises `FAKE_SLEEP` from 5 to 20, so the test is about 15 s slower (follow-up, not a fix).

## Verdict: MERGE WITH FIXES

M (none)
- N1 Migrated legacy logs are invisible to `logs --branch` and unjudged by `--failed`; the comment says there is no branch in the path (`gate.mjs:2466,2425`).
- N2 Review N9 is not fixed: the sequence is keyed on the ms-bearing `ts`, so two same-second failures share one excerpt and the first is lost (`gate.mjs:2267`).
- N3 `scrubSecrets` is quadratic on long `[\w.-]` runs and scrubs the whole log; 160 KB of `a.` took 199 s (`gate-core.mjs:1806,1834,2035`).
- N4 Three guards stay green when broken: Android-only adb (`gate.mjs:744`), the foreground filter (`:1076`) and the branch match (`gate-core.mjs:2495`).
- N5 Bare username, lowercased or domainless hostname, `/var/folders/<hash>/C`, emails, `curl -u` and multi-word YAML passwords are not redacted (`gate-core.mjs:1966`).
- N6 `simctl list devices booted` commits every booted simulator's UDID; the header claim is false and `claimed.udid` is unused (`gate.mjs:731,875`, `gate-core.mjs:2055`).
- N7 Legacy logs older than 35 days are migrated and pruned again on every run, and `.migrated` grows each time (`gate.mjs:1113,1515,469`).
- N8 `NITRO_UI_GATE_LOG` is accepted anywhere in the shared store, not just this branch's directory (`gate.mjs:293`).
- N9 The report's red-proof line numbers are stale and its "excerpts sequenced" claim is false; the race fix costs about 15 s of test time.

# X12 — Failure logs that outlive the worktree

**Branch:** `task/X12-failure-logs` (from `main` at `4257a0f`) · **Round:** fix round 1 of 2 (D19) ·
**Lease:** none (tooling only, no devices)

## Summary

Three gaps closed, all in `scripts/`.

**1. Logs survive worktree removal.** A run's log and its X9 background record now go to
`<git-common-dir>/nitro-ui-gates/<branch>/<gate>-<started-at>.log` — shared by every worktree of
the clone, untouched by `git worktree remove`. **The ledger stayed where it was** (`.gates/<branch>.jsonl`):
the brief allowed either, and moving it would have churned the reuse and export code that reads it
by path, for a file that is small and re-created by the next run. Only the logs, which nothing
re-creates, moved. `logPath` on a line is store-relative; `ledgerLogCandidates` still resolves a
pre-X12 `.gates/logs/...` line, and every run **copies** (not moves — a backgrounded run may hold the
file) its worktree's legacy directory into the store under `.gates/logs/<branch>/`, so old lines resolve
unchanged and no worktree's copy is skipped because another one migrated first. `logPathsFor` derives
the file it opens and the path the record and ledger name from one call, and validates an inherited
`NITRO_UI_GATE_LOG` before honouring it. Each record carries the branch *and the worktree* that started
it, so `wait`/`status` follow this checkout's background run even when several worktrees share the
store; `table` and `need` read it as before. Retention, stated: **35 days by mtime, then a 64 MiB cap,
oldest first, never a log touched in the last two hours** or belonging to a running gate; applied on
every run (foreground or a backgrounded launch) and by the new `gate.mjs logs [--branch b] [--failed]
[--all] [--prune]`. A stored log's branch is read from its whole path and its pass or fail from the
store's own record, so `logs --branch <b> --failed` still answers after the worktree and its ledger are
gone; a log neither can judge is reported as unknown.

**2. Export carries evidence.** `export --task <ID>` writes `docs/tasks/<ID>/failures/<run>-<n>.log`
(the run's timestamp, gate and a sequence number, so two same-second failures both survive) for every
**failed** line the store can judge — failing test names and assertion messages in their own section,
the last 150 lines, load at both ends (`summarizeLoad` gained `end`) — and records it as that line's
`failureLogPath`. Passing lines are copied **byte-for-byte** (a corrupt line stays corrupt) and get no
file; a failed line whose log is gone exports with a note naming where it looked and no pointer.
Scrubbed before writing: PEM blocks whole, URL userinfo, credential-shaped assignments (`TOKEN=`,
`"secret":`, `--api-key`, `.npmrc` `_auth=`) and bare shapes (`ghp_`, `npm_`, `github_pat_`, `xox*`,
AWS ids, JWTs), plus `Authorization:`/`Cookie:` headers **whole, whatever the scheme** — the value, not
the word `Bearer`. Local paths are redacted too: the store, this repo, the lease file, `$HOME` and the
hostname become `<store>`, `<repo>`, `<lease file>`, `~` and `<host>`, so a committed excerpt carries no
absolute path by construction.

**3. Device context on failure.** A failed gate that names a platform appends booted `simctl`
devices, `adb -s <serial> get-state` (one device's own state — never a device *list*, which is how the
first version read a neighbouring task's emulator), the lease list, load1 and (Android) the last 500
`logcat` lines for the app pid. The serial comes from this run's **lease record** plus `devices.json`,
never from `ANDROID_SERIAL`; a run with no lease, an expired lease or a reserved serial probes no
device at all and says which in the block. `splitDeviceContext` keeps that block out of the excerpt's
tail.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 816 tests / 36 suites | `5e105706c5a7` | 2 m 37 s | start 4.8 / med 5.0 / max 8.5 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

`need --for review`: `need: review is satisfied on this code tree.` — the diff is check-only tooling
(`scripts/gate.mjs`, `scripts/gate-core.mjs`, two test files), so no device gate is asked for. No
devices were used; the store path in these runs is the real clone's `.git/nitro-ui-gates/`.

## Red proofs

Each mutation applied, the suite run, then reverted. Batch 1 (`gate-logs.test.js`, 18/18 red):

- `puts the log under the git common dir` -> store resolves to `path.join(repoRoot, LEDGER_DIR, 'logs')` -> `expect(fs.existsSync(path.join(storeOf(dir), line.logPath))).toBe(true)` red
- `the store is the common dir (worktree removal)` -> `gateLogStoreDir` returns `process.cwd()/.gates/logs` -> `expect(absolute.startsWith(<main>/.git)).toBe(true)` red
- `migrates a pre-X12 .gates/logs/` -> `fs.existsSync(marker)` -> `true` -> `expect(fs.existsSync(migrated)).toBe(true)` red
- `migrates a pre-X12 .gates/logs/` -> `copyFileSync` -> `renameSync` -> "the original is still where its author left it" red
- `writes an excerpt for the failed run, none for the passed one` -> `if (!isFailedRunWithLog(entry))` -> `if (false)` -> `expect(written).toHaveLength(1)` red
- `writes an excerpt for the failed run` -> `scrubSecrets` bare-shape pass removed -> `expected "3 value(s) scrubbed"` red
- `writes an excerpt for the failed run` -> header prints `Scrubbed: 0` -> `Scrubbed: 3 credential-looking value(s)` red
- `writes an excerpt for the failed run` -> header prints `Full log: \`not recorded\`` -> `Full log: \`task/x12-fixture/check-…log\`` red
- `copies the other lines byte-for-byte` -> export re-serialises the pass-through lines -> corrupt line came back `{"corrupt":true,…}` red
- `applies retention to the store without touching a young log` -> age predicate `return false` -> `retention removed 1 file(s)` red
- `applies the size cap only after the age rule` -> `if (total > maxBytes)` -> `if (false)` -> victims `["stale","mid"]` red
- `says so, rather than writing an empty file, when the log cannot be found` -> the missing-log branch invents a `failureLogPath` -> `expect(committed.failureLogPath).toBeNull()` red
- `--failed lists the runs the ledger says failed` -> filter `false &&` -> `1 log file(s) … that the ledger says failed` red
- `bounds itself, and says it was bounded` -> `clampToBytes` removed -> `expect(<=131072)`, received 152269
- `takes the gate tools' own failure bullets` -> the `FAIL|●|✕|✗|not ok` test -> `if (false)` -> failure section empty (3 lines expected, 0)
- `lifts the device block out of the tail` -> `splitDeviceContext` bypassed -> `## Device and run context` red
- `appends simctl, adb, the lease list and load1` -> the append `if` -> `if (false)` -> `appended the device context` red
- `adds logcat … addressed only to the leased serial` -> `-s <serial>` dropped from logcat -> `adb -s emulator-5574 logcat -d --pid 4242` red
- `never addresses the maintainer's reserved emulator` -> reserved-serial `if` -> `if (false)` -> `expect(asked).not.toContain('-s emulator-5560')` red
- `does not feed a failed probe's error text to the next command` -> `pidAnswer?.ok === true ? text : ''` -> `pidAnswer?.text ?? ''` -> `logcat` was called with the error text
- `reports the last sample it measured` -> `end: null` -> `expect(summarizeLoad(…).end).toBe(30)` red

Three of these needed the test strengthened first (each was green under its mutation, i.e. not a
proof): the excerpt's failure section (short log ⇒ the tail also contains the same strings — now
asserted by section header), `Full log:` (label-only match), and the missing-log case (the committed
line was never read). All three fixed in the `test(gates):` commits, then red under the same mutation.

Also proven in `gate.test.js`: `listBackgroundRecords` stops recursing -> 7 background/`wait` tests
red, including `ghost-check.log` (a record written at store-root level is a fixture that no longer
matches how records are named, so the non-recursive batch-2 variant of that mutation is a no-op —
the recursive-walk mutation above is the proof).

## Files changed

- `scripts/gate-core.mjs` — `LOG_STORE_BASENAME`, `gateLogStoreDir`, `logRelativePath`, `logNameFor`,
  `ledgerLogCandidates`, `planLogRetention` (+ the two constants), `scrubSecrets`, `failureLinesFrom`,
  `splitDeviceContext` + the two markers, `renderFailureExcerpt`, `failureExcerptName`,
  `isFailedRunWithLog`, `summarizeLoad.end`, `failureLogPath` on the line, `LEDGER_VERSION = 5`.
- `scripts/gate.mjs` — the store, migration, retention, `logs` command, export excerpts, device
  context and its probes; `wait`/`status`/`table` read the store.
- `scripts/__tests__/gate-logs.test.js` — new, 44 tests.
- `scripts/__tests__/gate.test.js` — the X9 background tests follow the store; `load.end` in three
  `summarizeLoad` fixtures.
- `AGENTS.md`, `CONTRIBUTING.md`, `docs/tasks/ORCHESTRATOR.md` — where logs live, what an export
  carries, and the archive-before-remove workaround retired.

## Follow-ups

- `gate.mjs table --full` prints a store-relative `logPath`, which is no longer relative to the
  reader's cwd; `export` prints the absolute path, so a reader has the answer, but `--full` could too.
- `.gates/<branch>.jsonl` still dies with its worktree (by design); the only recovery is exporting
  before cleanup, which `ORCHESTRATOR.md` now says. A `logs`-style "this branch has an unexported
  ledger" hint would close it.
- The device-context probes run only on a *failed* gate; a passed-but-flaky harness run still leaves
  no device state, which is the Q3 question one step earlier.
- `scripts/real-input/*.mjs` keep their own `tailAppLog()`; gate's logcat probe duplicates ~10 lines
  of it rather than importing a device class out of a suite script.
- `logcat` is captured for the app's pid, so on a crash — the case where it matters most — `pidof`
  is empty and nothing is captured. The brief scopes the probe to the app's pid; the fix would be a
  `--pid`-less buffer dump bounded by line count, which is a different amount of evidence.

## Fix round 1

Against the review (`60ebba9`): all must-fixes and nits are in.

**M1** records carry `branch` *and* `worktree`, and `ownBackgroundRecords`/`ownRunningGates` scope
`wait`/`status` to the calling checkout — tested with two `git worktree add -f` checkouts on **one**
branch, so branch matching cannot explain it. **M2** every run writes a record, `branchOfStoredLog`
reads the branch from the whole path, `--failed` judges from the store's record, and a log neither can
judge reads *unknown*, not "0 failed". **M3** the copy has no marker gate: idempotent and
branch-keyed, `.migrated` provenance only. **M4** store, repo, lease file, `$HOME`, scratch dir and
host become placeholders — the scratch dir being the leak this round's export showed. **M5**
`Authorization`/`Cookie` scrubbed whole, `[_-]?auth` added, the false `.npmrc` claim gone. **N1**
retention prunes on both launch paths, printing what it deleted. **N2** grace tested by a 36-day
running record beside a 60-day victim. **N3/N4** dead assertion gone, migrated lines resolve, mtime
kept, collisions counted. **N5/N6** `get-state` of the lease's serial only, Android only, nothing
without a live lease. **N7** `logPathsFor` derives both spellings and validates the inherited path.
**N8/N9** env scrubbed, excerpts sequenced. `check` also caught three lint errors and a `wait`
assertion that only passed on an idle machine.

### Gates (fix round 1)

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 834 tests / 36 suites | `6913bb53fb5b` | 2 m 34 s | start 1.9 / med 3.5 / max 5.2 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

`need --for review`: `need: review is satisfied on this code tree.` — the diff is check-only tooling, so
no device gate is asked for. Two `check` runs went red on the way (`43ba510c1452`: the three lint errors
and the `wait` race; that failure is the excerpt now committed under `docs/tasks/X12/failures/`), and the
row above is the green one on `eddce4c`. No devices were used; the probes are fake binaries as before.

### Red proofs (fix round 1)

One battery, `/tmp/x12-red-proofs3.py`: 26 mutations (28 edits), each applied, the named test run, then
restored from the in-memory copy. All 26 red, line numbers in `gate-logs.test.js`. Format: mutation ->
the line that went red.

- M1 scoping deleted from `ownBackgroundRecords` -> `gate-logs.test.js:990 expect(wait.stderr).toContain('this worktree ran this')`
- M1 launcher + runner both stop writing `worktree` -> `:1024 expect(ours[0]).toMatchObject({`
- M1 `wait` reads the whole store again -> `:990 expect(wait.stderr).toContain('this worktree ran this')`
- M2 branch read from the first segment -> `:580 expect(byBranch.stdout).toContain('2 log file(s) for task/x12-nested/deep')`
- M2 foreground record moves off the log's basename -> `:589 expect(failed.stdout).toContain('1 log file(s)')`
- M2 `--failed` ignores store records -> `:589 expect(failed.stdout).toContain('1 log file(s)')`
- M2 unjudgeable log skipped silently -> `:609 expect(failed.stdout).toContain('could not be judged')`
- M3 per-clone marker rebuilt (read *and* write) -> `:1070 expect(fs.readFileSync(stored, 'utf8')).toContain(...)` — B's log never lands
- M4 body stops redacting -> `:1162 expect(excerpt).not.toContain(store)` (the store path appears verbatim)
- M4 scratch dir dropped as a target -> `:1171 expect(excerpt).not.toContain(tmp)` (`/private/var/folders/x4/<hash>/T`)
- M4 store dropped as a target -> `:1177 expect(excerpt).toContain('<store>/')`
- M5 header rule knows only `Bearer` -> `gate-core.mjs:1822 value.trim is not a function` (group 3 is undefined)
- M5 `[_-]?auth` removed -> `:1323 expect(result.text).not.toContain('dXNlcjpwYXNzd29yZA==')`
- N1 `pruneStoredLogs` dropped from `runGate` -> `:848 expect(run.stderr).toContain('retention removed 1 stored log file(s)')`
- N1 dropped from `startBackgroundGate` -> `:868 expect(started.stderr).toContain('retention removed 1 stored log file(s)')`
- N2 grace extension flattened -> `:915 expect(pruned.stdout).toContain('retention removed 1 file(s)')` (the 36-day log goes)
- N4 `utimesSync` removed -> `:715 expect(...mtimeMs / 1000)).toBe(` (copy time, not the original's)
- N3 migrated branch candidate dropped -> `:740 expect(typeof committed.failureLogPath).toBe('string')`
- N5 probe asks `devices` -> `:1630 expect(asked).toContain('adb -s emulator-5574 get-state')`
- N5 reserved serial not refused -> `:1702 expect(asked).not.toContain('-s emulator-5560')`
- N6 no-lease run trusts `ANDROID_SERIAL` -> `:1723 expect(asked).not.toContain('adb')`
- N6 env beats the pair's serial -> `:1668 expect(asked).toContain('adb -s emulator-5574 get-state')` (it asked 5576)
- N6 expired lease probed anyway -> `:1760 expect(asked).not.toContain('adb')`
- N7 ledger spelling stops following the file -> `:630 expect(line.logPath).toBe('.gates/logs/check-from-legacy-launcher.log')`
- N7 env value stops being validated -> `:641 expect(run.stderr).toContain('ignoring NITRO_UI_GATE_LOG')`
- N9 sequence number dropped -> `:1458 expect(name).toBe('2026-10-28T09-00-00Z--harness+android--01.log')`

The **first** battery run came back with six GREEN results — M1 ×2, M3, N1 background, N6 ×2 — and every
one was a gap in my test or my mutation, not in the code: the M1 fixture used two *different* branches
(branch matching alone satisfied it), the M1 mutation hit the runner while the launcher's own write was
the one under test, the M3 mutation relocated a note that is no longer read, the N1 background case
asserted only a file's absence (which `logs --prune` in the same test had explained away), and both N6
cases were judged by a note that the mutated code still printed. All six were closed before the run
above; nothing from that run should be read as a proof.

### Files changed (fix round 1)

- `scripts/gate-core.mjs` — `ownBackgroundRecords`, `storedLogFailed`, `localPathRedactions` (incl.
  `<tmp>`), the header rule and `[_-]?auth` in `scrubSecrets`, sequenced `failureExcerptName`, the
  migrated-branch candidate in `ledgerLogCandidates`.
- `scripts/gate.mjs` — `worktree`/`foreground` on records, `ownRecordScope`/`ownRunningGates`,
  `branchOfStoredLog`, `outcomeOfStoredLogs`, `pruneStoredLogs`, migration with no marker + mtime +
  conflicts, `logPathsFor` with env validation, `claimedDevice`/`get-state`, USAGE.
- `scripts/__tests__/gate-logs.test.js` 44 → 62 tests; `scripts/__tests__/gate.test.js` the progress
  race; `AGENTS.md`, `CONTRIBUTING.md`, `docs/tasks/ORCHESTRATOR.md` — what the store, `--failed` and
  an excerpt actually guarantee, with no "read it before you push" hedge.

## Fix round 2

Against the re-review (`ad90616`): all five must-fixes, plus N4, N7 and N8.

**N3** the two assignment regexes became one left-to-right pass with a bounded key scan, and an excerpt selects its lines first and scrubs only those, each capped. A 1 MB line of `a.` scrubs in 70 ms; the old pair took 12.6 s at 40 KB. **N5** two halves now: exact strings plus whole-word username and host rules and the whole scratch folder, and shape rules for other people's `/Users/x` and any `/var/folders/<hash>`. Added: email, `curl -u`, `user:pass@host`, Stripe/Anthropic/GitLab shapes, a config value that is a phrase. `git@github.com` and `logo@2x.png` stay. **N6** probes pass through `redactForeignDeviceIds`, so another task's UDID or serial becomes `<other device>` and the header's claim is true. **N1** a migrated log's branch is read from its own path, its verdict under the migrated spelling. **N2** the sequence keys on the file name, not the millisecond-bearing `ts`. **N4/N7/N8** three guards are testable, expired logs stop migrating, `NITRO_UI_GATE_LOG` must be this branch's own.

**N9** is this section: the numbers below were read off the file, not remembered; round 1's "excerpts sequenced" claim was false until N2; the `FAKE_SLEEP` cost is listed as a follow-up, not a fix.

### Gates (fix round 2)

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 871 tests / 36 suites | `182f1afd98ff` | 2 m 46 s | start 1.9 / med 3.6 / max 75.6 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

`need --for review`: `need: review is satisfied on this code tree.` — the diff is check-only tooling, so no device gate is asked for. No devices were used; the probes are fake binaries. `gate-logs.test.js` 62 → 99 tests. The `max 75.6` load is this machine running the mutation batteries beside the gate.

### Red proofs (fix round 2)

Each mutation applied alone and restored from an in-memory copy. Format: mutation -> the line that went red, in `gate-logs.test.js`.

N3:

- `MAX_KEY_SCAN` bound removed -> `:2222` `it('is not quadratic when one separator sits at the end of a long run')` — the suite did not reach its own result inside 420 s
- key reach `128` → `1` -> `:2258 expect(text).not.toContain('abcdef123456')` — the bound's other direction: a key longer than one character stops being recognised, so a real credential buried in a megabyte survives
- `EXCERPT_MAX_LINE_CHARS` cap dropped -> `:2364 expect(content).toContain('[line truncated]')`
- scrubbing every line again (round 1) -> `:2347 expect(scrubbed).toBe(0)`, received `300`
- `tailLines: 0` accepted as `slice(-0)` (the whole log) -> `:2347` same line, received `300`

N5 and N6:

- identity rules never returned -> `:1995 expect(apply(line)).not.toContain('danielwilliams')`
- host matched only in `os.hostname()`'s spelling -> `:2036 expect(redacted).not.toContain('daniels-macbook-pro')`
- host matched case-sensitively -> `:2036` same line
- identity strings of any length matched -> `:2099 expect(shortUser).toBe('ps -o user=p | grep -w id …')`
- email rule off -> `:1924 expect(text).not.toContain(address)`
- `git@github.com` treated as a person -> `:1936 expect(scrubSecrets(remote).text).toBe(remote)`
- `curl -u` rule off -> `:1953 expect(text).not.toContain('hunter2')`
- bare `user:pass@host` rule off -> `:1954 expect(text).toContain('[scrubbed]')` (the email rule caught part of it, which is itself worth knowing)
- config-style value dropped -> `:1866 expect(config.text).toBe('nexusPassword: [scrubbed]')`
- JSON structural character read as a value -> `:1882 expect(nested.text).toContain('"b":"c"')`
- `/Users` + `/home` shape rule inert -> `:2134 expect(result).not.toContain(secret)`
- role accounts redacted anyway -> `:2154 expect(scrubMachinePaths(line)).toBe(line)`
- `/var/folders` shape rule inert -> `:2134` same line
- this machine's scratch parent kept -> `:2060 expect(apply(line)).not.toContain('ZZ34Q44R7S30Q5V4F04F0000')`
- a plain `/tmp` redacted -> `:2071 expect(apply('rm -rf /tmp/whatever')).toBe(…)`
- device-block redaction skipped -> `:2584 expect(context).not.toContain('1F2D3E4F-…')`
- the lease's own UDID not treated as ours -> `:2580 expect(context).toContain('CD670291-…')`
- emulator serials left alone -> `:2621 expect(context).not.toContain('emulator-5560')`
- nothing claimed means nothing compared -> `:2607 expect(context).not.toContain('CD670291-…')`

N1, N2, N4, N7, N8:

- N1 branch read as `(unknown)` under `.gates/logs/` -> `:712` `3 log file(s) for task/x12-legacy`, printed 1
- N1 record's migrated key dropped -> `:743 expect(afterRemoval.stdout).toContain('check-2026-10-27…')`
- N1 ledger line's migrated key dropped -> `:726` `3 log file(s)`, printed 2
- N2 sequence keyed on raw `ts` -> `:1630 expect(written).toHaveLength(2)`, one file both lines point at
- N4 `asksAdb = true` -> `:2649 expect(asked).not.toContain('adb')`
- N4 `foreground !== true` removed -> `:1358 expect(wait.status).toBe(13)`, received `7`
- N4 branch comparison removed -> `:1409 expect(wait.status).toBe(2)`, received `13`
- N4 the fake adb's `get-state` grep bug restored -> `:2671 expect(context).toMatch(/adb get-state…\|\s*device/)`
- N7 age check removed -> `:1032 expect(runs).not.toContain('retention removed')` — the review's line, twice in three runs
- N8 widened to "anywhere in the store" -> `:829 expect(run.stderr).toContain('ignoring NITRO_UI_GATE_LOG')`
- N8 compared as unresolved `path.resolve` -> `:884 expect(run.stderr).not.toContain('ignoring NITRO_UI_GATE_LOG')` — the launcher's own path, spelled through a symlink, is rejected. `:852`, the other acceptance test, stays green under this mutation because it builds its path from the already-resolved store: that is why both exist.

The first batteries reported three of these as green and two others as red in name only, and all five were my error rather than the code's: the detector called "no ✕ printed" green, so a suite that failed to parse passed, and three mutations renamed an identifier instead of disabling a rule, which threw at import instead of asserting. The rewritten battery separates a broken file from a passing test, and every line above was read out of a failure that names an `expect`.

Three guards arrived untested and were caught before this report rather than after: the `PROTOCOL_ACCOUNTS` exemption, the role-account list, and the `> '/tmp'.length` floor that stops `os.tmpdir()` on a Linux runner rewriting every `/tmp/...` in a CI log. The hostname test was worse than untested — it asserted `not.toContain(form.toLowerCase())` against text that still read `Daniels-MacBook-Pro`, so it could never have failed.

### Privacy re-check of the committed excerpt

`grep -cE` over `docs/tasks/X12/{failures/*.log,gates.jsonl}`, each returning 0: `danielwilliams`; `/Users/[A-Za-z]`; `/home/[A-Za-z]`; `/var/folders/[a-z0-9]{2}/`; a UUID-shaped UDID; `emulator-[0-9]+`; any email; `MacBook|.local|williams`; `ghp_|npm_|sk-ant|sk_live|AIza|glpat-|eyJ`; `_auth|password|secret|token=`. What remains is placeholders only — `<repo>` ×4, `<tmp>` ×3, `<store>` ×2, and one each of `<host>`, `<user>`, `<other device>`, all six inside the header sentence that names the guarantees. No device gate ran this round, so no real identifier was ever in scope.

### Follow-ups (fix round 2)

- `FAKE_SLEEP` 5 → 20 in `gate.test.js` costs ~15 s of suite time (round 1's race fix). A barrier on the log line would remove both the sleep and the flake; not done here, since a faster fake re-exposes the race the review asked closed.
- `scrubMachinePaths` leaves `/Volumes/<host>/…` to the hostname rule instead of matching mount roots itself, so a host whose name is an ambiguous word keeps its mount path.
- N1's foreground half: a pre-X12 *foreground* run leaves only a ledger line, so after `git worktree remove` its log is listed and reported as unjudgeable. Making that judgement survive would mean writing a record at migration time — inventing a verdict the source never recorded.

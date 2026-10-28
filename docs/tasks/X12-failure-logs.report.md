# X12 — Failure logs that outlive the worktree

**Branch:** `task/X12-failure-logs` (from `main` at `4257a0f`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** none (tooling only, no devices)

## Summary

Three gaps closed, all in `scripts/`.

**1. Logs survive worktree removal.** A run's log and its X9 background record now go to
`<git-common-dir>/nitro-ui-gates/<branch>/<gate>-<started-at>.log` — shared by every worktree of
the clone, untouched by `git worktree remove`. **The ledger stayed where it was** (`.gates/<branch>.jsonl`):
the brief allowed either, and moving it would have churned the reuse and export code that reads it
by path, for a file that is small and re-created by the next run. Only the logs, which nothing
re-creates, moved. `logPath` on a line is store-relative; `ledgerLogCandidates` still resolves a
pre-X12 `.gates/logs/...` line, and the first run in a worktree **copies** (not moves — a backgrounded
run may hold the file) its legacy directory into the store under `.gates/logs/`, so old lines resolve
unchanged. `NITRO_UI_GATE_LOG` accepts either root and `listBackgroundRecords` walks the store, so
`wait`/`status`/`table`/`need` behave as before from any worktree. Retention, stated: **35 days by
mtime, then a 64 MiB cap, oldest first, never a log touched in the last two hours** or belonging to a
running background gate; applied on every run and by the new `gate.mjs logs [--branch b] [--failed]
[--all] [--prune]`.

**2. Export carries evidence.** `export --task <ID>` writes `docs/tasks/<ID>/failures/<run>.log` for
every **failed** line — failing test names and assertion messages in their own section, the last 150
lines, load at both ends (`summarizeLoad` gained `end`) — and records it as that line's
`failureLogPath`. Passing lines are copied **byte-for-byte** (a corrupt line stays corrupt) and get no
file; a failed line whose log is gone exports with a note naming where it looked and no pointer.
Scrubbed before writing: PEM blocks whole, URL userinfo, credential-shaped assignments (`TOKEN=`,
`"secret":`, `--api-key`, `<auth>…</auth>`) and bare shapes (`ghp_`, `npm_`, `github_pat_`, `xox*`,
AWS ids, JWTs). Not scrubbed: paths and hostnames — the header says the file is committed, so read it
before you push.

**3. Device context on failure.** A failed gate that names a platform appends booted `simctl`
devices, `adb -s <leased serial> devices`, the lease list, load1 and (Android) the last 500 `logcat`
lines for the app pid. Both adb commands name the leased serial; a reserved or missing serial is
refused in the block. `splitDeviceContext` keeps that block out of the excerpt's tail.

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
- `--failed lists the runs the ledger says failed` -> filter `false &&` -> `1 log file(s) … that the ledger says failed` red
- `bounds itself, and says it was bounded` -> `clampToBytes` removed -> `expect(<=131072)`, received 152269
- `takes the gate tools' own failure bullets` -> the `FAIL|●|✕|✗|not ok` test -> `if (false)` -> failure section empty (3 lines expected, 0)
- `lifts the device block out of the tail` -> `splitDeviceContext` bypassed -> `## Device and run context` red
- `appends simctl, adb, the lease list and load1` -> the append `if` -> `if (false)` -> `appended the device context` red
- `adds logcat … addressed only to the leased serial` -> `-s <serial>` dropped from logcat -> `adb -s emulator-5574 logcat -d --pid 4242` red
- `never addresses the maintainer's reserved emulator` -> reserved-serial `if` -> `if (false)` -> `expect(asked).not.toContain('-s emulator-5560')` red
- `does not feed a failed probe's error text to the next command` -> `pidAnswer?.ok === true ? text : ''` -> `pidAnswer?.text ?? ''` -> `logcat` was called with the error text
- `reports the last sample it measured` -> `end: null` -> `expect(summarizeLoad(…).end).toBe(30)` red

Two of these needed the test to be fixed first (each was green under the mutation, i.e. not a proof):
the excerpt's failure section (short log ⇒ the tail also contains the strings — now asserted by
section header) and `Full log:` (label-only match). Both fixed in `test(gates):` commits and then red.

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

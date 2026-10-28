/**
 * Failure evidence that outlives the thing that produced it (X12).
 *
 * Three claims, each of which was false before this task:
 *
 *   1. a gate's log is in the clone's **log store** (`<git-common-dir>/nitro-ui-gates/`),
 *      so `git worktree remove` cannot take it - the Q3 incident was a diagnosis of
 *      three flaky tests that could not read the failing runs because the branch's
 *      worktree was already gone;
 *   2. `export --task <ID>` attaches a scrubbed excerpt to every **failed** line and
 *      to no passing one, because a committed red row with no evidence is a red row
 *      nobody can act on;
 *   3. a failed device gate appends the device's own state to its log, which is the
 *      difference between "the harness timed out" and "the simulator had already
 *      exited, and logcat says why".
 *
 * No devices are booted here. The device probes are aimed at fake `simctl`/`adb`
 * programs (`NITRO_UI_SIMCTL_BIN` / `NITRO_UI_ADB_BIN`, the same overrides
 * lease.mjs uses), and every test asserts what those fakes were *asked* - including
 * that the maintainer's reserved serial is never addressed.
 *
 * The temp-repo cases follow the X10 rule: clear the git environment and assert the
 * toplevel before mutating anything, so a fixture can never reach this clone.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';
import { Buffer } from 'node:buffer';

import {
  EXCERPT_TAIL_LINES,
  LOG_RETENTION_DAYS,
  LOG_RETENTION_MAX_BYTES,
  LOG_STORE_BASENAME,
  failureExcerptName,
  failureLinesFrom,
  gateLogStoreDir,
  isFailedRunWithLog,
  ledgerLogCandidates,
  logNameFor,
  logRelativePath,
  planLogRetention,
  renderFailureExcerpt,
  scrubSecrets,
  splitDeviceContext,
  summarizeLoad,
} from '../gate-core.mjs';

const CLI = path.join(process.cwd(), 'scripts', 'gate.mjs');

/** Removes every scratch directory this file made, at the end of the suite. */
const cleanup = [];
afterAll(() => {
  for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
});

function scratch(prefix) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
  cleanup.push(dir);
  return dir;
}

/**
 * A git environment that cannot reach a repository other than the one named.
 *
 * Same list X10's tests use: the suite itself runs inside a real clone, and an
 * inherited `GIT_DIR`/`GIT_WORK_TREE` would send a fixture's `git worktree add` or
 * `git commit` into it.
 */
function gitEnv(dir) {
  const env = { ...process.env };
  for (const name of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_COMMON_DIR',
    'GIT_OBJECT_DIRECTORY',
    'GIT_GRAFT_FILE',
    'GIT_NAMESPACE',
  ]) {
    delete env[name];
  }
  return {
    ...env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.invalid',
    GIT_AUTHOR_DATE: '2026-10-28T12:00:00Z',
    GIT_COMMITTER_DATE: '2026-10-28T12:00:00Z',
    HOME: dir,
  };
}

function gitIn(dir, args) {
  const result = spawnSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    env: gitEnv(dir),
  });
  if (result.status !== 0)
    throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return String(result.stdout).trim();
}

/** Refuses to mutate a repository that is not the one it was handed. */
function gitInTempRepo(dir, args) {
  const toplevel = gitIn(dir, ['rev-parse', '--show-toplevel']);
  const expected = fs.realpathSync(dir);
  if (toplevel !== expected) {
    throw new Error(
      `refusing to run "git ${args.join(' ')}": the repository in play is ${toplevel}, not ${expected}`
    );
  }
  return gitIn(dir, args);
}

/**
 * A checkout small enough to run a gate in, with a fake runner that prints a Jest
 * summary and exits with `FAKE_EXIT`.
 *
 * `.gates/`, the store and `fake-bin/` are all gitignored, because an untracked log
 * that counts as code moves the tree mid-run and every line reads stale.
 */
function makeRepo({ branch = 'task/x12-fixture' } = {}) {
  const dir = scratch('x12-gate-');
  const write = (file, content) => {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };
  write('nitrogen/generated/ios/NitroUiAutolinking.swift', '// marker\n');
  write('ios/core/Core.swift', 'v1\n');
  write('example/package.json', '{"name":"x"}\n');
  write(
    '.gitignore',
    `.gates/\n${LOG_STORE_BASENAME}/\nfake-bin/\n.real-input/\n`
  );
  gitIn(dir, ['init', '-q', '-b', 'main']);
  gitInTempRepo(dir, ['add', '-A']);
  gitInTempRepo(dir, ['commit', '-qm', 'base']);
  if (branch !== 'main') gitInTempRepo(dir, ['checkout', '-qb', branch]);
  return dir;
}

/**
 * The fake gate runner, plus fake `simctl`/`adb` that record their arguments.
 *
 * The device fakes write each invocation into `<dir>/fake-bin/calls.log` so a test
 * can assert both what was asked and that the reserved serial was never asked. They
 * print something recognisable so the excerpt has content of its own to show.
 */
function fakeBins(dir, hook = '') {
  const bin = path.join(dir, 'fake-bin');
  fs.mkdirSync(bin, { recursive: true });
  const gate =
    '#!/bin/sh\n' +
    'echo "fake gate: $*"\n' +
    'echo "FAIL ios/core/Core.test.tsx"\n' +
    'echo "  \u25cf Switch \u203a renders the checked state"\n' +
    'echo "    Expected: true"\n' +
    'echo "    Received: false"\n' +
    'echo "Test Suites: 1 failed, 32 passed, 33 total"\n' +
    'echo "Tests: 3 failed, 662 passed, 665 total"\n' +
    'echo "NPM_TOKEN=supersecrettokenvalue GITHUB_TOKEN=ghp_${FAKE_TOKEN_BODY}"\n' +
    'echo "cloned with ghp_abcdefghijklmnopqrstuvwxyz123456 from the registry"\n' +
    (hook === '' ? '' : `${hook}\n`) +
    'exit ${FAKE_EXIT:-0}\n';
  for (const name of ['bun', 'node']) {
    fs.writeFileSync(path.join(bin, name), gate);
    fs.chmodSync(path.join(bin, name), 0o755);
  }
  const calls = path.join(bin, 'calls.log');
  const recorder = (program, output) =>
    '#!/bin/sh\n' +
    `printf '%s %s\\n' "${program}" "$*" >> "${calls}"\n` +
    `${output}\n` +
    'exit ${FAKE_DEVICE_EXIT:-0}\n';
  fs.writeFileSync(
    path.join(bin, 'simctl'),
    recorder(
      'simctl',
      'echo "    iPhone 17 (CD670291-1111-1111-1111-111111111111) (Booted)"'
    )
  );
  // `adb` answers `devices` and `pidof`; logcat gets 600 lines so the ~500 cap is
  // itself under test rather than assumed.
  // `adb` answers `devices`, `pidof` and `logcat`. Branching on grep rather than a
  // `case` glob on `$*`, because the patterns need the spaces and stars that quoting
  // then fights with - and a fake that dies on a syntax error would make the
  // probe-failure case look like a passing one. logcat prints 600 lines so the ~500
  // cap is measured rather than assumed.
  const argsFile = path.join(bin, 'adb-args');
  fs.writeFileSync(
    path.join(bin, 'adb'),
    '#!/bin/sh\n' +
      `printf 'adb %s\\n' "$*" >> "${calls}"\n` +
      `printf '%s\\n' "$*" > "${argsFile}"\n` +
      `if grep -q ' logcat ' "${argsFile}"; then\n` +
      '  i=1\n' +
      '  while [ "$i" -le 600 ]; do echo "logcat line $i"; i=$((i+1)); done\n' +
      '  exit ${FAKE_DEVICE_EXIT:-0}\n' +
      'fi\n' +
      `if grep -q ' pidof ' "${argsFile}"; then\n` +
      '  if [ -n "${FAKE_ADB_PIDOF_FAIL:-}" ]; then\n' +
      "    echo 'error: device offline' >&2\n" +
      '    exit 1\n' +
      '  fi\n' +
      '  echo 4242\n' +
      '  exit ${FAKE_DEVICE_EXIT:-0}\n' +
      'fi\n' +
      'echo "List of devices attached"\n' +
      'echo "$2 device"\n' +
      'exit ${FAKE_DEVICE_EXIT:-0}\n'
  );
  for (const name of ['simctl', 'adb'])
    fs.chmodSync(path.join(bin, name), 0o755);
  return { bin, calls };
}

function runCli(dir, args, extraEnv = {}, hook = '') {
  const { bin, calls } = fakeBins(dir, hook);
  fs.rmSync(calls, { force: true });
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      ...gitEnv(dir),
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      // The device probes must never see the real SDK or the maintainer's device.
      NITRO_UI_SIMCTL_BIN: path.join(bin, 'simctl'),
      NITRO_UI_ADB_BIN: path.join(bin, 'adb'),
      ANDROID_HOME: bin,
      ...extraEnv,
    },
  });
  return { ...result, calls, bin };
}

function ledgerIn(dir, branch) {
  const file = path.join(dir, '.gates', `${branch}.jsonl`);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((raw) => raw.trim() !== '')
    .map((raw) => JSON.parse(raw));
}

/** The store of a `git init` fixture: its own `.git`, as a main checkout's is. */
function storeOf(dir) {
  return path.join(dir, '.git', LOG_STORE_BASENAME);
}

/* ------------------------------- the store ------------------------------- */

describe('gateLogStoreDir / logRelativePath (where a log goes)', () => {
  it('hangs the store off the common dir, which a worktree does not own', () => {
    expect(gateLogStoreDir('/repo/.git')).toBe(
      `/repo/.git/${LOG_STORE_BASENAME}`
    );
    // A trailing slash from `git rev-parse` must not become a doubled separator.
    expect(gateLogStoreDir('/repo/.git/')).toBe(
      `/repo/.git/${LOG_STORE_BASENAME}`
    );
  });

  it('keys a log by branch, so one branch is one directory', () => {
    expect(logRelativePath('task/X12-failure-logs', 'check-1.log')).toBe(
      'task/X12-failure-logs/check-1.log'
    );
    // The store must not be escapable by a branch string that is not a ref, for the
    // same reason the ledger file name guard exists.
    expect(() => logRelativePath('../../etc', 'x.log')).toThrow();
  });

  it('names a log after its gate and start time, with no colons', () => {
    const name = logNameFor('harness:android', Date.UTC(2026, 9, 28, 12, 0, 0));
    expect(name).toBe('harness+android-2026-10-28T12-00-00.000Z.log');
    expect(name).not.toContain(':');
  });
});

describe('ledgerLogCandidates (old lines still resolve)', () => {
  const exists = (file) => file !== '/nothing';

  it('prefers a worktree log that is still there over the migrated copy', () => {
    const { file, candidates } = ledgerLogCandidates(
      { logPath: '.gates/logs/check-1.log' },
      {
        repoRoot: '/wt',
        worktreeGitDir: '/wt/.git',
        storeDir: '/clone/.git/nitro-ui-gates',
        existsSync: (candidate) => candidate === '/wt/.gates/logs/check-1.log',
      }
    );
    expect(file).toBe('/wt/.gates/logs/check-1.log');
    // And it looked in the store too, so a caller can say where it searched.
    expect(candidates).toContain(
      '/clone/.git/nitro-ui-gates/.gates/logs/check-1.log'
    );
    expect(exists('/nothing')).toBe(false);
  });

  it('falls through to the store when the worktree is gone', () => {
    const { file } = ledgerLogCandidates(
      { logPath: 'task/X12/check-1.log' },
      {
        repoRoot: '/gone',
        storeDir: '/clone/.git/nitro-ui-gates',
        existsSync: (candidate) =>
          candidate === '/clone/.git/nitro-ui-gates/task/X12/check-1.log',
      }
    );
    expect(file).toBe('/clone/.git/nitro-ui-gates/task/X12/check-1.log');
  });

  it('asks nowhere and finds nothing when the line has no log path', () => {
    const { file, candidates } = ledgerLogCandidates(
      { gate: 'check' },
      { storeDir: '/clone/.git/nitro-ui-gates', existsSync: () => true }
    );
    expect(candidates).toEqual([]);
    expect(file).toBeNull();
  });
});

describe('planLogRetention (the rule: 35 days, then 64 MiB)', () => {
  const DAY = 86_400_000;
  const now = Date.UTC(2026, 9, 28);

  it('deletes by age, oldest first, and spares anything young', () => {
    const logs = [
      { file: 'old-a', bytes: 10, mtimeMs: now - 40 * DAY },
      { file: 'old-b', bytes: 10, mtimeMs: now - 90 * DAY },
      { file: 'young', bytes: 10, mtimeMs: now - 6 * DAY },
    ];
    const plan = planLogRetention(logs, { now });
    expect(plan.victims.map((victim) => victim.file)).toEqual([
      'old-b',
      'old-a',
    ]);
    expect(plan.victims.every((victim) => victim.reason === 'age')).toBe(true);
    expect(plan.kept).toBe(1);
    expect(plan.keptBytes).toBe(10);
  });

  it('never deletes a log being written, however old the rest of the store is', () => {
    // The whole point of the grace: a `wait` reading a live run's log must not find
    // the file deleted underneath it by a sweep from another worktree.
    const plan = planLogRetention(
      [{ file: 'in-flight', bytes: 10, mtimeMs: now - 60 * DAY }],
      { now, protectNewerThan: 2 * 60 * 60_000 * 1000 }
    );
    expect(plan.victims).toEqual([]);
  });

  it('applies the size cap only after the age rule, and stops once under it', () => {
    const logs = [
      { file: 'stale', bytes: 10, mtimeMs: now - 40 * DAY },
      { file: 'mid', bytes: 50, mtimeMs: now - 3 * DAY },
      { file: 'newest', bytes: 50, mtimeMs: now - 1 * DAY },
    ];
    const plan = planLogRetention(logs, {
      now,
      maxBytes: 60,
      protectNewerThan: 0,
    });
    // The stale one went on age; then the older survivor goes on size; the newest
    // stays even though the cap is 60 and it alone is 50.
    expect(plan.victims.map((victim) => victim.file)).toEqual(['stale', 'mid']);
    expect(plan.victims[1].reason).toBe('size');
    expect(plan.keptBytes).toBe(50);
  });

  it('states a real ceiling rather than a placeholder', () => {
    expect(LOG_RETENTION_DAYS).toBe(35);
    expect(LOG_RETENTION_MAX_BYTES).toBe(64 * 1024 * 1024);
  });
});

/* -------------------------- the CLI, in a checkout ------------------------- */

describe('gate.mjs writes logs into the clone store, not the worktree', () => {
  it('puts the log under the git common dir and says so twice on stderr', () => {
    const dir = makeRepo();
    const run = runCli(dir, ['check']);
    expect(run.status).toBe(0);
    const [line] = ledgerIn(dir, 'task/x12-fixture');
    // Store-relative, so the line means the same thing from any worktree.
    expect(line.logPath).toMatch(/^task\/x12-fixture\/check-.*\.log$/);
    expect(fs.existsSync(path.join(storeOf(dir), line.logPath))).toBe(true);
    expect(fs.existsSync(path.join(dir, '.gates', 'logs'))).toBe(false);
    // Both the relative path and the absolute one are printed: the relative one is
    // what the ledger carries, the absolute one is what a human opens.
    expect(run.stderr).toContain(`gate: log ${line.logPath}`);
    expect(run.stderr).toContain(path.join(storeOf(dir), line.logPath));
  });

  it('keeps the ledger where it was, and only the logs move', () => {
    const dir = makeRepo();
    expect(runCli(dir, ['check']).status).toBe(0);
    expect(
      fs.existsSync(path.join(dir, '.gates', 'task', 'x12-fixture.jsonl'))
    ).toBe(true);
  });

  it('logs command lists the store, by branch, and says where it is', () => {
    const dir = makeRepo();
    expect(runCli(dir, ['check']).status).toBe(0);
    const listed = runCli(dir, ['logs', '--all']);
    expect(listed.status).toBe(0);
    expect(listed.stdout).toContain(storeOf(dir));
    expect(listed.stdout).toContain('task/x12-fixture/check-');
    expect(listed.stdout).toContain('1 log file(s) from every branch');

    const other = runCli(dir, ['logs', '--branch', 'main']);
    expect(other.stdout).toContain('0 log file(s) for main');

    const bad = runCli(dir, ['logs', '--nope']);
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain('unknown argument');
  });

  it('--failed lists the runs the ledger says failed, and only those', () => {
    const dir = makeRepo();
    expect(runCli(dir, ['check']).status).toBe(0);
    expect(runCli(dir, ['check'], { FAKE_EXIT: '3' }).status).toBe(3);
    const failed = runCli(dir, ['logs', '--failed']);
    expect(failed.stdout).toMatch(
      /1 log file\(s\) for task\/x12-fixture that the ledger says failed/
    );
    const passing = ledgerIn(dir, 'task/x12-fixture').find(
      (entry) => entry.result === 'pass'
    );
    const failing = ledgerIn(dir, 'task/x12-fixture').find(
      (entry) => entry.result === 'fail'
    );
    expect(failed.stdout).toContain(failing.logPath);
    expect(failed.stdout).not.toContain(passing.logPath);
  });
});

describe('logs survive git worktree remove', () => {
  it('the store is the common dir, and the removed worktree is really gone', () => {
    const dir = makeRepo({ branch: 'main' });
    const wtParent = scratch('x12-wt-');
    const worktree = path.join(wtParent, 'removed');
    gitInTempRepo(dir, [
      'worktree',
      'add',
      '-q',
      '-b',
      'task/x12-removed',
      worktree,
      'main',
    ]);

    // A failing gate inside the worktree, so there is evidence worth keeping.
    const run = runCli(worktree, ['check'], { FAKE_EXIT: '4' });
    expect(run.status).toBe(4);
    const [line] = ledgerIn(worktree, 'task/x12-removed');
    const absolute = path.join(storeOf(dir), line.logPath);
    // The proof the store is shared rather than per-worktree: a worktree's log is
    // under the *main* checkout's .git, which `git worktree remove` never touches.
    expect(absolute.startsWith(path.join(fs.realpathSync(dir), '.git'))).toBe(
      true
    );
    expect(fs.existsSync(absolute)).toBe(true);

    gitInTempRepo(dir, ['worktree', 'remove', '--force', worktree]);
    expect(fs.existsSync(worktree)).toBe(false);

    // This is the Q3 assertion: from the surviving checkout, the log is readable.
    const text = fs.readFileSync(absolute, 'utf8');
    expect(text).toContain('fake gate:');
    expect(text).toContain('FAIL ios/core/Core.test.tsx');

    const listed = runCli(dir, ['logs', '--all']);
    expect(listed.stdout).toContain('task/x12-removed/check-');
  });

  it('migrates a pre-X12 .gates/logs/ directory into the store, by copy', () => {
    const dir = makeRepo();
    // A log an older gate.mjs wrote, and a ledger line that names it.
    const legacy = path.join(dir, '.gates', 'logs');
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(
      path.join(legacy, 'check-2026-10-27T00-00-00.000Z.log'),
      'the old log, verbatim\n'
    );
    fs.writeFileSync(
      path.join(legacy, 'check-2026-10-27T00-00-00.000Z.gate.json'),
      '{"version":1,"gate":"check","pid":1,"done":true}\n'
    );
    expect(runCli(dir, ['check']).status).toBe(0);

    const migrated = path.join(
      storeOf(dir),
      '.gates',
      'logs',
      'check-2026-10-27T00-00-00.000Z.log'
    );
    expect(fs.existsSync(migrated)).toBe(true);
    expect(fs.readFileSync(migrated, 'utf8')).toBe('the old log, verbatim\n');
    expect(
      fs.existsSync(
        path.join(
          storeOf(dir),
          '.gates',
          'logs',
          'check-2026-10-27T00-00-00.000Z.gate.json'
        )
      )
    ).toBe(true);
    // A copy, not a move: the original is still where its author left it.
    expect(
      fs.existsSync(path.join(legacy, 'check-2026-10-27T00-00-00.000Z.log'))
    ).toBe(true);

    // And the old line resolves, which is what `export` and `table --full` need.
    const run = runCli(dir, ['export', '--out', 'exported.jsonl']);
    expect(run.status).toBe(0);
  });

  it('applies retention to the store without touching a young log', () => {
    const dir = makeRepo();
    expect(runCli(dir, ['check']).status).toBe(0);
    const store = storeOf(dir);
    const old = path.join(store, 'task', 'x12-fixture', 'ancient-check.log');
    fs.mkdirSync(path.dirname(old), { recursive: true });
    fs.writeFileSync(old, 'stale evidence\n');
    const stale = (Date.UTC(2026, 9, 28) - 60 * 86_400_000) / 1000;
    fs.utimesSync(old, stale, stale);

    const logs = runCli(dir, ['logs']);
    expect(logs.stdout).toContain('retention removed 1 file(s)');
    expect(fs.existsSync(old)).toBe(false);
    // The young log from the run above is untouched, and `logs` still lists it.
    expect(logs.stdout).toContain('task/x12-fixture/check-');
  });
});

/* ---------------------------- export excerpts ---------------------------- */

describe('gate.mjs export attaches failure evidence', () => {
  it('writes an excerpt for the failed run, none for the passed one, and points at it', () => {
    const dir = makeRepo();
    expect(runCli(dir, ['check']).status).toBe(0);
    expect(runCli(dir, ['check'], { FAKE_EXIT: '3' }).status).toBe(3);

    const exported = runCli(dir, ['export', '--task', 'X12']);
    expect(exported.status).toBe(0);

    const ledgerFile = path.join(dir, 'docs', 'tasks', 'X12', 'gates.jsonl');
    expect(fs.existsSync(ledgerFile)).toBe(true);
    const lines = fs
      .readFileSync(ledgerFile, 'utf8')
      .split('\n')
      .filter((raw) => raw.trim() !== '')
      .map((raw) => JSON.parse(raw));
    expect(lines).toHaveLength(2);
    const passed = lines.find((entry) => entry.result === 'pass');
    const failed = lines.find((entry) => entry.result === 'fail');
    expect(passed.failureLogPath).toBeNull();
    expect(typeof failed.failureLogPath).toBe('string');
    expect(failed.failureLogPath).toMatch(
      /^docs\/tasks\/X12\/failures\/.*\.log$/
    );

    const failuresDir = path.join(dir, 'docs', 'tasks', 'X12', 'failures');
    const written = fs.readdirSync(failuresDir);
    // One file for one failure, not two for two runs.
    expect(written).toHaveLength(1);
    expect(written[0]).toBe(path.basename(failed.failureLogPath));

    const excerpt = fs.readFileSync(path.join(failuresDir, written[0]), 'utf8');
    // Failing test names and assertion messages, in their own section rather than
    // only somewhere in the tail: a log shorter than 150 lines repeats everything in
    // the tail, so asserting on the whole file would pass even if the failure list
    // were never written (which is how the first version of this test read).
    const failuresSection = excerpt
      .split('## Failing tests and assertion messages')[1]
      .split('\n## ')[0];
    expect(failuresSection).toContain('FAIL ios/core/Core.test.tsx');
    expect(failuresSection).toContain('Expected: true');
    expect(failuresSection).toContain('Received: false');
    expect(failuresSection).toContain('Switch › renders the checked state');
    // The header a reader needs: which gate, which tree, what load, where the
    // *full* log is.
    expect(excerpt).toContain('# Failure excerpt \u2014 check');
    expect(excerpt).toContain(failed.tree.slice(0, 12));
    expect(excerpt).toContain(`Full log: \`${failed.logPath}\``);
    expect(excerpt).toMatch(/## Last \d+ log line\(s\)/);
    expect(EXCERPT_TAIL_LINES).toBe(150);
    expect(excerpt).toContain('Load: start');
    // And the secret in the log is gone, with the count of what was replaced.
    expect(excerpt).not.toContain('supersecrettokenvalue');
    expect(excerpt).toContain('[scrubbed]');
    expect(exported.stdout).toContain('1 failure excerpt(s)');
    // The count, not just the phrase: an export claiming "0 value(s) scrubbed" over
    // a log that had three tokens in it would read as an all-clear. The fake log
    // prints two assignments and one bare `ghp_`, and the header has to agree with
    // the number of markers the file actually carries.
    expect(exported.stdout).toContain('3 value(s) scrubbed');
    expect(excerpt).toContain('Scrubbed: 3 credential-looking value(s)');
    expect(excerpt.match(/\[scrubbed/g)).toHaveLength(3);
    expect(excerpt).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz123456');
  });

  it('writes nothing at all when the ledger holds only passes', () => {
    const dir = makeRepo();
    expect(runCli(dir, ['check']).status).toBe(0);
    expect(runCli(dir, ['export', '--task', 'X12']).status).toBe(0);
    expect(
      fs.existsSync(path.join(dir, 'docs', 'tasks', 'X12', 'failures'))
    ).toBe(false);
    const [line] = fs
      .readFileSync(
        path.join(dir, 'docs', 'tasks', 'X12', 'gates.jsonl'),
        'utf8'
      )
      .split('\n')
      .filter((raw) => raw.trim() !== '')
      .map((raw) => JSON.parse(raw));
    expect(line.failureLogPath).toBeNull();
  });

  it('copies the other lines byte-for-byte, corrupt ones included', () => {
    const dir = makeRepo();
    expect(runCli(dir, ['check']).status).toBe(0);
    const live = path.join(dir, '.gates', 'task', 'x12-fixture.jsonl');
    // A torn line, as a crash mid-append leaves it. Re-serialising would turn it
    // into a plausible object and lose the fact that it was unreadable.
    fs.appendFileSync(live, '{"gate":"check","tree":\n');
    expect(runCli(dir, ['export', '--task', 'X12']).status).toBe(0);
    const exported = fs
      .readFileSync(
        path.join(dir, 'docs', 'tasks', 'X12', 'gates.jsonl'),
        'utf8'
      )
      .split('\n')
      .filter((raw) => raw.trim() !== '');
    const original = fs
      .readFileSync(live, 'utf8')
      .split('\n')
      .filter((raw) => raw.trim() !== '');
    expect(exported).toHaveLength(2);
    expect(exported[0]).toBe(original[0]);
    expect(exported[1]).toBe('{"gate":"check","tree":');
  });

  it('says so, rather than writing an empty file, when the log cannot be found', () => {
    const dir = makeRepo();
    expect(runCli(dir, ['check'], { FAKE_EXIT: '5' }).status).toBe(5);
    const [line] = ledgerIn(dir, 'task/x12-fixture');
    fs.rmSync(path.join(storeOf(dir), line.logPath), { force: true });
    const exported = runCli(dir, ['export', '--task', 'X12']);
    expect(exported.status).toBe(0);
    expect(exported.stdout).toContain('NOTE no log for the failed `check` run');
    expect(exported.stdout).toContain(storeOf(dir));
    expect(
      fs.existsSync(path.join(dir, 'docs', 'tasks', 'X12', 'failures'))
    ).toBe(false);
  });
});

describe('scrubSecrets (what may be committed)', () => {
  it('replaces assignment-shaped credentials in every spelling the gates print', () => {
    const { text, replaced } = scrubSecrets(
      [
        'NPM_TOKEN=abcdef123456',
        '  "github-token": "gh-secret-value",',
        "export AWS_SECRET_ACCESS_KEY='wJalrEXAMPLEkey'",
        '  password: hunter2hunter2',
        '--api-key abcdefghijkl',
        '<auth>abc123abc123</auth>',
        'https://user:***@example.invalid/x',
      ].join('\n')
    );
    for (const secret of [
      'abcdef123456',
      'gh-secret-value',
      'wJalrEXAMPLEkey',
      'hunter2hunter2',
      'abcdefghijkl',
      'abc123abc123',
      'pw-not-hunter',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text.match(/\[scrubbed\]/g).length).toBe(replaced);
    expect(replaced).toBe(7);
  });

  it('replaces credential shapes that appear bare', () => {
    const text = scrubSecrets(
      'pulled with ghp_abcdefghijklmnopqrstuvwxyz123456 and a JWT eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmnopqrstuvwx'
    ).text;
    expect(text).not.toContain('ghp_');
    expect(text).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });

  it('replaces a PEM private key whole instead of shredding its base64', () => {
    const { text } = scrubSecrets(
      '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0B\nAQEFAASCBKcw\n-----END PRIVATE KEY-----\n'
    );
    expect(text).toBe('[scrubbed: private key]\n');
  });

  it('leaves ordinary log lines alone, which is what makes an excerpt readable', () => {
    const log =
      'PASS ios/core/Core.test.tsx\n' +
      'Tests: 665 passed, 665 total\n' +
      'Transform time: 12.5s\n' +
      'adb -s emulator-5574 shell input tap 100 200\n';
    expect(scrubSecrets(log)).toEqual({ text: log, replaced: 0 });
  });

  it('does not call a keyword argument a credential', () => {
    const log = 'sort_key=name\nmonkey=3 jobs\nkeyframes=1\nsession_count=4\n';
    expect(scrubSecrets(log).text).toBe(log);
  });
});

describe('renderFailureExcerpt', () => {
  const entry = {
    gate: 'harness:android',
    ts: '2026-10-28T09:00:00.000Z',
    tree: 'a'.repeat(64),
    head: 'abcdef123456789',
    branch: 'task/x12-fixture',
    command: 'bun run harness:android',
    result: 'fail',
    exitCode: 1,
    signal: null,
    durationMs: 123_000,
    load: { start: 3, median: 8, max: 40, count: 8, end: 39 },
    logPath: 'task/x12-fixture/harness+android-1.log',
    platform: 'android',
    device: 'emulator-5574',
    lease: 'lease-7',
  };

  it('lifts the device block out of the tail, so the tail is the failure', () => {
    const log = [
      'FAIL Switch renders',
      ...Array.from(
        { length: 400 },
        (unused, index) => `harness output ${index}`
      ),
      'gate: ---- device context (recorded on failure, X12) ----',
      'gate: adb devices',
      '  | emulator-5574 device',
      'gate: ---- end device context ----',
    ].join('\n');
    const { content } = renderFailureExcerpt({ entry, logText: log });
    expect(content).toContain('## Device and run context');
    expect(content).toContain('emulator-5574 device');
    // The tail is run output, not the context block: without the split, the last
    // 150 lines of this log would be nothing but `simctl` and lease output.
    const tail = content.split('## Last')[1];
    expect(tail).toContain('harness output 399');
    expect(tail).not.toContain('emulator-5574 device');
  });

  it('reports the load at both ends, from the line rather than invented', () => {
    const { content } = renderFailureExcerpt({ entry, logText: 'x\n' });
    expect(content).toContain(
      'Load: start 3.00, end 39.00, median 8.00, max 40.00'
    );
    expect(content).toContain('lease `lease-7`');
  });

  it('says when a log had no failure lines rather than printing nothing', () => {
    const { content } = renderFailureExcerpt({
      entry,
      logText: 'build started\n',
    });
    expect(content).toContain('(none matched');
  });

  it('bounds itself, and says it was bounded', () => {
    // Long enough lines that 150 of them exceed the cap: the clamp is about the
    // excerpt's total size, not the number of lines, and a reader of a truncated
    // file has to be able to tell.
    const line = (index) => `line ${index} ${'x'.repeat(1_000)}`;
    const { content } = renderFailureExcerpt({
      entry,
      logText: Array.from({ length: 400 }, (unused, index) => line(index)).join(
        '\n'
      ),
    });
    expect(Buffer.byteLength(content, 'utf8')).toBeLessThanOrEqual(128 * 1024);
    expect(content).toContain('excerpt truncated');
    // The newest lines survive a truncation, because they are the ones nearest the
    // failure; the header survives because it says where the full log is.
    expect(content).toContain('line 399 ');
    expect(content).toContain('Full log:');
  });

  it('names an excerpt after its run, with no path separators', () => {
    const name = failureExcerptName(entry);
    expect(name).toBe('2026-10-28T09-00-00Z--harness+android.log');
    expect(name).not.toContain('/');
  });

  it('only wants a failed run that has a log', () => {
    expect(isFailedRunWithLog(entry)).toBe(true);
    expect(isFailedRunWithLog({ ...entry, result: 'pass' })).toBe(false);
    expect(isFailedRunWithLog({ ...entry, logPath: null })).toBe(false);
    expect(isFailedRunWithLog({ corrupt: true, result: 'fail' })).toBe(false);
  });

  it('splitDeviceContext leaves a log with no block untouched', () => {
    expect(splitDeviceContext('plain\n')).toEqual({
      body: 'plain\n',
      context: null,
    });
  });
});

describe('failureLinesFrom (what the excerpt leads with)', () => {
  it('takes the gate tools’ own failure bullets and assertion lines', () => {
    expect(
      failureLinesFrom(
        [
          'PASS ios/core/ok.test.tsx',
          'FAIL ios/core/Core.test.tsx',
          '  ● Switch › renders the checked state',
          '    ✕ updates on press',
          '    ✗ the thumb moved',
          '    Expected: true',
          '    Received: false',
          '    ✓ a passing check',
          'Tests: 3 failed, 662 passed, 665 total',
        ].join('\n')
      )
    ).toEqual([
      'FAIL ios/core/Core.test.tsx',
      '● Switch › renders the checked state',
      '✕ updates on press',
      '✗ the thumb moved',
      'Expected: true',
      'Received: false',
    ]);
  });

  it('caps the list, because a log where everything failed is not an excerpt', () => {
    const lines = Array.from({ length: 50 }, (unused, i) => `✕ test ${i}`).join(
      '\n'
    );
    expect(failureLinesFrom(lines, 5)).toHaveLength(5);
  });
});

describe('summarizeLoad carries the end sample (X12)', () => {
  it('reports the last sample it measured', () => {
    expect(summarizeLoad({ start: 1, samples: [1, 20, 30] }).end).toBe(30);
    expect(summarizeLoad({ start: 1, samples: [] }).end).toBeNull();
  });
});

/* ----------------------- device context on a failed run -------------------- */

describe('a failed device gate records its device context', () => {
  const leased = {
    NITRO_UI_LEASE_ID: 'lease-x12',
    ANDROID_SERIAL: 'emulator-5574',
    NITRO_UI_HOME: null,
  };

  function leasesFileFor(dir) {
    const home = path.join(dir, 'lease-home');
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(
      path.join(home, 'leases.json'),
      JSON.stringify({
        leases: [
          {
            id: 'lease-x12',
            task: 'X12',
            platform: 'android',
            holds: ['pair-2.android'],
            acquiredAt: Date.now() - 60_000,
            ttlMinutes: 120,
            exclusive: false,
          },
        ],
      })
    );
    return home;
  }

  function failedDeviceRun(dir, extraEnv = {}, hook = '') {
    const home = leasesFileFor(dir);
    const run = runCli(
      dir,
      ['harness:android'],
      {
        ...leased,
        NITRO_UI_HOME: home,
        FAKE_EXIT: '1',
        ...extraEnv,
      },
      hook
    );
    return { run, home };
  }

  it('appends simctl, adb, the lease list and load1 to the log', () => {
    const dir = makeRepo();
    const { run } = failedDeviceRun(dir);
    expect(run.status).toBe(1);
    const [line] = ledgerIn(dir, 'task/x12-fixture');
    const log = fs.readFileSync(path.join(storeOf(dir), line.logPath), 'utf8');
    expect(run.stderr).toContain('appended the device context');
    expect(log).toContain('device context (recorded on failure, X12)');
    expect(log).toContain('simctl list devices booted');
    expect(log).toContain('iPhone 17');
    expect(log).toContain('adb devices');
    expect(log).toContain('lease file:');
    expect(log).toContain('lease-x12');
    expect(log).toContain('load1');
    expect(log).toContain('---- end device context ----');
  });

  it('adds logcat for the app pid, addressed only to the leased serial', () => {
    const dir = makeRepo();
    const { run } = failedDeviceRun(dir);
    const asked = fs.readFileSync(run.calls, 'utf8');
    expect(asked).toContain('adb -s emulator-5574 devices');
    expect(asked).toContain('adb -s emulator-5574 shell pidof nitroui.example');
    expect(asked).toContain('adb -s emulator-5574 logcat -d --pid 4242');
    const [line] = ledgerIn(dir, 'task/x12-fixture');
    const log = fs.readFileSync(path.join(storeOf(dir), line.logPath), 'utf8');
    const context = splitDeviceContext(log).context;
    // 500 of 600, and the label says so: the cap is real, and it is the newest
    // lines that survive.
    expect(context).toContain('last 500 of 600 lines');
    expect(context).toContain('logcat line 600');
    expect(context).not.toContain('logcat line 100\n');
  });

  it('never addresses the maintainer’s reserved emulator, and says why', () => {
    const dir = makeRepo();
    const { run } = failedDeviceRun(dir, { ANDROID_SERIAL: 'emulator-5560' });
    expect(run.status).toBe(1);
    // The fake adb was never invoked with the reserved serial, in either command.
    const asked = fs.existsSync(run.calls)
      ? fs.readFileSync(run.calls, 'utf8')
      : '';
    expect(asked).not.toContain('-s emulator-5560');
    const [line] = ledgerIn(dir, 'task/x12-fixture');
    const log = fs.readFileSync(path.join(storeOf(dir), line.logPath), 'utf8');
    expect(log).toContain('refused');
    expect(log).toContain('reserved');
  });

  it('refuses an unqualified adb devices when the lease gave no serial', () => {
    const dir = makeRepo();
    const { run } = failedDeviceRun(dir, { ANDROID_SERIAL: undefined });
    expect(run.status).toBe(1);
    const asked = fs.existsSync(run.calls)
      ? fs.readFileSync(run.calls, 'utf8')
      : '';
    // simctl is still fine to ask (it is host-wide, not another task's device), but
    // adb without a serial would list the maintainer's emulator too.
    expect(asked).toContain('simctl');
    expect(asked).not.toContain('adb devices');
    const [line] = ledgerIn(dir, 'task/x12-fixture');
    const log = fs.readFileSync(path.join(storeOf(dir), line.logPath), 'utf8');
    expect(log).toContain('no serial from the lease');
  });

  it('still records the gate result when a probe itself fails', () => {
    const dir = makeRepo();
    const { run } = failedDeviceRun(dir, { FAKE_DEVICE_EXIT: '127' });
    expect(run.status).toBe(1);
    const [line] = ledgerIn(dir, 'task/x12-fixture');
    expect(line.result).toBe('fail');
    expect(line.exitCode).toBe(1);
    const log = fs.readFileSync(path.join(storeOf(dir), line.logPath), 'utf8');
    expect(log).toContain('[unavailable]');
    // And the excerpt is still worth committing.
    expect(runCli(dir, ['export', '--task', 'X12']).status).toBe(0);
    const failures = fs.readdirSync(
      path.join(dir, 'docs', 'tasks', 'X12', 'failures')
    );
    expect(failures).toHaveLength(1);
  });

  it('does not feed a failed probe’s error text to the next command', () => {
    const dir = makeRepo();
    // `pidof` fails here, and a probe that returns its error text as if it were the
    // answer would hand `adb logcat --pid` a paragraph of shell error. Found by the
    // first version of this function, when a test's own fake adb broke syntax.
    const { run } = failedDeviceRun(dir, { FAKE_ADB_PIDOF_FAIL: '1' });
    expect(run.status).toBe(1);
    const asked = fs.readFileSync(run.calls, 'utf8');
    expect(asked).toContain('pidof');
    expect(asked).not.toContain('logcat');
    const [line] = ledgerIn(dir, 'task/x12-fixture');
    const log = fs.readFileSync(path.join(storeOf(dir), line.logPath), 'utf8');
    expect(log).toContain('no nitroui.example process on emulator-5574');
    expect(log).not.toContain('device offline');
  });

  it('does not probe anything for a non-device gate', () => {
    const dir = makeRepo();
    const run = runCli(dir, ['check'], { ...leased, FAKE_EXIT: '1' });
    expect(run.status).toBe(1);
    expect(fs.existsSync(run.calls)).toBe(false);
    const [line] = ledgerIn(dir, 'task/x12-fixture');
    const log = fs.readFileSync(path.join(storeOf(dir), line.logPath), 'utf8');
    expect(log).not.toContain('device context');
  });

  it('the excerpt separates the device block from the tail for real logs too', () => {
    const dir = makeRepo();
    const { run } = failedDeviceRun(dir);
    expect(run.status).toBe(1);
    expect(runCli(dir, ['export', '--task', 'X12']).status).toBe(0);
    const failures = fs.readdirSync(
      path.join(dir, 'docs', 'tasks', 'X12', 'failures')
    );
    const excerpt = fs.readFileSync(
      path.join(dir, 'docs', 'tasks', 'X12', 'failures', failures[0]),
      'utf8'
    );
    expect(excerpt).toContain('## Device and run context');
    expect(excerpt).toContain('FAIL ios/core/Core.test.tsx');
    // The harness output, not the probes, is what fills the tail.
    expect(excerpt.split('## Last')[1]).toContain('fake gate:');
  });
});

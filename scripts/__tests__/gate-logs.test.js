/* global Atomics, SharedArrayBuffer */
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
 *
 * The `NITRO_UI_*`, `ANDROID_SERIAL` and `IOS_SIM*` variables are dropped for the
 * same reason in the other direction (review N8): the suite is routinely run from a
 * dev shell that has sourced a lease, or from under a backgrounded `gate.mjs` (which
 * exports `NITRO_UI_GATE_LOG`), and any of those would silently retarget a fixture -
 * its store, its device, or its log path - so a test could pass or fail depending on
 * who typed `bun run test`.
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
  for (const name of Object.keys(env)) {
    if (
      name.startsWith('NITRO_UI_') ||
      name === 'ANDROID_SERIAL' ||
      name === 'ANDROID_AVD' ||
      name === 'EMULATOR_PORT' ||
      name.startsWith('IOS_SIM')
    ) {
      delete env[name];
    }
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
    // Two things the excerpt has to survive: a header credential (M5) and a path
    // under the home directory (M4), the shape a jest stack trace leaves in a log.
    'echo "Authorization: Bearer abcdef0123456789secretvalue"\n' +
    'echo "    at Object.<anonymous> ($HOME/work/oss/repo/example/index.js:7:3)"\n' +
    // The other machine-identifying path a real failure prints: jest names every
    // temp fixture by its absolute scratch path, which on macOS carries the per-user
    // folder hash. Round 1's own exported excerpt is what proved it still leaked.
    `echo "  in ${fs.realpathSync(os.tmpdir())}/x12-jest-fixture"\n` +
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
      // `get-state` is the only "is your device there" question the gate asks. It
      // answers with a state, not a device list, because a list would name devices
      // this task does not own - which is the whole reason for using it (N5).
      `if grep -q ' get-state ' "${argsFile}"; then\n` +
      '  echo device\n' +
      '  exit ${FAKE_DEVICE_EXIT:-0}\n' +
      'fi\n' +
      `if grep -q ' devices ' "${argsFile}"; then\n` +
      '  echo "List of devices attached"\n' +
      '  echo "emulator-5560 device"\n' +
      '  echo "emulator-9999 device"\n' +
      '  exit 0\n' +
      'fi\n' +
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

/**
 * Every background record in a fixture's store, read straight off disk.
 *
 * A detached run writes its record before it prints anything, so this is the one way
 * to ask "what did the launcher record?" without going through the CLI that reads it
 * back - which is the point when the field under test is the one the reader filters on.
 */
function storedRecords(dir) {
  const found = [];
  const walk = (current) => {
    let names;
    try {
      names = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of names) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.name.endsWith('.gate.json')) {
        try {
          found.push(JSON.parse(fs.readFileSync(absolute, 'utf8')));
        } catch {
          /* mid-write: the next poll reads it */
        }
      }
    }
  };
  walk(storeOf(dir));
  return found;
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
      /1 log file\(s\) for task\/x12-fixture that the store says failed/
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

  it('lists a removed worktree’s logs by branch, and knows they failed (M2)', () => {
    // The orchestrator's cleanup step is `gate.mjs logs --branch <b> --failed`
    // (ORCHESTRATOR.md), run from a *surviving* checkout after the worktree is gone.
    // Two things had to be fixed for that to work: a nested branch name is read from
    // the whole relative path (a directory listing only saw `task`), and pass/fail
    // comes from the store's own record (the ledger went with the worktree).
    const dir = makeRepo({ branch: 'main' });
    const wtParent = scratch('x12-wt-');
    const worktree = path.join(wtParent, 'nested');
    gitInTempRepo(dir, [
      'worktree',
      'add',
      '-q',
      '-b',
      'task/x12-nested/deep',
      worktree,
      'main',
    ]);
    expect(runCli(worktree, ['check'], { FAKE_EXIT: '4' }).status).toBe(4);
    expect(runCli(worktree, ['check']).status).toBe(0);
    gitInTempRepo(dir, ['worktree', 'remove', '--force', worktree]);
    expect(fs.existsSync(worktree)).toBe(false);

    const byBranch = runCli(dir, ['logs', '--branch', 'task/x12-nested/deep']);
    expect(byBranch.stdout).toContain('2 log file(s) for task/x12-nested/deep');

    // And the filtered form, which is the one the cleanup doc tells you to run.
    const failed = runCli(dir, [
      'logs',
      '--branch',
      'task/x12-nested/deep',
      '--failed',
    ]);
    expect(failed.stdout).toContain('1 log file(s)');
    expect(failed.stdout).toContain('that the store says failed');
    // The pass is not in there, so the count is a judgement and not a listing.
    expect(failed.stdout.match(/check-/g)).toHaveLength(1);
  });

  it('says it cannot tell, rather than "0 failed", when a stored log has no record (M2)', () => {
    // A log someone dropped into the store by hand (or one whose record was pruned):
    // the honest answer is "unknown", because "0 failed" reads as all-clear.
    const dir = makeRepo();
    expect(runCli(dir, ['check']).status).toBe(0);
    const orphan = path.join(
      storeOf(dir),
      'task',
      'x12-fixture',
      'orphan-no-record.log'
    );
    fs.writeFileSync(orphan, 'a log with no record beside it\n');

    const failed = runCli(dir, ['logs', '--failed']);
    expect(failed.stdout).toContain('could not be judged');
    expect(failed.stdout).toContain('pass or fail is unknown');
  });

  it('writes the log the ledger names, when a legacy launcher points at .gates/logs (N7)', () => {
    // An older `gate.mjs` starts a background run with `NITRO_UI_GATE_LOG` inside the
    // worktree's own `.gates/logs/`. The runner used to join that *name* onto the
    // store, so the file it wrote and the path the record and ledger named were
    // different files, and the reader was sent to one that did not exist.
    const dir = makeRepo();
    const legacy = path.join(dir, '.gates', 'logs');
    fs.mkdirSync(legacy, { recursive: true });
    const chosen = path.join(legacy, 'check-from-legacy-launcher.log');
    const run = runCli(dir, ['check'], { NITRO_UI_GATE_LOG: chosen });
    expect(run.status).toBe(0);

    // The file that was opened is the file that was written...
    expect(fs.existsSync(chosen)).toBe(true);
    expect(fs.readFileSync(chosen, 'utf8')).toContain('fake gate:');
    // ...and it is the one the ledger points at, in the legacy spelling.
    const [line] = ledgerIn(dir, 'task/x12-fixture');
    expect(line.logPath).toBe('.gates/logs/check-from-legacy-launcher.log');
    // Which is why the migration is not needed to read it back: it resolves through
    // this checkout, and `export` can excerpt it.
    expect(runCli(dir, ['export', '--task', 'X12']).status).toBe(0);
  });

  it('ignores an NITRO_UI_GATE_LOG that points outside the store (N7)', () => {
    const dir = makeRepo();
    const elsewhere = path.join(scratch('x12-outside-'), 'stolen.log');
    const run = runCli(dir, ['check'], { NITRO_UI_GATE_LOG: elsewhere });
    expect(run.status).toBe(0);
    expect(run.stderr).toContain('ignoring NITRO_UI_GATE_LOG');
    expect(fs.existsSync(elsewhere)).toBe(false);
    const [line] = ledgerIn(dir, 'task/x12-fixture');
    // It behaved exactly like a foreground run: a log in the store, under the branch.
    expect(line.logPath.startsWith('task/x12-fixture/')).toBe(true);
    expect(fs.existsSync(path.join(storeOf(dir), line.logPath))).toBe(true);
  });

  it('migrates a pre-X12 .gates/logs/ directory into the store, by copy', () => {
    const dir = makeRepo();
    // A log an older gate.mjs wrote, a ledger line that names it, and an old mtime -
    // the three things a migrated file has to keep: its bytes, its resolvability,
    // and its place in the 35-day queue.
    const legacy = path.join(dir, '.gates', 'logs');
    fs.mkdirSync(legacy, { recursive: true });
    const oldName = 'check-2026-10-27T00-00-00.000Z.log';
    const oldFile = path.join(legacy, oldName);
    fs.writeFileSync(
      oldFile,
      'the old log, verbatim\nFAIL old/Core.test.tsx\n'
    );
    // Ten days old: inside the 35-day window, so it survives the run that migrates
    // it, and outside the two-hour grace, so a run that ignored its mtime would be
    // visibly wrong about it.
    const stale = (Date.now() - 10 * 86_400_000) / 1000;
    fs.utimesSync(oldFile, stale, stale);
    fs.writeFileSync(
      path.join(legacy, 'check-2026-10-27T00-00-00.000Z.gate.json'),
      '{"version":1,"gate":"check","pid":1,"done":true}\n'
    );
    expect(runCli(dir, ['check']).status).toBe(0);
    // A *failed* line naming the legacy log, so the export below has something to
    // find. Without it the export resolves nothing and exits 0 whatever happens,
    // which is how the first version of this check proved nothing at all (N3).
    fs.appendFileSync(
      path.join(dir, '.gates', 'task', 'x12-fixture.jsonl'),
      `${JSON.stringify({
        v: 5,
        ts: '2026-10-27T00:00:00.000Z',
        gate: 'check',
        command: 'bun run check',
        tree: 'b'.repeat(64),
        head: 'dead000',
        branch: 'task/x12-fixture',
        result: 'fail',
        exitCode: 1,
        logPath: `.gates/logs/${oldName}`,
      })}\n`
    );

    const migrated = path.join(
      storeOf(dir),
      '.gates',
      'logs',
      'task/x12-fixture',
      oldName
    );
    expect(fs.existsSync(migrated)).toBe(true);
    expect(fs.readFileSync(migrated, 'utf8')).toBe(
      'the old log, verbatim\nFAIL old/Core.test.tsx\n'
    );
    expect(
      fs.existsSync(
        path.join(
          storeOf(dir),
          '.gates',
          'logs',
          'task/x12-fixture',
          'check-2026-10-27T00-00-00.000Z.gate.json'
        )
      )
    ).toBe(true);
    // And it kept its mtime (N4), or retention would give a two-month-old log a
    // fresh 35-day clock and the size cap would sort it as the newest thing there.
    expect(Math.round(fs.statSync(migrated).mtimeMs / 1000)).toBe(
      Math.round(fs.statSync(oldFile).mtimeMs / 1000)
    );

    // And the copy that survives: remove the worktree's own copy, which is what
    // `git worktree remove` does to the file a pre-X12 line names. The export below
    // can only produce an excerpt if it resolves the migrated copy through the store.
    fs.rmSync(oldFile);
    expect(fs.existsSync(migrated)).toBe(true);

    // The part that used to be vacuous: the old line has to *resolve*, which the
    // export proves by writing an excerpt for it. `--out` would take the "no task, no
    // failures directory" path and exit 0 without reading a byte of the log.
    const run = runCli(dir, ['export', '--task', 'X12']);
    expect(run.status).toBe(0);
    const committed = fs
      .readFileSync(
        path.join(dir, 'docs', 'tasks', 'X12', 'gates.jsonl'),
        'utf8'
      )
      .split('\n')
      .filter((raw) => raw.trim() !== '')
      .map((raw) => JSON.parse(raw))
      .find((entry) => entry.result === 'fail');
    expect(committed.logPath).toBe(`.gates/logs/${oldName}`);
    expect(typeof committed.failureLogPath).toBe('string');
    expect(fs.existsSync(path.join(dir, committed.failureLogPath))).toBe(true);
    // The excerpt is of the *migrated* log, which is the only copy the export could
    // have read from a worktree that is no longer there.
    const excerpt = fs.readFileSync(
      path.join(dir, committed.failureLogPath),
      'utf8'
    );
    expect(excerpt).toContain('FAIL old/Core.test.tsx');
  });

  it('migrates each worktree’s legacy logs, not just the first one to run (M3)', () => {
    const dir = makeRepo({ branch: 'main' });
    const wtParent = scratch('x12-wt-');
    const wtA = path.join(wtParent, 'a');
    const wtB = path.join(wtParent, 'b');
    gitInTempRepo(dir, [
      'worktree',
      'add',
      '-q',
      '-b',
      'task/wt-a',
      wtA,
      'main',
    ]);
    gitInTempRepo(dir, [
      'worktree',
      'add',
      '-q',
      '-b',
      'task/wt-b',
      wtB,
      'main',
    ]);
    // Both have pre-X12 logs, and one of them has a *same-named* log with different
    // bytes - the collision a per-clone marker used to hide by never migrating B.
    for (const [worktree, content] of [
      [wtA, 'A wrote this\n'],
      [wtB, 'B wrote this, and it is a different size\n'],
    ]) {
      const legacy = path.join(worktree, '.gates', 'logs');
      fs.mkdirSync(legacy, { recursive: true });
      fs.writeFileSync(
        path.join(legacy, 'check-2026-10-27T00-00-00.000Z.log'),
        content
      );
    }
    expect(runCli(wtA, ['check']).status).toBe(0);
    expect(runCli(wtB, ['check']).status).toBe(0);

    // Both are in the store, under their own branch, with their own bytes: the
    // marker is per worktree, and the branch keeps the same file name apart.
    const storedA = path.join(
      storeOf(dir),
      '.gates',
      'logs',
      'task/wt-a',
      'check-2026-10-27T00-00-00.000Z.log'
    );
    const storedB = path.join(
      storeOf(dir),
      '.gates',
      'logs',
      'task/wt-b',
      'check-2026-10-27T00-00-00.000Z.log'
    );
    expect(fs.existsSync(storedA)).toBe(true);
    expect(fs.existsSync(storedB)).toBe(true);
    expect(fs.readFileSync(storedA, 'utf8')).toBe('A wrote this\n');
    expect(fs.readFileSync(storedB, 'utf8')).toBe(
      'B wrote this, and it is a different size\n'
    );
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

  it('prunes on every run, not only when `logs` is asked (N1)', () => {
    // The `logs` command prunes by itself, so a test that only used it could not
    // tell "retention runs on every gate" from "retention runs when you list". A run
    // says out loud what it deleted - which is both the audit trail and what this
    // asserts, since the *launcher's* stderr is its own while a detached child's is
    // the log. Mutation check: deleting `pruneStoredLogs()` from `runGate` goes red
    // here (no line, and the file survives) and stays green for the `logs` test.
    const dir = makeRepo();
    const store = storeOf(dir);
    const old = path.join(store, 'task', 'x12-fixture', 'ancient-check.log');
    fs.mkdirSync(path.dirname(old), { recursive: true });
    fs.writeFileSync(old, 'stale evidence\n');
    const stale = (Date.now() - 60 * 86_400_000) / 1000;
    fs.utimesSync(old, stale, stale);

    const run = runCli(dir, ['check']);
    expect(run.status).toBe(0);
    expect(run.stderr).toContain('retention removed 1 stored log file(s)');
    expect(run.stderr).toContain('age');
    expect(fs.existsSync(old)).toBe(false);
  });

  it('prunes on a backgrounded launch too (N1)', () => {
    // The other call site: the launcher prunes before it opens its log, which is a
    // different line of code from the one `runGate` calls - and the only place a
    // detached run's own pruning could be seen is in its log, never in the launcher's
    // stderr. So asserting the line here proves the launcher does it, not the child.
    const dir = makeRepo();
    const store = storeOf(dir);
    const old = path.join(store, 'task', 'x12-fixture', 'ancient-check.log');
    fs.mkdirSync(path.dirname(old), { recursive: true });
    fs.writeFileSync(old, 'stale evidence\n');
    const stale = (Date.now() - 60 * 86_400_000) / 1000;
    fs.utimesSync(old, stale, stale);

    const started = runCli(dir, ['check', '--background']);
    expect(started.status).toBe(0);
    expect(started.stderr).toContain('retention removed 1 stored log file(s)');
    expect(fs.existsSync(old)).toBe(false);
  });

  it('keeps a log belonging to a gate that is still running (N2)', () => {
    // A bench that has been going for 36 days (an exclusive run on a machine left
    // alone over a month) has a log whose mtime is its start time, so it is past the
    // 35-day age rule and the only thing between it and the sweep is the record that
    // says the run is alive: `runningLogGraceMs` extends the grace to cover every
    // running record. Mutation check: `grace = base` in that function makes this red
    // (the log goes away, and the count drops to 2) while the age and size rule tests
    // stay green - which is the hole the review found.
    const dir = makeRepo();
    const store = storeOf(dir);
    const day = 86_400_000;
    const running = path.join(store, 'task', 'x12-fixture', 'bench-36d.log');
    const finished = path.join(store, 'task', 'x12-fixture', 'bench-60d.log');
    fs.mkdirSync(path.dirname(running), { recursive: true });
    fs.writeFileSync(running, 'still running\n');
    fs.writeFileSync(finished, 'a long-finished bench\n');
    for (const [file, ageDays] of [
      [running, 36],
      [finished, 60],
    ]) {
      const aged = (Date.now() - ageDays * day) / 1000;
      fs.utimesSync(file, aged, aged);
    }
    // The record for the one that is alive: `done: false`, started 36 days ago, with
    // this process' own pid - the cheapest thing the fixture can assert is alive.
    fs.writeFileSync(
      `${running.replace(/\.log$/, '')}.gate.json`,
      JSON.stringify({
        version: 1,
        gate: 'bench',
        pid: process.pid,
        startedAt: Date.now() - 36 * day,
        logPath: 'task/x12-fixture/bench-36d.log',
        done: false,
        branch: 'task/x12-fixture',
        worktree: fs.realpathSync(dir),
      })
    );

    const pruned = runCli(dir, ['logs', '--prune']);
    expect(pruned.status).toBe(0);
    // Exactly one victim: the 60-day-old log nothing claims. The 36-day one is older
    // than the retention window and survives anyway, on the record alone.
    expect(pruned.stdout).toContain('retention removed 1 file(s)');
    expect(fs.existsSync(running)).toBe(true);
    expect(fs.existsSync(finished)).toBe(false);
  });

  it('does not adopt a sibling worktree’s background run (M1)', () => {
    // Two checkouts, one shared store, **one branch** - the review's repro, and the
    // reason matching on the branch alone is not enough: `git worktree add -f` puts
    // the same branch in two checkouts, so two agents pointed at one branch is a real
    // configuration. Before the fix `wait` picked the newest record for the gate name
    // out of the whole store, so a passing run in C reported another worktree's exit 7
    // and exited 7 itself.
    const dir = makeRepo({ branch: 'main' });
    const branch = 'task/x12-dup';
    const wtParent = scratch('x12-wt-');
    const worktree = path.join(wtParent, 'sibling');
    gitInTempRepo(dir, ['branch', branch, 'main']);
    gitInTempRepo(dir, ['worktree', 'add', '-f', '-q', worktree, branch]);
    // Both checkouts end up on that branch, which is the whole point of the fixture.
    gitInTempRepo(dir, ['checkout', '--ignore-other-worktrees', '-q', branch]);
    expect(gitInTempRepo(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(
      branch
    );
    expect(gitInTempRepo(worktree, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(
      branch
    );

    // The sibling's record: finished, failing, *newer*, and on the same branch as
    // ours, so any rule weaker than "started in this checkout" picks it.
    const theirs = path.join(storeOf(dir), branch, 'check-10.log');
    fs.mkdirSync(path.dirname(theirs), { recursive: true });
    fs.writeFileSync(theirs, 'the other worktree ran this\n');
    fs.writeFileSync(
      theirs.replace(/\.log$/, '.gate.json'),
      JSON.stringify({
        version: 1,
        gate: 'check',
        pid: 4100,
        startedAt: Date.parse('2026-10-28T10:00:00.000Z'),
        logPath: `${branch}/check-10.log`,
        done: true,
        exitCode: 7,
        result: 'fail',
        branch,
        worktree: fs.realpathSync(worktree),
      })
    );
    // Ours: same branch, older, still open, owned by this test's own pid.
    const ours = path.join(storeOf(dir), branch, 'check-09.log');
    fs.writeFileSync(ours, 'gate: check\nthis worktree ran this\n');
    fs.writeFileSync(
      ours.replace(/\.log$/, '.gate.json'),
      JSON.stringify({
        version: 1,
        gate: 'check',
        pid: process.pid,
        startedAt: Date.parse('2026-10-28T09:00:00.000Z'),
        logPath: `${branch}/check-09.log`,
        done: false,
        branch,
        worktree: fs.realpathSync(dir),
      })
    );

    // `wait` in the checkout that owns the older record must not pick the newer one.
    // It has no ledger line and its pid is this test's own, so the answer is "still
    // running" (13) after a deliberately tiny budget - and the progress line it
    // prints is the last line of *our* log.
    const wait = runCli(dir, [
      'wait',
      '--gate',
      'check',
      '--timeout-minutes',
      '0.01',
    ]);
    expect(wait.stderr).toContain('this worktree ran this');
    expect(wait.stderr).not.toContain('the other worktree ran this');
    expect(wait.status).toBe(13);

    // And the sibling still sees *its own* finished run: exit 7, the exit code of the
    // gate it ran, not ours. Scoping must not hide a worktree's own results, which is
    // what the `worktree` field is for in both directions.
    const other = runCli(worktree, ['wait', '--gate', 'check']);
    expect(other.status).toBe(7);
    expect(other.stderr).toContain('failed with exit 7');

    // `status` likewise reports only its own run as running.
    const status = runCli(dir, ['status']);
    expect(status.stdout).toContain('running check');
    expect(status.stdout).toContain(String(process.pid));
    expect(status.stdout).not.toContain('4100');
  });

  it('records which worktree started a background run (M1)', () => {
    // The field the scoping above reads, asserted where it is written. A record
    // without it is a record no `wait` can attribute, and the "records predating this
    // scoping match anything" fallback would then apply to every future run - which is
    // the bug returning while every test above stayed green.
    const dir = makeRepo();
    expect(runCli(dir, ['check', '--background']).status).toBe(0);
    const deadline = Date.now() + 20_000;
    let records = [];
    while (Date.now() < deadline) {
      records = storedRecords(dir);
      if (records.some((record) => record.gate === 'check')) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
    const ours = records.filter((record) => record.gate === 'check');
    expect(ours).toHaveLength(1);
    expect(ours[0]).toMatchObject({
      branch: 'task/x12-fixture',
      worktree: fs.realpathSync(dir),
    });
    // And it is a store-relative path, so a reader in another worktree can resolve it.
    expect(ours[0].logPath.startsWith('task/x12-fixture/')).toBe(true);
  });

  it('migrates a worktree’s legacy logs even when another worktree already migrated (M3)', () => {
    // The M3 case in one line of code: the marker used to live in the *shared* store,
    // so the first worktree to migrate stopped every other one from ever doing it, and
    // the second's pre-X12 logs died with it - the exact loss X12 exists to prevent.
    // Mutation check: `path.join(location.dir, MIGRATION_NOTE)` for the note's path
    // does not reproduce it any more (see `writeMigrationNote`: the note is provenance,
    // never a gate), so the honest proof is that nothing here can skip the copy -
    // `migrateWorktreeLogs` has no marker read in it at all, which `logs --all` after
    // two worktrees' runs pins down from the outside.
    const dir = makeRepo({ branch: 'main' });
    const wtParent = scratch('x12-wt-');
    const [wtA, wtB] = ['a', 'b'].map((name) => path.join(wtParent, name));
    for (const [worktree, branch] of [
      [wtA, 'task/x12-mig-a'],
      [wtB, 'task/x12-mig-b'],
    ]) {
      gitInTempRepo(dir, ['branch', branch, 'main']);
      gitInTempRepo(dir, ['worktree', 'add', '-q', worktree, branch]);
      const legacy = path.join(worktree, '.gates', 'logs');
      fs.mkdirSync(legacy, { recursive: true });
      // Same file name in both, different bytes: the collision the review warned
      // about once the copy actually runs per worktree.
      fs.writeFileSync(
        path.join(legacy, 'check-2026-10-27T00-00-00.000Z.log'),
        `${branch} wrote this, and the sizes differ on purpose\n`
      );
    }
    expect(runCli(wtA, ['check']).status).toBe(0);
    expect(runCli(wtB, ['check']).status).toBe(0);

    for (const branch of ['task/x12-mig-a', 'task/x12-mig-b']) {
      const stored = path.join(
        storeOf(dir),
        '.gates',
        'logs',
        branch,
        'check-2026-10-27T00-00-00.000Z.log'
      );
      expect(fs.readFileSync(stored, 'utf8')).toContain(`${branch} wrote this`);
    }
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
    // Store-relative, because that is the spelling `gate.mjs logs` takes and the one
    // that means the same thing on every machine.
    expect(excerpt).toContain(`Full log: \`${failed.logPath}\``);
    expect(excerpt).toContain(`<store>/${failed.logPath}`);
    expect(excerpt).toMatch(/## Last \d+ log line\(s\)/);
    expect(EXCERPT_TAIL_LINES).toBe(150);
    expect(excerpt).toContain('Load: start');
    // And the secret in the log is gone, with the count of what was replaced.
    expect(excerpt).not.toContain('supersecrettokenvalue');
    expect(excerpt).toContain('[scrubbed]');
    expect(exported.stdout).toContain('1 failure excerpt(s)');
    // The count, not just the phrase: an export claiming "0 value(s) scrubbed" over
    // a log that had four credentials in it would read as an all-clear. The fake log
    // prints two assignments, one bare `ghp_` and one `Authorization:` header, and
    // the header has to agree with the number of markers the file actually carries.
    expect(exported.stdout).toContain('4 value(s) scrubbed');
    expect(excerpt).toContain('Scrubbed: 4 credential-looking value(s)');
    expect(excerpt.match(/\[scrubbed/g)).toHaveLength(4);
    expect(excerpt).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz123456');
  });

  it('commits no absolute path anywhere in an excerpt (D25)', () => {
    const dir = makeRepo();
    expect(runCli(dir, ['check'], { FAKE_EXIT: '3' }).status).toBe(3);
    expect(runCli(dir, ['export', '--task', 'X12']).status).toBe(0);
    const failuresDir = path.join(dir, 'docs', 'tasks', 'X12', 'failures');
    const excerpt = fs.readFileSync(
      path.join(failuresDir, fs.readdirSync(failuresDir)[0]),
      'utf8'
    );
    // This is the whole point of the assertion: the header used to print the store's
    // absolute path in *every* excerpt, and the fake log prints a stack frame under
    // $HOME, so both halves of the leak are in this one file.
    const home = os.homedir();
    const store = storeOf(dir);
    expect(excerpt).not.toContain(store);
    expect(excerpt).not.toContain(fs.realpathSync(dir));
    expect(excerpt).not.toContain(home);
    expect(excerpt).not.toContain(os.hostname());
    expect(excerpt).not.toContain('/Users/');
    // And the scratch directory, which is the leak round 1 found in *its own*
    // exported excerpt: `/private/var/folders/x4/<32 chars>/T/...` names the machine
    // as precisely as `$HOME`, and jest prints it for every temp fixture.
    const tmp = fs.realpathSync(os.tmpdir());
    expect(excerpt).not.toContain(tmp);
    expect(excerpt).toContain('<tmp>/x12-jest-fixture');
    // The placeholders in their place, so the file is still useful: a reader on the
    // machine that ran the gate can find the log and knows which checkout ran it.
    // (The fake's HOME *is* the checkout here, so the stack frame reads as `<repo>`
    // rather than `~`: the more specific path wins, which is the point of ordering.)
    expect(excerpt).toContain('<store>/');
    expect(excerpt).toContain('<repo>');
    expect(excerpt).toContain('<repo>/work/oss/repo/example/index.js');
    // And the credential the log carried is gone with the path, not instead of it.
    expect(excerpt).not.toContain('abcdef0123456789secretvalue');
    expect(excerpt).toContain('Authorization: [scrubbed]');
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
    // And the committed line points at nothing rather than at a file that does not
    // exist: a `failureLogPath` on a run whose evidence was never found sends a
    // reader looking for a file that is not there.
    const [committed] = fs
      .readFileSync(
        path.join(dir, 'docs', 'tasks', 'X12', 'gates.jsonl'),
        'utf8'
      )
      .split('\n')
      .filter((raw) => raw.trim() !== '')
      .map((raw) => JSON.parse(raw));
    expect(committed.failureLogPath).toBeNull();
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
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text.match(/\[scrubbed\]/g).length).toBe(replaced);
    expect(replaced).toBe(7);
  });

  it('scrubs Authorization headers in every form a log keeps them in (M5)', () => {
    // The first version replaced the *scheme* - the word `Bearer` - and published the
    // credential next to a `[scrubbed]` marker that read as if it had worked. A curl
    // verbose log, a JSON dump of request options and an env dump are all things a
    // failing `bun install` or a release job prints.
    const cases = [
      [
        'Authorization: Bearer abcdef0123456789secret',
        'abcdef0123456789secret',
      ],
      ['Authorization: Basic dXNlcjpwYXNzd29yZA==', 'dXNlcjpwYXNzd29yZA=='],
      ["curl -H 'Authorization: token 0123456789abcdef'", '0123456789abcdef'],
      [
        '"Authorization": "Bearer abcdef0123456789secret"',
        'abcdef0123456789secret',
      ],
      [
        '{"headers": {"Authorization": "Bearer abcdef0123456789secret"}}',
        'abcdef0123456789secret',
      ],
      [
        'Proxy-Authorization: Negotiate YIIBhwYJKoZIhvcNAQcCo',
        'YIIBhwYJKoZIhvcNAQcCo',
      ],
      ['Cookie: sessionid=abc123def456; other=2', 'abc123def456'],
    ];
    for (const [line, secret] of cases) {
      const result = scrubSecrets(line);
      expect(result.text).not.toContain(secret);
      expect(result.replaced).toBe(1);
      // The header's own key survives, so a reader can still tell which request leaked.
      const [, key] = /([A-Za-z-]+)\s*["']?\s*[:=]/.exec(line);
      expect(result.text).toContain(key);
    }
    // A header inside a quoted shell argument keeps its closing quote.
    expect(
      scrubSecrets("curl -H 'Authorization: token 0123456789abcdef'").text
    ).toBe("curl -H 'Authorization: [scrubbed]'");
  });

  it('scrubs .npmrc registry credentials (M5)', () => {
    // `.npmrc` is INI, not XML: its `_auth=` line is base64 `user:password` for a
    // registry, and a failing `npm publish`/`bun install` is exactly what prints it.
    // The first version's comment claimed `<auth>…</auth>` was npm's format; it is
    // Maven's, and npm's line went out unscrubbed.
    for (const line of [
      '//registry.example.com/:_auth=dXNlcjpwYXNzd29yZA==',
      '_auth=dXNlcjpwYXNzd29yZA==',
      '//registry.example.com/:_authToken=npm_abcdefghijklmnopqrstuvwxyz123456',
      '_password=s3cr3t-reg1stry-password',
    ]) {
      const result = scrubSecrets(line);
      expect(result.text).not.toContain('dXNlcjpwYXNzd29yZA==');
      expect(result.text).not.toContain('s3cr3t-reg1stry-password');
      expect(result.replaced).toBe(1);
      // And the line still says which key it was, which is the useful half.
      expect(result.text).toContain('[scrubbed]');
    }
  });

  it('scrubs a credential dump from an env-printing failure, and keeps the rest', () => {
    // The realistic worst case: one line of a shell that echoed its own environment
    // while failing. Two of these are secrets, two of them are the reason the run is
    // interesting, and an excerpt that shredded all four is not evidence.
    const { text } = scrubSecrets(
      [
        'env dump:',
        '  GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz123456',
        '  NPM_CONFIG_TOKEN=npm_abcdefghijklmnopqrstuvwx123456',
        '  GRADLE_USER_HOME=/Users/dev/.gradle',
        '  ANDROID_HOME=/Users/dev/Library/Android/sdk',
      ].join('\n')
    );
    expect(text).not.toContain('ghp_');
    expect(text).not.toContain('npm_');
    expect(text).toContain('GRADLE_USER_HOME=/Users/dev/.gradle');
    expect(text).toContain('ANDROID_HOME=/Users/dev/Library/Android/sdk');
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

/* --------------------- the scrubber must cost what it reads ---------------- */

describe('scrubSecrets is linear in what it reads (re-review N3)', () => {
  // The re-review measured the *old* patterns under Node 24: 40 KB of `a.` took
  // 12.6 s and 160 KB took 199 s, because `[\w.-]*` before `authorization` and
  // `\b[\w.-]{3,}` restart an unbounded scan at every `.`/`_`/`-` boundary. A gate
  // log that is one long data URI or base64url blob - a Metro bundle graph, a
  // SwiftPM manifest, an xcodebuild `-showBuildSettings` dump - therefore hung
  // `export` for minutes, which is the opposite of "the evidence survives".
  //
  // The budget is 1 s against a workload a linear scan finishes in a few ms, so it
  // cannot flake on a loaded machine; and it is deliberately a *time* assertion,
  // because that is the only way this failure mode is visible from outside.
  const BUDGET_MS = 1000;

  const scrubTimed = (text) => {
    const started = process.hrtime.bigint();
    const result = scrubSecrets(text);
    return {
      ...result,
      ms: Number(process.hrtime.bigint() - started) / 1e6,
    };
  };

  it('scrubs a 1 MB line of `a.` in under a second', () => {
    const result = scrubTimed('a.'.repeat(500_000));
    expect(result.ms).toBeLessThan(BUDGET_MS);
  });

  it('scrubs a 1 MB base64url line in under a second', () => {
    const alphabet =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let line = '';
    for (let i = 0; i < 1_000_000; i += 1) {
      line += alphabet[(i * 7919) % alphabet.length];
    }
    const result = scrubTimed(line);
    expect(result.ms).toBeLessThan(BUDGET_MS);
  });

  it('is not slower when the credential sits at the end of a long run', () => {
    // The shape that costs the old patterns most: no separator until the very last
    // character, so every one of the half-million boundaries is a candidate start
    // that has to fail only after reading the whole rest of the line.
    const result = scrubTimed(
      `a.${'b.'.repeat(499_999)}authorization=abcdef0123456789`
    );
    expect(result.ms).toBeLessThan(BUDGET_MS);
    expect(result.text).not.toContain('abcdef0123456789');
    expect(result.replaced).toBe(1);
  });

  it('is not quadratic in the number of URL-shaped runs', () => {
    // The userinfo rule had the same disease, and worse: 64 KB of `a.` took 3.4 s.
    const result = scrubTimed(`a.${'b.'.repeat(500_000)}@example.invalid`);
    expect(result.ms).toBeLessThan(BUDGET_MS);
  });

  it('is not quadratic in a line of XML-shaped runs', () => {
    const result = scrubTimed('<a>'.repeat(300_000));
    expect(result.ms).toBeLessThan(BUDGET_MS);
  });

  it('still finds the credential shapes inside a long line', () => {
    // The cheap way to pass a timing test is to stop matching things. This is the
    // counterweight: the same shapes the short-line tests assert, now buried at the
    // end of a megabyte of data-URI-looking text.
    const prefix = 'data:application/json;base64,' + 'QUJD'.repeat(250_000);
    const { text } = scrubTimed(
      [
        prefix,
        'ghp_abcdefghijklmnopqrstuvwxyz123456',
        'NPM_TOKEN=abcdef123456',
        'Authorization: Bearer abcdef0123456789secretvalue',
      ].join('\n')
    );
    expect(text).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz123456');
    expect(text).not.toContain('abcdef123456');
    expect(text).not.toContain('abcdef0123456789secretvalue');
    expect(text).toContain('Authorization: [scrubbed]');
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

  it('names an excerpt after its run, and keeps two same-second runs apart', () => {
    const name = failureExcerptName(entry);
    expect(name).toBe('2026-10-28T09-00-00Z--harness+android--01.log');
    expect(name).not.toContain('/');
    // `ts` is second-granular, so a re-run inside the same second has the same ts and
    // gate. Without the sequence the second export would overwrite the first
    // excerpt while both ledger lines still pointed at it.
    expect(failureExcerptName(entry, 2)).toBe(
      '2026-10-28T09-00-00Z--harness+android--02.log'
    );
    expect(failureExcerptName(entry, 2)).not.toBe(name);
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
  // The env a run has after sourcing `lease.mjs acquire`. The serial is here too,
  // and the gate must NOT read it: the probes take the serial from the lease record
  // (N6), so a stale or hand-set variable cannot point them at another task's device.
  const leased = {
    NITRO_UI_LEASE_ID: 'lease-x12',
    ANDROID_SERIAL: 'emulator-5574',
  };

  /**
   * A lease state home: `leases.json` (this run's lease, holding `pair-2`) and
   * `devices.json` (which says that pair's emulator is on 5574). The gate derives
   * the serial from those two files, the same way `lease.mjs acquire` derives the
   * env file it hands out.
   */
  function leaseHomeFor(dir, { lease = true, holds = ['pair-2'] } = {}) {
    const home = path.join(dir, 'lease-home');
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(
      path.join(home, 'leases.json'),
      JSON.stringify({
        leases: lease
          ? [
              {
                id: 'lease-x12',
                task: 'X12',
                platform: 'android',
                holds,
                acquiredAt: Date.now() - 60_000,
                ttlMinutes: 120,
                exclusive: false,
              },
            ]
          : [],
      })
    );
    fs.writeFileSync(
      path.join(home, 'devices.json'),
      JSON.stringify({
        pairs: [
          {
            id: 'pair-2',
            ios: { udid: 'CD670291-1111-1111-1111-111111111111' },
            android: { avd: 'avd_2', emulatorPort: 5574 },
            metroPort: 8297,
          },
          // A second pair, so a test can tell "asked my device" from "asked whoever
          // is in the pool" - and so a device-listing probe would visibly name it.
          {
            id: 'pair-3',
            android: { avd: 'avd_3', emulatorPort: 5576 },
            metroPort: 8298,
          },
        ],
      })
    );
    return home;
  }

  function failedDeviceRun(dir, extraEnv = {}, hook = '', leaseOptions = {}) {
    const home = leaseHomeFor(dir, leaseOptions);
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

  function logOf(dir) {
    const [line] = ledgerIn(dir, 'task/x12-fixture');
    return fs.readFileSync(path.join(storeOf(dir), line.logPath), 'utf8');
  }

  it('appends simctl, the device state, the lease list and load1 to the log', () => {
    const dir = makeRepo();
    const { run } = failedDeviceRun(dir);
    expect(run.status).toBe(1);
    const log = logOf(dir);
    expect(run.stderr).toContain('appended the device context');
    expect(log).toContain('device context (recorded on failure, X12)');
    expect(log).toContain('simctl list devices booted');
    expect(log).toContain('iPhone 17');
    expect(log).toContain('adb get-state');
    expect(log).toContain('lease file:');
    expect(log).toContain('lease-x12');
    expect(log).toContain('load1');
    // The line that makes the block useful from another machine: where the full log
    // is, in the spelling `gate.mjs logs` takes.
    expect(log).toContain('<store>/task/x12-fixture/harness+android-');
    expect(log).toContain('---- end device context ----');
  });

  it('asks the leased device its own state, and never lists devices', () => {
    const dir = makeRepo();
    const { run } = failedDeviceRun(dir);
    const asked = fs.readFileSync(run.calls, 'utf8');
    expect(asked).toContain('adb -s emulator-5574 get-state');
    // `adb devices` is a host-side query: it ignores `-s` and prints every emulator
    // the server sees, which would commit the maintainer's serial in an excerpt. The
    // fake prints such a list when asked, so this assertion has something to catch.
    expect(
      asked
        .split('\n')
        .filter((line) => line.startsWith('adb') && line.includes(' devices'))
    ).toEqual([]);
    const context = splitDeviceContext(logOf(dir)).context;
    expect(context).toContain('device');
    expect(context).not.toContain('List of devices attached');
    expect(context).not.toContain('emulator-9999');
    expect(context).not.toContain('emulator-5560');
  });

  it('adds logcat for the app pid, addressed only to the leased serial', () => {
    const dir = makeRepo();
    const { run } = failedDeviceRun(dir);
    const asked = fs.readFileSync(run.calls, 'utf8');
    expect(asked).toContain('adb -s emulator-5574 shell pidof nitroui.example');
    expect(asked).toContain('adb -s emulator-5574 logcat -d --pid 4242');
    const context = splitDeviceContext(logOf(dir)).context;
    // 500 of 600, and the label says so: the cap is real, and it is the newest
    // lines that survive.
    expect(context).toContain('last 500 of 600 lines');
    expect(context).toContain('logcat line 600');
    expect(context).not.toContain('logcat line 100\n');
  });

  it('takes the serial from the lease record, not from the environment', () => {
    const dir = makeRepo();
    // The env names a serial the pool says nothing about: the lease holds pair-2
    // (5574), `ANDROID_SERIAL` claims 5576. The record wins, because the env is a
    // copy that outlives the shell that sourced it, and the pool is the lease.
    const { run } = failedDeviceRun(dir, { ANDROID_SERIAL: 'emulator-5576' });
    expect(run.status).toBe(1);
    const asked = fs.readFileSync(run.calls, 'utf8');
    expect(asked).toContain('adb -s emulator-5574 get-state');
    expect(asked).not.toContain('-s emulator-5576');
  });

  it('never addresses the maintainer’s reserved emulator, and says why', () => {
    const dir = makeRepo();
    // The pool itself hands out the reserved port - the misconfiguration a lease is
    // supposed to survive. `devices.json` is validated before a pair is read, so the
    // serial is never derived at all and adb is never run against it; the block says
    // which rule refused.
    const home = leaseHomeFor(dir);
    fs.writeFileSync(
      path.join(home, 'devices.json'),
      JSON.stringify({
        pairs: [
          {
            id: 'pair-2',
            android: { avd: 'avd_2', emulatorPort: 5560 },
            metroPort: 8297,
          },
        ],
      })
    );
    const run = runCli(
      dir,
      ['harness:android'],
      { ...leased, NITRO_UI_HOME: home, FAKE_EXIT: '1' },
      ''
    );
    expect(run.status).toBe(1);
    // The fake adb was never invoked with the reserved serial, in either command.
    const asked = fs.existsSync(run.calls)
      ? fs.readFileSync(run.calls, 'utf8')
      : '';
    expect(asked).not.toContain('-s emulator-5560');
    expect(asked).not.toContain('adb');
    const log = logOf(dir);
    expect(log).toContain('refused');
    expect(log).toContain('reserved');
  });

  it('probes no device at all when the run holds no lease', () => {
    const dir = makeRepo();
    // No lease id, so nothing is ours to ask - even though ANDROID_SERIAL is set,
    // which is exactly the leftover-a-shell-leaves case.
    const { run } = failedDeviceRun(dir, { NITRO_UI_LEASE_ID: undefined }, '', {
      lease: false,
    });
    expect(run.status).toBe(1);
    const asked = fs.existsSync(run.calls)
      ? fs.readFileSync(run.calls, 'utf8')
      : '';
    // simctl is still fine to ask (it is host-wide, not another task's device), but
    // adb has no business being run by a task that holds nothing.
    expect(asked).toContain('simctl');
    expect(asked).not.toContain('adb');
    const log = logOf(dir);
    expect(log).toContain('holds no lease');
    expect(log).toContain('no device is ours to ask');
  });

  it('probes nothing for an expired or stolen lease, and says which', () => {
    const dir = makeRepo();
    // The run thinks it holds `lease-x12`; the lease file has no such entry (it
    // expired, or was re-handled). Probing that pair would be reading a device
    // another task now owns.
    const home = leaseHomeFor(dir);
    fs.writeFileSync(
      path.join(home, 'leases.json'),
      JSON.stringify({
        leases: [
          {
            id: 'lease-other',
            task: 'X9',
            platform: 'android',
            holds: ['pair-2'],
            acquiredAt: Date.now(),
            ttlMinutes: 120,
          },
        ],
      })
    );
    const run = runCli(
      dir,
      ['harness:android'],
      { ...leased, NITRO_UI_HOME: home, FAKE_EXIT: '1' },
      ''
    );
    expect(run.status).toBe(1);
    const asked = fs.existsSync(run.calls)
      ? fs.readFileSync(run.calls, 'utf8')
      : '';
    expect(asked).not.toContain('adb');
    expect(logOf(dir)).toContain('lease lease-x12 is no longer live');
  });

  it('still records the gate result when a probe itself fails', () => {
    const dir = makeRepo();
    const { run } = failedDeviceRun(dir, { FAKE_DEVICE_EXIT: '127' });
    expect(run.status).toBe(1);
    const [line] = ledgerIn(dir, 'task/x12-fixture');
    expect(line.result).toBe('fail');
    expect(line.exitCode).toBe(1);
    expect(logOf(dir)).toContain('[unavailable]');
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
    const log = logOf(dir);
    expect(log).toContain('no nitroui.example process on emulator-5574');
    expect(log).not.toContain('device offline');
  });

  it('does not probe anything for a non-device gate', () => {
    const dir = makeRepo();
    const run = runCli(dir, ['check'], { ...leased, FAKE_EXIT: '1' });
    expect(run.status).toBe(1);
    expect(fs.existsSync(run.calls)).toBe(false);
    expect(logOf(dir)).not.toContain('device context');
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

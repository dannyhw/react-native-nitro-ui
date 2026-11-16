/* global Atomics, SharedArrayBuffer */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import {
  LOG_RETENTION_DAYS,
  LOG_RETENTION_MAX_BYTES,
  LOG_STORE_BASENAME,
  gateLogStoreDir,
  ledgerLogCandidates,
  LOG_NAME_GATE_MAX,
  canonicalGateName,
  logNameFor,
  logRelativePath,
  planLogRetention,
  splitDeviceContext,
  summarizeLoad,
} from '../gate-core.mjs';
import { withoutLeaseEnv } from './helpers/scrubbed-env.js';
import { FREE_LSOF } from './helpers/free-lsof-stub.js';
import {
  DEFAULT_PAIR,
  leaseRecord,
  leasedEnv,
  writeLeaseStore,
} from './helpers/lease-store.js';

const CLI = path.join(process.cwd(), 'scripts', 'gate.mjs');

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
 * A git environment that cannot reach a repository other than the one named: the suite
 * runs inside a real clone, and an inherited `GIT_DIR` would send a fixture's commit into
 * it. Lease variables are dropped too, so a sourced lease cannot retarget a fixture.
 */
function gitEnv(dir) {
  const env = { ...withoutLeaseEnv(process.env) };
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
 * A checkout small enough to run a gate in. `.gates/`, the store and `fake-bin/` are
 * gitignored, because an untracked file that counts as code moves the tree mid-run.
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
 * A fake gate runner that prints a Jest summary and exits with `FAKE_EXIT`, plus fake
 * `simctl`/`adb` that record each invocation in `<dir>/fake-bin/calls.log`.
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
  // Two booted simulators: the first UDID is `pair-2`'s, the pair the fixture's lease
  // holds; the second belongs to nobody in the fixture's pool.
  fs.writeFileSync(
    path.join(bin, 'simctl'),
    recorder(
      'simctl',
      'echo "    iPhone 17 (CD670291-1111-1111-1111-111111111111) (Booted)"\n' +
        'echo "    iPhone 16 (1F2D3E4F-AAAA-BBBB-CCCC-DDDDCCCCAAAA) (Booted)"'
    )
  );
  // `adb` branches on grep rather than a `case` glob on `$*`, because the patterns need
  // spaces and stars that quoting fights with. logcat prints 600 lines, more than the
  // 500-line cap.
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
      // `get-state` answers with a state, not a device list. The foreign-serial branch
      // mimics adb naming other devices' serials in its own error text.
      `if grep -qE '(^| )get-state( |$)' "${argsFile}"; then\n` +
      '  if [ -n "${FAKE_ADB_FOREIGN_SERIAL:-}" ]; then\n' +
      "    echo 'adb: error: failed to get feature set: device emulator-5560 not found (also emulator-5561 offline)' >&2\n" +
      '    exit 1\n' +
      '  fi\n' +
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
      // A lease exports its pair's `METRO_PORT`, which the Metro pre-flight probes. On a
      // shared machine another task's Metro may really be on it, so the probe is stubbed.
      ...FREE_LSOF,
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

/** Every background record in a fixture's store, read off disk rather than via the CLI. */
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
    // A branch string that is not a ref must not escape the store.
    expect(() => logRelativePath('../../etc', 'x.log')).toThrow();
  });

  it('names a log after its gate and start time, with no colons', () => {
    const name = logNameFor('harness:android', Date.UTC(2026, 9, 28, 12, 0, 0));
    expect(name).toBe('harness+android-2026-10-28T12-00-00.000Z.log');
    expect(name).not.toContain(':');
  });

  it('keeps a filtered run naming eleven controls under the file-name limit, unique and readable', () => {
    const controls = [
      'segmented-control',
      'date-picker',
      'text-field',
      'bottom-sheet',
      'context-menu',
      'search-field',
      'icon-button',
      'button-group',
      'hosted-segmented',
      'hosted-date-picker',
      'list-item',
    ];
    const gate = canonicalGateName(
      'real-input:android',
      controls.flatMap((id) => ['--control', id])
    );
    expect(gate.length).toBeGreaterThan(255);
    const at = Date.UTC(2026, 10, 16, 12, 0, 0);
    const name = logNameFor(gate, at);
    // The longest file written beside a log.
    expect(
      Buffer.byteLength(`${name}.suites.json.isolated.json`)
    ).toBeLessThanOrEqual(255);
    expect(
      name.startsWith('real-input+android+--control+segmented-control')
    ).toBe(true);
    expect(name).toMatch(/~[0-9a-f]{10}-2026-11-16T12-00-00\.000Z\.log$/);
    const other = canonicalGateName(
      'real-input:android',
      [...controls.slice(0, -1), 'form'].flatMap((id) => ['--control', id])
    );
    expect(logNameFor(other, at)).not.toBe(name);
    // A name under the cap is left as it was.
    const short = canonicalGateName('real-input:ios', ['--control', 'form']);
    expect(short.length).toBeLessThan(LOG_NAME_GATE_MAX);
    expect(logNameFor(short, at)).toBe(
      'real-input+ios+--control+form-2026-11-16T12-00-00.000Z.log'
    );
  });
});

describe('ledgerLogCandidates', () => {
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
    // A `wait` reading a live run's log must not find the file deleted underneath it by
    // a sweep from another worktree.
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
    // A worktree's log is under the main checkout's .git, which `git worktree remove`
    // never touches.
    expect(absolute.startsWith(path.join(fs.realpathSync(dir), '.git'))).toBe(
      true
    );
    expect(fs.existsSync(absolute)).toBe(true);

    gitInTempRepo(dir, ['worktree', 'remove', '--force', worktree]);
    expect(fs.existsSync(worktree)).toBe(false);

    // From the surviving checkout, the log is readable.
    const text = fs.readFileSync(absolute, 'utf8');
    expect(text).toContain('fake gate:');
    expect(text).toContain('FAIL ios/core/Core.test.tsx');

    const listed = runCli(dir, ['logs', '--all']);
    expect(listed.stdout).toContain('task/x12-removed/check-');
  });

  it('lists a removed worktree’s logs by branch, and knows they failed (M2)', () => {
    // The branch name is nested, so it has to be read from the whole relative path, and
    // pass/fail has to come from the store's own record: the ledger went with the worktree.
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

    const failed = runCli(dir, [
      'logs',
      '--branch',
      'task/x12-nested/deep',
      '--failed',
    ]);
    expect(failed.stdout).toContain('1 log file(s)');
    expect(failed.stdout).toContain('that the store says failed');
    // The passing run is not listed.
    expect(failed.stdout.match(/check-/g)).toHaveLength(1);
  });

  it('says it cannot tell, rather than "0 failed", when a stored log has no record (M2)', () => {
    // A log dropped into the store by hand, or one whose record was pruned: the answer
    // is "unknown", because "0 failed" reads as all-clear.
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

  it('ignores an NITRO_UI_GATE_LOG that names another branch’s run (N8)', () => {
    // The store is shared by the whole clone, so a path inside it may be another branch's
    // run. Writing there would append to that log and mark that run's `.gate.json` done,
    // so its `wait` would return while its gate is still running.
    const dir = makeRepo();
    const theirs = path.join(
      storeOf(dir),
      'task',
      'x12-other-branch',
      'check-still-running.log'
    );
    fs.mkdirSync(path.dirname(theirs), { recursive: true });
    fs.writeFileSync(theirs, 'another branch’s gate is mid-flight\n');
    const theirRecord = theirs.replace(/\.log$/, '.gate.json');
    fs.writeFileSync(
      theirRecord,
      JSON.stringify({
        version: 1,
        gate: 'check',
        pid: 4321,
        startedAt: Date.now(),
        logPath: 'task/x12-other-branch/check-still-running.log',
        done: false,
        branch: 'task/x12-other-branch',
      })
    );

    const run = runCli(dir, ['check'], { NITRO_UI_GATE_LOG: theirs });
    expect(run.status).toBe(0);
    expect(run.stderr).toContain('ignoring NITRO_UI_GATE_LOG');
    // Untouched, and still not done.
    expect(fs.readFileSync(theirs, 'utf8')).toBe(
      'another branch’s gate is mid-flight\n'
    );
    expect(JSON.parse(fs.readFileSync(theirRecord, 'utf8')).done).toBe(false);
    const [line] = ledgerIn(dir, 'task/x12-fixture');
    expect(line.logPath.startsWith('task/x12-fixture/')).toBe(true);
  });

  it('accepts NITRO_UI_GATE_LOG for this branch, in a subdirectory the launcher made', () => {
    // The path shape the background launcher sets: a name in this branch's directory.
    const dir = makeRepo();
    const chosen = path.join(
      storeOf(dir),
      'task',
      'x12-fixture',
      'check-my-own-background-run.log'
    );
    const run = runCli(dir, ['check'], { NITRO_UI_GATE_LOG: chosen });
    expect(run.status).toBe(0);
    expect(run.stderr).not.toContain('ignoring NITRO_UI_GATE_LOG');
    expect(fs.readFileSync(chosen, 'utf8')).toContain('fake gate:');
    const [line] = ledgerIn(dir, 'task/x12-fixture');
    expect(line.logPath).toBe(
      'task/x12-fixture/check-my-own-background-run.log'
    );
  });

  it('accepts this branch’s log spelled through a symlink, not just resolved', () => {
    // A directory reached through a symlink shares no prefix with its own location (on
    // macOS, `/var` → `/private/var`), so the path check has to compare realpaths.
    const dir = makeRepo();
    // The branch directory the launcher would have created; the symlink is another
    // spelling of the same directory.
    fs.mkdirSync(path.join(storeOf(dir), 'task', 'x12-fixture'), {
      recursive: true,
    });
    const link = path.join(scratch('x12-link-'), 'store');
    fs.symlinkSync(storeOf(dir), link, 'dir');
    const chosen = path.join(
      link,
      'task',
      'x12-fixture',
      'check-via-symlink.log'
    );
    const run = runCli(dir, ['check'], { NITRO_UI_GATE_LOG: chosen });
    expect(run.status).toBe(0);
    expect(run.stderr).not.toContain('ignoring NITRO_UI_GATE_LOG');
    // Written where the variable said, and named the way the store names it.
    expect(fs.existsSync(chosen)).toBe(true);
    const [line] = ledgerIn(dir, 'task/x12-fixture');
    expect(line.logPath).toBe('task/x12-fixture/check-via-symlink.log');
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

  it('sweeps a per-run timing sidecar with the log it belongs to (X11 v6)', () => {
    // Retention's file-name filter is an allow-list, so a per-run file that is not on it
    // would stay in the shared store forever. Every sidecar name is asserted here.
    const dir = makeRepo();
    const store = storeOf(dir);
    const branchDir = path.join(store, 'task', 'x12-fixture');
    fs.mkdirSync(branchDir, { recursive: true });
    const aged = (Date.now() - 60 * 86_400_000) / 1000;
    const written = [];
    for (const name of [
      'harness+ios-2026-09-01T00-00-00.000Z.log',
      'harness+ios-2026-09-01T00-00-00.000Z.log.suites.json',
      'harness+ios-2026-09-01T00-00-00.000Z.log.suites.json.isolated.json',
      'harness+ios-2026-09-01T00-00-00.000Z.runner.json',
      'check-2026-09-01T00-00-00.000Z.log',
      'check-2026-09-01T00-00-00.000Z.log.steps.json',
    ]) {
      const file = path.join(branchDir, name);
      fs.writeFileSync(file, '{}\n');
      fs.utimesSync(file, aged, aged);
      written.push(file);
    }
    // A young sidecar, to prove the rule is age and not name.
    const young = path.join(branchDir, 'harness+android-today.log.suites.json');
    fs.writeFileSync(young, '{}\n');

    const pruned = runCli(dir, ['logs']);
    expect(pruned.status).toBe(0);
    expect(pruned.stdout).toContain('retention removed 6 file(s)');
    for (const file of written) expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(young)).toBe(true);
  });

  it("puts a harness run's timings in the store, named from its log (X11 v6)", () => {
    const dir = makeRepo();
    const suites = JSON.stringify({
      version: 1,
      gate: null,
      platform: 'ios',
      suites: [
        {
          file: '__tests__/Switch.harness.tsx',
          durationMs: 40_400,
          testBodyMs: 3_200,
          tests: 42,
          failed: 0,
          status: 'passed',
        },
      ],
    });
    // A device gate needs a live lease; this one comes from the shared fixture, not the
    // machine's own `~/.nitro-ui`.
    const timingLease = leaseRecord({
      id: 'lease-x11',
      task: 'X11',
      platform: 'ios',
    });
    const home = writeLeaseStore(path.join(dir, 'lease-home'), {
      leases: [timingLease],
    });
    const run = runCli(
      dir,
      ['harness:ios'],
      {
        ...leasedEnv({ home, pair: DEFAULT_PAIR, lease: timingLease }),
        FAKE_SUITES_JSON: suites,
      },
      // The fake runner plays the harness plugin: it writes the file the env names,
      // and prints the gate name the other variable carries.
      '[ -n "$HARNESS_SUITE_TIMING" ] && printf %s "$FAKE_SUITES_JSON" > "$HARNESS_SUITE_TIMING"; echo "plugin env: file=${HARNESS_SUITE_TIMING-unset} gate=${HARNESS_SUITE_TIMING_GATE-unset}"'
    );
    expect(run.status).toBe(0);

    // The gate's own name travels with it, unfolded: the file name is a lossy spelling.
    expect(run.stdout).toContain('plugin env: file=');
    expect(run.stdout).toContain('gate=harness:ios');

    const [line] = ledgerIn(dir, 'task/x12-fixture');
    expect(line.gate).toBe('harness:ios');
    expect(line.suiteTimings.suites[0].file).toBe(
      '__tests__/Switch.harness.tsx'
    );
    // And the file itself is in the clone's store, in this branch's directory, named
    // `<the log>.suites.json`.
    const expected = path.join(
      storeOf(dir),
      'task',
      'x12-fixture',
      `${line.logPath.split('/').pop()}.suites.json`
    );
    expect(fs.existsSync(expected)).toBe(true);
    // Nothing under the worktree's own `.gates/`.
    const inWorktree = [];
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
        else if (entry.name.endsWith('.suites.json')) inWorktree.push(absolute);
      }
    };
    walk(path.join(dir, '.gates'));
    expect(inWorktree).toEqual([]);
  });

  it('prunes on every run, not only when `logs` is asked (N1)', () => {
    // The `logs` command prunes by itself, so this uses a plain run, which says on
    // stderr what it deleted.
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
    // The launcher prunes before it opens its log. A detached child's own pruning would
    // show only in its log, so the line on stderr is the launcher's.
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
    // A run going for 36 days has a log whose mtime is its start time, so it is past the
    // 35-day age rule, and only the record that says the run is alive protects it.
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

    const pruned = runCli(dir, ['logs']);
    expect(pruned.status).toBe(0);
    // Exactly one victim: the 60-day-old log nothing claims. The 36-day one is older
    // than the retention window and survives anyway, on the record alone.
    expect(pruned.stdout).toContain('retention removed 1 file(s)');
    expect(fs.existsSync(running)).toBe(true);
    expect(fs.existsSync(finished)).toBe(false);
  });

  it('does not adopt a sibling worktree’s background run (M1)', () => {
    // Two checkouts, one shared store, one branch: `git worktree add -f` puts the same
    // branch in two checkouts, so matching a record on the branch alone is not enough.
    const dir = makeRepo({ branch: 'main' });
    const branch = 'task/x12-dup';
    const wtParent = scratch('x12-wt-');
    const worktree = path.join(wtParent, 'sibling');
    gitInTempRepo(dir, ['branch', branch, 'main']);
    gitInTempRepo(dir, ['worktree', 'add', '-f', '-q', worktree, branch]);
    // Both checkouts end up on that branch.
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

    // And the sibling still sees its own finished run: exit 7, the exit code of the gate
    // it ran, not ours.
    const other = runCli(worktree, ['wait', '--gate', 'check']);
    expect(other.status).toBe(7);
    expect(other.stderr).toContain('failed with exit 7');

    // `status` likewise reports only its own run as running.
    const status = runCli(dir, ['status']);
    expect(status.stdout).toContain('running check');
    expect(status.stdout).toContain(String(process.pid));
    expect(status.stdout).not.toContain('4100');
  });

  it('never reports a finished foreground run as the background gate it waits for (N4)', () => {
    // `wait` takes the newest record, so without the `foreground: true` filter a
    // foreground `check` that just failed in this worktree would be reported in place of
    // the background run still in progress.
    const dir = makeRepo();
    // The foreground run: real, failing with a distinctive code.
    expect(runCli(dir, ['check'], { FAKE_EXIT: '7' }).status).toBe(7);
    // …and an older background record for the same gate in this checkout, still open,
    // owned by this test's pid, with a log line of its own to print.
    const logPath = 'task/x12-fixture/check-09.log';
    const absolute = path.join(storeOf(dir), logPath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(
      absolute,
      'gate: check\nmy background run is still going\n'
    );
    fs.writeFileSync(
      absolute.replace(/\.log$/, '.gate.json'),
      JSON.stringify({
        version: 1,
        gate: 'check',
        pid: process.pid,
        startedAt: Date.parse('2026-10-28T09:00:00.000Z'),
        logPath,
        done: false,
        branch: 'task/x12-fixture',
        worktree: fs.realpathSync(dir),
      })
    );

    const wait = runCli(dir, [
      'wait',
      '--gate',
      'check',
      '--timeout-minutes',
      '0.01',
    ]);
    expect(wait.status).toBe(13);
    expect(wait.stderr).toContain('my background run is still going');
    // The finished foreground run's exit code is never attributed to the run that is
    // still going.
    expect(wait.stderr).not.toContain('exit 7');
  });

  it('keeps another branch’s record that names no worktree out of wait (N4)', () => {
    // A record with `branch` and no `worktree` cannot be excluded by the worktree
    // comparison, so the branch comparison is the only thing that keeps it out.
    const dir = makeRepo();
    const foreign = path.join(
      storeOf(dir),
      'task',
      'x12-other',
      'check-2026-10-27T00-00-00.000Z.log'
    );
    fs.mkdirSync(path.dirname(foreign), { recursive: true });
    fs.writeFileSync(foreign, 'another branch’s run, still going\n');
    fs.writeFileSync(
      foreign.replace(/\.log$/, '.gate.json'),
      JSON.stringify({
        version: 1,
        gate: 'check',
        pid: process.pid,
        startedAt: Date.parse('2026-10-27T00:00:00.000Z'),
        logPath: 'task/x12-other/check-2026-10-27T00-00-00.000Z.log',
        done: false,
        branch: 'task/x12-other',
      })
    );

    // This checkout has no background run of its own. The tiny budget keeps a failure
    // fast: a `wait` that adopted the foreign record would block for its full budget.
    const wait = runCli(dir, [
      'wait',
      '--gate',
      'check',
      '--timeout-minutes',
      '0.01',
    ]);
    expect(wait.status).toBe(2);
    expect(wait.stderr).toContain('no background gate');
    const status = runCli(dir, ['status']);
    expect(status.stdout).not.toContain('another branch');
  });

  it('records which worktree started a background run (M1)', () => {
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
});
describe('summarizeLoad carries the end sample (X12)', () => {
  it('reports the last sample it measured', () => {
    expect(summarizeLoad({ start: 1, samples: [1, 20, 30] }).end).toBe(30);
    expect(summarizeLoad({ start: 1, samples: [] }).end).toBeNull();
  });
});

/* ----------------------- device context on a failed run -------------------- */

describe('a failed device gate records its device context', () => {
  // The env a run has after sourcing `lease.mjs acquire`. The serial is here too, and
  // the gate must not read it: the probes take the serial from the lease record, so a
  // stale or hand-set variable cannot point them at another task's device.
  const leased = {
    NITRO_UI_LEASE_ID: 'lease-x12',
    ANDROID_SERIAL: 'emulator-5574',
  };

  /**
   * A lease state home: `leases.json` (this run's lease, holding `pair-2`) and
   * `devices.json` (which says that pair's emulator is on 5574). The gate derives
   * the serial from those two files.
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
                // A gate is refused when its lease was taken for the other platform,
                // so the fixture's lease covers both halves of the pair.
                platform: 'both',
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

  /**
   * Hooks the fake gate runs to change the lease state during the run. A device gate
   * with no live lease never starts, so a lease can only stop being live underneath a
   * run that was allowed to start: released from another shell, or expired at its ttl.
   */
  const RELEASED_LEASE_HOOK =
    'printf \'{"version":1,"leases":[]}\' > "$NITRO_UI_HOME/leases.json"';
  const EXPIRED_LEASE_HOOK =
    'printf \'{"version":1,"leases":[{"id":"lease-x12","task":"X12",' +
    '"platform":"both","holds":["pair-2"],"acquiredAt":1,"ttlMinutes":1}]}\' ' +
    '> "$NITRO_UI_HOME/leases.json"';

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

  it('names only this run’s own device in the block, and the rest as <other device>', () => {
    // `simctl list devices booted` is a host-wide question: it answers with every
    // simulator on the Mac, including other tasks' devices.
    const dir = makeRepo();
    const { run } = failedDeviceRun(dir);
    expect(run.status).toBe(1);
    const context = splitDeviceContext(logOf(dir)).context;
    // Ours, whole: the UDID is what you type back into `simctl` to debug the run.
    expect(context).toContain('CD670291-1111-1111-1111-111111111111');
    // Someone else's: the name and state stay (that is the useful half — it is how
    // you spot a second simulator stealing focus), the identifier does not.
    expect(context).toContain('iPhone 16');
    expect(context).not.toContain('1F2D3E4F-AAAA-BBBB-CCCC-DDDDCCCCAAAA');
    expect(context).toContain('<other device>');
  });

  it('names no device at all once the run stops holding a lease', () => {
    // Without a live lease there is no "own" device, so every identifier in the
    // host-wide answer is somebody else's. The lease is released during the run, because
    // an unleased gate never starts.
    const dir = makeRepo();
    const { run } = failedDeviceRun(dir, {}, RELEASED_LEASE_HOOK);
    expect(run.status).toBe(1);
    const context = splitDeviceContext(logOf(dir)).context;
    expect(context).toContain('iPhone 17');
    expect(context).toContain('iPhone 16');
    expect(context).not.toContain('CD670291-1111-1111-1111-111111111111');
    expect(context).not.toContain('1F2D3E4F-AAAA-BBBB-CCCC-DDDDCCCCAAAA');
    expect(context.match(/<other device>/g)).toHaveLength(2);
  });

  it('redacts a foreign emulator serial that an adb error names', () => {
    // A probe's *failure* text is echoed into the block, and adb puts a serial in
    // its own error messages, so the redaction cannot apply only to the answers.
    const dir = makeRepo();
    const { run } = failedDeviceRun(dir, { FAKE_ADB_FOREIGN_SERIAL: '1' });
    expect(run.status).toBe(1);
    const context = splitDeviceContext(logOf(dir)).context;
    // Our own serial is fine to print — the ledger line carries it anyway.
    expect(context).toContain('emulator-5574');
    expect(context).not.toContain('emulator-5560');
    expect(context).toContain('<other device>');
  });

  it('asks adb nothing for a failed iOS gate whose lease holds an emulator (N4)', () => {
    // A pair is an iOS simulator and an emulator, this run's lease is live, and the
    // environment names that emulator, but an iOS gate never touched it.
    const dir = makeRepo();
    const home = leaseHomeFor(dir);
    const run = runCli(
      dir,
      ['harness:ios'],
      {
        ...leased,
        IOS_SIM_UDID: 'CD670291-1111-1111-1111-111111111111',
        NITRO_UI_HOME: home,
        FAKE_EXIT: '1',
      },
      ''
    );
    expect(run.status).toBe(1);
    const asked = fs.existsSync(run.calls)
      ? fs.readFileSync(run.calls, 'utf8')
      : '';
    // simctl is a host-wide question and stays; adb is another platform's tool.
    expect(asked).toContain('simctl');
    expect(asked).not.toContain('adb');
    // And the block says why, rather than printing nothing where an answer should be.
    expect(logOf(dir)).toContain('not an Android gate');
  });

  it('asks the leased device its own state, and never lists devices', () => {
    const dir = makeRepo();
    const { run } = failedDeviceRun(dir);
    const asked = fs.readFileSync(run.calls, 'utf8');
    expect(asked).toContain('adb -s emulator-5574 get-state');
    // `adb devices` is a host-side query: it ignores `-s` and prints every emulator the
    // server sees. The fake prints such a list when asked.
    expect(
      asked
        .split('\n')
        .filter((line) => line.startsWith('adb') && line.includes(' devices'))
    ).toEqual([]);
    const context = splitDeviceContext(logOf(dir)).context;
    // The answer, not merely the word "device", which the `simctl` label in the block
    // also contains.
    expect(context).toMatch(/adb get-state[^|]*\n\s*\|\s*device/);
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
    // The env still says 5574, the serial the run was allowed to start on; the pool is
    // rewritten mid-run so the lease's pair is now 5576. The record wins, because the
    // env is a copy that outlives the shell that sourced it and the pool is the lease.
    const pairMovesPort =
      'printf \'{"pairs":[{"id":"pair-2","android":{"avd":"avd_2",' +
      '"emulatorPort":5576},"metroPort":8297}]}\' > "$NITRO_UI_HOME/devices.json"';
    const { run } = failedDeviceRun(dir, {}, pairMovesPort);
    expect(run.status).toBe(1);
    const asked = fs.readFileSync(run.calls, 'utf8');
    expect(asked).toContain('adb -s emulator-5576 get-state');
    expect(asked).not.toContain('-s emulator-5574');
  });

  it('never addresses the maintainer’s reserved emulator, and says why', () => {
    const dir = makeRepo();
    // The pool itself hands out the reserved port. `devices.json` is validated before a
    // pair is read, so the serial is never derived and adb is never run against it.
    // Written while the gate runs: a pool unusable at the start refuses the run outright.
    const home = leaseHomeFor(dir);
    const reservedPool =
      'printf \'{"pairs":[{"id":"pair-2","android":{"avd":"avd_2",' +
      '"emulatorPort":5560},"metroPort":8297}]}\' > "$NITRO_UI_HOME/devices.json"';
    const run = runCli(
      dir,
      ['harness:android'],
      { ...leased, NITRO_UI_HOME: home, FAKE_EXIT: '1' },
      reservedPool
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

  it('probes no device for a lease that stopped being live mid-run', () => {
    // The two ways that happens: released from another shell, and outlived at its own
    // ttl. Both start from a live lease, or the run would be refused before it starts.
    for (const hook of [RELEASED_LEASE_HOOK, EXPIRED_LEASE_HOOK]) {
      const dir = makeRepo();
      const { run } = failedDeviceRun(dir, {}, hook);
      expect(run.status).toBe(1);
      const asked = fs.existsSync(run.calls)
        ? fs.readFileSync(run.calls, 'utf8')
        : '';
      // simctl is still fine to ask (it is host-wide, not another task's device), but
      // adb has no business being run by a task that no longer holds the emulator.
      expect(asked).toContain('simctl');
      expect(asked).not.toContain('adb');
      const log = logOf(dir);
      expect(log).toContain('lease lease-x12 is no longer live');
      expect(log).toContain('not ours to ask');
    }
  });

  it('still records the gate result when a probe itself fails', () => {
    const dir = makeRepo();
    const { run } = failedDeviceRun(dir, { FAKE_DEVICE_EXIT: '127' });
    expect(run.status).toBe(1);
    const [line] = ledgerIn(dir, 'task/x12-fixture');
    expect(line.result).toBe('fail');
    expect(line.exitCode).toBe(1);
    expect(logOf(dir)).toContain('[unavailable]');
  });

  it('does not feed a failed probe’s error text to the next command', () => {
    const dir = makeRepo();
    // `pidof` fails here, and a probe that returns its error text as if it were the
    // answer would hand `adb logcat --pid` a paragraph of shell error.
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

  it('splitDeviceContext leaves a log with no block untouched', () => {
    expect(splitDeviceContext('plain\n')).toEqual({
      body: 'plain\n',
      context: null,
    });
  });
});

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  TOOLING_FILES,
  isToolingPath,
  LOG_STORE_BASENAME,
  ledgerLineFromRun,
  platformsOwningFile,
  platformsTouchedByPaths,
  renderStepTimings,
  requiredGatesFor,
  stepTimingsOf,
} from '../gate-core.mjs';
import { RUNNER_RECORD_SUFFIX } from '../gate-runner.mjs';
import { withoutLeaseEnv } from './helpers/scrubbed-env.js';
import { FREE_LSOF } from './helpers/free-lsof-stub.js';
import {
  DEFAULT_PAIR,
  leaseRecord,
  leasedEnv,
  writeLeaseStore,
} from './helpers/lease-store.js';

const CLI = path.join(process.cwd(), 'scripts', 'gate.mjs');
const CHECK_STEPS = path.join(process.cwd(), 'scripts', 'check-steps.mjs');

const TREE_A = 'a'.repeat(64);

/* ------------------------- the per-step ledger record ------------------------ */

describe('stepTimingsOf (what a ledger line carries)', () => {
  it('has no steps for a line written before X10', () => {
    expect(stepTimingsOf({ gate: 'check' })).toEqual([]);
    expect(stepTimingsOf(undefined)).toEqual([]);
    expect(stepTimingsOf({ stepTimings: null })).toEqual([]);
  });

  it('drops entries that are not steps rather than rendering an empty row', () => {
    expect(
      stepTimingsOf({
        stepTimings: {
          jobs: 4,
          steps: [
            { name: 'lint', status: 'pass', durationMs: 6200 },
            { status: 'pass', durationMs: 5 },
            null,
            'lint',
          ],
        },
      })
    ).toEqual([{ name: 'lint', status: 'pass', durationMs: 6200 }]);
  });

  it('is carried onto the line by ledgerLineFromRun, and absent by default', () => {
    const withSteps = ledgerLineFromRun({
      gate: 'check',
      command: 'bun run check',
      tree: TREE_A,
      durationMs: 180_000,
      result: 'pass',
      startedAt: Date.parse('2026-10-28T09:00:00.000Z'),
      stepTimings: {
        version: 1,
        jobs: 4,
        wallMs: 180_000,
        steps: [{ name: 'lint', status: 'pass', durationMs: 6200 }],
      },
    });
    expect(withSteps.stepTimings.steps).toEqual([
      { name: 'lint', status: 'pass', durationMs: 6200 },
    ]);
    expect(stepTimingsOf(withSteps).map((s) => s.name)).toEqual(['lint']);
    expect(ledgerLineFromRun(baseRun()).stepTimings).toBeNull();
  });
});

function baseRun() {
  return {
    gate: 'check',
    command: 'bun run check',
    tree: TREE_A,
    durationMs: 1000,
    result: 'pass',
    startedAt: Date.parse('2026-10-28T09:00:00.000Z'),
  };
}

describe('renderStepTimings (what `table --full` prints)', () => {
  const entries = [
    {
      gate: 'check',
      result: 'pass',
      tree: TREE_A,
      durationMs: 180_000,
      stepTimings: {
        version: 1,
        jobs: 4,
        wallMs: 178_000,
        steps: [
          {
            name: 'test',
            status: 'pass',
            durationMs: 147_000,
            exitCode: 0,
            signal: null,
            reason: null,
          },
          {
            name: 'prepare',
            status: 'fail',
            durationMs: 4_000,
            exitCode: 1,
            signal: null,
            reason: 'exit 1',
          },
          {
            name: 'publint',
            status: 'skipped',
            durationMs: 0,
            exitCode: null,
            signal: null,
            reason: 'not started - prepare failed',
          },
        ],
      },
    },
    { gate: 'harness:ios', result: 'pass', tree: TREE_A, durationMs: 90_000 },
  ];

  it('prints one row per step, with its duration', () => {
    const out = renderStepTimings({ entries, gates: ['check'] });
    expect(out).toContain('### `check` steps - 4 job(s)');
    expect(out).toContain('| `test` | **PASS** | 2 m 27 s | — |');
    expect(out).toContain('| `prepare` | **FAIL** | 4.0 s | exit 1 |');
    expect(out).toContain(
      '| `publint` | not started | 0.0 s | not started - prepare failed |'
    );
  });

  it('says nothing for a gate that recorded none', () => {
    expect(renderStepTimings({ entries, gates: ['harness:ios'] })).toBe('');
    expect(renderStepTimings({ entries: [], gates: null })).toBe('');
  });

  it('escapes a pipe so a reason cannot break the table', () => {
    const out = renderStepTimings({
      entries: [
        {
          gate: 'check',
          stepTimings: {
            steps: [
              {
                name: 'lint',
                status: 'fail',
                durationMs: 10,
                exitCode: null,
                signal: 'SIGTERM',
                reason: 'a | b',
              },
            ],
          },
        },
      ],
      gates: ['check'],
    });
    expect(out).toContain('a \\| b');
    // One row of four cells: the escaped pipe is not a column separator.
    const row = out.split('\n').find((line) => line.includes('`lint`'));
    expect(row.split(/(?<!\\)\|/)).toHaveLength(6);
  });
});

/* --------------------------- the tooling allow-list -------------------------- */

describe('TOOLING_FILES (X10, X26 additions)', () => {
  it.each([
    // None of these can reach the app binary: they run checks, schedule them, or
    // describe a device pool the app never sees.
    'scripts/check.mjs',
    'scripts/check-steps.mjs',
    'scripts/gate-runner.mjs',
    'scripts/gen-registry.mjs',
    'scripts/registry-core.mjs',
    'scripts/build-slot-core.mjs',
    'scripts/devices.example.json',
    'scripts/sync-example-lock.mjs',
    'scripts/lease.mjs',
    'scripts/lease-core.mjs',
    'scripts/task-ready.mjs',
    'scripts/task-ready-core.mjs',
    '.oxlintrc.json',
    '.oxfmtrc.jsonc',
    'vitest.config.mjs',
    'lefthook.yml',
    'scripts/worktrees.mjs',
    'scripts/worktrees-core.mjs',
    'scripts/watchdog.mjs',
    'scripts/watchdog-core.mjs',
    'scripts/task-records.mjs',
    'scripts/task-records-core.mjs',
  ])('%s is check-only tooling', (file) => {
    expect(TOOLING_FILES).toContain(file);
    expect(isToolingPath(file)).toBe(true);
    expect(platformsOwningFile(file)).toEqual([]);
  });

  it('task-ready is on the list because nothing a device run touches reads it', () => {
    // An entry on the list claims that no device run reads the file, so the claim is
    // checked with a search.
    for (const file of [
      'scripts/task-ready.mjs',
      'scripts/task-ready-core.mjs',
    ]) {
      expect(isToolingPath(file)).toBe(true);
      expect(platformsOwningFile(file)).toEqual([]);
    }
    const hits = spawnSync(
      'git',
      [
        'grep',
        '-l',
        'task-ready',
        '--',
        'scripts',
        'example',
        'src',
        'ios',
        'android',
        'nitrogen',
        'patches',
        'package.json',
      ],
      { cwd: process.cwd(), encoding: 'utf8' }
    );
    expect(hits.status).toBe(0);
    // The search covers `scripts/` too, where the device runners live, and removes only
    // what the list already calls tooling. Only the npm script that runs the checker
    // may remain.
    const readers = hits.stdout
      .trim()
      .split('\n')
      .filter((file) => file !== '' && !isToolingPath(file));
    expect(readers).toEqual(['package.json']);
    // The search does match inside `scripts/`, so an empty result is not a typo.
    expect(hits.stdout).toContain('scripts/task-ready.mjs');
  });

  it('nothing a device run starts imports the worktree lister, the watchdog or the task-record tool', () => {
    // File names, not bare words: `watchdog` alone also matches the native dwell probe,
    // which has a watchdog of its own.
    for (const needle of [
      'worktrees-core',
      'worktrees.mjs',
      'watchdog-core',
      'watchdog.mjs',
      'task-records-core',
      'task-records.mjs',
    ]) {
      const hits = spawnSync(
        'git',
        [
          'grep',
          '-l',
          needle,
          '--',
          'scripts',
          'example',
          'src',
          'ios',
          'android',
          'nitrogen',
          'patches',
          'package.json',
        ],
        { cwd: process.cwd(), encoding: 'utf8' }
      );
      const readers = hits.stdout
        .trim()
        .split('\n')
        .filter((file) => file !== '' && !isToolingPath(file));
      expect({ needle, readers }).toEqual({ needle, readers: [] });
      // The search does match inside `scripts/`, so an empty result is not a typo.
      expect(hits.stdout).toContain('scripts/');
    }
  });

  it('gate-runner is on the list because nothing a device run touches reads it', () => {
    // `gate-runner.mjs` wraps every device gate's command, but it only decides whether the
    // run's processes are stopped when the gate dies; no device run imports it.
    expect(isToolingPath('scripts/gate-runner.mjs')).toBe(true);
    expect(platformsOwningFile('scripts/gate-runner.mjs')).toEqual([]);
    const hits = spawnSync(
      'git',
      [
        'grep',
        '-l',
        'gate-runner',
        '--',
        'scripts',
        'example',
        'src',
        'ios',
        'android',
        'nitrogen',
        'patches',
        'package.json',
      ],
      { cwd: process.cwd(), encoding: 'utf8' }
    );
    expect(hits.status).toBe(0);
    const readers = hits.stdout
      .trim()
      .split('\n')
      .filter((file) => file !== '' && !isToolingPath(file));
    expect(readers).toEqual([]);
    // `gate.mjs` is the importer that must be found, so the search cannot pass by matching
    // nothing.
    expect(hits.stdout).toContain('scripts/gate.mjs');
    expect(hits.stdout).toContain('scripts/gate-core.mjs');
  });

  it('a commit that only changes the checker re-owns check and no device run', () => {
    const touched = platformsTouchedByPaths([
      'scripts/task-ready.mjs',
      'scripts/task-ready-core.mjs',
    ]);
    expect(touched.platforms).toEqual([]);
    expect(touched.tooling).toEqual([
      'scripts/task-ready.mjs',
      'scripts/task-ready-core.mjs',
    ]);
    expect(
      requiredGatesFor({ stage: 'review', touchedPlatforms: touched.platforms })
    ).toEqual(['check']);
  });

  it('a gate run under the supervisor lands the same evidence as one without', () => {
    // `gate.mjs` starts its command through `gate-runner.mjs`, so the command's exit code and
    // stdout have to arrive unchanged.
    const dir = makeRepo();
    const store = path.join(dir, 'store');
    const run = runCli(
      dir,
      ['check'],
      { NITRO_UI_GATE_LOG_STORE: store },
      // The command reports its own process group (`$$` is the script's pid) and what the
      // gate told the supervisor about itself.
      'echo "supervisor: pgid=$(ps -o pgid= -p $$ | tr -d \" \") of=${NITRO_UI_GATE_RUNNER_OF:-none} gate=${NITRO_UI_GATE_RUNNER_GATE:-none}"'
    );
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('fake check:');
    expect(run.stdout).toContain('Tests: 665 passed, 665 total');
    const [line] = ledgerIn(dir, 'task/x10-check-throughput');
    expect(line).toBeTruthy();
    expect(line.counts.suites).toEqual({ passed: 33, total: 33 });

    const reported = /pgid=(\d+) of=(\d+) gate=(\S+)/.exec(run.stdout);
    expect(reported).not.toBeNull();
    const commandGroup = Number(reported[1]);
    const gatePid = Number(reported[2]);
    expect(reported[3]).toBe('check');

    const sidecarFile = path.join(
      store,
      LOG_STORE_BASENAME,
      `${line.logPath}${RUNNER_RECORD_SUFFIX}`
    );
    expect(fs.existsSync(sidecarFile)).toBe(true);
    const sidecar = JSON.parse(fs.readFileSync(sidecarFile, 'utf8'));
    // The process group the command runs in is the one the supervisor recorded, so anything
    // the command leaves behind can be found and stopped by that group.
    expect(sidecar.group).toBe(commandGroup);
    expect(sidecar.gatePid).toBe(gatePid);
    expect(sidecar.gate).toBe('check');
    expect(sidecar.logPath).toBe(line.logPath);
    // A run that finished by itself records no sweep.
    expect(sidecar.stopped).toBeUndefined();
  });

  it('the files are real, so the list cannot guard a path that does not exist', () => {
    for (const file of TOOLING_FILES) {
      expect(fs.existsSync(path.join(process.cwd(), file))).toBe(true);
    }
  });

  it('what a device run really depends on is still mapped', () => {
    for (const file of [
      'scripts/build-app.mjs',
      'scripts/harness.mjs',
      'scripts/app-stamp.mjs',
      'scripts/patch-nitrogen.mjs',
    ]) {
      expect(isToolingPath(file)).toBe(false);
    }
  });
});

/* ------------------------ the runner and the ledger, end to end -------------- */

const cleanup = [];

afterAll(() => {
  for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * The environment every git call in this file runs with. `GIT_DIR`, `GIT_WORK_TREE` and
 * their relatives are inherited by child processes and win over `cwd`, so they are removed:
 * with them set (by a git hook, say) these tests would commit into someone else's repository.
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

/**
 * Runs a mutating git command, and refuses to if the repository it would reach is not this
 * test's own temp checkout.
 */
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

describe('the git helpers cannot be pointed at another repository (N1)', () => {
  it('strips every environment variable that overrides cwd', () => {
    // The process environment is pointed at a different repository for the duration, so an
    // environment that failed to strip the variables answers about the wrong checkout.
    const dir = makeRepo();
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'x10-elsewhere-'));
    try {
      gitIn(elsewhere, ['init', '-q', '-b', 'main']);
      const gitDir = path.join(elsewhere, '.git');
      const poisoned = {
        GIT_DIR: gitDir,
        GIT_WORK_TREE: elsewhere,
        GIT_INDEX_FILE: path.join(gitDir, 'INDEX'),
        GIT_COMMON_DIR: gitDir,
        GIT_OBJECT_DIRECTORY: path.join(gitDir, 'objects'),
        GIT_GRAFT_FILE: path.join(elsewhere, 'grafts'),
        GIT_NAMESPACE: 'refs/namespaces/x',
      };
      const saved = {};
      for (const [name, value] of Object.entries(poisoned)) {
        saved[name] = process.env[name];
        process.env[name] = value;
      }
      try {
        for (const name of Object.keys(poisoned)) {
          expect(gitEnv(dir)[name]).toBeUndefined();
        }
        // The helper's environment answers about `dir`; the inherited one answers about the
        // other checkout.
        expect(gitIn(dir, ['rev-parse', '--show-toplevel'])).toBe(
          fs.realpathSync(dir)
        );
        const inherited = spawnSync('git', ['rev-parse', '--show-toplevel'], {
          cwd: dir,
          encoding: 'utf8',
          env: { ...process.env },
        });
        expect(inherited.stdout.trim()).toBe(fs.realpathSync(elsewhere));
      } finally {
        for (const [name, value] of Object.entries(saved)) {
          if (value === undefined) delete process.env[name];
          else process.env[name] = value;
        }
      }
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('a redirected git really does reach the victim, and gitEnv stops it', () => {
    const victim = fs.mkdtempSync(path.join(os.tmpdir(), 'x10-victim-'));
    const caller = makeRepo();
    try {
      gitIn(victim, ['init', '-q', '-b', 'main']);
      fs.writeFileSync(path.join(victim, 'thing.txt'), 'untouched\n');
      gitIn(victim, ['add', '-A']);
      gitIn(victim, ['commit', '-qm', 'victim base']);
      const before = gitIn(victim, ['rev-parse', 'HEAD']);

      // `cwd` is the caller, and the commit still lands in the victim: `GIT_DIR` chooses the
      // repository.
      const redirect = {
        ...gitEnv(caller),
        GIT_DIR: path.join(victim, '.git'),
      };
      const naive = spawnSync(
        'git',
        ['commit', '--allow-empty', '-qm', 'written elsewhere'],
        { cwd: caller, encoding: 'utf8', env: redirect }
      );
      expect(naive.status).toBe(0);
      expect(gitIn(victim, ['rev-parse', 'HEAD'])).not.toBe(before);

      // The helper's environment does not carry the variable, so the same call stays in the
      // caller's checkout.
      expect(gitEnv(caller).GIT_DIR).toBeUndefined();
      expect(gitIn(caller, ['rev-parse', '--show-toplevel'])).toBe(
        fs.realpathSync(caller)
      );
      const victimHead = gitIn(victim, ['rev-parse', 'HEAD']);
      expect(() =>
        gitInTempRepo(caller, ['commit', '--allow-empty', '-qm', 'mine'])
      ).not.toThrow();
      expect(gitIn(victim, ['rev-parse', 'HEAD'])).toBe(victimHead);

      // With `GIT_WORK_TREE` pointing elsewhere, `--show-toplevel` reports the victim, which is
      // the condition `gitInTempRepo` throws on.
      const moved = spawnSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: caller,
        encoding: 'utf8',
        env: { ...gitEnv(caller), GIT_WORK_TREE: fs.realpathSync(victim) },
      });
      expect(moved.stdout.trim()).toBe(fs.realpathSync(victim));
    } finally {
      fs.rmSync(victim, { recursive: true, force: true });
    }
  });
});

/**
 * A checkout with one code file, a `main`, and a task branch: the smallest thing
 * `gate.mjs` will run in. `.gates/` is gitignored, or the ledger's own logs would count as
 * code and every line would read stale.
 */
function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'x10-gate-'));
  const write = (file, content) => {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };
  write('nitrogen/generated/ios/NitroUiAutolinking.swift', '// marker\n');
  write('ios/core/Core.swift', 'v1\n');
  write('example/package.json', '{"name":"x"}\n');
  write('.gitignore', '.gates/\nfake-bin/\nstate/\n');
  gitIn(dir, ['init', '-q', '-b', 'main']);
  gitInTempRepo(dir, ['add', '-A']);
  gitInTempRepo(dir, ['commit', '-qm', 'base']);
  gitInTempRepo(dir, ['checkout', '-qb', 'task/x10-check-throughput']);
  cleanup.push(dir);
  return dir;
}

/**
 * A fake `bun run check`: it writes the per-step timings to the file
 * `NITRO_UI_CHECK_STEPS_FILE` names (unless `FAKE_CHECK_NO_STEPS_FILE=1`) and prints a Jest
 * summary. `hook` is extra shell run before the exit.
 */
function fakeBin(dir, hook = '') {
  const bin = path.join(dir, 'fake-bin');
  fs.mkdirSync(bin, { recursive: true });
  const script =
    '#!/bin/sh\n' +
    'echo "fake check: $*"\n' +
    'echo "Test Suites: 33 passed, 33 total"\n' +
    'echo "Tests: 665 passed, 665 total"\n' +
    'if [ -n "$NITRO_UI_CHECK_STEPS_FILE" ] && [ -z "$FAKE_CHECK_NO_STEPS_FILE" ]; then\n' +
    '  mkdir -p "$(dirname "$NITRO_UI_CHECK_STEPS_FILE")"\n' +
    '  printf \'%s\' "$FAKE_CHECK_STEPS_JSON" > "$NITRO_UI_CHECK_STEPS_FILE"\n' +
    'fi\n' +
    (hook === '' ? '' : `${hook}\n`) +
    'exit ${FAKE_EXIT:-0}\n';
  for (const name of ['bun', 'node']) {
    fs.writeFileSync(path.join(bin, name), script);
    fs.chmodSync(path.join(bin, name), 0o755);
  }
  return bin;
}

/**
 * The lease this suite's runs use. A device gate refuses to start unless the store named by
 * `NITRO_UI_HOME` holds the lease its environment names, so the fixture has its own store.
 */
const FIXTURE_LEASE = leaseRecord({
  id: 'X10-1',
  task: 'X10',
  platform: 'ios',
});

function fixtureLeaseEnv(dir) {
  const home = path.join(dir, 'state');
  writeLeaseStore(home, { leases: [FIXTURE_LEASE] });
  // `FREE_LSOF`: a lease exports its Metro port, and the pre-flight would otherwise ask the
  // real machine whether that port is in use.
  return {
    ...leasedEnv({ home, pair: DEFAULT_PAIR, lease: FIXTURE_LEASE }),
    ...FREE_LSOF,
  };
}

function runCli(dir, args, extraEnv = {}, hook = '') {
  const bin = fakeBin(dir, hook);
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      ...gitEnv(dir),
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      ...fixtureLeaseEnv(dir),
      ...extraEnv,
    },
  });
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

const STEPS_JSON = JSON.stringify({
  version: 1,
  jobs: 4,
  wallMs: 180_000,
  steps: [
    {
      name: 'test',
      status: 'pass',
      durationMs: 147_000,
      exitCode: 0,
      signal: null,
      reason: null,
    },
    {
      name: 'lint',
      status: 'pass',
      durationMs: 6_000,
      exitCode: 0,
      signal: null,
      reason: null,
    },
  ],
});

describe('gate.mjs check records the step timings', () => {
  it('puts them on the ledger line, and table --full prints them', () => {
    const dir = makeRepo();
    const run = runCli(dir, ['check'], { FAKE_CHECK_STEPS_JSON: STEPS_JSON });
    expect(run.status).toBe(0);
    const [line] = ledgerIn(dir, 'task/x10-check-throughput');
    expect(line.gate).toBe('check');
    expect(line.stepTimings.jobs).toBe(4);
    expect(stepTimingsOf(line).map((s) => [s.name, s.status])).toEqual([
      ['test', 'pass'],
      ['lint', 'pass'],
    ]);
    expect(line.counts.tests.total).toBe(665);

    const table = runCli(dir, ['table', '--for', 'merge', '--full']);
    expect(table.stdout).toContain('### `check` steps - 4 job(s)');
    expect(table.stdout).toContain('| `test` | **PASS** | 2 m 27 s | — |');
    const short = runCli(dir, ['table', '--for', 'merge']);
    expect(short.stdout).not.toContain('### `check` steps');
  }, 60_000);

  it('a check with no timing file is still green', () => {
    const dir = makeRepo();
    const run = runCli(dir, ['check'], { FAKE_CHECK_NO_STEPS_FILE: '1' });
    expect(run.status).toBe(0);
    const [line] = ledgerIn(dir, 'task/x10-check-throughput');
    expect(line.result).toBe('pass');
    expect(line.stepTimings).toBeNull();
    expect(stepTimingsOf(line)).toEqual([]);
  }, 60_000);

  it('a check that reports zero steps is a fail, not a silent pass (M3)', () => {
    // A runner that exits 0 having started nothing writes an empty step list.
    const dir = makeRepo();
    const run = runCli(dir, ['check'], {
      FAKE_CHECK_STEPS_JSON: '{"version":1,"jobs":4,"wallMs":12,"steps":[]}',
    });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('reported no steps');
    const [line] = ledgerIn(dir, 'task/x10-check-throughput');
    expect(line.result).toBe('fail');
    // The empty breakdown is still recorded.
    expect(stepTimingsOf(line)).toEqual([]);
    expect(line.stepTimings).not.toBeNull();
  }, 60_000);

  it('a corrupt timing file is ignored rather than recorded as nonsense', () => {
    const dir = makeRepo();
    const run = runCli(dir, ['check'], {
      FAKE_CHECK_STEPS_JSON: '{"steps": "not an array"}',
    });
    expect(run.status).toBe(0);
    const [line] = ledgerIn(dir, 'task/x10-check-throughput');
    expect(line.stepTimings).toBeNull();
  }, 60_000);

  it('only the check gate is asked for a timing file', () => {
    const dir = makeRepo();
    runCli(dir, ['harness:ios', '--', 'One'], {});
    const [line] = ledgerIn(dir, 'task/x10-check-throughput');
    expect(line.gate).toBe('harness:ios:One');
    expect(line.stepTimings).toBeNull();
  }, 60_000);
});

describe('the runner and the ledger agree on the step list', () => {
  it('the gate ledger and the runner read the same tooling list file', () => {
    expect(isToolingPath('scripts/check.mjs')).toBe(true);
    expect(fs.existsSync(CHECK_STEPS)).toBe(true);
  });
});

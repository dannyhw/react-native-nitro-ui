/**
 * What `check` records.
 *
 * `check` used to be one number ("3 m 04 s"), so a step that doubled in cost was
 * invisible until someone timed it by hand. The per-step breakdown in the ledger
 * line is what makes `gate.mjs table --full` answer "which step?", and these tests
 * pin that the breakdown arrives, is shaped, and is tolerant when it does not
 * arrive at all.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

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
    // A blank duration reads like a step that took no time, which is a claim.
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
    // One row, four cells: the escaped pipe is content, not a column separator.
    const row = out.split('\n').find((line) => line.includes('`lint`'));
    expect(row.split(/(?<!\\)\|/)).toHaveLength(6);
  });
});

/* --------------------------- the tooling allow-list -------------------------- */

describe('TOOLING_FILES (X10, X26 additions)', () => {
  it.each([
    // Each of these used to count as "both platforms", so a one-line change to a
    // dev-only script owed four device runs. None of them can reach the app binary:
    // they run checks, schedule them, or describe a device pool the app never sees.
    // The lease pair is X26's: `lease.mjs` is a machine's own allocator, it ships in
    // no package, and no app binary contains it - what it decides is *when* a run may
    // start, which is the same argument that put `build-slot-core.mjs` on this list.
    'scripts/check.mjs',
    'scripts/check-steps.mjs',
    // X34: the supervisor a gate's command runs under, listed with `gate.mjs` beside it.
    'scripts/gate-runner.mjs',
    'scripts/gen-registry.mjs',
    'scripts/registry-core.mjs',
    'scripts/build-slot-core.mjs',
    'scripts/devices.example.json',
    'scripts/sync-example-lock.mjs',
    'scripts/lease.mjs',
    'scripts/lease-core.mjs',
    // X30: the hand-in checker, listed the same way and proven the same way below.
    'scripts/task-ready.mjs',
    'scripts/task-ready-core.mjs',
    // The ESLint config, whose rules directory is already tooling: a commit turning
    // one of them on was asking for two harness runs.
    'eslint.config.mjs',
    // The worktree lister and the watchdog: they read the machine and are proven below.
    'scripts/worktrees.mjs',
    'scripts/worktrees-core.mjs',
    'scripts/watchdog.mjs',
    'scripts/watchdog-core.mjs',
    // The task-record retention tool: it reads git and `docs/tasks`, proven below.
    'scripts/task-records.mjs',
    'scripts/task-records-core.mjs',
  ])('%s is check-only tooling', (file) => {
    expect(TOOLING_FILES).toContain(file);
    expect(isToolingPath(file)).toBe(true);
    // ... and belongs to neither platform's half, which is what stops a lease change
    // from re-owing two device runs on top of `check`.
    expect(platformsOwningFile(file)).toEqual([]);
  });

  it('task-ready is on the list because nothing a device run touches reads it', () => {
    // The claim a TOOLING_FILES entry rests on is "no binary contains this", and the
    // honest form of it is a search, not a sentence: X30's own commit had to be
    // tested as "both platforms" until this pair was listed, because an unclaimed
    // path under `scripts/` is the expensive answer by design. If a device run ever
    // does start importing the checker, this goes red and the entry comes off.
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
    // Everything left after the tooling paths are subtracted. Round 1 searched four
    // app directories and stopped at the edge of `scripts/`, which is exactly where a
    // device runner lives — `scripts/harness.mjs` importing the checker would have
    // looked clean. So the search now covers `scripts/` too and removes only what the
    // same list already calls tooling, which is the checker's own files, its tests and
    // the comment in `gate-core.mjs` that names them. What must remain is the npm
    // script that runs it, and nothing else: no import, no require, no harness config,
    // no app source, no runner (X30 fix round 1).
    const readers = hits.stdout
      .trim()
      .split('\n')
      .filter((file) => file !== '' && !isToolingPath(file));
    expect(readers).toEqual(['package.json']);
    // The widening is real: without the tooling paths, `scripts/` does answer, so a
    // search that silently matched nothing there would not look different from this.
    expect(hits.stdout).toContain('scripts/task-ready.mjs');
  });

  it('nothing a device run starts imports the worktree lister, the watchdog or the task-record tool', () => {
    // Same shape as the task-ready search above, for the same reason: a file on this
    // list is trusted to need no device run, so "no runner reads it" is asked of git.
    // `gate.mjs` names `scripts/worktrees.mjs` in a refusal message and is itself
    // tooling, which is why the tooling paths are subtracted rather than expected empty.
    // File names, not the bare word: `watchdog` alone also matches the native dwell
    // probe, which has a watchdog of its own and nothing to do with this script.
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
      // The search does answer inside `scripts/`, so an empty result is not a typo.
      expect(hits.stdout).toContain('scripts/');
    }
  });

  it('gate-runner is on the list because nothing a device run touches reads it', () => {
    // The same search as the checker's claim, because the same mistake is available here:
    // `scripts/gate-runner.mjs` wraps every device gate's command, which *sounds* like something
    // a device run depends on. It is not: it decides whether the run's processes come down when
    // its gate dies, and it is in neither binary. If a runner, a harness config or an app file
    // ever imports it, this goes red and the entry comes off — which is the right direction to
    // fail in, because the cost of a wrong entry is a device run nobody had.
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
    // Nothing outside the tooling list names it: not `harness.mjs`, not a runner, not the app.
    expect(readers).toEqual([]);
    // And the search really does answer, so a `git grep` that silently matched nothing in
    // `scripts/` cannot pass this by being empty. `gate.mjs` is the importer that must be there:
    // the supervisor exists to be started by it, and it is tooling too, so it belongs to no half.
    expect(hits.stdout).toContain('scripts/gate.mjs');
    expect(hits.stdout).toContain('scripts/gate-core.mjs');
  });

  it('a commit that only changes the checker re-owns check and no device run', () => {
    // The X30 consequence, stated as behaviour rather than as membership: before the
    // pair was listed this diff was *unmapped* code - the expensive answer, both
    // platforms - so a round that touched nothing but the hand-in checker owed two
    // harness runs no device needed and its task was not allowed to run.
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
    // The wiring, end to end: `gate.mjs` starts its command through `gate-runner.mjs`, so the
    // supervisor's own exit code and the command's stdout have to arrive unchanged — a wrapper that
    // swallowed the exit code would turn every red gate green, and a wrapper that lost the output
    // would empty every ledger line's test counts. The two assertions below are exactly those two
    // things, on the same fixture run the timing cases above rely on.
    const dir = makeRepo();
    const store = path.join(dir, 'store');
    const run = runCli(
      dir,
      ['check'],
      { NITRO_UI_GATE_LOG_STORE: store },
      // Asked of the kernel, not reported by the wrapper: which group is the *command* in, and what
      // did the gate tell the supervisor about itself. `$$` is this script's own pid, and its group
      // is the answer to "who could `kill(-pgid)` reach" — the group `ownMetroPids` attributes a
      // leftover Metro by, and the group the gate's signal handlers aim at.
      'echo "supervisor: pgid=$(ps -o pgid= -p $$ | tr -d \" \") of=${NITRO_UI_GATE_RUNNER_OF:-none} gate=${NITRO_UI_GATE_RUNNER_GATE:-none}"'
    );
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('fake check:');
    expect(run.stdout).toContain('Tests: 665 passed, 665 total');
    const [line] = ledgerIn(dir, 'task/x10-check-throughput');
    expect(line).toBeTruthy();
    // The command's counts still reached the ledger, through the supervisor's stdios.
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
    // THE claim, in the fixture that runs the real `gate.mjs`: the group the command is living in is
    // the group the supervisor wrote down — which is the number `gate.mjs` got from its own spawn,
    // so a server the command leaves behind is attributable, and sweepable, by a gate that is still
    // alive. Start the command in a group of its own and this is the line that goes red.
    expect(sidecar.group).toBe(commandGroup);
    expect(sidecar.gatePid).toBe(gatePid);
    expect(sidecar.gate).toBe('check');
    expect(sidecar.logPath).toBe(line.logPath);
    // A finished run records no sweep: there was nothing to sweep.
    expect(sidecar.stopped).toBeUndefined();
  });

  it('the files are real, so the list cannot guard a path that does not exist', () => {
    for (const file of TOOLING_FILES) {
      expect(fs.existsSync(path.join(process.cwd(), file))).toBe(true);
    }
  });

  it('what a device run really depends on is still mapped', () => {
    // The other half of the claim: `build-app.mjs` takes the slot, so it stays
    // both-platforms even though `build-slot-core.mjs` next to it does not.
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
 * The environment every git call in this file makes runs with.
 *
 * `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_COMMON_DIR` and
 * `GIT_OBJECT_DIRECTORY` are inherited by every child process, and they *win* over `cwd` - so a
 * suite that runs `git commit`/`checkout`/`merge` with them set (a git hook, `submodule foreach`, a
 * wrapper script) acts on whoever set them. The X10 review reproduced exactly that: running one of
 * these tests with `GIT_DIR` pointed at a victim repo wrote a `base` commit into it and switched its
 * branch. These are the repo's first tests that mutate a repository, so the variables are removed
 * rather than passed through, and `gitIn` additionally asserts which repository it is talking to.
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
 * Runs a mutating git command, and refuses to if the repository it would reach is not this test's
 * own temp checkout. `--show-toplevel` is asked with the same environment as the command itself, so
 * a `GIT_DIR` that would redirect the command also fails this check instead of going unnoticed.
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
    // The variables git obeys *instead of* cwd. Asserting they are absent only tests anything if
    // something put them there first, so the process environment is poisoned for the duration - with
    // a *different* repository, so an environment that failed to strip them answers about the wrong
    // checkout and this goes red rather than passing by coincidence.
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
        // One question, two environments: the helper's answers about `dir`; the inherited one is
        // talking about the other checkout, which is the whole hazard.
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
    // Both halves in one test, which is the red proof. Left half: the environment wins over `cwd`, so
    // the naive `{...process.env}` the review flagged commits into an unrelated repo - asserted here
    // so the scenario cannot rot into fiction. Right half: the helper's environment runs the same
    // command against the caller's directory instead, leaving the victim's history alone.
    const victim = fs.mkdtempSync(path.join(os.tmpdir(), 'x10-victim-'));
    const caller = makeRepo();
    try {
      gitIn(victim, ['init', '-q', '-b', 'main']);
      fs.writeFileSync(path.join(victim, 'thing.txt'), 'untouched\n');
      gitIn(victim, ['add', '-A']);
      gitIn(victim, ['commit', '-qm', 'victim base']);
      const before = gitIn(victim, ['rev-parse', 'HEAD']);

      // `cwd` is the caller and the commit still lands in the victim: GIT_DIR chooses the repository,
      // and a mutating command through `cwd` is not enough to stay in your lane.
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

      // The helper's environment cannot be redirected this way, because it does not carry the
      // variable at all, so the same mutating call stays in the caller's checkout.
      expect(gitEnv(caller).GIT_DIR).toBeUndefined();
      expect(gitIn(caller, ['rev-parse', '--show-toplevel'])).toBe(
        fs.realpathSync(caller)
      );
      const victimHead = gitIn(victim, ['rev-parse', 'HEAD']);
      expect(() =>
        gitInTempRepo(caller, ['commit', '--allow-empty', '-qm', 'mine'])
      ).not.toThrow();
      expect(gitIn(victim, ['rev-parse', 'HEAD'])).toBe(victimHead);

      // And the toplevel assertion below the guard is not decoration: with `GIT_WORK_TREE` pointing
      // elsewhere, that is exactly what `--show-toplevel` reports - the victim - which is the
      // condition `gitInTempRepo` throws on rather than acting.
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
 * A checkout with one code file, a `main`, and a task branch - the smallest thing
 * `gate.mjs` will run in. `.gates/` is gitignored here as it is in the real repo,
 * or the ledger's own logs count as code and every line reads stale.
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
 * A fake `bun run check` that behaves like the real runner's contract with the
 * ledger: it writes the per-step timings `NITRO_UI_CHECK_STEPS_FILE` names, and it
 * prints a Jest summary. `FAKE_CHECK_NO_STEPS_FILE=1` leaves it out, which is the
 * case that must stay green.
 *
 * `hook` is extra shell run before the exit, for the tests that need the tree to move
 * *during* a run. It has to go here rather than in a script a test writes first,
 * because `runCli` calls this function and would otherwise overwrite it.
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
 * The lease this suite's runs are sourced with, and the store that backs it (X28).
 *
 * `harness:ios` here is a device gate, and a device gate now refuses to start unless
 * the store named by `NITRO_UI_HOME` holds the lease its environment names — so a
 * suite that names a device without one gets exit 1 and no ledger line, which is not
 * what these tests are about. The store lives in the fixture rather than at the
 * machine's `~/.nitro-ui` for the same reason: the CLI used to read the real one, and
 * what another task had leased is not this suite's business.
 */
const FIXTURE_LEASE = leaseRecord({
  id: 'X10-1',
  task: 'X10',
  platform: 'ios',
});

function fixtureLeaseEnv(dir) {
  const home = path.join(dir, 'state');
  writeLeaseStore(home, { leases: [FIXTURE_LEASE] });
  // `FREE_LSOF` because leasing a pair exports its Metro port, and the pre-flight then
  // asks the kernel about it — on this machine that is another task's Metro.
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
    // Same reason as `gitEnv`: the CLI runs git in `dir`, and an inherited GIT_DIR
    // would send it somewhere else.
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
    // The unit-test summary is still what the row reports (M3), next to the steps.
    expect(line.counts.tests.total).toBe(665);

    const table = runCli(dir, ['table', '--for', 'merge', '--full']);
    expect(table.stdout).toContain('### `check` steps - 4 job(s)');
    expect(table.stdout).toContain('| `test` | **PASS** | 2 m 27 s | — |');
    // Without --full the report's table stays the short one a reviewer reads.
    const short = runCli(dir, ['table', '--for', 'merge']);
    expect(short.stdout).not.toContain('### `check` steps');
  }, 60_000);

  it('a check with no timing file is still green', () => {
    // The breakdown is a report on the run, not evidence about it: a runner that
    // could not write it must not turn a passing gate red.
    const dir = makeRepo();
    const run = runCli(dir, ['check'], { FAKE_CHECK_NO_STEPS_FILE: '1' });
    expect(run.status).toBe(0);
    const [line] = ledgerIn(dir, 'task/x10-check-throughput');
    expect(line.result).toBe('pass');
    expect(line.stepTimings).toBeNull();
    expect(stepTimingsOf(line)).toEqual([]);
  }, 60_000);

  it('a check that reports zero steps is a fail, not a silent pass (M3)', () => {
    // The other half of the entry-guard bug: a runner that exits 0 having started
    // nothing writes an empty step list, and from here that looked like a green run.
    // An empty list is now evidence of the opposite.
    const dir = makeRepo();
    const run = runCli(dir, ['check'], {
      FAKE_CHECK_STEPS_JSON: '{"version":1,"jobs":4,"wallMs":12,"steps":[]}',
    });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('reported no steps');
    const [line] = ledgerIn(dir, 'task/x10-check-throughput');
    expect(line.result).toBe('fail');
    // The breakdown is still recorded, because it is the proof of the emptiness.
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
    // `scripts/check.mjs` is on the allow-list, and it is the thing `check` runs, so
    // editing it must not owe device gates - that is the point of X10's item 4.
    expect(isToolingPath('scripts/check.mjs')).toBe(true);
    expect(fs.existsSync(CHECK_STEPS)).toBe(true);
  });
});

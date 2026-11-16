import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import {
  decideNeed,
  foreignProofKey,
  gateRowFor,
  isToolingPath,
  JUDGE_FILES,
  judgeDigest,
  LEDGER_VERSION,
  ledgerLineFromRun,
  RELAXING_SWITCHES,
  renderGateTable,
  summarizeGates,
} from '../gate-core.mjs';
import { reachableFiles } from './helpers/import-graph.mjs';
import { withoutLeaseEnv } from './helpers/scrubbed-env.js';
import {
  DEFAULT_PAIR,
  leaseRecord,
  leasedEnv,
  writeLeaseStore,
} from './helpers/lease-store.js';

const CLI = path.join(process.cwd(), 'scripts', 'gate.mjs');

const TREE = 'f'.repeat(64);
const OTHER_TREE = 'e'.repeat(64);
const TREES = { ios: 'i'.repeat(64), android: 'a'.repeat(64) };
const GATE_TREES = {
  'harness:ios': '1'.repeat(64),
  'harness:android': '2'.repeat(64),
  'real-input:ios': '3'.repeat(64),
  'real-input:android': '4'.repeat(64),
};
const JUDGE = 'j'.repeat(64);
const now = { tree: TREE, trees: TREES, gateTrees: GATE_TREES, judge: JUDGE };

const COMMANDS = {
  'check': 'bun run check',
  'harness:ios': 'node ../scripts/harness.mjs --harnessRunner ios',
  'real-input:ios': 'node scripts/real-input/ios.mjs',
};

/** A full green run recorded on `task/other`, on today's digests unless told otherwise. */
function run(overrides = {}) {
  const gate = overrides.gate ?? 'harness:ios';
  return ledgerLineFromRun({
    gate,
    command: COMMANDS[gate],
    tree: TREE,
    trees: TREES,
    gateTrees: GATE_TREES,
    treeAfter: TREE,
    gateTreesAfter: GATE_TREES,
    head: 'abc1234',
    branch: 'task/other',
    durationMs: 600_000,
    result: 'pass',
    exitCode: 0,
    startedAt: Date.parse('2026-11-16T10:00:00Z'),
    logPath: 'task/other/harness+ios-a.log',
    relaxed: {},
    judge: JUDGE,
    ...overrides,
  });
}

const rowOf = (gate, { list = [], foreign = [] } = {}) =>
  gateRowFor({ gate, list, foreign, ...now });

/* ------------------------- what a run from elsewhere proves ------------------------- */

describe('a green run recorded on another branch', () => {
  it('proves the gate when its digest for the gate is the current one, and the row names its branch', () => {
    const row = rowOf('harness:ios', { foreign: [run()] });
    expect(row.state).toBe('green');
    expect(row.from).toBe('task/other');
    expect(row.matched).toBe('harness:ios');
  });

  it('proves nothing when its digest for the gate differs', () => {
    const elsewhere = run({
      gateTrees: { ...GATE_TREES, 'harness:ios': '9'.repeat(64) },
      gateTreesAfter: { ...GATE_TREES, 'harness:ios': '9'.repeat(64) },
    });
    expect(rowOf('harness:ios', { foreign: [elsewhere] }).state).toBe(
      'missing'
    );
  });

  it('never proves `check`, which reads files the code tree leaves out', () => {
    for (const check of [
      run({ gate: 'check' }),
      run({ gate: 'check', result: 'fail', exitCode: 1 }),
      run({ gate: 'check', tree: OTHER_TREE, treeAfter: OTHER_TREE }),
    ]) {
      expect(rowOf('check', { foreign: [check] }).state).toBe('missing');
    }
    const need = decideNeed({
      entries: [],
      foreign: [run({ gate: 'check' })],
      ...now,
      stage: 'review',
    });
    expect(need.missing).toContain('check');
  });

  it('is compared on its own digest only, never on a fallback a line of this branch may use', () => {
    // Same platform half and full tree, but no per-gate digest: a line of this
    // branch would be compared on the platform half; one from elsewhere is not.
    const old = run({ gateTrees: null, gateTreesAfter: null });
    expect(rowOf('harness:ios', { foreign: [old] }).state).toBe('missing');
    expect(rowOf('harness:ios', { list: [old] }).state).toBe('green');
  });

  it('proves nothing when it was filtered', () => {
    const filtered = run({
      command: 'node ../scripts/harness.mjs --harnessRunner ios Switch',
    });
    expect(rowOf('harness:ios', { foreign: [filtered] }).state).toBe('missing');
    // Under its own name, as `resolveGate` records it, it is never even read.
    const named = run({
      gate: 'harness:ios:Switch',
      command: filtered.command,
    });
    const need = decideNeed({
      entries: [],
      foreign: [named],
      ...now,
      stage: 'merge',
    });
    expect(need.missing).toContain('harness:ios');
  });

  it('proves nothing when the tree, or the gate digest, moved while it ran, or when that was not read', () => {
    for (const moved of [
      run({ treeAfter: OTHER_TREE }),
      run({
        gateTreesAfter: { ...GATE_TREES, 'harness:ios': '9'.repeat(64) },
      }),
      run({ treeAfter: null }),
      run({ gateTreesAfter: null }),
    ]) {
      expect(rowOf('harness:ios', { foreign: [moved] }).state).toBe('missing');
    }
  });

  it('a red full run elsewhere on the current digest makes the row red and names its branch', () => {
    const red = run({ result: 'fail', exitCode: 1 });
    const row = rowOf('harness:ios', { foreign: [red] });
    expect(row.state).toBe('red');
    expect(row.from).toBe('task/other');
    // On another digest, filtered or moved, a red decides nothing either.
    for (const ignored of [
      run({
        result: 'fail',
        gateTrees: { ...GATE_TREES, 'harness:ios': '9'.repeat(64) },
        gateTreesAfter: { ...GATE_TREES, 'harness:ios': '9'.repeat(64) },
      }),
      run({
        result: 'fail',
        command: 'node ../scripts/harness.mjs --harnessRunner ios Switch',
      }),
      run({ result: 'fail', treeAfter: OTHER_TREE }),
    ]) {
      expect(rowOf('harness:ios', { foreign: [ignored] }).state).toBe(
        'missing'
      );
    }
  });

  it('proves nothing when a relaxing switch was set, or the line does not say', () => {
    const relaxed = run({ relaxed: { NITRO_UI_ALLOW_UNSTAMPED: '1' } });
    expect(rowOf('harness:ios', { foreign: [relaxed] }).state).toBe('missing');
    expect(
      rowOf('harness:ios', { foreign: [run({ relaxed: null })] }).state
    ).toBe('missing');
    // A relaxed red still decides: it can only ask for a run.
    const red = run({
      result: 'fail',
      exitCode: 1,
      relaxed: { NITRO_UI_GATE_DEVICE_FORCE: '1' },
    });
    expect(rowOf('harness:ios', { foreign: [red] }).state).toBe('red');
  });

  it('proves nothing when another ledger version wrote it', () => {
    for (const v of [LEDGER_VERSION - 1, LEDGER_VERSION + 1]) {
      expect(rowOf('harness:ios', { foreign: [{ ...run(), v }] }).state).toBe(
        'missing'
      );
    }
  });

  it('proves nothing when other gate code judged it, or the line does not say', () => {
    const other = run({ judge: 'k'.repeat(64) });
    expect(rowOf('harness:ios', { foreign: [other] }).state).toBe('missing');
    expect(
      rowOf('harness:ios', { foreign: [run({ judge: null })] }).state
    ).toBe('missing');
    // On its own branch the gate code is not compared.
    expect(rowOf('harness:ios', { list: [other] }).state).toBe('green');
    // A red judged by other gate code still decides.
    const red = run({ result: 'fail', exitCode: 1, judge: 'k'.repeat(64) });
    expect(rowOf('harness:ios', { foreign: [red] }).state).toBe('red');
  });

  it('a relaxed run still counts on its own branch, and shows as relaxed', () => {
    const relaxed = run({
      branch: 'task/here',
      relaxed: { NITRO_UI_ALLOW_LOCALE_MISMATCH: '1' },
    });
    expect(rowOf('harness:ios', { list: [relaxed] }).state).toBe('green');
    const table = renderGateTable({ entries: [relaxed], ...now });
    expect(table).toContain(
      '| `harness:ios` | **PASS** (relaxed: NITRO_UI_ALLOW_LOCALE_MISMATCH)'
    );
  });

  it('a completed run counts, shows as completed and names its branch', () => {
    const completed = run({
      gate: 'real-input:ios',
      command: 'node scripts/real-input/ios.mjs --control form',
      units: {
        kind: 'real-input',
        results: { switch: 'pass', form: 'pass' },
        everyRun: {},
        unnamed: [],
      },
      completion: {
        of: { ts: 'x', logPath: 'x.log', durationMs: 3_000_000 },
        attempt: 1,
        rerun: ['form'],
        filtered: 'real-input:ios:--control:form',
      },
    });
    const table = renderGateTable({
      entries: [],
      foreign: [completed],
      ...now,
    });
    const row = table
      .split('\n')
      .find((text) => text.startsWith('| `real-input:ios`'));
    expect(row).toContain(
      '**PASS** (completed: 1 of 2 units re-run, attempt 1; from `task/other`)'
    );
    // A completion that does not say it completed a full run is not one.
    const unnamed = { ...completed, completion: { ...completed.completion } };
    delete unnamed.completion.of;
    expect(rowOf('real-input:ios', { foreign: [unnamed] }).state).toBe(
      'missing'
    );
  });
});

describe("this branch's own lines come first", () => {
  it("a red run of this branch on the current digest is not hidden by another branch's green", () => {
    const red = run({ branch: 'task/here', result: 'fail', exitCode: 1 });
    const row = rowOf('harness:ios', { list: [red], foreign: [run()] });
    expect(row.state).toBe('red');
    expect(row.from).toBeNull();
    const need = decideNeed({
      entries: [red],
      foreign: [run()],
      ...now,
      stage: 'merge',
    });
    expect(need.missing).toContain('harness:ios');
  });

  it("a green run of this branch wins over another branch's", () => {
    const own = run({ branch: 'task/here', durationMs: 1_000 });
    const row = rowOf('harness:ios', { list: [own], foreign: [run()] });
    expect(row.state).toBe('green');
    expect(row.from).toBeNull();
    expect(row.entry).toBe(own);
  });

  it("a line of this branch on an older digest gives way to another branch's green on this one", () => {
    const stale = run({
      branch: 'task/here',
      gateTrees: { ...GATE_TREES, 'harness:ios': '9'.repeat(64) },
      gateTreesAfter: { ...GATE_TREES, 'harness:ios': '9'.repeat(64) },
    });
    const row = rowOf('harness:ios', { list: [stale], foreign: [run()] });
    expect(row.state).toBe('green');
    expect(row.from).toBe('task/other');
  });

  it('the newest of several green runs elsewhere is the one shown', () => {
    const older = run({ branch: 'task/older' });
    const newer = run({
      branch: 'task/newer',
      startedAt: Date.parse('2026-11-16T12:00:00Z'),
    });
    expect(rowOf('harness:ios', { foreign: [newer, older] }).from).toBe(
      'task/newer'
    );
  });
});

describe('the newest decisive run across the clone decides', () => {
  const at = (iso) => Date.parse(`2026-11-16T${iso}:00Z`);

  it('a branch whose newest run on these files is red gives no other branch a green', () => {
    const green = run({ branch: 'task/t', startedAt: at('10:00') });
    const red = run({
      branch: 'task/t',
      result: 'fail',
      exitCode: 1,
      startedAt: at('12:00'),
    });
    // On its own branch the newest line decides, and it is red.
    expect(rowOf('harness:ios', { list: [green, red] }).state).toBe('red');
    // So it is red on any other branch on the same files.
    const row = rowOf('harness:ios', { foreign: [green, red] });
    expect(row.state).toBe('red');
    expect(row.from).toBe('task/t');
    const need = decideNeed({
      entries: [],
      foreign: [green, red],
      ...now,
      stage: 'merge',
    });
    expect(need.missing).toContain('harness:ios');
  });

  it('a red on one branch is cleared by a newer full green on the same digest from any branch', () => {
    const red = run({
      branch: 'task/t',
      result: 'fail',
      exitCode: 1,
      startedAt: at('12:00'),
    });
    const later = run({ branch: 'task/u', startedAt: at('13:00') });
    const row = rowOf('harness:ios', { foreign: [red, later] });
    expect(row.state).toBe('green');
    expect(row.from).toBe('task/u');
    // A newer red on another branch voids an older green on a third.
    const older = run({ branch: 'task/u', startedAt: at('09:00') });
    expect(rowOf('harness:ios', { foreign: [older, red] }).state).toBe('red');
  });

  it("this branch's own green still decides first", () => {
    const own = run({ branch: 'task/here', startedAt: at('09:00') });
    const red = run({
      branch: 'task/t',
      result: 'fail',
      exitCode: 1,
      startedAt: at('12:00'),
    });
    const row = rowOf('harness:ios', { list: [own], foreign: [red] });
    expect(row.state).toBe('green');
    expect(row.from).toBeNull();
  });
});

describe('the gate code a run is judged by', () => {
  it('JUDGE_FILES holds every check-only file the gate or a device run executes', () => {
    // The gate, its supervisor and the lease, then what each device gate starts.
    const roots = [
      'scripts/gate.mjs',
      'scripts/gate-runner.mjs',
      'scripts/lease.mjs',
      'scripts/harness.mjs',
      'example/rn-harness.config.mjs',
      'example/jest.harness.config.mjs',
      'example/metro.config.js',
      'example/babel.config.js',
      'example/index.js',
      'scripts/build-app.mjs',
      'scripts/real-input/ios.mjs',
      'scripts/real-input/android.mjs',
    ];
    const reached = [...reachableFiles(process.cwd(), roots).keys()];
    const checkOnly = reached.filter((file) => isToolingPath(file)).sort();
    expect(checkOnly.filter((file) => !JUDGE_FILES.includes(file))).toEqual([]);
    // Anything else is already in a device digest.
    expect(JUDGE_FILES.filter((file) => !isToolingPath(file))).toEqual([]);
  });

  it('moves when one of its files changes, and only then', () => {
    const files = Object.fromEntries(JUDGE_FILES.map((file) => [file, file]));
    const read = (overrides) => (file) =>
      ({ ...files, ...overrides })[file] ?? null;
    const base = judgeDigest(read({}));
    expect(judgeDigest(read({}))).toBe(base);
    expect(judgeDigest(read({ 'scripts/gate-runner.mjs': 'edited' }))).not.toBe(
      base
    );
    expect(judgeDigest(read({ 'scripts/check.mjs': 'edited' }))).toBe(base);
  });
});

describe('ledger lines written before the clone-wide record', () => {
  it('still decide on their own branch the way they did', () => {
    // No `gateTrees` and no `treeAfter`: compared on the platform half, taken at their word.
    const legacy = {
      v: 5,
      ts: '2026-10-01T00:00:00.000Z',
      gate: 'harness:android',
      tree: OTHER_TREE,
      trees: TREES,
      result: 'pass',
    };
    const rows = summarizeGates({ entries: [legacy], ...now });
    expect(rows.find((row) => row.gate === 'harness:android').state).toBe(
      'green'
    );
    // From elsewhere the same line proves nothing.
    expect(
      foreignProofKey({ gate: 'harness:android', entry: legacy, ...now })
    ).toBeNull();
  });
});

/* ------------------------------ end to end, through the CLI ------------------------------ */

const cleanup = [];
afterAll(() => {
  for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
});

function gitEnv(home) {
  const env = { ...withoutLeaseEnv(process.env) };
  for (const name of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_COMMON_DIR',
    'GIT_OBJECT_DIRECTORY',
    // A switch inherited from the shell, `CI` on a CI runner, would mark every run relaxed.
    ...RELAXING_SWITCHES,
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
    HOME: home,
  };
}

function git(dir, args) {
  const result = spawnSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    env: gitEnv(dir),
  });
  if (result.status !== 0)
    throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

/**
 * A clone whose main checkout is on `task/here`, with a second worktree on
 * `task/there` at the same commit. The fake `node` and `bun` stand in for every
 * runner: each writes the harness suite record it is handed and exits `FAKE_EXIT`.
 */
function makeClone() {
  const parent = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'gate-evidence-'))
  );
  cleanup.push(parent);
  const here = path.join(parent, 'here');
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(here, file)), { recursive: true });
    fs.writeFileSync(path.join(here, file), content);
  };
  write('nitrogen/generated/ios/NitroUiAutolinking.swift', '// marker\n');
  write('ios/core/Core.swift', 'v1\n');
  write('example/package.json', '{"name":"x"}\n');
  write('.gitignore', '.gates/\nstate/\n');
  git(here, ['init', '-q', '-b', 'main']);
  git(here, ['add', '-A']);
  git(here, ['commit', '-qm', 'base']);
  git(here, ['checkout', '-qb', 'task/here']);
  const there = path.join(parent, 'there');
  git(here, ['worktree', 'add', '-q', '-b', 'task/there', there]);
  const bin = path.join(parent, 'fake-bin');
  fs.mkdirSync(bin);
  // On PATH rather than through `NITRO_UI_LSOF_BIN`, which marks a run relaxed.
  fs.writeFileSync(path.join(bin, 'lsof'), '#!/bin/sh\nexit 1\n');
  fs.chmodSync(path.join(bin, 'lsof'), 0o755);
  for (const name of ['node', 'bun']) {
    fs.writeFileSync(
      path.join(bin, name),
      '#!/bin/sh\n' +
        'echo "fake runner: $*"\n' +
        'if [ -n "$HARNESS_SUITE_TIMING" ] && [ -n "$FAKE_TIMING" ]; then printf \'%s\' "$FAKE_TIMING" > "$HARNESS_SUITE_TIMING"; fi\n' +
        'exit ${FAKE_EXIT:-0}\n'
    );
    fs.chmodSync(path.join(bin, name), 0o755);
  }
  return { parent, here, there, bin };
}

const LEASE = leaseRecord({
  id: 'EVIDENCE-1',
  task: 'EVIDENCE',
  platform: 'ios',
});

function runCli(clone, dir, args, env = {}) {
  const home = path.join(clone.parent, 'state');
  writeLeaseStore(home, { leases: [LEASE] });
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      ...gitEnv(clone.parent),
      PATH: `${clone.bin}${path.delimiter}${process.env.PATH}`,
      ...leasedEnv({ home, pair: DEFAULT_PAIR, lease: LEASE }),
      ...env,
    },
  });
}

const timing = (suites) =>
  JSON.stringify({
    version: 1,
    files: Object.keys(suites),
    suites: Object.entries(suites).map(([file, status]) => ({
      file,
      status,
      durationMs: 1000,
    })),
  });

const needLine = (output, gate) =>
  output.split('\n').find((text) => text.includes(` ${gate} —`)) ?? '';

describe('gate.mjs across the worktrees of one clone', () => {
  it('a green run outlives its worktree and satisfies another branch on the same files', () => {
    const clone = makeClone();
    const before = runCli(clone, clone.here, ['need', '--for', 'merge']);
    expect(needLine(before.stdout, 'harness:ios')).toContain('✗');

    expect(runCli(clone, clone.there, ['harness:ios']).status).toBe(0);
    expect(runCli(clone, clone.there, ['check']).status).toBe(0);
    git(clone.here, ['worktree', 'remove', '--force', clone.there]);
    expect(fs.existsSync(clone.there)).toBe(false);

    const after = runCli(clone, clone.here, ['need', '--for', 'merge']);
    expect(needLine(after.stdout, 'harness:ios')).toContain(
      '✓ harness:ios — green on its own digest (from `task/there`)'
    );
    expect(needLine(after.stdout, 'check')).toContain('✗ check');
    expect(after.stdout).toContain('real-input:ios');
    const table = runCli(clone, clone.here, ['table', '--for', 'merge']);
    expect(table.status).toBe(0);
    expect(table.stdout).toContain(
      '| `harness:ios` | **PASS** (from `task/there`)'
    );
    const status = runCli(clone, clone.here, ['status', '--for', 'merge']);
    expect(status.stdout).toMatch(/green\s+harness:ios .*from `task\/there`/);
  }, 120_000);

  it('a red run decides on every branch on the same files, after its worktree is removed too', () => {
    const clone = makeClone();
    expect(runCli(clone, clone.there, ['harness:ios']).status).toBe(0);
    expect(
      runCli(clone, clone.there, ['harness:ios'], { FAKE_EXIT: '1' }).status
    ).toBe(1);
    git(clone.here, ['worktree', 'remove', '--force', clone.there]);

    const need = runCli(clone, clone.here, ['need', '--for', 'merge']);
    expect(needLine(need.stdout, 'harness:ios')).toMatch(
      /✗ harness:ios — red \(exit 1 .*from `task\/there`\)/
    );
    // The same branch in a fresh worktree reads its own red from the record.
    const again = path.join(clone.parent, 'again');
    git(clone.here, ['worktree', 'add', '-q', again, 'task/there']);
    const there = runCli(clone, again, ['need', '--for', 'merge']);
    expect(needLine(there.stdout, 'harness:ios')).toContain(
      '✗ harness:ios — red'
    );
  }, 120_000);

  it('a run with a relaxing switch is recorded as relaxed and proves nothing elsewhere', () => {
    const clone = makeClone();
    expect(
      runCli(clone, clone.there, ['harness:ios'], {
        NITRO_UI_ALLOW_UNSTAMPED: '1',
      }).status
    ).toBe(0);
    const ledger = fs
      .readFileSync(
        path.join(clone.there, '.gates', 'task', 'there.jsonl'),
        'utf8'
      )
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(ledger.at(-1).relaxed).toEqual({ NITRO_UI_ALLOW_UNSTAMPED: '1' });
    const there = runCli(clone, clone.there, ['need', '--for', 'merge']);
    expect(needLine(there.stdout, 'harness:ios')).toContain(
      '✓ harness:ios — green on its own digest (relaxed: NITRO_UI_ALLOW_UNSTAMPED)'
    );
    const here = runCli(clone, clone.here, ['need', '--for', 'merge']);
    expect(needLine(here.stdout, 'harness:ios')).toContain('✗');
  }, 120_000);

  it('a run judged by other gate code proves nothing here', () => {
    const clone = makeClone();
    // Check-only: no device digest moves, only the gate code.
    fs.mkdirSync(path.join(clone.there, 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(clone.there, 'scripts/gate-core.mjs'),
      'export const judged = "differently";\n'
    );
    expect(runCli(clone, clone.there, ['harness:ios']).status).toBe(0);
    const here = runCli(clone, clone.here, ['need', '--for', 'merge']);
    expect(needLine(here.stdout, 'harness:ios')).toContain('✗');
    fs.rmSync(path.join(clone.there, 'scripts'), { recursive: true });
    expect(runCli(clone, clone.there, ['harness:ios']).status).toBe(0);
    const after = runCli(clone, clone.here, ['need', '--for', 'merge']);
    expect(needLine(after.stdout, 'harness:ios')).toContain(
      '✓ harness:ios — green on its own digest (from `task/there`)'
    );
  }, 120_000);

  it('a run on other files proves nothing here', () => {
    const clone = makeClone();
    fs.writeFileSync(path.join(clone.there, 'ios/core/Core.swift'), 'v2\n');
    expect(runCli(clone, clone.there, ['harness:ios']).status).toBe(0);
    const need = runCli(clone, clone.here, ['need', '--for', 'merge']);
    expect(needLine(need.stdout, 'harness:ios')).toContain('✗');
  }, 120_000);

  it('--rerun-failed completes only a red run of the branch it is called on', () => {
    const clone = makeClone();
    const red = runCli(clone, clone.there, ['harness:ios'], {
      FAKE_EXIT: '1',
      FAKE_TIMING: timing({
        '__tests__/Switch.harness.tsx': 'passed',
        '__tests__/Form.harness.tsx': 'failed',
      }),
    });
    expect(red.status).toBe(1);
    const refused = runCli(clone, clone.here, [
      'harness:ios',
      '--rerun-failed',
    ]);
    expect(refused.stderr).toContain(
      'refused before the run - no full harness:ios run is red on the current digest'
    );
    expect(refused.status).toBe(1);
    expect(fs.existsSync(path.join(clone.here, '.gates'))).toBe(false);
  }, 120_000);
});

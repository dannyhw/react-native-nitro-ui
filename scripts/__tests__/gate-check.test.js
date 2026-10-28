/**
 * What `check` records, and what a merge may reuse.
 *
 * Both halves are about a green that is *narrower* than it looks:
 *
 *   - `check` used to be one number ("3 m 04 s"), so a step that doubled in cost
 *     was invisible until someone timed it by hand. The per-step breakdown in the
 *     ledger line is what makes `gate.mjs table --full` answer "which step?", and
 *     these tests pin that the breakdown arrives, is shaped, and is tolerant when
 *     it does not arrive at all;
 *   - merge reuse is the opposite risk: accepting a `check` that did not really
 *     prove this code. So the cases are the ones where a wrong answer reads as
 *     proof - a red line, a line from a tree that only *looks* current, a commit
 *     that is not in this history, a device gate, and a review round.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import {
  TOOLING_FILES,
  applyReusedCheckRow,
  decideNeed,
  findReusableCheck,
  isToolingPath,
  ledgerLineFromRun,
  renderGateTable,
  renderStepTimings,
  stepTimingsOf,
} from '../gate-core.mjs';

const CLI = path.join(process.cwd(), 'scripts', 'gate.mjs');
const CHECK_STEPS = path.join(process.cwd(), 'scripts', 'check-steps.mjs');

const TREE_A = 'a'.repeat(64);
const TREE_B = 'b'.repeat(64);

/** A `check` line, with only the fields the reuse rule reads filled in. */
function checkLine({
  tree = TREE_A,
  head = 'commit-1',
  result = 'pass',
  treeAfter = tree,
  ts = '2026-10-28T09:00:00.000Z',
  gate = 'check',
} = {}) {
  return {
    gate,
    result,
    tree,
    treeAfter,
    head,
    ts,
    durationMs: 180_000,
    exitCode: result === 'pass' ? 0 : 1,
  };
}

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

/* ------------------------------ the merge rule ------------------------------ */

describe('findReusableCheck (may a merge borrow this check?)', () => {
  const ancestor = (commit) => commit === 'commit-1';

  it('accepts a pass on this exact tree whose commit is merged', () => {
    const found = findReusableCheck({
      ledgers: [{ branch: 'task/x10', entries: [checkLine()] }],
      tree: TREE_A,
      headIsAncestor: ancestor,
    });
    expect(found).toEqual({
      branch: 'task/x10',
      entry: expect.objectContaining({ head: 'commit-1' }),
    });
  });

  it('refuses a red line', () => {
    expect(
      findReusableCheck({
        ledgers: [
          { branch: 'task/x', entries: [checkLine({ result: 'fail' })] },
        ],
        tree: TREE_A,
        headIsAncestor: ancestor,
      })
    ).toBeNull();
  });

  it('refuses a line about a different code tree', () => {
    expect(
      findReusableCheck({
        ledgers: [{ branch: 'task/x', entries: [checkLine({ tree: TREE_B })] }],
        tree: TREE_A,
        headIsAncestor: ancestor,
      })
    ).toBeNull();
  });

  it('refuses a run whose tree moved under it (N1)', () => {
    expect(
      findReusableCheck({
        ledgers: [
          {
            branch: 'task/x',
            entries: [checkLine({ treeAfter: TREE_B })],
          },
        ],
        tree: TREE_A,
        headIsAncestor: ancestor,
      })
    ).toBeNull();
  });

  it('refuses a commit that is not in this history', () => {
    // The case that matters: a branch that happens to hold the same tree but was
    // never merged (or was squash-merged, so its head does not exist here at all).
    expect(
      findReusableCheck({
        ledgers: [
          { branch: 'task/x', entries: [checkLine({ head: 'other' })] },
        ],
        tree: TREE_A,
        headIsAncestor: ancestor,
      })
    ).toBeNull();
    expect(
      findReusableCheck({
        ledgers: [{ branch: 'task/x', entries: [checkLine({ head: null })] }],
        tree: TREE_A,
        headIsAncestor: () => true,
      })
    ).toBeNull();
  });

  it('will not carry a device gate across', () => {
    // The brief leaves those to the tree rules: a harness pass is evidence about a
    // binary built on someone's machine and lease, not about a text digest.
    expect(
      findReusableCheck({
        ledgers: [
          {
            branch: 'task/x',
            entries: [checkLine({ gate: 'harness:ios' })],
          },
        ],
        tree: TREE_A,
        headIsAncestor: ancestor,
      })
    ).toBeNull();
  });

  it('takes the newest line when two branches both qualify', () => {
    const found = findReusableCheck({
      ledgers: [
        {
          branch: 'task/older',
          entries: [checkLine({ ts: '2026-10-01T00:00:00.000Z' })],
        },
        {
          branch: 'task/newer',
          entries: [checkLine({ ts: '2026-10-27T00:00:00.000Z' })],
        },
      ],
      tree: TREE_A,
      headIsAncestor: ancestor,
    });
    expect(found.branch).toBe('task/newer');
  });

  it('needs a tree to match at all', () => {
    expect(
      findReusableCheck({
        ledgers: [{ branch: 'task/x', entries: [checkLine()] }],
        tree: null,
        headIsAncestor: ancestor,
      })
    ).toBeNull();
    expect(
      findReusableCheck({
        ledgers: [{ branch: 'task/x', entries: [checkLine()] }],
        tree: TREE_A,
        headIsAncestor: null,
      })
    ).toBeNull();
  });
});

describe('decideNeed with a reused check', () => {
  const reused = { branch: 'task/x10', entry: checkLine() };

  it('satisfies merge and says where the evidence came from', () => {
    const decision = decideNeed({
      entries: [],
      tree: TREE_A,
      stage: 'merge',
      reusedCheck: reused,
    });
    const row = decision.required.find((r) => r.gate === 'check');
    expect(row.state).toBe('green');
    expect(row.reused.branch).toBe('task/x10');
    expect(decision.missing).toEqual([
      'harness:ios',
      'harness:android',
      'real-input:ios',
      'real-input:android',
    ]);
    expect(decision.notes.join('\n')).toContain('task/x10');
  });

  it('does not touch review', () => {
    // A round is evidence about its own diff; borrowing `check` from a branch that
    // is not merged here would let an unproven round read as proven.
    const decision = decideNeed({
      entries: [],
      tree: TREE_A,
      stage: 'review',
      reusedCheck: reused,
    });
    const row = decision.required.find((r) => r.gate === 'check');
    expect(row.state).toBe('missing');
    expect(row.reused).toBeUndefined();
  });

  it('a local pass always wins - reuse is a fallback, not an override', () => {
    const local = checkLine({ head: 'local-commit' });
    const decision = decideNeed({
      entries: [local],
      tree: TREE_A,
      stage: 'merge',
      reusedCheck: reused,
    });
    const row = decision.required.find((r) => r.gate === 'check');
    expect(row.reused).toBeUndefined();
    expect(row.entry.head).toBe('local-commit');
  });

  it('renderGateTable agrees with need, pipe for pipe', () => {
    const table = renderGateTable({
      entries: [],
      tree: TREE_A,
      stage: 'merge',
      reusedCheck: reused,
    });
    expect(table).toContain('**PASS** *(reused)*');
    const strict = renderGateTable({
      entries: [],
      tree: TREE_A,
      stage: 'merge',
    });
    expect(strict).toContain('`check` | missing');
  });

  it('applyReusedCheckRow leaves a green local row alone', () => {
    const rows = [{ gate: 'check', state: 'green', entry: checkLine() }];
    expect(applyReusedCheckRow({ rows, reusedCheck: reused }).rows).toBe(rows);
  });
});

/* --------------------------- the tooling allow-list -------------------------- */

describe('TOOLING_FILES (X10 additions)', () => {
  it.each([
    // Each of these used to count as "both platforms", so a one-line change to a
    // dev-only script owed four device runs. None of them can reach the app binary:
    // they run checks, schedule them, or describe a device pool the app never sees.
    'scripts/check.mjs',
    'scripts/check-steps.mjs',
    'scripts/gen-registry.mjs',
    'scripts/registry-core.mjs',
    'scripts/build-slot-core.mjs',
    'scripts/devices.example.json',
    'scripts/sync-example-lock.mjs',
  ])('%s is check-only tooling', (file) => {
    expect(TOOLING_FILES).toContain(file);
    expect(isToolingPath(file)).toBe(true);
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
      'scripts/lease.mjs',
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

function gitIn(dir, args) {
  const result = spawnSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
      HOME: dir,
    },
  });
  if (result.status !== 0)
    throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return String(result.stdout).trim();
}

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
  write('.gitignore', '.gates/\nfake-bin/\n');
  gitIn(dir, ['init', '-q', '-b', 'main']);
  gitIn(dir, ['add', '-A']);
  gitIn(dir, ['commit', '-qm', 'base']);
  gitIn(dir, ['checkout', '-qb', 'task/x10-check-throughput']);
  cleanup.push(dir);
  return dir;
}

/**
 * A fake `bun run check` that behaves like the real runner's contract with the
 * ledger: it writes the per-step timings `NITRO_UI_CHECK_STEPS_FILE` names, and it
 * prints a Jest summary. `FAKE_CHECK_NO_STEPS_FILE=1` leaves it out, which is the
 * case that must stay green.
 */
function fakeBin(dir) {
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
    'exit ${FAKE_EXIT:-0}\n';
  for (const name of ['bun', 'node']) {
    fs.writeFileSync(path.join(bin, name), script);
    fs.chmodSync(path.join(bin, name), 0o755);
  }
  return bin;
}

function runCli(dir, args, extraEnv = {}) {
  const bin = fakeBin(dir);
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
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

describe('gate.mjs need --for merge reuses a merged branch check', () => {
  const BRANCH = 'task/x10-check-throughput';

  /** Branch work, committed, then `check` run on top of it. */
  function branchThatPassedChecks(dir) {
    fs.mkdirSync(path.join(dir, 'android/src/main/java'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'android/src/main/java/Thing.kt'),
      'class Thing\n'
    );
    gitIn(dir, ['add', '-A']);
    gitIn(dir, ['commit', '-qm', 'feat: branch work']);
    const run = runCli(dir, ['check'], { FAKE_CHECK_STEPS_JSON: STEPS_JSON });
    expect(run.status).toBe(0);
    const lines = ledgerIn(dir, BRANCH);
    expect(lines).toHaveLength(1);
    return lines[0];
  }

  it('accepts it once the branch is merged, and refuses before', () => {
    const dir = makeRepo();
    const line = branchThatPassedChecks(dir);

    // Before the merge, on `main`, the branch's ledger is not this tree's evidence:
    // main's code does not contain the branch's commit, or its file.
    gitIn(dir, ['checkout', '-q', 'main']);
    const before = runCli(dir, ['need', '--for', 'merge', '--base', 'main']);
    expect(before.status).toBe(1);
    expect(before.stdout).toContain('check — never run on this tree');
    expect(before.stdout).not.toContain('reused');

    gitIn(dir, ['merge', '-q', '--no-ff', BRANCH, '-m', 'merge: task']);
    expect(
      spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' })
        .status
    ).toBe(0);
    const after = runCli(dir, ['need', '--for', 'merge', '--base', 'main']);
    expect(after.stdout).toContain(`reused from \`${BRANCH}\``);
    // The line being reused is the one the branch wrote, not a lookalike.
    expect(after.stdout).toContain(line.head.slice(0, 7));
    // Still not a pass overall: the device gates are owed, and reuse does not touch
    // them.
    expect(after.status).toBe(1);
    expect(after.stdout).toContain('harness:ios — never run on this tree');

    const table = runCli(dir, ['table', '--for', 'merge']);
    expect(table.stdout).toContain('**PASS** *(reused)*');
  }, 120_000);

  it('--no-reuse asks the strict question', () => {
    const dir = makeRepo();
    branchThatPassedChecks(dir);
    gitIn(dir, ['checkout', '-q', 'main']);
    gitIn(dir, ['merge', '-q', '--no-ff', BRANCH, '-m', 'merge: task']);
    const strict = runCli(dir, [
      'need',
      '--for',
      'merge',
      '--base',
      'main',
      '--no-reuse',
    ]);
    expect(strict.stdout).not.toContain('reused');
    expect(strict.stdout).toContain('check — never run on this tree');
    expect(strict.status).toBe(1);
  }, 120_000);

  it('does not reuse when the merge brought in code as well', () => {
    // The case the whole rule has to survive: `main` moved, so the merged tree is
    // not the tree that passed, and a `check` on the branch says nothing about the
    // combination.
    const dir = makeRepo();
    branchThatPassedChecks(dir);
    gitIn(dir, ['checkout', '-q', 'main']);
    fs.writeFileSync(
      path.join(dir, 'ios', 'core', 'Main.swift'),
      'main moved\n'
    );
    gitIn(dir, ['add', '-A']);
    gitIn(dir, ['commit', '-qm', 'feat: main moved']);
    gitIn(dir, ['merge', '-q', '--no-ff', BRANCH, '-m', 'merge: task']);
    const after = runCli(dir, ['need', '--for', 'merge', '--base', 'main']);
    expect(after.stdout).not.toContain('reused');
    expect(after.stdout).toContain('check — never run on this tree');
    expect(after.status).toBe(1);
  }, 120_000);

  it('does not reuse across a squash merge, where the tree matches and the commit does not', () => {
    // Isolates the ancestor test from the tree test: a squash merge produces the
    // same code and a history that does not contain the branch's commit, so the
    // evidence cannot be placed in this tree and is not borrowed.
    const dir = makeRepo();
    const line = branchThatPassedChecks(dir);
    gitIn(dir, ['checkout', '-q', 'main']);
    gitIn(dir, ['merge', '-q', '--squash', BRANCH]);
    gitIn(dir, ['commit', '-qm', 'feat: branch work (squashed)']);
    // And the tree really is the one that passed, so the refusal is the commit's
    // fault alone - otherwise this test would prove nothing.
    const status = runCli(dir, ['status']);
    expect(status.stderr).toContain(`code tree ${line.tree.slice(0, 12)}`);
    const after = runCli(dir, ['need', '--for', 'merge', '--base', 'main']);
    expect(after.stdout).not.toContain('reused');
    expect(after.stdout).toContain('check — never run on this tree');
  }, 120_000);
});

describe('the runner and the ledger agree on the step list', () => {
  it('the gate ledger and the runner read the same tooling list file', () => {
    // `scripts/check.mjs` is on the allow-list, and it is the thing `check` runs, so
    // editing it must not owe device gates - that is the point of X10's item 4.
    expect(isToolingPath('scripts/check.mjs')).toBe(true);
    expect(fs.existsSync(CHECK_STEPS)).toBe(true);
  });
});

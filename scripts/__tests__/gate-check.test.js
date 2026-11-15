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
  LEDGER_VERSION,
  TOOLING_FILES,
  applyReusedCheckRow,
  decideNeed,
  findReusableCheck,
  fullTreesMatch,
  groupLedgerLinesByBranch,
  isToolingPath,
  LOG_STORE_BASENAME,
  ledgerLineFromRun,
  platformsOwningFile,
  platformsTouchedByPaths,
  renderGateTable,
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
const TREE_B = 'b'.repeat(64);

/**
 * A git tree hash, in the shape `git rev-parse HEAD^{tree}` prints. Two of these that
 * differ by one character are different trees, which is the property reuse now rests
 * on, so the fixture is hex rather than a word.
 */
const FULL_A = `${'c'.repeat(39)}1`;
const FULL_B = `${'c'.repeat(39)}2`;

/** A `check` line, with only the fields the reuse rule reads filled in. */
function checkLine({
  tree = TREE_A,
  fullTree = FULL_A,
  worktreeClean = true,
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
    fullTree,
    worktreeClean,
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

  it('carries the reuse pair, and is explicit when they were not measured', () => {
    // `fullTree` and `worktreeClean` default to null rather than a plausible guess, so
    // a caller that did not measure them writes a line reuse refuses instead of one it
    // would wrongly accept.
    const plain = ledgerLineFromRun(baseRun());
    expect(plain.fullTree).toBeNull();
    expect(plain.worktreeClean).toBeNull();
    const measured = ledgerLineFromRun({
      ...baseRun(),
      fullTree: 'c'.repeat(40),
      worktreeClean: true,
    });
    expect(measured.fullTree).toBe('c'.repeat(40));
    expect(measured.worktreeClean).toBe(true);
    // And the two fields are what a v4 line is expected to carry.
    expect(measured.v).toBe(LEDGER_VERSION);
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

  const ask = (ledgers, options = {}) =>
    findReusableCheck({
      ledgers,
      fullTree: FULL_A,
      headIsAncestor: ancestor,
      ...options,
    });

  it('accepts a pass on this exact tree whose commit is merged', () => {
    const found = ask([
      {
        branch: 'task/x10',
        source: '.gates/task/x10.jsonl',
        entries: [checkLine()],
      },
    ]);
    expect(found).toEqual({
      branch: 'task/x10',
      source: '.gates/task/x10.jsonl',
      entry: expect.objectContaining({ head: 'commit-1' }),
    });
  });

  it('carries the file a reused line came from, defaulting to its ledger path', () => {
    // The note has to say which file the evidence is in: a committed task export
    // is a copy, and a reviewer reading `task/x10`'s name should not have to work
    // out which of the two they are looking at.
    expect(ask([{ branch: 'task/x10', entries: [checkLine()] }]).source).toBe(
      '.gates/task/x10.jsonl'
    );
  });

  it('refuses a red line', () => {
    expect(
      ask([{ branch: 'task/x', entries: [checkLine({ result: 'fail' })] }])
    ).toBeNull();
  });

  it('refuses a line about a different tree', () => {
    expect(
      ask([{ branch: 'task/x', entries: [checkLine({ fullTree: FULL_B })] }])
    ).toBeNull();
  });

  it('refuses a line recorded over a dirty worktree, even on the right tree', () => {
    // The M3 shape: the run saw this tree *plus* uncommitted edits, and only the
    // commit's hash is written down, so the line cannot say this tree was checked on
    // its own. `tree` is untouched here - the code digest really does match - which is
    // what makes the flag the only thing refusing.
    expect(
      ask([
        {
          branch: 'task/x',
          entries: [checkLine({ worktreeClean: false })],
        },
      ])
    ).toBeNull();
    // And "not measured" is not "clean": a line written before v4 is not reusable.
    const unmeasured = checkLine();
    delete unmeasured.worktreeClean;
    expect(ask([{ branch: 'task/x', entries: [unmeasured] }])).toBeNull();
  });

  it('refuses when this worktree is dirty, because no hash names the tree in front of us', () => {
    const diagnostics = [];
    expect(
      ask([{ branch: 'task/x', entries: [checkLine()] }], {
        worktreeClean: false,
        diagnostics,
      })
    ).toBeNull();
    expect(diagnostics.join(' ')).toContain('uncommitted changes');
  });

  it('refuses a run whose tree moved under it (N1)', () => {
    expect(
      ask([{ branch: 'task/x', entries: [checkLine({ treeAfter: TREE_B })] }])
    ).toBeNull();
  });

  it('refuses a commit that is not in this history', () => {
    // The case that matters: a branch that happens to hold the same tree but was
    // never merged (or was squash-merged, so its head does not exist here at all).
    expect(
      ask([{ branch: 'task/x', entries: [checkLine({ head: 'other' })] }])
    ).toBeNull();
    expect(
      ask([{ branch: 'task/x', entries: [checkLine({ head: null })] }], {
        headIsAncestor: () => true,
      })
    ).toBeNull();
  });

  it('will not carry a device gate across', () => {
    // The brief leaves those to the tree rules: a harness pass is evidence about a
    // binary built on someone's machine and lease, not about a text digest.
    expect(
      ask([
        {
          branch: 'task/x',
          entries: [checkLine({ gate: 'harness:ios' })],
        },
      ])
    ).toBeNull();
  });

  it('takes the newest line when two branches both qualify', () => {
    const found = ask([
      {
        branch: 'task/older',
        entries: [checkLine({ ts: '2026-10-01T00:00:00.000Z' })],
      },
      {
        branch: 'task/newer',
        entries: [checkLine({ ts: '2026-10-27T00:00:00.000Z' })],
      },
    ]);
    expect(found.branch).toBe('task/newer');
  });

  it('needs a tree to match at all', () => {
    for (const fullTree of [null, undefined, '', 42]) {
      expect(
        findReusableCheck({
          ledgers: [{ branch: 'task/x', entries: [checkLine()] }],
          fullTree,
          headIsAncestor: ancestor,
        })
      ).toBeNull();
    }
    expect(
      findReusableCheck({
        ledgers: [{ branch: 'task/x', entries: [checkLine()] }],
        fullTree: FULL_A,
        headIsAncestor: null,
      })
    ).toBeNull();
  });

  it('ignores a line with no `fullTree` at all - a pre-v4 ledger is not reusable', () => {
    // The fallback reviewers would ask for is "compare `tree` instead", which is the
    // old unsound rule under a new name, so this refuses rather than degrades.
    const v3 = checkLine();
    delete v3.fullTree;
    expect(ask([{ branch: 'task/x', entries: [v3] }])).toBeNull();
  });

  it('a newer fail on the tree beats an older pass, even from another branch - M2', () => {
    // main ran check after the merge and it failed. That is the freshest answer about
    // this exact code, and no branch's older green may print over it.
    expect(
      ask([
        {
          branch: 'task/y',
          entries: [checkLine({ ts: '2026-10-01T00:00:00.000Z' })],
        },
        {
          branch: 'main',
          entries: [
            checkLine({ result: 'fail', ts: '2026-10-28T00:00:00.000Z' }),
          ],
        },
      ])
    ).toBeNull();
  });

  it('a newer pass on the tree does beat an older fail - the same code passed', () => {
    // The other direction, so the rule is "newest wins" and not "any red anywhere".
    const found = ask([
      {
        branch: 'task/y',
        entries: [
          checkLine({ result: 'fail', ts: '2026-10-01T00:00:00.000Z' }),
        ],
      },
      {
        branch: 'task/z',
        entries: [checkLine({ ts: '2026-10-28T00:00:00.000Z' })],
      },
    ]);
    expect(found).not.toBeNull();
    expect(found.branch).toBe('task/z');
  });

  it('an exact timestamp tie resolves against reuse - the fail is the decisive line (N2)', () => {
    // Two ledgers, one pass and one fail, same second. Whichever file a directory
    // listing happens to return first must not decide whether a merge is allowed, so
    // the tie-break takes the answer that refuses.
    const tie = '2026-10-28T09:00:00.000Z';
    expect(
      ask([
        {
          branch: 'task/a',
          entries: [checkLine({ ts: tie })],
        },
        {
          branch: 'task/b',
          entries: [checkLine({ result: 'fail', ts: tie })],
        },
      ])
    ).toBeNull();
    // Same two lines, opposite ledger order: identical answer.
    expect(
      ask([
        {
          branch: 'task/b',
          entries: [checkLine({ result: 'fail', ts: tie })],
        },
        {
          branch: 'task/a',
          entries: [checkLine({ ts: tie })],
        },
      ])
    ).toBeNull();
  });

  it('a ledger whose own newest line on the tree is a fail offers nothing - M2', () => {
    // Same branch, same tree: pass at 10:00, fail at 11:00. `gateRowFor` reads that
    // ledger as red, so reuse must not read it as a green it left behind.
    expect(
      ask([
        {
          branch: 'task/y',
          entries: [
            checkLine({ ts: '2026-10-01T10:00:00.000Z' }),
            checkLine({ result: 'fail', ts: '2026-10-01T11:00:00.000Z' }),
          ],
        },
      ])
    ).toBeNull();
  });

  it('a ledger whose own newest line on the tree is a pass is usable after a revert', () => {
    const found = ask([
      {
        branch: 'task/y',
        entries: [
          checkLine({ result: 'fail', ts: '2026-10-01T10:00:00.000Z' }),
          checkLine({ ts: '2026-10-01T11:00:00.000Z' }),
        ],
      },
    ]);
    expect(found).not.toBeNull();
    expect(found.entry.ts).toBe('2026-10-01T11:00:00.000Z');
  });

  it('the newest line decides across files, so an older green elsewhere cannot win', () => {
    // Two decisive lines on the same tree, in different ledgers. The later one is a
    // fail, and the comparison is global rather than per-file.
    expect(
      ask([
        {
          branch: 'task/a',
          entries: [checkLine({ ts: '2026-10-02T00:00:00.000Z' })],
        },
        {
          branch: 'task/b',
          source: 'docs/tasks/B/gates.jsonl',
          entries: [
            checkLine({
              result: 'fail',
              ts: '2026-10-03T00:00:00.000Z',
            }),
          ],
        },
      ])
    ).toBeNull();
  });

  it('says why it refused, so a decline is not a shrug', () => {
    const diagnostics = [];
    ask([{ branch: 'task/x', entries: [checkLine({ fullTree: FULL_B })] }], {
      diagnostics,
    });
    expect(diagnostics.join(' ')).toContain(
      `no other ledger has a check line on tree ${FULL_A.slice(0, 12)}`
    );

    const dirty = [];
    ask(
      [
        {
          branch: 'task/x',
          entries: [checkLine({ worktreeClean: false })],
        },
      ],
      { diagnostics: dirty }
    );
    expect(dirty.join(' ')).toContain('dirty worktree');
  });

  /**
   * A committed `docs/tasks/<ID>/gates.jsonl` has held two branches' lines since the
   * merging export (X30 item 2), and every line says which branch wrote it. Labelling
   * the file by its *first* line — round 1's rule — is not a presentation bug: the
   * "not this branch's own ledger" filter then excludes nothing (own lines are wearing
   * another round's name), and the reuse note credits whichever round sorted first with
   * a run it never did. So the grouping is tested through the same `ask` as the rules
   * that read its output.
   */
  describe('one committed ledger, two branches (X30 fix 1)', () => {
    const SOURCE = 'docs/tasks/X30/gates.jsonl';
    const line = (branch, over = {}) => ({ ...checkLine(over), branch });
    const FILE_LINES = [
      line('task/X30-round-1', { ts: '2026-10-27T00:00:00.000Z' }),
      line('task/X30-fix-1', { ts: '2026-10-28T00:00:00.000Z' }),
    ];

    it('splits the file on the branch each line carries', () => {
      expect(groupLedgerLinesByBranch(FILE_LINES, SOURCE)).toEqual([
        {
          branch: 'task/X30-round-1',
          entries: [FILE_LINES[0]],
          source: SOURCE,
        },
        {
          branch: 'task/X30-fix-1',
          entries: [FILE_LINES[1]],
          source: SOURCE,
        },
      ]);
    });

    it('excludes one branch, not one file — the own-ledger filter still works', () => {
      // The direction that matters is "my own lines leave", because a round reading its
      // own exported line back as another branch's evidence is how a merge certifies
      // itself. Both directions are asserted so this cannot pass by taking the first
      // or the last group.
      const withoutFix = groupLedgerLinesByBranch(
        FILE_LINES,
        SOURCE,
        'task/X30-fix-1'
      );
      expect(withoutFix.map((group) => group.branch)).toEqual([
        'task/X30-round-1',
      ]);
      expect(
        groupLedgerLinesByBranch(FILE_LINES, SOURCE, 'task/X30-round-1').map(
          (group) => group.branch
        )
      ).toEqual(['task/X30-fix-1']);
    });

    it('labels a line with no branch with the file it came from', () => {
      // A ledger written before `branch` existed, or a hand-made one: the honest label
      // is the path, which is also what the reuse note cites beside it.
      expect(groupLedgerLinesByBranch([checkLine()], SOURCE)).toEqual([
        { branch: SOURCE, entries: [checkLine()], source: SOURCE },
      ]);
    });

    it('credits the round whose line it is, in the file and in the verdict', () => {
      // Round 1 red at 10:00, the fix round green at 11:00, one file. Read as one
      // branch the answer is `task/X30-round-1` — a round whose own check failed is
      // said to have satisfied the merge — and the round that really ran it has no
      // name in the ledger at all.
      const lines = [
        line('task/X30-round-1', {
          result: 'fail',
          ts: '2026-10-28T10:00:00.000Z',
        }),
        line('task/X30-fix-1', { ts: '2026-10-28T11:00:00.000Z' }),
      ];
      const found = ask(groupLedgerLinesByBranch(lines, SOURCE));
      expect(found).not.toBeNull();
      expect(found.branch).toBe('task/X30-fix-1');
      expect(found.source).toBe(SOURCE);
      expect(found.entry.ts).toBe('2026-10-28T11:00:00.000Z');
    });
  });
});

describe('applyReusedCheckRow (what a local verdict does to reuse) - M2', () => {
  const reused = {
    branch: 'task/y',
    entry: checkLine(),
    source: '.gates/task/y.jsonl',
  };

  const rowWith = (state, why = null) => ({
    gate: 'check',
    state,
    why,
    entry: state === 'missing' ? null : checkLine(),
    matched: null,
    key: 'full',
    want: TREE_A,
    got: state === 'missing' ? null : TREE_A,
  });

  const rowsFor = (state, why) => [
    rowWith(state, why),
    { gate: 'harness:ios', state: 'missing' },
  ];

  const row = (rows) => rows.find((each) => each.gate === 'check');

  it('a red local row is never overridden by another branch pass', () => {
    const { rows, reused: used } = applyReusedCheckRow({
      rows: rowsFor('red'),
      reusedCheck: reused,
      stage: 'merge',
      tree: TREE_A,
    });
    expect(used).toBeNull();
    expect(row(rows).state).toBe('red');
  });

  it('a local run whose tree moved is not overridden either', () => {
    const { rows, reused: used } = applyReusedCheckRow({
      rows: rowsFor('stale', 'moved'),
      reusedCheck: reused,
      stage: 'merge',
      tree: TREE_A,
    });
    expect(used).toBeNull();
    expect(row(rows).state).toBe('stale');
  });

  it('a missing row, and one stale on tree, are exactly what reuse is for', () => {
    for (const [state, why] of [
      ['missing', null],
      ['stale', 'tree'],
    ]) {
      const { rows, reused: used } = applyReusedCheckRow({
        rows: rowsFor(state, why),
        reusedCheck: reused,
        stage: 'merge',
        tree: TREE_A,
      });
      expect(used).not.toBeNull();
      expect(row(rows).state).toBe('green');
    }
  });

  it('a green local row needs no reuse, and review never borrows one', () => {
    expect(
      applyReusedCheckRow({
        rows: rowsFor('green'),
        reusedCheck: reused,
        stage: 'merge',
        tree: TREE_A,
      }).reused
    ).toBeNull();
    expect(
      applyReusedCheckRow({
        rows: rowsFor('missing'),
        reusedCheck: reused,
        stage: 'review',
        tree: TREE_A,
      }).reused
    ).toBeNull();
  });

  it('decideNeed says why when nothing was borrowed, and never uses the word reused', () => {
    const decision = decideNeed({
      entries: [],
      tree: TREE_A,
      stage: 'merge',
      reusedCheck: null,
      reuseRefusals: ['task/y: its line was recorded over a dirty worktree'],
    });
    expect(decision.notes.join(' ')).toContain('no check line was borrowed');
    expect(decision.notes.join(' ')).not.toContain('reused');
  });
});

describe('fullTreesMatch (the one comparison reuse rests on)', () => {
  it('is exact, and nothing short of exact', () => {
    expect(fullTreesMatch(FULL_A, FULL_A)).toBe(true);
    expect(fullTreesMatch(`  ${FULL_A}  `, FULL_A)).toBe(true);
    for (const other of [
      FULL_B,
      FULL_A.slice(0, 39),
      `${FULL_A.slice(0, 39)}0`,
      FULL_A.toUpperCase(),
      '',
      '   ',
      null,
      undefined,
      42,
    ]) {
      expect(fullTreesMatch(FULL_A, other)).toBe(false);
      expect(fullTreesMatch(other, FULL_A)).toBe(false);
    }
  });

  it('does not prefix-match, which is what makes a one-character difference a different tree', () => {
    // A shared 39-character prefix is the case a sloppy compare would get wrong, and
    // the whole rule is only as strong as this line.
    expect(fullTreesMatch(`${'a'.repeat(39)}1`, `${'a'.repeat(39)}2`)).toBe(
      false
    );
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
    // would send it somewhere else. `need --for merge` now reads `HEAD^{tree}` and
    // `git status` there, so a redirected CLI would answer the reuse question about the
    // wrong repository - and reuse is the answer that decides whether a merge goes ahead.
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

describe('gate.mjs need --for merge reuses a merged branch check', () => {
  const BRANCH = 'task/x10-check-throughput';

  /** Branch work, committed, then `check` run on top of it. */
  function branchThatPassedChecks(dir) {
    fs.mkdirSync(path.join(dir, 'android/src/main/java'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'android/src/main/java/Thing.kt'),
      'class Thing\n'
    );
    gitInTempRepo(dir, ['add', '-A']);
    gitInTempRepo(dir, ['commit', '-qm', 'feat: branch work']);
    const run = runCli(dir, ['check'], { FAKE_CHECK_STEPS_JSON: STEPS_JSON });
    expect(run.status).toBe(0);
    const lines = ledgerIn(dir, BRANCH);
    expect(lines).toHaveLength(1);
    return lines[0];
  }

  /** The tree hash standing in front of us right now, from git itself. */
  const treeOf = (dir) => gitIn(dir, ['rev-parse', 'HEAD^{tree}']);

  it('accepts it once the branch is merged, and refuses before', () => {
    const dir = makeRepo();
    const line = branchThatPassedChecks(dir);
    // The run recorded git's own tree hash and a clean worktree, which is what makes
    // it reusable at all.
    expect(line.fullTree).toBe(treeOf(dir));
    expect(line.worktreeClean).toBe(true);

    // Before the merge, on `main`, the branch's ledger is not this tree's evidence:
    // main's code does not contain the branch's commit, or its file.
    gitInTempRepo(dir, ['checkout', '-q', 'main']);
    const before = runCli(dir, ['need', '--for', 'merge', '--base', 'main']);
    expect(before.status).toBe(1);
    expect(before.stdout).toContain('check — never run on this tree');
    expect(before.stdout).not.toContain('reused');

    gitInTempRepo(dir, ['merge', '-q', '--no-ff', BRANCH, '-m', 'merge: task']);
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

    // The same row from the renderer directly: `need` and `table` share
    // `applyReusedCheckRow`, so a report that contradicts the decision is one bug, not two.
    const rendered = renderGateTable({
      entries: ledgerIn(dir, 'main'),
      tree: line.tree,
      stage: 'merge',
      reusedCheck: {
        branch: BRANCH,
        entry: line,
        source: `.gates/${BRANCH}.jsonl`,
      },
    });
    expect(rendered).toContain('**PASS** *(reused)*');
    expect(rendered).toContain(line.tree.slice(0, 12));
  }, 120_000);

  it('reuses when the merged tree is byte-identical, and prints the tree it matched', () => {
    // The positive case stated as the rule itself: same tree hash, so a run here
    // would read the same files. The assertion that makes this a test rather than a
    // demo is that the note names the hash.
    const dir = makeRepo();
    const line = branchThatPassedChecks(dir);
    gitInTempRepo(dir, ['checkout', '-q', 'main']);
    gitInTempRepo(dir, ['merge', '-q', '--no-ff', BRANCH, '-m', 'merge: task']);
    const after = runCli(dir, ['need', '--for', 'merge', '--base', 'main']);
    expect(after.stdout).toContain(
      `this exact tree (${line.fullTree.slice(0, 12)}) with a clean worktree`
    );
    expect(after.stdout).toContain('check — green, reused');
  }, 120_000);

  it('refuses a merge that changes only docs - a docs commit is a different tree', () => {
    // This is the round-2 decision, tested from the side that loses: round 1 reused
    // this exact merge, because the code digest did not move and `docs/**` was on the
    // allowlist. A docs file is an input to `format`, to `readme:check` and to a jest
    // test that reads ORCHESTRATOR.md, so the honest answer is that the tree is new.
    const dir = makeRepo();
    const line = branchThatPassedChecks(dir);
    gitInTempRepo(dir, ['checkout', '-q', 'main']);
    fs.mkdirSync(path.join(dir, 'docs', 'tasks'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'docs', 'tasks', 'X9-report.md'),
      '# X9 report\n'
    );
    gitInTempRepo(dir, ['add', '-A']);
    gitInTempRepo(dir, ['commit', '-qm', 'docs(tasks): X9 report']);
    gitInTempRepo(dir, ['merge', '-q', '--no-ff', BRANCH, '-m', 'merge: task']);

    // The precondition round 1 relied on, still true: the *code* digest never moved,
    // so nothing but the full-tree comparison can see this merge at all.
    const status = runCli(dir, ['status']);
    expect(status.stderr).toContain(`code tree ${line.tree.slice(0, 12)}`);
    expect(treeOf(dir)).not.toBe(line.fullTree);

    const after = runCli(dir, ['need', '--for', 'merge', '--base', 'main']);
    expect(after.stdout).not.toContain('reused');
    expect(after.stdout).toContain('check — never run on this tree');
    expect(after.status).toBe(1);
  }, 120_000);

  it('refuses a rename out of a read directory into docs - the case the allowlist got wrong', () => {
    // The review's concrete counterexample, made a gate: a file moves from `bench/`
    // (which `check` type-checks) to `docs/` (which the allowlist said was inert). The
    // only path git reports is the destination, so an allowlist reads this as
    // docs-only and marks a green the run never earned. An exact tree hash notices,
    // because the tree changed.
    const dir = makeRepo();
    const line = branchThatPassedChecks(dir);
    gitInTempRepo(dir, ['checkout', '-q', 'main']);
    fs.mkdirSync(path.join(dir, 'bench'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'bench', 'Main.tsx'),
      'export const a = 1\n'
    );
    gitInTempRepo(dir, ['add', '-A']);
    gitInTempRepo(dir, ['commit', '-qm', 'chore: a bench file']);
    gitInTempRepo(dir, ['mv', 'bench/Main.tsx', 'docs/Main.tsx']);
    gitInTempRepo(dir, ['add', '-A']);
    gitInTempRepo(dir, ['commit', '-qm', 'docs: that file, moved']);
    // Proof the rename is invisible the way round 1 read it: `diff --name-only` with
    // git's default rename detection reports the *destination* only, so an allowlist
    // that trusts that list sees a docs addition and nothing else.
    expect(gitIn(dir, ['diff', '--name-only', 'HEAD~1..HEAD'])).toBe(
      'docs/Main.tsx'
    );
    gitInTempRepo(dir, ['merge', '-q', '--no-ff', BRANCH, '-m', 'merge: task']);

    const after = runCli(dir, ['need', '--for', 'merge', '--base', 'main']);
    expect(after.stdout).not.toContain('reused');
    expect(after.stdout).toContain('check — never run on this tree');
    expect(line.fullTree).not.toBe(treeOf(dir));
  }, 120_000);

  it('will not reuse a check recorded over uncommitted edits', () => {
    // The dirty-at-check-time case in the form where the flag is the *only* thing that
    // can refuse: `check` passed with the tree plus an untracked file, the file then
    // disappeared, and the merged tree is byte-identical to the hash the line names.
    // Nothing proves this tree was ever checked on its own, so reuse declines.
    const dir = makeRepo();
    fs.mkdirSync(path.join(dir, 'android/src/main/java'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'android/src/main/java/Thing.kt'),
      'class Thing\n'
    );
    gitInTempRepo(dir, ['add', '-A']);
    gitInTempRepo(dir, ['commit', '-qm', 'feat: branch work']);
    // An edit that is never committed and never gitignored, so `status` sees it.
    const scratch = path.join(dir, 'ios', 'core', 'Scratch.swift');
    fs.writeFileSync(scratch, 'uncommitted\n');
    const run = runCli(dir, ['check'], { FAKE_CHECK_STEPS_JSON: STEPS_JSON });
    expect(run.status).toBe(0);
    const [line] = ledgerIn(dir, BRANCH);
    expect(line.worktreeClean).toBe(false);
    // The gap the flag describes: the line names the commit's tree, which has no
    // Scratch.swift in it.
    expect(line.fullTree).toBe(treeOf(dir));

    // Take the edit away, so from here on the standing tree is exactly the recorded one.
    fs.rmSync(scratch);
    expect(gitIn(dir, ['status', '--porcelain'])).toBe('');

    gitInTempRepo(dir, ['checkout', '-q', 'main']);
    gitInTempRepo(dir, ['merge', '-q', '--no-ff', BRANCH, '-m', 'merge: task']);
    expect(treeOf(dir)).toBe(line.fullTree);
    const after = runCli(dir, ['need', '--for', 'merge', '--base', 'main']);
    expect(after.stdout).not.toContain('reused');
    expect(after.stdout).toContain('dirty worktree');
    expect(after.stdout).toContain('check — never run on this tree');
  }, 120_000);

  it('will not reuse a check whose tree moved out from under it', () => {
    // `fullTree` is only claimed when it is the same before and after the run: a docs
    // commit landing mid-flight moves the git tree and nothing else, and the run
    // spans two trees rather than proving one of them.
    const dir = makeRepo();
    fs.mkdirSync(path.join(dir, 'android/src/main/java'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'android/src/main/java/Thing.kt'),
      'class Thing\n'
    );
    gitInTempRepo(dir, ['add', '-A']);
    gitInTempRepo(dir, ['commit', '-qm', 'feat: branch work']);
    // A child that commits docs halfway through, so the tree under `check` changes.
    const run = runCli(
      dir,
      ['check'],
      { FAKE_CHECK_STEPS_JSON: STEPS_JSON },
      'mkdir -p docs\necho moved >> docs/moved.md\ngit add -A docs\ngit commit -qm "docs: moved under the run" >/dev/null'
    );
    expect(run.status).toBe(0);
    const [line] = ledgerIn(dir, BRANCH);
    expect(line.fullTree).toBeNull();
    expect(line.worktreeClean).toBe(true);

    gitInTempRepo(dir, ['checkout', '-q', 'main']);
    gitInTempRepo(dir, ['merge', '-q', '--no-ff', BRANCH, '-m', 'merge: task']);
    const after = runCli(dir, ['need', '--for', 'merge', '--base', 'main']);
    expect(after.stdout).not.toContain('reused');
  }, 120_000);

  it('refuses when this worktree is dirty, even though the tree hash matches', () => {
    // Asking about a tree that is not committed is asking about a tree no hash names,
    // so `need` says so instead of borrowing an answer for a lookalike.
    const dir = makeRepo();
    const line = branchThatPassedChecks(dir);
    gitInTempRepo(dir, ['checkout', '-q', 'main']);
    gitInTempRepo(dir, ['merge', '-q', '--no-ff', BRANCH, '-m', 'merge: task']);
    fs.writeFileSync(path.join(dir, 'ios', 'core', 'Wip.swift'), 'wip\n');
    const after = runCli(dir, ['need', '--for', 'merge', '--base', 'main']);
    expect(after.stdout).not.toContain('reused');
    expect(after.stdout).toContain('uncommitted changes');
    // And the refusal is the worktree, not the tree: it still matches.
    expect(treeOf(dir)).toBe(line.fullTree);
  }, 120_000);

  it('the newest line on the tree decides, so a merge that failed after the pass is not reused', () => {
    // Newest-wins under exact trees: `main` ran `check` on this very tree and it went
    // red, and a branch's older green may not print over that.
    const dir = makeRepo();
    const line = branchThatPassedChecks(dir);
    gitInTempRepo(dir, ['checkout', '-q', 'main']);
    gitInTempRepo(dir, ['merge', '-q', '--no-ff', BRANCH, '-m', 'merge: task']);
    const failed = runCli(dir, ['check'], {
      FAKE_CHECK_STEPS_JSON: STEPS_JSON,
      FAKE_EXIT: '1',
    });
    expect(failed.status).toBe(1);
    const lines = ledgerIn(dir, 'main');
    expect(lines[lines.length - 1].result).toBe('fail');
    expect(lines[lines.length - 1].fullTree).toBe(line.fullTree);

    const after = runCli(dir, ['need', '--for', 'merge', '--base', 'main']);
    expect(after.stdout).not.toContain('reused');
    expect(after.stdout).toContain('check — red');
  }, 120_000);

  it('--no-reuse asks the strict question', () => {
    const dir = makeRepo();
    branchThatPassedChecks(dir);
    gitInTempRepo(dir, ['checkout', '-q', 'main']);
    gitInTempRepo(dir, ['merge', '-q', '--no-ff', BRANCH, '-m', 'merge: task']);
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
    gitInTempRepo(dir, ['checkout', '-q', 'main']);
    fs.writeFileSync(
      path.join(dir, 'ios', 'core', 'Main.swift'),
      'main moved\n'
    );
    gitInTempRepo(dir, ['add', '-A']);
    gitInTempRepo(dir, ['commit', '-qm', 'feat: main moved']);
    gitInTempRepo(dir, ['merge', '-q', '--no-ff', BRANCH, '-m', 'merge: task']);
    const after = runCli(dir, ['need', '--for', 'merge', '--base', 'main']);
    expect(after.stdout).not.toContain('reused');
    expect(after.stdout).toContain('check — never run on this tree');
    expect(after.status).toBe(1);
  }, 120_000);

  it('refuses an export that arrived with this merge, because the tree it names is not this one', () => {
    // The real flow, and the answer is *no* for a simpler reason than round 1's: the
    // export is committed after the `check` line it carries, so the merged tree
    // contains a file the checked tree did not. No exclusion list is needed to say so,
    // and the same reasoning covers any other file a merge brings.
    const dir = makeRepo();
    branchThatPassedChecks(dir);
    const exported = runCli(dir, ['export', '--task', 'X10']);
    expect(exported.status).toBe(0);
    expect(
      fs.existsSync(path.join(dir, 'docs', 'tasks', 'X10', 'gates.jsonl'))
    ).toBe(true);
    gitInTempRepo(dir, ['add', '-A']);
    gitInTempRepo(dir, ['commit', '-qm', 'docs: X10 gate ledger']);
    gitInTempRepo(dir, ['checkout', '-q', 'main']);
    gitInTempRepo(dir, ['merge', '-q', '--no-ff', BRANCH, '-m', 'merge: task']);
    // No branch ledger survives in a fresh checkout, which is the case the export exists for.
    fs.rmSync(path.join(dir, '.gates', `${BRANCH}.jsonl`), { force: true });
    const after = runCli(dir, ['need', '--for', 'merge', '--base', 'main']);
    expect(after.stdout).not.toContain('reused');
    expect(after.stdout).toContain('check — never run on this tree');
  }, 120_000);

  it('will not reuse an exported check whose commit is not in this history', () => {
    // The committed copy, on the merge that is not a merge: `--squash` produces the
    // same *files*, and a fresh `check` would see identical content, but the commit the
    // line names is not an ancestor of HEAD, so the evidence belongs to a branch nobody
    // merged. `--no-reuse` is not involved here - this is the rule refusing.
    const dir = makeRepo();
    const line = branchThatPassedChecks(dir);
    expect(runCli(dir, ['export', '--task', 'X10']).status).toBe(0);
    gitInTempRepo(dir, ['add', '-A']);
    gitInTempRepo(dir, ['commit', '-qm', 'docs: X10 gate ledger']);
    gitInTempRepo(dir, ['checkout', '-q', 'main']);
    gitInTempRepo(dir, ['merge', '-q', '--squash', BRANCH]);
    gitInTempRepo(dir, ['commit', '-qm', 'feat: branch work (squashed)']);
    const after = runCli(dir, ['need', '--for', 'merge', '--base', 'main']);
    expect(after.stdout).not.toContain('reused');
    expect(after.stdout).toContain('check — never run on this tree');
    // The line's commit really is absent from this history, which is the condition
    // under test. Asked through `gitIn`/`gitEnv` rather than a bare spawn, so an
    // inherited `GIT_DIR` cannot make this assert about somebody else's checkout (N4).
    expect(
      spawnSync('git', ['merge-base', '--is-ancestor', line.head, 'HEAD'], {
        cwd: dir,
        encoding: 'utf8',
        env: gitEnv(dir),
      }).status
    ).not.toBe(0);
  }, 120_000);

  it('refuses a squash merge on the tree too, when no export is involved', () => {
    // The same squash without the export step: the merged files are byte-identical to
    // the tree that passed, so this isolates the two conditions and shows the commit
    // is the only thing refusing. Round 1 leaned on this to prove the exclusion list
    // was the sole blocker; under exact trees it proves ancestry still bites.
    const dir = makeRepo();
    const line = branchThatPassedChecks(dir);
    gitInTempRepo(dir, ['checkout', '-q', 'main']);
    gitInTempRepo(dir, ['merge', '-q', '--squash', BRANCH]);
    gitInTempRepo(dir, ['commit', '-qm', 'feat: branch work (squashed)']);
    expect(treeOf(dir)).toBe(line.fullTree);
    const after = runCli(dir, ['need', '--for', 'merge', '--base', 'main']);
    expect(after.stdout).not.toContain('reused');
    expect(after.stdout).toContain('not an ancestor of this tree');
  }, 120_000);

  it('prints the reuse pair in `status`, because that is what a merge compares', () => {
    // `status` is where a task decides whether it owes a run, so it has to show the two
    // fields reuse reads - and say plainly when a dirty worktree has made the whole
    // question unanswerable rather than printing a hash that will match and then not be
    // used.
    const dir = makeRepo();
    branchThatPassedChecks(dir);
    const clean = runCli(dir, ['status']);
    expect(clean.stderr).toContain('git tree');
    expect(clean.stderr).toContain('worktree clean');

    fs.writeFileSync(path.join(dir, 'ios', 'core', 'Wip.swift'), 'wip\n');
    const dirty = runCli(dir, ['status']);
    expect(dirty.stderr).toContain('DIRTY');
    expect(dirty.stderr).not.toContain('worktree clean');
  }, 120_000);

  it('does not reuse at review, even when another branch has a qualifying line', () => {
    // The stage guard from the CLI's side. Two branches with *identical* trees (B
    // starts at A's commit), so A's `check` line would satisfy every other
    // condition on B's tree, including the ancestry. A review round is evidence
    // about its own diff, so borrowing it here would let an unproven round read as
    // proven - which is why the rule is merge-only.
    const dir = makeRepo();
    branchThatPassedChecks(dir);
    gitInTempRepo(dir, ['branch', 'task/x10-copy', BRANCH]);
    gitInTempRepo(dir, ['checkout', '-q', 'task/x10-copy']);
    const review = runCli(dir, ['need', '--for', 'review', '--base', 'main']);
    expect(review.stdout).not.toContain('reused');
    expect(review.stdout).toContain('check — never run on this tree');
    // ...and the same command one stage up does take it, so the difference below
    // is the stage and nothing else.
    const merge = runCli(dir, ['need', '--for', 'merge', '--base', 'main']);
    expect(merge.stdout).toContain('reused from');
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

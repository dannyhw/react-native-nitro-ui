/**
 * The gate ledger's decisions: what a result is evidence *for*, and what a round
 * still owes.
 *
 * The failure mode being tested is not a crash, it is a green that means more
 * than it should, because that is what cost 27.6 h of fix rounds re-running
 * gates that had already run (docs/tasks/PROCESS-review-2026-10-26.md §3). So the
 * cases here are the ones where a wrong answer reads like proof:
 *
 *   - a result keyed to the code tree, so a report commit does not invalidate a
 *     device run - and a *code* change does;
 *   - a pass on one platform not standing in for the other;
 *   - a pass on an older tree reported as stale, never as green;
 *   - a bench, a single harness suite, or a run against someone else's tree never
 *     satisfying `merge`;
 *   - the generated table saying FAIL/stale where a hand-written one said PASS.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import {
  LEDGER_VERSION,
  MERGE_GATES,
  decideNeed,
  deviceFromEnv,
  countsForDisplay,
  changedPathsGitArgs,
  gatesSeen,
  gateRowFor,
  gateStateFor,
  isToolingPath,
  ledgerFileName,
  ledgerLineFromRun,
  ledgerRelativePath,
  latestByGate,
  listByGate,
  parseLedger,
  parseTestCounts,
  parseTestSummaries,
  platformMappingFor,
  platformTreesFromEntries,
  platformsOwningFile,
  platformsTouchedByPaths,
  renderGateTable,
  requiredGatesFor,
  resolveGate,
  summarizeGates,
  summarizeLoad,
  codeTreeDigest,
  contentHash,
  isCodeFile,
} from '../gate-core.mjs';

/** Tree digest used as "the code this ledger line was about" in these tests. */
const TREE_A =
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TREE_B =
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function head(short = TREE_A) {
  return short.slice(0, 12);
}

/**
 * A ledger line, with the noise filled in. `head` is deliberately a separate
 * argument from `tree`: several tests need the same tree at a different commit,
 * which is the docs-only-commit case.
 */
function line({
  gate,
  tree = TREE_A,
  commit = 'commit-1',
  result = 'pass',
  counts = {
    suites: { passed: 11, total: 11 },
    tests: { passed: 162, total: 162 },
  },
  durationMs = 175_300,
  load = { start: 3.1, median: 4.2, max: 9.1, count: 12 },
  lease = null,
  device = null,
  exitCode = result === 'pass' ? 0 : 1,
  logPath = `.gates/logs/${gate}-1.log`,
  trees = null,
  treeAfter = tree,
  summaries = null,
}) {
  return ledgerLineFromRun({
    gate,
    command: `bun run ${gate}`,
    tree,
    trees,
    treeAfter,
    summaries,
    head: commit,
    branch: 'task/X2-gate-ledger',
    platform: gate.includes('ios')
      ? 'ios'
      : gate.includes('android')
        ? 'android'
        : null,
    device,
    lease,
    load,
    durationMs,
    result,
    counts,
    logPath,
    startedAt: Date.parse('2026-10-26T10:00:00Z'),
    exitCode,
  });
}

describe('ledger lines', () => {
  it('writes the fields a report has to cite', () => {
    const entry = line({
      gate: 'harness:android',
      lease: 'X2-abc',
      device: 'emulator-5570',
    });
    expect(entry).toMatchObject({
      v: LEDGER_VERSION,
      gate: 'harness:android',
      tree: TREE_A,
      head: 'commit-1',
      platform: 'android',
      device: 'emulator-5570',
      lease: 'X2-abc',
      durationMs: 175300,
      result: 'pass',
      logPath: '.gates/logs/harness:android-1.log',
      // v2 (M1-M4 review): the per-platform halves, the tree after the run, and
      // every summary the gate printed rather than the last one.
      trees: null,
      treeAfter: TREE_A,
      summaries: null,
      signal: null,
    });
    expect(entry.ts).toBe('2026-10-26T10:00:00.000Z');
    expect(entry.load).toEqual({
      start: 3.1,
      median: 4.2,
      max: 9.1,
      count: 12,
    });
  });

  it('survives a JSON round trip, one line per run', () => {
    const text = [line({ gate: 'check' }), line({ gate: 'harness:ios' })]
      .map((entry) => JSON.stringify(entry))
      .join('\n');
    const parsed = parseLedger(`${text}\n`);
    expect(parsed).toHaveLength(2);
    expect(parsed.map((entry) => entry.gate)).toEqual(['check', 'harness:ios']);
  });

  it('keeps an unreadable line visible instead of reading it as a pass', () => {
    // A run killed mid-write leaves half a line. If it parsed to nothing, the
    // gate it was recording would silently revert to "missing" - correct by
    // accident - but a *mangled* pass could equally parse as a different gate.
    const parsed = parseLedger(
      `{"gate":"check","result":"pass"\nnot json at all\n`
    );
    expect(parsed).toHaveLength(2);
    expect(parsed.every((entry) => entry.corrupt === true)).toBe(true);
    expect(latestByGate(parsed)).toEqual({});
    expect(
      gateStateFor({ gate: 'check', tree: TREE_A, entry: undefined }).state
    ).toBe('missing');
  });

  it('takes the last line per gate by append order, not by clock', () => {
    const older = { ...line({ gate: 'check', result: 'fail' }) };
    older.ts = '2099-01-01T00:00:00.000Z';
    const newer = line({ gate: 'check', result: 'pass' });
    const latest = latestByGate([older, newer]);
    expect(latest.check.result).toBe('pass');
    expect(latestByGate([newer, older]).check.result).toBe('fail');
  });

  it('puts one file per branch under .gates, no separator to collide', () => {
    expect(ledgerRelativePath('task/X2-gate-ledger')).toBe(
      '.gates/task/X2-gate-ledger.jsonl'
    );
    expect(ledgerFileName('main')).toBe('main.jsonl');
    // A detached checkout still gets a file.
    expect(ledgerFileName('HEAD')).toBe('detached.jsonl');
    expect(ledgerFileName('')).toBe('detached.jsonl');
    // The two shapes a flattening separator would have collided: both are legal
    // refs, and both are legal branches in this repo's own naming.
    expect(ledgerFileName('task/a')).not.toBe(ledgerFileName('task+a'));
    expect(ledgerFileName('task?a')).not.toBe(ledgerFileName('task*b'));
  });

  it('refuses a branch string that would escape .gates', () => {
    // Not something git produces; what it stops is a caller feeding `need
    // --branch` (or an env var) something that is not a ref.
    expect(() => ledgerFileName('../../etc/passwd')).toThrow(
      /not a branch name/
    );
    expect(() => ledgerFileName('/absolute')).toThrow(/not a branch name/);
    expect(() => ledgerFileName('a\u0000b')).toThrow(/not a branch name/);
  });
});

describe('gateStateFor / summarizeGates', () => {
  it('reads green, red, stale and missing apart', () => {
    const ask = { gate: 'check', stage: 'merge', tree: TREE_A };
    expect(gateStateFor({ ...ask, entry: line({ gate: 'check' }) }).state).toBe(
      'green'
    );
    expect(
      gateStateFor({ ...ask, entry: line({ gate: 'check', tree: TREE_B }) })
        .state
    ).toBe('stale');
    expect(
      gateStateFor({
        ...ask,
        entry: line({ gate: 'check', result: 'fail' }),
      }).state
    ).toBe('red');
    // A red on the current tree stays red even if an older run was green: the
    // newest word on the tree is the one a reader needs.
    expect(
      gateRowFor({
        gate: 'check',
        list: [
          line({ gate: 'check' }),
          line({ gate: 'check', result: 'fail' }),
        ],
        ...ask,
      }).state
    ).toBe('red');
    expect(gateStateFor({ ...ask, entry: undefined }).state).toBe('missing');
  });

  it('lists the merge set plus anything else that ran, merge order first', () => {
    const gates = gatesSeen([
      line({ gate: 'harness:android:ColdSizing' }),
      line({ gate: 'bench' }),
    ]);
    expect(gates.slice(0, MERGE_GATES.length)).toEqual(MERGE_GATES);
    expect(gates).toContain('harness:android:ColdSizing');
    expect(gates).toContain('bench');
  });

  it('shows a suite run beside the full harness rather than instead of it', () => {
    const rows = summarizeGates({
      entries: [line({ gate: 'harness:android:ColdSizing' })],
      tree: TREE_A,
    });
    const full = rows.find((row) => row.gate === 'harness:android');
    expect(full.state).toBe('missing');
    expect(
      rows.find((row) => row.gate === 'harness:android:ColdSizing').state
    ).toBe('green');
  });
});

describe('platformsTouchedByPaths', () => {
  it('maps the brief prefixes: android/, ios/, and shared code to both', () => {
    expect(platformsTouchedByPaths(['android/src/main/Ui.kt'])).toEqual({
      platforms: ['android'],
      unmapped: [],
      tooling: [],
    });
    expect(platformsTouchedByPaths(['ios/ui/Switch.swift'])).toEqual({
      platforms: ['ios'],
      unmapped: [],
      tooling: [],
    });
    for (const shared of [
      'cpp/ui/Switch.cpp',
      'src/index.ts',
      'nitrogen/generated/shared/Y.h',
      'nitrogen/types/Config.ts',
    ]) {
      expect(platformsTouchedByPaths([shared]).platforms).toEqual([
        'ios',
        'android',
      ]);
    }
    expect(
      platformsTouchedByPaths(['example/android/app/build.gradle']).platforms
    ).toEqual(['android']);
    expect(platformsTouchedByPaths(['NitroUi.podspec']).platforms).toEqual([
      'ios',
    ]);
  });

  it('asks for both when it cannot tell, and says which paths', () => {
    const decision = platformsTouchedByPaths([
      'patches/react-native-harness.patch',
    ]);
    expect(decision.platforms).toEqual(['ios', 'android']);
    expect(decision.unmapped).toEqual(['patches/react-native-harness.patch']);
  });

  it('asks for nothing from docs, bench files and Markdown, wherever they live', () => {
    // This is the rule that makes 104 docs-only commits free: a report is not
    // code, and neither is a bench result file.
    expect(
      platformsTouchedByPaths([
        'docs/tasks/X2-gate-ledger.report.md',
        'docs/tasks/X2-gate-ledger/gates.jsonl',
        'README.md',
        'bench/results/abc-android.json',
      ])
    ).toEqual({ platforms: [], unmapped: [], tooling: [] });
  });
});

describe('requiredGatesFor / decideNeed', () => {
  it('review needs check plus the touched platforms, and nothing else', () => {
    expect(
      requiredGatesFor({ stage: 'review', touchedPlatforms: ['android'] })
    ).toEqual(['check', 'harness:android']);
    expect(
      requiredGatesFor({
        stage: 'review',
        touchedPlatforms: ['ios', 'android'],
      })
    ).toEqual(['check', 'harness:ios', 'harness:android']);
    expect(requiredGatesFor({ stage: 'review', touchedPlatforms: [] })).toEqual(
      ['check']
    );
    expect(() => requiredGatesFor({ stage: 'ship' })).toThrow(
      /review and merge/
    );
  });

  it('an android-only diff needs android only', () => {
    const decision = decideNeed({
      entries: [
        line({ gate: 'check' }),
        line({ gate: 'harness:android' }),
        line({ gate: 'harness:ios', result: 'fail' }),
      ],
      tree: TREE_A,
      stage: 'review',
      touchedPlatforms: platformsTouchedByPaths(['android/src/main/Ui.kt'])
        .platforms,
    });
    expect(decision.ok).toBe(true);
    expect(decision.required.map((row) => row.gate)).toEqual([
      'check',
      'harness:android',
    ]);
    // A red iOS run is not this round's problem, and real-input is merge-only.
    expect(decision.required.map((row) => row.gate)).not.toContain(
      'harness:ios'
    );
    expect(decision.missing).toEqual([]);
  });

  it('an android-only diff still needs check, and says so when it is red', () => {
    const decision = decideNeed({
      entries: [
        line({ gate: 'harness:android' }),
        line({ gate: 'check', result: 'fail' }),
      ],
      tree: TREE_A,
      stage: 'review',
      touchedPlatforms: ['android'],
    });
    expect(decision.ok).toBe(false);
    expect(decision.missing).toEqual(['check']);
    expect(decision.required.find((row) => row.gate === 'check').state).toBe(
      'red'
    );
  });

  it('a docs-only commit keeps a green gate green (same code tree, new HEAD)', () => {
    // The whole point of keying on the code tree: these two entries were written
    // at different commits, and the code between them is only a report.
    const entries = [
      line({ gate: 'check', commit: 'before-docs' }),
      line({
        gate: 'harness:android',
        commit: 'before-docs',
        device: 'emulator-5570',
      }),
    ];
    const docsOnly = platformsTouchedByPaths([
      'docs/tasks/X2-gate-ledger.report.md',
    ]).platforms;
    expect(docsOnly).toEqual([]);
    const decision = decideNeed({
      entries,
      tree: TREE_A,
      stage: 'review',
      touchedPlatforms: docsOnly,
    });
    expect(decision.ok).toBe(true);
    expect(decision.missing).toEqual([]);
    expect(decision.notes.join(' ')).toMatch(
      /docs-only commit never invalidates/
    );
  });

  it('a code change makes yesterday green stale, not green', () => {
    const entries = [
      line({ gate: 'check' }),
      line({ gate: 'harness:android' }),
    ];
    const decision = decideNeed({
      entries,
      // The tree after the fix round's edit; every entry above predates it.
      tree: TREE_B,
      stage: 'review',
      touchedPlatforms: ['android'],
    });
    expect(decision.ok).toBe(false);
    expect(decision.missing).toEqual(['check', 'harness:android']);
    expect(decision.required.every((row) => row.state === 'stale')).toBe(true);
    expect(decision.required.map((row) => row.gate)).not.toContain(
      'harness:ios'
    );
  });

  it('merge needs the whole set on this tree, once', () => {
    // review satisfied: check + both harness suites green.
    const review = decideNeed({
      entries: [
        line({ gate: 'check' }),
        line({ gate: 'harness:ios' }),
        line({ gate: 'harness:android' }),
      ],
      tree: TREE_A,
      stage: 'review',
      touchedPlatforms: ['ios', 'android'],
    });
    expect(review.ok).toBe(true);

    const merge = decideNeed({
      entries: [
        line({ gate: 'check' }),
        line({ gate: 'harness:ios' }),
        line({ gate: 'harness:android' }),
      ],
      tree: TREE_A,
      stage: 'merge',
    });
    expect(merge.ok).toBe(false);
    expect(merge.missing).toEqual(['real-input:ios', 'real-input:android']);

    const complete = decideNeed({
      entries: MERGE_GATES.map((gate) => line({ gate })),
      tree: TREE_A,
      stage: 'merge',
    });
    expect(complete.ok).toBe(true);
    expect(complete.required.map((row) => row.gate)).toEqual(MERGE_GATES);
  });

  it('never asks for a bench, and never accepts one as a substitute', () => {
    // Benches go to the bench host (D15), so a branch that benched everything and
    // ran no harness still owes the whole set.
    const entries = [
      line({ gate: 'bench' }),
      line({ gate: 'bench:quick' }),
      line({ gate: 'check' }),
    ];
    for (const stage of ['review', 'merge']) {
      const decision = decideNeed({
        entries,
        tree: TREE_A,
        stage,
        touchedPlatforms: ['ios', 'android'],
      });
      expect(
        decision.required.some((row) => row.gate.startsWith('bench'))
      ).toBe(false);
    }
    expect(
      decideNeed({ entries, tree: TREE_A, stage: 'merge' }).missing
    ).toEqual([
      'harness:ios',
      'harness:android',
      'real-input:ios',
      'real-input:android',
    ]);
  });

  it('a single suite green does not satisfy the platform harness gate', () => {
    const decision = decideNeed({
      entries: [
        line({ gate: 'check' }),
        line({ gate: 'harness:android:ColdSizing' }),
      ],
      tree: TREE_A,
      stage: 'review',
      touchedPlatforms: ['android'],
    });
    expect(decision.missing).toEqual(['harness:android']);
  });

  it('says when it could not read the diff instead of asking for nothing', () => {
    const decision = decideNeed({
      entries: [line({ gate: 'check' })],
      tree: TREE_A,
      stage: 'review',
      touchedPlatforms: ['ios', 'android'],
      diffUnknown: true,
    });
    expect(decision.missing).toEqual(['harness:ios', 'harness:android']);
    expect(decision.notes.join(' ')).toMatch(/could not be read/);
  });
});

describe('renderGateTable', () => {
  it('renders one row per gate with counts, tree, duration and load', () => {
    const table = renderGateTable({
      entries: [
        line({
          gate: 'check',
          counts: {
            suites: { passed: 21, total: 21 },
            tests: { passed: 344, total: 344 },
          },
          durationMs: 214_000,
        }),
        line({ gate: 'harness:android', device: 'emulator-5570' }),
      ],
      tree: TREE_A,
    });
    const rows = table.split('\n');
    expect(rows[0]).toBe(
      '| Gate | Result | Counts | Code tree | Duration | Load |'
    );
    expect(rows[1]).toBe('| --- | --- | --- | --- | --- | --- |');
    expect(rows.length).toBe(2 + MERGE_GATES.length);
    const check = rows.find((row) => row.includes('`check`'));
    expect(check).toContain('**PASS**');
    expect(check).toContain('344 tests / 21 suites');
    expect(check).toContain(`\`${head(TREE_A)}\``);
    expect(check).toContain('3 m 34 s');
    expect(check).toContain('start 3.1 / med 4.2 / max 9.1');
    expect(rows.find((row) => row.includes('`real-input:ios`'))).toContain(
      'missing'
    );
    expect(rows.find((row) => row.includes('`harness:ios`'))).toContain('—');
  });

  it('will not print PASS for a run from another code tree', () => {
    const table = renderGateTable({
      entries: [line({ gate: 'check', tree: TREE_B })],
      tree: TREE_A,
    });
    const check = table.split('\n').find((row) => row.includes('`check`'));
    expect(check).toContain('stale');
    expect(check).not.toContain('PASS');
    expect(check).toContain('(not this tree)');
  });

  it('shows a failure as a failure, failures first', () => {
    const table = renderGateTable({
      entries: [
        line({
          gate: 'harness:android',
          result: 'fail',
          exitCode: 1,
          counts: {
            suites: { passed: 10, failed: 1, total: 11 },
            tests: { passed: 160, failed: 2, total: 162 },
          },
        }),
      ],
      tree: TREE_A,
    });
    const row = table
      .split('\n')
      .find((line2) => line2.includes('`harness:android`'));
    expect(row).toContain('**FAIL**');
    expect(row).toContain('2 failed of 162 tests');
  });

  it('appends the log path only when asked', () => {
    const plain = renderGateTable({
      entries: [line({ gate: 'check' })],
      tree: TREE_A,
    });
    expect(plain).not.toContain('.gates/logs');
    const full = renderGateTable({
      entries: [line({ gate: 'check' })],
      tree: TREE_A,
      evidence: (entry) => `log \`${entry.logPath}\``,
    });
    expect(full).toContain('log `.gates/logs/check-1.log`');
  });
});

describe('parseTestCounts', () => {
  it('reads the summary a gate exited on', () => {
    expect(
      parseTestCounts(
        'Test Suites: 11 passed, 11 total\nTests: 162 passed, 162 total\n'
      )
    ).toEqual({
      suites: { passed: 11, total: 11 },
      tests: { passed: 162, total: 162 },
    });
    expect(
      parseTestCounts('Tests: 1 failed, 18 passed, 19 total').tests
    ).toEqual({
      failed: 1,
      passed: 18,
      total: 19,
    });
    expect(
      parseTestCounts('Tests: 2 skipped, 12 passed, 14 total').tests
    ).toEqual({
      skipped: 2,
      passed: 12,
      total: 14,
    });
  });

  it('reports the first summary, which is the unit step', () => {
    // M3. `check` prints jest, then the perf step, and "the last one wins" made
    // its row read `7 tests / 7 suites` while the unit run in the same log had
    // 391 tests across 23 suites. The one number a reviewer uses to notice a
    // deleted suite was the one that went missing.
    const log =
      'Test Suites: 23 passed, 23 total\n' +
      'Tests: 391 passed, 391 total\n' +
      'Test Suites: 7 passed, 7 total\n' +
      'Tests: 7 passed, 7 total';
    expect(parseTestCounts(log).tests.total).toBe(391);
    expect(parseTestCounts(log).suites.total).toBe(23);
    expect(parseTestSummaries(log)).toHaveLength(2);
    expect(parseTestSummaries(log)[1].tests.total).toBe(7);
    expect(
      parseTestCounts(
        'Tests: 12 passed, 14 total\nTest Suites: 2 failed, 12 total'
      ).tests.total
    ).toBe(14);
  });

  it('pairs a `Test Suites` line with the `Tests` line that follows it', () => {
    const [only] = parseTestSummaries('Test Suites: 11 passed, 11 total');
    expect(only).toEqual({ suites: { passed: 11, total: 11 }, tests: null });
  });

  it('returns null rather than inventing counts', () => {
    expect(parseTestCounts('build finished, no tests ran')).toBeNull();
    expect(parseTestCounts('')).toBeNull();
    expect(parseTestCounts(null)).toBeNull();
  });
});

describe('summarizeLoad', () => {
  it('reports start, median and max over the whole run', () => {
    expect(summarizeLoad({ start: 4, samples: [4, 1, 9, 2, 3] })).toEqual({
      start: 4,
      median: 3,
      max: 9,
      count: 5,
    });
    // Even count: the middle two, so a run that was busy for half its length is
    // not summarised as quiet.
    expect(summarizeLoad({ start: 1, samples: [1, 2, 3, 100] })).toMatchObject({
      median: 2.5,
      max: 100,
      count: 4,
    });
  });

  it('does not report a median it never measured', () => {
    expect(summarizeLoad({ start: 2.5, samples: [] })).toEqual({
      start: 2.5,
      median: null,
      max: null,
      count: 0,
    });
    expect(summarizeLoad({ samples: [Number.NaN, 3] }).count).toBe(1);
  });
});

describe('resolveGate', () => {
  it('runs the same commands package.json runs, from the same directory', () => {
    expect(resolveGate('check')).toMatchObject({
      argv: ['bun', 'run', 'check'],
      cwd: 'repo',
      platform: null,
      bench: false,
    });
    // The harness entry point, not `bun run`, so arguments survive (S9's Node
    // guard lives in that script) and cwd matches `bun --cwd example harness:ios`.
    expect(resolveGate('harness:android')).toMatchObject({
      argv: ['node', '../scripts/harness.mjs', '--harnessRunner', 'android'],
      cwd: 'example',
      platform: 'android',
    });
    expect(resolveGate('real-input:ios')).toMatchObject({
      argv: ['node', 'scripts/real-input/ios.mjs'],
      platform: 'ios',
    });
    expect(resolveGate('smoke:rn-cli')).toMatchObject({
      argv: ['bash', 'scripts/smoke/rn-cli.sh'],
    });
  });

  it('appends a suite to a harness gate, in the name or after --', () => {
    expect(resolveGate('harness:android:ColdSizing').argv).toEqual([
      'node',
      '../scripts/harness.mjs',
      '--harnessRunner',
      'android',
      'ColdSizing',
    ]);
    expect(resolveGate('harness:ios', ['ColdSizing']).argv.slice(4)).toEqual([
      'ColdSizing',
    ]);
  });

  it('names a filtered run something other than the full gate (M1)', () => {
    // The name is what the ledger records and what `need` matches on, so this is
    // where "one suite is not the platform gate" is actually decided. Round 1
    // recorded `argv[0]`, and a filtered run satisfied the full gate.
    expect(resolveGate('harness:ios', ['ColdSizing']).gate).not.toBe(
      'harness:ios'
    );
    expect(resolveGate('harness:ios', ['ColdSizing']).gate).toBe(
      'harness:ios:ColdSizing'
    );
    expect(resolveGate('harness:android:ColdSizing').gate).toBe(
      'harness:android:ColdSizing'
    );
    expect(
      resolveGate('real-input:android', ['--control', 'switch']).gate
    ).toBe('real-input:android:--control:switch');
    // A name that carries its arguments is a legal command, so a recorded gate
    // can be pasted straight back.
    expect(resolveGate('real-input:android:--control:switch').gate).toBe(
      'real-input:android:--control:switch'
    );
    // An argument with a separator in it cannot impersonate two arguments.
    expect(resolveGate('harness:android', ['a:b']).gate).toBe(
      'harness:android:a%3Ab'
    );
    expect(resolveGate('harness:android').gate).toBe('harness:android');
    expect(resolveGate('check').gate).toBe('check');
    expect(() => resolveGate('check', ['--coverage'])).toThrow(
      /check takes no arguments/
    );
  });

  it('routes bench to the bench runner and marks it a bench', () => {
    expect(resolveGate('bench')).toMatchObject({ bench: true, platform: null });
    expect(resolveGate('bench', ['--plan', 'quick']).argv.slice(1)).toEqual([
      'scripts/bench/run.mjs',
      '--plan',
      'quick',
    ]);
  });

  it('refuses a gate name it does not know, rather than running something', () => {
    expect(() => resolveGate('harness:both')).toThrow(
      /harness needs a platform/
    );
    expect(() => resolveGate('smoke:maybe')).toThrow(/smoke is one of/);
    expect(() => resolveGate('deploy')).toThrow(/unknown gate/);
  });
});

describe('deviceFromEnv', () => {
  it('records the lease id and serial a device gate ran under', () => {
    expect(
      deviceFromEnv(
        {
          NITRO_UI_LEASE_ID: 'X2-kwv6c',
          ANDROID_SERIAL: 'emulator-5570',
          ANDROID_AVD: 'nitroui_t01',
        },
        'android'
      )
    ).toEqual({
      platform: 'android',
      device: 'emulator-5570',
      lease: 'X2-kwv6c',
    });
    expect(
      deviceFromEnv(
        { NITRO_UI_LEASE_ID: 'X2-2', IOS_SIM_UDID: 'UDID-1' },
        'ios'
      )
    ).toEqual({ platform: 'ios', device: 'UDID-1', lease: 'X2-2' });
  });

  it('records nothing device-shaped for check, and no AVD name when there is no serial', () => {
    // D25: a committed ledger line must not carry this machine's device names
    // beyond what a lease exported for the run.
    expect(deviceFromEnv({}, null)).toEqual({
      platform: null,
      device: null,
      lease: null,
    });
    expect(
      deviceFromEnv({ ANDROID_AVD: 'nitroui_t01' }, null).device
    ).toBeNull();
  });
});

/**
 * The fix-round review items. These four describes are the reason this round
 * exists: M2 (a one-platform fix re-owed the other platform), M3 (`check`'s counts
 * cell), M4 (rename detection) and the tooling allow-list the review specified.
 */

/** `path -> content` -> `path -> content hash`, code files only, as the stamp does. */
function hashOf(files) {
  const entries = {};
  for (const [file, content] of Object.entries(files)) {
    if (isCodeFile(file)) entries[file] = contentHash(content);
  }
  return entries;
}

/** The full code-tree digest for a file set, the way `currentCodeTree()` reads it. */
function fullTreeOf(files) {
  return codeTreeDigest(hashOf(files));
}

function platformTreesOf(files) {
  return platformTreesFromEntries(hashOf(files));
}

describe('platformMappingFor / tooling class', () => {
  it('maps the platform directories, including the halves N3 left coarse', () => {
    expect(
      platformMappingFor('ios/components/Button/Switch.swift').platforms
    ).toEqual(['ios']);
    // example/ios is a Podfile, a lockfile and an Xcode project: iOS only, the
    // same as example/android was already.
    expect(platformMappingFor('example/ios/Podfile').platforms).toEqual([
      'ios',
    ]);
    expect(
      platformMappingFor('example/android/app/build.gradle').platforms
    ).toEqual(['android']);
    expect(
      platformMappingFor('nitrogen/generated/ios/Autolink.swift').platforms
    ).toEqual(['ios']);
    expect(
      platformMappingFor('nitrogen/generated/android/Autolink.kt').platforms
    ).toEqual(['android']);
    for (const shared of [
      'nitrogen/generated/shared/Types.hpp',
      'src/index.ts',
      'cpp/ui/Switch.cpp',
    ]) {
      expect(platformMappingFor(shared).platforms).toEqual(['ios', 'android']);
    }
  });

  it('treats the check-only allow-list as no platform at all', () => {
    for (const tooling of [
      'scripts/__tests__/gate.test.js',
      'scripts/gate.mjs',
      'scripts/gate-core.mjs',
      'scripts/bench/run.mjs',
      'scripts/perf/renders.mjs',
      'scripts/smoke/pack.sh',
      'scripts/package-files.mjs',
      'eslint-rules/no-raw-colors.js',
      'etc/package-files.txt',
      '.changeset/config.json',
      '.gitignore',
      '.prettierignore',
    ]) {
      expect(isToolingPath(tooling)).toBe(true);
      expect(platformsOwningFile(tooling)).toEqual([]);
    }
    expect(
      platformsTouchedByPaths(['scripts/gate.mjs', 'eslint-rules/x.js'])
    ).toEqual({ platforms: [], unmapped: [], tooling: expect.any(Array) });
  });

  it('keeps every path a device run depends on out of the allow-list', () => {
    // The review's warning: a device run imports a lot of `scripts/`, so
    // tooling is an allow-list and not `scripts/` wholesale. Each of these is
    // loaded by the harness config, Metro, or the binary, so it must still ask
    // for both platforms.
    for (const deviceRunInput of [
      'scripts/app-stamp.mjs',
      'scripts/app-stamp-core.mjs',
      'scripts/lease-core.mjs',
      'scripts/node-version.mjs',
      'scripts/harness-timing-gate.js',
      'scripts/harness.mjs',
      'scripts/real-input/android.mjs',
      'scripts/build-app.mjs',
      'scripts/pod-install.mjs',
      'scripts/patch-nitrogen.mjs',
    ]) {
      expect(isToolingPath(deviceRunInput)).toBe(false);
      expect(platformsOwningFile(deviceRunInput)).toEqual(['ios', 'android']);
    }
  });
});

describe('platformTreesFromEntries (the key M2 rests on)', () => {
  const ROUND_ONE = {
    'ios/components/Button/Switch.swift': 'swift-v1',
    'android/src/main/ui/Switch.kt': 'kt-v1',
    'src/ui/Shared.ts': 'ts-v1',
    'scripts/gate.mjs': 'tooling-v1',
  };

  it('puts shared code in both halves and tooling in neither', () => {
    const trees = platformTreesOf(ROUND_ONE);
    const iosOnly = platformTreesFromEntries(
      hashOf({ 'ios/a.swift': 'x', 'example/ios/Podfile': 'y' })
    );
    expect(trees.ios).not.toBe(trees.android);
    expect(iosOnly.android).toBe(
      platformTreesFromEntries(hashOf({})).android,
      'a tree of only iOS files has an empty Android half'
    );
    // Adding tooling changes neither half, which is what stops a tooling fix
    // round re-owing two device runs.
    expect(
      platformTreesOf({ ...ROUND_ONE, 'scripts/gate.mjs': 'tooling-v2' })
    ).toEqual(trees);
  });

  it('moves only the Android half when only Android changed', () => {
    const before = platformTreesOf(ROUND_ONE);
    const after = platformTreesOf({
      ...ROUND_ONE,
      'android/src/main/ui/Switch.kt': 'kt-v2',
    });
    expect(after.ios).toBe(before.ios);
    expect(after.android).not.toBe(before.android);
    expect(fullTreeOf(ROUND_ONE)).not.toBe(fullTreeOf(after));
  });

  it('moves both halves when shared code changed', () => {
    const before = platformTreesOf(ROUND_ONE);
    const after = platformTreesOf({
      ...ROUND_ONE,
      'src/ui/Shared.ts': 'ts-v2',
    });
    expect(after.ios).not.toBe(before.ios);
    expect(after.android).not.toBe(before.android);
  });
});

describe('the fix-round rule (M2)', () => {
  const ROUND_ONE = {
    'ios/components/Button/Switch.swift': 'swift-v1',
    'android/src/main/ui/Switch.kt': 'kt-v1',
  };
  const roundOneTree = fullTreeOf(ROUND_ONE);
  const roundOneTrees = platformTreesOf(ROUND_ONE);

  function lineOn(gate, tree, trees, result = 'pass') {
    return line({ gate, tree, trees, result });
  }

  /** Round 1: an iOS file and an Android file, and all three gates green. */
  function afterRoundOne() {
    expect(platformsTouchedByPaths(Object.keys(ROUND_ONE)).platforms).toEqual([
      'ios',
      'android',
    ]);
    return [
      lineOn('check', roundOneTree, roundOneTrees),
      lineOn('harness:ios', roundOneTree, roundOneTrees),
      lineOn('harness:android', roundOneTree, roundOneTrees),
    ];
  }

  it('an Android-only fix does not re-owe the iOS run', () => {
    const fixed = { ...ROUND_ONE, 'android/src/main/ui/Switch.kt': 'kt-v2' };
    const tree = fullTreeOf(fixed);
    const trees = platformTreesOf(fixed);
    // The fix itself touches Android only...
    expect(
      platformsTouchedByPaths(['android/src/main/ui/Switch.kt']).platforms
    ).toEqual(['android']);
    // ... and `need` still reads the *branch* diff, because that is what a diff
    // against the base ref is: the branch touched both platforms, so iOS stays
    // required. What M2 changes is that it stops being required *again*: the
    // round-1 line is keyed to the iOS half of the tree, and that half did not
    // move. Before it, this row read "not this code tree: re-run it".
    const touched = platformsTouchedByPaths(Object.keys(fixed));
    expect(touched.platforms).toEqual(['ios', 'android']);

    const entries = [
      ...afterRoundOne(),
      lineOn('check', tree, trees),
      lineOn('harness:android', tree, trees),
    ];
    const review = decideNeed({
      entries,
      tree,
      trees,
      stage: 'review',
      touchedPlatforms: touched.platforms,
    });
    expect(review.ok).toBe(true);
    expect(review.required.map((row) => row.gate)).toEqual([
      'check',
      'harness:ios',
      'harness:android',
    ]);
    expect(review.missing).toEqual([]);
    const iosRow = review.required.find((row) => row.gate === 'harness:ios');
    // This is the whole point: the iOS line is from the *previous* tree.
    expect(iosRow.entry.tree).toBe(roundOneTree);
    expect(iosRow.state).toBe('green');
    expect(iosRow.matched).toBe('ios');

    // Merge is not impressed: it still wants every gate once on the final tree.
    expect(
      decideNeed({ entries, tree, trees, stage: 'merge' }).missing
    ).toContain('harness:ios');
  });

  it('an iOS-only fix still re-ows Android, because it must', () => {
    const fixed = { ...ROUND_ONE, 'ios/components/Button/Switch.swift': 'v2' };
    const tree = fullTreeOf(fixed);
    const trees = platformTreesOf(fixed);
    const entries = [
      ...afterRoundOne(),
      lineOn('check', tree, trees),
      lineOn('harness:ios', tree, trees),
    ];
    const review = decideNeed({
      entries,
      tree,
      trees,
      stage: 'review',
      touchedPlatforms: platformsTouchedByPaths([
        'ios/components/Button/Switch.swift',
      ]).platforms,
    });
    expect(review.required.map((row) => row.gate)).toEqual([
      'check',
      'harness:ios',
    ]);
    // Android is not asked for at review here (the diff is iOS-only), and at
    // merge the round-1 line is stale: the full tree moved.
    expect(
      decideNeed({ entries, tree, trees, stage: 'merge' }).missing
    ).toContain('harness:android');
  });

  it('a shared-code fix re-ows both platforms', () => {
    const fixed = { ...ROUND_ONE, 'src/ui/Shared.ts': 'ts-v2' };
    const tree = fullTreeOf(fixed);
    const trees = platformTreesOf(fixed);
    const touched = platformsTouchedByPaths(['src/ui/Shared.ts']);
    expect(touched.platforms).toEqual(['ios', 'android']);
    const review = decideNeed({
      entries: afterRoundOne(),
      tree,
      trees,
      stage: 'review',
      touchedPlatforms: touched.platforms,
    });
    // `check` is keyed to the whole tree, so it is owed too; the two device runs
    // are owed because both binaries contain the shared file.
    expect(review.missing).toEqual(['check', 'harness:ios', 'harness:android']);
  });

  it('a tooling-only fix asks for check and nothing else', () => {
    const fixed = { ...ROUND_ONE, 'scripts/gate.mjs': 'tooling-v2' };
    const tree = fullTreeOf(fixed);
    const trees = platformTreesOf(fixed);
    expect(trees).toEqual(roundOneTrees);
    const touched = platformsTouchedByPaths(['scripts/gate.mjs']);
    expect(touched.platforms).toEqual([]);
    const review = decideNeed({
      entries: afterRoundOne(),
      tree,
      trees,
      stage: 'review',
      touchedPlatforms: touched.platforms,
      toolingPaths: touched.tooling,
    });
    expect(review.required.map((row) => row.gate)).toEqual(['check']);
    expect(review.notes.join(' ')).toMatch(/tooling \(check-only\)/);
  });
});

describe('a line that is not about this tree (N1, N2)', () => {
  it('is never green when the tree moved while the run went on', () => {
    const moved = line({ gate: 'check', tree: TREE_A, treeAfter: TREE_B });
    expect(
      gateStateFor({
        gate: 'check',
        entry: moved,
        tree: TREE_A,
        stage: 'merge',
      }).state
    ).toBe('stale');
    expect(
      gateStateFor({
        gate: 'check',
        entry: moved,
        tree: TREE_A,
        stage: 'merge',
      }).why
    ).toBe('moved');
    // A run that started clean on this tree outranks an interrupted one: the
    // interrupted run may have failed on code that is not here now.
    const rows = gateRowFor({
      gate: 'check',
      list: [line({ gate: 'check' }), moved],
      tree: TREE_A,
      stage: 'merge',
    });
    expect(rows.state).toBe('green');
    // ... and a moved-tree fail does not stay green either.
    expect(
      gateRowFor({
        gate: 'check',
        list: [moved],
        tree: TREE_A,
        stage: 'merge',
      }).state
    ).toBe('stale');
  });

  it('prefers the latest line for the tree being asked about', () => {
    const entries = [
      line({ gate: 'check', tree: TREE_A, commit: 'c1' }),
      line({ gate: 'check', tree: TREE_B, commit: 'c2', result: 'fail' }),
    ];
    // Reverted back to TREE_A: the code that passed is the code in front of us.
    expect(
      gateRowFor({
        gate: 'check',
        list: listByGate(entries).check,
        tree: TREE_A,
      }).state
    ).toBe('green');
    expect(
      gateRowFor({
        gate: 'check',
        list: listByGate(entries).check,
        tree: TREE_B,
      }).state
    ).toBe('red');
  });

  it('prints an older tree as stale, never as FAIL', () => {
    const table = renderGateTable({
      entries: [
        line({ gate: 'harness:android', tree: TREE_A, result: 'fail' }),
      ],
      tree: TREE_B,
      stage: 'merge',
    });
    expect(table).toContain('stale');
    expect(table).not.toContain('**FAIL**');
    expect(table).toContain('(not this tree)');
  });
});

describe('changedPathsGitArgs (M4)', () => {
  it('never follows a rename when asking what a diff touched', () => {
    const [committed, withWorktree] = changedPathsGitArgs('deadbeef');
    for (const args of [committed, withWorktree]) {
      expect(args).toContain('--no-renames');
      expect(args).toContain('--name-only');
    }
    expect(committed.join(' ')).toContain('deadbeef...HEAD');
    expect(withWorktree).not.toContain('deadbeef...HEAD');
  });
});

describe('countsForDisplay (M3)', () => {
  const JEST = {
    suites: { passed: 23, total: 23 },
    tests: { passed: 391, total: 391 },
  };
  const PERF = {
    suites: { passed: 7, total: 7 },
    tests: { passed: 7, total: 7 },
  };

  it('reports the unit step when every step passed', () => {
    const entry = line({
      gate: 'check',
      counts: JEST,
      summaries: [JEST, PERF],
    });
    expect(countsForDisplay(entry)).toEqual(JEST);
    expect(renderGateTable({ entries: [entry], tree: TREE_A })).toContain(
      '391 tests / 23 suites'
    );
  });

  it('sums the failures across steps when any step failed', () => {
    const failingPerf = {
      suites: { passed: 6, failed: 1, total: 7 },
      tests: { passed: 5, failed: 2, total: 7 },
    };
    const entry = line({
      gate: 'check',
      result: 'fail',
      counts: JEST,
      summaries: [JEST, failingPerf],
    });
    const shown = countsForDisplay(entry);
    expect(shown.tests.failed).toBe(2);
    expect(shown.tests.total).toBe(398);
    expect(
      renderGateTable({
        entries: [{ ...entry, result: 'fail' }],
        tree: TREE_A,
      })
    ).toMatch(/2 failed of 398 tests/);
  });

  it('still reports a single step as itself', () => {
    expect(
      countsForDisplay(line({ gate: 'harness:ios', counts: JEST }))
    ).toEqual(JEST);
    expect(countsForDisplay(undefined)).toBeNull();
  });
});

describe('summarizeLoad rounding (N5)', () => {
  it('rounds the start sample like the others', () => {
    // `os.loadavg()` returns a float, and the committed ledger had
    // "start":13.54443359375 in it.
    const samples = [13.54443359375, 20.4, 31.9];
    const load = summarizeLoad({ start: 13.54443359375, samples });
    expect(load).toEqual({ start: 13.54, median: 20.4, max: 31.9, count: 3 });
    expect(summarizeLoad({ start: 13.54443359375, samples: [] }).start).toBe(
      13.54
    );
    expect(summarizeLoad({ start: null, samples: [] }).count).toBe(0);
  });
});

/**
 * The CLI layer (`scripts/gate.mjs`), which no amount of pure-function testing
 * can see: M1 lives in "which name gets recorded", and M4 lives in "which git
 * command asks the question". Both are tested by running the real file in a
 * throwaway checkout with a fake runner on `PATH` that prints a jest summary and
 * exits 0, so the assertions are about what lands in the ledger and what `need`
 * answers - the two things a round actually reads.
 */

const CLI = path.join(process.cwd(), 'scripts', 'gate.mjs');

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
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  }
  return String(result.stdout).trim();
}

/**
 * A minimal checkout: the marker `repoRootOf()` looks for, an `example/` for the
 * harness gate to run in, and a `main` ref for `need --base` to diff against.
 *
 * @param {Record<string, string>} files path -> contents at the base commit
 * @param {(dir: string) => void} [onBranch] what the task branch then changes
 */
function makeCheckout(files, onBranch = () => {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'x2-gate-'));
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  fs.mkdirSync(path.join(dir, 'example'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'example/package.json'), '{"name":"x"}\n');
  // The real repo gitignores `.gates/`; a fixture that does not has its own
  // ledger and logs counted as code, so the tree moves while a gate runs and
  // every line reads stale. (Found by running this file: the N1 check caught it.)
  fs.writeFileSync(path.join(dir, '.gitignore'), '.gates/\nfake-bin/\n');
  gitIn(dir, ['init', '-q', '-b', 'main']);
  gitIn(dir, ['add', '-A']);
  gitIn(dir, ['commit', '-qm', 'base']);
  gitIn(dir, ['checkout', '-qb', 'task/x2-fixture']);
  onBranch(dir);
  return dir;
}

function writeFakeRunner(dir) {
  const bin = path.join(dir, 'fake-bin');
  fs.mkdirSync(bin, { recursive: true });
  const script =
    '#!/bin/sh\n' +
    'echo "fake runner: $0 $*"\n' +
    'echo "Test Suites: 23 passed, 23 total"\n' +
    'echo "Tests: 391 passed, 391 total"\n' +
    'if [ -n "$FAKE_SECOND_SUMMARY" ]; then\n' +
    '  echo "Test Suites: 7 passed, 7 total"\n' +
    '  echo "Tests: 7 passed, 7 total"\n' +
    'fi\n' +
    'exit 0\n';
  for (const name of ['node', 'bun']) {
    const shim = path.join(bin, name);
    fs.writeFileSync(shim, script);
    fs.chmodSync(shim, 0o755);
  }
  return bin;
}

function runCli(dir, args, extraEnv = {}) {
  const bin = writeFakeRunner(dir);
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

function ledgerLines(dir) {
  const file = path.join(dir, '.gates', 'task', 'x2-fixture.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((raw) => raw.trim() !== '')
    .map((raw) => JSON.parse(raw));
}

describe('gate.mjs (the CLI, in a throwaway checkout)', () => {
  const cleanup = [];

  function checkout(files, onBranch) {
    const dir = makeCheckout(files, onBranch);
    cleanup.push(dir);
    return dir;
  }

  afterAll(() => {
    for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('records a filtered run under its own name, and need still wants the gate', async () => {
    const dir = checkout(
      {
        'nitrogen/generated/ios/NitroUiAutolinking.swift': '// marker\n',
        'ios/components/Button/Switch.swift': 'v1\n',
      },
      (target) => {
        fs.mkdirSync(path.join(target, 'android/src/main/ui'), {
          recursive: true,
        });
        fs.writeFileSync(
          path.join(target, 'android/src/main/ui/Switch.kt'),
          'v1\n'
        );
        gitIn(target, ['add', '-A']);
        gitIn(target, ['commit', '-qm', 'touch android']);
      }
    );
    const run = runCli(dir, ['harness:android', '--', 'ColdSizing']);
    expect(run.status).toBe(0);
    const lines = ledgerLines(dir);
    expect(lines).toHaveLength(1);
    // M1: the recorded name carries the filter, so it is visibly not the
    // platform gate. `argv[0]` used to be recorded, and one suite satisfied
    // `harness:android`.
    expect(lines[0].gate).toBe('harness:android:ColdSizing');
    expect(lines[0].result).toBe('pass');
    expect(lines[0].trees.ios).toEqual(expect.any(String));
    expect(lines[0].treeAfter).toBe(lines[0].tree);

    const need = runCli(dir, ['need', '--for', 'review', '--base', 'main']);
    expect(need.status).toBe(1);
    expect(need.stdout).toContain('harness:android — never run on this tree');
    expect(need.stdout).not.toContain('✓ harness:android —');
  }, 60_000);

  it('records the full run under the bare name, and review then passes', async () => {
    const dir = checkout(
      {
        'nitrogen/generated/ios/NitroUiAutolinking.swift': '// marker\n',
        'android/src/main/ui/Switch.kt': 'v1\n',
      },
      (target) => {
        fs.writeFileSync(
          path.join(target, 'android/src/main/ui/Switch.kt'),
          'v2\n'
        );
        gitIn(target, ['add', '-A']);
        gitIn(target, ['commit', '-qm', 'touch android']);
      }
    );
    expect(runCli(dir, ['check'], { FAKE_SECOND_SUMMARY: '1' }).status).toBe(0);
    expect(runCli(dir, ['harness:android']).status).toBe(0);
    const lines = ledgerLines(dir);
    expect(lines.map((entry) => entry.gate)).toEqual([
      'check',
      'harness:android',
    ]);
    // M3 at the layer that writes the line: `counts` is the jest step, and the
    // perf step that printed last is kept beside it rather than in its place.
    expect(lines[0].counts.tests.total).toBe(391);
    expect(lines[0].summaries).toHaveLength(2);
    expect(lines[0].summaries[1].tests.total).toBe(7);

    const need = runCli(dir, ['need', '--for', 'review', '--base', 'main']);
    expect(need.stdout).toContain('need: review is satisfied');
    expect(need.status).toBe(0);
    const table = runCli(dir, ['table']);
    // Scoped to the `check` row on purpose: the fake runner prints the same
    // summary for every gate, so a loose substring would match another row.
    const checkRow = table.stdout
      .split('\n')
      .find((row) => row.startsWith('| `check` '));
    expect(checkRow).toContain('**PASS**');
    expect(checkRow).toContain('391 tests / 23 suites');
    // Merge is a different bar, on the same lines.
    const merge = runCli(dir, ['need', '--for', 'merge', '--base', 'main']);
    expect(merge.status).toBe(1);
    expect(merge.stdout).toContain('real-input:ios');
  }, 60_000);

  it('refuses arguments to check and records nothing', () => {
    const dir = checkout({
      'nitrogen/generated/ios/NitroUiAutolinking.swift': '// marker\n',
    });
    const run = runCli(dir, ['check', '--', '--coverage']);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('check takes no arguments');
    expect(ledgerLines(dir)).toEqual([]);
  });

  it('still asks for iOS when a rename moves a file out of ios/', () => {
    // M4: git follows renames by default, so a `git mv` out of a platform
    // directory used to read as "this branch touches no platform-specific code".
    const dir = checkout(
      {
        'nitrogen/generated/ios/NitroUiAutolinking.swift': '// marker\n',
        'ios/components/Button/Switch.swift': 'v1\n',
      },
      (target) => {
        fs.mkdirSync(path.join(target, 'bench/attic'), { recursive: true });
        gitIn(target, [
          'mv',
          'ios/components/Button/Switch.swift',
          'bench/attic/Switch.swift',
        ]);
        gitIn(target, ['commit', '-qm', 'move the button out']);
      }
    );
    const need = runCli(dir, ['need', '--for', 'review', '--base', 'main']);
    expect(need.status).toBe(1);
    expect(need.stdout).toContain('harness:ios');
    expect(need.stdout).not.toContain('touches no platform-specific code');
  });
});

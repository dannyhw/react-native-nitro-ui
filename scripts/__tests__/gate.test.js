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

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import {
  LEDGER_VERSION,
  MERGE_GATES,
  backgroundRecordPath,
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
  STILL_RUNNING_EXIT,
  decideWait,
  lastLogLine,
  pidMayBeRunning,
  runningBackgroundGates,
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
      // X12: the last sample, so a failure excerpt can say what load the run
      // *ended* under and not just how it averaged.
      end: 3,
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
      end: null,
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
    expect(load).toEqual({
      start: 13.54,
      median: 20.4,
      max: 31.9,
      count: 3,
      end: 31.9,
    });
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
 *
 * Those fixtures put `node` and `bun` shims on `PATH` and expect the CLI to reach
 * them. On a Node the gates do not run on, `gate.mjs` starts by re-execing itself
 * under the `.nvmrc` major (`node-version.mjs`), and that re-exec resolves a *real*
 * node from the fnm-exported PATH - so the fixture's fake runner is skipped
 * entirely and `bun run check` runs against a tree that is not this repo's.
 * FOLLOWUPS 57 saw two cases go red that way on Node 25/26. The answer comes from
 * the shipped module rather than a copy of its supported list, so this guard cannot
 * drift from the rule it defers to. (`node-version.mjs` cannot be imported here:
 * it uses `import.meta`, which jest's CJS transform rejects - the same reason
 * `gate-core.mjs` has none.)
 */
const runtime = (() => {
  const probeFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'x2-gate-node-')),
    'probe.mjs'
  );
  fs.writeFileSync(
    probeFile,
    'import { isSupportedNodeVersion } from ' +
      JSON.stringify(path.join(process.cwd(), 'scripts', 'node-version.mjs')) +
      ';\n' +
      'process.stdout.write(JSON.stringify({' +
      'supported: isSupportedNodeVersion(process.versions.node),' +
      'version: process.versions.node' +
      '}));\n'
  );
  const probe = spawnSync(process.execPath, [probeFile], {
    encoding: 'utf8',
  });
  fs.rmSync(path.dirname(probeFile), { recursive: true, force: true });
  try {
    return JSON.parse(String(probe.stdout));
  } catch {
    // Could not ask the module. Running the fixtures is the honest default:
    // they are what catches a real ledger bug.
    return { supported: true, version: process.versions.node };
  }
})();

const describeCli = runtime.supported ? describe : describe.skip;

if (!runtime.supported) {
  describe('gate.mjs (the CLI) cannot be tested on this runtime', () => {
    // Loud rather than silent: a skip nobody notices is how a guard becomes
    // decoration (the same reasoning as `emulator-launch.test.js`).
    it(`SKIPPED: the CLI fixtures need the Node the gates run on, and this is ${runtime.version}, where gate.mjs re-execs past the fake runner`, () => {
      expect(runtime.supported).toBe(false);
    });
  });
}

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
    // For the background/`wait` cases: a gate that takes a while, and a gate that
    // fails with a code that is not 1, so "exits with the gate\'s code" is a claim
    // a test can actually falsify.
    'if [ -n "$FAKE_PROGRESS" ]; then echo "$FAKE_PROGRESS"; fi\n' +
    // For the "is the device claimed *while* the run is in flight" case (X11 review M7): the
    // stand-in for four minutes of XCUITest reads the state file the reaper reads, from inside the
    // run. A claim that was taken after the run started, or released before it ended, is invisible
    // to every assertion made on the parent's side of the process boundary.
    'if [ -n "$FAKE_SHOW_CLAIMS" ]; then echo "claims-during-run:"; cat "$NITRO_UI_HOME/pool.json"; fi\n' +
    // For the `NITRO_UI_GATE_LOG` leak case (N6): a gate's own child processes must
    // not inherit the launcher's log path, so a nested `gate.mjs` cannot write into
    // its parent's log and mark its parent's record done.
    'if [ -n "$FAKE_SHOW_GATE_LOG_ENV" ]; then echo "child sees gate-log env [${NITRO_UI_GATE_LOG-unset}]"; fi\n' +
    // For the signal-forwarding cases (FOLLOWUPS 57): a gate that says it is ready, then
    // waits to be signalled and reports which signal it *actually received*. Only the
    // child can evidence a forward: anything asserted on the parent's side of the
    // process boundary would also be true when the child is merely killed by the OS.
    'if [ -n "$FAKE_TRAP" ]; then\n' +
    '  trap \'echo "fake: caught $FAKE_TRAP"; exit 3\' "$FAKE_TRAP"\n' +
    '  echo "fake: ready"\n' +
    '  i=0\n' +
    '  while [ "$i" -lt 300 ]; do sleep 0.1; i=$((i+1)); done\n' +
    '  exit 0\n' +
    'fi\n' +
    'if [ -n "$FAKE_SLEEP" ]; then sleep "$FAKE_SLEEP"; fi\n' +
    'if [ -n "$FAKE_PROGRESS_AFTER" ]; then echo "$FAKE_PROGRESS_AFTER"; fi\n' +
    'exit ${FAKE_EXIT:-0}\n';
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

/**
 * `runCli`, but running: the signal-forwarding cases have to reach into the
 * running CLI, which `spawnSync` cannot do.
 */
function spawnCli(dir, args, extraEnv = {}) {
  const bin = writeFakeRunner(dir);
  const child = spawn(process.execPath, [CLI, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      ...extraEnv,
    },
  });
  const output = { stdout: '', stderr: '' };
  child.stdout.on('data', (chunk) => {
    output.stdout += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    output.stderr += String(chunk);
  });
  return { child, output };
}

/** Resolves when `text` appears in `output`, or rejects with what was seen. */
async function waitUntil(output, text, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (output.stdout.includes(text) || output.stderr.includes(text)) return;
    if (Date.now() > deadline) {
      throw new Error(
        `never saw ${JSON.stringify(text)} in:\n${output.stdout}\n${output.stderr}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * `child`'s close, but bounded: a gate that hangs instead of exiting has to show up
 * as this error, with everything it said, not as a Jest timeout that arrived with no
 * idea where it stalled. Attach it before signalling - `close` fires once, and a
 * listener attached after the output has already arrived can miss it entirely.
 */
function closed(child, output, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `the gate did not exit within ${timeoutMs} ms. stdout:\n${output.stdout}\nstderr:\n${output.stderr}`
          )
        ),
      timeoutMs
    );
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
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

describeCli('gate.mjs (the CLI, in a throwaway checkout)', () => {
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

/**
 * `decideWait` and friends, one read of a record at a time.
 *
 * The CLI cases below cover the same rules end to end; these exist for the two
 * outcomes a live run cannot be made to produce on demand: a gate killed by a
 * signal (its record says `exitCode: null`), and a pid owned by another user. Both
 * are places where the tempting shortcut — `exitCode ?? 0`, or "we cannot signal
 * it, so it is dead" — reports a failure as a pass, or a running gate as gone.
 */
describe('decideWait / pidMayBeRunning', () => {
  const running = (overrides = {}) => ({
    pid: 4242,
    done: false,
    gate: 'check',
    ...overrides,
  });

  it('keeps waiting while the record is open and the process is alive', () => {
    const decision = decideWait({
      record: running(),
      pidAlive: true,
      elapsedMs: 30_000,
      timeoutMs: 600_000,
      progress: 'Compiling Switch.swift',
    });
    expect(decision.kind).toBe('running');
    expect(decision.message).toContain('Compiling Switch.swift');
  });

  it('says "still running" at the budget instead of a failure', () => {
    const decision = decideWait({
      record: running(),
      pidAlive: true,
      elapsedMs: 600_001,
      timeoutMs: 600_000,
      progress: null,
    });
    expect(decision.kind).toBe('exit');
    expect(decision.exitCode).toBe(STILL_RUNNING_EXIT);
    expect(decision.message).toContain('still running');
  });

  it('reads a signal-killed gate as a failure, not as exit 0', () => {
    const decision = decideWait({
      record: running({
        done: true,
        exitCode: null,
        signal: 'SIGKILL',
        result: 'fail',
      }),
      pidAlive: false,
      elapsedMs: 1_000,
      timeoutMs: 600_000,
      progress: null,
    });
    expect(decision.exitCode).toBe(1);
    expect(decision.message).toContain('SIGKILL');
  });

  it('passes on a record that says it passed', () => {
    expect(
      decideWait({
        record: running({ done: true, exitCode: 0, result: 'pass' }),
        pidAlive: false,
        elapsedMs: 0,
        timeoutMs: 600_000,
        progress: null,
      }).exitCode
    ).toBe(0);
  });

  it('names the last log line when a runner is gone without a result', () => {
    const decision = decideWait({
      record: running(),
      pidAlive: false,
      elapsedMs: 1_000,
      timeoutMs: 600_000,
      progress: 'Linking nitroui_b',
      ledgerEntry: null,
    });
    expect(decision.exitCode).toBe(STILL_RUNNING_EXIT);
    expect(decision.message).toContain('Linking nitroui_b');
  });

  it('answers from the ledger line when the record lies about being open', () => {
    const failed = decideWait({
      record: running(),
      pidAlive: false,
      elapsedMs: 1_000,
      timeoutMs: 600_000,
      progress: null,
      ledgerEntry: { gate: 'check', result: 'fail', exitCode: 7 },
    });
    expect(failed.exitCode).toBe(7);
    expect(failed.message).toContain('from the ledger line');
    expect(
      decideWait({
        record: running(),
        pidAlive: false,
        elapsedMs: 1_000,
        timeoutMs: 600_000,
        progress: null,
        ledgerEntry: { gate: 'check', result: 'pass', exitCode: 0 },
      }).exitCode
    ).toBe(0);
  });

  it('treats a pid it cannot signal as alive', () => {
    expect(pidMayBeRunning(1, () => true)).toBe(true);
    expect(
      pidMayBeRunning(1, () => {
        throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
      })
    ).toBe(false);
    expect(
      pidMayBeRunning(1, () => {
        throw Object.assign(new Error('not ours'), { code: 'EPERM' });
      })
    ).toBe(true);
    // A missing pid is not "alive": `status` must not list a gate that never started.
    expect(pidMayBeRunning(Number(undefined))).toBe(false);
  });

  it('lists only open records with a live pid as running', () => {
    const rows = runningBackgroundGates(
      [
        { gate: 'check', pid: 1, done: false, logPath: 'a.log', startedAt: 5 },
        { gate: 'harness:ios', pid: 2, done: true, logPath: 'b.log' },
        { gate: 'bench', pid: 3, done: false, logPath: 'c.log' },
        null,
      ],
      (pid) => pid === 1
    );
    expect(rows).toEqual([
      { gate: 'check', pid: 1, startedAt: 5, logPath: 'a.log' },
    ]);
  });

  it('takes the last real line of a log as progress, not a blank one', () => {
    expect(lastLogLine('a\nb\n\n')).toBe('b');
    expect(lastLogLine('')).toBeNull();
    expect(lastLogLine(null)).toBeNull();
    expect(lastLogLine(`x${'y'.repeat(300)}`)).toHaveLength(200);
  });
});

/**
 * `--background` and `wait` (X9 item 5).
 *
 * The behaviour being guarded is the one an agent depends on when it stops writing
 * `sleep 300; tail` loops: starting a gate must return at once, `wait` must block
 * and then leave with *the gate's* exit code, and the ledger must not be able to
 * tell a backgrounded run from a foreground one. A backgrounded run that recorded
 * nothing, or a `wait` that reported a failed gate as passed, is worse than the
 * polling loop it replaces.
 */
describeCli('gate.mjs --background and wait', () => {
  const cleanup = [];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function checkout(files) {
    const dir = makeCheckout(files);
    cleanup.push(dir);
    return dir;
  }

  afterAll(() => {
    for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
  });

  /**
   * This checkout's gate log store: `<git-common-dir>/nitro-ui-gates`.
   *
   * X12 moved logs out of the worktree, and a `git init` fixture's common dir is
   * its own `.git`, so the store is a sibling of `.gates/` rather than inside it.
   */
  function storeDir(dir) {
    return path.join(dir, '.git', 'nitro-ui-gates');
  }

  /** Resolves a ledger line's (store-relative) log path to a file on disk. */
  function logFile(dir, logPath) {
    return path.join(storeDir(dir), logPath);
  }

  /** The one background record in the store, throwing when there is not one. */
  function theRecord(dir) {
    const logs = storeDir(dir);
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
        else if (entry.name.endsWith('.gate.json')) found.push(absolute);
      }
    };
    walk(logs);
    if (found.length !== 1) {
      throw new Error(
        `expected exactly one background record, found ${found.length}`
      );
    }
    return JSON.parse(fs.readFileSync(found[0], 'utf8'));
  }

  /** Polls until the record says the gate is done (or gives up loudly). */
  async function waitForRecordToClose(dir, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const record = theRecord(dir);
      if (record.done === true) return record;
      if (Date.now() > deadline) {
        throw new Error(
          `background record never closed: ${JSON.stringify(record)}`
        );
      }
      await sleep(100);
    }
  }

  /** Polls until the log holds `text` (the gate has begun producing output). */
  async function waitForLog(dir, record, text, timeoutMs = 30_000) {
    const file = logFile(dir, record.logPath);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        if (fs.readFileSync(file, 'utf8').includes(text)) return;
      } catch {
        /* not created yet */
      }
      if (Date.now() > deadline) {
        throw new Error(
          `the gate's log never contained ${JSON.stringify(text)}`
        );
      }
      await sleep(50);
    }
  }

  const iosOnly = {
    'nitrogen/generated/ios/NitroUiAutolinking.swift': '// marker\n',
  };

  it('starts detached, records the same line a foreground run would, and wait reports it', async () => {
    const dir = checkout(iosOnly);
    const startedAt = Date.now();
    const started = runCli(dir, ['harness:android', '--background'], {
      // Long enough that the gate is certainly still mid-run by the time `wait`
      // gets its first look (see the wait below), and longer than any plausible
      // launcher overhead, so "returned early" is a measurement and not a
      // coincidence.
      FAKE_SLEEP: '20',
      FAKE_PROGRESS: 'Compiling Switch.swift',
    });
    expect(started.status).toBe(0);
    expect(started.stdout).toContain(
      'harness:android started in the background'
    );
    // It returned while the gate was still mid-run, so the elapsed time is far
    // short of the sleep the gate itself takes.
    expect(Date.now() - startedAt).toBeLessThan(3_000);
    // The gate's output went to the log, not into the launcher's terminal. If the
    // launcher waited and echoed, the summary would be here as well.
    expect(started.stdout).not.toContain('fake runner');

    const record = theRecord(dir);
    expect(record.gate).toBe('harness:android');
    expect(record.done).toBe(false);
    expect(typeof record.pid).toBe('number');
    expect(fs.existsSync(logFile(dir, record.logPath))).toBe(true);

    // `status` must not call a run that is happening "missing".
    const status = runCli(dir, ['status']);
    expect(status.stdout).toContain('running harness:android');
    expect(status.stdout).toMatch(/pid \d+/);

    // Wait for the gate to have *written* the line `wait` is about to be asked to
    // report. `wait` prints progress once, on its first pass, and a gate that has
    // not started printing yet leaves it with the launcher's own header as the last
    // line - which is what the full `check` (36 suites at once) caught: the
    // assertion below was passing only because the machine was idle enough for the
    // child to beat `wait` to the file. The claim under test is "progress comes from
    // the log", so the fixture supplies the log's content rather than racing it.
    await waitForLog(dir, record, 'Compiling Switch.swift');

    const wait = runCli(dir, ['wait', '--gate', 'harness:android']);
    expect(wait.status).toBe(0);
    // Progress comes from the log, which is the whole point of recording the path.
    expect(wait.stderr).toContain('Compiling Switch.swift');
    expect(wait.stderr).toContain('passed');

    const lines = ledgerLines(dir);
    expect(lines).toHaveLength(1);
    expect(lines[0].gate).toBe('harness:android');
    expect(lines[0].result).toBe('pass');
    expect(lines[0].exitCode).toBe(0);
    // The line points at the same log `wait` read, which is what makes a
    // backgrounded run auditable after the fact.
    expect(lines[0].logPath).toBe(record.logPath);
    // And it is the *same* line shape a foreground run writes, including the test
    // counts parsed out of the log exactly once. A run that echoed to the log
    // twice would parse two summaries here.
    expect(lines[0].summaries).toHaveLength(1);
    expect(lines[0].counts.tests.total).toBe(391);
    expect(theRecord(dir).done).toBe(true);
  }, 90_000);

  it('exits with the gate’s own failing code, not a generic one', async () => {
    const dir = checkout(iosOnly);
    const started = runCli(dir, ['check', '--background'], {
      FAKE_SLEEP: '1',
      FAKE_EXIT: '7',
    });
    expect(started.status).toBe(0);
    await waitForRecordToClose(dir);
    const wait = runCli(dir, ['wait', '--gate', 'check']);
    // 7, not 1 and not 0: a caller branching on the code has to see the gate's.
    expect(wait.status).toBe(7);
    expect(wait.stderr).toContain('failed with exit 7');
    const lines = ledgerLines(dir);
    expect(lines).toHaveLength(1);
    expect(lines[0].result).toBe('fail');
    expect(lines[0].exitCode).toBe(7);
  }, 90_000);

  it('reports "still running" as its own exit code at the timeout, leaving the gate alone', async () => {
    const dir = checkout(iosOnly);
    const started = runCli(dir, ['check', '--background'], { FAKE_SLEEP: '8' });
    expect(started.status).toBe(0);
    // ~1.2 s of budget against an 8 s gate: the answer has to be "not finished",
    // which is a different answer from "failed" and needs its own code.
    const wait = runCli(dir, [
      'wait',
      '--gate',
      'check',
      '--timeout-minutes',
      '0.02',
    ]);
    expect(wait.status).toBe(13);
    expect(wait.stderr).toContain('still running');
    // It was left running, and that is visible: the record is still open and the
    // pid still exists, which is what `status` reads.
    const record = theRecord(dir);
    expect(record.done).toBe(false);
    let alive = true;
    try {
      process.kill(Number(record.pid), 0);
    } catch {
      alive = false;
    }
    expect(alive).toBe(true);
    await waitForRecordToClose(dir);
  }, 120_000);

  it('reports a gate whose process is gone as "no result", without burning the timeout', async () => {
    const dir = checkout(iosOnly);
    // A record left behind by a run that was killed hard: no `done`, and no
    // process to ask. The wrong answer is to poll for 45 minutes on a corpse, and
    // the other wrong answer is to call it a pass.
    const deadPid = spawnSync(process.execPath, ['-e', '']).pid;
    // Store-relative, as a real record's `logPath` is, and written into the store
    // rather than the worktree (X12).
    const logPath = 'task/x2-fixture/ghost-check.log';
    fs.mkdirSync(path.dirname(logFile(dir, logPath)), { recursive: true });
    fs.writeFileSync(logFile(dir, logPath), 'gate: check\nmid-compile\n');
    fs.writeFileSync(
      backgroundRecordPath(logFile(dir, logPath)),
      JSON.stringify({
        version: 1,
        gate: 'check',
        pid: deadPid,
        startedAt: Date.now(),
        logPath,
        done: false,
      })
    );
    const started = Date.now();
    const wait = runCli(dir, [
      'wait',
      '--gate',
      'check',
      '--timeout-minutes',
      '10',
    ]);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(wait.status).toBe(13);
    expect(wait.stderr).toContain('gone without recording a result');
    expect(wait.stderr).toContain('mid-compile');
    expect(ledgerLines(dir)).toEqual([]);
  }, 60_000);

  it('trusts the ledger line when a finished run’s record still says running', () => {
    const dir = checkout(iosOnly);
    // The resurrection race: a gate finishes so fast that the launcher's "here is
    // my pid" write lands after the run's "I am done" write. `wait` that believed
    // the record would report a passed gate as gone (or keep waiting), so the
    // ledger line is what it reads instead.
    expect(runCli(dir, ['check']).status).toBe(0);
    const recorded = ledgerLines(dir)[0];
    const deadPid = spawnSync(process.execPath, ['-e', '']).pid;
    const recordPath = backgroundRecordPath(logFile(dir, recorded.logPath));
    fs.writeFileSync(
      recordPath,
      JSON.stringify({
        version: 1,
        gate: 'check',
        pid: deadPid,
        startedAt: Date.now(),
        logPath: recorded.logPath,
        done: false,
      })
    );
    const wait = runCli(dir, ['wait', '--gate', 'check']);
    expect(wait.status).toBe(0);
    expect(wait.stderr).toContain('from the ledger line');
  }, 60_000);

  it('refuses to wait for a gate that was never started', () => {
    const dir = checkout(iosOnly);
    const wait = runCli(dir, ['wait']);
    expect(wait.status).toBe(2);
    expect(wait.stderr).toContain('no background gate');
    expect(runCli(dir, ['wait', '--gate', 'bench']).stderr).toContain(
      'named bench'
    );
    const bad = runCli(dir, ['wait', '--timeout-minutes', '0']);
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain('positive number');
  }, 60_000);

  it('writes a background log the reader can read once, and keeps its log path out of the gate', async () => {
    const dir = checkout(iosOnly);
    const started = runCli(dir, ['check', '--background'], {
      FAKE_SHOW_GATE_LOG_ENV: '1',
    });
    expect(started.status).toBe(0);
    expect(runCli(dir, ['wait', '--gate', 'check']).status).toBe(0);
    const [record] = ledgerLines(dir);
    const log = fs.readFileSync(logFile(dir, record.logPath), 'utf8');
    // N5: a backgrounded run's stdout *is* this file, so echoing there as well as
    // writing the stream duplicates every line for the person who opens it.
    const summaries = log
      .split('\n')
      .filter((entry) => entry.includes('Tests: 391 passed'));
    expect(summaries).toHaveLength(1);
    expect(
      log.split('\n').filter((e) => e.startsWith('fake runner:'))
    ).toHaveLength(1);
    // N6: the gate's own command must not inherit the launcher's log path, or a
    // nested `gate.mjs` would append here and mark this run done with its own code.
    expect(log).toContain('child sees gate-log env [unset]');
  }, 90_000);

  it('passes a filtered run through to the gate, recorded under its own name', async () => {
    const dir = checkout(iosOnly);
    // `--background` sits before the separator and must not reach the gate's own
    // command line: `harness:android --background -- ColdSizing` used to hand the
    // flag to the runner as an argument of its own.
    const started = runCli(dir, [
      'harness:android',
      '--background',
      '--',
      'ColdSizing',
    ]);
    expect(started.status).toBe(0);
    const wait = runCli(dir, ['wait', '--gate', 'harness:android:ColdSizing']);
    expect(wait.status).toBe(0);
    const lines = ledgerLines(dir);
    expect(lines).toHaveLength(1);
    expect(lines[0].gate).toBe('harness:android:ColdSizing');
    // And the *gate process* never saw the flag: the fake runner echoes its own
    // argv into the log, so a leaked `--background` is visible there even though the
    // run still succeeds - which is exactly why the exit code above is not evidence.
    const log = fs.readFileSync(logFile(dir, lines[0].logPath), 'utf8');
    expect(log).toContain('fake runner:');
    expect(log).not.toContain('--background');
    expect(log).toContain('ColdSizing');
  }, 90_000);
});

/**
 * A device gate holds a claim on its lease's devices for the duration of the run (X11), which is
 * what lets the warm pool keep them booted without ever powering one off mid-suite.
 *
 * Checked through the real CLI, because the wiring is the risk: a claim that is never released
 * wedges a device until its pid is noticed as gone, and a claim that is never taken leaves the
 * reaper guessing from timestamps alone. The assertions are on `pool.json` - the file the reaper
 * reads - not on the run's output.
 */
describeCli('gate.mjs claims the device it runs on', () => {
  const IOS_ONLY = {
    'nitrogen/generated/ios/NitroUiAutolinking.swift': '// marker\n',
  };

  const cleanup = [];

  /** A checkout plus a `NITRO_UI_HOME` holding a lease for one pair of devices. */
  function leasedCheckout({ claimedBy = null } = {}) {
    const dir = makeCheckout(IOS_ONLY);
    const home = path.join(dir, 'state');
    fs.mkdirSync(home, { recursive: true });
    if (claimedBy != null) {
      fs.writeFileSync(
        path.join(home, 'pool.json'),
        JSON.stringify(
          {
            version: 1,
            devices: [
              {
                key: 'avd:nitro-ui-a',
                kind: 'android',
                id: 'nitro-ui-a',
                leaseId: 'X11-1',
                serial: 'emulator-5574',
                adbPort: 5043,
                bootedAtMs: Date.now(),
                lastUsedMs: Date.now(),
                idleShutdownMinutes: 30,
                claims: [
                  {
                    // This test process is the one pid a child can be certain is alive.
                    pid: process.pid,
                    id: 'other',
                    gate: claimedBy,
                    at: Date.now(),
                  },
                ],
              },
            ],
          },
          null,
          2
        )
      );
    }
    cleanup.push(dir);
    return {
      dir,
      home,
      env: {
        NITRO_UI_HOME: home,
        NITRO_UI_LEASE_ID: 'X11-1',
        NITRO_UI_LEASE_TASK: 'X11',
        NITRO_UI_LEASE_PLATFORM: 'both',
        IOS_SIM_UDID: 'UDID-A',
        ANDROID_AVD: 'nitro-ui-a',
        EMULATOR_PORT: '5574',
        ANDROID_SERIAL: 'emulator-5574',
        ANDROID_ADB_SERVER_PORT: '5043',
      },
    };
  }

  afterAll(() => {
    for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
  });

  const readPool = (home) => {
    const file = path.join(home, 'pool.json');
    if (!fs.existsSync(file)) return { devices: [] };
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  };

  it('claims the platform it runs on, and releases it when the run ends', async () => {
    const { dir, home, env } = leasedCheckout();
    const run = runCli(dir, ['harness:android'], env);
    expect(run.status).toBe(0);
    expect(run.stderr).toContain('claimed avd:nitro-ui-a');
    // An Android gate claims the emulator only: the simulator behind the same lease stays free
    // for the next task's iOS run.
    const devices = readPool(home).devices;
    expect(devices.map((x) => x.key)).toEqual(['avd:nitro-ui-a']);
    expect(devices[0].serial).toBe('emulator-5574');
    // Released, not merely "the process ended": a claim left behind by a wrapper that exits
    // normally would block the next gate until a reaper noticed the pid was gone.
    expect(devices[0].claims).toEqual([]);
  }, 90_000);

  it('refuses a device another live run holds, before the run starts', async () => {
    const { dir, home, env } = leasedCheckout({
      claimedBy: 'real-input:android',
    });
    const run = runCli(dir, ['harness:android'], env);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('real-input:android');
    expect(run.stderr).toContain('NITRO_UI_GATE_DEVICE_FORCE=1');
    // Nothing recorded: refused *before* the four-minute build, not after it fought over the
    // device, which is the difference between a fast no and a corrupt maybe.
    expect(ledgerLines(dir)).toEqual([]);
    expect(readPool(home).devices[0].claims).toHaveLength(1);
  }, 90_000);

  it('runs anyway under NITRO_UI_GATE_DEVICE_FORCE=1', async () => {
    const { dir, env } = leasedCheckout({ claimedBy: 'real-input:android' });
    const run = runCli(dir, ['harness:android'], {
      ...env,
      NITRO_UI_GATE_DEVICE_FORCE: '1',
    });
    expect(run.status).toBe(0);
    expect(run.stderr).toContain('NITRO_UI_GATE_DEVICE_FORCE=1');
    expect(ledgerLines(dir)).toHaveLength(1);
  }, 90_000);

  /**
   * The claim has to be in the state file *during* the run, not merely before or after it: that
   * window is the only thing the reaper reads, and a claim taken after the run started, or released
   * when the wrapper exited but before the child finished, both look identical to a parent that
   * only asserts at the end (X11 review M7). So the stand-in for the run reads `pool.json` itself.
   */
  it('has the claim live while the run is in flight', async () => {
    const { dir, env } = leasedCheckout();
    const run = runCli(dir, ['harness:android'], {
      ...env,
      FAKE_SHOW_CLAIMS: '1',
    });
    expect(run.status).toBe(0);
    const during = run.stdout.slice(run.stdout.indexOf('claims-during-run:'));
    const claimed = JSON.parse(during.slice(during.indexOf('{')));
    expect(claimed.devices.map((d) => d.key)).toEqual(['avd:nitro-ui-a']);
    const claims = claimed.devices[0].claims;
    expect(claims).toHaveLength(1);
    expect(claims[0].gate).toBe('harness:android');
    // The claim names a pid, which is the whole protocol: a record whose pid has died is read as
    // no claim, so this line is what makes a killed task unable to wedge a device. (That the pool
    // treats a dead pid that way is `device-pool.test.js`'s, with an injected liveness check.)
    expect(typeof claims[0].pid).toBe('number');
    expect(claims[0].pid).toBeGreaterThan(0);
    // And it is gone again once the run is over.
    expect(readPool(path.join(dir, 'state')).devices[0].claims).toEqual([]);
  }, 90_000);

  it('claims nothing when the environment names no lease', async () => {
    // A plain `bun run check` or a CI runner has no lease in its environment, and the claim path
    // must be invisible there rather than half-working off a stale `ANDROID_SERIAL`.
    const dir = makeCheckout(IOS_ONLY);
    cleanup.push(dir);
    const run = runCli(dir, ['check'], {
      NITRO_UI_HOME: path.join(dir, 'state'),
    });
    expect(run.status).toBe(0);
    expect(run.stderr).not.toContain('claimed');
    expect(fs.existsSync(path.join(dir, 'state', 'pool.json'))).toBe(false);
  }, 90_000);
});

/**
 * N4's other half: a task runner or a person that stops `gate.mjs` by PID must
 * not leave a harness holding the leased device. What makes this a forwarding
 * test rather than a "did something die" test is who reports it: the assertion is
 * on the *child's* own output, so a gate.mjs that simply died first (which is what
 * orphaning looks like) goes red.
 */
describeCli(
  'gate.mjs forwards a signal to the gate it started (FOLLOWUPS 57)',
  () => {
    const cleanup = [];
    const IOS_ONLY = {
      'nitrogen/generated/ios/NitroUiAutolinking.swift': '// marker\n',
    };

    afterAll(() => {
      for (const dir of cleanup)
        fs.rmSync(dir, { recursive: true, force: true });
    });

    for (const [signal, trap] of [
      ['SIGINT', 'INT'],
      ['SIGTERM', 'TERM'],
    ]) {
      it(`forwards ${signal} to the running gate, re-raises it, and still writes the ledger`, async () => {
        const dir = makeCheckout(IOS_ONLY);
        cleanup.push(dir);
        const { child, output } = spawnCli(dir, ['check'], { FAKE_TRAP: trap });
        // Attached before anything is waited on: `close` fires once, and under a
        // full-suite load the gate can be gone before its output has been read.
        const ended = closed(child, output, 20_000);
        // Marks the promise handled so a timeout that fires while an earlier
        // `waitUntil` is still polling reports itself at the `await` below rather
        // than as an unhandled rejection that fails an unrelated test.
        ended.catch(() => {});
        // A signal-only kill of this test's own child: the fake runner's shell
        // loops for 300 x 0.1 s, so it stops on its own in 30 s and a mutation
        // cannot leak a live process into the next test. The 20 s budgets below
        // are what actually catch a forwarder that stopped forwarding - by then
        // the child is still running, which is the point.
        try {
          await waitUntil(output, 'fake: ready', 20_000);
          child.kill(signal);
          // The gate itself saying it was signalled. Nothing on the parent's side
          // of the boundary can show this.
          await waitUntil(output, `fake: caught ${trap}`, 20_000);
          const end = await ended;
          // Re-raised on self, so the caller's status still reads "interrupted"
          // rather than a code that hides why the run stopped.
          expect(end.signal).toBe(signal);
          // And the evidence of the run survives an interrupt: one line, saying it
          // did not pass.
          const lines = ledgerLines(dir);
          expect(lines.map((row) => [row.gate, row.result])).toEqual([
            ['check', 'fail'],
          ]);
        } finally {
          child.kill('SIGKILL');
        }
      }, 90_000);
    }
  }
);

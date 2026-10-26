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

import { describe, expect, it } from '@jest/globals';

import {
  LEDGER_VERSION,
  MERGE_GATES,
  decideNeed,
  deviceFromEnv,
  gatesSeen,
  gateStateFor,
  ledgerFileName,
  ledgerLineFromRun,
  ledgerRelativePath,
  latestByGate,
  parseLedger,
  parseTestCounts,
  platformsTouchedByPaths,
  renderGateTable,
  requiredGatesFor,
  resolveGate,
  summarizeGates,
  summarizeLoad,
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
}) {
  return ledgerLineFromRun({
    gate,
    command: `bun run ${gate}`,
    tree,
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
    expect(gateStateFor(undefined, TREE_A).state).toBe('missing');
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
    expect(gateStateFor(line({ gate: 'check' }), TREE_A).state).toBe('green');
    expect(
      gateStateFor(line({ gate: 'check', tree: TREE_B }), TREE_A).state
    ).toBe('stale');
    expect(
      gateStateFor(line({ gate: 'check', result: 'fail' }), TREE_A).state
    ).toBe('red');
    // A red on the current tree stays red even if an older run was green: the
    // newest word on the tree is the one a reader needs.
    expect(
      gateStateFor(
        latestByGate([
          line({ gate: 'check' }),
          line({ gate: 'check', result: 'fail' }),
        ]).check,
        TREE_A
      ).state
    ).toBe('red');
    expect(gateStateFor(undefined, TREE_A).state).toBe('missing');
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
      codeTree: TREE_A,
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
    });
    expect(platformsTouchedByPaths(['ios/ui/Switch.swift'])).toEqual({
      platforms: ['ios'],
      unmapped: [],
    });
    for (const shared of [
      'cpp/ui/Switch.cpp',
      'src/index.ts',
      'nitrogen/generated/ios/X.swift',
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
    ).toEqual({ platforms: [], unmapped: [] });
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
      codeTree: TREE_A,
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
      codeTree: TREE_A,
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
      codeTree: TREE_A,
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
      codeTree: TREE_B,
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
      codeTree: TREE_A,
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
      codeTree: TREE_A,
      stage: 'merge',
    });
    expect(merge.ok).toBe(false);
    expect(merge.missing).toEqual(['real-input:ios', 'real-input:android']);

    const complete = decideNeed({
      entries: MERGE_GATES.map((gate) => line({ gate })),
      codeTree: TREE_A,
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
        codeTree: TREE_A,
        stage,
        touchedPlatforms: ['ios', 'android'],
      });
      expect(
        decision.required.some((row) => row.gate.startsWith('bench'))
      ).toBe(false);
    }
    expect(
      decideNeed({ entries, codeTree: TREE_A, stage: 'merge' }).missing
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
      codeTree: TREE_A,
      stage: 'review',
      touchedPlatforms: ['android'],
    });
    expect(decision.missing).toEqual(['harness:android']);
  });

  it('says when it could not read the diff instead of asking for nothing', () => {
    const decision = decideNeed({
      entries: [line({ gate: 'check' })],
      codeTree: TREE_A,
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
      codeTree: TREE_A,
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
      codeTree: TREE_A,
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
      codeTree: TREE_A,
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
      codeTree: TREE_A,
    });
    expect(plain).not.toContain('.gates/logs');
    const full = renderGateTable({
      entries: [line({ gate: 'check' })],
      codeTree: TREE_A,
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

  it('keeps the last summary when a gate printed several', () => {
    // `check` runs jest, then perf, then more jest; the summary it exited on is
    // the one that describes the result being recorded.
    expect(
      parseTestCounts(
        'Tests: 344 passed, 344 total\nTests: 12 passed, 12 total'
      ).tests.total
    ).toBe(12);
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
      argv: ['node', 'scripts/harness.mjs', '--harnessRunner', 'android'],
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
      'scripts/harness.mjs',
      '--harnessRunner',
      'android',
      'ColdSizing',
    ]);
    expect(resolveGate('harness:ios', ['ColdSizing']).argv.slice(4)).toEqual([
      'ColdSizing',
    ]);
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

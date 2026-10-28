/**
 * A missing sample has to say why, and a comparison arm's gap must not veto a machine.
 *
 * Two related things went wrong in A3's iOS mint, and both are fixed here:
 *
 * 1. **A null carried no evidence.** `missingPresented: 105` said how many presenting
 *    frames never arrived and nothing about why, so the refusal ("55 of 160 samples")
 *    could not be told apart from a probe that had stopped answering at all, and the
 *    investigation had to be re-instrumented from scratch. Every missing signal now
 *    rides a per-iteration reason (`probe-timeout` / `not-awaited` / `probe-error`,
 *    with the wait and the timeout in force), it is tallied per cell, it is printed in
 *    the report, and the mint's refusal quotes it.
 * 2. **A reference arm's gap refused a whole baseline.** `mount.date-picker` N=200 on
 *    the two `@expo/ui` arms was incomplete, and `baselineBlockers()` refused the
 *    entire table - including 150-odd nitro-ui rows that were perfectly measured. D9's
 *    A4 amendment leaves such a cell out and records it; `nitro-ui` (gated) and
 *    `rn-core` (every ratio's denominator) still refuse the mint.
 *
 * `bench/src/plan.ts` owns the timeouts the app waits with, and `scripts/bench/lib.mjs`
 * owns the rule a baseline is minted under. They cannot import each other, so the last
 * suite pins the numbers together - a drift there means a mint is refused for a wait
 * nobody asked for, or accepted for a rule it was not recorded under.
 */

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  BASELINE_MOUNT_TIMEOUT_MS,
  BASELINE_PRESENTED_TIMEOUT_MS,
  COMPARISON_IMPLEMENTATIONS,
  MAX_MISSING_SAMPLE_RATIO,
  MAX_REQUESTED_TIMEOUT_MS,
  aggregateRecords,
  baselineBlockers,
  buildBaseline,
  buildSchedule,
  cellKey,
  describeMissing,
  incompleteMetrics,
  launchBudgetMs,
  launchPlanString,
  parseTimeoutFlags,
  requestedTimeouts,
  skippedCellNotes,
  summarizeMissingReasons,
} from '../bench/lib.mjs';
// The bench app's plan parser is pure TypeScript over types only (no native imports),
// so it can be imported here rather than grepped. That makes the round trip below -
// `launchPlanString` in, `parsePlan` out - a real check of the launch flag.
import {
  DEFAULT_MOUNT_TIMEOUT_MS as APP_DEFAULT_MOUNT_TIMEOUT_MS,
  DEFAULT_PRESENTED_TIMEOUT_MS as APP_DEFAULT_PRESENTED_TIMEOUT_MS,
  MAX_TIMEOUT_MS as APP_MAX_TIMEOUT_MS,
  parsePlan,
} from '../../bench/src/plan';
import { detailSections } from '../bench/render.mjs';

const LAUNCHES = 4;
const ITERATIONS = 20;
const QUIET = [1, 1.01, 0.995, 1.005];

/**
 * Records for one cell, with `missingPresented`/`missingMount` iterations whose null
 * carries a reason - the shape `bench/src/runner.ts` writes.
 *
 * `reason` is what the probe answered with, not what the test believes: a fixture can
 * claim `probe-error` and the aggregation has to report exactly that, which is how the
 * "73 timeouts vs 73 probe errors" distinction gets proven without a device.
 */
function cellRecords({
  scenario = 'mount',
  implementation,
  n = 50,
  jsCommit = 40_000,
  mounted = 100_000,
  presented = 130_000,
  jsCpuPerOp = 20_000,
  mainCpuPerOp = 15_000,
  unmountMainCpuPerOp = 8_000,
  missingPresented = 0,
  missingMount = 0,
  reason = 'probe-timeout',
  presentedTimeoutMs = BASELINE_PRESENTED_TIMEOUT_MS,
  mountTimeoutMs = BASELINE_MOUNT_TIMEOUT_MS,
  mountSignal = true,
}) {
  const records = [
    {
      kind: 'meta',
      scenario,
      implementation,
      n,
      launch: 0,
      warmup: 0,
      measured: ITERATIONS,
      platform: 'ios 27.0',
      probeClock: 'CLOCK_UPTIME_RAW',
      mountSignal,
      mountTimeoutMs,
      presentedTimeoutMs,
    },
  ];

  for (let launch = 0; launch < LAUNCHES; launch++) {
    const factor = QUIET[launch % QUIET.length];
    for (let index = 0; index < ITERATIONS; index++) {
      const wiggle = 1 + 0.002 * ((index % 5) - 2);
      const lostMount = index < missingMount;
      const lostPresented = index < missingPresented;
      const awaited = mountSignal;
      const missing = [];
      if (lostMount) {
        missing.push({
          metric: 'mountedNs',
          reason: awaited ? reason : 'not-awaited',
          waitedMs: awaited ? mountTimeoutMs + 0.4 : 0,
          timeoutMs: mountTimeoutMs,
        });
      }
      if (lostPresented) {
        missing.push({
          metric: 'presentedNs',
          reason: awaited ? reason : 'not-awaited',
          waitedMs: awaited ? presentedTimeoutMs + 0.4 : 0,
          timeoutMs: presentedTimeoutMs,
        });
      }
      records.push({
        kind: 'iter',
        scenario,
        implementation,
        n,
        launch,
        index,
        warmup: false,
        jsCommitNs: jsCommit * factor * wiggle,
        mountedNs: lostMount ? null : mounted * factor * wiggle,
        presentedNs: lostPresented ? null : presented * factor * wiggle,
        ...(missing.length > 0 ? { missing } : {}),
      });
    }
    records.push({
      kind: 'cpu',
      scenario,
      implementation,
      n,
      launch,
      phase: 'mount',
      iterations: ITERATIONS,
      jsCpuNs: jsCpuPerOp * factor * ITERATIONS,
      mainCpuNs: mainCpuPerOp * factor * ITERATIONS,
    });
    records.push({
      kind: 'cpu',
      scenario,
      implementation,
      n,
      launch,
      phase: 'unmount',
      iterations: ITERATIONS,
      jsCpuNs: jsCpuPerOp * factor * ITERATIONS * 0.2,
      mainCpuNs: unmountMainCpuPerOp * factor * ITERATIONS,
    });
  }
  return records;
}

/** One memory cell per arm, so a mint has a `memory` row and the ratios have denominators. */
function memoryRecords({ implementation, n = 200, perInstance = 40_000 }) {
  const empty = 120_000_000;
  const records = [
    {
      kind: 'meta',
      scenario: 'memory',
      implementation,
      n,
      launch: 0,
      warmup: 0,
      measured: 0,
      platform: 'ios 27.0',
      probeClock: 'CLOCK_UPTIME_RAW',
      mountSignal: true,
    },
  ];
  for (let launch = 0; launch < LAUNCHES; launch++) {
    records.push({
      kind: 'mem',
      scenario: 'memory',
      implementation,
      n,
      launch,
      phase: 'empty',
      footprintBytes: empty,
      heapCollected: true,
    });
    records.push({
      kind: 'mem',
      scenario: 'memory',
      implementation,
      n,
      launch,
      phase: 'full',
      footprintBytes: empty + perInstance * n,
      heapCollected: true,
    });
  }
  return records;
}

const ARMS = {
  'rn-core': { mounted: 100_000 },
  'expo-ui-host-per-control': { mounted: 210_000 },
  'expo-ui-shared-host': { mounted: 80_000 },
  'nitro-ui': { mounted: 110_000 },
};

/**
 * A whole mintable run, with one arm's `mount` cell optionally gutted.
 *
 * The gap defaults to the A3 shape: 12 of 80 measured iterations without a presenting
 * frame, which is over the 10 % budget (`MAX_MISSING_SAMPLE_RATIO`) and therefore
 * incomplete. The arm is a parameter because which arm it is decides everything.
 */
function mintableRun({ gapOn = null, reason = 'probe-timeout' } = {}) {
  const records = [];
  for (const [implementation, values] of Object.entries(ARMS)) {
    records.push(
      ...cellRecords({
        implementation,
        ...values,
        // 3 of 20 iterations per launch = 12 of the cell's 80: A3's shape (105 of 160)
        // at this fixture's size, and just over the 10 % budget.
        ...(implementation === gapOn ? { missingPresented: 3, reason } : {}),
      })
    );
    records.push(...memoryRecords({ implementation }));
  }
  return {
    platform: 'ios',
    deviceKey: 'ios27-sim-testdevice',
    deviceName: 'nitro-ui A',
    sha: 'abc1234',
    dirty: false,
    plan: 'full',
    launches: 8,
    perfMarks: false,
    createdAt: '2026-10-28T00:00:00.000Z',
    machine: { cpuCount: 10, loadavg1: 1.5 },
    problems: [],
    cells: aggregateRecords(records, { keepRaw: true }),
  };
}

describe('why a sample is missing is recorded, per iteration', () => {
  it('tallies the reasons a cell lost its signals for, with the waits', () => {
    const run = mintableRun({ gapOn: 'expo-ui-shared-host' });
    const cell = run.cells['mount:expo-ui-shared-host:50'];
    expect(incompleteMetrics(cell)).toEqual([
      { metric: 'presentedNs', samples: 68, expected: 80 },
    ]);
    expect(cell.missing).toEqual({
      presentedNs: {
        total: 12,
        byReason: {
          'probe-timeout': {
            count: 12,
            // 2000 + 0.4 rounds to 2000.4: the wait really did run to the timeout.
            maxWaitedMs: 2000.4,
            timeoutMs: [2000],
            details: undefined,
          },
        },
      },
    });
    // The reason tally and the sanity counter describe the same iterations.
    expect(cell.sanity.missingPresented).toBe(12);
  });

  it('keeps a probe error apart from a timeout, and keeps its message', () => {
    const run = mintableRun({ gapOn: 'nitro-ui', reason: 'probe-error' });
    const cell = run.cells['mount:nitro-ui:50'];
    expect(cell.missing.presentedNs.byReason['probe-error']).toMatchObject({
      count: 12,
    });
    expect(cell.missing.presentedNs.byReason['probe-timeout']).toBeUndefined();
  });

  it('calls an un-awaited signal what it is, not a timeout', () => {
    // `mountSignal: false` never asked the probe, so the runner must not let 80
    // by-construction nulls read as 80 timeouts.
    const cells = aggregateRecords(
      cellRecords({
        implementation: 'nitro-ui',
        // 5 per launch = 20 of the cell's 80 iterations, none of them asked for.
        missingPresented: 5,
        mountSignal: false,
      })
    );
    const cell = cells['mount:nitro-ui:50'];
    expect(cell.missing.presentedNs.byReason).toEqual({
      'not-awaited': {
        count: 20,
        maxWaitedMs: 0,
        timeoutMs: [2000],
        details: undefined,
      },
    });
  });

  it('adds a fixed null to a cell where every signal arrived', () => {
    const cells = aggregateRecords(
      cellRecords({ implementation: 'nitro-ui' }),
      { keepRaw: true }
    );
    const cell = cells['mount:nitro-ui:50'];
    expect(cell.missing).toBeNull();
    // Compactness is the whole point of keeping the reason per iteration rather than a
    // transcript: the summary column costs a fixed `"missing":null` on a healthy cell
    // and a per-reason tally on an unhealthy one - never a row per iteration.
    expect(JSON.stringify({ missing: null })).toBe('{"missing":null}');
    const gap = aggregateRecords(
      cellRecords({ implementation: 'nitro-ui', missingPresented: 3 })
    )['mount:nitro-ui:50'];
    expect(JSON.stringify(gap.missing).length).toBeLessThan(200);
  });

  it('keeps a healthy iteration record the size it was, and a gap short', () => {
    // The per-iteration record is what multiplies: 25 iterations x 8 launches x every
    // cell of the plan. Nothing is added unless something went missing, and one
    // reason stays short enough that even a gutted cell is noise in the file.
    const healthy = {
      kind: 'iter',
      scenario: 'mount.date-picker',
      implementation: 'expo-ui-shared-host',
      n: 200,
      launch: 3,
      index: 17,
      warmup: false,
      jsCommitNs: 40000,
      mountedNs: 100000,
      presentedNs: 130000,
    };
    const size = (record) => JSON.stringify(record).length;
    expect(healthy.missing).toBeUndefined();
    expect(size(healthy)).toBe(189);

    const gap = {
      ...healthy,
      presentedNs: null,
      missing: [
        {
          metric: 'presentedNs',
          reason: 'probe-timeout',
          waitedMs: 2000.4,
          timeoutMs: 2000,
        },
      ],
    };
    const extra = size(gap) - size(healthy);
    // 95 bytes on a 189-byte record, and only on the iterations that lost a signal. A
    // full plan (`--plan full --launches 8`) is ~150k iteration records, so a run where
    // nothing goes missing gains exactly nothing, and a run shaped like A3's iOS mint
    // (~180 gaps in its worst two cells) gains ~17 kB on a ~1.5 MB file: ~1 %.
    expect(extra).toBe(95);
    expect(gap.missing[0].reason).toBe('probe-timeout');
  });

  it('counts the reasons for one launch, for the run progress line', () => {
    // One launch's records, as `drive()` hands them to `summarize`.
    const launch = cellRecords({
      implementation: 'expo-ui-shared-host',
      missingPresented: 3,
      missingMount: 1,
    }).filter((record) => record.launch === 0);
    expect(summarizeMissingReasons(launch)).toBe(
      '1 mounted probe-timeout (1500 ms), 3 presented probe-timeout (2000 ms)'
    );
    // Nothing missing: the line stays exactly as short as it was before A4.
    expect(
      summarizeMissingReasons(
        cellRecords({ implementation: 'nitro-ui' }).filter(
          (record) => record.launch === 0
        )
      )
    ).toBe('');
    // Warmups are excluded, so the counts line up with the iteration count printed
    // in front of them.
    const withWarmups = [
      ...cellRecords({ implementation: 'nitro-ui' }),
      {
        kind: 'iter',
        scenario: 'mount',
        implementation: 'nitro-ui',
        n: 50,
        launch: 4,
        index: 0,
        warmup: true,
        jsCommitNs: 1,
        mountedNs: null,
        presentedNs: null,
        missing: [
          {
            metric: 'presentedNs',
            reason: 'probe-timeout',
            waitedMs: 2000.4,
            timeoutMs: 2000,
          },
        ],
      },
    ];
    expect(summarizeMissingReasons(withWarmups)).toBe('');
  });

  it('prints the reasons in the cell detail, per signal', () => {
    const run = mintableRun({ gapOn: 'expo-ui-shared-host' });
    const detail = detailSections(run);
    expect(detail).toContain('Missing samples:');
    expect(detail).toContain('12 probe-timeout (asked 2000 ms');
    expect(detail).toContain('which launch, which iteration');
  });

  it('describes a pre-A4 gap as having no reason, rather than as none missing', () => {
    const lines = describeMissing({
      missing: { presentedNs: { total: 45, byReason: {} } },
    });
    expect(lines).toEqual([
      'presentedNs: 45 missing, no reason recorded (a results file from before A4)',
    ]);
  });

  it('stamps the waiting rule on the run and on the cell', () => {
    const cells = aggregateRecords(
      cellRecords({
        implementation: 'nitro-ui',
        presentedTimeoutMs: 40_000,
      })
    );
    expect(cells['mount:nitro-ui:50'].timeouts).toEqual({
      mountTimeoutMs: 1500,
      presentedTimeoutMs: 40_000,
    });
    expect(requestedTimeouts({ cells })).toEqual({
      mountTimeoutMs: 1500,
      presentedTimeoutMs: 40_000,
    });
  });
});

describe("the comparison-cell rule (D9's A4 amendment)", () => {
  it('leaves a comparison arm with an incomplete metric out of the baseline', () => {
    const run = mintableRun({ gapOn: 'expo-ui-shared-host' });
    expect(baselineBlockers(run)).toEqual([]);

    const baseline = buildBaseline(run);
    expect(Object.keys(baseline.cells)).not.toContain(
      'mount:expo-ui-shared-host:50'
    );
    const skipped = baseline.skippedCells['mount:expo-ui-shared-host:50'];
    expect(skipped).toMatchObject({
      scenario: 'mount',
      implementation: 'expo-ui-shared-host',
      n: 50,
      skipReason: 'presentedNs incomplete',
    });
    // Names the metric, its sample counts, and the reasons that were recorded.
    expect(skipped.skipReasons).toEqual([
      'presentedNs: 68 of 80 samples arrived - presentedNs: 12 probe-timeout (asked 2000 ms, waited up to 2000.4 ms)',
    ]);
    // Every other cell of that arm is still there, and so is every nitro-ui row.
    expect(Object.keys(baseline.cells)).toContain(
      'memory:expo-ui-shared-host:200'
    );
    expect(Object.keys(baseline.cells)).toContain('mount:nitro-ui:50');
    // A left-out cell carries no ratios at all, not a survivor-biased one.
    expect(JSON.stringify(baseline.skippedCells)).not.toContain('launchRatios');
  });

  it('refuses a nitro-ui gap, because that is the gated arm', () => {
    const reasons = baselineBlockers(mintableRun({ gapOn: 'nitro-ui' }));
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('gated metric(s) are n/a because too few');
    expect(reasons[0]).toContain('mount:nitro-ui:50 presentedNs (68 of 80');
  });

  it('refuses an rn-core gap, because it is every ratio denominator', () => {
    const reasons = baselineBlockers(mintableRun({ gapOn: 'rn-core' }));
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('mount:rn-core:50 presentedNs');
  });

  it('points the refusal at where the per-iteration detail lives', () => {
    const reasons = baselineBlockers(mintableRun({ gapOn: 'nitro-ui' }));
    expect(reasons[0]).toContain('probe-timeout');
    expect(reasons[0]).toContain('asked 2000 ms');
    expect(reasons[0]).toContain('results file');
    expect(reasons[0]).toContain('.ndjson');
  });

  it('treats every non-gated, non-control arm as a comparison arm', () => {
    expect(COMPARISON_IMPLEMENTATIONS).toEqual([
      'expo-ui-host-per-control',
      'expo-ui-shared-host',
      'nitro-ui-host',
    ]);
  });

  it('mints with nothing left out when every signal arrived', () => {
    const baseline = buildBaseline(mintableRun());
    expect(baseline.skippedCells).toEqual({});
    expect(Object.keys(baseline.cells)).toHaveLength(8);
    // So a clean mint prints nothing about left-out cells, and its output does not grow
    // a section nobody asked for.
    expect(
      skippedCellNotes(baseline, { display: 'bench/baselines/x/y.json' })
    ).toEqual([]);
  });

  it('prints the left-out cells, and says where the details live', () => {
    const lines = skippedCellNotes(
      buildBaseline(mintableRun({ gapOn: 'expo-ui-shared-host' })),
      {
        display: 'bench/baselines/maintainer-mac-2/ios27-sim-iphone17.json',
      }
    );
    expect(lines[0]).toContain(
      'Left out of the baseline: 1 comparison-arm cell(s)'
    );
    expect(lines[1]).toContain(
      'mount:expo-ui-shared-host:50: presentedNs: 68 of 80 samples arrived'
    );
    expect(lines[1]).toContain('12 probe-timeout (asked 2000 ms');
    expect(lines.at(-1)).toContain(
      '`bench/baselines/maintainer-mac-2/ios27-sim-iphone17.json` -> `skippedCells`'
    );
    expect(lines.at(-1)).toContain('cells -> `missing`');
  });

  it('refuses a run that waited longer than the rule the baseline records', () => {
    const runWith = (presentedTimeoutMs) => {
      const run = mintableRun();
      for (const cell of Object.values(run.cells)) {
        cell.timeouts = {
          mountTimeoutMs: BASELINE_MOUNT_TIMEOUT_MS,
          presentedTimeoutMs,
        };
      }
      return run;
    };
    // One millisecond over the rule already changes which samples arrive, so the
    // boundary is the rule - a guard weakened by a factor of ten would pass a
    // 6-second wait and mint a table whose `presented` column means something else.
    const reasons = baselineBlockers(runWith(6_000));
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('waited longer for a signal than a baseline');
    expect(reasons[0]).toContain('6000 ms presented');
    expect(baselineBlockers(runWith(BASELINE_PRESENTED_TIMEOUT_MS))).toEqual(
      []
    );
    // Same on the mount side, and the diagnostic flag is what reaches here.
    const mounted = mintableRun();
    for (const cell of Object.values(mounted.cells)) {
      cell.timeouts = { mountTimeoutMs: 1501, presentedTimeoutMs: 2000 };
    }
    expect(baselineBlockers(mounted)[0]).toContain('1501 ms mount');
  });

  it('records the rule it was minted under in the file', () => {
    // 1000 ms is *under* the rule, so the run may mint - and the file has to say which
    // rule its `presented` column was measured under, rather than the default.
    const run = mintableRun();
    for (const cell of Object.values(run.cells)) {
      cell.timeouts = { mountTimeoutMs: 1500, presentedTimeoutMs: 1000 };
    }
    expect(baselineBlockers(run)).toEqual([]);
    expect(buildBaseline(run).timeouts).toEqual({
      mountTimeoutMs: 1500,
      presentedTimeoutMs: 1000,
    });
    // A results file from before the flag recorded nothing, and gets the default.
    const before = mintableRun();
    for (const cell of Object.values(before.cells)) {
      delete cell.timeouts;
    }
    expect(baselineBlockers(before)).toEqual([]);
    expect(buildBaseline(before).timeouts).toEqual({
      mountTimeoutMs: BASELINE_MOUNT_TIMEOUT_MS,
      presentedTimeoutMs: BASELINE_PRESENTED_TIMEOUT_MS,
    });
  });
});

describe('the per-launch budget follows the requested waits', () => {
  const entry = (extra) => ({
    scenario: 'mount.date-picker',
    implementation: 'expo-ui-shared-host',
    n: 200,
    launch: 0,
    ...extra,
  });

  it('leaves the default run at the table value', () => {
    expect(launchBudgetMs(entry({}))).toBe(180_000);
    expect(launchBudgetMs(entry({ presentedTimeoutMs: 2000 }))).toBe(180_000);
  });

  it('grows by the extra wait for every iteration of the launch', () => {
    // 25 iterations x (40 000 - 2 000) extra = 950 000 ms on top of the 180 000 budget.
    // Without this a diagnostic run is killed as "stalled" for waiting on purpose, and a
    // killed launch becomes a `problem` - which is also a mint refusal.
    expect(launchBudgetMs(entry({ presentedTimeoutMs: 40_000 }))).toBe(
      180_000 + 25 * 38_000
    );
    // A mount wait counts twice per iteration (`mount` waits for its own signal and
    // again in the teardown), so both additions have to show up.
    expect(
      launchBudgetMs(
        entry({ mountTimeoutMs: 5_000, presentedTimeoutMs: 40_000 })
      )
    ).toBe(180_000 + 25 * (2 * 3_500 + 38_000));
  });

  it('keeps the leak budget the largest, and honours an explicit override', () => {
    expect(
      launchBudgetMs(
        entry({ scenario: 'leak.date-picker', presentedTimeoutMs: 40_000 })
      )
    ).toBe(300_000 + 25 * 38_000);
    // `BENCH_LAUNCH_TIMEOUT_S` is set by hand precisely to decide this question, so when
    // it is present `run.mjs` has already rewritten the whole table to it and the
    // requested waits must not add anything on top.
    expect(
      launchBudgetMs(entry({ presentedTimeoutMs: 40_000 }), {
        scenarioBudgets: {
          mount: 600_000,
          update: 600_000,
          memory: 600_000,
          leak: 600_000,
        },
        overrideSeconds: 600,
      })
    ).toBe(600_000);
  });
});

describe('the timeout flags', () => {
  const readFlag = (name) => (name === '--timeout-presented' ? '40000' : null);

  it('accepts a value inside the native backstop', () => {
    expect(
      parseTimeoutFlags(['--timeout-presented', '40000'], readFlag)
    ).toEqual({
      mountTimeoutMs: null,
      presentedTimeoutMs: 40_000,
      problem: null,
    });
  });

  it('refuses a non-number and a value past the native ceiling', () => {
    for (const value of ['abc', '0', '-5', '90000']) {
      const out = parseTimeoutFlags(
        ['--timeout-presented', value],
        () => value
      );
      expect(out.problem).toContain('--timeout-presented must be a number');
      expect(out.presentedTimeoutMs).toBeNull();
    }
  });

  it('puts a requested timeout on the launch string, and leaves a default off it', () => {
    expect(
      launchPlanString({
        scenario: 'mount.date-picker',
        implementation: 'expo-ui-shared-host',
        n: 200,
        launch: 0,
      })
    ).toBe('mount.date-picker:expo-ui-shared-host:200');
    expect(
      launchPlanString({
        scenario: 'mount.date-picker',
        implementation: 'expo-ui-shared-host',
        n: 200,
        launch: 0,
        perfMarks: true,
        presentedTimeoutMs: 40_000,
      })
    ).toBe(
      'mount.date-picker:expo-ui-shared-host:200:marks,presentedTimeout=40000'
    );
  });

  it('round-trips the launch string into the app plan, and back to the cell', () => {
    // The runner writes the flag, the app reads it, and both sides must agree on the
    // cell. If the app silently ignored the flag, every sample of a diagnostic run would
    // be recorded as a 2 s timeout while the run's own header claimed 40 s.
    const entry = {
      scenario: 'mount.date-picker',
      implementation: 'expo-ui-shared-host',
      n: 200,
      launch: 2,
      perfMarks: true,
      mountTimeoutMs: 4_000,
      presentedTimeoutMs: 40_000,
    };
    const asString = launchPlanString(entry);
    const parsed = parsePlan(asString);
    if (parsed == null) {
      throw new Error(`the app reads ${asString} as an unconfigured launch`);
    }
    expect(parsed).toMatchObject({
      scenario: 'mount.date-picker',
      implementation: 'expo-ui-shared-host',
      n: 200,
      perfMarks: true,
      mountTimeoutMs: 4_000,
      presentedTimeoutMs: 40_000,
      // A cell key never learns about the flags, so a diagnostic run lands in the same
      // rows as a normal one.
      mountSignal: true,
    });
    expect(cellKey(parsed.scenario, parsed.implementation, parsed.n)).toBe(
      cellKey(entry.scenario, entry.implementation, entry.n)
    );

    // No flags: the app waits by the defaults, and the string is unchanged from before
    // A4 (old results-file names and the app's own idle-screen parse stay valid).
    const plain = parsePlan(
      launchPlanString({
        ...entry,
        perfMarks: false,
        mountTimeoutMs: undefined,
        presentedTimeoutMs: undefined,
      })
    );
    expect(plain?.mountTimeoutMs).toBe(APP_DEFAULT_MOUNT_TIMEOUT_MS);
    expect(plain?.presentedTimeoutMs).toBe(APP_DEFAULT_PRESENTED_TIMEOUT_MS);
  });

  it('rejects a malformed timeout flag loudly, in the app too', () => {
    // The runner validates `--timeout-*`, but the launch string is the contract, and a
    // typo there must not quietly mean "use the default" - that is the failure mode A4 is
    // chasing (a wait nobody asked for, recorded as if it had been).
    for (const bad of [
      'mount:rn-core:50:presentedTimeout=abc',
      'mount:rn-core:50:presentedTimeout=',
      'mount:rn-core:50:presentedTimeout=0',
      'mount:rn-core:50:presentedTimeout=900000',
      'mount:rn-core:50:presentedTimeout=1000,2000',
      'mount:rn-core:50:madeUpTimeout=1000',
    ]) {
      expect(() => parsePlan(bad)).toThrow(/NITRO_BENCH plan/);
    }
    // A bare `marks` still parses, and so does a valid combination of all three.
    expect(parsePlan('mount:rn-core:50:marks')?.perfMarks).toBe(true);
    expect(
      parsePlan(
        'mount:rn-core:50:marks,mountTimeout=2000,presentedTimeout=30000'
      )?.presentedTimeoutMs
    ).toBe(30_000);
  });
});

describe('the app really records the reasons the aggregator reads', () => {
  /**
   * Text scans, not imports: `bench/src/*.ts` is a React Native app that this jest
   * config cannot render (it needs Nitro and the native probe), which is the same reason
   * `component-coverage.test.js` scans the bench arms. What a scan can prove - and what
   * actually breaks - is that the two halves still speak: the aggregator counts reasons
   * by name, so an app that stops emitting `missing`, or renames a code, silently turns
   * every future gap into "no reason recorded" and A4's evidence disappears.
   */
  const source = (file) =>
    readFileSync(resolve(process.cwd(), 'bench/src', file), 'utf8');
  const app = source('runner.ts');
  const types = source('types.ts');

  it('emits a reason per missing signal, per iteration', () => {
    expect(app).toMatch(/const missing: MissingSample\[\] = \[\]/);
    expect(app).toMatch(
      /\.\.\.\(missing\.length > 0 \? \{ missing \} : \{\}\)/
    );
    expect(app).toMatch(/mountedNs: mountedWait\?\.stamp == null \? null/);
    expect(app).toMatch(
      /presentedNs:\s*presentedWait\?\.stamp == null \? null/
    );
  });

  it('names every reason code the aggregator knows', () => {
    const codes = /export type MissingSampleReason =([\s\S]*?);/.exec(types);
    if (codes == null) {
      throw new Error(
        'bench/src/types.ts does not declare MissingSampleReason'
      );
    }
    const declared = [...codes[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(declared.sort()).toEqual([
      'not-awaited',
      'probe-error',
      'probe-timeout',
    ]);
    // `describeMissing` prints whatever it is handed, so the risk is one side adding a
    // code the other never mentions: the tally still counts it, the prose lies about it.
    // The runner must be able to produce all three (timeout + error from the probe, and
    // `not-awaited` for a cell that never asked).
    expect(app).toContain("'not-awaited'");
    expect(app).toContain('wait.reason');
    // ...and the aggregation side must not have a hardcoded branch that leaves one out.
    const lib = readFileSync(
      resolve(process.cwd(), 'scripts/bench/lib.mjs'),
      'utf8'
    );
    // The aggregator groups by whatever string it is handed and never lists the codes,
    // so there is nothing to assert except that no hardcoded branch was added.
    expect(lib).not.toMatch(/reason === ['"]probe-timeout['"]/);
  });

  it("waits with the plan's timeouts, not the module defaults", () => {
    // The launch flag is the whole diagnostic, so if the waits silently fall back to the
    // defaults the recorded `asked 2000 ms` would be a lie.
    expect(app).toMatch(/awaitMountStamp\(target\.plan\.mountTimeoutMs\)/);
    expect(app).toMatch(
      /awaitPresentedStamp\(target\.plan\.presentedTimeoutMs\)/
    );
    expect(app).toMatch(/awaitMountNs\(target\.plan\.mountTimeoutMs\)/);
    expect(types).toMatch(/mountTimeoutMs: number/);
    expect(types).toMatch(/presentedTimeoutMs: number/);
  });
});

describe('the two ends of the timeout rule agree', () => {
  it('waits by the same defaults the baseline is minted under', () => {
    expect(APP_DEFAULT_MOUNT_TIMEOUT_MS).toBe(BASELINE_MOUNT_TIMEOUT_MS);
    expect(APP_DEFAULT_PRESENTED_TIMEOUT_MS).toBe(
      BASELINE_PRESENTED_TIMEOUT_MS
    );
  });

  it('caps a requested wait below the native backstop on both platforms', () => {
    expect(APP_MAX_TIMEOUT_MS).toBe(MAX_REQUESTED_TIMEOUT_MS);
    const ios = readFileSync(
      resolve(
        process.cwd(),
        'bench/modules/bench-probe/ios/HybridBenchProbe.mm'
      ),
      'utf8'
    );
    const android = readFileSync(
      resolve(
        process.cwd(),
        'bench/modules/bench-probe/android/src/main/java/com/margelo/nitro/benchprobe/HybridBenchProbe.kt'
      ),
      'utf8'
    );
    const iosCeiling = Number(
      /kBenchPresentationCeilingSeconds = ([0-9.]+)/.exec(ios)[1]
    );
    const androidCeiling = Number(
      /PRESENTATION_CEILING_MS = ([0-9_]+)L/.exec(android)[1].replace(/_/g, '')
    );
    expect(MAX_REQUESTED_TIMEOUT_MS).toBeLessThan(iosCeiling * 1000);
    expect(MAX_REQUESTED_TIMEOUT_MS).toBeLessThan(androidCeiling);
    // Two ceilings that disagree would make one platform's long wait a timeout and the
    // other's a sample - the same class of bug A4 is chasing on one platform.
    expect(iosCeiling * 1000).toBe(androidCeiling);
    // And the cap has to be generous enough to be worth asking for: 20x the default
    // presented wait, so a 40 s arm is comfortably inside what can be requested.
    expect(MAX_REQUESTED_TIMEOUT_MS).toBeGreaterThanOrEqual(
      20 * BASELINE_PRESENTED_TIMEOUT_MS
    );
  });
});

describe('the completeness budget itself is unchanged', () => {
  it('still calls 10 % of 80 samples the boundary it was', () => {
    expect(MAX_MISSING_SAMPLE_RATIO).toBe(0.1);
    // 8 of 80 missing is exactly the 10 % allowance; the next iteration is over it.
    for (const [missingPerLaunch, gapExpected] of [
      [2, false],
      [3, true],
    ]) {
      const cells = aggregateRecords(
        cellRecords({
          implementation: 'expo-ui-shared-host',
          missingPresented: missingPerLaunch,
        })
      );
      const cell = cells['mount:expo-ui-shared-host:50'];
      expect({
        missing: missingPerLaunch * LAUNCHES,
        incomplete: incompleteMetrics(cell).length > 0,
      }).toEqual({
        missing: missingPerLaunch * LAUNCHES,
        incomplete: gapExpected,
      });
    }
  });
});

describe('a scheduled launch carries its timeouts', () => {
  it('keys a timeout-carrying launch as the same cell as a plain one', () => {
    const scheduled = buildSchedule({
      plan: 'quick',
      launches: 1,
      only: 'expo-ui-shared-host',
      presentedTimeoutMs: 40_000,
    });
    const plain = buildSchedule({
      plan: 'quick',
      launches: 1,
      only: 'expo-ui-shared-host',
    });
    // The launch string differs - the app has to be told to wait - and the cell it
    // measures does not, so a diagnostic run lands in the same rows as a normal one.
    expect(launchPlanString(scheduled[0])).toContain('presentedTimeout=40000');
    expect(launchPlanString(plain[0])).not.toContain('presentedTimeout');
    expect(
      cellKey(
        scheduled[0].scenario,
        scheduled[0].implementation,
        scheduled[0].n
      )
    ).toBe(cellKey(plain[0].scenario, plain[0].implementation, plain[0].n));
  });
});

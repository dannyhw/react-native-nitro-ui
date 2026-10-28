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
  BASELINE_TIMEOUTS_MS,
  COMPARISON_IMPLEMENTATIONS,
  DEFAULT_SCENARIO_BUDGETS,
  MEASURED_ITERATIONS,
  WARMUP_ITERATIONS,
  MAX_MISSING_SAMPLE_RATIO,
  maxRequestedTimeoutMsFor,
  aggregateRecords,
  baselineBlockers,
  buildBaseline,
  buildSchedule,
  cellKey,
  describeMissing,
  incompleteMetrics,
  launchBudgetMs,
  narrowingProblem,
  launchPlanString,
  parseTimeoutFlags,
  requestedTimeouts,
  timeoutRuleProblem,
  skippedCellNotes,
  summarizeMissingReasons,
} from '../bench/lib.mjs';
// The bench app's plan parser is pure TypeScript over types only (no native imports),
// so it can be imported here rather than grepped. That makes the round trip below -
// `launchPlanString` in, `parsePlan` out - a real check of the launch flag.
import { BENCH_DEFAULT_TIMEOUTS, parsePlan } from '../../bench/src/plan';
import { detailSections } from '../bench/render.mjs';

const LAUNCHES = 4;
const ITERATIONS = 20;
const QUIET = [1, 1.01, 0.995, 1.005];

/**
 * The waiting rule a baseline is minted under, per platform (A4/M1). Most fixtures in
 * this file are iOS-shaped because that is the run A4 minted; the ones that are not say
 * so by naming `ANDROID_RULE`.
 */
const IOS_RULE = BASELINE_TIMEOUTS_MS.ios;
const ANDROID_RULE = BASELINE_TIMEOUTS_MS.android;

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
  presentedTimeoutMs = IOS_RULE.presentedTimeoutMs,
  mountTimeoutMs = IOS_RULE.mountTimeoutMs,
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
 * The `nitro-ui-host` arm, which the plan only schedules on Android, so it is not in the
 * default fixture - the refusal test needs it anyway.
 */
const HOST_ARM = { mounted: 115_000 };

/**
 * A whole mintable run, with one arm's `mount` cell optionally gutted.
 *
 * The gap defaults to the A3 shape: 3 of 20 measured iterations per launch (12 of 80),
 * which is over the 10 % budget (`MAX_MISSING_SAMPLE_RATIO`) and therefore incomplete.
 * The arm is a parameter because which arm it is decides everything.
 */
function mintableRun({
  gapOn = null,
  reason = 'probe-timeout',
  withHost = false,
  platform = 'ios',
} = {}) {
  const arms = withHost ? { ...ARMS, 'nitro-ui-host': HOST_ARM } : ARMS;
  const records = [];
  for (const [implementation, values] of Object.entries(arms)) {
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
    platform,
    deviceKey: `${platform}27-sim-testdevice`,
    deviceName: 'nitro-ui A',
    sha: 'abc1234',
    dirty: false,
    plan: 'full',
    launches: 8,
    perfMarks: false,
    // Android mints are only mintable at the compiled regime (D9); iOS has no ART and
    // reports null, which the guard below already exempts.
    art:
      platform === 'android' ? { status: 'speed-profile', primed: true } : null,
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
            maxWaitedMs: IOS_RULE.presentedTimeoutMs + 0.4,
            timeoutMs: [IOS_RULE.presentedTimeoutMs],
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
        timeoutMs: [IOS_RULE.presentedTimeoutMs],
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
      `1 mounted probe-timeout (${String(IOS_RULE.mountTimeoutMs)} ms), ` +
        `3 presented probe-timeout (${String(IOS_RULE.presentedTimeoutMs)} ms)`
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
    expect(detail).toContain(
      `12 probe-timeout (asked ${String(IOS_RULE.presentedTimeoutMs)} ms`
    );
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
      `presentedNs: 68 of 80 samples arrived - presentedNs: 12 probe-timeout (asked ${String(
        IOS_RULE.presentedTimeoutMs
      )} ms, waited up to ${String(IOS_RULE.presentedTimeoutMs + 0.4)} ms)`,
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
    expect(reasons[0]).toContain(
      `asked ${String(IOS_RULE.presentedTimeoutMs)} ms`
    );
    expect(reasons[0]).toContain('results file');
    expect(reasons[0]).toContain('.ndjson');
  });

  it('leaves only the third-party reference arms out, and treats the rest as ours', () => {
    expect(COMPARISON_IMPLEMENTATIONS).toEqual([
      'expo-ui-host-per-control',
      'expo-ui-shared-host',
    ]);
  });

  it('refuses a nitro-ui-host gap, because that is our own runtime', () => {
    // The brief is explicit that `nitro-ui-host` belongs with the gated arm even though
    // it is never gated: a lost signal there is a fact about nitro-ui, and a machine
    // should not mint a table in which one of our arms could not be measured.
    const run = mintableRun({ withHost: true, gapOn: 'nitro-ui-host' });
    const reasons = baselineBlockers(run);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('mount:nitro-ui-host:50 presentedNs');
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
    expect(lines[1]).toContain(
      `12 probe-timeout (asked ${String(IOS_RULE.presentedTimeoutMs)} ms`
    );
    expect(lines.at(-1)).toContain(
      '`bench/baselines/maintainer-mac-2/ios27-sim-iphone17.json` -> `skippedCells`'
    );
    expect(lines.at(-1)).toContain('cells -> `missing`');
  });

  it('refuses a run that did not wait by the rule the baseline records', () => {
    const runWith = (presentedTimeoutMs) => {
      const run = mintableRun();
      for (const cell of Object.values(run.cells)) {
        cell.timeouts = {
          mountTimeoutMs: IOS_RULE.mountTimeoutMs,
          presentedTimeoutMs,
        };
      }
      return run;
    };
    // One millisecond over the rule already changes which samples arrive, so the
    // boundary is the rule itself - a guard weakened by a factor of ten would pass a
    // wait well past it and mint a table whose `presented` column means something else.
    const justOver = IOS_RULE.presentedTimeoutMs + 1;
    const reasons = baselineBlockers(runWith(justOver));
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('waited longer for a signal than a baseline');
    expect(reasons[0]).toContain(`${String(justOver)} ms presented`);
    expect(baselineBlockers(runWith(IOS_RULE.presentedTimeoutMs))).toEqual([]);
    // And the same *under* the rule (review N1). A 1 000 ms wait drops samples a
    // baseline keeps, so it is exactly as non-comparable as a 40 s one - and `run.mjs`
    // tells the operator any `--timeout-*` run is diagnostic, so minting here would
    // contradict the runner's own message. A guard that only looked upward let this
    // through, turning the DatePicker comparison cells into `skippedCells` silently.
    const justUnder = IOS_RULE.presentedTimeoutMs - 1;
    const short = baselineBlockers(runWith(justUnder));
    expect(short).toHaveLength(1);
    expect(short[0]).toContain('waited less time for a signal than a baseline');
    expect(short[0]).toContain(`${String(justUnder)} ms presented`);
    expect(baselineBlockers(runWith(1_000))[0]).toContain('1000 ms presented');
    // Same on the mount side, and the diagnostic flag is what reaches here.
    const mounted = mintableRun();
    for (const cell of Object.values(mounted.cells)) {
      cell.timeouts = {
        mountTimeoutMs: IOS_RULE.mountTimeoutMs + 1,
        presentedTimeoutMs: IOS_RULE.presentedTimeoutMs,
      };
    }
    expect(baselineBlockers(mounted)[0]).toContain(
      `${String(IOS_RULE.mountTimeoutMs + 1)} ms mount`
    );
  });

  it('refuses a run that recorded no waiting rule at all', () => {
    // A results file from an app built before the launch flag records nothing, and the
    // pre-A4 app waited 2 000 ms. Stamping the current default onto that file would be a
    // claim about a wait nobody made (review N1), so refuse rather than guess: the same
    // survivorship question, only unverifiable.
    const before = mintableRun();
    for (const cell of Object.values(before.cells)) {
      delete cell.timeouts;
    }
    const reasons = baselineBlockers(before);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('no launch recorded the waiting rule');
    // A file that half-reported (a mount rule and no presented one) is the same problem.
    const half = mintableRun();
    for (const cell of Object.values(half.cells)) {
      cell.timeouts = { mountTimeoutMs: IOS_RULE.mountTimeoutMs };
    }
    expect(baselineBlockers(half)[0]).toContain(
      'no launch recorded the waiting rule'
    );
  });

  it("mints Android under Android's rule, not iOS's", () => {
    // The whole point of per-platform defaults (M1): a 2 000 ms Android run is *at* its
    // rule and must mint, while the same 2 000 ms on iOS is a short diagnostic. Reading
    // one platform's rule for the other would refuse every Android mint the moment iOS
    // moved, and accept an Android run recorded at iOS's 8 s.
    const android = mintableRun({ platform: 'android' });
    for (const cell of Object.values(android.cells)) {
      cell.timeouts = {
        mountTimeoutMs: ANDROID_RULE.mountTimeoutMs,
        presentedTimeoutMs: ANDROID_RULE.presentedTimeoutMs,
      };
    }
    expect(baselineBlockers(android)).toEqual([]);
    expect(buildBaseline(android).timeouts).toEqual({
      mountTimeoutMs: 1_500,
      presentedTimeoutMs: 2_000,
    });
    // The rule Android is recorded under is the one from before A4, unchanged.
    expect(ANDROID_RULE.presentedTimeoutMs).toBe(2_000);
    expect(ANDROID_RULE.mountTimeoutMs).toBe(1_500);
    // And iOS's 8 s would not be a valid Android rule: `baselineBlockers` reads the
    // file's own platform, so an 8 s Android run is refused as a diagnostic.
    for (const cell of Object.values(android.cells)) {
      cell.timeouts = {
        mountTimeoutMs: 1_500,
        presentedTimeoutMs: IOS_RULE.presentedTimeoutMs,
      };
    }
    expect(baselineBlockers(android)[0]).toContain('on android');
  });

  it('records the rule it was minted under in the file', () => {
    // Minting at the rule records the rule.
    const atRule = mintableRun();
    for (const cell of Object.values(atRule.cells)) {
      cell.timeouts = {
        mountTimeoutMs: IOS_RULE.mountTimeoutMs,
        presentedTimeoutMs: IOS_RULE.presentedTimeoutMs,
      };
    }
    expect(buildBaseline(atRule).timeouts).toEqual({
      mountTimeoutMs: IOS_RULE.mountTimeoutMs,
      presentedTimeoutMs: IOS_RULE.presentedTimeoutMs,
    });
    // A run that asked for something else is refused (above), so the only rule a forced
    // file can carry is the one the app *reported* - reported, never filled in.
    const forced = mintableRun();
    for (const cell of Object.values(forced.cells)) {
      cell.timeouts = { mountTimeoutMs: 1_500, presentedTimeoutMs: 1_000 };
    }
    expect(buildBaseline(forced).timeouts).toEqual({
      mountTimeoutMs: 1_500,
      presentedTimeoutMs: 1_000,
    });
    // A results file from before the flag recorded nothing, and says so rather than
    // borrowing today's default (review N1: that app waited 2 000 ms, and stamping 8 000
    // onto the table is the false claim this field exists to prevent).
    const before = mintableRun();
    for (const cell of Object.values(before.cells)) {
      delete cell.timeouts;
    }
    expect(buildBaseline(before).timeouts).toEqual({
      mountTimeoutMs: null,
      presentedTimeoutMs: null,
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
    // The number this rule is named after, pinned: A4 raised iOS's presented wait from
    // 2 000 to 8 000 ms and left Android's at 2 000 (M1), and the budget must stay the
    // plain table value when nobody asks for more.
    expect(IOS_RULE.presentedTimeoutMs).toBe(8_000);
    expect(ANDROID_RULE.presentedTimeoutMs).toBe(2_000);
    expect(launchBudgetMs(entry({}), { platform: 'ios' })).toBe(
      DEFAULT_SCENARIO_BUDGETS.ios.mount
    );
    expect(
      launchBudgetMs(
        entry({ presentedTimeoutMs: IOS_RULE.presentedTimeoutMs }),
        { platform: 'ios' }
      )
    ).toBe(DEFAULT_SCENARIO_BUDGETS.ios.mount);
    // A *shorter* wait does not shrink the budget either: the launch still has to fit
    // the same work, and a run that gives up early is not a faster launch.
    expect(
      launchBudgetMs(entry({ presentedTimeoutMs: 2_000 }), {
        platform: 'ios',
      })
    ).toBe(DEFAULT_SCENARIO_BUDGETS.ios.mount);
  });

  it('starts above the most a default launch can spend waiting, per platform', () => {
    // The reason the table is what it is. A launch where no frame ever arrives waits the
    // full default on every iteration: 25 x (2 mount + 1 presented). A budget below that
    // kills the launch as "stalled" for a reason the runner chose, and a killed launch
    // loses 20 iterations of data and becomes a `problem` - a mint refusal - instead of
    // 20 recorded `probe-timeout` reasons. A4's raise from 2 000 to 8 000 ms is what
    // pushed iOS past the old 180 s table value; Android's 125 s is what keeps its own
    // row honest if anyone shrinks it again.
    for (const platform of ['ios', 'android']) {
      const rule = BASELINE_TIMEOUTS_MS[platform];
      const worst =
        (WARMUP_ITERATIONS + MEASURED_ITERATIONS) *
        (2 * rule.mountTimeoutMs + rule.presentedTimeoutMs);
      expect(worst).toBe(platform === 'ios' ? 275_000 : 125_000);
      for (const action of ['mount', 'update', 'memory']) {
        expect(DEFAULT_SCENARIO_BUDGETS[platform][action]).toBeGreaterThan(
          worst
        );
      }
      // `leak` never waits for a signal (it samples footprints), so it needs room for the
      // allocation work rather than the waiting, and is the largest of the four.
      expect(DEFAULT_SCENARIO_BUDGETS[platform].leak).toBeGreaterThan(
        DEFAULT_SCENARIO_BUDGETS[platform].mount
      );
    }
  });

  it('asks for a platform rather than guessing one', () => {
    // iOS's default wait needs 275 s of headroom and Android's table only has 180 s, so a
    // budget computed for the wrong platform is a stalled-launch kill in one direction and
    // a 4x over-allowance in the other. Falling back to a default platform is how that
    // would happen quietly.
    expect(() => launchBudgetMs(entry({}))).toThrow(
      /no baseline waiting rule for platform/
    );
    expect(() =>
      launchBudgetMs(entry({}), {
        platform: 'ios',
        scenarioBudgets: { android: { mount: 1 } },
      })
    ).toThrow(/no launch budgets for platform/);
  });

  it('grows by the extra wait for every iteration of the launch', () => {
    // 25 iterations x (40 000 - 8 000) extra = 800 000 ms on top of the table value.
    // Without this a diagnostic run is killed as "stalled" for waiting on purpose, and a
    // killed launch becomes a `problem` - which is also a mint refusal.
    expect(
      launchBudgetMs(entry({ presentedTimeoutMs: 40_000 }), {
        platform: 'ios',
      })
    ).toBe(DEFAULT_SCENARIO_BUDGETS.ios.mount + 25 * 32_000);
    // A mount wait counts twice per iteration (`mount` waits for its own signal and
    // again in the teardown), so both additions have to show up.
    expect(
      launchBudgetMs(
        entry({ mountTimeoutMs: 5_000, presentedTimeoutMs: 40_000 }),
        {
          platform: 'ios',
        }
      )
    ).toBe(
      DEFAULT_SCENARIO_BUDGETS.ios.mount +
        25 * (2 * (5_000 - IOS_RULE.mountTimeoutMs) + 32_000)
    );
  });

  it('keeps the leak budget the largest, and honours an explicit override', () => {
    expect(
      launchBudgetMs(
        entry({ scenario: 'leak.date-picker', presentedTimeoutMs: 40_000 }),
        { platform: 'ios' }
      )
    ).toBe(DEFAULT_SCENARIO_BUDGETS.ios.leak + 25 * 32_000);
    // `BENCH_LAUNCH_TIMEOUT_S` is set by hand precisely to decide this question, so when
    // it is present `run.mjs` has already rewritten the whole table to it and the
    // requested waits must not add anything on top.
    expect(
      launchBudgetMs(entry({ presentedTimeoutMs: 40_000 }), {
        platform: 'ios',
        scenarioBudgets: {
          ios: {
            mount: 600_000,
            update: 600_000,
            memory: 600_000,
            leak: 600_000,
          },
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
      parseTimeoutFlags(['--timeout-presented', '40000'], readFlag, 'ios')
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
        () => value,
        'ios'
      );
      expect(out.problem).toContain('--timeout-presented must be a number');
      expect(out.presentedTimeoutMs).toBeNull();
    }
  });

  it('caps the request by the platform it is running on', () => {
    // The cap is per platform because the native backstop is (M1). 8 000 ms is a normal
    // iOS request and a lie on Android, where the 2 s backstop answers first and the
    // recorded reason would blame an 8 s wait that never happened - the exact A4 root
    // cause. A shared 80 s cap is what let that happen on Android.
    expect(
      parseTimeoutFlags(['--timeout-presented', '8000'], () => '8000', 'ios')
    ).toEqual({
      mountTimeoutMs: null,
      presentedTimeoutMs: 8_000,
      problem: null,
    });
    const onAndroid = parseTimeoutFlags(
      ['--timeout-presented', '8000'],
      () => '8000',
      'android'
    );
    expect(onAndroid.presentedTimeoutMs).toBeNull();
    expect(onAndroid.problem).toContain('between 1 and 1900 on android');
    expect(onAndroid.problem).toContain('2000 ms native backstop');
    // Just under Android's ceiling it is a legitimate question ("does it present in
    // 1 900 ms?"), so the guard is the backstop and not a blanket 2 s rule.
    expect(
      parseTimeoutFlags(
        ['--timeout-presented', '1900'],
        () => '1900',
        'android'
      ).problem
    ).toBeNull();
    expect(maxRequestedTimeoutMsFor('android')).toBe(1_900);
    expect(maxRequestedTimeoutMsFor('ios')).toBe(80_000);
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
    const parsed = parsePlan(asString, 'ios');
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

    // No flags: the app waits by the platform's defaults, and the string is unchanged
    // from before A4 (old results-file names and the app's own idle-screen parse stay
    // valid). Both platforms are checked because the whole M1 fix is that the defaults
    // are not one number: an app that read iOS's on Android would wait 8 s where the
    // committed Android table was recorded at 2 s.
    const plainString = launchPlanString({
      ...entry,
      perfMarks: false,
      mountTimeoutMs: undefined,
      presentedTimeoutMs: undefined,
    });
    for (const platform of ['ios', 'android']) {
      const plain = parsePlan(plainString, platform);
      expect({
        mount: plain?.mountTimeoutMs,
        presented: plain?.presentedTimeoutMs,
      }).toEqual({
        mount: BENCH_DEFAULT_TIMEOUTS[platform].mountTimeoutMs,
        presented: BENCH_DEFAULT_TIMEOUTS[platform].presentedTimeoutMs,
      });
    }
    expect(parsePlan(plainString, 'android')?.presentedTimeoutMs).toBe(2_000);
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
      expect(() => parsePlan(bad, 'ios')).toThrow(/NITRO_BENCH plan/);
    }
    // Past *this platform's* backstop is refused on the launch string too, so a
    // hand-built plan cannot do what the flag guard refuses (M1).
    expect(() =>
      parsePlan('mount:rn-core:50:presentedTimeout=8000', 'android')
    ).toThrow(/NITRO_BENCH plan/);
    expect(
      parsePlan('mount:rn-core:50:presentedTimeout=8000', 'ios')
        ?.presentedTimeoutMs
    ).toBe(8_000);
    // A bare `marks` still parses, and so does a valid combination of all three.
    expect(parsePlan('mount:rn-core:50:marks', 'ios')?.perfMarks).toBe(true);
    expect(
      parsePlan(
        'mount:rn-core:50:marks,mountTimeout=2000,presentedTimeout=30000',
        'ios'
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

describe('an --update-baseline run refuses a waiting rule it did not ask for', () => {
  /**
   * The startup half of review N1. `run.mjs` calls every `--timeout-*` run DIAGNOSTIC, so
   * a mint that asked for a non-default wait had to be refused, and the minting guard
   * below is the last chance to notice - after the run. This is the same question answered
   * in the second the command starts, the way the load and narrowing guards work.
   */
  it('says nothing when the flags are absent or ask for the default', () => {
    expect(timeoutRuleProblem({ platform: 'ios' })).toBeNull();
    expect(
      timeoutRuleProblem({ platform: 'ios', presentedTimeoutMs: 8_000 })
    ).toBeNull();
    expect(
      timeoutRuleProblem({
        platform: 'android',
        mountTimeoutMs: 1_500,
        presentedTimeoutMs: 2_000,
      })
    ).toBeNull();
  });

  it('refuses a shorter or longer wait, per platform', () => {
    const short = timeoutRuleProblem({
      platform: 'ios',
      presentedTimeoutMs: 1_000,
    });
    expect(short).toContain('1000 ms for a presenting frame');
    expect(short).toContain('ios baselines are recorded at 1500/8000');
    expect(short).toContain('Drop the `--timeout-*` flags to mint');
    expect(
      timeoutRuleProblem({ platform: 'ios', presentedTimeoutMs: 40_000 })
    ).toContain('40000 ms for a presenting frame');
    // 8 000 ms is iOS's rule and an Android diagnostic, which is the M1 asymmetry
    // expressed as a refusal: one shared number would get both wrong.
    expect(
      timeoutRuleProblem({ platform: 'android', presentedTimeoutMs: 8_000 })
    ).toContain('android baselines are recorded at 1500/2000');
  });
});

describe('the two ends of the timeout rule agree', () => {
  const ios = () =>
    readFileSync(
      resolve(
        process.cwd(),
        'bench/modules/bench-probe/ios/HybridBenchProbe.mm'
      ),
      'utf8'
    );
  const android = () =>
    readFileSync(
      resolve(
        process.cwd(),
        'bench/modules/bench-probe/android/src/main/java/com/margelo/nitro/benchprobe/HybridBenchProbe.kt'
      ),
      'utf8'
    );

  it('waits by the same defaults the baseline is minted under, on both platforms', () => {
    // The drift this pins is the expensive kind: a mint refused for a wait nobody asked
    // for, or accepted under a rule it was not recorded with. Per platform, because the
    // two no longer share a number (M1).
    for (const platform of ['ios', 'android']) {
      expect(BENCH_DEFAULT_TIMEOUTS[platform]).toEqual(
        BASELINE_TIMEOUTS_MS[platform]
      );
    }
    // Android's own numbers, stated plainly: nothing about the Android wait moved.
    expect(BASELINE_TIMEOUTS_MS.android.mountTimeoutMs).toBe(1_500);
    expect(BASELINE_TIMEOUTS_MS.android.presentedTimeoutMs).toBe(2_000);
    expect(BASELINE_TIMEOUTS_MS.ios.presentedTimeoutMs).toBe(8_000);
  });

  it("caps a requested wait below that platform's native backstop", () => {
    const iosCeiling = Number(
      /kBenchPresentationCeilingSeconds = ([0-9.]+)/.exec(ios())[1]
    );
    const androidCeiling = Number(
      /PRESENTATION_CEILING_MS = ([0-9_]+)L/
        .exec(android())[1]
        .replace(/_/g, '')
    );
    for (const [platform, ceilingMs] of [
      ['ios', iosCeiling * 1000],
      ['android', androidCeiling],
    ]) {
      expect(BASELINE_TIMEOUTS_MS[platform].presentationCeilingMs).toBe(
        ceilingMs
      );
      expect(maxRequestedTimeoutMsFor(platform)).toBeLessThan(ceilingMs);
      expect(BENCH_DEFAULT_TIMEOUTS[platform].maxRequestedTimeoutMs).toBe(
        maxRequestedTimeoutMsFor(platform)
      );
      // The cap has to reach at least as far as the platform's own default, or the
      // default rule could not be asked for explicitly.
      if (ceilingMs > BASELINE_TIMEOUTS_MS[platform].presentedTimeoutMs) {
        expect(maxRequestedTimeoutMsFor(platform)).toBeGreaterThanOrEqual(
          BASELINE_TIMEOUTS_MS[platform].presentedTimeoutMs
        );
      }
    }
    // 2 s on Android and 90 s on iOS is deliberate (M1), not drift: each is above its own
    // platform's cap and the pair is pinned so the next change is a decision.
    expect(androidCeiling).toBe(2_000);
    expect(iosCeiling).toBe(90);
    // iOS's cap has to stay generous enough to be worth asking for: A4 measured the
    // slowest iOS frame at 3.6 s, so 10x the 8 s default keeps a strange arm inside
    // what can be requested.
    expect(maxRequestedTimeoutMsFor('ios')).toBe(40_000 * 2);
    expect(maxRequestedTimeoutMsFor('ios')).toBeGreaterThanOrEqual(
      10 * IOS_RULE.presentedTimeoutMs
    );
  });

  it("arms each platform's measured presenting capture with its ceiling constant", () => {
    // Reading the *constant* is not enough: A4's root cause was a call site waiting 2 s
    // while a constant said something else, and the review restored that call site with
    // every constant untouched, green (N2). So read the delay argument of the timer each
    // platform actually arms, inside the function that arms it - the names all coexist
    // in these files, and the regression is which one the timer is handed.
    const bodyOf = (source, header, what) => {
      const at = source.indexOf(header);
      if (at < 0) {
        throw new Error(`no ${what} in the probe source`);
      }
      const rest = source.slice(at);
      const end = rest.indexOf('\n  }\n');
      if (end < 0) {
        throw new Error(`${what} does not end where this test expects`);
      }
      return rest.slice(0, end);
    };
    const kotlinDelay = (body, what) => {
      const found = /postDelayed\(([\s\S]*?)\}, ([A-Za-z_0-9.]+)\)/.exec(body);
      if (found == null) {
        throw new Error(`no ${what} postDelayed in that body`);
      }
      return String(found[2]);
    };
    const objcDelay = (body, what) => {
      const found =
        /dispatch_after\(\s*dispatch_time\(DISPATCH_TIME_NOW,\s*static_cast<int64_t>\(\s*([A-Za-z_0-9.]+)\s*\*\s*NSEC_PER_SEC\s*\)/.exec(
          body
        );
      if (found == null) {
        throw new Error(`no ${what} dispatch_after in that body`);
      }
      return String(found[1]);
    };

    // The measured presenting capture: iOS's `dispatch_after` in
    // `BenchProbeArmPresentation`, Android's in `armFrameCapture`.
    expect(
      objcDelay(
        bodyOf(ios(), 'void BenchProbeArmPresentation(', 'iOS presentation'),
        'iOS presentation ceiling'
      )
    ).toBe('kBenchPresentationCeilingSeconds');
    expect(
      kotlinDelay(
        bodyOf(android(), 'fun armFrameCapture(', 'Android presentation'),
        'Android presentation ceiling'
      )
    ).toBe('PRESENTATION_CEILING_MS');

    // The pacing waits keep their own constants, so the two waits cannot be merged by a
    // rename in either direction: the measured capture must not end up on the pacing
    // number (that substitution is the exact A4 regression), and a pacing timer must not
    // inherit a 90 s ceiling that turns a missed frame into a 90 s stall.
    expect(
      kotlinDelay(
        bodyOf(android(), 'fun nextFrameNs(', 'Android pacing'),
        'Android pacing'
      )
    ).toBe('FRAME_TIMEOUT_MS');
    expect(
      objcDelay(
        bodyOf(ios(), 'HybridBenchProbe::nextFrameNs(', 'iOS pacing'),
        'iOS pacing'
      )
    ).toBe('kBenchPacingFrameCeilingSeconds');
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

describe('a narrowed run cannot mint the whole table', () => {
  const filtersFor = (extra) => ({
    only: null,
    component: null,
    scenario: null,
    n: null,
    ...extra,
  });
  const sizes = (extra, platform = 'ios') => {
    const filters = filtersFor(extra);
    return {
      scheduled: buildSchedule({
        plan: 'full',
        launches: 8,
        platform,
        ...filters,
      }).length,
      wholePlan: buildSchedule({ plan: 'full', launches: 8, platform }).length,
      filters,
    };
  };

  it('says nothing about a run that measured the whole plan', () => {
    expect(narrowingProblem(sizes({}))).toBeNull();
    // `--only` naming every arm is not a narrowing, and the plan/launches guards in
    // `baselineBlockers` are not confused by an arm list either.
    expect(
      narrowingProblem(
        sizes({
          only: 'rn-core,nitro-ui,expo-ui-shared-host,expo-ui-host-per-control',
        })
      )
    ).toBeNull();
  });

  it('refuses the mint for each filter, and names it', () => {
    for (const [extra, expected] of [
      [{ scenario: 'mount.date-picker' }, '--scenario mount.date-picker'],
      [{ n: 200 }, '--n 200'],
      [{ component: 'slider' }, '--component slider'],
      [{ only: 'nitro-ui,rn-core' }, '--only nitro-ui,rn-core'],
    ]) {
      const problem = narrowingProblem(sizes(extra));
      expect(problem).toContain('narrowed to');
      expect(problem).toContain(expected);
      expect(problem).toContain('not measured in base');
    }
  });

  it('catches the diagnostic run shape the docs recommend', () => {
    // The exact command in docs/architecture/benchmarks.md: one cell of the plan.
    const diagnostic = sizes({
      component: 'date-picker',
      scenario: 'mount.date-picker',
      n: 200,
    });
    expect(diagnostic.scheduled).toBeLessThan(diagnostic.wholePlan);
    expect(narrowingProblem(diagnostic)).not.toBeNull();
    expect(sizes({}).scheduled).toBe(sizes({}).wholePlan);
  });

  it('does not mistake a platform with fewer arms for a filtered run', () => {
    // Android has an extra scoped arm, so its whole plan differs from iOS's. Each
    // platform is compared with itself, which is what makes the comparison meaningful.
    const android = sizes({}, 'android');
    expect(narrowingProblem(android)).toBeNull();
    expect(android.wholePlan).not.toBe(sizes({}, 'ios').wholePlan);
  });
});

describe('raising the waiting rule is value-neutral for a cell that was complete', () => {
  /**
   * The claim part 3 rests on, checked rather than argued: a longer wait changes *which*
   * samples arrive and never *what* an arriving sample says. So a cell that already
   * measured every iteration inside the old wait has identical numbers under the new one,
   * and a committed baseline - every cell of which is complete by the mint rule - stays
   * comparable across the change. The only cells that move are the ones that were losing
   * samples, and they move towards the truth: the iterations a short wait dropped are
   * exactly the slow ones, which is why their survivor-biased median reads fast.
   *
   * `timeToPresentMs` is A4's measured shape: `rn-core` on the 16 ms floor, `nitro-ui` at
   * ~150 ms, and the two `@expo/ui` arms at N=200 with a frame that lands at 2.7-3.0 s -
   * above the old 2 000 ms wait, below the new 8 000 ms one.
   */
  const timeToPresentMs = {
    'rn-core': 16,
    'nitro-ui': 150,
    // The arm A3 lost frames on: frames land in a band that straddles the old 2 000 ms
    // wait (so it loses its slow tail) and sits inside the new one.
    'expo-ui-shared-host': 2400,
  };

  function recordsFor(implementation, { presentedTimeoutMs }) {
    const floor = timeToPresentMs[implementation];
    const records = [
      {
        kind: 'meta',
        scenario: 'mount',
        implementation,
        n: 200,
        launch: 0,
        warmup: 0,
        measured: ITERATIONS,
        platform: 'ios 27.0',
        probeClock: 'CLOCK_UPTIME_RAW',
        mountSignal: true,
        mountTimeoutMs: IOS_RULE.mountTimeoutMs,
        presentedTimeoutMs,
      },
    ];
    for (let launch = 0; launch < LAUNCHES; launch++) {
      for (let index = 0; index < ITERATIONS; index++) {
        // Deterministic spread: -25 % to +15 % across the iteration. For the fast arms
        // that band is far inside either wait; for the slow one it straddles the old wait
        // and sits wholly inside the new one.
        const tookMs = floor * (0.75 + 0.4 * (index / (ITERATIONS - 1)));
        const lost = tookMs > presentedTimeoutMs;
        records.push({
          kind: 'iter',
          scenario: 'mount',
          implementation,
          n: 200,
          launch,
          index,
          warmup: false,
          jsCommitNs: 5_000_000,
          mountedNs: 20_000_000,
          presentedNs: lost ? null : 20_000_000 + tookMs * 1e6,
          ...(lost
            ? {
                missing: [
                  {
                    metric: 'presentedNs',
                    reason: 'probe-timeout',
                    waitedMs: presentedTimeoutMs + 0.4,
                    timeoutMs: presentedTimeoutMs,
                  },
                ],
              }
            : {}),
        });
      }
    }
    return records;
  }

  const medianUnder = (implementation, presentedTimeoutMs) => {
    const cells = aggregateRecords(
      recordsFor(implementation, { presentedTimeoutMs })
    );
    const cell = cells[`mount:${implementation}:200`];
    return {
      median: cell.metrics.presentedNs.median,
      samples: cell.metrics.presentedNs.samples,
      incomplete: incompleteMetrics(cell).length > 0,
    };
  };

  it('leaves a cell that measured everything identical, to the nanosecond', () => {
    for (const implementation of ['rn-core', 'nitro-ui']) {
      const before = medianUnder(implementation, 2_000);
      const after = medianUnder(implementation, IOS_RULE.presentedTimeoutMs);
      expect(before.samples).toBe(LAUNCHES * ITERATIONS);
      expect(after).toEqual(before);
    }
  });

  it('is exactly the incomplete cell that changes, and towards its true median', () => {
    const before = medianUnder('expo-ui-shared-host', 2_000);
    const after = medianUnder(
      'expo-ui-shared-host',
      IOS_RULE.presentedTimeoutMs
    );
    // The old wait loses the slow tail: the cell is not reportable, and its median is the
    // fast survivors - A3's 97.5 ms recorded for an arm that presents in ~2 s.
    expect(before.incomplete).toBe(true);
    expect(before.samples).toBeGreaterThan(0);
    expect(before.samples).toBeLessThan(LAUNCHES * ITERATIONS);
    expect(before.median).toBeLessThan(2_000e6);
    // The new wait measures every iteration, so the median is the arm's real number and it
    // is *slower* than the survivor-biased one. Raising the wait never flatters an arm.
    expect(after.incomplete).toBe(false);
    expect(after.samples).toBe(LAUNCHES * ITERATIONS);
    expect(after.median).toBeGreaterThan(before.median * 1.2);
    expect(after.median).toBeGreaterThan(2_000e6);
  });

  it('is the reason the iOS default is what it is: above the slowest measured frame', () => {
    // The rule has to clear the slowest frame measured anywhere in A4's iOS runs (3 565
    // ms, 3 850 ms in the 40 s diagnostic) with room for a busy machine, and stay well
    // under the 90 s native backstop so "we stopped asking" stays distinguishable.
    const slowestMeasuredFrameMs = 3_850;
    expect(IOS_RULE.presentedTimeoutMs).toBeGreaterThan(slowestMeasuredFrameMs);
    expect(IOS_RULE.presentedTimeoutMs).toBeLessThan(
      maxRequestedTimeoutMsFor('ios')
    );
    expect(maxRequestedTimeoutMsFor('ios')).toBeLessThan(90_000);
    // And the two ends have to agree, because the number that gates a mint is the
    // runner's and the number a launch actually waits by is the app's. `waits by the
    // same defaults the baseline is minted under` asserts the equality; this one is the
    // proof that a revert cannot slip through as a pair - both constants would have to
    // move together, and one of them is read from the app's own module.
    expect(BENCH_DEFAULT_TIMEOUTS.ios.presentedTimeoutMs).toBe(
      IOS_RULE.presentedTimeoutMs
    );
    expect(BENCH_DEFAULT_TIMEOUTS.ios.presentedTimeoutMs).toBeGreaterThan(
      slowestMeasuredFrameMs
    );
    // The evidence for 8 s is iOS evidence only, which is why Android did not take the
    // raise (M1): nothing measured on Android has a frame between 2 s and 8 s - the cells
    // that lose presenting samples there never draw one at all.
    expect(ANDROID_RULE.presentedTimeoutMs).toBeLessThan(
      slowestMeasuredFrameMs
    );
  });
});

describe('Android keeps the waiting rule it was minted with (review M1)', () => {
  /**
   * One place that reads Android's *effective* waits end to end: the string the runner
   * puts on a default launch, the number the app parses off it, the native timer that
   * could answer instead, the wall-clock budget the runner allows, and the rule a mint is
   * refused under. Any of the five moving is the change M1 exists to prevent, and each is
   * a different file, so a fix in one would otherwise look complete.
   *
   * Proven red by moving each in turn: the app default to 8 000 (both the parse and the
   * mint-rule equality go red), the ceiling constant or its `postDelayed` call site to
   * 90 s (the backstop and call-site tests), the budget table to iOS's (the table pin),
   * and the platform's rule to iOS's (the mint test above).
   */
  const entry = {
    scenario: 'update.progress',
    implementation: 'expo-ui-shared-host',
    n: 50,
    launch: 0,
  };

  it('asks the app for no timeout at all, and the app waits 1 500 / 2 000', () => {
    const [scheduled] = buildSchedule({
      plan: 'quick',
      launches: 1,
      platform: 'android',
      only: 'expo-ui-shared-host',
    });
    expect(launchPlanString(scheduled)).not.toContain('Timeout');
    const parsed = parsePlan(launchPlanString(scheduled), 'android');
    expect({
      mount: parsed?.mountTimeoutMs,
      presented: parsed?.presentedTimeoutMs,
    }).toEqual({ mount: 1_500, presented: 2_000 });
  });

  it('has a native backstop at 2 s, so nothing can wait longer than that', () => {
    const android = readFileSync(
      resolve(
        process.cwd(),
        'bench/modules/bench-probe/android/src/main/java/com/margelo/nitro/benchprobe/HybridBenchProbe.kt'
      ),
      'utf8'
    );
    expect(
      Number(
        /PRESENTATION_CEILING_MS = ([0-9_]+)L/
          .exec(android)[1]
          .replace(/_/g, '')
      )
    ).toBe(2_000);
    // Which is also why the requested cap there is 1 900 ms and not iOS's 80 s: past the
    // backstop, the recorded timeout would not be the one the run asked for.
    expect(maxRequestedTimeoutMsFor('android')).toBe(1_900);
  });

  it('gives each launch the pre-A4 budget, sized for those waits', () => {
    expect(launchBudgetMs(entry, { platform: 'android' })).toBe(180_000);
    // 25 iterations x (2 x 1 500 + 2 000) = 125 000 ms of worst-case waiting, inside it.
    expect(25 * (2 * 1_500 + 2_000)).toBe(125_000);
  });

  it('does not pay the 8 s wait across the cells that never draw', () => {
    // The cost M1 removes: the 8 Android `update.{progress,picker}:expo-ui-*` cells that
    // await both signals and time out on every iteration (A3: "never mounted"). Each
    // extra second of the presented wait is 1 s per iteration of every one of their
    // launches, and it is not free CPU either - `opBatch` brackets the wait, so those
    // comparison rows integrate main-thread work over it.
    const affectedCells = 8;
    const launches = 8;
    const iterations = WARMUP_ITERATIONS + MEASURED_ITERATIONS;
    const extraWaitMs = 8_000 - 2_000;
    const extraSeconds =
      (affectedCells * launches * iterations * extraWaitMs) / 1000;
    expect(extraSeconds).toBe(9_600); // ~2.7 h per Android full run
    // ...and at iOS's 8 s the same cells would run past the budget Android's launches get,
    // which is the other half of why the raise was not simply taken at face value: a
    // launch killed as "stalled" is a `problem`, and a `problem` refuses the whole mint.
    expect((iterations * (2 * 1_500 + 8_000)) / 180_000).toBeGreaterThan(1);
    expect((iterations * (2 * 1_500 + 2_000)) / 180_000).toBeLessThan(1);
  });
});

describe('the two copies of the launch budgets agree', () => {
  /**
   * `run.mjs` owns the table it hands to the launcher; `lib.mjs` restates it so the
   * widening rule can be tested without importing a runner that cannot be imported under
   * jest (`import.meta`). Two copies of a number drift, and the drift is silent in the
   * worst way: tests would pass against one table while devices ran on the other, so a
   * launch killed as "stalled" on a slow arm would look like a case the suite covers.
   *
   * This reads the runner's own source rather than a fixture, so editing a budget there
   * moves the expectation here with it - or fails.
   */
  const runnerTable = () => {
    const source = readFileSync(
      resolve(process.cwd(), 'scripts/bench/run.mjs'),
      'utf8'
    );
    const block = /const TIMEOUTS = \{([\s\S]*?)\n\};/.exec(source);
    expect(block).not.toBeNull();
    // Per platform, so a table that is right for one and wrong for the other cannot be
    // read as a flat match against `DEFAULT_SCENARIO_BUDGETS`.
    return Object.fromEntries(
      [...String(block[1]).matchAll(/(ios|android):\s*\{([^}]*)\}/g)].map(
        ([, platform, rows]) => [
          platform,
          Object.fromEntries(
            [...rows.matchAll(/(\w+):\s*([0-9_]+)/g)].map(([, key, value]) => [
              key,
              Number(value.replace(/_/g, '')),
            ])
          ),
        ]
      )
    );
  };

  it('is the same table, read from the runner that uses it', () => {
    expect(runnerTable()).toEqual(DEFAULT_SCENARIO_BUDGETS);
  });

  it('has an entry for every scenario the plans can schedule', () => {
    // Otherwise `launchBudgetMs` falls back to its own default for a new action, and the
    // fallback is the value A4 just found too small.
    const actions = new Set();
    for (const plan of ['quick', 'full']) {
      for (const platform of ['ios', 'android']) {
        for (const entry of buildSchedule({ plan, launches: 1, platform })) {
          actions.add(String(entry.scenario).split('.')[0]);
        }
      }
    }
    const table = runnerTable();
    for (const platform of ['ios', 'android']) {
      for (const action of actions) {
        expect(table[platform]).toHaveProperty(action);
      }
    }
    expect([...actions].sort()).toEqual(['leak', 'memory', 'mount', 'update']);
  });
});

/**
 * The benchmark gate must be able to fail.
 *
 * T02 round 1 shipped a gate that could not: `--check` vetoed the whole run
 * whenever `rn-core`'s *absolute* numbers had moved since the baseline, which
 * between sessions is nearly always, and `--compare` only ever compared
 * `nitro-ui` against nothing. The reviewer proved it from the committed data
 * (docs/tasks/T02-bench.review.md B1). These fixtures are the regression test
 * for that, with no device involved: a synthetic run where a `nitro-ui` arm got
 * twice as slow has to produce a conclusive failure, and the levers that are
 * *not* evidence - control drift, a slow reference arm, a noisy cell - must not
 * suppress or manufacture one.
 *
 * The same `gate()` is used by `run.mjs --check/--compare` and by
 * `report.mjs --compare/--check` (review S11), so covering it covers both.
 */

import { describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  SCHEMA_VERSION,
  aggregateRecords,
  baselineBlockers,
  comparableMetrics,
  gate,
  noiseTable,
  ratioTable,
} from '../bench/lib.mjs';
// `comparisonSections()` lives in render.mjs rather than report.mjs so the gate
// can be tested here: report.mjs is the filesystem CLI and resolves repo paths
// through `import.meta`, which jest's CommonJS transform cannot represent.
import { comparisonSections, renderMarkdown } from '../bench/render.mjs';

const LAUNCHES = 4;
const ITERATIONS = 20;

/**
 * Per-launch multipliers. The quiet one is what an idle machine produces; the
 * loud one is a machine doing something else while a cell is measured, which is
 * what the within-run noise guard is supposed to notice.
 */
const QUIET = [1, 1.01, 0.995, 1.005];
const LOUD = [1, 1.7, 0.62, 1.35];

/**
 * Records for one cell.
 *
 * `values` are per-op nanoseconds; latency metrics are written per iteration and
 * CPU as one bracket per launch, exactly like the bench app does.
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
  spread = false,
}) {
  const factors = spread ? LOUD : QUIET;
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
    },
  ];

  for (let launch = 0; launch < LAUNCHES; launch++) {
    const factor = factors[launch] ?? 1;
    for (let index = 0; index < ITERATIONS; index++) {
      const wiggle = 1 + 0.002 * ((index % 5) - 2);
      records.push({
        kind: 'iter',
        scenario,
        implementation,
        n,
        launch,
        index,
        warmup: false,
        jsCommitNs: jsCommit * factor * wiggle,
        mountedNs: mounted * factor * wiggle,
        presentedNs: presented * factor * wiggle,
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
    if (scenario === 'mount') {
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
  }
  return records;
}

/** Memory/leak cell: `footprint(phase)` for one launch, in bytes. */
function memoryRecords({
  scenario = 'memory',
  implementation,
  n = 200,
  empty = 120_000_000,
  perInstance = 40_000,
  leakPerCycle = 0,
  wobble = false,
  heaps = null,
}) {
  const records = [
    {
      kind: 'meta',
      scenario,
      implementation,
      n,
      launch: 0,
      warmup: 0,
      measured: 0,
      platform: 'ios 27.0',
      probeClock: 'CLOCK_UPTIME_RAW',
    },
  ];
  const sample = (launch, phase, bytes) => {
    records.push({
      kind: 'mem',
      scenario,
      implementation,
      n,
      launch,
      phase,
      footprintBytes: bytes,
      heapCollected: true,
      nativeHeapBytes:
        heaps == null
          ? null
          : empty + heaps.native * n * (phase === 'full' ? 1 : 0),
      javaHeapBytes:
        heaps == null
          ? null
          : empty + heaps.java * n * (phase === 'full' ? 1 : 0),
    });
  };
  for (let launch = 0; launch < LAUNCHES; launch++) {
    if (scenario === 'memory') {
      sample(launch, 'empty', empty);
      sample(launch, 'full', empty + perInstance * n);
    } else {
      for (let cycle = 0; cycle <= 10; cycle++) {
        // A wobble is not a leak; a monotonic climb is.
        const drift =
          wobble && cycle % 2 === 1 ? leakPerCycle * 6 : leakPerCycle;
        sample(launch, `leak${cycle}`, empty + drift * cycle);
      }
    }
  }
  return records;
}

/** A whole synthetic run: control + the two reference arms + nitro-ui. */
function makeRun(overrides = {}) {
  const arms = {
    'rn-core': {},
    'expo-ui-host-per-control': { mounted: 210_000 },
    'expo-ui-shared-host': { mounted: 80_000 },
    'nitro-ui': { mounted: 110_000 },
    ...Object.fromEntries(
      Object.entries(overrides).map(([implementation, values]) => [
        implementation,
        values,
      ])
    ),
  };
  const records = [];
  for (const [implementation, values] of Object.entries(arms)) {
    records.push(...cellRecords({ implementation, ...values }));
    records.push(...memoryRecords({ implementation, ...values }));
  }
  return {
    platform: 'ios',
    cells: aggregateRecords(records, { keepRaw: true }),
  };
}

/** A run whose `leak` scenario has per-arm slopes, for the leak gate. */
function leakRun({ rnCore, nitroUi }) {
  const records = [
    ...cellRecords({ implementation: 'rn-core' }),
    ...cellRecords({ implementation: 'nitro-ui' }),
    ...memoryRecords({
      scenario: 'leak',
      implementation: 'rn-core',
      leakPerCycle: rnCore,
    }),
    ...memoryRecords({
      scenario: 'leak',
      implementation: 'nitro-ui',
      leakPerCycle: nitroUi,
    }),
  ];
  return {
    platform: 'ios',
    cells: aggregateRecords(records, { keepRaw: true }),
  };
}

describe('benchmark gate', () => {
  it('is silent when nothing changed', () => {
    const result = gate({ head: makeRun(), base: makeRun() });
    expect(result.failures).toEqual([]);
    expect(result.conclusiveFailure).toBe(false);
  });

  it('fails conclusively when a nitro-ui arm doubles', () => {
    const result = gate({
      head: makeRun({ 'nitro-ui': { mounted: 220_000, presented: 260_000 } }),
      base: makeRun(),
    });
    expect(result.conclusiveFailure).toBe(true);
    const mounted = result.conclusiveFailures.find(
      (failure) => failure.metric === 'mountedNs'
    );
    expect(mounted).toBeDefined();
    expect(mounted.implementation).toBe('nitro-ui');
    // head(x/rn-core) / base(x/rn-core) = (220/100) / (110/100)
    expect(mounted.ratio).toBeCloseTo(2, 1);
    expect(mounted.ci.low).toBeGreaterThan(1.05);
  });

  it('never gates the reference arms', () => {
    // Expo gets twice as slow, nitro-ui does not move. An `@expo/ui` bump must
    // not fail a nitro-ui pull request (review S9).
    const result = gate({
      head: makeRun({
        'expo-ui-host-per-control': { mounted: 420_000 },
        'expo-ui-shared-host': { mounted: 160_000 },
      }),
      base: makeRun(),
    });
    expect(result.conclusiveFailure).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
    for (const failure of result.failures) {
      expect(failure.gated).toBe(false);
      expect(failure.implementation).not.toBe('nitro-ui');
    }
  });

  it('is not suppressed by control drift, and not triggered by it either', () => {
    // The exact failure mode of round 1: `rn-core` 5x slower in head. On its own
    // that is machine state, not a regression...
    const drifted = makeRun({
      'rn-core': {
        jsCommit: 200_000,
        mounted: 500_000,
        presented: 650_000,
        jsCpuPerOp: 100_000,
        mainCpuPerOp: 75_000,
      },
    });
    expect(gate({ head: drifted, base: makeRun() }).conclusiveFailure).toBe(
      false
    );

    // ...but it must not be able to excuse a real 2x regression either. Same
    // drift, plus nitro-ui doubled *relative to the drifted control*.
    const driftedAndSlower = makeRun({
      'rn-core': {
        jsCommit: 200_000,
        mounted: 500_000,
        presented: 650_000,
        jsCpuPerOp: 100_000,
        mainCpuPerOp: 75_000,
      },
      'nitro-ui': {
        jsCommit: 80_000,
        mounted: 1_100_000,
        presented: 1_300_000,
        jsCpuPerOp: 40_000,
        mainCpuPerOp: 30_000,
      },
    });
    const result = gate({ head: driftedAndSlower, base: makeRun() });
    expect(result.conclusiveFailure).toBe(true);
    expect(
      result.conclusiveFailures.some(
        (failure) =>
          failure.implementation === 'nitro-ui' &&
          failure.metric === 'mountedNs'
      )
    ).toBe(true);
  });

  it('suppresses a cell that was noisy inside its own run, and only that cell', () => {
    const result = gate({
      // nitro-ui doubled AND bounced around launch to launch; the unmount CPU of
      // the same arm doubled too, quietly, and must stay conclusive.
      head: makeRun({
        'nitro-ui': { mounted: 220_000, presented: 260_000, spread: true },
      }),
      base: makeRun(),
    });
    const mounted = result.failures.find(
      (failure) =>
        failure.implementation === 'nitro-ui' && failure.metric === 'mountedNs'
    );
    expect(mounted).toBeDefined();
    expect(mounted.overThreshold).toBe(true);
    expect(mounted.noisy).toBe(true);
    expect(mounted.conclusive).toBe(false);
    expect(result.conclusiveFailure).toBe(false);

    const noise = noiseTable(
      ratioTable(makeRun({ 'nitro-ui': { spread: true } }))
    );
    expect(noise['mount:nitro-ui:50'].metrics.mountedNs.noisy).toBe(true);
    expect(noise['mount:rn-core:50'].metrics.mountedNs).toBeUndefined();
  });

  it('sees a costlier teardown as its own metric', () => {
    // Review S5: mount and unmount used to share one CPU bracket, so a slower
    // teardown was reported as a slower mount.
    const result = gate({
      head: makeRun({ 'nitro-ui': { unmountMainCpuPerOp: 24_000 } }),
      base: makeRun(),
    });
    expect(result.conclusiveFailure).toBe(true);
    const failure = result.conclusiveFailures[0];
    expect(failure.metric).toBe('unmountMainNsPerOp');
    expect(failure.ratio).toBeCloseTo(3, 1);
  });

  it('gates a monotonic leak climb, and ignores a wobble', () => {
    const leaky = gate({
      head: leakRun({ rnCore: 1_000, nitroUi: 9_000 }),
      base: leakRun({ rnCore: 1_000, nitroUi: 1_000 }),
    });
    expect(leaky.conclusiveFailure).toBe(true);
    expect(
      leaky.conclusiveFailures.some(
        (failure) => failure.metric === 'leakSlopeBytesPerCycle'
      )
    ).toBe(true);

    // A slope fitted over a series that is not climbing is not "a monotonic
    // increase" (§6's wording), so it is not comparable and cannot gate.
    const wobbling = aggregateRecords(
      memoryRecords({
        scenario: 'leak',
        implementation: 'nitro-ui',
        leakPerCycle: 9_000,
        wobble: true,
      }),
      { keepRaw: true }
    )['leak:nitro-ui:200'];
    expect(wobbling.memory.leakMonotonic).toBe(false);
    expect(comparableMetrics(wobbling)).not.toHaveProperty(
      'leakSlopeBytesPerCycle'
    );
  });

  it('is the same gate behind the standalone reporter (review S11)', () => {
    const noisyHead = makeRun({
      'nitro-ui': { mounted: 220_000, presented: 260_000, spread: true },
    });
    const noisy = comparisonSections({
      run: noisyHead,
      base: makeRun(),
      mode: 'compare',
      label: 'base',
    });
    expect(noisy.exitCode).toBe(0);
    expect(noisy.result.conclusiveFailure).toBe(false);

    const clear = comparisonSections({
      run: makeRun({ 'nitro-ui': { mounted: 220_000, presented: 260_000 } }),
      base: makeRun(),
      mode: 'compare',
      label: 'base',
    });
    expect(clear.exitCode).toBe(1);
    expect(clear.markdown).toContain('nitro-ui');
  });

  it('refuses to mint a baseline from a dirty, broken or busy machine', () => {
    const clean = {
      ...makeRun(),
      dirty: false,
      problems: [],
      machine: { cpuCount: 14, loadavg1: 2.5, quiet: true },
    };
    expect(baselineBlockers(clean)).toEqual([]);
    expect(
      baselineBlockers({ ...clean, dirty: true }).some((reason) =>
        reason.includes('dirty')
      )
    ).toBe(true);
    expect(
      baselineBlockers({ ...clean, problems: ['launch 2 ended early'] }).length
    ).toBeGreaterThan(0);
    expect(
      baselineBlockers({
        ...clean,
        machine: { cpuCount: 14, loadavg1: 12, quiet: false },
      }).some((reason) => reason.includes('load average'))
    ).toBe(true);
    expect(
      baselineBlockers({ ...clean, machine: { cpuCount: 14 } }).length
    ).toBeGreaterThan(0);
  });
});

/**
 * The same verdict through the shipped binary, so the exit code that CI keys on
 * is covered too - `run.mjs` uses the identical `comparisonSections()`.
 */
describe('bench report CLI', () => {
  const script = resolve(process.cwd(), 'scripts/bench/report.mjs');

  function fixture(overrides) {
    const run = makeRun(overrides);
    return {
      schemaVersion: SCHEMA_VERSION,
      platform: 'ios',
      plan: 'quick',
      deviceKey: 'ios27-sim-testdevice',
      startedAt: '2026-10-22T00:00:00.000Z',
      durationMs: 1000,
      problems: [],
      cells: run.cells,
    };
  }

  function report(headOverrides) {
    const dir = mkdtempSync(join(tmpdir(), 'bench-report-'));
    try {
      const headFile = join(dir, 'head.json');
      const baseFile = join(dir, 'base.json');
      writeFileSync(headFile, JSON.stringify(fixture(headOverrides)));
      writeFileSync(baseFile, JSON.stringify(fixture({})));
      const result = spawnSync(
        process.execPath,
        [script, headFile, '--compare', baseFile],
        {
          encoding: 'utf8',
          cwd: process.cwd(),
        }
      );
      return { ...result, markdown: renderMarkdown(fixture(headOverrides)) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('exits 1 when a nitro-ui arm regressed', () => {
    const result = report({
      'nitro-ui': { mounted: 220_000, presented: 260_000 },
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('nitro-ui');
    expect(result.stdout).toContain('FAIL');
    expect(result.markdown).toContain('presented');
  });

  it('exits 0 when the same comparison is inside the noise', () => {
    const result = report({
      'nitro-ui': { mounted: 220_000, presented: 260_000, spread: true },
    });
    expect(result.stdout).toContain('noisy');
    expect(result.status).toBe(0);
  });
});

describe('memory aggregation', () => {
  /**
   * Round 2 regression: the Android heap breakdown stored an undefined variable,
   * which killed the runner *after* it had measured 48 launches. iOS reports -1
   * for both heaps, so no iOS run - and no iOS-shaped fixture - ever reached that
   * line. Android has to be in the fixture for that to be worth testing.
   */
  it('folds the Android heap breakdown into per-instance bytes', () => {
    const n = 200;
    const cells = aggregateRecords(
      memoryRecords({
        implementation: 'rn-core',
        n,
        perInstance: 40_000,
        heaps: { native: 3_000, java: 2_000 },
      })
    );
    const memory = cells['memory:rn-core:200'].memory;

    // PSS moved 40 KB per instance, of which 5 KB is attributable to a heap.
    expect(memory.bytesPerInstance).toBeCloseTo(40_000, 0);
    expect(memory.nativeBytesPerInstance).toBeCloseTo(3_000, 0);
    expect(memory.javaBytesPerInstance).toBeCloseTo(2_000, 0);
    expect(memory.heapBreakdownLaunches).toBe(LAUNCHES);
    expect(memory.heapCollected).toBe(true);
  });

  it('leaves the heap breakdown null on iOS, where the probe reports -1', () => {
    const cells = aggregateRecords(
      memoryRecords({ implementation: 'rn-core', n: 200 })
    );
    const memory = cells['memory:rn-core:200'].memory;
    expect(memory.bytesPerInstance).toBeCloseTo(40_000, 0);
    expect(memory.nativeBytesPerInstance).toBeNull();
    expect(memory.javaBytesPerInstance).toBeNull();
  });
});

/**
 * Pure helpers for the benchmark runner and reporter.
 *
 * Nothing in here touches a device or spawns a process, so the math that decides
 * whether a PR is "slow" can be read on its own. The protocol implemented here
 * is `docs/research/setup-decisions.md` SS6 "Benchmarks and performance
 * guardrails".
 */

export const SCHEMA_VERSION = 1;
export const WARMUP_ITERATIONS = 5;
export const MEASURED_ITERATIONS = 20;
export const LAUNCHES_PER_CELL = 4;
export const LAUNCH_SETTLE_MS = 1000;

/** Fail a PR when head/base is over this ... */
export const RATIO_FAIL_THRESHOLD = 1.2;
/** ... and the bootstrap CI of that ratio excludes this (so tiny moves do not fail). */
export const RATIO_CI_EXCLUDES = 1.05;
/** `rn-core` is the control: if *it* moved more than this, nothing is trustworthy. */
export const CONTROL_DRIFT_THRESHOLD = 0.1;

export const IMPLEMENTATIONS = [
  'rn-core',
  'expo-ui-host-per-control',
  'expo-ui-shared-host',
  'nitro-ui',
];

/** Latency metrics, all nanoseconds, all smaller-is-better. */
export const LATENCY_METRICS = ['jsCommitNs', 'mountedNs', 'presentedNs'];

/**
 * Plans are lists of `scenario:N` cells. The implementation dimension is crossed
 * with these by `buildSchedule`; `nitro-ui` self-skips until a component
 * registers itself (bench/src/implementations/nitroUi.tsx).
 */
export const PLANS = {
  quick: [
    { scenario: 'mount', n: 50 },
    { scenario: 'update', n: 50 },
    { scenario: 'memory', n: 200 },
  ],
  full: [
    { scenario: 'mount', n: 1 },
    { scenario: 'mount', n: 50 },
    { scenario: 'mount', n: 200 },
    { scenario: 'update', n: 1 },
    { scenario: 'update', n: 50 },
    { scenario: 'memory', n: 200 },
    { scenario: 'leak', n: 200 },
  ],
};

/** `mount:rn-core:50` - the string one app launch is driven with. */
export function planString(scenario, implementation, n) {
  return `${scenario}:${implementation}:${n}`;
}

/** `mount:rn-core:50` - the key a cell of the results matrix is stored under. */
export function cellKey(scenario, implementation, n) {
  return planString(scenario, implementation, n);
}

export function parseCellKey(key) {
  const [scenario, implementation, n] = key.split(':');
  return { scenario, implementation, n: Number(n) };
}

/**
 * The launch schedule: `launches` passes over every cell, forward on even passes
 * and reversed on odd ones. That is the ABBA idea (nitro's own `performance.yml`
 * scheme) generalised to four implementations - whatever machine drift survives
 * a fresh process per cell then hits every implementation about evenly instead
 * of always the last one.
 */
export function buildSchedule({
  plan = 'quick',
  implementations = IMPLEMENTATIONS,
  launches = LAUNCHES_PER_CELL,
  only = null,
} = {}) {
  const cells = PLANS[plan];
  if (cells == null) {
    throw new Error(
      `Unknown plan "${String(plan)}" (expected ${Object.keys(PLANS).join(' or ')})`
    );
  }
  const wanted =
    only == null
      ? implementations
      : implementations.filter((name) => only.split(',').includes(name.trim()));
  if (wanted.length === 0) {
    throw new Error(
      `--only matched no implementation (known: ${IMPLEMENTATIONS.join(', ')})`
    );
  }

  const schedule = [];
  for (let launch = 0; launch < launches; launch++) {
    const order = launch % 2 === 0 ? wanted : [...wanted].reverse();
    for (const cell of cells) {
      for (const implementation of order) {
        schedule.push({
          scenario: cell.scenario,
          implementation,
          n: cell.n,
          launch,
        });
      }
    }
  }
  return schedule;
}

/* ---------------------------------- stats --------------------------------- */

export function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function median(values) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** Median absolute deviation - the robust spread reported next to each median. */
export function medianAbsoluteDeviation(values) {
  if (values.length === 0) {
    return null;
  }
  const centre = median(values);
  return median(values.map((value) => Math.abs(value - centre)));
}

export function p95(values) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(
    sorted.length,
    Math.max(1, Math.ceil(sorted.length * 0.95))
  );
  return sorted[rank - 1] ?? null;
}

/** Deterministic PRNG, so a bootstrap CI is reproducible for a given input. */
/* eslint-disable no-bitwise -- 32-bit mixing is the algorithm. */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/* eslint-enable no-bitwise */

function resample(values, random) {
  const out = [];
  for (let index = 0; index < values.length; index++) {
    out.push(values[Math.floor(random() * values.length)] ?? values[0] ?? 0);
  }
  return out;
}

function percentile(values, quantile) {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(sorted.length * quantile))
  );
  return sorted[rank] ?? null;
}

/**
 * 95% CI of `median(numerator) / median(denominator)`, resampling whole launches
 * (iterations inside one launch share a process, so they are not independent).
 *
 * Each argument is an array of per-launch sample arrays. Returns null when a
 * side has no samples: "no CI" must never be read as "no risk".
 */
export function bootstrapMedianRatio(
  numeratorLaunches,
  denominatorLaunches,
  { resamples = 2000, seed = 20261022 } = {}
) {
  const numerator = (numeratorLaunches ?? [])
    .filter((values) => Array.isArray(values) && values.length > 0)
    .map((values) => median(values));
  const denominator = (denominatorLaunches ?? [])
    .filter((values) => Array.isArray(values) && values.length > 0)
    .map((values) => median(values));
  if (numerator.length === 0 || denominator.length === 0) {
    return null;
  }
  const denCentre = median(denominator);
  const observed = denCentre === 0 ? null : median(numerator) / denCentre;
  if (!isNumber(observed)) {
    return null;
  }
  const random = mulberry32(seed);
  const ratios = [];
  for (let index = 0; index < resamples; index++) {
    const denSample = median(resample(denominator, random));
    if (denSample === 0) {
      continue;
    }
    const ratio = median(resample(numerator, random)) / denSample;
    if (isNumber(ratio)) {
      ratios.push(ratio);
    }
  }
  if (ratios.length === 0) {
    return null;
  }
  return {
    ratio: observed,
    low: percentile(ratios, 0.025),
    high: percentile(ratios, 0.975),
    launchSamples: numerator.length + denominator.length,
  };
}

/* -------------------------------- aggregate ------------------------------- */

function addAll(values) {
  const numbers = values.filter(isNumber);
  if (numbers.length === 0) {
    return null;
  }
  return numbers.reduce((total, value) => total + value, 0);
}

function leastSquaresSlope(points) {
  const count = points.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (const [x, y] of points) {
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const divisor = count * sumXX - sumX * sumX;
  return divisor === 0 ? null : (count * sumXY - sumX * sumY) / divisor;
}

function emptyCell(record) {
  return {
    scenario: record.scenario,
    implementation: record.implementation,
    n: record.n,
    skipReason: null,
    skipReasons: [],
    clock: null,
    platform: null,
    warmup: 0,
    measured: 0,
    latency: {
      jsCommitNs: new Map(),
      mountedNs: new Map(),
      presentedNs: new Map(),
    },
    cpu: new Map(),
    memory: new Map(),
  };
}

/** How many launches actually produced data for a cell (they can differ per metric). */
function distinctLaunches(cell) {
  const launches = new Set();
  for (const map of [...Object.values(cell.latency), cell.cpu, cell.memory]) {
    for (const launch of map.keys()) {
      launches.add(launch);
    }
  }
  return launches.size;
}

function summariseCell(key, cell) {
  const metrics = {};
  for (const metric of LATENCY_METRICS) {
    const perLaunch = [...cell.latency[metric].entries()].sort(
      (a, b) => a[0] - b[0]
    );
    const values = perLaunch.flatMap(([, list]) => list);
    metrics[metric] = {
      median: median(values),
      mad: medianAbsoluteDeviation(values),
      p95: p95(values),
      min: values.length === 0 ? null : Math.min(...values),
      max: values.length === 0 ? null : Math.max(...values),
      samples: values.length,
      launchMedians: perLaunch.map(([, list]) => median(list)),
    };
  }

  const cpuSamples = [...cell.cpu.values()];
  const cpu = {
    launches: cpuSamples.length,
    jsNsPerUpdate: median(
      cpuSamples.map((s) => s.jsNsPerUpdate).filter(isNumber)
    ),
    mainNsPerUpdate: median(
      cpuSamples.map((s) => s.mainNsPerUpdate).filter(isNumber)
    ),
    profilerMsPerUpdate: median(
      cpuSamples.map((s) => s.profilerMsPerUpdate).filter(isNumber)
    ),
    profilerTotalMs: addAll(cpuSamples.map((s) => s.profilerTotalMs)),
    launchJsNsPerUpdate: cpuSamples
      .map((s) => s.jsNsPerUpdate)
      .filter(isNumber),
    launchMainNsPerUpdate: cpuSamples
      .map((s) => s.mainNsPerUpdate)
      .filter(isNumber),
  };

  const perLaunchBytes = [];
  const slopes = [];
  const monotonic = [];
  for (const phases of cell.memory.values()) {
    if (isNumber(phases.empty) && isNumber(phases.full) && cell.n > 0) {
      perLaunchBytes.push((phases.full - phases.empty) / cell.n);
    }
    const cycles = Object.entries(phases)
      .filter(([phase]) => phase.startsWith('leak'))
      .map(([phase, bytes]) => [Number(phase.slice(4)), bytes])
      .filter(([, bytes]) => isNumber(bytes))
      .sort((a, b) => a[0] - b[0]);
    if (cycles.length >= 2) {
      slopes.push(leastSquaresSlope(cycles));
      monotonic.push(
        cycles.every(
          ([, bytes], index) =>
            index === 0 || bytes >= (cycles[index - 1]?.[1] ?? 0)
        )
      );
    }
  }

  return {
    key,
    scenario: cell.scenario,
    implementation: cell.implementation,
    n: cell.n,
    skipReason: cell.skipReason,
    skipReasons: cell.skipReasons,
    clock: cell.clock,
    platform: cell.platform,
    protocol: { warmup: cell.warmup, measured: cell.measured },
    launches: distinctLaunches(cell),
    metrics,
    cpu,
    memory: {
      bytesPerInstance: median(perLaunchBytes),
      bytesPerInstanceLaunches: perLaunchBytes.length,
      launchBytesPerInstance: perLaunchBytes,
      leakSlopeBytesPerCycle: median(slopes),
      leakMonotonic: monotonic.length === 0 ? null : monotonic.every(Boolean),
      leakLaunches: slopes.length,
    },
  };
}

/**
 * Fold every NDJSON record of a run into the results matrix.
 *
 * `launch` is the index the runner stamped when it merged the launches;
 * `warmup` iterations are dropped here - they exist to make the measured ones
 * honest, not to be reported.
 */
export function aggregateRecords(records, { keepRaw = false } = {}) {
  /** @type {Map<string, any>} */
  const cells = new Map();

  for (const record of records) {
    const key = cellKey(record.scenario, record.implementation, record.n);
    let cell = cells.get(key);
    if (cell == null) {
      cell = emptyCell(record);
      cells.set(key, cell);
    }

    if (record.kind === 'meta') {
      cell.warmup = Math.max(cell.warmup, record.warmup);
      cell.measured = Math.max(cell.measured, record.measured);
      cell.clock = record.probeClock;
      cell.platform = record.platform;
    } else if (record.kind === 'skip') {
      if (!cell.skipReasons.includes(record.reason)) {
        cell.skipReasons.push(record.reason);
      }
      cell.skipReason = cell.skipReasons[0] ?? 'unavailable';
    } else if (record.kind === 'iter' && !record.warmup) {
      for (const metric of LATENCY_METRICS) {
        const value = record[metric];
        if (isNumber(value)) {
          const bucket = cell.latency[metric].get(record.launch) ?? [];
          bucket.push(value);
          cell.latency[metric].set(record.launch, bucket);
        }
      }
    } else if (record.kind === 'cpu') {
      const perUpdate = (value) =>
        isNumber(value) && record.iterations > 0
          ? value / record.iterations
          : null;
      cell.cpu.set(record.launch, {
        jsNsPerUpdate: perUpdate(record.jsCpuNs),
        mainNsPerUpdate: perUpdate(record.mainCpuNs),
        profilerMsPerUpdate: perUpdate(record.profilerTotalMs),
        profilerTotalMs: record.profilerTotalMs,
      });
    } else if (record.kind === 'mem') {
      const phases = cell.memory.get(record.launch) ?? {};
      phases[record.phase] = record.footprintBytes;
      cell.memory.set(record.launch, phases);
    }
  }

  const out = {};
  for (const [key, cell] of cells) {
    const summary = summariseCell(key, cell);
    if (keepRaw) {
      // Kept only in `bench/results/*` (gitignored), so a `--compare` can
      // bootstrap over iterations instead of over 4 launch medians.
      summary.raw = {};
      for (const metric of LATENCY_METRICS) {
        summary.raw[metric] = Object.fromEntries(cell.latency[metric]);
      }
    }
    out[key] = summary;
  }
  return out;
}

/* --------------------------------- compare -------------------------------- */

/**
 * Metrics a cell contributes to a comparison: the three latencies, the two CPU
 * numbers, and bytes-per-instance for the memory scenario (skipped when the two
 * footprint samples came out equal or inverted - a 0/n ratio is noise, not a
 * result).
 */
export function comparableMetrics(cell) {
  const metrics = {};
  for (const metric of LATENCY_METRICS) {
    const value = cell.metrics?.[metric]?.median;
    if (isNumber(value) && value > 0) {
      metrics[metric] = value;
    }
  }
  if (isNumber(cell.cpu?.mainNsPerUpdate) && cell.cpu.mainNsPerUpdate > 0) {
    metrics.mainNsPerUpdate = cell.cpu.mainNsPerUpdate;
  }
  if (isNumber(cell.cpu?.jsNsPerUpdate) && cell.cpu.jsNsPerUpdate > 0) {
    metrics.jsNsPerUpdate = cell.cpu.jsNsPerUpdate;
  }
  if (
    cell.scenario === 'memory' &&
    isNumber(cell.memory?.bytesPerInstance) &&
    cell.memory.bytesPerInstance > 0
  ) {
    metrics.bytesPerInstance = cell.memory.bytesPerInstance;
  }
  return metrics;
}

/**
 * Head-vs-base ratios for every cell both runs measured.
 *
 * Takes a full results run or a bare `cells` map: `--check` compares against
 * baseline cells that have been normalised to the control, which no longer
 * belong to a run document.
 */
export function compareResults(base, head) {
  const baseCells = cellsFrom(base);
  const headCells = cellsFrom(head);
  const rows = [];
  for (const [key, headCell] of Object.entries(headCells)) {
    const baseCell = baseCells[key];
    if (baseCell == null) {
      rows.push({
        key,
        status: 'missing-base',
        head: headCell,
        base: null,
        perMetric: {},
      });
      continue;
    }
    const headMetrics = comparableMetrics(headCell);
    const baseMetrics = comparableMetrics(baseCell);
    const perMetric = {};
    for (const [metric, headValue] of Object.entries(headMetrics)) {
      const baseValue = baseMetrics[metric];
      if (!isNumber(baseValue) || baseValue === 0) {
        continue;
      }
      perMetric[metric] = {
        base: baseValue,
        head: headValue,
        ratio: headValue / baseValue,
      };
    }
    const skippedBoth =
      headCell.skipReason != null && baseCell.skipReason != null;
    rows.push({
      key,
      status: skippedBoth ? 'skipped-both' : 'ok',
      head: headCell,
      base: baseCell,
      perMetric,
    });
  }
  return rows;
}

/**
 * `rn-core` is measured in every run only to answer "was this machine behaving?".
 * If the control itself moved, nothing else in the run can be trusted, so the
 * answer to that question turns a failure into "noisy, inconclusive".
 */
export function controlDrift(base, head) {
  const findings = [];
  const baseCells = cellsFrom(base);
  const headCells = cellsFrom(head);
  for (const [key, headCell] of Object.entries(headCells)) {
    if (headCell.implementation !== 'rn-core') {
      continue;
    }
    const baseCell = baseCells[key];
    if (baseCell == null) {
      continue;
    }
    const headMetrics = comparableMetrics(headCell);
    const baseMetrics = comparableMetrics(baseCell);
    for (const [metric, headValue] of Object.entries(headMetrics)) {
      const baseValue = baseMetrics[metric];
      if (!isNumber(baseValue) || baseValue === 0) {
        continue;
      }
      const ratio = headValue / baseValue;
      if (Math.abs(ratio - 1) > CONTROL_DRIFT_THRESHOLD) {
        findings.push({ key, metric, base: baseValue, head: headValue, ratio });
      }
    }
  }
  return findings;
}

/**
 * The gate. Every metric over `RATIO_FAIL_THRESHOLD` is reported; it is only
 * *conclusive* (i.e. allowed to fail a job) when the bootstrap CI of the ratio
 * excludes `RATIO_CI_EXCLUDES`.
 */
export function gateFailures(comparison) {
  const failures = [];
  for (const row of comparison) {
    if (row.status !== 'ok') {
      continue;
    }
    for (const [metric, value] of Object.entries(row.perMetric)) {
      if (value.ratio <= RATIO_FAIL_THRESHOLD) {
        continue;
      }
      const ci = bootstrapMedianRatio(
        launchSamples(row.head, metric),
        launchSamples(row.base, metric)
      );
      failures.push({
        key: row.key,
        metric,
        ratio: value.ratio,
        base: value.base,
        head: value.head,
        ci,
        conclusive: ci != null && ci.low > RATIO_CI_EXCLUDES,
      });
    }
  }
  return failures;
}

/**
 * Per-launch samples for a comparison metric. Latencies keep their raw
 * iterations; CPU and memory only survive as one number per launch.
 */
export function launchSamples(cell, metric) {
  if (cell.raw?.[metric] != null) {
    return Object.values(cell.raw[metric]);
  }
  const raw = cell.metrics?.[metric]?.launchMedians;
  if (Array.isArray(raw)) {
    return raw.map((value) => [value]);
  }
  const scalar =
    metric === 'mainNsPerUpdate'
      ? cell.cpu?.launchMainNsPerUpdate
      : metric === 'jsNsPerUpdate'
        ? cell.cpu?.launchJsNsPerUpdate
        : cell.memory?.launchBytesPerInstance;
  return Array.isArray(scalar) ? scalar.map((value) => [value]) : [];
}

/* --------------------------------- format --------------------------------- */

export function formatNs(value) {
  if (!isNumber(value)) {
    return 'n/a';
  }
  const abs = Math.abs(value);
  if (abs >= 1e6) {
    return `${(value / 1e6).toFixed(2)} ms`;
  }
  if (abs >= 1e3) {
    return `${(value / 1e3).toFixed(2)} us`;
  }
  return `${Math.round(value)} ns`;
}

export function formatBytes(value) {
  if (!isNumber(value)) {
    return 'n/a';
  }
  const kib = value / 1024;
  return Math.abs(kib) >= 1024
    ? `${(kib / 1024).toFixed(1)} MiB`
    : `${kib.toFixed(1)} KiB`;
}

export function formatRatio(value) {
  return isNumber(value) ? `${value.toFixed(2)}x` : 'n/a';
}

export function formatMs(value) {
  return isNumber(value) ? `${value.toFixed(2)} ms` : 'n/a';
}

/** Markdown table with a header row, used by the report and the PR comment. */
export function markdownTable(header, rows) {
  const cells = (row) => row.map((cell) => String(cell ?? ''));
  const head = cells(header);
  const body = rows.map(cells);
  const widths = head.map((cell, index) =>
    Math.max(cell.length, ...body.map((row) => row[index]?.length ?? 0))
  );
  const line = (row) =>
    `| ${row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join(' | ')} |`;
  return [
    line(head),
    `| ${widths.map((width) => '-'.repeat(Math.max(3, width))).join(' | ')} |`,
    ...body.map(line),
  ].join('\n');
}

/* ------------------------------- baselines -------------------------------- */

/**
 * Divide every metric by the `rn-core` value for the same scenario and N.
 *
 * Absolute numbers drift with the OS build, the simulator image and whatever
 * else the machine is doing; a ratio to the control arm does not. That is why
 * committed baselines carry tolerances *only* on these ratios
 * (docs/research/setup-decisions.md SS6).
 */
export function normaliseToControl(cells) {
  const out = {};
  for (const [key, cell] of Object.entries(cells)) {
    const control = cells[`${cell.scenario}:rn-core:${cell.n}`];
    const copy = JSON.parse(JSON.stringify({ ...cell, metrics: {} }));
    delete copy.raw;
    copy.cpu = { ...cell.cpu };
    copy.memory = { ...cell.memory };

    // Pair by launch index rather than dividing two aggregates: a launch that
    // was slow for everyone then slows both arms equally.
    const paired = (cellSamples, controlSamples) => {
      const ratios = [];
      for (let index = 0; index < cellSamples.length; index++) {
        const base = controlSamples[index];
        const value = cellSamples[index];
        if (isNumber(value) && isNumber(base) && base !== 0) {
          ratios.push(value / base);
        }
      }
      return ratios;
    };

    for (const metric of LATENCY_METRICS) {
      const stats = cell.metrics?.[metric];
      const controlStats = control?.metrics?.[metric];
      if (stats?.median == null) {
        continue;
      }
      const perLaunch = paired(
        stats.launchMedians ?? [],
        controlStats?.launchMedians ?? []
      );
      copy.metrics[metric] = {
        median:
          perLaunch.length > 0
            ? median(perLaunch)
            : isNumber(controlStats?.median) && controlStats.median !== 0
              ? stats.median / controlStats.median
              : stats.median,
        mad: medianAbsoluteDeviation(perLaunch),
        p95: p95(perLaunch),
        samples: perLaunch.length,
        launchMedians: perLaunch,
      };
    }

    const scalarLaunches = (side, metric) =>
      metric === 'mainNsPerUpdate'
        ? (side.cpu?.launchMainNsPerUpdate ?? [])
        : metric === 'jsNsPerUpdate'
          ? (side.cpu?.launchJsNsPerUpdate ?? [])
          : metric === 'bytesPerInstance'
            ? (side.memory?.launchBytesPerInstance ?? [])
            : [];
    for (const metric of [
      'jsNsPerUpdate',
      'mainNsPerUpdate',
      'bytesPerInstance',
    ]) {
      if (!isNumber(copy.cpu?.[metric]) && !isNumber(copy.memory?.[metric])) {
        continue;
      }
      const perLaunch = paired(
        scalarLaunches(cell, metric),
        scalarLaunches(control, metric)
      );
      const fallbackRatio = (base) =>
        isNumber(base) && base !== 0
          ? (copy.cpu?.[metric] ?? copy.memory?.[metric]) / base
          : (copy.cpu?.[metric] ?? copy.memory?.[metric]);
      const target = isNumber(copy.cpu?.[metric]) ? copy.cpu : copy.memory;
      target[metric] =
        perLaunch.length > 0
          ? median(perLaunch)
          : fallbackRatio(
              metric === 'mainNsPerUpdate'
                ? control?.cpu?.mainNsPerUpdate
                : metric === 'jsNsPerUpdate'
                  ? control?.cpu?.jsNsPerUpdate
                  : control?.memory?.bytesPerInstance
            );
      if (metric === 'mainNsPerUpdate') {
        copy.cpu.launchMainNsPerUpdate = perLaunch;
      } else if (metric === 'jsNsPerUpdate') {
        copy.cpu.launchJsNsPerUpdate = perLaunch;
      } else {
        copy.memory.launchBytesPerInstance = perLaunch;
      }
    }
    copy.memory.bytesPerInstanceLaunches =
      copy.memory.bytesPerInstanceLaunches ?? 0;
    out[key] = copy;
  }
  return out;
}

/** Strip per-iteration arrays so a committed baseline stays reviewable. */
export function trimCells(cells) {
  return Object.fromEntries(
    Object.entries(cells).map(([key, cell]) => {
      const copy = { ...cell };
      delete copy.raw;
      return [key, copy];
    })
  );
}

/** Accept both a full results run and a bare `cells` map. */
export function cellsFrom(run) {
  return run.cells ?? run;
}

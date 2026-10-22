/**
 * Pure helpers for the benchmark runner and reporter.
 *
 * Nothing in here touches a device or spawns a process, so the math that decides
 * whether a PR is "slow" can be read on its own. The protocol implemented here
 * is `docs/research/setup-decisions.md` SS6 "Benchmarks and performance
 * guardrails".
 */

export const SCHEMA_VERSION = 2;
export const WARMUP_ITERATIONS = 5;
export const MEASURED_ITERATIONS = 20;
export const LAUNCHES_PER_CELL = 4;
export const LAUNCH_SETTLE_MS = 1000;

/** Fail a run when the control-normalised head/base ratio is over this ... */
export const RATIO_FAIL_THRESHOLD = 1.2;
/** ... and the bootstrap CI of that ratio excludes this (so tiny moves do not fail). */
export const RATIO_CI_EXCLUDES = 1.05;
/**
 * Above this, a control metric's head/base movement is *mentioned* in the report
 * as machine context. It never suppresses a verdict (T02 review B1).
 */
export const CONTROL_NOTE_THRESHOLD = 0.1;
/**
 * Within-run noise limit, as the MAD of the launch-paired ratio divided by its
 * median (docs/DECISIONS.md D9). Judged per (scenario, N, metric): a cell that
 * bounced around inside one run cannot be attributed to a code change, and a
 * cell that was stable stays conclusive even when another cell was noisy.
 */
export const NOISE_REL_SPREAD = 0.1;
/**
 * A machine is "unquiet" above 0.5 x core count (D9): a busy laptop may produce
 * readable same-run ratios but must never mint a committed baseline.
 */
export const UNQUIET_LOAD_RATIO = 0.5;

/**
 * Only the implementation under development is gated. `expo-ui-*` are reference
 * arms: an `@expo/ui` bump must not fail a nitro-ui PR, and `rn-core` is the
 * control. They are measured and reported, never gated (T02 review S9).
 */
export const GATED_IMPLEMENTATIONS = ['nitro-ui'];

export const IMPLEMENTATIONS = [
  'rn-core',
  'expo-ui-host-per-control',
  'expo-ui-shared-host',
  'nitro-ui',
];

/** Latency metrics, all nanoseconds, all smaller-is-better. */
export const LATENCY_METRICS = ['jsCommitNs', 'mountedNs', 'presentedNs'];

/**
 * Per-op CPU metrics. Named "per op" because the op is a mount+teardown cycle in
 * the `mount` scenario and a prop update in the `update` scenario (T02 review
 * S5 asked for the mount and the unmount to stop sharing one bracket).
 */
export const CPU_METRICS = ['jsNsPerOp', 'mainNsPerOp', 'unmountMainNsPerOp'];

/** Footprint and leak metrics. */
export const MEMORY_METRICS = ['bytesPerInstance', 'leakSlopeBytesPerCycle'];

/** Everything that can be normalised to `rn-core` and gated. */
export const GATE_METRICS = [
  ...LATENCY_METRICS,
  ...CPU_METRICS,
  ...MEMORY_METRICS,
];

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
 * 95% CI of `median(head) / median(base)` where both sides are **launch-paired
 * ratios** (`arm launch median / rn-core launch median` for the same launch
 * index), so machine drift cancels the way it does in the point estimate.
 *
 * Two sampling modes, both honest about what they resample:
 *
 * - **hierarchical** - when a side has its per-launch iterations, resample
 *   launches first and then iterations inside each sampled launch (iterations in
 *   one launch share a process, so they are not independent).
 * - **launch-level** - a committed baseline only stores the per-launch paired
 *   ratios, so that side resamples those.
 *
 * Returns null when a side has no samples: "no CI" must never read as "no risk".
 */
export function bootstrapComparisonRatio(
  head,
  base,
  { resamples = 4000, seed = 20261022 } = {}
) {
  const headRatios = (head?.launchRatios ?? []).filter(isNumber);
  const baseRatios = (base?.launchRatios ?? []).filter(isNumber);
  if (headRatios.length === 0 || baseRatios.length === 0) {
    return null;
  }
  const centre = (values) => {
    const m = median(values);
    return m === 0 ? null : m;
  };
  const observed = (() => {
    const b = centre(baseRatios);
    return b === null ? null : centre(headRatios) / b;
  })();
  if (!isNumber(observed)) {
    return null;
  }
  const sideValue = (side, ratios, random) => {
    const arm = side?.arm ?? null;
    const control = side?.control ?? null;
    const paired = [];
    for (let index = 0; index < ratios.length; index++) {
      const launch = Math.floor(random() * ratios.length);
      const armValues = arm?.[launch];
      const controlValues = control?.[launch];
      if (
        Array.isArray(armValues) &&
        armValues.length > 0 &&
        Array.isArray(controlValues) &&
        controlValues.length > 0
      ) {
        const den = median(resample(controlValues, random));
        if (den === 0) {
          continue;
        }
        paired.push(median(resample(armValues, random)) / den);
      } else {
        paired.push(ratios[launch] ?? 0);
      }
    }
    return paired.length > 0 ? median(paired) : null;
  };
  const random = mulberry32(seed);
  const ratios = [];
  for (let index = 0; index < resamples; index++) {
    const headValue = sideValue(head, headRatios, random);
    const baseValue = sideValue(base, baseRatios, random);
    if (headValue == null || baseValue == null || baseValue === 0) {
      continue;
    }
    const ratio = headValue / baseValue;
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
    launchSamples: headRatios.length + baseRatios.length,
    hierarchical: head?.arm != null && base?.arm != null,
  };
}

/* -------------------------------- aggregate ------------------------------- */

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
    /** `mount` = the timed op, `unmount` = the teardown that precedes it. */
    cpu: { mount: new Map(), unmount: new Map() },
    memory: new Map(),
    sanity: {
      missingMount: 0,
      missingPresented: 0,
      presentedBeforeMount: 0,
      mountBeforeCommit: 0,
    },
  };
}

/** How many launches actually produced data for a cell (they can differ per metric). */
function distinctLaunches(cell) {
  const launches = new Set();
  for (const map of [
    ...Object.values(cell.latency),
    cell.cpu.mount,
    cell.cpu.unmount,
    cell.memory,
  ]) {
    for (const launch of map.keys()) {
      launches.add(launch);
    }
  }
  return launches.size;
}

/**
 * One cell's numbers.
 *
 * `median`/`mad` are the median and MAD **of the per-launch medians** - the
 * "median of medians" the protocol promises - so a launch is the unit of
 * variation, which matches how the launches are interleaved and how the gate
 * bootstraps. `p95`/`min`/`max` stay pooled over iterations because a tail
 * latency only shows up in the pooled distribution.
 */
function summariseCell(key, cell) {
  const metrics = {};
  for (const metric of LATENCY_METRICS) {
    const perLaunch = [...cell.latency[metric].entries()].sort(
      (a, b) => a[0] - b[0]
    );
    const values = perLaunch.flatMap(([, list]) => list);
    const launchMedians = perLaunch.map(([, list]) => median(list));
    metrics[metric] = {
      median: median(launchMedians),
      mad: medianAbsoluteDeviation(launchMedians),
      p95: p95(values),
      min: values.length === 0 ? null : Math.min(...values),
      max: values.length === 0 ? null : Math.max(...values),
      samples: values.length,
      launchMedians,
    };
  }

  const cpuPhase = (samples) => {
    const perUpdate = (pick) =>
      median(samples.map((s) => pick(s)).filter(isNumber));
    const launches = (pick) => samples.map((s) => pick(s)).filter(isNumber);
    return {
      launches: samples.length,
      jsNsPerOp: perUpdate((s) => s.jsNsPerOp),
      mainNsPerOp: perUpdate((s) => s.mainNsPerOp),
      launchJsNsPerOp: launches((s) => s.jsNsPerOp),
      launchMainNsPerOp: launches((s) => s.mainNsPerOp),
    };
  };
  const mount = cpuPhase([...cell.cpu.mount.values()]);
  const unmount = cpuPhase([...cell.cpu.unmount.values()]);
  const cpu = {
    launches: mount.launches,
    jsNsPerOp: mount.jsNsPerOp,
    mainNsPerOp: mount.mainNsPerOp,
    launchJsNsPerOp: mount.launchJsNsPerOp,
    launchMainNsPerOp: mount.launchMainNsPerOp,
    unmountLaunches: unmount.launches,
    unmountMainNsPerOp: unmount.mainNsPerOp,
    launchUnmountMainNsPerOp: unmount.launchMainNsPerOp,
  };

  const perLaunchBytes = [];
  const slopes = [];
  const launchSlopes = [];
  const monotonic = [];
  const heapCollected = [];
  const perLaunchNative = [];
  const perLaunchJava = [];
  for (const phases of cell.memory.values()) {
    if (isNumber(phases.empty) && isNumber(phases.full) && cell.n > 0) {
      perLaunchBytes.push((phases.full - phases.empty) / cell.n);
    }
    if (typeof phases.heapCollected === 'boolean') {
      heapCollected.push(phases.heapCollected);
    }
    for (const [heapKey, bucket] of [
      ['nativeHeap', perLaunchNative],
      ['javaHeap', perLaunchJava],
    ]) {
      const breakdown = phases[heapKey];
      if (
        breakdown != null &&
        isNumber(breakdown.empty) &&
        isNumber(breakdown.full) &&
        cell.n > 0
      ) {
        bucket.push((breakdown.full - breakdown.empty) / cell.n);
      }
    }
    const cycles = Object.entries(phases)
      .filter(([phase]) => phase.startsWith('leak'))
      .map(([phase, bytes]) => [Number(phase.slice(4)), bytes])
      .filter(([, bytes]) => isNumber(bytes))
      .sort((a, b) => a[0] - b[0]);
    if (cycles.length >= 2) {
      const slope = leastSquaresSlope(cycles);
      if (isNumber(slope)) {
        slopes.push(slope);
        launchSlopes.push(slope);
      }
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
      launchLeakSlopeBytesPerCycle: launchSlopes,
      leakMonotonic: monotonic.length === 0 ? null : monotonic.every(Boolean),
      leakLaunches: slopes.length,
      /** Whether `globalThis.gc()` existed, so the heap really was collected. */
      heapCollected:
        heapCollected.length === 0 ? null : heapCollected.every(Boolean),
      /**
       * Where the per-instance bytes actually live (review S8): `Debug
       * .getNativeHeapAllocatedSize()` and Java-heap-used deltas on Android,
       * `null` on iOS, where `phys_footprint` already attributes the native heap
       * to the process. Reported, deliberately **not gated** - `bytesPerInstance`
       * is the memory verdict, these two explain it (the Expo arms have measured
       * below `rn-core` on PSS, which is only believable with a breakdown).
       */
      nativeBytesPerInstance: median(perLaunchNative),
      javaBytesPerInstance: median(perLaunchJava),
      heapBreakdownLaunches: perLaunchNative.length,
    },
    /**
     * Cross-checks on the native signals (T02 review S2): `presented` is a frame
     * stamp, so `presented < mounted` or `mounted < jsCommit` means a signal
     * arrived out of order and the reader must not trust the latency pair.
     */
    sanity: cell.sanity,
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
      if (record.mountedNs == null) {
        cell.sanity.missingMount += 1;
      }
      if (record.presentedNs == null) {
        cell.sanity.missingPresented += 1;
      }
      if (
        isNumber(record.presentedNs) &&
        isNumber(record.mountedNs) &&
        record.presentedNs < record.mountedNs
      ) {
        cell.sanity.presentedBeforeMount += 1;
      }
      if (
        isNumber(record.mountedNs) &&
        isNumber(record.jsCommitNs) &&
        record.mountedNs < record.jsCommitNs
      ) {
        cell.sanity.mountBeforeCommit += 1;
      }
    } else if (record.kind === 'cpu') {
      const phase = record.phase === 'unmount' ? 'unmount' : 'mount';
      const perUpdate = (value) =>
        isNumber(value) && record.iterations > 0
          ? value / record.iterations
          : null;
      cell.cpu[phase].set(record.launch, {
        jsNsPerOp: perUpdate(record.jsCpuNs),
        mainNsPerOp: perUpdate(record.mainCpuNs),
      });
    } else if (record.kind === 'mem') {
      const phases = cell.memory.get(record.launch) ?? {};
      phases[record.phase] = record.footprintBytes;
      if (typeof record.heapCollected === 'boolean') {
        phases.heapCollected = record.heapCollected;
      }
      // Heap breakdown, kept per phase so the same empty/full delta that gives
      // `bytesPerInstance` can be attributed to a heap (review S8). iOS reports
      // -1 for both, which stays `null` here rather than becoming a number.
      for (const [heapKey, bytes] of [
        ['nativeHeap', record.nativeHeapBytes],
        ['javaHeap', record.javaHeapBytes],
      ]) {
        if (isNumber(bytes) && bytes >= 0) {
          const breakdown = (phases[heapKey] ??= {});
          breakdown[record.phase] = value;
        }
      }
      cell.memory.set(record.launch, phases);
    }
  }

  const out = {};
  for (const [key, cell] of cells) {
    const summary = summariseCell(key, cell);
    if (keepRaw) {
      // Kept only in `bench/results/*` (gitignored), so a `--compare` can run a
      // hierarchical bootstrap (launches, then iterations inside each launch).
      summary.raw = {};
      for (const metric of LATENCY_METRICS) {
        summary.raw[metric] = Object.fromEntries(cell.latency[metric]);
      }
    }
    out[key] = summary;
  }
  return out;
}

/* ------------------------- ratios to the control arm ------------------------ */

/**
 * Metrics a cell contributes to a comparison. Smaller is better for all of them,
 * and each must be a positive number to mean anything.
 *
 * The leak slope only counts when the footprint actually climbed monotonically:
 * §6 of setup-decisions asks to "fail on a monotonic increase", and a slope from
 * a wobbling series is not an increase (T02 review S8 - it used to be printed
 * and never gated).
 */
export function comparableMetrics(cell) {
  const metrics = {};
  for (const metric of LATENCY_METRICS) {
    const value = cell.metrics?.[metric]?.median;
    if (isNumber(value) && value > 0) {
      metrics[metric] = value;
    }
  }
  for (const [metric, value] of [
    ['jsNsPerOp', cell.cpu?.jsNsPerOp],
    ['mainNsPerOp', cell.cpu?.mainNsPerOp],
    ['unmountMainNsPerOp', cell.cpu?.unmountMainNsPerOp],
    ['bytesPerInstance', cell.memory?.bytesPerInstance],
    ['leakSlopeBytesPerCycle', cell.memory?.leakSlopeBytesPerCycle],
  ]) {
    if (!isNumber(value) || value <= 0) {
      continue;
    }
    if (
      metric === 'leakSlopeBytesPerCycle' &&
      cell.memory?.leakMonotonic !== true
    ) {
      continue;
    }
    metrics[metric] = value;
  }
  return metrics;
}

/**
 * Per-launch samples of one metric: an array of iterations per launch for the
 * latency metrics (raw is kept in `bench/results/*` only), otherwise a one-value
 * array per launch.
 */
export function launchValues(cell, metric) {
  if (cell == null) {
    return null;
  }
  const raw = cell.raw?.[metric];
  if (raw != null) {
    const perLaunch = Object.values(raw)
      .filter((values) => Array.isArray(values) && values.length > 0)
      .map((values) => values.filter(isNumber));
    return perLaunch.length > 0 ? perLaunch : null;
  }
  const single = {
    jsCommitNs: () => cell.metrics?.jsCommitNs?.launchMedians,
    mountedNs: () => cell.metrics?.mountedNs?.launchMedians,
    presentedNs: () => cell.metrics?.presentedNs?.launchMedians,
    jsNsPerOp: () => cell.cpu?.launchJsNsPerOp,
    mainNsPerOp: () => cell.cpu?.launchMainNsPerOp,
    unmountMainNsPerOp: () => cell.cpu?.launchUnmountMainNsPerOp,
    bytesPerInstance: () => cell.memory?.launchBytesPerInstance,
    leakSlopeBytesPerCycle: () => cell.memory?.launchLeakSlopeBytesPerCycle,
  }[metric];
  const values = single?.();
  if (!Array.isArray(values)) {
    return null;
  }
  const filtered = values.filter(isNumber).map((value) => [value]);
  return filtered.length > 0 ? filtered : null;
}

/**
 * Launch-paired ratio of one cell against the `rn-core` cell of the same
 * scenario and N: launch `L`'s arm median over launch `L`'s control median.
 *
 * Pairing by launch index is the whole point - the launches are interleaved
 * ABBA across implementations, so whatever the machine did during launch 2
 * affected both arms. Dividing two pooled medians instead would keep that drift.
 */
export function pairedLaunchRatios(cell, control, metric) {
  const arm = launchValues(cell, metric);
  const base = launchValues(control, metric);
  if (arm == null || base == null) {
    return { launchRatios: [], arm, control: base };
  }
  const launchRatios = [];
  for (let index = 0; index < arm.length; index++) {
    const denominator = median(base[index] ?? []);
    const numerator = median(arm[index] ?? []);
    if (isNumber(numerator) && isNumber(denominator) && denominator > 0) {
      launchRatios.push(numerator / denominator);
    }
  }
  return { launchRatios, arm, control: base };
}

/**
 * Divide every metric by the `rn-core` value for the same scenario and N.
 *
 * Absolute numbers drift with the OS build, the simulator image and whatever
 * else the machine is doing; a launch-paired ratio to the control arm does not.
 * That is why committed baselines carry ratios only (docs/DECISIONS.md D9).
 */
export function ratioTable(source) {
  const cells = cellsFrom(source);
  const out = {};
  for (const [key, cell] of Object.entries(cells)) {
    const entry = {
      key,
      scenario: cell.scenario,
      implementation: cell.implementation,
      n: cell.n,
      skipReason: cell.skipReason ?? null,
      metrics: {},
    };
    out[key] = entry;
    if (cell.skipReason != null) {
      continue;
    }
    const control =
      cell.implementation === 'rn-core'
        ? cell
        : cells[`${cell.scenario}:rn-core:${cell.n}`];
    if (control == null) {
      continue;
    }
    for (const metric of Object.keys(comparableMetrics(cell))) {
      if (cell.implementation === 'rn-core') {
        entry.metrics[metric] = {
          ratio: 1,
          launchRatios: [1],
          samples: 1,
          control: true,
        };
        continue;
      }
      const { launchRatios, arm } = pairedLaunchRatios(cell, control, metric);
      const ratio = median(launchRatios);
      if (!isNumber(ratio)) {
        continue;
      }
      entry.metrics[metric] = {
        ratio,
        launchRatios,
        samples: launchRatios.length,
        iterationsPerLaunch: arm ?? undefined,
      };
    }
  }
  return out;
}

/**
 * Within-run noise of a ratio table, per cell and metric: the MAD of the
 * launch-paired ratios over their median (D9). `rn-core` itself is 1.0 by
 * construction, so the spread of *every other arm's* paired ratio is the honest
 * answer to "how much did this machine move while measuring this cell?".
 */
export function noiseTable(table) {
  const out = {};
  for (const [key, entry] of Object.entries(table)) {
    const metrics = {};
    for (const [metric, value] of Object.entries(entry.metrics)) {
      if (value.control === true) {
        continue;
      }
      const spread = medianAbsoluteDeviation(value.launchRatios ?? []);
      const centre = median(value.launchRatios ?? []);
      const relSpread =
        isNumber(spread) && isNumber(centre) && centre > 0
          ? spread / centre
          : null;
      metrics[metric] = {
        relSpread,
        noisy: relSpread == null || relSpread > NOISE_REL_SPREAD,
      };
    }
    out[key] = { key, metrics };
  }
  return out;
}

/**
 * How much the `rn-core` control moved between two runs, per cell and metric.
 *
 * Informational only. It used to suppress the whole run when any single control
 * metric drifted, which - measured on absolute numbers between two sessions -
 * happened almost every time and made `--check` structurally unable to fail
 * (T02 review B1). Noise is judged within the run instead (see `noiseTable`).
 */
export function controlMovement(base, head) {
  const baseCells = cellsFrom(base);
  const headCells = cellsFrom(head);
  const findings = [];
  for (const [key, headCell] of Object.entries(headCells)) {
    if (headCell.implementation !== 'rn-core' || headCell.skipReason != null) {
      continue;
    }
    const baseCell = baseCells[key];
    if (baseCell == null || baseCell.skipReason != null) {
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
      if (Math.abs(ratio - 1) > CONTROL_NOTE_THRESHOLD) {
        findings.push({ key, metric, base: baseValue, head: headValue, ratio });
      }
    }
  }
  return findings;
}

/* ---------------------------------- gate ---------------------------------- */

/**
 * The one gate (`T02 review S11`): `run.mjs` and `report.mjs` both call this, so
 * the standalone reporter cannot drift away from the runner again.
 *
 * Both sides arrive as **launch-paired ratios to `rn-core`**, so:
 *
 * - `--check` compares today's ratios with a committed ratio baseline;
 * - `--compare` compares head's ratios with base's ratios, i.e.
 *   `head(x/rn-core) / base(x/rn-core)`;
 * - noise is per (scenario, N, metric) inside each run, never a whole-run veto;
 * - only `nitro-ui` is gated: `expo-ui-*` stay reference arms (S9).
 */
export function gate({
  head,
  base,
  headTable = ratioTable(head),
  baseTable = ratioTable(base),
  headNoise = noiseTable(headTable),
  baseNoise = noiseTable(baseTable),
}) {
  const rows = [];
  const failures = [];
  for (const [key, headEntry] of Object.entries(headTable)) {
    const baseEntry = baseTable[key];
    if (baseEntry == null) {
      rows.push({
        key,
        implementation: headEntry.implementation,
        status: 'missing-base',
        perMetric: {},
      });
      continue;
    }
    if (headEntry.skipReason != null && baseEntry.skipReason != null) {
      rows.push({
        key,
        implementation: headEntry.implementation,
        status: 'skipped-both',
        perMetric: {},
      });
      continue;
    }
    const gated = GATED_IMPLEMENTATIONS.includes(headEntry.implementation);
    const perMetric = {};
    for (const [metric, headValue] of Object.entries(headEntry.metrics)) {
      const baseValue = baseEntry.metrics?.[metric];
      if (
        baseValue == null ||
        !isNumber(baseValue.ratio) ||
        baseValue.ratio === 0
      ) {
        continue;
      }
      const ratio = headValue.ratio / baseValue.ratio;
      const headNoisy = headNoise[key]?.metrics?.[metric]?.noisy === true;
      const baseNoisy = baseNoise[key]?.metrics?.[metric]?.noisy === true;
      const noisy = headNoisy || baseNoisy;
      const ci = bootstrapComparisonRatio(
        {
          launchRatios: headValue.launchRatios,
          arm: headValue.iterationsPerLaunch,
          control: (() => {
            const controlCell =
              headEntry.implementation === 'rn-core'
                ? null
                : cellsFrom(head)[
                    `${headEntry.scenario}:rn-core:${headEntry.n}`
                  ];
            return controlCell == null
              ? null
              : launchValues(controlCell, metric);
          })(),
        },
        {
          launchRatios: baseValue.launchRatios,
          arm:
            baseValue.iterationsPerLaunch ??
            launchValues(cellsFrom(base)[key], metric) ??
            undefined,
          control: (() => {
            const controlCell =
              baseEntry.implementation === 'rn-core'
                ? null
                : cellsFrom(base)[
                    `${baseEntry.scenario}:rn-core:${baseEntry.n}`
                  ];
            return controlCell == null
              ? null
              : launchValues(controlCell, metric);
          })(),
        }
      );
      const overThreshold = ratio > RATIO_FAIL_THRESHOLD;
      const conclusive =
        gated &&
        overThreshold &&
        !noisy &&
        ci != null &&
        isNumber(ci.low) &&
        ci.low > RATIO_CI_EXCLUDES;
      const detail = {
        base: baseValue.ratio,
        head: headValue.ratio,
        ratio,
        ci,
        noisy,
        headNoisy,
        baseNoisy,
        gated,
        overThreshold,
        conclusive,
        samples: headValue.samples,
      };
      perMetric[metric] = detail;
      if (overThreshold) {
        failures.push({
          key,
          metric,
          implementation: headEntry.implementation,
          ...detail,
        });
      }
    }
    rows.push({
      key,
      implementation: headEntry.implementation,
      status: headEntry.skipReason != null ? 'skipped' : 'ok',
      gated,
      perMetric,
    });
  }
  const conclusiveFailures = failures.filter((failure) => failure.conclusive);
  return {
    rows,
    failures,
    conclusiveFailures,
    conclusiveFailure: conclusiveFailures.length > 0,
    headNoise,
    baseNoise,
  };
}

/**
 * Whether a run may mint a committed baseline (D9 + T02 review S10): clean tree,
 * every launch completed, and an idle machine. `--force` overrides, loudly.
 */
export function baselineBlockers(run) {
  const reasons = [];
  if (run.dirty === true) {
    reasons.push(
      'the working tree is dirty (a baseline must be attributable to a commit)'
    );
  }
  if (Array.isArray(run.problems) && run.problems.length > 0) {
    reasons.push(
      `${String(run.problems.length)} launch(es) did not complete in this run`
    );
  }
  const machine = run.machine ?? {};
  if (isNumber(machine.loadavg1) && isNumber(machine.cpuCount)) {
    const ceiling = machine.cpuCount * UNQUIET_LOAD_RATIO;
    if (machine.loadavg1 > ceiling) {
      reasons.push(
        `the machine was busy: load average ${machine.loadavg1.toFixed(2)} over ${String(
          machine.cpuCount
        )} cores (ceiling ${ceiling.toFixed(1)})`
      );
    }
  } else if (machine.loadavg1 == null) {
    reasons.push('the run did not record a load average');
  }
  return reasons;
}

/**
 * Committed baselines are **ratio-only**: per cell and metric the launch-paired
 * ratio to `rn-core`, plus the within-run noise it was measured with. Absolute
 * numbers and trends belong in CI artifacts, not in git (D9).
 */
export function buildBaseline(run) {
  const table = ratioTable(run);
  const noise = noiseTable(table);
  const cells = {};
  for (const [key, entry] of Object.entries(table)) {
    cells[key] = {
      scenario: entry.scenario,
      implementation: entry.implementation,
      n: entry.n,
      skipReason: entry.skipReason,
      metrics: Object.fromEntries(
        Object.entries(entry.metrics).map(([metric, value]) => [
          metric,
          {
            ratio: value.ratio,
            launchRatios: value.launchRatios,
            samples: value.samples,
            noise: noise[key]?.metrics?.[metric]?.relSpread ?? null,
          },
        ])
      ),
      sanity: cellsFrom(run.cells)[key]?.sanity ?? null,
    };
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    platform: run.platform,
    deviceKey: run.deviceKey,
    deviceName: run.deviceName,
    sha: run.sha,
    plan: run.plan,
    launches: run.launches,
    updatedAt: run.createdAt,
    machine: run.machine ?? null,
    cells,
  };
}

/** A baseline from before D9 (absolute cells) cannot be gated against. */
export function isCompatibleBaseline(baseline) {
  return baseline?.schemaVersion === SCHEMA_VERSION && baseline.cells != null;
}

/**
 * Turn a ratio baseline back into the shape `gate` reads, so baseline and run go
 * through one implementation.
 */
export function baselineTable(baseline) {
  const out = {};
  for (const [key, cell] of Object.entries(baseline.cells)) {
    out[key] = {
      key,
      scenario: cell.scenario,
      implementation: cell.implementation,
      n: cell.n,
      skipReason: cell.skipReason ?? null,
      metrics: Object.fromEntries(
        Object.entries(cell.metrics).map(([metric, value]) => [
          metric,
          {
            ratio: value.ratio,
            launchRatios: value.launchRatios ?? [value.ratio],
            samples: value.samples ?? 1,
            control: cell.implementation === 'rn-core',
          },
        ])
      ),
    };
  }
  return out;
}

/** Noise recorded *with* the baseline, so `--check` honours both sides. */
export function baselineNoise(baseline) {
  const out = {};
  for (const [key, cell] of Object.entries(baseline.cells)) {
    const metrics = {};
    for (const [metric, value] of Object.entries(cell.metrics)) {
      const relSpread = value.noise;
      metrics[metric] = {
        relSpread: isNumber(relSpread) ? relSpread : null,
        noisy: !isNumber(relSpread) || relSpread > NOISE_REL_SPREAD,
      };
    }
    out[key] = { key, metrics };
  }
  return out;
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

export function formatSpread(value) {
  return isNumber(value) ? `${(value * 100).toFixed(1)}%` : 'n/a';
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

/* ------------------------------- file naming ------------------------------ */

/**
 * Results files are named `<sha>[-dirty]-<platform>-<run stamp>.json` so two
 * runs of the same commit never overwrite each other (T02 review S12), and a
 * dirty-tree run can never masquerade as the clean run of that commit.
 */
export function resultsFileName(
  sha,
  platform,
  when = new Date(),
  dirty = false
) {
  const stamp = when
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
  return `${sha}${dirty ? '-dirty' : ''}-${platform}-${stamp}.json`;
}

/** Newest matching results file name for a short sha, clean runs preferred. */
export function newestResultsName(names, sha, platform) {
  const escaped = sha.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped}(-dirty)?-${platform}-.+\\.json$`);
  const matches = names.filter((name) => pattern.test(name));
  const clean = matches.filter((name) => !name.includes('-dirty-'));
  const pool = clean.length > 0 ? clean : matches;
  return pool.sort().reverse()[0] ?? null;
}

/** Accept both a full results run and a bare `cells` map. */
export function cellsFrom(run) {
  return run?.cells ?? run ?? {};
}

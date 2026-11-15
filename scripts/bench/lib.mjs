/**
 * Pure helpers for the benchmark runner and reporter: nothing in here touches a
 * device or spawns a process.
 */

/**
 * The version of the **results file** a run writes and every reader accepts. A
 * results file is a machine-local artifact (`bench/results/`, gitignored), so
 * bumping this means "re-run the bench", never "migrate a committed file".
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
 * Above this, a control metric's head/base movement is mentioned in the report
 * as machine context. It never suppresses a verdict.
 */
export const CONTROL_NOTE_THRESHOLD = 0.1;
/**
 * Within-run noise limit, as the MAD of the launch-paired ratio divided by its
 * median. Judged per (scenario, N, metric): a cell that bounced around inside
 * one run cannot be attributed to a code change, and a cell that was stable
 * stays conclusive even when another cell was noisy.
 */
export const NOISE_REL_SPREAD = 0.1;
/**
 * With more than this share of a cell's samples missing, a metric is not
 * reportable: it prints `n/a` and is dropped from `comparableMetrics()`, so it
 * enters no ratio table and cannot be gated. A median over the iterations whose
 * signal happened to arrive is survivor-biased.
 */
export const MAX_MISSING_SAMPLE_RATIO = 0.1;
/**
 * A machine is "unquiet" above 0.5 x core count. The answer is reported with
 * every run - `machine.quiet` and the report's load line - because a busy host
 * still produces readable same-run ratios, just noisier ones.
 */
export const UNQUIET_LOAD_RATIO = 0.5;
/**
 * How often a running bench takes a load sample, in addition to the one at every
 * launch boundary.
 */
export const LOAD_SAMPLE_INTERVAL_MS = 30_000;
/**
 * How much of a run may sit over the ceiling before the run counts as busy: the
 * odd spike (a daemon, a Spotlight pass) is not the machine being busy for the run.
 */
export const LOAD_OVER_CEILING_FRACTION = 0.1;
/**
 * Only the implementation under development is gated. `expo-ui-*` are reference
 * arms: an `@expo/ui` bump must not fail a nitro-ui PR, and `rn-core` is the
 * control. They are measured and reported, never gated.
 */
export const GATED_IMPLEMENTATIONS = ['nitro-ui'];

/**
 * The arms that can report their *own* native perf marks (`bun bench
 * --perf-marks`). Only the library under development has a mark source
 * (`nitroUiCore.drainPerf()`), so a marks run narrows the matrix to these and
 * never pretends to instrument `@expo/ui` or `rn-core`.
 */
export const MARK_CAPABLE_IMPLEMENTATIONS = ['nitro-ui'];

export const IMPLEMENTATIONS = [
  'rn-core',
  'expo-ui-host-per-control',
  'expo-ui-shared-host',
  'nitro-ui',
  // nitro-ui's controls inside one shared `<Host>`. A reference arm like the two
  // `expo-ui-*` ones: measured and reported, never gated.
  'nitro-ui-host',
];

/**
 * The arms a baseline compares against rather than gates: the two `@expo/ui`
 * references. An incomplete metric on one of them leaves that one cell out of the
 * table and records it, and never withholds the whole table. `nitro-ui-host` is
 * not one of them: it is our own runtime, so a lost signal there is a fact about
 * nitro-ui, not about a third-party reference.
 */
export const COMPARISON_IMPLEMENTATIONS = IMPLEMENTATIONS.filter(
  (name) =>
    name !== 'nitro-ui' && name !== 'nitro-ui-host' && name !== 'rn-core'
);

/**
 * The default waiting rule, per platform. `bench/src/plan.ts` `BENCH_DEFAULT_TIMEOUTS`
 * must hold the same numbers: `scripts/` cannot import the app's TypeScript, and a
 * jest test fails if the two disagree.
 *
 * A run that waited anything other than its platform's default is a diagnostic: which
 * samples arrive changes the median, so its ratios are not comparable with a run
 * measured under a different rule. `maxRequestedTimeoutMs` stays below
 * `presentationCeilingMs`, the native backstop, because a backstop that answers first
 * records a timeout the run never asked for.
 */
export const DEFAULT_TIMEOUTS_MS = {
  ios: {
    mountTimeoutMs: 1500,
    presentedTimeoutMs: 8000,
    presentationCeilingMs: 90_000,
    maxRequestedTimeoutMs: 80_000,
  },
  android: {
    mountTimeoutMs: 1500,
    presentedTimeoutMs: 2000,
    presentationCeilingMs: 2_000,
    maxRequestedTimeoutMs: 1_900,
  },
};

/** The rule for one platform, or an error naming the ones that have a rule. */
export function defaultTimeoutsFor(platform) {
  const timeouts = DEFAULT_TIMEOUTS_MS[platform];
  if (timeouts == null) {
    throw new Error(
      `no default waiting rule for platform "${String(platform)}" (known: ${Object.keys(
        DEFAULT_TIMEOUTS_MS
      ).join(', ')})`
    );
  }
  return timeouts;
}

/**
 * The per-launch wall-clock budgets, by platform and scenario action, that `run.mjs`
 * starts from. Each must exceed what a launch of that platform can spend waiting under
 * its default rule. They live here because the runner cannot be imported under jest
 * (`import.meta`).
 */
export const DEFAULT_SCENARIO_BUDGETS = {
  ios: {
    mount: 300_000,
    update: 300_000,
    memory: 300_000,
    leak: 420_000,
  },
  android: {
    mount: 180_000,
    update: 180_000,
    memory: 180_000,
    leak: 300_000,
  },
};

/**
 * The wall-clock budget for one launch: the scenario's allowance, widened by any extra
 * waiting this launch was asked to do, so a launch that asked for longer waits is not
 * killed as stalled. `platform` is required because the two platforms wait different
 * amounts. With `overrideSeconds` (`BENCH_LAUNCH_TIMEOUT_S`) the budget is set by hand
 * and nothing is added.
 */
export function launchBudgetMs(
  entry,
  {
    platform,
    scenarioBudgets = DEFAULT_SCENARIO_BUDGETS,
    overrideSeconds = null,
  } = {}
) {
  const budgets = scenarioBudgets[platform];
  const defaults = defaultTimeoutsFor(platform);
  if (budgets == null) {
    throw new Error(
      `no launch budgets for platform "${String(platform)}" (known: ${Object.keys(
        scenarioBudgets
      ).join(', ')})`
    );
  }
  const base = budgets[scenarioActionOf(entry.scenario)] ?? 180_000;
  if (isNumber(overrideSeconds) && overrideSeconds > 0) {
    return base;
  }
  // 2 mount waits + 1 presented per iteration is the widest case (`mount`); `update`
  // waits twice and `memory`/`leak` not at all, so this only ever over-allows.
  const waitsFor = (mount, presented) => 2 * mount + presented;
  const asked = waitsFor(
    entry.mountTimeoutMs ?? defaults.mountTimeoutMs,
    entry.presentedTimeoutMs ?? defaults.presentedTimeoutMs
  );
  const standard = waitsFor(
    defaults.mountTimeoutMs,
    defaults.presentedTimeoutMs
  );
  return (
    base +
    Math.max(0, asked - standard) * (WARMUP_ITERATIONS + MEASURED_ITERATIONS)
  );
}

/**
 * The longest signal timeout a run may ask for on one platform (`--timeout-mount`,
 * `--timeout-presented`, and the `mountTimeout=`/`presentedTimeout=` launch flags).
 *
 * Both platforms arm a native backstop for a process that never draws at all, and a
 * backstop that wins the race would record a timeout the run never asked for. So the
 * requested wait stays strictly below that platform's ceiling: 90 s on iOS
 * (`kBenchPresentationCeilingSeconds`), 2 s on Android (`PRESENTATION_CEILING_MS`).
 */
export function maxRequestedTimeoutMsFor(platform) {
  return defaultTimeoutsFor(platform).maxRequestedTimeoutMs;
}

/**
 * `--timeout-mount <ms>` / `--timeout-presented <ms>`: how long each launch waits for a
 * native signal before recording it as missing, with the reason. The value rides the
 * launch string rather than an env var because a release build has no env. The cap is
 * the platform's (see `maxRequestedTimeoutMsFor`).
 *
 * Returns the problem rather than exiting, so a test can check the validation without
 * spawning a run.
 */
export function parseTimeoutFlags(argv, readFlag, platform) {
  const out = { mountTimeoutMs: null, presentedTimeoutMs: null, problem: null };
  const maxMs = maxRequestedTimeoutMsFor(platform);
  for (const [name, key] of [
    ['--timeout-mount', 'mountTimeoutMs'],
    ['--timeout-presented', 'presentedTimeoutMs'],
  ]) {
    if (!argv.includes(name)) {
      continue;
    }
    const raw = readFlag(name);
    const ms = raw == null ? Number.NaN : Number(raw);
    if (!Number.isFinite(ms) || ms < 1 || ms > maxMs) {
      out.problem = `${name} must be a number of milliseconds between 1 and ${String(
        maxMs
      )} on ${String(platform)} (that platform arms a ${String(
        defaultTimeoutsFor(platform).presentationCeilingMs
      )} ms native backstop, and one that answers first would record a wait the run never asked for)`;
      return out;
    }
    out[key] = ms;
  }
  return out;
}

/**
 * Arms that cannot mount a component on one platform, keyed
 * `platform:implementation:component`, so those cells are not scheduled there.
 *
 * `@expo/ui` on Android exposes no mountable date field, only the inline Material 3
 * `DateTimePicker` and whole dialogs. In a fit-its-content host the inline calendar's
 * month pager is measured with infinite width and the app crashes; with the width
 * bounded it prices a full-screen calendar against the compact field every other arm
 * renders.
 */
export const ARMS_WITHOUT_COMPONENT = [
  'android:expo-ui-host-per-control:date-picker',
  'android:expo-ui-shared-host:date-picker',
  // `@expo/ui`'s Compose surface has no stepper, because Material has none.
  'android:expo-ui-host-per-control:stepper',
  'android:expo-ui-shared-host:stepper',
];

/**
 * Arms that are scoped to a set of components, or to one platform and a set of
 * components, keyed by implementation name. `nitro-ui-host` composes only what a
 * `<Host>` can draw, and on iOS `<Host>` is a passthrough, so a cell there would price
 * "nitro-ui plus one extra `View`" under a name that promises a shared composition.
 *
 * The component scope applies whether or not the caller named a platform; the platform
 * scope only applies when one is named. `bench/src/implementations/index.ts` must list
 * the same components.
 */
export const ARM_SCOPES = {
  'nitro-ui-host': {
    components: [
      // @generated by scripts/gen-registry.mjs (region: host-arm-components) - do not edit; run bun run regen
      'switch',
      'slider',
      'progress',
      'button',
      'segmented-control',
      'picker',
      'date-picker',
      'menu',
      // @end-generated
    ],
    platform: 'android',
  },
};

/** Whether a scoped arm renders `component` at all, platform aside. */
export function armScopeCovers(implementation, component) {
  const scope = ARM_SCOPES[implementation];
  return scope == null || scope.components.includes(component);
}

/** Latency metrics, all nanoseconds, all smaller-is-better. */
export const LATENCY_METRICS = ['jsCommitNs', 'mountedNs', 'presentedNs'];

/**
 * Per-op CPU metrics. The op is a mount+teardown cycle in the `mount` scenario and
 * a prop update in the `update` scenario.
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
 * with these by `buildSchedule`.
 *
 * A cell's scenario carries its component: the bare name is Switch and
 * `<action>.<component>` is every other component. `componentOf` is the one
 * place that reads the encoding; `--component` filters on it.
 */
export const PLANS = {
  quick: [
    { scenario: 'mount', n: 50 },
    { scenario: 'update', n: 50 },
    { scenario: 'memory', n: 200 },
    { scenario: 'mount.slider', n: 50 },
    { scenario: 'update.slider', n: 50 },
    { scenario: 'memory.slider', n: 200 },
    { scenario: 'mount.button', n: 50 },
    { scenario: 'update.button', n: 50 },
    { scenario: 'memory.button', n: 200 },
    { scenario: 'mount.progress', n: 50 },
    { scenario: 'update.progress', n: 50 },
    { scenario: 'memory.progress', n: 200 },
    { scenario: 'mount.segmented-control', n: 50 },
    { scenario: 'update.segmented-control', n: 50 },
    { scenario: 'memory.segmented-control', n: 200 },
    { scenario: 'mount.date-picker', n: 50 },
    { scenario: 'update.date-picker', n: 50 },
    { scenario: 'memory.date-picker', n: 200 },
    { scenario: 'mount.picker', n: 50 },
    { scenario: 'update.picker', n: 50 },
    { scenario: 'memory.picker', n: 200 },
    { scenario: 'mount.menu', n: 50 },
    { scenario: 'update.menu', n: 50 },
    { scenario: 'memory.menu', n: 200 },
    { scenario: 'mount.text-field', n: 50 },
    { scenario: 'update.text-field', n: 50 },
    { scenario: 'memory.text-field', n: 200 },
    // Two `mount` cells: a Form's `n` is rows inside one container, and it is measured
    // at both 20 and 50.
    { scenario: 'mount.form', n: 20 },
    { scenario: 'mount.form', n: 50 },
    { scenario: 'update.form', n: 50 },
    { scenario: 'memory.form', n: 200 },
  ],
  full: [
    { scenario: 'mount', n: 1 },
    { scenario: 'mount', n: 50 },
    { scenario: 'mount', n: 200 },
    { scenario: 'update', n: 1 },
    { scenario: 'update', n: 50 },
    { scenario: 'memory', n: 200 },
    { scenario: 'leak', n: 200 },
    { scenario: 'mount.slider', n: 1 },
    { scenario: 'mount.slider', n: 50 },
    { scenario: 'mount.slider', n: 200 },
    { scenario: 'update.slider', n: 1 },
    { scenario: 'update.slider', n: 50 },
    { scenario: 'memory.slider', n: 200 },
    { scenario: 'leak.slider', n: 200 },
    { scenario: 'mount.button', n: 1 },
    { scenario: 'mount.button', n: 50 },
    { scenario: 'mount.button', n: 200 },
    { scenario: 'update.button', n: 1 },
    { scenario: 'update.button', n: 50 },
    { scenario: 'memory.button', n: 200 },
    { scenario: 'leak.button', n: 200 },
    { scenario: 'mount.progress', n: 1 },
    { scenario: 'mount.progress', n: 50 },
    { scenario: 'mount.progress', n: 200 },
    { scenario: 'update.progress', n: 1 },
    { scenario: 'update.progress', n: 50 },
    { scenario: 'memory.progress', n: 200 },
    { scenario: 'leak.progress', n: 200 },
    { scenario: 'mount.segmented-control', n: 1 },
    { scenario: 'mount.segmented-control', n: 50 },
    { scenario: 'mount.segmented-control', n: 200 },
    { scenario: 'update.segmented-control', n: 1 },
    { scenario: 'update.segmented-control', n: 50 },
    { scenario: 'memory.segmented-control', n: 200 },
    { scenario: 'leak.segmented-control', n: 200 },
    { scenario: 'mount.date-picker', n: 1 },
    { scenario: 'mount.date-picker', n: 50 },
    { scenario: 'mount.date-picker', n: 200 },
    { scenario: 'update.date-picker', n: 1 },
    { scenario: 'update.date-picker', n: 50 },
    { scenario: 'memory.date-picker', n: 200 },
    { scenario: 'leak.date-picker', n: 200 },
    { scenario: 'mount.picker', n: 1 },
    { scenario: 'mount.picker', n: 50 },
    { scenario: 'mount.picker', n: 200 },
    { scenario: 'update.picker', n: 1 },
    { scenario: 'update.picker', n: 50 },
    { scenario: 'memory.picker', n: 200 },
    { scenario: 'leak.picker', n: 200 },
    { scenario: 'mount.menu', n: 1 },
    { scenario: 'mount.menu', n: 50 },
    { scenario: 'mount.menu', n: 200 },
    { scenario: 'update.menu', n: 1 },
    { scenario: 'update.menu', n: 50 },
    { scenario: 'memory.menu', n: 200 },
    { scenario: 'leak.menu', n: 200 },
    { scenario: 'mount.text-field', n: 1 },
    { scenario: 'mount.text-field', n: 50 },
    { scenario: 'mount.text-field', n: 200 },
    { scenario: 'update.text-field', n: 1 },
    { scenario: 'update.text-field', n: 50 },
    { scenario: 'memory.text-field', n: 200 },
    { scenario: 'leak.text-field', n: 200 },
    // Form is a container, so its `n` is a row count inside one grouped list rather
    // than a count of mounted controls. There is no `n: 1` and no `n: 200` for
    // `mount`/`update`: a one-row Form is not a grouped list, and a 200-row one wants
    // a virtualised list. `memory`/`leak` keep `n: 200` because those cells measure
    // bytes per row, which wants a long batch to divide by.
    { scenario: 'mount.form', n: 20 },
    { scenario: 'mount.form', n: 50 },
    { scenario: 'update.form', n: 20 },
    { scenario: 'update.form', n: 50 },
    { scenario: 'memory.form', n: 200 },
    { scenario: 'leak.form', n: 200 },
  ],
};

/** The component a scenario cell belongs to: `mount.slider` -> `slider`. */
export function componentOf(scenario) {
  const dot = String(scenario).indexOf('.');
  return dot === -1 ? 'switch' : String(scenario).slice(dot + 1);
}

/** The action half of a scenario cell: `mount.slider` -> `mount`. */
export function scenarioActionOf(scenario) {
  const value = String(scenario);
  const dot = value.indexOf('.');
  return dot === -1 ? value : value.slice(0, dot);
}

/** The scenario cell for one component and action: `mount` + `slider` -> `mount.slider`. */
export function scenarioFor(action, component) {
  return component === 'switch' ? action : `${action}.${component}`;
}

/** `mount:rn-core:50` - the string one app launch is driven with. */
export function planString(scenario, implementation, n, flags = null) {
  const base = `${scenario}:${implementation}:${n}`;
  return flags == null || flags.length === 0
    ? base
    : `${base}:${flags.filter(Boolean).join(',')}`;
}

/**
 * The launch string for one schedule entry, including the `:marks` flag when the
 * entry asked for the runtime's own perf marks. A results *cell* key never carries
 * it (`cellKey`): a marks run is a diagnosis of the same cell, not another arm.
 */
export function launchPlanString(entry) {
  const flags = [];
  if (entry.perfMarks === true) {
    flags.push('marks');
  }
  if (isNumber(entry.mountTimeoutMs)) {
    flags.push(`mountTimeout=${String(entry.mountTimeoutMs)}`);
  }
  if (isNumber(entry.presentedTimeoutMs)) {
    flags.push(`presentedTimeout=${String(entry.presentedTimeoutMs)}`);
  }
  return planString(entry.scenario, entry.implementation, entry.n, flags);
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
 * and reversed on odd ones (ABBA), so whatever machine drift survives a fresh
 * process per cell hits every implementation about evenly instead of always the
 * last one.
 */
export function buildSchedule({
  plan = 'quick',
  implementations = IMPLEMENTATIONS,
  launches = LAUNCHES_PER_CELL,
  only = null,
  perfMarks = false,
  component = null,
  scenario = null,
  n = null,
  platform = null,
  mountTimeoutMs = null,
  presentedTimeoutMs = null,
} = {}) {
  const cells = PLANS[plan];
  if (cells == null) {
    throw new Error(
      `Unknown plan "${String(plan)}" (expected ${Object.keys(PLANS).join(' or ')})`
    );
  }
  // A `null` filter keeps every cell the plan has.
  const wantedCells = cells
    .filter(
      (cell) => component == null || componentOf(cell.scenario) === component
    )
    .filter(
      (cell) =>
        scenario == null ||
        cell.scenario === scenario ||
        cell.scenario.startsWith(`${scenario}.`)
    )
    .filter((cell) => n == null || cell.n === n);
  if (wantedCells.length === 0) {
    if (component != null) {
      throw new Error(
        `--component ${String(component)} matched no cell in plan "${String(plan)}" ` +
          `(components here: ${[...new Set(cells.map((cell) => componentOf(cell.scenario)))].join(', ')})`
      );
    }
    throw new Error(
      `--scenario ${String(scenario)}${n == null ? '' : ` with --n ${String(n)}`} matched no cell in plan "${String(plan)}" ` +
        `(cells here: ${[...new Set(cells.map((cell) => `${cell.scenario}@${String(cell.n)}`))].join(', ')})`
    );
  }
  let wanted =
    only == null
      ? implementations
      : implementations.filter((name) => only.split(',').includes(name.trim()));
  if (wanted.length === 0) {
    throw new Error(
      `--only matched no implementation (known: ${IMPLEMENTATIONS.join(', ')})`
    );
  }
  if (perfMarks) {
    // Only the library records marks, so a marks run measures nothing else.
    const marked = wanted.filter((name) =>
      MARK_CAPABLE_IMPLEMENTATIONS.includes(name)
    );
    if (marked.length === 0) {
      throw new Error(
        `--perf-marks needs an implementation with marks (${MARK_CAPABLE_IMPLEMENTATIONS.join(', ')}); asked for ${wanted.join(', ')}`
      );
    }
    wanted = marked;
  }
  // A scoped arm (see `ARM_SCOPES`) is not scheduled on another platform. It is
  // dropped here, before the cell loop, so it does not read as a measured arm with
  // a missing cell.
  wanted = wanted.filter((name) => {
    const scope = ARM_SCOPES[name];
    return (
      scope == null ||
      scope.platform == null ||
      platform == null ||
      scope.platform === platform
    );
  });
  if (wanted.length === 0) {
    // An explicit `--only` of a scoped arm on another platform would otherwise
    // launch nothing at all and exit green.
    throw new Error(
      `--only matched no implementation for platform ${String(platform)} ` +
        `(scoped arms: ${Object.entries(ARM_SCOPES)
          .map(
            ([name, scope]) =>
              `${name} = ${scope.platform} ${scope.components.join('/')}`
          )
          .join(', ')})`
    );
  }

  const schedule = [];
  for (let launch = 0; launch < launches; launch++) {
    const order = launch % 2 === 0 ? wanted : [...wanted].reverse();
    for (const cell of wantedCells) {
      for (const implementation of order) {
        if (!armScopeCovers(implementation, componentOf(cell.scenario))) {
          // The arm does not render this cell's component.
          continue;
        }
        if (
          platform != null &&
          ARMS_WITHOUT_COMPONENT.includes(
            `${platform}:${implementation}:${componentOf(cell.scenario)}`
          )
        ) {
          // This platform's arm cannot mount the component. A run with no `platform`
          // (a hand schedule, a test) still asks for every arm it was given.
          continue;
        }
        // Only a timeout the caller asked for goes on the launch string; otherwise
        // the app's own defaults apply.
        schedule.push({
          scenario: cell.scenario,
          implementation,
          n: cell.n,
          perfMarks: perfMarks === true,
          launch,
          ...(isNumber(mountTimeoutMs) ? { mountTimeoutMs } : {}),
          ...(isNumber(presentedTimeoutMs) ? { presentedTimeoutMs } : {}),
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
 * Two sampling modes:
 *
 * - **hierarchical** - when a side has its per-launch iterations, resample
 *   launches first and then iterations inside each sampled launch (iterations in
 *   one launch share a process, so they are not independent).
 * - **launch-level** - when a side has only the per-launch paired ratios, that
 *   side resamples those.
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
    /**
     * `false` when the arm told the runner its latency pair cannot exist
     * (`bench/src/plan.ts` `NO_MOUNT_SIGNAL`). Changes no number, only whether a
     * cell full of nulls is called a lost signal or an absent one.
     */
    mountSignal: true,
    latency: {
      jsCommitNs: new Map(),
      mountedNs: new Map(),
      presentedNs: new Map(),
    },
    /** `mount` = the timed op, `unmount` = the teardown that precedes it. */
    cpu: { mount: new Map(), unmount: new Map() },
    memory: new Map(),
    /** launch -> the `perf` records of that launch (marks runs only). */
    marks: new Map(),
    sanity: {
      missingMount: 0,
      missingPresented: 0,
      presentedBeforeMount: 0,
      mountBeforeCommit: 0,
    },
    /**
     * Why each missing signal is missing, accumulated while folding the run:
     * `metric -> reason -> { count, maxWaitedMs, askedMs, details }`. The counts in
     * `sanity` say how many; these say why.
     */
    missing: {},
    /**
     * The waiting rule this cell was measured under, from its launches' `meta`
     * records. Null when no launch recorded one.
     */
    timeouts: { mountTimeoutMs: null, presentedTimeoutMs: null },
    /**
     * Denominators for the completeness rule, counted from the records that
     * arrived: what each metric should have produced.
     */
    universe: {
      /** Measured (non-warmup) `iter` records: the latency denominator. */
      iterations: 0,
      /** Launches that produced a mount-phase CPU bracket. */
      cpuMountLaunches: new Set(),
      /** Launches that produced an unmount-phase CPU bracket. */
      cpuUnmountLaunches: new Set(),
      /** Launches that produced a footprint sample. */
      memoryLaunches: new Set(),
      /** Launches that produced at least one `leak<N>` sample. */
      leakLaunches: new Set(),
    },
  };
}

/** Fold one iteration's `missing` entry into the cell's reason tally. */
function recordMissingReason(cell, entry) {
  if (entry == null || typeof entry !== 'object') {
    return;
  }
  const metric = entry.metric;
  const reason = entry.reason;
  if (metric !== 'mountedNs' && metric !== 'presentedNs') {
    return;
  }
  if (typeof reason !== 'string' || reason.length === 0) {
    return;
  }
  const byMetric = (cell.missing[metric] ??= {});
  const tally = (byMetric[reason] ??= {
    count: 0,
    maxWaitedMs: null,
    /** Every timeout this reason was recorded under (a launch may ask for longer). */
    askedMs: [],
    /** A few verbatim messages, so a `probe-error` can be read without the log. */
    details: [],
  });
  tally.count += 1;
  if (isNumber(entry.waitedMs)) {
    tally.maxWaitedMs = Math.max(tally.maxWaitedMs ?? 0, entry.waitedMs);
  }
  if (isNumber(entry.timeoutMs) && !tally.askedMs.includes(entry.timeoutMs)) {
    tally.askedMs.push(entry.timeoutMs);
  }
  if (
    typeof entry.detail === 'string' &&
    tally.details.length < 3 &&
    !tally.details.includes(entry.detail)
  ) {
    tally.details.push(entry.detail);
  }
}

/**
 * The per-cell `missing` summary the report prints: one entry per signal, one per
 * reason, with the counts and the waits. Null for a cell nothing went missing in.
 */
function summariseMissing(byMetric) {
  if (Object.keys(byMetric).length === 0) {
    return null;
  }
  const out = {};
  for (const [metric, reasons] of Object.entries(byMetric)) {
    let total = 0;
    const byReason = {};
    for (const [reason, tally] of Object.entries(reasons)) {
      total += tally.count;
      byReason[reason] = {
        count: tally.count,
        maxWaitedMs: isNumber(tally.maxWaitedMs)
          ? Math.round(tally.maxWaitedMs * 10) / 10
          : null,
        timeoutMs: tally.askedMs.length === 0 ? null : tally.askedMs,
        details: tally.details.length > 0 ? tally.details : undefined,
      };
    }
    out[metric] = { total, byReason };
  }
  return out;
}

/**
 * One human-readable line per signal with missing samples, for the report:
 *
 *     presentedNs: 12 probe-timeout (asked 2000 ms, waited up to 2000.4 ms)
 *     mountedNs: 20 not-awaited
 */
export function describeMissing(cell) {
  const lines = [];
  for (const [metric, summary] of Object.entries(cell?.missing ?? {})) {
    const reasons = Object.entries(summary.byReason);
    if (reasons.length === 0) {
      lines.push(
        `${metric}: ${String(summary.total)} missing, no reason recorded (a results file from before A4)`
      );
      continue;
    }
    const parts = reasons.map(([reason, tally]) => {
      const facts = [];
      if (Array.isArray(tally.timeoutMs) && tally.timeoutMs.length > 0) {
        facts.push(
          `asked ${tally.timeoutMs.map((ms) => `${String(ms)} ms`).join('/')}`
        );
      }
      if (isNumber(tally.maxWaitedMs)) {
        facts.push(`waited up to ${String(tally.maxWaitedMs)} ms`);
      }
      const detail =
        tally.details && tally.details.length > 0
          ? ` - ${tally.details[0]}`
          : '';
      return `${String(tally.count)} ${reason}${
        facts.length > 0 ? ` (${facts.join(', ')})` : ''
      }${detail}`;
    });
    lines.push(`${metric}: ${parts.join('; ')}`);
  }
  return lines;
}

/**
 * The same reasons counted over one launch's raw records, for the run's progress line:
 *
 *     20 iterations, 3 presented probe-timeout (2000 ms)
 *
 * Measured iterations only, so the counts line up with the iteration count in front of
 * them.
 */
export function summarizeMissingReasons(records) {
  const reasons = {};
  for (const record of records) {
    if (record.kind !== 'iter' || record.warmup) {
      continue;
    }
    for (const missing of record.missing ?? []) {
      const metric = String(missing.metric).replace(/Ns$/, '');
      const key = `${metric} ${String(missing.reason)}`;
      const tally = (reasons[key] ??= { count: 0, askedMs: null });
      tally.count += 1;
      if (isNumber(missing.timeoutMs)) {
        tally.askedMs =
          tally.askedMs == null
            ? missing.timeoutMs
            : Math.max(tally.askedMs, missing.timeoutMs);
      }
    }
  }
  return Object.entries(reasons)
    .map(([reason, tally]) =>
      tally.askedMs == null
        ? `${String(tally.count)} ${reason}`
        : `${String(tally.count)} ${reason} (${String(tally.askedMs)} ms)`
    )
    .join(', ');
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
 * `median`/`mad` are the median and MAD of the per-launch medians, so a launch
 * is the unit of variation, which matches how the launches are interleaved and
 * how the gate bootstraps. `p95`/`min`/`max` stay pooled over iterations because
 * a tail latency only shows up in the pooled distribution.
 */
function summariseCell(key, cell) {
  const metrics = {};
  /**
   * How complete each metric is. `expected` is what the cell's own records said
   * it should produce - measured iterations for a latency metric, launches for a
   * per-launch one - and `reportable` is false once more than
   * `MAX_MISSING_SAMPLE_RATIO` of it is missing.
   */
  const completeness = {};
  const judge = (samples, expected) => ({
    samples,
    expected,
    reportable:
      expected <= 0 ||
      samples >= Math.ceil(expected * (1 - MAX_MISSING_SAMPLE_RATIO)),
  });
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
      expected: cell.universe.iterations,
      reportable: judge(values.length, cell.universe.iterations).reportable,
      launchMedians,
    };
    completeness[metric] = judge(values.length, cell.universe.iterations);
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
  completeness.jsNsPerOp = judge(
    mount.launchJsNsPerOp.length,
    cell.universe.cpuMountLaunches.size
  );
  completeness.mainNsPerOp = judge(
    mount.launchMainNsPerOp.length,
    cell.universe.cpuMountLaunches.size
  );
  completeness.unmountMainNsPerOp = judge(
    unmount.launchMainNsPerOp.length,
    cell.universe.cpuUnmountLaunches.size
  );

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

  /**
   * The runtime's own native perf marks, when this cell came from a
   * `--perf-marks` run. Reported, never gated: recording a mark is a mutex write
   * and draining one is JS work, so these iterations are instrumented and cannot
   * be compared with the clean numbers above.
   */
  const markRecords = [...cell.marks.values()].flat();
  completeness.bytesPerInstance = judge(
    perLaunchBytes.length,
    cell.universe.memoryLaunches.size
  );
  completeness.leakSlopeBytesPerCycle = judge(
    slopes.length,
    cell.universe.leakLaunches.size
  );
  const markMedians = (pick) => median(markRecords.map(pick).filter(isNumber));
  const marks =
    markRecords.length === 0
      ? null
      : {
          iterations: markRecords.length,
          launches: cell.marks.size,
          propsApplied: markMedians((record) => record.propsApplied),
          propsAppliedPerInstance:
            cell.n > 0
              ? markMedians((record) => record.propsApplied / cell.n)
              : null,
          firstFrame: markMedians((record) => record.firstFrame),
          instances: markMedians((record) => record.instances),
          propsAppliedNs: markMedians((record) => record.propsAppliedNs),
          firstFrameNs: markMedians((record) => record.firstFrameNs),
          drawLatencyNs: markMedians((record) => record.drawLatencyNs),
        };

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
    /** Why signals did not arrive, per metric and reason. Null in a clean cell. */
    missing: summariseMissing(cell.missing),
    /** The waiting rule this cell ran under, from its launches' `meta` records. */
    timeouts: cell.timeouts,
    /** `{ samples, expected, reportable }` per metric: the rule behind every `n/a`. */
    completeness,
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
       * Where the per-instance bytes live: `Debug.getNativeHeapAllocatedSize()`
       * and Java-heap-used deltas on Android, `null` on iOS, where
       * `phys_footprint` already attributes the native heap to the process.
       * Reported, not gated: `bytesPerInstance` is the memory verdict.
       */
      nativeBytesPerInstance: median(perLaunchNative),
      javaBytesPerInstance: median(perLaunchJava),
      heapBreakdownLaunches: perLaunchNative.length,
    },
    marks,
    /**
     * Cross-checks on the native signals: `presented < mounted` or
     * `mounted < jsCommit` means a signal arrived out of order and the latency
     * pair cannot be trusted.
     */
    sanity: cell.sanity,
    mountSignal: cell.mountSignal,
  };
}

/**
 * Fold every NDJSON record of a run into the results matrix.
 *
 * `launch` is the index the runner stamped when it merged the launches;
 * `warmup` iterations are dropped here.
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
      if (record.mountSignal === false) {
        cell.mountSignal = false;
      }
      /** The longest wait any launch of this cell was asked for. */
      for (const [field, value] of [
        ['mountTimeoutMs', record.mountTimeoutMs],
        ['presentedTimeoutMs', record.presentedTimeoutMs],
      ]) {
        if (isNumber(value)) {
          cell.timeouts[field] = Math.max(cell.timeouts[field] ?? 0, value);
        }
      }
    } else if (record.kind === 'skip') {
      if (!cell.skipReasons.includes(record.reason)) {
        cell.skipReasons.push(record.reason);
      }
      cell.skipReason = cell.skipReasons[0] ?? 'unavailable';
    } else if (record.kind === 'iter' && !record.warmup) {
      cell.universe.iterations += 1;
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
      // In the same branch as the `sanity` counters, so the reasons and the counts
      // cover the same iterations (warmups excluded).
      for (const missing of record.missing ?? []) {
        recordMissingReason(cell, missing);
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
      (phase === 'unmount'
        ? cell.universe.cpuUnmountLaunches
        : cell.universe.cpuMountLaunches
      ).add(record.launch);
      const perUpdate = (value) =>
        isNumber(value) && record.iterations > 0
          ? value / record.iterations
          : null;
      cell.cpu[phase].set(record.launch, {
        jsNsPerOp: perUpdate(record.jsCpuNs),
        mainNsPerOp: perUpdate(record.mainCpuNs),
      });
    } else if (record.kind === 'perf') {
      const marks = cell.marks.get(record.launch) ?? [];
      marks.push(record);
      cell.marks.set(record.launch, marks);
    } else if (record.kind === 'mem') {
      cell.universe.memoryLaunches.add(record.launch);
      if (typeof record.phase === 'string' && record.phase.startsWith('leak')) {
        cell.universe.leakLaunches.add(record.launch);
      }
      const phases = cell.memory.get(record.launch) ?? {};
      phases[record.phase] = record.footprintBytes;
      if (typeof record.heapCollected === 'boolean') {
        phases.heapCollected = record.heapCollected;
      }
      // Heap breakdown, kept per phase so the same empty/full delta that gives
      // `bytesPerInstance` can be attributed to a heap. iOS reports -1 for both,
      // which stays `null` here rather than becoming a number.
      for (const [heapKey, bytes] of [
        ['nativeHeap', record.nativeHeapBytes],
        ['javaHeap', record.javaHeapBytes],
      ]) {
        if (isNumber(bytes) && bytes >= 0) {
          const breakdown = (phases[heapKey] ??= {});
          breakdown[record.phase] = bytes;
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
 * Whether one metric of one cell has enough samples to be printed at all
 * (`MAX_MISSING_SAMPLE_RATIO`). A results file without `cell.completeness` has
 * its denominators rebuilt from the sanity counters.
 */
export function metricIsReportable(cell, metric) {
  const declared = cell?.completeness?.[metric];
  if (declared != null) {
    return declared.reportable !== false;
  }
  if (LATENCY_METRICS.includes(metric)) {
    const samples = cell?.metrics?.[metric]?.samples;
    if (!isNumber(samples)) {
      return true;
    }
    const missing =
      metric === 'presentedNs'
        ? (cell?.sanity?.missingPresented ?? 0)
        : metric === 'mountedNs'
          ? (cell?.sanity?.missingMount ?? 0)
          : 0;
    return (
      samples >= Math.ceil((samples + missing) * (1 - MAX_MISSING_SAMPLE_RATIO))
    );
  }
  const launchSamples = {
    jsNsPerOp: cell?.cpu?.launchJsNsPerOp,
    mainNsPerOp: cell?.cpu?.launchMainNsPerOp,
    unmountMainNsPerOp: cell?.cpu?.launchUnmountMainNsPerOp,
    bytesPerInstance: cell?.memory?.launchBytesPerInstance,
    leakSlopeBytesPerCycle: cell?.memory?.launchLeakSlopeBytesPerCycle,
  }[metric];
  const launches = cell?.launches;
  if (!Array.isArray(launchSamples) || !isNumber(launches)) {
    return true;
  }
  return (
    launchSamples.length >= Math.ceil(launches * (1 - MAX_MISSING_SAMPLE_RATIO))
  );
}

/**
 * The metrics this cell may be *quoted* on: positive, and complete enough to
 * mean anything. `ratioTable`, the absolute table, `--compare` and the gate all
 * go through here, so an incomplete metric is absent everywhere at once. The
 * leak slope only counts when the footprint climbed monotonically: a slope from
 * a wobbling series is not an increase.
 */
export function comparableMetrics(cell) {
  const metrics = {};
  for (const metric of LATENCY_METRICS) {
    const value = cell.metrics?.[metric]?.median;
    if (isNumber(value) && value > 0 && metricIsReportable(cell, metric)) {
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
    if (!metricIsReportable(cell, metric)) {
      continue;
    }
    metrics[metric] = value;
  }
  return metrics;
}

/**
 * Metrics this cell did measure but too few times to quote, with their
 * denominators: the reason a table says `n/a` instead of a number, printed so a
 * reader can tell "the signal never arrived" from "the arm is slow".
 */
export function incompleteMetrics(cell) {
  const found = [];
  for (const metric of GATE_METRICS) {
    const hasValue =
      isNumber(cell?.metrics?.[metric]?.median) ||
      isNumber(cell?.cpu?.[metric]) ||
      isNumber(cell?.memory?.[metric]);
    if (!hasValue || metricIsReportable(cell, metric)) {
      continue;
    }
    const declared = cell?.completeness?.[metric];
    if (declared != null) {
      found.push({
        metric,
        samples: declared.samples,
        expected: declared.expected,
      });
      continue;
    }
    found.push({
      metric,
      samples: cell?.metrics?.[metric]?.samples ?? null,
      expected: null,
    });
  }
  return found;
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
 * The launches are interleaved ABBA across implementations, so whatever the
 * machine did during launch 2 affected both arms. Dividing two pooled medians
 * instead would keep that drift.
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
 * That is why every comparison is made on ratios.
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
    const controlMetrics = comparableMetrics(control);
    for (const metric of Object.keys(comparableMetrics(cell))) {
      // A ratio is only as whole as its denominator: if the control's metric is
      // incomplete, the arm's ratio for it is n/a too, and ungated.
      if (!(metric in controlMetrics)) {
        continue;
      }
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
 * launch-paired ratios over their median. `rn-core` itself is 1.0 by
 * construction, so the spread of every other arm's paired ratio says how much
 * the machine moved while measuring this cell.
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
 * Informational only: noise is judged within the run (see `noiseTable`).
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
 * The one gate: `run.mjs` and `report.mjs` both call this, so the standalone
 * reporter cannot drift away from the runner.
 *
 * Both sides arrive as **launch-paired ratios to `rn-core`**, so:
 *
 * - both modes compare head's ratios with base's ratios, i.e.
 *   `head(x/rn-core) / base(x/rn-core)`;
 * - noise is per (scenario, N, metric) inside each run, never a whole-run veto;
 * - only `nitro-ui` is gated: `expo-ui-*` stay reference arms.
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
    const newArm =
      gated &&
      headEntry.skipReason == null &&
      Object.keys(perMetric).length === 0;
    rows.push({
      key,
      implementation: headEntry.implementation,
      // A gated arm whose baseline cell was skipped (the component did not
      // exist when the baseline was recorded) has ratios to `rn-core` but no
      // base ratio to regress against. Saying `ok` would imply it was checked.
      status:
        headEntry.skipReason != null ? 'skipped' : newArm ? 'new-arm' : 'ok',
      gated,
      perMetric,
      armRatios: newArm
        ? Object.fromEntries(
            Object.entries(headEntry.metrics).map(([metric, value]) => [
              metric,
              value.ratio,
            ])
          )
        : null,
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

function unmeasuredReason(cells, key) {
  const cell = cells[key];
  if (cell == null) {
    return 'no record';
  }
  return cell.skipReason == null && !(cell.launches > 0) ? 'no samples' : null;
}

/**
 * The cells of `expected` that ended without a verdict because a side has no
 * measurement of them. A cell both sides measured and neither can quote a metric
 * for (a flat leak slope) is not one: nothing failed there.
 */
export function uncomparedCells({ expected, head, base, rows }) {
  const verdicts = new Set(
    rows
      .filter((row) => Object.keys(row.perMetric).length > 0)
      .map((row) => row.key)
  );
  const sides = [
    ['base', cellsFrom(base)],
    ['head', cellsFrom(head)],
  ];
  const uncompared = [];
  for (const key of expected) {
    if (verdicts.has(key)) {
      continue;
    }
    const { scenario, implementation, n } = parseCellKey(key);
    const reasons = [];
    for (const [side, cells] of sides) {
      const own = unmeasuredReason(cells, key);
      const control =
        implementation === 'rn-core'
          ? null
          : unmeasuredReason(cells, cellKey(scenario, 'rn-core', n));
      if (own != null) {
        reasons.push(`${side} has ${own}`);
      } else if (control != null) {
        reasons.push(`${side} has ${control} of its rn-core control`);
      }
    }
    if (reasons.length > 0) {
      uncompared.push({ key, reasons });
    }
  }
  return uncompared;
}

/** The load average a run is quiet at: 0.5 x core count. */
export function loadCeiling(cpuCount) {
  return isNumber(cpuCount) ? cpuCount * UNQUIET_LOAD_RATIO : null;
}

function roundLoad(value) {
  return isNumber(value) ? Math.round(value * 1e4) / 1e4 : null;
}

/** Whether `value` is what `summarizeLoadSamples()` records for a run. */
function isLoadSummary(value) {
  return (
    value != null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    isNumber(value.count) &&
    value.count > 0 &&
    isNumber(value.median) &&
    isNumber(value.ceiling)
  );
}

/**
 * Summarise a run's load samples compactly enough to live in a committed
 * baseline. Returns null when there is nothing to summarise or the ceiling is
 * unknown.
 */
export function summarizeLoadSamples(samples, { cpuCount } = {}) {
  const ceiling = loadCeiling(cpuCount);
  const values = (Array.isArray(samples) ? samples : []).filter(isNumber);
  if (ceiling == null || values.length === 0) {
    return null;
  }
  const over = values.filter((value) => value > ceiling).length;
  return {
    count: values.length,
    ceiling: roundLoad(ceiling),
    median: roundLoad(median(values)),
    p90: roundLoad(percentile(values, 0.9)),
    max: roundLoad(Math.max(...values)),
    over,
    overFraction: roundLoad(over / values.length),
  };
}

/**
 * A load sampler the runner can drive from launch boundaries and a timer.
 *
 * `readLoad` is injected so this stays free of `node:os` like the rest of the
 * file, and so a test can hand it a load curve and see what the run recorded.
 */
export function createLoadSampler(readLoad) {
  if (typeof readLoad !== 'function') {
    throw new TypeError('createLoadSampler() needs a readLoad() function');
  }
  const samples = [];
  return {
    samples,
    sample() {
      const value = readLoad();
      if (isNumber(value)) {
        samples.push(value);
      }
      return value;
    },
    summary({ cpuCount }) {
      return summarizeLoadSamples(samples, { cpuCount });
    },
  };
}

/**
 * Why this run's load counts as busy, or null when it does not.
 *
 * The rule judges the whole run, not its last minute: a run that recorded samples
 * is busy when the median is over the ceiling, or when more than
 * `LOAD_OVER_CEILING_FRACTION` of the samples are. A results file with no samples
 * is judged on its single load average. Nothing exits on this answer: a busy run
 * is read as a noisier run.
 */
export function loadOverCeiling(machine) {
  const source = machine ?? {};
  const ceiling = loadCeiling(source.cpuCount);
  if (isLoadSummary(source.loadSamples) && ceiling != null) {
    const samples = source.loadSamples;
    if (samples.median > ceiling) {
      return `the machine was busy for half the run: median load average ${samples.median.toFixed(2)} over ${String(source.cpuCount)} cores (ceiling ${ceiling.toFixed(1)}, ${String(samples.count)} samples, max ${samples.max.toFixed(2)})`;
    }
    if (samples.overFraction > LOAD_OVER_CEILING_FRACTION) {
      return `the machine was busy for ${String(Math.round(samples.overFraction * 100))}% of the run: ${String(samples.over)} of ${String(samples.count)} load samples over ${ceiling.toFixed(1)} (ceiling for ${String(source.cpuCount)} cores), median ${samples.median.toFixed(2)}`;
    }
    return null;
  }
  if (isNumber(source.loadavg1) && isNumber(source.cpuCount)) {
    if (source.loadavg1 > ceiling) {
      return `the machine was busy: load average ${source.loadavg1.toFixed(2)} over ${String(source.cpuCount)} cores (ceiling ${ceiling.toFixed(1)})`;
    }
    return null;
  }
  if (source.loadavg1 == null) {
    return 'the run did not record a load average';
  }
  return null;
}

/**
 * The waiting rule a run measured under: the largest timeout any of its cells was
 * asked to wait for, and 0 when a results file has no such field.
 *
 * Compared against `DEFAULT_TIMEOUTS_MS` by the runner: a run that waited differently
 * is a diagnostic (it changes which samples arrive, not what they say).
 */
export function requestedTimeouts(run) {
  let mountTimeoutMs = 0;
  let presentedTimeoutMs = 0;
  for (const cell of Object.values(cellsFrom(run.cells ?? run))) {
    if (isNumber(cell?.timeouts?.mountTimeoutMs)) {
      mountTimeoutMs = Math.max(mountTimeoutMs, cell.timeouts.mountTimeoutMs);
    }
    if (isNumber(cell?.timeouts?.presentedTimeoutMs)) {
      presentedTimeoutMs = Math.max(
        presentedTimeoutMs,
        cell.timeouts.presentedTimeoutMs
      );
    }
  }
  return { mountTimeoutMs, presentedTimeoutMs };
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
 * runs of the same commit never overwrite each other, and a dirty-tree run can
 * never masquerade as the clean run of that commit.
 */
export function resultsFileName(
  sha,
  platform,
  when = new Date(),
  dirty = false,
  marks = false
) {
  const stamp = when
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
  return `${sha}${dirty ? '-dirty' : ''}-${platform}-${stamp}${marks ? '-marks' : ''}.json`;
}

/**
 * Newest matching results file name for a short sha, clean runs preferred.
 *
 * `--perf-marks` runs are named `-marks.json` and are excluded: they are
 * instrumented, so they must never become a `--compare` base by accident.
 */
export function newestResultsName(names, sha, platform) {
  const escaped = sha.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped}(-dirty)?-${platform}-.+\\.json$`);
  const matches = names.filter(
    (name) => pattern.test(name) && !name.includes('-marks.json')
  );
  const clean = matches.filter((name) => !name.includes('-dirty-'));
  const pool = clean.length > 0 ? clean : matches;
  return pool.sort().reverse()[0] ?? null;
}

/** Accept both a full results run and a bare `cells` map. */
export function cellsFrom(run) {
  return run?.cells ?? run ?? {};
}

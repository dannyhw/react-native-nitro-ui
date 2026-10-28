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
 * Above this share of a cell's samples, a metric is **not reportable** (round
 * 4): it prints `n/a`, and it is dropped from `comparableMetrics()`, so it
 * enters no ratio table and cannot be gated. A median over "the 35 of 80
 * iterations whose signal happened to arrive" is not a slow cell - it is a
 * survivor-biased sample of a broken signal, and printing it is worse than
 * printing nothing (round 3's Android mount `presented` read 166 ms / 178 ms
 * that way, at 44 % and 84 % missing).
 */
export const MAX_MISSING_SAMPLE_RATIO = 0.1;
/**
 * A machine is "unquiet" above 0.5 x core count (D9): a busy laptop may produce
 * readable same-run ratios but must never mint a committed baseline.
 */
export const UNQUIET_LOAD_RATIO = 0.5;
/**
 * How often a running bench takes a load sample in addition to the one at every
 * launch boundary (R4). The guard used to read a single `os.loadavg()` taken
 * when the run *ended*, so three quiet hours were judged by their last minute.
 */
export const LOAD_SAMPLE_INTERVAL_MS = 30_000;
/**
 * How much of a run may sit over the ceiling before the run counts as busy (R4).
 * A bench run is dozens of minutes of short bursts, so the odd spike - a daemon,
 * a Spotlight pass - is not the machine being busy *for the run*.
 */
export const LOAD_OVER_CEILING_FRACTION = 0.1;
/**
 * A committed baseline is a `full` plan at 8 launches or more
 * (bench/baselines/README.md): a `quick` plan is local feedback, and 4 launches
 * give a within-run spread too wide for a ratio to be a threshold.
 */
export const BASELINE_PLAN = 'full';
export const BASELINE_LAUNCHES = 8;

/**
 * Only the implementation under development is gated. `expo-ui-*` are reference
 * arms: an `@expo/ui` bump must not fail a nitro-ui PR, and `rn-core` is the
 * control. They are measured and reported, never gated (T02 review S9).
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
  // nitro-ui's controls inside one shared `<Host>` (H1, widened to more controls by
  // H2a). A reference arm like the two `expo-ui-*` ones - measured and reported, never
  // gated (`GATED_IMPLEMENTATIONS`).
  'nitro-ui-host',
];

/**
 * The arms a baseline **compares against** rather than gates: everything measured
 * except the library under development and the `rn-core` control.
 *
 * This is the A4 amendment to D9. An incomplete metric on a comparison arm makes that
 * one cell's ratio survivor-biased - which is a reason not to print or gate it, and
 * never a reason to refuse a whole table, because these arms carry no verdict
 * (`GATED_IMPLEMENTATIONS`). One such cell refusing an entire machine's baseline is
 * how A3's `maintainer-mac-2` iOS mint died: `mount.date-picker` at N=200 presented on
 * 55/160 and 87/160 measured iterations on the two `@expo/ui` arms and nothing else was
 * wrong. Under the amendment that cell is left out and recorded; a gap in `nitro-ui`
 * (gated) or `rn-core` (the denominator of every ratio) still refuses the mint.
 *
 * `nitro-ui-host` counts as a comparison arm for the same reason `expo-ui-*` does: it
 * is measured, reported, and never gated.
 */
export const COMPARISON_IMPLEMENTATIONS = IMPLEMENTATIONS.filter(
  (name) => name !== 'nitro-ui' && name !== 'rn-core'
);

/**
 * The waiting rule a baseline has to be minted under (A4).
 *
 * `bench/src/plan.ts` owns these numbers - it is what parses them off the launch plan -
 * and they are restated here because `scripts/` cannot import the app's TypeScript.
 * `scripts/__tests__/bench-missing-samples.test.js` imports both sides and fails if they
 * disagree.
 *
 * A run that waited longer for a presenting frame is a **diagnostic**, like a
 * `--perf-marks` run: a sample that arrives keeps its value, but *which* samples arrive
 * changes the median, so its ratios are not comparable with a table recorded under a
 * different rule. `baselineBlockers()` refuses one instead of letting it quietly
 * redefine what `presented` means.
 */
export const BASELINE_MOUNT_TIMEOUT_MS = 1500;
export const BASELINE_PRESENTED_TIMEOUT_MS = 2000;

/**
 * The per-launch wall-clock budgets, by scenario action, that `run.mjs` starts from.
 * Restated here so `launchBudgetMs` can be tested without importing the runner (which
 * cannot be imported under jest: `import.meta`).
 */
export const DEFAULT_SCENARIO_BUDGETS = {
  mount: 180_000,
  update: 180_000,
  memory: 180_000,
  leak: 300_000,
};

/**
 * The wall-clock budget for one launch, widened by whatever signal waits that launch was
 * asked to make.
 *
 * The budgets above assume the default waits: an iteration of `mount` waits up to
 * `mount` + `presented` for its own two signals and again `mount` in the teardown that
 * follows, so 25 iterations already contain ~87 s of waiting. Ask for a 40 s presenting
 * wait and the same launch would be killed as *stalled* for a reason the runner itself
 * introduced - and a killed launch becomes a `problem`, a worse record than the slow
 * sample it was chasing.
 *
 * `overrideSeconds` is the `BENCH_LAUNCH_TIMEOUT_S` escape hatch and wins outright: that
 * override exists precisely to set the budget by hand.
 */
export function launchBudgetMs(
  entry,
  { scenarioBudgets = DEFAULT_SCENARIO_BUDGETS, overrideSeconds = null } = {}
) {
  const base = scenarioBudgets[scenarioActionOf(entry.scenario)] ?? 180_000;
  if (isNumber(overrideSeconds) && overrideSeconds > 0) {
    return base;
  }
  // 2 mount waits + 1 presented per iteration is the widest case (`mount`); `update`
  // waits twice and `memory`/`leak` not at all, so this only ever over-allows.
  const waitsFor = (mount, presented) => 2 * mount + presented;
  const asked = waitsFor(
    entry.mountTimeoutMs ?? BASELINE_MOUNT_TIMEOUT_MS,
    entry.presentedTimeoutMs ?? BASELINE_PRESENTED_TIMEOUT_MS
  );
  const standard = waitsFor(
    BASELINE_MOUNT_TIMEOUT_MS,
    BASELINE_PRESENTED_TIMEOUT_MS
  );
  return (
    base +
    Math.max(0, asked - standard) * (WARMUP_ITERATIONS + MEASURED_ITERATIONS)
  );
}

/**
 * The longest signal timeout a run may ask for (`--timeout-mount`,
 * `--timeout-presented`, and the `mountTimeout=`/`presentedTimeout=` launch flags).
 *
 * Both platforms arm a native backstop for a process that never draws at all - 90 s
 * (`kBenchPresentationCeilingSeconds` in `HybridBenchProbe.mm`,
 * `PRESENTATION_CEILING_MS` in `HybridBenchProbe.kt`) - and a backstop that wins the
 * race *is* the timeout: it would answer `-1` and the recorded reason would blame a
 * wait the run never asked for. So the requested wait stays strictly below the ceiling,
 * which keeps "we stopped asking" and "the process is not drawing" two distinguishable
 * answers. `bench/src/plan.ts` `MAX_TIMEOUT_MS` restates this number for the app.
 */
export const MAX_REQUESTED_TIMEOUT_MS = 80_000;

/**
 * `--timeout-mount <ms>` / `--timeout-presented <ms>`: how long each launch waits for a
 * native signal before recording it as missing, with the reason.
 *
 * The point is the diagnostic question A4 asks - "did this arm's frame never come, or
 * did it come later than we were willing to wait?" - which is unanswerable at the
 * default 2 s when the arm in question takes 40 s. The value rides the launch string
 * rather than an env var because a release build has no env, exactly like `marks`.
 *
 * Returns the problem rather than exiting, so a test can prove the validation without
 * spawning a run. A run that raises a timeout is not baseline material (see
 * `BASELINE_*_TIMEOUT_MS`) and `run.mjs` says so at startup.
 */
export function parseTimeoutFlags(argv, readFlag) {
  const out = { mountTimeoutMs: null, presentedTimeoutMs: null, problem: null };
  for (const [name, key] of [
    ['--timeout-mount', 'mountTimeoutMs'],
    ['--timeout-presented', 'presentedTimeoutMs'],
  ]) {
    if (!argv.includes(name)) {
      continue;
    }
    const raw = readFlag(name);
    const ms = raw == null ? Number.NaN : Number(raw);
    if (!Number.isFinite(ms) || ms < 1 || ms > MAX_REQUESTED_TIMEOUT_MS) {
      out.problem = `${name} must be a number of milliseconds between 1 and ${String(
        MAX_REQUESTED_TIMEOUT_MS
      )} (both platforms arm a 90 s native backstop, and one that answers first would record a wait the run never asked for)`;
      return out;
    }
    out[key] = ms;
  }
  return out;
}

/**
 * Arms that cannot mount a component on one platform, keyed
 * `platform:implementation:component`, so those cells are simply not scheduled
 * there (G5).
 *
 * `@expo/ui`'s two Android arms have no date-picker cell because `@expo/ui`
 * exposes no mountable date *field* — only the inline Material 3 `DateTimePicker`
 * and whole dialogs. Measured on `nitroui_t02` (2026-10-25), neither shape is
 * priceable:
 *
 * - the fit-its-content host every self-sizing arm gets (`Host matchContents`)
 *   measures the inline calendar's horizontally scrollable month pager with
 *   infinite width, and the app dies: `IllegalStateException: Horizontally
 *   scrollable component was measured with an infinity maximum width
 *   constraints`;
 * - with the width bounded it does mount, at 2.45 s of mount work per iteration
 *   of 50 inline calendars (~96 s per launch, shared-host arm), which is the
 *   runner's whole per-launch budget — and it prices a full-screen calendar
 *   against the compact field every other arm renders.
 *
 * An arm that cannot mount the control is not a slow arm, so the Android
 * date-picker rows are `nitro-ui` over `rn-core` with the gap stated, rather
 * than four launches per cell that end in `no end sentinel within 180s`.
 * `bench/src/implementations/expoUi.android.tsx` fails such a launch loudly.
 */
export const ARMS_WITHOUT_COMPONENT = [
  'android:expo-ui-host-per-control:date-picker',
  'android:expo-ui-shared-host:date-picker',
];

/**
 * Arms that are scoped to a set of components, or to one platform *and* a set of
 * components, keyed by implementation name.
 *
 * `ARMS_WITHOUT_COMPONENT` is per platform because it describes something the
 * *platform's* runtime cannot mount. This is the other case: an arm that renders some
 * controls (and, for the Host, exists on one platform). `nitro-ui-host` (H1, widened to
 * Slider, Progress and Button by H2a) composes what a `<Host>` can draw - Switch,
 * Slider, linear Progress, Button - and `NitroUiHostList` throws for the rest, so any
 * other cell is a launch that would render nothing and still report a plausible mount
 * time for zero controls. SegmentedControl, Picker and DatePicker stay out because a
 * `<Host>` refuses them, which is H2b's scope. And on iOS `<Host>` is the documented
 * passthrough - permanently, since T17 measured an iOS Host and D23's outcome was not
 * to ship one - so a cell there would price "nitro-ui plus one extra `View`" under a
 * name that promises a shared composition.
 *
 * The component scope is a property of the arm, so it applies whether or not the caller
 * named a platform; the platform scope only applies when one is named.
 * `bench/src/implementations/index.ts` repeats the same list as `components` and
 * `NitroUiHostList` refuses what is not on it: an arm that renders nothing must say so
 * in the table rather than be measured. `scripts/__tests__/bench-gate.test.js` keeps
 * those lists from drifting apart.
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
 *
 * A cell's scenario carries its component: the bare name is the first component
 * (Switch, kept so pre-G1 results files and baselines still line up) and
 * `<action>.<component>` is every component after it. `componentOf` is the one
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
  ],
};

/**
 * The component a scenario cell belongs to.
 *
 * The one reader of the `action.component` encoding, so the runner, the
 * reporter and the gate all treat a component as a dimension rather than
 * string-matching scenario names in three places.
 */
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
 * it (`cellKey`): a marks run is a diagnosis of the same cell, not a fifth arm.
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
  perfMarks = false,
  component = null,
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
  // The component dimension is crossed here too, and *before* the
  // implementation one: a plan now holds several components' cells, and running
  // a component's cells is the unit of work a task or a review asks for
  // (`--component slider`). `null` keeps the historical behaviour of measuring
  // every component the plan knows about.
  const wantedCells =
    component == null
      ? cells
      : cells.filter((cell) => componentOf(cell.scenario) === component);
  if (wantedCells.length === 0) {
    throw new Error(
      `--component ${String(component)} matched no cell in plan "${String(plan)}" ` +
        `(components here: ${[...new Set(cells.map((cell) => componentOf(cell.scenario)))].join(', ')})`
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
    // Only the library records marks, so a marks run measures nothing else - it
    // would just burn launches whose marks are structurally empty.
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
  // A scoped arm (see `ARM_SCOPES`) is not scheduled outside its scope. The
  // platform half is dropped here, before the cell loop, because the caller asked
  // for arms by name: an arm that is not scheduled at all must not read as a
  // measured arm with a missing cell.
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
          // The arm renders a different control than this cell asks for. Skipping
          // the cell is also what keeps a scoped arm out of another component's
          // ratio table, where its absence is honest and an empty tree is not.
          continue;
        }
        if (
          platform != null &&
          ARMS_WITHOUT_COMPONENT.includes(
            `${platform}:${implementation}:${componentOf(cell.scenario)}`
          )
        ) {
          // One platform's arm cannot mount this component at all; the other
          // platforms keep their cell, and a run with no `platform` (a hand
          // schedule, a test) still asks for every arm it was given.
          continue;
        }
        // Only a timeout the caller *asked for* goes on the launch string, so a
        // normal run's strings stay exactly what they were and the app's own
        // defaults apply. Anything non-default makes the run a diagnostic
        // (`BASELINE_*_TIMEOUT_MS`), which `run.mjs` says at startup.
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
    /**
     * `false` when the arm told the runner its latency pair cannot exist
     * (`bench/src/plan.ts` `NO_MOUNT_SIGNAL`). Turned on by the launch's `meta`
     * record; changes no number, only whether a cell full of nulls is called a
     * lost signal or an absent one.
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
     * `metric -> reason -> { count, maxWaitedMs, askedMs, details }`.
     *
     * The counts in `sanity` answer "how many"; they cannot answer "why", which is the
     * question a refused baseline leaves behind (A3's iOS mint: 105 missing `presented`
     * samples on one arm, and no way to tell a 2 s probe timeout from a probe that
     * never answered at all). Every `iter` record now carries a reason per null, and
     * `summariseCell` turns these into the compact `cell.missing` the report prints.
     */
    missing: {},
    /**
     * The waiting rule this cell was measured under, as recorded by the launches'
     * own `meta` records (A4). Null until a launch says otherwise, which is what a
     * results file from before the flag existed looks like.
     */
    timeouts: { mountTimeoutMs: null, presentedTimeoutMs: null },
    /**
     * Denominators for the completeness rule, counted from the records that
     * arrived: what each metric should have produced. Without them a metric
     * that produced 35 of 80 samples is indistinguishable from one that
     * produced 80 of 80, which is how round 3 shipped survivor-biased numbers.
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

/**
 * Fold one iteration's `missing` entry into the cell's reason tally.
 *
 * Kept as a function of the accumulating cell (rather than a post-pass over records) so
 * the tally is built in the same pass as the latency values it explains, and so a record
 * with no `missing` array - every results file written before A4, and every healthy
 * iteration - contributes nothing.
 */
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
 * The per-cell `missing` summary the report prints and the refusal points at: one entry
 * per signal, one per reason, with the counts and the waits.
 *
 * Returns null for a cell nothing went missing in, so the cells in a healthy results file
 * stay the size they were before A4.
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
 * One human-readable line per signal with missing samples, for the report and for the
 * mint's refusal. The reasons are the point of the whole exercise, so they lead:
 *
 *     presentedNs: 12 probe-timeout (asked 2000 ms, waited up to 2000.4 ms)
 *     mountedNs: 20 not-awaited
 *
 * A results file written before A4 has counts and no reasons, and says so rather than
 * printing an empty summary.
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
 * Lives in `lib.mjs` rather than inlined in `run.mjs` so it can be unit tested: the
 * runner cannot be imported under jest at all (`import.meta`), and a progress line that
 * silently stopped counting reasons is exactly the kind of regression nobody notices on a
 * four-hour run. Measured iterations only, so the counts line up with the iteration count
 * in front of them; warmups still reach the cell's own `missing` block.
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
 * `median`/`mad` are the median and MAD **of the per-launch medians** - the
 * "median of medians" the protocol promises - so a launch is the unit of
 * variation, which matches how the launches are interleaved and how the gate
 * bootstraps. `p95`/`min`/`max` stay pooled over iterations because a tail
 * latency only shows up in the pooled distribution.
 */
function summariseCell(key, cell) {
  const metrics = {};
  /**
   * How complete each metric is (round 4). `expected` is what the cell's own
   * records said it should produce - measured iterations for a latency metric,
   * launches for a per-launch one - and `reportable` is false once more than
   * `MAX_MISSING_SAMPLE_RATIO` of it is missing. A partial median is a
   * survivor-biased number, so it must not be printed, ratioed, or gated.
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
   * be compared with the clean numbers above. They exist to explain them - the
   * `propsAppliedPerInstance` count says how many native prop commits one React
   * commit really caused, and `drawLatencyNs` is the library's own props-to-pixels
   * span inside what the probe measures as `UI CPU/op`.
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
    /**
     * Why signals did not arrive, per metric and reason (A4). Null in a clean cell.
     * The counts next to it (`sanity.missingPresented`) say how many; these say why,
     * which is what a refused mint has to answer.
     */
    missing: summariseMissing(cell.missing),
    /** The waiting rule this cell ran under, from its launches' `meta` records. */
    timeouts: cell.timeouts,
    /**
     * `{ samples, expected, reportable }` per metric: the denominator rule
     * behind every `n/a` in the tables, and the reason a cell with a 44 %-missing
     * column cannot carry a verdict (round 4).
     */
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
    marks,
    sanity: cell.sanity,
    mountSignal: cell.mountSignal,
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
      if (record.mountSignal === false) {
        cell.mountSignal = false;
      }
      /**
       * The waiting rule this cell was measured under (A4). Max, not first: a mixed
       * launch set is worth seeing rather than averaging away, and `baselineBlockers`
       * refuses a mint whose rule is not the one the baseline is recorded under.
       */
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
      // Why, not just how many (A4). Sits in the same branch as the `sanity` counters
      // it explains, so warmups are excluded here for exactly the reason they are
      // excluded there: the denominators, the samples and the reasons have to be
      // counted over the same set of iterations or the two cannot be reconciled.
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
      // `bytesPerInstance` can be attributed to a heap (review S8). iOS reports
      // -1 for both, which stays `null` here rather than becoming a number.
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
 * Metrics a cell contributes to a comparison. Smaller is better for all of them,
 * and each must be a positive number to mean anything.
 *
 * The leak slope only counts when the footprint actually climbed monotonically:
 * §6 of setup-decisions asks to "fail on a monotonic increase", and a slope from
 * a wobbling series is not an increase (T02 review S8 - it used to be printed
 * and never gated).
 */
/**
 * Whether one metric of one cell has enough samples to be printed at all
 * (round 4, `MAX_MISSING_SAMPLE_RATIO`).
 *
 * New runs carry `cell.completeness` with the exact denominator. Results files
 * written before round 4 do not, so their denominators are rebuilt from the
 * sanity counters: a pre-fix file that recorded `missingPresented: 45` of 80
 * iterations gets the same `n/a` when it is re-reported today, which is the
 * only way round 3's Android mount table stops quoting a 166 ms survivor.
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
 * go through here, so an incomplete metric is absent everywhere at once.
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
    const controlMetrics = comparableMetrics(control);
    for (const metric of Object.keys(comparableMetrics(cell))) {
      // A ratio is only as whole as its denominator: in round 3 the Android
      // `expo-ui-shared-host` mount cell had 80 of 80 presenting frames while
      // `rn-core` had 13, and 1.15x was the survivor over the survivor. If the
      // control's metric is incomplete, the arm's ratio for it is meaningless
      // too - n/a, and ungated.
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

/**
 * The load average a machine may mint a baseline at (D9): 0.5 x core count.
 */
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
 * baseline: the run is described by five numbers instead of ~1 500 of them.
 *
 * Returns null when there is nothing to summarise or the ceiling is unknown,
 * which is what keeps a results file from before R4 on the old rule.
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
 * Why this run's load disqualifies it as baseline material, or null when it does
 * not (D9 + R4).
 *
 * R4: the rule judges **the run, not its last minute**. A run that recorded
 * samples is refused when the median is over the ceiling, or when more than
 * `LOAD_OVER_CEILING_FRACTION` of the samples are. A1b's iOS run is the case the
 * single sample got wrong: `full` plan, 1120 launches, no problems, load5 4.06
 * against a 7.0 ceiling - and it was refused by a `loadavg1` of 7.60 measured in
 * the final minute of a 154-minute run.
 *
 * Results files from before the sampler keep the single-sample rule: a lone load
 * average is all they have, and re-judging them with a rule nobody measured
 * would quietly re-qualify runs that were never sampled.
 */
export function loadBlocker(machine) {
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
 * asked to wait for, and 0 when a results file predates the field.
 *
 * Compared against `BASELINE_*_TIMEOUT_MS` by `baselineBlockers()`: a run that waited
 * longer is a diagnostic (it changes which samples arrive, not what they say), so it
 * cannot mint the table future runs are gated against.
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

/**
 * The incomplete metrics of a run, split by whose fault it is (A4).
 *
 * `refusals` are cells whose incomplete metric makes a number the baseline *gates on*
 * unusable: a `nitro-ui` row (the only gated arm), or any metric of `rn-core`, which is
 * the denominator of every ratio in the file. Those refuse the whole mint - a
 * survivor-biased verdict is not baseline material, and this half of the rule is
 * unchanged from round 4.
 *
 * `comparisonGaps` are the same defect on an arm that carries no verdict (`expo-ui-*`,
 * `nitro-ui-host`). Those cells are left out of the baseline and recorded, because
 * refusing a machine's entire table over a reference arm's frame probe throws away every
 * gated row that run measured correctly - which is exactly what A3's iOS mint did for
 * 55/160 and 87/160 samples on two `@expo/ui` cells.
 *
 * Both halves key on the arm, not the component or scenario: what matters is whether the
 * number gates anything.
 */
export function baselineCompleteness(run) {
  const incomplete = Object.entries(cellsFrom(run.cells ?? run)).flatMap(
    ([key, cell]) =>
      incompleteMetrics(cell).map((entry) => ({
        key,
        implementation:
          cell?.implementation ?? parseCellKey(key).implementation,
        ...entry,
      }))
  );
  const refusals = [];
  const comparisonGaps = [];
  for (const entry of incomplete) {
    // `rn-core` is not gated either, but its metrics *are* every ratio's
    // denominator: an incomplete control metric poisons the row above it, so the
    // control belongs with the gated arm, not with the comparison arms.
    if (
      GATED_IMPLEMENTATIONS.includes(entry.implementation) ||
      entry.implementation === 'rn-core'
    ) {
      refusals.push(entry);
    } else {
      comparisonGaps.push(entry);
    }
  }
  return { refusals, comparisonGaps, incomplete };
}

/**
 * A short, greppable pointer to the per-iteration detail behind a gap: the reason codes
 * and counts that were recorded with them (A4's "a failure leaves a record").
 */
function missingDetailHint(run, key) {
  const cell = cellsFrom(run.cells ?? run)[key];
  const lines = describeMissing(cell);
  return lines.length > 0
    ? ` - ${lines.join('; ')}`
    : ' - no per-iteration reason recorded for this cell (a results file from before A4)';
}

/**
 * Where a refusal or a left-out cell points a reader for the per-iteration detail
 * (A4: a failure has to leave a record, and the record has to say where it is).
 */
const WHERE_THE_DETAILS_LIVE =
  "\n        per-iteration reasons are in that cell's `missing` block in the results " +
  'file, and verbatim in its sibling `.ndjson` (bench/src/runner.ts records a reason ' +
  'per null; scripts/bench/render.mjs prints the same line per cell).';

/**
 * Whether a run may mint a committed baseline (D9 + T02 review S10): clean tree,
 * every launch completed, an idle machine, and on Android an app that is actually
 * compiled. `--force` overrides, loudly.
 */
export function baselineBlockers(run) {
  const reasons = [];
  if (run.perfMarks === true) {
    reasons.push(
      'the run turned on native perf marks (--perf-marks), so every iteration there paid for instrumentation'
    );
  }
  if (run.dirty === true) {
    reasons.push(
      'the working tree is dirty (a baseline must be attributable to a commit)'
    );
  }
  if (run.plan !== BASELINE_PLAN) {
    reasons.push(
      `the run used plan "${String(run.plan ?? 'unknown')}", and a baseline needs "${BASELINE_PLAN}" - quick-plan numbers are local feedback`
    );
  }
  if (!isNumber(run.launches) || run.launches < BASELINE_LAUNCHES) {
    reasons.push(
      `the run used ${String(run.launches ?? 'an unknown number of')} launches per cell, and a baseline needs at least ${String(BASELINE_LAUNCHES)}`
    );
  }
  if (Array.isArray(run.problems) && run.problems.length > 0) {
    reasons.push(
      `${String(run.problems.length)} launch(es) did not complete in this run`
    );
  }
  // A baseline is a table of ratios, so it can only be minted while every metric the
  // table *gates on* is actually being measured (round 4's completeness rule, narrowed
  // by A4). An incomplete metric on a gated arm (`nitro-ui`) or on `rn-core` (the
  // denominator of every ratio) makes the surviving ratios survivor-biased verdicts, and
  // refuses the mint. The same defect on a comparison arm (`expo-ui-*`, `nitro-ui-host`)
  // leaves just that cell out - see `baselineCompleteness()`.
  const { refusals } = baselineCompleteness(run);
  if (refusals.length > 0) {
    const where = refusals
      .slice(0, 3)
      .map(
        (entry) =>
          `${entry.key} ${entry.metric} (${String(entry.samples ?? '?')} of ${String(entry.expected ?? '?')} samples)${missingDetailHint(run, entry.key)}`
      )
      .join('\n  - ');
    reasons.push(
      `${String(refusals.length)} gated metric(s) are n/a because too few samples arrived:\n  - ${where}` +
        WHERE_THE_DETAILS_LIVE
    );
  }
  // Waiting longer than the rule the baseline is recorded under is the same kind of
  // disqualifier as `--perf-marks`: the samples that arrive keep their values, but
  // *which* arrive changes the median, so the run cannot redefine `presented`.
  const timeouts = requestedTimeouts(run);
  if (
    timeouts.presentedTimeoutMs > BASELINE_PRESENTED_TIMEOUT_MS ||
    timeouts.mountTimeoutMs > BASELINE_MOUNT_TIMEOUT_MS
  ) {
    reasons.push(
      `the run waited longer for a signal than a baseline is recorded under (${String(timeouts.mountTimeoutMs)} ms mount / ${String(timeouts.presentedTimeoutMs)} ms presented vs ${String(BASELINE_MOUNT_TIMEOUT_MS)}/${String(BASELINE_PRESENTED_TIMEOUT_MS)}), so which samples arrived is not comparable with a committed baseline - it is a diagnostic run like --perf-marks`
    );
  }
  const machine = run.machine ?? {};
  const load = loadBlocker(machine);
  if (load != null) {
    reasons.push(load);
  }
  // The ART compile state is a comparability regime, not a detail: with the
  // baseline profile in force (`speed-profile`) versus left at `verify`, T12
  // measured the same code's launch-paired ratio to the shared host move 1.22x ->
  // 0.99x on mount `presented` and 2.28x -> 2.45x on memory, so a baseline minted
  // from an uncompiled app would gate future runs against a different regime
  // (`docs/architecture/benchmarks.md`). iOS has no ART and is exempt.
  if (run.platform === 'android') {
    if (run.art == null) {
      reasons.push(
        'the run did not record an ART compile state, so its regime is unknown (anything before T12 measured the interpreter)'
      );
    } else if (run.art.status !== 'speed-profile') {
      reasons.push(
        `the app was still at ART status "${String(run.art.status)}", so this run measured the interpreter: a baseline has to be recorded at speed-profile (${String(run.art.primed === false ? 'priming was attempted and did not reach it' : 'priming did not run')})`
      );
    }
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
  // Comparison-arm cells with an incomplete metric do not go in the table (A4): a
  // survivor-biased reference row is worthless to gate against and would be quoted as
  // if it were whole. They are collected in `skippedCells` instead - with the metric,
  // its sample counts and the recorded reasons - so the file says what is missing and
  // why, rather than looking like the cell was never measured.
  const { comparisonGaps } = baselineCompleteness(run);
  const gapsByCell = {};
  for (const gap of comparisonGaps) {
    (gapsByCell[gap.key] ??= []).push(gap);
  }
  const skippedCells = {};
  for (const [key, gaps] of Object.entries(gapsByCell).sort()) {
    const cell = cellsFrom(run.cells ?? run)[key] ?? {};
    skippedCells[key] = {
      scenario: cell.scenario ?? parseCellKey(key).scenario,
      implementation: cell.implementation ?? parseCellKey(key).implementation,
      n: cell.n ?? parseCellKey(key).n,
      skipReason: gaps.map((gap) => `${gap.metric} incomplete`).join(', '),
      skipReasons: gaps.map(
        (gap) =>
          `${gap.metric}: ${String(gap.samples ?? '?')} of ${String(gap.expected ?? '?')} samples arrived${missingDetailHint(run, key)}`
      ),
    };
  }
  for (const [key, entry] of Object.entries(table)) {
    if (skippedCells[key] != null) {
      continue;
    }
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
  const timeouts = requestedTimeouts(run);
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
    art: run.art ?? null,
    /**
     * The waiting rule this table was recorded under (A4). A baseline's `presented`
     * column only means anything with its timeout attached: raise the wait and
     * previously-missing samples start arriving, which moves the median without
     * anything about the app changing.
     */
    timeouts: {
      mountTimeoutMs:
        timeouts.mountTimeoutMs > 0
          ? timeouts.mountTimeoutMs
          : BASELINE_MOUNT_TIMEOUT_MS,
      presentedTimeoutMs:
        timeouts.presentedTimeoutMs > 0
          ? timeouts.presentedTimeoutMs
          : BASELINE_PRESENTED_TIMEOUT_MS,
    },
    /**
     * Comparison-arm cells left out of `cells`, and why (A4). Empty in a run where
     * every signal arrived.
     */
    skippedCells,
    cells,
  };
}

/**
 * The lines a mint prints after writing, naming every comparison-arm cell the file left
 * out and why (A4). Nothing for a run with no gaps, so a clean mint's output does not
 * grow a section nobody asked for.
 *
 * In `lib.mjs` rather than `report.mjs` so it can be unit tested: the reporter imports
 * `node:fs` and `import.meta`, and the important half of a mint is not just that the
 * cells were left out but that the run *said so* on the terminal.
 */
export function skippedCellNotes(baseline, { display }) {
  const skipped = baseline?.skippedCells ?? {};
  const keys = Object.keys(skipped).sort();
  if (keys.length === 0) {
    return [];
  }
  const lines = [
    `Left out of the baseline: ${String(keys.length)} comparison-arm cell(s) with an incomplete metric (D9's A4 amendment - a comparison arm carries no verdict, so its gap costs it its own row, not the table):`,
  ];
  for (const key of keys) {
    for (const reason of skipped[key].skipReasons ?? [
      skipped[key].skipReason ?? 'incomplete',
    ]) {
      lines.push(`  - ${key}: ${reason}`);
    }
  }
  lines.push(
    `        details: \`${display}\` -> \`skippedCells\`; per-iteration reasons in the results file's cells -> \`missing\`.`
  );
  return lines;
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

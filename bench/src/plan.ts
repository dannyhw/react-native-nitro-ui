import type {
  BenchPlan,
  ComponentName,
  ImplementationName,
  ScenarioAction,
  ScenarioName,
} from './types';

const ACTIONS: readonly ScenarioAction[] = [
  'mount',
  'update',
  'memory',
  'leak',
];

/**
 * Components other than the first one carry their name in the scenario cell.
 * `switch` is deliberately absent: its cells are the bare action names, which
 * is what every pre-G1 results file and baseline says.
 */
const SUFFIXED_COMPONENTS: readonly Exclude<ComponentName, 'switch'>[] = [
  'slider',
  'button',
  'progress',
  'segmented-control',
  'date-picker',
  'picker',
];

const IMPLEMENTATIONS: readonly ImplementationName[] = [
  'rn-core',
  'expo-ui-host-per-control',
  'expo-ui-shared-host',
  'nitro-ui',
  // The library's own controls in one shared composition (`Host`). It is a
  // cell the arm itself refuses for any component but Switch
  // (`BenchImplementation.components`), which is why it can sit in the shared plan.
  'nitro-ui-host',
];

/**
 * Split `update.slider` into its action and component. A bare action is the
 * first component's cell. Returns null for anything else, including a
 * `mount.button` - a cell the plan asks for that no arm implements must fail
 * the launch, not measure the wrong control.
 */
function splitScenario(value: string): [ScenarioAction, ComponentName] | null {
  const dot = value.indexOf('.');
  if (dot === -1) {
    return (ACTIONS as readonly string[]).includes(value)
      ? [value as ScenarioAction, 'switch']
      : null;
  }
  const action = value.slice(0, dot);
  const component = value.slice(dot + 1);
  if (
    !(ACTIONS as readonly string[]).includes(action) ||
    !(SUFFIXED_COMPONENTS as readonly string[]).includes(
      component as Exclude<ComponentName, 'switch'>
    )
  ) {
    return null;
  }
  return [action as ScenarioAction, component as ComponentName];
}

function isImplementation(value: string): value is ImplementationName {
  return (IMPLEMENTATIONS as readonly string[]).includes(value);
}

/**
 * Cells whose arm cannot produce a mounting transaction, so the probe's mount
 * hook has nothing to stamp: `update.slider:rn-core` flips a value the floor
 * `View` does not take (`implementations/rnCore.tsx`), which means the commit
 * changes no props on any native node, so no transaction is created and both
 * signals time out - 1.5 s + 2 s per iteration, about 95 s per launch, for two
 * numbers that are `n/a` in the table either way.
 *
 * Keyed `scenario:implementation`, because it is a property of the pair: the
 * same arm *does* signal on `mount.slider` (mounting 50 views is a transaction)
 * and `rn-core` signals on every `switch` cell.
 */
const NO_MOUNT_SIGNAL: readonly string[] = [
  'update.slider:rn-core',
  // The same shape for Progress: RN core's control arm is an `ActivityIndicator`
  // (G3 brief), which has no value to flip, so a `update.progress` commit
  // changes no native prop and creates no transaction.
  'update.progress:rn-core',
];

/**
 * Parse the `scenario:implementation:N[:marks]` launch argument.
 * Returns null for an unconfigured launch, which renders the idle screen.
 *
 * The optional 4th token asks for the runtime's own native perf marks
 * (`bun bench --perf-marks`). It is deliberately part of the launch argument
 * rather than an env var: a release build has no env, and one launch must be
 * fully described by the string the runner passed it.
 */
export function parsePlan(raw: string): BenchPlan | null {
  if (raw.length === 0) {
    return null;
  }
  const parts = raw.split(':');
  const [scenario, implementation, count, flags] = parts;
  const halves = scenario == null ? null : splitScenario(scenario);
  if (
    (parts.length !== 3 && parts.length !== 4) ||
    scenario == null ||
    implementation == null ||
    count == null ||
    halves === null ||
    !isImplementation(implementation)
  ) {
    throw new Error(
      `NITRO_BENCH unparseable plan "${raw}" (expected scenario:implementation:N, ` +
        `got scenarios ${ACTIONS.map((action) =>
          [action, ...SUFFIXED_COMPONENTS.map((c) => `${action}.${c}`)].join(
            '|'
          )
        ).join('|')} and implementations ${IMPLEMENTATIONS.join('|')})`
    );
  }
  const n = Number(count);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(
      `NITRO_BENCH plan "${raw}" has a non-negative integer count`
    );
  }
  if (flags != null && flags !== 'marks') {
    throw new Error(
      `NITRO_BENCH plan "${raw}" has an unknown flag "${flags}" (known: marks)`
    );
  }
  const [action, component] = halves;
  return {
    scenario: scenario as ScenarioName,
    action,
    component,
    implementation,
    n,
    mountSignal: !NO_MOUNT_SIGNAL.includes(`${scenario}:${implementation}`),
    perfMarks: flags === 'marks',
  };
}

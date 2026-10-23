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
];

const IMPLEMENTATIONS: readonly ImplementationName[] = [
  'rn-core',
  'expo-ui-host-per-control',
  'expo-ui-shared-host',
  'nitro-ui',
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
    perfMarks: flags === 'marks',
  };
}

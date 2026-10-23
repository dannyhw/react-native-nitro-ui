import type { BenchPlan, ImplementationName, ScenarioName } from './types';

const SCENARIOS: readonly ScenarioName[] = [
  'mount',
  'update',
  'memory',
  'leak',
];
const IMPLEMENTATIONS: readonly ImplementationName[] = [
  'rn-core',
  'expo-ui-host-per-control',
  'expo-ui-shared-host',
  'nitro-ui',
];

function isScenario(value: string): value is ScenarioName {
  return (SCENARIOS as readonly string[]).includes(value);
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
  if (
    (parts.length !== 3 && parts.length !== 4) ||
    scenario == null ||
    implementation == null ||
    count == null ||
    !isScenario(scenario) ||
    !isImplementation(implementation)
  ) {
    throw new Error(
      `NITRO_BENCH unparseable plan "${raw}" (expected scenario:implementation:N, ` +
        `got scenarios ${SCENARIOS.join('|')} and implementations ${IMPLEMENTATIONS.join('|')})`
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
  return { scenario, implementation, n, perfMarks: flags === 'marks' };
}

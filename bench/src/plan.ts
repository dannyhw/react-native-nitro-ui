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
 * Parse the `scenario:implementation:N` launch argument.
 * Returns null for an unconfigured launch, which renders the idle screen.
 */
export function parsePlan(raw: string): BenchPlan | null {
  if (raw.length === 0) {
    return null;
  }
  const parts = raw.split(':');
  const [scenario, implementation, count] = parts;
  if (
    parts.length !== 3 ||
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
  return { scenario, implementation, n };
}

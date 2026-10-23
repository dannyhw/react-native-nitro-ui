import { NitroModules } from 'react-native-nitro-modules';
import type { BenchProbe } from './BenchProbe.nitro';

/**
 * Lazily created probe. Creating it is what triggers autolinking, so this must
 * not happen at import time in a release app that may not have the module.
 */
let probe: BenchProbe | null = null;

export function benchProbe(): BenchProbe {
  if (probe == null) {
    probe = NitroModules.createHybridObject<BenchProbe>('BenchProbe');
  }
  return probe;
}

export type { BenchProbe };
export { BenchThread } from './BenchProbe.nitro';

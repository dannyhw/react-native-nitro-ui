import type { BenchImplementation } from '../types';
import { ExpoUiHostPerControlList, ExpoUiSharedHostList } from './expoUi';
import {
  NitroUiList,
  drainNitroUiPerfMarks,
  enableNitroUiPerfMarks,
} from './nitroUi';
import { RnCoreList } from './rnCore';

/**
 * The implementations the runner can measure, in ABBA-interleaving order.
 *
 * `rn-core` is the control arm and always runs. `nitro-ui` is the library under
 * development - the only arm with native perf marks, and the only gated one.
 *
 * Adding a new component to the matrix means one branch per arm here (they
 * dispatch on `BenchListProps.component`) plus the plan cells; the arm names, the
 * runner and the gate do not change.
 */
export const implementations: BenchImplementation[] = [
  {
    name: 'rn-core',
    available: true,
    skipReason: null,
    List: RnCoreList,
    enablePerfMarks: null,
    drainPerfMarks: null,
  },
  {
    name: 'expo-ui-host-per-control',
    available: true,
    skipReason: null,
    List: ExpoUiHostPerControlList,
    enablePerfMarks: null,
    drainPerfMarks: null,
  },
  {
    name: 'expo-ui-shared-host',
    available: true,
    skipReason: null,
    List: ExpoUiSharedHostList,
    enablePerfMarks: null,
    drainPerfMarks: null,
  },
  {
    name: 'nitro-ui',
    available: true,
    skipReason: null,
    List: NitroUiList,
    enablePerfMarks: enableNitroUiPerfMarks,
    drainPerfMarks: drainNitroUiPerfMarks,
  },
];

export function findImplementation(name: string): BenchImplementation | null {
  for (const implementation of implementations) {
    if (implementation.name === name) {
      return implementation;
    }
  }
  return null;
}

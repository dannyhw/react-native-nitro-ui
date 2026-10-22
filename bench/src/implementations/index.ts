import type { BenchImplementation } from '../types';
import { ExpoUiHostPerControlList, ExpoUiSharedHostList } from './expoUi';
import {
  NITRO_UI_AVAILABLE,
  NITRO_UI_SKIP_REASON,
  NitroUiList,
} from './nitroUi';
import { RnCoreList } from './rnCore';

/**
 * The implementations the runner can measure, in ABBA-interleaving order.
 *
 * `rn-core` is the control arm and always runs. `nitro-ui` is listed unconditionally
 * but self-skips until T10 exports a component (see ./nitroUi.tsx).
 *
 * Adding a new component to the matrix means adding one entry here plus its
 * scenario props; nothing else in the harness changes.
 */
export const implementations: BenchImplementation[] = [
  {
    name: 'rn-core',
    available: true,
    skipReason: null,
    List: RnCoreList,
  },
  {
    name: 'expo-ui-host-per-control',
    available: true,
    skipReason: null,
    List: ExpoUiHostPerControlList,
  },
  {
    name: 'expo-ui-shared-host',
    available: true,
    skipReason: null,
    List: ExpoUiSharedHostList,
  },
  {
    name: 'nitro-ui',
    available: NITRO_UI_AVAILABLE,
    skipReason: NITRO_UI_SKIP_REASON,
    List: NitroUiList,
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

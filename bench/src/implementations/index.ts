import type { BenchImplementation } from '../types';
import { ExpoUiHostPerControlList, ExpoUiSharedHostList } from './expoUi';
import {
  ExpoUiButtonHostPerControlList,
  ExpoUiButtonSharedHostList,
} from './expoUiButton';
import {
  NitroUiButtonList,
  NitroUiList,
  drainNitroUiPerfMarks,
  enableNitroUiPerfMarks,
} from './nitroUi';
import { RnCoreButtonList } from './rnCoreButton';
import { RnCoreList } from './rnCore';

/**
 * The implementations the runner can measure, in ABBA-interleaving order.
 *
 * `rn-core` is the control arm and always runs. `nitro-ui` is the library under
 * development - the only arm with native perf marks, and the only gated one.
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
  {
    name: 'rn-core-button',
    available: true,
    skipReason: null,
    List: RnCoreButtonList,
    enablePerfMarks: null,
    drainPerfMarks: null,
  },
  {
    name: 'expo-ui-host-per-control-button',
    available: true,
    skipReason: null,
    List: ExpoUiButtonHostPerControlList,
    enablePerfMarks: null,
    drainPerfMarks: null,
  },
  {
    name: 'expo-ui-shared-host-button',
    available: true,
    skipReason: null,
    List: ExpoUiButtonSharedHostList,
    enablePerfMarks: null,
    drainPerfMarks: null,
  },
  {
    name: 'nitro-ui-button',
    available: true,
    skipReason: null,
    List: NitroUiButtonList,
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

import { Platform } from 'react-native';

import type { BenchImplementation } from '../types';
import { ExpoUiHostPerControlList, ExpoUiSharedHostList } from './expoUi';
import {
  NitroUiHostList,
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
    components: null,
    List: RnCoreList,
    enablePerfMarks: null,
    drainPerfMarks: null,
  },
  {
    name: 'expo-ui-host-per-control',
    available: true,
    skipReason: null,
    components: null,
    List: ExpoUiHostPerControlList,
    enablePerfMarks: null,
    drainPerfMarks: null,
  },
  {
    name: 'expo-ui-shared-host',
    available: true,
    skipReason: null,
    components: null,
    List: ExpoUiSharedHostList,
    enablePerfMarks: null,
    drainPerfMarks: null,
  },
  {
    name: 'nitro-ui',
    available: true,
    skipReason: null,
    components: null,
    List: NitroUiList,
    enablePerfMarks: enableNitroUiPerfMarks,
    drainPerfMarks: drainNitroUiPerfMarks,
  },
  // T17 spike: the same library's controls inside one shared `<Host>`, so one
  // hosting controller for the batch instead of one per control. Not gated (it is
  // not the shipping arm). iOS-only, because that is what T17 built - the Android
  // twin is on branch `task/T16-host-spike`, and `<Host>` renders a plain `View`
  // there, which would be a number measuring nothing.
  {
    name: 'nitro-ui-host',
    available: Platform.OS === 'ios',
    skipReason: 'the iOS Host spike (T17); Android has no Host on this branch',
    components: ['switch', 'slider'],
    List: NitroUiHostList,
    enablePerfMarks: null,
    drainPerfMarks: null,
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

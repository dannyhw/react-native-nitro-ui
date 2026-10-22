import { NitroModules } from 'react-native-nitro-modules';

import type { NitroUiCore } from './NitroUiCore.nitro';

let core: NitroUiCore | null = null;

/**
 * The native core object, created on first use.
 *
 * Lazily created on purpose: importing `react-native-nitro-ui` must not touch
 * native code before the app is up (and unit tests must be able to import the
 * package without a native runtime).
 */
function getCore(): NitroUiCore {
  if (core == null) {
    core = NitroModules.createHybridObject<NitroUiCore>('NitroUiCore');
  }
  return core;
}

/**
 * Access to the shared native core runtime. Internal for now - components (T10)
 * and the benchmark probe (T02) build on top of it.
 */
export const nitroUiCore: Pick<NitroUiCore, 'now'> = {
  now(): number {
    return getCore().now();
  },
};

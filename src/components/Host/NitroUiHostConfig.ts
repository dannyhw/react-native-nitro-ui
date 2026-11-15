import type { ViewConfig } from 'react-native-nitro-modules';

import type { NitroUiHostProps } from './Host.nitro';

/**
 * The Fabric view config of the `NitroUiHost` Hybrid View. A hand-kept copy of
 * the JSON config nitrogen generates; a unit test fails when the two disagree.
 */
export const NitroUiHostConfig: ViewConfig<NitroUiHostProps> = {
  uiViewClassName: 'NitroUiHost',
  supportsRawText: false,
  bubblingEventTypes: {},
  directEventTypes: {},
  // A Host has no props of its own: `hybridRef` is the one nitrogen adds to every
  // Hybrid View.
  validAttributes: {
    hybridRef: true,
  },
};

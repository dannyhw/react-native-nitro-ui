import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiProgressProps } from './NativeNitroUiProgress';

/**
 * The Fabric view config of the `NitroUiProgress` Hybrid View. A hand-kept copy of
 * the JSON config nitrogen generates; a unit test fails when the two disagree.
 */
export const NitroUiProgressConfig: ViewConfig<NativeNitroUiProgressProps> = {
  uiViewClassName: 'NitroUiProgress',
  supportsRawText: false,
  bubblingEventTypes: {},
  directEventTypes: {},
  validAttributes: {
    variant: true,
    appearance: true,
    contained: true,
    value: true,
    tintColor: true,
    trackColor: true,
    testID: true,
    accessibilityLabel: true,
    nuiPerfId: true,
    nuiSizingKey: true,
    nuiSizingId: true,
    hybridRef: true,
  },
};

import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiSwitchProps } from './NativeNitroUiSwitch';

/**
 * The Fabric view config of the `NitroUiSwitch` Hybrid View. A hand-kept copy of
 * the JSON config nitrogen generates; a unit test fails when the two disagree.
 */
export const NitroUiSwitchConfig: ViewConfig<NativeNitroUiSwitchProps> = {
  uiViewClassName: 'NitroUiSwitch',
  supportsRawText: false,
  bubblingEventTypes: {},
  directEventTypes: {},
  validAttributes: {
    value: true,
    defaultValue: true,
    mostRecentEventCount: true,
    disabled: true,
    tintColor: true,
    testID: true,
    accessibilityLabel: true,
    nuiPerfId: true,
    nuiTestWidth: true,
    onValueChange: true,
    nuiSizingKey: true,
    nuiSizingId: true,
    hybridRef: true,
  },
};

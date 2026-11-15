import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiCheckboxProps } from './NativeNitroUiCheckbox';

/**
 * The Fabric view config of the `NitroUiCheckbox` Hybrid View. A hand-kept copy of
 * the JSON config nitrogen generates; a unit test fails when the two disagree.
 */
export const NitroUiCheckboxConfig: ViewConfig<NativeNitroUiCheckboxProps> = {
  uiViewClassName: 'NitroUiCheckbox',
  supportsRawText: false,
  bubblingEventTypes: {},
  directEventTypes: {},
  validAttributes: {
    checked: true,
    defaultChecked: true,
    indeterminate: true,
    mostRecentEventCount: true,
    label: true,
    iosStyle: true,
    disabled: true,
    tintColor: true,
    testID: true,
    accessibilityLabel: true,
    nuiPerfId: true,
    onCheckedChange: true,
    nuiSizingKey: true,
    nuiSizingId: true,
    hybridRef: true,
  },
};

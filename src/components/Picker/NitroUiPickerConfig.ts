import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiPickerProps } from './NativeNitroUiPicker';

/**
 * Fabric view config of `NitroUiPicker`: a copy of nitrogen's generated JSON,
 * which `src/` cannot import. A unit test fails when the two differ.
 */
export const NitroUiPickerConfig: ViewConfig<NativeNitroUiPickerProps> = {
  uiViewClassName: 'NitroUiPicker',
  supportsRawText: false,
  bubblingEventTypes: {},
  directEventTypes: {},
  validAttributes: {
    options: true,
    selectedIndex: true,
    defaultSelectedIndex: true,
    mostRecentEventCount: true,
    variant: true,
    label: true,
    disabled: true,
    tintColor: true,
    testID: true,
    accessibilityLabel: true,
    nuiPerfId: true,
    onValueChange: true,
    nuiSizingKey: true,
    nuiSizingId: true,
    hybridRef: true,
  },
};

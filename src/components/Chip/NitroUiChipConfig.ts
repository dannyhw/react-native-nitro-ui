import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiChipProps } from './NativeNitroUiChip';

/**
 * Fabric view config of `NitroUiChip`: a copy of nitrogen's generated JSON,
 * which `src/` cannot import. A unit test fails when the two differ.
 */
export const NitroUiChipConfig: ViewConfig<NativeNitroUiChipProps> = {
  uiViewClassName: 'NitroUiChip',
  supportsRawText: false,
  bubblingEventTypes: {},
  directEventTypes: {},
  validAttributes: {
    label: true,
    variant: true,
    selected: true,
    defaultSelected: true,
    mostRecentEventCount: true,
    disabled: true,
    systemImage: true,
    androidIcon: true,
    testID: true,
    accessibilityLabel: true,
    nuiPerfId: true,
    onSelectedChange: true,
    onPress: true,
    nuiSizingKey: true,
    nuiSizingId: true,
    hybridRef: true,
  },
};

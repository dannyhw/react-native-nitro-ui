import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiListItemProps } from './NativeNitroUiListItem';

/**
 * The Fabric view config of the `NitroUiListItem` Hybrid View. A hand-kept copy of
 * the JSON config nitrogen generates; a unit test fails when the two disagree.
 */
export const NitroUiListItemConfig: ViewConfig<NativeNitroUiListItemProps> = {
  uiViewClassName: 'NitroUiListItem',
  supportsRawText: false,
  bubblingEventTypes: {},
  directEventTypes: {},
  validAttributes: {
    title: true,
    subtitle: true,
    value: true,
    systemImage: true,
    androidIcon: true,
    accessory: true,
    pressable: true,
    insideRow: true,
    disabled: true,
    testID: true,
    accessibilityLabel: true,
    nuiPerfId: true,
    onPress: true,
    nuiSizingKey: true,
    nuiSizingId: true,
    hybridRef: true,
  },
};

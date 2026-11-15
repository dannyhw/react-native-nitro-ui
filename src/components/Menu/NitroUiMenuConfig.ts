import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiMenuProps } from './NativeNitroUiMenu';

/**
 * The Fabric view config of the `NitroUiMenu` Hybrid View. A hand-kept copy of
 * the JSON config nitrogen generates; a unit test fails when the two disagree.
 */
export const NitroUiMenuConfig: ViewConfig<NativeNitroUiMenuProps> = {
  uiViewClassName: 'NitroUiMenu',
  supportsRawText: false,
  bubblingEventTypes: {},
  directEventTypes: {},
  validAttributes: {
    title: true,
    variant: true,
    size: true,
    disabled: true,
    rows: true,
    tintColor: true,
    systemImage: true,
    androidIcon: true,
    hasPrimaryAction: true,
    testID: true,
    accessibilityLabel: true,
    nuiPerfId: true,
    onSelect: true,
    onOpen: true,
    onClose: true,
    primaryAction: true,
    nuiSizingKey: true,
    nuiSizingId: true,
    hybridRef: true,
  },
};

import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiButtonProps } from './NativeNitroUiButton';

/**
 * Fabric view config of `NitroUiButton`: a copy of nitrogen's generated JSON,
 * which `src/` cannot import. A unit test fails when the two differ.
 */
export const NitroUiButtonConfig: ViewConfig<NativeNitroUiButtonProps> = {
  uiViewClassName: 'NitroUiButton',
  supportsRawText: false,
  bubblingEventTypes: {},
  directEventTypes: {},
  validAttributes: {
    title: true,
    variant: true,
    size: true,
    shape: true,
    disabled: true,
    tintColor: true,
    systemImage: true,
    androidIcon: true,
    testID: true,
    accessibilityLabel: true,
    nuiPerfId: true,
    onPress: true,
    nuiSizingKey: true,
    nuiSizingId: true,
    hybridRef: true,
  },
};

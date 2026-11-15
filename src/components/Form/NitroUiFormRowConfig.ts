import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiFormRowProps } from './NativeFormViews';

/**
 * The Fabric view config of the `NitroUiFormRow` Hybrid View: an inline copy of the JSON
 * nitrogen generates, which a unit test compares against nitrogen's output.
 */
export const NitroUiFormRowConfig: ViewConfig<NativeNitroUiFormRowProps> = {
  uiViewClassName: 'NitroUiFormRow',
  supportsRawText: false,
  bubblingEventTypes: {},
  directEventTypes: {},
  validAttributes: {
    accessory: true,
    selected: true,
    pressable: true,
    nuiPerfId: true,
    onPress: true,
    onContentBox: true,
    hybridRef: true,
  },
};

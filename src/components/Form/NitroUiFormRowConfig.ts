import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiFormRowProps } from './NativeFormViews';

/**
 * The Fabric view config of the `NitroUiFormRow` Hybrid View.
 *
 * A copy of `nitrogen/generated/shared/json/NitroUiFormRowConfig.json`, kept inline for the
 * reason `NitroUiMenuConfig.ts` gives. `src/__tests__/viewConfigs.test.ts` fails when the
 * copy and nitrogen's output disagree.
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

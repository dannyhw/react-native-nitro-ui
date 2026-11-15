import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiFormProps } from './NativeFormViews';

/**
 * The Fabric view config of the `NitroUiForm` Hybrid View. It must match
 * `nitrogen/generated/shared/json/NitroUiFormConfig.json`.
 */
export const NitroUiFormConfig: ViewConfig<NativeNitroUiFormProps> = {
  uiViewClassName: 'NitroUiForm',
  supportsRawText: false,
  bubblingEventTypes: {},
  directEventTypes: {},
  validAttributes: {
    keyboardAvoidance: true,
    nuiContentOffsetY: true,
    nuiPerfId: true,
    onContentBox: true,
    onContentOffset: true,
    onImeInset: true,
    hybridRef: true,
  },
};

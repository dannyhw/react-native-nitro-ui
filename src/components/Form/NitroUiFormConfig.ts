import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiFormProps } from './NativeFormViews';

/**
 * The Fabric view config of the `NitroUiForm` Hybrid View.
 *
 * A copy of `nitrogen/generated/shared/json/NitroUiFormConfig.json`, kept inline for the
 * reason `NitroUiMenuConfig.ts` gives. `src/__tests__/viewConfigs.test.ts` fails when the
 * copy and nitrogen's output disagree.
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

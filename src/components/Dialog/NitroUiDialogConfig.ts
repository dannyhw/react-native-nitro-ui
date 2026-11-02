import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiDialogProps } from './NativeNitroUiDialog';

/**
 * The Fabric view config of the `NitroUiDialog` Hybrid View.
 *
 * A copy of `nitrogen/generated/shared/json/NitroUiDialogConfig.json`, kept
 * inline for the reason `NitroUiMenuConfig.ts` gives. `src/__tests__/
 * viewConfigs.test.ts` fails when the copy and nitrogen's output disagree.
 */
export const NitroUiDialogConfig: ViewConfig<NativeNitroUiDialogProps> = {
  uiViewClassName: 'NitroUiDialog',
  supportsRawText: false,
  bubblingEventTypes: {},
  directEventTypes: {},
  validAttributes: {
    variant: true,
    presented: true,
    mostRecentEventCount: true,
    title: true,
    message: true,
    titleVisibility: true,
    actions: true,
    dismissible: true,
    tintColor: true,
    testID: true,
    nuiPerfId: true,
    onPresentedChange: true,
    onAction: true,
    hybridRef: true,
  },
};

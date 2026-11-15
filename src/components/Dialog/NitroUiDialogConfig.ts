import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiDialogProps } from './NativeNitroUiDialog';

/**
 * The Fabric view config of the `NitroUiDialog` Hybrid View. A hand-kept copy of
 * the JSON config nitrogen generates; a unit test fails when the two disagree.
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

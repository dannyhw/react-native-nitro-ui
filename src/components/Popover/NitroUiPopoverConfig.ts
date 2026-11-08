import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiPopoverProps } from './NativeNitroUiPopover';

/**
 * The Fabric view config of the `NitroUiPopover` Hybrid View.
 *
 * A copy of `nitrogen/generated/shared/json/NitroUiPopoverConfig.json`, kept inline
 * for the reason `NitroUiMenuConfig.ts` gives. `src/__tests__/viewConfigs.test.ts`
 * fails when the copy and nitrogen's output disagree.
 */
export const NitroUiPopoverConfig: ViewConfig<NativeNitroUiPopoverProps> = {
  uiViewClassName: 'NitroUiPopover',
  supportsRawText: false,
  bubblingEventTypes: {},
  directEventTypes: {},
  validAttributes: {
    presented: true,
    mostRecentEventCount: true,
    maxWidth: true,
    testID: true,
    nuiPerfId: true,
    onPresentedChange: true,
    onDismissed: true,
    hybridRef: true,
  },
};

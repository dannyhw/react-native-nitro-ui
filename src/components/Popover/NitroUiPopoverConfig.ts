import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiPopoverProps } from './NativeNitroUiPopover';

/**
 * Fabric view config of `NitroUiPopover`: a copy of nitrogen's generated JSON,
 * which `src/` cannot import. A unit test fails when the two differ.
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

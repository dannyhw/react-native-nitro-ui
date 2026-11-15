import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiTooltipProps } from './NativeNitroUiTooltip';

/**
 * Fabric view config of `NitroUiTooltip`: a copy of nitrogen's generated JSON,
 * which `src/` cannot import. A unit test fails when the two differ.
 */
export const NitroUiTooltipConfig: ViewConfig<NativeNitroUiTooltipProps> = {
  uiViewClassName: 'NitroUiTooltip',
  supportsRawText: false,
  bubblingEventTypes: {},
  directEventTypes: {},
  validAttributes: {
    presented: true,
    mostRecentEventCount: true,
    message: true,
    title: true,
    actions: true,
    placement: true,
    testID: true,
    nuiPerfId: true,
    onPresentedChange: true,
    onAction: true,
    hybridRef: true,
  },
};

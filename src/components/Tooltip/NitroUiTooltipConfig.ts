import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiTooltipProps } from './NativeNitroUiTooltip';

/**
 * The Fabric view config of the `NitroUiTooltip` Hybrid View.
 *
 * A copy of `nitrogen/generated/shared/json/NitroUiTooltipConfig.json`, kept inline
 * for the reason `NitroUiMenuConfig.ts` gives. `src/__tests__/viewConfigs.test.ts`
 * fails when the copy and nitrogen's output disagree.
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

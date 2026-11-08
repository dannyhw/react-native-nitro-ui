import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiFormSectionProps } from './NativeFormViews';

/**
 * The Fabric view config of the `NitroUiFormSection` Hybrid View.
 *
 * A copy of `nitrogen/generated/shared/json/NitroUiFormSectionConfig.json`, kept inline for
 * the reason `NitroUiMenuConfig.ts` gives. `src/__tests__/viewConfigs.test.ts` fails when
 * the copy and nitrogen's output disagree.
 */
export const NitroUiFormSectionConfig: ViewConfig<NativeNitroUiFormSectionProps> =
  {
    uiViewClassName: 'NitroUiFormSection',
    supportsRawText: false,
    bubblingEventTypes: {},
    directEventTypes: {},
    validAttributes: {
      title: true,
      footer: true,
      nuiPerfId: true,
      onMetrics: true,
      onPlacement: true,
      hybridRef: true,
    },
  };

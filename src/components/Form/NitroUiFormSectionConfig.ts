import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiFormSectionProps } from './NativeFormViews';

/**
 * The Fabric view config of the `NitroUiFormSection` Hybrid View. Must match
 * `nitrogen/generated/shared/json/NitroUiFormSectionConfig.json`; a unit test compares them.
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

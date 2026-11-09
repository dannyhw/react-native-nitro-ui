import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiStepperProps } from './NativeNitroUiStepper';

/**
 * The Fabric view config of the `NitroUiStepper` Hybrid View.
 *
 * A copy of `nitrogen/generated/shared/json/NitroUiStepperConfig.json`, kept
 * inline for the reason `NitroUiButtonConfig.ts` gives (a published `src/` module
 * may not import a JSON file above `src`). `src/__tests__/viewConfigs.test.ts`
 * fails when the copy and nitrogen's output disagree.
 */
export const NitroUiStepperConfig: ViewConfig<NativeNitroUiStepperProps> = {
  uiViewClassName: 'NitroUiStepper',
  supportsRawText: false,
  bubblingEventTypes: {},
  directEventTypes: {},
  validAttributes: {
    value: true,
    defaultValue: true,
    mostRecentEventCount: true,
    minimumValue: true,
    maximumValue: true,
    step: true,
    disabled: true,
    testID: true,
    accessibilityLabel: true,
    nuiPerfId: true,
    onValueChange: true,
    nuiSizingKey: true,
    nuiSizingId: true,
    hybridRef: true,
  },
};

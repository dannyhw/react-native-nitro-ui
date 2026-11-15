import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiStepperProps } from './NativeNitroUiStepper';

/**
 * The Fabric view config of the `NitroUiStepper` Hybrid View. A hand-kept copy of
 * the JSON config nitrogen generates; a unit test fails when the two disagree.
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

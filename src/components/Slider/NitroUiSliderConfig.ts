import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiSliderProps } from './NativeNitroUiSlider';

/**
 * Fabric view config of `NitroUiSlider`: a copy of nitrogen's generated JSON,
 * which `src/` cannot import. A unit test fails when the two differ.
 */
export const NitroUiSliderConfig: ViewConfig<NativeNitroUiSliderProps> = {
  uiViewClassName: 'NitroUiSlider',
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
    tintColor: true,
    testID: true,
    accessibilityLabel: true,
    nuiPerfId: true,
    onValueChange: true,
    onSlidingStart: true,
    onSlidingComplete: true,
    nuiSizingKey: true,
    nuiSizingId: true,
    hybridRef: true,
  },
};

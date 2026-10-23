import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiSliderProps } from './NativeNitroUiSlider';

/**
 * The Fabric view config of the `NitroUiSlider` Hybrid View.
 *
 * A copy of `nitrogen/generated/shared/json/NitroUiSliderConfig.json`, kept
 * inline because a published `src/` module must not import outside the package
 * source (react-native-builder-bob cannot emit declarations for a JSON module
 * above `src`), and because the copy is reviewable in the diff of a component.
 *
 * `src/__tests__/viewConfigs.test.ts` fails when the copy and nitrogen's output
 * disagree, so this can never drift silently.
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

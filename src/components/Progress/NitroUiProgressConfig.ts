import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiProgressProps } from './NativeNitroUiProgress';

/**
 * The Fabric view config of the `NitroUiProgress` Hybrid View.
 *
 * A copy of `nitrogen/generated/shared/json/NitroUiProgressConfig.json`, kept
 * inline because a published `src/` module must not import outside the package
 * source (react-native-builder-bob cannot emit declarations for a JSON module
 * above `src`), and because the copy is reviewable in the diff of a component.
 *
 * `src/__tests__/viewConfigs.test.ts` fails when the copy and nitrogen's output
 * disagree, so this can never drift silently.
 */
export const NitroUiProgressConfig: ViewConfig<NativeNitroUiProgressProps> = {
  uiViewClassName: 'NitroUiProgress',
  supportsRawText: false,
  bubblingEventTypes: {},
  directEventTypes: {},
  validAttributes: {
    variant: true,
    value: true,
    tintColor: true,
    trackColor: true,
    testID: true,
    accessibilityLabel: true,
    nuiPerfId: true,
    nuiSizingKey: true,
    nuiSizingId: true,
    hybridRef: true,
  },
};

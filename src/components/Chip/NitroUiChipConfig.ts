import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiChipProps } from './NativeNitroUiChip';

/**
 * The Fabric view config of the `NitroUiChip` Hybrid View.
 *
 * A copy of `nitrogen/generated/shared/json/NitroUiChipConfig.json`, kept inline
 * for the reason `NitroUiButtonConfig.ts` gives (a published `src/` module may
 * not import a JSON file above `src`). `src/__tests__/viewConfigs.test.ts` fails
 * when the copy and nitrogen's output disagree.
 */
export const NitroUiChipConfig: ViewConfig<NativeNitroUiChipProps> = {
  uiViewClassName: 'NitroUiChip',
  supportsRawText: false,
  bubblingEventTypes: {},
  directEventTypes: {},
  validAttributes: {
    label: true,
    variant: true,
    selected: true,
    defaultSelected: true,
    mostRecentEventCount: true,
    disabled: true,
    systemImage: true,
    androidIcon: true,
    testID: true,
    accessibilityLabel: true,
    nuiPerfId: true,
    onSelectedChange: true,
    onPress: true,
    nuiSizingKey: true,
    nuiSizingId: true,
    hybridRef: true,
  },
};

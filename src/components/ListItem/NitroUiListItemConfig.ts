import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiListItemProps } from './NativeNitroUiListItem';

/**
 * The Fabric view config of the `NitroUiListItem` Hybrid View.
 *
 * A copy of `nitrogen/generated/shared/json/NitroUiListItemConfig.json`, kept
 * inline for the reason `NitroUiButtonConfig.ts` gives (a published `src/` module
 * may not import a JSON file above `src`). `src/__tests__/viewConfigs.test.ts`
 * fails when the copy and nitrogen's output disagree.
 */
export const NitroUiListItemConfig: ViewConfig<NativeNitroUiListItemProps> = {
  uiViewClassName: 'NitroUiListItem',
  supportsRawText: false,
  bubblingEventTypes: {},
  directEventTypes: {},
  validAttributes: {
    title: true,
    subtitle: true,
    value: true,
    systemImage: true,
    androidIcon: true,
    accessory: true,
    pressable: true,
    insideRow: true,
    disabled: true,
    testID: true,
    accessibilityLabel: true,
    nuiPerfId: true,
    onPress: true,
    nuiSizingKey: true,
    nuiSizingId: true,
    hybridRef: true,
  },
};

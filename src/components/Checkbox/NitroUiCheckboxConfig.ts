import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiCheckboxProps } from './NativeNitroUiCheckbox';

/**
 * The Fabric view config of the `NitroUiCheckbox` Hybrid View.
 *
 * A copy of `nitrogen/generated/shared/json/NitroUiCheckboxConfig.json`, kept
 * inline for the reason `NitroUiButtonConfig.ts` gives (a published `src/` module
 * may not import a JSON file above `src`). `src/__tests__/viewConfigs.test.ts`
 * fails when the copy and nitrogen's output disagree.
 */
export const NitroUiCheckboxConfig: ViewConfig<NativeNitroUiCheckboxProps> = {
  uiViewClassName: 'NitroUiCheckbox',
  supportsRawText: false,
  bubblingEventTypes: {},
  directEventTypes: {},
  validAttributes: {
    checked: true,
    defaultChecked: true,
    indeterminate: true,
    mostRecentEventCount: true,
    label: true,
    disabled: true,
    tintColor: true,
    testID: true,
    accessibilityLabel: true,
    nuiPerfId: true,
    onCheckedChange: true,
    nuiSizingKey: true,
    nuiSizingId: true,
    hybridRef: true,
  },
};

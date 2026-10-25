import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiPickerProps } from './NativeNitroUiPicker';

/**
 * The Fabric view config of the `NitroUiPicker` Hybrid View.
 *
 * A copy of `nitrogen/generated/shared/json/NitroUiPickerConfig.json`, kept
 * inline because a published `src/` module must not import outside the package
 * source (react-native-builder-bob cannot emit declarations for a JSON module
 * above `src`), and because the copy is reviewable in the diff of a component.
 *
 * `src/__tests__/viewConfigs.test.ts` fails when the copy and nitrogen's output
 * disagree, so this can never drift silently.
 */
export const NitroUiPickerConfig: ViewConfig<NativeNitroUiPickerProps> = {
  uiViewClassName: 'NitroUiPicker',
  supportsRawText: false,
  bubblingEventTypes: {},
  directEventTypes: {},
  validAttributes: {
    options: true,
    selectedIndex: true,
    defaultSelectedIndex: true,
    mostRecentEventCount: true,
    variant: true,
    label: true,
    disabled: true,
    tintColor: true,
    testID: true,
    accessibilityLabel: true,
    nuiPerfId: true,
    onValueChange: true,
    nuiSizingKey: true,
    nuiSizingId: true,
    hybridRef: true,
  },
};

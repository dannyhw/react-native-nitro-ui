import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiTextFieldProps } from './NativeNitroUiTextField';

/**
 * The Fabric view config of the `NitroUiTextField` Hybrid View.
 *
 * A copy of `nitrogen/generated/shared/json/NitroUiTextFieldConfig.json`, kept
 * inline for the reasons `NitroUiSwitchConfig.ts` gives;
 * `src/__tests__/viewConfigs.test.ts` fails when the two disagree.
 */
export const NitroUiTextFieldConfig: ViewConfig<NativeNitroUiTextFieldProps> = {
  uiViewClassName: 'NitroUiTextField',
  supportsRawText: false,
  bubblingEventTypes: {},
  directEventTypes: {},
  validAttributes: {
    value: true,
    defaultValue: true,
    mostRecentEventCount: true,
    placeholder: true,
    multiline: true,
    keyboardType: true,
    autoCapitalize: true,
    autoCorrect: true,
    secureTextEntry: true,
    maxLength: true,
    returnKeyType: true,
    editable: true,
    testID: true,
    accessibilityLabel: true,
    nuiPerfId: true,
    onValueChange: true,
    onFocusChange: true,
    onSubmitEditing: true,
    nuiSizingKey: true,
    nuiSizingId: true,
    hybridRef: true,
  },
};

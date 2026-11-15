import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiTextFieldProps } from './NativeNitroUiTextField';

/**
 * Fabric view config of `NitroUiTextField`: a copy of nitrogen's generated
 * JSON, which `src/` cannot import. A unit test fails when the two differ.
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

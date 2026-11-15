import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiSearchFieldProps } from './NativeNitroUiSearchField';

/**
 * The Fabric view config of the `NitroUiSearchField` Hybrid View. A hand-kept copy of
 * the JSON config nitrogen generates; a unit test fails when the two disagree.
 */
export const NitroUiSearchFieldConfig: ViewConfig<NativeNitroUiSearchFieldProps> =
  {
    uiViewClassName: 'NitroUiSearchField',
    supportsRawText: false,
    bubblingEventTypes: {},
    directEventTypes: {},
    validAttributes: {
      value: true,
      defaultValue: true,
      mostRecentEventCount: true,
      placeholder: true,
      keyboardType: true,
      autoCapitalize: true,
      autoCorrect: true,
      maxLength: true,
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

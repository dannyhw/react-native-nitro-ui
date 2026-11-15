import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiDatePickerProps } from './NativeNitroUiDatePicker';

/**
 * Fabric view config of `NitroUiDatePicker`: a copy of nitrogen's generated
 * JSON, which `src/` cannot import. A unit test fails when the two differ.
 */
export const NitroUiDatePickerConfig: ViewConfig<NativeNitroUiDatePickerProps> =
  {
    uiViewClassName: 'NitroUiDatePicker',
    supportsRawText: false,
    bubblingEventTypes: {},
    directEventTypes: {},
    validAttributes: {
      valueMillis: true,
      defaultValueMillis: true,
      mostRecentEventCount: true,
      mode: true,
      variant: true,
      minimumMillis: true,
      maximumMillis: true,
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

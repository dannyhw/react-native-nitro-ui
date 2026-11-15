import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiSegmentedControlProps } from './NativeNitroUiSegmentedControl';

/**
 * The Fabric view config of the `NitroUiSegmentedControl` Hybrid View. A hand-kept copy of
 * the JSON config nitrogen generates; a unit test fails when the two disagree.
 */
export const NitroUiSegmentedControlConfig: ViewConfig<NativeNitroUiSegmentedControlProps> =
  {
    uiViewClassName: 'NitroUiSegmentedControl',
    supportsRawText: false,
    bubblingEventTypes: {},
    directEventTypes: {},
    validAttributes: {
      options: true,
      selectedIndex: true,
      defaultSelectedIndex: true,
      mostRecentEventCount: true,
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

import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiButtonGroupProps } from './NativeNitroUiButtonGroup';

/**
 * The Fabric view config of the `NitroUiButtonGroup` Hybrid View. A hand-kept copy of
 * the JSON config nitrogen generates; a unit test fails when the two disagree.
 */
export const NitroUiButtonGroupConfig: ViewConfig<NativeNitroUiButtonGroupProps> =
  {
    uiViewClassName: 'NitroUiButtonGroup',
    supportsRawText: false,
    bubblingEventTypes: {},
    directEventTypes: {},
    validAttributes: {
      items: true,
      appearance: true,
      variant: true,
      size: true,
      labelStyle: true,
      disabled: true,
      tintColor: true,
      checkedIds: true,
      controlledIds: true,
      defaultCheckedIds: true,
      mostRecentEventCount: true,
      overflowAccessibilityLabel: true,
      accessibilityLabel: true,
      testID: true,
      nuiPerfId: true,
      onPress: true,
      onCheckedChange: true,
      nuiSizingKey: true,
      nuiSizingId: true,
      hybridRef: true,
    },
  };

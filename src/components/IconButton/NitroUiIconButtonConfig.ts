import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiIconButtonProps } from './NativeNitroUiIconButton';

/**
 * Fabric view config of `NitroUiIconButton`: a copy of nitrogen's generated
 * JSON, which `src/` cannot import. A unit test fails when the two differ.
 */
export const NitroUiIconButtonConfig: ViewConfig<NativeNitroUiIconButtonProps> =
  {
    uiViewClassName: 'NitroUiIconButton',
    supportsRawText: false,
    bubblingEventTypes: {},
    directEventTypes: {},
    validAttributes: {
      accessibilityLabel: true,
      systemImage: true,
      androidIcon: true,
      variant: true,
      size: true,
      width: true,
      shape: true,
      disabled: true,
      tintColor: true,
      checked: true,
      defaultChecked: true,
      mostRecentEventCount: true,
      testID: true,
      nuiPerfId: true,
      onPress: true,
      onCheckedChange: true,
      nuiSizingKey: true,
      nuiSizingId: true,
      hybridRef: true,
    },
  };

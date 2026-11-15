import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiBottomSheetProps } from './NativeNitroUiBottomSheet';

/**
 * The Fabric view config of the `NitroUiBottomSheet` Hybrid View. A hand-kept copy of
 * the JSON config nitrogen generates; a unit test fails when the two disagree.
 */
export const NitroUiBottomSheetConfig: ViewConfig<NativeNitroUiBottomSheetProps> =
  {
    uiViewClassName: 'NitroUiBottomSheet',
    supportsRawText: false,
    bubblingEventTypes: {},
    directEventTypes: {},
    validAttributes: {
      presented: true,
      mostRecentEventCount: true,
      detents: true,
      dismissible: true,
      showsGrabber: true,
      cornerRadius: true,
      containerColor: true,
      label: true,
      testID: true,
      nuiPerfId: true,
      onPresentedChange: true,
      onDetentChange: true,
      onDismissed: true,
      onContentBox: true,
      hybridRef: true,
    },
  };

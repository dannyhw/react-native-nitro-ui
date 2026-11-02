import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiBottomSheetProps } from './NativeNitroUiBottomSheet';

/**
 * The Fabric view config of the `NitroUiBottomSheet` Hybrid View.
 *
 * A copy of `nitrogen/generated/shared/json/NitroUiBottomSheetConfig.json`, kept
 * inline for the reason `NitroUiMenuConfig.ts` gives. `src/__tests__/
 * viewConfigs.test.ts` fails when the copy and nitrogen's output disagree.
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

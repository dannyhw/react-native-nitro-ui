import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativePopoverProtoProps } from './PopoverProto';

/**
 * S5 spike only: a copy of
 * `nitrogen/generated/shared/json/NitroUiPopoverProtoConfig.json`, checked by
 * `src/__tests__/viewConfigs.test.ts`.
 */
export const NitroUiPopoverProtoConfig: ViewConfig<NativePopoverProtoProps> = {
  uiViewClassName: 'NitroUiPopoverProto',
  supportsRawText: false,
  bubblingEventTypes: {},
  directEventTypes: {},
  validAttributes: {
    presented: true,
    mostRecentEventCount: true,
    maxWidth: true,
    sizeBeforePresent: true,
    testID: true,
    onPresentedChange: true,
    onDismissed: true,
    hybridRef: true,
  },
};

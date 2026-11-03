import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeContextMenuProtoProps } from './ContextMenuProto';

/**
 * S3 spike only: a copy of
 * `nitrogen/generated/shared/json/NitroUiContextMenuProtoConfig.json`, checked by
 * `src/__tests__/viewConfigs.test.ts`.
 */
export const NitroUiContextMenuProtoConfig: ViewConfig<NativeContextMenuProtoProps> =
  {
    uiViewClassName: 'NitroUiContextMenuProto',
    supportsRawText: false,
    bubblingEventTypes: {},
    directEventTypes: {},
    validAttributes: {
      rows: true,
      title: true,
      disabled: true,
      cancelTouches: true,
      onSelect: true,
      onOpen: true,
      onClose: true,
      onTrace: true,
      hybridRef: true,
    },
  };

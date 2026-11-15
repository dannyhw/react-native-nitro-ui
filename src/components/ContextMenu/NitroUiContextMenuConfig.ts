import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiContextMenuProps } from './NativeNitroUiContextMenu';

/**
 * Fabric view config of `NitroUiContextMenu`: a copy of nitrogen's generated
 * JSON, which `src/` cannot import. A unit test fails when the two differ.
 */
export const NitroUiContextMenuConfig: ViewConfig<NativeNitroUiContextMenuProps> =
  {
    uiViewClassName: 'NitroUiContextMenu',
    supportsRawText: false,
    bubblingEventTypes: {},
    directEventTypes: {},
    validAttributes: {
      rows: true,
      title: true,
      disabled: true,
      previewCornerRadius: true,
      nuiPerfId: true,
      onSelect: true,
      onOpen: true,
      onClose: true,
      hybridRef: true,
    },
  };

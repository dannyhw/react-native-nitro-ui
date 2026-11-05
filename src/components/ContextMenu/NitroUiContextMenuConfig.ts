import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiContextMenuProps } from './NativeNitroUiContextMenu';

/**
 * The Fabric view config of the `NitroUiContextMenu` Hybrid View.
 *
 * A copy of `nitrogen/generated/shared/json/NitroUiContextMenuConfig.json`, kept
 * inline for the reason `NitroUiMenuConfig.ts` gives. `src/__tests__/
 * viewConfigs.test.ts` fails when the copy and nitrogen's output disagree.
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

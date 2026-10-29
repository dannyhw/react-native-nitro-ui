import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiMenuProps } from './NativeNitroUiMenu';

/**
 * The Fabric view config of the `NitroUiMenu` Hybrid View.
 *
 * A copy of `nitrogen/generated/shared/json/NitroUiMenuConfig.json`, kept inline
 * because a published `src/` module must not import outside the package source
 * (react-native-builder-bob cannot emit declarations for a JSON module above
 * `src`), and because the copy is reviewable in the diff of a component.
 *
 * `src/__tests__/viewConfigs.test.ts` fails when the copy and nitrogen's output
 * disagree, so this can never drift silently.
 */
export const NitroUiMenuConfig: ViewConfig<NativeNitroUiMenuProps> = {
  uiViewClassName: 'NitroUiMenu',
  supportsRawText: false,
  bubblingEventTypes: {},
  directEventTypes: {},
  validAttributes: {
    title: true,
    variant: true,
    size: true,
    disabled: true,
    rows: true,
    tintColor: true,
    systemImage: true,
    hasPrimaryAction: true,
    testID: true,
    accessibilityLabel: true,
    nuiPerfId: true,
    onSelect: true,
    onOpen: true,
    onClose: true,
    primaryAction: true,
    nuiSizingKey: true,
    nuiSizingId: true,
    hybridRef: true,
  },
};

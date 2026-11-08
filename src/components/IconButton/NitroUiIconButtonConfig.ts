import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiIconButtonProps } from './NativeNitroUiIconButton';

/**
 * The Fabric view config of the `NitroUiIconButton` Hybrid View.
 *
 * A copy of `nitrogen/generated/shared/json/NitroUiIconButtonConfig.json`, kept
 * inline for Button's and Chip's reason: a published `src/` module must not
 * import outside the package source, and the copy is reviewable in a diff.
 * `src/__tests__/viewConfigs.test.ts` fails when the copy and nitrogen's output
 * disagree, so it cannot drift silently.
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

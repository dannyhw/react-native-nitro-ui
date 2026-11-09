import type { ViewConfig } from 'react-native-nitro-modules';

import type { NativeNitroUiButtonGroupProps } from './NativeNitroUiButtonGroup';

/**
 * The Fabric view config of the `NitroUiButtonGroup` Hybrid View.
 *
 * A copy of `nitrogen/generated/shared/json/NitroUiButtonGroupConfig.json`, kept
 * inline for Button's reason: a published `src/` module must not import outside
 * the package source, and the copy is reviewable in a diff.
 * `src/__tests__/viewConfigs.test.ts` fails when the copy and nitrogen's output
 * disagree, so it cannot drift silently.
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

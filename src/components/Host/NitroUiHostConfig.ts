import type { ViewConfig } from 'react-native-nitro-modules';

import type { NitroUiHostProps } from './Host.nitro';

/**
 * The Fabric view config of the `NitroUiHost` Hybrid View.
 *
 * A copy of `nitrogen/generated/shared/json/NitroUiHostConfig.json`, kept inline
 * for the same reason as every other component's copy: a published `src/` module
 * must not import a JSON file above `src`, and
 * `src/__tests__/viewConfigs.test.ts` fails when the copy and nitrogen's output
 * disagree.
 *
 * `children: true` is the whole point of this view and the only such config in
 * the library: every other nitro-ui component is a leaf.
 */
export const NitroUiHostConfig: ViewConfig<NitroUiHostProps> = {
  uiViewClassName: 'NitroUiHost',
  supportsRawText: false,
  bubblingEventTypes: {},
  directEventTypes: {},
  // `hybridRef` is nitrogen's own bookkeeping prop, present on every Hybrid View's
  // config (it is what makes `hybridRef` reach the native instance). A Host has no
  // props of its own, so this is the whole list - and it is why `Host.tsx` sends
  // nothing beyond RN's base `View` props.
  validAttributes: {
    hybridRef: true,
  },
};

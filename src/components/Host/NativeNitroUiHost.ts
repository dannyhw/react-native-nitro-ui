import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import { getHostComponent } from 'react-native-nitro-modules';

import type { NitroUiHostMethods, NitroUiHostProps } from './Host.nitro';
import { NitroUiHostConfig } from './NitroUiHostConfig';

/**
 * The raw host component behind `Host`.
 *
 * Its props are exactly RN's base `View` props - the spec declares none, so there
 * is no `NativeNitroUiHostProps` to intersect with `ViewProps` the way every other
 * component has one. What it adds over a plain `View` is native: it accepts
 * children, and it composes them.
 *
 * @internal Not app API; `Host` is the component apps render.
 */
export const NativeNitroUiHost = getHostComponent<
  NitroUiHostProps,
  NitroUiHostMethods
>(
  'NitroUiHost',
  () => NitroUiHostConfig
) as unknown as ComponentType<ViewProps>;

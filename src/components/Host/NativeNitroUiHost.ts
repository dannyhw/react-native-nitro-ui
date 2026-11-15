import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import { getHostComponent } from 'react-native-nitro-modules';

import type { NitroUiHostMethods, NitroUiHostProps } from './Host.nitro';
import { NitroUiHostConfig } from './NitroUiHostConfig';

/**
 * The raw host component behind `Host`. Its props are React Native's base
 * `View` props; the spec declares none of its own.
 *
 * @internal
 */
export const NativeNitroUiHost = getHostComponent<
  NitroUiHostProps,
  NitroUiHostMethods
>(
  'NitroUiHost',
  () => NitroUiHostConfig
) as unknown as ComponentType<ViewProps>;

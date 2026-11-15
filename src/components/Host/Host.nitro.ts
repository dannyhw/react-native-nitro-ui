import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

/**
 * The Host has no native props of its own. `style`, layout and `testID` are
 * React Native's base view props.
 */
export interface NitroUiHostProps extends HybridViewProps {}

export interface NitroUiHostMethods extends HybridViewMethods {}

/**
 * The Hybrid View behind the `Host` wrapper.
 *
 * Only Android instantiates it: `Host` renders a plain view on iOS, where the
 * native class is a no-op that exists because a Hybrid View needs an
 * implementation on both platforms. Apps render `Host`, not this type.
 */
export type NitroUiHost = HybridView<NitroUiHostProps, NitroUiHostMethods>;

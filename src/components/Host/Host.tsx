import { type ReactNode } from 'react';
import { Platform, View, type ViewProps } from 'react-native';

import { NativeNitroUiHost } from './NativeNitroUiHost';

/**
 * Props of {@link Host}.
 *
 * A Host is a container: it takes layout props like any other view and nothing
 * else. What it may contain is the question - see {@link Host}.
 */
export interface HostProps extends ViewProps {
  children?: ReactNode;
}

/**
 * Renders its nitro-ui children into one shared native composition (Android).
 *
 * Every control outside a Host brings its own Compose runtime with it: one
 * `Composition`, one owner view and one native view tree per control, which is
 * exactly what Android memory and mount UI-thread time pay for. A Host gives all
 * of its direct nitro-ui children **one** Compose composition instead, so 50
 * Switches cost one composition rather than fifty.
 *
 * The trade is real, and it is why this is opt-in rather than the default:
 * inside a Host a control is Compose content, not an RN view. It cannot be
 * interleaved with RN views in layout or z-order, is not scrolled by an RN
 * `ScrollView`, is not clipped or transformed by an RN ancestor, and has no box
 * of its own for Yoga - the Host's box is the only thing RN lays out.
 *
 * On iOS it is a passthrough today: the children render exactly as they do
 * outside a Host, in a plain view.
 */
export function Host({ children, ...props }: HostProps) {
  if (Platform.OS !== 'android') {
    return (
      <View {...props} testID={props.testID}>
        {children}
      </View>
    );
  }
  return <NativeNitroUiHost {...props}>{children}</NativeNitroUiHost>;
}

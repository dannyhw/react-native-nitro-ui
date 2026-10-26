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
 * Renders its nitro-ui children into one shared native composition (iOS).
 *
 * Every control outside a Host brings its own SwiftUI runtime with it: one
 * `UIHostingController`, one hosted view tree and one Fabric node per control,
 * which is exactly what iOS mount memory and mount UI-thread time pay for. A Host
 * gives all of its direct nitro-ui children **one** hosting controller instead, so
 * 50 Switches cost one hosting controller rather than fifty (T17, the iOS twin of
 * the Android Host in `docs/tasks/T16-host-spike.report.md`).
 *
 * The trade is real, and it is why this is opt-in rather than the default:
 * inside a Host a control is SwiftUI content, not an RN view. It cannot be
 * interleaved with RN views in layout or z-order, is not scrolled by an RN
 * `ScrollView`, is not clipped or transformed by an RN ancestor, and has no box
 * of its own for Yoga - the Host's box is the only thing RN lays out. Sizing
 * (`measureContent()`) reports zero for a hosted control, and a screen reader
 * sees the children in the Host's order rather than RN's.
 *
 * On Android it is a passthrough today: the children render exactly as they do
 * outside a Host, in a plain view. The Android Host is on branch
 * `task/T16-host-spike`; the JS API is the same on both.
 */
export function Host({ children, ...props }: HostProps) {
  if (Platform.OS !== 'ios') {
    return (
      <View {...props} testID={props.testID}>
        {children}
      </View>
    );
  }
  return <NativeNitroUiHost {...props}>{children}</NativeNitroUiHost>;
}

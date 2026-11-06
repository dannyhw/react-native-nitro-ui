/**
 * S5 spike only (never merged): `<Popover>` with React Native content, Q7 Appendix F.
 *
 * The structure:
 *
 * ```tsx
 * <View collapsable={false} style={{ alignSelf: 'flex-start' }}>  // hugs the anchor
 *   <NativeNitroUiPopoverProto                                     // first: behind the anchor
 *     pointerEvents="box-none"
 *     style={{ position: 'absolute', left: 0, top: 0, width: cap, alignItems: 'flex-start' }}
 *   >
 *     <View collapsable={false}>{children}</View>                  // the content box
 *   </NativeNitroUiPopoverProto>
 *   {anchor}
 * </View>
 * ```
 *
 * - The wrapper is the anchor's box: native points the popover at the native view's
 *   parent (iOS) / the host's parent (Android).
 * - Two-axis `fit` without a native measure: the native node is as wide as the cap and
 *   lays its one child out with `alignItems: 'flex-start'`, so Yoga gives the content
 *   box its own width (at most the cap; text wraps there) and its own height. Native
 *   reads that box, the first child's frame, as the popover's size.
 * - The content is mounted only from the render that asks for the popover until native
 *   says it has gone (BottomSheet's `mounted`), so a closed popover is one empty node.
 */
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import {
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import {
  getHostComponent,
  type HybridViewProps,
} from 'react-native-nitro-modules';

import { useControlled } from '../../core/useControlled';
import {
  useStableCallback,
  type NitroCallbackProp,
} from '../../core/useStableCallback';
import type { NitroUiPopoverProtoMethods } from './PopoverProto.nitro';
import { NitroUiPopoverProtoConfig } from './NitroUiPopoverProtoConfig';

/** S5 spike only: what a `hybridRef` callback gets. */
export interface PopoverProtoHandle {
  readonly presented: boolean;
  nuiTestStateReport(): string;
  nuiTestDismiss(): void;
}

type PresentedChangeHandler = (presented: boolean, eventCount: number) => void;
type DismissedHandler = (ended: boolean) => void;
type HybridRefHandler = (view: PopoverProtoHandle) => void;

/** Every spec prop, always sent; callbacks in Nitro's `{ f }` wrapper. */
export interface NativePopoverProtoProps extends HybridViewProps {
  presented: boolean;
  mostRecentEventCount: number;
  maxWidth: number;
  sizeBeforePresent: boolean;
  testID: string | null;
  onPresentedChange: NitroCallbackProp<PresentedChangeHandler>;
  onDismissed: NitroCallbackProp<DismissedHandler>;
  hybridRef?: NitroCallbackProp<HybridRefHandler>;
}

const NativeNitroUiPopoverProto = getHostComponent<
  NativePopoverProtoProps,
  NitroUiPopoverProtoMethods
>(
  'NitroUiPopoverProto',
  () => NitroUiPopoverProtoConfig
) as unknown as ComponentType<
  Omit<ViewProps, 'testID'> & NativePopoverProtoProps
>;

export interface PopoverProtoProps {
  isPresented: boolean;
  onIsPresentedChange?: ((isPresented: boolean) => void) | undefined;
  /** Rendered in place; the popover points at the box that hugs it. */
  anchor: ReactNode;
  /** The popover's content: anything React Native renders. */
  children?: ReactNode;
  /** Called once the popover has gone, however it was closed. */
  onDismiss?: (() => void) | undefined;
  /** The widest the content may be. Default 320, and never wider than the window less 32. */
  maxWidth?: number | undefined;
  /** Spike knob for the Q1 red proof (see the spec). Default true. */
  sizeBeforePresent?: boolean | undefined;
  testID?: string | undefined;
  style?: StyleProp<ViewStyle>;
  /** @internal harness handle */
  hybridRef?: ((view: PopoverProtoHandle) => void) | undefined;
}

/** Material's and iOS's popover cap. */
const DEFAULT_MAX_WIDTH = 320;
/** What the window keeps free on both sides. */
const WINDOW_MARGIN = 16;

export function PopoverProto({
  isPresented,
  onIsPresentedChange,
  anchor,
  children,
  onDismiss,
  maxWidth = DEFAULT_MAX_WIDTH,
  sizeBeforePresent = true,
  testID,
  style,
  hybridRef,
}: PopoverProtoProps) {
  const presented = isPresented === true;
  const lastNativeWasClose = useRef(false);
  const controlled = useControlled<boolean>(presented, false, (next) => {
    lastNativeWasClose.current = !next;
    onIsPresentedChange?.(next);
  });
  const { width: windowWidth } = useWindowDimensions();
  const cap = Math.max(0, Math.min(maxWidth, windowWidth - 2 * WINDOW_MARGIN));

  const [mounted, setMounted] = useState(presented);
  if (presented && !mounted) {
    setMounted(true);
  }
  const dismissedCallback = useStableCallback((ended: boolean) => {
    setMounted(false);
    if (ended) onDismiss?.();
  }) as NitroCallbackProp<DismissedHandler>;
  const hybridRefCallback = useStableCallback(hybridRef);

  // The refusal warning, as Tooltip's (D33).
  const warned = useRef(false);
  const echoedAtLastCheck = useRef(0);
  const echoed = controlled.mostRecentEventCount;
  useEffect(() => {
    const echoedNow = echoed !== echoedAtLastCheck.current;
    echoedAtLastCheck.current = echoed;
    if (!__DEV__ || warned.current || !echoedNow) return;
    if (lastNativeWasClose.current && presented) {
      warned.current = true;
      console.warn(
        'react-native-nitro-ui: a Popover was closed by the user but `isPresented` is still true.'
      );
    }
  }, [echoed, presented]);

  return (
    <View
      collapsable={false}
      testID={testID}
      style={[WRAPPER_BASE_STYLE, style]}
    >
      <NativeNitroUiPopoverProto
        presented={presented}
        mostRecentEventCount={controlled.mostRecentEventCount}
        maxWidth={cap}
        sizeBeforePresent={sizeBeforePresent !== false}
        testID={testID ?? null}
        onPresentedChange={controlled.onNativeChange}
        onDismissed={dismissedCallback}
        hybridRef={hybridRefCallback ?? undefined}
        pointerEvents="box-none"
        style={
          mounted
            ? {
                position: 'absolute',
                left: 0,
                top: 0,
                width: cap,
                alignItems: 'flex-start',
              }
            : CLOSED_STYLE
        }
      >
        {mounted ? (
          <View collapsable={false} style={{ maxWidth: cap }}>
            {children}
          </View>
        ) : null}
      </NativeNitroUiPopoverProto>
      {anchor}
    </View>
  );
}

const WRAPPER_BASE_STYLE = { alignSelf: 'flex-start' } as const;

const CLOSED_STYLE = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: 0,
  height: 0,
} as const;

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useControlled } from '../../core/useControlled';
import { InsideRowContext } from '../../core/useSelfSizing';
import {
  useStableCallback,
  type NitroCallbackProp,
} from '../../core/useStableCallback';
import type { NitroUiPopoverHandle } from './NativeNitroUiPopover';
import { NativeNitroUiPopover } from './NativeNitroUiPopover';

/** Props of {@link Popover}. */
export interface PopoverProps {
  /** Whether the popover is presented. */
  isPresented: boolean;
  /**
   * Called when the popover closes without the app asking: a tap outside it,
   * the back gesture (Android), or its window going away. Not called when the
   * app changes `isPresented`, and not called when the popover is unmounted.
   *
   * Keep `isPresented` in step with it: a parent that leaves `isPresented`
   * true after a close gets the popover back (and a dev warning).
   */
  onIsPresentedChange?: ((isPresented: boolean) => void) | undefined;
  /**
   * The element the popover points at. It is laid out in place, in the app's
   * own layout.
   */
  anchor: ReactNode;
  /**
   * The popover's content: anything React Native renders, laid out at up to
   * `maxWidth`. It stays mounted from the render that presents the popover
   * until the popover has gone.
   */
  children?: ReactNode;
  /**
   * Called once the popover has gone, whether the user or the app closed it.
   * The content unmounts at the same moment.
   */
  onDismiss?: (() => void) | undefined;
  /**
   * The widest the content may be, in points. Default: `320`. The content
   * never gets more than the window's width less 32 either.
   */
  maxWidth?: number | undefined;
  /**
   * Identifies the presented popover: its content gets the id
   * `<testID>-popover` on both platforms. The wrapper around the anchor
   * carries no id of its own.
   */
  testID?: string | undefined;
  /**
   * Styles for the wrapper around the anchor. The wrapper hugs its anchor
   * (`alignSelf: 'flex-start'`) by default; this style wins over that.
   */
  style?: StyleProp<ViewStyle> | undefined;
  /**
   * Read-only access to the native view, for tests and benchmarks.
   *
   * @internal
   */
  hybridRef?: ((view: NitroUiPopoverHandle) => void) | undefined;
  /**
   * Instance id for native performance marks, for benchmarks.
   *
   * @internal
   */
  nuiPerfId?: number | null | undefined;
}

/** A cap, not a width: narrower content keeps its own width. */
const DEFAULT_MAX_WIDTH = 320;

/** Kept free on each side of the window, so a popover never touches an edge. */
const WINDOW_MARGIN = 16;

const CLOSED_STYLE = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: 0,
  height: 0,
} as const;

function contentCap(maxWidth: number | undefined, windowWidth: number): number {
  const wanted =
    typeof maxWidth === 'number' && Number.isFinite(maxWidth) && maxWidth > 0
      ? maxWidth
      : DEFAULT_MAX_WIDTH;
  return Math.max(0, Math.min(wanted, windowWidth - 2 * WINDOW_MARGIN));
}

/**
 * The wrapper hugs its anchor: stretched to the row's width, as React Native
 * would by default, the popover would point at the row's middle.
 */
const WRAPPER_BASE_STYLE = { alignSelf: 'flex-start' } as const;

/**
 * A popover anchored to one of your views, whose content is React Native
 * views. A system popover on iOS; a Material 3 surface in a popup on Android,
 * which has no popover control of its own.
 *
 * ```tsx
 * const [open, setOpen] = useState(false);
 * <Popover
 *   isPresented={open}
 *   onIsPresentedChange={setOpen}
 *   anchor={<Button title="More" onPress={() => setOpen(true)} />}
 * >
 *   <Text>Anything React Native can render</Text>
 * </Popover>
 * ```
 *
 * The popover is placed below the anchor, start-aligned, and above it when
 * there is no room below; Android also moves it clear of the keyboard.
 */
export function Popover({
  isPresented,
  onIsPresentedChange,
  anchor,
  children,
  onDismiss,
  maxWidth,
  testID,
  style,
  hybridRef,
  nuiPerfId = null,
}: PopoverProps) {
  const presented = isPresented === true;
  const lastNativeWasClose = useRef(false);
  const controlled = useControlled<boolean>(presented, false, (next) => {
    lastNativeWasClose.current = !next;
    onIsPresentedChange?.(next);
  });
  const { width: windowWidth } = useWindowDimensions();
  const cap = contentCap(maxWidth, windowWidth);

  // The content stays mounted until native reports the popover gone, so it
  // survives the exit animation.
  const [mounted, setMounted] = useState(presented);
  if (presented && !mounted) {
    setMounted(true);
  }

  const dismissedCallback = useStableCallback((ended: boolean) => {
    setMounted(false);
    if (ended) onDismiss?.();
  }) as NitroCallbackProp<(ended: boolean) => void>;
  const hybridRefCallback = useStableCallback(hybridRef);

  // Warns once when the app leaves `isPresented` true after a user close. Only
  // the commit that confirms a native event is checked.
  const warnedRefusal = useRef(false);
  const echoedAtLastCheck = useRef(0);
  const echoed = controlled.mostRecentEventCount;
  useEffect(() => {
    const echoedNow = echoed !== echoedAtLastCheck.current;
    echoedAtLastCheck.current = echoed;
    if (!__DEV__ || warnedRefusal.current || !echoedNow) return;
    if (lastNativeWasClose.current && presented) {
      warnedRefusal.current = true;
      console.warn(
        'react-native-nitro-ui: a Popover was closed by the user but `isPresented` ' +
          'is still true, so it is presented again. Update `isPresented` in ' +
          '`onIsPresentedChange`.'
      );
    }
  }, [echoed, presented]);

  // The native node is laid out off-flow at the cap's width, with
  // `alignItems: 'flex-start'` so its one child gets the content's own size.
  // Native sizes the popover from that child's frame and moves it into the
  // popover.
  return (
    <View collapsable={false} style={[WRAPPER_BASE_STYLE, style]}>
      <NativeNitroUiPopover
        presented={presented}
        mostRecentEventCount={controlled.mostRecentEventCount}
        maxWidth={cap}
        testID={testID ?? null}
        nuiPerfId={nuiPerfId}
        onPresentedChange={controlled.onNativeChange}
        onDismissed={dismissedCallback}
        hybridRef={hybridRefCallback ?? undefined}
        // The node stays in the app's tree while its content is in the popover,
        // and must not take a touch meant for the screen under it.
        pointerEvents="box-none"
        style={mounted ? contentNodeStyle(cap) : CLOSED_STYLE}
      >
        {mounted ? (
          <View collapsable={false} style={contentBoxStyle(cap)}>
            {/*
             * The content is shown in the popover, not where it was written, so
             * an enclosing `Form.Row`'s alignment rule must not reach it.
             */}
            <InsideRowContext.Provider value={false}>
              {children}
            </InsideRowContext.Provider>
          </View>
        ) : null}
      </NativeNitroUiPopover>
      {anchor}
    </View>
  );
}

function contentNodeStyle(cap: number): ViewStyle {
  return {
    position: 'absolute',
    left: 0,
    top: 0,
    width: cap,
    alignItems: 'flex-start',
  };
}

function contentBoxStyle(cap: number): ViewStyle {
  return { maxWidth: cap };
}

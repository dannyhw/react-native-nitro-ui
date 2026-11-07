import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useControlled } from '../../core/useControlled';
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
   * Called when the popover closes for a reason the app did not write: a tap outside it,
   * the back gesture (Android), or the window it was anchored in going away. Not called
   * when `isPresented` changes because the app changed it, and not called when the
   * popover's own mount is dropped - a popover that is unmounted closes silently, as a
   * sheet does (DECISIONS D44 item 2).
   *
   * Keep `isPresented` in step with it. A parent that leaves `isPresented` true after a
   * close gets the popover back (and a dev warning).
   */
  onIsPresentedChange?: ((isPresented: boolean) => void) | undefined;
  /**
   * The element the popover points at. It is laid out **in place**, in the app's own
   * layout, and the wrapper's box around it is the anchor: what the popover points at on
   * both platforms.
   */
  anchor: ReactNode;
  /**
   * The popover's content: anything React Native renders. It is mounted from the render
   * that asks for the popover until the popover has gone, and laid out in the app's own
   * tree at up to `maxWidth` - the platform's popover shows that layout, it does not
   * measure it.
   */
  children?: ReactNode;
  /**
   * Called once the popover has gone, however it was closed - by the user or by the app.
   * The content unmounts at the same moment.
   */
  onDismiss?: (() => void) | undefined;
  /**
   * The widest the content may be, in points. The content never gets more than the
   * window's width less 32 either, which is what makes the popover fit a portrait phone.
   * Default: `320`.
   */
  maxWidth?: number | undefined;
  /**
   * Finds the *presented* popover: native gives the popover's own content the id
   * `<testID>-popover`, on both platforms. The wrapper around the anchor deliberately
   * carries no id of its own - the app gave it an anchor, and the anchor is what an app
   * or a test should look for there.
   */
  testID?: string | undefined;
  /**
   * Styles for the wrapper around the anchor. The wrapper hugs its anchor
   * (`alignSelf: 'flex-start'`), so it is the anchor's box; this style wins over that.
   */
  style?: StyleProp<ViewStyle> | undefined;
  /**
   * Access to the native Hybrid Object, for this repo's harness.
   *
   * @internal Not app API (DECISIONS D14). The shape is written inline for the reason
   * `BottomSheetProps.hybridRef` gives.
   */
  hybridRef?: ((view: NitroUiPopoverHandle) => void) | undefined;
  /**
   * Instance id used by native perf marks. Benchmark only.
   *
   * @internal Benchmark and diagnostics only - not app API.
   */
  nuiPerfId?: number | null | undefined;
}

/**
 * The content's default cap: wide enough for a menu, a short form or a confirm, and the
 * width UIKit's own popovers and Material's menus settle near. It is a cap, not a width:
 * content narrower than this gets its own width.
 */
const DEFAULT_MAX_WIDTH = 320;

/** What the window keeps free on both sides, so a popover never touches an edge. */
const WINDOW_MARGIN = 16;

/** A closed popover's node: no box at all, and nothing laid out inside it. */
const CLOSED_STYLE = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: 0,
  height: 0,
} as const;

/**
 * The widest the content may be: the app's cap, and never more than the window less its
 * margins. Both platforms lay the content out at this and never exceed it.
 */
function contentCap(
  maxWidth: number | undefined,
  windowWidth: number
): number {
  const wanted =
    typeof maxWidth === 'number' && Number.isFinite(maxWidth) && maxWidth > 0
      ? maxWidth
      : DEFAULT_MAX_WIDTH;
  return Math.max(0, Math.min(wanted, windowWidth - 2 * WINDOW_MARGIN));
}

/**
 * The wrapper hugs its anchor. Without this, React Native's default `alignItems:
 * 'stretch'` would widen a wrapper around a button to the whole row, and the popover
 * would point at the row's middle. An app `style` wins.
 */
const WRAPPER_BASE_STYLE = { alignSelf: 'flex-start' } as const;

/**
 * A popover: a platform popover anchored to one of your views, whose content is React
 * Native views. `UIPopoverPresentationController` on iOS; a Compose `Popup` with a
 * Material 3 `Surface` on Android, which has no popover control of its own (DECISIONS
 * D38 item 1).
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
 * The content lays itself out in the app's own tree, at up to `maxWidth`, before the
 * popover shows it - so the popover's first frame is its final size on both platforms,
 * and no native measuring waits for a layout pass. The popover is placed below the
 * anchor, start-aligned, and above it when there is no room below; Android also moves it
 * clear of the keyboard (DECISIONS D44 item 1).
 *
 * It is presented in a window of its own on iOS, as a tooltip is (D41): a popover sitting
 * in the app's presentation chain is what UIKit dismisses when the app closes a `Modal`,
 * and the next `Modal` the app opens is refused (measured for Tooltip, G18).
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
  // Whether the newest native event was a close, for the refusal check below. Written by
  // the handler `useControlled` calls after it has echoed the count.
  const lastNativeWasClose = useRef(false);
  const controlled = useControlled<boolean>(presented, false, (next) => {
    lastNativeWasClose.current = !next;
    onIsPresentedChange?.(next);
  });
  const { width: windowWidth } = useWindowDimensions();
  const cap = contentCap(maxWidth, windowWidth);

  // The content is mounted from the render that asks for the popover until native says
  // the popover has gone (BottomSheet's rule, which D44 item 2 gives Popover): it has to
  // survive the exit animation, and a closed popover costs nothing but its empty node.
  const [mounted, setMounted] = useState(presented);
  if (presented && !mounted) {
    setMounted(true);
  }

  const dismissedCallback = useStableCallback((ended: boolean) => {
    setMounted(false);
    if (ended) onDismiss?.();
  }) as NitroCallbackProp<(ended: boolean) => void>;
  const hybridRefCallback = useStableCallback(hybridRef);

  // A close the app refused (DECISIONS D33, as a tooltip's and a sheet's): only the
  // commit whose echoed count moved counts.
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

  // The node is the content's box, not the anchor's: absolute at the wrapper's origin, as
  // wide as the cap, and `alignItems: 'flex-start'` so Yoga gives its one child - the
  // content box - the content's own width and height. Native reads that child's frame and
  // gives the popover exactly that size. None of it is on screen: iOS hides the node and
  // moves it into the popover, Android moves it into the popup.
  return (
    <View
      collapsable={false}
      style={[WRAPPER_BASE_STYLE, style]}
    >
      <NativeNitroUiPopover
        presented={presented}
        mostRecentEventCount={controlled.mostRecentEventCount}
        maxWidth={cap}
        testID={testID ?? null}
        nuiPerfId={nuiPerfId}
        onPresentedChange={controlled.onNativeChange}
        onDismissed={dismissedCallback}
        hybridRef={hybridRefCallback ?? undefined}
        // The node's own view stays in the app's tree while its content is in the
        // popover: it must never take a touch meant for the screen under it.
        pointerEvents="box-none"
        style={mounted ? contentNodeStyle(cap) : CLOSED_STYLE}
      >
        {mounted ? (
          <View collapsable={false} style={contentBoxStyle(cap)}>
            {children}
          </View>
        ) : null}
      </NativeNitroUiPopover>
      {anchor}
    </View>
  );
}

/** The node's box while the content is mounted: the cap wide, its height the content's. */
function contentNodeStyle(cap: number): ViewStyle {
  return {
    position: 'absolute',
    left: 0,
    top: 0,
    width: cap,
    alignItems: 'flex-start',
  };
}

/** The content box: the node's one child, which native measures the popover from. */
function contentBoxStyle(cap: number): ViewStyle {
  return { maxWidth: cap };
}

import { useEffect, useRef, type ReactNode } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { useControlled } from '../../core/useControlled';
import {
  useStableCallback,
  type NitroCallbackProp,
} from '../../core/useStableCallback';
import type { NitroUiTooltipAction } from './Tooltip.nitro';
import { NativeNitroUiTooltip } from './NativeNitroUiTooltip';

/**
 * One button of a tooltip. The actions are data, as a dialog's are: never child
 * views, never JSON.
 */
export interface TooltipAction {
  /**
   * What `onAction` reports. Unique across the tooltip's actions, and stable: a
   * re-ordered list keeps each button's identity.
   */
  id: string;
  /** The button's text. */
  title: string;
}

/** Where the tooltip goes relative to its anchor. */
export type TooltipPlacement = 'auto' | 'above' | 'below';

/**
 * Props of {@link Tooltip}.
 *
 * `isPresented` is controlled and required: the app decides when the tooltip is up,
 * and every close the user causes is reported through `onIsPresentedChange` - the
 * event-count handshake a dialog uses (`docs/architecture/core.md` §4).
 */
export interface TooltipProps extends ViewProps {
  /** Whether the tooltip is presented. */
  isPresented: boolean;
  /**
   * Called when the tooltip closes for a reason the app did not write: a tap outside
   * it, an action, Back (Android, a tooltip with actions), or its anchor leaving its
   * window. A layout move or a scroll is not a close: the tooltip follows its anchor.
   * Not called when `isPresented` changes because the app changed it.
   *
   * Keep `isPresented` in step with it. A parent that leaves `isPresented` true after
   * a close gets the tooltip back (and a dev warning).
   */
  onIsPresentedChange?: ((isPresented: boolean) => void) | undefined;
  /** The tooltip's text. Also what screen readers announce. */
  message: string;
  /**
   * A title above the message. Default: none. With a title or an action, Android
   * draws Material's rich tooltip; with neither, its plain one.
   */
  title?: string | undefined;
  /**
   * Up to two buttons under the message, in order. Every `id` unique; a dev build
   * throws for a third action or a repeated id. Default: none.
   */
  actions?: readonly TooltipAction[] | undefined;
  /**
   * Called with an action's `id` when the user taps it - always before the
   * `onIsPresentedChange(false)` the same tap causes (DECISIONS D32).
   */
  onAction?: ((id: string) => void) | undefined;
  /**
   * Which side of the anchor the tooltip prefers. Default: `'auto'` - iOS picks the
   * side with room, Android puts it above. Both platforms flip to the other side
   * when the preferred one has no room.
   */
  placement?: TooltipPlacement | undefined;
  /** The anchor: what the tooltip points at, laid out in place. */
  children?: ReactNode;
  /**
   * Access to the native Hybrid Object, for this repo's harness and benchmarks.
   *
   * @internal Not app API (DECISIONS D14). The shape is written inline for the
   * reason `DatePickerProps.hybridRef` gives.
   */
  hybridRef?:
    | ((view: {
        readonly presented: boolean;
        readonly mostRecentEventCount: number;
        readonly message: string;
        readonly title: string | null;
        readonly placement: string;
        nuiTestStateReport(): string;
        nuiTestPerformAction(id: string): void;
        nuiTestDismiss(): void;
      }) => void)
    | undefined;
  /**
   * Instance id used by native perf marks. Benchmark only.
   *
   * @internal Benchmark and diagnostics only - not app API.
   */
  nuiPerfId?: number | null | undefined;
}

/** The most actions a tooltip takes: Material's rich tooltip has room for two. */
const MAX_ACTIONS = 2;

/**
 * The actions as native wants them. A dev build throws for a third action and for a
 * repeated id - `onAction` could not say which of two equal ids was tapped; a
 * release build keeps the first two.
 */
function toNativeActions(
  actions: readonly TooltipAction[] | undefined
): NitroUiTooltipAction[] {
  const list = actions ?? [];
  if (__DEV__) {
    if (list.length > MAX_ACTIONS) {
      throw new Error(
        `react-native-nitro-ui: a tooltip takes at most ${String(MAX_ACTIONS)} actions, and got ${String(list.length)}.`
      );
    }
    const ids = new Set<string>();
    for (const action of list) {
      if (ids.has(action.id)) {
        throw new Error(
          `react-native-nitro-ui: two tooltip actions share the id "${action.id}" - ids must be unique.`
        );
      }
      ids.add(action.id);
    }
  }
  return list
    .slice(0, MAX_ACTIONS)
    .map((action) => ({ id: action.id, title: action.title }));
}

/**
 * The native actions, with a stable identity: an inline `actions={[...]}` is a new
 * array every render, and props diff by identity, so without this an unrelated
 * parent re-render would re-send the struct array. Keyed on content, as Dialog's
 * `useNativeActions` is.
 */
function useNativeActions(
  actions: readonly TooltipAction[] | undefined
): NitroUiTooltipAction[] {
  const next = toNativeActions(actions);
  // Joined by characters no title can forge into a field boundary.
  const signature = next.map((a) => `${a.id}\u0000${a.title}`).join('\u0001');
  const cache = useRef<{
    signature: string;
    actions: NitroUiTooltipAction[];
  } | null>(null);
  const previous = cache.current;
  if (previous != null && previous.signature === signature) {
    return previous.actions;
  }
  cache.current = { signature, actions: next };
  return next;
}

function normalisePlacement(
  placement: TooltipPlacement | undefined
): TooltipPlacement {
  return placement === 'above' || placement === 'below' ? placement : 'auto';
}

/** A module-level no-op, so `onAction` is always sent with one identity (D7b). */
function onActionNotProvided(): void {
  // Intentionally empty: the caller asked for nothing.
}

/**
 * The wrapper hugs its anchor. Without this, React Native's default `alignItems:
 * 'stretch'` would widen a wrapper around an icon to the whole row, and the tooltip
 * would point at the row's middle. An app `style` wins.
 */
const WRAPPER_BASE_STYLE = { alignSelf: 'flex-start' } as const;

/**
 * A tooltip the app opens next to a view: a message, an optional title and up to two
 * actions. Material 3's `PlainTooltip` / `RichTooltip` on Android; a UIKit popover
 * with SwiftUI content on iOS, which has no tooltip control.
 *
 * ```tsx
 * const [tip, setTip] = useState(true);
 * <Tooltip
 *   isPresented={tip}
 *   onIsPresentedChange={setTip}
 *   title="Saved searches"
 *   message="Tap the star to keep this search."
 *   actions={[{ id: 'ok', title: 'Got it' }]}
 * >
 *   <StarButton />
 * </Tooltip>
 * ```
 *
 * The children are the anchor, laid out in place inside a plain `View` that hugs
 * them (`alignSelf: 'flex-start'`); the tooltip points at that view's box. It opens
 * only when the app sets `isPresented` - there is no long-press or hover trigger -
 * and stays up until the user or the app closes it: it never times out.
 */
export function Tooltip({
  isPresented,
  onIsPresentedChange,
  message,
  title,
  actions,
  onAction,
  placement,
  children,
  testID,
  hybridRef,
  nuiPerfId = null,
  style,
  ...viewProps
}: TooltipProps) {
  const presented = isPresented === true;
  // Whether the newest native event was a close, for the refusal check below.
  // Written by the handler `useControlled` calls after it has echoed the count.
  const lastNativeWasClose = useRef(false);
  const controlled = useControlled<boolean>(presented, false, (next) => {
    lastNativeWasClose.current = !next;
    onIsPresentedChange?.(next);
  });
  const actionCallback = useStableCallback(
    onAction ?? onActionNotProvided
  ) as NitroCallbackProp<(id: string) => void>;
  const hybridRefCallback = useStableCallback(hybridRef);
  const nativeActions = useNativeActions(actions);

  // A close the app refused (DECISIONS D33, as a dialog's): native has said `false`,
  // JS has echoed that event, and `isPresented` is still `true` in the commit that
  // echoes it. Native presents the tooltip again on that same commit; the warning is
  // the developer's half. Only that commit counts: an app that followed the close to
  // `false` and opens the tooltip again later is an ordinary open, not a refusal.
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
        'react-native-nitro-ui: a tooltip was closed by the user but `isPresented` ' +
          'is still true, so it is presented again. Update `isPresented` in ' +
          '`onIsPresentedChange`.'
      );
    }
  }, [echoed, presented]);

  return (
    <View {...viewProps} testID={testID} style={[WRAPPER_BASE_STYLE, style]}>
      <NativeNitroUiTooltip
        presented={presented}
        mostRecentEventCount={controlled.mostRecentEventCount}
        message={message}
        title={title != null && title !== '' ? title : null}
        actions={nativeActions}
        placement={normalisePlacement(placement)}
        testID={testID ?? null}
        nuiPerfId={nuiPerfId}
        onPresentedChange={controlled.onNativeChange}
        onAction={actionCallback}
        hybridRef={hybridRefCallback ?? undefined}
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
}

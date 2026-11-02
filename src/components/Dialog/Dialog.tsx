import { useEffect, useRef } from 'react';
import { type ColorValue, type ViewProps } from 'react-native';

import { useControlled } from '../../core/useControlled';
import { useProcessedColor } from '../../core/useProcessedColor';
import {
  useStableCallback,
  type NitroCallbackProp,
} from '../../core/useStableCallback';
import type { NitroUiDialogAction } from './Dialog.nitro';
import { NativeNitroUiDialog } from './NativeNitroUiDialog';

/**
 * One button of a dialog. The actions are data, as a Menu's items are: never
 * child views, never JSON.
 */
export interface DialogAction {
  /**
   * What `onAction` reports. Unique across the dialog's actions, and stable: a
   * re-ordered list keeps each button's identity.
   */
  id: string;
  /** The button's text. */
  title: string;
  /**
   * How the platform draws and places the button. Default: `'default'`.
   *
   * - `'cancel'`: iOS's bold Cancel (last in an action sheet); Material's dismiss
   *   button or the sheet's last row. At most one per dialog.
   * - `'destructive'`: red on iOS, the scheme's error colour on Android.
   */
  role?: 'default' | 'cancel' | 'destructive' | undefined;
  /** Draw the button disabled; a tap on it reports nothing. Default: `false`. */
  disabled?: boolean | undefined;
}

/**
 * The props both dialogs share.
 *
 * `isPresented` is controlled and required: the parent decides whether the dialog
 * is up, and every open or close the user causes is reported through
 * `onIsPresentedChange` - the same event-count handshake a Switch's `value` uses
 * (`docs/architecture/core.md` §4).
 */
export interface DialogProps extends ViewProps {
  /** Whether the dialog is presented. */
  isPresented: boolean;
  /**
   * Called when the user closes the dialog: an action tap, an outside tap, the
   * back gesture, a swipe, or iOS taking it down because its view left the
   * window. Not called when `isPresented` changes because the app changed it.
   *
   * Keep `isPresented` in step with it. A parent that leaves `isPresented` true
   * after a dismissal gets the dialog back (and a dev warning); use
   * `dismissible={false}` to keep a dialog up instead.
   */
  onIsPresentedChange?: ((isPresented: boolean) => void) | undefined;
  /** The dialog's title. It is also what screen readers announce. */
  title: string;
  /** The body text under the title. Default: none. */
  message?: string | undefined;
  /**
   * The buttons, in order. At least one, at most one `'cancel'`, and every `id`
   * unique - a dev build throws otherwise.
   */
  actions: readonly DialogAction[];
  /**
   * Called with an action's `id` when the user taps it - always before the
   * `onIsPresentedChange(false)` the same tap causes (DECISIONS D32).
   */
  onAction?: ((id: string) => void) | undefined;
  /**
   * Whether an outside tap, the back gesture or a swipe closes the dialog.
   * Default: `true`. An action tap always closes it.
   */
  dismissible?: boolean | undefined;
  /** The buttons' colour. Default: each platform's theme. */
  tintColor?: ColorValue | undefined;
  /**
   * Access to the native Hybrid Object, for this repo's harness and benchmarks.
   *
   * @internal Not app API (DECISIONS D14). The shape is written inline for the
   * reason `DatePickerProps.hybridRef` gives.
   */
  hybridRef?:
    | ((view: {
        readonly variant: string;
        readonly presented: boolean;
        readonly mostRecentEventCount: number;
        readonly title: string;
        readonly message: string | null;
        readonly dismissible: boolean;
        readonly tintColor: number | null;
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

/** Props of {@link AlertDialog}. */
export type AlertDialogProps = DialogProps;

/** Props of {@link ConfirmationDialog}. */
export interface ConfirmationDialogProps extends DialogProps {
  /**
   * Whether the title is shown - SwiftUI's `Visibility` for a confirmation
   * dialog. Default: `'automatic'`, which follows each platform's default: an iOS
   * action sheet hides the title (with or without a message), as SwiftUI does;
   * Android shows it. `'visible'` shows it on both, `'hidden'` hides it on both.
   */
  titleVisibility?: 'automatic' | 'visible' | 'hidden' | undefined;
}

const ROLES: readonly string[] = ['default', 'cancel', 'destructive'];

/**
 * The actions as native wants them: every member filled in, roles resolved, and
 * the rules a platform would otherwise crash or guess on applied.
 *
 * `UIAlertController` raises for a second `.cancel` action, so a second cancel
 * can never reach native: a dev build throws here, and a release build demotes
 * every cancel after the first to `'default'`. An empty list and a repeated id
 * throw in dev too - a dialog with no buttons cannot be closed by an action, and
 * `onAction` could not say which of two equal ids was tapped.
 */
function toNativeActions(
  actions: readonly DialogAction[] | undefined
): NitroUiDialogAction[] {
  const list = actions ?? [];
  if (__DEV__) {
    if (list.length === 0) {
      throw new Error(
        'react-native-nitro-ui: a dialog needs at least one action - pass `actions`.'
      );
    }
    const ids = new Set<string>();
    let cancels = 0;
    for (const action of list) {
      if (ids.has(action.id)) {
        throw new Error(
          `react-native-nitro-ui: two dialog actions share the id "${action.id}" - ids must be unique.`
        );
      }
      ids.add(action.id);
      if (action.role === 'cancel') cancels += 1;
    }
    if (cancels > 1) {
      throw new Error(
        "react-native-nitro-ui: a dialog may have at most one 'cancel' action."
      );
    }
  }
  let sawCancel = false;
  return list.map((action) => {
    let role =
      action.role != null && ROLES.includes(action.role)
        ? action.role
        : 'default';
    if (role === 'cancel') {
      if (sawCancel) role = 'default';
      sawCancel = true;
    }
    return {
      id: action.id,
      title: action.title,
      role,
      disabled: action.disabled === true,
    };
  });
}

/**
 * What makes one action list the same as another, for the cache below. Fields
 * are joined by a character no title can forge into a field boundary.
 */
function actionsSignature(actions: readonly NitroUiDialogAction[]): string {
  return actions
    .map(
      (a) =>
        `${a.id}\u0000${a.title}\u0000${a.role}\u0000${a.disabled ? '1' : '0'}`
    )
    .join('\u0001');
}

/**
 * The native actions, with a stable identity.
 *
 * A caller who writes `actions={[...]}` inline makes a new array every render,
 * and props diff by identity, so without this an unrelated parent re-render
 * would re-send and re-convert the whole struct array. Keyed on content, the way
 * `Menu`'s `useMenuRows` is.
 */
function useNativeActions(
  actions: readonly DialogAction[] | undefined
): NitroUiDialogAction[] {
  const next = toNativeActions(actions);
  const signature = actionsSignature(next);
  const cache = useRef<{
    signature: string;
    actions: NitroUiDialogAction[];
  } | null>(null);
  const previous = cache.current;
  if (previous != null && previous.signature === signature) {
    return previous.actions;
  }
  cache.current = { signature, actions: next };
  return next;
}

/**
 * The box React Native lays out: nothing.
 *
 * The presented window is the platform's and is not in React Native's layout at
 * all, so the view is a `0 x 0` anchor that takes no touches. An app may still
 * place it with `style` - absolutely over the button that opens a confirmation
 * dialog, say - and on iPad that box is where the action sheet's arrow points.
 */
const ANCHOR_BASE_STYLE = {
  position: 'absolute',
  width: 0,
  height: 0,
} as const;

/** A module-level no-op, so `onAction` is always sent with one identity (D7b). */
function onActionNotProvided(): void {
  // Intentionally empty: the caller asked for nothing.
}

type DialogVariant = 'alert' | 'confirmation';

function normaliseTitleVisibility(
  visibility: ConfirmationDialogProps['titleVisibility']
): 'automatic' | 'visible' | 'hidden' {
  return visibility === 'visible' || visibility === 'hidden'
    ? visibility
    : 'automatic';
}

/** The implementation both exports share; `variant` is the only difference. */
function NitroDialog({
  variant,
  isPresented,
  onIsPresentedChange,
  title,
  message,
  actions,
  onAction,
  dismissible = true,
  tintColor,
  titleVisibility,
  testID,
  hybridRef,
  nuiPerfId = null,
  style,
  ...restProps
}: ConfirmationDialogProps & { variant: DialogVariant }) {
  const presented = isPresented === true;
  // Whether the newest native event was a dismissal, for the refusal check below.
  // Written by the handler `useControlled` calls after it has echoed the count.
  const lastNativeWasDismissal = useRef(false);
  const controlled = useControlled<boolean>(presented, false, (next) => {
    lastNativeWasDismissal.current = !next;
    onIsPresentedChange?.(next);
  });
  const actionCallback = useStableCallback(
    onAction ?? onActionNotProvided
  ) as NitroCallbackProp<(id: string) => void>;
  const hybridRefCallback = useStableCallback(hybridRef);
  const nativeActions = useNativeActions(actions);
  const processedTint = useProcessedColor(tintColor);

  // A dismissal the app refused (DECISIONS D33): native has said `false`, JS has
  // echoed that event, and `isPresented` is still `true` *in the commit that
  // echoes it*. Native presents the dialog again on that same commit; the warning
  // is the developer's half. Only that commit counts: a parent that followed the
  // dismissal to `false` and opens the dialog again later re-runs this effect with
  // the same echoed count, and that is an ordinary open, not a refusal.
  const warnedRefusal = useRef(false);
  const echoedAtLastCheck = useRef(0);
  const echoed = controlled.mostRecentEventCount;
  useEffect(() => {
    const echoedNow = echoed !== echoedAtLastCheck.current;
    echoedAtLastCheck.current = echoed;
    if (!__DEV__ || warnedRefusal.current || !echoedNow) return;
    if (lastNativeWasDismissal.current && presented) {
      warnedRefusal.current = true;
      console.warn(
        'react-native-nitro-ui: a dialog was dismissed by the user but `isPresented` ' +
          'is still true, so it is presented again. Update `isPresented` in ' +
          '`onIsPresentedChange`, or pass `dismissible={false}` to keep the dialog up.'
      );
    }
  }, [echoed, presented]);

  return (
    <NativeNitroUiDialog
      {...restProps}
      variant={variant}
      presented={presented}
      mostRecentEventCount={controlled.mostRecentEventCount}
      title={title}
      message={message ?? null}
      titleVisibility={normaliseTitleVisibility(titleVisibility)}
      actions={nativeActions}
      dismissible={dismissible !== false}
      tintColor={processedTint}
      testID={testID ?? null}
      nuiPerfId={nuiPerfId}
      onPresentedChange={controlled.onNativeChange}
      onAction={actionCallback}
      hybridRef={hybridRefCallback ?? undefined}
      pointerEvents="none"
      style={[ANCHOR_BASE_STYLE, style]}
    />
  );
}

/**
 * The platform alert: UIKit's `UIAlertController` (`.alert`) on iOS, Material 3's
 * `AlertDialog` on Android.
 *
 * ```tsx
 * const [open, setOpen] = useState(false);
 * <AlertDialog
 *   isPresented={open}
 *   onIsPresentedChange={setOpen}
 *   title="Delete draft?"
 *   message="This cannot be undone."
 *   actions={[
 *     { id: 'cancel', title: 'Cancel', role: 'cancel' },
 *     { id: 'delete', title: 'Delete', role: 'destructive' },
 *   ]}
 *   onAction={(id) => id === 'delete' && deleteDraft()}
 * />
 * ```
 *
 * It has no size of its own: the dialog is a window the platform lays out, and
 * the view React Native sees is a `0 x 0` anchor.
 */
export function AlertDialog(props: AlertDialogProps) {
  return <NitroDialog {...props} variant="alert" />;
}

/**
 * A choice among actions, presented from where it was asked: UIKit's action
 * sheet (`UIAlertController`, `.actionSheet`) on iOS, a Material 3
 * `ModalBottomSheet` with one row per action on Android.
 *
 * Same API as {@link AlertDialog}, plus `titleVisibility`. On iPad the sheet is a
 * popover pointing at this component's box, so place it (`style`) over the
 * control that opened it.
 */
export function ConfirmationDialog(props: ConfirmationDialogProps) {
  return <NitroDialog {...props} variant="confirmation" />;
}

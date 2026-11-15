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

/** One button of a dialog. */
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
 * `isPresented` is controlled and required: the parent decides whether the
 * dialog is up, and every close the user causes is reported through
 * `onIsPresentedChange`.
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
   * Called with an action's `id` when the user taps it, always before the
   * `onIsPresentedChange(false)` the same tap causes.
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
   * Read-only access to the native view, for tests and benchmarks.
   *
   * @internal
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
   * Instance id for native performance marks; `null` turns them off.
   *
   * @internal
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
 * `UIAlertController` raises for a second `.cancel` action, so a dev build
 * throws on one and a release build demotes every cancel after the first to
 * `'default'`.
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

function actionsSignature(actions: readonly NitroUiDialogAction[]): string {
  return actions
    .map(
      (a) =>
        `${a.id}\u0000${a.title}\u0000${a.role}\u0000${a.disabled ? '1' : '0'}`
    )
    .join('\u0001');
}

/**
 * Keeps the array's identity while its content is unchanged: an inline
 * `actions={[...]}` is a new array every render, and props diff by identity.
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
 * The dialog is a platform window outside React Native's layout, so the view is
 * a `0 x 0` anchor that takes no touches. On iPad the action sheet's arrow
 * points at this box.
 */
const ANCHOR_BASE_STYLE = {
  position: 'absolute',
  width: 0,
  height: 0,
} as const;

/** A module-level no-op, so `onAction` is always sent with one identity. */
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

  // Warns when the app refused a dismissal: native reported `false`, and
  // `isPresented` is still `true` in the commit that echoes that event. Only
  // that commit counts; a later re-open runs this with the same echoed count.
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
 * It takes no space in the layout: the dialog is a window the platform lays
 * out.
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

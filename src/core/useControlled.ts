import { useInsertionEffect, useMemo, useRef, useState } from 'react';

import type { NitroCallbackProp } from './useStableCallback';
import { useStableCallback } from './useStableCallback';

/**
 * What a wrapper has to hand to its native view to make a value controlled.
 */
export interface ControlledState<Value> {
  /**
   * The value to send as the native `value` prop, or `null` when the component
   * is uncontrolled - native then keeps showing what the user set.
   */
  value: Value | null;
  /**
   * The value to send as the native `defaultValue` prop: seeds an uncontrolled
   * control's first displayed value and is ignored afterwards.
   */
  defaultValue: Value;
  /**
   * The value to send as `mostRecentEventCount`: how many native changes JS has
   * already seen.
   */
  mostRecentEventCount: number;
  /** The native `onValueChange` prop, ready to spread into JSX. */
  onNativeChange: NitroCallbackProp<(value: Value, eventCount: number) => void>;
}

/**
 * The event-count handshake of `docs/research/core-architecture.md` §4, in JS.
 *
 * Native owns the *displayed* value and updates it immediately on interaction,
 * so there is no visual latency. It then emits `(value, eventCount)`; this hook
 * calls the user's handler and echoes `eventCount` back as a prop in the same
 * render. Native accepts a `value` write only once it has seen at least as many
 * of its own events, which gives us:
 *
 * - **rejected changes**: the user's handler does not update state, so the
 *   `value` prop's identity does not change - but `mostRecentEventCount` does,
 *   so a commit still happens and native reverts the displayed value.
 * - **stale writes**: a `value` written while a native event is in flight is
 *   ignored instead of clobbering what the user just did.
 * - **uncontrolled mode**: with `value === undefined` JS never sets state, so a
 *   toggle costs no React render at all.
 *
 * @param value - the controlled value, or `undefined` for uncontrolled
 * @param defaultValue - initial value of an uncontrolled component; handed back
 *   untouched so a wrapper sends exactly what this hook decided
 * @param onChange - the user's `onValueChange` handler
 */
export function useControlled<Value>(
  value: Value | undefined,
  defaultValue: Value,
  onChange: ((value: Value) => void) | undefined
): ControlledState<Value> {
  const [mostRecentEventCount, setMostRecentEventCount] = useState(0);

  // The native callback must keep one identity forever, so everything it needs
  // lives in refs that the commit phase refreshes.
  const latest = useRef({ onChange, isControlled: value !== undefined });
  useInsertionEffect(() => {
    latest.current = { onChange, isControlled: value !== undefined };
  });

  const handleNativeChange = useMemo(
    () => (next: Value, eventCount: number) => {
      latest.current.onChange?.(next);
      if (latest.current.isControlled) {
        // Batched with the user's own setState, so the commit always sees both.
        // Never rewinds: an event that lands out of order must not make native
        // think JS has not seen the newer one.
        setMostRecentEventCount((previous) =>
          eventCount > previous ? eventCount : previous
        );
      }
    },
    []
  );
  // Always wired, even without a user handler: in controlled mode the echo is
  // what lets native accept the next `value` write.
  const onNativeChange = useStableCallback(
    handleNativeChange
  ) as NitroCallbackProp<(value: Value, eventCount: number) => void>;

  return {
    value: value === undefined ? null : value,
    defaultValue,
    mostRecentEventCount,
    onNativeChange,
  };
}

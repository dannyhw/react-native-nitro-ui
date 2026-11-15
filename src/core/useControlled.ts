import { useInsertionEffect, useMemo, useRef, useState } from 'react';

import type { NitroCallbackProp } from './useStableCallback';
import { useStableCallback } from './useStableCallback';

export interface ControlledState<Value> {
  /** `null` when uncontrolled: native keeps showing what the user set. */
  value: Value | null;
  /** Seeds an uncontrolled control's first value; ignored afterwards. */
  defaultValue: Value;
  /** How many native changes JS has already seen. */
  mostRecentEventCount: number;
  onNativeChange: NitroCallbackProp<(value: Value, eventCount: number) => void>;
}

/**
 * Makes a value controlled without visual latency. Native shows a change at
 * once and reports it with an event count; this hook echoes the count back as
 * a prop, and native ignores a `value` older than its own count. A rejected
 * change still commits, because the count moved, so native reverts to `value`.
 */
export function useControlled<Value>(
  value: Value | undefined,
  defaultValue: Value,
  onChange: ((value: Value) => void) | undefined
): ControlledState<Value> {
  const [mostRecentEventCount, setMostRecentEventCount] = useState(0);
  const isControlled = value !== undefined;

  const seenEvents = useRef(0);
  // State is adjusted during render because `useInsertionEffect` may not
  // schedule updates.
  const [wasControlled, setWasControlled] = useState(isControlled);
  if (wasControlled !== isControlled) {
    setWasControlled(isControlled);
    if (isControlled && seenEvents.current > mostRecentEventCount) {
      // An uncontrolled control echoes nothing, so native is ahead of JS. Without
      // this seed every `value` write looks stale until the next tap.
      setMostRecentEventCount(seenEvents.current);
    }
  }

  // The native callback keeps one identity, so what it reads lives in a ref
  // that each commit refreshes.
  const latest = useRef({ onChange, isControlled });
  useInsertionEffect(() => {
    const previouslyControlled = latest.current.isControlled;
    latest.current = { onChange, isControlled };
    if (previouslyControlled === isControlled) {
      return;
    }
    if (__DEV__) {
      console.warn(
        `react-native-nitro-ui: a component changed from ${
          previouslyControlled ? 'controlled' : 'uncontrolled'
        } to ${isControlled ? 'controlled' : 'uncontrolled'}. ` +
          'Keep `value` either always defined or always undefined - passing it ' +
          'conditionally is not supported.'
      );
    }
  });
  const handleNativeChange = useMemo(
    () => (next: Value, eventCount: number) => {
      if (eventCount > seenEvents.current) {
        seenEvents.current = eventCount;
      }
      // Echo before the user's handler: a handler that throws must not stop the
      // echo, or native would treat every later `value` write as stale.
      if (latest.current.isControlled) {
        // Never rewinds: an event that lands out of order must not make native
        // think JS has not seen the newer one.
        setMostRecentEventCount((previous) =>
          eventCount > previous ? eventCount : previous
        );
      }
      latest.current.onChange?.(next);
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

import { Platform } from 'react-native';

import { DEFAULT_MOUNT_TIMEOUT_MS, DEFAULT_PRESENTED_TIMEOUT_MS } from './plan';
import type { MissingSampleReason } from './types';
import { benchProbe } from '../modules/bench-probe/src';

/**
 * How long the runner waits for each native signal before calling it missing. The
 * launch plan can override both (`scenario:impl:N:presentedTimeout=40000`); the values
 * and the reason they exist live in `plan.ts`, which is what parses them, so importing
 * the plan parser does not pull this module's native object with it.
 */
export { DEFAULT_MOUNT_TIMEOUT_MS, DEFAULT_PRESENTED_TIMEOUT_MS };

/**
 * Single access point to the native probe.
 *
 * Deliberately eager and unforgiving: if the private bench module did not
 * autolink into the release build, every number we would produce is meaningless,
 * so we want a loud crash on first render rather than a table of zeros.
 */
export const probe = benchProbe();

export const probeClock =
  Platform.OS === 'ios'
    ? ('CLOCK_UPTIME_RAW' as const)
    : ('System.nanoTime' as const);

/** Wait for the platform to present a frame. Pacing only - see `awaitPresented`. */
export function nextFrameNs(): Promise<number> {
  return probe.nextFrameNs();
}

/** Sleep without letting a caller accidentally time it. */
export function settle(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

/** The outcome of one native-signal wait, with the reason a null deserves. */
export interface StampWait {
  /** The timestamp, or null when it never arrived. */
  stamp: number | null;
  /** Wall-clock ms the wait really took (the probe's own clock, not `Date.now`). */
  waitedMs: number;
  /** The timeout passed to the probe, so a recorded timeout can be checked. */
  timeoutMs: number;
  /** Why `stamp` is null; only meaningful then. `probe-error` also sets `detail`. */
  reason: MissingSampleReason;
  detail?: string;
}

/** Clip a native error message: it goes into every reader of the results file. */
function clipError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 160 ? `${message.slice(0, 157)}...` : message;
}

/**
 * Wait for one signal, recording *why* it did not arrive.
 *
 * The caller arms with `armMountObserver()`, so the only ways out are a stamp, a
 * `-1` at the timeout, and a probe that is not there or threw. A `NaN`/non-number
 * answer counts as an error rather than a timeout: it is not a signal that was slow,
 * it is a probe that cannot be trusted, and a run full of those must not read as "the
 * frames were just slow".
 */
async function awaitStamp(
  timeoutMs: number,
  call: (timeoutMs: number) => Promise<number>
): Promise<StampWait> {
  const startedAt = probe.now();
  try {
    const stamp = await call(timeoutMs);
    const waitedMs = Math.max(0, (probe.now() - startedAt) / 1e6);
    if (typeof stamp === 'number' && Number.isFinite(stamp)) {
      if (stamp >= 0) {
        return { stamp, waitedMs, timeoutMs, reason: 'probe-timeout' };
      }
      return {
        stamp: null,
        waitedMs,
        timeoutMs,
        reason: 'probe-timeout',
      };
    }
    return {
      stamp: null,
      waitedMs,
      timeoutMs,
      reason: 'probe-error',
      detail: `probe answered ${typeof stamp} ${String(stamp)}`,
    };
  } catch (error) {
    const waitedMs = Math.max(0, (probe.now() - startedAt) / 1e6);
    return {
      stamp: null,
      waitedMs,
      timeoutMs,
      reason: 'probe-error',
      detail: clipError(error),
    };
  }
}

/**
 * Resolve with the native mount timestamp of the transaction armed by the
 * caller's `probe.armMountObserver()`, or `null` when the signal never arrived.
 *
 * Resolved by the native mount hook, so no JS loop runs while the mount is in
 * flight. The previous implementation polled `lastMountNs` with `setTimeout(0)`
 * inside the CPU bracket, which charged the JS thread for the duration of the
 * native mount (T02 review S1).
 *
 * Prefer {@link awaitMountStamp}, which also reports why a null is a null; this
 * stays for callers that only need the number.
 */
export async function awaitMountNs(
  timeoutMs = DEFAULT_MOUNT_TIMEOUT_MS
): Promise<number | null> {
  const wait = await awaitStamp(timeoutMs, (ms) => probe.awaitMount(ms));
  return wait.stamp;
}

/**
 * Resolve with the timestamp of the frame that presented that transaction, or
 * `null`. Captured natively in the same turn as the mount, one frame after the
 * commit - not after a JS round trip (T02 review S2).
 */
export async function awaitPresentedNs(
  timeoutMs = DEFAULT_PRESENTED_TIMEOUT_MS
): Promise<number | null> {
  const wait = await awaitStamp(timeoutMs, (ms) => probe.awaitPresented(ms));
  return wait.stamp;
}

/** As {@link awaitMountNs}, with the reason a missing stamp is missing. */
export function awaitMountStamp(timeoutMs = DEFAULT_MOUNT_TIMEOUT_MS) {
  return awaitStamp(timeoutMs, (ms) => probe.awaitMount(ms));
}

/** As {@link awaitPresentedNs}, with the reason a missing stamp is missing. */
export function awaitPresentedStamp(timeoutMs = DEFAULT_PRESENTED_TIMEOUT_MS) {
  return awaitStamp(timeoutMs, (ms) => probe.awaitPresented(ms));
}

/**
 * Ask every runtime in the process to collect.
 *
 * `phys_footprint` (iOS) and PSS (Android) both include the Hermes heap, so a
 * footprint sample taken without collecting measures whatever the GC happened to
 * leave around rather than the cost of the controls. Returns whether a JS
 * collector was actually reachable, which the report prints next to the memory
 * numbers (T02 review S8).
 */
export function collectGarbage(): boolean {
  const jsGc = (globalThis as { gc?: () => void }).gc;
  const collected = typeof jsGc === 'function';
  if (collected) {
    jsGc();
  }
  probe.gc();
  return collected;
}

/** Breakdown of the process footprint, where the platform can give one. */
export function heapBreakdown(): {
  nativeHeapBytes: number | null;
  javaHeapBytes: number | null;
} {
  const nativeHeapBytes = probe.nativeHeapBytes();
  const javaHeapBytes = probe.javaHeapBytes();
  return {
    nativeHeapBytes: nativeHeapBytes >= 0 ? nativeHeapBytes : null,
    javaHeapBytes: javaHeapBytes >= 0 ? javaHeapBytes : null,
  };
}

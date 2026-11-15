import { Platform } from 'react-native';

import type { MissingSampleReason } from './types';
import { benchProbe } from '../modules/bench-probe/src';

// No timeout is defaulted here: the launch plan (`plan.ts`) resolves one per
// platform, and `plan.ts` must not import this module, which creates the probe.

/**
 * The native probe. Created eagerly, so a build the bench module did not link
 * into crashes on first render instead of reporting zeros.
 */
export const probe = benchProbe();

export const probeClock =
  Platform.OS === 'ios'
    ? ('CLOCK_UPTIME_RAW' as const)
    : ('System.nanoTime' as const);

/** Wait for the platform to present a frame. For pacing, not for timing. */
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
 * Wait for one signal, recording why it did not arrive. A non-number answer is
 * a probe error, not a timeout: the probe is broken, not the frame slow.
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
 * Resolve with the native mount timestamp of the transaction armed by
 * `probe.armMountObserver()`, or `null` when the signal never arrived. Resolved
 * natively, so no JS runs inside the CPU bracket while the mount is in flight.
 */
export async function awaitMountNs(timeoutMs: number): Promise<number | null> {
  const wait = await awaitStamp(timeoutMs, (ms) => probe.awaitMount(ms));
  return wait.stamp;
}

/**
 * Resolve with the timestamp of the frame that presented that transaction, or
 * `null`. Captured natively, one frame after the commit.
 */
export async function awaitPresentedNs(
  timeoutMs: number
): Promise<number | null> {
  const wait = await awaitStamp(timeoutMs, (ms) => probe.awaitPresented(ms));
  return wait.stamp;
}

/** As {@link awaitMountNs}, with the reason a missing stamp is missing. */
export function awaitMountStamp(timeoutMs: number) {
  return awaitStamp(timeoutMs, (ms) => probe.awaitMount(ms));
}

/** As {@link awaitPresentedNs}, with the reason a missing stamp is missing. */
export function awaitPresentedStamp(timeoutMs: number) {
  return awaitStamp(timeoutMs, (ms) => probe.awaitPresented(ms));
}

/**
 * Ask every runtime in the process to collect; returns whether a JS collector
 * was reachable. The footprint includes the Hermes heap, so a sample taken
 * without collecting measures what the GC happened to leave around.
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

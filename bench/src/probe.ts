import { Platform } from 'react-native';
import { benchProbe } from '../modules/bench-probe/src';

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

/**
 * Resolve with the native mount timestamp of the transaction armed by the
 * caller's `probe.armMountObserver()`, or `null` when the signal never arrived.
 *
 * Resolved by the native mount hook, so no JS loop runs while the mount is in
 * flight. The previous implementation polled `lastMountNs` with `setTimeout(0)`
 * inside the CPU bracket, which charged the JS thread for the duration of the
 * native mount (T02 review S1).
 */
export async function awaitMountNs(timeoutMs = 1500): Promise<number | null> {
  const stamp = await probe.awaitMount(timeoutMs);
  return stamp >= 0 ? stamp : null;
}

/**
 * Resolve with the timestamp of the frame that presented that transaction, or
 * `null`. Captured natively in the same turn as the mount, one frame after the
 * commit - not after a JS round trip (T02 review S2).
 */
export async function awaitPresentedNs(
  timeoutMs = 2000
): Promise<number | null> {
  const stamp = await probe.awaitPresented(timeoutMs);
  return stamp >= 0 ? stamp : null;
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

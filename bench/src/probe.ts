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

/** Wait for the platform to present a frame. */
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
 * Wait for the native mount observer to report, after the caller armed it.
 * Returns null on timeout so a lost signal shows up as "n/a" in the report.
 */
export async function waitForMountNs(timeoutMs = 1500): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const observed = probe.lastMountNs;
    if (observed >= 0) {
      return observed;
    }
    if (Date.now() >= deadline) {
      return null;
    }
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve();
      }, 0);
    });
  }
}

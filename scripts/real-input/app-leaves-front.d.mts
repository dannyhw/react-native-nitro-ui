/**
 * Types for `app-leaves-front.mjs`, which is plain JavaScript with JSDoc comments, for
 * the e2e suite's step before each fresh launch.
 */

/** How long the app is given to leave the front after it is stopped, in ms. */
export const LEAVE_FRONT_DEADLINE_MS: number;

/** The device reads and the one write the wait needs. */
export interface FrontDevice {
  /** Stops the app (`am force-stop <app>`). */
  forceStop(): void;
  /** The output of `pidof <app>`: empty once no process of the app is left. */
  processIds(): string;
  /** `dumpsys window displays` followed by `dumpsys window windows`. */
  windowDump(): string;
  /** `dumpsys activity activities`. */
  activityDump(): string;
}

/** The app's activity records `dumpsys activity activities` still lists. */
export function appActivityRecords(dump: string, appId: string): string[];

/**
 * Stop the app, then wait until it has no process, the focused window belongs to
 * something else and no activity record of it is left; throws at the deadline, naming
 * what is left.
 */
export function stopAndAwaitLeavingFront(
  device: FrontDevice,
  appId: string,
  options?: { deadlineMs?: number; pollMs?: number }
): Promise<void>;

/**
 * Types for `popup-windows.mjs`, which is plain JavaScript with JSDoc comments, for the
 * e2e suite's device reads.
 */

/** The app's own popup windows in one `dumpsys window windows` print. */
export function countAppPopupWindows(dump: string, appId: string): number;

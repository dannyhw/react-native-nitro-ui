/**
 * Types for `android-calendar.mjs`, the inline calendar's column rule, read out of
 * a `uiautomator dump`. JavaScript with unit tests, like the other rules.
 */

import type { UiautomatorNode } from './uiautomator.mjs';

/** The box width at or above which a calendar lays out for a touch target. */
export const CALENDAR_WIDE_MIN_DP: number;

/** The touch-target floor a box of this width should have produced, in dp. */
export function expectedColumnDp(widthDp: number): number;

/** The weekday header row inside `box`, as the columns it actually has. */
export function measureCalendarGrid(
  tree: ReadonlyArray<UiautomatorNode>,
  box: { x1: number; y1: number; x2: number; y2: number },
  density: number
): {
  columns: Array<{ widthPx: number; widthDp: number }>;
  minWidthPx: number;
  minWidthDp: number;
  spreadPx: number;
  density: number;
  detail: string;
} | null;

/** What is wrong with a measured grid, in the words a report line needs. */
export function calendarGridProblems(
  grid: {
    columns: Array<{ widthPx: number; widthDp: number }>;
    minWidthPx: number;
    minWidthDp: number;
    spreadPx: number;
    density: number;
  },
  options?: { minColumnDp?: number }
): string[];

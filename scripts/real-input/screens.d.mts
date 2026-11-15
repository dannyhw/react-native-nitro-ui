/**
 * Types for `screens.mjs` — the table that says which tab reaches which screen and
 * which echo proves it arrived. JavaScript, shared by both platforms' runners; this
 * names only the two exports the e2e suite reads.
 */

/** The testIDs the example app draws as its per-screen echoes. */
export const ECHO: Readonly<Record<string, string>>;

/** The echo whose presence proves a screen came up. */
export function screenTab(screen: string): { anchor: string };

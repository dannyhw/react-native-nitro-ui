#!/usr/bin/env node
//
// The consumer smoke app's ready line: the contract, as pure functions.
//
// `scripts/smoke/App.tsx` used to signal readiness with a bare
// `NITRO_UI_SMOKE_READY`, which proved that the bundle loaded, the core
// answered and nothing crashed - and nothing about the five controls actually
// being laid out. A control that mounted but never got a box (a sizing
// regression, a hosting change, a `measureContent()` that returns 0) turned the
// screen red and passed. R2 recorded that as a follow-up; this is the assertion.
//
// The app now prints the box each control was laid out with, and this file owns
// the shape of that line, used by BOTH platform paths in `common.sh`:
//
//   NITRO_UI_SMOKE_READY switch=30x20 slider=310x20 button=88x36 progress=310x4 segmented-control=214x32
//
// A box is a number, not necessarily an integer: `onLayout` reports the layout
// metrics Fabric computed, and those are fractional as a rule - dp scaled by the
// display density on Android, font metrics on iOS. The first device run of this
// gate printed `switch=52.19047546386719x48` (Android) and
// `button=61x34.333343505859375` (iOS); an integer-only contract called both
// runs a failure while every control had a box. So the number grammar is
// `digits[.digits]`, and the unit fixtures include the fractional form precisely
// because integer fixtures cannot catch that mistake.
//
// Why a module and not shell: the assertion is the gate, it has to be the same
// on iOS and Android, and it has to be demonstrable without a device - see
// `scripts/__tests__/smoke-ready-line.test.js`. Like `scripts/bench/lib.mjs`,
// this file holds the logic and no CLI, so jest can import it (`ready-line.mjs`
// is the command both platform paths call).
//
// `App.tsx` is copied into a generated consumer app, so it cannot import this
// file; the control list there is a deliberate copy. Keep the two in sync (and
// the test, which asserts the shape both sides agree on).

/** The five controls v0.1 ships, in the order the app renders them. */
export const SMOKE_CONTROLS = Object.freeze([
  'switch',
  'slider',
  'button',
  'progress',
  'segmented-control',
  'picker',
]);

/** The readiness signal on both platforms (also the default `READY_PATTERN`). */
export const READY_PREFIX = 'NITRO_UI_SMOKE_READY';

/**
 * Printed by the app instead of stalling silently: it is ready but at least one
 * control still has no box. The runner fails on this immediately rather than
 * waiting out `READY_TIMEOUT` for a line that will never come.
 */
export const PENDING_PREFIX = 'NITRO_UI_SMOKE_PENDING';

/** Last line containing `prefix` (a log may repeat a line; the last one is truth). */
export function findLine(text, prefix) {
  let found = null;
  for (const line of String(text).split('\n')) {
    if (line.includes(prefix)) {
      found = line;
    }
  }
  return found;
}

/**
 * Check a ready line against the contract.
 *
 * @param {string | null} line the log line, or `null` for "no ready line"
 * @returns {{ ok: boolean, sizes: Record<string, {width: number, height: number}>, problems: string[] }}
 *   `problems` is a human-readable reason per control that is missing, zero or
 *   malformed - the message a smoke run fails with.
 */
export function checkReadyLine(line) {
  const sizes = {};
  const problems = [];
  if (line == null) {
    return {
      ok: false,
      sizes,
      problems: [`no ${READY_PREFIX} line in the log`],
    };
  }
  for (const control of SMOKE_CONTROLS) {
    // Space-delimited `name=WxH` tokens, each control exactly once. The token
    // boundary matters: a line that merely mentions the control is not evidence,
    // and a box glued to other text (`30x20px`) is not a measurement either.
    const number = '\\d+(?:\\.\\d+)?';
    const match = new RegExp(
      `(?:^|\\s)${control}=(${number})x(${number})(?:\\s|$)`
    ).exec(line);
    if (match == null) {
      problems.push(`${control}: no "WxH" box in the ready line`);
      continue;
    }
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!(width > 0) || !(height > 0)) {
      problems.push(`${control}: laid out at ${width}x${height}`);
      continue;
    }
    sizes[control] = { width, height };
  }
  return { ok: problems.length === 0, sizes, problems };
}

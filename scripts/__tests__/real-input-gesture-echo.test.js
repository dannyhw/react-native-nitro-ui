/**
 * The gesture echo a drag check waits on (E5).
 *
 * `hosted-slider` failed alone on several branches and passed on a re-run, because the
 * only thing it waited on was the *value* stopping for 1200 ms, and a drag that is
 * merely slow answers that like a finished one. The fix is to wait for the control to
 * report the gesture itself, which makes the parse of that report and the rule applied
 * to it load-bearing for a gate — so they are testable without a device, rather than
 * only discoverable on one.
 *
 * The fixtures are not the right answer: the accepted text is `start=2 complete=12`,
 * not `start=1 complete=1`, so a parser that happened to hard-code the common case or
 * read greedily goes red here instead of on a run.
 *
 * @file No device: `screens.mjs` is data and two pure functions.
 */

import { describe, expect, it } from '@jest/globals';

import { gestureCounts, gestureReported } from '../real-input/screens.mjs';

describe('gestureCounts', () => {
  it('reads both phases out of the order the echo draws them in', () => {
    expect(gestureCounts('start=2 complete=12')).toEqual({
      starts: 2,
      completes: 12,
    });
  });

  it('reads both phases when complete comes first', () => {
    // The check asks for the pair as one text node, and a node's text is not
    // guaranteed to keep the source order if the row is ever reworded.
    expect(gestureCounts('complete=7 start=3')).toEqual({
      starts: 3,
      completes: 7,
    });
  });

  it('reports a phase it cannot see as null, not as zero', () => {
    // `0` would say "no gesture has happened", which a wait would then accept as
    // "this gesture has"; `null` says the echo was not there to read.
    expect(gestureCounts(null)).toEqual({ starts: null, completes: null });
    expect(gestureCounts('order=SC')).toEqual({
      starts: null,
      completes: null,
    });
    expect(gestureCounts('start=4')).toEqual({ starts: 4, completes: null });
  });

  it('does not read a digit out of a neighbouring number', () => {
    expect(gestureCounts('start=1 complete=1').completes).toBe(1);
    expect(gestureCounts('started=9 complete=2').starts).toBeNull();
  });
});

describe('gestureReported', () => {
  it('accepts a gesture whose start and complete both arrived', () => {
    expect(
      gestureReported({ starts: 1, completes: 1 }, { starts: 2, completes: 2 })
    ).toBe(true);
  });

  it('refuses a complete with no start after it', () => {
    // The case the old value-settle fell into: a `complete` that belongs to the
    // previous gesture is not the end of this one.
    expect(
      gestureReported({ starts: 1, completes: 1 }, { starts: 1, completes: 2 })
    ).toBe(false);
  });

  it('refuses a start that has not been closed yet', () => {
    expect(
      gestureReported({ starts: 1, completes: 1 }, { starts: 2, completes: 1 })
    ).toBe(false);
  });

  it('refuses the same gesture read twice', () => {
    expect(
      gestureReported({ starts: 2, completes: 2 }, { starts: 2, completes: 2 })
    ).toBe(false);
  });

  it('counts a first gesture against an echo that read zero', () => {
    expect(
      gestureReported({ starts: 0, completes: 0 }, { starts: 1, completes: 1 })
    ).toBe(true);
    expect(
      gestureReported({ starts: 0, completes: 0 }, { starts: 0, completes: 1 })
    ).toBe(false);
  });

  it('refuses an echo that has not been drawn at all', () => {
    expect(
      gestureReported(
        { starts: 0, completes: 0 },
        { starts: null, completes: null }
      )
    ).toBe(false);
  });
});

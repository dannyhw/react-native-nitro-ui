import { describe, expect, it, vi } from 'vitest';

import { heldDrop } from '../../example/e2e/real-input/press-feedback';

vi.mock('e2e', () => ({ expect: {} }));

const HOLD_MS = 1_800;
const REST = 0.97;
/** A Material state layer over a light row: a few percent darker. */
const INKED = 0.94;

describe('heldDrop', () => {
  it('reads ink a slow driver put down after the first frame was taken', () => {
    // The hosted-runner failure: the press took 2.8 s for an 1800 ms hold, so the
    // finger landed after the frame asked for at +450 ms, which read the row at rest.
    const frames = [
      { askedAt: 450, doneAt: 1_085, mean: REST },
      { askedAt: 1_085, doneAt: 1_720, mean: INKED },
    ];
    expect(heldDrop(REST, frames, HOLD_MS)).toBeCloseTo(REST - INKED, 6);
  });

  it('does not count a frame that finished after the press could have ended', () => {
    // Ink still fading after the lift is not ink drawn while held.
    const frames = [
      { askedAt: 450, doneAt: 1_085, mean: REST },
      { askedAt: 1_190, doneAt: 1_800, mean: INKED },
    ];
    expect(heldDrop(REST, frames, HOLD_MS)).toBe(0);
  });

  it('reports a row that never darkens as no drop', () => {
    const frames = [
      { askedAt: 450, doneAt: 1_085, mean: REST },
      { askedAt: 1_085, doneAt: 1_720, mean: REST },
    ];
    expect(heldDrop(REST, frames, HOLD_MS)).toBe(0);
  });

  it('has nothing to report when no frame finished inside the press', () => {
    expect(heldDrop(REST, [], HOLD_MS)).toBe(-Infinity);
    expect(
      heldDrop(REST, [{ askedAt: 450, doneAt: 2_100, mean: INKED }], HOLD_MS)
    ).toBe(-Infinity);
  });
});

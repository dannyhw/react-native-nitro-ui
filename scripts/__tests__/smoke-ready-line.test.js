import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  checkReadyLine,
  findLine,
  PENDING_PREFIX,
  READY_PREFIX,
  SMOKE_CONTROLS,
} from '../smoke/lib.mjs';

const READY_LINE =
  'I/ReactNative( 1234): ' +
  `${READY_PREFIX} switch=30x20 slider=310x20 button=88x36 ` +
  'progress=310x4 segmented-control=214x32 ' +
  'date-picker=138x34 picker=72x35 menu=76x34 text-field=310x22 chip=58x28 ' +
  'search-field=310x37 checkbox=40x40 icon-button=32x32 button-group=310x48 ' +
  'stepper=94x32 list-item=310x56 host=310x96';

// Fractional sizes: Android scales dp by the display density, and iOS sizes a
// Button from its font.
const READY_LINE_FRACTIONAL =
  'I/ReactNativeJS(13147): ' +
  `${READY_PREFIX} switch=52.19047546386719x48 slider=363.4285583496094x48 ` +
  'button=91.04762268066406x48 progress=363.4285583496094x4.19049072265625 ' +
  'segmented-control=256x48 date-picker=120.76190185546875x48 ' +
  'picker=280x56.09523010253906 menu=97.619049072265625x48 ' +
  'text-field=363.4285583496094x24 chip=66.28571319580078x48 ' +
  'search-field=363.4285583496094x56 checkbox=48x48 ' +
  'icon-button=48x48 button-group=363.4285583496094x48 stepper=104x48 ' +
  'list-item=363.4285583496094x65.651611328125 host=363.4285583496094x96';

describe('smoke ready line', () => {
  it('passes on one non-zero box per control', () => {
    const verdict = checkReadyLine(READY_LINE);
    expect(verdict.ok).toBe(true);
    expect(verdict.problems).toEqual([]);
    expect(verdict.sizes.switch).toEqual({ width: 30, height: 20 });
    expect(verdict.sizes['segmented-control']).toEqual({
      width: 214,
      height: 32,
    });
    expect(verdict.sizes.picker).toEqual({ width: 72, height: 35 });
    expect(verdict.sizes.menu).toEqual({ width: 76, height: 34 });
  });

  it('fails the bare line the app used to print', () => {
    const verdict = checkReadyLine(`${READY_PREFIX}`);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems).toHaveLength(SMOKE_CONTROLS.length);
  });

  it('accepts the fractional boxes the platforms really report', () => {
    for (const line of [READY_LINE, READY_LINE_FRACTIONAL]) {
      const verdict = checkReadyLine(line);
      expect(verdict.problems).toEqual([]);
      expect(verdict.ok).toBe(true);
    }
    const verdict = checkReadyLine(READY_LINE_FRACTIONAL);
    expect(verdict.sizes.switch).toEqual({
      width: 52.19047546386719,
      height: 48,
    });
    expect(verdict.sizes.progress).toEqual({
      width: 363.4285583496094,
      height: 4.19049072265625,
    });
    expect(verdict.sizes.picker).toEqual({
      width: 280,
      height: 56.09523010253906,
    });
    expect(verdict.sizes.host).toEqual({
      width: 363.4285583496094,
      height: 96,
    });
  });

  it('fails when one control has no box, however the others look', () => {
    const withoutSlider = READY_LINE.replace(' slider=310x20', '');
    const verdict = checkReadyLine(withoutSlider);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join('\n')).toContain('slider');
  });

  it('fails a fractional control that never grew, on the fractional line', () => {
    const zeroed = READY_LINE_FRACTIONAL.replace(
      'progress=363.4285583496094x4.19049072265625',
      'progress=363.4285583496094x0.0'
    );
    const verdict = checkReadyLine(zeroed);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join('\n')).toContain('progress');
  });

  it.each([
    ['zero width', 'progress=0x4'],
    ['zero height', 'switch=30x0'],
    ['both zero', 'button=0x0'],
    ['zero to two decimals', 'progress=363.4x0.00'],
    ['no separator', 'switch=30'],
    ['a non-numeric box', 'slider=wide'],
    ['a negative height', 'button=88x-36'],
    ['a fraction glued to other text', 'switch=30.5x20.5px'],
    ['a fraction with no digits after the point', 'switch=30.5x20.'],
  ])('fails a %s box', (_label, token) => {
    const control = token.split('=')[0];
    const broken = READY_LINE.replace(
      new RegExp(` ${control}=\\d+x\\d+`),
      ` ${token}`
    );
    expect(broken).not.toBe(READY_LINE);
    const verdict = checkReadyLine(broken);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join('\n')).toContain(control);
  });

  it('does not count a mention of the control as its box', () => {
    const verdict = checkReadyLine(
      `${READY_PREFIX} switch=30x20 slider=310x20 button=88x36 progress=310x4 ` +
        'date-picker=138x34 picker=72x35 ' +
        'message mentions segmented-control here'
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join('\n')).toContain('segmented-control');
  });

  it('is per-control: no control may satisfy the contract with another id', () => {
    const verdict = checkReadyLine(
      `${READY_PREFIX} switch=30x20x1 slider=310x20 button=88x36 ` +
        'progress=310x4 segmented-control=214x32 ' +
        'date-picker=138x34 picker=72x35 menu=76x34 host=310x96'
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join('\n')).toContain('switch');
  });

  it('reports no ready line at all', () => {
    const verdict = checkReadyLine(null);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join('\n')).toContain(READY_PREFIX);
  });

  it('finds the last of several lines, and the pending line', () => {
    const log = [
      'something else',
      `${READY_PREFIX} switch=1x1 slider=1x1 button=1x1 progress=1x1 ` +
        'segmented-control=1x1 date-picker=1x1',
      READY_LINE,
      `${PENDING_PREFIX} progress=0x0`,
    ].join('\n');
    expect(findLine(log, READY_PREFIX)).toBe(READY_LINE);
    expect(findLine(log, PENDING_PREFIX)).toBe(
      `${PENDING_PREFIX} progress=0x0`
    );
    expect(findLine('nothing here', READY_PREFIX)).toBeNull();
  });

  it('agrees with the control list the smoke app renders', () => {
    // `App.tsx` is copied into a generated consumer app and cannot import this
    // module, so the two control lists are a deliberate copy.
    const app = readFileSync(join(__dirname, '..', 'smoke', 'App.tsx'), 'utf8');
    for (const control of SMOKE_CONTROLS) {
      expect(app).toContain(`testID="SMOKE-${control}"`);
      expect(app).toContain(`'${control}'`);
    }
    expect(app).toContain(READY_PREFIX);
    expect(app).toContain(PENDING_PREFIX);
  });
});

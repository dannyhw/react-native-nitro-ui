import { describe, expect, it } from '@jest/globals';

import {
  AbortedCheck,
  CheckLog,
  Suite,
  runCheck,
} from '../real-input/report.mjs';

/**
 * Checked on the text: `support.mjs` computes paths from `import.meta.url`, which jest cannot
 * parse, so it cannot be imported here.
 */
describe('support.mjs still exports the report', () => {
  it('re-exports the three classes it used to define', () => {
    const text = require('node:fs').readFileSync(
      `${__dirname}/../real-input/support.mjs`,
      'utf8'
    );
    const line = text
      .split('\n')
      .find(
        (each) => each.startsWith('export {') && each.includes('report.mjs')
      );
    expect(line).toBeDefined();
    for (const name of ['Suite', 'CheckLog', 'AbortedCheck', 'runCheck']) {
      expect(line).toContain(name);
    }
  });
});

/** Runs `fn` with stdout collected, and returns what it printed. */
function captured(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

/** `captured`, for an async `fn`. */
async function capturedAsync(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

describe('the real-input report', () => {
  it('says WARN in the summary when a check warned, and names which', () => {
    const suite = new Suite('ios', []);
    const check = suite.beginAuxiliary('a11y:switch', 'Switch a11y');
    check.check('the control is named at its own box', true);
    check.warn('the first read was this box at ⅓ scale');
    const out = captured(() => suite.finish());
    expect(out).toContain('WARN');
    expect(out).toContain('a11y:switch');
  });

  it('prints no WARN at all for a run where nothing warned', () => {
    const suite = new Suite('ios', []);
    const check = suite.beginAuxiliary('a11y:switch', 'Switch a11y');
    check.check('the control is named at its own box', true);
    const out = captured(() => suite.finish());
    expect(out).not.toContain('WARN');
  });

  it('counts the warnings instead of printing one line per case', () => {
    const suite = new Suite('ios', []);
    for (const id of ['a11y:switch', 'a11y:slider']) {
      const check = suite.beginAuxiliary(id, `${id} a11y`);
      check.check('named', true);
      check.warn('the first read was this box at ⅓ scale');
    }
    const out = captured(() => suite.finish());
    expect(out).toMatch(/WARN[^]*?2/);
    expect(out).toContain('a11y:switch');
    expect(out).toContain('a11y:slider');
  });

  it('does not fail the run for a warning, and does not hide it either', () => {
    const suite = new Suite('ios', []);
    const check = suite.beginAuxiliary('a11y:switch', 'Switch a11y');
    check.check('named', true);
    check.warn('a read was at ⅓ scale');
    let code = null;
    const out = captured(() => {
      code = suite.finish();
    });
    expect(code).toBe(0);
    expect(out).toContain('WARN');
    expect(check.passed).toBe(true);
  });

  it('keeps a failing check failing when it also warned', () => {
    const suite = new Suite('ios', []);
    const check = suite.beginAuxiliary('a11y:switch', 'Switch a11y');
    check.warn('a read was at ⅓ scale');
    check.check('the wrapper box is the control box', false);
    let code = null;
    const out = captured(() => {
      code = suite.finish();
    });
    expect(code).toBe(1);
    expect(out).toContain('failed: the wrapper box is the control box');
    expect(out).toContain('WARN');
  });

  it('prints a warning as WARN where it is printed, not as an ordinary note', () => {
    const check = new CheckLog('Switch a11y');
    const out = captured(() =>
      check.warn('the first read was this box at ⅓ scale')
    );
    expect(out).toMatch(/WARN/);
    expect(out).toContain('⅓');
    // And it is recorded, so `finish` can count it.
    expect(check.warns.length).toBe(1);
  });
});

describe('a check that aborts (runCheck)', () => {
  const CONTROL = { id: 'switch', title: 'Switch', screen: 'switch' };

  /** One control's run through `runCheck`, then the suite's exit code and what it printed. */
  async function runOne(check) {
    const suite = new Suite('android', [CONTROL]);
    let code = null;
    const out = await capturedAsync(async () => {
      const log = suite.begin(CONTROL);
      await runCheck(log, () => check(log));
      code = suite.finish();
    });
    return { code, out };
  }

  it('fails the run for a bare AbortedCheck that the log never recorded', async () => {
    const { code, out } = await runOne(() => {
      throw new AbortedCheck('the probe had nothing to read');
    });
    expect(code).toBe(1);
    expect(out).toContain('switch: FAIL');
    expect(out).toContain('the probe had nothing to read');
    expect(out).toContain('0/1 controls passed');
  });

  it('fails the run for a bare AbortedCheck thrown after an assertion passed', async () => {
    const { code, out } = await runOne((log) => {
      log.check('the tree has a first segment', true);
      throw new AbortedCheck('the corner probe has no first segment');
    });
    expect(code).toBe(1);
    expect(out).toContain('switch: FAIL');
  });

  it('fails the control for an abort another log recorded', async () => {
    // Recorded, but not on *this* control's line, so this control has no failure of its own.
    const other = new CheckLog('somewhere else');
    const { code, out } = await runOne(() =>
      captured(() => other.abort('a different log stopped'))
    );
    expect(code).toBe(1);
    expect(out).toContain('switch: FAIL');
  });

  it('moves on after an abort its own log recorded, and counts it once', async () => {
    const suite = new Suite('android', [
      CONTROL,
      { id: 'slider', title: 'Slider', screen: 'slider' },
    ]);
    let code = null;
    let first = null;
    const out = await capturedAsync(async () => {
      first = suite.begin(suite.controls[0]);
      await runCheck(first, () => first.abort('no switch on screen'));
      const second = suite.begin(suite.controls[1]);
      await runCheck(second, () => second.check('the slider moved', true));
      code = suite.finish();
    });
    expect(code).toBe(1);
    expect(first.failures).toEqual(['no switch on screen']);
    expect(out).toContain('switch: FAIL');
    expect(out).toContain('slider: PASS');
  });

  it('passes a check that neither failed nor aborted', async () => {
    const { code } = await runOne((log) => log.check('it moved', true));
    expect(code).toBe(0);
  });

  it('lets any other error end the run', async () => {
    await expect(
      capturedAsync(() =>
        runCheck(new CheckLog('x'), () => {
          throw new TypeError('not a check result');
        })
      )
    ).rejects.toThrow('not a check result');
  });

  it('is the only catch for AbortedCheck in the real-input runners', () => {
    // A runner with its own `instanceof AbortedCheck` catch could swallow a bare throw, and a bare
    // throw skips the log. Both are checked as text, over every file the runners are made of.
    const fs = require('node:fs');
    const dir = `${__dirname}/../real-input`;
    const offenders = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.mjs') && name !== 'report.mjs')
      .flatMap((name) =>
        fs
          .readFileSync(`${dir}/${name}`, 'utf8')
          .split('\n')
          .map((line, index) => ({ name, line, index }))
          .filter(({ line }) => !line.trim().startsWith('//'))
          .filter(({ line }) =>
            /instanceof AbortedCheck|new AbortedCheck\(/.test(line)
          )
          .map(({ name: file, index }) => `${file}:${String(index + 1)}`)
      );
    expect(offenders).toEqual([]);
  });
});

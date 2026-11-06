/**
 * The real-input report: what `Suite.finish()` prints, and what it counts.
 *
 * `real-input-*.test.js` files cover the rules that decide pass or fail from a log. Nothing covered
 * the *summary* — the one line a gate's reader sees first, and the only place a fact that is neither
 * a pass nor a failure can go. That is what a WARN is for (X16 item 4): a first read at exactly the
 * screen's ⅓ scale is a real accessibility bug that came and went, and a run that swallowed it in
 * fourteen per-case notes would report it as clean.
 *
 * The assertions are on the printed line rather than on internal state, because the claim worth
 * guarding is "a human reading the end of this run sees it".
 *
 * @file No device: `Suite` is a printer, and every branch of it is reachable from here.
 */

import { describe, expect, it } from '@jest/globals';

import {
  AbortedCheck,
  CheckLog,
  Suite,
  runCheck,
} from '../real-input/report.mjs';

/**
 * `report.mjs` is importable and `support.mjs` is not (it computes paths from `import.meta.url`,
 * which jest cannot parse), so this file reaching `Suite` is itself half of the reason the module
 * was split. The other half is that callers must not have to know about the split: `support.mjs`
 * re-exports all three, and its four real callers keep spelling the old name. Checked on the text
 * because a re-export that goes missing turns those callers into `undefined is not a constructor`
 * at the start of a 16-minute device run, which is a bad way to learn it.
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
    // Fourteen healthy cases must not train a reader to ignore the word. A summary that always said
    // WARN would be read as boilerplate, and the one line that exists to be noticed would join the
    // rest of the output.
    const suite = new Suite('ios', []);
    const check = suite.beginAuxiliary('a11y:switch', 'Switch a11y');
    check.check('the control is named at its own box', true);
    const out = captured(() => suite.finish());
    expect(out).not.toContain('WARN');
  });

  it('counts the warnings instead of printing one line per case', () => {
    // A gate's summary is one line. Ten cases with the same finding are one fact about the run, and
    // ten sentences would push the totals off the screen the totals are the point of.
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
    // The distinction the whole item rests on. A ⅓-scale first read that settled is a measurement
    // the rule still grades correctly - it compares two elements of one read - so the case passes.
    // But "passed" must not be the last thing said about it: the run exits 0 *and* says WARN.
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
    // A warning is not a downgrade of a failure. If `warn` could make a red case look merely noisy,
    // it would be the most convenient way to lose a real finding.
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
    // The per-case print and the summary have to agree. A note prefixed with nothing is one of forty
    // lines about boxes; the word at the start of the line is what makes a reader stop.
    const check = new CheckLog('Switch a11y');
    const out = captured(() =>
      check.warn('the first read was this box at ⅓ scale')
    );
    expect(out).toMatch(/WARN/);
    expect(out).toContain('⅓');
    // And it is recorded, so `finish` can count it after the run rather than re-reading stdout.
    expect(check.warns.length).toBe(1);
  });
});

/**
 * X20 item 1: an abort the log never recorded is a failure, not a pass.
 *
 * The Android runner swallowed every `AbortedCheck` to move on to the next control, on the
 * assumption that `CheckLog.abort` had already put the reason on the report. A bare
 * `throw new AbortedCheck(...)` skips the log, so the control printed PASS with no assertion
 * behind it - E1 saw exactly that. `runCheck` is the one place the runner's catch lives now.
 */
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
    // The E1 shape: something passed first, so "the log has a note" is not evidence of anything.
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
    // A runner that grows its own `instanceof AbortedCheck` catch can swallow a bare throw again,
    // and a check that throws one bare skips the reason on its own line. Both are text, so both
    // are checked as text, over every file the runners are made of.
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

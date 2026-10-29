/**
 * The iOS real-input log tells you which control had to press again.
 *
 * M2 exists because a regression that made every iOS control need a second press
 * was invisible: `pressUntil` printed "answered on tap 2/3" to
 * `.real-input/ios/xcodebuild-test.log`, a file the next run overwrites, and the
 * gate's own log kept only lines matching `Test Case|Test Suite|error:`. Twenty-five
 * iOS real-input logs hold no retry line, and every one of them reads `10/10` —
 * which cannot distinguish "never retried" from "retried every time". The fix is
 * a parse and a counter, and the failure mode of a parse is to keep passing while
 * counting nothing, which looks exactly like a healthy run.
 *
 * So: the fixtures are real shapes taken from a `gate.mjs` log of this suite
 * (`Test Case ... started`, four spaces of indent on the child's own `print`),
 * and the assertions are on the *counts*, because the count is what the report
 * prints. Each one is paired with the mutation it catches, in the file's red
 * proof in `F1-determinism.report.md`.
 */

import { describe, expect, it } from '@jest/globals';

import { parseTestResults, realInputLine } from '../real-input/ios-log.mjs';

/**
 * A two-case run where the Switch needed a second press and the Button did not.
 *
 * The suite's header precedes any case. The retry line is indented the way
 * xcodebuild indents a case's own stdout; a matcher anchored to `^` would drop
 * every one of them, which is the same silence as not printing it.
 */
const RUN = [
  'real-input (ios): nitro-ui A · 49D5024D · Metro 8295 · scheme NitroUiExampleUITests',
  "Test Suite 'Selected tests' started at 2026-10-29 05:19:29.480",
  "Test Case '-[NitroUiExampleUITests.RealInputTests testRealInputSwitch]' started.",
  '    t =     6.52s Checking existence of `"switch-controlled-value" Any`',
  '    real-input (ios): the first real tap: the controlled Switch (switch-controlled) answered on tap 2/3 - the earlier tap(s) were never delivered',
  "Test Case '-[NitroUiExampleUITests.RealInputTests testRealInputSwitch]' passed (18.271 seconds).",
  "Test Case '-[NitroUiExampleUITests.RealInputTests testRealInputButton]' started.",
  '    real-input (ios): a real tap on a hosted Button: tap 1/3 left "0" - tapping again',
  '    real-input (ios): a real tap on a hosted Button: tap 2/3 left "0" - tapping again',
  "Test Case '-[NitroUiExampleUITests.RealInputTests testRealInputButton]' passed (9.100 seconds).",
].join('\n');

describe('real-input iOS log', () => {
  it('counts a retry, and attributes it to the case that pressed again', () => {
    const results = parseTestResults(RUN);
    const sw = results.get('testRealInputSwitch');
    const button = results.get('testRealInputButton');

    expect(sw.retries).toHaveLength(1);
    expect(sw.retries[0]).toContain('answered on tap 2/3');
    // The Button never got an answer on a later tap, so nothing here may be
    // counted for it: two unanswered presses is a control that failed or
    // aborted, not a control that needed a retry.
    expect(button.retries).toEqual([]);
    expect(button.notes).toHaveLength(2);
  });

  it('does not charge the suite header to whichever case reads next', () => {
    const results = parseTestResults(RUN);
    // The header is printed before any `Test Case ... started`, so it belongs to
    // nobody. Attaching it to the first case would give every run one retry-free
    // note on Switch, and, if the tag ever moved, could count as a retry.
    const all = [...results.values()].flatMap((r) => [
      ...r.notes,
      ...r.retries,
    ]);
    expect(all.some((line) => line.includes('Metro 8295'))).toBe(false);
    // The header is the only line before a case starts, so Switch keeps exactly
    // the one line it printed.
    expect(results.get('testRealInputSwitch').retries).toHaveLength(1);
  });

  it('still recognises a suite line when xcodebuild adds a prefix', () => {
    // Observed shapes: xcodebuild's own console indents a case's stdout, and a
    // log gathered from a result bundle quotes it with a timestamp. Matching the
    // tag rather than the line start is what survives both.
    for (const line of [
      'real-input (ios): dwell-probe: RESULT target=x dwell=0.05s switch=1/12 js-toggle=3/3',
      '    real-input (ios): the first real tap: foo answered on tap 3/3 - x',
      '2026-10-29 05:19:29.480 NitroUiExampleUITests(xxx)[123] <private>: real-input (ios): bar answered on tap 2/3',
    ]) {
      expect(realInputLine(line)).not.toBeNull();
    }
    expect(realInputLine('    t = 6.52s Checking existence of `x`')).toBeNull();
  });

  it('tells an unanswered press apart from a retried one', () => {
    // The two lines differ by four words and the difference is the whole
    // measurement: "answered on tap 2/3" says the OS dropped a touch, "tap 1/3
    // left" says the check is still waiting. Counting both would report drops
    // that were only slowness.
    expect(
      realInputLine(
        '    real-input (ios): the first tap: foo answered on tap 2/3 - never delivered'
      )?.isRetry
    ).toBe(true);
    expect(
      realInputLine(
        '    real-input (ios): tap 1/3 on "echo" left "off" - tapping again'
      )?.isRetry
    ).toBe(false);
  });

  it('reports the counted line once, not also as a note', () => {
    // A real run caught this: the retry line appeared twice under the control,
    // because it sat in both `notes` and `retries`, and the caller prints both
    // arrays. Two lists that mean different things must not both hold one line.
    const sw = parseTestResults(RUN).get('testRealInputSwitch');
    const answered = [...sw.notes, ...sw.retries].filter((line) =>
      line.includes('answered on tap 2/3')
    );
    expect(answered).toHaveLength(1);
    expect(sw.notes).not.toContainEqual(
      expect.stringContaining('answered on tap')
    );
  });

  it('keeps attaching an error line to the case that names it', () => {
    const log = [
      "Test Case '-[NitroUiExampleUITests.RealInputTests testRealInputSwitch]' started.",
      '/path/RealInputTests.swift:142: error: -[NitroUiExampleUITests.RealInputTests testRealInputSwitch] : failed - one real tap should flip the Switch',
      "Test Case '-[NitroUiExampleUITests.RealInputTests testRealInputSwitch]' failed (30.000 seconds).",
    ].join('\n');
    const sw = parseTestResults(log).get('testRealInputSwitch');
    expect(sw.outcome).toBe('failed');
    expect(sw.notes).toHaveLength(1);
    expect(sw.notes[0]).toContain('one real tap should flip the Switch');
  });

  it('reports no results at all for a log with no cases', () => {
    // A build failure produces a log with `error:` lines and no cases. Returning
    // nothing is what makes `ios.mjs` say "the case never reported" rather than
    // calling an empty run green.
    expect(
      parseTestResults('** TEST BUILD FAILED **\nerror: clang failed').size
    ).toBe(0);
  });
});

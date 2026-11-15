import { describe, expect, it } from '@jest/globals';

import { parseTestResults, realInputLine } from '../real-input/ios-log.mjs';

/**
 * A run where the Switch needed a second press and the Button did not. The suite's
 * header precedes any case, and a case's own output is indented the way xcodebuild
 * indents it.
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
  "Test Case '-[NitroUiExampleUITests.RealInputTests testRealInputTextField]' started.",
  '    real-input (ios): the first refused edit to be reported: key "x" into the frozen field key 1/3 left "frozen: 0 edits refused" - typing it again',
  '    real-input (ios): the first refused edit to be reported: key "x" into the frozen field answered on key 2/3 - the earlier key(s) were never delivered',
  "Test Case '-[NitroUiExampleUITests.RealInputTests testRealInputTextField]' passed (21.400 seconds).",
].join('\n');

describe('real-input iOS log', () => {
  it('counts a retry, and attributes it to the case that pressed again', () => {
    const results = parseTestResults(RUN);
    const sw = results.get('testRealInputSwitch');
    const button = results.get('testRealInputButton');

    expect(sw.retries).toHaveLength(1);
    expect(sw.retries[0]).toContain('answered on tap 2/3');
    // Two unanswered presses are not a retry: a retry is an answer on a later tap.
    expect(button.retries).toEqual([]);
    expect(button.notes).toHaveLength(2);
  });

  it('does not charge the suite header to whichever case reads next', () => {
    const results = parseTestResults(RUN);
    // The header is printed before any case starts, so it belongs to no case.
    const all = [...results.values()].flatMap((r) => [
      ...r.notes,
      ...r.retries,
    ]);
    expect(all.some((line) => line.includes('Metro 8295'))).toBe(false);
    expect(results.get('testRealInputSwitch').retries).toHaveLength(1);
  });

  it('still recognises a suite line when xcodebuild adds a prefix', () => {
    // xcodebuild's console indents a case's stdout, and a log taken from a result
    // bundle prefixes a timestamp.
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
    // "answered on tap 2/3" means a touch was dropped; "tap 1/3 left" means the
    // check is still waiting.
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

  it('counts a re-typed keystroke as the retry it is', () => {
    expect(
      realInputLine(
        '    real-input (ios): the first refused edit: key "x" answered on key 2/3 - ' +
          'the earlier key(s) were never delivered'
      )?.isRetry
    ).toBe(true);
    // An attempt that was not answered is still a note, not a counted retry.
    expect(
      realInputLine(
        '    real-input (ios): key 1/3 left "frozen: 0 edits refused" - typing it again'
      )?.isRetry
    ).toBe(false);

    const field = parseTestResults(RUN).get('testRealInputTextField');
    expect(field.retries).toHaveLength(1);
    expect(field.retries[0]).toContain('answered on key 2/3');
    expect(field.notes).toHaveLength(1);
    expect(field.notes[0]).toContain('typing it again');
  });

  it('reports the counted line once, not also as a note', () => {
    // The caller prints both arrays, so one line must not be in both.
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
    // A build failure has `error:` lines and no cases; it must not read as an
    // empty green run.
    expect(
      parseTestResults('** TEST BUILD FAILED **\nerror: clang failed').size
    ).toBe(0);
  });
});

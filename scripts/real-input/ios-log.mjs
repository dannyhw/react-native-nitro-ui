/**
 * Reading an XCUITest log: which case did what, and how often it had to press
 * again to get there.
 *
 * This lives apart from `ios.mjs` for one reason: `ios.mjs` runs the suite, so
 * nothing can reach these functions without a simulator. Whether a retry is
 * counted, and which control a log line is attributed to, is the part of M2 a
 * regression could quietly break - the gate still prints `10/10` either way - so
 * it is the part that needs a test, and a test needs an import. See
 * `scripts/__tests__/real-input-ios-log.test.js`.
 */

/**
 * The suite's own log line, if this line of an xcodebuild log is one.
 *
 * A `print()` from an XCUITest case arrives with whatever prefix the tool in
 * front of it decides on - none, a timestamp, quotes - so the prefix is not
 * matched; the `real-input (ios):` tag is what makes the line ours, and the
 * helper returns the text with the prefix stripped so the report reads the same
 * whichever tool produced the log.
 *
 * @param {string} line
 * @returns {{ text: string, isRetry: boolean } | null}
 */
export function realInputLine(line) {
  const match = /real-input \((?:ios|android)\): (.*)$/.exec(line);
  if (match == null) {
    return null;
  }
  return {
    text: `real-input (ios): ${match[1].trim()}`,
    // Only "answered on tap n/N" says a press was delivered and had to be
    // repeated. The "tap n/N left ..." lines say an attempt was not answered,
    // and belong to the notes rather than to the count: a run where every
    // control needed one retry and a run where every control's first press was
    // simply slow are different facts, and the number has to mean one of them.
    isRetry: / answered on tap \d+\/\d+/.test(match[1]),
  };
}

/**
 * What each test case did, read out of an xcodebuild log.
 *
 * The suite's own `real-input (ios):` lines are attached to whichever case was
 * running when they were printed, which is what makes a retry a fact about a
 * control rather than a line that only ever lived in
 * `.real-input/ios/xcodebuild-test.log` - a file the next run overwrites (F1 M2).
 *
 * @param {string} log
 * @returns {Map<string, { outcome: string, duration: string, notes: string[], retries: string[] }>} by method name.
 *   `notes` and `retries` are disjoint: a retry line is in `retries` only. Both end
 *   up on the control's log, so a parser that also left them in `notes` printed every
 *   retry twice - once as a note, once as the counted retry - which is how the first
 *   version of this came out of a real run.
 */
export function parseTestResults(log) {
  /** @type {Map<string, { outcome: string, duration: string, notes: string[], retries: string[] }>} */
  const results = new Map();
  for (const match of log.matchAll(
    /Test Case '-\[[\w.]+ (\w+)\]' (passed|failed|skipped) \(([\d.]+) seconds\)/g
  )) {
    results.set(match[1], {
      outcome: match[2],
      duration: match[3],
      notes: [],
      retries: [],
    });
  }
  /** Which case is on screen right now, while walking the log in order. */
  let running = null;
  for (const line of log.split('\n')) {
    const started = /Test Case '-\[[\w.]+ (\w+)\]' started/.exec(line);
    if (started != null) {
      running = results.get(started[1]) ?? null;
    }
    const own = realInputLine(line);
    if (own != null) {
      if (running == null) {
        // A line printed before any case started (the suite's own header, most
        // often). Kept in the log, attributed to nobody: inventing an owner for
        // it would put a retry on a control that did not do one.
        continue;
      }
      if (own.isRetry) {
        running.retries.push(own.text);
      } else {
        running.notes.push(own.text);
      }
      continue;
    }
    if (!/error:/.test(line)) {
      continue;
    }
    const named = /(testRealInput\w+)/.exec(line);
    if (named != null && results.has(named[1])) {
      results.get(named[1]).notes.push(line.trim());
      continue;
    }
    // Anything else - a build or runner error - belongs to whichever case
    // failed, because that is the run it explains.
    for (const result of results.values()) {
      if (result.outcome === 'failed') {
        result.notes.push(line.trim());
      }
    }
  }
  return results;
}

/**
 * The real-input report: one control's checks, and the run's summary line.
 *
 * Split out of `support.mjs` for the same reason `a11y.mjs` was split from
 * `ios.mjs`: `support.mjs` computes paths from `import.meta.url`, which jest
 * refuses to parse, so nothing in it can be imported by a unit test. The
 * distinction that matters here is a printed one - what a WARN looks like, and
 * whether the summary line carries it - and a claim about the one line a reader
 * sees first has to be a test rather than a device run (X16 item 4). No behaviour
 * changed in the move; `support.mjs` still re-exports all three, so every existing
 * import keeps working.
 */

/** @typedef {(typeof import('./controls.mjs').REAL_INPUT_CONTROLS)[number]} RealInputControl */

/**
 * One control's run: the assertions it made, and whether any failed.
 *
 * Checks report every assertion rather than throwing on the first one, because
 * the useful output of a failing real-input run is "the drag moved the thumb and
 * JS counted it, but `complete` never fired", not just "red".
 */
export class CheckLog {
  /** @param {string} title */
  constructor(title) {
    this.title = title;
    /** @type {string[]} */
    this.notes = [];
    /** @type {string[]} */
    this.failures = [];
    /**
     * Findings the run neither passed nor failed (X16 item 4). A transient accessibility bug is the
     * case: a first read at exactly the screen's ⅓ scale, discarded by a re-read that then agreed,
     * leaves the rule grading a correct tree — so the case passes, honestly — while the fact that
     * the tree was *ever* wrong is a real defect that came and went. That belongs in the summary,
     * because a fact that only ever appears as one line among forty per-case notes is reported as
     * clean by anyone who reads the verdict column.
     *
     * Kept apart from `notes` for the same reason `retries` is: the number has to be countable, and
     * a count that can be swept off the screen is not a count.
     *
     * @type {string[]}
     */
    this.warns = [];
    /**
     * Presses this control needed more than once to get an answer. Kept apart
     * from `notes` because a run where every control needed a second press is
     * the regression `FOLLOWUPS.md:58` describes, and it must be countable
     * rather than one line among forty.
     *
     * @type {string[]}
     */
    this.retries = [];
  }

  /**
   * @param {string} message
   */
  note(message) {
    this.notes.push(message);
    console.log(`    · ${message}`);
  }

  /**
   * A finding worth the summary line that is neither a pass nor a failure.
   *
   * Printed with the word at the front of the line, where a note starts with a middot: the per-case
   * print and the summary have to agree, and the word is what makes a reader stop.
   *
   * @param {string} message
   */
  warn(message) {
    this.warns.push(message);
    console.log(`    WARN ${message}`);
  }

  /**
   * A press was delivered and had to be repeated. Says how often, because
   * "10/10 green" cannot tell "never retried" from "retried every time" unless
   * the number is recorded (Q3 §3, F1 M2).
   *
   * @param {string} message
   */
  retried(message) {
    this.retries.push(message);
    this.note(message);
  }

  /**
   * @param {string} description
   * @param {boolean} condition
   */
  check(description, condition) {
    if (condition) {
      this.notes.push(`ok: ${description}`);
      console.log(`    ✓ ${description}`);
      return true;
    }
    this.failures.push(description);
    console.log(`    ✗ ${description}`);
    return false;
  }

  /**
   * @param {string} description
   * @param {string | number} actual
   * @param {string | number} expected
   */
  checkEquals(description, actual, expected) {
    return this.check(
      `${description} — expected ${String(expected)}, saw ${String(actual)}`,
      String(actual) === String(expected)
    );
  }

  /**
   * Record something that should not have happened at all (a missing element, an
   * unusable device). It is a failure, and it stops the check.
   *
   * @param {string} message
   * @returns {never}
   */
  abort(message) {
    this.failures.push(message);
    console.log(`    ✗ ${message}`);
    const error = new AbortedCheck(message);
    RECORDED_ABORTS.set(error, this);
    throw error;
  }

  get passed() {
    return this.failures.length === 0;
  }
}

/**
 * A check stopped because something it needs is not there at all (an element
 * that never appeared, a gesture that timed out). The reason is already on the
 * report, so the run moves on to the next control instead of losing it too.
 *
 * "Already on the report" is only true when {@link CheckLog.abort} threw it. A bare
 * `throw new AbortedCheck(...)` from a check skips the log, and the runner that
 * swallowed it to move on used to report that control as passed - E1 saw a PASS on
 * a check that never ran (X20 item 1). So which log recorded an abort is kept here,
 * and {@link runCheck} turns one no log recorded into a failure of the control.
 */
export class AbortedCheck extends Error {}

/**
 * The aborts {@link CheckLog.abort} threw, and the log that recorded each. A
 * `WeakMap` rather than a flag on the error: a flag is a public field, and a check
 * that copied it onto its own `new AbortedCheck` would be the false green again.
 *
 * @type {WeakMap<AbortedCheck, CheckLog>}
 */
const RECORDED_ABORTS = new WeakMap();

/**
 * Runs one control's check against its log, and moves on when it aborts.
 *
 * The contract the runner relies on, in one place so a runner cannot get it
 * wrong: an abort `log` itself recorded is a failure that is already printed, so
 * the run carries on with the next control; an `AbortedCheck` that `log` never
 * recorded (thrown bare, or by another log) is recorded here as a failure, because
 * otherwise the control reads PASS with no assertion behind it; any other error is
 * not a check result at all and ends the run.
 *
 * @param {CheckLog} log the control's log
 * @param {() => unknown} fn the check
 * @returns {Promise<void>}
 */
export async function runCheck(log, fn) {
  try {
    await fn();
  } catch (error) {
    if (!(error instanceof AbortedCheck)) throw error;
    if (RECORDED_ABORTS.get(error) === log) return;
    log.check(
      `the check stopped with an abort its log never recorded, so nothing it ` +
        `asserted can be trusted: ${error.message}`,
      false
    );
  }
}

/**
 * The run's report, shared by both platforms so the two print the same shape.
 */
export class Suite {
  /**
   * @param {string} platform
   * @param {ReadonlyArray<RealInputControl>} controls
   */
  constructor(platform, controls) {
    this.platform = platform;
    this.controls = controls;
    /** @type {Array<{ control: RealInputControl, log: CheckLog | null, missing: boolean }>} */
    this.results = [];
    /**
     * Logs for checks that are not about one control, so they cannot inflate the
     * control totals. See {@link beginAuxiliary}.
     *
     * @type {Array<{ id: string, log: CheckLog }>}
     */
    this.auxiliary = [];
  }

  /**
   * A control that is in the shared table but has no check on this platform.
   * That is a failure, never a skip.
   *
   * @param {string} id
   */
  markMissing(id) {
    const control = this.controls.find((entry) => entry.id === id);
    if (control != null) {
      this.results.push({ control, log: null, missing: true });
    }
  }

  /**
   * @param {RealInputControl} control
   */
  begin(control) {
    const log = new CheckLog(control.title);
    console.log(`\n  ${control.id}: ${control.title}`);
    this.results.push({ control, log, missing: false });
    return log;
  }

  /**
   * A check that is not one control's press-sequence assertion, and must not be counted
   * as a control.
   *
   * `finish` reports `passed/expected` over the shared control table, so a log pushed into
   * `results` would make the totals lie: `real-input` would claim eleven controls passed
   * when the table has ten. The X4 a11y sweep is the first user — fourteen cases that are
   * about the accessibility tree rather than about a control responding to a press. They
   * get their own section and their own line in the verdict, which keeps `10/10` meaning
   * what it has always meant while still failing the run.
   *
   * @param {string} id
   * @param {string} title
   * @returns {CheckLog}
   */
  beginAuxiliary(id, title) {
    const log = new CheckLog(title);
    console.log(`\n  ${id}: ${title}`);
    this.auxiliary.push({ id, log });
    return log;
  }

  /**
   * Print the summary and return the process exit code.
   *
   * @returns {number}
   */
  finish() {
    const expected = this.controls.length;
    const done = this.results.filter((entry) => !entry.missing);
    const passed = done.filter((entry) => entry.log?.passed);
    console.log('');
    for (const entry of this.results) {
      if (entry.missing) {
        console.log(
          `${entry.control.id}: NO CHECK on ${this.platform} — the control is listed in scripts/real-input/controls.mjs but this platform does not implement one`
        );
        continue;
      }
      const label = entry.log?.passed ? 'PASS' : 'FAIL';
      const retries = entry.log?.retries.length ?? 0;
      console.log(
        `${entry.control.id}: ${label}` +
          (retries > 0
            ? ` (retried ${String(retries)} press sequence(s))`
            : ' (no retries)')
      );
      for (const failure of entry.log?.failures ?? []) {
        console.log(`    failed: ${failure}`);
      }
    }
    // Auxiliary checks press too: the a11y sweep reaches its screens through the same
    // tabs the controls do, and on a full run that is most of the run's navigations. A
    // retry counted only on the control side was a retry the summary denied (X21), so
    // the one number a reader compares against "no retries" is the sum of both sides.
    const controlRetries = done.reduce(
      (sum, entry) => sum + (entry.log?.retries.length ?? 0),
      0
    );
    const auxiliaryRetries = this.auxiliary.reduce(
      (sum, entry) => sum + (entry.log.retries.length ?? 0),
      0
    );
    const totalRetries = controlRetries + auxiliaryRetries;
    // The auxiliary checks, printed after the controls so the control table's totals stay
    // readable and their own failures still decide the exit code below.
    const auxFailed = this.auxiliary.filter((entry) => !entry.log.passed);
    for (const entry of this.auxiliary) {
      if (entry.log.passed) continue;
      for (const failure of entry.log.failures) {
        console.log(`${entry.id}: failed: ${failure}`);
      }
    }
    // Warnings, counted on the one line a reader looks at first (X16 item 4). Which checks warned is
    // named here rather than left to the per-case notes, because the whole point of a warning is
    // that the case *passed*: a fact that only lives in a note two screens up is how a transient
    // accessibility bug gets reported as a clean run. Counted rather than one line per case, so ten
    // instances of one finding read as one fact about the run instead of pushing the totals off the
    // screen. Never affects the exit code - see `CheckLog.warn` for why that is the honest answer.
    const warned = [...this.results, ...this.auxiliary].filter(
      (entry) => (entry.log?.warns.length ?? 0) > 0
    );
    if (warned.length > 0) {
      console.log(
        `\nWARN ${String(warned.length)} check(s) reported a finding that is neither a pass ` +
          `nor a failure: ${warned.map((entry) => entry.id ?? entry.control.id).join(', ')}`
      );
      for (const entry of warned) {
        for (const message of entry.log.warns) {
          console.log(`  ${entry.id ?? entry.control.id}: ${message}`);
        }
      }
    }
    console.log(
      `\nreal-input (${this.platform}): ${String(passed.length)}/${String(expected)} controls passed` +
        ` · ${String(totalRetries)} press sequence(s) needed a retry` +
        (totalRetries === 0
          ? ''
          : ' - see the "answered on tap/key" notes above for which') +
        (auxiliaryRetries === 0
          ? ''
          : `, ${String(auxiliaryRetries)} of them by an auxiliary check`) +
        (this.auxiliary.length === 0
          ? ''
          : ` · ${String(this.auxiliary.length - auxFailed.length)}/` +
            `${String(this.auxiliary.length)} auxiliary checks passed`)
    );
    return passed.length === expected &&
      this.results.length === expected &&
      auxFailed.length === 0
      ? 0
      : 1;
  }
}

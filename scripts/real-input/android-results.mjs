/**
 * The Android real-input verdicts: e2e's JSON report turned into one report line
 * per test, and the quarantine rule a skipped test is held to.
 *
 * Kept apart from `android.mjs`, which starts a run when it is imported, so the
 * verdicts can be unit-tested against report fixtures.
 */

/** @typedef {import('./report.mjs').Suite} Suite */
/** @typedef {(typeof import('./controls.mjs').REAL_INPUT_CONTROLS)[number]} RealInputControl */

/** One test file per control, named after its id in `controls.mjs`. */
export const TEST_SUFFIX = '.e2e.ts';

/** Where quarantined tests are listed, relative to the repo root. */
export const FOLLOWUPS_FILE = 'docs/tasks/FOLLOWUPS.md';

const QUARANTINE_HEADING = '## Quarantined tests';

const QUARANTINE_COMMENT = /\bQUARANTINED \d{4}-\d{2}-\d{2}\b/;

/**
 * The tests listed under "Quarantined tests" in FOLLOWUPS, as `file` + `title`
 * pairs: each list item opens with the file in backticks and the title in
 * double quotes, and may wrap onto indented lines.
 *
 * @param {string | null} text the file's contents, or null when it cannot be read
 * @returns {Array<{file: string, title: string}>}
 */
export function quarantineList(text) {
  if (text == null) return [];
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === QUARANTINE_HEADING);
  if (start === -1) return [];
  /** @type {string[]} */
  const items = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2} /.test(line)) break;
    if (line.startsWith('- ')) {
      items.push(line.slice(2));
    } else if (/^\s+\S/.test(line) && items.length > 0) {
      items[items.length - 1] += ` ${line.trim()}`;
    } else if (/^\S/.test(line) && items.length > 0) {
      // Prose after the list is the rest of the file, whose own items are not quarantines.
      break;
    }
  }
  return items.flatMap((item) => {
    const match = /^`([^`]+)`\s+"([^"]+)"/.exec(item);
    return match == null ? [] : [{ file: match[1], title: match[2] }];
  });
}

/**
 * What stops a skipped test from counting as quarantined, one reason per gap;
 * empty when it is quarantined.
 *
 * Both halves are required, so a skip cannot hide unlisted: the comment sits in
 * the contiguous `//` comment block directly above the `test.skip(` line, and
 * FOLLOWUPS names the file and the title as written.
 *
 * @param {any} result one e2e report result with status `skipped`
 * @param {{listed: Array<{file: string, title: string}>,
 *   readTestFile: (file: string) => string | null}} sources
 * @returns {string[]}
 */
export function quarantineGaps(result, { listed, readTestFile }) {
  const cause = result.skip?.cause ?? 'unknown';
  if (cause !== 'explicit') {
    return [
      `it was skipped by the runner (${String(cause)}), not by test.skip`,
    ];
  }
  const file = String(result.file);
  const title = String(result.titlePath?.at(-1) ?? '');
  const line = Number(result.source?.line);
  const where = `${file}:${String(line)}`;
  const gaps = [];
  const lines = readTestFile(file)?.split('\n') ?? null;
  if (lines == null || !Number.isInteger(line) || line < 1) {
    gaps.push(
      `its source (${where}) cannot be read for the QUARANTINED comment`
    );
  } else if (!/^\s*test\.skip\(/.test(lines[line - 1] ?? '')) {
    gaps.push(`${where} is not a test.skip( line`);
  } else {
    let commented = false;
    for (let index = line - 2; index >= 0; index -= 1) {
      const text = lines[index].trim();
      if (!text.startsWith('//')) break;
      if (QUARANTINE_COMMENT.test(text)) {
        commented = true;
        break;
      }
    }
    if (!commented) {
      gaps.push(
        `no "// QUARANTINED <YYYY-MM-DD>" comment on the line above its test.skip( (${where})`
      );
    }
  }
  const name = file.split('/').at(-1);
  if (!listed.some((entry) => entry.file === name && entry.title === title)) {
    gaps.push(
      `\`${String(name)}\` "${title}" is not listed under "Quarantined tests" in ${FOLLOWUPS_FILE}`
    );
  }
  return gaps;
}

/**
 * The verdicts of one e2e run, as one report line per control.
 *
 * A control's file is its suite, so a control is green when every test in its
 * file passed or is quarantined, and red with one line per failed test — the line
 * is the failure itself, because `gate.mjs` harvests the `✗` lines into a run's
 * excerpt. A quarantined test gets a line of its own and decides nothing.
 *
 * @param {Suite} suite
 * @param {ReadonlyArray<RealInputControl>} controls
 * @param {any} report The `run` object of e2e's report.
 * @param {{followups: string | null, readTestFile: (file: string) => string | null}} sources
 *   FOLLOWUPS' text, and a reader of a test file by its report path.
 * @returns {boolean} whether every selected control passed
 */
export function recordResults(suite, controls, report, sources) {
  const results = Array.isArray(report?.results) ? report.results : [];
  const listed = quarantineList(sources.followups);
  let anyResult = false;
  /** Checks the report says did not pass, whatever e2e itself exited with. */
  let failures = 0;
  for (const control of controls) {
    const file = `real-input/${control.id}${TEST_SUFFIX}`;
    const fromFile = results.filter(
      (result) => result.kind === 'test' && result.file === file
    );
    if (fromFile.length === 0) {
      // A control that ran nothing is a failure, never a skip: the file exists but
      // collected nothing (a filter, a bad import).
      suite.markMissing(control.id);
      failures += 1;
      continue;
    }
    anyResult = true;
    const log = suite.begin(control);
    for (const result of fromFile) {
      const title = result.titlePath?.join(' › ') ?? control.title;
      if (result.status === 'passed') {
        log.check(title, true);
        continue;
      }
      if (result.status === 'skipped') {
        const gaps = quarantineGaps(result, {
          listed,
          readTestFile: sources.readTestFile,
        });
        if (gaps.length === 0) {
          log.quarantine(`${title} — skipped, listed in ${FOLLOWUPS_FILE}`);
          continue;
        }
        failures += 1;
        log.check(
          `${title} — skipped, which is not a pass: ${gaps.join('; ')}`,
          false
        );
        continue;
      }
      failures += 1;
      const failure =
        result.error?.message ??
        result.error?.value ??
        result.status ??
        'failed';
      log.check(`${title}: ${String(failure).split('\n')[0]}`, false);
    }
  }
  // Whether the report proves the run passed — not merely that it produced
  // something. e2e's own exit code is a second, weaker opinion on top of this one.
  return anyResult && failures === 0;
}

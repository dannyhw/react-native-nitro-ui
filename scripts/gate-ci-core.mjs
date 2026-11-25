/**
 * The pure half of taking `real-input:android` from a GitHub Actions run: which run
 * may be imported, how what it uploaded is judged, and the ledger line it becomes.
 * No `gh`, no git and no process spawning, so the tests can import it.
 *
 * A run is judged from what it uploaded, never from the job's conclusion: the units
 * file the suite wrote, the e2e report, and the run record `scripts/gate-ci.mjs`
 * wrote around the suite. The e2e report is judged again here by the code a local
 * run is judged by (`recordResults`, quarantines included), and a control passes
 * only when both the units file and the report say it did.
 */

import { recordResults } from './real-input/android-results.mjs';
import { REAL_INPUT_CONTROLS } from './real-input/controls.mjs';
import {
  canonicalGateName,
  completeRerun,
  completionProvenance,
  gateStateFor,
  ledgerLineFromRun,
  planRerunFailed,
  realInputUnitsFromResults,
  relaxedSwitches,
  resolveGate,
} from './gate-core.mjs';

/** The one gate a CI run can stand for. */
export const CI_GATE = 'real-input:android';

/** The workflow, its job and the artifact the job uploads its report in. */
export const CI_WORKFLOW_PATH = '.github/workflows/ci.yml';
export const CI_JOB_NAME = 'Real input (Android)';
export const CI_ARTIFACT = 'real-input-android';

/**
 * Inside the artifact: one folder per run of the suite, each with the run record,
 * the units file and e2e's output folder.
 */
export const CI_FULL_DIR = 'full';
export const CI_RERUN_DIR = 'rerun';
export const CI_RUN_RECORD = 'run.json';
export const CI_UNITS_FILE = 'units.json';
export const CI_E2E_DIR = 'e2e';
export const CI_REPORT_FILE = `${CI_E2E_DIR}/report.json`;

/**
 * Switches every GitHub-hosted runner sets. They lengthen the suite's ceiling to fit
 * the hosted emulator (`scripts/real-input/android.mjs`), which a CI run is accepted
 * with, so they are not recorded as relaxing it. Any other relaxing switch is.
 */
export const HOSTED_RUNNER_SWITCHES = ['CI', 'GITHUB_ACTIONS'];

/**
 * The relaxing switches a CI run of the suite had set, less the hosted runner's own.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {Record<string, string>}
 */
export function hostedRunRelaxed(env) {
  const relaxed = relaxedSwitches(env);
  for (const name of HOSTED_RUNNER_SWITCHES) delete relaxed[name];
  return relaxed;
}

/**
 * Every reason a run may not be imported onto this checkout; empty when it may.
 *
 * @param {object} options
 * @param {any} options.run the Actions run, as `gh api .../actions/runs/<id>` reads it
 * @param {any[]} options.jobs the jobs of that run's newest attempt
 * @param {string} options.head this checkout's `HEAD`
 * @param {string[]} options.dirty `git status --porcelain` lines
 * @param {object[]} [options.entries] this branch's ledger lines
 * @param {{tree?: string | null, trees?: object | null, gateTrees?: object | null}} [options.digests]
 *   this checkout's digests, which decide which of those lines are on this code
 * @returns {string[]}
 */
export function ciImportRefusals({
  run,
  jobs,
  head,
  dirty,
  entries = [],
  digests = {},
}) {
  const reasons = [];
  const id = String(run?.id ?? '?');
  const sha = String(run?.head_sha ?? '');
  if (sha === '' || sha !== head) {
    reasons.push(
      `run ${id} ran commit ${sha === '' ? '(none named)' : sha.slice(0, 12)}, and HEAD ` +
        `is ${String(head).slice(0, 12)}: a CI run proves only the commit it ran. ` +
        'Check out that commit, or dispatch a run of this one'
    );
  }
  if (dirty.length > 0) {
    reasons.push(
      `the worktree has uncommitted changes (${dirty.slice(0, 3).join(', ')}` +
        `${dirty.length > 3 ? ', …' : ''}), so its files are not the commit the run ` +
        'ran: commit or stash them'
    );
  }
  if (run?.status !== 'completed') {
    reasons.push(
      `run ${id} is not finished (${String(run?.status ?? 'unknown')}): wait for it`
    );
  }
  if (run?.path !== CI_WORKFLOW_PATH) {
    reasons.push(
      `run ${id} is of ${String(run?.path ?? 'an unnamed workflow')}, not ${CI_WORKFLOW_PATH}`
    );
  }
  const matching = (jobs ?? []).filter((job) => job?.name === CI_JOB_NAME);
  if (matching.length !== 1) {
    reasons.push(
      `run ${id} has ${matching.length === 0 ? 'no' : String(matching.length)} job(s) ` +
        `named "${CI_JOB_NAME}"` +
        (matching.length === 0
          ? ` (its jobs: ${(jobs ?? []).map((job) => `"${String(job?.name)}"`).join(', ') || 'none'})`
          : '')
    );
  } else if (matching[0].status !== 'completed') {
    reasons.push(
      `the "${CI_JOB_NAME}" job of run ${id} is not finished (${String(matching[0].status)})`
    );
  }
  const attempt = Number(run?.run_attempt ?? 1);
  if (
    entries.some(
      (entry) =>
        entry?.source?.runId === Number(run?.id) &&
        Number(entry?.source?.attempt ?? 1) === attempt
    )
  ) {
    reasons.push(
      `attempt ${String(attempt)} of run ${id} is already in this branch's ledger`
    );
  }
  // The last line appended decides this branch's row, so a run that started before a
  // line that already decides on this digest would override newer evidence.
  const started = Date.parse(String(run?.run_started_at ?? ''));
  const deciding = entries.filter((entry) => {
    if (entry?.gate !== CI_GATE) return false;
    const { state } = gateStateFor({
      gate: CI_GATE,
      entry,
      tree: digests.tree ?? null,
      trees: digests.trees ?? null,
      gateTrees: digests.gateTrees ?? null,
    });
    return state === 'green' || state === 'red';
  });
  if (deciding.length > 0 && !Number.isFinite(started)) {
    reasons.push(
      `run ${id} does not say when it started, and this branch already has a ` +
        `${CI_GATE} line on this code: an import must not replace a newer run`
    );
  } else {
    const newer = deciding.filter((entry) => Date.parse(entry.ts) > started);
    if (newer.length > 0) {
      const last = newer[newer.length - 1];
      reasons.push(
        `run ${id} started at ${new Date(started).toISOString()}, before the ` +
          `${last.result === 'pass' ? 'green' : 'red'} ${CI_GATE} ` +
          `${last.completion == null ? 'run' : 'completion'} of ${String(last.ts)} ` +
          'already on this branch for this code: importing it would replace newer ' +
          'evidence. Dispatch a new run of this commit'
      );
    }
  }
  return reasons;
}

/** The one job a run is imported from; call after `ciImportRefusals` came back empty. */
export function ciJobOf(jobs) {
  return (jobs ?? []).find((job) => job?.name === CI_JOB_NAME) ?? null;
}

/**
 * The artifact the imported job uploaded. A run re-run on GitHub keeps every
 * attempt's artifacts under the same name, so only one created while that job ran
 * is its own.
 *
 * @param {object} options
 * @param {any[]} options.artifacts the run's artifacts, as the API lists them
 * @param {any} options.job the job being imported
 * @returns {{artifact: any, refusal: null} | {artifact: null, refusal: string}}
 */
export function ciArtifactOf({ artifacts, job }) {
  const started = Date.parse(String(job?.started_at ?? ''));
  const completed = Date.parse(String(job?.completed_at ?? ''));
  const named = (artifacts ?? []).filter(
    (entry) => entry?.name === CI_ARTIFACT
  );
  if (!Number.isFinite(started) || !Number.isFinite(completed)) {
    return {
      artifact: null,
      refusal:
        `the "${CI_JOB_NAME}" job does not say when it ran, so no ${CI_ARTIFACT} ` +
        'artifact can be tied to it',
    };
  }
  const own = named.filter((entry) => {
    const created = Date.parse(String(entry?.created_at ?? ''));
    return created >= started && created <= completed;
  });
  const span = `${new Date(started).toISOString()} to ${new Date(completed).toISOString()}`;
  if (own.length !== 1) {
    return {
      artifact: null,
      refusal:
        `${own.length === 0 ? 'no' : String(own.length)} ${CI_ARTIFACT} artifact(s) ` +
        `were created while the job ran (${span}; the run has ${String(named.length)}), ` +
        (own.length === 0
          ? 'so this attempt uploaded no report: the job ended before the suite started'
          : "so which one is this attempt's report is not known"),
    };
  }
  if (own[0]?.expired === true) {
    return {
      artifact: null,
      refusal: `the job's ${CI_ARTIFACT} artifact (${String(own[0].id)}) has expired`,
    };
  }
  return { artifact: own[0], refusal: null };
}

/**
 * One run of the suite's verdicts, with logs that print nothing: `recordResults`
 * reports through a suite, and this one only collects.
 */
function collectingSuite() {
  /** @type {Map<string, {status: string, failures: string[], quarantined: string[]}>} */
  const byId = new Map();
  return {
    byId,
    markMissing(id) {
      byId.set(id, { status: 'missing', failures: [], quarantined: [] });
    },
    begin(control) {
      const entry = { status: 'pass', failures: [], quarantined: [] };
      byId.set(control.id, entry);
      return {
        check(description, condition) {
          if (!condition) {
            entry.status = 'fail';
            entry.failures.push(description);
          }
          return condition;
        },
        quarantine(message) {
          entry.quarantined.push(message);
        },
      };
    },
  };
}

/**
 * A run record's relaxing switches, or `null` when it does not say.
 *
 * @param {any} record
 * @returns {Record<string, string> | null}
 */
function recordedRelaxed(record) {
  const relaxed = record?.relaxed;
  return relaxed != null &&
    typeof relaxed === 'object' &&
    !Array.isArray(relaxed)
    ? relaxed
    : null;
}

/**
 * The verdict of one run of the suite from what it uploaded.
 *
 * It passes only when the run exited 0, every unit and every every-run check passed,
 * the e2e report is of `sha`, and the report, judged again here, proves each selected
 * control passed. A control the units file and the report disagree about is a
 * failure. A run that selected no control (an a11y case alone) has no report to read.
 *
 * @param {object} options
 * @param {any} options.record the run record (`run.json`)
 * @param {any} options.results the units file the suite wrote, or `null`
 * @param {any} options.report e2e's `report.json`, or `null`
 * @param {string} options.sha the commit the run must be of
 * @param {{followups: string | null, readTestFile: (file: string) => string | null}} options.sources
 *   what quarantines are read from, at that commit
 * @param {ReadonlyArray<{id: string, title: string}>} [options.controls]
 * @param {boolean} [options.whole] the run must be the full suite: no arguments, and
 *   every control selected
 * @returns {{passed: boolean, units: object | null, why: string[], evidence: string[],
 *   quarantined: string[], failures: string[]}} `why` every reason it did not pass;
 *   `evidence` the ones about the upload itself rather than a unit or the exit code
 */
export function judgeUploadedRun({
  record,
  results,
  report,
  sha,
  sources,
  controls = REAL_INPUT_CONTROLS,
  whole = false,
}) {
  const evidence = [];
  const why = [];
  const quarantined = [];
  const failures = [];
  if (record?.sha !== sha) {
    evidence.push(
      `the run record is of commit ${String(record?.sha ?? '(none named)').slice(0, 12)}, ` +
        `not ${String(sha).slice(0, 12)}`
    );
  }
  const exitCode =
    typeof record?.exitCode === 'number' ? record.exitCode : null;
  if (exitCode !== 0) {
    why.push(
      exitCode == null
        ? `the run ended without an exit code${record?.signal == null ? '' : ` (signal ${String(record.signal)})`}`
        : `the run exited ${String(exitCode)}`
    );
  }
  if (whole) {
    const args = Array.isArray(record?.args) ? record.args.map(String) : null;
    if (args == null || args.length > 0) {
      evidence.push(
        args == null
          ? 'the run record does not say what the suite was given, so it is not known to be the full suite'
          : `the run was given ${args.join(' ')}, so it is not the full suite`
      );
    }
  }
  if (results == null || !Array.isArray(results.selected)) {
    why.push(
      'the run wrote no per-control results: it stopped before its report'
    );
    return {
      passed: false,
      units: null,
      why,
      evidence,
      quarantined,
      failures,
    };
  }
  const selected = results.selected.map(String);
  if (whole) {
    const left = controls
      .map((control) => control.id)
      .filter((id) => !selected.includes(id));
    if (left.length > 0 || selected.length !== controls.length) {
      evidence.push(
        `the run selected ${String(selected.length)} of the ${String(controls.length)} ` +
          `controls${left.length > 0 ? ` (not ${left.join(', ')})` : ''}, so it is not the full suite`
      );
    }
  }
  const known = selected.map(
    (id) => controls.find((control) => control.id === id) ?? null
  );
  const unknown = selected.filter((_, index) => known[index] == null);
  if (unknown.length > 0) {
    evidence.push(
      `the results name controls this commit has not: ${unknown.join(', ')}`
    );
  }
  const fromUnits = new Map(
    (results.controls ?? []).map((control) => [
      String(control?.id),
      control?.status === 'pass' ? 'pass' : 'fail',
    ])
  );
  const suite = collectingSuite();
  const wanted = known.filter((control) => control != null);
  if (wanted.length > 0) {
    const run = report?.run ?? null;
    if (run == null) {
      evidence.push('the run uploaded no e2e report');
    } else {
      const commit = run?.vcs?.commit ?? null;
      if (commit !== sha) {
        evidence.push(
          `the e2e report is of commit ${String(commit ?? '(none named)').slice(0, 12)}, ` +
            `not ${String(sha).slice(0, 12)}`
        );
      }
      if (run?.vcs?.dirty === true) {
        evidence.push(
          'the e2e report says its checkout had uncommitted changes'
        );
      }
    }
    recordResults(suite, wanted, run, sources);
  }
  const merged = [];
  for (const control of wanted) {
    const unit = fromUnits.get(control.id) ?? null;
    const judged = suite.byId.get(control.id) ?? null;
    for (const message of judged?.quarantined ?? []) {
      quarantined.push(`${control.id}: ${message}`);
    }
    if (unit == null && judged == null) continue;
    const judgedStatus = judged?.status ?? 'missing';
    for (const failure of judged?.failures ?? []) {
      failures.push(`${control.id}: ${failure}`);
    }
    if (judgedStatus === 'missing') {
      failures.push(`${control.id}: the e2e report has no test of it`);
    }
    if (unit === 'pass' && judgedStatus !== 'pass') {
      evidence.push(
        `${control.id}: the uploaded results say it passed, and the e2e report does not`
      );
    }
    merged.push({
      id: control.id,
      status: unit === 'pass' && judgedStatus === 'pass' ? 'pass' : 'fail',
    });
  }
  const units = realInputUnitsFromResults({
    selected,
    controls: merged,
    auxiliary: results.auxiliary ?? [],
  });
  for (const [id, status] of Object.entries(units?.results ?? {})) {
    if (status !== 'pass')
      why.push(`${id} ${status === 'not-run' ? 'did not run' : 'failed'}`);
  }
  for (const [id, status] of Object.entries(units?.everyRun ?? {})) {
    if (status !== 'pass') why.push(`${id} failed`);
  }
  why.push(...evidence);
  return {
    passed: why.length === 0,
    units,
    why,
    evidence,
    quarantined,
    failures,
  };
}

/**
 * What one run folder of the artifact holds, already parsed.
 *
 * @typedef {object} UploadedRun
 * @property {any} record `run.json`
 * @property {any} results `units.json`, or `null`
 * @property {any} report `e2e/report.json`, or `null`
 */

/**
 * The ledger line a CI run becomes, judged the way a local run and its completion
 * are. A red full run that the job re-ran once is recorded as one completion line,
 * as `gate.mjs <gate> --rerun-failed` records one, provided the re-run selected
 * exactly what a completion of that red run would.
 *
 * @param {object} options
 * @param {{runId: number, attempt: number, jobId: number | null, url: string | null}} options.source
 * @param {string} options.head the commit, which is the run's
 * @param {string} options.branch
 * @param {{tree: string, trees: object, gateTrees: object, judge: string | null}} options.before
 *   this checkout's digests before the import
 * @param {{tree: string, gateTrees: object}} options.after and after it
 * @param {UploadedRun} options.full
 * @param {UploadedRun | null} options.rerun
 * @param {{followups: string | null, readTestFile: (file: string) => string | null}} options.sources
 * @param {ReadonlyArray<{id: string, title: string}>} [options.controls]
 * @returns {{line: object, notes: string[], full: object, rerun: object | null}}
 */
export function ciLedgerLine({
  source,
  head,
  branch,
  before,
  after,
  full,
  rerun = null,
  sources,
  controls = REAL_INPUT_CONTROLS,
}) {
  const notes = [];
  const fullVerdict = judgeUploadedRun({
    ...full,
    sha: head,
    sources,
    controls,
    whole: true,
  });
  const common = {
    gate: CI_GATE,
    tree: before.tree,
    trees: before.trees,
    gateTrees: before.gateTrees,
    treeAfter: after.tree,
    gateTreesAfter: after.gateTrees,
    head,
    branch,
    platform: 'android',
    lease: null,
    load: null,
    logPath: null,
    source,
  };
  const timesOf = (record) => {
    const started = Date.parse(String(record?.startedAt ?? ''));
    const finished = Date.parse(String(record?.finishedAt ?? ''));
    return {
      startedAt: Number.isFinite(started) ? started : Date.now(),
      durationMs:
        Number.isFinite(started) && Number.isFinite(finished)
          ? finished - started
          : 0,
    };
  };
  const exitOf = (record, result) => {
    const code = typeof record?.exitCode === 'number' ? record.exitCode : null;
    return result === 'fail' && (code === 0 || code == null) ? 1 : code;
  };
  const fullResult = fullVerdict.passed ? 'pass' : 'fail';
  const base = ledgerLineFromRun({
    ...common,
    command: resolveGate(CI_GATE).argv.join(' '),
    device: full.record?.device ?? null,
    ...timesOf(full.record),
    result: fullResult,
    exitCode: exitOf(full.record, fullResult),
    signal: full.record?.signal ?? null,
    units: fullVerdict.units,
    relaxed: recordedRelaxed(full.record),
    judge: before.judge,
  });
  if (rerun == null)
    return { line: base, notes, full: fullVerdict, rerun: null };
  if (fullVerdict.evidence.length > 0) {
    notes.push(
      `the full run's upload does not stand for a full run (${fullVerdict.evidence.join('; ')}), ` +
        'so nothing completes it. The re-run is not counted'
    );
    return { line: base, notes, full: fullVerdict, rerun: null };
  }

  const rerunArgs = Array.isArray(rerun.record?.args)
    ? rerun.record.args.map(String)
    : null;
  const plan = planRerunFailed({
    gate: CI_GATE,
    entries: [base],
    tree: before.tree,
    trees: before.trees,
    gateTrees: before.gateTrees,
  });
  if (plan.refusal != null) {
    notes.push(
      `the job re-ran ${rerunArgs?.join(' ') ?? 'something'}, and a completion of ` +
        `the full run would not have: ${plan.refusal}. The re-run is not counted`
    );
    return { line: base, notes, full: fullVerdict, rerun: null };
  }
  if (
    rerunArgs == null ||
    rerunArgs.join('\0') !== plan.filterArgs.join('\0')
  ) {
    notes.push(
      `the job re-ran ${rerunArgs?.join(' ') ?? '(no arguments recorded)'}, and a ` +
        `completion re-runs ${plan.filterArgs.join(' ')}. The re-run is not counted`
    );
    return { line: base, notes, full: fullVerdict, rerun: null };
  }
  const rerunVerdict = judgeUploadedRun({
    ...rerun,
    sha: head,
    sources,
    controls,
  });
  const digest = before.gateTrees?.[CI_GATE] ?? null;
  const verdict = completeRerun({
    plan,
    childUnits: rerunVerdict.units,
    exitCode:
      typeof rerun.record?.exitCode === 'number' ? rerun.record.exitCode : null,
    digestBefore: digest,
    digestAfter: after.gateTrees?.[CI_GATE] ?? null,
    gate: CI_GATE,
  });
  const why = [...verdict.why, ...rerunVerdict.evidence];
  const result = why.length === 0 ? 'pass' : 'fail';
  const rerunRelaxed = recordedRelaxed(rerun.record);
  const provenance =
    rerunRelaxed == null
      ? { relaxed: null, judge: null }
      : completionProvenance({
          base,
          relaxed: rerunRelaxed,
          judge: before.judge,
        });
  const line = ledgerLineFromRun({
    ...common,
    command: resolveGate(CI_GATE, plan.filterArgs).argv.join(' '),
    device: rerun.record?.device ?? null,
    ...timesOf(rerun.record),
    result,
    exitCode: exitOf(rerun.record, result),
    signal: rerun.record?.signal ?? null,
    units: verdict.units,
    completion: {
      of: plan.of,
      attempt: plan.attempt,
      rerun: plan.rerun,
      filtered: canonicalGateName(CI_GATE, plan.filterArgs),
      why,
    },
    ...provenance,
  });
  return { line, notes, full: fullVerdict, rerun: rerunVerdict };
}

/**
 * The digests a job stands in for, inside the job: it has one commit, so the commit
 * is every digest, and a completion's "the digest did not move" holds by construction.
 *
 * @param {string} sha
 */
export function commitAsDigests(sha) {
  return {
    tree: sha,
    trees: { ios: sha, android: sha },
    gateTrees: { [CI_GATE]: sha },
    judge: null,
  };
}

/**
 * The launch loop of a run, apart from the CLI so it can be driven without a device.
 */

import { launchPlanString, summarizeMissingReasons } from './lib.mjs';

function firstLine(error) {
  return (error instanceof Error ? error.message : String(error)).split(
    '\n'
  )[0];
}

function summarize(records) {
  const skipped = records.find((record) => record.kind === 'skip');
  if (skipped != null) {
    return `skipped (${skipped.reason})`;
  }
  const iterations = records.filter(
    (record) => record.kind === 'iter' && !record.warmup
  ).length;
  const notes = summarizeMissingReasons(records);
  return `${String(iterations)} iterations${notes === '' ? '' : `, ${notes}`}`;
}

/**
 * Never rejects: a failed launch is a problem and the next one still runs, while an app
 * that cannot be installed or stopped ends the loop, with `stopped` saying why beside
 * the records collected until then.
 */
export async function drive({
  targetFor,
  runLaunch,
  schedule,
  platform,
  sample = () => {},
  tagFor = () => '',
  write = (text) => process.stderr.write(text),
  settleMs = 300,
}) {
  const records = [];
  const problems = [];
  let stopped = null;
  for (let index = 0; index < schedule.length; index++) {
    const entry = schedule[index];
    const position = `${String(index + 1)}/${String(schedule.length)}`;
    sample();
    let target;
    try {
      target = await targetFor(entry);
    } catch (error) {
      stopped = `the ${entry.side ?? 'head'} app could not be installed for launch ${position}: ${firstLine(error)}`;
      break;
    }
    // Counted within the side: a comparison drives both sides' launches of one cell in
    // the same array, and the total would otherwise read as twice the plan.
    const launchesOfSide = schedule.filter(
      (other) =>
        other.scenario === entry.scenario &&
        other.implementation === entry.implementation &&
        other.n === entry.n &&
        (other.side ?? null) === (entry.side ?? null)
    ).length;
    const label = `${tagFor(entry)}${launchPlanString(entry)} launch ${String(entry.launch + 1)}/${String(launchesOfSide)}`;
    write(`[${position}] ${label} ... `);
    try {
      const result = await runLaunch(target, entry, platform);
      records.push(
        ...result.records.map((record) => ({
          ...record,
          launch: entry.launch,
          ...(entry.side == null ? {} : { side: entry.side }),
        }))
      );
      write(
        `${summarize(result.records)} (${String(Math.round(result.ms / 100) / 10)}s)\n`
      );
      if (result.error != null) {
        problems.push(`${label}: ${result.error}`);
        write(`  ! ${result.error}\n`);
      }
    } catch (error) {
      problems.push(`${label}: ${firstLine(error)}`);
      write(`failed: ${firstLine(error)}\n`);
    }
    try {
      await target.terminate();
    } catch (error) {
      stopped = `the app could not be stopped after launch ${position}: ${firstLine(error)}`;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, settleMs));
  }
  return { records, problems, stopped };
}

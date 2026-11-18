import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  STALL_LIMIT_MS,
  runXcodebuild,
} from '../real-input/ios-xcodebuild.mjs';

const STARTED =
  "Test Case '-[NitroUiExampleUITests.RealInputTests testRealInputSwitch]' started.";

/** Stand-ins for `xcodebuild`, each a node script that prints what a run would. */
const STAND_INS = {
  // A run whose test service never answers: nothing at all, for longer than any limit.
  silent: 'setTimeout(() => {}, 60_000);',
  // Busy, but no case ever starts.
  chatty: `
    const timer = setInterval(() => console.log('Testing started'), 50);
    setTimeout(() => clearInterval(timer), 60_000);`,
  // Its first case starts late, inside the limit, and the run outlives the limit.
  late: `
    setTimeout(() => console.log(${JSON.stringify(STARTED)}), 250);
    setTimeout(() => process.exit(0), 1_200);`,
  // The same, with the line split across two writes.
  split: `
    const line = ${JSON.stringify(STARTED)};
    setTimeout(() => process.stdout.write(line.slice(0, 20)), 150);
    setTimeout(() => process.stdout.write(line.slice(20) + '\\n'), 250);
    setTimeout(() => process.exit(0), 1_200);`,
  // A case that starts on stderr.
  stderr: `
    setTimeout(() => console.error(${JSON.stringify(STARTED)}), 250);
    setTimeout(() => process.exit(0), 1_200);`,
  // Quiet, then done: a build phase, which has no limit.
  quiet: 'setTimeout(() => process.exit(0), 600);',
};

let dir;
const logs = [];

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nitro-ui-xcodebuild-'));
  for (const [name, source] of Object.entries(STAND_INS)) {
    fs.writeFileSync(path.join(dir, `${name}.mjs`), source);
  }
  vi.spyOn(console, 'log').mockImplementation((line) => logs.push(line));
});

afterAll(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

function standIn(name, stall) {
  return runXcodebuild([path.join(dir, `${name}.mjs`)], {
    logFile: path.join(dir, `${name}.log`),
    what: `stand-in ${name}`,
    env: process.env,
    cwd: dir,
    command: process.execPath,
    stall,
  });
}

function watch(limitMs) {
  const stopped = [];
  return {
    stopped,
    stall: { limitMs, onStall: () => stopped.push(Date.now()) },
  };
}

describe('runXcodebuild', () => {
  it('waits five minutes for the first test case', () => {
    expect(STALL_LIMIT_MS).toBe(5 * 60 * 1000);
  });

  it('stops a run that prints nothing at the limit, runner first', async () => {
    const { stopped, stall } = watch(400);
    const started = Date.now();
    const result = await standIn('silent', stall);
    const took = Date.now() - started;
    expect(result.stalled).toBe(true);
    expect(result.status).not.toBe(0);
    expect(stopped).toHaveLength(1);
    expect(stopped[0] - started).toBeGreaterThanOrEqual(390);
    expect(took).toBeLessThan(10_000);
    expect(fs.readFileSync(path.join(dir, 'silent.log'), 'utf8')).toContain(
      'no test case started within 400 ms'
    );
  });

  it('stops a run that prints, but never starts a case', async () => {
    const { stopped, stall } = watch(400);
    const result = await standIn('chatty', stall);
    expect(result.stalled).toBe(true);
    expect(stopped).toHaveLength(1);
  });

  it('never stops a run whose first case started late, however long it runs after', async () => {
    for (const name of ['late', 'split', 'stderr']) {
      const { stopped, stall } = watch(500);
      const result = await standIn(name, stall);
      expect({ name, ...result }).toEqual({ name, status: 0, stalled: false });
      expect(stopped).toEqual([]);
    }
  });

  it('has no limit without a stall watch', async () => {
    const result = await standIn('quiet', null);
    expect(result).toEqual({ status: 0, stalled: false });
  });
});

/**
 * The machine-wide build slot: one heavy native build at a time, and a queue
 * that never wedges.
 *
 * X9's evidence for needing this is a 10-core machine at load 13 with two app
 * builds and `check` running together. The lease pool already refuses a third
 * *device* task, but a build needs no device, so nothing limited builds at all.
 *
 * The cases here are the ones that cost a machine its afternoon:
 *
 *   - the second build waits and the first proceeds (the whole point), both in
 *     one process and across two real ones;
 *   - a holder whose process died is reclaimed **now**, not after a 45-minute ttl;
 *   - a stamp-fresh skip takes no slot, so a queue is never blocked by a build
 *     that had nothing to compile;
 *   - the same task may hold two slots (`doctor --prime` builds both platforms);
 *   - a slot from another host is never stolen by pid, because pids only mean
 *     something on the machine that wrote them.
 *
 * Everything the decision reads is injected: the clock, the poll, `isAlive`. A
 * test cannot kill a real compiler to prove the reclaim works, and it must not
 * have to wait 5 s to prove the queue drains. The real-filesystem cases use a
 * throwaway `NITRO_UI_HOME` / temp dir, so the machine's own `builds.json` is
 * never in these fixtures.
 *
 * Fixtures do not coincide with the right answer: the holder's task is `G7` and
 * the waiter's is `X9`, and a reclaim that read the wrong field would leave `G7`
 * in the file rather than silently matching what the test hopes for.
 */

import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BUILD_SLOT_TTL_MINUTES,
  DEFAULT_BUILD_WAIT_MINUTES,
  DEFAULT_MAX_CONCURRENT_BUILDS,
  buildLimitFrom,
  buildOwnerFor,
  buildSlotPaths,
  currentBuildSlots,
  decideBuildSlot,
  formatSlotHolder,
  maxConcurrentBuildsFrom,
  pruneBuildSlots,
  processPidIsAlive,
  releaseBuildSlot,
  slotHolderIsDead,
  takeBuildSlot,
} from '../build-slot-core.mjs';

const REPO_ROOT = join(__dirname, '..', '..');
const BUILD_APP = join(REPO_ROOT, 'scripts', 'build-app.mjs');
const CORE = join(REPO_ROOT, 'scripts', 'build-slot-core.mjs');

/** A clock the test moves, and a poll log so "did it wait" is observable. */
function fakeClock(start = 1_000_000) {
  let value = start;
  const polls = [];
  return {
    now: () => value,
    advance: (ms) => {
      value += ms;
    },
    sleep: (ms) => {
      polls.push(ms);
      value += ms;
    },
    polls,
  };
}

const HOST = 'maintainer-mac-1';

/** A slot as `builds.json` would hold it. */
function slot(overrides = {}) {
  const base = {
    id: 'G7-abcd1234',
    task: 'G7',
    platform: 'ios',
    pid: 41_123,
    host: HOST,
    acquiredAt: 1_000_000,
    ttlMinutes: BUILD_SLOT_TTL_MINUTES,
    ...overrides,
  };
  return { owner: buildOwnerFor(base.task, base.pid), ...base };
}

const ALIVE = () => true;
const DEAD = () => false;

let home;
let paths;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'nitro-ui-slots-'));
  paths = buildSlotPaths(home);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('the limit', () => {
  it('is one build at a time unless the machine says otherwise', () => {
    expect(DEFAULT_MAX_CONCURRENT_BUILDS).toBe(1);
    expect(maxConcurrentBuildsFrom({ pairs: [] })).toBe(1);
    expect(maxConcurrentBuildsFrom(null)).toBe(1);
    expect(maxConcurrentBuildsFrom({ maxConcurrentBuilds: 2 })).toBe(2);
    // A value that is not a positive integer is not "unlimited", it is a typo.
    expect(maxConcurrentBuildsFrom({ maxConcurrentBuilds: 0 })).toBe(1);
    expect(maxConcurrentBuildsFrom({ maxConcurrentBuilds: -3 })).toBe(1);
    expect(maxConcurrentBuildsFrom({ maxConcurrentBuilds: 1.5 })).toBe(1);
    expect(maxConcurrentBuildsFrom({ maxConcurrentBuilds: '2' })).toBe(1);
  });

  it('refuses the build that would exceed it, and names the holders', () => {
    const held = [slot()];
    const verdict = decideBuildSlot({
      active: held,
      max: 1,
      owner: 'X9/42000',
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/maxConcurrentBuilds = 1/);
    expect(verdict.waiting.map((entry) => entry.task)).toEqual(['G7']);

    expect(
      decideBuildSlot({ active: held, max: 2, owner: 'X9/42000' }).ok
    ).toBe(true);
  });

  it('names a typo in the pool file, and stays quiet about an absent key', () => {
    // This line prints on every single build, so the two cases have to be told
    // apart: `maxConcurrentBuilds: 0` is somebody's typo and deserves a sentence,
    // while a file that simply has no key is the documented default and would make
    // the warning permanent background noise on every machine in the pool.
    const file = '/home/me/.nitro-ui/devices.json';
    expect(buildLimitFrom({ pairs: [] }, file)).toEqual({
      max: 1,
      note: null,
    });
    expect(buildLimitFrom({ maxConcurrentBuilds: 3 }, file)).toEqual({
      max: 3,
      note: null,
    });
    for (const value of [0, -3, 1.5, '2', null]) {
      const limit = buildLimitFrom({ maxConcurrentBuilds: value }, file);
      expect(limit.max).toBe(1);
      expect(limit.note).toContain('maxConcurrentBuilds to');
      expect(limit.note).toContain(JSON.stringify(value));
      expect(limit.note).toContain(file);
    }
    // `null` is a *value* here (the key is present), so it gets the message too -
    // JSON.stringify renders it as `null`, which is what the reader needs to see.
    expect(buildLimitFrom(null, file)).toEqual({ max: 1, note: null });
  });

  it('lets one process hold two slots so --prime cannot deadlock itself', () => {
    // A primer takes the iOS slot and then asks for Android's, in one process. A
    // rule that read "a slot is held" as "not mine" would have it wait for itself.
    const mine = [
      slot({
        task: 'doctor-prime',
        pid: 7,
        owner: 'doctor-prime/7',
        platform: 'ios',
      }),
    ];
    expect(
      decideBuildSlot({ active: mine, max: 1, owner: 'doctor-prime/7' }).ok
    ).toBe(true);
    expect(decideBuildSlot({ active: mine, max: 1, owner: 'G8/9' }).ok).toBe(
      false
    );
  });

  it('does not let two processes share a slot because they share a task name', () => {
    // The hole the owner field exists for: a leased task can run two builds in two
    // processes, and matching on `task` alone would let the second straight in.
    const held = [slot({ task: 'G7', pid: 41_123, owner: 'G7/41123' })];
    expect(
      decideBuildSlot({
        active: held,
        max: 1,
        owner: buildOwnerFor('G7', 42_000),
      }).ok
    ).toBe(false);
    expect(buildOwnerFor('G7', 41_123)).toBe(buildOwnerFor('G7', 41_123));
    expect(buildOwnerFor('G7', 41_123)).not.toBe(buildOwnerFor('G7', 42_000));
  });
});

describe('staleness', () => {
  it('reclaims a slot whose process is gone', () => {
    expect(
      slotHolderIsDead(slot({ pid: 41_123 }), { isAlive: DEAD, host: HOST })
    ).toBe(true);
    expect(
      slotHolderIsDead(slot({ pid: 41_123 }), { isAlive: ALIVE, host: HOST })
    ).toBe(false);
  });

  it('never reclaims a slot written by another host', () => {
    // Two machines sharing one state dir: pid 41123 on the other host is not
    // "my" pid 41123, and stealing its slot would put two builds on one machine.
    const foreign = slot({ host: 'maintainer-mac-9' });
    expect(slotHolderIsDead(foreign, { isAlive: DEAD, host: HOST })).toBe(
      false
    );
    expect(
      pruneBuildSlots(
        { builds: [foreign] },
        {
          now: 1_000_000 + 60_000,
          isAlive: DEAD,
          host: HOST,
        }
      ).builds
    ).toHaveLength(1);
  });

  it("expires a slot by its own ttl, not the asker's", () => {
    const fresh = slot();
    expect(
      pruneBuildSlots(
        { builds: [fresh] },
        {
          now: 1_000_000 + (BUILD_SLOT_TTL_MINUTES - 1) * 60_000,
          isAlive: ALIVE,
          host: HOST,
        }
      ).builds
    ).toHaveLength(1);
    expect(
      pruneBuildSlots(
        { builds: [fresh] },
        {
          now: 1_000_000 + (BUILD_SLOT_TTL_MINUTES + 1) * 60_000,
          isAlive: ALIVE,
          host: HOST,
        }
      ).builds
    ).toHaveLength(0);
    // A slot that carries no ttl still expires by the default, never forever.
    expect(
      pruneBuildSlots(
        { builds: [{ ...slot(), ttlMinutes: undefined }] },
        {
          now: 1_000_000 + (BUILD_SLOT_TTL_MINUTES + 1) * 60_000,
          isAlive: ALIVE,
          host: HOST,
        }
      ).builds
    ).toHaveLength(0);
  });

  it('names a holder in one readable line', () => {
    const line = formatSlotHolder(
      slot({ acquiredAt: 1_000_000 }),
      1_000_000 + 5 * 60_000
    );
    expect(line).toContain('G7');
    expect(line).toContain('ios');
    expect(line).toContain('pid 41123');
    expect(line).toContain('5m in');
    expect(line.split('\n')).toHaveLength(1);
  });
});

describe('takeBuildSlot against a real filesystem', () => {
  it('queues the second build behind the first', () => {
    const clock = fakeClock();
    const logs = [];
    const common = {
      buildsFile: paths.builds,
      lockFile: paths.lock,
      max: 1,
      host: HOST,
      now: clock.now,
      sleep: clock.sleep,
      isAlive: ALIVE,
      log: (m) => logs.push(m),
    };

    const first = takeBuildSlot({
      ...common,
      task: 'G7',
      platform: 'ios',
      pid: 41_123,
    });
    expect(first.slot.task).toBe('G7');
    expect(clock.polls).toHaveLength(0);

    const second = takeBuildSlot({
      ...common,
      task: 'X9',
      platform: 'android',
      pid: 42_000,
    });
    // It waited: at least one poll, and one line naming the holder.
    expect(clock.polls.length).toBeGreaterThan(0);
    const waits = logs.filter((line) => /waiting for a build slot/.test(line));
    expect(waits).toHaveLength(1);
    expect(waits[0]).toContain('G7');
    expect(second.waitedMs).toBeGreaterThan(0);

    const live = () =>
      currentBuildSlots({
        buildsFile: paths.builds,
        now: clock.now,
        isAlive: ALIVE,
        host: HOST,
      });
    first.release();
    expect(live().map((entry) => entry.task)).toEqual(['X9']);
    second.release();
    expect(live()).toHaveLength(0);
  });

  it('takes over a slot whose holder died', () => {
    const clock = fakeClock();
    // G7 is in the file and its pid is gone; X9 must not wait for the ttl.
    writeFileSync(
      paths.builds,
      `${JSON.stringify({ builds: [slot()] }, null, 2)}\n`
    );
    const logs = [];
    const taken = takeBuildSlot({
      buildsFile: paths.builds,
      lockFile: paths.lock,
      max: 1,
      host: HOST,
      task: 'X9',
      platform: 'ios',
      pid: 42_000,
      now: clock.now,
      sleep: clock.sleep,
      isAlive: DEAD,
      log: (m) => logs.push(m),
    });
    expect(taken.slot.task).toBe('X9');
    expect(clock.polls).toHaveLength(0);
    expect(
      logs.filter((line) => /waiting for a build slot/.test(line))
    ).toHaveLength(0);
    // The corpse is gone from the file, replaced by the live holder.
    expect(
      JSON.parse(readFileSync(paths.builds, 'utf8')).builds.map((e) => e.task)
    ).toEqual(['X9']);
  });

  it('gives up after its own wait budget rather than forever', () => {
    const clock = fakeClock();
    writeFileSync(
      paths.builds,
      `${JSON.stringify({ builds: [slot()] }, null, 2)}\n`
    );
    expect(DEFAULT_BUILD_WAIT_MINUTES).toBe(60);
    expect(() =>
      takeBuildSlot({
        buildsFile: paths.builds,
        lockFile: paths.lock,
        max: 1,
        host: HOST,
        task: 'X9',
        platform: 'ios',
        pid: 42_000,
        now: clock.now,
        sleep: clock.sleep,
        isAlive: ALIVE,
        waitMinutes: 2,
        pollMs: 30_000,
      })
    ).toThrow(/no build slot free within 2 minutes/);
  });

  it('runs two builds at once when the machine asks for two', () => {
    const clock = fakeClock();
    const common = {
      buildsFile: paths.builds,
      lockFile: paths.lock,
      max: 2,
      host: HOST,
      now: clock.now,
      sleep: clock.sleep,
      isAlive: ALIVE,
    };
    const ios = takeBuildSlot({
      ...common,
      task: 'G7',
      platform: 'ios',
      pid: 41_123,
    });
    const android = takeBuildSlot({
      ...common,
      task: 'X9',
      platform: 'android',
      pid: 42_000,
    });
    expect(clock.polls).toHaveLength(0);
    expect(
      currentBuildSlots({
        buildsFile: paths.builds,
        now: clock.now,
        isAlive: ALIVE,
        host: HOST,
      })
    ).toHaveLength(2);
    ios.release();
    android.release();
  });

  it('releases only the slot it took, not the other one its task name shares', () => {
    const clock = fakeClock();
    const common = {
      buildsFile: paths.builds,
      lockFile: paths.lock,
      max: 3,
      host: HOST,
      now: clock.now,
      sleep: clock.sleep,
      isAlive: ALIVE,
    };
    // Same task, two processes: `--prime` in one, a hand-run build in another.
    const ios = takeBuildSlot({
      ...common,
      task: 'G7',
      platform: 'ios',
      pid: 7,
    });
    const other = takeBuildSlot({
      ...common,
      task: 'G7',
      platform: 'android',
      pid: 8,
    });
    const live = () =>
      currentBuildSlots({
        buildsFile: paths.builds,
        now: clock.now,
        isAlive: ALIVE,
        host: HOST,
      });
    expect(live()).toHaveLength(2);

    const released = releaseBuildSlot({
      buildsFile: paths.builds,
      lockFile: paths.lock,
      slotId: ios.slot.id,
      now: clock.now,
      isAlive: ALIVE,
      host: HOST,
    });
    expect(released).toHaveLength(1);
    // The other process is still compiling, and still holds its slot.
    expect(live().map((entry) => entry.platform)).toEqual(['android']);

    releaseBuildSlot({
      buildsFile: paths.builds,
      lockFile: paths.lock,
      slotId: other.slot.id,
      now: clock.now,
      isAlive: ALIVE,
      host: HOST,
    });
    expect(live()).toHaveLength(0);
  });

  it('releasing a slot that is already gone is not an error', () => {
    const clock = fakeClock();
    expect(
      releaseBuildSlot({
        buildsFile: paths.builds,
        lockFile: paths.lock,
        slotId: 'G7-nope',
        now: clock.now,
        isAlive: ALIVE,
        host: HOST,
      })
    ).toHaveLength(0);
  });
});

describe('the CLI that uses it', () => {
  /**
   * A stamp-fresh skip must take no slot: it compiles nothing, and a queue of
   * tasks blocked behind a machine that is idle would be worse than no rule.
   *
   * A source-order guard rather than a run: proving it by running would need
   * either a real multi-minute build inside `check` or a test hook invented for
   * the purpose. The guard says what it checks and goes red the moment somebody
   * moves the slot acquisition above the skip block. The live behaviour is
   * proved separately on a real tree (X9 report).
   */
  it('decides the stamp-fresh skip before taking a slot', () => {
    const source = readFileSync(BUILD_APP, 'utf8');
    const skip = source.indexOf('if (skip.skip) {');
    const take = source.indexOf('takeBuildSlot({');
    expect(skip).toBeGreaterThan(-1);
    expect(take).toBeGreaterThan(-1);
    expect(skip).toBeLessThan(take);
    // And the skip really returns, so control cannot reach the slot from there.
    expect(source.slice(skip, take)).toContain('return 0;');
  });

  /**
   * Two real processes, one slot. The lock and the wait have to work across
   * processes: the single-process cases above could pass with a bug that only
   * showed when a second interpreter touched the file, which is the whole reason
   * `withLock` exists. Real timings - no fake clock.
   *
   * `startMs` is the second child's own delay before it asks, so the ordering is
   * deterministic without the parent having to poll: the holder is definitely
   * inside its 3 s hold when the waiter arrives ~600 ms in.
   */
  it('serialises two separate build processes', async () => {
    const child = ({ task, holdMs, startMs }) =>
      spawn(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
            import { takeBuildSlot } from ${JSON.stringify(CORE)};
            const [buildsFile, lockFile, task, hold, start] = process.argv.slice(1);
            if (Number(start) > 0) {
              Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(start));
            }
            const held = takeBuildSlot({
              task,
              platform: 'ios',
              buildsFile,
              lockFile,
              max: 1,
              host: 'test-host',
              pid: Number(process.pid),
              pollMs: 100,
              log: (m) => process.stderr.write(m + '\\n'),
            });
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(hold));
            held.release();
            process.stdout.write(JSON.stringify({
              task, id: held.slot.id, waitedMs: held.waitedMs,
            }));
          `,
          paths.builds,
          paths.lock,
          task,
          String(holdMs),
          String(startMs),
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );

    const collect = (proc) =>
      new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (chunk) => {
          stdout += String(chunk);
        });
        proc.stderr.on('data', (chunk) => {
          stderr += String(chunk);
        });
        proc.on('close', (code) => resolve({ code, stdout, stderr }));
      });

    const [first, second] = await Promise.all([
      collect(child({ task: 'G7', holdMs: 3_000, startMs: 0 })),
      collect(child({ task: 'X9', holdMs: 0, startMs: 600 })),
    ]);
    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    const a = JSON.parse(first.stdout);
    const b = JSON.parse(second.stdout);
    expect(a.waitedMs).toBeLessThan(1_000);
    expect(b.task).toBe('X9');
    expect(b.waitedMs).toBeGreaterThanOrEqual(1_000);
    expect(b.id).not.toBe(a.id);
    expect(second.stderr).toMatch(/waiting for a build slot/);
    // One line, not one per poll: the waiter must not become the noise.
    expect(
      second.stderr
        .split('\n')
        .filter((line) => /waiting for a build slot/.test(line))
    ).toHaveLength(1);
    // Both slots are gone: a released build leaves nothing for the next task.
    expect(
      currentBuildSlots({
        buildsFile: paths.builds,
        now: Date.now(),
        isAlive: () => false,
        host: 'test-host',
      })
    ).toHaveLength(0);
  }, 120_000);

  it('names the state file in the waiting message so a wedged build is fixable', () => {
    const clock = fakeClock();
    writeFileSync(
      paths.builds,
      `${JSON.stringify({ builds: [slot()] }, null, 2)}\n`
    );
    const logs = [];
    expect(() =>
      takeBuildSlot({
        buildsFile: paths.builds,
        lockFile: paths.lock,
        max: 1,
        host: HOST,
        task: 'X9',
        platform: 'ios',
        pid: 42_000,
        now: clock.now,
        sleep: clock.sleep,
        isAlive: ALIVE,
        waitMinutes: 1,
        pollMs: 20_000,
        log: (m) => logs.push(m),
      })
    ).toThrow(new RegExp(paths.builds.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    expect(logs.join('\n')).toContain(paths.builds);
  });
});

describe('processPidIsAlive', () => {
  it('says yes for itself and no for a pid that cannot exist', () => {
    expect(processPidIsAlive(process.pid)).toBe(true);
    // 0x7FFFFFFE is past the pid_max on every platform this repo runs on.
    expect(processPidIsAlive(0x7ffffffe)).toBe(false);
  });
});

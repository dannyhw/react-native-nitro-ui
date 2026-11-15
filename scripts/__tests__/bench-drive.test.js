/**
 * The launch loop of a bench run, with the device replaced by a fake. The records of
 * an hours-long run are written only once the loop returns, so what it does when an
 * install fails half-way decides whether they are kept.
 */

import { describe, expect, it } from '@jest/globals';

import { drive } from '../bench/drive.mjs';

const SCHEDULE = [
  {
    scenario: 'mount',
    implementation: 'rn-core',
    n: 50,
    launch: 0,
    side: 'base',
  },
  {
    scenario: 'mount',
    implementation: 'nitro-ui',
    n: 50,
    launch: 0,
    side: 'base',
  },
  {
    scenario: 'mount',
    implementation: 'nitro-ui',
    n: 50,
    launch: 0,
    side: 'head',
  },
  {
    scenario: 'mount',
    implementation: 'rn-core',
    n: 50,
    launch: 0,
    side: 'head',
  },
];

function session({
  failInstallOf = null,
  failLaunchOf = null,
  failStopOf = null,
}) {
  const log = [];
  const installed = { current: null };
  const target = (side) => ({
    async terminate() {
      if (failStopOf === side) throw new Error('device offline');
    },
  });
  return {
    log,
    options: {
      schedule: SCHEDULE,
      platform: 'ios',
      settleMs: 0,
      write: (text) => log.push(text),
      tagFor: (entry) => `${entry.side} `,
      async targetFor(entry) {
        if (installed.current !== entry.side) {
          if (failInstallOf === entry.side) {
            throw new Error('install failed: no space left\n    at simctl');
          }
          installed.current = entry.side;
        }
        return target(entry.side);
      },
      async runLaunch(_target, entry) {
        if (failLaunchOf === entry.implementation) {
          throw new Error('launch refused');
        }
        return {
          ms: 1_200,
          records: [
            {
              kind: 'iter',
              warmup: false,
              scenario: entry.scenario,
              implementation: entry.implementation,
              n: entry.n,
              mountedNs: 100_000,
            },
          ],
        };
      },
    },
  };
}

describe('the bench launch loop', () => {
  it('drives every launch and stamps each record with its launch and side', async () => {
    const run = session({});
    const out = await drive(run.options);
    expect(out.stopped).toBeNull();
    expect(out.problems).toEqual([]);
    expect(
      out.records.map((r) => `${r.side}:${r.implementation}:${r.launch}`)
    ).toEqual([
      'base:rn-core:0',
      'base:nitro-ui:0',
      'head:nitro-ui:0',
      'head:rn-core:0',
    ]);
  });

  it('keeps what it measured when the second app cannot be installed', async () => {
    const run = session({ failInstallOf: 'head' });
    // Resolves: a rejection here is what used to lose the base side's two launches.
    const out = await drive(run.options);
    expect(out.records.map((r) => `${r.side}:${r.implementation}`)).toEqual([
      'base:rn-core',
      'base:nitro-ui',
    ]);
    expect(out.stopped).toBe(
      'the head app could not be installed for launch 3/4: install failed: no space left'
    );
    // The loop ended there: the fourth launch was never announced.
    expect(run.log.join('')).not.toContain('[4/4]');
  });

  it('records a launch that throws and carries on with the next one', async () => {
    const run = session({ failLaunchOf: 'nitro-ui' });
    const out = await drive(run.options);
    expect(out.stopped).toBeNull();
    expect(out.problems).toEqual([
      'base mount:nitro-ui:50 launch 1/1: launch refused',
      'head mount:nitro-ui:50 launch 1/1: launch refused',
    ]);
    expect(out.records).toHaveLength(2);
  });

  it('stops, with its records, when the app cannot be stopped', async () => {
    const run = session({ failStopOf: 'head' });
    const out = await drive(run.options);
    expect(out.records).toHaveLength(3);
    expect(out.stopped).toBe(
      'the app could not be stopped after launch 3/4: device offline'
    );
  });
});

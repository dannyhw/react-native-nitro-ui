/* global Atomics, SharedArrayBuffer */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { LOG_STORE_BASENAME, metroPortForGate } from '../gate-core.mjs';
import { leaseRecord, writeLeaseStore } from './helpers/lease-store.js';
import { withoutLeaseEnv } from './helpers/scrubbed-env.js';
import {
  decideAcquire,
  lsofListenArgs,
  metroPreflightFromEnv,
  metroPortReason,
  metroPortsOf,
  normalizeDevices,
  renderEnvFile,
  pidIsAlive,
  parseLsofListeners,
  portListeners,
} from '../lease-core.mjs';

const REPO_ROOT = join(__dirname, '..', '..');
const LEASE_CLI = join(REPO_ROOT, 'scripts', 'lease.mjs');
const GATE_CLI = join(REPO_ROOT, 'scripts', 'gate.mjs');
const EXAMPLE_CONFIG = join(REPO_ROOT, 'scripts', 'devices.example.json');

/** The pairs and Metro ports `devices.example.json` declares. */
const PAIR_A = 'pair-a';
const PORT_A = 8295;
const PAIR_B = 'pair-b';
const PORT_B = 8296;

/* ------------------------- the pure half, injected -------------------------- */

describe('parseLsofListeners', () => {
  it('reads the -Fpc shape: one entry per pid, in file order', () => {
    expect(parseLsofListeners(`p4242\ncnode\nf12\np99\ncPython\n`)).toEqual([
      { pid: 4242, command: 'node' },
      { pid: 99, command: 'Python' },
    ]);
  });

  it('answers nothing for the empty output lsof gives an unused port', () => {
    expect(parseLsofListeners('')).toEqual([]);
    expect(parseLsofListeners(null)).toEqual([]);
    expect(parseLsofListeners('lsof: cannot open /dev/mem\n')).toEqual([]);
  });

  it('keeps a pid whose command line never arrives, rather than dropping it', () => {
    // Output can end after the pid when the process exits between the scan and the read.
    expect(parseLsofListeners('p7\n')).toEqual([{ pid: 7, command: '' }]);
  });
});

describe('portListeners', () => {
  const run =
    (text, ok = true) =>
    () => ({ ok, text });

  it('asks the one question both callers need, in lsof -Fpc spelling', () => {
    expect(lsofListenArgs(8295)).toEqual([
      '-nP',
      '-iTCP:8295',
      '-sTCP:LISTEN',
      '-Fpc',
    ]);
  });

  it('reports the listener, naming the pid and the program', () => {
    expect(portListeners({ port: PORT_A, run: run(`p4242\ncnode\n`) })).toEqual(
      {
        port: PORT_A,
        checked: true,
        error: null,
        listeners: [{ pid: 4242, command: 'node' }],
      }
    );
  });

  it("treats lsof's exit-1-with-no-output as 'nothing is listening'", () => {
    // `lsof` exits 1 and prints nothing for a free port.
    expect(portListeners({ port: PORT_A, run: run('', false) })).toEqual({
      port: PORT_A,
      checked: true,
      error: null,
      listeners: [],
    });
  });

  it('says it could not check, rather than calling the port free', () => {
    const missing = portListeners({ port: PORT_A, run: () => null });
    expect(missing.checked).toBe(false);
    expect(missing.listeners).toEqual([]);
    expect(missing.error).toMatch(/gave no answer/);

    const broken = portListeners({
      port: PORT_A,
      run: run('lsof: command not found', false),
    });
    expect(broken.checked).toBe(false);
    expect(broken.error).toMatch(/command not found/);
  });

  it('refuses a port that is not a port, and says which', () => {
    expect(portListeners({ port: 0, run: run('') }).error).toMatch(
      /not a port number/
    );
  });
});

describe('metroPortReason', () => {
  it('names the port, the pair and the process', () => {
    const reason = metroPortReason({ id: PAIR_A, metroPort: PORT_A }, [
      { pid: 4242, command: 'node' },
    ]);
    expect(reason).toContain(`Metro port ${PORT_A}`);
    expect(reason).toContain(PAIR_A);
    expect(reason).toContain('pid 4242 (node)');
    expect(reason).toContain('app bridge was replaced');
  });

  it('says nothing when nothing is listening', () => {
    expect(metroPortReason({ id: PAIR_A, metroPort: PORT_A }, [])).toBeNull();
  });
});

describe('one Metro port per platform', () => {
  const example = JSON.parse(readFileSync(EXAMPLE_CONFIG, 'utf8'));

  it('gives Android a port of its own, 1000 above metroPort unless devices.json names one', () => {
    const [a] = normalizeDevices(example).pairs;
    expect(metroPortsOf(a)).toEqual({ ios: PORT_A, android: PORT_A + 1000 });
    const named = { ...example.pairs[0], androidMetroPort: 8399 };
    expect(metroPortsOf(normalizeDevices({ pairs: [named] }).pairs[0])).toEqual(
      {
        ios: PORT_A,
        android: 8399,
      }
    );
  });

  it('refuses a devices.json where two Metro ports collide', () => {
    const clash = {
      ...example,
      pairs: [
        { ...example.pairs[0], androidMetroPort: PORT_B },
        example.pairs[1],
      ],
    };
    expect(() => normalizeDevices(clash)).toThrow(
      `pair pair-b ios Metro port ${PORT_B} is also the pair pair-a android Metro port`
    );
  });

  it('exports the port of each platform the lease covers', () => {
    const [pair] = normalizeDevices(example).pairs;
    const lease = { id: 'L', task: 'T', platform: 'both' };
    const both = renderEnvFile(lease, pair, 'both');
    expect(both).toContain(`export METRO_PORT='${PORT_A}'`);
    expect(both).toContain(`export METRO_PORT_IOS='${PORT_A}'`);
    expect(both).toContain(`export METRO_PORT_ANDROID='${PORT_A + 1000}'`);
    expect(renderEnvFile(lease, pair, 'ios')).not.toContain(
      'METRO_PORT_ANDROID'
    );
    expect(renderEnvFile(lease, pair, 'android')).not.toContain(
      'METRO_PORT_IOS'
    );
  });

  it("a gate runs on its own platform's port, and on METRO_PORT without one", () => {
    const env = {
      METRO_PORT: '8295',
      METRO_PORT_IOS: '8295',
      METRO_PORT_ANDROID: '9295',
    };
    expect(metroPortForGate('android', env)).toBe('9295');
    expect(metroPortForGate('ios', env)).toBe('8295');
    expect(metroPortForGate('android', { METRO_PORT: '8295' })).toBe('8295');
    expect(metroPortForGate(null, env)).toBe('8295');
  });
});

describe('decideAcquire with a busy Metro port', () => {
  const pairs = normalizeDevices(
    JSON.parse(readFileSync(EXAMPLE_CONFIG, 'utf8'))
  ).pairs;
  const heldLease = {
    id: 'X15-1',
    task: 'X15',
    platform: 'both',
    holds: [PAIR_A],
    acquiredAt: Date.now(),
    ttlMinutes: 240,
  };
  const blocked = (id) => ({
    id,
    reason: `Metro port (${id}) is served by pid 1 (node)`,
  });
  const ask = (over = {}) =>
    decideAcquire({
      active: [],
      pairs,
      maxDeviceLeases: 2,
      exclusive: false,
      platform: 'both',
      task: 'X4',
      ...over,
    });

  it("takes the quiet pair when a free pair's port is served", () => {
    const decision = ask({ portBlocked: [blocked(PAIR_A)] });
    expect(decision.ok).toBe(true);
    expect(decision.pair.id).toBe(PAIR_B);
  });

  it('waits on the port instead of claiming every pair is leased', () => {
    const decision = ask({ portBlocked: [blocked(PAIR_A), blocked(PAIR_B)] });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toContain('Metro port');
    expect(decision.reason).not.toMatch(/already leased/);
  });

  it('does not report a port it was not told about', () => {
    expect(ask().ok).toBe(true);
    expect(ask().pair.id).toBe(PAIR_A);
  });

  it('lets an exclusive acquire proceed over a busy Metro port, and says so', () => {
    // An exclusive lease is for a bench, whose JS is built into the Release binary, so
    // it never serves or joins a Metro.
    const decision = ask({ exclusive: true, portBlocked: [blocked(PAIR_B)] });
    expect(decision.ok).toBe(true);
    expect(decision.note).toContain(
      'exclusive lease does not wait on Metro ports'
    );
    expect(decision.note).toContain(`Metro port (${PAIR_B})`);
  });

  it('still holds a non-exclusive lease back from a busy port when it is the only pair', () => {
    const decision = ask({
      exclusive: false,
      portBlocked: [blocked(PAIR_A), blocked(PAIR_B)],
    });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toMatch(/Metro port/);
  });

  it("still lets a task's own lease hold its pair over its own Metro", () => {
    // Re-running `acquire` mid-suite regenerates the env file, and the server on the
    // port is then that task's own run.
    const decision = ask({
      task: 'X15',
      active: [heldLease],
      portBlocked: [blocked(PAIR_A)],
    });
    expect(decision.ok).toBe(true);
    expect(decision.pair.id).toBe(PAIR_A);
  });
});

describe("metroPreflightFromEnv (the gate's pre-flight)", () => {
  const run =
    (text, ok = true) =>
    () => ({ ok, text });

  it('is nothing to check when no lease exported a port', () => {
    // No METRO_PORT means no lease handed a port out. `listeners` is still present,
    // because callers read it without checking.
    expect(metroPreflightFromEnv({}, run(''))).toEqual({
      checked: false,
      port: null,
      reason: null,
      warning: null,
      listeners: [],
    });
  });

  it('refuses a port another process serves, naming it', () => {
    const answer = metroPreflightFromEnv(
      { METRO_PORT: String(PORT_A) },
      run(`p4242\ncnode\n`)
    );
    expect(answer.checked).toBe(true);
    expect(answer.reason).toContain(`Metro port ${PORT_A}`);
    expect(answer.reason).toContain('pid 4242 (node)');
    expect(answer.listeners).toEqual([{ pid: 4242, command: 'node' }]);
  });

  it('passes a port nobody is listening on', () => {
    expect(
      metroPreflightFromEnv({ METRO_PORT: String(PORT_A) }, run('', false))
    ).toEqual({
      checked: true,
      port: PORT_A,
      reason: null,
      warning: null,
      listeners: [],
    });
  });

  it('warns instead of refusing when the machine cannot answer', () => {
    const answer = metroPreflightFromEnv(
      { METRO_PORT: String(PORT_A) },
      () => null
    );
    expect(answer.reason).toBeNull();
    expect(answer.warning).toMatch(/could not check Metro port 8295/);
  });

  it('refuses a METRO_PORT that is not a number', () => {
    expect(
      metroPreflightFromEnv({ METRO_PORT: '829a' }, run('')).reason
    ).toMatch(/not a port number/);
  });
});

/* --------------------- the incident's shape, end to end --------------------- */

/**
 * Whether this Node is one the gates support. On another runtime `gate.mjs` re-execs
 * itself under a real node, past the fixture's fake runner, so the CLI cases are skipped.
 */
const runtime = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'x15-node-'));
  const probeFile = join(dir, 'probe.mjs');
  writeFileSync(
    probeFile,
    'import { isSupportedNodeVersion } from ' +
      JSON.stringify(join(REPO_ROOT, 'scripts', 'node-version.mjs')) +
      ';\n' +
      'process.stdout.write(JSON.stringify({' +
      'supported: isSupportedNodeVersion(process.versions.node),' +
      'version: process.versions.node' +
      '}));\n'
  );
  const probe = spawnSync(process.execPath, [probeFile], { encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
  try {
    return JSON.parse(String(probe.stdout));
  } catch {
    return { supported: true, version: process.versions.node };
  }
})();

const describeCli = runtime.supported ? describe : describe.skip;

if (!runtime.supported) {
  describe('gate.mjs cannot be tested on this runtime', () => {
    it(`SKIPPED: the CLI fixtures need the Node the gates run on, and this is ${runtime.version}, where gate.mjs re-execs past the fake runner`, () => {
      expect(runtime.supported).toBe(false);
    });
  });
}

describeCli('a stale Metro server on a leased pair', () => {
  let home;
  let bins;
  let config;
  let busyFile;
  let checkouts;

  /**
   * `lsof` as a stub: it replays whatever `ports.txt` says is listening, in `-Fpc` shape,
   * and answers a free port the way lsof does (exit 1, nothing printed). A pid written
   * `@/path/to/pid` is read from that file, so a port reads as free until the process
   * that will serve it has written its pid.
   */
  const writeLsofStub = () => {
    writeFileSync(
      join(bins, 'lsof'),
      [
        '#!/bin/sh',
        'port=""',
        'for a in "$@"; do case "$a" in -iTCP:*) port="${a#-iTCP:}" ;; esac; done',
        'port="${port%-*}"',
        'if [ -f "$NITRO_UI_FAKE_BUSY" ]; then',
        '  line=$(grep "^${port} " "$NITRO_UI_FAKE_BUSY" || true)',
        '  if [ -n "$line" ]; then',
        '    pid=$(printf "%s" "$line" | cut -d" " -f2)',
        '    cmd=$(printf "%s" "$line" | cut -d" " -f3)',
        '    case "$pid" in',
        '      @*)',
        '        pid=$(cat "${pid#@}" 2>/dev/null || true)',
        '        # A pid resolved from a file stands for a real process, so it gets the real',
        '        # rule: `lsof` only ever names something that exists. A literal pid in the file',
        '        # is an assertion about what lsof would say, and is taken at face value.',
        '        if [ -n "$pid" ]; then kill -0 "$pid" 2>/dev/null || pid=""; fi ;;',
        '    esac',
        '    if [ -n "$pid" ]; then',
        '      printf "p%s\\nc%s\\n" "$pid" "$cmd"',
        '      exit 0',
        '    fi',
        '  fi',
        'fi',
        'exit 1',
        '',
      ].join('\n')
    );
    chmodSync(join(bins, 'lsof'), 0o755);
  };

  /** Marks `port` as served by `pid`/`command`. */
  const serve = (port, pid = 4242, command = 'node') => {
    const kept = readFileSync(busyFile, 'utf8')
      .split('\n')
      .filter((line) => line !== '' && !line.startsWith(`${port} `));
    kept.push(`${port} ${pid} ${command}`);
    writeFileSync(busyFile, `${kept.join('\n')}\n`);
  };

  const env = (extra = {}) => ({
    // Lease variables from the shell running this suite are removed: the fixture decides
    // the pair and the Metro port.
    ...withoutLeaseEnv(process.env),
    NITRO_UI_HOME: home,
    NITRO_UI_LEASE_POLL_MS: '20',
    NITRO_UI_LSOF_BIN: join(bins, 'lsof'),
    NITRO_UI_FAKE_BUSY: busyFile,
    NITRO_UI_GATE_LOG_STORE: join(home, 'log-store'),
    ...extra,
  });
  const leaseCli = (args, extra = {}) =>
    spawnSync(process.execPath, [LEASE_CLI, ...args, '--config', config], {
      encoding: 'utf8',
      env: env(extra),
      timeout: 60_000,
    });

  /** A refused acquire writes no lease file at all, which is the same as none held. */
  const leases = () => {
    try {
      return JSON.parse(readFileSync(join(home, 'leases.json'), 'utf8')).leases;
    } catch {
      return [];
    }
  };

  /** The env a device gate runs under on pair-a, as `lease.mjs` would print it. */
  const leasePairA = leaseRecord({
    id: 'X4-1',
    task: 'X4',
    platform: 'android',
    holds: [PAIR_A],
  });

  const PAIR_A_ENV = {
    NITRO_UI_LEASE_ID: 'X4-1',
    NITRO_UI_LEASE_TASK: 'X4',
    NITRO_UI_LEASE_PLATFORM: 'android',
    ANDROID_AVD: 'nitro-ui-a',
    EMULATOR_PORT: '5574',
    ANDROID_SERIAL: 'emulator-5574',
    ANDROID_ADB_SERVER_PORT: '5043',
    METRO_PORT: String(PORT_A),
  };

  /** `gate.mjs <gate>`, in a throwaway checkout with the lease env sourced. */
  const gateCli = (args, extra = {}, lease = leasePairA) => {
    // The lease has to be in the store as well as in the environment: a device gate
    // refuses a run whose lease it cannot find, before it asks about the Metro port.
    writeLeaseStore(home, {
      skipDevices: true,
      leases: [lease],
    });
    const dir = makeCheckout();
    checkouts.push(dir);
    const bin = join(dir, 'fake-bin');
    const result = spawnSync(process.execPath, [GATE_CLI, ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: env({ PATH: `${bin}${delimiter}${process.env.PATH}`, ...extra }),
      timeout: 90_000,
    });
    return { ...result, dir, lines: ledgerLines(dir) };
  };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'x15-metro-lease-'));
    bins = join(home, 'bin');
    mkdirSync(bins, { recursive: true });
    config = join(home, 'devices.json');
    copyFileSync(EXAMPLE_CONFIG, config);
    busyFile = join(home, 'ports.txt');
    writeFileSync(busyFile, '');
    writeLsofStub();
    checkouts = [];
  });

  afterEach(() => {
    for (const dir of checkouts) rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it('is not handed out by acquire, which takes the other pair instead', () => {
    // A process serves pair-a's port while nobody holds a lease on pair-a.
    serve(PORT_A);
    const result = leaseCli(['acquire', '--task', 'X4']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`export METRO_PORT='${PORT_B}'`);
    expect(leases()[0].holds).toEqual([PAIR_B]);
  });

  it('refuses when every pair is leased, naming the processes on the ports', () => {
    serve(PORT_A);
    serve(PORT_B, 909, 'Python');
    const result = leaseCli(['acquire', '--task', 'X4', '--wait-minutes', '0']);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/lease: refused/);
    expect(result.stderr).toContain(`Metro port ${PORT_A}`);
    expect(result.stderr).toContain('pid 4242 (node)');
    expect(result.stderr).toContain('pid 909 (Python)');
    expect(result.stderr).not.toMatch(/already leased/);
    expect(leases()).toEqual([]);
  });

  it('lets the task that already holds the pair re-acquire over its own Metro', () => {
    const first = leaseCli(['acquire', '--task', 'X4']);
    expect(first.status).toBe(0);
    const port = Number(/export METRO_PORT='(\d+)'/.exec(first.stdout)?.[1]);
    serve(port);
    const again = leaseCli(['acquire', '--task', 'X4']);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain(`export METRO_PORT='${port}'`);
  });

  it('says so once when the machine cannot answer, and leases anyway', () => {
    // A machine with no `lsof` must still be able to lease.
    const result = leaseCli(['acquire', '--task', 'X4'], {
      NITRO_UI_LSOF_BIN: join(bins, 'nope'),
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/could not check the pool's Metro ports/);
    expect(leases()).toHaveLength(1);
  });

  it('makes gate.mjs refuse a leased pair whose Metro port someone else serves', () => {
    // The port can go busy after the lease was granted, so the gate asks again when it
    // starts.
    const run = gateCli(['harness:android'], { ...PAIR_A_ENV });
    serve(PORT_A);
    const second = gateCli(['harness:android'], { ...PAIR_A_ENV });
    expect(second.status).toBe(1);
    expect(second.stderr).toContain('refused before the run');
    expect(second.stderr).toContain(`Metro port ${PORT_A}`);
    expect(second.stderr).toContain('pid 4242 (node)');
    expect(second.stderr).toContain('NITRO_UI_GATE_METRO_FORCE=1');
    // A refused run never started, so it records nothing. The first run, on the same
    // port while it was free, did record.
    expect(second.lines).toEqual([]);
    expect(run.lines).toHaveLength(1);
  });

  it('hands a lease on both platforms one Metro port per platform', () => {
    const result = leaseCli(['acquire', '--task', 'X4', '--platform', 'both']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`export METRO_PORT_IOS='${PORT_A}'`);
    expect(result.stdout).toContain(
      `export METRO_PORT_ANDROID='${PORT_A + 1000}'`
    );
  });

  it('runs an Android gate beside an iOS gate on one lease, each on its own port', () => {
    const both = leaseRecord({
      id: 'X4-1',
      task: 'X4',
      platform: 'both',
      holds: [PAIR_A],
    });
    const bothEnv = {
      ...PAIR_A_ENV,
      NITRO_UI_LEASE_PLATFORM: 'both',
      IOS_SIM_UDID: '00000000-0000-4000-8000-00000000000A',
      IOS_SIM: 'iPhone 17',
      METRO_PORT_IOS: String(PORT_A),
      METRO_PORT_ANDROID: String(PORT_A + 1000),
    };
    // The iOS gate's Metro is up on the iOS port.
    serve(PORT_A);
    const android = gateCli(['harness:android'], bothEnv, both);
    expect(android.stderr).not.toContain('refused before the run');
    expect(android.stdout).toContain(`fake runner metro: ${PORT_A + 1000}`);
    expect(android.status).toBe(0);
    expect(android.lines).toHaveLength(1);
    // The same lease's iOS gate is still refused while its own port is served.
    const ios = gateCli(['harness:ios'], bothEnv, both);
    expect(ios.stderr).toContain(`Metro port ${PORT_A}`);
    expect(ios.status).toBe(1);
  });

  it('runs the gate under NITRO_UI_GATE_METRO_FORCE=1', () => {
    serve(PORT_A);
    const run = gateCli(['harness:android'], {
      ...PAIR_A_ENV,
      NITRO_UI_GATE_METRO_FORCE: '1',
    });
    // The fake runner on PATH prints a jest summary and exits 0.
    expect(run.status).toBe(0);
    expect(run.stderr).toContain('NITRO_UI_GATE_METRO_FORCE=1');
    expect(run.lines).toHaveLength(1);
  });

  it('stops the Metro its own run left on the leased port', () => {
    // Several gates run in a row on one lease, and a Metro left up by one would make the
    // next refuse to start. A gate stops the listeners in its own command's process
    // group. `FAKE_SERVE_METRO` makes the fake runner start a real listener as its child
    // and exit without stopping it.
    const port = freePort();
    const pidFile = join(home, 'fake-metro.pid');
    rmSync(pidFile, { force: true });
    serve(port, `@${pidFile}`, 'node');
    let ownerPid = null;
    let run = null;
    try {
      run = gateCli(['harness:android'], {
        ...PAIR_A_ENV,
        METRO_PORT: String(port),
        FAKE_SERVE_METRO: `${port} ${pidFile}`,
        FAKE_REAL_NODE: process.execPath,
        FAKE_METRO_SNIPPET: LISTENER_SNIPPET,
      });
      expect(run.status).toBe(0);
      ownerPid = readFixturePid(pidFile);
      expect(ownerPid).not.toBeNull();
      expect(run.stderr).toContain('stopped the Metro this run started');
      expect(run.stderr).toContain(String(ownerPid));
      expect(pidIsAlive(ownerPid)).toBe(false);
      // The sweep is also written to the run's stored log, after the run's own output.
      const [record] = run.lines;
      expect(record.logPath).toBeTruthy();
      const transcript = readFileSync(
        join(home, 'log-store', LOG_STORE_BASENAME, record.logPath),
        'utf8'
      );
      expect(transcript).toContain('stopped the Metro this run started');
      expect(transcript).toContain('Tests: 3 passed, 3 total');
      // With the fixture's lease dropped, pair-a can be leased again: its Metro port is
      // free.
      writeLeaseStore(home, { skipDevices: true, leases: [] });
      const next = leaseCli(['acquire', '--task', 'X5']);
      expect(next.status).toBe(0);
      expect(next.stdout).toContain(`export METRO_PORT='${PORT_A}'`);
    } finally {
      killFixturePid(ownerPid);
      if (run != null) writeFileSync(busyFile, '');
    }
  }, 30_000);

  it('leaves a Metro in another process group alone', () => {
    // The listener is a child of this test process, so it is in the test's process group
    // and not the gate's. `NITRO_UI_GATE_METRO_FORCE=1` gets the run past the pre-flight.
    const port = freePort();
    const pidFile = join(home, 'other-metro.pid');
    rmSync(pidFile, { force: true });
    const listener = spawn(
      process.execPath,
      ['-e', LISTENER_SNIPPET, String(port), pidFile],
      { stdio: 'ignore' }
    );
    let otherPid = null;
    try {
      otherPid = readFixturePid(pidFile);
      expect(otherPid).not.toBeNull();
      expect(pidIsAlive(otherPid)).toBe(true);
      serve(port, `@${pidFile}`, 'node');
      const run = gateCli(['harness:android'], {
        ...PAIR_A_ENV,
        METRO_PORT: String(port),
        NITRO_UI_GATE_METRO_FORCE: '1',
      });
      expect(run.status).toBe(0);
      expect(run.stderr).not.toContain('stopped the Metro this run started');
      expect(pidIsAlive(otherPid)).toBe(true);
    } finally {
      listener.kill('SIGKILL');
      killFixturePid(otherPid);
      writeFileSync(busyFile, '');
    }
  }, 30_000);

  it('leaves a run with no METRO_PORT alone (CI, a plain check)', () => {
    // `check` uses no device and no Metro, so the pre-flight must not apply to it even
    // when a leased shell exports a busy METRO_PORT.
    serve(PORT_A);
    const run = gateCli(['check'], {
      NITRO_UI_LSOF_BIN: join(bins, 'nope'),
    });
    expect(run.status).toBe(0);
    expect(run.stderr).not.toMatch(/Metro pre-flight/);
    expect(run.lines).toHaveLength(1);

    const busy = gateCli(['check'], { METRO_PORT: String(PORT_A) });
    expect(busy.status).toBe(0);
    expect(busy.stderr).not.toMatch(/refused before the run/);
    expect(busy.lines).toHaveLength(1);
  });
});

/* ------------------------- a throwaway checkout ---------------------------- */

/**
 * A stand-in bundle server: it binds the port, writes its pid and stays up. It exits by
 * itself after 60 s, so a test that dies before its cleanup cannot leave a listener
 * behind. The bind is retried because `freePort` releases the port before this binds it.
 */
const LISTENER_SNIPPET =
  'const net=require("net"),fs=require("fs");' +
  'const tryBind=(n)=>{const s=net.createServer((c)=>c.end());' +
  's.once("error",(e)=>{if(e.code!=="EADDRINUSE"||n>20)throw e;' +
  'setTimeout(()=>tryBind(n+1),200)});' +
  's.listen(Number(process.argv[1]),()=>fs.writeFileSync(process.argv[2],String(process.pid)))};' +
  'tryBind(0);const die=setTimeout(()=>process.exit(0),60000);if(die.unref)die.unref();';

/**
 * Blocks without a subprocess and without spinning: `Atomics.wait` on a shared buffer is a
 * real sleep that works on Node's main thread.
 */
function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    spawnSync(process.execPath, ['-e', '0']);
  }
}

/**
 * Waits for a fixture's pid file to appear and returns the pid in it, or null. The writer
 * is several processes down, so the budget is generous for a loaded machine.
 */
function readFixturePid(pidFile, limitMs = 30_000) {
  const deadline = Date.now() + limitMs;
  for (;;) {
    if (existsSync(pidFile)) {
      const pid = Number(String(readFileSync(pidFile, 'utf8')).trim());
      if (Number.isInteger(pid) && pid > 0) return pid;
    }
    if (Date.now() >= deadline) return null;
    sleepSync(25);
  }
}

/** Kills a fixture's listener by the pid it wrote, and waits for it to be gone. */
function killFixturePid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
  const deadline = Date.now() + 5_000;
  while (pidIsAlive(pid) && Date.now() < deadline) {
    sleepSync(25);
  }
}

/** A port nobody is listening on, asked of the OS rather than hardcoded. */
function freePort() {
  const probe = spawnSync(
    process.execPath,
    [
      '-e',
      'const s=require("net").createServer();s.listen(0,()=>{process.stdout.write(String(s.address().port));s.close()});',
    ],
    { encoding: 'utf8' }
  );
  const port = Number(String(probe.stdout ?? '').trim());
  expect(Number.isInteger(port) && port > 0).toBe(true);
  return port;
}

/**
 * The smallest tree `gate.mjs` runs in: the marker `repoRootOf()` looks for, an
 * `example/` for a harness gate to run in, and a fake `node`/`bun` on PATH that prints a
 * jest summary.
 */
function makeCheckout() {
  const dir = mkdtempSync(join(tmpdir(), 'x15-gate-'));
  for (const file of [
    'nitrogen/generated/ios/NitroUiAutolinking.swift',
    'example/package.json',
  ]) {
    const target = join(dir, file);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, '{"name":"x"}\n');
  }
  writeFileSync(join(dir, '.gitignore'), '.gates/\nfake-bin/\n');
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);
  git(dir, ['checkout', '-qb', 'task/x15-fixture']);
  const bin = join(dir, 'fake-bin');
  mkdirSync(bin, { recursive: true });
  const script = [
    '#!/bin/sh',
    'echo "fake runner: $0 $*"',
    'echo "fake runner metro: $METRO_PORT"',
    // `FAKE_SERVE_METRO` is "<port> <pid file>": start a listener as this shim's own
    // child, so it shares the shim's process group, and exit without stopping it.
    // `FAKE_REAL_NODE` names the interpreter, because `node` on this PATH is this shim.
    'if [ -n "$FAKE_SERVE_METRO" ]; then',
    '  set -- $FAKE_SERVE_METRO',
    '  "$FAKE_REAL_NODE" -e "$FAKE_METRO_SNIPPET" "$1" "$2" &',
    // Wait for the listener to exist before exiting, or the gate's sweep finds nothing.
    '  i=0',
    '  while [ "$i" -lt 75 ]; do',
    '    [ -s "$2" ] && break',
    '    sleep 0.2',
    '    i=$((i+1))',
    '  done',
    '  echo "fake metro: serving $1 as pid $(cat "$2" 2>/dev/null)"',
    'fi',
    'echo "Test Suites: 1 passed, 1 total"',
    'echo "Tests: 3 passed, 3 total"',
    'exit ${FAKE_EXIT:-0}',
    '',
  ].join('\n');
  for (const name of ['node', 'bun']) {
    const shim = join(bin, name);
    writeFileSync(shim, script);
    chmodSync(shim, 0o755);
  }
  return dir;
}

function git(dir, args) {
  const result = spawnSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
      HOME: dir,
    },
  });
  if (result.status !== 0)
    throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return String(result.stdout).trim();
}

function ledgerLines(dir) {
  try {
    return readFileSync(
      join(dir, '.gates', 'task', 'x15-fixture.jsonl'),
      'utf8'
    )
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

/**
 * A pair nobody has leased can still have its Metro port spoken for (X15 item 1).
 *
 * The incident this guards (FOLLOWUPS, X4 on 2026-10-29): F7's harness kept running on
 * pair-a after its lease there ended, so the pool handed pair-a to X4 twice, and with two
 * Metro servers on one port the run died as
 * `The app bridge was replaced by a newer app connection` - F7's iOS app had joined X4's
 * Android Metro. Three device runs, and an error message that never mentioned a port.
 *
 * The lease file cannot see that state: the stale run holds no lease, so every lease
 * decision reads "pair-a is free". So the answer comes from the kernel, and these tests
 * check both halves of that - `lease.mjs acquire` will not hand out a pair whose port a
 * live process serves, and `gate.mjs` refuses to start on one.
 *
 * `lsof` is stubbed with `NITRO_UI_LSOF_BIN`, the same kind of override the adb/simctl
 * checks use: a test that asked the real machine would depend on what another task
 * happens to be running, and "the port is busy" would be untestable rather than merely
 * flaky. The stub replays `lsof -Fpc` byte shapes (`p<pid>`, `c<command>`) from a file,
 * so a case says which port is busy and which process owns it.
 */

import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
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

import {
  decideAcquire,
  lsofListenArgs,
  metroPreflightFromEnv,
  metroPortReason,
  normalizeDevices,
  pidIsAlive,
  parseLsofListeners,
  portListeners,
} from '../lease-core.mjs';

const REPO_ROOT = join(__dirname, '..', '..');
const LEASE_CLI = join(REPO_ROOT, 'scripts', 'lease.mjs');
const GATE_CLI = join(REPO_ROOT, 'scripts', 'gate.mjs');
const EXAMPLE_CONFIG = join(REPO_ROOT, 'scripts', 'devices.example.json');

/** devices.example.json's own pairs and Metro ports, so fixtures name what it really says. */
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
    // An error message is not a listener: nothing there parses as `p<digits>`.
    expect(parseLsofListeners('lsof: cannot open /dev/mem\n')).toEqual([]);
  });

  it('keeps a pid whose command line never arrives, rather than dropping it', () => {
    // Output can end after the pid when the process goes between the scan and the
    // read. Dropping it would read as "the port is free", which is the wrong way up.
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
    // That is the normal answer for a free port, so reading it as a failure would make
    // every free port an unchecked one - and every check would then fail open.
    expect(portListeners({ port: PORT_A, run: run('', false) })).toEqual({
      port: PORT_A,
      checked: true,
      error: null,
      listeners: [],
    });
  });

  it('says it could not check, rather than calling the port free', () => {
    // The fail-open has to be visible: a machine without lsof still gets leases, but
    // never a clean-looking "port is free" that was never asked about.
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
    // The reason has to name the port: "every pair is already leased" sends the task to
    // `lease.mjs list`, where a stale Metro is invisible.
    const decision = ask({ portBlocked: [blocked(PAIR_A), blocked(PAIR_B)] });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toContain('Metro port');
    expect(decision.reason).not.toMatch(/already leased/);
  });

  it('does not report a port it was not told about', () => {
    // The guard must not be decoration: with no blocked ports the answer is the old one.
    expect(ask().ok).toBe(true);
    expect(ask().pair.id).toBe(PAIR_A);
  });

  it('lets an exclusive acquire proceed over a busy Metro port, and says so', () => {
    // An exclusive lease is a bench or a baseline mint, and a bench builds its JS into
    // the Release binary (`scripts/bench/devices.mjs:10`), so it never serves or joins a
    // Metro. Waiting here cost up to an hour for a port the run will not touch, and the
    // `pendingExclusive` marker refreshed on every poll held back every *other* task
    // with a message that named neither the port nor the pid (X15 review). The guard the
    // exclusive case really needs is the device reap it already runs, not this one.
    const decision = ask({ exclusive: true, portBlocked: [blocked(PAIR_B)] });
    expect(decision.ok).toBe(true);
    expect(decision.note).toContain(
      'exclusive lease does not wait on Metro ports'
    );
    expect(decision.note).toContain(`Metro port (${PAIR_B})`);
  });

  it('still holds a non-exclusive lease back from a busy port when it is the only pair', () => {
    // The other half of the pair of rules: the device task that *would* join that Metro
    // keeps the guard. Making the exclusive case loud-but-fast must not quietly widen
    // the exception to everyone.
    const decision = ask({
      exclusive: false,
      portBlocked: [blocked(PAIR_A), blocked(PAIR_B)],
    });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toMatch(/Metro port/);
  });

  it("still lets a task's own lease hold its pair over its own Metro", () => {
    // Re-running `acquire` mid-suite to regenerate the env file is documented, and the
    // server on that port is that task's own run. `acquire` answers that caller from
    // its idempotent path before the port question; this is the decision the same
    // situation makes when the pair really is this task's own.
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
    // CI, and every plain `bun run check`: no METRO_PORT means no port was handed out.
    expect(metroPreflightFromEnv({}, run(''))).toEqual({
      checked: false,
      port: null,
      reason: null,
      warning: null,
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
  });

  it('passes a port nobody is listening on', () => {
    expect(
      metroPreflightFromEnv({ METRO_PORT: String(PORT_A) }, run('', false))
    ).toEqual({ checked: true, port: PORT_A, reason: null, warning: null });
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
 * A minimal checkout `gate.mjs` will run in, with a fake `node`/`bun` on PATH.
 *
 * `gate.mjs` starts by re-execing itself under `.nvmrc`'s major when the current runtime
 * is not one it supports, and that re-exec resolves a *real* node from the fnm-exported
 * PATH - past the fixture's fake runner. So the CLI cases carry the same runtime guard
 * `gate.test.js` uses, read from the shipped module rather than a copy of its list.
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
   * `lsof` as a stub: it replays whatever `ports.txt` says is listening, in `-Fpc`
   * shape. The port is read out of the argv so one stub answers for the whole pool, and
   * the no-match answer is lsof's real one (exit 1, nothing printed).
   *
   * A pid may be written `@/path/to/pid`, meaning "read the live pid out of that file",
   * which is how the ownership cases name a process that does not exist until the run
   * starts: the port reads as free until the fake Metro writes its pid, and as busy from
   * then on. The alternative - asserting a pid the fixture invented - would let the sweep
   * pass by trusting the fixture instead of the kernel.
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
    ...process.env,
    NITRO_UI_HOME: home,
    NITRO_UI_LEASE_POLL_MS: '20',
    NITRO_UI_LSOF_BIN: join(bins, 'lsof'),
    NITRO_UI_FAKE_BUSY: busyFile,
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
  const gateCli = (args, extra = {}) => {
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
    // The incident: a run holds pair-a's *port* while holding no lease, so the pool
    // sees pair-a free. The next task asks, and the only right answer is pair-b.
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
    // The documented way to get an env file again mid-run: the server on the port is
    // this task's own suite, so this has to keep working or the guard breaks a workflow.
    const first = leaseCli(['acquire', '--task', 'X4']);
    expect(first.status).toBe(0);
    const port = Number(/export METRO_PORT='(\d+)'/.exec(first.stdout)?.[1]);
    serve(port);
    const again = leaseCli(['acquire', '--task', 'X4']);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain(`export METRO_PORT='${port}'`);
  });

  it('says so once when the machine cannot answer, and leases anyway', () => {
    // Fail-open with a voice: a container with no lsof must still be able to lease.
    const result = leaseCli(['acquire', '--task', 'X4'], {
      NITRO_UI_LSOF_BIN: join(bins, 'nope'),
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/could not check the pool's Metro ports/);
    expect(leases()).toHaveLength(1);
  });

  it('makes gate.mjs refuse a leased pair whose Metro port someone else serves', () => {
    // The second net: the lease was granted *before* the port went busy, and a gate
    // starts minutes after its acquire. X4's pair, X4's lease, someone else's Metro.
    const run = gateCli(['harness:android'], { ...PAIR_A_ENV });
    serve(PORT_A);
    const second = gateCli(['harness:android'], { ...PAIR_A_ENV });
    expect(second.status).toBe(1);
    expect(second.stderr).toContain('refused before the run');
    expect(second.stderr).toContain(`Metro port ${PORT_A}`);
    expect(second.stderr).toContain('pid 4242 (node)');
    expect(second.stderr).toContain('NITRO_UI_GATE_METRO_FORCE=1');
    // Nothing recorded: the run never started, so there is no evidence to write. And
    // the first run, on the same port while it was still free, did record - so the
    // refusal is about the port and not about the fixture.
    expect(second.lines).toEqual([]);
    expect(run.lines).toHaveLength(1);
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
    // The merge sequence (`real-input:ios` -> `real-input:android` -> `harness:ios` ->
    // `harness:android`) runs four gates on one lease, and a Metro left up by the first is
    // what the second's pre-flight then refuses - the second refuses *itself*. So a gate
    // stops what its own run started, and the ownership test is the child's process group: a
    // kernel fact, where attributing a listener by its environment (`ps eww`) is not - an id
    // past that command's truncation width reads as somebody else's server, and the safe
    // branch there is precisely the leak.
    //
    // `FAKE_SERVE_METRO` makes the fixture's runner spawn a real socket owner as its own child
    // (the harness's bundle server, one process level down) and exit without stopping it. The
    // busy file names the pid *indirectly*, so the port reads free until the listener exists
    // and busy from then on: the order a leaked server has in a real run, and the reason the
    // fixture cannot simply assert a pid of its own.
    //
    // The listener binds its own free port while the fixture's *leased* port stays 8295: the
    // sweep asks about `METRO_PORT`, so both are pointed at the listener's port for this case,
    // and pair-a remains free in the pool for the acquire assertion at the end.
    const port = freePort();
    const pidFile = join(home, 'fake-metro.pid');
    rmSync(pidFile, { force: true });
    serve(port, `@${pidFile}`, 'node');
    const run = gateCli(['harness:android'], {
      ...PAIR_A_ENV,
      METRO_PORT: String(port),
      FAKE_SERVE_METRO: `${port} ${pidFile}`,
      FAKE_REAL_NODE: process.execPath,
      FAKE_METRO_SNIPPET: LISTENER_SNIPPET,
    });
    expect(run.status).toBe(0);
    const ownerPid = Number(readFileSync(pidFile, 'utf8').trim());
    expect(ownerPid).toBeGreaterThan(0);
    expect(run.stderr).toContain('stopped the Metro this run started');
    expect(run.stderr).toContain(String(ownerPid));
    expect(pidIsAlive(ownerPid)).toBe(false);
    // And the pool's answer for the pair is unchanged: the sweep stopped a server on the port
    // this run was handed, not the pair's own port, and certainly not another task's.
    const next = leaseCli(['acquire', '--task', 'X5']);
    expect(next.status).toBe(0);
    expect(next.stdout).toContain(`export METRO_PORT='${PORT_A}'`);
  });

  it('leaves a Metro in another process group alone', () => {
    // The half that keeps this safe: stopping a stranger's Metro *is* the X4 incident, so the
    // sweep's only authority is "same group as my child". The listener below is a child of
    // this test process, so its group is the test's, while the busy file reports its real pid
    // on the leased port - so a sweep keyed on the port alone, or on an environment string,
    // would kill it. `NITRO_UI_GATE_METRO_FORCE=1` gets the run past the pre-flight (which is
    // what a hand-started Metro session does today), isolating the sweep from the refusal.
    const port = freePort();
    const pidFile = join(home, 'other-metro.pid');
    rmSync(pidFile, { force: true });
    const listener = spawn(
      process.execPath,
      ['-e', LISTENER_SNIPPET, String(port), pidFile],
      { stdio: 'ignore' }
    );
    try {
      const deadline = Date.now() + 15_000;
      while (!existsSync(pidFile) && Date.now() < deadline) {
        spawnSync(process.execPath, ['-e', '0']);
      }
      expect(existsSync(pidFile)).toBe(true);
      const otherPid = Number(readFileSync(pidFile, 'utf8').trim());
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
      try {
        const pid = Number(readFileSync(pidFile, 'utf8').trim());
        if (pid > 0) process.kill(pid, 'SIGKILL');
      } catch {
        /* gone */
      }
      writeFileSync(busyFile, '');
    }
  });

  it('leaves a run with no METRO_PORT alone (CI, a plain check)', () => {
    // Nothing to ask about when no lease handed a port out. Written to fail if the
    // pre-flight ever reaches a non-device gate too: `check` runs with a busy METRO_PORT
    // exported (the lease env is sourced in the shell, and `check` inherits it), so a
    // pre-flight on this path would refuse a CI step that has no device and no Metro of
    // its own. `check` is also the gate that has no platform, which is the real reason it
    // must stay out of the guard.
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
 * A bundle server, as a real socket owner: binds, writes its pid, and stays up. The retries
 * are because `freePort` releases the port before the caller binds it - the usual
 * ephemeral-port race, and the same one a real Metro has with a predecessor's port.
 */
const LISTENER_SNIPPET =
  'const net=require("net"),fs=require("fs");' +
  'const tryBind=(n)=>{const s=net.createServer((c)=>c.end());' +
  's.once("error",(e)=>{if(e.code!=="EADDRINUSE"||n>20)throw e;' +
  'setTimeout(()=>tryBind(n+1),200)});' +
  's.listen(Number(process.argv[1]),()=>fs.writeFileSync(process.argv[2],String(process.pid)))};' +
  'tryBind(0);setTimeout(()=>{},1e6);';

/**
 * A port nobody is listening on, asked of the OS rather than guessed: the fixture's fake Metro
 * has to own a real socket, and a hardcoded number is a test that fails whenever somebody
 * else's run happens to use it (which is what pair-a's real port turned out to be, mid-run).
 */
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
 * jest summary. Same shape as `gate.test.js`'s fixture.
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
  // Built from lines rather than one concatenated string: the Metro-leak case needs a
  // nested quoting level (a `node -e` inside a shim inside a JS string), and an array keeps
  // each level readable.
  const script = [
    '#!/bin/sh',
    'echo "fake runner: $0 $*"',
    // The Metro-leak case: a run that starts a bundle server and exits without stopping it.
    // `FAKE_SERVE_METRO` is "<port> <pid file>". The listener is a *real* socket owner,
    // spawned as this shim's own child so it shares this shim's process group - the fact the
    // sweep decides on, which is why the runner cannot simply report a pid of its own.
    // `FAKE_REAL_NODE` names the interpreter: `node` on this PATH is this shim.
    'if [ -n "$FAKE_SERVE_METRO" ]; then',
    '  set -- $FAKE_SERVE_METRO',
    '  "$FAKE_REAL_NODE" -e "$FAKE_METRO_SNIPPET" "$1" "$2" &',
    '  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do',
    '    [ -s "$2" ] && break',
    '    sleep 0.2',
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

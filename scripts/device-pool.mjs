#!/usr/bin/env node
/**
 * The warm device pool: a booted device stays booted for the next lease, and only this
 * module powers pool devices off. State is `pool.json` in the lease home directory.
 *
 *  - A gate claims its lease's devices for the length of its run. A claim is a pid, and a dead
 *    pid is not a claim.
 *  - A device a live lease holds is never powered off on a timer, claimed or not.
 *  - Nothing reaps passively: only an explicit reap and an `--exclusive` acquire power off.
 *  - Every power-off re-validates under the lock immediately before it acts, and has the
 *    emulator confirm its AVD name first. A stored serial is never trusted.
 *  - Decisions are taken under `leases.lock`; device I/O runs with the lock released, so a
 *    slow shutdown cannot fail another task's acquire.
 *  - Only devices named in `devices.json` are ever shut down.
 */

import { spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
} from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { dirname, join } from 'node:path';

import {
  DEVICE_POLL_MS,
  DEVICE_SETTLE_TIMEOUT_MS,
  IDLE_SHUTDOWN_DEFAULT_MINUTES,
  LOAD_SETTLE_TIMEOUT_MS,
  LOCK_TIMEOUT_MS,
  POOL_STATE_VERSION,
  deviceIsBusy,
  emulatorSerial,
  identifiersFor,
  isReservedSerial,
  leaseIsLive,
  loadSettleCeiling,
  pidIsAlive,
  poolReapDecision,
  readJson,
  sleepMs,
  stateHome,
  withLock,
  writeJsonAtomic,
} from './lease-core.mjs';
import { emulatorGpuMode, emulatorLaunchArgs } from './emulator-launch.mjs';

export const POOL_FILE = 'pool.json';

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** `0` is a real answer ("do not wait at all"), so the test cannot be truthiness. */
function nonNegativeNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function poolStatePath(home = stateHome()) {
  return join(home, POOL_FILE);
}

/**
 * The pool state, or an empty one. A file that cannot be parsed is moved aside and reported
 * in `recovered`, never silently ignored.
 */
export function readPool(home = stateHome()) {
  const file = poolStatePath(home);
  let state;
  try {
    state = readJson(file, { version: POOL_STATE_VERSION, devices: [] });
  } catch (error) {
    const aside = `${file}.corrupt-${Date.now()}`;
    try {
      renameSync(file, aside);
    } catch {
      // A file that cannot be moved must not fail every pool command: the next write
      // replaces it.
    }
    return {
      version: POOL_STATE_VERSION,
      devices: [],
      recovered: {
        from: error ? aside : file,
        reason: String(error?.message ?? error),
      },
    };
  }
  if (!Array.isArray(state.devices)) state.devices = [];
  state.version = POOL_STATE_VERSION;
  return state;
}

/**
 * Why a reap refuses to run when the pool state could not be read: an unreadable file is
 * read as empty, and an empty pool has no claims, which would let a reap power off devices
 * the lost file said were in use.
 *
 * @returns {string | null} the reason to report, or null when the state was readable
 */
export function poolRecoverySkip(recovered) {
  if (recovered == null) return null;
  return (
    `pool state was unreadable (${recovered.reason}) at ${recovered.from} - ` +
    'nothing is powered off from a pool that cannot remember what it was ' +
    'holding; look at that file, then re-run'
  );
}

/** Pool keys for the devices a pair names, in the form records use (`avd:<name>` / `ios:<udid>`). */
export function poolKeysForPair(pair) {
  const keys = [];
  if (pair?.android?.avd)
    keys.push(poolKeyFor({ platform: 'android', id: pair.android.avd }));
  if (pair?.ios?.udid)
    keys.push(poolKeyFor({ platform: 'ios', id: pair.ios.udid }));
  return keys;
}

/** The keys of the devices one platform's run touches (an `ios` gate never claims the AVD). */
export function identifiersForPair(pair, platform = 'both') {
  const ids = [];
  if (platform !== 'ios' && pair?.android?.avd)
    ids.push(`avd:${pair.android.avd}`);
  if (platform !== 'android' && pair?.ios?.udid)
    ids.push(`ios:${pair.ios.udid}`);
  return ids;
}

/**
 * A pool key's prefix and its platform are different words: an Android key reads
 * `avd:<name>` while the code branches on `android`. This translates between them.
 *
 * @returns {[string | null, string]} `[kind, id]`
 */
function splitKey(key) {
  const i = String(key).indexOf(':');
  if (i === -1) return [null, String(key)];
  const prefix = key.slice(0, i);
  const id = key.slice(i + 1);
  if (prefix === KEY_PREFIX.android) return ['android', id];
  if (prefix === KEY_PREFIX.ios) return ['ios', id];
  return [prefix, id];
}

export const KEY_PREFIX = { android: 'avd', ios: 'ios' };

export function poolKeyFor({ platform, id }) {
  const prefix = KEY_PREFIX[platform] ?? platform;
  return id == null ? null : `${prefix}:${id}`;
}

function upsertDevice(state, key, fields) {
  let entry = state.devices.find((x) => x.key === key);
  if (!entry) {
    const [kind, id] = splitKey(key);
    entry = { key, kind, id, claims: [] };
    state.devices.push(entry);
  }
  if (!Array.isArray(entry.claims)) entry.claims = [];
  Object.assign(entry, fields);
  return entry;
}

/**
 * Device operations. The defaults are the real binaries; `NITRO_UI_ADB_BIN` and
 * `NITRO_UI_SIMCTL_BIN` point them at a stub.
 */
export function deviceOperations({
  home = stateHome(),
  env = process.env,
  now = Date.now,
  log = () => {},
} = {}) {
  const adbBin = env.NITRO_UI_ADB_BIN || 'adb';
  const simctlBin = env.NITRO_UI_SIMCTL_BIN || 'xcrun';

  /**
   * The working directory of every emulator and adb call. An emulator, and an adb server an
   * adb call forks, outlive the command and keep their working directory for days: started
   * from a worktree, they keep its files on disk after the worktree is removed.
   */
  function workDir() {
    mkdirSync(home, { recursive: true });
    return home;
  }

  /**
   * Runs `adb` on the adb server that owns the device. Each pair has a private server, and a
   * server only lists the devices registered with it, so the port comes from the pair's
   * `adbPort`, not from the caller's shell.
   *
   * @param {string[] | null} args
   * @param {number | string | null} [adbPort]
   */
  function adb(args, adbPort = null) {
    const serverPort = adbPort ?? env.ANDROID_ADB_SERVER_PORT ?? null;
    return spawnSync(
      adbBin,
      serverPort ? ['-P', String(serverPort), ...args] : args,
      { encoding: 'utf8', timeout: 120_000, cwd: workDir() }
    );
  }

  function simctl(args) {
    return spawnSync(simctlBin, ['simctl', ...args], {
      encoding: 'utf8',
      timeout: 300_000,
    });
  }

  const out = (res) => (res?.stdout ?? '').trim();

  return {
    adb,
    simctl,

    /**
     * `adb devices`, and whether the server answered. A timed-out call has no output, which
     * looks the same as "no emulator attached", so `ok: false` means "unknown" and the
     * caller must keep the device's record.
     *
     * @returns {{ok: boolean, serials: string[], answer: string}}
     */
    attachedSerialsResult(adbPort = null) {
      const res = adb(['devices'], adbPort);
      const answer = out(res);
      if (res?.error != null || res?.status !== 0) {
        return {
          ok: false,
          serials: [],
          answer:
            answer ||
            String(res?.stderr ?? '').trim() ||
            String(res?.error?.message ?? `exit ${String(res?.status)}`),
        };
      }
      return {
        ok: true,
        answer,
        serials: answer
          .split('\n')
          .slice(1)
          .map((line) => line.trim().split(/\s+/))
          .filter(
            ([serial, state]) =>
              serial?.startsWith('emulator-') && state === 'device'
          )
          .map(([serial]) => serial),
      };
    },

    attachedSerials(adbPort = null) {
      return this.attachedSerialsResult(adbPort).serials;
    },

    /**
     * Which AVD is behind this serial, answered by the emulator itself. The last check
     * before `emu kill`: a device that does not name the AVD the pool means is never killed.
     * A console that is not ready yet names no AVD, which reads as null.
     *
     * @returns {string | null}
     */
    emulatorAvdName(serial, adbPort = null) {
      const answer = out(adb(['-s', serial, 'emu', 'avd', 'name'], adbPort));
      const first = answer.split('\n')[0]?.trim();
      return first && first !== 'OK' && !/^emulator-|offline|error/i.test(first)
        ? first
        : null;
    },

    bootComplete(serial, adbPort = null) {
      return (
        out(
          adb(['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], adbPort)
        ) === '1'
      );
    },

    shutdownAndroid(serial, adbPort = null) {
      const res = adb(['-s', serial, 'emu', 'kill'], adbPort);
      log(`  emulator ${serial}: shutdown (${out(res) || 'emu kill'})`);
      return res.status === 0;
    },

    /**
     * Every simulator `simctl` knows about, and whether `simctl` answered.
     *
     * @returns {{ok: boolean, byUdid: Map<string, string>, answer: string}}
     */
    simulatorsResult() {
      const res = simctl(['list', '-j', 'devices']);
      if (res?.error != null || res?.status !== 0) {
        return {
          ok: false,
          byUdid: new Map(),
          answer:
            String(res?.stderr ?? '').trim() ||
            String(res?.error?.message ?? `exit ${String(res?.status)}`),
        };
      }
      let groups = {};
      try {
        groups = JSON.parse(out(res) || '{}')?.devices ?? {};
      } catch (error) {
        // Unparseable output is "unknown" too, never "shut down".
        return {
          ok: false,
          byUdid: new Map(),
          answer: String(error?.message ?? error),
        };
      }
      const byUdid = new Map();
      for (const list of Object.values(groups)) {
        for (const x of list ?? []) {
          const udid = x?.udid ?? x?.identifier;
          if (udid) byUdid.set(udid, x?.state ?? 'Shutdown');
        }
      }
      return { ok: true, byUdid, answer: 'ok' };
    },

    simulators() {
      return this.simulatorsResult().byUdid;
    },

    /** Simulators `simctl` reports as Booted, or null when it did not answer. */
    bootedSimulatorsOrNull() {
      const { ok, byUdid } = this.simulatorsResult();
      return ok
        ? [...byUdid.entries()]
            .filter(([, state]) => state === 'Booted')
            .map(([udid]) => udid)
        : null;
    },

    bootedSimulators() {
      return [...this.simulators().entries()]
        .filter(([, state]) => state === 'Booted')
        .map(([udid]) => udid);
    },

    /**
     * Boots a simulator headlessly. Not `open -a Simulator`: on Xcode 27 Simulator.app also
     * boots its own default device. "Unable to boot device in current state: Booted" counts
     * as success.
     */
    bootSimulator(udid) {
      const res = simctl(['boot', udid]);
      const already = /current state: Booted/i.test(res.stderr ?? '');
      log(`  simulator ${udid}: boot requested (exit ${res.status ?? '?'})`);
      return res.status === 0 || already;
    },

    shutdownSimulator(udid) {
      const res = simctl(['shutdown', udid]);
      log(`  simulator ${udid}: shutdown (exit ${res.status ?? '?'})`);
      return res.status === 0;
    },

    /**
     * Starts an emulator detached and returns at once: the caller waits on `adb devices`.
     * Its log lives beside the pool state.
     *
     * `adbPort` must be in the launch environment: an emulator registers with the adb server
     * named by `ANDROID_ADB_SERVER_PORT` in its own environment, and with the default server
     * on 5037 when that is unset, where the pair's private server never sees it.
     */
    bootEmulator({ avd, port, adbPort = null }) {
      const args = emulatorLaunchArgs({
        avd,
        port,
        gpuMode: emulatorGpuMode(env),
      });
      const logDir = join(dirname(poolStatePath(home)), 'logs');
      mkdirSync(logDir, { recursive: true });
      const logFile = join(logDir, `emulator-${port ?? 'auto'}-${now()}.log`);
      const launchEnv =
        adbPort == null
          ? env
          : { ...env, ANDROID_ADB_SERVER_PORT: String(adbPort) };
      try {
        const fd = openSync(logFile, 'a');
        const child = spawn(env.EMULATOR_BIN || 'emulator', args, {
          detached: true,
          stdio: ['ignore', fd, fd],
          env: launchEnv,
          cwd: workDir(),
        });
        child.unref();
        closeSync(fd);
        log(
          `  emulator ${avd}${port ? `:${port}` : ''}: boot requested ` +
            `(gpu ${emulatorGpuMode(env)}${
              adbPort == null ? '' : `, adb server ${adbPort}`
            }, log ${logFile})`
        );
        return child.pid != null;
      } catch (error) {
        log(
          `  emulator ${avd}: could not start (${String(error?.message ?? error)})`
        );
        return false;
      }
    },
  };
}

/**
 * What a pool key is on this machine, from the pair that names it. The serial is derived
 * from the pair's console port, never taken from the caller's environment: a wrong serial
 * in a record would aim a later `emu kill` at another pair's emulator.
 *
 * @param {{ios?: {udid?: string | null}, android?: {emulatorPort?: number | null, adbPort?: number | null, avd?: string | null}}} pair
 * @param {string} key
 * @returns {Record<string, unknown>}
 */
function identityFor(pair, key) {
  const [kind, id] = splitKey(key);
  if (kind === 'android') {
    return {
      kind,
      id,
      udid: null,
      serial:
        pair?.android?.emulatorPort != null
          ? emulatorSerial(pair.android.emulatorPort)
          : null,
      adbPort: pair?.android?.adbPort ?? null,
    };
  }
  return {
    kind,
    id,
    udid: kind === 'ios' ? id : null,
    serial: null,
    adbPort: null,
  };
}

export class DevicePool {
  constructor({
    home = stateHome(),
    env = process.env,
    devices = null,
    log = console.error,
    now = Date.now,
    readLoad = () => loadavg()[0],
    cores = cpus()?.length || 8,
    sleep = (ms) => sleepMs(ms),
    isPidAlive = pidIsAlive,
    ops,
  } = {}) {
    this.home = home;
    this.env = env;
    this.devices = devices;
    this.log = log;
    this.now = now;
    this.readLoad = readLoad;
    this.cores = cores;
    this.sleep = sleep;
    this.isPidAlive = isPidAlive;
    this.pollMs = positiveNumber(env.NITRO_UI_LEASE_POLL_MS) ?? DEVICE_POLL_MS;
    this.settleTimeoutMs =
      nonNegativeNumber(env.NITRO_UI_LOAD_SETTLE_TIMEOUT_MS) ??
      LOAD_SETTLE_TIMEOUT_MS;
    this.ops = ops ?? deviceOperations({ home, env, now, log });
  }

  leases() {
    return (
      readJson(join(this.home, 'leases.json'), { leases: [] }).leases ?? []
    );
  }

  /**
   * Whether the pool state file can be read, without touching it. Not `readPool`, which
   * moves an unreadable file aside and returns an empty state. A missing file is readable.
   *
   * @returns {{ok: true} | {ok: false, file: string, reason: string}}
   */
  poolStateReadable() {
    const file = poolStatePath(this.home);
    let text;
    try {
      if (!existsSync(file)) return { ok: true };
      text = readFileSync(file, 'utf8');
    } catch (error) {
      return { ok: false, file, reason: String(error?.message ?? error) };
    }
    try {
      const state = JSON.parse(text);
      if (state == null || typeof state !== 'object')
        return { ok: false, file, reason: 'the file is not a JSON object' };
      return { ok: true };
    } catch (error) {
      return { ok: false, file, reason: String(error?.message ?? error) };
    }
  }

  /** Read-modify-write of `pool.json`, under the same lock as `leases.json`. */
  withPool(fn) {
    return withLock({
      lockFile: join(this.home, 'leases.lock'),
      timeoutMs: LOCK_TIMEOUT_MS,
      mutate: () => {
        const state = readPool(this.home);
        const result = fn(state);
        writeJsonAtomic(poolStatePath(this.home), state);
        return result;
      },
    });
  }

  idleShutdownMinutesFor(kind) {
    const value = this.devices?.idleShutdownMinutes;
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? value
      : undefined;
  }

  /**
   * Writes the pair's records with `phase: 'booting'` before a boot starts, so a reap cannot
   * power the device off during the minutes it spends coming up. `notePair` clears the phase.
   */
  markBooting(pair, lease, { platform = lease?.platform ?? 'both' } = {}) {
    const keys = poolKeysForPair(pair).filter((key) => {
      const kind = splitKey(key)[0];
      return platform === 'both' || platform === kind;
    });
    const nowMs = this.now();
    return this.withPool((state) => {
      for (const key of keys) {
        const prev = state.devices.find((x) => x.key === key);
        upsertDevice(state, key, {
          ...identityFor(pair, key),
          leaseId: lease?.id ?? prev?.leaseId ?? null,
          bootedAtMs: prev?.bootedAtMs ?? nowMs,
          lastUsedMs: prev?.lastUsedMs ?? nowMs,
          idleShutdownMinutes:
            this.idleShutdownMinutesFor(splitKey(key)[0]) ??
            prev?.idleShutdownMinutes ??
            IDLE_SHUTDOWN_DEFAULT_MINUTES,
          claims: prev?.claims ?? [],
          phase: 'booting',
          // The booting protection expires: a boot that outlives its timeout is a crashed task.
          phaseAtMs: nowMs,
        });
      }
      return keys;
    });
  }

  /**
   * Records that the pair's devices are warm and associated with `lease`. Only the devices
   * named in `booted` get a fresh `bootedAtMs`; one that was already up keeps its clock.
   */
  notePair(
    pair,
    lease,
    { booted = [], platform = lease?.platform ?? 'both' } = {}
  ) {
    const keys = poolKeysForPair(pair);
    const nowMs = this.now();
    return this.withPool((state) => {
      for (const key of keys) {
        const [kind, id] = splitKey(key);
        const prev = state.devices.find((x) => x.key === key);
        const serial =
          kind === 'android' && pair.android?.emulatorPort != null
            ? emulatorSerial(pair.android.emulatorPort)
            : (prev?.serial ?? null);
        const adbPort =
          kind === 'android'
            ? (pair.android?.adbPort ?? prev?.adbPort ?? null)
            : null;
        if (isReservedSerial(serial)) {
          throw new Error(
            `pool refuses to manage ${key}: emulator serial ${serial} is reserved`
          );
        }
        upsertDevice(state, key, {
          key,
          kind,
          id,
          leaseId: lease?.id ?? prev?.leaseId ?? null,
          bootedAtMs:
            booted.includes(key) || prev?.bootedAtMs == null
              ? nowMs
              : prev.bootedAtMs,
          lastUsedMs: nowMs,
          idleShutdownMinutes:
            this.idleShutdownMinutesFor(kind) ??
            prev?.idleShutdownMinutes ??
            IDLE_SHUTDOWN_DEFAULT_MINUTES,
          serial,
          adbPort,
          udid: kind === 'ios' ? id : (prev?.udid ?? null),
          platform,
          phase: null,
          claims: prev?.claims ?? [],
        });
      }
      return keys;
    });
  }

  /**
   * Claims the pair's devices for one run and returns `{ id, keys }`. A device another live
   * pid holds is refused unless `force` is set, which claims it anyway and warns.
   */
  claim({
    pair,
    gate = null,
    platform = 'both',
    force = false,
    pid = process.pid,
    id = claimId(),
  }) {
    const keys = identifiersForPair(pair, platform);
    if (keys.length === 0) return null;
    const conflicts = [];
    this.withPool((state) => {
      const nowMs = this.now();
      for (const key of keys) {
        const entry = upsertDevice(state, key, identityFor(pair, key));
        entry.claims = (entry.claims ?? []).filter((c) =>
          this.isPidAlive(c?.pid)
        );
        const others = entry.claims.filter((c) => c.pid !== pid);
        if (others.length > 0) conflicts.push({ key, claims: others });
        entry.claims = [...entry.claims, { pid, id, gate, at: nowMs }];
        entry.lastUsedMs = nowMs;
      }
      return keys;
    });
    if (conflicts.length > 0 && !force) {
      this.releaseClaim({ keys, pid, id });
      throw new Error(
        `${conflicts.map((x) => x.key).join(', ')} ${conflicts.length > 1 ? 'are' : 'is'} ` +
          `held by ${conflicts
            .flatMap((x) =>
              x.claims.map((c) => `pid ${c.pid}${c.gate ? ` (${c.gate})` : ''}`)
            )
            .join(', ')}.\n` +
          '  two runs on one device fight over the app, Metro and the screenshots.\n' +
          '  wait for it, or set NITRO_UI_GATE_DEVICE_FORCE=1 to claim anyway.'
      );
    }
    for (const x of conflicts) {
      this.log(
        `  WARN ${x.key} is also held by ${x.claims
          .map((c) => `pid ${c.pid}${c.gate ? ` (${c.gate})` : ''}`)
          .join(', ')} - claimed anyway (NITRO_UI_GATE_DEVICE_FORCE=1)`
      );
    }
    return { id, keys, conflicts };
  }

  /**
   * Drops a claim (no keys = all of them) and starts the idle clock from now. With an `id`
   * the claim is matched by id alone, so another process can release it; without one, every
   * claim of `pid` is dropped.
   */
  releaseClaim({ keys = [], pid = process.pid, id = null } = {}) {
    return this.withPool((state) => {
      const nowMs = this.now();
      for (const entry of state.devices) {
        if (keys.length > 0 && !keys.includes(entry.key)) continue;
        const before = entry.claims?.length ?? 0;
        entry.claims = (entry.claims ?? []).filter((c) =>
          id != null ? c.id !== id : c.pid !== pid
        );
        if ((entry.claims?.length ?? 0) !== before) entry.lastUsedMs = nowMs;
      }
      return true;
    });
  }

  /** Drops every claim whose pid is gone. */
  pruneClaims() {
    return this.withPool((state) => {
      let dropped = 0;
      for (const entry of state.devices) {
        const live = (entry.claims ?? []).filter((c) =>
          this.isPidAlive(c?.pid)
        );
        dropped += (entry.claims?.length ?? 0) - live.length;
        entry.claims = live;
      }
      return dropped;
    });
  }

  /** The devices one platform of a pair needs. */
  devicesFor(pair, platform = 'both') {
    const wanted = [];
    if (platform !== 'ios' && pair?.android?.avd) {
      wanted.push({
        kind: 'android',
        key: `avd:${pair.android.avd}`,
        avd: pair.android.avd,
        port: pair.android?.emulatorPort ?? null,
        serial:
          pair.android?.emulatorPort != null
            ? emulatorSerial(pair.android.emulatorPort)
            : null,
        adbPort: pair.android?.adbPort ?? null,
      });
    }
    if (platform !== 'android' && pair?.ios?.udid) {
      wanted.push({
        kind: 'ios',
        key: `ios:${pair.ios.udid}`,
        udid: pair.ios.udid,
      });
    }
    return wanted;
  }

  /**
   * Whether this device is up enough to be reused instead of started: attached and past
   * `sys.boot_completed` for an emulator, `Booted` for a simulator.
   */
  isDeviceUp(w) {
    return w.kind === 'android'
      ? !!w.serial &&
          this.ops.attachedSerials(w.adbPort).includes(w.serial) &&
          this.ops.bootComplete(w.serial, w.adbPort)
      : this.ops.bootedSimulators().includes(w.udid);
  }

  /**
   * Pool keys of this pair whose device is up right now, and so would be reused by the next
   * hand-off. An exclusive acquire leaves these out of its power-off list to avoid a cold
   * boot of the device it is about to use.
   */
  upKeysFor(pair, platform = 'both') {
    return this.devicesFor(pair, platform)
      .filter((w) => this.isDeviceUp(w))
      .map((w) => w.key);
  }

  /**
   * Brings the pair's devices up and waits until each is attached and the machine's load has
   * settled. Never throws: a device that will not come up is reported in `degraded`.
   */
  ensureBooted(
    pair,
    lease,
    { platform = 'both', timeoutMs = DEVICE_SETTLE_TIMEOUT_MS } = {}
  ) {
    const wanted = this.devicesFor(pair, platform);

    const startedAt = this.now();
    const already = new Set();
    const isUp = (w) => this.isDeviceUp(w);

    const booted = [];
    // A boot the tool refused outright is not polled for.
    const refused = new Set();
    for (const w of wanted) {
      if (isUp(w)) {
        already.add(w.key);
        this.log(
          `  ${w.kind} device ${w.udid ?? `${w.avd}:${w.port}`} is already up - reusing it`
        );
        continue;
      }
      this.log(
        `  booting ${w.kind} device ${w.udid ?? `${w.avd}:${w.port ?? 'auto'}`}`
      );
      const started =
        w.kind === 'android'
          ? this.ops.bootEmulator({
              avd: w.avd,
              port: w.port,
              adbPort: w.adbPort,
            })
          : this.ops.bootSimulator(w.udid);
      if (!started) {
        refused.add(w.key);
        this.log(`  WARN ${w.kind} device ${w.key}: the boot was refused`);
        continue;
      }
      booted.push(w.key);
    }

    const deadline = startedAt + timeoutMs;
    const degraded = [...refused];
    // Marked as booting before the wait, which can take minutes: `notePair` only stamps the
    // new lease and clock when the wait ends.
    if (wanted.some((w) => !already.has(w.key) && !refused.has(w.key))) {
      this.markBooting(pair, lease, { platform });
    }
    for (const w of wanted) {
      if (already.has(w.key) || refused.has(w.key)) continue;
      let ok = false;
      while (this.now() < deadline) {
        ok = isUp(w);
        if (ok) break;
        this.sleep(this.pollMs);
      }
      if (!ok) {
        degraded.push(w.key);
        this.log(
          `  WARN ${w.kind} device ${w.udid ?? w.avd} did not settle in ` +
            `${Math.round((this.now() - startedAt) / 1000)}s`
        );
      }
    }

    const settled = this.waitForLoadToSettle({ deadlineMs: deadline });
    this.notePair(pair, lease, { booted, platform });
    return {
      booted,
      already: [...already],
      degraded,
      loadSettled: settled.settled,
      load: settled.load,
      waitedMs: this.now() - startedAt,
    };
  }

  /**
   * Waits for the 1-minute load to fall under the settle ceiling, and gives up with a warning
   * at the timeout. `NITRO_UI_LOAD_SETTLE_TIMEOUT_MS` shortens the wait; `0` skips it after
   * one reading.
   */
  waitForLoadToSettle({ deadlineMs, timeoutMs = this.settleTimeoutMs } = {}) {
    const ceiling = loadSettleCeiling(this.cores);
    const start = this.now();
    const stop = Math.min(deadlineMs ?? Infinity, start + timeoutMs);
    let load = this.readLoad();
    while (load >= ceiling && this.now() < stop) {
      this.sleep(this.pollMs);
      load = this.readLoad();
    }
    const settled = load < ceiling;
    if (!settled) {
      this.log(
        `  WARN load average ${load.toFixed(2)} is still above the settle ceiling ` +
          `${ceiling} after ${Math.round((this.now() - start) / 1000)}s - continuing anyway`
      );
    }
    return { settled, load, ceiling, waitedMs: this.now() - start };
  }

  /**
   * The state a power-off decision is made against, read in one lock hold: the record and the
   * identifiers every live lease holds. Read again immediately before each power-off, because
   * the previous device's I/O can take minutes and a lease or claim may arrive meanwhile. The
   * lock is not held across the power-off itself.
   *
   * @returns {{entry: object | null, held: Set<string>}}
   */
  deviceState(key, { exceptLeaseId = null } = {}) {
    return this.withPool((state) => {
      const leasesNow = this.leases();
      return {
        entry: state.devices.find((x) => x.key === key) ?? null,
        held: this.heldIdentifiers({ leases: leasesNow }),
        heldForced: this.heldIdentifiers({
          leases: leasesNow,
          exceptLeaseId,
        }),
      };
    });
  }

  /**
   * Whether this device may still be powered off, answered from a fresh read. `forced` says
   * the caller named this device in `shutdownKeys`, which is judged against the hold set that
   * exempts `exceptLeaseId`.
   */
  canActOnKey(key, { forced = false, exceptLeaseId = null } = {}) {
    const nowMs = this.now();
    const { entry, held, heldForced } = this.deviceState(key, {
      exceptLeaseId,
    });
    const heldSet = forced ? heldForced : held;
    if (entry == null) return { allowed: true, held: heldSet, entry: null };
    if (deviceIsBusy(entry, nowMs, this.isPidAlive)) {
      const live = (entry.claims ?? []).find((c) => this.isPidAlive(c?.pid));
      return {
        allowed: false,
        held: heldSet,
        entry,
        why:
          entry.phase === 'booting'
            ? 'a boot is in flight'
            : `in use by pid ${live?.pid}${live?.gate ? ` (${live.gate})` : ''}`,
      };
    }
    if (heldSet.has(entry.id)) {
      return {
        allowed: false,
        held: heldSet,
        entry,
        why: 'a live lease holds it',
      };
    }
    return { allowed: true, held: heldSet, entry };
  }

  /**
   * Powers off every pool device that has outlived its idle limit, and reports what it did.
   * `shutdownKeys` (`acquire --exclusive`) is the caller's way of saying "these ones now".
   *
   * Three passes, in this order:
   *
   *  1. plan, under the lease lock, with no device I/O: decides which devices are worth
   *     looking at and authorises nothing;
   *  2. act: for each, re-read under a brief lock (`canActOnKey`) and power off only what is
   *     still unheld and unclaimed, with the lock released before the command;
   *  3. drop the records of devices that are actually off.
   *
   * With no devices.json loaded nothing is reapable: the pool only shuts down devices the
   * machine declared.
   */
  reap({
    idleMinutes,
    shutdownKeys = [],
    reason = 'idle',
    exceptLeaseId = null,
  } = {}) {
    if (this.devices?.pairs == null) {
      return {
        reaped: [],
        kept: [],
        alreadyOff: [],
        failed: [],
        refused: [],
        skipped:
          "no devices.json loaded, so nothing is declared as this machine's pool",
      };
    }
    const nowMs = this.now();
    // Checked read-only, before the first `withPool`: that would replace an unreadable file
    // with an empty state.
    const unreadable = this.poolStateReadable();
    if (!unreadable.ok) {
      return {
        reaped: [],
        kept: [],
        alreadyOff: [],
        failed: [],
        refused: [],
        skipped: poolRecoverySkip({
          from: unreadable.file,
          reason: unreadable.reason,
        }),
      };
    }
    this.pruneClaims();
    // Pass 1: which devices are worth acting on.
    const plan = this.withPool((state) => {
      if (state.recovered != null) {
        return {
          aborted: poolRecoverySkip(state.recovered),
          planned: [],
          decided: { kept: [], refused: [] },
          keys: [],
        };
      }
      const leasesNow = this.leases();
      // Two hold sets. `held` counts every live lease, the caller's own included, and
      // governs the idle path. `heldForced` exempts `exceptLeaseId` and applies only to
      // devices named in `shutdownKeys`: an exclusive lease holds every pair and would
      // otherwise reap nothing.
      const held = this.heldIdentifiers({ leases: leasesNow, nowMs });
      const heldForced = this.heldIdentifiers({
        leases: leasesNow,
        nowMs,
        exceptLeaseId,
      });
      const planned = [];
      const decided = { kept: [], refused: [] };
      for (const entry of [...state.devices]) {
        if (isReservedSerial(entry.serial)) {
          decided.refused.push({
            key: entry.key,
            serial: entry.serial,
            why: 'reserved serial',
          });
          continue;
        }
        if (!this.isPoolDevice(entry)) {
          decided.refused.push({ key: entry.key, why: 'not in devices.json' });
          continue;
        }
        const forced = shutdownKeys.includes(entry.key);
        const heldSet = forced ? heldForced : held;
        // A pair another live lease holds is off-limits even when named in `shutdownKeys`.
        if (heldSet.has(entry.id)) {
          decided.kept.push({
            key: entry.key,
            reason: 'lease-held',
            idleMinutes: Math.round(
              Math.max(
                0,
                nowMs -
                  Math.max(entry?.bootedAtMs ?? nowMs, entry?.lastUsedMs ?? 0)
              ) / 60_000
            ),
          });
          continue;
        }
        // An explicit `idleMinutes` overrides devices.json for this call. It never reaches a
        // pair a live lease holds: those were kept above.
        const decision = poolReapDecision(entry, {
          nowMs,
          leases: leasesNow,
          defaultIdleMinutes:
            this.idleShutdownMinutesFor(entry.kind) ?? idleMinutes,
          overrideIdleMinutes: idleMinutes,
          isPidAlive: this.isPidAlive,
        });
        if (!forced && decision.action === 'keep') {
          decided.kept.push({
            key: entry.key,
            reason: decision.reason,
            idleMinutes: Math.round(decision.idleMs / 60_000),
          });
          continue;
        }
        // The hold sets are not carried into the plan: pass 2 reads them fresh.
        planned.push({ entry, decision, forced });
      }
      return { planned, decided, keys: state.devices.map((x) => x.key) };
    });
    if (plan.aborted != null) {
      return {
        reaped: [],
        kept: [],
        alreadyOff: [],
        failed: [],
        refused: [],
        skipped: plan.aborted,
      };
    }

    const done = {
      reaped: [],
      alreadyOff: [],
      failed: [],
      refused: [],
      ...plan.decided,
    };

    // Pass 2: the device I/O, outside the lock, each device preceded by its own re-read.
    const offKeys = [];
    for (const { entry, decision, forced } of plan.planned) {
      const live = this.canActOnKey(entry.key, { forced, exceptLeaseId });
      if (!live.allowed) {
        this.log(
          `  ${entry.key}: ${live.why} since the reap started - left up`
        );
        done.kept.push({
          key: entry.key,
          reason: live.why,
          idleMinutes: Math.round(decision.idleMs / 60_000),
        });
        continue;
      }
      const outcome = this.shutdownDevice(live.entry ?? entry, {
        reason: forced ? reason : decision.reason,
        held: live.held,
      });
      if (outcome === 'off' || outcome === 'already') {
        offKeys.push(entry.key);
        if (outcome === 'off')
          done.reaped.push({ key: entry.key, reason: decision.reason });
        else done.alreadyOff.push({ key: entry.key });
      } else if (outcome === 'refused') {
        done.refused.push({
          key: entry.key,
          why: 'refused (see the log above)',
        });
      } else {
        done.failed.push({ key: entry.key, reason: decision.reason });
      }
    }

    // A named device with no record may still be up: something booted it outside the pool.
    // Its identity comes from devices.json.
    const seen = new Set(plan.keys);
    for (const key of shutdownKeys) {
      if (seen.has(key)) continue;
      const declared = this.declaredEntry(key);
      if (declared == null) continue;
      const live = this.canActOnKey(key, { forced: true, exceptLeaseId });
      if (live.held.has(declared.id)) {
        done.kept.push({ key, reason: 'lease-held', idleMinutes: 0 });
        continue;
      }
      if (!live.allowed) {
        this.log(`  ${key}: ${live.why} - left up`);
        done.kept.push({ key, reason: live.why, idleMinutes: 0 });
        continue;
      }
      const outcome = this.shutdownDevice(declared, {
        reason,
        held: live.held,
      });
      if (outcome === 'off') done.reaped.push({ key, reason });
      else if (outcome === 'already') done.alreadyOff.push({ key });
      else if (outcome === 'refused')
        done.refused.push({ key, why: 'refused (see the log above)' });
      else done.failed.push({ key, reason });
    }

    // Pass 3: forget the records of devices this pass shut down or found off.
    if (offKeys.length > 0) {
      this.withPool((state) => {
        state.devices = state.devices.filter(
          (x) =>
            !offKeys.includes(x.key) ||
            deviceIsBusy(x, this.now(), this.isPidAlive)
        );
        return true;
      });
    }
    return done;
  }

  /** Every pool key devices.json declares. */
  keysForPool() {
    return (this.devices?.pairs ?? []).flatMap((pair) => poolKeysForPair(pair));
  }

  /**
   * A pool record for a key devices.json declares but `pool.json` has never seen: a pool
   * device that something else booted. It carries no lease and no timestamps.
   */
  declaredEntry(key) {
    const [kind, id] = splitKey(key);
    const expected = this.pairFor({ kind, id });
    if (expected == null) return null;
    return {
      key,
      kind,
      id,
      leaseId: null,
      claims: [],
      serial: expected.serial ?? null,
      adbPort: expected.adbPort ?? null,
      udid: expected.udid ?? null,
    };
  }

  /** The identity `devices.json` gives this pool key: the only one a power-off acts on. */
  pairFor(entry) {
    if (entry?.kind === 'ios') {
      const pair = (this.devices?.pairs ?? []).find(
        (x) => x.ios?.udid === entry.id
      );
      return pair ? { udid: pair.ios.udid } : null;
    }
    const pair = (this.devices?.pairs ?? []).find(
      (x) => x.android?.avd === entry.id
    );
    if (pair?.android?.avd == null) return null;
    return {
      serial:
        pair.android.serial ??
        (pair.android.emulatorPort != null
          ? emulatorSerial(pair.android.emulatorPort)
          : null),
      adbPort: pair.android.adbPort ?? null,
    };
  }

  /**
   * Every device identifier a live lease holds: AVD names, UDIDs, and the serials its console
   * ports imply. `exceptLeaseId` exempts one lease from its own protection, for the exclusive
   * power-off only.
   */
  heldIdentifiers({
    leases = this.leases(),
    nowMs = this.now(),
    exceptLeaseId = null,
  } = {}) {
    const held = new Set();
    for (const lease of leases ?? []) {
      if (exceptLeaseId != null && lease.id === exceptLeaseId) continue;
      if (!leaseIsLive(lease, nowMs)) continue;
      for (const pairId of lease.holds ?? []) {
        const pair = (this.devices?.pairs ?? []).find((p) => p.id === pairId);
        if (pair == null) continue;
        for (const id of identifiersFor(pair, 'both')) held.add(id);
        if (pair.android?.emulatorPort != null) {
          held.add(emulatorSerial(pair.android.emulatorPort));
        }
      }
    }
    return held;
  }

  /** @returns {'off' | 'already' | 'failed' | 'refused'} */
  shutdownDevice(entry, { reason = 'idle', held = null } = {}) {
    if (!entry) return 'already';
    if (!this.isPoolDevice(entry)) return 'refused';
    if (isReservedSerial(entry.serial)) return 'refused';
    if (deviceIsBusy(entry, this.now(), this.isPidAlive)) {
      this.log(`  ${entry.key}: still claimed, leaving it up`);
      return 'failed';
    }
    // Never act on a stored serial: `pool.json` can be stale. The pair decides the identity,
    // no live lease may hold it, and the device confirms who it is before it is powered off.
    const expected = this.pairFor(entry);
    if (expected == null) {
      this.log(`  refused ${entry.key}: devices.json does not name it`);
      return 'refused';
    }
    const heldIds = held ?? this.heldIdentifiers();
    if (entry.kind === 'ios') {
      const udid = entry.udid ?? entry.id;
      if (udid !== expected.udid) {
        this.log(
          `  refused ${entry.key}: the record says simulator ${udid}, devices.json says ${expected.udid}`
        );
        return 'refused';
      }
      if (heldIds.has(udid)) {
        this.log(`  refused ${entry.key}: a live lease holds that simulator`);
        return 'refused';
      }
      // "simctl did not answer" is `failed`, which keeps the record; only "not in the booted
      // list" is `already`.
      const booted = this.ops.bootedSimulatorsOrNull();
      if (booted == null) {
        this.log(
          `  ${entry.key}: simctl did not answer, so the simulator's state is unknown - left alone`
        );
        return 'failed';
      }
      if (!booted.includes(udid)) return 'already';
      this.log(`  shutting down simulator ${udid} (${reason})`);
      return this.ops.shutdownSimulator(udid) ? 'off' : 'failed';
    }
    const serial = expected.serial;
    if (serial == null) {
      this.log(`  refused ${entry.key}: devices.json gives it no console port`);
      return 'refused';
    }
    if (entry.serial != null && entry.serial !== serial) {
      // A warning, not a refusal: nothing rewrites a record until its device is next handed
      // out, so refusing here would make the device unreapable.
      this.log(
        `  ${entry.key}: the record says ${entry.serial}, devices.json says ${serial} - using the pair's, and asking the device`
      );
    }
    if (isReservedSerial(serial)) return 'refused';
    if (heldIds.has(entry.id) || heldIds.has(serial)) {
      this.log(`  refused ${entry.key}: a live lease holds that pair`);
      return 'refused';
    }
    // An adb that did not answer is not an emulator that is off.
    const attached = this.ops.attachedSerialsResult(expected.adbPort);
    if (!attached.ok) {
      this.log(
        `  ${entry.key}: adb did not answer (${attached.answer}), so the emulator's state is unknown - left alone`
      );
      return 'failed';
    }
    if (!attached.serials.includes(serial)) return 'already';
    const who = this.ops.emulatorAvdName(serial, expected.adbPort);
    if (who !== entry.id) {
      this.log(
        `  refused ${entry.key}: ${serial} answers to AVD ${who ?? '(no answer)'}, not ${entry.id}`
      );
      return 'refused';
    }
    this.log(`  shutting down emulator ${serial} (${reason})`);
    return this.ops.shutdownAndroid(serial, expected.adbPort)
      ? 'off'
      : 'failed';
  }

  /** Whether the pool may power this device off: with devices.json loaded, only if named there. */
  isPoolDevice(entry) {
    if (!entry?.id) return false;
    if (this.devices?.pairs == null) return true;
    return this.devices.pairs.some((pair) =>
      entry.kind === 'ios'
        ? pair.ios?.udid === entry.id
        : pair.android?.avd === entry.id
    );
  }

  /** What `lease.mjs list` prints: one row per warm device, with who is holding it. */
  summary() {
    const state = readPool(this.home);
    const leases = this.leases();
    const nowMs = this.now();
    return state.devices.map((x) => {
      const lease = leases.find((l) => l.id === x.leaseId);
      const live = (x.claims ?? []).filter((c) => this.isPidAlive(c?.pid));
      return {
        ...x,
        idleMinutes: Math.round(
          (nowMs - Math.max(x.bootedAtMs ?? 0, x.lastUsedMs ?? 0)) / 60_000
        ),
        leaseTask: lease?.task ?? null,
        busy: live.length > 0,
        claims: live,
      };
    });
  }
}

function claimId(pid = process.pid) {
  return `${pid.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * The pair a lease's env file describes, so a process that sourced a lease can find its own
 * devices without reading leases.json.
 */
export function pairFromEnv(env = process.env) {
  const port = Number(env.EMULATOR_PORT);
  const adbPort = Number(env.ANDROID_ADB_SERVER_PORT);
  return {
    id: 'env',
    ios: env.IOS_SIM_UDID ? { udid: env.IOS_SIM_UDID } : null,
    android: env.ANDROID_AVD
      ? {
          avd: env.ANDROID_AVD,
          emulatorPort: Number.isInteger(port) ? port : null,
          serial:
            env.ANDROID_SERIAL ??
            (Number.isInteger(port) ? emulatorSerial(port) : null),
          // The adb server that can see this device.
          adbPort: Number.isInteger(adbPort) ? adbPort : null,
        }
      : null,
  };
}

/**
 * Claims the current lease's devices for one command, or returns null when the environment
 * names no devices. `platform` is the caller's and is intersected with the lease's: an iOS run
 * under a `both` lease claims the simulator only.
 */
export function claimDevicesFromEnv({
  pool,
  env = process.env,
  gate = null,
  force = false,
  platform = null,
} = {}) {
  const pair = pairFromEnv(env);
  if (pair.ios == null && pair.android == null) return null;
  const instance = pool ?? new DevicePool({ env });
  const claim = instance.claim({
    pair,
    gate,
    platform: intersectPlatforms(
      platform ?? env.NITRO_UI_LEASE_PLATFORM ?? 'both',
      env.NITRO_UI_LEASE_PLATFORM ?? 'both'
    ),
    force,
  });
  return claim == null ? null : { ...claim, pool: instance };
}

/** `both` ∩ `ios` is `ios`; two `both`s stay `both`. */
function intersectPlatforms(a, b) {
  if (a === b) return a;
  if (a === 'both') return b;
  if (b === 'both') return a;
  // Two different platforms asked for: honour the narrower caller (the claim is for `a`).
  return a;
}

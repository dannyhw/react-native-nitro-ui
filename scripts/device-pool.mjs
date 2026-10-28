#!/usr/bin/env node
/**
 * The warm device pool (X11).
 *
 * Booting a device is the most expensive thing a task does by accident. A paired AVD takes tens of
 * seconds; an iOS 27 simulator takes minutes and drives this 10-core machine's 1-minute load to
 * peaks of 58-74 on the way up (measured over four cold boots, X11 report item 6 - and still 16-21
 * after 150 s, well above the bench's settle ceiling of 5). Tasks used to boot their devices, run
 * one suite and power them down, so nothing was ever reused and every run re-paid the boot. This
 * module owns the alternative: a device that is already booted stays booted and is handed to the
 * next lease, and **only this module powers pool devices off**.
 *
 * The rules, in one place:
 *
 *  - `lease.mjs acquire --boot` boots the pair it hands out and waits until each device is attached
 *    and the machine's load is under the settle ceiling (or a timeout passes, with a warning);
 *  - the harness leaves a device it was handed alone: it shuts an emulator down only when it started
 *    that emulator itself (`instance.js`'s `startedByHarness`), so a warm device a lease handed over
 *    leaves a run booted. The patch's contribution is on the other side - when the harness does have
 *    to boot one, it lands on the leased console port and this repo's GPU mode (X11 review N5: the
 *    patch does not touch `dispose`, and does not need to);
 *  - a gate claims its lease's devices for the length of its run. A claim is a pid, and a dead pid
 *    is not a claim: that is the whole concurrency protocol, so a reaper never has to trust a
 *    clean exit and a killed task cannot wedge a device as "in use" forever;
 *  - a device a *live lease* holds is never powered off on a timer, and `--idle-minutes` does not
 *    override that either (X11 review M3): a build, a Metro session, a real-input run or a person
 *    reading a stack trace make no claim, and 31 minutes of that is ordinary work, not a leak;
 *  - `lease.mjs reap` powers a device off once it has been idle past `idleShutdownMinutes`
 *    (devices.json, default 30) and no live lease holds it - never while a claim is live, and never
 *    on the strength of a stored serial: it derives the device's identity from devices.json and has
 *    the emulator confirm it (`emu avd name`) before anything is powered off (X11 review M4);
 *  - `acquire --exclusive` hands a bench a quiet machine and does so whether or not `--boot` was
 *    passed (X11 review M6). There is no `release --exclusive` - releasing leaves devices warm.
 *
 * State is per-machine, beside the leases it references:
 *
 *   ~/.nitro-ui/pool.json   one record per device this pool has booted
 *
 * Decisions are taken under the *same* `leases.lock` as `leases.json` - which is what keeps "does
 * anyone own this device?" answerable without a second source of truth - but the device I/O a reap
 * does (each one a spawn of up to two minutes) happens with the lock released, so a slow shutdown
 * cannot fail another task's `acquire` (X11 review N1).
 *
 * Devices come from `devices.json` and nowhere else: the same list the lease hands out is the only
 * list anything may shut down. A device that is booted but not named there is somebody else's -
 * most often `emulator-5560`, which the person owns - and `scripts/doctor-core.mjs` reports those
 * as unowned rather than the pool adopting them.
 *
 * Everything here is synchronous, like the rest of the lease tooling: waiting on a boot is a
 * `sleepMs` poll of `adb devices` / `simctl list`, and the tests inject both the clock and the
 * device operations, so no test needs a device.
 */

import { spawn, spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, renameSync } from 'node:fs';
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

/** `Number(x)` when it is a positive finite number, else null (env knobs are strings or absent). */
function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** As above, and `0` is a real answer ("do not wait at all"), so the test cannot be truthiness. */
function nonNegativeNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * The example app's id, for the between-task reset. Both platforms use the same application id
 * (`example/android/app/build.gradle`, `PRODUCT_BUNDLE_IDENTIFIER`), so one value per platform is
 * spelled out rather than shared, in case they ever split.
 */
export const EXAMPLE_APP_ID = {
  android: 'nitroui.example',
  ios: 'nitroui.example',
};

export function poolStatePath(home = stateHome()) {
  return join(home, POOL_FILE);
}

/**
 * The pool state, or an empty one.
 *
 * A file nobody can parse is moved aside rather than ignored. That is the difference between a
 * pool that quietly forgets two warm devices (the leak: they hold a pair each, they are never
 * reaped, and `list` shows nothing) and one that says where the evidence went; the file is kept
 * because the only copy of "what was booted and by whom" is that JSON.
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
      // A file we cannot move (permissions, or it vanished) still must not make every pool
      // command fail: the next write replaces it, and the reason is in the message either way.
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
 * A pool key's prefix and platform are different words: keys read `avd:nitro-ui-a` because that is
 * what a human scanning `lease.mjs list` recognises, while every decision in this file branches on
 * the *platform* (`android`, `ios`). Translating here, in one place, is what keeps a `kind ===
 * 'android'` check from quietly never matching - which it did, and meant a device was recorded
 * with no serial and no reservation check at all.
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

/** The pool key prefix each platform's devices are stored under. */
export const KEY_PREFIX = { android: 'avd', ios: 'ios' };

/** The pool key for one device of a pair. */
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
 * Device operations, overridable so a test can prove the rules without a machine. The defaults are
 * the real binaries; `NITRO_UI_ADB_BIN` / `NITRO_UI_SIMCTL_BIN` point them at a stub, exactly as
 * `scripts/doctor.mjs` and the `list` unowned-device check already do.
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
   * Runs `adb`, on the adb *server* that owns the device.
   *
   * Every lease gets a private server (`ANDROID_ADB_SERVER_PORT`), and an adb server only lists
   * the devices it knows about - so asking the wrong one "is emulator-5574 up?" answers *no* about
   * a device that is running fine. That is why the port travels with the device (from
   * devices.json's `adbPort`) instead of being read from whoever's shell is asking: a reaper that
   * believed a "no" would forget a live emulator, and the machine would be left holding a boot
   * nobody owns.
   *
   * @param {string[] | null} args
   * @param {number | string | null} [adbPort]
   */
  function adb(args, adbPort = null) {
    const serverPort = adbPort ?? env.ANDROID_ADB_SERVER_PORT ?? null;
    return spawnSync(
      adbBin,
      serverPort ? ['-P', String(serverPort), ...args] : args,
      { encoding: 'utf8', timeout: 120_000 }
    );
  }

  function simctl(args) {
    return spawnSync(simctlBin, ['simctl', ...args], {
      encoding: 'utf8',
      timeout: 300_000,
    });
  }

  const out = (res) => (res?.stdout ?? '').trim();

  /** A simctl mutation's outcome: it prints nothing on success and the problem on stderr. */
  function simctlResult(res, onOk) {
    const answer =
      out(res) ||
      String(res?.stderr ?? '')
        .split('\n')
        .find(Boolean)
        ?.trim() ||
      '';
    return {
      ok: res?.status === 0,
      answer:
        answer || (res?.status === 0 ? onOk : `exit ${String(res.status)}`),
    };
  }

  return {
    adb,
    simctl,

    /** Serials the adb server reports as online (`adb devices`, state `device`). */
    attachedSerials(adbPort = null) {
      return out(adb(['devices'], adbPort))
        .split('\n')
        .slice(1)
        .map((line) => line.trim().split(/\s+/))
        .filter(
          ([serial, state]) =>
            serial?.startsWith('emulator-') && state === 'device'
        )
        .map(([serial]) => serial);
    },

    /**
     * Which AVD is actually sitting behind this serial, answered by the device itself
     * (`adb -s <serial> emu avd name`).
     *
     * This is the last gate before `emu kill` (X11 review M4). Everything else the reaper knows
     * about a device is a record of what somebody *said* about it — `pool.json`, or devices.json's
     * port table, which gets renumbered. This is the one thing it can ask the emulator, and a
     * device that will not answer to the AVD the pool means is never killed on the pool's say-so.
     *
     * `emulator-5554\tDevice\n` is the answer on a device whose console is not ready yet, and no
     * AVD is named, which is a refusal too: an emulator you cannot identify is not one you get to
     * power off.
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

    /**
     * Removes the app from a simulator, which takes its data container with it.
     *
     * This is the iOS reset (X11 review M2). What the pool used to report instead — "none needed,
     * `simctl install` replaces the app container" — is false, and the repo's own patch to
     * `platform-apple` says so in its installed code: "`simctl install` is fast and keeps the app
     * container". So a task's `NSUserDefaults` and Documents survived into the next task's run on
     * the same pooled simulator, while `lease` printed a row saying the reset was satisfied.
     *
     * `simctl` prints nothing on success and the problem on stderr, so the answer is read from both.
     */
    uninstallSimulatorApp(udid, appId) {
      return simctlResult(simctl(['uninstall', udid, appId]), 'uninstalled');
    },

    /** Re-installs a bundle the reset just removed, so a device leaves the pool ready, not empty. */
    installSimulatorApp(udid, appPath) {
      return simctlResult(simctl(['install', udid, appPath]), 'installed');
    },

    /**
     * Where a simulator keeps an installed app's data, or null when it has none
     * (`simctl get_app_container <udid> <bundle> data`).
     *
     * This is what makes the iOS reset *provable* rather than promised: an uninstall that worked
     * leaves no container to find, so the reset checks the device after the fact instead of trusting
     * an exit code. It is also the hook the completeness proof writes its marker through.
     */
    simulatorDataContainer(udid, appId) {
      const res = simctl(['get_app_container', udid, appId, 'data']);
      const found = out(res);
      return res?.status === 0 && found !== '' ? found : null;
    },

    bootComplete(serial, adbPort = null) {
      return (
        out(
          adb(['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], adbPort)
        ) === '1'
      );
    },

    /**
     * The cheapest reset that reports what it did: `adb -s <serial> shell pm clear <appId>`, which
     * wipes the app's data directory and leaves the installed bundle alone.
     *
     * The `shell` is not decoration. `pm` is a *device-side* command, so `adb -s X pm clear Y` —
     * what this line used to build — answers `adb: unknown command pm` on stderr, empty stdout and
     * exit 1 on every device, forever. The retry loop then looked like a device that would not
     * clear, four times, and the log said "pm clear FAILED (no answer)" instead of "this command
     * was never a command".
     *
     * `pm clear` answers `Success` or `Failure`/`Failed` on stdout, and the answer is returned
     * rather than reduced to a boolean: a reset that failed has to say which, because a device
     * still coming up and a package that is not installed need different things from whoever reads
     * the line. An empty stdout with a non-zero exit is reported with its exit code for the same
     * reason — that combination is how a *malformed* command answers, as opposed to a refused one.
     */
    clearAppData(serial, appId, adbPort = null) {
      const res = adb(['-s', serial, 'shell', 'pm', 'clear', appId], adbPort);
      const answer = out(res);
      return {
        ok: /Success/i.test(answer),
        answer: answer || `(no answer, exit ${String(res.status)})`,
      };
    },

    shutdownAndroid(serial, adbPort = null) {
      const res = adb(['-s', serial, 'emu', 'kill'], adbPort);
      log(`  emulator ${serial}: shutdown (${out(res) || 'emu kill'})`);
      return res.status === 0;
    },

    /** Every simulator `simctl` knows about, by udid, with its state. */
    simulators() {
      const res = simctl(['list', '-j', 'devices']);
      let groups = {};
      try {
        groups = JSON.parse(out(res) || '{}')?.devices ?? {};
      } catch {
        return new Map();
      }
      const byUdid = new Map();
      for (const list of Object.values(groups)) {
        for (const x of list ?? []) {
          const udid = x?.udid ?? x?.identifier;
          if (udid) byUdid.set(udid, x?.state ?? 'Shutdown');
        }
      }
      return byUdid;
    },

    bootedSimulators() {
      return [...this.simulators().entries()]
        .filter(([, state]) => state === 'Booted')
        .map(([udid]) => udid);
    },

    /**
     * Boots a simulator *headlessly*.
     *
     * Not `open -a Simulator`: on Xcode 27 that opens Simulator.app, which asks DeviceKit for its
     * default device and boots that one too - a device no lease handed out, which is precisely the
     * class of unowned background load the pool exists to remove. A pooled simulator needs no
     * window: the harness drives it over `simctl`, and anything a human watches opens its own.
     *
     * "Unable to boot device in current state: Booted" counts as success: it is what racing the
     * harness's own boot prints, and the caller's next check would agree with it.
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
     * Starts an emulator detached, from the one launch configuration (`scripts/emulator-launch.mjs`),
     * and returns at once: the caller waits on `adb devices`, not on this process. Its log lives
     * beside the pool state, so "why did that boot fail" has an answer after the shell is gone.
     */
    bootEmulator({ avd, port }) {
      const args = emulatorLaunchArgs({
        avd,
        port,
        gpuMode: emulatorGpuMode(env),
      });
      const logDir = join(dirname(poolStatePath(home)), 'logs');
      mkdirSync(logDir, { recursive: true });
      const logFile = join(logDir, `emulator-${port ?? 'auto'}-${now()}.log`);
      try {
        const fd = openSync(logFile, 'a');
        const child = spawn(env.EMULATOR_BIN || 'emulator', args, {
          detached: true,
          stdio: ['ignore', fd, fd],
          env,
        });
        child.unref();
        closeSync(fd);
        log(
          `  emulator ${avd}${port ? `:${port}` : ''}: boot requested ` +
            `(gpu ${emulatorGpuMode(env)}, log ${logFile})`
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
 * The pool, bound to one machine's state directory. Every method is safe to call from any script:
 * state is read-modify-written under the lease lock, and device operations are best-effort with
 * their outcome logged rather than thrown - a device that will not shut down is a warning, not a
 * failed command.
 */
/**
 * What a pool key *is* on this machine, from the pair that names it: the serial to address an
 * emulator with, the adb server that can see it, the UDID of a simulator.
 *
 * The serial is *derived* from the pair's console port, never copied from whoever's shell is
 * writing the record (X11 review M4). `claim()` runs in a gate's process, where `ANDROID_SERIAL` is
 * whatever that process had in its environment — and a record whose serial belongs to a different
 * pair is a reaper's `emu kill` aimed at somebody else's emulator. `shutdownDevice` now re-derives
 * identity from devices.json before it acts, so a record with no serial is workable again (it used
 * to be read as "already off"), which means the env's version has no job here. A disagreement is
 * worth printing, not worth trusting.
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
    // Poll and settle waits are injectable *and* env-tunable: the device loop wants a calm 2 s, and
    // a test or a CI runner wants to be allowed to hurry. `NITRO_UI_LEASE_POLL_MS` is the same knob
    // the lease CLI already reads, so one variable speeds up both.
    this.pollMs = positiveNumber(env.NITRO_UI_LEASE_POLL_MS) ?? DEVICE_POLL_MS;
    this.settleTimeoutMs =
      nonNegativeNumber(env.NITRO_UI_LOAD_SETTLE_TIMEOUT_MS) ??
      LOAD_SETTLE_TIMEOUT_MS;
    this.ops = ops ?? deviceOperations({ home, env, now, log });
  }

  /** Live leases (`pruneExpired` has already run when a command calls this). */
  leases() {
    return (
      readJson(join(this.home, 'leases.json'), { leases: [] }).leases ?? []
    );
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

  /** `idleShutdownMinutes` from the loaded devices.json, or undefined to fall through to the default. */
  idleShutdownMinutesFor(kind) {
    const value = this.devices?.idleShutdownMinutes;
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? value
      : undefined;
  }

  /**
   * Writes the pair's records with `phase: 'booting'` *before* a boot starts, so the minutes it
   * spends coming up are covered (X11 review M3).
   *
   * The field existed and was read by `deviceIsBusy` but never written, which made it a comment: a
   * warm reuse of a record whose timestamps were already past the idle limit could be powered off
   * by another task's reap during the up-to-`settleTimeoutMs` wait, because `notePair` only refreshes
   * those timestamps once the wait is over. The phase is cleared by `notePair` on the way out.
   *
   * Identity comes from the pair, exactly as `notePair` will write it, so the record this leaves
   * behind on a failed boot is a record the reaper can still reason about.
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
          // The clock the protection is measured against (`deviceIsBusy`): a boot that outlives its
          // own timeout is a crashed task, not a boot in progress.
          phaseAtMs: nowMs,
        });
      }
      return keys;
    });
  }

  /**
   * Records that the pair's devices are warm and associated with `lease`.
   *
   * `booted` names the devices this call actually started: only those get a fresh `bootedAtMs`. A
   * device that was already up keeps the clock it had, so a warm hand-off does not restart an idle
   * timer that was already running towards its shutdown.
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
          // `assertLeasable` refuses such a pair before a lease exists; this is the pool's own
          // refusal, so a devices.json edit cannot make the pool the second path to that device.
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
          // The boot is over: this is the line that ends the `markBooting` window above, so a
          // device that came up is never stuck being "booting" (and off the idle clock) forever.
          phase: null,
          claims: prev?.claims ?? [],
        });
      }
      return keys;
    });
  }

  /**
   * Claims the pair's devices for one run and returns `{ id, keys }`.
   *
   * A device another live pid holds is refused, with the pid and gate in the message: two gates on
   * one device fight over the app, Metro and the screenshots, and both go red for a reason no log
   * explains. `force` (a gate's `NITRO_UI_GATE_DEVICE_FORCE=1`) takes it anyway and warns - two
   * commands of one task on one pair is legitimate (a build finishing while a run waits), and the
   * pool should not be the thing that surprises you about it.
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
   * Drops a claim (no keys = all of them), and starts the idle clock from here: a 50-minute run
   * that released at the end is idle from then, not from when it started - otherwise a long enough
   * run would be reaped the second it finished.
   *
   * With an `id` the claim object itself is the token, so it is what identifies the claim; pid is
   * the fallback for "drop whatever this process holds" on the way out, including after a crash
   * left claims behind. Matching on `pid && id` instead would make a release from a different
   * pid (a wrapper reaping its child's claim) a silent no-op, which is a device stuck "in use"
   * until its pid is noticed as dead.
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

  /** Drops every claim whose pid is gone. Cheap enough to run before any decision. */
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

  /**
   * Brings the pair's devices up and waits until each is attached *and* the machine has settled
   * after the boot. Never throws: a device that will not come up is reported in `degraded`, and
   * the caller decides whether that is fatal - a harness run on a warm pair cares, a lease that
   * only needed the ports does not.
   */
  ensureBooted(
    pair,
    lease,
    { platform = 'both', timeoutMs = DEVICE_SETTLE_TIMEOUT_MS } = {}
  ) {
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

    const startedAt = this.now();
    const already = new Set();
    const isUp = (w) =>
      w.kind === 'android'
        ? !!w.serial &&
          this.ops.attachedSerials(w.adbPort).includes(w.serial) &&
          this.ops.bootComplete(w.serial, w.adbPort)
        : this.ops.bootedSimulators().includes(w.udid);

    const booted = [];
    // A boot that the tool refused outright (no such AVD, no such UDID, an emulator binary that
    // is not on PATH) is known immediately, and polling a device that was never started for the
    // whole timeout turns a mistyped devices.json into a seven-minute lease command.
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
          ? this.ops.bootEmulator({ avd: w.avd, port: w.port })
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
    // The wait below is minutes, and a record that is already past its idle limit is reapable by
    // another task the whole time (`notePair` only stamps the new lease and clock when the wait
    // ends), so the devices actually coming up are marked as booting first (M3).
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
   * Waits for the 1-minute load to fall under the settle ceiling, then gives up with a warning
   * rather than hanging a lease: another task's Xcode build is a legitimate reason for load and a
   * pool must not turn into a queue. The ceiling is the bench's own (`loadSettleCeiling`), so a
   * harness run that starts after a boot is not measured while the machine drains it.
   *
   * `NITRO_UI_LOAD_SETTLE_TIMEOUT_MS` shortens the wait, and `0` skips it after one reading. That
   * is not a test-only escape hatch: the wait is a courtesy to the *next* measurement, and a
   * caller that does not care (a reset, a reap, a CI runner whose numbers nobody benchmarks)
   * should say so rather than sit for three minutes behind a load it will never get under.
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
   * Clears the example app's data on each device of the pair, so the next task does not inherit the
   * last one's storage, and reports what was actually done on each.
   *
   * Android: `adb -s <serial> shell pm clear <appId>`, retried. The pool resets a device *it has
   * just booted*, and an emulator whose `sys.boot_completed` is already `1` can still answer
   * `Failed` for a few seconds while PackageManager settles — which is what the first real boot of
   * this code did, and what a single attempt reported as a permanent failure. The retries are
   * bounded and use the injected clock, so a test drives them without waiting.
   *
   * iOS: `simctl uninstall`, verified by asking for the data container afterwards. The row used to
   * read "none needed (simctl install replaces the app container)", which the repo's own
   * platform-apple patch contradicts — `simctl install` *keeps* the container — so the pool was
   * printing a satisfied reset while a task's defaults and Documents sat there for the next task.
   * Uninstall is the cheapest thing that is provably complete: `get_app_container … data` then has
   * nothing to return, and that check, not the exit code, is what the row reports.
   *
   * Removing the app is only safe because everything that runs on a pooled device installs it
   * first: the harness's patched iOS path installs `HARNESS_APP_PATH` on every run, and real-input
   * installs its own `.app`. When `HARNESS_APP_PATH` is set we reinstall here too, so a device never
   * leaves the pool empty for a consumer that does not install (and the reinstall failure is
   * reported, not swallowed).
   *
   * @param {object} pair
   * @param {{appId?: {android: string, ios: string}, attempts?: number, reinstallApp?: string | null}} [options]
   */
  resetPair(
    pair,
    {
      appId = EXAMPLE_APP_ID,
      attempts = 4,
      reinstallApp = process.env.HARNESS_APP_PATH ?? null,
    } = {}
  ) {
    const results = [];
    if (pair?.android?.avd) {
      const serial =
        pair?.android?.emulatorPort != null
          ? emulatorSerial(pair.android.emulatorPort)
          : (pair?.android?.serial ?? null);
      let ok = false;
      let answer = 'no serial to address';
      let tries = 0;
      while (!ok && tries < attempts) {
        tries += 1;
        if (!serial) break;
        const clear = this.ops.clearAppData(
          serial,
          appId.android,
          pair.android?.adbPort ?? null
        );
        ok = !!clear?.ok;
        answer = clear?.answer ?? '(no answer)';
        if (!ok && tries < attempts) this.sleep(this.pollMs);
      }
      results.push({
        key: `avd:${pair.android.avd}`,
        action: 'pm clear',
        ok,
        attempts: tries,
        answer,
      });
    }
    if (pair?.ios?.udid) {
      const udid = pair.ios.udid;
      const un = this.ops.uninstallSimulatorApp(udid, appId.ios);
      // Believe the device, not the exit code: the thing a reset promises is that the data is
      // gone, and `simctl` answers that directly.
      const container = this.ops.simulatorDataContainer(udid, appId.ios);
      let ok = !!un?.ok && container == null;
      // Both answers, when both went wrong: "simctl refused" and "the container is still there" are
      // different failures to whoever has to fix them, and reporting only one of them sends them to
      // the wrong tool.
      const parts = [un?.answer ?? '(no answer)'];
      if (container != null)
        parts.push(`data container survived: ${container}`);
      let answer = parts.join('; ');
      let tries = 1;
      if (ok && reinstallApp != null) {
        tries += 1;
        const re = this.ops.installSimulatorApp(udid, reinstallApp);
        // A device left without an app is worse than one with stale data, so a failed reinstall is
        // a failed reset: the next run installs anyway, and whoever read the line should know the
        // device is not ready.
        ok = ok && !!re?.ok;
        answer = re?.ok
          ? `${answer}; reinstalled ${reinstallApp}`
          : `${answer}; reinstall FAILED (${re?.answer})`;
      }
      results.push({
        key: `ios:${udid}`,
        action: 'simctl uninstall',
        ok,
        attempts: tries,
        answer,
      });
    }
    return results;
  }

  /**
   * Powers off every pool device that has outlived its idle limit, and reports what it did.
   * `shutdownKeys` (`acquire --exclusive`) is the caller's way of saying "these ones now".
   *
   * Three passes, in this order:
   *
   *  1. **decide**, under the lease lock, with no device I/O at all (X11 review N1);
   *  2. **act** - `simctl shutdown`, `adb emu kill`, each of which can take seconds - with the lock
   *     released;
   *  3. **re-read and drop** the records for devices that are actually off, re-checking claims
   *     first, so a run that started in the open window keeps its device.
   *
   * The split matters because the lock is the lease file's: it is held with a 10-second timeout and
   * stolen from anyone who holds it 30 seconds, so an `adb emu kill` that stalls used to fail every
   * other task's `acquire` and gate claim on this machine - and could lose the reaper its own lock
   * mid-write.
   *
   * With no devices.json loaded nothing is reapable: the pool shuts down the devices the machine
   * *declared*, never one it merely observed booted, and a caller that cannot name its pool has no
   * such list. That is also what keeps a stray `lease.mjs list` in a scratch `NITRO_UI_HOME` from
   * powering off anything at all.
   */
  reap({
    idleMinutes,
    shutdownKeys = [],
    reason = 'handoff',
    exceptLeaseId = this.env?.NITRO_UI_LEASE_ID ?? null,
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
    this.pruneClaims();
    // Pass 1: the decision, read-only, holding the lock only for as long as reading JSON takes.
    const plan = this.withPool((state) => {
      const leasesNow = this.leases();
      const held = this.heldIdentifiers({
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
        // An explicit `--idle-minutes` is the caller overriding devices.json for this one call -
        // `reap --idle-minutes 0` is "power the pool off now", the cleanup command a machine's
        // operator reaches for. It never reaches a pair a live lease holds (X11 review M3): the
        // answer there is that somebody is using it, and `release` is the way to change that.
        const decision = poolReapDecision(entry, {
          nowMs,
          leases: leasesNow,
          defaultIdleMinutes:
            this.idleShutdownMinutesFor(entry.kind) ?? idleMinutes,
          overrideIdleMinutes: idleMinutes,
          isPidAlive: this.isPidAlive,
          exceptLeaseId,
        });
        // A pair another task holds under a live lease is off-limits even under `shutdownKeys`,
        // which is an *idle* filter, not a licence to evict somebody mid-run.
        if (held.has(entry.id)) {
          decided.kept.push({
            key: entry.key,
            reason: 'lease-held',
            idleMinutes: Math.round(decision.idleMs / 60_000),
          });
          continue;
        }
        if (!forced && decision.action === 'keep') {
          decided.kept.push({
            key: entry.key,
            reason: decision.reason,
            idleMinutes: Math.round(decision.idleMs / 60_000),
          });
          continue;
        }
        planned.push({ entry, decision, forced });
      }
      return { held, planned, decided, keys: state.devices.map((x) => x.key) };
    });

    // Pass 2: the device I/O, outside the lock.
    const done = {
      reaped: [],
      alreadyOff: [],
      failed: [],
      refused: [],
      ...plan.decided,
    };
    const offKeys = [];
    for (const { entry, decision, forced } of plan.planned) {
      const outcome = this.shutdownDevice(entry, {
        reason: forced ? reason : decision.reason,
        held: plan.held,
      });
      if (outcome === 'off' || outcome === 'already') {
        offKeys.push(entry.key);
        if (outcome === 'off')
          done.reaped.push({ key: entry.key, reason: decision.reason });
        else done.alreadyOff.push({ key: entry.key });
      } else if (outcome === 'refused') {
        // The reason is on the log: `shutdownDevice` says which of its checks refused, because the
        // difference between "not in devices.json" and "a live lease holds this pair" is the
        // difference between a nuisance and another task's emulator going down.
        done.refused.push({
          key: entry.key,
          why: 'refused (see the log above)',
        });
      } else {
        done.failed.push({ key: entry.key, reason: decision.reason });
      }
    }

    // A device that is up but has no record is still up. That happens whenever anything boots a
    // pool device outside the pool - the harness's own boot path does it on a cold machine, and a
    // person does it with `emulator @pair_a` - and an exclusive lease's whole point is that nothing
    // is left running underneath the bench, so the list it hands in is answered from devices.json,
    // not from the records. Identity here comes from the pair by construction, which is exactly what
    // the checks below insist on for a record that has one.
    const seen = new Set(plan.keys);
    for (const key of shutdownKeys) {
      if (seen.has(key)) continue;
      const declared = this.declaredEntry(key);
      if (declared == null) continue;
      if (plan.held.has(declared.id)) continue;
      const outcome = this.shutdownDevice(declared, {
        reason,
        held: plan.held,
      });
      if (outcome === 'off') done.reaped.push({ key, reason });
      else if (outcome === 'already') done.alreadyOff.push({ key });
      else if (outcome === 'refused')
        done.refused.push({ key, why: 'refused (see the log above)' });
      else done.failed.push({ key, reason });
    }

    // Pass 3: forget the records that are genuinely off - re-locked, and re-checked, because the
    // window above is long enough for a run to have claimed the device. A device that is off (or
    // was never on) stops being the pool's business; one that refused to die stays listed so the
    // next `list` still shows it, and `reap` retries.
    if (offKeys.length > 0) {
      this.withPool((state) => {
        state.devices = state.devices.filter((x) => {
          if (!offKeys.includes(x.key)) return true;
          return deviceIsBusy(x, this.now(), this.isPidAlive);
        });
        return true;
      });
    }
    return done;
  }

  /** Every pool key devices.json declares, for a caller that wants the machine's whole pool. */
  keysForPool() {
    return (this.devices?.pairs ?? []).flatMap((pair) => poolKeysForPair(pair));
  }

  /**
   * A pool record for a key devices.json declares but `pool.json` has never seen: a pool device
   * that something else booted. Built from the pair alone, which is the only source of identity the
   * reaper trusts anyway, and deliberately carrying no `leaseId` (nothing leased it as far as the
   * pool knows) and no `bootedAtMs`/`lastUsedMs` (the pool does not know when it started, and
   * guessing "recent" would hide it from the idle clock forever).
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

  /** `{serial, adbPort}` the machine's own `devices.json` says this pool key has - the only identity
   * the reaper is willing to act on (X11 review M4).
   */
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
    // Same rule as `identityFor`: the serial is *derived* from the pair's console port, so a
    // devices.json that renumbers a pair cannot leave a record pointing at another pair's device.
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
   * Every device identifier a live lease holds - AVD names, UDIDs, and the serials its console
   * ports imply (X11 review M3). Identifier-level rather than pair-level because an exclusive lease
   * holds every pair in `holds`, and a reap that only compared pair ids against its own record's
   * `leaseId` would happily kill a bench's emulator: the bench's lease names the pair, but no pool
   * record names the bench.
   *
   * `exceptLeaseId` is the caller's own lease: your hold does not stop *your* reap - if it did, an
   * exclusive lease could not power the machine down at all, since it holds every pair.
   */
  heldIdentifiers({
    leases = this.leases(),
    nowMs = this.now(),
    exceptLeaseId = this.leaseId ?? null,
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
    // Never act on a stored serial (X11 review M4). `pool.json` is a cache of what was true when a
    // device was handed out: devices.json gets renumbered, and `claim()` records the
    // `ANDROID_SERIAL` of the process that claimed it. A stale serial in a record whose AVD name
    // still matches devices.json used to be enough to `emu kill` *another task's leased emulator*,
    // because the AVD name is not what the kill is addressed to. So: the pair decides the identity,
    // the record may not disagree with it, no other live lease may claim that identifier, and the
    // device answers a live question about itself before anything is powered off.
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
      if (!this.ops.bootedSimulators().includes(udid)) return 'already';
      this.log(`  shutting down simulator ${udid} (${reason})`);
      return this.ops.shutdownSimulator(udid) ? 'off' : 'failed';
    }
    const serial = expected.serial;
    if (serial == null) {
      this.log(`  refused ${entry.key}: devices.json gives it no console port`);
      return 'refused';
    }
    if (entry.serial != null && entry.serial !== serial) {
      // The record and devices.json disagree. The kill is addressed to the *pair's* serial, and the
      // live check below has to agree about who is behind it, so a disagreement is a warning rather
      // than a device that can never be reaped again - which is what a refusal here would cause,
      // since nothing rewrites a record until its device is next handed out.
      this.log(
        `  ${entry.key}: the record says ${entry.serial}, devices.json says ${serial} - using the pair's, and asking the device`
      );
    }
    if (isReservedSerial(serial)) return 'refused';
    if (heldIds.has(entry.id) || heldIds.has(serial)) {
      this.log(`  refused ${entry.key}: a live lease holds that pair`);
      return 'refused';
    }
    if (!this.ops.attachedSerials(expected.adbPort).includes(serial))
      return 'already';
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

  /** Is this a device the pool may power off? When the caller loaded devices.json, it must be named
   * there: the pool shuts down what the machine declared as its pool, and nothing it observed.
   */
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
 * The pair a lease's env file describes, in the shape the pool speaks.
 *
 * Anything that has `source`d a lease can find its own devices this way without reading
 * leases.json - which is what lets a gate claim them: it runs as a child of a task, and the env
 * file is the contract it was handed.
 */
export function pairFromEnv(env = process.env) {
  const port = Number(env.EMULATOR_PORT);
  const adbPort = Number(env.ANDROID_ADB_SERVER_PORT);
  return {
    id: env.NITRO_UI_LEASE_PAIR ?? 'env',
    ios: env.IOS_SIM_UDID ? { udid: env.IOS_SIM_UDID } : null,
    android: env.ANDROID_AVD
      ? {
          avd: env.ANDROID_AVD,
          emulatorPort: Number.isInteger(port) ? port : null,
          // The serial the lease exported (or the one its port implies), so a claim records the
          // device it holds: a pool entry with no serial cannot be powered off, and `reap` would
          // read it as "already off" and forget an emulator that is running.
          serial:
            env.ANDROID_SERIAL ??
            (Number.isInteger(port) ? emulatorSerial(port) : null),
          // The adb server that can see this device. Without it a claim or a reset asks the
          // default server about an emulator it has never heard of, and gets "not found".
          adbPort: Number.isInteger(adbPort) ? adbPort : null,
        }
      : null,
  };
}

/**
 * Claims the current lease's devices for one command, or returns null when the environment names no
 * devices at all (a plain `bun run check`, a unit test, a CI runner).
 *
 * `platform` is the *caller's* (the gate being run), and it is intersected with what the
 * environment names: an iOS harness run under a `both` lease claims the simulator only, so the
 * Android device behind the same lease stays free for the next task's Android run. Claiming more
 * than a run touches is how a warm pool turns into a queue.
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
  // The pool travels with the claim so the caller can release it without keeping a second object
  // alive to remember which state file it wrote.
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

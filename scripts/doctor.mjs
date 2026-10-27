#!/usr/bin/env node
/**
 * Is this machine ready to build, gate and bench nitro-ui? And, with `--setup`,
 * make it so as far as a script safely can.
 *
 *   node scripts/doctor.mjs            # check only; exit 1 if anything required fails
 *   node scripts/doctor.mjs --setup    # also create the two device pairs + devices.json
 *   node scripts/doctor.mjs --json     # machine-readable results
 *
 * Checks: Xcode and its iOS runtime, CocoaPods, Node (`.nvmrc`) through fnm, bun
 * (`packageManager`), JDK 17, the Android SDK pieces `example/android` builds
 * with, the emulator system image, git/gh push access, the agent CLIs, disk,
 * load, and whether `~/.nitro-ui/devices.json` describes devices that exist.
 *
 * `--setup` only ever *adds*: it creates simulators named `nitro-ui A`/`nitro-ui B`
 * and AVDs `nitroui_a`/`nitroui_b` (reusing them if present), then writes
 * `devices.json` if there is none. It never edits or deletes a device it did not
 * create, never installs SDK packages or accepts licenses (it prints the command
 * instead), and never boots anything.
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statfsSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  DEFAULT_PAIRS,
  REQUIREMENTS,
  applyAvdConfig,
  bunStatus,
  cocoapodsProblem,
  deviceTypeId,
  supportedIphones,
  devicesConfigProblems,
  exitCode,
  parseAvdList,
  parseVersion,
  pickIosRuntime,
  renderDevicesConfig,
  simulatorsByUdid,
  simulatorsByUdidWithState,
  emulatorsFromAdbDevices,
  unownedBootedDevices,
  unownedCheckProblem,
  coldCacheWarning,
  mainCheckoutPath,
} from './doctor-core.mjs';
import {
  activeLeases,
  normalizeDevices,
  readJson,
  stateHome,
  statePaths,
} from './lease-core.mjs';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

/** @typedef {{ area: string, name: string, status: 'ok' | 'warn' | 'fail', detail: string, fix?: string }} Result */

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ input?: string, timeout?: number }} [options]
 */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: options.timeout ?? 60_000,
    input: options.input,
    cwd: REPO_ROOT,
  });
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
    missing: result.error?.code === 'ENOENT',
  };
}

/** @param {string} command */
function json(command, args) {
  const result = run(command, args);
  if (!result.ok) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function readRepoFile(relative) {
  try {
    return readFileSync(path.join(REPO_ROOT, relative), 'utf8');
  } catch {
    return '';
  }
}

/** What `example/android/build.gradle` builds with. */
function androidBuildRequirements() {
  const gradle = readRepoFile('example/android/build.gradle');
  const pick = (key) =>
    new RegExp(`${key}\\s*=\\s*"?([\\w.]+)"?`).exec(gradle)?.[1] ?? null;
  return {
    compileSdk: pick('compileSdkVersion'),
    buildTools: pick('buildToolsVersion'),
    ndk: pick('ndkVersion'),
  };
}

function androidSdkRoot() {
  return (
    process.env.ANDROID_HOME ??
    process.env.ANDROID_SDK_ROOT ??
    path.join(os.homedir(), 'Library/Android/sdk')
  );
}

function avdHome() {
  return (
    process.env.ANDROID_AVD_HOME ?? path.join(os.homedir(), '.android/avd')
  );
}

function listDir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** @returns {Result[]} */
function checkMachine() {
  const results = [];
  const arm = process.arch === 'arm64' && process.platform === 'darwin';
  results.push({
    area: 'machine',
    name: 'platform',
    status: arm ? 'ok' : 'fail',
    detail: `${process.platform}/${process.arch}, ${os.cpus().length} cores, ${Math.round(os.totalmem() / 2 ** 30)} GB`,
    fix: arm
      ? undefined
      : 'the gates and baselines assume an Apple Silicon Mac',
  });
  try {
    const stats = statfsSync(os.homedir());
    const freeGb = Math.round((stats.bavail * stats.bsize) / 2 ** 30);
    results.push({
      area: 'machine',
      name: 'disk',
      status: freeGb >= REQUIREMENTS.minFreeDiskGb ? 'ok' : 'warn',
      detail: `${freeGb} GB free`,
      fix:
        freeGb >= REQUIREMENTS.minFreeDiskGb
          ? undefined
          : `builds, DerivedData and two AVDs want ~${REQUIREMENTS.minFreeDiskGb} GB`,
    });
  } catch {
    // statfs is best-effort.
  }
  const load = os.loadavg()[0];
  const cores = os.cpus().length;
  results.push({
    area: 'machine',
    name: 'load',
    status: load <= cores * 0.5 ? 'ok' : 'warn',
    detail: `load1 ${load.toFixed(1)} on ${cores} cores`,
    fix:
      load <= cores * 0.5
        ? undefined
        : 'benches refuse a machine above 0.5 x cores (R4)',
  });
  const label = process.env.NITRO_UI_MACHINE_LABEL;
  results.push({
    area: 'machine',
    name: 'NITRO_UI_MACHINE_LABEL',
    status: label ? 'ok' : 'warn',
    detail: label ?? 'unset (bench results say "unlabelled")',
    fix: label
      ? undefined
      : 'export NITRO_UI_MACHINE_LABEL=maintainer-mac-<n> in your shell profile',
  });
  return results;
}

/** @returns {Result[]} */
function checkJs() {
  const results = [];
  const wantedNode = readRepoFile('.nvmrc').trim();
  const fnm = run('fnm', ['--version']);
  results.push({
    area: 'js',
    name: 'fnm',
    status: fnm.ok ? 'ok' : 'fail',
    detail: fnm.ok ? fnm.stdout : 'not found',
    fix: fnm.ok ? undefined : 'brew install fnm',
  });
  if (fnm.ok && wantedNode !== '') {
    const node = run('fnm', [
      'exec',
      '--using',
      wantedNode,
      '--',
      'node',
      '--version',
    ]);
    results.push({
      area: 'js',
      name: `node ${wantedNode} (.nvmrc)`,
      status: node.ok ? 'ok' : 'fail',
      detail: node.ok ? node.stdout : 'not installed in fnm',
      fix: node.ok ? undefined : `fnm install ${wantedNode}`,
    });
  }
  const packageJson = JSON.parse(readRepoFile('package.json') || '{}');
  const wantedBun =
    /^bun@(.+)$/.exec(packageJson.packageManager ?? '')?.[1] ?? null;
  const bun = run('bun', ['--version']);
  const status = bunStatus(wantedBun, bun.ok ? bun.stdout : null);
  results.push({
    area: 'js',
    name: 'bun',
    status,
    detail: bun.ok
      ? `${bun.stdout} (packageManager ${wantedBun ?? '?'})`
      : 'not found',
    fix:
      status === 'ok'
        ? undefined
        : `curl -fsSL https://bun.sh/install | bash -s "bun-v${wantedBun ?? 'latest'}"`,
  });
  const installed = existsSync(path.join(REPO_ROOT, 'node_modules/.bin'));
  results.push({
    area: 'js',
    name: 'dependencies',
    status: installed ? 'ok' : 'warn',
    detail: installed ? 'node_modules present' : 'not installed',
    fix: installed ? undefined : 'bun install (in the repo root)',
  });
  return results;
}

/** @returns {{ results: Result[], runtime: { identifier: string, version: string } | null }} */
function checkIos() {
  const results = [];
  const xcode = run('xcodebuild', ['-version']);
  const major = parseVersion(xcode.stdout)?.[0] ?? 0;
  results.push({
    area: 'ios',
    name: 'Xcode',
    // Xcode 26 builds the library; the gates and baselines run on iOS 27.
    status: !xcode.ok
      ? 'fail'
      : major >= REQUIREMENTS.xcodeMajor
        ? 'ok'
        : major === REQUIREMENTS.xcodeMajor - 1
          ? 'warn'
          : 'fail',
    detail: xcode.ok
      ? xcode.stdout.split('\n').join(', ')
      : 'xcodebuild not usable',
    fix:
      xcode.ok && major >= REQUIREMENTS.xcodeMajor
        ? undefined
        : `install Xcode ${REQUIREMENTS.xcodeMajor}+ and run: sudo xcode-select -s /Applications/Xcode.app`,
  });
  const selected = run('xcode-select', ['-p']);
  const isFullXcode = selected.ok && selected.stdout.includes('.app/');
  results.push({
    area: 'ios',
    name: 'xcode-select',
    status: isFullXcode ? 'ok' : 'fail',
    detail: selected.stdout || 'unset',
    fix: isFullXcode
      ? undefined
      : 'sudo xcode-select -s /Applications/Xcode.app',
  });
  if (xcode.ok) {
    const firstLaunch = run('xcodebuild', ['-checkFirstLaunchStatus']);
    results.push({
      area: 'ios',
      name: 'first launch / license',
      status: firstLaunch.ok ? 'ok' : 'fail',
      detail: firstLaunch.ok ? 'done' : 'pending',
      fix: firstLaunch.ok
        ? undefined
        : 'sudo xcodebuild -license accept && sudo xcodebuild -runFirstLaunch',
    });
  }
  const runtimes = json('xcrun', ['simctl', 'list', 'runtimes', '-j']) ?? {};
  const runtime = pickIosRuntime(runtimes, REQUIREMENTS.iosRuntime);
  results.push({
    area: 'ios',
    name: `iOS ${REQUIREMENTS.iosRuntime} simulator runtime`,
    status: runtime ? 'ok' : 'fail',
    detail: runtime ? runtime.version : 'not installed',
    fix: runtime
      ? undefined
      : `xcodebuild -downloadPlatform iOS -buildVersion ${REQUIREMENTS.iosRuntime}`,
  });
  const pod = run('pod', ['--version']);
  const problem = cocoapodsProblem(pod.ok ? pod.stdout : null);
  results.push({
    area: 'ios',
    name: 'CocoaPods',
    status: problem == null ? 'ok' : 'fail',
    detail: problem ?? pod.stdout,
    fix: problem == null ? undefined : 'brew install cocoapods',
  });
  return { results, runtime };
}

/** @returns {{ results: Result[], sdk: string, tools: { avdmanager: string, emulator: string } }} */
function checkAndroid() {
  const results = [];
  const sdk = androidSdkRoot();
  const sdkThere = existsSync(sdk);
  results.push({
    area: 'android',
    name: 'SDK',
    status: sdkThere ? 'ok' : 'fail',
    detail: sdkThere ? 'found' : `not at ${sdk}`,
    fix: sdkThere
      ? undefined
      : 'install Android Studio and its default SDK, or set ANDROID_HOME',
  });
  const java17 = run('/usr/libexec/java_home', [
    '-v',
    String(REQUIREMENTS.jdkMajor),
  ]);
  const javaHome = process.env.JAVA_HOME;
  const javaHomeMatches =
    javaHome == null ||
    (java17.ok && path.resolve(javaHome) === path.resolve(java17.stdout));
  results.push({
    area: 'android',
    name: `JDK ${REQUIREMENTS.jdkMajor}`,
    status: !java17.ok ? 'fail' : javaHomeMatches ? 'ok' : 'warn',
    detail: !java17.ok
      ? 'not installed'
      : javaHomeMatches
        ? 'installed'
        : `installed, but JAVA_HOME points elsewhere`,
    fix: !java17.ok
      ? 'brew install --cask zulu@17'
      : javaHomeMatches
        ? undefined
        : `export JAVA_HOME=$(/usr/libexec/java_home -v ${REQUIREMENTS.jdkMajor})`,
  });
  const tools = {
    adb: path.join(sdk, 'platform-tools/adb'),
    emulator: path.join(sdk, 'emulator/emulator'),
    avdmanager: path.join(sdk, 'cmdline-tools/latest/bin/avdmanager'),
    sdkmanager: path.join(sdk, 'cmdline-tools/latest/bin/sdkmanager'),
  };
  const sdkmanager = `${tools.sdkmanager.replace(os.homedir(), '~')}`;
  for (const [name, file] of Object.entries(tools)) {
    const there = existsSync(file);
    results.push({
      area: 'android',
      name,
      status: there ? 'ok' : 'fail',
      detail: there ? 'found' : 'missing',
      fix: there
        ? undefined
        : name === 'avdmanager' || name === 'sdkmanager'
          ? 'Android Studio > Settings > Android SDK > SDK Tools > "Android SDK Command-line Tools (latest)"'
          : `${sdkmanager} --install ${name === 'adb' ? 'platform-tools' : 'emulator'}`,
    });
  }
  const wanted = androidBuildRequirements();
  const platforms = listDir(path.join(sdk, 'platforms'));
  const pieces = [
    {
      name: `platform android-${wanted.compileSdk}`,
      there: platforms.some(
        (dir) =>
          dir === `android-${wanted.compileSdk}` ||
          dir.startsWith(`android-${wanted.compileSdk}.`)
      ),
      // From API 37 the SDK names platforms with a minor version (`android-37.0`).
      pkg: `platforms;android-${wanted.compileSdk}${Number(wanted.compileSdk) >= 37 ? '.0' : ''}`,
    },
    {
      name: `build-tools ${wanted.buildTools}`,
      there: listDir(path.join(sdk, 'build-tools')).includes(
        wanted.buildTools ?? ''
      ),
      pkg: `build-tools;${wanted.buildTools}`,
    },
    {
      name: `NDK ${wanted.ndk}`,
      there: listDir(path.join(sdk, 'ndk')).includes(wanted.ndk ?? ''),
      pkg: `ndk;${wanted.ndk}`,
    },
  ];
  for (const piece of pieces) {
    results.push({
      area: 'android',
      name: piece.name,
      // Gradle downloads these on the first build once the licenses are accepted.
      status: piece.there ? 'ok' : 'warn',
      detail: piece.there
        ? 'installed'
        : 'missing (the first Gradle build downloads it if licenses are accepted)',
      fix: piece.there ? undefined : `${sdkmanager} --install "${piece.pkg}"`,
    });
  }
  const image = REQUIREMENTS.androidSystemImage;
  const imageThere = existsSync(path.join(sdk, ...image.split(';')));
  results.push({
    area: 'android',
    name: 'emulator system image',
    status: imageThere ? 'ok' : 'fail',
    detail: imageThere ? image : `${image} missing`,
    fix: imageThere ? undefined : `${sdkmanager} --install "${image}"`,
  });
  return { results, sdk, tools };
}

/** @returns {Result[]} */
function checkGitAndAgents() {
  const results = [];
  const name = run('git', ['config', 'user.name']);
  const email = run('git', ['config', 'user.email']);
  results.push({
    area: 'git',
    name: 'identity',
    status: name.ok && email.ok ? 'ok' : 'fail',
    detail: name.ok && email.ok ? 'user.name and user.email set' : 'unset',
    fix:
      name.ok && email.ok
        ? undefined
        : 'git config --global user.name/user.email',
  });
  const packageJson = JSON.parse(readRepoFile('package.json') || '{}');
  const slug = /github\.com[/:]([^/]+\/[^/.]+)/.exec(
    packageJson.repository?.url ?? ''
  )?.[1];
  const gh = run('gh', ['auth', 'status']);
  if (!gh.ok) {
    results.push({
      area: 'git',
      name: 'gh',
      status: 'fail',
      detail: gh.missing ? 'not installed' : 'not logged in',
      fix: gh.missing ? 'brew install gh && gh auth login' : 'gh auth login',
    });
  } else if (slug != null) {
    const push = run('gh', [
      'api',
      `repos/${slug}`,
      '--jq',
      '.permissions.push',
    ]);
    results.push({
      area: 'git',
      name: `push to ${slug}`,
      status: push.stdout === 'true' ? 'ok' : 'warn',
      detail:
        push.stdout === 'true'
          ? 'allowed'
          : 'not allowed (fine for a worker, not for the orchestrator)',
    });
  }
  for (const [cli, why] of [
    ['claude', 'reviewer / orchestrator'],
    ['opencode', 'implementer'],
  ]) {
    const version = run(cli, ['--version']);
    results.push({
      area: 'agents',
      name: cli,
      status: version.ok ? 'ok' : 'warn',
      detail: version.ok
        ? version.stdout.split('\n')[0]
        : `not on PATH (${why})`,
    });
  }
  const ccacheVersion = run('ccache', ['--version']);
  results.push({
    area: 'build',
    name: 'ccache',
    status: ccacheVersion.ok ? 'ok' : 'warn',
    detail: ccacheVersion.ok
      ? ccacheVersion.stdout.split('\n')[0]
      : 'not installed (optional; faster native rebuilds)',
    fix: ccacheVersion.ok ? undefined : 'brew install ccache',
  });
  // Whether the *caches* are warm, which is a different question from whether
  // ccache is installed: the first native build on a fresh machine cost 9.5 min
  // on iOS and 4 m 43 s on Android against 138 s and 17 s warm.
  const stats = ccacheVersion.ok
    ? run('ccache', ['--show-stats'], { timeout: 20_000 }).stdout
    : null;
  const cache = coldCacheWarning(stats);
  results.push({
    area: 'build',
    name: 'build caches',
    status: cache.status === 'ok' ? 'ok' : 'warn',
    detail: cache.detail,
    fix: cache.fix,
  });
  return results;
}

/**
 * @param {{ runtime: { identifier: string, version: string } | null, emulator: string, adb: string | null }} context
 * @returns {Result[]}
 */
function checkDevices({ runtime, emulator, adb }) {
  const { devices: file } = statePaths(stateHome());
  if (!existsSync(file)) {
    return [
      {
        area: 'devices',
        name: 'devices.json',
        status: 'fail',
        detail: `none at ${file.replace(os.homedir(), '~')}`,
        fix: 'node scripts/doctor.mjs --setup',
      },
    ];
  }
  let config;
  try {
    config = JSON.parse(readFileSync(file, 'utf8'));
    normalizeDevices(config);
  } catch (error) {
    return [
      {
        area: 'devices',
        name: 'devices.json',
        status: 'fail',
        detail: String(error.message ?? error),
      },
    ];
  }
  const listingJson = json('xcrun', ['simctl', 'list', 'devices', '-j']);
  const simulators = simulatorsByUdid(listingJson ?? {});
  const avds = existsSync(emulator)
    ? parseAvdList(run(emulator, ['-list-avds']).stdout)
    : new Set();
  const problems = devicesConfigProblems(config, {
    simulators,
    avds,
    iosRuntimeMajor:
      parseVersion(runtime?.version)?.[0] ?? REQUIREMENTS.iosRuntimeMajor,
  });
  return [
    {
      area: 'devices',
      name: 'devices.json',
      status: problems.length === 0 ? 'ok' : 'fail',
      detail:
        problems.length === 0
          ? `${config.pairs.length} pair(s), all present`
          : problems.join('; '),
      fix:
        problems.length === 0
          ? undefined
          : 'fix the file by hand, or move it away and run --setup',
    },
    ...checkUnownedDevices(config, listingJson, adb),
  ];
}

/**
 * Pool devices that are booted while no lease holds them (X9 item 6).
 *
 * `devices.json` says what *can* be leased; it never said what is running with no
 * owner, which is the state that makes harness numbers move: a stranger's
 * simulator competes for the same cores, and the only evidence was that the
 * machine felt slow. A live lease is a legitimate owner, so those pairs are left
 * alone, and so is the reserved emulator — nobody may lease it, so telling its
 * owner to shut it down is not this script's call.
 *
 * Warnings only, on purpose: doctor reports on a machine it does not own and
 * never shuts a device down.
 *
 * @param {ReturnType<typeof normalizeDevices>} config
 * @param {object | null} listingJson raw `simctl list devices -j`, or null when xcrun did not answer
 * @param {string | null} adb path to adb, or null when the SDK is missing
 * @returns {Result[]}
 */
function checkUnownedDevices(config, listingJson, adb) {
  const listing = listingJson ?? {};
  // Null means "adb could not run", which is a different answer from "adb ran and
  // nothing is attached", so it has to survive to `unownedCheckProblem`.
  const adbText =
    adb != null && existsSync(adb)
      ? run(adb, ['devices']).stdout || null
      : null;
  const { leases: leaseFile } = statePaths(stateHome());
  // Read-only: `activeLeases` drops what has outlived its ttl without rewriting the
  // file, which is `lease.mjs`'s job, not a report's.
  let liveLeases = [];
  try {
    liveLeases = activeLeases(readJson(leaseFile, { leases: [] }), Date.now());
  } catch (error) {
    return [
      {
        area: 'devices',
        name: 'unowned devices',
        status: 'fail',
        detail: `leases unreadable, so nothing can be called owned: ${String(error.message ?? error)}`,
        fix: 'inspect or remove ~/.nitro-ui/leases.json (lease.mjs recreates it)',
      },
    ];
  }

  const attached = emulatorsFromAdbDevices(adbText, config.pairs);
  const warnings = unownedBootedDevices({
    pool: config,
    simulators: simulatorsByUdidWithState(listing),
    emulators: attached,
    leases: liveLeases,
    reservedPorts: config.reservedEmulatorPorts,
  });
  const problem = unownedCheckProblem({
    xcrunOk: listingJson != null,
    adbOk: adbText != null,
  });
  if (warnings.length === 0 && problem == null) {
    // Nothing is loose: say so, so `warn`-free output is evidence rather than
    // silence about a check that quietly did not run.
    return [
      {
        area: 'devices',
        name: 'unowned devices',
        status: 'ok',
        detail: 'every booted pool device is held by a lease',
      },
    ];
  }
  const rows =
    problem == null
      ? []
      : [
          {
            area: 'devices',
            name: 'unowned devices',
            status: /** @type {'warn'} */ ('warn'),
            detail: problem,
            fix: 'install the Android SDK (adb) and Xcode (xcrun), or ignore this row on a machine with neither',
          },
        ];
  return [
    ...rows,
    ...warnings.map((warning, index) => ({
      area: 'devices',
      name: `unowned device ${String(index + 1)}`,
      status: /** @type {'warn'} */ ('warn'),
      detail: warning,
      fix: 'shut it down, or lease it while you use it: node scripts/lease.mjs acquire --task <ID>',
    })),
  ];
}

/**
 * Creates the default pairs' devices (reusing any that exist by name) and writes
 * `devices.json`. Refuses to run when a `devices.json` already exists.
 *
 * @returns {Result[]}
 */
function setupDevices({ runtime, tools }) {
  const { home, devices: file } = statePaths(stateHome());
  if (existsSync(file)) {
    return [
      {
        area: 'setup',
        name: 'devices',
        status: 'ok',
        detail: 'devices.json exists; left alone',
      },
    ];
  }
  if (runtime == null) {
    return [
      {
        area: 'setup',
        name: 'devices',
        status: 'fail',
        detail: 'no iOS runtime to create simulators on',
      },
    ];
  }
  const imagePath = path.join(
    androidSdkRoot(),
    ...REQUIREMENTS.androidSystemImage.split(';')
  );
  if (!existsSync(tools.avdmanager) || !existsSync(imagePath)) {
    return [
      {
        area: 'setup',
        name: 'devices',
        status: 'fail',
        detail:
          'avdmanager or the emulator system image is missing (see android above)',
      },
    ];
  }
  const types = json('xcrun', ['simctl', 'list', 'devicetypes', '-j']) ?? {};
  const existingSims = [
    ...simulatorsByUdid(
      json('xcrun', ['simctl', 'list', 'devices', '-j']) ?? {}
    ).values(),
  ];
  const existingAvds = parseAvdList(run(tools.emulator, ['-list-avds']).stdout);
  const results = [];
  const created = [];
  for (const pair of DEFAULT_PAIRS) {
    let udid = existingSims.find(
      (sim) =>
        sim.name === pair.simulatorName && sim.runtime === runtime.identifier
    )?.udid;
    if (udid == null) {
      const type = deviceTypeId(types, pair.simulatorType, runtime);
      if (type == null) {
        const iphones = supportedIphones(runtime);
        results.push({
          area: 'setup',
          name: pair.simulatorName,
          status: 'fail',
          detail:
            `iOS ${runtime.version} has no "${pair.simulatorType}" device type` +
            (iphones.length > 0 ? ` (it supports: ${iphones.join(', ')})` : ''),
        });
        continue;
      }
      const made = run('xcrun', [
        'simctl',
        'create',
        pair.simulatorName,
        type,
        runtime.identifier,
      ]);
      if (!made.ok) {
        results.push({
          area: 'setup',
          name: pair.simulatorName,
          status: 'fail',
          detail: made.stderr,
        });
        continue;
      }
      udid = made.stdout;
      results.push({
        area: 'setup',
        name: pair.simulatorName,
        status: 'ok',
        detail: `created ${pair.simulatorType} ${udid}`,
      });
    } else {
      results.push({
        area: 'setup',
        name: pair.simulatorName,
        status: 'ok',
        detail: `reused ${udid}`,
      });
    }
    if (!existingAvds.has(pair.avd)) {
      const made = run(
        tools.avdmanager,
        [
          'create',
          'avd',
          '-n',
          pair.avd,
          '-k',
          REQUIREMENTS.androidSystemImage,
          '-d',
          REQUIREMENTS.avdProfile,
        ],
        { input: 'no\n', timeout: 180_000 }
      );
      if (!made.ok) {
        results.push({
          area: 'setup',
          name: pair.avd,
          status: 'fail',
          detail: made.stderr || made.stdout,
        });
        continue;
      }
      const ini = path.join(avdHome(), `${pair.avd}.avd`, 'config.ini');
      writeFileSync(ini, applyAvdConfig(readFileSync(ini, 'utf8')));
      results.push({
        area: 'setup',
        name: pair.avd,
        status: 'ok',
        detail: `created (${REQUIREMENTS.avdProfile}, API ${REQUIREMENTS.androidApiLevel})`,
      });
    } else {
      results.push({
        area: 'setup',
        name: pair.avd,
        status: 'ok',
        detail: 'reused',
      });
    }
    created.push({ ...pair, udid });
  }
  if (created.length === DEFAULT_PAIRS.length) {
    mkdirSync(home, { recursive: true });
    writeFileSync(
      file,
      `${JSON.stringify(renderDevicesConfig(created, runtime.version), null, 2)}\n`
    );
    results.push({
      area: 'setup',
      name: 'devices.json',
      status: 'ok',
      detail: `written to ${file.replace(os.homedir(), '~')}`,
    });
  }
  return results;
}

/**
 * Builds both platforms once, in the main checkout, so the first real build of the
 * first task is not the cold one (`coldCacheWarning` is what points here).
 *
 * Why the main checkout: ccache and Gradle's build cache are shared per user
 * anyway, but Xcode's derived data and `Pods/` live in the directory that built,
 * so priming from a task's worktree would warm only the shared half and then be
 * deleted with the worktree.
 *
 * The work is done by `scripts/build-app.mjs` rather than a copy of its two
 * command lines: that is where the stamp, ccache launcher, arch default and the
 * machine-wide build slot live, and a prime that skipped the slot would be the
 * exact load-13 situation it exists to prevent.
 *
 * @param {{ log?: (message: string) => void, timeoutMinutes?: number }} [options]
 * @returns {Result[]}
 */
function primeCaches({
  log = (m) => process.stderr.write(`${m}\n`),
  timeoutMinutes = 45,
} = {}) {
  const checkout = mainCheckoutPath({
    toplevel: run('git', ['rev-parse', '--show-toplevel']).stdout || null,
    commonDir: run('git', ['rev-parse', '--git-common-dir']).stdout || null,
  });
  if (checkout == null) {
    return [
      {
        area: 'prime',
        name: 'main checkout',
        status: 'fail',
        detail: 'git did not say where this repo lives',
        fix: 'run `node scripts/build-app.mjs --platform ios|android` in the main checkout',
      },
    ];
  }
  // The main checkout's *own* script, run from its own directory: it may be on a
  // different branch than this worktree, and the point is to warm the caches that
  // checkout's builds use.
  const script = path.join(checkout, 'scripts/build-app.mjs');
  const results = [];
  // The build's own output goes to *this process's stderr*, live: a cold build
  // takes minutes and a caller watching it wants to see why it is slow. Stdout
  // stays untouched so `doctor --json --prime` is still parseable JSON.
  const buildStdio = /** @type {('ignore' | 2)[]} */ (['ignore', 2, 2]);
  for (const platform of ['ios', 'android']) {
    log(
      `doctor: priming ${platform} in ${checkout} (this is the cold build: minutes, not seconds)`
    );
    const built = spawnSync(
      process.execPath,
      [script, '--platform', platform],
      {
        cwd: checkout,
        stdio: buildStdio,
        timeout: timeoutMinutes * 60_000,
        env: process.env,
      }
    );
    results.push({
      area: 'prime',
      name: `build ${platform}`,
      status: built.status === 0 ? 'ok' : 'fail',
      detail:
        built.status === 0
          ? `built in ${checkout}`
          : `exit ${String(built.status ?? built.signal)} in ${checkout}`,
      fix:
        built.status === 0
          ? undefined
          : `node scripts/build-app.mjs --platform ${platform} (run from ${checkout})`,
    });
  }
  const stats = run('ccache', ['--show-stats'], { timeout: 20_000 });
  const cache = coldCacheWarning(stats.ok ? stats.stdout : null);
  results.push({
    area: 'prime',
    name: 'caches after priming',
    status: cache.status === 'ok' ? 'ok' : 'warn',
    detail: cache.detail,
    fix: cache.fix,
  });
  return results;
}

const MARK = { ok: '✔', warn: '!', fail: '✖' };

function print(results) {
  let area = '';
  for (const result of results) {
    if (result.area !== area) {
      area = result.area;
      process.stdout.write(`\n${area}\n`);
    }
    process.stdout.write(
      `  ${MARK[result.status]} ${result.name}: ${result.detail}\n`
    );
    if (result.fix && result.status !== 'ok')
      process.stdout.write(`      fix: ${result.fix}\n`);
  }
  const fails = results.filter((result) => result.status === 'fail').length;
  const warns = results.filter((result) => result.status === 'warn').length;
  process.stdout.write(`\n${fails} failing, ${warns} warning(s)\n`);
}

export function main(argv = process.argv.slice(2)) {
  const unknown = argv.filter(
    (arg) => !['--setup', '--prime', '--json'].includes(arg)
  );
  if (unknown.length > 0) {
    process.stderr.write(
      'usage: node scripts/doctor.mjs [--setup] [--prime] [--json]\n'
    );
    return 2;
  }
  const results = [...checkMachine(), ...checkJs()];
  const ios = checkIos();
  const android = checkAndroid();
  results.push(...ios.results, ...android.results, ...checkGitAndAgents());
  if (argv.includes('--setup')) {
    results.push(
      ...setupDevices({ runtime: ios.runtime, tools: android.tools })
    );
  }
  results.push(
    ...checkDevices({
      runtime: ios.runtime,
      emulator: android.tools.emulator,
      adb: android.tools.adb,
    })
  );
  // Last, and not part of a plain doctor run: priming is a dozen minutes of
  // compiling that nobody asked for while reading a report. `--json` still gets
  // the rows so a machine-mint script can read what it cost.
  if (argv.includes('--prime')) {
    results.push(...primeCaches());
  }
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  } else {
    print(results);
  }
  return exitCode(results);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main();
}

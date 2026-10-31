/**
 * `--dry-run`: what a bench run *would* do, without booting, building or measuring.
 *
 * Minting this machine's baselines (RECOVERY's first step) failed twice on things
 * only reading the code revealed: there was no per-machine baseline to write to, and
 * the iOS device key came from the simulator's *name*. Both are answerable in a
 * second by a command that prints what it resolved, so a three-hour plan is not the
 * first thing to tell you.
 *
 * Two halves, deliberately:
 *
 *   - `dryRunReport` is pure: the device answer, the load average, the flag list and
 *     whether a file exists all come in as arguments, so the rules are unit tests
 *     rather than a machine (`scripts/__tests__/bench-dry-run.test.js`).
 *   - `dryRun` is the gatherer: one read-only `simctl list`, one read of the AVD's
 *     own files, `os.loadavg`. It calls nothing that boots, builds or installs -
 *     `resolveIosDevice` boots a stopped simulator and `resolveAndroidDevice`
 *     requires a running emulator, which is exactly what a pre-flight has to survive.
 *
 * The refusals are the runner's own functions called on the runner's own inputs
 * (`machineLabelProblem`, `baselineFileFor`, `loadBlocker`), so a dry run cannot
 * disagree with the run it describes.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  baselineFileFor,
  foundingDependencies,
  labelPreFlightProblem,
  machineLabelFromEnv,
  machineLabelProblem,
} from './baseline.mjs';
import {
  deviceClassName,
  iosDeviceClassName,
  iosDeviceKey,
} from './devices.mjs';
import {
  buildSchedule,
  loadBlocker,
  loadCeiling,
  mergeBaselineProblems,
  mergeRunProblems,
  narrowingProblem,
  parseTimeoutFlags,
  timeoutRuleProblem,
} from './lib.mjs';
import { installedPackageVersions, mergeCandidateRun } from './machine.mjs';
import { resolvedDependencies } from './deps.mjs';

/**
 * Everything `--dry-run` prints and decides about a **merge mint**, from inputs it
 * can gather without booting anything (X14).
 *
 * A merge is the one mint `narrowingProblem()` must not refuse - writing one
 * component's cells into an existing file *is* a narrowed schedule - so the
 * questions that replace it are asked here, before a device is booted: does this
 * machine's file exist, does it already hold this component, is anything else
 * narrowing the run, and is the environment comparable with the file's. Three of
 * those are pure (a file and a component name); the environment half needs a
 * stand-in for the run, which is what `mergeCandidateRun()` builds from the host,
 * a read-only device listing and `bun.lock`.
 *
 * Fields the candidate cannot know yet - a system-image fingerprint, an ART compile
 * state - come back as `deferred`, and `run.mjs` asks them again of the measured run
 * before writing. `allowDeferred` is only ever passed here, never for the write.
 *
 * @param {{
 *   platform: 'ios'|'android',
 *   plan: string,
 *   launches: number,
 *   perfMarks: boolean,
 *   component: string | null,
 *   only?: string | null,
 *   scenario?: string | null,
 *   n?: number | null,
 *   timeouts?: { mountTimeoutMs: number|null, presentedTimeoutMs: number|null } | null,
 *   dirty?: boolean,
 *   baseline?: any | null,
 *   exists?: boolean,
 *   deviceKey: string | null,
 *   device?: any,
 *   dependencies?: any,
 *   resolved?: Record<string, {value: unknown, why: string} | null>,
 *   scheduleLength?: number | null,
 *   componentPlanLength?: number | null,
 *   allowDeferred?: boolean,
 *   now?: () => string,
 * }} input
 * @returns {{ problems: string[], unverified: Array, deferred: Array, note: string
 *   | null, seeded: object, foundingDependencies: any, skipped: boolean }}
 */
export function mergePreflight(input) {
  const {
    platform,
    plan,
    launches,
    perfMarks,
    component,
    only = null,
    scenario = null,
    n = null,
    timeouts = null,
    dirty = false,
    baseline = null,
    exists = false,
    deviceKey,
    device = {},
    machine = null,
    dependencies = null,
    scheduleLength = null,
    componentPlanLength = null,
    allowDeferred = false,
    now,
  } = input;
  if (component == null) {
    return {
      problems: [],
      unverified: [],
      deferred: [],
      note: null,
      seeded: {},
      foundingDependencies: null,
      skipped: true,
    };
  }
  const candidate = mergeCandidateRun({
    platform,
    plan,
    launches,
    perfMarks,
    dirty,
    deviceKey,
    device,
    dependencies,
    timeouts,
    ...(machine == null ? {} : { machine }),
    ...(now == null ? {} : { now }),
  });
  const problems = mergeRunProblems({ plan, launches, perfMarks, dirty });
  const decided = mergeBaselineProblems({
    run: candidate,
    baseline,
    exists,
    component,
    filters: { only, scenario, n },
    scheduled: scheduleLength,
    componentPlan: componentPlanLength,
    allowDeferred,
    ...(input.resolved == null ? {} : { resolved: input.resolved }),
  });
  return {
    problems: [...problems, ...decided.problems],
    unverified: decided.unverified,
    deferred: decided.deferred ?? [],
    note: decided.note,
    seeded: decided.seeded,
    foundingDependencies: decided.foundingDependencies,
    skipped: false,
  };
}

/**
 * The versions a merge pre-flight can name: `bun.lock` in the working tree, plus the
 * ones recovered from a pre-X14 file's own founding commit (X14).
 *
 * The second half is what lets a comparison run against the four committed
 * baselines, none of which records what app produced it. `git` is injected and
 * read-only so the unit tests can hand it a fake revision, and a lock or revision
 * that cannot be read yields nulls - which the merge refuses rather than matching
 * against another blank.
 */
export function mergeDependencyEvidence({
  lockPath,
  nodeModulesDir,
  git = null,
  baseline = null,
  read = (file) => fs.readFileSync(file, 'utf8'),
}) {
  const tryRead = (file) => {
    try {
      return read(file);
    } catch {
      return null;
    }
  };
  const resolved = resolvedDependencies({
    lockText: tryRead(lockPath),
    manifestText: tryRead(
      path.join(path.dirname(lockPath), 'bench', 'package.json')
    ),
    source: 'bun.lock in the working tree',
  });
  const dependencies = {
    reactNative: resolved.reactNative,
    expoUi: resolved.expoUi,
    installedReactNative: null,
    installedExpoUi: null,
    source: resolved.source,
  };
  if (nodeModulesDir != null) {
    const installed = installedPackageVersions({ nodeModulesDir, read });
    dependencies.installedReactNative = installed.reactNative;
    dependencies.installedExpoUi = installed.expoUi;
  }
  return {
    dependencies,
    resolved: foundingDependencyEvidence({ git, baseline }),
    problems: resolved.problems,
  };
}

/**
 * The app versions recorded at the commit a baseline's own `sha` names, in the shape
 * `mergeBaselineProblems({ resolved })` wants.
 *
 * One implementation lives in `baseline.mjs` (`foundingDependencies()`), which is what
 * the authoritative check runs. `dry-run.mjs` used to carry its own copy of the same
 * eleven lines and the two drifted the moment one of them learned something new, so
 * the pre-flight asks the original instead — which is safe because the dependency
 * only points *down* this way: `baseline.mjs` imports `deps.mjs` and `lib.mjs`, never
 * this module.
 */
export function foundingDependencyEvidence({ git = null, baseline = null }) {
  const recovered = foundingDependencies({ git, baseline });
  return {
    'dependencies.reactNative': recovered['dependencies.reactNative'],
    'dependencies.expoUi': recovered['dependencies.expoUi'],
  };
}

/**
 * The iOS device key from a simulator listing alone.
 *
 * The same three fields `resolveIosDevice` uses - the runtime bucket's identifier,
 * the entry's `deviceTypeIdentifier`, and `name` only as the fallback - with no
 * `simctl boot` behind it. A stopped simulator is a normal answer here, not a
 * problem: that is the case where booting would be the mistake.
 *
 * @param {{
 *   udid: string | null,
 *   listing: { devices?: Record<string, Array<Record<string, unknown>>> } | null,
 * }} input
 * @returns {{deviceKey: string | null, detail: string | null, problem: string | null}}
 */
export function iosDryRunDevice({ udid, listing }) {
  if (udid == null || udid === '') {
    return {
      deviceKey: null,
      detail: null,
      problem:
        'IOS_SIM_UDID is not set, so no simulator can be resolved - lease one (node scripts/lease.mjs acquire --task <ID>)',
    };
  }
  if (listing == null) {
    return {
      deviceKey: null,
      detail: null,
      problem:
        '`xcrun simctl list devices -j` did not answer, so no simulator can be resolved',
    };
  }
  const bucket = Object.entries(listing.devices ?? {}).find(([, devices]) =>
    devices.some((entry) => entry.udid === udid)
  );
  if (bucket == null) {
    return {
      deviceKey: null,
      detail: null,
      problem: `iOS simulator ${udid} is not in this machine's listing (create it, or use the UDID your lease hands you)`,
    };
  }
  const [runtimeId, devices] = bucket;
  const device = devices.find((entry) => entry.udid === udid);
  // Same derivation as `resolveIosDevice`: `...SimRuntime.iOS-27-0` -> `27.0`.
  const runtime =
    /iOS-(\d+(?:-\d+)?)/.exec(runtimeId)?.[1]?.replace('-', '.') ?? null;
  return {
    deviceKey: iosDeviceKey(runtime, device),
    detail: `"${device.name}" ${String(device.state ?? 'Unknown')}, iOS ${runtime ?? 'unknown'}, class ${iosDeviceClassName(device)}`,
    // The same shape `collectMachine` reads a live device through, so a merge
    // pre-flight compares like with like (`run.mjs`'s own pre-flight uses this).
    device: { name: device.name ?? null, sdk: null, runtime },
    problem: null,
  };
}

/**
 * The hardware profile and API level of an AVD that is *not* running, from its files.
 *
 * A dry run cannot ask a device (`adb shell getprop`) because the honest case is a
 * stopped AVD, and starting one is what this command must not do. The AVD directory
 * already holds both answers: `hw.device.name` is the same key `resolveAndroidDevice`
 * reads for a live one, and the system-image path carries the API level, with the
 * sidecar `.ini`'s `target=android-<n>` behind it. Nulls rather than guesses - a
 * fallback that happened to equal the real value would make a failed read invisible.
 *
 * @param {{
 *   avd: string | null,
 *   read: (file: string) => string | null,
 *   avdHome: string,
 * }} input
 * @returns {{apiLevel: string | null, profile: string | null, from: string | null, missing: boolean}}
 */
export function readAvdHardware({ avd, read, avdHome }) {
  if (avd == null || avd === '') {
    return { apiLevel: null, profile: null, from: null, missing: true };
  }
  const dir = path.join(avdHome, `${avd}.avd`, 'config.ini');
  const sidecar = path.join(avdHome, `${avd}.ini`);
  const config = read(dir);
  const meta = read(sidecar);
  if (config == null && meta == null) {
    return { apiLevel: null, profile: null, from: null, missing: true };
  }
  const key = (text, name) => {
    if (text == null) return null;
    for (const line of text.split('\n')) {
      const [left, ...rest] = line.split('=');
      if (left?.trim() === name && rest.length > 0) {
        return rest.join('=').trim() || null;
      }
    }
    return null;
  };
  const apiLevel =
    /android-(\d+)/.exec(key(config, 'image.sysdir.1') ?? '')?.[1] ??
    /android-(\d+)/.exec(key(meta, 'target') ?? '')?.[1] ??
    null;
  return {
    apiLevel,
    profile: key(config, 'hw.device.name'),
    from: config != null ? dir : sidecar,
    missing: false,
  };
}

/**
 * The Android device key without touching a device.
 *
 * @param {{
 *   avd: string | null,
 *   serial: string | null,
 *   hardware: { apiLevel: string | null, profile: string | null, missing: boolean },
 *   attachedSerials: string[],
 * }} input
 * @returns {{deviceKey: string | null, detail: string, problem: string | null}}
 */
export function androidDryRunDevice({
  avd,
  serial,
  hardware,
  attachedSerials,
}) {
  if (avd == null && serial == null) {
    return {
      deviceKey: null,
      detail: 'nothing assigned',
      problem:
        'ANDROID_AVD (or ANDROID_SERIAL) is not set, so no emulator can be resolved - lease one (node scripts/lease.mjs acquire --task <ID>)',
    };
  }
  const problems = [];
  if (hardware.missing) {
    problems.push(
      `no config.ini for AVD "${avd ?? '?'}" under ~/.android/avd, so its API level and hardware profile are unknown here`
    );
  }
  // Both halves or neither: an API level with no profile would produce
  // `android33-emu-`, a key shaped like a real one that matches no committed
  // baseline - the worst kind of wrong answer, because it reads as resolved.
  if (hardware.apiLevel == null || hardware.profile == null) {
    problems.push(
      `the device key cannot be built from this AVD's files (API level ${hardware.apiLevel ?? 'unknown'}, profile ${hardware.profile ?? 'unknown'})`
    );
  }
  const attached = serial != null && attachedSerials.includes(serial);
  return {
    deviceKey:
      hardware.apiLevel == null || hardware.profile == null
        ? null
        : `android${hardware.apiLevel}-emu-${deviceClassName(hardware.profile)}`,
    detail:
      `AVD ${avd ?? '?'}, API ${hardware.apiLevel ?? 'unknown'}, profile ${hardware.profile ?? 'unknown'}, ` +
      (attached
        ? `attached as ${serial}`
        : `${serial ?? 'no serial'} not attached (a run boots it; this command does not)`),
    // The shape `collectMachine` reads a live device through (`avd`/`sdk`/`image`),
    // so a merge pre-flight compares like with like. The system-image fingerprint is
    // null on purpose: only a booted device can answer that, and inventing one would
    // let the guard pass on a blank (`androidImage` is a *deferred* field).
    device: {
      avd,
      sdk: hardware.apiLevel,
      image: null,
      profile: hardware.profile,
    },
    problem: problems.length === 0 ? null : problems.join('; '),
  };
}

/**
 * Everything `--dry-run` prints and decides, from injected inputs.
 *
 * A flag that was not passed is never a reason not to run: an unlabelled machine is
 * information for a plain run and a refusal for `--check`. The distinction is the
 * whole shape of the exit code, so it is asserted on directly.
 *
 * @param {{
 *   platform: 'ios' | 'android',
 *   plan: string,
 *   launches: number,
 *   component: string | null,
 *   argv: string[],
 *   env?: Record<string, string | undefined>,
 *   deviceKey: string | null,
 *   deviceDetail: string | null,
 *   deviceProblem: string | null,
 *   cpuCount: number,
 *   loadavg1: number | null,
 *   baselinesDir: string,
 *   existsSync?: (file: string) => boolean,
 *   relative?: (file: string) => string,
 * }} input
 * @returns {{lines: string[], problems: string[], exitCode: number}}
 */
export function dryRunReport(input) {
  const {
    platform,
    plan,
    launches,
    component,
    argv,
    env = process.env,
    deviceKey,
    deviceDetail,
    deviceProblem,
    cpuCount,
    loadavg1,
    baselinesDir,
    existsSync = (file) => fs.existsSync(file),
    readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8')),
    relative = (file) => path.relative(process.cwd(), file),
    /**
     * What a merge pre-flight can ask about without a device: the device's
     * half-answered identity (`{ name, sdk, runtime }` from the AVD config or the
     * simulator listing) and a gatherer for the app versions, called with the target
     * file so it can recover what that file's own founding commit pinned. Both are
     * null in a unit test that asks a different question.
     */
    deviceInfo = null,
    /**
     * The host summary the merge pre-flight compares with the file's, injected for
     * the same reason the device key and load average are: this half is a unit test
     * rather than a machine. The gatherer omits it, and the candidate then reports
     * the real host.
     */
    machine = null,
    mergeEvidence = null,
  } = input;

  const minting = argv.includes('--update-baseline');
  const checking = argv.includes('--check');
  const forced = argv.includes('--force');
  // The run's own schedule builder, so the launch count and the `--component` /
  // `--only` / `--scenario` refusals are the real ones rather than a re-derivation that
  // could drift. It throws for exactly the cases worth naming, so the message is kept.
  let schedule = [];
  let scheduleProblem = null;
  const filters = {
    only: argv.includes('--only')
      ? String(argv[argv.indexOf('--only') + 1])
      : null,
    component,
    scenario: argv.includes('--scenario')
      ? String(argv[argv.indexOf('--scenario') + 1])
      : null,
    n: argv.includes('--n') ? Number(argv[argv.indexOf('--n') + 1]) : null,
  };
  try {
    schedule = buildSchedule({
      plan,
      launches,
      perfMarks: argv.includes('--perf-marks'),
      platform,
      ...filters,
    });
  } catch (error) {
    scheduleProblem = String(error.message ?? error);
  }
  const dimension = (pick) => new Set(schedule.map(pick)).size;
  const label = machineLabelFromEnv(env);
  const ceiling = loadCeiling(cpuCount);
  const blocker = loadBlocker({ loadavg1, cpuCount });
  const problems = [];

  const lines = [
    `Platform:  ${platform}`,
    `Plan:      ${plan}${
      scheduleProblem == null
        ? ` (${String(dimension((entry) => `${entry.scenario}:${entry.n}`))} cells x ${String(
            dimension((entry) => entry.implementation)
          )} implementations x ${String(
            dimension((entry) => entry.launch)
          )} launches = ${String(schedule.length)} launches)`
        : ' (no schedule)'
    }`,
    `Device:    ${deviceKey ?? 'UNKNOWN'}${deviceDetail == null ? '' : ` - ${deviceDetail}`}`,
    `Machine:   ${label}`,
    `Load:      ${loadavg1 == null ? 'unknown' : loadavg1.toFixed(2)} now, ceiling ${
      ceiling == null ? 'unknown' : ceiling.toFixed(1)
    } for ${String(cpuCount)} cores`,
  ];
  if (scheduleProblem != null) problems.push(scheduleProblem);
  if (deviceProblem != null) problems.push(deviceProblem);
  if (blocker != null) lines.push(`           busy: ${blocker}`);

  // The baseline path, through the same resolver the runner uses: it is the one
  // place that refuses a bad label by throwing, and a dry run that rebuilt the path
  // itself would print a file the run would never open. Because that resolver
  // *throws*, the two reasons it would refuse are asked first: X8's own pre-flight
  // (N7 - `run.mjs` refuses with this same function, so a dry run cannot print a
  // refusal the run would not produce, nor prefix a flag twice) for a run that
  // gates a baseline, and X8's predicate for one that does not. The second is what
  // an unlabelled *plain* run needs: it asks for no baseline, so the pre-flight
  // says nothing, and calling the resolver anyway threw out of `--dry-run`.
  let baselinePath = null;
  const labelProblem = labelPreFlightProblem(argv, env);
  const labelIsUsable = machineLabelProblem(label, { flag: 'dry-run' }) == null;
  if (labelProblem == null && labelIsUsable && deviceKey != null) {
    baselinePath = baselineFileFor({
      baselinesDir,
      deviceKey,
      machineLabel: label,
    });
  }
  const exists = baselinePath == null ? null : existsSync(baselinePath);
  // A merge pre-flight reads the file it would write into. Read lazily and only for
  // that shape: a `--check` does not need the contents, and a corrupt file is the
  // check's problem to report, not something to throw over here. Not gated on
  // `--force`, because the merge rules are not overridable.
  let mergeBaseline = null;
  if (minting && component != null && baselinePath != null && exists === true) {
    try {
      mergeBaseline = readJson(baselinePath);
    } catch (error) {
      problems.push(
        `--update-baseline --component ${String(component)}: ${relative(baselinePath)} could not be read (${String(
          error instanceof Error ? error.message : error
        )})`
      );
    }
  }
  lines.push(
    `Baseline:  ${
      baselinePath == null
        ? 'unknown - needs a machine label and a resolved device key'
        : `${relative(baselinePath)} ${exists ? 'exists' : 'does not exist'}`
    }`
  );

  if (minting || checking) {
    const flag = minting ? '--update-baseline' : '--check';
    const mergeLines = [];
    // The waiting rule is knowable from the flags, so the dry run answers the same
    // question the runner asks at startup (review N1): a mint under a non-default
    // wait is a diagnostic, and "would start" here would be wrong. The same values
    // are what the merge pre-flight below compares against the file's `timeouts`.
    const timeouts = parseTimeoutFlags(
      argv,
      (name) => {
        const at = argv.indexOf(name);
        return at === -1 ? null : (argv[at + 1] ?? null);
      },
      platform
    );
    if (labelProblem != null) {
      // Pushed whole, and un-prefixed: X8's function already names the flag, and its
      // second line is the fix (`export NITRO_UI_MACHINE_LABEL=…`), already indented
      // to line up under this column. Truncating to the first line, and prefixing it
      // again, printed `--check: --check:` and dropped the thing to do about it.
      problems.push(labelProblem);
    }
    if (deviceKey == null) {
      problems.push(
        `${flag}: the device key is unknown, so there is no baseline file to ${minting ? 'write' : 'gate against'}`
      );
    }
    if (minting && blocker != null && !forced) {
      problems.push(`--update-baseline: ${blocker} (pass --force to override)`);
    }
    // The same narrowing guard `run.mjs` applies before it boots anything, so a dry
    // run cannot print "would start" for a mint the run would refuse.
    if (minting && !forced) {
      const waiting = timeoutRuleProblem({
        platform,
        mountTimeoutMs: timeouts.mountTimeoutMs,
        presentedTimeoutMs: timeouts.presentedTimeoutMs,
      });
      if (waiting != null) {
        problems.push(`--update-baseline: ${waiting}`);
      }
    }
    if (minting && !forced && component == null) {
      const narrowed = narrowingProblem({
        scheduled: schedule.length,
        wholePlan: buildSchedule({
          plan,
          launches,
          platform,
          perfMarks: argv.includes('--perf-marks'),
        }).length,
        filters,
      });
      if (narrowed != null) {
        problems.push(
          `--update-baseline: ${narrowed} (pass --force to override)`
        );
      }
    }
    // The merge question (X14), asked of the file the run would write into. A
    // `--component` mint replaces the narrowing refusal above with this one, so a
    // dry run has to answer it or it would print "would start" for a run the
    // runner refuses before booting. Unlike the guards above, `--force` does not
    // silence it: force overrules judgements about the measurement, and whether
    // these numbers belong in this file is not one.
    if (minting && component != null && deviceKey != null) {
      // Gathered only now, and for this file: the founding-commit half of the
      // version evidence is a question about the file, not about the machine.
      const evidence = mergeEvidence?.(mergeBaseline) ?? null;
      const merged = mergePreflight({
        platform,
        plan,
        launches,
        perfMarks: argv.includes('--perf-marks'),
        component,
        only: filters.only,
        scenario: filters.scenario,
        n: filters.n,
        timeouts,
        dirty: false,
        baseline: mergeBaseline,
        exists: exists === true,
        deviceKey,
        device: deviceInfo ?? {},
        ...(machine == null ? {} : { machine }),
        dependencies: evidence?.dependencies ?? null,
        ...(evidence?.resolved == null ? {} : { resolved: evidence.resolved }),
        scheduleLength: schedule.length,
        // The component's own plan size, which is what a merge has to fully cover.
        componentPlanLength: buildSchedule({
          plan,
          launches,
          platform,
          perfMarks: argv.includes('--perf-marks'),
          component,
        }).length,
        allowDeferred: true,
      });
      // The run's own faults (plan, launch count, marks, dirty tree) stay
      // overridable, exactly as they are in `run.mjs`; the file's answer is not.
      const runProblems = merged.problems.filter((reason) =>
        forced
          ? !/plan "|launches per cell|perf marks|working tree is dirty/.test(
              reason
            )
          : true
      );
      problems.push(...runProblems);
      for (const entry of merged.unverified) {
        mergeLines.push(`Merge:     ${entry.reason}`);
      }
      for (const entry of merged.deferred) {
        mergeLines.push(`Merge:     deferred - ${entry.reason}`);
      }
    }
    if (checking && exists === false) {
      problems.push(
        `--check: no baseline at ${relative(String(baselinePath))} - create it with --update-baseline`
      );
    }
    // What the merge accepted without measuring, and what it could not ask yet,
    // printed before the verdict so a reader sees which fields the answer rested on.
    lines.push(...mergeLines);
    lines.push(
      `${(minting ? 'Mint:' : 'Check:').padEnd(11)}${
        problems.length === 0 ? 'would start' : 'would refuse'
      }`
    );
  } else if (machineLabelProblem(label, { flag: '--dry-run' }) != null) {
    // The note for a run that gates nothing: `labelPreFlightProblem` returns null
    // here by design (no flag to refuse), so this asks X8's predicate directly
    // rather than re-deriving which flag would have asked.
    lines.push(
      'Note:      no machine label - fine for a plain run, needed by --check and --update-baseline'
    );
  }

  for (const reason of problems) lines.push(`Reason:    ${reason}`);
  lines.push(
    problems.length === 0
      ? `Dry run:   OK - ${minting ? 'a mint' : checking ? 'a check' : 'a run'} could start`
      : `Dry run:   ${String(problems.length)} reason(s) not to start it as asked`
  );
  return { lines, problems, exitCode: problems.length === 0 ? 0 : 2 };
}

/** Where AVDs live, honouring `ANDROID_AVD_HOME` the way the emulator does. */
export function avdHomeFrom(env = process.env) {
  if (env.ANDROID_AVD_HOME != null && env.ANDROID_AVD_HOME !== '') {
    return env.ANDROID_AVD_HOME;
  }
  return path.join(env.HOME ?? env.USERPROFILE ?? '', '.android', 'avd');
}

/** `xcrun simctl list devices -j`, or null when the tool is not there. Read-only. */
export function simctlListing(env = process.env) {
  try {
    return JSON.parse(
      execFileSync('xcrun', ['simctl', 'list', 'devices', '-j'], {
        encoding: 'utf8',
        timeout: 60_000,
        env,
      })
    );
  } catch {
    return null;
  }
}

/**
 * The emulators adb sees, or an empty list.
 *
 * A convenience line ("is my AVD up?"), so a machine with no Android SDK still gets
 * a dry run rather than a stack trace.
 */
export function attachedEmulatorSerials(env = process.env) {
  const home = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
  const adb = home != null ? path.join(home, 'platform-tools', 'adb') : 'adb';
  try {
    return execFileSync(adb, ['devices'], {
      encoding: 'utf8',
      timeout: 30_000,
      env,
    })
      .split('\n')
      .filter((line) => line.endsWith('\tdevice'))
      .map((line) => String(line.split('\t')[0]));
  } catch {
    return [];
  }
}

/**
 * The gatherer: read-only tool output, then `dryRunReport`.
 *
 * @param {{
 *   argv: string[],
 *   platform: 'ios' | 'android',
 *   plan: string,
 *   launches: number,
 *   component: string | null,
 *   baselinesDir: string,
 *   env?: NodeJS.ProcessEnv,
 *   write?: (line: string) => void,
 * }} options
 * @returns {number} 0 when the run as asked could start, 2 with reasons when not
 */
export function dryRun({
  argv,
  platform,
  plan,
  launches,
  component,
  baselinesDir,
  env = process.env,
  machine = null,
  write = (line) => process.stdout.write(`${line}\n`),
  /**
   * Gathers the version evidence a merge pre-flight asks for, called with the target
   * file (X14). Injected rather than built here because the paths are the caller's:
   * `run.mjs` knows the repo root, and this module stays free of `build.mjs` so the
   * unit tests can hand it a fixture instead of the real `bun.lock`.
   */
  mergeEvidence = null,
}) {
  let device;
  if (platform === 'ios') {
    const udid = env.IOS_SIM_UDID ?? null;
    // Only asks Xcode when there is a UDID to look for: nothing is assigned, the
    // answer is already known, and a pre-flight should not pay for a tool call it
    // cannot use the result of.
    device = iosDryRunDevice({
      udid,
      listing: udid == null || udid === '' ? null : simctlListing(env),
    });
  } else {
    device = androidDryRunDevice({
      avd: env.ANDROID_AVD ?? env.AVD ?? null,
      serial: env.ANDROID_SERIAL ?? null,
      hardware: readAvdHardware({
        avd: env.ANDROID_AVD ?? env.AVD ?? null,
        avdHome: avdHomeFrom(env),
        read: (file) => {
          try {
            return fs.readFileSync(file, 'utf8');
          } catch {
            return null;
          }
        },
      }),
      attachedSerials: attachedEmulatorSerials(env),
    });
  }

  const report = dryRunReport({
    platform,
    plan,
    launches,
    component,
    argv,
    env,
    deviceKey: device.deviceKey,
    deviceDetail: device.detail,
    deviceProblem: device.problem,
    deviceInfo: device.device ?? null,
    ...(machine == null ? {} : { machine }),
    cpuCount: os.cpus().length,
    loadavg1: os.loadavg()[0] ?? null,
    baselinesDir,
    ...(mergeEvidence == null ? {} : { mergeEvidence }),
  });
  for (const line of report.lines) write(line);
  return report.exitCode;
}

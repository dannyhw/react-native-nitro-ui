/**
 * One Android emulator launch configuration, apart from the launchers.
 *
 * Why (X11): three paths started emulators and they did not agree.
 * `react-native-harness` booted `-gpu swiftshader_indirect` (software
 * rendering), `scripts/real-input/android.mjs` told its caller `-gpu host`, and
 * so the GPU mode depended on whoever happened to boot the emulator first -
 * which is why the Android harness took 455 s for 214 tests against iOS's 149 s
 * for 165. Whoever boots a pool device now decides it from this file, and every
 * launcher takes its arguments from here.
 *
 * The three paths:
 *
 *   - `patches/@react-native-harness%2Fplatform-android@1.6.0.patch` - the
 *     harness's own boot. It embeds, verbatim, the blocks this file renders
 *     (`harnessLaunchBlock()` / `harnessAccelBlock()` /
 *     `harnessAccelCallerLines()`), and
 *     `scripts/__tests__/emulator-launch.test.js` fails when the patch stops
 *     containing those strings or when evaluating the *installed* file stops
 *     agreeing with `emulatorLaunchArgs()` and `accelerationUsable()`. That is
 *     what makes it one source rather than a copy with a comment.
 *
 * To change the harness's launch configuration: edit this file, then run
 * `scripts/patch-harness-android.mjs`, which rebuilds the patch from a pristine
 * copy of the installed module, applies it, and leaves the package uninstalled
 * so a forgotten regeneration cannot pass with stale `node_modules`.
 *   - `scripts/lease.mjs` boots a leased pair's devices with `emulatorLaunchArgs`.
 *   - `scripts/real-input/android.mjs` prints the boot command it expects, built
 *     from `emulatorLaunchCommand`.
 *
 * **Benches are deliberately not in that list.** A baseline is a measurement of
 * one machine's device and the committed ones were minted on whatever boot the
 * bench host had, so `scripts/bench/**` still passes no launch arguments at all.
 * See `BENCH_GPU_MODE_NOTE`.
 *
 * No `import.meta` here, so `scripts/__tests__/emulator-launch.test.js` can
 * import it (the same reason `scripts/lease-core.mjs` exists next to
 * `scripts/lease.mjs`).
 */

/**
 * The environment variable that overrides the GPU mode, read by every launcher
 * here (including the patched harness). It exists for two reasons: X11's own
 * A/B measurement (same tree, same device, two GPU modes) has to be possible
 * without editing `node_modules`, and a bench host that needs the mode a
 * baseline was minted with can pin it for its own shell.
 */
export const EMULATOR_GPU_ENV = 'NITRO_UI_EMULATOR_GPU';

/**
 * The GPU mode the harness, the lease pool and real-input boot with.
 *
 * `host` renders on the machine's own GPU; `swiftshader_indirect` - what
 * `react-native-harness` hard-coded - renders in software on the CPU. The value
 * is safe on every machine this repo gates on, and the emulator falls back to
 * software itself when there is no host GPU to take.
 */
export const HARNESS_GPU_MODE = 'host';

/** What `react-native-harness` ships with, and the software fallback. */
export const SOFTWARE_GPU_MODE = 'swiftshader_indirect';

/**
 * What the bench path does, written down because a reader who looks here and
 * finds no bench entry will assume it was missed: `scripts/bench/**` never
 * starts an emulator and never chooses a GPU mode, so baselines keep the boot
 * the bench host's device already has.
 */
export const BENCH_GPU_MODE_NOTE =
  'scripts/bench/** boots no emulator and passes no launch arguments, so a bench ' +
  'measures the device as it finds it. Pin NITRO_UI_EMULATOR_GPU in the bench ' +
  "host's own shell if a baseline needs a particular GPU mode.";

/** The emulator console ports `-port` accepts: even, 5554-5682 (see lease-core). */
export const EMULATOR_PORT_FLOOR = 5554;
export const EMULATOR_PORT_CEILING = 5682;

/**
 * Is this a console port the emulator can be told to take? The same rule
 * `checkEmulatorEnv` applies to `EMULATOR_PORT`, in one place so the harness
 * patch cannot quietly disagree with the lease about which ports are bootable.
 *
 * @param {unknown} port
 * @returns {boolean}
 */
export function isEmulatorConsolePort(port) {
  const text = String(port ?? '');
  if (!/^\d+$/.test(text)) return false;
  const value = Number(text);
  return (
    value % 2 === 0 &&
    value >= EMULATOR_PORT_FLOOR &&
    value <= EMULATOR_PORT_CEILING
  );
}

/**
 * The GPU mode this process should launch with: the override, or `host`.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function emulatorGpuMode(env = process.env) {
  const override = env[EMULATOR_GPU_ENV];
  return typeof override === 'string' && override.trim() !== ''
    ? override.trim()
    : HARNESS_GPU_MODE;
}

/**
 * The snapshot flags for one boot mode, matching what the harness passes.
 *
 * `reuse` loads the AVD's saved snapshot (what a warm pool wants); `generate`
 * boots clean so a snapshot can be saved; `cold` boots clean and saves nothing.
 *
 * @param {'reuse' | 'generate' | 'cold'} [mode]
 * @returns {string[]}
 */
export function emulatorSnapshotArgs(mode = 'cold') {
  if (mode === 'reuse') return ['-no-snapshot-save'];
  if (mode === 'generate') return ['-no-snapshot-load'];
  return ['-no-snapshot-load', '-no-snapshot-save'];
}

/**
 * One emulator's full boot argv.
 *
 * `@<avd>` rather than `-avd <avd>` because that is the form the harness uses
 * and the form the emulator records in its own `emu-launch-params.txt`. The
 * form matters only in that the drift test compares the two launchers token by
 * token.
 *
 * @param {object} options
 * @param {string} options.avd the AVD name
 * @param {number | string | null} [options.port] console port to claim
 * @param {'reuse' | 'generate' | 'cold'} [options.snapshot]
 * @param {string | null} [options.gpuMode] overrides the env/`HARNESS_GPU_MODE` choice
 * @returns {string[]}
 */
export function emulatorLaunchArgs({
  avd,
  port = null,
  snapshot = 'cold',
  gpuMode = null,
}) {
  if (typeof avd !== 'string' || avd === '') {
    throw new Error('emulatorLaunchArgs needs an avd name');
  }
  const args = [`@${avd}`];
  // `-port` straight after the AVD, so the port a device claimed is the first
  // thing a console shows: the failure this arg exists to prevent is a leased
  // AVD coming up as somebody else's serial.
  //
  // A port that was *offered* and cannot be taken is an error, not a reason to
  // leave `-port` out (X11 review N2): dropping it silently is precisely the
  // "boot on whatever console is free" behaviour the flag exists to forbid, and
  // it turns a mistyped devices.json into a device nobody can address. An
  // absent port is the other case, and legitimate: upstream, and every run
  // outside a lease, boots without one.
  if (port != null && port !== '') {
    if (!isEmulatorConsolePort(port)) {
      throw new Error(
        `emulatorLaunchArgs: ${String(port)} is not a console port the emulator can take ` +
          `(even numbers ${String(EMULATOR_PORT_FLOOR)}-${String(EMULATOR_PORT_CEILING)}); ` +
          'booting without -port would put this AVD on any free serial'
      );
    }
    args.push('-port', String(port));
  }
  args.push(
    ...emulatorSnapshotArgs(snapshot),
    '-no-window',
    '-gpu',
    gpuMode ?? emulatorGpuMode(),
    '-noaudio',
    '-no-boot-anim',
    '-no-metrics'
  );
  return args;
}

/**
 * The same argv as a line a human can paste, with `-avd <name>` because it reads
 * better in an error message and behaves identically.
 *
 * @param {Parameters<typeof emulatorLaunchArgs>[0]} options
 * @param {string} [emulatorBinary]
 * @returns {string}
 */
export function emulatorLaunchCommand(options, emulatorBinary = 'emulator') {
  const args = emulatorLaunchArgs(options);
  const avd = args[0].slice(1);
  return [emulatorBinary, '-avd', avd, ...args.slice(1)].join(' ');
}

/* ------------------------- the patch's rendered blocks ---------------------- */

/**
 * The block the harness patch embeds to build its boot argv.
 *
 * This is the one place the harness's launch configuration is written. The drift
 * test reads the patch file, requires this exact text inside it, and checks the
 * installed file's `getEmulatorStartupArgs()` still agrees with
 * `emulatorLaunchArgs()`. Change this file without regenerating the patch, or
 * hand-edit the patch, and that test goes red either way.
 *
 * It has to be dependency-free JS: it runs inside
 * `node_modules/@react-native-harness/platform-android/dist/emulator-startup.js`,
 * which knows nothing about this repository.
 *
 * @returns {string}
 */
export function harnessLaunchBlock() {
  return `    // nitro-ui patch: boot on the console port the caller was assigned, on the
    // GPU this repo's launch configuration names. Several tasks share one
    // machine, each with its own AVD, its own private adb server and a device
    // the person owns that must never be used. Without \`-port\` the emulator
    // takes the lowest free console port, so a leased AVD can land on a serial
    // another task was told not to touch, and the serial the lease exported
    // (\`emulator-5574\`) is not the one that exists. When EMULATOR_PORT is set
    // the emulator either gets that port or fails to start - which is the
    // answer a lease needs; a port that cannot be a console port at all is a
    // mistake in the environment, and dropping \`-port\` there would boot the AVD
    // on any free serial, which is the very thing this patch prevents. The GPU
    // mode is \`host\` rather than upstream's \`swiftshader_indirect\`: software
    // rendering is most of why the Android harness costs three times iOS. Set
    // NITRO_UI_EMULATOR_GPU to override for one shell (an A/B run, or a bench
    // host pinning its baseline's mode).
    // Drop this patch once react-native-harness accepts a port and a GPU mode.
    //
    // nitro-ui: the block below is rendered verbatim by
    // scripts/emulator-launch.mjs (harnessLaunchBlock).
    // scripts/__tests__/emulator-launch.test.js fails if the patch and that
    // file disagree, or if this stops matching emulatorLaunchArgs().
    const nitroUiPort = process.env.EMULATOR_PORT ?? '';
    let nitroUiPortArgs = [];
    if (nitroUiPort !== '') {
        const nitroUiPortNumber = Number(nitroUiPort);
        const nitroUiPortOk = /^\\d+$/.test(nitroUiPort) && nitroUiPortNumber % 2 === 0 && nitroUiPortNumber >= ${EMULATOR_PORT_FLOOR} && nitroUiPortNumber <= ${EMULATOR_PORT_CEILING};
        if (!nitroUiPortOk) {
            throw new Error(\`EMULATOR_PORT="\${nitroUiPort}" is not a console port the emulator can take (even numbers ${EMULATOR_PORT_FLOOR}-${EMULATOR_PORT_CEILING})\`);
        }
        nitroUiPortArgs = ['-port', nitroUiPort];
    }
    const nitroUiGpu = (process.env.${EMULATOR_GPU_ENV} ?? '').trim() || '${HARNESS_GPU_MODE}';
    return [\`@\${name}\`, ...nitroUiPortArgs, ...modeArgs, '-no-window', '-gpu', nitroUiGpu, '-noaudio', '-no-boot-anim', '-no-metrics'];`;
}

/**
 * Phrases that mean the check itself said "no", whatever else it printed.
 * Rendered into the patch by `harnessAccelBlock()`, so the patch and this
 * function cannot disagree about what the words mean.
 */
export const ACCELERATION_UNUSABLE_PHRASES = Object.freeze([
  'is not installed',
  'is not usable',
  'not available',
  'haxm is not installed',
  'kvm is not available',
]);

/** Phrases that mean "yes" when no exit status is available. */
export const ACCELERATION_USABLE_PHRASES = Object.freeze([
  'is installed and usable',
  'hypervisor.framework',
  'hvf',
  'kvm',
  'accel',
]);

/**
 * Whether `emulator -accel-check` says hardware acceleration is usable here.
 *
 * Upstream looked for the phrase *"is installed and usable"*, which this
 * emulator version no longer prints: on the maintainer machine the check exits
 * **0** and prints `accel:` / `0` / `Hypervisor.Framework OS X Version 26.6`, so
 * every Android harness run warned that it would "fall back to very slow software
 * emulation" while it was using hardware acceleration the whole time. A warning
 * that is always wrong is worse than none - it teaches you to ignore the one line
 * that would tell you a run is being measured on software rendering.
 *
 * The rules, in order:
 *
 *   1. a known non-zero exit status means unusable, whatever was printed;
 *   2. a known zero exit status means usable - the check's own status is its
 *      answer, and an empty success still means it found nothing wrong;
 *   3. with no status to go on (a caller that only has text), the documented
 *      failure phrases mean unusable and an `accel` / `Hypervisor.Framework` /
 *      `KVM` line or upstream's old success phrase means usable.
 *
 * This is the same decision the patch embeds (see `harnessAccelBlock`), and the
 * drift test checks the installed patch against these fixtures.
 *
 * @param {object} options
 * @param {string} [options.output] stdout and stderr combined
 * @param {number | null} [options.exitCode] the check's exit status, when known
 * @returns {boolean}
 */
export function accelerationUsable({ output = '', exitCode = null } = {}) {
  const text = String(output ?? '').toLowerCase();
  if (exitCode != null) return Number(exitCode) === 0;
  if (ACCELERATION_UNUSABLE_PHRASES.some((phrase) => text.includes(phrase)))
    return false;
  return ACCELERATION_USABLE_PHRASES.some((phrase) => text.includes(phrase));
}

/**
 * The block the harness patch embeds for the accel decision: `accelerationUsable`
 * in patch-package's own indentation, with the phrase lists interpolated from the
 * constants above so the two cannot drift apart. Same contract as
 * `harnessLaunchBlock()`: the drift test requires this text inside the patch.
 *
 * @returns {string} every line indented by four spaces, as it appears in the file
 */
export function harnessAccelBlock() {
  const unusable = ACCELERATION_UNUSABLE_PHRASES.map(
    (phrase) => `'${phrase}'`
  ).join(', ');
  const usable = ACCELERATION_USABLE_PHRASES.map(
    (phrase) => `'${phrase}'`
  ).join(', ');
  return [
    `/**
 * Parses the output of \`emulator -accel-check\` to determine whether hardware
 * acceleration (KVM on Linux, HVF on macOS) is usable.
 *
 * nitro-ui patch: the exit status is the check's answer. This emulator version
 * prints "accel: / 0 / Hypervisor.Framework OS X Version ..." rather than the
 * phrase upstream looked for ("is installed and usable"), so every Android
 * harness run on a machine with Hypervisor.Framework warned that it was about
 * to fall back to very slow software emulation while it was using hardware
 * acceleration the whole time (docs/tasks/X11-device-throughput.md).
 *
 * Rendered verbatim by scripts/emulator-launch.mjs (harnessAccelBlock); the
 * caller passes the exit status, which nano-spawn only carries on a non-zero
 * exit (\`error.exitCode\`), so a resolved spawn means 0.
 * scripts/__tests__/emulator-launch.test.js fails if the patch and that file
 * disagree.
 */
const nitroUiAccelUnusablePhrases = [${unusable}];
const nitroUiAccelUsablePhrases = [${usable}];
export const isAccelerationUsable = (accelCheckOutput, exitCode = null) => {
    const text = String(accelCheckOutput ?? '').toLowerCase();
    if (exitCode != null)
        return Number(exitCode) === 0;
    if (nitroUiAccelUnusablePhrases.some((phrase) => text.includes(phrase)))
        return false;
    return nitroUiAccelUsablePhrases.some((phrase) => text.includes(phrase));
};`,
  ]
    .join('\n')
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : `    ${line}`))
    .join('\n');
}

/**
 * The lines the patch adds at the accel *call* site, where the exit status is
 * actually known (the parser alone cannot see it). The drift test requires each
 * one inside the patch, because a call site that stops passing the status is the
 * other way this warning comes back.
 *
 * @returns {string[]}
 */
export function harnessAccelCallerLines() {
  return [
    'let nitroUiAccelExitCode = 0;',
    "nitroUiAccelExitCode = typeof error.exitCode === 'number' ? error.exitCode : 1;",
    'isAccelerationUsable(combinedOutput, nitroUiAccelExitCode)',
  ];
}

/** The upstream call the patch must no longer contain. */
export const HARNESS_ACCEL_CALLER_BEFORE =
  'isAccelerationUsable(combinedOutput)';

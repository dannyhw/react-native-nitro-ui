/**
 * The Android emulator launch configuration shared by the lease pool, the real-input runner
 * and the patched `react-native-harness`. No `import.meta` here: jest imports this file.
 */

/** Environment variable that overrides the GPU mode for every launcher. */
export const EMULATOR_GPU_ENV = 'NITRO_UI_EMULATOR_GPU';

/** Renders on the machine's own GPU. */
export const HARNESS_GPU_MODE = 'host';

/** What `react-native-harness` ships with, and the software fallback. */
export const SOFTWARE_GPU_MODE = 'swiftshader_indirect';

export const BENCH_GPU_MODE_NOTE =
  'scripts/bench/** boots no emulator and passes no launch arguments, so a bench ' +
  'measures the device as it finds it. Pin NITRO_UI_EMULATOR_GPU in the bench ' +
  "host's own shell if a baseline needs a particular GPU mode: the committed " +
  'Android baselines were minted before this repo chose a mode, which was ' +
  "upstream's swiftshader_indirect, while a device booted here now defaults to " +
  'host.';

/** The emulator console ports `-port` accepts: even numbers in this range. */
export const EMULATOR_PORT_FLOOR = 5554;
export const EMULATOR_PORT_CEILING = 5682;

/**
 * Is this a console port the emulator can be told to take?
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

/** Environment variables that name a display server the emulator could bind to. */
export const DISPLAY_SERVER_ENV_VARS = Object.freeze([
  'DISPLAY',
  'WAYLAND_DISPLAY',
]);

/**
 * The GPU mode this machine can honour.
 *
 * `host` needs a display to bind a GL context to, and without one the emulator does not
 * fail: it never finishes booting. So Linux with no display server gets software rendering.
 * macOS always has a GPU to render on.
 *
 * @param {object} [host]
 * @param {NodeJS.ProcessEnv} [host.env] the environment to read
 * @param {string} [host.platform] `process.platform`
 * @returns {string} the mode to boot with
 */
export function emulatorGpuModeForHost({
  env = process.env,
  platform = process.platform,
} = {}) {
  const override = String(env[EMULATOR_GPU_ENV] ?? '').trim();
  if (override !== '') return override;
  if (platform === 'darwin') return HARNESS_GPU_MODE;
  const hasDisplayServer = DISPLAY_SERVER_ENV_VARS.some(
    (name) => String(env[name] ?? '').trim() !== ''
  );
  return hasDisplayServer ? HARNESS_GPU_MODE : SOFTWARE_GPU_MODE;
}

/**
 * The GPU mode for this machine, for launchers that run outside the harness.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function emulatorGpuMode(env = process.env) {
  return emulatorGpuModeForHost({ env });
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
 * `@<avd>` rather than `-avd <avd>`: the harness uses that form, and a test compares the
 * two launchers' arguments token by token.
 *
 * @param {object} options
 * @param {string} options.avd the AVD name
 * @param {number | string | null} [options.port] console port to claim
 * @param {'reuse' | 'generate' | 'cold'} [options.snapshot]
 * @param {string | null} [options.gpuMode] overrides the env/`HARNESS_GPU_MODE` choice
 * @param {{env?: NodeJS.ProcessEnv, platform?: string} | null} [options.host]
 *   the machine to ask for the mode, when `gpuMode` does not settle it
 * @returns {string[]}
 */
export function emulatorLaunchArgs({
  avd,
  port = null,
  snapshot = 'cold',
  gpuMode = null,
  host = null,
}) {
  if (typeof avd !== 'string' || avd === '') {
    throw new Error('emulatorLaunchArgs needs an avd name');
  }
  const args = [`@${avd}`];
  // An offered port that is not a console port is an error: leaving `-port` out would boot
  // the AVD on whichever serial is free, which is not the one the caller will address.
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
    gpuMode ?? emulatorGpuModeForHost(host ?? {}),
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

/**
 * The GPU rule as a JS expression, rendered into the harness patch. It must stay equivalent
 * to `emulatorGpuModeForHost`; a test runs both over the same fixtures.
 *
 * @param {string} envExpr how to reach the environment (`process.env`, or a local)
 * @param {string} platformExpr how to reach `process.platform`
 * @returns {string}
 */
function gpuModeExpression(envExpr, platformExpr) {
  const vars = DISPLAY_SERVER_ENV_VARS.map((name) => `'${name}'`).join(', ');
  return [
    `(function nitroUiGpuMode() {`,
    `    const override = (${envExpr}['${EMULATOR_GPU_ENV}'] ?? '').trim();`,
    `    if (override !== '') return override;`,
    `    if (${platformExpr} === 'darwin') return '${HARNESS_GPU_MODE}';`,
    `    const displayServer = [${vars}].some((name) => (${envExpr}[name] ?? '').trim() !== '');`,
    `    return displayServer ? '${HARNESS_GPU_MODE}' : '${SOFTWARE_GPU_MODE}';`,
    `  })()`,
  ].join('\n    ');
}

/**
 * The block the harness patch embeds to build its boot argv. After changing it, regenerate
 * the patch with `scripts/patch-harness-android.mjs`; a test fails while the two disagree.
 *
 * Dependency-free JS: it runs inside the installed `@react-native-harness/platform-android`.
 *
 * @returns {string}
 */
export function harnessLaunchBlock() {
  return `    // nitro-ui patch: boot on the console port the caller was assigned, on the
    // GPU this machine can actually honour. Several tasks share one machine,
    // each with its own AVD, its own private adb server and a device the person
    // owns that must never be used. Without \`-port\` the emulator takes the
    // lowest free console port, so a leased AVD can land on a serial another
    // task was told not to touch, and the serial the lease exported
    // (\`emulator-5574\`) is not the one that exists. When EMULATOR_PORT is set
    // the emulator either gets that port or fails to start - which is the answer
    // a lease needs; a port that cannot be a console port at all is a mistake in
    // the environment, and dropping \`-port\` there would boot the AVD on any free
    // serial, which is the very thing this patch prevents.
    //
    // The GPU mode is the other half of this block, and it is why the repo
    // patched it at all: upstream's \`swiftshader_indirect\` renders on the CPU,
    // which is most of why the Android harness cost three times iOS (X11). \`host\`
    // is the fix on a machine with a GPU and something to draw into - and the
    // failure mode when it has neither is not an error, it is an emulator that
    // never finishes booting (F8: both hosted Android runs, 900 s, cache miss and
    // cache hit). So the rule is machine-aware, and it is one rule: the text
    // below is rendered from \`scripts/emulator-launch.mjs\`, whose
    // \`emulatorGpuModeForHost\` is the Node-side form and the local that follows
    // is its twin.
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
    const nitroUiGpu = ${gpuModeExpression('process.env', 'process.platform')};
    return [\`@\${name}\`, ...nitroUiPortArgs, ...modeArgs, '-no-window', '-gpu', nitroUiGpu, '-noaudio', '-no-boot-anim', '-no-metrics'];`;
}

/**
 * Phrases in the check's output that mean "no", whatever else it printed. Rendered into the
 * harness patch.
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
 * The exit status is the answer when it is known: current emulators exit 0 and print
 * `Hypervisor.Framework ...` instead of the phrase "is installed and usable". With no
 * status, the failure phrases mean unusable and the success phrases mean usable.
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
 * The block the harness patch embeds for the acceleration decision: `accelerationUsable`
 * with the phrase lists interpolated from the constants above.
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
 * The lines the patch adds where the harness calls the check, the only place the exit
 * status is known.
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

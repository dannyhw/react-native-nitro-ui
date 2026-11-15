#!/usr/bin/env node
/**
 * Collects the emulator boot diagnostics the Android harness job uploads.
 *
 *   node scripts/ci-emulator-diagnostics.mjs [--out <dir>]   (default: harness-diag)
 *
 * Every command runs under its own deadline and an overall budget
 * (`NITRO_UI_DIAG_COMMAND_TIMEOUT_MS`, `NITRO_UI_DIAG_BUDGET_MS`), and file reads
 * come before anything that talks to the emulator. Always exits 0.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/** Per-command deadline. Every timeout below is a multiple of it. */
const COMMAND_TIMEOUT_MS = Number(
  process.env.NITRO_UI_DIAG_COMMAND_TIMEOUT_MS ?? 20_000
);
/** Overall budget: the CI step's 5 minutes minus a minute to write and exit. */
const TOTAL_BUDGET_MS = Number(process.env.NITRO_UI_DIAG_BUDGET_MS ?? 240_000);

const argv = process.argv.slice(2);
const outIndex = argv.indexOf('--out');
/** The artifact directory. `upload-artifact`'s `path` must name the same string. */
const OUT =
  outIndex >= 0 ? String(argv[outIndex + 1] ?? 'harness-diag') : 'harness-diag';

const startedAt = Date.now();
/** Commands that gave no answer. */
const incomplete = [];
const elapsed = () => Date.now() - startedAt;
const budgetLeft = () => TOTAL_BUDGET_MS - elapsed();

/**
 * Runs one command under a deadline and returns the text the log should carry
 * for it. Never throws.
 *
 * @param {string[]} command
 * @param {{timeoutMs?: number, label?: string}} [options]
 * @returns {string} the command's output, or the reason it has none
 */
function run(command, { timeoutMs = COMMAND_TIMEOUT_MS, label } = {}) {
  const name = label ?? command.join(' ');
  if (budgetLeft() <= 0) {
    incomplete.push(name);
    return `skipped, the diagnostics budget is spent: ${name}`;
  }
  const [file, ...args] = command;
  const result = spawnSync(file, args, {
    encoding: 'utf8',
    timeout: Math.min(timeoutMs, budgetLeft()),
    killSignal: 'SIGKILL',
    // No stdin: a tool that wants a password or a keypress gets EOF, not a tty.
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`.replace(
    /\s+$/u,
    ''
  );
  // Killed by the deadline: `spawnSync` reports `error` (ETIMEDOUT) on some
  // versions and only `signal` on others. Partial output is kept, because what
  // a tool printed before it hung is the evidence.
  if (result.error != null || result.signal != null) {
    incomplete.push(name);
    const reason =
      result.signal != null
        ? `timed out after ${Math.round(timeoutMs / 1000)}s and was killed`
        : `gave up (${String(result.error?.message ?? result.error)})`;
    return combined === ''
      ? `no output (${reason}): ${name}`
      : `${combined}\n<${reason}>: ${name}`;
  }
  if (result.status !== 0) {
    // A non-zero exit is an *answer* (`pgrep` returns 1 for "nothing matched"), so the
    // output that came with it is kept; only a command that printed nothing needs a note.
    return combined === ''
      ? `exit ${String(result.status)}: ${name}`
      : combined;
  }
  return combined;
}

/** The first `adb` this machine has. */
function findAdb() {
  const fromPath = (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .map((dir) => path.join(dir, 'adb'))
    .find((candidate) => fs.existsSync(candidate));
  const candidates = [
    fromPath,
    process.env.ANDROID_HOME
      ? path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb')
      : null,
    process.env.ANDROID_HOME
      ? path.join(process.env.ANDROID_HOME, 'emulator', 'adb')
      : null,
    '/opt/android-sdk/platform-tools/adb',
  ].filter((candidate) => candidate != null && fs.existsSync(candidate));
  return candidates[0] ?? null;
}

fs.mkdirSync(OUT, { recursive: true });
const adb = findAdb();
const hostLogPath = path.join(OUT, 'host.log');
/** Written incrementally, so a run that dies mid-way still leaves a readable file. */
const appendHost = (section) =>
  fs.appendFileSync(hostLogPath, `${section}\n`, 'utf8');

// ---- 1. the part that cannot block, first -------------------------------------
fs.writeFileSync(
  hostLogPath,
  [
    `== diagnostics start == ${new Date().toISOString()} ` +
      `(budget ${Math.round(TOTAL_BUDGET_MS / 1000)}s, per command ${Math.round(COMMAND_TIMEOUT_MS / 1000)}s)`,
    '== date ==',
    run(['date', '-u']),
    '== adb ==',
    adb ?? 'not found',
    '== qemu processes ==',
    run(['pgrep', '-a', 'qemu']) || 'none',
  ].join('\n') + '\n',
  'utf8'
);

// The AVD's hardware configuration, `hw.gpu.mode` included. A file read, so it
// comes before the `adb` sections and survives a wedged emulator.
const avdName = run(['node', path.join('scripts', 'ci-avd-name.mjs')], {
  timeoutMs: COMMAND_TIMEOUT_MS / 2,
}).trim();
const avdDir = path.join(
  process.env.HOME ?? '',
  '.android',
  'avd',
  `${avdName || 'unknown'}.avd`
);
const avdLogPath = path.join(OUT, 'avd.log');
fs.writeFileSync(
  avdLogPath,
  [
    '== avd name ==',
    avdName,
    '== avd dir ==',
    run(['ls', '-la', path.join(process.env.HOME ?? '', '.android', 'avd')]),
    '== config.ini (hardware lines) ==',
    run([
      'grep',
      '-E',
      'hw\\.|disk|image\\.sys',
      path.join(avdDir, 'config.ini'),
    ]),
  ].join('\n') + '\n',
  'utf8'
);
const copied = [];
if (fs.existsSync(avdDir)) {
  for (const entry of fs.readdirSync(avdDir)) {
    if (!entry.endsWith('.log') && entry !== 'emulator-launch-params.txt')
      continue;
    try {
      fs.copyFileSync(path.join(avdDir, entry), path.join(OUT, entry));
      copied.push(entry);
    } catch {
      // An AVD log held open by a qemu being torn down is normal, and is not a reason to
      // lose the files that did copy.
    }
  }
}

// ---- 2. the part that talks to the emulator, bounded -------------------------
/** `adb -e shell getprop X`, or the reason there is no value. */
const prop = (name) =>
  adb == null
    ? `${name}=<no adb>`
    : `${name}=${run([adb, '-e', 'shell', 'getprop', name])
        .replace(/\s+/gu, ' ')
        .trim()}`;

appendHost(
  [
    '== adb devices ==',
    adb == null ? '<no adb>' : run([adb, 'devices', '-l']),
  ].join('\n')
);
appendHost(
  [
    '== boot properties ==',
    ...(adb == null
      ? ['<no adb>']
      : [
          prop('sys.boot_completed'),
          prop('init.svc.zygote'),
          prop('init.svc.surfaceflinger'),
        ]),
  ].join('\n')
);
// The zone and locale the emulator booted with. They are device settings that
// nothing in this repo sets, so they are read and recorded.
appendHost(
  [
    '== device clock and locale ==',
    ...(adb == null
      ? ['<no adb>']
      : [
          prop('persist.sys.timezone'),
          prop('persist.sys.locale'),
          prop('ro.product.locale'),
          prop('ro.build.version.sdk'),
          `date=${run([adb, '-e', 'shell', 'date']).trim()}`,
        ]),
  ].join('\n')
);
/**
 * Matches the record of a command not answering. A killed command keeps what it
 * printed and appends the reason, so the reason can be anywhere in the string.
 */
const UNANSWERED =
  /(\bno output \(|<timed out after |\bgave up \(|skipped, the diagnostics budget)/u;

// The kernel ring needs CAP_SYSLOG, which the job user lacks, hence `sudo -n`.
// The `kvm|binder` filter runs here instead of in a shell pipeline, so there is
// one process to bound.
const dmesg = run(['sudo', '-n', 'dmesg'], { label: 'sudo -n dmesg' });
const unanswerable = UNANSWERED.test(dmesg);
appendHost(
  [
    '== dmesg (kvm) ==',
    unanswerable
      ? dmesg
      : dmesg
          .split('\n')
          .filter((line) => /kvm|binder/iu.test(line))
          .slice(-40)
          .join('\n') || '<nothing mentions kvm or binder>',
    '== kernel tail ==',
    unanswerable ? dmesg : dmesg.split('\n').slice(-60).join('\n'),
  ].join('\n')
);

// `-d`: dump and exit. Without it logcat is a stream that never ends.
const logcatPath = path.join(OUT, 'logcat.txt');
if (adb != null) {
  const dump = run([adb, '-e', 'logcat', '-d', '-v', 'brief'], {
    timeoutMs: COMMAND_TIMEOUT_MS * 1.5,
  });
  fs.writeFileSync(logcatPath, `${dump}\n`, 'utf8');
}

// ---- 3. the step's own stdout: evidence in the run log, not only the artifact --
const tail = (file, lines) => {
  if (!fs.existsSync(file)) return `<missing: ${path.basename(file)}>`;
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .slice(-lines)
    .join('\n');
};
const logcat = fs.existsSync(logcatPath)
  ? fs.readFileSync(logcatPath, 'utf8')
  : '';
process.stdout.write(
  [
    '--- host.log (last 40 lines) ---',
    tail(hostLogPath, 40),
    '--- avd.log ---',
    tail(avdLogPath, 60),
    '--- logcat (FATAL / boot) ---',
    logcat
      .split('\n')
      .filter((line) =>
        /FATAL|AndroidRuntime|boot_completed|bootanim|zygote/iu.test(line)
      )
      .slice(-40)
      .join('\n') || '<none>',
    ...copied.map(
      (entry) =>
        `--- ${entry} (last 80 lines) ---\n${tail(path.join(OUT, entry), 80)}`
    ),
    ...(incomplete.length > 0
      ? [
          `--- incomplete: ${String(incomplete.length)} command(s) gave no answer ---`,
          ...incomplete.map((name) => `  · ${name}`),
        ]
      : []),
    `diagnostics: ${String(
      fs.readdirSync(OUT).filter((name) => !name.startsWith('.')).length
    )} file(s) in ${OUT} (elapsed ${String(Math.round(elapsed() / 1000))}s)`,
    '\n',
  ].join('\n')
);
process.exit(0);

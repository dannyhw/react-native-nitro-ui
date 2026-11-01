#!/usr/bin/env node
/**
 * The emulator boot diagnostics the Android harness job uploads.
 *
 * Why this is a script and not the step body it replaces: run 41269235234 got what it
 * asked for and then hung. `Run Harness tests` failed at 03:46, and the next step —
 * `Collect emulator boot diagnostics`, `if: always()` — ran until the run was cancelled
 * **90 minutes later**. A diagnostics step is the one step that must never do that: it is
 * the evidence for the failure above it, and a job that produces no artifact and no log
 * tells nobody anything about a run that already cost an hour and a half.
 *
 * Two rules follow from that, and they are the whole design:
 *
 *  1. **Nothing may block indefinitely.** Every command is spawned with its own deadline
 *     and killed when it passes it. `timeout(1)` would have been the shell answer and is
 *     not one: these tests run the step for real, on macOS, where `timeout` is not
 *     installed — a guard nobody can execute is not a guard.
 *  2. **Cheap evidence goes first.** Reading `date`, the AVD's `config.ini` and qemu's own
 *     log cannot block, so they run before anything that talks to an emulator or to
 *     `sudo`. On a machine where the emulator is wedged, that ordering is the difference
 *     between an artifact with the GPU mode in it and an empty directory — which is what
 *     the GPU question this job exists to answer needs.
 *
 * What could hang, all of it now bounded, in the order it was suspected:
 *   - `adb devices` waiting on a server that is starting, and `-e shell …` waiting for a
 *     device that will never arrive — the emulator has just died under the harness;
 *   - `adb logcat` with no `-d`, which is a stream that never ends (kept `-d`, and
 *     bounded as well: a flag can be dropped by the next edit, a deadline cannot);
 *   - `sudo -n dmesg` — `-n` should refuse rather than prompt, but a `sudo` that prompts
 *     reads a tty that never answers;
 *   - anything else, because bounding one command and not the rest is how the first
 *     version of a step like this gets written.
 *
 * The step also carries `timeout-minutes: 5` (and the job a whole-job one), which is the
 * belt for a runner that stops responding to everything, including to being cancelled.
 * This script's own budget is inside that.
 *
 * Exit status is 0 whatever happened, and the last line counts the files collected: the
 * step's job is to report, and `if-no-files-found: error` on the upload is what makes an
 * empty artifact red.
 *
 * @since F8 fix round 2, after CI dispatch 41269235234.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/**
 * Per-command and overall budgets. Both overridable so a test can prove the bound in
 * seconds instead of waiting half a minute per hanging command — and, per this repo's own
 * rule about fakes that change timing, the shortened form is paired with a second case at
 * the *real* numbers (a tool that is merely slow), so a script that only honoured a small
 * deadline could not pass. Every timeout below is expressed as a multiple of
 * {@link COMMAND_TIMEOUT_MS} rather than as a fresh literal, so one knob moves them all
 * and no command can end up longer than the thing meant to bound it.
 */
const COMMAND_TIMEOUT_MS = Number(
  process.env.NITRO_UI_DIAG_COMMAND_TIMEOUT_MS ?? 20_000
);
/**
 * Overall budget: the step's 5 minutes minus a minute to write and exit. A machine where
 * every `adb` call times out spends this and stops, with what it had already collected
 * written to disk.
 */
const TOTAL_BUDGET_MS = Number(process.env.NITRO_UI_DIAG_BUDGET_MS ?? 240_000);

const argv = process.argv.slice(2);
const outIndex = argv.indexOf('--out');
/** The artifact directory. `upload-artifact`'s `path` must name the same string. */
const OUT =
  outIndex >= 0 ? String(argv[outIndex + 1] ?? 'harness-diag') : 'harness-diag';

const startedAt = Date.now();
/** Commands that gave no answer, in the shape both the log and the assertions read. */
const incomplete = [];
const elapsed = () => Date.now() - startedAt;
const budgetLeft = () => TOTAL_BUDGET_MS - elapsed();

/**
 * Run one command, bounded, and return the text the log should carry for it.
 *
 * Never throws, never blocks past its deadline, and never lets a failure end the run: the
 * caller is assembling an evidence file, and one absent tool must not cost it the other
 * seven facts.
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
    // No stdin: a tool that wants a password or a keypress gets EOF rather than an open
    // tty. `sudo -n` is supposed to refuse on its own; this is the belt.
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`.replace(
    /\s+$/u,
    ''
  );
  /**
   * Killed by our own deadline. `spawnSync` reports `error` (ETIMEDOUT) on some versions
   * and only `signal` on others, so both are handled rather than either.
   *
   * Whatever the tool managed to print is kept and labelled, because *that* is the
   * evidence a hang produces: `adb` naming the device it is waiting for, or logcat's last
   * lines before the emulator stopped writing, is the difference between "adb hung" and
   * "adb hung on `devices`, having printed nothing at all". Discarding the partial output
   * when a kill happens is the mistake that left the 90-minute run with an empty log.
   */
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

/** The first executable `adb` this machine has, found the way the shell version did. */
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

/**
 * The AVD's real hardware configuration, `hw.gpu.mode` included — the number this job's
 * GPU change is judged by, and the reason this section is above the `adb` ones: it is a
 * file read, so it is the evidence most likely to still exist on a machine whose emulator
 * is wedged. First point in the job where the file exists, too: the harness creates or
 * restores the AVD after the preflight, so asking there printed "no such file" on a cache
 * miss (41256853746).
 */
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
/**
 * The clock and locale the emulator booted with. The Android job's DatePicker DST rule
 * prints `DST PREMISE MISSING` on a zone with no transition, and the zone is a *device*
 * setting (`persist.sys.timezone`) that nothing in this repo passes — Android's
 * `appLaunchOptions` has `extras` only, no environment. Read from the device rather than
 * asserted, so the artifact is the answer.
 */
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
 * Whether the text above is a command's *answer* or the record of it not answering.
 *
 * A killed command keeps whatever it printed and appends the reason, so the reason can
 * be anywhere in the string rather than at the start — testing the prefix would let a
 * `sudo` that printed one line and then hang be filed as a healthy `dmesg`, which is the
 * mistake in the other direction: the log would then say "nothing mentions kvm" about a
 * machine that never got as far as answering.
 */
const UNANSWERED =
  /(\bno output \(|<timed out after |\bgave up \(|skipped, the diagnostics budget)/u;

/**
 * The kernel ring needs CAP_SYSLOG, which the job user does not have (41256853746's plain
 * `dmesg` printed "read kernel buffer failed: Operation not permitted" twice). The runners
 * grant the tool user passwordless sudo, and `-n` means "refuse rather than prompt" — but
 * a bounded call is the difference between that being true, and it being true on the day
 * the diagnostics matter. The `kvm|binder` filter happens here rather than in a shell
 * pipeline, so there is one process to bound rather than two, and one read of the ring
 * rather than two.
 */
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

/**
 * `-d`: dump and exit. Without it this is a stream that never ends, which is one of the
 * shapes this step hung in — and the reason it is bounded as well as flagged.
 */
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

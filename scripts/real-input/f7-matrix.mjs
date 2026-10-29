#!/usr/bin/env node
/**
 * F7 mechanism matrix: press the same control the same way, once per shape of the
 * app, and write one JSON row per cell.
 *
 * The question (`docs/tasks/F7-quick-tap.md`) is which single change moves the
 * busy Switch screen from "a 50 ms press is usually lost" to "12/12 land". That
 * is a one-variable-per-run question, and the answer has to be a table, so this
 * drives `dwell-probe.mjs` over the shapes rather than leaving a human to type
 * eleven commands and remember which variant each log was.
 *
 * Two arms:
 *
 * - `rn` — the real app, with `SWITCH_SCREEN_VARIANT` in
 *   `example/src/probeVariant.ts` flipped between shapes. That file is JS, which
 *   Metro serves, so one compiled binary serves every cell (`--skip-build`). The
 *   probe prints the variant the screen itself reports, and a cell whose variant
 *   is not the one asked for is thrown out rather than reported.
 * - `native` — a window with no React Native in the process at all
 *   (`NitroUiProbe.swift`), in three shapes. Same binary, launched differently.
 *
 * Usage (needs a leased, booted simulator and the app already built):
 *
 *   IOS_SIM_UDID=<udid> METRO_PORT=<port> \
 *     node scripts/real-input/f7-matrix.mjs [--taps 12] [--dwell 0.05] [--arm rn]
 *      [--only rn-v0-shipped,rn-v1-no-cancel] [--out docs/tasks/F7]
 *
 * One caveat the driver cannot fix for itself: every `--skip-build` cell serves JS
 * from the same Metro as everything else on this port, so the machine has to be
 * quiet enough that nothing else restarts the app mid-cell. Each row carries the
 * variant the screen itself reported and its own load1, and a cell that did not get
 * the variant it asked for is thrown out, not reported.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const VARIANT_FILE = path.join(REPO, 'example/src/probeVariant.ts');

const argv = process.argv.slice(2);
function flag(name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : fallback;
}

const TAPS = flag('--taps', '12');
const DWELL = flag('--dwell', '0.05');
const ARM = flag('--arm', 'both');
const OUT_DIR = flag('--out', 'docs/tasks/F7');
const ONLY = flag('--only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * The cells. `variant` is what `probeVariant.ts` is set to; `probeUi`/`rows`
 * belong to the no-React-Native arm. `witness` names how delivery is read, and
 * `fractions` cycles where across the control each press lands.
 */
const CELLS = [
  // --- The real app, one variable at a time, on the busy Switch screen.
  {
    name: 'rn-v0-shipped',
    arm: 'rn',
    variant: 0,
    target: 'switch-uncontrolled',
    label: 'busy screen as shipped',
  },
  {
    name: 'rn-v1-no-cancel',
    arm: 'rn',
    variant: 1,
    target: 'switch-uncontrolled',
    label: 'canCancelContentTouches=false',
  },
  {
    name: 'rn-v2-no-scroll',
    arm: 'rn',
    variant: 2,
    target: 'switch-uncontrolled',
    label: 'scrollEnabled=false (pan never arms)',
  },
  {
    name: 'rn-v3-no-list',
    arm: 'rn',
    variant: 3,
    target: 'switch-uncontrolled',
    label: '200-row list removed',
  },
  {
    name: 'rn-v4-no-scrollview',
    arm: 'rn',
    variant: 4,
    target: 'switch-uncontrolled',
    label: '200 hosted switches, no scroll view',
  },
  {
    name: 'rn-v5-rn-switches',
    arm: 'rn',
    variant: 5,
    // Same pressed control as every other RN cell: only what is *mounted* below it
    // changes, so a difference here is about the 200 rows, not about the aim.
    target: 'switch-uncontrolled',
    label: '200 RN Switches instead of hosted ones',
  },
  {
    name: 'rn-v6-plain-boxes',
    arm: 'rn',
    variant: 6,
    target: 'switch-uncontrolled',
    label: '200 plain boxes: same rows, no hosting controllers',
  },
  // --- Other hosted controls, same press, same screens.
  //
  // These read an *echo* rather than a control's own value, because a Button and a
  // SegmentedControl publish nothing of their own: an echo is the weaker witness —
  // it cannot tell a dropped touch from a lost event — so each row is read with the
  // knowledge that RN's own `Pressable` takes the same press 3/3 on the same screen,
  // which is what keeps the event path from being the explanation.
  {
    name: 'rn-button-busy',
    arm: 'rn',
    variant: 0,
    tab: 'tab-button',
    anchor: 'real-input-count',
    target: 'real-input-enabled',
    witness: 'echo:real-input-count',
    label: 'Button, 200 of them mounted',
  },
  {
    name: 'rn-segmented-busy',
    arm: 'rn',
    variant: 0,
    tab: 'tab-segmented',
    anchor: 'real-input-segmented-events',
    target: 'real-input-segmented',
    witness: 'echo:real-input-segmented-events',
    // Alternating segments: choosing the segment that is already chosen reports
    // nothing by design, so a fixed aim would read 12 real presses as 1 change.
    fractions: '0.5,0.12',
    label: 'SegmentedControl, 200 of them mounted',
  },
  {
    name: 'rn-button-host',
    arm: 'rn',
    variant: 0,
    tab: 'tab-host',
    anchor: 'host-controlled-value',
    target: 'host-button',
    witness: 'echo:host-button-presses',
    label: 'Button inside a <Host> (a dozen controls mounted)',
  },
  {
    name: 'rn-segmented-host',
    arm: 'rn',
    variant: 0,
    tab: 'tab-host',
    anchor: 'host-controlled-value',
    target: 'host-segmented',
    witness: 'echo:host-segmented-index',
    fractions: '0.5,0.9',
    label: 'SegmentedControl inside a <Host>',
  },
  {
    name: 'rn-switch-host',
    arm: 'rn',
    variant: 0,
    tab: 'tab-host',
    anchor: 'host-controlled-value',
    target: 'host-switch-0',
    label: 'Switch inside a <Host> (the calm screen, for scale)',
  },
  {
    name: 'rn-list-row-busy',
    arm: 'rn',
    variant: 0,
    target: 'switch-list-3',
    label: 'a Switch *in* the 200-row list, not above it',
  },
  // --- The same kind of control, with no React Native in the process.
  {
    name: 'native-scroll-200',
    arm: 'native',
    probeUi: 'scroll',
    rows: 200,
    target: 'probe-toggle-2',
    label: 'no RN: UIScrollView at UIKit defaults, 200 rows',
  },
  {
    name: 'native-scroll-rn-200',
    arm: 'native',
    probeUi: 'scroll-rn',
    rows: 200,
    target: 'probe-toggle-2',
    label: 'no RN: same, delaysContentTouches=false, 200 rows',
  },
  {
    name: 'native-view-200',
    arm: 'native',
    probeUi: 'view',
    rows: 200,
    target: 'probe-toggle-2',
    label: 'no RN: no scroll view, 200 rows',
  },
  {
    name: 'native-scroll-12',
    arm: 'native',
    probeUi: 'scroll',
    rows: 12,
    target: 'probe-toggle-2',
    label: 'no RN: UIScrollView, 12 rows',
  },
];

/** The one line in `probeVariant.ts` that says which shape the screen renders. */
const VARIANT_LINE =
  /export const SWITCH_SCREEN_VARIANT: SwitchScreenVariant = [0-9]+;/;
function writeVariant(value) {
  const src = fs.readFileSync(VARIANT_FILE, 'utf8');
  if (!VARIANT_LINE.test(src)) {
    throw new Error('f7-matrix: could not find the variant constant to set');
  }
  fs.writeFileSync(
    VARIANT_FILE,
    src.replace(
      VARIANT_LINE,
      `export const SWITCH_SCREEN_VARIANT: SwitchScreenVariant = ${value};`
    )
  );
}

/**
 * Which variant is currently written into the file.
 *
 * Matched on the constant's own name rather than on the first `= <digit>;` in the
 * file, which is what it used to be: the file now carries a second constant, and
 * whichever one a regex happened to reach first would depend on their order.
 */
function currentVariant() {
  const src = fs.readFileSync(VARIANT_FILE, 'utf8');
  return Number(
    /SWITCH_SCREEN_VARIANT: SwitchScreenVariant = (\d+);/.exec(src)?.[1]
  );
}

function load1() {
  const out = spawnSync('sysctl', ['-n', 'vm.loadavg'], {
    encoding: 'utf8',
  });
  return Number(out.stdout.trim().split(/\s+/)[1] ?? '0');
}

/**
 * Run one cell and pull its RESULT line out of the probe's own log.
 *
 * @returns {Promise<{label: string, delivered: number, taps: number, control: number, controlTaps: number, variant: string, load1: number, status: number}>}
 */
async function runCell(cell) {
  const probeArgs = [
    'scripts/real-input/dwell-probe.mjs',
    '--dwells',
    String(cell.dwell ?? Number(DWELL)).replace(/^$/, '0.05'),
    '--taps',
    TAPS,
    '--target',
    cell.target,
    '--witness',
    cell.witness ?? 'native',
    '--label',
    cell.name,
    '--skip-build',
    '--json',
    path.join(OUT_DIR, `probe-${cell.name}.json`),
  ];
  if (cell.fractions) probeArgs.push('--fractions', cell.fractions);
  if (cell.tab) probeArgs.push('--tab', cell.tab, '--anchor', cell.anchor);
  if (cell.probeUi)
    probeArgs.push('--probe-ui', cell.probeUi, '--rows', String(cell.rows));

  const at = load1();
  console.log(
    `\nf7-matrix: ${cell.name} — ${cell.label} (load1 ${at.toFixed(2)})`
  );
  const status = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      probeArgs.map((a) => String(a)),
      { cwd: REPO, stdio: 'inherit', env: process.env }
    );
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });

  const logFile = path.join(
    REPO,
    '.real-input/ios',
    `dwell-probe-${cell.name}-${Number(DWELL).toFixed(2)}.log`
  );
  const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
  // The RESULT line carries the counts; the header line carries the label, the
  // witness and the variant the screen itself reported. Parsing both rather than
  // widening the RESULT format keeps the line `docs/tasks/F1/dwell-probe.md` and
  // `readResult` in `dwell-probe.mjs` already describe.
  //
  // Group order here is the order the line prints them in: delivered, taps, then
  // the positive control's two. Reading them from 1, not 2, matters — the first
  // pass of this driver did and printed every busy-screen cell as "12/3".
  const result =
    /RESULT target=\S+ dwell=[\d.]+s switch=(\d+)\/(\d+) js-toggle=(\d+)\/(\d+)/.exec(
      log
    );
  const variant = /probe variant-(\d+)/.exec(log)?.[1] ?? '?';
  if (result == null) {
    console.log(`f7-matrix: ${cell.name} produced no RESULT (exit ${status})`);
    return {
      cell: cell.name,
      label: cell.label,
      delivered: null,
      taps: Number(TAPS),
      control: null,
      controlTaps: null,
      variant,
      load1: Number(at.toFixed(2)),
      status,
    };
  }
  return {
    cell: cell.name,
    label: cell.label,
    delivered: Number(result[1]),
    taps: Number(result[2]),
    control: Number(result[3]),
    controlTaps: Number(result[4]),
    variant,
    load1: Number(at.toFixed(2)),
    status,
  };
}

async function main() {
  const original = currentVariant();
  const rows = [];
  try {
    for (const cell of CELLS) {
      if (ONLY.length > 0 && !ONLY.includes(cell.name)) continue;
      if (ARM !== 'both' && cell.arm !== ARM) continue;
      if (cell.arm === 'rn') writeVariant(cell.variant);
      rows.push(await runCell(cell));
    }
  } finally {
    writeVariant(original);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `f7-matrix-${DWELL}s.json`);
  fs.writeFileSync(out, `${JSON.stringify(rows, null, 2)}\n`);
  console.log(`\nf7-matrix: wrote ${out}`);
  console.log(
    '\n| Cell | Shape | Delivered | Positive control | Variant | load1 |'
  );
  console.log('| --- | --- | --- | --- | --- | --- |');
  for (const r of rows) {
    console.log(
      `| \`${r.cell}\` | ${r.label} | ${
        r.delivered == null ? '—' : `${r.delivered}/${r.taps}`
      } | ${r.control == null ? '—' : `${r.control}/${r.controlTaps}`} | ${
        r.variant
      } | ${r.load1.toFixed(2)} |`
    );
  }
  return 0;
}

process.exitCode = await main().catch((error) => {
  console.error(`\nf7-matrix: ${String(error)}`);
  return 1;
});

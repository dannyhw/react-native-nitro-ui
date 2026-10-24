#!/usr/bin/env node
//
// The consumer smoke app's ready-line check, as a command. Both platform paths
// in `common.sh` call it, so iOS and Android cannot drift apart:
//
//   node scripts/smoke/ready-line.mjs <logfile>          # verdict on a captured log
//   node scripts/smoke/ready-line.mjs --line "<line>"    # the same, for one line
//
// Exit 0 when every control has a non-zero box, 1 otherwise (one line per
// problem), 2 on a usage or read error. The contract itself is in `lib.mjs`,
// where the jest test can reach it (same split as `scripts/bench/`).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  checkReadyLine,
  findLine,
  PENDING_PREFIX,
  READY_PREFIX,
  SMOKE_CONTROLS,
} from './lib.mjs';

function main(argv) {
  const [first, second] = argv;
  let text;
  if (first === '--line') {
    text = second ?? '';
  } else if (first != null) {
    try {
      text = readFileSync(first, 'utf8');
    } catch (error) {
      console.error(`ready-line: cannot read ${first}: ${String(error)}`);
      return 2;
    }
  } else {
    console.error(
      'ready-line: usage: ready-line.mjs <logfile> | --line "<ready line>"'
    );
    return 2;
  }

  const verdict = checkReadyLine(findLine(text, READY_PREFIX));
  const pending = findLine(text, PENDING_PREFIX);
  if (!verdict.ok) {
    for (const problem of verdict.problems) {
      console.error(`ready-line: ${problem}`);
    }
    if (pending != null) {
      console.error(`ready-line: the app reported: ${pending.trim()}`);
    }
    console.error(
      `ready-line: the ready line must carry ${SMOKE_CONTROLS.length} name=WxH boxes, each > 0x0.`
    );
    return 1;
  }
  const summary = SMOKE_CONTROLS.map((control) => {
    const size = verdict.sizes[control];
    return `${control}=${size.width}x${size.height}`;
  }).join(' ');
  console.log(
    `ready-line: all ${SMOKE_CONTROLS.length} controls laid out: ${summary}`
  );
  return 0;
}

// Only run as a command, so the module stays importable (scripts/bench/*.mjs).
if (
  process.argv[1] != null &&
  import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href
) {
  process.exit(main(process.argv.slice(2)));
}

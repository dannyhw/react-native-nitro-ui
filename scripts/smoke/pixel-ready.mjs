#!/usr/bin/env node
// Decodes a device screenshot PNG and checks the smoke-app's colour semaphore
// (see scripts/smoke/App.tsx): white = still starting, red = READY, blue =
// the app detected a failure. Needed because JS console output is stripped in
// iOS Release builds, so a log line cannot be the readiness signal there.
//
// Usage: node scripts/smoke/pixel-ready.mjs <screenshot.png>
/* eslint-disable no-bitwise -- PNG filtering is inherently bit-level */
// Prints one of: STARTING | READY | ERROR | BLANK (BLANK = no semaphore at
// all: white screen - the app started but JS never styled it) and exits 0.
import { inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

const png = readFileSync(process.argv[2]);
if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
  console.error('not a PNG');
  process.exit(2);
}

// Parse chunks.
let offset = 8;
let width = 0,
  height = 0,
  bitDepth = 0,
  colorType = 0,
  interlaced = 0;
const idat = [];
while (offset < png.length) {
  const len = png.readUInt32BE(offset);
  const type = png.toString('ascii', offset + 4, offset + 8);
  const data = png.subarray(offset + 8, offset + 8 + len);
  if (type === 'IHDR') {
    width = data.readUInt32BE(0);
    height = data.readUInt32BE(4);
    bitDepth = data[8];
    colorType = data[9];
    interlaced = data[12];
  } else if (type === 'IDAT') idat.push(data);
  else if (type === 'IEND') break;
  offset += 12 + len;
}
if (bitDepth !== 8 || interlaced !== 0 || ![0, 2, 6].includes(colorType)) {
  console.error(
    `unsupported PNG (depth=${bitDepth} type=${colorType} interlaced=${interlaced})`
  );
  process.exit(2);
}

// Unfilter scanlines.
const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
const stride = width * channels;
const raw = inflateSync(Buffer.concat(idat));
const rows = [];
let pos = 0;
let prev = Buffer.alloc(stride);
for (let y = 0; y < height; y++) {
  const filter = raw[pos++];
  const line = Buffer.from(raw.subarray(pos, pos + stride));
  pos += stride;
  for (let x = 0; x < stride; x++) {
    const a = x >= channels ? line[x - channels] : 0;
    const b = prev[x];
    const c = x >= channels ? prev[x - channels] : 0;
    let v = line[x];
    if (filter === 1) v += a;
    else if (filter === 2) v += b;
    else if (filter === 3) v += (a + b) >> 1;
    else if (filter === 4) {
      const p = a + b - c;
      const pa = Math.abs(p - a),
        pb = Math.abs(p - b),
        pc = Math.abs(p - c);
      v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    line[x] = v & 0xff;
  }
  rows.push(line);
  prev = line;
}

function pixel(x, y) {
  const row = rows[y] ?? rows[rows.length - 1];
  const i = x * channels;
  return [row[i], row[i + 1], row[i + 2]];
}

// Sample a grid over the whole screen below the status bar. Channel
// dominance, not absolute values: Android screencap can render #ff0000 as a
// dark red (~#8b0000) depending on the display colour profile.
const isRed = ([r, g, b]) => r > g + 40 && r > b + 40 && r > 60;
const isBlue = ([r, g, b]) => b > r + 40 && b > g + 40 && b > 60;
const isWhite = ([r, g, b]) => r > 200 && g > 200 && b > 200;
const close = (px, test) => test(px);
const counts = { READY: 0, ERROR: 0, white: 0, other: 0 };
for (
  let y = Math.floor(height * 0.15);
  y < height * 0.97;
  y += Math.max(1, Math.floor(height / 60))
) {
  for (
    let x = Math.floor(width * 0.1);
    x < width * 0.9;
    x += Math.max(1, Math.floor(width / 60))
  ) {
    const px = pixel(x, y);
    if (close(px, isRed)) counts.READY++;
    else if (close(px, isBlue)) counts.ERROR++;
    else if (close(px, isWhite)) counts.white++;
    else counts.other++;
  }
}
const total = counts.READY + counts.ERROR + counts.white + counts.other;
if (counts.READY > total * 0.5) console.log('READY');
else if (counts.ERROR > total * 0.5) console.log('ERROR');
else if (counts.white + counts.READY + counts.ERROR > total * 0.97)
  console.log('STARTING');
else console.log('BLANK');

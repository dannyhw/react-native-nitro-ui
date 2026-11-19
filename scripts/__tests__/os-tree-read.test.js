import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { tree } from '../../example/e2e/real-input/os-tree';

vi.mock('e2e', () => ({ expect: {} }));

// The real driver gives stdout at most 2 s to drain before `process.exit`; a stand-in
// that exits the moment it has written is that cut-off at its harshest.
const NODE_COUNT = 30_000;

function snapshotDriver() {
  return `
const nodes = [{ index: 0, type: 'android.widget.FrameLayout', label: JSON.stringify(process.argv.slice(2)) }];
for (let index = 1; index < ${NODE_COUNT}; index += 1) {
  nodes.push({
    index,
    type: 'android.widget.TextView',
    value: 'row ' + index + ' '.padEnd(120, 'x'),
    enabled: true,
    rect: { x: 0, y: index * 10, width: 1080, height: 10 },
    parentIndex: 0,
    depth: 1,
  });
}
process.stdout.write(JSON.stringify({ success: true, data: { nodes } }));
process.exit(0);
`;
}

let scratch;
let temp;
let savedTmp;
let savedSerial;

function driver(source) {
  const file = join(scratch, `driver-${String(Math.random()).slice(2)}.mjs`);
  writeFileSync(file, source);
  return file;
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'os-tree-test-'));
  temp = mkdtempSync(join(tmpdir(), 'os-tree-tmp-'));
  savedTmp = process.env.TMPDIR;
  savedSerial = process.env.ANDROID_SERIAL;
  // Every temporary file the read makes lands here, where the test can see it go.
  process.env.TMPDIR = temp;
  process.env.ANDROID_SERIAL = 'emulator-5590';
});

afterEach(() => {
  if (savedTmp === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = savedTmp;
  if (savedSerial === undefined) delete process.env.ANDROID_SERIAL;
  else process.env.ANDROID_SERIAL = savedSerial;
  rmSync(scratch, { recursive: true, force: true });
  rmSync(temp, { recursive: true, force: true });
});

describe('tree', () => {
  it('reads a multi-MB snapshot whole when the driver exits as soon as it has written', () => {
    const nodes = tree({ unmerged: true }, driver(snapshotDriver()));

    expect(nodes).toHaveLength(NODE_COUNT);
    expect(
      nodes[NODE_COUNT - 1].text.startsWith(`row ${NODE_COUNT - 1} `)
    ).toBe(true);
    expect(readdirSync(temp)).toEqual([]);
  });

  it('asks the driver for the same snapshot it always has', () => {
    const [merged] = tree({}, driver(snapshotDriver()));
    const [unmerged] = tree({ unmerged: true }, driver(snapshotDriver()));

    const base = [
      'snapshot',
      '--json',
      '--force-full',
      '--serial',
      'emulator-5590',
      '--session',
      'e2e-android-0',
    ];
    expect(JSON.parse(merged.contentDesc)).toEqual(base);
    expect(JSON.parse(unmerged.contentDesc)).toEqual([...base, '--raw']);
  });

  it('names the byte count of an answer that is not a snapshot, and leaves no file', () => {
    const cut = driver(
      `process.stdout.write('{"data":{"nodes":[{"index":0'); process.exit(0);`
    );

    expect(() => tree({}, cut)).toThrow(
      /the driver answered with 28 bytes that are not a snapshot/
    );
    expect(readdirSync(temp)).toEqual([]);
  });

  it('says the driver failed when it exits non-zero, and leaves no file', () => {
    const failing = driver(
      `process.stderr.write('DEVICE_IN_USE'); process.exit(3);`
    );

    expect(() => tree({}, failing)).toThrow(
      /reading the accessibility tree from the driver failed: [\s\S]*DEVICE_IN_USE/
    );
    expect(readdirSync(temp)).toEqual([]);
  });
});

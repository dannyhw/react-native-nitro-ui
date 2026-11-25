import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';

import { pixelAt } from '../real-input/png-pixel.mjs';
import {
  frameGeometry,
  frameRows,
  heldDrop,
  lastTouchUpSeconds,
} from '../real-input/held-frames.mjs';

/**
 * The input dispatcher's recent events after a held swipe on the API 35 emulator,
 * cut to the last move, the lift and the queues after them. A key's release, with its
 * own `action=UP`, is added above to show that only the touchscreen's lift counts.
 */
const DUMP = `  KeyEvent(deviceId=1, eventTime=115099000000000, source=KEYBOARD, displayId=0, action=UP, flags=0x00000008)
  RecentQueue: length=10
    MotionEvent(deviceId=-1, eventTime=115013349000000, source=TOUCHSCREEN, displayId=0, action=MOVE, actionButton=0x00000000, flags=0x00000000, metaState=0x00000000, buttonState=0x00000000, classific
    MotionEvent(deviceId=-1, eventTime=115013366000000, source=TOUCHSCREEN, displayId=0, action=UP, actionButton=0x00000000, flags=0x00000000, metaState=0x00000000, buttonState=0x00000000, classificat
  PendingEvent: <none>
  InboundQueue: <empty>`;

describe('lastTouchUpSeconds', () => {
  it('reads the touchscreen lift, in seconds of uptime, and not a key release', () => {
    expect(lastTouchUpSeconds(DUMP)).toBeCloseTo(115013.366, 6);
  });

  it('takes the newest lift when the queue holds two', () => {
    const two = DUMP.replace('action=MOVE', 'action=UP');
    expect(lastTouchUpSeconds(two)).toBeCloseTo(115013.366, 6);
  });

  it('answers null when no lift is in the queue', () => {
    expect(
      lastTouchUpSeconds(DUMP.replaceAll('action=UP', 'action=MOVE'))
    ).toBe(null);
  });
});

const LIFT = 115013.366;
const REST = 0.97;
/** A Material state layer over a light row: a few percent darker. */
const INKED = 0.94;

describe('heldDrop', () => {
  it('reads ink however slowly the frame then crossed adb', () => {
    // A hosted runner took about 1.5 s to hand a frame over; the device had taken
    // it well before the lift.
    const frames = [
      { askedAt: 458, takenBy: LIFT - 1.2, mean: REST },
      { askedAt: 1_917, takenBy: LIFT - 0.4, mean: INKED },
    ];
    expect(heldDrop(REST, frames, LIFT)).toBeCloseTo(REST - INKED, 6);
  });

  it('does not count a frame the device took after the lift', () => {
    // Ink still fading after the lift is not ink drawn while held.
    const frames = [
      { askedAt: 450, takenBy: LIFT - 1.2, mean: REST },
      { askedAt: 1_700, takenBy: LIFT + 0.05, mean: INKED },
    ];
    expect(heldDrop(REST, frames, LIFT)).toBe(0);
  });

  it('does not count a frame within a clock step of the lift', () => {
    // `/proc/uptime` rounds down to 10 ms, so a frame read as 5 ms before the lift
    // may have been taken after it.
    const frames = [{ askedAt: 1_700, takenBy: LIFT - 0.005, mean: INKED }];
    expect(heldDrop(REST, frames, LIFT)).toBe(-Infinity);
  });

  it('reports a row that never darkens as no drop', () => {
    const frames = [
      { askedAt: 450, takenBy: LIFT - 1.2, mean: REST },
      { askedAt: 900, takenBy: LIFT - 0.7, mean: REST },
    ];
    expect(heldDrop(REST, frames, LIFT)).toBe(0);
  });
});

/** A 3x2 RGBA frame whose every pixel is distinct, behind a header of `words` words. */
function rawFrame(words = 4) {
  const header = Buffer.alloc(words * 4);
  header.writeUInt32LE(3, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(1, 8);
  const pixels = Buffer.alloc(3 * 2 * 4);
  for (let index = 0; index < 6; index += 1) {
    pixels.writeUInt8(10 + index, index * 4);
    pixels.writeUInt8(100 + index, index * 4 + 1);
    pixels.writeUInt8(200 + index, index * 4 + 2);
    pixels.writeUInt8(255, index * 4 + 3);
  }
  return Buffer.concat([header, pixels]);
}

describe('frameGeometry and frameRows', () => {
  it('finds the header length Android 10 and later write, and the older one', () => {
    for (const words of [4, 3]) {
      const raw = rawFrame(words);
      expect(frameGeometry(raw.subarray(0, 16), raw.length)).toEqual({
        width: 3,
        height: 2,
        headerBytes: words * 4,
      });
    }
  });

  it('reads the rows it was sent as an image of their own', () => {
    const raw = rawFrame();
    const geometry = frameGeometry(raw.subarray(0, 16), raw.length);
    const second = raw.subarray(16 + 3 * 4, 16 + 6 * 4);
    const rows = frameRows(geometry, 1, 1, new Uint8Array(second));
    expect(rows.height).toBe(1);
    expect(pixelAt(rows, 0, 0)).toEqual([13, 103, 203, 255]);
  });

  it('refuses a pixel format it would misread', () => {
    const raw = rawFrame();
    raw.writeUInt32LE(5, 8);
    expect(() => frameGeometry(raw.subarray(0, 16), raw.length)).toThrow(
      /not RGBA_8888/
    );
  });

  it('refuses a frame or a row span whose length does not match', () => {
    const raw = rawFrame();
    expect(() => frameGeometry(raw.subarray(0, 16), raw.length + 4)).toThrow(
      /12 or 16 byte header/
    );
    const geometry = frameGeometry(raw.subarray(0, 16), raw.length);
    expect(() => frameRows(geometry, 0, 1, new Uint8Array(8))).toThrow(
      /12 bytes, and 8 arrived/
    );
  });
});

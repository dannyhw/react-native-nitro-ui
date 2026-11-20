import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SweepDevice } from '../real-input/a11y-sweep-device.mjs';

const WIDTH = 1080;
const HEIGHT = 2424;
const ROW_PITCH = 250;

/**
 * A device showing a page `depth` px deep, scrolled to `offset`. An upward swipe moves the
 * page `step` px towards its top, less than the finger travels, as on a loaded runner. The
 * swipes numbered in `dropped` (from 1) move nothing, as a dropped input does.
 */
function pageDevice({ depth, offset, step, dropped = [] }) {
  const page = { offset, swipes: 0 };
  const rows = Math.ceil((depth + HEIGHT) / ROW_PITCH);
  const xml = () => {
    const nodes = [];
    for (let i = 0; i < rows; i += 1) {
      const y1 = i * ROW_PITCH - page.offset;
      if (y1 + 40 <= 0 || y1 >= HEIGHT) continue;
      nodes.push(
        `<node text="Row ${String(i)}" bounds="[0,${String(y1)}][${String(WIDTH)},${String(y1 + 40)}]" />`
      );
    }
    return `<hierarchy>${nodes.join('')}</hierarchy>`;
  };
  const adbShell = (command) => {
    if (command === 'wm size') {
      return `Physical size: ${String(WIDTH)}x${String(HEIGHT)}\n`;
    }
    if (command.startsWith('uiautomator dump')) {
      return 'UI hierchary dumped to: /sdcard/x.xml\n';
    }
    if (command.startsWith('cat ')) return xml();
    const swipe = command.match(/^input swipe \d+ (\d+) \d+ (\d+) \d+$/);
    if (swipe != null) {
      page.swipes += 1;
      const towardsTop = Number(swipe[2]) > Number(swipe[1]);
      if (towardsTop && !dropped.includes(page.swipes)) {
        page.offset = Math.max(0, page.offset - step);
      }
    }
    return '';
  };
  return { page, device: new SweepDevice({ adbShell, tabs: [], appId: 'x' }) };
}

describe('scrollToTop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function settle(promise) {
    const done = promise.then(
      () => null,
      (error) => error
    );
    await vi.runAllTimersAsync();
    return done;
  }

  it('returns to the top of a page deeper than eight swipes', async () => {
    // 11,700 px at 600 px a swipe: twenty swipes up before the page stops.
    const { page, device } = pageDevice({
      depth: 11_700,
      offset: 11_700,
      step: 600,
    });
    expect(await settle(device.scrollToTop())).toBeNull();
    expect(page.offset).toBe(0);
  });

  it('keeps going past one dropped swipe mid-page', async () => {
    const { page, device } = pageDevice({
      depth: 4000,
      offset: 4000,
      step: 600,
      dropped: [3],
    });
    expect(await settle(device.scrollToTop())).toBeNull();
    expect(page.offset).toBe(0);
  });
});

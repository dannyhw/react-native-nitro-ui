import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  resetScrollCount,
  resetTapBand,
  reveal,
} from '../../example/e2e/real-input/support';

jest.mock('e2e', () => ({ expect: {} }));

// A page in device pixels, laid out like the example app on a Pixel profile: the tab
// strip ends at 260, the content view at 2400, and the screen's ScrollView shows page
// rows from 410 down. A row off that viewport is out of the tree, as on a device,
// unless it is hosted: a hosted node keeps answering with its box.
const STRIP = { x: 0, y: 150, width: 1080, height: 110 };
const CONTENT = { x: 0, y: 0, width: 1080, height: 2400 };
const VIEW_TOP = 410;
const VIEW_BOTTOM = 2400;
const PAGE_HEIGHT = 8000;
const ROW_HEIGHT = 120;

function fakePage() {
  const page = { scroll: 0, drags: [], travels: [], waits: 0 };

  const fixed = (box) => ({
    count: async () => 1,
    boundingBox: async () => box,
    isVisible: async () => true,
  });

  page.row = (pageY, { hosted = false } = {}) => {
    const box = () => ({
      x: 40,
      y: VIEW_TOP + pageY - page.scroll,
      width: 1000,
      height: ROW_HEIGHT,
    });
    const onScreen = () => {
      const { y } = box();
      return y + ROW_HEIGHT > VIEW_TOP && y < VIEW_BOTTOM;
    };
    const inTree = () => hosted || onScreen();
    return {
      count: async () => (inTree() ? 1 : 0),
      boundingBox: async () => {
        if (!inTree()) {
          // The engine waits the whole action timeout for the node before refusing.
          page.waits += 1;
          throw new Error('locator matched no nodes');
        }
        return box();
      },
      isVisible: async () => {
        if (!inTree()) throw new Error('locator matched no nodes');
        return onScreen();
      },
    };
  };

  page.screen = {
    getByTestId: (id) => {
      if (id === 'example-tabs') return fixed(STRIP);
      if (id === 'android:id/content') return fixed(CONTENT);
      throw new Error(`no fake node for ${id}`);
    },
    swipe: async ({ from, to }) => {
      const travel = from.y - to.y;
      page.drags.push(travel > 0 ? 'towards-bottom' : 'towards-top');
      page.travels.push(travel);
      page.scroll = Math.min(
        PAGE_HEIGHT - (VIEW_BOTTOM - VIEW_TOP),
        Math.max(0, page.scroll + travel)
      );
    },
  };

  page.dragsSince = (mark) => page.drags.slice(mark);
  return page;
}

describe('reveal', () => {
  let page;

  beforeEach(() => {
    resetTapBand();
    resetScrollCount();
    page = fakePage();
  });

  it('drags from the top down to a control below the window', async () => {
    await reveal(page.screen, page.row(3000));
    expect(page.drags).toEqual(['towards-bottom', 'towards-bottom']);
  });

  it('travels up to a control above the band without going down first', async () => {
    await reveal(page.screen, page.row(3000));
    const mark = page.drags.length;

    await reveal(page.screen, page.row(300, { hosted: true }));

    const drags = page.dragsSince(mark);
    expect(drags.length).toBeGreaterThan(0);
    expect(drags.every((drag) => drag === 'towards-top')).toBe(true);
  });

  it('brings a control just above the band back by its distance, not a full stride', async () => {
    await reveal(page.screen, page.row(3000));
    const mark = page.travels.length;

    await reveal(page.screen, page.row(2550));

    const travels = page.travels.slice(mark);
    expect(travels).toHaveLength(1);
    // The row sat 900 px above the band's middle; a full stride is 1296 px.
    expect(Math.abs(travels[0])).toBeLessThan(1000);
  });

  it('costs no drag for a control already in the band', async () => {
    await reveal(page.screen, page.row(3000));
    const mark = page.drags.length;

    await reveal(page.screen, page.row(3000));

    expect(page.dragsSince(mark)).toEqual([]);
  });

  it('rewinds to the top for a control out of the tree on a scrolled page', async () => {
    await reveal(page.screen, page.row(3000));
    const row = page.row(200);

    await reveal(page.screen, row);

    expect(page.scroll).toBe(0);
  });

  it('never waits on a read of a control that is off screen', async () => {
    await reveal(page.screen, page.row(3000));
    await reveal(page.screen, page.row(200));
    expect(page.waits).toBe(0);
  });
});

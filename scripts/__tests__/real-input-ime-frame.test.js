/**
 * The keyboard's top edge, read out of the insets the window manager publishes.
 *
 * `imeTopPx` is the only number the popover's Android keyboard claim ("the content stays
 * above the keyboard") can be checked against, and it is a scrape of `dumpsys` - the kind of
 * reader that fails by returning nothing, or worse something plausible, when a release
 * changes the wording. Both have happened: the first version knew only `mFrame=Rect(…)`,
 * which the API 35 image no longer prints, and the second read the IME's own window frame,
 * which on that image is the whole content area - so a field that had moved clear of the
 * keyboard was reported as sitting 1,400 px under it.
 *
 * So the fixtures are lines measured on that API 35 image, with the two shapes that used to
 * be read left in as decoys: neither may answer, and the top of each is a number the parser
 * would have to invent rather than one it can fall back to.
 */

import { describe, expect, it } from '@jest/globals';

import { imeInsetSample, imeInsetTop } from '../real-input/ime-frame.mjs';

/** The keyboard on screen, as `dumpsys activity top` printed it on the API 35 image. */
const SHOWN =
  '            InsetsSource id=3 type=ime frame=[0,1541][1080,2424] ' +
  'visibleFrame=[0,1541][1080,2424] visible=true flags= sideHint=BOTTOM ' +
  'boundingRects=null\n';

/** The same source with no keyboard in it: a real line, and no answer to the question. */
const HIDDEN =
  '            InsetsSource id=e992000a type=ime frame=[0,0][0,0] visible=false ' +
  'flags= sideHint=NONE boundingRects=null\n';

describe('imeInsetTop', () => {
  it('reads the visible ime inset', () => {
    expect(imeInsetTop(SHOWN)).toBe(1541);
  });

  it('says nothing about a keyboard that is not up', () => {
    expect(imeInsetTop(HIDDEN)).toBeNull();
    expect(imeInsetTop('')).toBeNull();
    expect(
      imeInsetTop(
        'InsetsSource id=3 type=ime frame=[0,900][1080,900] visible=true'
      )
    ).toBeNull();
    // The shape the previous version read: the IME's inset still laid out over the app, with
    // the keyboard not in it. It has a real height, so only the visibility can tell it apart
    // from a keyboard - and reading it answers 142, the status bar.
    expect(
      imeInsetTop(
        'InsetsSource id=3 type=ime frame=[0,142][1080,2424] visible=false'
      )
    ).toBeNull();
  });

  it('will not take another inset type for the keyboard', () => {
    // The lines beside the IME's, from the same block. Both are visible, both are at the
    // bottom of the screen, and neither is the keyboard: a parser that matched on the frame
    // instead of the type would read one and turn the rule into a pass.
    expect(
      imeInsetTop(
        '            InsetsSource id=e9920001 type=navigationBars frame=[0,2361][1080,2424] ' +
          'visible=true flags=SUPPRESS_SCRIM|ANIMATE_RESIZING sideHint=BOTTOM\n' +
          '            InsetsSource id=e9920005 type=mandatorySystemGestures ' +
          'frame=[0,2340][1080,2424] visible=true flags= sideHint=BOTTOM\n'
      )
    ).toBeNull();
  });

  it('will not take the IME window frame for the keyboard', () => {
    // The two shapes earlier versions read, printed while a keyboard was on screen. The
    // window's own frame is the content area minus the status bar, so both would answer 142
    // - the status bar - and every "above the keyboard" claim would fail from behind it.
    expect(
      imeInsetTop(
        '    Frames: parent=[0,142][1080,2424] display=[0,142][1080,2424] ' +
          'frame=[0,142][1080,2424] last=[0,142][1080,2424] insetsChanged=false\n' +
          '      mFrame=Rect(0, 142 - 1080, 2424)\n'
      )
    ).toBeNull();
  });

  it('takes the strictest answer when a dump carries more than one window', () => {
    // One block per activity: whichever the parser reads, "above the keyboard" has to mean
    // above the tallest keyboard in the dump.
    expect(
      imeInsetTop(
        '            InsetsSource id=3 type=ime frame=[0,1600][1080,2424] visible=true\n' +
          SHOWN
      )
    ).toBe(1541);
  });

  it('reads one keyboard without swallowing the block that follows it', () => {
    // A visible keyboard, then a hidden one for another window: the second says nothing and
    // must not erase the first.
    expect(imeInsetTop(`${SHOWN}${HIDDEN}`)).toBe(1541);
    expect(imeInsetTop(`${HIDDEN}${SHOWN}`)).toBe(1541);
  });
});

describe('imeInsetSample', () => {
  it('names the lines a failed read had to work from', () => {
    const sample = imeInsetSample(`${HIDDEN}${SHOWN}`);
    expect(sample).toContain('visible=false');
    expect(sample).toContain('1541');
  });

  it('says so when the dump never mentions the keyboard', () => {
    expect(
      imeInsetSample('InsetsSource id=1 type=statusBars frame=[0,0][1080,142]')
    ).toBe('no type=ime line at all');
  });
});

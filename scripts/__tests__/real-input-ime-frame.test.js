/**
 * The keyboard's top edge, read out of the dumps that report it.
 *
 * `imeTopPx` is the only number the popover's Android keyboard claim ("the content stays
 * above the keyboard") can be checked against, and it is a scrape of `dumpsys` - the kind
 * of reader that fails by returning nothing when a release changes the wording. That is
 * not a hypothetical: the first version knew only `mFrame=Rect(l, t - r, b)`, which the API
 * 35 image no longer prints, and the check reported "nothing reported the keyboard frame"
 * with the keyboard plainly on screen. The fixtures below are the two shapes measured on
 * devices - the hidden IME window's own `Frames:` line, and the service's `Rect` form -
 * with the top of each chosen so no fallback can guess it.
 */

import { describe, expect, it } from '@jest/globals';

import { imeFrameTop, imeWindowTop } from '../real-input/ime-frame.mjs';

describe('imeFrameTop', () => {
  it('reads the API 34+ window dump, which has no mFrame= anywhere', () => {
    // One `Window #` block for the IME, as `dumpsys window windows` prints it on the
    // API 35 image: the frames are one line, and the window's own is `frame=`.
    expect(
      imeFrameTop(
        '    mHasSurface=true isReadyForDisplay()=true mWindowRemovalAllowed=false\n' +
          '    Frames: parent=[0,142][1080,2424] display=[0,142][1080,2424] ' +
          'frame=[0,1480][1080,2424] last=[0,142][1080,2424] insetsChanged=true\n'
      )
    ).toBe(1480);
  });

  it('reads the service and the older window dumps', () => {
    expect(
      imeFrameTop(
        '    mInputShown=true\n  mInputBoundsOnScreen=Rect(0, 1512 - 1080, 2424)\n'
      )
    ).toBe(1512);
    expect(
      imeFrameTop('  Window state:\n      mFrame=Rect(0, 1512 - 1080, 2424)\n')
    ).toBe(1512);
  });

  it('prefers the named frame over the bare one when a dump carries both', () => {
    expect(
      imeFrameTop(
        '  mFrame=Rect(0, 1512 - 1080, 2424)\n' +
          '    Frames: parent=[0,142][1080,2424] frame=[0,990][1080,2424]\n'
      )
    ).toBe(1512);
  });

  it('will not take a parent frame for the window’s own', () => {
    // The decoy has to be unmatchable rather than merely first: a pattern that allowed a
    // word character before `frame=` would read the parent's top as the keyboard's.
    expect(
      imeFrameTop(
        '    WindowFrames{parentFrame=[0,142][1080,2424] frame=[0,1480][1080,2424]}'
      )
    ).toBe(1480);
  });

  it('says nothing about a keyboard that is not on screen', () => {
    // Zero height is the hidden IME's own frame shape on some releases; "the keyboard
    // starts at y" has no answer there, and inventing one would move a check's numbers.
    expect(
      imeFrameTop(
        '    Frames: parent=[0,142][1080,2424] frame=[0,1480][1080,1480]'
      )
    ).toBeNull();
    expect(
      imeFrameTop('  mInputShown=false\n  mCurId=android/.LatinIME\n')
    ).toBeNull();
    expect(imeFrameTop('')).toBeNull();
  });
  // `imeWindowTop` is the half a single read gets wrong. Both blocks below are the shapes
  // `dumpsys window windows` prints on the API 35 image: the first is the IME window with no
  // keyboard on screen, and its frame is a *real* frame - laid out over the app, top at the
  // status bar - which `imeFrameTop` happily returns as 142.
  const HIDDEN_BLOCK =
    '    mViewVisibility=0x8 mHaveFrame=true mObscured=false\n' +
    '    mHasSurface=false isReadyForDisplay()=false mWindowRemovalAllowed=false\n' +
    '    Frames: parent=[0,142][1080,2424] display=[0,142][1080,2424] ' +
    'frame=[0,142][1080,2424] last=[0,142][1080,2424] insetsChanged=false\n';

  const SHOWN_BLOCK =
    '    mViewVisibility=0x0 mHaveFrame=true mObscured=false\n' +
    '    mHasSurface=true isReadyForDisplay()=true mWindowRemovalAllowed=false\n' +
    '    Frames: parent=[0,142][1080,2424] display=[0,142][1080,2424] ' +
    'frame=[0,1584][1080,2424] last=[0,142][1080,2424] insetsChanged=true\n';

  it('refuses a frame from an IME window that is not being displayed', () => {
    expect(imeFrameTop(HIDDEN_BLOCK)).toBe(142);
    expect(imeWindowTop(HIDDEN_BLOCK)).toBeNull();
  });

  it('reads the keyboard out of a window that is', () => {
    expect(imeWindowTop(SHOWN_BLOCK)).toBe(1584);
  });

  it('still parses a block that prints neither display marker', () => {
    // The two markers are what this release happens to print, not a promise: a dump that
    // stops printing them should fall through to the frame rather than fail the rule.
    expect(
      imeWindowTop(
        '    mIsImWindow=true mIsWallpaper=false\n' +
          '    Frames: parent=[0,142][1080,2424] frame=[0,1584][1080,2424]\n'
      )
    ).toBe(1584);
  });
});

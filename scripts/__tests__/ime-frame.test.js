/**
 * The two keyboard-edge readers, off a device.
 *
 * Both are `dumpsys` scrapes, and every `dumpsys` scrape ends the same way: the format
 * drifts, the pattern stops matching, and a `null` turns the check it feeds into a no-op
 * that reports a green. S6b round 2 is the cautionary tale this file exists to prevent a
 * repeat of: it asserted `a full keyboard … occupies 2282 px of a 2424 px window` on a
 * device where the real band was 1025 px, from a window record belonging to a *hidden*
 * keyboard, and then failed a field for sitting "below" a keyboard whose top it had placed
 * at 142 px. Nothing between the scrape and that sentence was testable.
 *
 * So both parsers are pure (text in, edge or `null` out), and both answers — up and down —
 * come from dumps shaped like the ones the lease's API 35 AVD prints, with GBoard's real
 * numbers in them (1399 up, 2156 stale-down, 1080x2424 display). `imeServiceTopPx` reading
 * the stale block is the single most important line here: it is the exact bug, and a parser
 * that only ever sees a keyboard-up dump cannot prove it refuses a keyboard-down one.
 */

import { describe, expect, it } from '@jest/globals';

import {
  imeInsetSample,
  imeInsetTop,
  imeServiceSample,
  imeServiceShown,
  imeServiceTopPx,
} from '../real-input/ime-frame.mjs';

/** The `InsetsState` of the app's window with GBoard up (API 35, 1080x2424). */
const ACTIVITY_TOP_UP = [
  '  Local InsetsState:',
  '    InsetsSource id=1 type=statusBars frame=[0,0][1080,142] visibleFrame=[0,0][1080,142] visible=true type=ITYPE_STATUS_BAR',
  '    InsetsSource id=2 type=navigationBars frame=[0,2274][1080,2424] visibleFrame=[0,2274][1080,2424] visible=true type=ITYPE_NAVIGATION_BAR',
  '    InsetsSource id=3 type=ime frame=[0,1399][1080,2424] visibleFrame=[0,1399][1080,2424] visible=true type=ITYPE_IME',
  '    InsetsSource id=4 type=mandatorySystemGestures frame=[0,2274][1080,2424] visibleFrame=[0,2274][1080,2424] visible=true type=ITYPE_MANDATORY_SYSTEM_GESTURES',
].join('\n');

/**
 * The same block with the keyboard dismissed: the source stays, `visible=false`, and its
 * `frame` still carries the rectangle it had a moment ago. That lag is the point — a reader
 * that only asked "does this source have a height" gets 1399 out of a dump whose keyboard is
 * gone, which is the same failure as reading the IME service's stale insets.
 */
const ACTIVITY_TOP_DOWN = ACTIVITY_TOP_UP.replace(
  /\btype=ime\b(.*)\bvisible=true/,
  'type=ime$1visible=false'
);

/** `dumpsys input_method` with GBoard up. */
const INPUT_METHOD_UP = [
  'SERVICE test.ime.ImsService id=29 pid=1234 uid=10182',
  '  mCurMethodId=com.google.android.inputmethod.latin/.LatinIME',
  '  mInputShown=true mIsInputViewShown=true mStatusTipMessage=null',
  '  Last computed insets:',
  '    contentTopInsets=2424 visibleTopInsets=1399 touchableRegion=SkRegion((0,1399,1080,2156))',
  '  mShowRequested=true mShowExplicitlyRequested=true',
].join('\n');

/**
 * The same service after the keyboard went away: `mInputShown=false`, and the insets block
 * *still printed* — the stale edge (the bottom of the keyboard's own rectangle) that a
 * reader must not build a band from.
 */
const INPUT_METHOD_DOWN = [
  'SERVICE test.ime.ImsService id=29 pid=1234 uid=10182',
  '  mCurMethodId=com.google.android.inputmethod.latin/.LatinIME',
  '  mInputShown=false mIsInputViewShown=false mStatusTipMessage=null',
  '  Last computed insets:',
  '    contentTopInsets=2424 visibleTopInsets=2156 touchableRegion=SkRegion()',
  '  mShowRequested=false mShowExplicitlyRequested=false',
].join('\n');

/** An IME in fullscreen extract mode: a legal top of 0. */
const INPUT_METHOD_EXTRACT = INPUT_METHOD_UP.replace(
  'visibleTopInsets=1399',
  'visibleTopInsets=0'
);

describe('imeInsetTop (the app window’s own ime InsetsSource)', () => {
  it('reads the visible ime source and none of its neighbours', () => {
    expect(imeInsetTop(ACTIVITY_TOP_UP)).toBe(1399);
  });

  it('says nothing when the source is there but not visible', () => {
    // Not even when its frame is a full-height keyboard rectangle: `visible` is the flag
    // that says whether that rectangle is on the screen.
    expect(imeInsetTop(ACTIVITY_TOP_DOWN)).toBe(null);
  });

  it('says nothing for a source with no height (the IME window, ready and empty)', () => {
    expect(
      imeInsetTop(
        '    InsetsSource id=3 type=ime frame=[0,2424][1080,2424] visibleFrame=[0,2424][1080,2424] visible=true'
      )
    ).toBe(null);
  });

  it('takes the strictest edge across the blocks of a multi-activity dump', () => {
    expect(
      imeInsetTop(`${ACTIVITY_TOP_UP}\n${ACTIVITY_TOP_UP.replace('1399', 900)}`)
    ).toBe(900);
  });

  it('is not fooled by the navigation-bar and gesture lines beside it', () => {
    // Neither of those is `type=ime`, and both carry a bottom frame that would make a
    // wrong answer look plausible (2274 of a 2424 px window is a real band).
    expect(
      imeInsetTop(ACTIVITY_TOP_DOWN.replace(/\bvisible=false\b/, ''))
    ).toBe(null);
  });

  it('says nothing, rather than 0, for a dump that never mentioned an IME', () => {
    expect(imeInsetTop('InsetsState: (none)')).toBe(null);
    expect(imeInsetSample('InsetsState: (none)')).toBe(
      'no type=ime line at all'
    );
  });

  it('quotes the line it read when it has to say it read nothing', () => {
    expect(imeInsetSample(ACTIVITY_TOP_UP)).toContain('type=ime');
  });
});

describe('imeServiceTopPx (the IME service’s last computed insets)', () => {
  it('reads visibleTopInsets while the input view is up', () => {
    expect(imeServiceShown(INPUT_METHOD_UP)).toBe(true);
    expect(imeServiceTopPx(INPUT_METHOD_UP)).toBe(1399);
  });

  it('refuses the same number once the input view is down', () => {
    // The exact S6b defect: the block survives the hide, and its value is the *bottom* of
    // the keyboard's rectangle. A parser without the `mInputShown` gate returns 2156 here,
    // which a check reads as "a keyboard occupying 268 px" — or, at 142, a full one.
    expect(imeServiceShown(INPUT_METHOD_DOWN)).toBe(false);
    expect(imeServiceTopPx(INPUT_METHOD_DOWN)).toBe(null);
  });

  it('keeps a legal edge of 0 (a fullscreen extract-mode IME)', () => {
    expect(imeServiceTopPx(INPUT_METHOD_EXTRACT)).toBe(0);
  });

  it('says nothing when the insets block is not there', () => {
    expect(imeServiceTopPx('  mInputShown=true mIsInputViewShown=true')).toBe(
      null
    );
    expect(imeServiceSample('  mInputShown=true')).toContain(
      'no "Last computed insets:" block'
    );
  });

  it('does not read `mInputShown=false` as shown', () => {
    // A substring check would: `mInputShown=false` contains `mInputShown=`, and a laxer
    // pattern than `=true\b` also matches `mInputShown=trueish` in a future field list.
    expect(imeServiceShown('  mInputShown=false')).toBe(false);
    expect(imeServiceSample('  mInputShown=false')).toContain(
      'mInputShown is not true'
    );
  });

  it('quotes what the dump actually said', () => {
    expect(imeServiceSample(INPUT_METHOD_UP)).toContain(
      'visibleTopInsets=1399'
    );
  });
});

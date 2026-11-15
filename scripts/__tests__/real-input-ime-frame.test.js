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

import {
  imeEditorInfo,
  imeEditorInfoSample,
  imeInsetSample,
  imeInsetTop,
  imeServiceSample,
  imeServiceShown,
  imeServiceTopPx,
} from '../real-input/ime-frame.mjs';

/** The keyboard on screen, as `dumpsys activity top` printed it on the API 35 image. */
const SHOWN =
  '            InsetsSource id=3 type=ime frame=[0,1541][1080,2424] ' +
  'visibleFrame=[0,1541][1080,2424] visible=true flags= sideHint=BOTTOM ' +
  'boundingRects=null\n';

/** The same source with no keyboard in it: a real line, and no answer to the question. */
const HIDDEN =
  '            InsetsSource id=e992000a type=ime frame=[0,0][0,0] visible=false ' +
  'flags= sideHint=NONE boundingRects=null\n';

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

  it('reads the visible ime source and none of its neighbours', () => {
    expect(imeInsetTop(ACTIVITY_TOP_UP)).toBe(1399);
  });

  it('is not fooled by the navigation-bar and gesture lines beside it', () => {
    // Neither of those is `type=ime`, and both carry a bottom frame that would make a
    // wrong answer look plausible (2274 of a 2424 px window is a real band).
    expect(
      imeInsetTop(ACTIVITY_TOP_DOWN.replace(/\bvisible=false\b/, ''))
    ).toBe(null);
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

/**
 * `imeServiceTopPx` reads the other scrape, `dumpsys input_method`. S6b round 2 is why it is
 * tested with the keyboard down as well as up: it asserted `a full keyboard … occupies
 * 2282 px of a 2424 px window` on a device where the real band was 1025 px, from a record
 * belonging to a *hidden* keyboard. The insets block survives the hide, so a parser that
 * only ever sees a keyboard-up dump cannot prove it refuses a keyboard-down one.
 */
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

/**
 * `imeEditorInfo` is the reader for a different question — not "how high is the keyboard"
 * but "which keyboard was the IME asked for" — and it broke in the other direction: a
 * scrape written against `mCurEditorInfo=EditorInfo{…}` matched nothing at all, because the
 * manager's *text* dump has never printed the editor record. It forwards to the bound IME,
 * whose own section prints `mInputEditorInfo:` and then `EditorInfo.dump()`, whose first
 * line is `inputType=0x… imeOptions=0x… privateImeOptions=…`.
 *
 * The fixtures are that shape, with the two hex numbers chosen so a parser that grabbed the
 * wrong pair or read the hex as decimal cannot land on them: the field here asked for the
 * decimal keypad (`0x2002`, not the plain number class the wrapper's own fallback would
 * name) with the Search action (`0x3`), beside a `0x0` caps mode and a `0x8` show-flags
 * value that are the decoys a loose match would take.
 */
const EDITOR_SESSION = [
  'Input method service state for com.android.inputmethod.latin.LatinIME@9a3f1c0:',
  '  mViewsCreated=true',
  '  mDecorViewVisible=true mIsFullscreenMode=false mIsFullscreenExtractMode=false',
  '  mToken=android.os.BinderProxy@c3d4e5f',
  '  mInputBinding=InputBinding{InputMethodBinding{...',
  '  mStartedInputConnection=android.view.inputmethod.ComposingText@0',
  '  mInputStarted=true mInputViewStarted=true mCandidatesViewStarted=false',
  '  mInputEditorInfo:',
  '    inputType=0x2002 imeOptions=0x3 privateImeOptions=null',
  '    actionLabel=null actionId=0',
  '    initialSelStart=0 initialSelEnd=0 initialToolType=1 initialCapsMode=0x0',
  '    hintText=Search recipes label=null',
  '    packageName=com.nitroui.example autofillId=123 fieldId=0 fieldName=null',
  '  mShowInputRequested=true mLastShowInputRequested=true mShowInputFlags=0x8',
  '',
].join('\n');

/** The same section with a field focused and no session the IME has taken. */
const NO_SESSION = EDITOR_SESSION.replace(
  /  mInputEditorInfo:\n(?:.*\n)*?(?=  mShowInputRequested)/,
  '  mInputEditorInfo: null\n'
);

describe('imeEditorInfo', () => {
  it('reads the keyboard and the action key off the IME service section', () => {
    const found = imeEditorInfo(EDITOR_SESSION);
    expect(found).not.toBeNull();
    expect(found.inputType).toBe(0x2002);
    expect(found.imeOptions).toBe(0x3);
    expect(found.sample).toContain('inputType=0x2002');
  });

  it('reads nothing when the field has no session, and says that is what it saw', () => {
    expect(imeEditorInfo(NO_SESSION)).toBeNull();
    expect(imeEditorInfoSample(NO_SESSION)).toContain('mInputEditorInfo: null');
  });

  it('says so when the dump carries no IME section at all', () => {
    // The manager's own lines, which is all a dump used to be to a parser that looked for
    // the record here: nothing in them answers the question, and a `null` with no words
    // attached is how a broken scrape hides.
    const managerOnly =
      '  mCurrentUserId=0\n  mCurMethodId=com.android.inputmethod.latin/.LatinIME\n' +
      '  mCurClient=ClientState{fa11 10136 android.view.inputmethod.IInputMethodWrapper}\n';
    expect(imeEditorInfo(managerOnly)).toBeNull();
    expect(imeEditorInfoSample(managerOnly)).toContain(
      'no IME service section'
    );
  });
});

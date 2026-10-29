/**
 * A hosted Switch's own state, read out of a `uiautomator dump`.
 *
 * `nativeChecked` is M3's Android half: it is what lets `pressUntil` tell "the
 * OS dropped the touch" from "the control changed and the change event never
 * reached JS". Both of its failure modes are silent. Return `null` where a value
 * exists and every retry gets blamed on delivery, which is the behaviour this
 * whole change exists to stop. Pick the wrong node and it reads somebody else's
 * state, which is worse than reading nothing because it is *confidently* wrong -
 * it can call a delivered touch a dropped one.
 *
 * The fixtures are the real shapes, measured in a dump of the running app: the
 * labelled node is `checkable="false"` at `[901,759][1038,843]` and the node that
 * holds the value is its parent, `checkable="true"` at `[901,738][1038,864]`. The
 * library's `accessibilityLabel` lands on the child, so reading the labelled node
 * itself answers "off" forever.
 */

import { describe, expect, it } from '@jest/globals';

import { parseHierarchy } from '../real-input/uiautomator.mjs';
import { nativeChecked } from '../real-input/android-tree.mjs';

/**
 * A node shaped like the ones in a real dump.
 *
 * `bounds` is what `parseHierarchy` produces, so the fixture is built through the
 * real parser rather than by hand: a hand-rolled object that gets `width` wrong
 * would test the helper against a shape the code never sees.
 */
function node({ desc = '', checkable = 'false', checked = 'false', bounds }) {
  return {
    contentDesc: desc,
    checkable,
    checked,
    ...parseHierarchy(
      `<hierarchy>${
        `<node content-desc="${desc}" checkable="${checkable}" checked="${checked}" ` +
        `bounds="${bounds}" />`
      }</hierarchy>`
    )[0],
  };
}

/** The real pair, as measured: labelled child inside a checkable parent. */
const SWITCH_ON = [
  node({ bounds: '[0,0][1080,2424]' }),
  node({ checkable: 'true', checked: 'true', bounds: '[901,738][1038,864]' }),
  node({ desc: 'Controlled switch', bounds: '[901,759][1038,843]' }),
];

describe('real-input Android native state', () => {
  it('reads the value off the checkable box that carries the labelled control', () => {
    expect(nativeChecked(SWITCH_ON, 'Controlled switch')).toBe('on');
    expect(
      nativeChecked(
        SWITCH_ON.map((n, i) => (i === 1 ? { ...n, checked: 'false' } : n)),
        'Controlled switch'
      )
    ).toBe('off');
  });

  it('refuses a checkable box elsewhere on the screen', () => {
    // The screen the real-input suite runs on has eight checkable Switches. A
    // helper that took "the first checkable node in document order" - which is
    // what reading the flat dump backwards does - would answer with whichever one
    // happens to be first, and the M3 guard would then be comparing one control's
    // state against another control's echo.
    const tree = [
      node({ checkable: 'true', checked: 'true', bounds: '[80,400][206,526]' }),
      node({
        checkable: 'true',
        checked: 'false',
        bounds: '[901,738][1038,864]',
      }),
      node({ desc: 'Controlled switch', bounds: '[901,759][1038,843]' }),
    ];
    expect(nativeChecked(tree, 'Controlled switch')).toBe('off');
  });

  it('takes the tightest box when several contain the control', () => {
    // A wrapper that also publishes `checkable` would otherwise win by being
    // first, and it reports its own aggregate rather than the control's value.
    const tree = [
      node({
        checkable: 'true',
        checked: 'true',
        bounds: '[880,700][1060,900]',
      }),
      node({
        checkable: 'true',
        checked: 'false',
        bounds: '[901,738][1038,864]',
      }),
      node({ desc: 'Controlled switch', bounds: '[901,759][1038,843]' }),
    ];
    expect(nativeChecked(tree, 'Controlled switch')).toBe('off');
  });

  it('says null rather than guessing when the control publishes nothing', () => {
    // Button, Slider and SegmentedControl have no `checked`. Returning "off" for
    // those would make `pressUntil` believe it had a witness.
    expect(
      nativeChecked(
        [node({ desc: 'Hosted button', bounds: '[100,700][300,760]' })],
        'Hosted button'
      )
    ).toBeNull();
    expect(nativeChecked(SWITCH_ON, 'A control not on this screen')).toBeNull();
  });

  it('ignores a labelled node with no box', () => {
    // A node scrolled out of the viewport keeps its `content-desc` and loses its
    // height. Matching it would read the state of a control no tap could reach,
    // while `requireControlOnScreen` is separately refusing to press it.
    const tree = [
      node({
        checkable: 'true',
        checked: 'true',
        bounds: '[901,738][1038,864]',
      }),
      node({ desc: 'Controlled switch', bounds: '[901,759][1038,759]' }),
      node({ desc: 'Controlled switch', bounds: '[901,759][1038,843]' }),
    ];
    expect(nativeChecked(tree, 'Controlled switch')).toBe('on');
  });
});

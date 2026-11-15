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
import {
  nativeChecked,
  nativeEnabled,
  tightestFlaggedNode,
} from '../real-input/android-tree.mjs';

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

/**
 * `nativeEnabled`, against the shape measured on G12's Chip screen: the disabled
 * chip's `enabled="false"` is on its clickable 48 dp touch target, and the node
 * with the label inside it says `enabled="true"`.
 */
function chipNode({
  desc = '',
  clickable = 'false',
  enabled = 'true',
  bounds,
}) {
  return {
    ...parseHierarchy(
      `<hierarchy><node content-desc="${desc}" clickable="${clickable}" ` +
        `enabled="${enabled}" bounds="${bounds}" /></hierarchy>`
    )[0],
  };
}

const DISABLED_CHIP = [
  chipNode({ bounds: '[0,0][1080,2424]', clickable: 'true' }),
  chipNode({
    clickable: 'true',
    enabled: 'false',
    bounds: '[562,738][964,864]',
  }),
  chipNode({ desc: 'Real-input disabled chip', bounds: '[562,759][964,843]' }),
];

describe('real-input Android enabled state', () => {
  it('reads enabled off the clickable box that carries the labelled control', () => {
    expect(nativeEnabled(DISABLED_CHIP, 'Real-input disabled chip')).toBe(
      'false'
    );
    expect(
      nativeEnabled(
        DISABLED_CHIP.map((n, i) => (i === 1 ? { ...n, enabled: 'true' } : n)),
        'Real-input disabled chip'
      )
    ).toBe('true');
  });

  it('does not read the labelled node itself, which says enabled either way', () => {
    // The measured trap: the labelled node is `enabled="true"` on a disabled chip.
    const labelled = DISABLED_CHIP[2];
    expect(labelled.enabled).toBe('true');
    expect(nativeEnabled(DISABLED_CHIP, 'Real-input disabled chip')).not.toBe(
      labelled.enabled
    );
  });

  it('says null when nothing clickable carries the control', () => {
    expect(
      nativeEnabled(
        [chipNode({ desc: 'Lonely', bounds: '[0,0][10,10]' })],
        'Lonely'
      )
    ).toBeNull();
    expect(nativeEnabled(DISABLED_CHIP, 'Not on this screen')).toBeNull();
  });
});

/**
 * `tightestFlaggedNode`, against the shape measured on G20's ButtonGroup screen:
 * Material merges the *row*, then draws each item as its own box (the one that
 * carries `clickable`, and for a toggle `checkable`/`checked`), the title as a
 * separate `TextView` inside it, and Compose's `Role.Checkbox` decoration as a third
 * node between the two. `real-input`'s item search starts from the title, because
 * that is the only thing in the dump that says which item it means.
 *
 * The three nodes are deliberately the same shape apart from the flags: a rule that
 * took the first node in document order, the loosest container, or the named node
 * itself would each pick one of the decoys, and the `ButtonGroup` check would then
 * report a checked toggle as unchecked and a disabled item as enabled.
 */
function groupNode({
  text = '',
  clickable = 'false',
  checkable = 'false',
  checked = 'false',
  enabled = 'true',
  cls = 'android.view.View',
  bounds,
}) {
  return parseHierarchy(
    `<hierarchy><node text="${text}" class="${cls}" clickable="${clickable}" ` +
      `checkable="${checkable}" checked="${checked}" enabled="${enabled}" ` +
      `bounds="${bounds}" /></hierarchy>`
  )[0];
}

/** The `Bold` toggle item of "Real-input formatting toggles", as measured. */
const TOGGLE_ITEM = [
  groupNode({ bounds: '[0,0][1080,2424]' }),
  // A row that *is* clickable, and answers for the whole group: the loosest box that
  // contains the title, and the wrong answer to both questions below. The real row is
  // not clickable, but a rule that picked the loosest container cannot tell the two
  // screens apart, and the fixture must be able to.
  groupNode({
    clickable: 'true',
    checkable: 'true',
    checked: 'false',
    enabled: 'true',
    bounds: '[189,947][891,1073]',
  }),
  groupNode({
    clickable: 'true',
    checkable: 'true',
    checked: 'true',
    bounds: '[189,948][421,1073]',
  }), // the item
  groupNode({
    cls: 'android.widget.CheckBox',
    bounds: '[189,958][421,1063]',
  }), // the Role.Checkbox decoration
  groupNode({
    text: 'Bold',
    cls: 'android.widget.TextView',
    bounds: '[305,984][379,1037]',
  }), // the title
];

describe('real-input Android container lookup', () => {
  it('answers the item, not the title, the decoration or the row', () => {
    const title = TOGGLE_ITEM[4];
    expect(tightestFlaggedNode(TOGGLE_ITEM, title, 'checkable')).toBe(
      TOGGLE_ITEM[2]
    );
    expect(tightestFlaggedNode(TOGGLE_ITEM, title, 'clickable')).toBe(
      TOGGLE_ITEM[2]
    );
    expect(tightestFlaggedNode(TOGGLE_ITEM, title, 'checkable').checked).toBe(
      'true'
    );
  });

  it('carries the disabled answer out of the item, where it lives', () => {
    // The measured trap, one rung smaller than the Chip's: the title of a disabled
    // item says `enabled="true"` and the item's own box says `enabled="false"`.
    const disabled = TOGGLE_ITEM.map((n, i) =>
      i === 2 ? { ...n, checked: 'false', enabled: 'false' } : n
    );
    expect(
      tightestFlaggedNode(disabled, disabled[4], 'clickable').enabled
    ).toBe('false');
    expect(disabled[4].enabled).toBe('true');
  });

  it('says null rather than naming somebody else', () => {
    // A title with no clickable box around it is not an item a reader can act on,
    // and `itemOf` aborts on that reading — so the helper must not answer.
    expect(
      tightestFlaggedNode(
        [TOGGLE_ITEM[0], TOGGLE_ITEM[4]],
        TOGGLE_ITEM[4],
        'clickable'
      )
    ).toBeNull();
    expect(tightestFlaggedNode(TOGGLE_ITEM, null, 'clickable')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';

import { parseHierarchy } from '../real-input/uiautomator.mjs';
import {
  nativeChecked,
  tightestFlaggedNode,
} from '../real-input/android-tree.mjs';

/**
 * A node shaped like the ones in a real dump, built through the real parser so
 * its `bounds` have the shape the code sees.
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

/**
 * As in a real dump: the accessibility label lands on a child that is not
 * checkable, and its checkable parent holds the value.
 */
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
    // The first checkable node in document order belongs to another control.
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
    // height.
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
 * A ButtonGroup item in a real dump: the item's own box carries `clickable` (and
 * for a toggle `checkable`/`checked`), its title is a separate `TextView` inside
 * it, and Compose's `Role.Checkbox` decoration is a third node between the two.
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

/** A `Bold` toggle item, inside a decoy row. */
const TOGGLE_ITEM = [
  groupNode({ bounds: '[0,0][1080,2424]' }),
  // A decoy: a clickable row, the loosest box that contains the title.
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
    // The title of a disabled item says `enabled="true"`; the item's own box
    // says `enabled="false"`.
    const disabled = TOGGLE_ITEM.map((n, i) =>
      i === 2 ? { ...n, checked: 'false', enabled: 'false' } : n
    );
    expect(
      tightestFlaggedNode(disabled, disabled[4], 'clickable').enabled
    ).toBe('false');
    expect(disabled[4].enabled).toBe('true');
  });

  it('says null rather than naming somebody else', () => {
    // A title with no clickable box around it is not an item a reader can act on.
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

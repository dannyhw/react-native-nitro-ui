import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  A11Y_CONTROLS,
  A11Y_EXEMPTIONS,
  a11yProblems,
  checkControlA11y,
  staleExemptions,
} from '../real-input/a11y.mjs';
import { parseHierarchy } from '../real-input/uiautomator.mjs';

/** @type {Map<string, import('../real-input/uiautomator.mjs').UiautomatorNode[]>} */
const parsed = new Map();

/**
 * A control's tree as dumped from the running app by
 * `scripts/conformance/make-a11y-fixtures.mjs`, parsed once so node identity survives:
 * the mutations below find the node to break by object.
 *
 * @param {string} id an `A11yControl.id`
 */
function tree(id) {
  if (!parsed.has(id)) {
    parsed.set(
      id,
      parseHierarchy(
        readFileSync(`${__dirname}/fixtures/a11y/${id}.xml`, 'utf8')
      )
    );
  }
  return parsed.get(id);
}

/**
 * @param {string} id an `A11yControl.id`
 * @returns {import('../real-input/a11y.mjs').A11yControl}
 */
function control(id) {
  const found = A11Y_CONTROLS.find((candidate) => candidate.id === id);
  if (found == null) throw new Error(`no a11y case "${id}"`);
  return found;
}

/** The node a verdict is about, so a mutation can be named precisely. */
function named(id) {
  const node = tree(id).find(
    (candidate) => candidate.contentDesc === control(id).label
  );
  if (node == null) throw new Error(`fixture ${id} has no named node`);
  return node;
}

/** The measured tree with one node replaced by a patched copy, the rest verbatim. */
function mutate(id, target, patch) {
  return tree(id).map((node) =>
    node === target ? { ...node, ...patch } : node
  );
}

const ZERO_BOX = {
  x1: 0,
  y1: 0,
  x2: 0,
  y2: 0,
  cx: 0,
  cy: 0,
  width: 0,
  height: 0,
};

describe('the a11y rule, on measured trees', () => {
  it('passes the controls today’s code gets right, and reports the rest as debt', () => {
    const verdicts = A11Y_CONTROLS.map((entry) => {
      const result = checkControlA11y(entry, tree(entry.id));
      return { id: entry.id, failures: result.failures, known: result.known };
    });
    expect(
      verdicts.filter((v) => v.known.length === 0).map((v) => v.id)
    ).toEqual([
      'switch',
      'button',
      'date-picker',
      'picker',
      'menu',
      'chip',
      'checkbox',
      'icon-button',
      'button-group',
      'hosted-switch',
      'hosted-button',
      'hosted-picker',
      'hosted-date-picker',
      'hosted-progress',
      'text-field',
      'search-field',
      'context-menu',
      'form',
      'list-item',
    ]);
    expect(verdicts.filter((v) => v.known.length > 0).map((v) => v.id)).toEqual(
      [
        'slider',
        'segmented-control',
        // Actionable only through Compose's custom `SetProgress`, which a uiautomator
        // dump cannot show.
        'stepper',
        'hosted-slider',
        'hosted-segmented',
      ]
    );
    // A new failure on a control with a debt row still goes red: rows match findings.
    for (const verdict of verdicts) {
      expect(verdict.failures).toEqual([]);
    }
  });

  it('goes red when a name moves to the container around the control', () => {
    // The wrapper is the RN content container (the whole page): the shape a component
    // produces when it sets `accessibilityLabel` on its host view rather than on the
    // thing it renders.
    const target = named('switch');
    const wrapper = tree('switch').find(
      (node) =>
        node !== target &&
        node.className === 'android.view.ViewGroup' &&
        node.bounds.width === 1080 &&
        node.bounds.height === 2040 &&
        node.scrollable !== 'true'
    );
    expect(wrapper).toBeDefined();
    const mutated = tree('switch').map((node) => {
      if (node === target) return { ...node, contentDesc: '' };
      if (node === wrapper)
        return { ...node, contentDesc: control('switch').label };
      return node;
    });
    const problems = a11yProblems(control('switch'), mutated);
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain('is not actionable');
    expect(problems[0]).toContain('which is the page, not the control');
  });

  it('goes red when the name is on the control AND on something else', () => {
    const mutated = tree('switch').map((node) =>
      node.className === 'android.widget.ScrollView'
        ? { ...node, contentDesc: control('switch').label }
        : node
    );
    const problems = a11yProblems(control('switch'), mutated);
    expect(problems.join('\n')).toContain('2 nodes carry the name');
    expect(problems.join('\n')).toContain('announces twice');
  });

  it('goes red when a labelled checkbox splits its name across two nodes', () => {
    // The fixture has one named node, so the split is written back into it: the same
    // name on a second, wider node that answers to nothing.
    const home = named('checkbox');
    const labelBox = {
      ...home.bounds,
      x1: home.bounds.x2 - 20,
      width: home.bounds.width,
      cx: home.bounds.cx + 100,
    };
    const split = {
      ...home,
      className: 'android.view.View',
      bounds: labelBox,
      clickable: 'false',
      checkable: 'false',
      focusable: 'false',
    };
    const problems = a11yProblems(control('checkbox'), [
      ...tree('checkbox'),
      split,
    ]);
    expect(problems.join('\n')).toContain('2 nodes carry the name');
    expect(problems.join('\n')).toContain('announces twice');
    expect(a11yProblems(control('checkbox'), tree('checkbox'))).toEqual([]);
  });

  it('goes red when a stepper’s two halves each keep a name', () => {
    // What a dump shows once the two glyph buttons stop clearing their semantics.
    const home = named('stepper');
    const half = {
      ...home,
      className: 'android.widget.Button',
      clickable: 'true',
      focusable: 'true',
      bounds: {
        ...home.bounds,
        x2: home.bounds.x1 + Math.round(home.bounds.width / 2),
        width: Math.round(home.bounds.width / 2),
        cx: home.bounds.x1 + Math.round(home.bounds.width / 4),
      },
    };
    const problems = a11yProblems(control('stepper'), [
      ...tree('stepper'),
      half,
    ]);
    expect(problems.join('\n')).toContain('2 nodes carry the name');
    expect(problems.join('\n')).toContain('announces twice');
    // The unmutated tree carries its known not-actionable finding, but not this one.
    const measured = a11yProblems(control('stepper'), tree('stepper'));
    expect(measured.join('\n')).not.toContain('nodes carry the name');
  });

  it('goes red when the name has no box', () => {
    // Compose names a hosted control below the fold and draws nothing for it.
    const problems = a11yProblems(
      control('hosted-button'),
      mutate('hosted-button', named('hosted-button'), { bounds: ZERO_BOX })
    );
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain('zero-sized box');
  });

  it('goes red when the name disappears', () => {
    const problems = a11yProblems(
      control('date-picker'),
      mutate('date-picker', named('date-picker'), {
        contentDesc: 'Something else',
      })
    );
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain('announces this control as nothing');
  });

  it('goes red for an interactive control whose named node cannot be acted on', () => {
    // The Picker's name is on a `Spinner` that is itself `clickable`; no other node at
    // the control's box is actionable.
    const stripped = mutate('picker', named('picker'), { clickable: 'false' });
    const problems = a11yProblems(control('picker'), stripped);
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain('is not actionable');
    expect(problems[0]).toContain(
      'The nearest actionable box containing it is'
    );
    expect(problems[0]).toContain('which is the page, not the control');
  });

  it('does not let the page’s scroll view stand in for a control', () => {
    // The ScrollView is focusable and contains everything, so a rule of containment plus
    // any action would pass every control.
    const scroller = tree('slider').find((node) => node.scrollable === 'true');
    expect(scroller.focusable).toBe('true');
    expect(scroller.bounds.width).toBeGreaterThan(named('slider').bounds.width);
    const problems = a11yProblems(control('slider'), tree('slider'));
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain('which is the page, not the control');
  });

  it('goes red when the only actionable ancestor is a region, not the control', () => {
    // A `focusable` card or section container around the name is not the control's own
    // box, and only its size tells it from a touch target. The Switch's named track sits
    // in a Material touch target, which this fixture swaps for a much larger ancestor.
    const nodes = tree('switch');
    const target = nodes.find(
      (node) =>
        node !== named('switch') &&
        node.clickable === 'true' &&
        node.bounds.width === named('switch').bounds.width
    );
    expect(target).toBeDefined();
    const namedBox = named('switch').bounds;
    const region = {
      ...target,
      // The size of a section container and well under a page's, so the size rule alone
      // has to catch it, not the scroll filter.
      bounds: {
        ...namedBox,
        x1: namedBox.x1 - 100,
        y1: namedBox.y1 - 100,
        x2: namedBox.x2 + 100,
        y2: namedBox.y2 + 100,
        width: namedBox.width + 200,
        height: namedBox.height + 200,
        cx: namedBox.cx,
        cy: namedBox.cy,
      },
      scrollable: 'false',
    };
    const withRegion = nodes.map((node) => (node === target ? region : node));
    expect(
      region.bounds.width * region.bounds.height >
        namedBox.width * namedBox.height * 4
    ).toBe(true);
    const problems = a11yProblems(control('switch'), withRegion);
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain('nothing whose box is the control');
    // The same node at touch-target size is still accepted.
    const realTarget = nodes.find((node) => node === target);
    expect(a11yProblems(control('switch'), nodes)).toEqual([]);
    expect(realTarget.clickable).toBe('true');
  });

  it('goes red when a name lands on the scroll container itself', () => {
    // The scroll view is focusable, so "the name is on an actionable node" is true here.
    const scroller = tree('switch').find((node) => node.scrollable === 'true');
    const mutated = tree('switch').map((node) => {
      if (node === scroller)
        return { ...node, contentDesc: control('switch').label };
      if (node === named('switch')) return { ...node, contentDesc: '' };
      return node;
    });
    const problems = a11yProblems(control('switch'), mutated);
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain('is on a scroll container');
  });

  it('accepts a Material touch target taller than the visual it wraps', () => {
    // Why the rule is containment and not box equality: the Switch's named node is 137x84
    // inside a clickable, checkable, focusable node of 137x126.
    const target = named('switch');
    expect(target.clickable).toBe('false');
    expect(target.checkable).toBe('false');
    const home = tree('switch').find(
      (node) =>
        node !== target &&
        node.bounds.width === target.bounds.width &&
        node.bounds.height > target.bounds.height &&
        node.clickable === 'true'
    );
    expect(home).toBeDefined();
    expect(a11yProblems(control('switch'), tree('switch'))).toEqual([]);
    // Without the home's flags the same tree fails, so the pass above is not the scroll
    // view's doing.
    const stripped = mutate('switch', home, {
      clickable: 'false',
      checkable: 'false',
      focusable: 'false',
    });
    expect(a11yProblems(control('switch'), stripped)[0]).toContain(
      'is not actionable'
    );
  });

  it('grades the control, not the first node that happens to carry its name', () => {
    // A recycled wrapper can carry the row's name too and come first in tree order. The
    // fixture adds that second node ahead of the row and makes the row clickable, as a
    // pressable Form row is.
    const row = named('form');
    expect(row.resourceId).toBe(control('form').anchorTestId);
    const pressable = { ...row, clickable: 'true' };
    const box = row.bounds;
    const wrapper = {
      ...row,
      resourceId: '',
      focusable: 'true',
      scrollable: 'true',
      bounds: {
        ...box,
        x1: 0,
        y1: 0,
        x2: box.x2 + 60,
        y2: box.y2 + 400,
        width: box.width + 60,
        height: box.height + 400,
        cx: box.cx,
        cy: box.cy,
      },
    };
    const nodes = [
      wrapper,
      ...tree('form').map((node) => (node === row ? pressable : node)),
    ];

    const problems = a11yProblems(control('form'), nodes);
    // The duplicate is still a finding, but actionability was asked of the row, not of
    // the wrapper.
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain('announces twice');
    expect(problems.join(' ')).not.toContain('scroll container');
    expect(problems.join(' ')).not.toContain('is not actionable');

    const single = a11yProblems(
      control('form'),
      tree('form').map((node) => (node === row ? pressable : node))
    );
    expect(single).toEqual([]);
  });

  it('grades a group by what its box contains, and goes red when that is nothing', () => {
    // Material merges the row into the node that carries the group's name, and the items
    // survive inside it as three separately clickable views. A `clearAndSetSemantics` on
    // the row would swallow exactly those three nodes.
    const items = tree('button-group').filter(
      (node) =>
        node.scrollable !== 'true' &&
        (node.clickable === 'true' ||
          node.checkable === 'true' ||
          node.focusable === 'true')
    );
    expect(items.length).toBe(3);
    expect(a11yProblems(control('button-group'), tree('button-group'))).toEqual(
      []
    );
    const swallowed = tree('button-group').map((node) =>
      items.includes(node)
        ? {
            ...node,
            clickable: 'false',
            checkable: 'false',
            focusable: 'false',
          }
        : node
    );
    const problems = a11yProblems(control('button-group'), swallowed);
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain('names a group whose box contains nothing');
  });
});

describe('the debt list', () => {
  it('is the measured findings, per platform, and nothing else', () => {
    expect(
      A11Y_EXEMPTIONS.map((entry) => `${entry.platform}:${entry.control}`)
    ).toEqual([
      'android:slider',
      'android:segmented-control',
      'android:hosted-slider',
      'android:hosted-segmented',
      'android:stepper',
      'ios:slider',
      'ios:hosted-slider',
      'ios:stepper',
      'ios:hosted-picker',
      'ios:context-menu',
      'ios:form',
      'ios:icon-button',
    ]);
    for (const entry of A11Y_EXEMPTIONS) {
      expect(entry.followups.length).toBeGreaterThan(0);
    }
  });

  it('excuses only the finding it describes', () => {
    // A row matched to `not actionable` must not excuse a missing name.
    const missing = mutate('slider', named('slider'), { contentDesc: '' });
    const result = checkControlA11y(control('slider'), missing);
    expect(result.exempt).toBe(false);
    expect(result.failures.length).toBe(1);
    expect(result.failures[0]).toContain('announces this control as nothing');
  });

  it('goes red when a control is fixed and its row is left behind', () => {
    // Give the Slider's own node a press and its row stops matching.
    const fixed = mutate('slider', named('slider'), { clickable: 'true' });
    const result = checkControlA11y(control('slider'), fixed);
    expect(result.known).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.exempt).toBe(false);
    expect(
      staleExemptions(
        A11Y_CONTROLS.map((entry) => entry.id),
        []
      )
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('the android entry for "slider"'),
        expect.stringContaining('delete the exemption'),
      ])
    );
    // Every row of the platform asked about is reported, and none of the other's.
    expect(
      staleExemptions(
        A11Y_CONTROLS.map((entry) => entry.id),
        [],
        'android'
      ).length
    ).toBe(A11Y_EXEMPTIONS.filter((e) => e.platform === 'android').length);
    expect(
      staleExemptions(
        A11Y_CONTROLS.map((entry) => entry.id),
        [],
        'ios'
      ).length
    ).toBe(A11Y_EXEMPTIONS.filter((e) => e.platform === 'ios').length);
  });

  it('says nothing about a control the run never read', () => {
    // A filtered `--control slider` run must not report the rows it skipped as stale.
    expect(staleExemptions(['slider'], ['slider'])).toEqual([]);
    expect(staleExemptions([], [])).toEqual([]);
    expect(staleExemptions(['slider'], [])).toEqual([
      expect.stringContaining('the android entry for "slider"'),
    ]);
  });
});

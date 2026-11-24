import { describe, expect, it, vi } from 'vitest';

import { editableField } from '../../example/e2e/real-input/support';
import {
  chooseByBox,
  fieldLocator,
} from '../../example/e2e/real-input/field-locator';

vi.mock('e2e', () => ({ expect: {} }));

/** `[x1,y1][x2,y2]`, the way a dump and the driver's evidence print a box. */
function bounds(text) {
  const [x1, y1, x2, y2] = text.match(/-?\d+(\.\d+)?/g).map(Number);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

const node = (role, name, box, children = []) => ({
  role,
  name,
  rect: box == null ? undefined : bounds(box),
  children,
});

/**
 * The Form screen as the CI driver reported it when the case failed: the field's
 * `textbox` and the `group "Note"` siblings at one depth, the boxes from the same
 * failure's snapshot (`EditText` [105,346][975,421], `View desc="Note"`
 * [105,346][975,409], `TextView "Notes"` [0,211][163,306]).
 */
function formSiblings() {
  return node('group', undefined, '[0,0][1080,2424]', [
    node('heading', 'Notes', '[0,211][163,306]'),
    node('text', 'Saved when the field loses focus.', '[105,306][975,340]'),
    node('group', undefined, '[105,346][975,421]'),
    node('textbox', undefined, '[105,346][975,421]'),
    node('group', 'Note', '[105,346][975,409]'),
    node('text', 'Near the bottom of the list', '[105,430][975,470]'),
    node('heading', 'Diagnostics', '[0,520][300,600]'),
  ]);
}

/**
 * The Form screen as a `uiautomator dump` of this library shows it on a local
 * emulator: `EditText` [105,1445][975,1520] with its child `View desc="Note"`
 * [105,1445][975,1508].
 */
function formNested() {
  return node('group', undefined, '[0,0][1080,2424]', [
    node('heading', 'Notes', '[0,1310][163,1405]'),
    node('textbox', undefined, '[105,1445][975,1520]', [
      node('group', 'Note', '[105,1445][975,1508]'),
    ]),
    node('text', 'Near the bottom of the list', '[105,1529][975,1569]'),
  ]);
}

/** Two fields on one screen, each in the shape asked for. */
function twoFields(role, first, second, shape) {
  const field = (name, top) => {
    const box = `[48,${top}][1032,${top + 150}]`;
    const label = `[48,${top}][1032,${top + 130}]`;
    return shape === 'nested'
      ? [node(role, undefined, box, [node('group', name, label)])]
      : [node(role, undefined, box), node('group', name, label)];
  };
  return node('group', undefined, '[0,0][1080,2424]', [
    node('text', 'value', '[48,300][400,340]'),
    ...field(first, 400),
    node('text', 'focus', '[48,600][400,640]'),
    ...field(second, 700),
  ]);
}

/**
 * A screen whose locators resolve the way the mobile engine resolves them over one
 * snapshot: a role query skips nothing here (no node is hidden), a label query is a
 * case-insensitive substring kept innermost, `or` is a union in document order, and
 * `has` looks among strict descendants only. Every read takes a fresh snapshot of
 * `screen.tree`, so a test can change the screen between reads.
 */
function standInScreen(tree) {
  const screen = { tree, actions: [], reads: 0 };

  const flatten = () => {
    const index = [];
    const walk = (entry, parent) => {
      const item = { node: entry, parent };
      index.push(item);
      for (const child of entry.children ?? []) walk(child, item);
    };
    walk(screen.tree, undefined);
    return index;
  };
  const within = (entry, ancestor) => {
    for (let at = entry.parent; at != null; at = at.parent) {
      if (at === ancestor) return true;
    }
    return false;
  };
  const resolve = (expression, index) => {
    switch (expression.kind) {
      case 'role': {
        const scope =
          expression.scope == null
            ? index
            : index.filter((entry) =>
                resolve(expression.scope, index).some((outer) =>
                  within(entry, outer)
                )
              );
        return scope.filter((entry) => entry.node.role === expression.role);
      }
      case 'label': {
        const matches = index.filter((entry) =>
          (entry.node.name ?? '')
            .toLowerCase()
            .includes(expression.text.toLowerCase())
        );
        return matches.filter(
          (entry) =>
            !matches.some((other) => other !== entry && within(other, entry))
        );
      }
      case 'union': {
        const both = new Set([
          ...resolve(expression.left, index),
          ...resolve(expression.right, index),
        ]);
        return index.filter((entry) => both.has(entry));
      }
      case 'filter':
        return resolve(expression.source, index).filter((entry) => {
          const inside = index.filter((other) => within(other, entry));
          if (
            expression.has != null &&
            resolve(expression.has, inside).length === 0
          ) {
            return false;
          }
          return (
            expression.hasNot == null ||
            resolve(expression.hasNot, inside).length === 0
          );
        });
      case 'nth': {
        const picked = resolve(expression.source, index)[expression.index];
        return picked == null ? [] : [picked];
      }
      default:
        throw new Error(`stand-in: no ${expression.kind} expression`);
    }
  };
  const snapshot = (expression) => {
    screen.reads += 1;
    return resolve(expression, flatten());
  };

  const locator = (expression) => {
    const one = (what) => {
      const matches = snapshot(expression);
      if (matches.length === 0) {
        throw new Error(`locator matched no nodes (${what})`);
      }
      if (matches.length > 1) {
        throw new Error(
          `locator is ambiguous: ${String(matches.length)} nodes`
        );
      }
      return matches[0].node;
    };
    const act = (action) => async (text) => {
      screen.actions.push({ action, node: one(action), text });
    };
    return {
      expression,
      count: async () => snapshot(expression).length,
      all: async () =>
        snapshot(expression).map((_, index) =>
          locator({ kind: 'nth', source: expression, index })
        ),
      nth: (index) => locator({ kind: 'nth', source: expression, index }),
      or: (other) =>
        locator({ kind: 'union', left: expression, right: other.expression }),
      filter: ({ has, hasNot }) =>
        locator({
          kind: 'filter',
          source: expression,
          has: has?.expression,
          hasNot: hasNot?.expression,
        }),
      getByRole: (role) => locator({ kind: 'role', role, scope: expression }),
      boundingBox: async () => ({ ...one('boundingBox').rect }),
      isVisible: async () => one('isVisible') != null,
      tap: act('tap'),
      pressSequentially: act('pressSequentially'),
    };
  };

  screen.getByRole = (role) => locator({ kind: 'role', role });
  screen.getByLabel = (text) => locator({ kind: 'label', text });
  return screen;
}

describe('editableField finds the field a name belongs to', () => {
  it('answers with the EditText when the driver nests the name inside it', async () => {
    const screen = standInScreen(formNested());
    const field = editableField(screen, 'Note');
    expect(await field.count()).toBe(1);
    expect(await field.boundingBox()).toEqual(bounds('[105,1445][975,1520]'));
  });

  it('answers with the EditText when the driver reports the name beside it, as on CI', async () => {
    const screen = standInScreen(formSiblings());
    const field = editableField(screen, 'Note');
    expect(await field.count()).toBe(1);
    expect(await field.boundingBox()).toEqual(bounds('[105,346][975,421]'));
    await field.tap();
    expect(screen.actions).toEqual([
      { action: 'tap', node: formSiblings().children[3], text: undefined },
    ]);
  });

  it('keeps reading the same field when the name moves out of it between two reads', async () => {
    const screen = standInScreen(formNested());
    const field = editableField(screen, 'Note');
    await field.tap();
    screen.tree = formSiblings();
    expect(await field.boundingBox()).toEqual(bounds('[105,346][975,421]'));
    screen.tree = formNested();
    expect(await field.boundingBox()).toEqual(bounds('[105,1445][975,1520]'));
  });

  it('types into the editable node, not the node that carries the name', async () => {
    const screen = standInScreen(formSiblings());
    await editableField(screen, 'Note').pressSequentially('abc');
    expect(screen.actions[0].node.role).toBe('textbox');
    expect(screen.actions[0].text).toBe('abc');
  });

  for (const shape of ['nested', 'siblings']) {
    it(`tells the text-field screen's two fields apart (${shape})`, async () => {
      const screen = standInScreen(
        twoFields('textbox', 'Typing field', 'Focus field', shape)
      );
      expect(await editableField(screen, 'Focus field').boundingBox()).toEqual(
        bounds('[48,700][1032,850]')
      );
      expect(await editableField(screen, 'Typing field').boundingBox()).toEqual(
        bounds('[48,400][1032,550]')
      );
    });

    it(`finds a search field the same way (${shape})`, async () => {
      const screen = standInScreen(
        twoFields(
          'searchbox',
          'Typing search field',
          'Focus search field',
          shape
        )
      );
      expect(
        await editableField(screen, 'Focus search field').boundingBox()
      ).toEqual(bounds('[48,700][1032,850]'));
    });
  }
});

describe('editableField reads few snapshots', () => {
  // `reveal` reads a box twice within two seconds to see it hold still, so a resolve
  // that read every field on a seven-field screen never settled on a device.
  const sevenFields = (shape) => {
    const tree = node('group', undefined, '[0,0][1080,2424]', []);
    for (let field = 0; field < 7; field += 1) {
      const top = 300 + field * 290;
      const box = `[73,${top}][1006,${top + 63}]`;
      const name = node('group', `Field ${String(field)}`, box);
      tree.children.push(
        node(
          'group',
          undefined,
          `[42,${top - 40}][1038,${top + 80}]`,
          shape === 'nested'
            ? [node('textbox', undefined, box, [name])]
            : [node('textbox', undefined, box), name]
        )
      );
    }
    return tree;
  };

  for (const [shape, most] of [
    ['nested', 2],
    ['siblings', 5],
  ]) {
    it(`resolves field 5 of 7 in at most ${String(most)} snapshots (${shape})`, async () => {
      const screen = standInScreen(sevenFields(shape));
      const field = editableField(screen, 'Field 5');
      expect(await field.count()).toBe(1);
      expect(screen.reads).toBeLessThanOrEqual(most);
      // A read straight after the count acts through the field it chose.
      screen.reads = 0;
      expect(await field.boundingBox()).toEqual(bounds('[73,1750][1006,1813]'));
      expect(screen.reads).toBe(1);
    });
  }
});

describe('editableField does not guess', () => {
  it('matches nothing when no editable node holds a node with the name', async () => {
    // "Notes" carries the word, but sits above the field, outside its box.
    const tree = formSiblings();
    tree.children = tree.children.filter((entry) => entry.name !== 'Note');
    const screen = standInScreen(tree);
    expect(await editableField(screen, 'Note').count()).toBe(0);
    const field = fieldLocator(
      screen.getByRole('textbox'),
      screen.getByLabel('Note'),
      screen.getByRole('group'),
      'the Note field',
      0
    );
    await expect(field.boundingBox()).rejects.toThrow(/matched no nodes/);
    expect(await field.all()).toEqual([]);
  });

  it('refuses two fields that each nest the name', async () => {
    const screen = standInScreen(
      twoFields('textbox', 'Note', 'Note', 'nested')
    );
    const field = editableField(screen, 'Note');
    expect(await field.count()).toBe(2);
    await expect(field.tap()).rejects.toThrow(/ambiguous/);
    expect(screen.actions).toEqual([]);
  });

  it('refuses two fields whose boxes each hold the name', async () => {
    const tree = formSiblings();
    tree.children.splice(
      4,
      0,
      node('searchbox', undefined, '[100,340][980,430]')
    );
    const screen = standInScreen(tree);
    const field = editableField(screen, 'Note');
    expect(await field.count()).toBe(2);
    await expect(field.boundingBox()).rejects.toThrow(/ambiguous/);
  });

  it('cannot be chained, so a caller never builds on a frozen match', () => {
    const field = editableField(standInScreen(formNested()), 'Note');
    expect(() => field.filter({})).toThrow(/not chained/);
    expect(field.then).toBeUndefined();
  });
});

describe('chooseByBox', () => {
  it('takes a box within a pixel of the field as inside it', () => {
    expect(
      chooseByBox(
        [bounds('[105.4,346.6][974.6,420.5]')],
        [bounds('[105,346][975,409]')]
      )
    ).toEqual({ kind: 'one', index: 0 });
    expect(
      chooseByBox(
        [bounds('[105,346][975,421]')],
        [bounds('[105,344][975,409]')]
      )
    ).toEqual({ kind: 'none' });
  });

  it('ignores a named node with no box', () => {
    expect(chooseByBox([bounds('[105,346][975,421]')], [null])).toEqual({
      kind: 'none',
    });
  });
});

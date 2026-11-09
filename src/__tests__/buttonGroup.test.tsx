import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, type RenderResult } from '@testing-library/react-native';

import { nitroUiHybridObjects } from '../../__mocks__/react-native-nitro-modules';
import {
  ButtonGroup,
  type ButtonGroupItem,
} from '../components/ButtonGroup/ButtonGroup';
import { resetButtonGroupWarningsForTests } from '../components/ButtonGroup/ButtonGroup';

/**
 * Wrapper-level tests for the two ButtonGroup rules a device cannot see (G20).
 *
 * The first is the sizing **key**. It is the cache key: two groups that build the
 * same string share one cached size for the life of the process
 * (`docs/architecture/sizing.md`, DECISIONS D16), and a ButtonGroup's key carries a
 * field per item because the items *are* the row. Appendix B7's red proof for this
 * line is the quiet one — drop `androidIcon` from the key and an icon that arrives
 * with a bundled asset shares one cache entry with the same row without it, so the
 * box either waits for a glyph that never comes or keeps a slot it no longer draws.
 * The second half of that proof is escaping: a title containing `|` must not be able
 * to push a field into the key that the caller never passed.
 *
 * The second rule is the *shape of the wire*: every field of every item is always
 * sent (D7 / nitro#1184), the controlled checked set names only the items whose
 * `checked` is a boolean, and `defaultCheckedIds` only the uncontrolled ones. Those
 * three arrays are what the native set handshake (`ButtonGroupCheckedSet`)
 * reconciles, and a device test can only see what they add up to.
 */
const ITEMS: ButtonGroupItem[] = [
  { id: 'copy', title: 'Copy', systemImage: 'doc.on.doc', androidIcon: 'copy' },
  { id: 'paste', title: 'Paste' },
];

beforeEach(() => {
  // `useSizingId` asks native for an instance id; the root mock keeps a registry of
  // fakes for exactly that.
  nitroUiHybridObjects.NitroUiCore = () => ({
    nextSizingId: () => 1,
  });
  resetButtonGroupWarningsForTests();
});

/** The props the wrapper gave the native view with `testID`. */
function nativeProps(
  view: RenderResult,
  testId: string
): Record<string, unknown> {
  return view.getByTestId(testId).props as unknown as Record<string, unknown>;
}

const keyOf = (view: RenderResult, testId: string): string =>
  String(nativeProps(view, testId).nuiSizingKey);

describe('ButtonGroup - sizing key', () => {
  it('is appearance|variant|size|labelStyle|count then four fields per item', async () => {
    const view = await render(<ButtonGroup items={ITEMS} testID="group" />);
    expect(keyOf(view, 'group')).toBe(
      'standard|filled|medium|automatic|2|a|Copy|doc.on.doc|copy|a|Paste||'
    );
  });

  it('names a toggle item differently from an action item', async () => {
    const view = await render(
      <ButtonGroup
        items={[{ id: 'bold', title: 'Bold', toggle: true, checked: false }]}
        testID="group"
      />
    );
    expect(keyOf(view, 'group')).toBe(
      'standard|filled|medium|automatic|1|t|Bold||'
    );
  });

  it('moves with each per-item field, and with the order of the items', async () => {
    const view = await render(
      <>
        <ButtonGroup items={ITEMS} testID="a" />
        <ButtonGroup items={[...ITEMS].reverse()} testID="b" />
      </>
    );
    const forward = keyOf(view, 'a');
    expect(keyOf(view, 'b')).not.toBe(forward);
    expect(keyOf(view, 'b')).toBe(
      'standard|filled|medium|automatic|2|a|Paste|||a|Copy|doc.on.doc|copy'
    );

    // Each field on its own, against the same two-item row.
    const mutations: [string, ButtonGroupItem[], string][] = [
      ['title', [{ ...ITEMS[0]!, title: 'Duplicate' }, ITEMS[1]!], 'Duplicate'],
      [
        'systemImage',
        [{ ...ITEMS[0]!, systemImage: 'list.bullet' }, ITEMS[1]!],
        'list.bullet',
      ],
      [
        'androidIcon',
        [{ ...ITEMS[0]!, androidIcon: 'paste' }, ITEMS[1]!],
        'paste',
      ],
    ];
    for (const [name, items, needle] of mutations) {
      const mutated = await render(
        <ButtonGroup items={items} testID={`m-${name}`} />
      );
      const key = keyOf(mutated, `m-${name}`);
      expect(key).toContain(needle);
      expect(key).not.toBe(forward);
    }
  });

  it('cannot be forged by a separator inside a free-form field', async () => {
    // Without escaping, a title of `a|b` reads as the two fields `a` and `b`, and
    // lands on the same key as a title of `a` with a `systemImage` of `b` — one
    // cache entry for two rows that draw at different widths.
    const forged = await render(
      <ButtonGroup items={[{ id: 'x', title: 'a|b' }]} testID="forged" />
    );
    const real = await render(
      <ButtonGroup
        items={[{ id: 'x', title: 'a', systemImage: 'b' }]}
        testID="real"
      />
    );
    expect(keyOf(forged, 'forged')).toBe(
      'standard|filled|medium|automatic|1|a|a\\|b||'
    );
    expect(keyOf(forged, 'forged')).not.toBe(keyOf(real, 'real'));
  });

  it('leaves the repaint-only props out of the key', async () => {
    const view = await render(
      <>
        <ButtonGroup
          items={[
            { id: 'bold', title: 'Bold', toggle: true, checked: true },
            { id: 'copy', title: 'Copy' },
          ]}
          testID="one"
        />
        <ButtonGroup
          items={[
            {
              id: 'bold',
              title: 'Bold',
              toggle: true,
              checked: false,
              disabled: true,
            },
            { id: 'copy', title: 'Copy' },
          ]}
          disabled
          tintColor="#ff0000"
          testID="two"
        />
      </>
    );
    // Same row, same height: `checked`, `disabled` and `tintColor` paint.
    expect(keyOf(view, 'two')).toBe(keyOf(view, 'one'));
  });

  it('is the appearance, variant, size and labelStyle the caller asked for', async () => {
    const view = await render(
      <ButtonGroup
        items={[{ id: 'copy', title: 'Copy' }]}
        appearance="connected"
        variant="outlined"
        size="xlarge"
        labelStyle="iconOnly"
        testID="group"
      />
    );
    expect(keyOf(view, 'group')).toBe(
      'connected|outlined|xlarge|iconOnly|1|a|Copy||'
    );
  });
});

describe('ButtonGroup - the wire', () => {
  it('sends every field of every item, always', async () => {
    const view = await render(
      <ButtonGroup items={[{ id: 'copy', title: 'Copy' }]} testID="group" />
    );
    expect(nativeProps(view, 'group').items).toEqual([
      {
        id: 'copy',
        title: 'Copy',
        systemImage: null,
        androidIcon: null,
        disabled: false,
        toggle: false,
      },
    ]);
    // A missing prop would leave a recycled view showing the previous mount's row.
    expect(nativeProps(view, 'group').checkedIds).toEqual([]);
    expect(nativeProps(view, 'group').controlledIds).toEqual([]);
    expect(nativeProps(view, 'group').defaultCheckedIds).toEqual([]);
    expect(nativeProps(view, 'group').mostRecentEventCount).toBe(0);
  });

  it('names only the boolean-checked items as controlled', async () => {
    const view = await render(
      <ButtonGroup
        items={[
          { id: 'bold', title: 'Bold', toggle: true, checked: true },
          { id: 'italic', title: 'Italic', toggle: true, checked: false },
          {
            id: 'underline',
            title: 'Underline',
            toggle: true,
            defaultChecked: true,
          },
          { id: 'copy', title: 'Copy' },
        ]}
        testID="group"
      />
    );
    const props = nativeProps(view, 'group');
    // `underline` is uncontrolled: native keeps its state and no JS write may move
    // it, which is the reason `controlledIds` is sent at all.
    expect(props.checkedIds).toEqual(['bold']);
    expect(props.controlledIds).toEqual(['bold', 'italic']);
    expect(props.defaultCheckedIds).toEqual(['underline']);
  });

  it('says uncontrolled with an empty controlledIds, not with a missing prop', async () => {
    // The wire prop cannot be absent (D7 / nitro#1184), so "uncontrolled" is said by
    // `controlledIds` being empty rather than by a missing `checkedIds`: with no id a
    // write may move, native's own set is the only word on the row.
    const view = await render(
      <ButtonGroup
        items={[
          { id: 'bold', title: 'Bold', toggle: true, defaultChecked: true },
        ]}
        testID="group"
      />
    );
    expect(nativeProps(view, 'group').controlledIds).toEqual([]);
    expect(nativeProps(view, 'group').defaultCheckedIds).toEqual(['bold']);
    expect(nativeProps(view, 'group').mostRecentEventCount).toBe(0);
  });

  it('stretches, because overflow is decided at the box’s width', async () => {
    const view = await render(
      <ButtonGroup items={ITEMS} style={{ margin: 4 }} testID="group" />
    );
    const style = nativeProps(view, 'group').style as Record<string, unknown>[];
    expect(style[0]).toEqual({ alignSelf: 'stretch' });
    expect(style[1]).toEqual({ margin: 4 });
  });

  it('warns once about a duplicate id, and again after a reset', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const items: ButtonGroupItem[] = [
      { id: 'x', title: 'One' },
      { id: 'x', title: 'Two' },
    ];
    const first = await render(<ButtonGroup items={items} testID="group" />);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('duplicate');
    warn.mockClear();
    // A second mount of the same bug is silent: the guard is per process, like
    // `warnAndroidIconName`'s, because a per-render warning on a list screen is a
    // warning nobody reads. `resetButtonGroupWarningsForTests` is how a test that
    // needs to see it again gets to see it.
    await render(<ButtonGroup items={items} testID="group" />);
    expect(warn).not.toHaveBeenCalled();
    resetButtonGroupWarningsForTests();
    await render(<ButtonGroup items={items} testID="again" />);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(first.toJSON()).toBeTruthy();
  });
});

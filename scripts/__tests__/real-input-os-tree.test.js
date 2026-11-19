import { describe, expect, it } from 'vitest';

import { asTreeNode } from '../../example/e2e/real-input/os-tree';

const RECT = { x: 10, y: 20, width: 300, height: 120 };

describe("the driver's node, as the e2e readers see it", () => {
  it('takes scrollable from the flag when the driver prints one, whatever the class', () => {
    expect(
      asTreeNode({
        index: 0,
        type: 'android.widget.ScrollView',
        scrollable: false,
        rect: RECT,
      }).scrollable
    ).toBe('false');
    expect(
      asTreeNode({
        index: 1,
        type: 'android.view.ViewGroup',
        scrollable: true,
        rect: RECT,
      }).scrollable
    ).toBe('true');
  });

  it('falls back to the class only when the driver leaves the flag off', () => {
    expect(
      asTreeNode({ index: 0, type: 'android.widget.ScrollView', rect: RECT })
        .scrollable
    ).toBe('true');
    expect(
      asTreeNode({ index: 1, type: 'android.view.ViewGroup', rect: RECT })
        .scrollable
    ).toBe('false');
  });

  it('keeps the action flags as printed, and empty where the driver printed none', () => {
    const printed = asTreeNode({
      index: 0,
      type: 'android.view.ViewGroup',
      clickable: false,
      focusable: true,
      longClickable: true,
      rect: RECT,
    });
    expect({
      clickable: printed.clickable,
      focusable: printed.focusable,
      longClickable: printed.longClickable,
    }).toEqual({ clickable: 'false', focusable: 'true', longClickable: 'true' });
    const bare = asTreeNode({
      index: 1,
      type: 'android.view.ViewGroup',
      rect: RECT,
    });
    expect({
      clickable: bare.clickable,
      focusable: bare.focusable,
      longClickable: bare.longClickable,
    }).toEqual({ clickable: '', focusable: '', longClickable: '' });
  });

  it("keeps a Spinner's own name apart from the choice it shows", () => {
    const spinner = asTreeNode({
      index: 0,
      type: 'android.widget.Spinner',
      label: 'Mica',
      contentDescription: 'Real-input enabled picker',
      rect: RECT,
    });
    expect({ text: spinner.text, contentDesc: spinner.contentDesc }).toEqual({
      text: 'Mica',
      contentDesc: 'Real-input enabled picker',
    });
  });

  it('reads a node with only a label as named by it', () => {
    const button = asTreeNode({
      index: 0,
      type: 'android.widget.Button',
      label: 'Save',
      rect: RECT,
    });
    expect({ text: button.text, contentDesc: button.contentDesc }).toEqual({
      text: '',
      contentDesc: 'Save',
    });
  });
});

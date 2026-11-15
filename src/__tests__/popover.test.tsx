import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { act, render, type RenderResult } from '@testing-library/react-native';
import { useState, type ReactElement } from 'react';
import { Dimensions, Text } from 'react-native';

import { Popover } from '../components/Popover/Popover';

// The tree is read as JSON rather than by testID: the node and its content box
// are both under test, and only one of them carries an id.

const WINDOW_WIDTH = Dimensions.get('window').width;

/** The width the wrapper caps the content at: `maxWidth`, and never more than the window less its margins. */
const capOf = (maxWidth?: number) =>
  Math.max(0, Math.min(maxWidth ?? 320, WINDOW_WIDTH - 32));

/** A node of `toJSON()`'s tree. */
type Json = {
  type: string;
  props: Record<string, unknown>;
  children?: unknown;
};

function walk(node: unknown, visit: (json: Json) => void): void {
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, visit));
    return;
  }
  if (node == null || typeof node !== 'object') {
    return;
  }
  const json = node as Json;
  if (typeof json.type === 'string') {
    visit(json);
    walk(json.children, visit);
  }
}

/** The popover's native node: exactly one per render. */
function nodeOf(view: RenderResult): Json {
  const found: Json[] = [];
  walk(view.toJSON(), (json) => {
    if (json.type === 'NitroUiPopover') found.push(json);
  });
  expect(found).toHaveLength(1);
  return found[0]!;
}

/** The content box: the node's one element child, which native measures the popover from. */
function boxOf(view: RenderResult): Json | null {
  const direct = nodeOf(view).children;
  const list = Array.isArray(direct) ? direct : [direct];
  const elements = list.filter(
    (child) =>
      child != null &&
      typeof child === 'object' &&
      typeof (child as Json).type === 'string'
  ) as Json[];
  expect(elements.length).toBeLessThanOrEqual(1);
  return elements[0] ?? null;
}

function flatStyle(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...(Array.isArray(style) ? style : [style]));
}

type NativeProps = {
  presented: boolean;
  mostRecentEventCount: number;
  maxWidth: number;
  testID: string | null;
  nuiPerfId: number | null;
  pointerEvents: string;
  style: unknown;
  onPresentedChange: { f: (presented: boolean, eventCount: number) => void };
  onDismissed: { f: (ended: boolean) => void };
};

let warn: jest.SpiedFunction<typeof console.warn>;

beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

function refusalWarnings(): number {
  return warn.mock.calls.filter((call) => /Popover/.test(String(call[0])))
    .length;
}

describe('Popover · the box native measures', () => {
  it('lays the content out inside the cap, not as the cap', async () => {
    const view = await render(
      <Popover isPresented testID="pop" anchor={<Text>a</Text>}>
        <Text>content</Text>
      </Popover>
    );
    const node = nodeOf(view).props as unknown as NativeProps;
    const style = flatStyle(node.style);
    expect(style.position).toBe('absolute');
    // Without this the content box is stretched to the cap and every popover draws wide.
    expect(style.alignItems).toBe('flex-start');
    // The node's box overlaps the app's own views, so it must never take a touch
    // meant for them.
    expect(node.pointerEvents).toBe('box-none');
    // The content box is the node's one child, capped at the same width.
    expect(flatStyle(boxOf(view)?.props.style).maxWidth).toBe(capOf(undefined));
  });

  it('caps the content at the smaller of maxWidth and the window less its margins', async () => {
    const roomy = await render(
      <Popover isPresented maxWidth={280} testID="pop" anchor={<Text>a</Text>}>
        <Text>content</Text>
      </Popover>
    );
    expect((nodeOf(roomy).props as unknown as NativeProps).maxWidth).toBe(280);

    // Wider than the window: the window wins, for the node's own box too.
    const wider = await render(
      <Popover
        isPresented
        maxWidth={WINDOW_WIDTH + 500}
        testID="pop"
        anchor={<Text>a</Text>}
      >
        <Text>content</Text>
      </Popover>
    );
    expect((nodeOf(wider).props as unknown as NativeProps).maxWidth).toBe(
      WINDOW_WIDTH - 32
    );
    expect(flatStyle(nodeOf(wider).props.style).width).toBe(WINDOW_WIDTH - 32);

    const byDefault = await render(
      <Popover isPresented testID="pop" anchor={<Text>a</Text>}>
        <Text>content</Text>
      </Popover>
    );
    expect((nodeOf(byDefault).props as unknown as NativeProps).maxWidth).toBe(
      capOf(undefined)
    );
  });

  it('mounts the content on the render that asks for presentation', async () => {
    const view = await render(
      <Popover isPresented testID="pop" anchor={<Text>a</Text>}>
        <Text>content</Text>
      </Popover>
    );
    // No native event has been answered, and the box is already there to be measured.
    expect((nodeOf(view).props as unknown as NativeProps).presented).toBe(true);
    expect(boxOf(view)).not.toBeNull();
  });

  it('keeps the content mounted until native says the popover has gone', async () => {
    const view = await render(
      <Popover isPresented testID="pop" anchor={<Text>a</Text>}>
        <Text>content</Text>
      </Popover>
    );
    // The app withdraws it: the popover is still animating out, so the content stays.
    await act(async () => {
      view.rerender(
        <Popover isPresented={false} testID="pop" anchor={<Text>a</Text>}>
          <Text>content</Text>
        </Popover>
      );
    });
    expect((nodeOf(view).props as unknown as NativeProps).presented).toBe(
      false
    );
    expect(boxOf(view)).not.toBeNull();
    // Native says it is gone, and the content goes with it.
    await act(async () => {
      (nodeOf(view).props as unknown as NativeProps).onDismissed.f(true);
    });
    expect(boxOf(view)).toBeNull();
  });
});

describe('Popover · the props Nitro receives', () => {
  it('sends every prop always, with null for the ones that are not set', async () => {
    const view = await render(
      <Popover isPresented={false} testID="pop" anchor={<Text>a</Text>}>
        <Text>content</Text>
      </Popover>
    );
    const props = nodeOf(view).props as unknown as NativeProps;
    expect(
      Object.keys(props)
        .filter((key) => key !== 'children')
        .sort()
    ).toEqual([
      'hybridRef',
      'maxWidth',
      'mostRecentEventCount',
      'nuiPerfId',
      'onDismissed',
      'onPresentedChange',
      'pointerEvents',
      'presented',
      'style',
      'testID',
    ]);
    expect(props.testID).toBe('pop');
    expect(props.nuiPerfId).toBeNull();
    expect(props.presented).toBe(false);
    expect(props.mostRecentEventCount).toBe(0);
  });

  it('sends a null testID rather than no testID', async () => {
    const view = await render(
      <Popover isPresented={false} anchor={<Text>a</Text>}>
        <Text>content</Text>
      </Popover>
    );
    // An absent prop is one native never hears about, so "not set" has to be a value.
    expect(nodeOf(view).props.testID).toBeNull();
  });
});

/** The parent's setter, so a test can play the app. */
let setOpen: (next: boolean) => void = () => {};

function Parent({ refuse }: { refuse: boolean }) {
  const [open, setter] = useState(false);
  setOpen = setter;
  return (
    <Popover
      testID="pop"
      isPresented={open}
      onIsPresentedChange={(next) => {
        if (!refuse) setter(next);
      }}
      anchor={<Text>a</Text>}
    >
      <Text>content</Text>
    </Popover>
  );
}

/** Play native: the user closed the popover, and this is native event `count`. */
function nativeDismissal(view: RenderResult, count: number): void {
  (nodeOf(view).props as unknown as NativeProps).onPresentedChange.f(
    false,
    count
  );
}

describe('Popover · the handshake (D33)', () => {
  it('echoes the event count it was given, so native knows JS caught up', async () => {
    const view = await render(<Parent refuse={false} />);
    await act(async () => setOpen(true));
    expect((nodeOf(view).props as unknown as NativeProps).presented).toBe(true);
    await act(async () => nativeDismissal(view, 4));
    const props = nodeOf(view).props as unknown as NativeProps;
    expect(props.mostRecentEventCount).toBe(4);
    expect(props.presented).toBe(false);
  });

  it('warns once when the parent keeps `isPresented` true after a close', async () => {
    const view = await render(<Parent refuse />);
    await act(async () => setOpen(true));
    await act(async () => nativeDismissal(view, 1));
    expect(refusalWarnings()).toBe(1);
    // The popover goes back up: `presented` is what the app asked for.
    expect((nodeOf(view).props as unknown as NativeProps).presented).toBe(true);
    await act(async () => nativeDismissal(view, 2));
    expect(refusalWarnings()).toBe(1);
  });

  it('stays quiet when the parent follows the close and opens it again later', async () => {
    const view = await render(<Parent refuse={false} />);
    await act(async () => setOpen(true));
    await act(async () => nativeDismissal(view, 1));
    await act(async () => setOpen(true));
    expect((nodeOf(view).props as unknown as NativeProps).presented).toBe(true);
    expect(refusalWarnings()).toBe(0);
  });
});

describe('Popover · onDismiss and the content', () => {
  it('reports a dismissal only when a presentation really ended', async () => {
    const dismissed = jest.fn();
    const shown = (presented: boolean): ReactElement => (
      <Popover
        isPresented={presented}
        onDismiss={dismissed}
        testID="pop"
        anchor={<Text>a</Text>}
      >
        <Text>content</Text>
      </Popover>
    );
    const view = await render(shown(false));
    // React withdrew a popover that was never up: the content goes, the app hears nothing.
    await act(async () => {
      (nodeOf(view).props as unknown as NativeProps).onDismissed.f(false);
    });
    expect(dismissed).not.toHaveBeenCalled();
    expect(boxOf(view)).toBeNull();

    await act(async () => {
      view.rerender(shown(true));
    });
    expect(boxOf(view)).not.toBeNull();
    // The app withdraws it. The content waits for native, so the popover can animate out.
    await act(async () => {
      view.rerender(shown(false));
    });
    expect(boxOf(view)).not.toBeNull();
    await act(async () => {
      (nodeOf(view).props as unknown as NativeProps).onDismissed.f(true);
    });
    expect(dismissed).toHaveBeenCalledTimes(1);
    expect(boxOf(view)).toBeNull();
  });
});

import { useCallback, useState } from 'react';
import {
  Modal,
  Platform,
  processColor,
  Text,
  TurboModuleRegistry,
  View,
} from 'react-native';
import {
  afterEach,
  beforeAll,
  cleanup,
  describe,
  expect,
  it,
  render,
  waitFor,
} from 'react-native-harness';
import { screen, userEvent } from '@react-native-harness/ui';
import { Switch, nitroUiCore } from 'react-native-nitro-ui';
import { waitForHandle } from './handles';

/**
 * The harness's own helpers do not return an element's frame, so the bounds
 * Fabric laid out are read from the native module behind them.
 */
type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

/**
 * What `hybridRef` hands back. Read-only: a prop written through it would
 * bypass React and never commit.
 */
type SwitchHandle = {
  readonly value: boolean | null;
  readonly mostRecentEventCount: number;
  readonly disabled: boolean;
  readonly tintColor: number | null;
  readonly accessibilityLabel: string | null;
  measureContent(): { width: number; height: number };
};

let hybrid: SwitchHandle | null = null;
const captureHybrid = (view: SwitchHandle) => {
  hybrid = view;
};

/**
 * The `hybridRef` callback lands on a commit after the view is created, so a
 * testID being found does not mean `hybrid` is set yet.
 */
async function hybridWhenReady(): Promise<SwitchHandle> {
  return waitForHandle(() => hybrid, { what: 'the Switch under test' });
}

const osVersion = (
  Platform.constants as { readonly osVersion?: string } | undefined
)?.osVersion;
// `Platform.Version` is a string on iOS, so the major has to be parsed.
const iosMajor = Number.parseInt(osVersion ?? String(Platform.Version), 10);
/**
 * The box a Switch with no `style` should get. Spelled out rather than imported
 * from the component, because reading its constant back would assert nothing.
 * The Android 52x48 dp is the Material 3 track inside its 48 dp touch target.
 */
const expectedBox = Platform.select({
  android: { width: 52, height: 48 },
  default:
    Number.isFinite(iosMajor) && iosMajor >= 26
      ? { width: 61, height: 28 }
      : { width: 51, height: 31 },
});

const pressNearEnd = async (box: ViewInfo, end: 'start' | 'end') => {
  await userEvent.pressAt(
    end === 'start' ? box.x + 2 : box.x + box.width - 2,
    box.y + box.height / 2
  );
};

/**
 * `screen.findByTestId` throws on the first miss and takes no timeout, and a
 * hosted control is only queryable once it has mounted and committed, so this
 * polls the non-throwing query first.
 */
async function waitForTestId(testId: string, timeoutMs = 10000) {
  const deadline = nitroUiCore.now() + timeoutMs;
  for (;;) {
    if (harnessUi.queryByTestId(testId) != null) {
      return screen.findByTestId(testId);
    }
    if (nitroUiCore.now() > deadline) {
      throw new Error(
        `No element with testID "${testId}" within ${timeoutMs}ms.`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

afterEach(() => {
  cleanup();
  hybrid = null;
});

describe('Switch · core runtime', () => {
  beforeAll(async () => {
    // The first render in the app process pays one-time costs (Nitro's hybrid
    // registry, the first composition or hosting controller) that can exceed
    // the 1000ms the harness waits for a mount on a cold Android emulator.
    console.log('[dbg] warm-up: render begin');
    const { unmount } = await render(<Switch defaultValue testID="warm-up" />, {
      timeout: 15000,
    });
    console.log('[dbg] warm-up: done');
    unmount();
  });

  it('hosts, measures and takes props inside a Modal', async () => {
    let value = false;
    const seen: boolean[] = [];
    const holder: { current: SwitchHandle | null } = { current: null };
    const { rerender } = await render(
      <Modal visible animationType="none">
        <View
          style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}
        >
          <Switch
            value={value}
            onValueChange={(next) => {
              seen.push(next);
              value = next;
            }}
            testID="in-modal"
            hybridRef={(view) => {
              holder.current = view;
            }}
          />
        </View>
      </Modal>
    );

    const measured = await pollUntil(
      () => {
        const size = holder.current?.measureContent() ?? null;
        return size !== null && size.width > 0 && size.height > 0 ? size : null;
      },
      () =>
        new Error(
          `Modal host never measured (last=${String(
            JSON.stringify(holder.current?.measureContent() ?? null)
          )}).`
        )
    );
    expect(Math.abs(measured.width - expectedBox!.width)).toBeLessThan(1.5);
    expect(Math.abs(measured.height - expectedBox!.height)).toBeLessThan(1.5);

    // No press here: RN's `Modal` is a second window, and the harness cannot
    // deliver a tap into it on either platform. A `value` write from JS being
    // applied inside the dialog stands in for it.
    value = true;
    await rerender(
      <Modal visible animationType="none">
        <View
          style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}
        >
          <Switch
            value
            onValueChange={(next) => {
              seen.push(next);
              value = next;
            }}
            testID="in-modal"
            hybridRef={(view) => {
              holder.current = view;
            }}
          />
        </View>
      </Modal>
    );
    await waitFor(() => expect(holder.current!.value).toBe(true));
  });

  /**
   * A hosted control inside a `Modal` has no testID the harness can reach, so
   * this polls whatever the caller can observe instead.
   */
  async function pollUntil<T>(read: () => T | null, onError: () => Error) {
    const deadline = nitroUiCore.now() + 10000;
    for (;;) {
      const value = read();
      if (value !== null) return value;
      if (nitroUiCore.now() > deadline) throw onError();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  it('keeps the control inside its default box and answers taps at both ends', async () => {
    await render(
      <Switch defaultValue={false} testID="box" hybridRef={captureHybrid} />
    );
    await waitForTestId('box');
    const box = harnessUi.queryByTestId('box');
    const content = (await hybridWhenReady()).measureContent() ?? null;
    console.log(
      `Switch box: fabric=${box?.width}x${box?.height} at ${box?.x},${box?.y} hosted=${content?.width}x${content?.height} expected=${expectedBox?.width}x${expectedBox?.height}`
    );

    expect(box).not.toBeNull();
    expect(content).not.toBeNull();
    // Yoga rounds to hundredths; anything past that is the control overflowing.
    expect(Math.abs(box!.width - expectedBox!.width)).toBeLessThan(0.6);
    expect(Math.abs(box!.height - expectedBox!.height)).toBeLessThan(0.6);
    expect(content!.width).toBeLessThanOrEqual(box!.width + 0.6);
    expect(content!.height).toBeLessThanOrEqual(box!.height + 0.6);

    const seen: boolean[] = [];
    await render(
      <Switch
        defaultValue={false}
        onValueChange={(next) => seen.push(next)}
        testID="ends"
      />
    );
    await waitForTestId('ends');
    const ends = harnessUi.queryByTestId('ends');
    expect(ends).not.toBeNull();
    await pressNearEnd(ends!, 'start');
    await waitFor(() => expect(seen).toEqual([true]));
    await pressNearEnd(ends!, 'end');
    await waitFor(() => expect(seen).toEqual([true, false]));
  });

  it('keeps up with taps faster than React can round trip', async () => {
    // Controlled, because that is the mode where JS writes each value back to
    // native.
    const seen: boolean[] = [];
    function Rapid() {
      const [on, setOn] = useState(false);
      const onChange = useCallback((next: boolean) => {
        seen.push(next);
        setOn(next);
      }, []);
      return (
        <Switch
          value={on}
          onValueChange={onChange}
          testID="rapid"
          hybridRef={captureHybrid}
        />
      );
    }
    await render(<Rapid />);
    const element = await waitForTestId('rapid');
    await userEvent.press(element);
    await userEvent.press(element);
    await userEvent.press(element);
    await waitFor(() => expect(seen).toEqual([true, false, true]));
    await waitFor(() => expect(hybrid?.mostRecentEventCount).toBe(3));
    // The control is where the last tap put it, so the next tap reports false.
    await userEvent.press(element);
    await waitFor(() => expect(seen).toEqual([true, false, true, false]));
  });

  it('keeps the tint and the disabled flag when its props change', async () => {
    const tint = processColor('#7C4DFF') as number;
    const seen: boolean[] = [];
    const { rerender } = await render(
      <Switch
        defaultValue
        disabled
        tintColor="#7C4DFF"
        onValueChange={(next) => seen.push(next)}
        testID="repaint"
        hybridRef={captureHybrid}
      />
    );
    const element = await waitForTestId('repaint');
    await userEvent.press(element);
    expect(seen).toEqual([]);
    expect(hybrid?.tintColor).toBe(tint);

    await rerender(
      <Switch
        defaultValue
        onValueChange={(next) => seen.push(next)}
        testID="repaint"
        hybridRef={captureHybrid}
      />
    );
    expect(hybrid?.tintColor).toBeNull();
    await userEvent.press(element);
    await waitFor(() => expect(seen).toEqual([false]));
  });

  it('reports the size of what it hosts', async () => {
    await render(
      <Switch defaultValue testID="sized" hybridRef={captureHybrid} />
    );
    await waitForTestId('sized');
    const content = (await hybridWhenReady()).measureContent() ?? null;
    const box = harnessUi.queryByTestId('sized');
    console.log(
      `Switch size: measureContent=${content?.width}x${content?.height} box=${box?.width}x${box?.height}`
    );

    expect(content).not.toBeNull();
    expect(content!.width).toBeGreaterThan(20);
    expect(content!.height).toBeGreaterThan(10);
    expect(box!.width).toBeGreaterThan(20);
    expect(box!.height).toBeGreaterThan(10);
  });

  it('reports the control size and not the box when the box is bigger', async () => {
    // At the default box the control's own size and Yoga's box are equal, so an
    // implementation that echoes the box would pass; a bigger box tells them
    // apart.
    await render(
      <Switch
        defaultValue
        style={{ width: 90, height: 50 }}
        testID="roomy"
        hybridRef={captureHybrid}
      />
    );
    await waitForTestId('roomy');
    const content = (await hybridWhenReady()).measureContent() ?? null;
    const box = harnessUi.queryByTestId('roomy');
    console.log(
      `Switch in a roomy box: measureContent=${content?.width}x${content?.height} box=${box?.width}x${box?.height}`
    );

    expect(content).not.toBeNull();
    expect(box).not.toBeNull();
    expect(Math.abs(box!.width - 90)).toBeLessThan(0.6);
    expect(Math.abs(box!.height - 50)).toBeLessThan(0.6);
    expect(content!.width).toBeLessThan(box!.width - 20);
    expect(content!.height).toBeLessThan(box!.height);
    expect(Math.abs(content!.width - expectedBox!.width)).toBeLessThan(1.5);
    expect(Math.abs(content!.height - expectedBox!.height)).toBeLessThan(1.5);
  });

  it('round-trips an opaque tintColor', async () => {
    // A fully opaque colour is above `Int32.max`: iOS `processColor` returns it
    // unsigned and Android's returns it signed, so the getter has to hand back
    // what the platform's own `processColor` produced.
    const tint = processColor('#7C4DFF') as number;
    await render(
      <Switch
        defaultValue
        tintColor="#7C4DFF"
        testID="tinted-prop"
        hybridRef={captureHybrid}
      />
    );
    await waitForTestId('tinted-prop');
    expect(hybrid?.tintColor).toBe(tint);
  });

  it('follows a controlled value in both directions', async () => {
    const seen: boolean[] = [];
    function Controlled() {
      const [on, setOn] = useState(false);
      const onChange = useCallback((next: boolean) => {
        seen.push(next);
        setOn(next);
      }, []);
      return (
        <View>
          <Switch value={on} onValueChange={onChange} testID="controlled" />
          <Text testID="controlled-value">{on ? 'on' : 'off'}</Text>
        </View>
      );
    }
    await render(<Controlled />);
    const element = await waitForTestId('controlled');

    await userEvent.press(element);
    await waitFor(() => expect(seen).toEqual([true]));
    await userEvent.press(element);
    await waitFor(() => expect(seen).toEqual([true, false]));
  });

  it('reverts a change JS rejected', async () => {
    // The handler never updates state, so `value` stays false.
    const seen: boolean[] = [];
    await render(
      <Switch
        value={false}
        onValueChange={(next) => seen.push(next)}
        testID="rejected"
        hybridRef={captureHybrid}
      />
    );
    const element = await waitForTestId('rejected');

    await userEvent.press(element);
    await waitFor(() => expect(seen.length).toBe(1));
    expect(seen[0]).toBe(true);

    // Native must have shown `false` again in between, so this tap starts from
    // off and reports on once more.
    await userEvent.press(element);
    await waitFor(() => expect(seen.length).toBe(2));
    expect(seen[1]).toBe(true);

    expect(hybrid?.mostRecentEventCount).toBeGreaterThanOrEqual(2);
  });

  it('applies a value written from JS', async () => {
    const seen: boolean[] = [];
    const { rerender } = await render(
      <Switch
        value={false}
        onValueChange={(next) => seen.push(next)}
        testID="from-js"
      />
    );
    await rerender(
      <Switch
        value
        onValueChange={(next) => seen.push(next)}
        testID="from-js"
      />
    );
    const element = await waitForTestId('from-js');

    // The tap reports the value the control displayed *before* the tap, so
    // `false` here means the prop write reached SwiftUI/Compose.
    await userEvent.press(element);
    await waitFor(() => expect(seen.length).toBe(1));
    expect(seen[0]).toBe(false);
  });

  it('keeps its own state when uncontrolled', async () => {
    const seen: boolean[] = [];
    await render(
      <Switch
        defaultValue
        onValueChange={(next) => seen.push(next)}
        testID="free"
      />
    );
    const element = await waitForTestId('free');

    await userEvent.press(element);
    await waitFor(() => expect(seen).toEqual([false]));
    await userEvent.press(element);
    await waitFor(() => expect(seen).toEqual([false, true]));
  });

  it('ignores presses when disabled', async () => {
    const seen: boolean[] = [];
    const barrier: boolean[] = [];
    await render(
      <View>
        <Switch
          disabled
          value
          onValueChange={(next) => seen.push(next)}
          testID="off-limits"
          hybridRef={captureHybrid}
        />
        {/* A control that may answer: once its event has arrived the pipeline
            has flushed, so none is still on its way for the disabled Switch. */}
        <Switch
          defaultValue={false}
          onValueChange={(next) => barrier.push(next)}
          testID="barrier"
        />
      </View>
    );
    const element = await waitForTestId('off-limits');
    const barrierElement = await waitForTestId('barrier');

    await userEvent.press(element);
    await userEvent.press(element);
    await userEvent.press(barrierElement);
    await waitFor(() => expect(barrier).toEqual([true]));

    expect(seen).toEqual([]);
    expect(hybrid?.mostRecentEventCount).toBe(0);
  });

  it('survives mounting and unmounting repeatedly', async () => {
    for (let cycle = 0; cycle < 20; cycle += 1) {
      const { unmount } = await render(
        <Switch defaultValue testID={`cycle-${cycle}`} />
      );
      unmount();
    }

    const seen: boolean[] = [];
    await render(
      <Switch onValueChange={(next) => seen.push(next)} testID="after-cycles" />
    );
    await userEvent.press(await waitForTestId('after-cycles'));
    await waitFor(() => expect(seen).toEqual([true]));
  });

  it('marks props applied and first frame for one instance', async () => {
    nitroUiCore.setPerfEnabled(true);
    try {
      nitroUiCore.drainPerf();
      const { unmount } = await render(
        <Switch
          defaultValue
          testID="marked"
          nuiPerfId={7}
          hybridRef={captureHybrid}
        />
      );
      await waitForTestId('marked');
      // `drainPerf()` consumes the buffer and the marks land on the UI thread,
      // so every poll has to keep what it read.
      const kinds: string[] = [];
      await waitFor(
        () => {
          for (const event of nitroUiCore.drainPerf()) {
            if (event.instanceId === 7) {
              kinds.push(event.kind);
            }
          }
          expect(kinds).toEqual(
            expect.arrayContaining(['propsApplied', 'firstFrame'])
          );
        },
        { timeout: 3000 }
      );
      unmount();
      // A mark for the dropped instance could still be in flight, so mount a
      // second instance and wait for its marks before asserting the first is
      // silent.
      nitroUiCore.drainPerf();
      const { unmount: unmountAfterDrop } = await render(
        <Switch defaultValue testID="marked-again" nuiPerfId={8} />
      );
      await waitForTestId('marked-again');
      const afterDrop: number[] = [];
      await waitFor(
        () => {
          for (const event of nitroUiCore.drainPerf()) {
            if (event.kind === 'propsApplied') {
              afterDrop.push(event.instanceId);
            }
          }
          expect(afterDrop).toEqual(expect.arrayContaining([8]));
        },
        { timeout: 3000 }
      );
      expect(afterDrop).not.toContain(7);
      unmountAfterDrop();
    } finally {
      nitroUiCore.setPerfEnabled(false);
      nitroUiCore.drainPerf();
    }
  });
});

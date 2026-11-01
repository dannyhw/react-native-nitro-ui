/**
 * On-device tests for the core runtime and the Switch (task T10).
 *
 * These run inside the app, so they exercise what no JS test can: SwiftUI
 * `Toggle` and Compose `Switch` really hosted, the event-count handshake really
 * applied, and the recycled/dropped view really reused.
 *
 * The revert case has no accessibility-state query to read, so it uses a
 * tap-twice oracle: after a change JS rejected, the *second* tap must report
 * `true` again. If the native revert had not happened, the Switch would still
 * display `true` and the second tap would report `false`.
 */
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
import { expectTimingBudget } from './timingGate';

/**
 * Bounds of a rendered view, read straight from the harness native module.
 *
 * `screen.findByTestId` keeps only a native id, and `screen.screenshot(element)`
 * reports `0x0` for any element target (the module does not return the captured
 * size), so the only way to measure what Fabric actually laid out is the raw
 * `queryByTestId` behind those helpers.
 */
type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

/**
 * What `hybridRef` hands back.
 *
 * Declared here rather than imported: DECISIONS D14 keeps Hybrid View types off
 * the public surface in v0.1, and the only reason to read one is diagnostics -
 * exactly what this file does. Read-only by design; writing a prop through it
 * would bypass React and never commit.
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
 * `hybrid`, once the ref callback has actually run.
 *
 * The two box tests read `hybrid?.measureContent()` one statement after a
 * `waitForTestId`, and that poll answers for the *box*: a `hybridRef` callback
 * lands on a commit after the view is created. On CI's 3-core runner the gap was
 * wide enough to matter — `keeps the control inside its default box` failed
 * `expected null not to be null` while its own log line printed
 * `fabric=61x28` (run 41230848294), i.e. the layout was right and only the
 * handle was missing. The `?.`/`?? null` made a late callback look like a
 * control that reports no content, which is the one thing that test exists to
 * detect; waiting for the handle keeps that assertion meaning what it says.
 */
async function hybridWhenReady(): Promise<SwitchHandle> {
  return waitForHandle(() => hybrid, { what: 'the Switch under test' });
}

/**
 * The box a Switch with no `style` is supposed to get, spelled out here rather
 * than imported from `src/components/Switch/Switch.tsx`: the point of the test is
 * that the shipped default is the size the control actually is, so reading the
 * constant back would assert nothing. Measured numbers, per platform:
 * - iOS 26+: SwiftUI `Toggle(.switch)` lays out at 61x28 pt. Before 26 the
 *   control is the old 51x31 (DECISIONS D14).
 * - Android: a Material 3 `Switch` is a 52x48 dp track inside the 48 dp minimum
 *   interactive size.
 */
const osVersion = (
  Platform.constants as { readonly osVersion?: string } | undefined
)?.osVersion;
const iosMajor = Number.parseInt(osVersion ?? String(Platform.Version), 10);
const expectedBox = Platform.select({
  android: { width: 52, height: 48 },
  // `Platform.Version` is a string on iOS, so the major has to be parsed -
  // comparing it numerically silently fails and the test then expects the
  // pre-26 box on a 26+ device.
  default:
    Number.isFinite(iosMajor) && iosMajor >= 26
      ? { width: 61, height: 28 }
      : { width: 51, height: 31 },
});

/** A press near one end of the box, at the control's vertical centre. */
const pressNearEnd = async (box: ViewInfo, end: 'start' | 'end') => {
  await userEvent.pressAt(
    end === 'start' ? box.x + 2 : box.x + box.width - 2,
    box.y + box.height / 2
  );
};

/**
 * Wait for a testID to exist, and return it.
 *
 * `screen.findByTestId` throws on the first pass that finds nothing: it has no
 * timeout argument. A hosted control only becomes queryable after it has
 * mounted, laid out and committed, which on a loaded machine can take longer
 * than that single pass, so the suite polls the non-throwing query first and
 * only then asks the harness for the reference.
 */
async function waitForTestId(testId: string, timeoutMs = 10000) {
  const deadline = nitroUiCore.now() + timeoutMs;
  for (;;) {
    if (harnessUi.queryByTestId(testId) != null) {
      // Hand back the harness' own reference: the press/screenshot helpers
      // expect that shape, and it is the same lookup the poll just made.
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
    // The first render of the app process pays one-time costs: Nitro's first
    // call into the hybrid registry, and the first Compose composition /
    // UIHostingController commit. On a cold Android emulator that is more than
    // the 1000ms the harness waits for a mount, so pay it here - every test
    // below then measures a steady-state mount, which is what it asserts on.
    console.log('[dbg] warm-up: render begin');
    const { unmount } = await render(<Switch defaultValue testID="warm-up" />, {
      timeout: 15000,
    });
    console.log('[dbg] warm-up: done');
    unmount();
  });

  it('hosts, measures and takes props inside a Modal', async () => {
    // R6, closed. RN 0.88's `Modal` is a second window with its own surface, and it
    // is where a hosting bug no other test can see shows up: Fabric lays that tree
    // out before `Dialog.show()` gives it a window, which is the one thing a
    // `ComposeView` cannot survive (docs/architecture/core.md §6). Two oracles: the
    // size the composition reports from inside that window, and a `value` write from
    // JS being accepted there. A tap would be a third - see the note below.
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

    // Why no press here: the harness cannot deliver a tap into an RN `Modal` on
    // either platform, and not because of this library. RN's `Modal` is a second
    // window, and a coordinate press at the frame the native query reports reaches
    // nothing inside it - measured on API 35 against React Native's own `Switch` in
    // the same dialog, which ignores the same tap, so no library's control can be
    // pressed there (H9). iOS misses too, and adding a plain RN control to the dialog
    // makes the query itself throw "No active window found" (H10).
    // Every press this suite makes is therefore on the first window, where the
    // harness does work; what R6 needed - that a composition exists in the dialog's
    // window and takes props there - is settled by the two oracles above and below.

    // The handshake works across the second surface, too: a `value` write from JS is
    // applied inside the dialog, not only on the first screen.
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
   * Wait for a query the harness cannot express yet.
   *
   * `waitForTestId` needs a testID, and a hosted control inside a `Modal` has no
   * reachable one, so this polls whatever the caller can observe instead. The
   * deadline is one frame clock (`nitroUiCore.now()`), not `Date.now()`, to keep
   * every wait in this suite on the same base as the native marks.
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
    // Review B1: with the pre-26 default on a 26 device, SwiftUI laid the Toggle
    // out at 61 pt inside a 51 pt Fabric box - it overflowed, centred, so the
    // painted track stuck past both edges. RN hit-tests to the box, so the outer
    // ~6 pt of a visible control answered nothing, and the row next to it was
    // laid out wrong. This asserts the box, the hosted control's own size
    // against it, and that a press near each inside edge is delivered.
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
    // Two or three taps in the time one round trip takes: native must show the
    // newest value, JS must see every event in order and counted, and the write
    // JS sends back must be accepted rather than read as a stale clobber.
    // Controlled, because that is the mode where the echo travels back to native.
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
    // The echo of the newest count reaches native, which is what lets a later
    // write through instead of being dropped as stale.
    await waitFor(() => expect(hybrid?.mostRecentEventCount).toBe(3));
    // And the control is where the last tap put it: the next tap reports false.
    await userEvent.press(element);
    await waitFor(() => expect(seen).toEqual([true, false, true, false]));
  });

  it('keeps the tint and the disabled flag when its props change', async () => {
    // The closest JS reaches to a recycled row: the same instance, new props, no
    // remount. Both a rendered prop (`tintColor`) and a behaviour prop
    // (`disabled`) have to follow, each way.
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
    // Both numbers come from the native side: `measureContent()` from the
    // hosted control's own measure pass, the box from the Fabric node's frame.
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
    // Round-2 review R2-1. At the default box this number cannot tell the two
    // platforms' questions apart: the control's intrinsic size and Yoga's box
    // are the same dp, so an implementation that echoes the box passes. Give it
    // a bigger box and the difference is the whole point - `measureContent()`
    // must keep reporting the control (52x48 dp of M3 Switch, 48 dp touch
    // target included) while the box grows to 90x50.
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
    // The control did not grow into the space it was given.
    expect(content!.width).toBeLessThan(box!.width - 20);
    expect(content!.height).toBeLessThan(box!.height);
    expect(Math.abs(content!.width - expectedBox!.width)).toBeLessThan(1.5);
    expect(Math.abs(content!.height - expectedBox!.height)).toBeLessThan(1.5);
  });

  it('round-trips an opaque tintColor', async () => {
    // A fully opaque colour is >= 0x80000000, which is above `Int32.max`. iOS
    // `processColor` returns it unsigned and Android's returns it signed, so a
    // native decode that assumes one of the two silently drops the other - and
    // the control then keeps the platform accent with no error anywhere. The
    // getter has to hand back what the platform's own `processColor` produced.
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

    // JS echoed every event count back, which is what allowed the revert.
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
        {/* A control that is allowed to answer, so its event can be awaited.
            Asserting `seen` straight after the presses would pass even if an
            event were still travelling; once the barrier's event has arrived,
            the pipeline demonstrably flushed and nothing arrived for the
            disabled Switch. */}
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
    // No interaction, so no event for JS to echo back.
    expect(hybrid?.mostRecentEventCount).toBe(0);
  });

  it('survives mounting and unmounting repeatedly', async () => {
    // Each cycle disposes a composition / hosting controller and builds a new
    // one through `onDropView`, the path a screen transition takes.
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
      // `drainPerf()` consumes the buffer, so every poll has to keep what it
      // read: the marks land on the UI thread and may arrive after the first
      // poll already emptied the ring.
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
      // A dropped view must not mark anything any more. Asserting that straight
      // away would prove nothing - a mark could still be in flight - so mount a
      // *different* instance and wait for its marks first. Once instance 8's
      // marks have arrived the ring is demonstrably live and flushed, and a mark
      // for the dropped instance 7 would have arrived with them.
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

  it('mounts many instances at once', async () => {
    const rows = Array.from({ length: 40 }, (_, index) => index);
    // 40 hosted controls is the stress case, and it is slower than the harness's
    // 1000ms default: one `UIHostingController` / Compose composition each has to
    // be built, laid out and committed. So this render gets its own timeout, and
    // the measured time is asserted against a budget an order of magnitude above
    // what the platforms actually take (see docs/tasks/T10-core-switch.report.md).
    const startedAt = nitroUiCore.now();
    await render(
      <View>
        {rows.map((row) => (
          <Switch
            key={row}
            defaultValue={row % 2 === 0}
            testID={`many-${row}`}
          />
        ))}
      </View>,
      { timeout: 20000 }
    );
    const mountedIn = nitroUiCore.now() - startedAt;
    console.log(
      `Switch stress: 40 hosted controls mounted in ${mountedIn.toFixed(1)}ms`
    );
    // A duration, so D21 reports it on every run and judges it only under
    // `HARNESS_TIMING=1` on a quiet machine. The gate that runs everywhere is
    // the one below: all 40 boxes reached the tree.
    await expectTimingBudget({
      label: 'Switch stress: mount 40 instances',
      measuredMs: mountedIn,
      limitMs: 10000,
      note: 'the bar is headroom for a debug build, not a target',
    });
    await waitForTestId('many-39');
    expect(harnessUi.queryByTestId('many-39')).not.toBeNull();
  });
});

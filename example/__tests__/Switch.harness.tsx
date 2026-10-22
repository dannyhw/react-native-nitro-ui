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
import { processColor, Text, TurboModuleRegistry, View } from 'react-native';
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
import { Switch, nitroUiCore, type NitroUiSwitch } from 'react-native-nitro-ui';

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

let hybrid: NitroUiSwitch | null = null;
const captureHybrid = (view: NitroUiSwitch) => {
  hybrid = view;
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
    const { unmount } = await render(<Switch defaultValue testID="warm-up" />, {
      timeout: 15000,
    });
    unmount();
  });

  it('reports the size of what it hosts', async () => {
    await render(
      <Switch defaultValue testID="sized" hybridRef={captureHybrid} />
    );
    await waitForTestId('sized');
    // Both numbers come from the native side: `measureContent()` from the
    // hosted control's own measure pass, the box from the Fabric node's frame.
    const content = hybrid?.measureContent() ?? null;
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
    await render(
      <Switch
        disabled
        value
        onValueChange={(next) => seen.push(next)}
        testID="off-limits"
        hybridRef={captureHybrid}
      />
    );
    const element = await waitForTestId('off-limits');

    await userEvent.press(element);
    await userEvent.press(element);
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
      // Marks for a dropped view must not be recorded any more.
      nitroUiCore.drainPerf();
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
    expect(mountedIn).toBeLessThan(10000);
    await waitForTestId('many-39');
    expect(harnessUi.queryByTestId('many-39')).not.toBeNull();
  });
});

import { forwardRef, memo, useState } from 'react';
import {
  DeviceEventEmitter,
  Platform,
  TurboModuleRegistry,
  View,
  type ViewStyle,
} from 'react-native';
import {
  afterEach,
  beforeAll,
  beforeEach,
  cleanup,
  describe,
  expect,
  it,
  render,
} from 'react-native-harness';
import { userEvent } from '@react-native-harness/ui';
import { Host, Switch, nitroUiCore } from 'react-native-nitro-ui';
import { waitForHandle } from './handles';

type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

type SwitchHandle = {
  readonly value: boolean | null;
  readonly mostRecentEventCount: number;
  readonly disabled: boolean;
};

type Log = {
  /** Every `onValueChange` that reached JS, in order, named by `testID`. */
  events: string[];
  /** The same presses as `id:value`: what each press asked for. */
  requests: string[];
  /** The value the app agreed to, per instance. Only written when accepted. */
  accepted: Record<string, boolean>;
  /** Every box the Host reported to `onLayout`. */
  layouts: { width: number; height: number }[];
  handles: Record<string, SwitchHandle>;
  /** JS-side writes, so a test can move a control with no touch at all. */
  write: Record<string, (next: boolean) => void>;
  setIds?: (ids: string[]) => void;
  setDisabled?: (next: boolean) => void;
  setHidden?: (next: boolean) => void;
  /** Change a hosted child's own `style`, to force a later layout pass for *it*. */
  setSized?: (next: boolean) => void;
};

const newLog = (): Log => ({
  events: [],
  requests: [],
  accepted: {},
  layouts: [],
  handles: {},
  write: {},
});

/**
 * A wrapper that takes its child's size, so `queryByTestId` on it reports the Host's
 * box. RN stretches a childless-axis `View` to its parent instead, which would report
 * the screen.
 */
const HUG: ViewStyle = { alignSelf: 'flex-start' };

function settle(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls, because `screen.findByTestId` has no timeout and a hosted control mounts
 * through the Host's composition, later than the harness's single pass.
 */
async function boxOf(testId: string, timeoutMs = 15000): Promise<ViewInfo> {
  const deadline = nitroUiCore.now() + timeoutMs;
  for (;;) {
    const box = harnessUi.queryByTestId(testId);
    if (box != null) {
      return box;
    }
    if (nitroUiCore.now() > deadline) {
      throw new Error(
        `No element with testID "${testId}" within ${String(timeoutMs)}ms.`
      );
    }
    await settle(50);
  }
}

async function mount(ui: Parameters<typeof render>[0], timeoutMs = 30000) {
  return await render(ui, { timeout: timeoutMs });
}

/**
 * `hybridRef` runs on a commit after layout, so a handle read straight after a mount
 * can be `undefined`. The wait is on existence only.
 */
function handleOf(log: Log, id: string): Promise<SwitchHandle> {
  return waitForHandle(() => log.handles[id], { what: `"${id}"` });
}

/**
 * Press at an absolute point and report which control's `onValueChange` reached JS,
 * or `null`. On Android a hosted control's own view is laid out at `0 x 0`, so an
 * answer can only arrive through the Host's composition.
 */
async function probeAt(
  x: number,
  y: number,
  allowed: string[],
  log: Log
): Promise<string | null> {
  const before = log.events.length;
  await userEvent.pressAt(x, y);
  await settle(240);
  const hit = log.events.slice(before);
  expect(hit.length).toBeLessThanOrEqual(1);
  const last = hit[hit.length - 1];
  if (last == null) {
    return null;
  }
  expect(allowed).toContain(last);
  return last;
}

function probeIn(
  box: ViewInfo,
  offsetX: number,
  offsetY: number,
  allowed: string[],
  log: Log
) {
  return probeAt(box.x + offsetX, box.y + offsetY, allowed, log);
}

/** The child a press answered, without its fixture's prefix. */
const suffixOf = (hit: string | null): string =>
  hit == null ? 'none' : hit.slice(hit.lastIndexOf('-') + 1);

const reports = (stats: ReturnType<typeof nitroUiCore.sizingStats>) =>
  stats.reportsQueued + stats.reportsDropped + stats.reportsConfirmed;

/**
 * One Switch wired to the log. It holds its own state, so a JS write is a real state
 * change and a rejected change is a real refusal. `onValueChange` is deliberately a
 * fresh closure per render, as apps write it.
 */
function Toggle({
  id,
  log,
  accept = true,
  defaultValue = false,
  disabled,
  style,
}: {
  id: string;
  log: Log;
  accept?: boolean;
  defaultValue?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const [value, setValue] = useState(defaultValue);
  log.write[id] = setValue;
  return (
    <Switch
      testID={id}
      value={value}
      disabled={disabled}
      style={style}
      hybridRef={(view: SwitchHandle) => {
        log.handles[id] = view;
      }}
      onValueChange={(next) => {
        log.events.push(id);
        log.requests.push(`${id}:${String(next)}`);
        if (accept) {
          log.accepted[id] = next;
          setValue(next);
        }
      }}
    />
  );
}

/**
 * A Switch the test can enable after mount: a press a disabled control refuses has
 * to answer once it is enabled, or the Host may simply have drawn nothing.
 */
function Enableable({
  id,
  log,
  initiallyDisabled,
}: {
  id: string;
  log: Log;
  initiallyDisabled: boolean;
}) {
  const [disabled, setDisabled] = useState(initiallyDisabled);
  log.setDisabled = setDisabled;
  return <Toggle id={id} log={log} disabled={disabled} />;
}

/** A Host whose child list the test can change. */
function HostedList({
  log,
  ids,
  hostStyle,
  childStyle,
  hideLast,
  refuseLast,
}: {
  log: Log;
  ids: string[];
  hostStyle?: ViewStyle;
  childStyle?: ViewStyle;
  /** Start with the last child `display: none`; `setHidden(false)` shows it. */
  hideLast?: boolean;
  /**
   * Make the last child refuse every press. A refused press still reaches
   * `onValueChange`, but the value stays whatever JS last wrote.
   */
  refuseLast?: boolean;
}) {
  const [current, setCurrent] = useState(ids);
  const [hidden, setHidden] = useState(hideLast ?? false);
  log.setIds = setCurrent;
  log.setHidden = setHidden;
  return (
    <Host style={hostStyle}>
      {current.map((id, index) => (
        <Toggle
          key={id}
          id={id}
          log={log}
          accept={!(refuseLast && index === current.length - 1)}
          style={
            hidden && index === current.length - 1
              ? { ...childStyle, display: 'none' }
              : childStyle
          }
        />
      ))}
    </Host>
  );
}

/**
 * A hosted Switch whose own `style` a test can change after mount. Fabric emits a
 * layout update only for a node whose own metrics changed; resizing a sibling does not.
 */
function Resizer({ id, log }: { id: string; log: Log }) {
  const [big, setBig] = useState(false);
  log.setSized = setBig;
  return (
    <Toggle
      id={id}
      log={log}
      style={big ? { width: 160, height: 60 } : { width: 120, height: 44 }}
    />
  );
}

/** `[width, height, x, y]`, rounded. */
function frame(b: ViewInfo): number[] {
  return [
    Math.round(b.width),
    Math.round(b.height),
    Math.round(b.x),
    Math.round(b.y),
  ];
}

afterEach(() => {
  cleanup();
});

// MARK: - Both platforms

describe('Host · hosted controls are still controls', () => {
  let log: Log;

  beforeEach(() => {
    log = newLog();
  });

  beforeAll(async () => {
    // Pay the process-wide firsts (Nitro's first hybrid call, the first Compose
    // composition / UIHostingController commit) before anything is asserted.
    const { unmount } = await mount(
      <Switch defaultValue testID="host-warm-up" />
    );
    unmount();
  });

  /**
   * Android: press inside the Host at the column's leading edge, because the hosted
   * child's own view has no size. iOS: the Host is a passthrough `View`, so the
   * child's own box is the target.
   */
  async function pressFirstControl(hostTestId: string, childId: string) {
    if (Platform.OS === 'android') {
      const host = await boxOf(hostTestId);
      return await probeIn(host, 8, 24, [childId], log);
    }
    const child = await boxOf(childId);
    return await probeAt(
      child.x + child.width / 2,
      child.y + child.height / 2,
      [childId],
      log
    );
  }

  it('lets a real touch reach a hosted Switch, and JS sees the new value', async () => {
    const { unmount } = await mount(
      <View testID="tap-host" style={HUG}>
        <Host style={{ width: 300, height: 140 }}>
          <Toggle id="tap-0" log={log} />
        </Host>
      </View>
    );
    // The wrapper reports the Host's box: it hugs its one fixed-size child (`HUG`),
    // and a plain RN view is reliably queryable where a native container is not.
    const box = await boxOf('tap-host');
    expect([Math.round(box.width), Math.round(box.height)]).toEqual([300, 140]);
    const toggle = await handleOf(log, 'tap-0');

    const hit = await pressFirstControl('tap-host', 'tap-0');
    expect(hit).toBe('tap-0');
    expect(log.events).toEqual(['tap-0']);
    expect(log.accepted['tap-0']).toBe(true);
    expect(toggle.value).toBe(true);
    unmount();
  });

  it('snaps a hosted Switch back when JS rejects the change', async () => {
    const { unmount } = await mount(
      <View testID="reject-host" style={HUG}>
        <Host style={{ width: 300, height: 140 }}>
          <Toggle id="reject-0" log={log} accept={false} />
        </Host>
      </View>
    );
    await boxOf('reject-0');
    await handleOf(log, 'reject-0');
    const first = await pressFirstControl('reject-host', 'reject-0');
    expect(first).toBe('reject-0');
    // The app refused, so the value JS owns never moved.
    const afterFirst = log.handles['reject-0'];
    expect(afterFirst?.value).toBe(false);
    expect(log.accepted['reject-0']).toBeUndefined();

    const eventsAfterFirst = log.events.length;
    const second = await pressFirstControl('reject-host', 'reject-0');
    expect(second).toBe('reject-0');
    expect(log.events.length).toBe(eventsAfterFirst + 1);
    // The second press asked for `true` again, which is only possible if native had
    // already put the Switch back to off.
    expect(log.requests).toEqual(['reject-0:true', 'reject-0:true']);
    expect(
      log.handles['reject-0']?.mostRecentEventCount
    ).toBeGreaterThanOrEqual(2);
    expect(afterFirst?.value).toBe(false);
    unmount();
  });

  it('takes a JS write with no touch at all', async () => {
    const { unmount } = await mount(
      <View testID="write-host" style={HUG}>
        <Host style={{ width: 300, height: 140 }}>
          <Toggle id="write-0" log={log} />
        </Host>
      </View>
    );
    await boxOf('write-0');
    const toggle = await handleOf(log, 'write-0');
    expect(toggle.value).toBe(false);
    log.write['write-0']?.(true);
    await settle(400);
    // The handle holds the last JS prop, not what is drawn. The press is the witness:
    // only a Switch showing `true` asks to go back to `false`.
    expect(toggle.value).toBe(true);
    expect(log.events).toEqual([]);
    expect(await pressFirstControl('write-host', 'write-0')).toBe('write-0');
    expect(log.requests).toEqual(['write-0:false']);
    expect(toggle.value).toBe(false);
    unmount();
  });

  it('follows children that are added, removed and reordered', async () => {
    const { unmount } = await mount(
      <View testID="list-host" style={HUG}>
        <HostedList
          log={log}
          ids={['list-a', 'list-b', 'list-c']}
          hostStyle={{ width: 300, height: 220 }}
        />
      </View>
    );
    await boxOf('list-c');
    expect(await pressFirstControl('list-host', 'list-a')).toBe('list-a');

    // Reorder: `c` moves to the top and `b` goes away.
    log.setIds?.(['list-c', 'list-a']);
    await settle(500);
    expect(await pressFirstControl('list-host', 'list-c')).toBe('list-c');

    // Add: `list-d` was never mounted and joins at the end.
    log.setIds?.(['list-c', 'list-a', 'list-d']);
    await settle(500);
    const addedBox = frame(await boxOf('list-d'));
    // A child laid out after the Host mounted reports the frame Yoga computed for it.
    expect(addedBox[0]).toBeGreaterThan(0);
    expect(addedBox[1]).toBeGreaterThan(0);
    const listBox = await boxOf('list-host');
    const order: string[] = [];
    for (let offset = 4; offset <= 200; offset += 8) {
      const hit = await probeIn(
        listBox,
        8,
        offset,
        ['list-c', 'list-a', 'list-d'],
        log
      );
      if (hit != null && order[order.length - 1] !== hit) {
        order.push(hit);
      }
    }
    expect(order).toEqual(['list-c', 'list-a', 'list-d']);

    // Removing every child but one must not take the Host with it.
    log.setIds?.(['list-a']);
    await settle(400);
    expect(await pressFirstControl('list-host', 'list-a')).toBe('list-a');
    expect(harnessUi.queryByTestId('list-c')).toBeNull();
    unmount();
  });

  it('keeps a disabled hosted Switch disabled', async () => {
    const { unmount } = await mount(
      <View testID="off-host" style={HUG}>
        <Host style={{ width: 300, height: 140 }}>
          <Enableable id="off-0" log={log} initiallyDisabled />
        </Host>
      </View>
    );
    await boxOf('off-0');
    expect((await handleOf(log, 'off-0')).disabled).toBe(true);
    expect(await pressFirstControl('off-host', 'off-0')).toBeNull();
    expect(log.events).toEqual([]);

    // A Host that drew nothing would answer `null` forever, so the same press has to
    // answer once the control is enabled.
    log.setDisabled?.(false);
    await settle(400);
    expect(await pressFirstControl('off-host', 'off-0')).toBe('off-0');
    expect(log.requests).toEqual(['off-0:true']);
    unmount();
  });

  it('finds a hosted child by testID', async () => {
    const { unmount } = await mount(
      <View testID="find-host" style={HUG}>
        <Host style={{ width: 300, height: 200 }}>
          <Toggle id="find-0" log={log} />
          <Toggle id="find-1" log={log} />
          <Toggle
            id="find-sized"
            log={log}
            style={{ width: 120, height: 44 }}
          />
        </Host>
      </View>
    );
    const zero = await boxOf('find-0');
    const one = await boxOf('find-1');
    if (Platform.OS === 'android') {
      // The id is on the child's own view, which declines to measure while a Host
      // draws it: the box it reports is not where the control is drawn.
      expect(Math.round(zero.width)).toBe(0);
      expect(Math.round(zero.height)).toBe(0);
      expect(Math.round(one.width)).toBe(0);
      expect(Math.round(one.height)).toBe(0);
    } else {
      // The passthrough gives its children real views.
      expect(zero.width).toBeGreaterThan(0);
      expect(zero.height).toBeGreaterThan(0);
      expect(one.width).toBeGreaterThan(0);
      expect(one.height).toBeGreaterThan(0);
    }
    unmount();
  });

  // Only a change to the child's own style makes Fabric lay that child out again. On
  // Android the child's view then takes the frame Yoga computed, while the drawing in
  // the Host's composition stays where it was.
  it('lays a re-framed hosted child at its Yoga frame, not its drawing (F8)', async () => {
    const { unmount } = await mount(
      <View testID="f8-host" style={HUG}>
        <Host testID="f8-box" style={{ width: 300, height: 200 }}>
          <Toggle id="f8-0" log={log} />
          <Resizer id="f8-sized" log={log} />
        </Host>
      </View>
    );
    /** Which x offsets, down the second row's band, answer the hosted Switch. */
    const drawnColumns = async () => {
      const host = await boxOf('f8-box');
      const hit: number[] = [];
      for (let x = 4; x <= 220; x += 8) {
        if (
          (await probeIn(host, x, 70, ['f8-0', 'f8-sized'], log)) === 'f8-sized'
        ) {
          hit.push(x);
        }
      }
      return hit;
    };
    const sizedBefore = frame(await boxOf('f8-sized'));
    // The probe reads the composition's row band, which exists only where the Host
    // draws; on iOS the box and the drawing are the same rectangle.
    const drawnBefore = Platform.OS === 'android' ? await drawnColumns() : [];
    if (Platform.OS === 'android') {
      expect(drawnBefore.length).toBeGreaterThan(0);
    }

    log.setSized?.(true);
    await settle(600);

    const sizedAfter = frame(await boxOf('f8-sized'));

    if (Platform.OS === 'android') {
      // The re-frame moved the frame and not the drawing.
      expect(await drawnColumns()).toEqual(drawnBefore);
      expect(sizedBefore).toEqual([0, 0, 0, 0]);
      // The child's own Yoga frame, in the second row.
      expect(sizedAfter).toEqual([160, 60, 0, 48]);
      // A child nobody re-framed keeps the frame it mounted with.
      expect(frame(await boxOf('f8-0'))).toEqual([0, 0, 0, 0]);
      // The drawing stops at the control, well short of a box 160 wide.
      const widest = drawnBefore.at(-1) ?? 0;
      expect(widest).toBeLessThan((sizedAfter[0] ?? 0) - 60);
    } else {
      // The passthrough gives the child a real view, so its box is its Yoga frame.
      expect(sizedBefore.slice(0, 2)).toEqual([120, 44]);
      expect(sizedAfter.slice(0, 2)).toEqual([160, 60]);
      expect(Math.round((await boxOf('f8-0')).width)).toBeGreaterThan(0);
    }
    unmount();
  });
});

// MARK: - Android

if (Platform.OS === 'android') {
  describe('Host · geometry (D24)', () => {
    let log: Log;
    beforeEach(() => {
      log = newLog();
    });

    /** Three hosted Switches in a Host of the given size, children styled as asked. */
    async function mountThree(
      hostTestId: string,
      hostStyle: ViewStyle | undefined,
      childStyle?: ViewStyle,
      prefix = 'g'
    ) {
      const mounted = await mount(
        <View testID={hostTestId} style={HUG}>
          <Host
            style={hostStyle}
            onLayout={(event) => log.layouts.push(event.nativeEvent.layout)}
          >
            {['0', '1', '2'].map((suffix) => (
              <Toggle
                key={suffix}
                id={`${prefix}-${suffix}`}
                log={log}
                style={childStyle}
              />
            ))}
          </Host>
        </View>
      );
      const box = await boxOf(hostTestId);
      const ids = ['0', '1', '2'].map((suffix) => `${prefix}-${suffix}`);
      return { box, ids, unmount: mounted.unmount };
    }

    /**
     * Mount one fixture alone, press a sweep of offsets, unmount, report the answers.
     * Two fixtures mounted together would share screen coordinates, and a press would
     * answer for whichever Compose view is on top. A hosted row is 48 dp tall, so x=8
     * and y=24 are inside the leading column and the first row.
     */
    async function sweepThree(options: {
      hostTestId: string;
      hostStyle: ViewStyle;
      prefix: string;
      childStyle?: ViewStyle;
      offsets: number[];
      axis: 'x' | 'y';
    }) {
      const { hostTestId, hostStyle, prefix, childStyle, offsets, axis } =
        options;
      const { box, ids, unmount } = await mountThree(
        hostTestId,
        hostStyle,
        childStyle,
        prefix
      );
      const hits: string[] = [];
      for (const offset of offsets) {
        const hit =
          axis === 'y'
            ? await probeIn(box, 8, offset, ids, log)
            : await probeIn(box, offset, 24, ids, log);
        hits.push(suffixOf(hit));
      }
      const hostBox = {
        width: Math.round(box.width),
        height: Math.round(box.height),
      };
      unmount();
      return { hits, hostBox };
    }

    it('takes its box from its own style, not from what it draws', async () => {
      // Children whose RN boxes sum to 288, in a Host asked to be 140 tall.
      const { box, unmount } = await mountThree(
        'box-host',
        { width: 260, height: 140 },
        { height: 96 },
        'box'
      );
      expect([Math.round(box.width), Math.round(box.height)]).toEqual([
        260, 140,
      ]);
      // Rounded, because the boxes made a dp round trip through px.
      expect(log.layouts.length).toBeGreaterThan(0);
      for (const layout of log.layouts) {
        expect([Math.round(layout.width), Math.round(layout.height)]).toEqual([
          260, 140,
        ]);
      }
      unmount();
    });

    it('with no height, it is the sum of its childrens boxes', async () => {
      // 3 x 24 = 72 for Yoga; the Compose column draws about 144.
      const { box, unmount } = await mountThree(
        'tall-host',
        { width: 260 },
        { height: 24 },
        'tall'
      );
      expect(Math.round(box.height)).toBe(72);
      expect(Math.round(box.width)).toBe(260);
      unmount();
    });

    it('draws every hosted child, in mount order', async () => {
      const { box, ids, unmount } = await mountThree(
        'order-host',
        { width: 300, height: 240 },
        undefined,
        'order'
      );
      // A sweep rather than three guesses: the row pitch is Compose's business, and
      // 8 dp cannot step over a touch target.
      const seen: (string | null)[] = [];
      for (let offset = 4; offset <= 140; offset += 8) {
        seen.push(await probeIn(box, 8, offset, ids, log));
      }
      const drawn = seen.filter((hit): hit is string => hit != null);
      expect(new Set(drawn.map((hit) => hit.slice(-1)))).toEqual(
        new Set(['0', '1', '2'])
      );
      expect(drawn[0]).toBe('order-0');
      // Presses never go backwards: a Column in mount order.
      const indexes = drawn.map((hit) => Number(hit.slice(-1)));
      const sorted = [...indexes].sort((a, b) => a - b);
      expect(indexes).toEqual(sorted);
      // Below the drawn column, the Host's own box is dead space.
      expect(await probeIn(box, 8, 234, ids, log)).toBeNull();
      unmount();
    });

    it('ignores a hosted child style height when placing the drawing', async () => {
      // Identical Hosts, children 96 tall versus 20 tall. Compose draws three 48 dp
      // rows either way, so the offsets run through the column and past it.
      const offsets = [12, 60, 112, 164];
      const tall = await sweepThree({
        hostTestId: 'h96-host',
        hostStyle: { width: 300, height: 240 },
        prefix: 'h96',
        childStyle: { height: 96 },
        offsets,
        axis: 'y',
      });
      const short = await sweepThree({
        hostTestId: 'h20-host',
        hostStyle: { width: 300, height: 240 },
        prefix: 'h20',
        childStyle: { height: 20 },
        offsets,
        axis: 'y',
      });
      expect(short.hostBox).toEqual(tall.hostBox);
      expect(short.hits).toEqual(tall.hits);
      // At least one offset has to reach a control, or "identical" would only mean
      // "nothing is tappable in either".
      expect(tall.hits.filter((hit) => hit !== 'none').length).toBeGreaterThan(
        0
      );
    });

    it('clips its content to its own box', async () => {
      // Short Host (60) versus tall Host (240), same three children: the same offset
      // has to reach a control in the tall one and nothing in the short one.
      const short = await mountThree(
        'short-host',
        { width: 300, height: 60 },
        undefined,
        'short'
      );
      const shortTop = await probeIn(short.box, 8, 12, short.ids, log);
      const shortLow = await probeIn(short.box, 8, 120, short.ids, log);
      short.unmount();

      const tall = await mountThree(
        'tall-host-clip',
        { width: 300, height: 240 },
        undefined,
        'clip'
      );
      const tallTop = await probeIn(tall.box, 8, 12, tall.ids, log);
      const tallLow = await probeIn(tall.box, 8, 120, tall.ids, log);
      // Children start at the Host's top edge in a Host of either height.
      expect(shortTop).toBe('short-0');
      expect(tallTop).toBe('clip-0');
      // The same lower offset answers in the tall Host and is clipped in the short one.
      expect(shortLow).toBeNull();
      expect(['clip-1', 'clip-2']).toContain(tallLow);
      tall.unmount();
    });

    it('lets a hosted child ask for the full width without moving the drawing', async () => {
      // `width: '100%'` + `alignSelf: 'stretch'` versus nothing: the style moves the
      // frame RN computes for the child, and must not move the pixels Compose draws.
      const offsets = [8, 150, 292];
      const stretched = await sweepThree({
        hostTestId: 'wide-host',
        hostStyle: { width: 300, height: 200 },
        prefix: 'wide',
        childStyle: { width: '100%', alignSelf: 'stretch' },
        offsets,
        axis: 'x',
      });
      const plain = await sweepThree({
        hostTestId: 'plain-host',
        hostStyle: { width: 300, height: 200 },
        prefix: 'plain',
        offsets,
        axis: 'x',
      });
      expect(plain.hits).toEqual(stretched.hits);
      // The leading edge reaches a control and the middle of a 300 dp Host does not.
      expect(stretched.hits).toEqual(['0', 'none', 'none']);
      expect(Math.round(stretched.hostBox.width)).toBe(300);
    });

    it('reports nothing to the sizing engine, while an unhosted control reports', async () => {
      // The same batch unhosted shows that the counters were live.
      nitroUiCore.invalidateSizingEnvironment();
      const before = nitroUiCore.sizingStats();
      const hosted = await mount(
        <Host style={{ width: 300, height: 420 }}>
          {Array.from({ length: 8 }, (_, index) => `h-${String(index)}`).map(
            (id) => (
              <Toggle key={id} id={id} log={log} />
            )
          )}
        </Host>,
        40000
      );
      await boxOf('h-7', 25000);
      await settle(800);
      const afterHosted = nitroUiCore.sizingStats();
      hosted.unmount();
      await settle(300);

      const plain = await mount(
        <View>
          {Array.from({ length: 8 }, (_, index) => `p-${String(index)}`).map(
            (id) => (
              <Toggle key={id} id={id} log={log} />
            )
          )}
        </View>,
        40000
      );
      await boxOf('p-7', 25000);
      await settle(800);
      const afterPlain = nitroUiCore.sizingStats();
      plain.unmount();

      /** Every counter the engine keeps, as a delta over one mount of eight controls. */
      const delta = (
        from: ReturnType<typeof nitroUiCore.sizingStats>,
        to: ReturnType<typeof nitroUiCore.sizingStats>
      ) => ({
        measurements: to.measurements - from.measurements,
        reports: reports(to) - reports(from),
        cachedSizes: to.cachedSizes - from.cachedSizes,
        corrections:
          to.correctionsImmediate -
          from.correctionsImmediate +
          (to.correctionsBatched - from.correctionsBatched),
        ledgerEntries: to.ledgerEntries - from.ledgerEntries,
      });
      const hostedDelta = delta(before, afterHosted);
      const plainDelta = delta(afterHosted, afterPlain);
      // A hosted control never reports: nothing queued, cached or corrected.
      expect(hostedDelta.reports).toBe(0);
      expect(hostedDelta.cachedSizes).toBe(0);
      expect(hostedDelta.corrections).toBe(0);
      // Fabric still asks each hosted child's Yoga node once for the frame it will not
      // draw, so the measure calls are the same either way.
      expect(hostedDelta.measurements).toBe(8);
      expect(plainDelta.measurements).toBe(8);
      // Unhosted, each control reports twice (queued, then confirmed), and eight
      // controls of one configuration cache the size once.
      expect(plainDelta.reports).toBe(16);
      expect(plainDelta.cachedSizes).toBe(1);
      // `ledgerEntries` is not asserted: it counts live instances, so its delta is
      // Fabric's instance-id churn across mounts.
    });

    // Vertical padding only: a sweep presses at a fixed x, so a left padding would
    // move the drawing out from under every press.
    it('insets its drawing for its own padding', async () => {
      const offsets = [8, 24, 40, 56, 72, 88, 104, 120, 136, 152, 168];
      const plain = await sweepThree({
        hostTestId: 'nopad-host',
        hostStyle: { width: 300, height: 240 },
        prefix: 'nopad',
        offsets,
        axis: 'y',
      });
      const padded = await sweepThree({
        hostTestId: 'pad-host',
        hostStyle: { width: 300, height: 240, paddingVertical: 32 },
        prefix: 'pad',
        offsets,
        axis: 'y',
      });
      const drawn = (hits: string[]) =>
        new Set(hits.filter((hit) => hit !== 'none'));
      // Both draw all three rows. A sweep may fall in the dead band between two rows,
      // so the comparison below is about which offset first hits.
      expect(drawn(plain.hits)).toEqual(new Set(['0', '1', '2']));
      expect(drawn(padded.hits)).toEqual(new Set(['0', '1', '2']));
      const firstHitOffset = (hits: string[]) => {
        const index = hits.findIndex((hit) => hit !== 'none');
        return index < 0 ? Number.POSITIVE_INFINITY : (offsets[index] ?? 0);
      };
      // 8 dp into a padded Host is padding; 8 dp into a plain one is row 0.
      expect(firstHitOffset(plain.hits)).toBeLessThan(32);
      expect(firstHitOffset(padded.hits)).toBeGreaterThanOrEqual(32);
      // Padding is inside the Host's own height.
      expect(padded.hostBox).toEqual(plain.hostBox);
    });

    it('does not draw a hosted child RN hid with display: none', async () => {
      const hiddenLog = newLog();
      const { unmount } = await mount(
        <View testID="hidden-host" style={HUG}>
          <HostedList
            log={hiddenLog}
            ids={['hidden-a', 'hidden-b']}
            hostStyle={{ width: 300, height: 200 }}
            hideLast
          />
        </View>
      );
      const box = await boxOf('hidden-host');
      await boxOf('hidden-a');
      const sweep = async () => {
        const answers: string[] = [];
        for (let offset = 4; offset <= 180; offset += 8) {
          const hit = await probeIn(
            box,
            8,
            offset,
            ['hidden-a', 'hidden-b'],
            hiddenLog
          );
          if (hit != null && answers[answers.length - 1] !== hit) {
            answers.push(hit);
          }
        }
        return answers;
      };
      // `hidden-b` is `display: none`: only `hidden-a` is composed, so only it answers.
      expect(await sweep()).toEqual(['hidden-a']);
      hiddenLog.setHidden?.(false);
      await settle(500);
      expect(await sweep()).toEqual(['hidden-a', 'hidden-b']);
      unmount();
    });

    // Hiding takes a hosted child out of the composition, so the write lands on a
    // control with no Compose state behind it. The last child refuses every press, so
    // a press on it asks for the opposite of what is drawn.
    it('applies a value written while the hosted child was hidden', async () => {
      const s2Log = newLog();
      const { unmount } = await mount(
        <View testID="s2-host" style={HUG}>
          <HostedList
            log={s2Log}
            ids={['s2-a', 's2-b']}
            hostStyle={{ width: 300, height: 200 }}
            hideLast
            refuseLast
          />
        </View>
      );
      const box = await boxOf('s2-host');
      await boxOf('s2-a');
      await boxOf('s2-b');
      const hiddenToggle = await handleOf(s2Log, 's2-b');

      // The write, while `display: none` still hides the child.
      s2Log.write['s2-b']?.(true);
      await settle(500);
      // Read off the handle: a JS write never passes through `onValueChange`.
      expect(hiddenToggle.value).toBe(true);

      // A value change must not put the hidden child back in the drawing.
      const offsetsFor = async () => {
        const found: { offset: number; hit: string }[] = [];
        for (let offset = 4; offset <= 180; offset += 8) {
          const hit = await probeIn(box, 8, offset, ['s2-a', 's2-b'], s2Log);
          if (hit != null && found[found.length - 1]?.hit !== hit) {
            found.push({ offset, hit });
          }
        }
        return found;
      };
      expect((await offsetsFor()).map((entry) => entry.hit)).toEqual(['s2-a']);

      s2Log.setHidden?.(false);
      await settle(600);
      const shown = await offsetsFor();
      expect(shown.map((entry) => entry.hit)).toEqual(['s2-a', 's2-b']);
      const firstB = shown.find((entry) => entry.hit === 's2-b');
      expect(firstB).toBeDefined();

      const before = s2Log.requests.length;
      expect(
        await probeIn(box, 8, firstB!.offset, ['s2-a', 's2-b'], s2Log)
      ).toBe('s2-b');
      // The drawn thumb was ON, so the press the drawing reports is the turn-off.
      expect(s2Log.requests.slice(before)).toEqual(['s2-b:false']);
      unmount();
    });
  });

  // JS refuses the children it can name. It cannot see through a component, so a
  // child behind `memo`, `forwardRef` or a function component reaches the native
  // allowlist, which is then the only rule.
  describe('Host · what it refuses', () => {
    let log: Log;
    beforeEach(() => {
      log = newLog();
    });

    /** The device event a debuggable `NitroUiHost` emits for a refused child. */
    type Report = { message?: string; childClass?: string };

    function listen(sink: Report[]) {
      return DeviceEventEmitter.addListener(
        'NitroUiHostUnhostableChild',
        (report: Report) => {
          sink.push(report);
        }
      );
    }

    /** A child JS cannot name, which is what makes the native rule the only one. */
    const WrappedView = memo(function ViewBehindMemo() {
      return <View testID="wrapped-view" />;
    });

    /** The ref is deliberately not handed on: what matters is the element type. */
    const ViewThroughForwardRef = forwardRef<View>(
      function ViewBehindForwardRef(_props, _ref) {
        return <View testID="wrapped-view-forwarded" />;
      }
    );

    function ViewFromUserComponent() {
      return <View testID="wrapped-view-user" />;
    }

    it('will not compose a view behind a component, and tells JS', async () => {
      const refused: Report[] = [];
      const subscription = listen(refused);
      try {
        const { unmount } = await mount(
          <View testID="refuse-host" style={HUG}>
            <Host style={{ width: 300, height: 140 }}>
              <WrappedView />
              <ViewThroughForwardRef />
              <ViewFromUserComponent />
            </Host>
          </View>
        );
        // Nothing in the Host's box answers: there is no composition there to press.
        const host = await boxOf('refuse-host');
        for (const offset of [24, 60, 100]) {
          expect(await probeIn(host, 8, offset, [], log)).toBeNull();
        }
        // One report per refused child, naming the child's class.
        expect(refused.length).toBe(3);
        for (const report of refused) {
          expect(report.childClass).toBe('ReactViewGroup');
          expect(report.message ?? '').toMatch(/not a nitro-ui control/);
        }
        expect(
          refused.some((report) =>
            /docs\/components\/host\.md/.test(report.message ?? '')
          )
        ).toBe(true);
        unmount();
      } finally {
        subscription.remove();
      }
    });

    /** The same three shapes around a control a Host does compose. */
    const WrappedSwitch = memo(function SwitchBehindMemo() {
      return <Toggle id="through-memo" log={log} />;
    });

    const SwitchThroughForwardRef = forwardRef<View>(
      function SwitchBehindForwardRef(_props, _ref) {
        return <Toggle id="through-forwarded" log={log} />;
      }
    );

    function SwitchFromUserComponent() {
      return <Toggle id="through-user" log={log} />;
    }

    it('composes a control behind a component, and says nothing', async () => {
      const refused: Report[] = [];
      const subscription = listen(refused);
      try {
        const { unmount } = await mount(
          <View testID="through-host" style={HUG}>
            <Host style={{ width: 300, height: 200 }}>
              <WrappedSwitch />
              <SwitchThroughForwardRef />
              <SwitchFromUserComponent />
            </Host>
          </View>
        );
        expect(refused).toEqual([]);
        // A sweep, because the row pitch is Compose's business and 8 dp cannot step
        // over a touch target.
        const host = await boxOf('through-host');
        const seen: string[] = [];
        for (let offset = 4; offset <= 190; offset += 8) {
          const hit = await probeIn(
            host,
            8,
            offset,
            ['through-memo', 'through-forwarded', 'through-user'],
            log
          );
          if (hit != null) {
            seen.push(hit);
          }
        }
        expect(new Set(seen)).toEqual(
          new Set(['through-memo', 'through-forwarded', 'through-user'])
        );
        // In mount order, like unwrapped children.
        const order = seen.map((hit) =>
          hit === 'through-memo' ? 0 : hit === 'through-forwarded' ? 1 : 2
        );
        expect(order).toEqual([...order].sort((left, right) => left - right));
        unmount();
      } finally {
        subscription.remove();
      }
    });

    // A `<Host>` directly inside a `<Host>` is refused in JS; behind a component only
    // the native allowlist can refuse it.
    it('will not compose a Host behind a component either', async () => {
      const refused: Report[] = [];
      const subscription = listen(refused);
      const WrappedHost = memo(function HostBehindMemo() {
        return (
          <Host style={{ width: 300, height: 48 }}>
            <Toggle id="nested-0" log={log} />
          </Host>
        );
      });
      try {
        const { unmount } = await mount(
          <View testID="nested-hosts" style={HUG}>
            <Host style={{ width: 300, height: 140 }}>
              <WrappedHost />
            </Host>
          </View>
        );
        await settle(400);
        const host = await boxOf('nested-hosts');
        expect(await probeIn(host, 8, 24, [], log)).toBeNull();
        expect(
          refused.some((report) => /another <Host>/.test(report.message ?? ''))
        ).toBe(true);
        unmount();
      } finally {
        subscription.remove();
      }
    });
  });

  describe('Host · a box of none (D24)', () => {
    it('lays a zero-height Host at zero, and its content is not tappable', async () => {
      const log = newLog();
      const { unmount } = await mount(
        <View testID="zero-row" style={{ width: 320 }}>
          <Host style={{ width: 300, height: 0 }}>
            <Toggle id="zero-0" log={log} />
          </Host>
          <View testID="zero-below" style={{ width: 300, height: 24 }} />
        </View>
      );
      const row = await boxOf('zero-row');
      const below = await boxOf('zero-below');
      const insideHost = await probeAt(row.x + 8, row.y + 8, ['zero-0'], log);
      const insideSibling = await probeAt(
        below.x + 8,
        below.y + 12,
        ['zero-0'],
        log
      );
      // The Host took no vertical space: the sibling starts at the row's own top.
      expect(below.y).toBe(row.y);
      // Nothing is tappable where a drawn Switch would be, and nothing overflowed
      // into the sibling: Compose clips to the box.
      expect(insideHost).toBeNull();
      expect(insideSibling).toBeNull();
      unmount();
    });
  });
} else {
  // MARK: - iOS: the passthrough

  describe('Host · iOS passthrough', () => {
    let log: Log;
    beforeEach(() => {
      log = newLog();
    });

    /** A Switch's intrinsic box, which iOS 26 changed. */
    const osVersion = (
      Platform.constants as { readonly osVersion?: string } | undefined
    )?.osVersion;
    const iosMajor = Number.parseInt(osVersion ?? String(Platform.Version), 10);
    const switchBox =
      Number.isFinite(iosMajor) && iosMajor >= 26
        ? { width: 61, height: 28 }
        : { width: 51, height: 31 };

    it('leaves its children the boxes RN gives them', async () => {
      const { unmount } = await mount(
        <View testID="ios-host" style={HUG}>
          <Host style={{ width: 300, height: 140 }}>
            <Toggle id="ios-0" log={log} />
            <Toggle id="ios-1" log={log} />
          </Host>
        </View>
      );
      const host = await boxOf('ios-host');
      const zero = await boxOf('ios-0');
      const one = await boxOf('ios-1');
      // The Host's box is its style (it is a `View`), and the children keep their
      // measured intrinsic boxes.
      expect([Math.round(host.width), Math.round(host.height)]).toEqual([
        300, 140,
      ]);
      expect(Math.round(zero.width)).toBe(switchBox.width);
      expect(Math.round(zero.height)).toBe(switchBox.height);
      // Stacked by RN, in order, below each other.
      expect(one.y).toBeGreaterThan(zero.y);
      unmount();
    });

    it('presses a hosted child where RN put it', async () => {
      const { unmount } = await mount(
        <View testID="ios-tap-host" style={HUG}>
          <Host style={{ width: 300, height: 140 }}>
            <Toggle id="ios-tap-0" log={log} />
          </Host>
        </View>
      );
      const child = await boxOf('ios-tap-0');
      const toggle = await handleOf(log, 'ios-tap-0');
      const hit = await probeAt(
        child.x + child.width / 2,
        child.y + child.height / 2,
        ['ios-tap-0'],
        log
      );
      expect(hit).toBe('ios-tap-0');
      expect(toggle.value).toBe(true);
      unmount();
    });
  });
}

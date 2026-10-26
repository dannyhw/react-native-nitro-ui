/**
 * On-device tests for `<Host>` (task H1).
 *
 * Two jobs. The first is the ordinary one: a control inside a Host is still a
 * control, so its events, its controlled handshake, its `disabled` state and its
 * `testID` must survive being drawn by somebody else's composition. Those cases run
 * on **both** platforms — on iOS a Host is the documented passthrough `View`, so the
 * same file is also the iOS regression that the passthrough must break nothing.
 *
 * The second job is D24 (`docs/DECISIONS.md`, `docs/architecture/sizing.md` §10): a
 * hosted control never measures, its RN frame is decorative, and the Host places its
 * children itself. Those are asserted with **pairs**, never with a single expected
 * number, because a fixture that happens to agree with the answer proves nothing:
 *
 *  - two Hosts that differ *only* in their children's `style.height` must place the
 *    drawing identically (a `height` on a hosted child would separate them);
 *  - a Host shorter than its content and a Host taller than it must disagree about
 *    whether an offset below the box reaches a control (the clip rule);
 *  - children asking for `width: '100%'` must be hit-testable exactly where children
 *    that ask for nothing are (the cross-axis rule);
 *  - a Host whose children's boxes sum to 72 dp is 72 tall, while Compose draws a
 *    taller column (the "no height" rule) — so a Host that measured Compose content,
 *    or that came out 0 tall, both fail.
 *
 * Where a probe is used, the invariant is *monotonicity* ("deeper presses reach later
 * children") rather than a hard-coded row pitch: Compose's row height is Compose's
 * business, and a test that hard-coded it would be a second layout implementation
 * rather than a witness of the one under test.
 */
import { useState } from 'react';
import {
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

type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

/**
 * What `hybridRef` hands back for a Switch. Declared here rather than imported:
 * DECISIONS D14 keeps Hybrid View types off the public surface, and the only reason
 * to read one is diagnostics — here, what a *hosted* control currently displays,
 * which is how a rejected change is visible at all.
 */
type SwitchHandle = {
  readonly value: boolean | null;
  readonly mostRecentEventCount: number;
  readonly disabled: boolean;
};

type Log = {
  /** Every `onValueChange` that reached JS, in order, named by `testID`. */
  events: string[];
  /**
   * The same presses as `id:value`, because what a press *asked for* is the half
   * that proves a reverted control went back to off (the second press asking for
   * `true` again is only meaningful if the first ask was `true` too).
   */
  requests: string[];
  /** The value the app agreed to, per instance. Only written when accepted. */
  accepted: Record<string, boolean>;
  /** Every box the Host reported to `onLayout`. */
  layouts: { width: number; height: number }[];
  handles: Record<string, SwitchHandle>;
  /** JS-side writes, so a test can move a control with no touch at all. */
  write: Record<string, (next: boolean) => void>;
  /** Reorder the children of a list fixture. */
  setIds?: (ids: string[]) => void;
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
 * Poll for a `testID` and hand back its box.
 *
 * `screen.findByTestId` has no timeout (Switch.harness documents why), and a hosted
 * control mounts through the Host's composition — slower than the single pass the
 * harness makes, on a loaded machine.
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
 * Press at an absolute point and report which control answered, or `null`.
 *
 * "Answered" means that instance's `onValueChange` reached JS. On Android the hosted
 * view is `GONE` and outside the touch path, so the only way an answer can arrive is
 * through the Host's composition — which is the property under test, not an
 * assumption. More than one answer per press is a failure in itself (overlapping hit
 * areas between two hosted controls).
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

/** Press an offset inside a box. */
function probeIn(
  box: ViewInfo,
  offsetX: number,
  offsetY: number,
  allowed: string[],
  log: Log
) {
  return probeAt(box.x + offsetX, box.y + offsetY, allowed, log);
}

/**
 * Which of a pair's Hosts a press answered, ignoring the fixture's own prefix.
 *
 * The pairs below differ in exactly one style, so both must answer *the same child*
 * at the same offset — and their ids cannot be compared as they are, because the
 * prefix is what tells the two fixtures apart.
 */
const suffixOf = (hit: string | null): string =>
  hit == null ? 'none' : hit.slice(hit.lastIndexOf('-') + 1);

const reports = (stats: ReturnType<typeof nitroUiCore.sizingStats>) =>
  stats.reportsQueued + stats.reportsDropped + stats.reportsConfirmed;

/**
 * One hosted (or plain) Switch, wired to the log.
 *
 * It holds its own state, so a JS write is a real React state change and a rejected
 * change is a real refusal. `onValueChange` is a fresh closure per render on purpose:
 * apps do that by accident all the time, and a control whose callback is captured by a
 * composition that no longer owns it would show up here.
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

/** A Host whose child list the test can change. */
function HostedList({
  log,
  ids,
  hostStyle,
  childStyle,
}: {
  log: Log;
  ids: string[];
  hostStyle?: ViewStyle;
  childStyle?: ViewStyle;
}) {
  const [current, setCurrent] = useState(ids);
  log.setIds = setCurrent;
  return (
    <Host style={hostStyle}>
      {current.map((id) => (
        <Toggle key={id} id={id} log={log} style={childStyle} />
      ))}
    </Host>
  );
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
   * Where the first hosted control is on each platform.
   *
   * Android: inside the Host, at the column's leading edge, so the press has to go
   * through the Host's `AndroidComposeView`. iOS: the passthrough lays children out as
   * RN views, so the control's own box is the right target. Same question, two honest
   * answers, and the difference is the documented behaviour.
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

    const hit = await pressFirstControl('tap-host', 'tap-0');
    expect(hit).toBe('tap-0');
    expect(log.events).toEqual(['tap-0']);
    expect(log.accepted['tap-0']).toBe(true);
    expect(log.handles['tap-0']?.value).toBe(true);
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
    const first = await pressFirstControl('reject-host', 'reject-0');
    expect(first).toBe('reject-0');
    // The app refused, so the value JS owns never moved — and the control must have
    // been redrawn to match. `mostRecentEventCount` proves a commit happened.
    const afterFirst = log.handles['reject-0'];
    expect(afterFirst?.value).toBe(false);
    expect(log.accepted['reject-0']).toBeUndefined();

    // The revert oracle Switch.harness uses, and the only one that does not trust the
    // handle: a control that had *displayed* the rejected value would report `false`
    // on this second press (its own state moved), and a reverted one reports `true`.
    const eventsAfterFirst = log.events.length;
    const second = await pressFirstControl('reject-host', 'reject-0');
    expect(second).toBe('reject-0');
    expect(log.events.length).toBe(eventsAfterFirst + 1);
    // The oracle Switch.harness uses, and the one that does not trust the handle (a
    // `hybridRef` is a live object, so comparing two reads of it proves nothing): the
    // second press asked for `true` *again*, which is only possible if native had
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
    expect(log.handles['write-0']?.value).toBe(false);
    log.write['write-0']?.(true);
    await settle(400);
    // The control has no view of its own to update on Android: this is the Host's
    // composition recomposing that one child, and the handle is what says so.
    expect(log.handles['write-0']?.value).toBe(true);
    expect(log.events).toEqual([]);
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

    // Reorder: `c` moves to the top and `b` goes away. The drawn order has to follow,
    // which on Android is the per-child `key(child)` scope in the Host's Column.
    log.setIds?.(['list-c', 'list-a']);
    await settle(500);
    expect(await pressFirstControl('list-host', 'list-c')).toBe('list-c');

    // And removing the child that was just pressed must not take the Host with it.
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
          <Toggle id="off-0" log={log} disabled />
        </Host>
      </View>
    );
    await boxOf('off-0');
    expect(log.handles['off-0']?.disabled).toBe(true);
    expect(await pressFirstControl('off-host', 'off-0')).toBeNull();
    expect(log.events).toEqual([]);
    unmount();
  });

  /**
   * `testID` on a hosted child: the harness must still find it.
   *
   * Android keeps the child's `View` alive (`GONE`, drawing nothing) and that view is
   * what carries the id, so this is the query every other suite relies on. Its box is
   * reported for the record — on Android it is RN's frame, not where the control drew,
   * and on iOS it is RN's frame too, because there is no composition to draw instead.
   */
  it('finds a hosted child by testID', async () => {
    const { unmount } = await mount(
      <View testID="find-host" style={HUG}>
        <Host style={{ width: 300, height: 200 }}>
          <Toggle id="find-0" log={log} />
          <Toggle id="find-1" log={log} />
        </Host>
      </View>
    );
    const zero = await boxOf('find-0');
    const one = await boxOf('find-1');
    // Found — which is the contract the harness suites rely on; `boxOf` throws if the
    // id resolves to nothing. What the box says differs by who owns the pixels, and
    // both halves are the point of looking.
    if (Platform.OS === 'android') {
      // *No size at all*: the child's `View` is `GONE` while a Host draws it, so it
      // takes no part in Android's layout or touch dispatch. Its RN frame still exists
      // (the Host is 96 tall, two children's engine boxes) and is simply decorative,
      // which is D24's whole sentence in one measurement.
      expect(Math.round(zero.width)).toBe(0);
      expect(Math.round(zero.height)).toBe(0);
      expect(Math.round(one.width)).toBe(0);
      expect(Math.round(one.height)).toBe(0);
    } else {
      // The passthrough gives its children real views, so the same query finds a child
      // that is laid out and touchable — the zero above is a statement about Compose
      // taking the drawing over, not about `testID` surviving a Host. The exact box is
      // the `Host · iOS passthrough` suite's business; a number here would only be a
      // second copy of it.
      expect(zero.width).toBeGreaterThan(0);
      expect(zero.height).toBeGreaterThan(0);
      expect(one.width).toBeGreaterThan(0);
      expect(one.height).toBeGreaterThan(0);
    }
    unmount();
  });
});

// MARK: - Android: D24

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
     *
     * Sequential on purpose. Two fixtures mounted together share the screen and so
     * share coordinates: a press then answers for whichever Compose view is on top,
     * not for the style under test, and the pair silently compares one fixture with
     * itself. One at a time at the same offsets is the comparison that means something.
     *
     * The vertical sweep sits at x=8 and the horizontal one at y=24: a hosted row is
     * 48 dp tall with the control inside it, so 8 is inside the leading column and 24
     * is inside the first row without leaning on its edge.
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
      // Children whose RN boxes sum to 288, in a Host asked to be 140 tall: the two
      // numbers cannot both be right, and D24 says the style is.
      const { box, unmount } = await mountThree(
        'box-host',
        { width: 260, height: 140 },
        { height: 96 },
        'box'
      );
      expect([Math.round(box.width), Math.round(box.height)]).toEqual([
        260, 140,
      ]);
      // Every box RN reported for the Host is the box its own style asked for (dp
      // round-trip through px, hence the rounding). None of them is the height of the
      // column Compose is drawing, which is 288 dp of children.
      expect(log.layouts.length).toBeGreaterThan(0);
      for (const layout of log.layouts) {
        expect([Math.round(layout.width), Math.round(layout.height)]).toEqual([
          260, 140,
        ]);
      }
      unmount();
    });

    it('with no height, it is the sum of its childrens boxes', async () => {
      // 3 x 24 = 72 for Yoga, ~144 for the Compose column. A Host that measured its
      // content would be ~144, and one that measured nothing at all would be 0; both
      // are far from the 72 D24 predicts.
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
      // A sweep rather than three guesses: the row pitch is Compose's business (see
      // the header), and 8 dp cannot step over a 31 dp touch target.
      const seen: (string | null)[] = [];
      for (let offset = 4; offset <= 140; offset += 8) {
        seen.push(await probeIn(box, 8, offset, ids, log));
      }
      const drawn = seen.filter((hit): hit is string => hit != null);
      // Every child is drawn and hittable…
      expect(new Set(drawn.map((hit) => hit.slice(-1)))).toEqual(
        new Set(['0', '1', '2'])
      );
      // …the first press reaches the first child…
      expect(drawn[0]).toBe('order-0');
      // …and presses never go backwards, which is "a Column in mount order" in
      // observations rather than in pixels.
      const indexes = drawn.map((hit) => Number(hit.slice(-1)));
      const sorted = [...indexes].sort((a, b) => a - b);
      expect(indexes).toEqual(sorted);
      // Below the drawn column, the Host's own box is dead space: RN's box is 240
      // tall and Compose's content is three rows, and nothing claims the difference.
      expect(await probeIn(box, 8, 234, ids, log)).toBeNull();
      unmount();
    });

    it('ignores a hosted child style height when placing the drawing', async () => {
      // The pair: identical Hosts, children 96 tall versus 20 tall. If a child's
      // `height` moved the drawing, the two sweeps would disagree. Compose draws three
      // 48 dp rows either way, so offsets are taken through the column and past it.
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
      // Same Host box, same answers at every offset — for children whose own RN
      // boxes differ by 228 dp in total.
      expect(short.hostBox).toEqual(tall.hostBox);
      expect(short.hits).toEqual(tall.hits);
      // The pair is not vacuous: at least one offset has to reach a control, or
      // "identical" would only mean "nothing is tappable in either".
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
      // Children start at the Host's top edge, so the first row is the first child in
      // a Host of either height…
      expect(shortTop).toBe('short-0');
      expect(tallTop).toBe('clip-0');
      // …and the same lower offset answers in the tall Host and is outside the short
      // one: the box clips what it cannot show, rather than the content pushing the
      // box open or centring itself into it.
      expect(shortLow).toBeNull();
      expect(['clip-1', 'clip-2']).toContain(tallLow);
      tall.unmount();
    });

    it('lets a hosted child ask for the full width without moving the drawing', async () => {
      // The cross-axis pair: `width: '100%'` + `alignSelf: 'stretch'` versus nothing.
      // The style moves the frame RN computes for the child; it must not move the
      // pixels Compose draws, so both Hosts are hit-testable at the same x offsets.
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
      // Not vacuous in either direction: the leading edge reaches a control and the
      // middle of a 300 dp Host does not, so the sweep can tell the two apart.
      expect(stretched.hits).toEqual(['0', 'none', 'none']);
      expect(Math.round(stretched.hostBox.width)).toBe(300);
    });

    it('reports nothing to the sizing engine, while an unhosted control reports', async () => {
      // D24's other half: a hosted control never measures, so it never reports. The
      // same batch unhosted is the positive control that the counters were live.
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
      // What a hosted control never does is report. On a cache this test has just
      // invalidated, eight hosted Switches queue nothing, confirm nothing, drop
      // nothing, write no cache entry and ask Fabric for no correction — which is why
      // D17's first-frame rule has nothing to apply to.
      expect(hostedDelta.reports).toBe(0);
      expect(hostedDelta.cachedSizes).toBe(0);
      expect(hostedDelta.corrections).toBe(0);
      // What hosting does *not* change is the measure call: Fabric still asks each
      // hosted child's Yoga node once for the frame it will not draw, and the engine
      // answers with the size it already believes. Eight children, eight calls, either
      // way — so "hosted controls never measure" is a sentence about content, and this
      // is the line between that claim and a false one.
      expect(hostedDelta.measurements).toBe(8);
      expect(plainDelta.measurements).toBe(8);
      // The witness that the reporting counters could have moved: the same eight
      // controls unhosted report twice each (queued, then confirmed) and eight controls
      // of one configuration learn the size once between them, not eight times.
      expect(plainDelta.reports).toBe(16);
      expect(plainDelta.cachedSizes).toBe(1);
      // `ledgerEntries` is deliberately not asserted: it is a gauge of how many live
      // instances the engine has answered for, so its delta is Fabric's instance-id
      // churn across mounts rather than work done by either fixture.
    });
  });

  /**
   * A Host that is given no height draws nothing.
   *
   * The dev warning is unit-tested in `src/__tests__/host.test.tsx`. This is the
   * on-device half: the box is read from the layout RN actually produced — the
   * sibling below the Host starts where the Host started — rather than from an
   * `onLayout`, which RN does not send for a view it laid out at zero. A rule that
   * only held in the fake case would show up here, and so would a Compose column
   * that overflowed the box it was given.
   */
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
      // The Host took no vertical space: the sibling starts at the row's own top,
      // which is the box RN computed for a Host that measures nothing (D24).
      expect(below.y).toBe(row.y);
      // Nothing is tappable in the space a drawn Switch would have needed, and
      // nothing overflowed into the sibling either: Compose clips to the box.
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

    /** The box a Switch with no style is meant to get on this OS (D14). */
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
      // The Host's box is its style on iOS too (it is a `View`), and the children keep
      // their measured intrinsic boxes — which is exactly what they give up on Android.
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
      const hit = await probeAt(
        child.x + child.width / 2,
        child.y + child.height / 2,
        ['ios-tap-0'],
        log
      );
      expect(hit).toBe('ios-tap-0');
      expect(log.handles['ios-tap-0']?.value).toBe(true);
      unmount();
    });
  });
}

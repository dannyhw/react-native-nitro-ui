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
import { Host, Picker, Switch, nitroUiCore } from 'react-native-nitro-ui';

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
  /** Change a fixture's `disabled` after mount. */
  setDisabled?: (next: boolean) => void;
  /** Change which of a list fixture's children are `display: none`. */
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
 * "Answered" means that instance's `onValueChange` reached JS. On Android a hosted
 * control declines to measure, so its own view is laid out at `0 x 0` — not a hit
 * target, and not visible-to-user (review S1 corrects an earlier draft that called it
 * `GONE`: Fabric re-asserts `VISIBLE` on that view every layout pass). The only way an
 * answer can arrive is therefore through the Host's composition, which is the property
 * under test rather than an assumption. More than one answer per press is a failure in
 * itself (overlapping hit areas between two hosted controls).
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

/**
 * A Switch the test can enable after mount.
 *
 * A `disabled` assertion that only ever presses a disabled control passes for a Host
 * that drew nothing at all, so the fixture has to be able to answer: same box, same
 * press, one prop different (review S6).
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
   * Make the last child refuse every press it receives.
   *
   * A refused press still reaches `onValueChange`, so the child keeps answering probes,
   * but its value cannot drift: press it ten times and it is still whatever JS last
   * wrote. That is what lets a case ask "what is the drawing showing?" with a press.
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
 * A hosted Switch whose own `style` a test can change after mount.
 *
 * Only the child's own metrics make Fabric emit a layout update for that child: growing a
 * sibling re-lays the screen without touching it, so `updateLayout` never runs again for
 * it and a test built on that never exercises the second pass it claims to (review M2).
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

/** `[width, height, x, y]`, rounded — the shape every box assertion in this file uses. */
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
    // The handle records the write, but a handle is the model's last JS prop, not what
    // is drawn: a Host whose composition never recomposed would read the same here
    // (review S6). The press is the witness — a Switch still showing `false` would ask
    // for `true`, and only one showing `true` asks to go back.
    expect(log.handles['write-0']?.value).toBe(true);
    expect(log.events).toEqual([]);
    expect(await pressFirstControl('write-host', 'write-0')).toBe('write-0');
    expect(log.requests).toEqual(['write-0:false']);
    expect(log.handles['write-0']?.value).toBe(false);
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

    // Add: a child that was never mounted has to become drawable, which is the brief's
    // "added" and something the two steps above cannot show (review S6). `list-d` joins
    // at the end, so a sweep that reaches it means the Host composed a child it did not
    // have at mount, in the order the app asked for.
    log.setIds?.(['list-c', 'list-a', 'list-d']);
    await settle(500);
    const addedBox = frame(await boxOf('list-d'));
    // A child Fabric laid out *after* the Host mounted is F8 from the other side, and it
    // behaves as one re-framed later does: on Android the frame Yoga computed reaches its
    // `View` (measured `[52, 48, 0, 96]` — the engine box, third row), while a child the
    // Host drew from the start keeps the `[0, 0, 0, 0]` it mounted with. Which of the two
    // it is does not matter to the reader: the box is the engine's frame, never the drawn
    // rect, which is the `testID` caveat in docs/components/host.md.
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

    // And removing every child but one must not take the Host with it.
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
    expect(log.handles['off-0']?.disabled).toBe(true);
    expect(await pressFirstControl('off-host', 'off-0')).toBeNull();
    expect(log.events).toEqual([]);

    // A Host that drew nothing would answer `null` forever, so the same press has to
    // answer once the control is enabled: the first `null` was the Switch refusing,
    // not the composition being missing (review S6).
    log.setDisabled?.(false);
    await settle(400);
    expect(await pressFirstControl('off-host', 'off-0')).toBe('off-0');
    expect(log.requests).toEqual(['off-0:true']);
    unmount();
  });

  /**
   * `testID` on a hosted child: the harness must still find it — and what its box
   * means, which is the caveat an E2E tool needs (review S8).
   *
   * Android keeps the child's `View` alive and that view is what carries the id, so
   * this is the query every other suite relies on. The box it reports is *not* where
   * the control is: the child is laid out at `0 x 0` at the Host's origin, so a tool
   * that taps the centre of the `testID` view taps nothing. Inside a Host, find hosted
   * controls by `accessibilityLabel` (docs/components/host.md).
   */
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
    // Found — which is the contract the harness suites rely on; `boxOf` throws if the
    // id resolves to nothing. What the box says differs by who owns the pixels, and
    // both halves are the point of looking.
    if (Platform.OS === 'android') {
      // *No size at all*: the child declines to measure while a Host draws it, so it is
      // laid out at nothing and is neither a hit target nor visible-to-user. Its RN
      // frame still exists (the Host is 96 tall, two children's engine boxes) and is
      // simply decorative, which is D24's whole sentence in one measurement.
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
    // Whether a *later* layout pass changes that answer is the F8 case below; on Android
    // it does, and into the child's engine frame rather than the drawing's rect.
    unmount();
  });

  /**
   * F8: a hosted child's box after a later Fabric layout pass *over that child*.
   *
   * The first version of this case grew a sibling's height and read the child again. That
   * never exercised anything: Fabric emits a layout update for a node whose own metrics
   * changed, so a sibling's height runs no `updateLayout` for the hosted child and the
   * `[0, 0, 0, 0]` passed whatever the answer turned out to be (review M2). Here the
   * child's own `style` changes instead, 120 x 44 to 160 x 60 — a real second pass over
   * the same `View`.
   *
   * Measured on Android inside a 300 x 200 Host at the window origin:
   *
   *  - at mount the child reads `[0, 0, 0, 0]`, which is what the docs said;
   *  - after the re-frame it reads `[160, 60, 0, 48]` — **its own Yoga frame**. F8 is
   *    real: the next layout update lays the child out at the frame Yoga computed, so a
   *    hosted child's `testID` box is not permanently zero. (A child *added* later is the
   *    same story: `list-d` in the case above reads `[52, 48, 0, 96]`.)
   *  - what did not move is the drawing: the same x offsets down the column answered
   *    before the re-frame and after it, and the drawing still stops at the control —
   *    60 dp inside a box 160 wide.
   *    That reading is Android's, because the probe reads the composition's row band:
   *    on iOS the passthrough draws every child into its own view, so a child's box is
   *    its drawing and the probe would compare a rectangle with itself. The iOS branch
   *    reads the other half of the same case — the child is laid out at its Yoga frame
   *    before the re-frame and at the new one after it.
   *
   * So the caveat is not "a hosted child's box is nothing", it is "a hosted child's box
   * is the engine's frame, not the drawn one" — sometimes zero, sometimes a plausible
   * rectangle that is 108 dp of box around a 52 x 32 control. Both readings send a test
   * tool to `accessibilityLabel` instead (`docs/components/host.md`).
   */
  it('lays a re-framed hosted child at its Yoga frame, not its drawing (F8)', async () => {
    const { unmount } = await mount(
      <View testID="f8-host" style={HUG}>
        <Host testID="f8-box" style={{ width: 300, height: 200 }}>
          <Toggle id="f8-0" log={log} />
          <Resizer id="f8-sized" log={log} />
        </Host>
      </View>
    );
    /**
     * Which x offsets, down the second row's band, answer the hosted Switch.
     *
     * A pair, not a number: Compose's row pitch and the drawn control's width are
     * Compose's business, so this asks where the drawing answers and compares two moments.
     */
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
    // The column probe reads the composition's row band inside the Host box, which is
    // only where the Host draws; on iOS the box and the drawing are the same rectangle.
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
      // F8: the child's own engine box, in the row Yoga put it in.
      expect(sizedAfter).toEqual([160, 60, 0, 48]);
      // A child nobody re-framed keeps the mount answer, so this is per-child and not a
      // Host-wide revival of the children's frames.
      expect(frame(await boxOf('f8-0'))).toEqual([0, 0, 0, 0]);
      // And the new box is still not the drawn rect: the drawing stops at the control,
      // 60 dp short of a box 160 wide.
      const widest = drawnBefore.at(-1) ?? 0;
      expect(widest).toBeLessThan((sizedAfter[0] ?? 0) - 60);
    } else {
      // The passthrough gives the child a real view, so its box is its Yoga frame before
      // the re-frame and after it — and on iOS that frame is where the control is drawn.
      expect(sizedBefore.slice(0, 2)).toEqual([120, 44]);
      expect(sizedAfter.slice(0, 2)).toEqual([160, 60]);
      expect(Math.round((await boxOf('f8-0')).width)).toBeGreaterThan(0);
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

    /**
     * `padding` on a Host moves the drawing, not just the box (review S3).
     *
     * The pair is sequential like every other pair here: the same sweep of offsets on
     * an unpadded Host and on one with 32 dp of `paddingVertical`. Vertical only,
     * because a sweep presses at a fixed x — a left padding would move the drawing out
     * from under every press in it, which is the same fact told badly (it was the first
     * version of this test, and it failed for exactly that reason). If `setPadding`
     * never reaches the view (the base `ViewManager` setter is a no-op), the padded
     * Host answers at the top edge exactly like the plain one.
     */
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
      // Both draw all three rows, so the difference is a shift and not a Host that
      // stopped composing. A sweep is allowed to fall in the dead band between two
      // rows — that is why the comparison below is about *which* offset first bites.
      expect(drawn(plain.hits)).toEqual(new Set(['0', '1', '2']));
      expect(drawn(padded.hits)).toEqual(new Set(['0', '1', '2']));
      const firstHitOffset = (hits: string[]) => {
        const index = hits.findIndex((hit) => hit !== 'none');
        return index < 0 ? Number.POSITIVE_INFINITY : (offsets[index] ?? 0);
      };
      // The plain drawing is reachable above the padding and the padded one is not:
      // 8 dp into a padded Host is padding, and 8 dp into a plain one is row 0.
      expect(firstHitOffset(plain.hits)).toBeLessThan(32);
      expect(firstHitOffset(padded.hits)).toBeGreaterThanOrEqual(32);
      // And the box is the same either way — padding is inside the Host's own height.
      expect(padded.hostBox).toEqual(plain.hostBox);
    });

    /**
     * `display: 'none'` on a hosted child takes it out of the drawing too (S2).
     *
     * A Host draws its children, so RN's hiding cannot be honoured by hiding a view
     * that draws nothing anyway: the child has to leave the composition. The witness
     * is that the hidden child is not tappable *and the shown child still is* — a Host
     * that drew nothing at all would pass the first half alone.
     */
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
      // Show it and the same sweep reaches both. Before the fix the *first* sweep
      // already reached `hidden-b`, because the composition never looked at `display`.
      hiddenLog.setHidden?.(false);
      await settle(500);
      expect(await sweep()).toEqual(['hidden-a', 'hidden-b']);
      unmount();
    });

    /**
     * S2's other half: a value a hosted child is given *while it is hidden* has to be
     * what the child draws when it comes back.
     *
     * Hiding takes a hosted child out of the composition, so the write lands on a
     * control with no Compose state behind it. An implementation that composed the child
     * from the value it happened to have when it was hidden — or that skipped the write
     * because nothing was listening — shows the old thumb position the moment `display`
     * flips back, which is a silently wrong control on the screen the app returns to.
     *
     * The oracle is a press on the last child with `refuseLast`: JS never accepts it, so
     * the value can only be the one the test wrote. A drawing that caught the write is ON
     * and therefore reports `false`; a drawing that did not is OFF and reports `true`.
     */
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

      // The write, while `display: none` still hides the child.
      s2Log.write['s2-b']?.(true);
      await settle(500);
      // JavaScript has the value and sent the prop; that half is easy and only the
      // premise. (Read off the handle rather than `accepted`: this is a JS write, which
      // never passes through `onValueChange`.)
      expect(s2Log.handles['s2-b']?.value).toBe(true);

      // Hidden is still hidden: a value change must not put the child back in the
      // drawing, so the only answer a sweep can get is from the shown child.
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

      // Show it. The child that comes back has to be the one JS wrote.
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

  /**
   * What a Host will not compose, and how loudly it says so (review M2, S5).
   *
   * JS refuses the children it can name. It cannot see through a component, so
   * `memo(() => <Picker />)` arrives as an unknown child and the native allowlist is
   * the only rule left — and in round 1 there was none, so it composed the Picker.
   * The report was a `Log.w`, which is a line no app author reads, so these cases
   * assert that JavaScript hears about it too.
   */
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

    /** A control behind a component, which is what JS cannot see through. */
    const WrappedPicker = memo(function PickerBehindMemo() {
      return (
        <Picker
          options={['Cinder', 'Mica', 'Shale']}
          defaultSelectedIndex={0}
          testID="wrapped-picker"
        />
      );
    });

    /**
     * The two other shapes the review named (M2). `forwardRef` hands React a third
     * element type, and a plain function component is what most apps actually write.
     * Each is opaque to JS in its own way, so each has to be caught by the native rule
     * rather than the JS one. The ref is deliberately not handed on: none of this
     * library's controls accept one, and what matters here is the element type the
     * Host is handed.
     */
    const PickerThroughForwardRef = forwardRef<View>(
      function PickerBehindForwardRef(_props, _ref) {
        return (
          <Picker
            options={['Cinder', 'Mica', 'Shale']}
            defaultSelectedIndex={0}
            testID="wrapped-picker-forwarded"
          />
        );
      }
    );

    function PickerFromUserComponent() {
      return (
        <Picker
          options={['Cinder', 'Mica', 'Shale']}
          defaultSelectedIndex={0}
          testID="wrapped-picker-user"
        />
      );
    }

    it('will not compose a control behind a component, and tells JS', async () => {
      const refused: Report[] = [];
      const subscription = listen(refused);
      try {
        const { unmount } = await mount(
          <View testID="refuse-host" style={HUG}>
            <Host style={{ width: 300, height: 140 }}>
              <WrappedPicker />
              <PickerThroughForwardRef />
              <PickerFromUserComponent />
            </Host>
          </View>
        );
        // The Picker's view exists — it is a Fabric node like any other — but nobody
        // composed it, and it declined to measure, so it is nothing. That holds for
        // every shape the control hides behind, not only the one JS would unwrap.
        const boxes: string[] = [];
        for (const testId of [
          'wrapped-picker',
          'wrapped-picker-forwarded',
          'wrapped-picker-user',
        ]) {
          const picker = await boxOf(testId);
          boxes.push(
            `${testId}=${String(Math.round(picker.width))}x${String(
              Math.round(picker.height)
            )}`
          );
        }
        expect(boxes).toEqual([
          'wrapped-picker=0x0',
          'wrapped-picker-forwarded=0x0',
          'wrapped-picker-user=0x0',
        ]);
        // Nothing in the Host's box answers: there is no composition there to press.
        const host = await boxOf('refuse-host');
        for (const offset of [24, 60, 100]) {
          expect(await probeIn(host, 8, offset, [], log)).toBeNull();
        }
        // And the refusal reached JavaScript, naming the control (S5: not logcat). One
        // report per refused child is the proof that all three shapes reached the
        // native rule rather than being dropped without a word.
        expect(
          refused.filter((report) => /Picker/.test(report.message ?? '')).length
        ).toBe(3);
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

    /**
     * A `<Host>` inside a `<Host>` is refused in JS when JS can see it. Behind a
     * component it is the native allowlist that refuses it — and a Host is a
     * `NitroComposeHost` like any control, so this is the child that had no rule at
     * all in round 1 (M2, and the orchestrator's answer to the nesting question is
     * "refused").
     */
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

  /**
   * A Host that is given no height draws nothing.
   *
   * The dev warning is unit-tested in `src/__tests__/host.test.tsx`. This is the
   * on-device half: the box is read from the layout RN actually produced — the
   * sibling below the Host starts where the Host started — rather than from the
   * Host's own `onLayout`. Fabric does report a zero-height layout (an earlier draft
   * of these docs claimed it does not), but a sibling's frame is the measurement that
   * does not need the Host to say anything about itself. A rule that only held in the
   * fake case would show up here, and so would a Compose column that overflowed the
   * box it was given.
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

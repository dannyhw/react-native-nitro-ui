/**
 * On-device tests for the ContextMenu (task G16; design Q6 Appendix F1, spike S3).
 *
 * A ContextMenu is a `View` around React Native children that opens a menu on a long
 * press, so the suite has three halves:
 *
 * - **The box.** It must lay out exactly like a `View` with the same style - Yoga's box,
 *   and the children where Yoga put them. The oracle is a twin `View`, never a constant,
 *   and the child positions are read from the native views themselves (`kids=` in the
 *   report, and HarnessUI's own frames), because Yoga's numbers are the same whatever
 *   the native mount does (D36 item 5: the iOS content-children patch would draw a padded
 *   ContextMenu's children twice inset).
 * - **The gesture.** A held press goes through `userEvent.longPressAt` - the
 *   `@react-native-harness/ui` patch D36 item 2 asked for (`docs/upstream.md` H11) - with
 *   real timing on both platforms, so there is no synchronous stand-in for the long-press
 *   timeout. A tap is `userEvent.press`. What a person would see is React's own counters.
 * - **The menu.** A row in a popup is out of the injector's reach (it is not the app's
 *   window), so picks go through `nuiTestSelectRow`, the path a row press takes; the rest
 *   is read from `nuiTestContextMenuReport` (`ContextMenu.nitro.ts` says what each field
 *   means and which platform answers it).
 *
 * Platform splits are stated where they happen: the anchor, the layout-move rule, the
 * gesture slot's arm count and the a11y action are Android's; the `UIMenu` tree, the
 * interaction and the accessible-wrapper getter are iOS's.
 */
import type { ReactElement } from 'react';
import {
  PixelRatio,
  Platform,
  Pressable,
  Text,
  TurboModuleRegistry,
  View,
} from 'react-native';
import {
  afterEach,
  beforeEach,
  cleanup,
  describe,
  expect,
  it,
  render,
} from 'react-native-harness';
import { screen, userEvent } from '@react-native-harness/ui';
import { ContextMenu, type MenuGroup } from 'react-native-nitro-ui';

const IOS = Platform.OS === 'ios';

type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

/** What `hybridRef` hands back - declared, not imported (DECISIONS D14). */
type Handle = {
  readonly disabled: boolean;
  readonly title: string | null;
  readonly previewCornerRadius: number | null;
  nuiTestSelectRow(id: string): void;
  nuiTestMenuProbe(): void;
  nuiTestContextMenuReport(): string;
  nuiTestA11yLongClick(): void;
};

const handles = new Map<string, Handle>();
const capture =
  (testId: string) =>
  (view: Handle): void => {
    handles.set(testId, view);
  };

/** Every event the app heard, in arrival order, as `<testID>:<event>`. */
const events: string[] = [];
const record = (testId: string) => ({
  onOpen: () => events.push(`${testId}:open`),
  onClose: () => events.push(`${testId}:close`),
  onSelect: (id: string) => events.push(`${testId}:select:${id}`),
});
/** The inner `Pressable`'s own callbacks, counted by kind. */
const presses: Record<string, number> = {};
const bump = (key: string) => (): void => {
  presses[key] = (presses[key] ?? 0) + 1;
};
const count = (key: string): number => presses[key] ?? 0;
const eventsOf = (testId: string): string[] =>
  events
    .filter((e) => e.startsWith(`${testId}:`))
    .map((e) => e.slice(testId.length + 1));

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(
  what: string,
  ok: () => boolean,
  timeoutMs = 5000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!ok()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

async function handleFor(testId: string): Promise<Handle> {
  await until(`the hybridRef of "${testId}"`, () => handles.has(testId));
  return handles.get(testId)!;
}

/** The report as `key -> value`. */
function parse(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of line.split(';')) {
    const at = pair.indexOf('=');
    if (at > 0) out[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return out;
}

/**
 * The report once it satisfies `ok`: the native side publishes it on the UI thread and
 * each read asks for a fresh one, so a read can trail the event it is about.
 */
async function reportWhen(
  testId: string,
  ok: (r: Record<string, string>) => boolean,
  what: string,
  timeoutMs = 5000
): Promise<Record<string, string>> {
  const handle = await handleFor(testId);
  const deadline = Date.now() + timeoutMs;
  let report = parse(handle.nuiTestContextMenuReport());
  while (!ok(report)) {
    if (Date.now() > deadline) {
      throw new Error(
        `${what}: the report never got there - ${handle.nuiTestContextMenuReport()}`
      );
    }
    await sleep(50);
    report = parse(handle.nuiTestContextMenuReport());
  }
  return report;
}

/** The report after it has had time to settle (two reads 150 ms apart). */
async function settledReport(testId: string): Promise<Record<string, string>> {
  const handle = await handleFor(testId);
  handle.nuiTestContextMenuReport();
  await sleep(150);
  return parse(handle.nuiTestContextMenuReport());
}

function box(testId: string): ViewInfo {
  const info = harnessUi.queryByTestId(testId);
  if (info == null) throw new Error(`no view "${testId}" on screen`);
  return info;
}

/** A point inside a view, as fractions of its box (screen points / dp). */
function pointIn(testId: string, fx: number, fy: number) {
  const b = box(testId);
  return { x: b.x + b.width * fx, y: b.y + b.height * fy };
}

/** Hold at a point for `ms` (real timing), then wait for the app to hear `open`. */
async function holdAt(
  testId: string,
  fx: number,
  fy: number,
  ms = 1000
): Promise<void> {
  const at = pointIn(testId, fx, fy);
  await userEvent.longPressAt(at.x, at.y, ms);
}

async function openedBy(testId: string, fx = 0.3, fy = 0.4): Promise<void> {
  await holdAt(testId, fx, fy);
  await until(`"${testId}" to open`, () =>
    eventsOf(testId.replace(/-target$/, '')).includes('open')
  );
}

const GROUP: MenuGroup = {
  actions: [
    { id: 'reply', title: 'Reply' },
    { id: 'copy', title: 'Copy' },
    { id: 'pin', title: 'Pin', disabled: true },
    {
      id: 'more',
      title: 'More',
      items: [
        { id: 'archive', title: 'Archive' },
        { id: 'mail', title: 'Mail' },
      ],
    },
  ],
  sections: [
    { id: 'tools', title: 'Tools', items: [{ id: 'flag', title: 'Flag' }] },
    {
      id: 'danger',
      items: [{ id: 'delete', title: 'Delete', destructive: true }],
    },
  ],
};
/** What the menu built from {@link GROUP} is, in Menu's `drawn` notation. */
const GROUP_DRAWN =
  'Reply,Copy,Pin~,{More:Archive,Mail},(Tools:Flag),(:Delete!)';
/** Its pickable rows: 7 actions, the submenu's own row not among them. */
const GROUP_ROWS = '7';

const GROWN: MenuGroup = {
  actions: [...(GROUP.actions ?? []), { id: 'later', title: 'Later' }],
  sections: GROUP.sections,
};

/** A ContextMenu around one `Pressable`, recorded under `testId`. */
function Message({
  testId,
  group = GROUP,
  disabled = false,
  accessible,
  label,
  above = 0,
}: {
  testId: string;
  group?: MenuGroup;
  disabled?: boolean;
  accessible?: boolean;
  label?: string;
  above?: number;
}): ReactElement {
  return (
    <View style={{ paddingTop: 24, paddingHorizontal: 16 }}>
      <View style={{ height: above }} />
      <ContextMenu
        testID={testId}
        group={group}
        disabled={disabled}
        accessible={accessible}
        accessibilityLabel={label}
        style={{ padding: 12, borderRadius: 16, backgroundColor: '#eef' }}
        hybridRef={capture(testId)}
        {...record(testId)}
      >
        <Pressable
          testID={`${testId}-target`}
          onPress={bump(`${testId}:press`)}
          onPressIn={bump(`${testId}:pressIn`)}
          onPressOut={bump(`${testId}:pressOut`)}
          style={{ height: 96, backgroundColor: '#cde' }}
        >
          <Text>Hold this message</Text>
        </Pressable>
      </ContextMenu>
    </View>
  );
}

beforeEach(() => {
  events.length = 0;
  for (const key of Object.keys(presses)) delete presses[key];
  handles.clear();
});

afterEach(() => {
  cleanup();
});

describe('ContextMenu · the box', () => {
  it('lays out like a View with the same style, children in place', async () => {
    const style = {
      padding: 12,
      borderWidth: 2,
      borderColor: '#88a',
      alignSelf: 'flex-start',
    } as const;
    await render(
      <View style={{ paddingTop: 40, paddingLeft: 24, gap: 16 }}>
        <ContextMenu
          testID="mount-box"
          group={GROUP}
          style={style}
          hybridRef={capture('mount-box')}
        >
          <View
            testID="mount-child"
            style={{ width: 100, height: 40, backgroundColor: '#fc9' }}
          />
        </ContextMenu>
        <View testID="twin-box" style={style}>
          <View
            testID="twin-child"
            style={{ width: 100, height: 40, backgroundColor: '#fc9' }}
          />
        </View>
      </View>
    );
    await until('both boxes', () => {
      return (
        harnessUi.queryByTestId('mount-child') != null &&
        harnessUi.queryByTestId('twin-child') != null
      );
    });
    await sleep(300);
    const menuBox = box('mount-box');
    const twinBox = box('twin-box');
    const child = box('mount-child');
    const twinChild = box('twin-child');
    const report = await settledReport('mount-box');
    console.log(
      `    · box=${String(menuBox.width)}x${String(menuBox.height)} twin=` +
        `${String(twinBox.width)}x${String(twinBox.height)} child@` +
        `${String(child.x - menuBox.x)},${String(child.y - menuBox.y)} twinChild@` +
        `${String(twinChild.x - twinBox.x)},${String(twinChild.y - twinBox.y)} ` +
        `native kids=${report.kids} contentIndex=${report.contentIndex}`
    );
    // The box is the twin's.
    expect(Math.abs(menuBox.width - twinBox.width)).toBeLessThan(0.6);
    expect(Math.abs(menuBox.height - twinBox.height)).toBeLessThan(0.6);
    // And the child sits where the twin's does - read from the native frames, which is
    // what a double inset would move.
    expect(
      Math.abs(child.x - menuBox.x - (twinChild.x - twinBox.x))
    ).toBeLessThan(0.6);
    expect(
      Math.abs(child.y - menuBox.y - (twinChild.y - twinBox.y))
    ).toBeLessThan(0.6);
    // The native side agrees: one React Native child, at the twin's offset, and the
    // menu's own view (iOS content view, Android compose host) is the last subview.
    const [kid] = (report.kids ?? '').split('|');
    const frame = (kid ?? '').split('@')[1]?.split(',').map(Number) ?? [];
    expect(kid?.startsWith('mount-child@')).toBe(true);
    expect(Math.abs((frame[0] ?? -1) - (twinChild.x - twinBox.x))).toBeLessThan(
      0.6
    );
    expect(Math.abs((frame[1] ?? -1) - (twinChild.y - twinBox.y))).toBeLessThan(
      0.6
    );
    const [index, total] = (report.contentIndex ?? '').split('/').map(Number);
    expect(index).toBe((total ?? 0) - 1);
  });

  it('keeps the children in React order through 50 rounds of churn', async () => {
    function Churn({ ids }: { ids: number[] }): ReactElement {
      return (
        <ContextMenu
          testID="churn"
          group={GROUP}
          style={{ marginTop: 40, borderWidth: 1 }}
          hybridRef={capture('churn')}
        >
          {ids.map((id) => (
            <View
              key={id}
              testID={`c${String(id)}`}
              style={{ height: 6, marginBottom: 2, backgroundColor: '#9cf' }}
            />
          ))}
        </ContextMenu>
      );
    }
    let ids = [0, 1, 2, 3, 4];
    const { rerender } = await render(<Churn ids={ids} />);
    let bad = '-';
    let ok = 0;
    for (let round = 1; round <= 50; round += 1) {
      // Deterministic: drop one, insert one, rotate.
      const next = ids.filter((id) => id % 7 !== round % 7);
      next.push(100 + round);
      const shift = round % next.length;
      ids = [...next.slice(shift), ...next.slice(0, shift)].slice(0, 5);
      await rerender(<Churn ids={ids} />);
      const js = ids.map((id) => `c${String(id)}`).join(',');
      let native = '';
      const deadline = Date.now() + 1500;
      for (;;) {
        const report = parse(
          (await handleFor('churn')).nuiTestContextMenuReport()
        );
        native = (report.kids ?? '')
          .split('|')
          .map((k) => k.split('@')[0])
          .join(',');
        const [index, total] = (report.contentIndex ?? '')
          .split('/')
          .map(Number);
        if (native === js && index === (total ?? 0) - 1) break;
        if (Date.now() > deadline) break;
        await sleep(40);
      }
      if (native === js) ok += 1;
      else if (bad === '-') bad = `r${String(round)}:js=${js}:native=${native}`;
    }
    console.log(`    · churn ok=${String(ok)}/50 firstBad=${bad}`);
    expect(bad).toBe('-');
  });
});

describe('ContextMenu · the gesture', () => {
  it('lets a tap through to the child, and opens nothing', async () => {
    await render(<Message testId="tap" />);
    await handleFor('tap');
    await userEvent.press(await screenRef('tap-target'));
    await until('the press', () => count('tap:press') === 1);
    // Longer than the long-press timeout on both platforms (Android 400 ms, iOS ~740).
    await sleep(1200);
    expect(count('tap:press')).toBe(1);
    expect(eventsOf('tap')).toEqual([]);
    const report = await settledReport('tap');
    expect(report.opens).toBe('0');
  });

  it('opens on a hold, never presses the child, picks then closes, and the next tap presses once', async () => {
    await render(<Message testId="hold" />);
    await handleFor('hold');
    await holdAt('hold-target', 0.3, 0.4);
    await until('the open', () => eventsOf('hold').includes('open'));
    await sleep(300);
    console.log(
      `    · after the hold: pressIn=${String(count('hold:pressIn'))} pressOut=` +
        `${String(count('hold:pressOut'))} press=${String(count('hold:press'))} ` +
        `events=${eventsOf('hold').join(',')}`
    );
    // The cancel: the `Pressable` saw the touch begin and end, and never pressed.
    expect(count('hold:press')).toBe(0);
    expect(count('hold:pressIn')).toBe(1);
    expect(count('hold:pressOut')).toBe(1);
    const open = await reportWhen('hold', (r) => r.open === '1', 'open');
    expect(open.opens).toBe('1');
    // A pick reports the choice, then the close (D32), exactly once each.
    (await handleFor('hold')).nuiTestSelectRow('copy');
    await until('the close', () => eventsOf('hold').includes('close'));
    await sleep(300);
    expect(eventsOf('hold')).toEqual(['open', 'select:copy', 'close']);
    await reportWhen('hold', (r) => r.open === '0', 'closed');
    // No stuck responder: a fresh tap presses exactly once, and opens nothing.
    await userEvent.press(await screenRef('hold-target'));
    await until('the fresh press', () => count('hold:press') === 1);
    await sleep(900);
    expect(count('hold:press')).toBe(1);
    expect(eventsOf('hold')).toEqual(['open', 'select:copy', 'close']);
  });

  it('opens the inner of two nested ContextMenus only', async () => {
    await render(
      <View style={{ paddingTop: 40, paddingHorizontal: 16 }}>
        <ContextMenu
          testID="outer"
          group={{ actions: [{ id: 'o', title: 'Outer' }] }}
          style={{ padding: 16, backgroundColor: '#fee' }}
          hybridRef={capture('outer')}
          {...record('outer')}
        >
          <Text>outer</Text>
          <ContextMenu
            testID="inner"
            group={{ actions: [{ id: 'i', title: 'Inner' }] }}
            style={{ height: 96, marginTop: 8, backgroundColor: '#fcc' }}
            hybridRef={capture('inner')}
            {...record('inner')}
          >
            <Text>inner</Text>
          </ContextMenu>
        </ContextMenu>
      </View>
    );
    await handleFor('inner');
    await holdAt('inner', 0.4, 0.6);
    await until('the inner open', () => eventsOf('inner').includes('open'));
    await sleep(500);
    expect(eventsOf('inner')).toEqual(['open']);
    expect(eventsOf('outer')).toEqual([]);
    (await handleFor('inner')).nuiTestSelectRow('i');
    await until('the inner close', () => eventsOf('inner').includes('close'));
  });

  it('when disabled, opens nothing and the child keeps the gesture', async () => {
    await render(
      <View>
        <Message testId="off" disabled />
        <Message testId="on" />
      </View>
    );
    await handleFor('off');
    await handleFor('on');
    // A tap on each: an enabled ContextMenu arms a long press for it (Android), a
    // disabled one does not - the barrier twin that says the tap reached both.
    await userEvent.press(await screenRef('off-target'));
    await userEvent.press(await screenRef('on-target'));
    await until('both presses', () => {
      return count('off:press') === 1 && count('on:press') === 1;
    });
    if (!IOS) {
      const off = await settledReport('off');
      const on = await settledReport('on');
      expect(off.arms).toBe('0');
      expect(on.arms).toBe('1');
    } else {
      // iOS refuses in the configuration provider: no tree to hand UIKit.
      (await handleFor('off')).nuiTestMenuProbe();
      await reportWhen('off', (r) => r.drawn === 'nil', 'a refused probe');
    }
    // And a hold: the child presses on release (it has no `onLongPress`), no menu.
    await holdAt('off-target', 0.5, 0.5);
    await until('the disabled hold to press', () => count('off:press') === 2);
    await sleep(500);
    expect(eventsOf('off')).toEqual([]);
  });
});

describe('ContextMenu · the menu', () => {
  it('builds the rows Menu builds: nested, sections, destructive, disabled', async () => {
    await render(<Message testId="tree" />);
    const handle = await handleFor('tree');
    if (IOS) {
      handle.nuiTestMenuProbe();
      const report = await reportWhen(
        'tree',
        (r) => r.drawn !== '-1',
        'the probe'
      );
      console.log(`    · drawn=${report.drawn}`);
      expect(report.drawn).toBe(GROUP_DRAWN);
      expect(report.rows).toBe(GROUP_ROWS);
    } else {
      // Android has no second renderer: the popup's own composition is what counts.
      handle.nuiTestA11yLongClick();
      const report = await reportWhen('tree', (r) => r.open === '1', 'open');
      const composed = await reportWhen(
        'tree',
        (r) => r.menu !== '-1',
        'the popup witness'
      );
      console.log(`    · rows=${composed.rows} menu=${composed.menu}`);
      expect(report.drawn).toBe('-1');
      expect(composed.rows).toBe(GROUP_ROWS);
      handle.nuiTestSelectRow('reply');
      await reportWhen('tree', (r) => r.open === '0', 'closed');
    }
  });

  it('refuses a disabled row and an unknown id, and still closes', async () => {
    await render(<Message testId="refuse" />);
    const handle = await handleFor('refuse');
    await openedBy('refuse-target');
    handle.nuiTestSelectRow('pin');
    await until('the close', () => eventsOf('refuse').includes('close'));
    // The barrier: a real row picks, so the refusal above was not a pick still in flight.
    await openedBy('refuse-target');
    handle.nuiTestSelectRow('reply');
    await until('the second close', () => {
      return eventsOf('refuse').filter((e) => e === 'close').length === 2;
    });
    await sleep(200);
    expect(eventsOf('refuse')).toEqual([
      'open',
      'close',
      'open',
      'select:reply',
      'close',
    ]);
  });

  it('closes an open menu when it becomes disabled, and applies a group change live', async () => {
    function Live({
      disabled,
      group,
    }: {
      disabled: boolean;
      group: MenuGroup;
    }): ReactElement {
      return <Message testId="live" disabled={disabled} group={group} />;
    }
    const { rerender } = await render(<Live disabled={false} group={GROUP} />);
    await handleFor('live');
    await openedBy('live-target');
    await rerender(<Live disabled={false} group={GROWN} />);
    if (!IOS) {
      // The popup recomposed with the new rows, and stayed up.
      const grown = await reportWhen(
        'live',
        (r) => r.rows === '8',
        'the grown popup'
      );
      expect(grown.open).toBe('1');
    } else {
      (await handleFor('live')).nuiTestMenuProbe();
      await reportWhen(
        'live',
        (r) =>
          (r.drawn ?? '').startsWith(
            'Reply,Copy,Pin~,{More:Archive,Mail},Later'
          ),
        'the grown tree'
      );
      expect(
        parse((await handleFor('live')).nuiTestContextMenuReport()).open
      ).toBe('1');
    }
    expect(eventsOf('live')).toEqual(['open']);
    await rerender(<Live disabled group={GROWN} />);
    await until('the disabled close', () => eventsOf('live').includes('close'));
    await reportWhen('live', (r) => r.open === '0', 'closed');
    expect(eventsOf('live')).toEqual(['open', 'close']);
  });

  it('closes an open menu that a layout moves (Android: the popup follows its anchor)', async () => {
    if (IOS) {
      console.log(
        '    · iOS: UIKit presents the menu over a snapshot of the view, so a layout ' +
          'under it moves nothing the menu points at - no rule to test'
      );
      return;
    }
    function Moving({ above }: { above: number }): ReactElement {
      return <Message testId="move" above={above} />;
    }
    const { rerender } = await render(<Moving above={0} />);
    await handleFor('move');
    await openedBy('move-target');
    await reportWhen('move', (r) => r.menu !== '-1', 'the popup');
    await rerender(<Moving above={40} />);
    await until('the close', () => eventsOf('move').includes('close'));
    expect(eventsOf('move')).toEqual(['open', 'close']);
  });

  it('opens the popup at the finger, not at the view (Android)', async () => {
    if (IOS) {
      console.log(
        '    · iOS: UIKit places the menu beside the lifted preview; there is no anchor of ours'
      );
      return;
    }
    await render(<Message testId="anchor" />);
    await handleFor('anchor');
    const density = PixelRatio.get();
    const near = (a: number, b: number): boolean =>
      Math.abs(a - b) / density <= 1;
    const seen: string[] = [];
    let atTopStart = 0;
    // Off-centre points, so an anchor at the view's centre or corner cannot pass. A popup
    // that does not fit to the right of the finger is aligned to end there instead
    // (Material's position provider), so either corner may sit on the press point - but
    // the first point leaves room, and must land top-start.
    for (const [fx, fy] of [
      [0.15, 0.3],
      [0.8, 0.6],
    ] as const) {
      events.length = 0;
      await holdAt('anchor-target', fx, fy);
      await until('the open', () => eventsOf('anchor').includes('open'));
      await reportWhen(
        'anchor',
        (r) => r.menu !== '-1' && r.press !== '-1',
        'the popup and the press'
      );
      // Material's placement comes after the popup's first layout: read it settled.
      await sleep(500);
      const report = await settledReport('anchor');
      const [px, py] = (report.press ?? '').split(',').map(Number);
      const [ml, mt, mr, mb] = (report.menu ?? '').split(',').map(Number);
      seen.push(
        `press=${String(report.press)} menu=${String(report.menu)} anchor=${String(report.anchor)}`
      );
      const xOk = near(ml!, px!) || near(mr!, px!);
      const yOk = near(mt!, py!) || near(mb!, py!);
      if (near(ml!, px!) && near(mt!, py!)) atTopStart += 1;
      if (!xOk || !yOk) {
        throw new Error(
          `the popup is not at the finger (density ${String(density)}): ${seen.join(' | ')}`
        );
      }
      (await handleFor('anchor')).nuiTestSelectRow('reply');
      await reportWhen('anchor', (r) => r.open === '0', 'closed');
    }
    if (atTopStart < 1) {
      throw new Error(
        `no popup opened top-start at the finger: ${seen.join(' | ')}`
      );
    }
  });
});

describe('ContextMenu · accessibility', () => {
  it('makes an accessible ContextMenu the element that carries the menu', async () => {
    await render(
      <View>
        <Message testId="ax-on" accessible label="Message from Ada" />
        <Message testId="ax-off" />
        <Message testId="ax-disabled" accessible label="Disabled" disabled />
      </View>
    );
    const on = await settledReport('ax-on');
    const off = await settledReport('ax-off');
    const disabled = await settledReport('ax-disabled');
    console.log(
      `    · on ax=${on.ax} action=${on.a11yAction} · off ax=${off.ax} · ` +
        `disabled action=${disabled.a11yAction}`
    );
    // iOS (D37 item 2): RN's `isAccessibilityElement` answers from the content view, so
    // this goes red the day React Native moves that answer again. Android: `accessible`
    // makes the wrapper the focusable node.
    expect(on.ax).toBe('1');
    expect(off.ax).toBe('0');
    if (!IOS) {
      // The action TalkBack's double-tap-and-hold sends, labelled, and only while the
      // menu can open.
      expect(on.a11yAction).toBe('Show menu');
      expect(disabled.a11yAction).not.toBe('Show menu');
      (await handleFor('ax-on')).nuiTestA11yLongClick();
      const opened = await reportWhen(
        'ax-on',
        (r) => r.open === '1',
        'the a11y open'
      );
      expect(opened.opens).toBe('1');
      expect(eventsOf('ax-on')).toEqual(['open']);
      (await handleFor('ax-on')).nuiTestSelectRow('reply');
      await until('the close', () => eventsOf('ax-on').includes('close'));
    }
  });
});

describe('ContextMenu · drop and recycle', () => {
  it('reports the close of a menu dropped while open, and leaves no popup', async () => {
    function Maybe({ shown }: { shown: boolean }): ReactElement {
      return shown ? <Message testId="drop" /> : <View />;
    }
    const before = IOS ? -1 : Number((await liveNow()) ?? 0);
    const { rerender } = await render(<Maybe shown />);
    await handleFor('drop');
    await openedBy('drop-target');
    await rerender(<Maybe shown={false} />);
    await until('the close of the dropped menu', () =>
      eventsOf('drop').includes('close')
    );
    expect(eventsOf('drop')).toEqual(['open', 'close']);
    if (!IOS) {
      // The next mount reads the leak a dropped mount cannot report.
      handles.clear();
      await rerender(<Message testId="drop-probe" />);
      const report = await reportWhen(
        'drop-probe',
        (r) => r.live !== undefined,
        'a probe'
      );
      await sleep(300);
      const settled = await settledReport('drop-probe');
      console.log(
        `    · live before=${String(before)} after=${settled.live ?? report.live}`
      );
      expect(Number(settled.live)).toBe(before);
    }
  });

  it('drops a pending press with the view (Android)', async () => {
    if (IOS) {
      console.log(
        '    · iOS: UIKit owns the pending press, and the view keeps its interaction'
      );
      return;
    }
    function Maybe({ shown }: { shown: boolean }): ReactElement {
      return shown ? <Message testId="pending" /> : <View />;
    }
    const { rerender } = await render(<Maybe shown />);
    await handleFor('pending');
    const at = pointIn('pending-target', 0.5, 0.5);
    const held = userEvent.longPressAt(at.x, at.y, 1000);
    await sleep(150);
    await rerender(<Maybe shown={false} />);
    await held;
    await sleep(600);
    expect(eventsOf('pending')).toEqual([]);
  });

  it('opens and drops 30 menus and leaves the popup count where it was (Android)', async () => {
    if (IOS) {
      console.log(
        '    · iOS: the menu is UIKit’s, not a window of ours, so there is no count'
      );
      return;
    }
    function Cycle({ round }: { round: number }): ReactElement {
      return round % 2 === 0 ? (
        <Message testId={`leak-${String(round)}`} />
      ) : (
        <View />
      );
    }
    const before = Number(await liveNow());
    const { rerender } = await render(<Cycle round={0} />);
    for (let round = 0; round < 60; round += 2) {
      const testId = `leak-${String(round)}`;
      await rerender(<Cycle round={round} />);
      const handle = await handleFor(testId);
      handle.nuiTestA11yLongClick();
      await reportWhen(testId, (r) => r.menu !== '-1', `open ${testId}`);
      await rerender(<Cycle round={round + 1} />);
    }
    await rerender(<Message testId="leak-probe" />);
    await sleep(500);
    const report = await settledReport('leak-probe');
    console.log(`    · live before=${String(before)} after=${report.live}`);
    expect(Number(report.live)).toBe(before);
  });

  it('comes back from the recycle pool with no previous owner and its interaction', async () => {
    function Owner({ id }: { id: 'first' | 'second' | 'none' }): ReactElement {
      if (id === 'none') return <View />;
      return (
        <Message
          testId={id}
          group={
            id === 'first'
              ? GROUP
              : { actions: [{ id: 'only', title: 'Only' }] }
          }
        />
      );
    }
    const { rerender } = await render(<Owner id="first" />);
    const first = await handleFor('first');
    // State a reset has to clear: a pick, an open/close pair and a probe's answer.
    await openedBy('first-target');
    first.nuiTestSelectRow('reply');
    await until('the close', () => eventsOf('first').includes('close'));
    first.nuiTestMenuProbe();
    await reportWhen('first', (r) => r.selects === '1', 'the pick');
    await rerender(<Owner id="none" />);
    await sleep(300);
    await rerender(<Owner id="second" />);
    const report = await settledReport('second');
    console.log(
      `    · second owner: ${(await handleFor('second')).nuiTestContextMenuReport()}`
    );
    expect(report.open).toBe('0');
    expect(report.opens).toBe('0');
    expect(report.selects).toBe('0');
    expect(report.rows).toBe('1');
    expect(report.drawn).toBe('-1');
    if (IOS) expect(report.interaction).toBe('1');
    // And it still opens, for its own owner.
    await openedBy('second-target');
    (await handleFor('second')).nuiTestSelectRow('only');
    await until('the pick', () => eventsOf('second').includes('select:only'));
  });
});

/** HarnessUI's element reference for a testID (what `userEvent.press` wants). */
function screenRef(testId: string) {
  return screen.findByTestId(testId);
}

/** The process-wide popup count, read through a throwaway ContextMenu (Android). */
async function liveNow(): Promise<string> {
  const probe = await render(<Message testId="live-now" />);
  const report = await settledReport('live-now');
  probe.unmount();
  handles.delete('live-now');
  await sleep(200);
  return report.live ?? '0';
}

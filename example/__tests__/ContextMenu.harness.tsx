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
  StyleSheet,
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
  queryByAccessibilityLabel(label: string): ViewInfo | null;
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
  /** Sample the open popup's window (G21); `no popup` when this wrapper has none. */
  nuiTestMenuPixelProbe(color: number): void;
  nuiTestMenuPixelReport(): string;
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
 * each read asks for a fresh one, so a read can trail the event it is about. A view
 * builds no report before the first read asks (`pending`), and `ok` is never shown that
 * one: `undefined !== '-1'` would pass it.
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
  while (report.seq === undefined || !ok(report)) {
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

/**
 * The report after it has had time to settle: two reads 150 ms apart, and the second
 * one built (a first read can be the one that asked for it).
 */
async function settledReport(testId: string): Promise<Record<string, string>> {
  const handle = await handleFor(testId);
  handle.nuiTestContextMenuReport();
  await sleep(150);
  return reportWhen(testId, () => true, 'a settled report');
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
/** The same menu as the Android popup's semantics tree has it (E2): every group `( )`. */
const GROUP_DRAWN_ANDROID =
  '(:Reply,Copy,Pin~),(More:Archive,Mail),(Tools:Flag),(:Delete)';
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
      // And a view that cannot open copies no event for it; the armed twin does.
      expect(off.copies).toBe('0');
      expect(Number(on.copies)).toBeGreaterThan(0);
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

describe('ContextMenu · not the touch target', () => {
  function Layers(): ReactElement {
    return (
      <View style={{ paddingTop: 40, paddingHorizontal: 16, gap: 16 }}>
        <View style={{ height: 96 }}>
          <Pressable
            testID="under"
            onPress={bump('under:press')}
            style={[StyleSheet.absoluteFill, { backgroundColor: '#cde' }]}
          />
          <ContextMenu
            testID="pe-none"
            pointerEvents="none"
            group={GROUP}
            style={[StyleSheet.absoluteFill, { padding: 12 }]}
            hybridRef={capture('pe-none')}
            {...record('pe-none')}
          >
            <Text>pointerEvents none</Text>
          </ContextMenu>
        </View>
        <ContextMenu
          testID="pe-box-none"
          pointerEvents="box-none"
          group={GROUP}
          style={{ height: 96, padding: 12, backgroundColor: '#efe' }}
          hybridRef={capture('pe-box-none')}
          {...record('pe-box-none')}
        >
          <View
            testID="pe-box-none-child"
            style={{ width: 60, height: 24, backgroundColor: '#9c9' }}
          />
        </ContextMenu>
      </View>
    );
  }

  it('opens nothing for a tap or a hold that goes through it, and lets the view under it press', async () => {
    await render(<Layers />);
    await handleFor('pe-none');
    await handleFor('pe-box-none');
    const none = pointIn('pe-none', 0.5, 0.5);
    // A tap: the press under it is the barrier that says the touch landed here.
    await userEvent.pressAt(none.x, none.y);
    await until('the press under it', () => count('under:press') === 1);
    // Longer than the long-press timeout on both platforms (Android 400 ms, iOS ~740).
    await sleep(1200);
    // A hold: the view under it has no `onLongPress`, so it presses on release - unless
    // something cancelled its touch.
    await userEvent.longPressAt(none.x, none.y, 1000);
    await until('the held press under it', () => count('under:press') === 2);
    await sleep(600);
    // `box-none` on its empty area: the same, with nothing under it to press.
    const empty = pointIn('pe-box-none', 0.85, 0.8);
    await userEvent.pressAt(empty.x, empty.y);
    await sleep(1200);
    await userEvent.longPressAt(empty.x, empty.y, 1000);
    await sleep(800);
    const noneReport = await settledReport('pe-none');
    const boxNoneReport = await settledReport('pe-box-none');
    console.log(
      `    · under presses=${String(count('under:press'))} none ` +
        `opens=${String(noneReport.opens)} armed=${String(noneReport.armed)} ` +
        `box-none opens=${String(boxNoneReport.opens)} armed=${String(boxNoneReport.armed)}`
    );
    expect(eventsOf('pe-none')).toEqual([]);
    expect(eventsOf('pe-box-none')).toEqual([]);
    expect(count('under:press')).toBe(2);
    expect(noneReport.opens).toBe('0');
    expect(boxNoneReport.opens).toBe('0');
    if (!IOS) {
      expect(noneReport.armed).toBe('0');
      expect(boxNoneReport.armed).toBe('0');
    }
    // The barrier for box-none: a hold on its child is its own, and opens the menu.
    await holdAt('pe-box-none-child', 0.5, 0.5);
    await until('the box-none child hold to open', () =>
      eventsOf('pe-box-none').includes('open')
    );
    (await handleFor('pe-box-none')).nuiTestSelectRow('reply');
    await until('the close', () => eventsOf('pe-box-none').includes('close'));
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
      // Android: the popup's own composition, and its semantics tree (E2) - Menu's
      // Material groups, the submenu inline as a group of its own.
      handle.nuiTestA11yLongClick();
      await reportWhen('tree', (r) => r.open === '1', 'open');
      const composed = await reportWhen(
        'tree',
        (r) => r.menu !== '-1' && r.drawn !== '-1',
        'the popup witness'
      );
      console.log(
        `    · rows=${composed.rows} menu=${composed.menu} drawn=${composed.drawn}`
      );
      expect(composed.drawn).toBe(GROUP_DRAWN_ANDROID);
      expect(composed.rows).toBe(GROUP_ROWS);
      handle.nuiTestSelectRow('reply');
      await reportWhen('tree', (r) => r.open === '0', 'closed');
    }
  });

  it('carries subtitle and checked into the menu it builds (E2)', async () => {
    const checks: MenuGroup = {
      actions: [
        { id: 'pin', title: 'Pin', subtitle: 'Keep on top', checked: true },
        { id: 'mute', title: 'Mute', checked: false },
      ],
      sections: [
        {
          id: 'tools',
          title: 'Tools',
          items: [{ id: 'flag', title: 'Flag', subtitle: 'For later' }],
        },
      ],
    };
    await render(<Message testId="e2-ctx" group={checks} />);
    const handle = await handleFor('e2-ctx');
    if (IOS) {
      handle.nuiTestMenuProbe();
      const report = await reportWhen(
        'e2-ctx',
        (r) => r.drawn !== '-1',
        'the probe'
      );
      console.log(`    · drawn=${report.drawn}`);
      // `UIAction.subtitle` and `.on`; an unchecked toggle is `.off`, like a plain row.
      expect(report.drawn).toBe('Pin@Keep on top+,Mute,(Tools:Flag@For later)');
    } else {
      handle.nuiTestA11yLongClick();
      const report = await reportWhen(
        'e2-ctx',
        (r) => r.open === '1' && r.drawn !== '-1',
        'the popup witness'
      );
      console.log(`    · drawn=${report.drawn}`);
      expect(report.drawn).toBe(
        '(:Pin@Keep on top+,Mute=),(Tools:Flag@For later)'
      );
    }
    // A checked row's pick is a pick.
    if (IOS) await openedBy('e2-ctx-target');
    handle.nuiTestSelectRow('pin');
    await until('the pick', () => eventsOf('e2-ctx').includes('select:pin'));
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

  it('opens again, with onOpen, for a hold that starts while the last menu is closing', async () => {
    await render(<Message testId="race" />);
    const handle = await handleFor('race');
    await openedBy('race-target');
    // The pick starts the dismiss animation; the hold right behind it is a new touch
    // while that runs, and UIKit asks for a new configuration for it at once (iOS).
    handle.nuiTestSelectRow('reply');
    await holdAt('race-target', 0.6, 0.5);
    await until('the close', () => eventsOf('race').includes('close'));
    await until(
      'the second open',
      () => eventsOf('race').filter((e) => e === 'open').length === 2
    );
    const report = await reportWhen('race', (r) => r.open === '1', 'open');
    console.log(
      `    · configs=${String(report.configs)} events=${eventsOf('race').join(',')}`
    );
    handle.nuiTestSelectRow('copy');
    await until('the second close', () => {
      return eventsOf('race').filter((e) => e === 'close').length === 2;
    });
    await sleep(200);
    expect(eventsOf('race')).toEqual([
      'open',
      'select:reply',
      'close',
      'open',
      'select:copy',
      'close',
    ]);
  });

  it('builds no report until a harness asks for one', async () => {
    function Titled({ n }: { n: number }): ReactElement {
      return (
        <ContextMenu
          testID="quiet"
          group={GROUP}
          title={`Title ${String(n)}`}
          hybridRef={capture('quiet')}
        >
          <Text>quiet</Text>
        </ContextMenu>
      );
    }
    const { rerender } = await render(<Titled n={0} />);
    await handleFor('quiet');
    // Ten prop updates, each an `afterUpdate`, and no read yet: what an app does.
    for (let n = 1; n <= 10; n += 1) {
      await rerender(<Titled n={n} />);
    }
    await sleep(300);
    const report = await reportWhen(
      'quiet',
      (r) => r.seq !== undefined,
      'the first report'
    );
    console.log(
      `    · seq=${String(report.seq)} title=${String(report.title)}`
    );
    expect(report.title).toBe('Title 10');
    // The builds the reads themselves asked for, and nothing from the updates before.
    expect(Number(report.seq)).toBeLessThanOrEqual(2);
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

  it('leaves no layout listener behind a pick, a drop, or a drop while open (Android)', async () => {
    if (IOS) {
      console.log(
        '    · iOS: no layout rule, so no listener (the menu is over a snapshot)'
      );
      return;
    }
    function Scene({
      step,
      tick,
    }: {
      step: 'picked' | 'open' | 'gone';
      tick: number;
    }): ReactElement {
      // `tick` changes the text above, so every step draws a frame - the frames a leaked
      // pre-draw listener would run in.
      return (
        <View>
          <Text>{`frame ${String(tick)}`}</Text>
          {step === 'picked' ? <Message testId="watch-pick" /> : null}
          {step === 'open' ? <Message testId="watch-drop" /> : null}
          {step === 'gone' ? <Message testId="watch-probe" /> : null}
        </View>
      );
    }
    let tick = 0;
    const { rerender } = await render(<Scene step="picked" tick={tick} />);
    const frames = async (step: 'picked' | 'open' | 'gone'): Promise<void> => {
      for (let i = 0; i < 6; i += 1) {
        tick += 1;
        await rerender(<Scene step={step} tick={tick} />);
        await sleep(60);
      }
    };
    const before = Number((await settledReport('watch-pick')).watchStray);
    // 1. A pick - what a row press calls - with the view still mounted, then frames.
    await openedBy('watch-pick-target');
    (await handleFor('watch-pick')).nuiTestSelectRow('reply');
    await until('the pick close', () =>
      eventsOf('watch-pick').includes('close')
    );
    await frames('picked');
    const afterPick = Number((await settledReport('watch-pick')).watchStray);
    // 2. That view dropped, and another dropped while its menu is open, then frames.
    await rerender(<Scene step="open" tick={++tick} />);
    await openedBy('watch-drop-target');
    await rerender(<Scene step="gone" tick={++tick} />);
    await until('the dropped close', () =>
      eventsOf('watch-drop').includes('close')
    );
    await frames('gone');
    const after = Number((await settledReport('watch-probe')).watchStray);
    console.log(
      `    · stray listener runs: before=${String(before)} afterPick=${String(afterPick)} ` +
        `afterDrops=${String(after)}`
    );
    expect(afterPick).toBe(before);
    expect(after).toBe(before);
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

describe('ContextMenu · a recycled wrapper', () => {
  it('keeps no previous owner’s accessibility label', async () => {
    // React Native's own recycle reset clears the label's tag and leaves the view's
    // `contentDescription`, and only ever writes a non-empty one back - so a wrapper
    // recycled into an owner with no label would still be announced by the old one.
    // Measured by real input's a11y sweep: "Message from Grace" on `ctx-outer`.
    function Owner({
      step,
    }: {
      step: 'labelled' | 'none' | 'plain';
    }): ReactElement {
      if (step === 'none') return <View />;
      return step === 'labelled' ? (
        <Message testId="label-first" accessible label="A label from before" />
      ) : (
        <Message testId="label-second" />
      );
    }
    const { rerender } = await render(<Owner step="labelled" />);
    await settledReport('label-first');
    expect(
      harnessUi.queryByAccessibilityLabel('A label from before')
    ).not.toBeNull();
    await rerender(<Owner step="none" />);
    await sleep(300);
    await rerender(<Owner step="plain" />);
    const second = await settledReport('label-second');
    const stale = harnessUi.queryByAccessibilityLabel('A label from before');
    console.log(
      `    · second owner ax=${second.ax} stale label box=${stale == null ? 'none' : `${String(stale.width)}x${String(stale.height)}`}`
    );
    expect(stale).toBeNull();
    expect(second.ax).toBe('0');
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

/**
 * `androidIcon` on the rows (G21): a glyph in each row's Material slot.
 *
 * The rows live in a popup of their own window, so nothing readable on the wrapper says
 * whether a row's glyph reached the screen. Menu faces the same wall and answers it the
 * same way, and ContextMenu carries the same two reads for the same reason:
 *
 *  - `iconTints=` in its report, written by each row **as it draws**, from the
 *    `LocalContentColor` its glyph is tinted with — a colour a test cannot name, because
 *    Material takes it from this device's dynamic palette;
 *  - `nuiTestMenuPixelProbe`, which samples the popup window the witness already keeps.
 *
 * Counts are compared as **differences** between two menus that differ only by the icon:
 * a colour count includes the row titles, which Material draws in that same colour, and
 * the artwork here is a filled square, so the difference is the slot's area. The size
 * claim is 20 dp (`MenuDefaults.LeadingIconSize`) at this device's density, squared.
 *
 * One popup is open at a time: a Material popup takes focus and dismisses on a touch
 * outside itself, so a sample is taken and the menu closed before the next one opens.
 *
 * The `MenuRowIcons.reset()` half of this is proven on the JVM, where a recycled slot is
 * observable directly (`MenuRowIconsTest`); the recycle case below is the same claim on
 * the device, where whether Fabric hands the view back at all is not the harness's call.
 */
describe('ContextMenu · the row glyphs (G21)', () => {
  /** The same filled square, through each road D43 gives an app. */
  const SLAB_ASSET = require('../src/assets/icons/slab_24px.xml');
  const SLAB_NAME = 'nitroui_test_slab';
  const NOT_SHIPPED = 'nitroui_test_never_built';

  /** `MenuDefaults.LeadingIconSize` in material3 1.5.0-beta02. Not 24 dp. */
  const ROW_ICON_DP = 20;

  /**
   * One row that may carry a glyph, one that never does, and the titles every
   * comparison menu here shares — so one probe minus another leaves the artwork.
   */
  const glyphGroup = (icon: string | number | undefined): MenuGroup => ({
    actions: [
      { id: 'slab', title: 'Arrange by size', androidIcon: icon },
      { id: 'plain', title: 'Sort by name' },
    ],
  });

  /** The `<id>#<RRGGBB>` list the report carries, as a map. */
  function tintsOf(report: Record<string, string>): Map<string, string> {
    const out = new Map<string, string>();
    const field = report.iconTints;
    if (field != null && field !== '-') {
      for (const entry of field.split(',')) {
        const at = entry.indexOf('#');
        if (at > 0) {
          out.set(entry.slice(0, at), `#${entry.slice(at + 1)}`);
        }
      }
    }
    return out;
  }

  /** A field every report carries, refusing the line that lost it. */
  function fieldOf(report: Record<string, string>, name: string): string {
    const value = report[name];
    if (value == null) {
      throw new Error(
        `a report with no "${name}" field: ${JSON.stringify(report)}`
      );
    }
    return value;
  }

  /**
   * A `l,t,r,b` rect as `WxH` — the half of it two popups can share.
   *
   * Two wrappers sit in two places, so their popups do too; what a claim about a glyph
   * is about is the frame, and comparing whole rects would compare where each happened
   * to open.
   */
  function frameOf(rect: string): string {
    const parts = rect.split(',').map(Number);
    if (parts.length !== 4 || parts.some((value) => Number.isNaN(value))) {
      throw new Error(`The popup rect is not four numbers: "${rect}".`);
    }
    const [left, top, right, bottom] = parts as [
      number,
      number,
      number,
      number,
    ];
    return `${String(Math.round(right - left))}x${String(
      Math.round(bottom - top)
    )}`;
  }

  /** Open `testId` the way the platform is being tested, and wait for its popup. */
  async function openMenu(testId: string): Promise<Record<string, string>> {
    const handle = await handleFor(testId);
    if (IOS) {
      await openedBy(`${testId}-target`);
    } else {
      handle.nuiTestA11yLongClick();
    }
    return await reportWhen(
      testId,
      (r) => r.open === '1' && r.menu !== '-1',
      `the popup of "${testId}"`,
      15000
    );
  }

  /** Pick the row with no glyph: the popup closes, and no test below counts a pick. */
  async function shut(testId: string): Promise<void> {
    const handle = await handleFor(testId);
    handle.nuiTestSelectRow('plain');
    await reportWhen(testId, (r) => r.open === '0', `"${testId}" closed`);
  }

  /**
   * One popup probe, answered.
   *
   * Sampling needs the UI thread and a Nitro call may not block for it, so a probe is a
   * pair: ask, then poll. The `n=` a line carries is what tells this probe's answer from
   * the previous control's.
   */
  async function probePopup(
    handle: Handle,
    color: number,
    what: string
  ): Promise<string> {
    const before = handle.nuiTestMenuPixelReport();
    handle.nuiTestMenuPixelProbe(color);
    const deadline = Date.now() + 8000;
    for (;;) {
      const line = handle.nuiTestMenuPixelReport();
      if (line !== '' && line !== before) {
        return line;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `the popup probe for ${what} never reported; last "${line}".`
        );
      }
      await sleep(50);
    }
  }

  /** Sample the open popup until two reads agree, and return that count. */
  async function stableHits(
    handle: Handle,
    color: number,
    what: string
  ): Promise<number> {
    const deadline = Date.now() + 15000;
    let previous = -1;
    let last = -1;
    for (;;) {
      const line = await probePopup(handle, color, what);
      if (/no popup/.test(line)) {
        throw new Error(
          `the popup probe for ${what} said "no popup" while the menu was open - ` +
            `the witness kept a window nobody can sample.`
        );
      }
      const hits = / hits=(\d+)/.exec(line);
      if (hits == null) {
        throw new Error(
          `the popup probe for ${what} reported no count: "${line}".`
        );
      }
      last = Number(hits[1]);
      if (last === previous) {
        return last;
      }
      previous = last;
      if (Date.now() > deadline) {
        return last;
      }
      await sleep(250);
    }
  }

  /** Open `testId`, sample its popup, close it, and hand back the count. */
  async function inkOf(
    testId: string,
    color: number,
    what: string
  ): Promise<number> {
    const handle = await handleFor(testId);
    await openMenu(testId);
    const ink = await stableHits(handle, color, what);
    await shut(testId);
    return ink;
  }

  it('draws the row glyph at the slot size, from a Metro asset and from a name', async () => {
    await render(
      <View>
        <Message testId="glyph-asset" group={glyphGroup(SLAB_ASSET)} />
        <Message testId="glyph-name" group={glyphGroup(SLAB_NAME)} />
        <Message testId="glyph-none" group={glyphGroup(undefined)} />
      </View>
    );

    if (IOS) {
      // iOS's menu is UIKit's `UIMenu`: `androidIcon` has nothing to draw into there, and
      // the probe says `no pixels` rather than answering 0. Both are the honest green.
      await openMenu('glyph-asset');
      const report = await settledReport('glyph-asset');
      expect(fieldOf(report, 'iconTints')).toBe('-');
      const handle = await handleFor('glyph-asset');
      handle.nuiTestMenuPixelProbe(0x000000);
      expect(handle.nuiTestMenuPixelReport()).toContain('no pixels');
      return;
    }

    // The row names the colour it drew with, and only the row with an icon names one.
    const asset = await handleFor('glyph-asset');
    await openMenu('glyph-asset');
    const drawn = await reportWhen(
      'glyph-asset',
      (r) => tintsOf(r).has('slab'),
      'a row that drew its glyph',
      15000
    );
    expect(tintsOf(drawn).has('plain')).toBe(false);
    const tint = tintsOf(drawn).get('slab');
    if (tint == null) {
      throw new Error('the row reported no tint for its glyph.');
    }
    const color = parseInt(tint.slice(1), 16);
    const assetInk = await stableHits(asset, color, 'the asset menu');
    await shut('glyph-asset');

    const nameInk = await inkOf('glyph-name', color, 'the named menu');
    const noneInk = await inkOf('glyph-none', color, 'the icon-less menu');
    const ink = assetInk - noneInk;
    console.log(
      `    · row glyph ink: tint=${drawn.iconTints} asset=${String(
        assetInk
      )} name=${String(nameInk)} none=${String(noneInk)}`
    );

    // The slot, measured: 20 dp, and a square that fills its canvas paints it squared.
    // 12% is the anti-aliased edge of a 55-pixel square and nothing else — Material's
    // 24 dp default would be 44% more ink, and "resolved but never drawn" is 100% less.
    const slot = ROW_ICON_DP * PixelRatio.get();
    expect(ink).toBeGreaterThan(slot * slot * 0.88);
    expect(ink).toBeLessThan(slot * slot * 1.12);

    // D43's two roads to one file, measured as pixels: the drawable the app shipped and
    // the file Metro served leave the same mark.
    const nameDifference = nameInk - noneInk;
    expect(Math.abs(nameDifference - ink)).toBeLessThan(
      Math.max(6, ink * 0.06)
    );

    // Closed, there is no window to sample, and the probe says `no popup` rather than
    // counting the last frame it saw.
    const closed = await probePopup(asset, color, 'the closed menu');
    expect(closed).toContain('no popup');
  });

  it('refuses a probe with no popup, and a name that cannot resolve with no glyph', async () => {
    await render(
      <View>
        <Message testId="miss" group={glyphGroup(NOT_SHIPPED)} />
        <Message testId="miss-none" group={glyphGroup(undefined)} />
      </View>
    );

    if (IOS) {
      await openMenu('miss');
      expect((await settledReport('miss')).iconTints).toBe('-');
      return;
    }

    // Before anything is open the probe refuses: "nothing to sample" is a different
    // answer from "sampled and found none", and a test has to be able to tell them apart.
    const handle = await handleFor('miss');
    handle.nuiTestMenuPixelProbe(0x123456);
    expect(handle.nuiTestMenuPixelReport()).toContain('no popup');

    const missing = await openMenu('miss');
    expect(missing.iconTints).toBe('-');
    const missingFrame = frameOf(fieldOf(missing, 'menu'));
    await shut('miss');
    // A name the resource table does not know resolves to `Absent`, which reaches
    // `leadingIcon` as `null` — so the popup that could not find its glyph is the popup
    // with no glyphs at all, to the last dp: no reserved 20 dp gap, no moved title.
    const plain = await openMenu('miss-none');
    expect(plain.iconTints).toBe('-');
    const plainFrame = frameOf(fieldOf(plain, 'menu'));
    await shut('miss-none');
    console.log(
      `    · unresolved name: menu=${missingFrame} none=${plainFrame}`
    );
    expect(missingFrame).toBe(plainFrame);
  });

  it('hands the next owner no glyph of the last one’s', async () => {
    if (IOS) {
      console.log(
        '    · iOS: the rows are UIKit’s, so there is no slot to hand over'
      );
      return;
    }
    function Owner({ id }: { id: 'first' | 'second' | 'none' }): ReactElement {
      if (id === 'none') return <View />;
      return (
        <Message
          testId={`recycle-${id}`}
          group={glyphGroup(id === 'first' ? SLAB_NAME : undefined)}
        />
      );
    }
    const { rerender } = await render(<Owner id="first" />);
    await openMenu('recycle-first');
    await reportWhen(
      'recycle-first',
      (r) => tintsOf(r).has('slab'),
      'the first owner’s glyph',
      15000
    );
    await shut('recycle-first');
    await rerender(<Owner id="none" />);
    await sleep(300);
    await rerender(<Owner id="second" />);
    const second = await handleFor('recycle-second');

    // Whether Fabric hands the same wrapper back is its own business; what is asserted
    // is what the second owner may claim. It has no `androidIcon`, so before it opens it
    // carries no tint — and once open, its popup draws none either: a slot kept from the
    // first owner would put a square beside these titles.
    expect(tintsOf(await settledReport('recycle-second')).size).toBe(0);
    const opened = await openMenu('recycle-second');
    expect(opened.iconTints).toBe('-');
    const frame = frameOf(fieldOf(opened, 'menu'));
    const ink = await stableHits(second, 0x123456, 'the second owner’s popup');
    await shut('recycle-second');
    console.log(`    · second owner: menu=${frame} ink=${String(ink)}`);
    expect(ink).toBe(0);
  });
});

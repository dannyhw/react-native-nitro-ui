import { useState } from 'react';
import {
  PixelRatio,
  Platform,
  processColor,
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
import { userEvent } from '@react-native-harness/ui';
import {
  Button,
  Host,
  Menu,
  nitroUiCore,
  type ButtonSize,
  type MenuGroup,
  type NitroUiSizingStats,
} from 'react-native-nitro-ui';

/** The Fabric name - what the sizing engine files sizes under. */
const COMPONENT = 'NitroUiMenu';

const BUTTON_COMPONENT = 'NitroUiButton';

type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
  queryByAccessibilityLabel(label: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

/** What `hybridRef` hands back; the library exports no Hybrid View types. */
type MenuHandle = {
  readonly title: string;
  readonly variant: string;
  readonly size: string;
  readonly disabled: boolean;
  readonly tintColor: number | null;
  readonly systemImage: string | null;
  readonly androidIcon: string | null;
  readonly accessibilityLabel: string | null;
  measureContent(): { width: number; height: number };
  nuiTestSelectRow(id: string): void;
  nuiTestMenuReport(): string;
  nuiTestMenuProbe(): void;
  nuiTestPixelProbe(color: number): void;
  nuiTestPixelReport(): string;
  nuiTestMenuPixelProbe(color: number): void;
  nuiTestMenuPixelReport(): string;
};

const handles = new Map<string, MenuHandle>();
const captureHybrid =
  (testId: string) =>
  (view: MenuHandle): void => {
    handles.set(testId, view);
  };

type ButtonHandle = {
  measureContent(): { width: number; height: number };
};
const buttonHandles = new Map<string, ButtonHandle>();
const captureButton =
  (testId: string) =>
  (view: ButtonHandle): void => {
    buttonHandles.set(testId, view);
  };

/**
 * Every callback in arrival order; the per-kind logs below cannot show the order
 * between a pick and a close.
 */
const orderLog: string[] = [];

/** Every `onSelect` the app has reported, in order. */
const selectLog: string[] = [];
const recordSelect =
  (testId: string) =>
  (id: string): void => {
    orderLog.push(`select:${testId}:${id}`);
    selectLog.push(`${testId}:${id}`);
  };

/** `onOpen`/`onClose` likewise, tagged so a count cannot be either one. */
const stateLog: string[] = [];
const recordOpen = (testId: string) => (): void => {
  orderLog.push(`open:${testId}`);
  stateLog.push(`${testId}:open`);
};
const recordClose = (testId: string) => (): void => {
  orderLog.push(`close:${testId}`);
  stateLog.push(`${testId}:close`);
};

/**
 * Every `primaryAction` the app has reported, in order. Kept apart from `stateLog`
 * so "a press on the action half opened nothing" can be asserted.
 */
const primaryLog: string[] = [];
const recordPrimary = (testId: string) => (): void => {
  orderLog.push(`action:${testId}`);
  primaryLog.push(`${testId}:action`);
};

// MARK: - The witness

/** A menu's report line, parsed. */
type MenuReport = {
  /** `-1` means "this platform cannot tell", which is not the same as `false`. */
  expanded: boolean | null;
  live: number | null;
  anchor: number[];
  menu: number[];
  rows: number;
  /** The menu the platform itself built; `null` for `-1` (nothing has read it yet). */
  drawn: string | null;
  /**
   * Whether this mount drew the split trigger. `null` means `-1`: iOS has no second
   * hit target to look for.
   */
  split: boolean | null;
  /** The two halves' screen rects, in the same space as `anchor`; `-1` unread. */
  leading: number[];
  trailing: number[];
  /**
   * What each row that drew an `androidIcon` tinted it with: `<id>#<RRGGBB>`, comma
   * separated, or `-` when no row drew one. The colour comes from the device's
   * dynamic palette, so a test has to read it here.
   */
  iconTints: string;
};

function parseMenuReport(line: string): MenuReport {
  const field = (name: string): string => {
    const found = line.split(';').find((part) => part.startsWith(`${name}=`));
    if (found == null) {
      throw new Error(`No "${name}" in menu report "${line}".`);
    }
    return found.slice(name.length + 1);
  };
  const rect = (name: string): number[] =>
    field(name)
      .split(',')
      .map((part) => Number(part));
  const expandedField = field('expanded');
  const liveField = field('live');
  const splitField = field('split');
  return {
    // `-1` means "cannot tell" and must not coerce into `false` or `0`.
    expanded: expandedField === '-1' ? null : expandedField === '1',
    live: liveField === '-1' ? null : Number(liveField),
    anchor: rect('anchor'),
    menu: rect('menu'),
    rows: Number(field('rows')),
    drawn: field('drawn') === '-1' ? null : field('drawn'),
    split: splitField === '-1' ? null : splitField === '1',
    leading: rect('leading'),
    trailing: rect('trailing'),
    iconTints: field('iconTints'),
  };
}

/**
 * A parsed rect as four numbers. Throws on a short one, so a missing field cannot
 * read as "at the origin".
 */
function edges(rect: number[], what: string): [number, number, number, number] {
  if (rect.length !== 4 || rect.some((value) => Number.isNaN(value))) {
    throw new Error(
      `The ${what} rect is not four numbers: "${rect.join(',')}".`
    );
  }
  return [rect[0] ?? 0, rect[1] ?? 0, rect[2] ?? 0, rect[3] ?? 0];
}

/**
 * iOS answers `-1` for open state and geometry: SwiftUI hands the menu to the
 * system's presentation, so the control has no window to read.
 */
function expectUnanswerable(current: MenuReport): void {
  expect(current.expanded).toBeNull();
  expect(current.live).toBeNull();
  expect(current.anchor).toEqual([-1, -1, -1, -1]);
  expect(current.menu).toEqual([-1, -1, -1, -1]);
  expect(current.split).toBeNull();
  expect(current.leading).toEqual([-1, -1, -1, -1]);
  expect(current.trailing).toEqual([-1, -1, -1, -1]);
}

// MARK: - Waits that refuse a wrong answer

const stats = (): NitroUiSizingStats => nitroUiCore.sizingStats();

function delta(before: NitroUiSizingStats, after: NitroUiSizingStats) {
  return {
    corrections:
      after.correctionsImmediate -
      before.correctionsImmediate +
      (after.correctionsBatched - before.correctionsBatched),
    cachedSizes: after.cachedSizes - before.cachedSizes,
    measurements: after.measurements - before.measurements,
  };
}

type Size = { width: number; height: number };

/** Within what Yoga rounds to. */
function sameSize(a: Size | null, b: Size | null): boolean {
  return (
    a != null &&
    b != null &&
    Math.abs(a.width - b.width) < 0.6 &&
    Math.abs(a.height - b.height) < 0.6
  );
}

function describeSize(size: Size | null): string {
  return size == null
    ? 'null'
    : `${size.width.toFixed(2)}x${size.height.toFixed(2)}`;
}

function sizeOf(testId: string): Size | null {
  return harnessUi.queryByTestId(testId);
}

function boxOf(testId: string): ViewInfo | null {
  return harnessUi.queryByTestId(testId);
}

function measured(testId: string): Size | null {
  return handles.get(testId)?.measureContent() ?? null;
}

function measuredButton(testId: string): Size | null {
  return buttonHandles.get(testId)?.measureContent() ?? null;
}

/**
 * Polls for the hybrid handle: `hybridRef` fires when the native view is created,
 * which is after the commit `render` waits for.
 */
async function waitForHandle(
  testId: string,
  what: string
): Promise<MenuHandle> {
  return await pollUntil(
    () => handles.get(testId) ?? null,
    () => new Error(`"${testId}" (${what}) never handed back a hybrid handle.`)
  );
}

async function waitForMeasuredButton(testId: string, what: string) {
  return await pollUntil(
    () => {
      const size = measuredButton(testId);
      return size != null && size.width > 0 && size.height > 0 ? size : null;
    },
    () => new Error(`"${testId}" (${what}) never reported a measured size.`)
  );
}

function report(testId: string): MenuReport {
  const handle = handles.get(testId);
  if (handle == null) {
    throw new Error(`No hybrid handle for "${testId}" - it never mounted.`);
  }
  return parseMenuReport(handle.nuiTestMenuReport());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollUntil<T>(
  read: () => T | null,
  failure: () => Error,
  timeoutMs = 8000
): Promise<T> {
  const deadline = nitroUiCore.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value != null) {
      return value;
    }
    if (nitroUiCore.now() > deadline) {
      throw failure();
    }
    await sleep(25);
  }
}

async function waitForTestId(
  testId: string,
  timeoutMs = 10000
): Promise<ViewInfo> {
  return await pollUntil(
    () => harnessUi.queryByTestId(testId),
    () =>
      new Error(`No element with testID "${testId}" within ${timeoutMs}ms.`),
    timeoutMs
  );
}

/**
 * Polls until the box of `testId` is `size`. Waiting for any box would accept the
 * planted `WRONG_SIZE` or the declared fallback.
 */
async function waitForBox(testId: string, size: Size, what: string) {
  return await pollUntil(
    () => (sameSize(sizeOf(testId), size) ? sizeOf(testId) : null),
    () =>
      new Error(
        `testID "${testId}" (${what}) never reached ` +
          `${size.width.toFixed(2)}x${size.height.toFixed(2)} - last box ` +
          `${describeSize(sizeOf(testId))}, control measured ` +
          `${describeSize(measured(testId))}.`
      )
  );
}

/** Poll until the control reports *a* size (a host measures after its first commit). */
async function waitForMeasured(testId: string, what: string) {
  return await pollUntil(
    () => {
      const size = measured(testId);
      return size != null && size.width > 0 && size.height > 0 ? size : null;
    },
    () => new Error(`"${testId}" (${what}) never reported a measured size.`)
  );
}

/**
 * Polls until the mount titled `wantTitle` reports a non-zero size. Fabric recycles
 * the view and Nitro hands back the same JS handle object for it, so object identity
 * cannot tell a new mount from the old one; the title can. A control also answers
 * `0x0` mid re-measure.
 */
async function waitForFreshMeasure(
  testId: string,
  wantTitle: string,
  what: string,
  timeoutMs = 8000
): Promise<Size> {
  return await pollUntil(
    () => {
      const handle = handles.get(testId);
      if (handle == null || handle.title !== wantTitle) {
        return null;
      }
      const size = handle.measureContent();
      return size.width > 0 && size.height > 0 ? size : null;
    },
    () =>
      new Error(
        `"${testId}" (${what}) never answered as "${wantTitle}" on its new mount - ` +
          `the handle says title ${JSON.stringify(
            handles.get(testId)?.title ?? null
          )} and measureContent() says ${describeSize(
            measured(testId)
          )}, box ${describeSize(sizeOf(testId))}.`
      ),
    timeoutMs
  );
}

/**
 * Polls until the control reports a non-zero size that is not `previous`:
 * `measureContent()` keeps answering the last size while Compose re-measures, and
 * answers `0x0` in between.
 */
async function waitForRemeasure(
  testId: string,
  previous: Size,
  what: string
): Promise<Size> {
  return await pollUntil(
    () => {
      const size = measured(testId);
      return size != null &&
        size.width > 0 &&
        size.height > 0 &&
        !sameSize(size, previous)
        ? size
        : null;
    },
    () =>
      new Error(
        `"${testId}" (${what}) still measures ${describeSize(previous)} after the ` +
          `change - control now measures ${describeSize(measured(testId))}, so it ` +
          'never re-measured.'
      )
  );
}

/**
 * Polls the report until `read` accepts it. A menu opens on the UI thread while JS
 * is back in the test, so the wait is on state, not on time.
 */
async function waitForMenu(
  testId: string,
  read: (r: MenuReport) => boolean,
  timeoutMs = 12000
): Promise<MenuReport> {
  const deadline = nitroUiCore.now() + timeoutMs;
  let seen = 'never read';
  for (;;) {
    const current = report(testId);
    if (read(current)) {
      return current;
    }
    seen = JSON.stringify(current);
    if (nitroUiCore.now() > deadline) {
      throw new Error(
        `Menu report for "${testId}" never matched within ${String(timeoutMs)}ms; ` +
          `last read ${seen}.`
      );
    }
    await sleep(50);
  }
}

/** Wait for a log line to appear, or fail naming the press that never reached JS. */
async function waitForLog(
  log: readonly string[],
  count: number,
  what: string,
  timeoutMs = 8000
): Promise<void> {
  const deadline = nitroUiCore.now() + timeoutMs;
  for (;;) {
    if (log.length >= count) {
      return;
    }
    if (nitroUiCore.now() > deadline) {
      throw new Error(
        `"${what}" reported ${String(log.length)} of ${String(count)} expected ` +
          `events within ${String(timeoutMs)}ms: ${log.join(', ') || 'nothing'}.`
      );
    }
    await sleep(25);
  }
}

async function settle(ms = 250): Promise<void> {
  await sleep(ms);
}

// MARK: - Sizing fixtures

/**
 * The sizing key `Menu.tsx` builds, each piece escaped. Written out rather than
 * imported, so a wrong key in the library cannot go unnoticed here.
 */
function sizingKey(
  variant: string,
  size: string,
  title: string,
  systemImage = '',
  action: 'action' | 'plain' = 'plain',
  androidIcon = ''
): string {
  const escape = (value: string): string => value.replace(/[\\|]/g, '\\$&');
  return [
    variant,
    size,
    action,
    escape(systemImage),
    escape(androidIcon),
    escape(title),
  ].join('|');
}

/** A size that is *not* any menu's size, planted as the engine's first answer. */
const WRONG_SIZE = { width: 14.5, height: 73.5 };

/** Plants a wrong size for each configuration, then drops the cache once. */
function poisonConfigurations(
  keys: readonly string[],
  component: string = COMPONENT
): void {
  for (const key of keys) {
    nitroUiCore.seedSizingSize(
      component,
      key,
      WRONG_SIZE.width,
      WRONG_SIZE.height
    );
  }
  nitroUiCore.invalidateSizingEnvironment();
}

/**
 * What each platform declares before the first measure (`NitroUiDeclaredFallbacks`).
 * Deliberately not the measured size of any fixture below: a fallback equal to the
 * answer would hide a failed correction.
 */
const DECLARED_FALLBACK =
  Platform.OS === 'ios'
    ? { width: 74, height: 38 }
    : { width: 75.1, height: 52 };

// MARK: - Menu content fixtures

/** Four actions, one submenu and one section - and the ids each one carries. */
const GROUP: MenuGroup = {
  actions: [
    { id: 'copy', title: 'Copy' },
    { id: 'cut', title: 'Cut', systemImage: 'scissors' },
    { id: 'paste', title: 'Paste', disabled: true },
    {
      id: 'share',
      title: 'Share',
      items: [
        { id: 'share.messages', title: 'Messages' },
        { id: 'share.mail', title: 'Mail', destructive: true },
      ],
    },
  ],
  sections: [
    {
      id: 'danger',
      title: 'Dangerous',
      items: [{ id: 'delete', title: 'Delete', destructive: true }],
    },
  ],
};

/**
 * `GROUP`'s pickable rows: the actions that are not submenu parents, plus every
 * child. A submenu's own row draws a header on Android and a nested menu on iOS, and
 * is not pickable on either, so it is not counted.
 */
const PICKABLE = 6;

/** The same trigger with three times the list: same key, same box, more rows. */
const BIG_GROUP: MenuGroup = {
  actions: [
    { id: 'copy', title: 'Copy' },
    { id: 'cut', title: 'Cut' },
    { id: 'paste', title: 'Paste' },
    { id: 'select', title: 'Select all' },
    { id: 'find', title: 'Find' },
    { id: 'replace', title: 'Replace' },
    { id: 'reload', title: 'Reload' },
    { id: 'inspect', title: 'Inspect element' },
    { id: 'more', title: 'More tools' },
  ],
  sections: [
    {
      id: 'danger',
      title: 'Dangerous',
      items: [
        { id: 'delete', title: 'Delete' },
        { id: 'purge', title: 'Purge cache' },
      ],
    },
  ],
};

/** `BIG_GROUP`'s pickable rows: nine actions plus a section's two. */
const BIG_PICKABLE = 11;

/**
 * An untitled group between two titled ones, holding a destructive row and a
 * disabled one.
 */
const UNTITLED_GROUP: MenuGroup = {
  actions: [{ id: 'open', title: 'Open' }],
  sections: [
    {
      id: 'share',
      title: 'Share',
      items: [
        { id: 'airdrop', title: 'AirDrop' },
        { id: 'mail', title: 'Mail' },
      ],
    },
    {
      id: 'danger',
      items: [
        { id: 'delete', title: 'Delete', destructive: true },
        { id: 'archive', title: 'Archive', disabled: true },
      ],
    },
    {
      id: 'more',
      title: 'More',
      items: [{ id: 'info', title: 'Get Info' }],
    },
  ],
};

/** `UNTITLED_GROUP`'s rows: one action and three sections' one, two and two. */
const UNTITLED_PICKABLE = 6;

/**
 * The untitled group's rows in `drawn` notation (`!` destructive, `~` disabled):
 * what iOS must draw, and the rows Android composes under a bare divider.
 */
const UNTITLED_ROWS = ['Delete!', 'Archive~'];

/**
 * The rows of the inline group titled `title` in a `drawn` tree, or `null` when the
 * tree has no such group. Inline groups do not nest, so a group's rows run from its
 * `(` to the next `)`.
 */
function drawnGroup(drawn: string, title: string): string[] | null {
  const open = `(${title}:`;
  const start = drawn.indexOf(open);
  if (start < 0) {
    return null;
  }
  const end = drawn.indexOf(')', start);
  const rows = drawn.slice(start + open.length, end);
  return rows === '' ? [] : rows.split(',');
}

/** The trigger presses reach the app's own window, so a trigger really opens. */
async function pressTrigger(testId: string): Promise<void> {
  const box = boxOf(testId);
  if (box == null) {
    throw new Error(`Cannot press "${testId}" - no box.`);
  }
  await userEvent.pressAt(box.x + box.width / 2, box.y + box.height / 2);
}

/** Press the middle of the box the *witness* reports (inside a `<Host>`). */
async function pressWitnessed(testId: string): Promise<void> {
  const [left, top, right, bottom] = edges(report(testId).anchor, 'anchor');
  expect(left).toBeGreaterThanOrEqual(0);
  expect(right).toBeGreaterThan(left);
  expect(bottom).toBeGreaterThan(top);
  // `pressAt` wants React Native's units; the witness answers in device pixels.
  await userEvent.pressAt(
    (left + right) / 2 / PixelRatio.get(),
    (top + bottom) / 2 / PixelRatio.get()
  );
}

/**
 * Presses the middle of a rect the witness reports, in device pixels. The middle of
 * a split trigger's React Native frame is the seam between its two halves, so each
 * half is pressed through its own rect.
 */
async function pressRect(rect: number[], what: string): Promise<void> {
  const [left, top, right, bottom] = edges(rect, what);
  expect(left).toBeGreaterThanOrEqual(0);
  expect(right).toBeGreaterThan(left);
  expect(bottom).toBeGreaterThan(top);
  await userEvent.pressAt(
    (left + right) / 2 / PixelRatio.get(),
    (top + bottom) / 2 / PixelRatio.get()
  );
}

/**
 * Picks a row through the model's own pick path: a harness press cannot reach a row,
 * which is drawn in the popup's own window.
 */
async function pickRow(testId: string, id: string): Promise<void> {
  const handle = handles.get(testId);
  if (handle == null) {
    throw new Error(`Cannot pick "${id}" - "${testId}" never mounted.`);
  }
  handle.nuiTestSelectRow(id);
  await settle(150);
}

const columnStyle = { gap: 8 } as const;

afterEach(() => {
  cleanup();
  handles.clear();
  buttonHandles.clear();
  selectLog.length = 0;
  stateLog.length = 0;
  orderLog.length = 0;
  primaryLog.length = 0;
  splitControl.setAction = undefined;
  splitControl.setDisabled = undefined;
  nitroUiCore.setSizingTraceEnabled(false);
});

// MARK: - The box

describe('Menu · G7a', () => {
  const VARIANTS = ['filled', 'tonal', 'outlined', 'text', 'elevated'] as const;
  /** `medium` is left out: it is the size of every other configuration here. */
  const TRIGGER_SIZES = ['small', 'large', 'xlarge', 'xxlarge'] as const;

  it('lays each configuration out at the size the control measured', async () => {
    // Every configuration is poisoned first, so each box has to come from a
    // correction rather than from the declared fallback.
    poisonConfigurations([
      ...VARIANTS.map((variant) => sizingKey(variant, 'medium', 'Variant')),
      ...TRIGGER_SIZES.map((size) => sizingKey('filled', size, 'Sized')),
    ]);
    const before = stats();
    await render(
      <View style={columnStyle}>
        {VARIANTS.map((variant) => (
          <Menu
            key={variant}
            title="Variant"
            group={GROUP}
            variant={variant}
            testID={`cfg-${variant}`}
            hybridRef={captureHybrid(`cfg-${variant}`)}
          />
        ))}
        {TRIGGER_SIZES.map((size) => (
          <Menu
            key={size}
            title="Sized"
            group={GROUP}
            size={size}
            testID={`cfg-size-${size}`}
            hybridRef={captureHybrid(`cfg-size-${size}`)}
          />
        ))}
      </View>,
      { timeout: 20000 }
    );
    const lines: string[] = [];
    for (const testId of [
      ...VARIANTS.map((variant) => `cfg-${variant}`),
      ...TRIGGER_SIZES.map((size) => `cfg-size-${size}`),
    ]) {
      await waitForTestId(testId);
      const content = await waitForMeasured(testId, testId);
      const box = await waitForBox(testId, content, testId);
      // The planted size surviving means no correction ever arrived; the fallback
      // surviving means the correction never replaced the first frame.
      expect(sameSize(box, WRONG_SIZE)).toBe(false);
      expect(sameSize(box, DECLARED_FALLBACK)).toBe(false);
      lines.push(`${testId}=${describeSize(box)}`);
    }
    await settle(300);
    const cold = delta(before, stats());
    console.log(
      `menu sizes (declared fallback ${describeSize(DECLARED_FALLBACK)}): ` +
        `${lines.join(' ')} corrections=${String(cold.corrections)} ` +
        `measurements=${String(cold.measurements)}`
    );
    // A poisoned entry is provisional and is laid out, so each one has to be
    // replaced by a correction.
    expect(cold.corrections).toBeGreaterThanOrEqual(
      VARIANTS.length + TRIGGER_SIZES.length
    );
  });

  it('takes exactly the box its Button twin takes', async () => {
    const key = sizingKey('filled', 'medium', 'Twin');
    poisonConfigurations([key]);
    poisonConfigurations([key], BUTTON_COMPONENT);
    const before = stats();
    await render(
      <View style={columnStyle}>
        <Menu
          title="Twin"
          group={GROUP}
          variant="filled"
          testID="twin-menu"
          hybridRef={captureHybrid('twin-menu')}
        />
        <Button
          title="Twin"
          variant="filled"
          testID="twin-button"
          hybridRef={captureButton('twin-button')}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('twin-menu');
    await waitForTestId('twin-button');
    const menuBox = await waitForBox(
      'twin-menu',
      await waitForMeasured('twin-menu', 'the menu'),
      'the menu'
    );
    const buttonBox = await waitForBox(
      'twin-button',
      await waitForMeasuredButton('twin-button', 'the Button'),
      'the Button'
    );
    await settle(300);
    const cold = delta(before, stats());
    console.log(
      `trigger parity: menu=${describeSize(menuBox)} ` +
        `button=${describeSize(buttonBox)} ` +
        `corrections=${String(cold.corrections)}`
    );
    // Neither box is inherited: both poisoned entries had to be replaced, so
    // parity cannot be two declared fallbacks agreeing by accident.
    expect(sameSize(menuBox, WRONG_SIZE)).toBe(false);
    expect(sameSize(buttonBox, WRONG_SIZE)).toBe(false);
    expect(cold.corrections).toBeGreaterThanOrEqual(2);
    expect(sameSize(menuBox, buttonBox)).toBe(true);
  });

  it('keeps the trigger when only the list changes', async () => {
    // A `group` that leaked into the sizing key would give the same box and still
    // cost a new cache entry, so both are checked.
    const key = sizingKey('filled', 'medium', 'List');
    poisonConfigurations([key]);
    const { rerender, unmount } = await render(
      <Menu
        title="List"
        group={GROUP}
        testID="list-small"
        hybridRef={captureHybrid('list-small')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('list-small');
    const smallSize = await waitForMeasured('list-small', 'the short list');
    await waitForBox('list-small', smallSize, 'the short list');
    await settle(150);

    const before = stats();
    await rerender(
      <Menu
        title="List"
        group={BIG_GROUP}
        testID="list-small"
        hybridRef={captureHybrid('list-small')}
      />
    );
    // No re-measure is owed here, so the wait is for the box to still be *this*
    // size after a frame rather than for it to become a different one.
    await settle(300);
    const after = delta(before, stats());
    const box = sizeOf('list-small');
    console.log(
      `group is not in the key: ${describeSize(smallSize)} -> ` +
        `${describeSize(box)} rows=${String(report('list-small').rows)} ` +
        `delta=${JSON.stringify(after)}`
    );
    expect(sameSize(box, smallSize)).toBe(true);
    expect(sameSize(box, WRONG_SIZE)).toBe(false);
    expect(after.cachedSizes).toBe(0);
    expect(after.corrections).toBe(0);

    // The big list did arrive: the asserts above would also hold if the second
    // render had been dropped.
    expect(handles.get('list-small')?.title).toBe('List');
    expect(report('list-small').rows).toBe(
      Platform.OS === 'android' ? 0 : BIG_PICKABLE
    );
    unmount();
  });

  it('re-measures when the title changes (R3)', async () => {
    const SHORT = 'Open';
    const LONG = 'Open this menu';
    poisonConfigurations([
      sizingKey('filled', 'medium', SHORT),
      sizingKey('filled', 'medium', LONG),
    ]);
    const before = stats();
    const { rerender, unmount } = await render(
      <Menu
        title={SHORT}
        group={GROUP}
        testID="title"
        hybridRef={captureHybrid('title')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('title');
    const shortSize = await waitForMeasured('title', 'the short title');
    await waitForBox('title', shortSize, 'the short title');
    const cold = delta(before, stats());
    expect(cold.corrections).toBeGreaterThanOrEqual(1);

    await rerender(
      <Menu
        title={LONG}
        group={GROUP}
        testID="title"
        hybridRef={captureHybrid('title')}
      />
    );
    const longSize = await waitForRemeasure(
      'title',
      shortSize,
      'the long title'
    );
    await waitForBox('title', longSize, 'the long title');
    expect(longSize.width).toBeGreaterThan(shortSize.width + 1);
    expect(handles.get('title')?.title).toBe(LONG);
    expect(delta(before, stats()).cachedSizes).toBeGreaterThanOrEqual(2);
    console.log(
      `title R3: short=${describeSize(shortSize)} long=${describeSize(longSize)}`
    );
    unmount();
  });

  // MARK: - Picking

  it('reports one onSelect per pick and nothing for a row that cannot be picked', async () => {
    // The refusals come first, and an empty log alone proves nothing: an event can
    // still be in flight. The enabled twin's answer shows events are delivered, and
    // the RN `Pressable` shows the harness press itself lands.
    const rnPresses: string[] = [];
    await render(
      <View style={columnStyle}>
        <Pressable
          testID="menu-barometer"
          onPress={(): void => {
            rnPresses.push('tap');
          }}
        >
          <Text>Barometer</Text>
        </Pressable>
        <Menu
          title="Actions"
          group={GROUP}
          testID="pick"
          hybridRef={captureHybrid('pick')}
          onSelect={recordSelect('pick')}
        />
        <Menu
          title="Other"
          group={GROUP}
          testID="twin"
          hybridRef={captureHybrid('twin')}
          onSelect={recordSelect('twin')}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('pick');
    const barometer = await waitForTestId('menu-barometer');
    await userEvent.pressAt(
      barometer.x + barometer.width / 2,
      barometer.y + barometer.height / 2
    );
    await pollUntil(
      () => (rnPresses.length > 0 ? true : null),
      () =>
        new Error(
          'The harness press reached neither the RN Pressable in this column nor ' +
            'anything else: this test cannot judge a Menu press.'
        ),
      5000
    );

    // Three refusals: a row the group says is disabled, a submenu parent (pickable
    // on neither platform) and an id the group does not hold.
    await pickRow('pick', 'paste');
    await pickRow('pick', 'share');
    await pickRow('pick', 'no-such-row');
    expect(selectLog).toEqual([]);

    await pickRow('twin', 'copy');
    await waitForLog(selectLog, 1, "the twin's pick");
    expect(selectLog).toEqual(['twin:copy']);

    await pickRow('pick', 'copy');
    await waitForLog(selectLog, 2, 'the first pick');
    expect(selectLog).toEqual(['twin:copy', 'pick:copy']);
    await pickRow('pick', 'delete');
    await waitForLog(selectLog, 3, 'the destructive pick');
    console.log(`picks: ${JSON.stringify(selectLog)}`);
    expect(selectLog).toEqual(['twin:copy', 'pick:copy', 'pick:delete']);
    expect(
      selectLog.filter((line) => /paste|share|no-such/.test(line))
    ).toEqual([]);
  });

  // MARK: - Open and close

  it('opens once, closes once, and pairs every open with a close', async () => {
    await render(
      <Menu
        title="Events"
        group={GROUP}
        testID="events"
        hybridRef={captureHybrid('events')}
        onSelect={recordSelect('events')}
        onOpen={recordOpen('events')}
        onClose={recordClose('events')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('events');

    if (Platform.OS !== 'android') {
      // iOS answers `-1` for all of it: the system keeps the presentation, so the
      // control cannot tell whether its menu is open. A press is delivered and
      // nothing is reported.
      const box = await waitForTestId('events');
      await userEvent.pressAt(box.x + box.width / 2, box.y + box.height / 2);
      await settle(400);
      expectUnanswerable(report('events'));
      expect(stateLog).toEqual([]);
      expect(await handles.get('events')?.title).toBe('Events');
      await pickRow('events', 'copy');
      await waitForLog(selectLog, 1, 'the iOS pick');
      expect(selectLog).toEqual(['events:copy']);
      console.log(
        'iOS: onOpen/onClose unobservable (system presentation) - asserted as ' +
          'unanswerable, not as zero'
      );
      return;
    }

    const closed = report('events');
    expect(closed.expanded).toBe(false);
    expect(closed.rows).toBe(0);
    const liveBefore = closed.live;

    await pressTrigger('events');
    const open = await waitForMenu(
      'events',
      (r) => r.expanded === true && r.live === (liveBefore ?? 0) + 1
    );
    expect(open.rows).toBe(PICKABLE);
    await waitForLog(stateLog, 1, 'the open');
    // Once, not twice: the anchor's own `onClick` and Material's expansion callback
    // both report the same request.
    expect(stateLog).toEqual(['events:open']);

    await pickRow('events', 'copy');
    const afterPick = await waitForMenu(
      'events',
      (r) => r.expanded === false && r.live === (liveBefore ?? 0)
    );
    expect(selectLog).toEqual(['events:copy']);
    expect(stateLog).toEqual(['events:open', 'events:close']);
    // A pick reports the choice first and the close after it.
    expect(orderLog).toEqual([
      'open:events',
      'select:events:copy',
      'close:events',
    ]);
    // The rect goes with the window.
    expect(afterPick.menu).toEqual([-1, -1, -1, -1]);
    expect(afterPick.rows).toBe(0);

    await pressTrigger('events');
    await waitForMenu(
      'events',
      (r) => r.expanded === true && r.live === (liveBefore ?? 0) + 1
    );
    await waitForLog(stateLog, 3, 'the second open');
    expect(stateLog[2]).toBe('events:open');
    console.log(`open/close: ${JSON.stringify(stateLog)}`);
    // Leave nothing up for the next test.
    await pickRow('events', 'copy');
    // A delta, not `=== 0`: `live` is process-wide, so a menu an earlier test left
    // open would count here.
    await waitForMenu(
      'events',
      (r) => r.expanded === false && r.live === (liveBefore ?? 0)
    );
  });

  it('closes when it is disabled while the menu is open', async () => {
    const { rerender, unmount } = await render(
      <Menu
        title="Disable"
        group={GROUP}
        testID="disable"
        hybridRef={captureHybrid('disable')}
        onSelect={recordSelect('disable')}
        onOpen={recordOpen('disable')}
        onClose={recordClose('disable')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('disable');
    if (Platform.OS !== 'android') {
      // iOS has no open state to read; what is checkable is that the flag React
      // sent reaches the control.
      rerender(
        <Menu
          title="Disable"
          group={GROUP}
          disabled
          testID="disable"
          hybridRef={captureHybrid('disable')}
          onOpen={recordOpen('disable')}
          onClose={recordClose('disable')}
        />
      );
      await settle(300);
      expect(handles.get('disable')?.disabled).toBe(true);
      expectUnanswerable(report('disable'));
      console.log(
        'iOS: disabled-while-open is unobservable; the flag round-trips'
      );
      unmount();
      return;
    }

    const liveBefore = report('disable').live ?? 0;
    await pressTrigger('disable');
    await waitForMenu(
      'disable',
      (r) => r.expanded === true && r.live === liveBefore + 1
    );
    rerender(
      <Menu
        title="Disable"
        group={GROUP}
        disabled
        testID="disable"
        hybridRef={captureHybrid('disable')}
        onSelect={recordSelect('disable')}
        onOpen={recordOpen('disable')}
        onClose={recordClose('disable')}
      />
    );
    // Both halves, not just `expanded`: `expanded` is model state and drops with the
    // props batch, while the window goes later, when Compose disposes the popup.
    const closed = await waitForMenu(
      'disable',
      (r) => r.expanded === false && r.live === liveBefore
    );
    expect(closed.menu).toEqual([-1, -1, -1, -1]);
    expect(stateLog).toEqual(['disable:open', 'disable:close']);
    expect(handles.get('disable')?.disabled).toBe(true);

    // Re-enabling must not resurrect a window nobody asked for, and a row must not
    // be pickable while it is disabled.
    rerender(
      <Menu
        title="Disable"
        group={GROUP}
        testID="disable"
        hybridRef={captureHybrid('disable')}
        onSelect={recordSelect('disable')}
        onOpen={recordOpen('disable')}
        onClose={recordClose('disable')}
      />
    );
    await settle(400);
    const after = report('disable');
    expect(after.expanded).toBe(false);
    expect(after.live).toBe(liveBefore);
    console.log(`disable-while-open: ${JSON.stringify(stateLog)}`);
    unmount();
  });

  // MARK: - What the list holds

  /** `GROUP` with two rows: what a menu shrinks *to*. */
  const SMALL_GROUP: MenuGroup = {
    actions: [
      { id: 'first', title: 'First' },
      { id: 'second', title: 'Second' },
    ],
  };

  it('renders a submenu inline on Android and nested on iOS', async () => {
    await render(
      <Menu
        title="Share"
        group={GROUP}
        testID="submenu"
        hybridRef={captureHybrid('submenu')}
        onSelect={recordSelect('submenu')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('submenu');
    const closed = report('submenu');

    if (Platform.OS === 'android') {
      const liveBefore = closed.live ?? 0;
      await pressTrigger('submenu');
      const open = await waitForMenu(
        'submenu',
        (r) => r.expanded === true && r.live === liveBefore + 1
      );
      // Six is the inline answer: a nested list would compose four rows here (Copy,
      // Cut, Paste, Share), because a submenu's children exist only once its own
      // window opens.
      expect(open.rows).toBe(PICKABLE);
      expect(open.rows).toBeGreaterThan(4);
      // The parent draws a header and answers nothing; its children answer.
      await pickRow('submenu', 'share');
      expect(selectLog).toEqual([]);
      await pickRow('submenu', 'share.messages');
      await waitForLog(selectLog, 1, 'the submenu child');
      expect(selectLog).toEqual(['submenu:share.messages']);
      await waitForMenu(
        'submenu',
        (r) => r.expanded === false && r.live === liveBefore
      );
    } else {
      // iOS nests, so the system's window holds the children and this control can
      // only report the rows its own model holds.
      expect(closed.rows).toBe(PICKABLE);
      await pickRow('submenu', 'share');
      expect(selectLog).toEqual([]);
      await pickRow('submenu', 'share.mail');
      await waitForLog(selectLog, 1, 'the nested submenu child');
      expect(selectLog).toEqual(['submenu:share.mail']);
      console.log(
        `submenu: android=composed rows (inline), ios=model rows (nested); ` +
          `rows=${String(closed.rows)}`
      );
    }
  });

  /**
   * A trigger whose title is shorter than its rows. "Move into a folder" needs more
   * width than Material's 112 dp list floor.
   */
  const WIDE_GROUP: MenuGroup = {
    actions: [
      { id: 'move', title: 'Move' },
      { id: 'folder', title: 'Move into a folder' },
    ],
  };

  /** Two rows, both shorter than Material's own 112 dp list floor. */
  const NARROW_GROUP: MenuGroup = {
    actions: [
      { id: 'a', title: 'Up' },
      { id: 'b', title: 'Down' },
    ],
  };

  /**
   * Material's own minimum width for a dropdown list, and its own maximum for a row's
   * content (`DropdownMenuItemDefaultMinWidth` / `…MaxWidth` in `Menu.kt`, both private).
   */
  const MATERIAL_LIST_MIN_DP = 112;
  const MATERIAL_LIST_MAX_DP = 280;

  /** One popup, measured: its width and where its start edge landed, in device px. */
  type PopupMeasure = {
    popupWidthPx: number;
    anchorWidthPx: number;
    /** The popup's start edge and the trigger's, both device px from one read. */
    popupStartPx: number;
    anchorStartPx: number;
  };

  /**
   * Opens `testId` and measures its popup against its own trigger. `live` is read
   * here rather than passed in because it counts every menu in the process.
   */
  async function openAndMeasurePopup(testId: string): Promise<PopupMeasure> {
    const liveBefore = report(testId).live ?? 0;
    await pressTrigger(testId);
    const open = await waitForMenu(
      testId,
      (r) => r.expanded === true && (r.live ?? 0) === liveBefore + 1
    );
    const [menuLeft, , menuRight] = edges(open.menu, 'menu');
    const [anchorLeft, , anchorRight] = edges(open.anchor, 'anchor');
    return {
      popupWidthPx: menuRight - menuLeft,
      anchorWidthPx: anchorRight - anchorLeft,
      popupStartPx: menuLeft,
      anchorStartPx: anchorLeft,
    };
  }

  /** Closes `testId`'s popup by picking a row, so the next measurement is one window. */
  async function closePopupByPicking(
    testId: string,
    id: string
  ): Promise<void> {
    const liveWhenOpen = report(testId).live ?? 0;
    await pickRow(testId, id);
    await waitForMenu(
      testId,
      (r) => r.expanded === false && (r.live ?? 0) === liveWhenOpen - 1
    );
  }

  it('gives the list the width its items need, not the trigger\u2019s', async () => {
    const { unmount } = await render(
      <View style={{ gap: 6 }}>
        <Menu
          title="Move"
          group={WIDE_GROUP}
          testID="wide-list"
          hybridRef={captureHybrid('wide-list')}
          onSelect={recordSelect('wide-list')}
        />
        {/* A short list in the same render measures where Material's 112 dp floor
            sits on this device, so the wide popup is compared with that and not
            with a constant. */}
        <Menu
          title="Up"
          group={NARROW_GROUP}
          testID="floor-list"
          hybridRef={captureHybrid('floor-list')}
          onSelect={recordSelect('floor-list')}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('wide-list');
    await waitForTestId('floor-list');
    const closed = report('wide-list');
    const closedFloor = report('floor-list');

    if (Platform.OS !== 'android') {
      // iOS presents through the system's menu, which gives the control no window
      // to measure; only the model's own rows are answerable.
      expectUnanswerable(closed);
      expectUnanswerable(closedFloor);
      expect(closed.rows).toBe(WIDE_GROUP.actions?.length ?? 0);
      expect(closedFloor.rows).toBe(NARROW_GROUP.actions?.length ?? 0);
      console.log(
        `wide/floor lists on iOS: no popup window to measure (D23); rows ` +
          `${String(closed.rows)}/${String(closedFloor.rows)}`
      );
      unmount();
      return;
    }

    const trigger = await waitForBox(
      'wide-list',
      await waitForMeasured('wide-list', 'the trigger'),
      'the trigger'
    );
    const wide = await openAndMeasurePopup('wide-list');
    // `ExposedDropdownMenu` matches the anchor's width by default, which clips every
    // row longer than the trigger. The rows are Compose nodes that `queryByTestId`
    // cannot reach, so the popup window's own rect is what is read.
    expect(wide.anchorWidthPx).toBeGreaterThan(0);
    expect(wide.popupWidthPx).toBeGreaterThan(wide.anchorWidthPx);

    // The first popup is closed by picking a row, so only one is on screen while
    // the next is measured. A list of two short rows sits on Material's floor.
    await closePopupByPicking('wide-list', 'folder');
    const floor = await openAndMeasurePopup('floor-list');
    const floorPx = MATERIAL_LIST_MIN_DP * PixelRatio.get();
    expect(floor.popupWidthPx).toBeGreaterThanOrEqual(floorPx - 1);

    // The width is the items', not a constant's: strictly wider than a list that
    // needed nothing but the floor.
    expect(wide.popupWidthPx).toBeGreaterThan(floor.popupWidthPx);

    // `<=`, not `<`: a popup whose widest row wants exactly Material's 280 dp cap
    // may be exactly the cap, which a large font scale can reach.
    expect(wide.popupWidthPx / PixelRatio.get()).toBeLessThanOrEqual(
      MATERIAL_LIST_MAX_DP
    );

    // Horizontal placement is printed, not asserted: it is decided by Material's
    // `ExposedDropdownMenuPositionProvider`.
    await closePopupByPicking('floor-list', 'a');
    console.log(
      `wide list: trigger ${String(wide.anchorWidthPx)} px, popup ` +
        `${String(wide.popupWidthPx)} px ` +
        `(${(wide.popupWidthPx / PixelRatio.get()).toFixed(1)} dp), floor list ` +
        `${String(floor.popupWidthPx)} px, start ${String(wide.popupStartPx)} vs ` +
        `${String(wide.anchorStartPx)}, trigger box ${describeSize(trigger)}`
    );
    unmount();
  });

  /**
   * A section whose title is far longer than the 280 dp a Material row stops at, over
   * rows that need almost nothing.
   */
  const LONG_HEADER_GROUP: MenuGroup = {
    sections: [
      {
        id: 'long',
        title:
          'A section title long enough to want more width than a Material menu row is ' +
          'ever allowed to take, which is the point of it',
        items: [{ id: 'tiny', title: 'Up' }],
      },
    ],
  };

  it('caps a section header at the width a row stops at', async () => {
    const { unmount } = await render(
      <Menu
        title="Sections"
        group={LONG_HEADER_GROUP}
        testID="long-header"
        hybridRef={captureHybrid('long-header')}
        onSelect={recordSelect('long-header')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('long-header');
    if (Platform.OS !== 'android') {
      expectUnanswerable(report('long-header'));
      unmount();
      return;
    }

    const { popupWidthPx } = await openAndMeasurePopup('long-header');
    // The popup is as wide as its widest child asks. Material caps a row at 280 dp,
    // but a header is not a row, so the header has to carry the same cap itself.
    expect(popupWidthPx / PixelRatio.get()).toBeLessThanOrEqual(
      MATERIAL_LIST_MAX_DP
    );
    console.log(
      `long header: popup ${String(popupWidthPx)} px ` +
        `(${(popupWidthPx / PixelRatio.get()).toFixed(1)} dp, cap ` +
        `${String(MATERIAL_LIST_MAX_DP)} dp)`
    );
    await closePopupByPicking('long-header', 'tiny');
    unmount();
  });

  it('keeps Material\u2019s 112 dp floor on a list of short items', async () => {
    const { unmount } = await render(
      <Menu
        title="Up"
        group={NARROW_GROUP}
        testID="narrow-list"
        hybridRef={captureHybrid('narrow-list')}
        onSelect={recordSelect('narrow-list')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('narrow-list');
    if (Platform.OS !== 'android') {
      expectUnanswerable(report('narrow-list'));
      unmount();
      return;
    }
    const liveBefore = report('narrow-list').live ?? 0;
    await pressTrigger('narrow-list');
    const open = await waitForMenu(
      'narrow-list',
      (r) => r.expanded === true && r.live === liveBefore + 1
    );
    const [menuLeft, , menuRight] = edges(open.menu, 'menu');
    const [anchorLeft, , anchorRight] = edges(open.anchor, 'anchor');
    const scale = PixelRatio.get();
    // Both rows are shorter than Material's minimum, so the popup sits on the floor
    // rather than shrinking to the trigger.
    expect((menuRight - menuLeft) / scale).toBeGreaterThanOrEqual(
      MATERIAL_LIST_MIN_DP
    );
    console.log(
      `short list: popup ${String(menuRight - menuLeft)} px = ` +
        `${((menuRight - menuLeft) / scale).toFixed(1)} dp (floor ` +
        `${String(MATERIAL_LIST_MIN_DP)}), trigger ${String(anchorRight - anchorLeft)} px`
    );
    unmount();
  });

  it('draws every row of an untitled group, with its role (G9)', async () => {
    await render(
      <Menu
        title="File"
        group={UNTITLED_GROUP}
        testID="untitled"
        hybridRef={captureHybrid('untitled')}
        onSelect={recordSelect('untitled')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('untitled');
    const handle = await waitForHandle('untitled', 'the untitled-group menu');
    const before = report('untitled');
    // No probe has run yet, so nothing is reported as drawn.
    expect(before.drawn).toBeNull();

    if (Platform.OS === 'ios') {
      // `rows` counts what the model asked SwiftUI to draw, not what it drew.
      expect(before.rows).toBe(UNTITLED_PICKABLE);
      handle.nuiTestMenuProbe();
      const probed = await waitForMenu('untitled', (r) => r.drawn != null);
      const drawn = probed.drawn ?? '';
      console.log(`untitled group: ios drawn=${drawn}`);
      // The titled groups first: the barrier that the probe read a real menu.
      expect(drawnGroup(drawn, 'Share')).toEqual(['AirDrop', 'Mail']);
      expect(drawnGroup(drawn, 'More')).toEqual(['Get Info']);
      expect(drawnGroup(drawn, '')).toEqual(UNTITLED_ROWS);
      // And the whole menu, in order, so a row moved between groups is red too.
      expect(drawn).toBe(
        `Open,(Share:AirDrop,Mail),(:${UNTITLED_ROWS.join(',')}),(More:Get Info)`
      );
    } else {
      const liveBefore = before.live ?? 0;
      // With no popup open there is nothing to read, so the probe leaves the report
      // alone.
      handle.nuiTestMenuProbe();
      await settle(150);
      expect(report('untitled').drawn).toBeNull();
      await pressTrigger('untitled');
      // `rows` here counts the rows the popup composed.
      const open = await waitForMenu(
        'untitled',
        (r) =>
          r.expanded === true && r.live === liveBefore + 1 && r.drawn != null
      );
      expect(open.rows).toBe(UNTITLED_PICKABLE);
      // The popup's own semantics tree: every Material group, the untitled one
      // with both of its rows. Destructive is a colour there, so no `!`.
      console.log(`untitled group: android drawn=${open.drawn ?? ''}`);
      expect(drawnGroup(open.drawn ?? '', 'Share')).toEqual([
        'AirDrop',
        'Mail',
      ]);
      expect(open.drawn).toBe(
        '(:Open),(Share:AirDrop,Mail),(:Delete,Archive~),(More:Get Info)'
      );
    }

    await pickRow('untitled', 'archive');
    expect(selectLog).toEqual([]);
    if (Platform.OS === 'android') {
      // A press on a disabled row still takes the popup down; reopen for the pick
      // that reports.
      await waitForMenu('untitled', (r) => r.expanded === false);
      await pressTrigger('untitled');
      await waitForMenu('untitled', (r) => r.expanded === true);
    }
    await pickRow('untitled', 'delete');
    await waitForLog(selectLog, 1, "the untitled group's destructive row");
    expect(selectLog).toEqual(['untitled:delete']);
    if (Platform.OS === 'android') {
      await waitForMenu('untitled', (r) => r.expanded === false);
    }
  });

  it('relays the rows when the group changes while it is open', async () => {
    const { rerender, unmount } = await render(
      <Menu
        title="Shrink"
        group={GROUP}
        testID="shrink"
        hybridRef={captureHybrid('shrink')}
        onSelect={recordSelect('shrink')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('shrink');
    // Closed, `rows` differs by platform: Android counts the rows the open popup
    // composed (none while it is shut), iOS counts what its model can build.
    if (Platform.OS !== 'android') {
      expect(report('shrink').rows).toBe(PICKABLE);
    }

    const shrinkTo = (
      <Menu
        title="Shrink"
        group={SMALL_GROUP}
        testID="shrink"
        hybridRef={captureHybrid('shrink')}
        onSelect={recordSelect('shrink')}
      />
    );

    if (Platform.OS !== 'android') {
      // No window to watch on iOS: an open menu's contents are the system's, so a
      // closed one is the only place the relay can be read from.
      rerender(shrinkTo);
      await settle(300);
      expect(report('shrink').rows).toBe(2);
      await pickRow('shrink', 'first');
      await waitForLog(selectLog, 1, 'the row that replaced it');
      expect(selectLog).toEqual(['shrink:first']);
      unmount();
      return;
    }

    const liveBefore = report('shrink').live ?? 0;
    await pressTrigger('shrink');
    const open = await waitForMenu(
      'shrink',
      (r) => r.rows === PICKABLE && r.expanded === true
    );
    expect(open.live).toBe(liveBefore + 1);
    rerender(shrinkTo);
    const shrunk = await waitForMenu('shrink', (r) => r.rows === 2);
    // The same window, not a new one: the menu did not close and reopen to change
    // its contents, so the press that opened it still stands.
    expect(shrunk.expanded).toBe(true);
    expect(shrunk.live).toBe(liveBefore + 1);
    // And the new list is the live one: `first` exists only in the shrunk group.
    await pickRow('shrink', 'first');
    await waitForLog(selectLog, 1, 'the row that replaced it');
    expect(selectLog).toEqual(['shrink:first']);
    await waitForMenu(
      'shrink',
      (r) => r.expanded === false && r.live === liveBefore
    );
    unmount();
  });

  // MARK: - Teardown

  it('leaves nothing behind when a Menu with an open menu is dropped', async () => {
    // `live` counts menus in the whole process and the dropped control cannot report
    // on itself, so the count is read on a surviving control, as a delta.
    const tree = (openPresent: boolean) => (
      <View style={columnStyle}>
        {openPresent ? (
          <Menu
            title="Dropped"
            group={GROUP}
            testID="drop-open"
            hybridRef={captureHybrid('drop-open')}
            onSelect={recordSelect('drop-open')}
          />
        ) : null}
        <Menu
          title="Survivor"
          group={GROUP}
          testID="drop-witness"
          hybridRef={captureHybrid('drop-witness')}
          onSelect={recordSelect('drop-witness')}
        />
      </View>
    );
    const { rerender, unmount } = await render(tree(true), { timeout: 20000 });
    await waitForTestId('drop-open');
    await waitForTestId('drop-witness');

    if (Platform.OS !== 'android') {
      // iOS reports `-1` for `live`, so nothing here can be measured.
      expectUnanswerable(report('drop-witness'));
      console.log('iOS: no live-menu count exists to drop back to zero');
      unmount();
      return;
    }

    const liveBefore = report('drop-witness').live ?? 0;
    await pressTrigger('drop-open');
    const open = await waitForMenu(
      'drop-open',
      (r) => r.expanded === true && r.live === liveBefore + 1
    );
    expect(open.rows).toBe(PICKABLE);
    expect(report('drop-witness').live).toBe(liveBefore + 1);

    rerender(tree(false));
    const after = await waitForMenu(
      'drop-witness',
      (r) => (r.live ?? 0) === liveBefore
    );
    expect(after.live).toBe(liveBefore);
    // And the tree the drop left behind is healthy: the survivor opens and closes on
    // its own, which a composition that had given up would not do.
    await pressTrigger('drop-witness');
    await waitForMenu(
      'drop-witness',
      (r) => r.expanded === true && r.live === liveBefore + 1
    );
    await pickRow('drop-witness', 'copy');
    const settled = await waitForMenu(
      'drop-witness',
      (r) => r.expanded === false && r.live === liveBefore
    );
    expect(settled.menu).toEqual([-1, -1, -1, -1]);
    console.log(
      `drop-while-open: live ${String(liveBefore)} -> ` +
        `${String(liveBefore + 1)} -> ${String(after.live)}`
    );
    unmount();
  });

  it('carries no old state across a remount', async () => {
    // A test cannot force Fabric to recycle the view, so the claim holds either way:
    // a fresh mount of the same id shows what React sent and nothing the last
    // instance left behind, including an open menu.
    const { unmount } = await render(
      <Menu
        title="Recycled"
        group={GROUP}
        testID="recycle"
        hybridRef={captureHybrid('recycle')}
        onSelect={recordSelect('recycle')}
        onOpen={recordOpen('recycle')}
        onClose={recordClose('recycle')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('recycle');
    const liveBefore = report('recycle').live ?? 0;
    if (Platform.OS === 'android') {
      await pressTrigger('recycle');
      await waitForMenu(
        'recycle',
        (r) => r.expanded === true && r.live === liveBefore + 1
      );
    }
    unmount();
    await settle(400);
    // The only handle that exists now is the one the teardown left behind, so the
    // short wait below has to fail, naming what it refused.
    const previousTitle = handles.get('recycle')?.title ?? null;
    const previousSize = measured('recycle');
    let refusal = 'answered';
    try {
      await waitForFreshMeasure(
        'recycle',
        'Renamed',
        'the previous mount',
        1500
      );
    } catch (error) {
      refusal = String(error);
    }
    console.log(
      `refuse previous mount: title=${JSON.stringify(previousTitle)} ` +
        `measured=${describeSize(previousSize)} -> ${refusal}`
    );
    expect(previousTitle).not.toBe('Renamed');
    // The torn-down handle answers `0x0` on both platforms (drop and recycle clear
    // the cached size), so the zero check and the title check both refuse it here.
    expect(refusal).toContain('never answered as "Renamed"');
    selectLog.length = 0;
    stateLog.length = 0;
    orderLog.length = 0;

    const { unmount: unmountAgain } = await render(
      <Menu
        title="Renamed"
        group={SMALL_GROUP}
        testID="recycle"
        hybridRef={captureHybrid('recycle')}
        onSelect={recordSelect('recycle')}
        onOpen={recordOpen('recycle')}
        onClose={recordClose('recycle')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('recycle');
    await waitForFreshMeasure('recycle', 'Renamed', 'the remounted menu');
    // This handle has a real size to offer, so asking for a title no mount was given
    // can only be refused by the title check.
    let wrongTitleRefusal = 'answered';
    try {
      await waitForFreshMeasure(
        'recycle',
        'NeverGiven',
        'the live mount',
        1000
      );
    } catch (error) {
      wrongTitleRefusal = String(error);
    }
    expect(wrongTitleRefusal).toContain('never answered as "NeverGiven"');
    const fresh = report('recycle');
    expect(handles.get('recycle')?.title).toBe('Renamed');
    expect(fresh.rows).toBe(Platform.OS === 'android' ? 0 : 2);
    if (Platform.OS === 'android') {
      expect(fresh.expanded).toBe(false);
      expect(fresh.live).toBe(liveBefore);
      // The old instance's callbacks are gone with it: a pick answers through the
      // new mount's `onSelect` exactly once, and no `onOpen` leaks from before.
      await pickRow('recycle', 'first');
      await waitForLog(selectLog, 1, 'the remounted pick');
      expect(selectLog).toEqual(['recycle:first']);
      expect(stateLog).toEqual([]);
    } else {
      expectUnanswerable(fresh);
    }
    unmountAgain();
  });
});

// MARK: - Expressive rows

/**
 * Every row shape at once: a checked row with a subtitle, an unchecked checkable
 * row, a plain row with a subtitle, a titled group holding a checked row and a
 * disabled row with a subtitle, and an untitled group with a destructive row.
 */
const E2_GROUP: MenuGroup = {
  actions: [
    { id: 'grid', title: 'Grid', subtitle: 'Tiles', checked: true },
    { id: 'list', title: 'List', checked: false },
    { id: 'rename', title: 'Rename', subtitle: 'Edit the name' },
  ],
  sections: [
    {
      id: 'sort',
      title: 'Sort',
      items: [
        { id: 'name', title: 'Name', checked: true },
        {
          id: 'date',
          title: 'Date',
          subtitle: 'Newest first',
          disabled: true,
        },
      ],
    },
    {
      id: 'danger',
      items: [{ id: 'delete', title: 'Delete', destructive: true }],
    },
  ],
};

/** {@link E2_GROUP} with every `subtitle` and `checked` taken away. */
const E2_PLAIN: MenuGroup = {
  actions: [
    { id: 'grid', title: 'Grid' },
    { id: 'list', title: 'List' },
    { id: 'rename', title: 'Rename' },
  ],
  sections: [
    {
      id: 'sort',
      title: 'Sort',
      items: [
        { id: 'name', title: 'Name' },
        { id: 'date', title: 'Date', disabled: true },
      ],
    },
    {
      id: 'danger',
      items: [{ id: 'delete', title: 'Delete', destructive: true }],
    },
  ],
};

/**
 * What each platform's own menu holds for {@link E2_GROUP} and {@link E2_PLAIN}, in
 * `drawn` notation. iOS reads UIKit's `UIMenu`, where an unchecked toggle is `.off`
 * like a plain row, so `List` has no mark. Android reads the popup's semantics tree:
 * every Material group is `( )` - the top-level actions too - an unchecked checkable
 * row is `=`, and destructive is a colour the tree does not carry.
 */
const E2_DRAWN =
  Platform.OS === 'ios'
    ? 'Grid@Tiles+,List,Rename@Edit the name,(Sort:Name+,Date@Newest first~),(:Delete!)'
    : '(:Grid@Tiles+,List=,Rename@Edit the name),(Sort:Name+,Date@Newest first~),(:Delete)';
const E2_PLAIN_DRAWN =
  Platform.OS === 'ios'
    ? 'Grid,List,Rename,(Sort:Name,Date~),(:Delete!)'
    : '(:Grid,List,Rename),(Sort:Name,Date~),(:Delete)';

/**
 * Read what the platform drew for `testId` and hand back the first answer that is not
 * `previous`: iOS opens and closes the menu through the probe, Android opens the popup
 * with a real press on the trigger (its witness reads the popup's semantics tree on
 * layout) and leaves it open.
 */
async function readDrawn(
  testId: string,
  previous: string | null = null
): Promise<string> {
  if (Platform.OS === 'ios') {
    const handle = await waitForHandle(testId, 'the probed menu');
    handle.nuiTestMenuProbe();
  } else {
    await pressTrigger(testId);
  }
  const seen = await waitForMenu(
    testId,
    (r) =>
      r.drawn != null &&
      r.drawn !== previous &&
      (Platform.OS === 'ios' || r.expanded === true)
  );
  return seen.drawn ?? '';
}

/** Close an open Android popup through a row that reports nothing (`date` is disabled). */
async function closeQuietly(testId: string): Promise<void> {
  if (Platform.OS === 'android') {
    await pickRow(testId, 'date');
    await waitForMenu(testId, (r) => r.expanded === false);
  }
}

/** Mount-time state for {@link E2Menu}: the setter a test uses to change `group`. */
const e2Control: { setGroup?: (group: MenuGroup) => void } = {};

function E2Menu({ testId, initial }: { testId: string; initial: MenuGroup }) {
  const [group, setGroup] = useState(initial);
  e2Control.setGroup = setGroup;
  return (
    <Menu
      title="View"
      group={group}
      testID={testId}
      hybridRef={captureHybrid(testId)}
      onSelect={recordSelect(testId)}
      onOpen={recordOpen(testId)}
      onClose={recordClose(testId)}
    />
  );
}

describe('Menu · Expressive rows (E2)', () => {
  it('draws groups, subtitles and checks in the platform’s own menu', async () => {
    await render(<E2Menu testId="e2-rows" initial={E2_GROUP} />, {
      timeout: 20000,
    });
    await waitForTestId('e2-rows');
    await waitForHandle('e2-rows', 'the E2 menu');
    // No probe has run yet, so nothing is reported as drawn.
    expect(report('e2-rows').drawn).toBeNull();
    const drawn = await readDrawn('e2-rows');
    console.log(`e2 rows: ${Platform.OS} drawn=${drawn}`);
    // The whole menu, in order: every subtitle and check where the platform puts it,
    // and on Android three Material groups, each section a surface of its own.
    expect(drawn).toBe(E2_DRAWN);
    if (Platform.OS === 'android') {
      expect(drawn.split('),(')).toHaveLength(3);
    }

    // A checked row is still a row: its pick reports the id once, and nothing flips
    // locally - the check is whatever the app sends next.
    await pickRow('e2-rows', 'grid');
    await waitForLog(selectLog, 1, 'the checked row');
    expect(selectLog).toEqual(['e2-rows:grid']);
    if (Platform.OS === 'android') {
      await waitForMenu('e2-rows', (r) => r.expanded === false);
      // One open, one close, pick before close.
      expect(orderLog).toEqual([
        'open:e2-rows',
        'select:e2-rows:grid',
        'close:e2-rows',
      ]);
    }
  });

  it('takes subtitle and checked away in place, and a remount starts with neither', async () => {
    const { unmount } = await render(
      <E2Menu testId="e2-reset" initial={E2_GROUP} />,
      { timeout: 20000 }
    );
    await waitForTestId('e2-reset');
    await waitForHandle('e2-reset', 'the E2 menu');
    const full = await readDrawn('e2-reset');
    expect(full).toBe(E2_DRAWN);
    await closeQuietly('e2-reset');

    // In place: the same mount, new props.
    e2Control.setGroup?.(E2_PLAIN);
    await settle(200);
    const plain = await readDrawn('e2-reset', full);
    console.log(`e2 in place: ${Platform.OS} drawn=${plain}`);
    expect(plain).toBe(E2_PLAIN_DRAWN);
    await closeQuietly('e2-reset');
    // And back, so the rows really follow the prop rather than having lost it.
    e2Control.setGroup?.(E2_GROUP);
    await settle(200);
    expect(await readDrawn('e2-reset', plain)).toBe(E2_DRAWN);
    await closeQuietly('e2-reset');

    // Across a remount - Fabric may hand back the same native view from its recycle
    // pool: nothing the last owner drew may answer for the new one before it draws.
    unmount();
    await settle(400);
    handles.delete('e2-reset');
    const { unmount: unmountAgain } = await render(
      <E2Menu testId="e2-reset" initial={E2_PLAIN} />,
      { timeout: 20000 }
    );
    await waitForTestId('e2-reset');
    await waitForHandle('e2-reset', 'the remounted E2 menu');
    expect(report('e2-reset').drawn).toBeNull();
    const fresh = await readDrawn('e2-reset');
    console.log(`e2 remount: ${Platform.OS} drawn=${fresh}`);
    expect(fresh).toBe(E2_PLAIN_DRAWN);
    await closeQuietly('e2-reset');
    unmountAgain();
  });
});

// MARK: - Split trigger

/** Mount-time setters for {@link SplitMenu}, so a test can change one prop in place. */
const splitControl: {
  setAction?: (on: boolean) => void;
  setDisabled?: (on: boolean) => void;
} = {};

/**
 * A Menu whose `primaryAction` a test can take away and hand back without
 * remounting. "Off" is `undefined`, not a no-op: only `undefined` makes the trigger a
 * single button.
 */
function SplitMenu({ testId }: { testId: string }) {
  const [action, setAction] = useState(true);
  const [disabled, setDisabled] = useState(false);
  splitControl.setAction = setAction;
  splitControl.setDisabled = setDisabled;
  return (
    <Menu
      title="Publish"
      group={GROUP}
      disabled={disabled}
      testID={testId}
      hybridRef={captureHybrid(testId)}
      onSelect={recordSelect(testId)}
      onOpen={recordOpen(testId)}
      onClose={recordClose(testId)}
      primaryAction={action ? recordPrimary(testId) : undefined}
    />
  );
}

describe('Menu · Split trigger (E3)', () => {
  it('is two halves, and each one does only its own job', async () => {
    await render(<SplitMenu testId="split" />, { timeout: 20000 });
    await waitForTestId('split');
    await waitForHandle('split', 'the split menu');

    if (Platform.OS !== 'android') {
      // iOS has no second hit target, so the layout fields answer `-1`. A SwiftUI
      // `Menu` built with `primaryAction:` acts on a tap and opens on a long press,
      // and the harness's synthesised touch does reach that tap.
      const before = report('split');
      expectUnanswerable(before);
      expect(before.split).toBeNull();
      await pressTrigger('split');
      await waitForLog(primaryLog, 1, 'the split trigger tap');
      await settle(250);
      expect(primaryLog).toEqual(['split:action']);
      expect(stateLog).toEqual([]);
      expect(report('split').split).toBeNull();
      console.log(
        "iOS: one button, one gesture - the press reaches SwiftUI's tap and runs the " +
          'action, while split/leading/trailing stay -1 because there is no second ' +
          "hit target to measure and opening stays G7b's real-input case"
      );
      return;
    }

    // --- The trigger *is* a split button: two non-degenerate, disjoint rects that
    // together fill the control's own box.
    const drawn = await waitForMenu('split', (r) => r.split === true);
    const [lLeft, lTop, lRight, lBottom] = edges(drawn.leading, 'leading half');
    const [tLeft, tTop, tRight, tBottom] = edges(
      drawn.trailing,
      'trailing half'
    );
    expect(lRight).toBeGreaterThan(lLeft);
    expect(tRight).toBeGreaterThan(tLeft);
    expect(lBottom).toBeGreaterThan(lTop);
    expect(lTop).toBe(tTop);
    expect(lBottom).toBe(tBottom);
    expect(lLeft).toBeLessThan(tLeft);
    expect(lRight).toBeLessThanOrEqual(tLeft + 1);
    const frame = boxOf('split');
    expect(frame).not.toBeNull();
    const ratio = PixelRatio.get();
    const boxRight = (frame!.x + frame!.width) * ratio;
    const boxBottom = (frame!.y + frame!.height) * ratio;
    expect(lLeft).toBeGreaterThanOrEqual(frame!.x * ratio - 2);
    expect(tRight).toBeLessThanOrEqual(boxRight + 2);
    expect(tBottom).toBeLessThanOrEqual(boxBottom + 2);
    console.log(
      `split halves: leading=${lLeft},${lTop},${lRight},${lBottom} ` +
        `trailing=${tLeft},${tTop},${tRight},${tBottom} box=${describeSize(frame)}`
    );

    const liveBefore = drawn.live ?? 0;

    // --- The leading half: the action, and *nothing else*. No open, no close, no
    // popup, and the list count unmoved.
    await pressRect(drawn.leading, 'the action half');
    await waitForLog(primaryLog, 1, 'the action half');
    await settle(250);
    expect(primaryLog).toEqual(['split:action']);
    expect(stateLog).toEqual([]);
    expect(orderLog).toEqual(['action:split']);
    const stillShut = report('split');
    expect(stillShut.expanded).toBe(false);
    expect(stillShut.live).toBe(liveBefore);
    expect(stillShut.split).toBe(true);

    // --- The trailing half: the list, exactly once. One press is one `onOpen`.
    await pressRect(drawn.trailing, 'the list half');
    const opened = await waitForMenu(
      'split',
      (r) => r.expanded === true && r.live === liveBefore + 1
    );
    expect(stateLog).toEqual(['split:open']);
    expect(primaryLog).toEqual(['split:action']);
    expect(orderLog).toEqual(['action:split', 'open:split']);

    // --- And the list hangs off *that* half, not off the whole control: the window's
    // left edge is the trailing half's, not the control's (`lLeft`, well to its left).
    const [mLeft, mTop] = edges(opened.menu, 'menu');
    expect(mLeft).toBeGreaterThanOrEqual(tLeft - 2);
    expect(mLeft).toBeLessThanOrEqual(tLeft + 2);
    expect(mLeft).toBeGreaterThan(lLeft + 8);
    expect(mTop).toBeGreaterThanOrEqual(tBottom - 2);
    console.log(
      `split popup: menu left=${String(mLeft)} top=${String(mTop)} - trailing half ` +
        `left=${String(tLeft)} bottom=${String(tBottom)} - leading half left=` +
        `${String(lLeft)}`
    );

    // One close, after the pick, and the halves are still there underneath.
    await pickRow('split', 'copy');
    await waitForMenu(
      'split',
      (r) => r.expanded === false && r.live === liveBefore
    );
    expect(stateLog).toEqual(['split:open', 'split:close']);
    expect(orderLog).toEqual([
      'action:split',
      'open:split',
      'select:split:copy',
      'close:split',
    ]);
    const closedAgain = report('split');
    expect(closedAgain.split).toBe(true);
    expect(closedAgain.leading).toEqual(drawn.leading);
  });

  it('takes the second half away with the action, and gives it back', async () => {
    await render(<SplitMenu testId="split-inplace" />, { timeout: 20000 });
    await waitForHandle('split-inplace', 'the split menu');
    if (Platform.OS !== 'android') {
      // iOS has no layout to change.
      expectUnanswerable(report('split-inplace'));
      splitControl.setAction?.(false);
      await settle(300);
      expectUnanswerable(report('split-inplace'));
      expect(handles.get('split-inplace')?.title).toBe('Publish');
      return;
    }

    const on = await waitForMenu('split-inplace', (r) => r.split === true);
    expect(on.leading).not.toEqual([-1, -1, -1, -1]);

    splitControl.setAction?.(false);
    await settle(400);
    const off = await waitForMenu('split-inplace', (r) => r.split === false);
    // Both halves go unread, not stale.
    expect(off.leading).toEqual([-1, -1, -1, -1]);
    expect(off.trailing).toEqual([-1, -1, -1, -1]);
    // One trigger again, so a press opens like any other Menu's.
    const liveBefore = off.live ?? 0;
    await pressTrigger('split-inplace');
    await waitForMenu(
      'split-inplace',
      (r) => r.expanded === true && r.live === liveBefore + 1
    );
    expect(primaryLog).toEqual([]);
    expect(stateLog).toEqual(['split-inplace:open']);
    await pickRow('split-inplace', 'copy');
    await waitForMenu(
      'split-inplace',
      (r) => r.expanded === false && r.live === liveBefore
    );

    // And back, so "it disappeared" cannot be "it stopped reporting".
    splitControl.setAction?.(true);
    await settle(400);
    const back = await waitForMenu('split-inplace', (r) => r.split === true);
    expect(back.trailing).not.toEqual([-1, -1, -1, -1]);
    console.log('split in place: on -> off (one trigger) -> on again');
  });

  // Fabric may hand the new mount the previous owner's native view, and the previous
  // owner here had a second hit target.
  it('starts a new mount with one trigger, whatever the last one drew', async () => {
    const { unmount } = await render(<SplitMenu testId="split-recycle" />, {
      timeout: 20000,
    });
    await waitForHandle('split-recycle', 'the split menu');
    if (Platform.OS === 'android') {
      await waitForMenu('split-recycle', (r) => r.split === true);
    }
    unmount();
    await settle(400);
    handles.delete('split-recycle');

    // Same testID, same title, no `primaryAction`: the only difference from the
    // previous owner is the missing half.
    const { unmount: unmountAgain } = await render(
      <Menu
        title="Publish"
        group={GROUP}
        testID="split-recycle"
        hybridRef={captureHybrid('split-recycle')}
        onOpen={recordOpen('split-recycle')}
        onClose={recordClose('split-recycle')}
      />,
      { timeout: 20000 }
    );
    await waitForHandle('split-recycle', 'the remounted plain menu');
    const fresh = report('split-recycle');
    if (Platform.OS === 'android') {
      expect(fresh.split).toBe(false);
      expect(fresh.leading).toEqual([-1, -1, -1, -1]);
      expect(fresh.trailing).toEqual([-1, -1, -1, -1]);
      const liveBefore = fresh.live ?? 0;
      await pressTrigger('split-recycle');
      await waitForMenu(
        'split-recycle',
        (r) => r.expanded === true && r.live === liveBefore + 1
      );
      expect(stateLog).toEqual(['split-recycle:open']);
      await pickRow('split-recycle', 'copy');
      await waitForMenu(
        'split-recycle',
        (r) => r.expanded === false && r.live === liveBefore
      );
    } else {
      // iOS never had a split layout to leak.
      expectUnanswerable(fresh);
    }
    console.log(
      `split remount: split=${String(report('split-recycle').split)}`
    );
    unmountAgain();
  });

  it('disables both halves and closes an open split menu', async () => {
    await render(<SplitMenu testId="split-disabled" />, { timeout: 20000 });
    await waitForHandle('split-disabled', 'the split menu');
    if (Platform.OS !== 'android') {
      // iOS: the flag round-trips and the presentation is SwiftUI's.
      splitControl.setDisabled?.(true);
      await settle(300);
      expect(handles.get('split-disabled')?.disabled).toBe(true);
      expectUnanswerable(report('split-disabled'));
      return;
    }

    const drawn = await waitForMenu('split-disabled', (r) => r.split === true);
    const liveBefore = drawn.live ?? 0;
    await pressRect(drawn.trailing, 'the list half');
    await waitForMenu(
      'split-disabled',
      (r) => r.expanded === true && r.live === liveBefore + 1
    );

    splitControl.setDisabled?.(true);
    await settle(400);
    const shut = await waitForMenu(
      'split-disabled',
      (r) => r.expanded === false && r.live === liveBefore
    );
    expect(stateLog).toEqual(['split-disabled:open', 'split-disabled:close']);
    // The halves are still drawn - `disabled` repaints, it does not relayout - but they
    // answer nothing.
    expect(shut.split).toBe(true);
    await pressRect(shut.leading, 'the disabled action half');
    await pressRect(shut.trailing, 'the disabled list half');
    await settle(400);
    expect(primaryLog).toEqual([]);
    expect(stateLog).toEqual(['split-disabled:open', 'split-disabled:close']);
    expect(report('split-disabled').expanded).toBe(false);
    console.log('split disabled: open closed by the flag, both halves inert');
  });

  // The sizing key carries an `action` field so the split and plain triggers cannot
  // share a cache entry; sharing one would leave the split control at the plain
  // trigger's width.
  it("earns its own box, which is not the plain trigger's", async () => {
    const splitKey = sizingKey('filled', 'medium', 'Publish', '', 'action');
    const plainKey = sizingKey('filled', 'medium', 'Publish');
    expect(splitKey).not.toBe(plainKey);
    poisonConfigurations([splitKey, plainKey]);
    const before = stats();
    await render(
      <View style={columnStyle}>
        <SplitMenu testId="split-size" />
        <Menu
          title="Publish"
          group={GROUP}
          testID="plain-size"
          hybridRef={captureHybrid('plain-size')}
        />
      </View>,
      { timeout: 20000 }
    );
    const lines: string[] = [];
    for (const testId of ['split-size', 'plain-size']) {
      await waitForTestId(testId);
      const content = await waitForMeasured(testId, testId);
      const box = await waitForBox(testId, content, testId);
      expect(sameSize(box, WRONG_SIZE)).toBe(false);
      expect(sameSize(box, DECLARED_FALLBACK)).toBe(false);
      lines.push(`${testId}=${describeSize(box)}`);
    }
    const splitBox = sizeOf('split-size')!;
    const plainBox = sizeOf('plain-size')!;
    if (Platform.OS === 'android') {
      // The second container makes the control wider. On iOS `primaryAction` is a
      // gesture, so its box is the same box.
      expect(splitBox.width).toBeGreaterThan(plainBox.width + 1);
    }
    await settle(300);
    const cold = delta(before, stats());
    console.log(
      `split sizes (declared fallback ${describeSize(DECLARED_FALLBACK)}): ` +
        `${lines.join(' ')} corrections=${String(cold.corrections)}`
    );
    // Two poisoned entries, two corrections - so neither box was inherited.
    expect(cold.corrections).toBeGreaterThanOrEqual(2);
  });
});

// MARK: - Inside a <Host> (Android)

/** What the hosted fixture hands back to the test that mounts it. */
type HostLog = {
  menu?: MenuHandle;
  /** Move the whole `<Host>` down: a layout move, with no touch in it. */
  setSpacer?: (height: number) => void;
  /** Move a hosted control *inside* the `<Host>`, leaving the `<Host>` alone. */
  setButtonSize?: (size: ButtonSize) => void;
};

const newHostLog = (): HostLog => ({});

/**
 * A Menu hosted by a `<Host>`, under a spacer the test can lengthen. Inside a
 * `<Host>` the child's own React Native frame is `0 × 0`, so the witness's rect is
 * the only address there is, and the spacer moves the Host without a scroll gesture.
 */
function HostedMenu({ log }: { log: HostLog }) {
  const [spacer, setSpacer] = useState(0);
  log.setSpacer = setSpacer;
  return (
    <View>
      <View testID="menu-spacer" style={{ height: spacer, width: 40 }} />
      <Host testID="menu-host" style={{ width: 300, height: 300 }}>
        <Menu
          title="Hosted"
          group={GROUP}
          testID="hosted-menu"
          hybridRef={(view: MenuHandle): void => {
            log.menu = view;
            handles.set('hosted-menu', view);
          }}
        />
      </Host>
    </View>
  );
}

describe('Menu · inside a Host', () => {
  let log: HostLog;

  beforeEach(() => {
    log = newHostLog();
  });

  afterEach(() => {
    cleanup();
    handles.clear();
    selectLog.length = 0;
    stateLog.length = 0;
  });

  it('opens under its own button, and follows it when the Host moves', async () => {
    await render(<HostedMenu log={log} />, { timeout: 30000 });
    // `render` resolves on the box; the handle `report` reads lands a commit later.
    await waitForHandle('hosted-menu', 'the hosted menu');

    if (Platform.OS !== 'android') {
      // `<Host>` is a passthrough on iOS: the child keeps its own React Native view.
      // The first frame is the declared fallback, so the measurement is taken first
      // and the frame is then waited for.
      const content = await waitForMeasured(
        'hosted-menu',
        'the hosted trigger'
      );
      const box = await waitForBox(
        'hosted-menu',
        content,
        'the hosted trigger'
      );
      expect(box.width).toBeGreaterThan(10);
      expect(box.height).toBeGreaterThan(10);
      expectUnanswerable(report('hosted-menu'));
      console.log(
        `iOS hosted box: ${describeSize(box)} measured ${describeSize(content)}`
      );
      return;
    }

    // An anchor rect taken from the React Native frame would be `0 × 0` here, and
    // the press below would land on the spacer instead of on the button.
    const own = sizeOf('hosted-menu');
    expect(own == null ? 0 : own.width * own.height).toBe(0);

    const liveBefore = report('hosted-menu').live ?? 0;
    await pressWitnessed('hosted-menu');
    const first = await waitForMenu(
      'hosted-menu',
      (r) => r.expanded === true && r.live === liveBefore + 1
    );
    const [aLeft, aTop, aRight, aBottom] = edges(first.anchor, 'anchor');
    const [mLeft, mTop, , mBottom] = edges(first.menu, 'menu');
    expect(aRight).toBeGreaterThan(aLeft);
    expect(aBottom).toBeGreaterThan(aTop);
    expect(mBottom).toBeGreaterThan(mTop);
    // Under the button rather than under the `<Host>`'s rectangle.
    expect(mTop + 24).toBeGreaterThanOrEqual(aBottom);
    expect(Math.abs(mLeft - aLeft)).toBeLessThan(40);
    expect(first.rows).toBe(PICKABLE);
    const gap = mTop - aBottom;
    // The upper bound: `mTop + 24 >= aBottom` only refuses a popup that comes up
    // above the button, so a list opened far below it would pass.
    expect(gap).toBeLessThan(48);

    // Move the `<Host>`. Compose is never told: a popup positions itself against the
    // anchor's box inside its own composition, so a window left standing would point
    // at where the button used to be.
    log.setSpacer?.(120);
    const moved = await waitForMenu(
      'hosted-menu',
      (r) => r.expanded === false && (r.live ?? 0) === liveBefore
    );
    expect(moved.menu).toEqual([-1, -1, -1, -1]);

    // The press below is aimed at the rect the witness reports now, so a stale rect
    // lands on the spacer and no menu opens.
    await pressWitnessed('hosted-menu');
    const reopened = await waitForMenu(
      'hosted-menu',
      (r) => r.expanded === true && r.live === liveBefore + 1
    );
    const [nextLeft, , , nextBottom] = edges(reopened.anchor, 'anchor');
    const [nextMenuLeft, nextMenuTop] = edges(reopened.menu, 'menu');
    expect(
      Math.abs(nextBottom - aBottom - 120 * PixelRatio.get())
    ).toBeLessThan(6);
    // The list came up at the new anchor: within a row of its bottom, and a good
    // part of the 120 dp away from where it sat before.
    expect(Math.abs(nextMenuTop - nextBottom)).toBeLessThan(48);
    expect(Math.abs(nextMenuTop - (aBottom + gap))).toBeGreaterThan(
      (120 * PixelRatio.get()) / 2
    );
    expect(Math.abs(nextMenuLeft - nextLeft)).toBeLessThan(40);
    expect(reopened.rows).toBe(PICKABLE);
    console.log(
      `hosted anchoring: gap=${String(gap)} -> ${String(nextMenuTop - nextBottom)} ` +
        `px at anchor bottom ${String(aBottom)} -> ${String(nextBottom)}`
    );

    // Leave nothing up: `live` counts menus in the whole process, so a window left
    // open here would count in the next test.
    handles.get('hosted-menu')?.nuiTestSelectRow('copy');
    await waitForMenu(
      'hosted-menu',
      (r) => r.expanded === false && (r.live ?? 0) === liveBefore
    );
  });

  it('comes down when its hosted child leaves the Host', async () => {
    const tree = (present: boolean, spacer: number) => (
      <View>
        <View testID="menu-spacer" style={{ height: spacer, width: 40 }} />
        <Host testID="menu-host" style={{ width: 300, height: 300 }}>
          {present ? (
            <Menu
              title="Hosted"
              group={GROUP}
              testID="hosted-removal"
              hybridRef={captureHybrid('hosted-removal')}
            />
          ) : null}
          <Menu
            title="Anchor"
            group={GROUP}
            testID="hosted-survivor"
            hybridRef={captureHybrid('hosted-survivor')}
          />
        </Host>
      </View>
    );
    await render(tree(true, 0), { timeout: 30000 });
    await waitForHandle('hosted-survivor', 'the surviving hosted menu');
    if (Platform.OS !== 'android') {
      // On iOS the two Menus are ordinary React Native views, so all that can be
      // checked is that both are there and neither reports a window.
      await waitForTestId('hosted-removal');
      await waitForTestId('hosted-survivor');
      expectUnanswerable(report('hosted-survivor'));
      return;
    }
    await waitForTestId('hosted-removal');
    const liveBefore = report('hosted-survivor').live ?? 0;
    // Pressed where the Host drew it: a hosted child's React Native frame is `0 × 0`
    // at the Host's origin, so its centre is the trigger's corner pixel, which a
    // Button's touch target does not catch.
    await pressWitnessed('hosted-removal');
    await waitForMenu(
      'hosted-removal',
      (r) => r.expanded === true && r.live === liveBefore + 1
    );
    // Take the child out and leave the `<Host>` itself alone.
    render(tree(false, 0));
    const gone = await waitForMenu(
      'hosted-survivor',
      (r) => (r.live ?? 0) === liveBefore
    );
    expect(gone.live).toBe(liveBefore);
    // The rest of the composition is alive: the sibling still opens, in the same
    // composition the removed child just left.
    await pressWitnessed('hosted-survivor');
    await waitForMenu(
      'hosted-survivor',
      (r) => r.expanded === true && r.live === liveBefore + 1
    );
    handles.get('hosted-survivor')?.nuiTestSelectRow('copy');
    await waitForMenu(
      'hosted-survivor',
      (r) => r.expanded === false && (r.live ?? 0) === liveBefore
    );
  });

  /**
   * Two hosted controls stacked in one `<Host>`, the one above able to grow. Growing
   * it moves the Menu's button inside the composition while the composition and the
   * `<Host>`'s React Native frame stay where they were.
   */
  function HostedPair({ log: hostLog }: { log: HostLog }) {
    const [buttonSize, setButtonSize] = useState<ButtonSize>('small');
    hostLog.setButtonSize = setButtonSize;
    return (
      <Host testID="pair-host" style={{ width: 300, height: 300 }}>
        <Button title="Above" size={buttonSize} testID="pair-button" />
        <Menu
          title="Below"
          group={GROUP}
          testID="pair-menu"
          hybridRef={(view: MenuHandle): void => {
            handles.set('pair-menu', view);
          }}
        />
      </Host>
    );
  }

  it('takes its window down when its button moves inside the Host', async () => {
    await render(<HostedPair log={log} />, { timeout: 30000 });
    await waitForHandle('pair-menu', 'the paired hosted menu');
    if (Platform.OS !== 'android') {
      // Nothing to measure: iOS hosts by passing the child through, so the button
      // and the menu are ordinary React Native views there.
      await waitForTestId('pair-menu');
      expectUnanswerable(report('pair-menu'));
      return;
    }
    const liveBefore = report('pair-menu').live ?? 0;
    await pressWitnessed('pair-menu');
    const open = await waitForMenu(
      'pair-menu',
      (r) => r.expanded === true && r.live === liveBefore + 1
    );
    const [, anchorTop] = edges(open.anchor, 'anchor');

    // Grow the row above. The `<Host>`'s frame does not move, so a control that only
    // watched its own window's position would see nothing change and leave a window
    // hanging over the wrong rows.
    log.setButtonSize?.('large');
    const closed = await waitForMenu(
      'pair-menu',
      (r) => r.expanded === false && (r.live ?? 0) === liveBefore
    );
    expect(closed.menu).toEqual([-1, -1, -1, -1]);
    // And the button really did move, so the window closed for that reason.
    const [, nextAnchorTop] = edges(report('pair-menu').anchor, 'anchor');
    expect(nextAnchorTop).toBeGreaterThan(anchorTop);
    console.log(
      `hosted anchor move: anchor top ${String(anchorTop)} -> ` +
        `${String(nextAnchorTop)} px, window taken down`
    );
  });

  it('reports what React sent, and what the trigger is for a screen reader', async () => {
    await render(
      <View style={columnStyle}>
        <Menu
          title="Named"
          group={GROUP}
          variant="outlined"
          size="large"
          tintColor="#c837ab"
          systemImage="tray.full"
          accessibilityLabel="Open the actions"
          testID="read-back"
          hybridRef={captureHybrid('read-back')}
        />
        <Menu
          title="Plain"
          group={GROUP}
          disabled
          testID="read-back-plain"
          hybridRef={captureHybrid('read-back-plain')}
        />
        <Menu
          title="Fallback"
          group={GROUP}
          testID="read-back-fallback"
          hybridRef={captureHybrid('read-back-fallback')}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('read-back');
    await waitForTestId('read-back-plain');
    await waitForMeasured('read-back', 'the named menu');
    const named = await waitForHandle('read-back', 'the named menu');
    const plain = await waitForHandle('read-back-plain', 'the disabled menu');
    expect(named?.title).toBe('Named');
    expect(named?.variant).toBe('outlined');
    expect(named?.size).toBe('large');
    expect(named?.disabled).toBe(false);
    expect(named?.systemImage).toBe('tray.full');
    expect(named?.accessibilityLabel).toBe('Open the actions');
    // The colour is the platform's own `processColor` output, so the expected
    // number is computed rather than written down.
    expect(named?.tintColor).toBe(processColor('#c837ab'));
    expect(plain?.accessibilityLabel).toBeNull();
    expect(plain?.disabled).toBe(true);
    console.log(
      `read back: variant=${String(named?.variant)} size=${String(named?.size)} ` +
        `tint=${String(named?.tintColor)} label=${String(
          named?.accessibilityLabel
        )}`
    );
    // Everything above is a round trip through React's props; this reads the view
    // tree the harness can walk.
    const namedElement =
      harnessUi.queryByAccessibilityLabel('Open the actions');
    // `read-back-fallback` sets no `accessibilityLabel`, so this is the title fallback.
    // Logged rather than asserted: the query answers null for it on iOS, and null for
    // every Compose control on Android.
    const fallbackElement = harnessUi.queryByAccessibilityLabel('Fallback');
    console.log(
      `a11y tree: named=${describeSize(namedElement)} ` +
        `fallback=${describeSize(fallbackElement)} ` +
        `plain=${describeSize(harnessUi.queryByAccessibilityLabel('Plain'))}`
    );
    const fallback = await waitForHandle(
      'read-back-fallback',
      'the menu with no accessibilityLabel'
    );
    expect(fallback.accessibilityLabel).toBeNull();
    if (Platform.OS === 'ios') {
      const namedBox = await waitForTestId('read-back');
      expect(namedElement).not.toBeNull();
      expect(Math.abs(namedElement!.width - namedBox.width)).toBeLessThan(2);
    }
    // The query walks UIKit views only: this holds that the prop reaches the
    // component view React Native makes at the trigger's box, not the name VoiceOver
    // reads from the SwiftUI element.
  });
});

// MARK: - The glyph and the top of the ladder

/**
 * The trigger's glyph is checked by width, not by pixels: the slot Material's
 * `Button` reserves is taken only when the composition was handed artwork, and the
 * box is compared with a `Button` given the same asset.
 */
describe('Menu · the glyph and the top rungs (G19 fix round 2)', () => {
  const SHARE_ASSET = require('../src/assets/icons/share_24px.xml');

  /** A name the example app does not ship, so the resource table answers 0. */
  const NOT_SHIPPED = 'nitroui_test_never_built';

  const RUNGS = ['small', 'medium', 'large', 'xlarge', 'xxlarge'] as const;

  /**
   * Measures in the order given. `buttonIds` names the ids that are `Button`s: their
   * handles live in `buttonHandles`, not in `handles`.
   */
  async function measureAll(
    testIds: readonly string[],
    buttonIds: readonly string[] = []
  ): Promise<Map<string, Size>> {
    const buttons = new Set(buttonIds);
    const boxes = new Map<string, Size>();
    for (const testId of testIds) {
      await waitForTestId(testId);
      const content = buttons.has(testId)
        ? await waitForMeasuredButton(testId, testId)
        : await waitForMeasured(testId, testId);
      boxes.set(testId, await waitForBox(testId, content, testId));
    }
    return boxes;
  }

  const logged = (boxes: Map<string, Size>, prefix?: string): string =>
    [...boxes.entries()]
      .map(([id, size]) => `${prefix ?? ''}${id}=${describeSize(size)}`)
      .join(' ');

  it('takes the glyph the Button takes, into the box the Button takes', async () => {
    // An icon makes a trigger wider by exactly the amount it makes a Button wider,
    // because they are the same composition.
    const menuKeys = ['', 'icon'].map((icon) =>
      sizingKey('filled', 'medium', 'Share', '', 'plain', icon)
    );
    poisonConfigurations(menuKeys);
    poisonConfigurations(menuKeys, BUTTON_COMPONENT);
    const before = stats();
    await render(
      <View style={columnStyle}>
        <Menu
          title="Share"
          group={GROUP}
          testID="menu-plain"
          hybridRef={captureHybrid('menu-plain')}
        />
        <Menu
          title="Share"
          group={GROUP}
          androidIcon={SHARE_ASSET}
          testID="menu-icon"
          hybridRef={captureHybrid('menu-icon')}
        />
        <Button
          title="Share"
          androidIcon={SHARE_ASSET}
          testID="button-icon"
          hybridRef={captureButton('button-icon')}
        />
      </View>,
      { timeout: 20000 }
    );
    const boxes = await measureAll(
      ['menu-plain', 'menu-icon', 'button-icon'],
      ['button-icon']
    );
    console.log(`menu glyph boxes: ${logged(boxes)}`);
    await settle(300);
    const cold = delta(before, stats());

    const plain = boxes.get('menu-plain')!;
    const icon = boxes.get('menu-icon')!;
    const twin = boxes.get('button-icon')!;
    // An asset has to arrive as the dev-server URL (or, in a release build, the
    // drawable Metro filed it under), not as the number `require` evaluated to.
    if (Platform.OS === 'android') {
      expect(handles.get('menu-icon')?.androidIcon ?? '').toMatch(
        /^url:.*share_24px\.xml/
      );
      // Material's icon slot is taken: wider, and no taller.
      expect(icon.width).toBeGreaterThan(plain.width + 1);
      expect(Math.abs(icon.height - plain.height)).toBeLessThan(0.6);
      // The same box the Button's icon produced.
      expect(sameSize(icon, twin)).toBe(true);
    } else {
      // iOS draws `systemImage` and ignores `androidIcon`.
      expect(sameSize(icon, plain)).toBe(true);
      expect(handles.get('menu-icon')?.androidIcon ?? '').toContain(
        'share_24px'
      );
    }
    // Every configuration had to earn its box: two poisoned Menu entries (three on
    // Android, where the Button's key is poisoned too).
    expect(cold.corrections).toBeGreaterThanOrEqual(2);
  });

  it('draws no slot for a glyph that cannot be resolved', async () => {
    // An unresolvable name is no icon at all, not an empty reserved slot.
    const keys = ['', 'icon'].map((icon) =>
      sizingKey('filled', 'medium', 'Share', '', 'plain', icon)
    );
    poisonConfigurations(keys);
    await render(
      <View style={columnStyle}>
        <Menu
          title="Share"
          group={GROUP}
          testID="missing-plain"
          hybridRef={captureHybrid('missing-plain')}
        />
        <Menu
          title="Share"
          group={GROUP}
          androidIcon={NOT_SHIPPED}
          testID="missing-icon"
          hybridRef={captureHybrid('missing-icon')}
        />
      </View>,
      { timeout: 20000 }
    );
    const boxes = await measureAll(['missing-plain', 'missing-icon']);
    console.log(`menu missing-glyph boxes: ${logged(boxes)}`);
    expect(
      sameSize(boxes.get('missing-icon')!, boxes.get('missing-plain')!)
    ).toBe(true);
  });

  it('puts the glyph on the leading half of a split trigger', async () => {
    // `primaryAction` gives Android a second container: the label, with its glyph,
    // goes in the leading one and the chevron holds the trailing one. iOS has one
    // button for both jobs.
    const keys = ['', 'icon'].map((icon) =>
      sizingKey('filled', 'medium', 'Publish', '', 'action', icon)
    );
    poisonConfigurations(keys);
    await render(
      <View style={columnStyle}>
        <Menu
          title="Publish"
          group={GROUP}
          primaryAction={() => {}}
          testID="split-noicon"
          hybridRef={captureHybrid('split-noicon')}
        />
        <Menu
          title="Publish"
          group={GROUP}
          primaryAction={() => {}}
          androidIcon={SHARE_ASSET}
          testID="split-icon"
          hybridRef={captureHybrid('split-icon')}
        />
      </View>,
      { timeout: 20000 }
    );
    const boxes = await measureAll(['split-noicon', 'split-icon']);
    console.log(`menu split-glyph boxes: ${logged(boxes)}`);
    if (Platform.OS === 'android') {
      const plain = boxes.get('split-noicon')!;
      const icon = boxes.get('split-icon')!;
      expect(icon.width).toBeGreaterThan(plain.width + 1);
      // The same glyph the plain trigger draws at this rung: the split is a wider
      // box, not a taller one.
      expect(Math.abs(icon.height - plain.height)).toBeLessThan(0.6);
    } else {
      expect(
        sameSize(boxes.get('split-icon')!, boxes.get('split-noicon')!)
      ).toBe(true);
    }
  });

  it('lays the five rungs out in order, and reaches the top two', async () => {
    poisonConfigurations(
      RUNGS.map((size) => sizingKey('filled', size, 'Rung'))
    );
    const before = stats();
    await render(
      <View style={columnStyle}>
        {RUNGS.map((size) => (
          <Menu
            key={size}
            title="Rung"
            group={GROUP}
            size={size}
            testID={`rung-${size}`}
            hybridRef={captureHybrid(`rung-${size}`)}
          />
        ))}
      </View>,
      { timeout: 20000 }
    );
    const boxes = await measureAll(RUNGS.map((size) => `rung-${size}`));
    const heightOf = (size: string): number => {
      const box = boxes.get(`rung-${size}`);
      if (box == null) {
        throw new Error(`"${size}" never produced a box.`);
      }
      return box.height;
    };
    console.log(`menu rung boxes: ${logged(boxes)}`);
    await settle(300);
    const cold = delta(before, stats());
    expect(cold.corrections).toBeGreaterThanOrEqual(RUNGS.length);

    if (Platform.OS === 'android') {
      // Material's own container heights: 48 / 48 / 56 / 96 / 136 dp, the first two
      // sharing a box because the 48 dp touch target floors both.
      expect(heightOf('medium')).toBeLessThan(heightOf('large'));
      expect(heightOf('large')).toBeLessThan(heightOf('xlarge'));
      expect(heightOf('xlarge')).toBeLessThan(heightOf('xxlarge'));
      expect(heightOf('xlarge')).toBeGreaterThanOrEqual(95.5);
      expect(heightOf('xxlarge')).toBeGreaterThanOrEqual(135.5);
    } else {
      // iOS has fewer `.controlSize` values than the ladder has rungs, so the top of
      // the ladder collapses there.
      expect(heightOf('xlarge')).toBeGreaterThanOrEqual(heightOf('medium'));
      expect(Math.abs(heightOf('xlarge') - heightOf('xxlarge'))).toBeLessThan(
        0.6
      );
    }
  });
});

/**
 * A row's glyph is read two ways: `iconTints` in the report, which each row writes as
 * it draws, and `nuiTestMenuPixelProbe`, which samples the popup window. Pixel counts
 * are compared as differences between two menus that differ only by the icon, because
 * the row titles are drawn in the same colour. One popup is open at a time: a
 * Material popup dismisses on a touch outside itself.
 */
describe('Menu · the row glyphs (G21)', () => {
  /** The same filled square, as a Metro asset and as a drawable name. */
  const SLAB_ASSET = require('../src/assets/icons/slab_24px.xml');
  const SLAB_NAME = 'nitroui_test_slab';
  const NOT_SHIPPED = 'nitroui_test_never_built';

  /** `MenuDefaults.LeadingIconSize` in material3 1.5.0-beta02. Not 24 dp. */
  const ROW_ICON_DP = 20;

  /**
   * One row with a glyph, one row without, and a disabled row to close through. Every
   * comparison menu uses the same titles, so subtracting one probe from another
   * cancels the text and leaves the artwork.
   */
  const glyphGroup = (
    icon: string | number | undefined,
    checked = false
  ): MenuGroup => ({
    actions: [
      {
        id: 'slab',
        title: 'Arrange by size',
        androidIcon: icon,
        checked: checked ? true : undefined,
      },
      { id: 'plain', title: 'Sort by name' },
      { id: 'date', title: 'Date', disabled: true },
    ],
  });

  /** The `<id>#<RRGGBB>` list the report carries, as a map. */
  function tintsOf(current: MenuReport): Map<string, string> {
    const out = new Map<string, string>();
    if (current.iconTints !== '-') {
      for (const entry of current.iconTints.split(',')) {
        const at = entry.indexOf('#');
        if (at > 0) {
          out.set(entry.slice(0, at), `#${entry.slice(at + 1)}`);
        }
      }
    }
    return out;
  }

  /**
   * A rect's `WxH`. Two triggers in one column sit in different places, so only the
   * sizes of their popups compare.
   */
  function frameOf(rect: number[]): string {
    const [left, top, right, bottom] = edges(rect, 'menu');
    return `${String(Math.round(right - left))}x${String(
      Math.round(bottom - top)
    )}`;
  }

  /**
   * Runs one probe and waits for its answer. Sampling needs the UI thread and a Nitro
   * method may not block for it, so a probe is a pair: ask, then poll.
   */
  function probeOnce(
    probe: () => void,
    read: () => string,
    what: string
  ): Promise<string> {
    const before = read();
    probe();
    return pollUntil(
      () => {
        const next = read();
        return next === '' || next === before ? null : next;
      },
      () =>
        new Error(`the probe for ${what} never reported; last "${read()}".`),
      8000
    );
  }

  /** The `hits=` of a probe line, or 0 for a refusal. */
  function probeHitsOf(line: string): number {
    const hits = / hits=(\d+)/.exec(line);
    return hits == null ? 0 : Number(hits[1]);
  }

  /**
   * A split trigger whose two halves have been measured, not merely composed:
   * `split === true` says the composition drew both, and their rects land a frame
   * later.
   */
  async function splitHalves(testId: string): Promise<MenuReport> {
    return await waitForMenu(
      testId,
      (r) => {
        if (r.split !== true) {
          return false;
        }
        const [lLeft, , lRight] = edges(r.leading, 'leading half');
        const [tLeft, , tRight] = edges(r.trailing, 'trailing half');
        return lRight > lLeft && tRight > tLeft;
      },
      12000
    );
  }

  /** Open `testId`, wait for its rows to be composed, and hand back the report. */
  async function openRows(testId: string): Promise<MenuReport> {
    await pressTrigger(testId);
    return await waitForMenu(testId, (r) => r.expanded === true);
  }

  /**
   * The iOS counterpart of {@link openRows}. iOS answers `expanded=-1`, so the wait is
   * for the tree the probe copies from the `UIMenu` it presents and dismisses.
   */
  async function probeIosRows(testId: string): Promise<MenuReport> {
    const handle = await waitForHandle(testId, `the iOS menu "${testId}"`);
    handle.nuiTestMenuProbe();
    return await waitForMenu(testId, (r) => r.drawn != null, 12000);
  }

  /** Close `testId` and wait for it to be gone, so the next popup has the screen. */
  async function shut(testId: string): Promise<void> {
    await closeQuietly(testId);
    await waitForMenu(testId, (r) => r.expanded === false);
  }

  /** The colour a row drew its glyph with, refusing a row that drew none. */
  async function tintRow(
    testId: string,
    rowId: string,
    what: string
  ): Promise<number> {
    const seen = await waitForMenu(
      testId,
      (r) => r.expanded === true && tintsOf(r).has(rowId),
      15000
    );
    const tint = tintsOf(seen).get(rowId);
    if (tint == null) {
      throw new Error(
        `"${testId}" never recorded a tint for ${what} row "${rowId}".`
      );
    }
    // A Metro asset's artwork can arrive after the row composes its slot and records
    // the tint, so give it time before the caller samples.
    await settle(400);
    return parseInt(tint.slice(1), 16);
  }

  /** Sample the open popup until two reads agree, and return that count. */
  async function stableHits(
    testId: string,
    color: number,
    what: string
  ): Promise<number> {
    const handle = handles.get(testId);
    if (handle == null) {
      throw new Error(`"${testId}" has no handle - it was never rendered.`);
    }
    const deadline = nitroUiCore.now() + 15000;
    let previous = -1;
    let last = -1;
    for (;;) {
      const line = await probeOnce(
        () => handle.nuiTestMenuPixelProbe(color),
        () => handle.nuiTestMenuPixelReport(),
        `"${testId}" popup (${what})`
      );
      if (/no popup/.test(line)) {
        throw new Error(
          `the popup probe for "${testId}" (${what}) said "no popup" while the ` +
            `menu was open - the witness kept a window nobody can sample.`
        );
      }
      if (/no pixels/.test(line)) {
        // iOS's refusal, which the callers on that platform assert for directly.
        return -1;
      }
      last = probeHitsOf(line);
      if (last === previous) {
        return last;
      }
      previous = last;
      if (nitroUiCore.now() > deadline) {
        return last;
      }
      await settle(250);
    }
  }

  /** Open `testId`, sample its popup, close it, and hand back the count. */
  async function inkOf(
    testId: string,
    color: number,
    what: string
  ): Promise<number> {
    await openRows(testId);
    const ink = await stableHits(testId, color, what);
    await shut(testId);
    return ink;
  }

  it('draws the row glyph at the slot size, from a Metro asset and from a name', async () => {
    await render(
      <View style={columnStyle}>
        <Menu
          title="Asset"
          group={glyphGroup(SLAB_ASSET)}
          testID="rows-asset"
          hybridRef={captureHybrid('rows-asset')}
        />
        <Menu
          title="Name"
          group={glyphGroup(SLAB_NAME)}
          testID="rows-name"
          hybridRef={captureHybrid('rows-name')}
        />
        <Menu
          title="None"
          group={glyphGroup(undefined)}
          testID="rows-none"
          hybridRef={captureHybrid('rows-none')}
        />
      </View>,
      { timeout: 20000 }
    );
    for (const testId of ['rows-asset', 'rows-name', 'rows-none']) {
      await waitForTestId(testId);
      await waitForMeasured(testId, testId);
    }

    if (Platform.OS !== 'android') {
      // iOS's menu is UIKit's, in a window this process cannot rasterise: the probe says
      // `no pixels` rather than answering 0, and `iconTints` stays `-` because iOS drew
      // no Android glyph. The row itself must still be in the menu UIKit built.
      const opened = await probeIosRows('rows-asset');
      expect(opened.iconTints).toBe('-');
      expect(opened.rows).toBe(3);
      expect(opened.drawn).toContain('Arrange by size');
      const iosHandle = await waitForHandle('rows-asset', 'the iOS refusal');
      iosHandle.nuiTestMenuPixelProbe(0x000000);
      expect(iosHandle.nuiTestMenuPixelReport()).toContain('no pixels');
      return;
    }

    const assetHandle = handles.get('rows-asset');
    if (assetHandle == null) {
      throw new Error('"rows-asset" has no handle - it was never rendered.');
    }
    // A row's glyph is not the trigger's: this control was sent no `androidIcon` of its
    // own, and the rows' names travel inside the rows array.
    expect(assetHandle.androidIcon).toBeNull();

    // The row says which colour it drew with, and only the row with an icon says any.
    const openedAsset = await openRows('rows-asset');
    expect(tintsOf(openedAsset).has('slab')).toBe(true);
    expect(tintsOf(openedAsset).has('plain')).toBe(false);
    const color = await tintRow('rows-asset', 'slab', 'the imported square');
    const assetInk = await stableHits('rows-asset', color, 'the asset menu');
    await shut('rows-asset');

    const nameInk = await inkOf('rows-name', color, 'the named menu');
    const noneInk = await inkOf('rows-none', color, 'the icon-less menu');
    const ink = assetInk - noneInk;
    console.log(
      `row glyph ink: tint=${openedAsset.iconTints} asset=${String(
        assetInk
      )} name=${String(nameInk)} none=${String(noneInk)}`
    );

    // A square that fills its canvas paints the 20 dp slot squared; the 12% allows
    // for its anti-aliased edge.
    const slot = ROW_ICON_DP * PixelRatio.get();
    expect(ink).toBeGreaterThan(slot * slot * 0.88);
    expect(ink).toBeLessThan(slot * slot * 1.12);

    // The drawable the app shipped and the file Metro served leave the same mark.
    const nameDifference = nameInk - noneInk;
    expect(Math.abs(nameDifference - ink)).toBeLessThan(
      Math.max(6, ink * 0.06)
    );

    // Closed, there is no window to sample, and the probe says `no popup` rather than
    // counting the last frame it saw.
    const closed = await probeOnce(
      () => assetHandle.nuiTestMenuPixelProbe(color),
      () => assetHandle.nuiTestMenuPixelReport(),
      'the closed menu'
    );
    expect(closed).toContain('no popup');
  });

  it('refuses a popup probe with no popup, and a name that cannot resolve with no icon', async () => {
    await render(
      <View style={columnStyle}>
        <Menu
          title="Missing"
          group={glyphGroup(NOT_SHIPPED)}
          testID="rows-missing"
          hybridRef={captureHybrid('rows-missing')}
        />
        <Menu
          title="None"
          group={glyphGroup(undefined)}
          testID="rows-none2"
          hybridRef={captureHybrid('rows-none2')}
        />
      </View>,
      { timeout: 20000 }
    );
    for (const testId of ['rows-missing', 'rows-none2']) {
      await waitForTestId(testId);
      await waitForMeasured(testId, testId);
    }

    if (Platform.OS !== 'android') {
      // `androidIcon` is Android's prop, so on iOS the menu built from an unresolvable
      // name is the same menu, row for row, as the group with no icons at all.
      const missing = await probeIosRows('rows-missing');
      expect(missing.iconTints).toBe('-');
      const plain = await probeIosRows('rows-none2');
      expect(plain.iconTints).toBe('-');
      expect(plain.drawn).toBe(missing.drawn);
      return;
    }

    // Before anything is open, the probe refuses: "nothing to sample" is a different
    // answer from "sampled, and found none".
    const handle = await waitForHandle('rows-missing', 'the closed control');
    const refused = await probeOnce(
      () => handle.nuiTestMenuPixelProbe(0x123456),
      () => handle.nuiTestMenuPixelReport(),
      'the closed popup'
    );
    expect(refused).toContain('no popup');

    const missing = await openRows('rows-missing');
    expect(missing.iconTints).toBe('-');
    // Resolved-to-nothing is the menu with no icons at all: no reserved gap, no moved
    // label, one popup frame.
    const missingFrame = frameOf(missing.menu);
    await shut('rows-missing');
    const plain = await openRows('rows-none2');
    expect(plain.iconTints).toBe('-');
    const plainFrame = frameOf(plain.menu);
    await shut('rows-none2');
    console.log(`unresolved name: menu=${missingFrame} none=${plainFrame}`);
    expect(missingFrame).toBe(plainFrame);
  });

  it('keeps the check in the slot when the row is checked', async () => {
    await render(
      <View style={columnStyle}>
        <Menu
          title="Checked"
          group={glyphGroup(SLAB_NAME, true)}
          testID="rows-checked"
          hybridRef={captureHybrid('rows-checked')}
        />
        <Menu
          title="Unchecked"
          group={glyphGroup(SLAB_NAME, false)}
          testID="rows-unchecked"
          hybridRef={captureHybrid('rows-unchecked')}
        />
      </View>,
      { timeout: 20000 }
    );
    for (const testId of ['rows-checked', 'rows-unchecked']) {
      await waitForTestId(testId);
      await waitForMeasured(testId, testId);
    }
    if (Platform.OS !== 'android') {
      // iOS has no Material slot to keep. What it can show is that the check reaches
      // UIKit on the row that carries the glyph: the `+` in the tree notation.
      const checked = await probeIosRows('rows-checked');
      expect(checked.drawn).toContain('Arrange by size+');
      const unchecked = await probeIosRows('rows-unchecked');
      expect(unchecked.drawn).not.toContain('Arrange by size+');
      return;
    }

    // The row's own glyph, on the row that can be checked, on the menu where it is not.
    const unchecked = await openRows('rows-unchecked');
    expect(tintsOf(unchecked).has('slab')).toBe(true);
    const uncheckedFrame = frameOf(unchecked.menu);
    await shut('rows-unchecked');

    // The same row checked: it drew Material's check in that slot instead, so it
    // recorded no tint for the app's glyph, and the popup is exactly as wide.
    const checked = await openRows('rows-checked');
    expect(tintsOf(checked).has('slab')).toBe(false);
    const checkedFrame = frameOf(checked.menu);
    await shut('rows-checked');
    console.log(
      `checked row slot: unchecked=${uncheckedFrame} checked=${checkedFrame}`
    );
    expect(checkedFrame).toBe(uncheckedFrame);
  });

  it('puts the trigger glyph in the leading half, and only there', async () => {
    // A CSS string, not the bare number: the number form of a `ColorValue` is an ARGB
    // int, so `0xff00a0` has alpha 0 and would ask for a transparent tint.
    const tintCss = '#ff00a0';
    const tint = processColor(tintCss) as number;
    await render(
      <View style={columnStyle}>
        <Menu
          title="Publish"
          group={glyphGroup(undefined)}
          primaryAction={() => {}}
          tintColor={tintCss}
          androidIcon={SLAB_NAME}
          testID="split-ink"
          hybridRef={captureHybrid('split-ink')}
        />
        <Menu
          title="Publish"
          group={glyphGroup(undefined)}
          primaryAction={() => {}}
          tintColor={tintCss}
          testID="split-noink"
          hybridRef={captureHybrid('split-noink')}
        />
      </View>,
      { timeout: 20000 }
    );
    for (const testId of ['split-ink', 'split-noink']) {
      await waitForTestId(testId);
      await waitForMeasured(testId, testId);
    }

    if (Platform.OS !== 'android') {
      // iOS has no split trigger to look at: a `primaryAction` there is a gesture on one
      // button, so `split` answers `-1`, and the trigger's pixel probe answers
      // `no pixels` because it has no Android glyph to sample.
      expect(report('split-ink').split).toBeNull();
      const iosHandle = await waitForHandle(
        'split-ink',
        'the iOS split trigger'
      );
      iosHandle.nuiTestPixelProbe(tint);
      expect(iosHandle.nuiTestPixelReport()).toContain('no pixels');
      return;
    }

    const withGlyph = await splitHalves('split-ink');
    const without = await splitHalves('split-noink');
    const [lLeft, , lRight] = edges(withGlyph.leading, 'leading');
    const [tLeft, , tRight] = edges(withGlyph.trailing, 'trailing');
    const [plainLLeft, , plainLRight] = edges(without.leading, 'leading');
    const [plainTLeft, , plainTRight] = edges(without.trailing, 'trailing');
    console.log(
      `split halves: glyph=${lRight - lLeft}/${tRight - tLeft} ` +
        `plain=${plainLRight - plainLLeft}/${plainTRight - plainTLeft}`
    );
    expect(lRight).toBeLessThanOrEqual(tLeft + 1);
    expect(plainLRight).toBeLessThanOrEqual(plainTLeft + 1);
    // The label, glyph and all, lives in the leading half: that half grows by the slot,
    // and the chevron's half does not move at all.
    expect(lRight - lLeft).toBeGreaterThan(plainLRight - plainLLeft + 8);
    expect(Math.abs(tRight - tLeft - (plainTRight - plainTLeft))).toBeLessThan(
      0.6
    );

    // And the glyph is painted there. The tint is the app's own, so the colour is
    // known; the label carries it too, so what is asserted is the difference the
    // square makes.
    const glyphHandle = await waitForHandle('split-ink', 'the split trigger');
    const plainHandle = await waitForHandle(
      'split-noink',
      'the plain split trigger'
    );
    const triggerInk = async (
      target: MenuHandle,
      label: string
    ): Promise<number> => {
      const line = await probeOnce(
        () => target.nuiTestPixelProbe(tint),
        () => target.nuiTestPixelReport(),
        `"${label}" trigger`
      );
      return probeHitsOf(line);
    };
    const glyphPixels = await triggerInk(glyphHandle, 'split-ink');
    const plainPixels = await triggerInk(plainHandle, 'split-noink');
    console.log(
      `split glyph ink: glyph=${String(glyphPixels)} plain=${String(
        plainPixels
      )}`
    );
    expect(glyphPixels).toBeGreaterThan(plainPixels + 20);
  });
});

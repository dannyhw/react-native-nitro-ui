/**
 * On-device tests for the Menu (task G7a).
 *
 * A Menu is a Button's box and a window's worth of content, so this suite has two
 * halves that read completely differently.
 *
 * **The box** is the Button's story, told again: the sizing configuration is
 * `variant|size|action|systemImage|title` (`Menu.tsx`'s `sizingVariantFor`), the items
 * are deliberately *not* in it, `action` is in it because a `primaryAction` gives
 * Android a second container (E3 - see the split suite), and every cold configuration
 * is poisoned first
 * (`seedSizingSize` with a size no menu has, then an environment bump) so a
 * correction that never arrives leaves a visible wrong box *and* costs a correction
 * the test requires. The `group` half is this control's own claim, and it is the
 * one a Button cannot make: a menu whose list grows must not be re-laid out, so
 * "the same key for two different menus" is asserted here, not assumed.
 *
 * **The window** is the Picker's story, told with a different seam. The harness
 * dispatches input into the app's own window, so a press reaches the trigger - and
 * on Android that really opens the list - while no press reaches a row inside it
 * (`HostPopups.harness.tsx`'s header explains why: a Compose `Popup` is a window of
 * its own). Rows are therefore pressed through `nuiTestSelectRow`, which runs the
 * model's own pick path, and everything about the list is read from inside the
 * composition through `nuiTestMenuReport`: `expanded`, a process-wide `live` menu
 * count, the anchor's rect, the menu's rect, and the pickable rows it composed.
 *
 * **iOS passes through the window half.** Two independent reasons, both measured
 * elsewhere: a SwiftUI `Menu` hands its list to the system's presentation, so the
 * composition never owns a window to measure (`HybridNitroUiPicker` answers `-1` for
 * the same reason and this control does too), and `userEvent`'s synthesised touch is
 * refused by SwiftUI's button gesture environment (`docs/tasks/G2-button.report.md`
 * measured that for every Button style). One exception, measured by E3's split suite:
 * a `Menu` built with `primaryAction:` does take the synthesised tap, so the action
 * half of that prop *is* observable on iOS - opening is not.
 *
 * So on iOS the open/close counters, the rects, `live` and the inline-vs-nested
 * difference are asserted only as far as the `-1`s and the row count go, and the taps
 * that need a real HID-level event are
 * G7b's real-input case (`docs/components/menu.md` says the same about
 * `onOpen`/`onClose`).
 *
 * Two rules that hold on both platforms and are therefore *not* platform-split: a
 * pick reports `onSelect` exactly once and a disabled row reports nothing (each with
 * the barrier twin that proves the press landed at all), and a `disabled` control
 * answers nothing.
 */
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

/** The sibling this control claims to size like, filed under its own name. */
const BUTTON_COMPONENT = 'NitroUiButton';

type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
  queryByAccessibilityLabel(label: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

/**
 * What `hybridRef` hands back - declared, not imported (DECISIONS D14). Read-only,
 * and there is no `expanded`: open state is native-owned (D29), and the witness
 * below is the seam that reads it.
 */
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

/** Handles by testID, so a test can ask each control what it holds. */
const handles = new Map<string, MenuHandle>();
const captureHybrid =
  (testId: string) =>
  (view: MenuHandle): void => {
    handles.set(testId, view);
  };

/**
 * The Button's handle, declared the same way (D14) and only as wide as the one
 * claim below needs: a Button and a Menu with the same props are the same box.
 */
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
 * All three callbacks in the one order they arrived, which `selectLog` and
 * `stateLog` cannot say between them: two arrays have no shared position, so the
 * pick-then-close order DECISIONS D32 chose would leave both of them exactly as they
 * are however the two callbacks were ordered. `docs/components/menu.md` states the
 * order, so this is the line that holds it.
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
 * Every `primaryAction` the app has reported, in order (E3).
 *
 * Its own array rather than a tag inside `stateLog`, because the whole claim is about
 * the two *not* mixing: a press on the action half must leave `stateLog` empty, and
 * counting both in one list would make "no open" indistinguishable from "one open".
 */
const primaryLog: string[] = [];
const recordPrimary = (testId: string) => (): void => {
  orderLog.push(`action:${testId}`);
  primaryLog.push(`${testId}:action`);
};

// MARK: - The witness

/** The five numbers a menu is asked about, parsed out of its report line. */
type MenuReport = {
  /** `-1` means "this platform cannot tell", which is not the same as `false`. */
  expanded: boolean | null;
  live: number | null;
  anchor: number[];
  menu: number[];
  rows: number;
  /**
   * The menu the platform itself built, in `Menu.nitro.ts`'s notation, as the
   * last `nuiTestMenuProbe` read it; `null` for `-1` (no probe yet, or Android,
   * which has no second renderer to ask).
   */
  drawn: string | null;
  /**
   * Whether this mount's composition drew the split trigger (E3). `null` means `-1`:
   * iOS has no second hit target to look for, `true`/`false` is Android looking and
   * answering. Not the same question as the `primaryAction` prop, which is what React
   * sent - see `MenuModel.splitDrawn`.
   */
  split: boolean | null;
  /** The two halves' screen rects, in the same space as `anchor`; `-1` unread. */
  leading: number[];
  trailing: number[];
  /**
   * What each row that drew an `androidIcon` tinted it with: `<id>#<RRGGBB>`, comma
   * separated, or `-` when no row drew one (G21). The colour is Material's, from the
   * device's dynamic palette - which is exactly why a test cannot write it down and has
   * to be told it by the row that used it.
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
    // `-1` is this control's own "unanswerable" (Q1 §2: "never a `0` that reads as
    // 'checked'"), so it must not coerce into `false`/`0` here and hide the
    // difference between "closed" and "cannot tell".
    expanded: expandedField === '-1' ? null : expandedField === '1',
    live: liveField === '-1' ? null : Number(liveField),
    anchor: rect('anchor'),
    menu: rect('menu'),
    rows: Number(field('rows')),
    drawn: field('drawn') === '-1' ? null : field('drawn'),
    // The same `-1` is not a `false` argument here either: "Android composed one
    // button" and "iOS has no such measurement" have to stay two different answers.
    split: splitField === '-1' ? null : splitField === '1',
    leading: rect('leading'),
    trailing: rect('trailing'),
    iconTints: field('iconTints'),
  };
}

/**
 * A parsed rect as four plain numbers, refusing a short one.
 *
 * `noUncheckedIndexedAccess` makes every `rect[0]` an `| undefined`, and `?? 0` at
 * each use would let a missing field read as "at the origin" - which is how a broken
 * anchor measurement sneaks through a geometry gate.
 */
function edges(rect: number[], what: string): [number, number, number, number] {
  if (rect.length !== 4 || rect.some((value) => Number.isNaN(value))) {
    throw new Error(
      `The ${what} rect is not four numbers: "${rect.join(',')}".`
    );
  }
  return [rect[0] ?? 0, rect[1] ?? 0, rect[2] ?? 0, rect[3] ?? 0];
}

/** `-1` for every geometry field, which is what iOS answers and what iOS asserts. */
function expectUnanswerable(current: MenuReport): void {
  expect(current.expanded).toBeNull();
  expect(current.live).toBeNull();
  expect(current.anchor).toEqual([-1, -1, -1, -1]);
  expect(current.menu).toEqual([-1, -1, -1, -1]);
  // E3's three, for the same reason as the four above: iOS's `primaryAction` is a
  // gesture on one button, so `split=0` would claim a layout iOS chose.
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
 * Poll until the hybrid handle for `testId` exists, so its props can be read.
 *
 * `hybridRef` fires when the native view is created, which is after the commit that
 * `render` waits for - so reading a handle once can land in that gap and answer
 * `undefined` for a control that is fine. That is how X14's merge saw
 * `expected undefined to be null` once at `read-back-fallback`, and it is the same
 * reason the sizing gates poll for a measured size instead of reading it once.
 *
 * The wait is for *a handle*, never for a particular value, so a prop that really is
 * wrong is exactly as red as it was and fails on the same expectation line - the only
 * thing that changes is that a slow registration stops being a test failure.
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

/** Poll until the *Button* control reports a size. */
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
 * Poll until the box of `testId` is `size`.
 *
 * Waiting for "a box" would accept the planted `WRONG_SIZE` and the declared
 * fallback, so every sizing gate waits for *this* size or fails naming both the box
 * it is stuck on and what the control measured.
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
 * Poll until a mount that answers as `wantTitle` reports a real size, and refuse
 * everything else.
 *
 * Q3 §1's rule for a remount is that the previous mount must not get to answer. The
 * obvious signal - "not the handle object I had before the teardown" - is wrong here:
 * measured on iOS at `06-02-21Z`, the remount of `recycle` answered through the *same*
 * JS handle object, because Fabric recycles the view and Nitro hands back the wrapper
 * it made for that tag. Object identity says nothing about which mount is talking; the
 * props do, so the wait asks the handle what title it was given and refuses any answer
 * still carrying the old one - the refusal is asserted where it happens, in the
 * remount test below, which calls this while only the torn-down mount can answer.
 * Zero is refused for Q3's other reason: a control answers `0x0` mid re-measure, and a
 * zero read as a verdict is the historical `0.00x0.00` signature.
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
 * Poll until the control reports a size that is *not* `previous`.
 *
 * `measureContent()` keeps answering with the last measured size while Compose
 * recomposes and re-measures, so waiting for "a size" would return the pre-change
 * number and call the change measured.
 *
 * Zero is refused for the reason Q3 §1 gives for this same shape: a control answers
 * `0x0` mid re-measure, and "not the previous size" is then satisfied by a change that
 * never arrived - the historical `0.00x0.00` signature, read as a verdict.
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
 * Poll the witness until `read` is happy, and hand back what it saw.
 *
 * A menu opens on the UI thread while JS is back in the test, so a fixed sleep would
 * measure the machine. The predicate, not the sleep, is what makes a red legible.
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
 * The key `Menu.tsx` builds: `variant|size|action|systemImage|title`, each piece
 * escaped.
 *
 * Written out here rather than imported - a harness that poisoned the cache through
 * the library's own helper could not catch the helper being wrong, and a missing
 * input in that key is the R3 bug class. The absence of `group` is asserted, too
 * (see the "trigger, not the list" test), and the presence of `action` is asserted by
 * the split sizing gate: a split trigger that shared the plain trigger's entry would be
 * laid out at the wrong width, and measured that way - the *split* control is the one
 * left at the other's box, because a shared entry keeps the last correction written to
 * it. `docs/tasks/E3/mutations.json` carries both directions.
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

/**
 * Plant a wrong answer for several configurations, then drop the cache once.
 *
 * The component is a parameter because the parity gate poisons the *Button's*
 * entry too: two controls have to earn two sizes before their boxes may be
 * compared.
 */
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
 * What each platform *declares* before the first measure
 * (`NitroUiDeclaredFallbacks`), kept here so the "laid out at the fallback" claim is
 * checkable. These are deliberately not the measured size of any fixture below: a
 * fallback equal to the answer hides a failed correction (X4's rule 1).
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
 * is not pickable on either (D29), so it is not counted.
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
 * An untitled group between two titled ones (G9), holding both row roles: a
 * destructive row and a disabled one. The titled neighbours are the barrier - a
 * reading that lost every group would fail on them too, so a missing untitled
 * group cannot pass as "the probe read nothing".
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
 * tree has no such group. Inline groups do not nest (D29), so a group's rows run
 * from its `(` to the next `)`.
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
 * Press the middle of a rect the *witness* reports, in device pixels (E3).
 *
 * `pressTrigger` presses the middle of the *React Native* frame, which for a split
 * trigger is the seam between the two halves - a press there belongs to neither and
 * would make "the leading half fired the action" a coin flip. Everything the split
 * suite presses goes through the halves' own rects for that reason, and `edges`
 * refuses a short one so an unread `-1` half cannot press the origin.
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

/** Pick a row through the seam a real row uses. */
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
  /** The five Button variants a trigger can be, plus four of its five sizes. */
  const VARIANTS = ['filled', 'tonal', 'outlined', 'text', 'elevated'] as const;
  /**
   * Four of the five rungs - `medium` is every other configuration's size. The two
   * G19 fix round 2 added to Menu are in here because "the trigger has the whole
   * ladder" is a claim about each rung's configuration, not about one: a rung whose
   * key the engine has never seen is laid out at the declared fallback until it
   * earns its own entry, and that is a per-rung failure. The rung *boxes* - the
   * heights that are the actual promise - are measured by the ladder suite at the
   * end of this file.
   */
  const TRIGGER_SIZES = ['small', 'large', 'xlarge', 'xxlarge'] as const;

  it('lays each configuration out at the size the control measured', async () => {
    // The control is its own oracle: nothing below is a constant, and every
    // configuration is poisoned first, so the box has to be *earned* by a
    // correction rather than inherited from the declared fallback.
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
      // Both wrong answers, named separately, because they fail differently: the
      // planted size surviving means no correction ever arrived, and the fallback
      // surviving means the correction never beat the first frame (X4 rule 1).
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
    // Seven poisoned configurations, seven corrections. This is the strict half:
    // unlike a *new* configuration, which Android can settle inside the layout
    // pass that first measures it (Picker's shrink gate records that), a poisoned
    // entry is provisional and is laid out, so it has to be replaced.
    expect(cold.corrections).toBeGreaterThanOrEqual(
      VARIANTS.length + TRIGGER_SIZES.length
    );
  });

  it('takes exactly the box its Button twin takes', async () => {
    // Every other sizing gate in this file only requires a box to be *earned*,
    // so a trigger laid out at its label's text box - no fill, no padding -
    // passes all of them. That is precisely the bug this test exists for: the
    // iOS trigger shipped that way (53.33x20.33 against Button's 77.33x34.33,
    // measured in `docs/components/menu.md`) and every gate above stayed green.
    // Parity against a real Button needs no constant, which is what makes it
    // cheap to keep.
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
    // And the one is the other's - the claim Q1 section 2 makes about the label.
    expect(sameSize(menuBox, buttonBox)).toBe(true);
  });

  it('keeps the trigger when only the list changes', async () => {
    // The `group` half of the sizing key claim, and the one a Button cannot make.
    // Nine items plus a section, against four items plus a submenu, must give the
    // same box *and* cost no new cache entry: a `group` that leaked into the key
    // would give the same box and still fragment the cache, which is the failure
    // the key exists to prevent.
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
    // Zero new configurations: the key did not change, so the engine was never
    // asked about this menu again...
    expect(after.cachedSizes).toBe(0);
    // ...and nothing had to chase a box that never moved.
    expect(after.corrections).toBe(0);

    // And the big list is really the one the control holds - the assert above
    // would also be true if the second render had been dropped on the floor.
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
    // The list is not in the key, and the trigger is: the second title cost a
    // configuration of its own.
    expect(delta(before, stats()).cachedSizes).toBeGreaterThanOrEqual(2);
    console.log(
      `title R3: short=${describeSize(shortSize)} long=${describeSize(longSize)}`
    );
    unmount();
  });

  // MARK: - Picking

  it('reports one onSelect per pick and nothing for a row that cannot be picked', async () => {
    // Nothing in this control is more important than "one answer per pick", and it
    // is the one requirement both platforms answer identically: the row press goes
    // through the model, not through a window.
    //
    // The refusals come first, because an empty log by itself proves nothing - an
    // event can still be in flight. The enabled twin control's answer is the barrier
    // that says the pipeline delivered, and the RN `Pressable` at the top of the
    // column says the same thing about the harness itself (`Button.harness.tsx`
    // records why a hosted SwiftUI control cannot be its own witness on iOS).
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

    // Three refusals, three different reasons: a row the group says is disabled, a
    // submenu *parent* (a header on Android, a nested menu on iOS - pickable on
    // neither, D29), and an id the group has never heard of.
    await pickRow('pick', 'paste');
    await pickRow('pick', 'share');
    await pickRow('pick', 'no-such-row');
    expect(selectLog).toEqual([]);

    // The barrier: the twin answers, so an empty log above was a refusal.
    await pickRow('twin', 'copy');
    await waitForLog(selectLog, 1, "the twin's pick");
    expect(selectLog).toEqual(['twin:copy']);

    // And the control under test answers once, then again - never twice.
    await pickRow('pick', 'copy');
    await waitForLog(selectLog, 2, 'the first pick');
    expect(selectLog).toEqual(['twin:copy', 'pick:copy']);
    await pickRow('pick', 'delete');
    await waitForLog(selectLog, 3, 'the destructive pick');
    console.log(`picks: ${JSON.stringify(selectLog)}`);
    expect(selectLog).toEqual(['twin:copy', 'pick:copy', 'pick:delete']);
    // Still nothing for the rows that cannot be picked, after everything above.
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
      // iOS answers `-1` for all of it, and that answer is the assertion: a `0` or
      // a `false` here would claim the control had a closed menu when the truth is
      // that the platform keeps the presentation (Q1 §2). A press is delivered and
      // nothing is reported, which is what `docs/components/menu.md` says about
      // `onOpen`/`onClose` on iOS; the tap that would open it for real is G7b's.
      const box = await waitForTestId('events');
      await userEvent.pressAt(box.x + box.width / 2, box.y + box.height / 2);
      await settle(400);
      expectUnanswerable(report('events'));
      expect(stateLog).toEqual([]);
      expect(await handles.get('events')?.title).toBe('Events');
      // The half iOS does answer: a pick reaches JS through the model.
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
    // both report the same request, and the funnel is what keeps that to one event.
    expect(stateLog).toEqual(['events:open']);

    await pickRow('events', 'copy');
    const afterPick = await waitForMenu(
      'events',
      (r) => r.expanded === false && r.live === (liveBefore ?? 0)
    );
    expect(selectLog).toEqual(['events:copy']);
    // The pairing: a pick closes the menu, and a close that is not reported is a
    // listener that never sees the menu go away. (`Q1` §5 worded this as "never for a
    // pick"; D32 settles it the way the report read it - an *unpaired* open is what to
    // refuse, so a pick does fire the pair.)
    expect(stateLog).toEqual(['events:open', 'events:close']);
    // And the order between the two callbacks, which neither log above can express.
    // DECISIONS D32: a pick reports the choice first and closes after it, and
    // `MenuModel.applyPick` is written that way. `docs/components/menu.md` promises
    // exactly this sequence, so a listener that acts on the pick is never handed a
    // menu that is still up. The same order is pinned off-device by
    // `android/src/test/.../MenuModelTest.kt`, which is the half that can be shown red
    // without an emulator.
    expect(orderLog).toEqual([
      'open:events',
      'select:events:copy',
      'close:events',
    ]);
    // The rect goes with the window, so a later gate cannot press where a closed
    // menu used to be.
    expect(afterPick.menu).toEqual([-1, -1, -1, -1]);
    expect(afterPick.rows).toBe(0);

    // And again: open state is not sticky, and the second open is one event.
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
    // A delta, not `=== 0`: `live` is process-wide, so a menu an earlier gate left
    // open would make this line blame the wrong control (Q3 §2).
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
      // iOS has no open state to close from here, and the reason is the same as
      // above. What *is* checkable is that the flag React sent is the flag SwiftUI
      // is told, which is the half of D29 that lives in this repo.
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
    // props batch, while the window goes when Compose disposes the popup - reading
    // the count in between measures a window already on its way out (H2b's wording,
    // for the same reason).
    const closed = await waitForMenu(
      'disable',
      (r) => r.expanded === false && r.live === liveBefore
    );
    expect(closed.menu).toEqual([-1, -1, -1, -1]);
    // D29 is a rule about the app's view of it too: whoever opened it hears it close.
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
      // Six is the *inline* answer, and it is a discriminator rather than a
      // restatement: a nested Android list would compose four rows here (Copy, Cut,
      // Paste, Share), because the submenu's children only exist once its own window
      // opens. D29 asks for the six.
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
      // only report what its own model holds - which is the same six, counted
      // differently, and the harness cannot tell the two renderings apart from here.
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
   * A trigger whose title is shorter than any of its rows, which is the case the
   * list has to survive: the README's `menu-android.png` showed this shape and the
   * popup lost the tail of every label in it.
   *
   * "Move into a folder" is deliberately long enough that its row needs more width than
   * Material's 112 dp list floor, which is what makes the assertion below about the
   * popup's width rather than about a constant.
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
   * The two bounds a popup has to sit between, named here rather than as literals so the
   * assertions say which is which.
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
   * Opens `testId` and measures its popup against its own trigger.
   *
   * `live` is read here rather than passed in because it counts every menu in the
   * process, so a caller that already has one open would otherwise be one out. Both
   * rects come from one witness read of one menu, and two menus read the same way in one
   * render answer in the same units, so anything taken here compares directly.
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
        {/* The same render's other half, and the reason it has to be in this render:
            Material's 112 dp floor is a *constant*, so "wider than 112 dp" is only a
            claim about the items if a short list really does sit on that constant here.
            This menu measures that, in the same units on the same device, which is what
            turns "the wide popup is wider than the short one" into a check that a popup
            pinned to any single width - 112 dp, or `Modifier.width(112.dp)` - cannot
            pass. */}
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
      // iOS presents through the system's menu, which reports no window for the
      // composition to measure (D23), so nothing about the list's width can be read
      // from here on iOS's harness. (Android can: the rest of this test measures its
      // popup through the witness's `menu=` rect.) What this branch keeps deterministic
      // is the part that is answerable: the model's own rows, and the -1s for the window
      // that is not there.
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
    // The bug, in one line: `ExposedDropdownMenu` passes `matchAnchorWidth = true`
    // by default, and its own `exposedDropdownSize` sets `minWidth = maxWidth =
    // anchorWidth`, so the window came back exactly as wide as the button and every
    // longer row lost its tail. Nothing here could see that: the rows are Compose
    // nodes, not views, so `queryByTestId` cannot reach them, and the trigger's own
    // rect is the box that is *not* clipped. The witness's `menu=` rect is the
    // popup's window, which is where the clipping happened.
    expect(wide.anchorWidthPx).toBeGreaterThan(0);
    expect(wide.popupWidthPx).toBeGreaterThan(wide.anchorWidthPx);

    // The premise, measured rather than assumed: a list of two short rows sits on
    // Material's floor in this render, on this device, in these units. Closed by
    // picking a row first, because a popup is a window of its own and the second
    // one's width should be the only thing on screen while it is being read.
    await closePopupByPicking('wide-list', 'folder');
    const floor = await openAndMeasurePopup('floor-list');
    const floorPx = MATERIAL_LIST_MIN_DP * PixelRatio.get();
    expect(floor.popupWidthPx).toBeGreaterThanOrEqual(floorPx - 1);

    // And now the width is the items', not a constant's: strictly wider than a list
    // that needed nothing but the floor. Either the trigger's width (the shipped bug) or
    // a hard 112 dp goes red on this line, which is what the line above alone cannot do.
    expect(wide.popupWidthPx).toBeGreaterThan(floor.popupWidthPx);

    // …and the reason that is not "grow forever": the popup stays inside the 280 dp
    // ceiling Material caps a row's content at. `<=`, not `<`, because a popup whose
    // widest row wants exactly the cap is allowed to be exactly the cap, and at a large
    // font scale that is a reachable configuration rather than a rounding argument.
    expect(wide.popupWidthPx / PixelRatio.get()).toBeLessThanOrEqual(
      MATERIAL_LIST_MAX_DP
    );

    // Where the extra width went: printed, not asserted, and that is deliberate. The
    // window's horizontal position is `ExposedDropdownMenuPositionProvider`'s decision,
    // and this call exposes no lever that moves a window sideways - `Modifier.offset(x =
    // 12.dp)` on the list, the widest one it takes, moves the rows *inside* the window and
    // leaves the window where it was (measured: the witness still read the same rect, and
    // every assertion above stayed green). An assertion here could not be shown to fail,
    // which is the bar every new check has to clear, so placement is guarded where it is
    // genuinely at risk instead: the hosted test below asserts
    // `Math.abs(mLeft - aLeft) < 40` beside a `gap < 48` whose red proof is G7b round 1's
    // `DropdownMenu(offset = DpOffset(0.dp, 64.dp))` - the one mutant in this file's
    // history that really moved a window (16 px below the anchor's bottom to 168 px). What
    // these lines add is the width claim; the number below keeps the geometry the fix
    // produced on the record every run.
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
   * rows that need almost nothing. The header is the only child of a popup that is not
   * a `DropdownMenuItem`, so it is the only one Material's own cap does not reach.
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
    // Once the popup stopped matching the trigger, its width is whatever its widest
    // child asks for. Material caps a *row* at 280 dp (`DropdownMenuItemDefaultMaxWidth`
    // in the row's own `sizeIn`) but a header is not a row, so an uncapped header was
    // free to stretch the list past the width a Material menu is meant to stop at - and
    // the widest thing the menu could then show was still capped, which is a menu whose
    // rows are ellipsised inside a window bigger than they need. `MenuHeader` carries the
    // same cap, and this is the line that says so.
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
    // The other half of the fix: switching the anchor's width off must not let the
    // list shrink to the trigger. Both rows here are shorter than Material's
    // minimum, so a correct popup is exactly its floor, and a mutant that forced
    // *some* width (rather than letting content decide) would land on the trigger's
    // box and go red under this line. The wide test above measures this same floor in
    // its own render, because comparing a wide popup against a floor needs both in one
    // place; this test keeps it as a standalone claim as well.
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
    // Nothing has asked yet, so nothing may be claimed: a `drawn` before the probe
    // would be an answer this test did not cause.
    expect(before.drawn).toBeNull();

    if (Platform.OS === 'ios') {
      // The model has all six - it did before G9 too. `rows` is what we asked
      // SwiftUI to draw, which is why it could not see the bug.
      expect(before.rows).toBe(UNTITLED_PICKABLE);
      handle.nuiTestMenuProbe();
      const probed = await waitForMenu('untitled', (r) => r.drawn != null);
      const drawn = probed.drawn ?? '';
      console.log(`untitled group: ios drawn=${drawn}`);
      // The titled groups first: the barrier that the probe read a real menu.
      expect(drawnGroup(drawn, 'Share')).toEqual(['AirDrop', 'Mail']);
      expect(drawnGroup(drawn, 'More')).toEqual(['Get Info']);
      // The claim: the untitled group is its own group, with both of its rows and
      // their roles. Before G9 this read `[]` - the group was there, empty.
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
      // `rows` here is counted from the rows the popup composed, so six is the
      // untitled group drawn - the parity iOS is held to above.
      const open = await waitForMenu(
        'untitled',
        (r) =>
          r.expanded === true && r.live === liveBefore + 1 && r.drawn != null
      );
      expect(open.rows).toBe(UNTITLED_PICKABLE);
      // And the popup's own semantics tree (E2): every Material group, the untitled
      // one with both of its rows. Destructive is a colour there, so no `!`.
      console.log(`untitled group: android drawn=${open.drawn ?? ''}`);
      expect(drawnGroup(open.drawn ?? '', 'Share')).toEqual([
        'AirDrop',
        'Mail',
      ]);
      expect(open.drawn).toBe(
        '(:Open),(Share:AirDrop,Mail),(:Delete,Archive~),(More:Get Info)'
      );
    }

    // The destructive row of the untitled group is a row like any other: picked, it
    // reports; its disabled neighbour reports nothing.
    await pickRow('untitled', 'archive');
    expect(selectLog).toEqual([]);
    if (Platform.OS === 'android') {
      // A press on a disabled row still takes the popup down (D32); reopen for the
      // pick that reports.
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
    // Closed, `rows` differs by platform by construction: Android counts the rows the
    // open popup composed (none while it is shut), iOS counts what its model can
    // build. The relay below is what this gate is about, so the closed reading is
    // only asserted where it says something.
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
      // No window to watch on iOS, but the model still has to follow React: an open
      // menu's contents are the system's, and a *closed* one is the only place the
      // relay can be read from here.
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
    // `live` counts menus in the whole process, and the dropped control is the one
    // thing that cannot be trusted to report about itself - so the count is read on
    // a *surviving* control, as a delta from the value it had before anything opened
    // (`Q3` §2). Absolute numbers would make this test depend on the tests around it.
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
      // iOS reports `-1` for `live`: the control that could answer is gone, and the
      // one that remains says it cannot tell. Nothing here can be measured, and the
      // harness says so instead of reading a zero as a clean-up.
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
    // The survivor sees the same window the dropped control opened.
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
    // Recycling is the harness's, not the test's to force, so the claim is the one
    // that holds either way: a fresh mount of the same id shows what React sent and
    // nothing the last instance left behind - including an open menu.
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
    // Q3 §1's other half, proven at the moment it is worth proving: right now the
    // only handle that exists is the one the teardown left behind. A wait that
    // accepted "any handle answers" would be satisfied here and report the remount as
    // measured. The short wait below has to fail, and fail naming what it refused.
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
    // The leftover is the previous mount's handle, carrying the title this mount was
    // given, not the next one's.
    expect(previousTitle).not.toBe('Renamed');
    // And the wait refuses it. Measured on both platforms, the torn-down handle
    // answers `0.00x0.00` (drop and recycle clear the cached size on both), so the
    // zero rule and the title rule both refuse it here. The probe after the remount
    // holds the title rule on its own, against a handle with a real size to offer.
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
    // The title rule on its own: this handle has a real size to offer, so a wait that
    // accepted any handle would answer here. Ask for a title no mount was given and
    // the only thing that can refuse is the guard - drop the guard and this is the
    // line that goes red, which is what makes the wait a check rather than a comment.
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

// MARK: - Expressive rows (E2)

/**
 * Every new row shape at once (E2): a checked row with a subtitle, an unchecked
 * checkable row, a plain row with a subtitle, a titled group holding a checked row and
 * a disabled row with a subtitle, and an untitled group with a destructive row - the
 * last one is the barrier that the probe read a real menu.
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
 * `drawn` notation (`Menu.nitro.ts`). iOS reads UIKit's `UIMenu`: a subtitle is
 * `UIAction.subtitle` and a check is `.on`, and an unchecked toggle is `.off` like a
 * plain row, so `List` has no mark. Android reads the popup's semantics tree: every
 * Material group is `( )` - the top-level actions too - an unchecked checkable row is
 * `=`, and destructive is a colour the tree does not carry.
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
    // Nothing has asked yet, so nothing may be claimed.
    expect(report('e2-rows').drawn).toBeNull();
    const drawn = await readDrawn('e2-rows');
    console.log(`e2 rows: ${Platform.OS} drawn=${drawn}`);
    // The whole menu, in order: every subtitle and check where the platform puts it,
    // and on Android three Material groups - each section a surface of its own, where
    // before E2 a bare divider split one surface and the tree held no group at all.
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
      // D32 is unchanged on the new popup: one open, one close, pick before close.
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

    // In place: the same mount, new props. Both fields are part of what makes one
    // menu a different menu, so the wrapper's cached row array has to change with them.
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

// MARK: - Split trigger (E3)

/** Mount-time setters for {@link SplitMenu}, so a test can change one prop in place. */
const splitControl: {
  setAction?: (on: boolean) => void;
  setDisabled?: (on: boolean) => void;
} = {};

/**
 * The split configuration: a Menu whose `primaryAction` a test can take away and hand
 * back without remounting (E3).
 *
 * The action is passed as `undefined` rather than as a no-op when it is "off", because
 * `undefined` is what makes `Menu.tsx` send `hasPrimaryAction: false` - the flag that
 * chooses the trigger's layout. `useStableCallback` keeps one wrapper per mount, so
 * flipping it is a prop change and not a callback-identity change.
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
  /**
   * Two hit targets, two jobs.
   *
   * The claim under every line here is *two*, not "wider": a trigger that grew a
   * second container but routed both to the popup, or drew a second container that is
   * not a hit target at all, would satisfy a width assertion. The two halves are read
   * from the composition's own layout (`split`/`leading`/`trailing`) and pressed there,
   * not through the React Native frame - whose middle is the seam between them.
   */
  it('is two halves, and each one does only its own job', async () => {
    await render(<SplitMenu testId="split" />, { timeout: 20000 });
    await waitForTestId('split');
    await waitForHandle('split', 'the split menu');

    if (Platform.OS !== 'android') {
      // iOS is unchanged by E3's *layout*, and the -1s are the answer that says so
      // ("no second hit target exists here to measure"), not a `0` that would claim a
      // layout iOS chose. What the prop changes there is the gesture: a SwiftUI `Menu`
      // built with `primaryAction:` acts on a tap and opens on a long press (D29).
      //
      // Measured on this run, the harness's synthesised touch does reach that tap -
      // unlike a Button's own gesture environment, which refuses it (G2), so this is
      // the one place the action half of the prop is observable off the real-input
      // gate. The open half stays unobservable either way (system presentation), which
      // is what the -1s above and the iOS cases further up are for.
      const before = report('split');
      expectUnanswerable(before);
      expect(before.split).toBeNull();
      await pressTrigger('split');
      await settle(400);
      // One press, one action, and still no second container in the report.
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
    // Side by side and not overlapping - the seam is where a "single trigger with a
    // chevron drawn on top" would fail, because it has no second rect to report.
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

    // --- The trailing half: the list, exactly once. One press is one `onOpen`, which
    // is the same funnel the plain trigger relies on - Material's checked button
    // reports a *request*, and `MenuModel.setOpen` is what keeps it to one event.
    await pressRect(drawn.trailing, 'the list half');
    const opened = await waitForMenu(
      'split',
      (r) => r.expanded === true && r.live === liveBefore + 1
    );
    expect(stateLog).toEqual(['split:open']);
    expect(primaryLog).toEqual(['split:action']);
    expect(orderLog).toEqual(['action:split', 'open:split']);

    // --- And the list hangs off *that* half, not off the whole control: the window's left
    // edge has to be the trailing half's, not the control's (`lLeft`, well to its left).
    // E3 measured which of the two placements decides that - composing the list in the
    // leading half's slot moved this window to 21 px against these 202, while moving the
    // call out of the half's own wrapper `Box` and staying in this half's slot moved it
    // nowhere (`docs/tasks/E3/mutations.json`). The slot anchors the list; the `Box` is
    // `propagateMinConstraints` plumbing.
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

  /**
   * The second half follows the prop, in place.
   *
   * E3's layout claim in the direction the old code could not make: taking
   * `primaryAction` away has to *stop* drawing the split button, not leave a second
   * hit target that fires nothing. `split` is what the composition drew, so this is the
   * assertion that says the layout followed, rather than the prop being remembered.
   */
  it('takes the second half away with the action, and gives it back', async () => {
    await render(<SplitMenu testId="split-inplace" />, { timeout: 20000 });
    await waitForHandle('split-inplace', 'the split menu');
    if (Platform.OS !== 'android') {
      // The prop round-trips and iOS has no layout to change - the same statement the
      // case above makes, with the flag now moving.
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
    // Both halves go unread, not stale: a half that kept its box would still hand the
    // next gate coordinates for a container that is gone.
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

  /**
   * Across a remount, which is the recycle case.
   *
   * Fabric may hand the new mount the previous owner's native view, and the previous
   * owner here had a second hit target. `MenuModel.reset` and the split composition's
   * own `onDispose` are the two things that stop that layout answering for a control
   * that never asked for it, and this is the only place either is observed from the
   * device side (`MenuModelTest.aRecycleClearsTheSplitTriggerAndItsHalves` is the
   * off-device twin).
   */
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

    // Same testID, same title, no `primaryAction` - the shape a recycled view arrives
    // in, where the only difference from the previous owner is the missing half.
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
      // Android answers the layout question directly: the recycled view drew one
      // trigger, so `split` is a `false` and both halves are unread rather than stale.
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
      // iOS never had a split layout to leak, so the three fields answer -1 before the
      // remount and after it - the same answer, which is the claim E3 can make there.
      expectUnanswerable(fresh);
    }
    console.log(
      `split remount: split=${String(report('split-recycle').split)}`
    );
    unmountAgain();
  });

  /**
   * `disabled` reaches both halves, and ends an open list (D29).
   *
   * The close is D29's rule restated for a split trigger; the two refusals are the
   * half that a plain Menu has no equivalent of, because there is only one press to
   * refuse there. Material keeps a disabled button inert before the model sees the
   * press, so the off-device twin of this (`aDisabledControlRefusesThePrimaryAction`)
   * asks the model directly - this is the real-input-shaped version.
   */
  it('disables both halves and closes an open split menu', async () => {
    await render(<SplitMenu testId="split-disabled" />, { timeout: 20000 });
    await waitForHandle('split-disabled', 'the split menu');
    if (Platform.OS !== 'android') {
      // iOS: the flag round-trips and the presentation is SwiftUI's, exactly as the
      // non-split disabled case above asserts.
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

  /**
   * The split configuration's size, earned rather than inherited (D17's rule, E3's
   * configuration).
   *
   * Two wrong answers are poisoned and refused: the planted `WRONG_SIZE`, and the
   * control's *declared fallback* - which is what a split trigger left at the first
   * frame would sit at. The two boxes are also compared with each other, because the
   * sizing key carries an `action` field precisely so these two configurations cannot
   * share a cache entry. A source that dropped the field puts both Menus in one entry,
   * and this is the case that sees it - on the *split* control, left at the plain
   * trigger's width. A shared entry holds one answer, the last correction written to it,
   * and the split control is the holder that no longer matches its own measurement. Both
   * directions of the mutation are in `docs/tasks/E3/mutations.json`; the field itself,
   * which no device run can read, is guarded by
   * `src/__tests__/menuSizingKey.test.tsx`.
   */
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
      // Material's own answer: the second container makes the control wider. iOS's
      // `primaryAction` is a gesture, so its box is the same box and this line would be
      // a lie there - which is the same asymmetry the whole suite is written around.
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
 * A Menu hosted by a `<Host>`, under a spacer the test can lengthen.
 *
 * Shape copied from `HostPopups.harness.tsx`'s `PopupHost`, for the reason it gives:
 * inside a `<Host>` the child's own React Native frame is `0 × 0` (D24), so the
 * witness's rect is the only address there is, and a spacer is how a test moves the
 * thing underneath a popup's window without a scroll gesture.
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
      // `<Host>` is the documented passthrough on iOS (D23): the child keeps its own
      // React Native view, so the honest claim is that hosting changes nothing the
      // box is made of - not an Android geometry that does not exist here.
      // The measurement is taken first and the frame is then waited for, in that
      // order: the first frame is the declared fallback, so reading the frame once
      // compares a pre-correction box with a post-correction measurement and passes
      // only when the correction happened to land first. It did exactly that until
      // this trigger grew its Button chrome, and then the window closed. `waitForBox`
      // asks for the size the control earned, like every other sizing gate here.
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

    // The sanity gate under the rest of this test, in `HostPopups`'s words: if the
    // anchor rect came from the React Native frame it would be `0 × 0` here, and the
    // press below would land on the spacer instead of on the button.
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
    // Under the button rather than under the `<Host>`'s rectangle - which is the
    // whole point of this control having its own anchor, and what a plain
    // `DropdownMenu` composed inside a host would get wrong.
    expect(mTop + 24).toBeGreaterThanOrEqual(aBottom);
    expect(Math.abs(mLeft - aLeft)).toBeLessThan(40);
    expect(first.rows).toBe(PICKABLE);
    const gap = mTop - aBottom;
    // The upper bound, which the line above does not give: `mTop + 24 >= aBottom` only
    // refuses a popup that comes up *above* the button, so a list opened 200 px below
    // it would pass. The number is the same 48 the reopened half below uses, so both
    // halves ask one question.
    //
    // How this was shown able to fail (G7b fix round 1, M2). Baseline on this emulator:
    // the popup's window top sat 16 px below the anchor's bottom. Replacing this
    // `ExposedDropdownMenu` with a plain `DropdownMenu(offset = DpOffset(0.dp, 64.dp))`
    // - a 64 dp offset handed to Material's own position provider, so the *window*
    // moves rather than its content - made the same reading 168 px, and this line
    // went red with `expected 168 to be less than 48` (`harness:android:Menu`, 30 Oct
    // 01:48:49Z). So the bound does catch a popup that moves: the witness reads the
    // window, and the window can move.
    //
    // What it did *not* catch, in round 1: dropping `menuAnchor` from the trigger three
    // ways (the anchor inside the box, a `clickable` + `DropdownMenu`, that pair inside
    // a `fillMaxSize` Box) and a 300 dp `Modifier.offset` on the list's *content*. All
    // four passed this gate whole, which on this Material version (1.4.0) is the
    // measurement: none of them moved the popup's window off the anchor. So this bound
    // guards behaviour `menuAnchor` provides, and the code comment in
    // `HybridNitroUiMenu.kt` explaining why the anchor stays is a reading of Material's
    // contract rather than something these four mutants reproduced.
    expect(gap).toBeLessThan(48);

    // Move the `<Host>`. Compose is never told: a popup positions itself against the
    // anchor's box inside its own composition, so a window left standing would point
    // at where the button used to be. `docs/components/host.md` records that answer
    // for the Picker; this is the same rule, measured on the Menu.
    log.setSpacer?.(120);
    const moved = await waitForMenu(
      'hosted-menu',
      (r) => r.expanded === false && (r.live ?? 0) === liveBefore
    );
    expect(moved.menu).toEqual([-1, -1, -1, -1]);

    // The witness followed the Host rather than freezing: the press below is aimed at
    // the rect it reports *now*, so a stale rect lands on the spacer and no menu
    // opens. That is what makes the second half evidence and not a restatement.
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
    // The list came up at the *new* anchor rather than where the old one is: within a
    // row of the new anchor's bottom, and a good part of the 120 dp away from where it
    // sat before. Material is allowed a small correction of its own at the second
    // place - the numbers are logged below rather than pinned to a constant, because
    // what this gate refuses is a popup that stayed behind, not a five-point inset.
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

    // Leave nothing up: `live` counts menus in the whole process, so a window this
    // gate forgets is the next gate's leak.
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
      // On iOS the two Menus are ordinary React Native views (D23), so the claim
      // that survives is only that both are there and neither reports a window.
      await waitForTestId('hosted-removal');
      await waitForTestId('hosted-survivor');
      expectUnanswerable(report('hosted-survivor'));
      return;
    }
    await waitForTestId('hosted-removal');
    const liveBefore = report('hosted-survivor').live ?? 0;
    // Pressed where the Host drew it, as the other hosted cases are: a hosted child's
    // React Native frame is `0 × 0` at the Host's origin (`docs/components/host.md`,
    // "Finding a hosted control"), so its centre is the trigger's corner pixel - which
    // `menuAnchor`'s whole-box pointer input caught before E2, and a Button's own touch
    // target does not.
    await pressWitnessed('hosted-removal');
    await waitForMenu(
      'hosted-removal',
      (r) => r.expanded === true && r.live === liveBefore + 1
    );
    // Take the child out and leave the `<Host>` itself alone - the third teardown an
    // app performs, after the whole-host drop and the disable.
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
   * Two hosted controls stacked in one `<Host>`, the one above able to grow.
   *
   * This is the second of the two ways an anchored window can be left pointing at
   * nothing, and the `<Host>`-moves test above cannot see it: growing the row above
   * moves the Menu's button *inside* the composition while the composition itself,
   * and the `<Host>`'s React Native frame, stay exactly where they were. Only a
   * reading of the anchor's own box can notice (`noteAnchorBox`), which is why the
   * fixture is a pair rather than another spacer.
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
      // Nothing to measure: iOS hosts by passing the child through (D23), so the
      // button and the menu are ordinary React Native views there.
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
    // And the button really did move - without this the gate above could be reading a
    // window that closed for a reason nobody intended.
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
    // Every handle this test reads is waited for, not read once: `hybridRef` lands
    // after the commit `render` resolves, so a single read is a race with view
    // creation. `read-back-fallback` is the one X14's merge tripped on, and
    // `read-back-plain` is the same shape one line earlier - it just happens to be
    // behind a `waitForMeasured` that only waits for `read-back`.
    const named = await waitForHandle('read-back', 'the named menu');
    const plain = await waitForHandle('read-back-plain', 'the disabled menu');
    expect(named?.title).toBe('Named');
    expect(named?.variant).toBe('outlined');
    expect(named?.size).toBe('large');
    expect(named?.disabled).toBe(false);
    expect(named?.systemImage).toBe('tray.full');
    expect(named?.accessibilityLabel).toBe('Open the actions');
    // The colour is the platform's own `processColor` output - D10's bit pattern,
    // which is why the expected number is computed rather than written down.
    expect(named?.tintColor).toBe(processColor('#c837ab'));
    expect(plain?.accessibilityLabel).toBeNull();
    expect(plain?.disabled).toBe(true);
    console.log(
      `read back: variant=${String(named?.variant)} size=${String(named?.size)} ` +
        `tint=${String(named?.tintColor)} label=${String(
          named?.accessibilityLabel
        )}`
    );
    // The half the getters cannot say: that the name reaches the element a screen
    // reader lands on. Everything above is a round trip through React's props, so this
    // reads the tree the harness can walk - the house pattern of `Progress.harness.tsx`
    // and `Slider.harness.tsx`. And it is a different read, not the same one: measured
    // at `06-20-03Z`, clearing `accessibilityLabel` off the view RN builds for this
    // control - prop, model and SwiftUI element untouched - leaves all six getters above
    // answering and makes this query return null.
    const namedElement =
      harnessUi.queryByAccessibilityLabel('Open the actions');
    // `read-back-fallback` sets no `accessibilityLabel`, so this is the title fallback -
    // logged rather than asserted, because the walk cannot see it: measured at
    // `06-02-21Z` it answers null on iOS, and on Android the query answers null for every
    // Compose control (`Slider.harness.tsx`), so it would say nothing there either way.
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
    // What this cannot say. On Android the one-node promise (`clearAndSetSemantics`
    // carrying name, value, role, state and the action, so TalkBack gets one focus stop
    // rather than a nameless one beside it) is a claim about the `SemanticsNode` tree,
    // and the only reading of that tree this environment has is `uiautomator dump` -
    // which is `realInput`, and G7b's. On iOS the element the walk lands on is the one RN
    // makes for the view: `HybridNitroUiMenuComponent` is an `RCTViewComponentView`, RN
    // applies `accessibilityLabel` to it from its own base props, and the Swift host is
    // only its `contentView` - so deleting `.modifier(OptionalMenuAccessibility(...))`
    // from the SwiftUI trigger, measured at `06-02-21Z`, leaves this query answering for
    // `'Open the actions'`. What the assertion holds is that the prop reaches the
    // component view RN makes at the trigger's box - not the name VoiceOver reads. The
    // query walks UIKit views only, and that view is not an accessibility element (no
    // `accessible`), so the name a reader gets comes from the SwiftUI modifier, which
    // this test cannot reach (a reading; FOLLOWUPS has it for G7b). What VoiceOver says
    // for the rows is SwiftUI's own naming, and
    // nothing here can open the menu to hear it. `docs/components/menu.md` keeps the list
    // of what is and is not stood behind.
  });
});

// MARK: - The glyph and the top of the ladder (G19 fix round 2)

/**
 * `androidIcon` on the trigger, and the two rungs the trigger was missing.
 *
 * Both come from one review finding: `ButtonSize` and `ButtonProps.androidIcon` grew
 * in this task and Menu — whose trigger *is* a Button, in the docs and in the
 * composition — was left behind. `size="xlarge"` type-checked and drew `medium`;
 * a glyph was not offerable at all.
 *
 * What a device adds over `src/__tests__/menuSizingKey.test.tsx` (which reads the key
 * and the prop directly) is the box. A key can carry a field and a prop can arrive and
 * still be drawn wrong: the icon can miss its slot, an unresolved name can reserve one
 * anyway, and a rung can be sent to native and laid out at the declared fallback. So
 * every case here measures, poisons first so nothing is inherited, and compares
 * against a real `Button` rather than against a constant — the same rule the parity
 * gate above runs on.
 *
 * **The drawn glyph is proven by width, not by pixels.** Menu has no pixel probe
 * (Button's `nuiTestPixelProbe` is its own spec, and D43's tint rule is proven there),
 * and a Menu's node tree does not show the glyph either: it carries no
 * `contentDescription`, because the trigger's own node names the control. What is
 * measurable is that the slot Material's `Button` reserves was taken — which only
 * happens when the composition was handed artwork — and that the box it produced is
 * the *same box* a Button with the same asset produced, drawn by the same
 * [NitroUiM3Button]. That comparison is what a Menu-specific pixel probe would add
 * nothing to.
 */
describe('Menu · the glyph and the top rungs (G19 fix round 2)', () => {
  /**
   * The Material Symbols file the example app imports, required the way an app does.
   *
   * `share_24px.xml`, not `star_24px.xml`: Button's D43 suite loads the star in its
   * own gates and this suite wants the file read fresh here. It does not change a
   * single assertion below — every box in this file is a *settled* box — but a cold
   * read is the state a developer's first frame is in, and `Pending` taking the slot
   * is half of what the second case proves.
   */
  const SHARE_ASSET = require('../src/assets/icons/share_24px.xml');

  /** A name the example app does not ship, so the resource table answers 0. */
  const NOT_SHIPPED = 'nitroui_test_never_built';

  const RUNGS = ['small', 'medium', 'large', 'xlarge', 'xxlarge'] as const;

  /**
   * Measure, in the order given, and refuse a control that never reported a box.
   *
   * `buttonIds` names the ids that are `Button`s, because the two controls answer
   * `measureContent` through **different handle maps** — `handles` holds what
   * `captureHybrid` handed back, `buttonHandles` what `captureButton` did. Asking the
   * Menu map about a Button is not a wrong number, it is no number at all: the poll
   * sits there until it times out, which is how this first met a device.
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
    // The claim `docs/components/menu.md` makes about a control it could not make
    // until now: an icon makes a trigger wider, and by exactly the amount it makes a
    // Button wider, because they are the same composition. Four configurations, both
    // components, poisoned in both caches — and no constant anywhere, so the ladder
    // and Material's `hasStartIcon` padding can move and this stays true.
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
    // The wire the wrapper built, read back off the trigger: an asset has to arrive as
    // the dev-server URL (or, in a release build, the drawable Metro filed it under),
    // not as the number `require` evaluated to.
    if (Platform.OS === 'android') {
      expect(handles.get('menu-icon')?.androidIcon ?? '').toMatch(
        /^url:.*share_24px\.xml/
      );
      // Material's slot, taken: the ladder's glyph plus its spacing, and not one
      // pixel of it decided by the file.
      expect(icon.width).toBeGreaterThan(plain.width + 1);
      expect(Math.abs(icon.height - plain.height)).toBeLessThan(0.6);
      // The Box the Button's icon produced, to the tenth of a dp: same slot, same
      // painter, same padding call. A Menu that resolved the icon and never passed it
      // to its trigger, or passed it to a slot of its own making, fails here rather
      // than in a screenshot nobody compares.
      expect(sameSize(icon, twin)).toBe(true);
    } else {
      // iOS draws `systemImage` and ignores `androidIcon` — the same contract Button
      // keeps, now measured on the second control that offers the prop.
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
    // Round 1's contract, on the new control: an unresolvable name is *no icon*, not a
    // smaller icon. Reserved-but-empty artwork is the failure a release build hides
    // and a user sees as a gap beside a label.
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
    // `primaryAction` gives Android a second container, and the label — with its
    // glyph — goes in the leading one while the chevron holds the trailing one. iOS
    // has one button for both jobs, so this is an Android measurement, like E3's.
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
    // The half of item 4 a JS test cannot see: `xlarge` reaching native is one thing,
    // being *laid out* at 96 dp another. Before this round the wrapper rewrote the
    // rung to `medium`, so this measured a 48 dp box for a name whose box is 96 — and
    // nothing else in the suite noticed, because every other gate asks a box to be
    // earned rather than to be a particular height.
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
      // Material's own container heights: 48 / 48 / 56 / 96 / 136, the first two
      // sharing a box because the 48 dp touch target floors both. The top two numbers
      // only exist if the rung reached Compose: `medium` is 48 dp, which is what this
      // control drew for `xlarge` until this round.
      expect(heightOf('medium')).toBeLessThan(heightOf('large'));
      expect(heightOf('large')).toBeLessThan(heightOf('xlarge'));
      expect(heightOf('xlarge')).toBeLessThan(heightOf('xxlarge'));
      expect(heightOf('xlarge')).toBeGreaterThanOrEqual(95.5);
      expect(heightOf('xxlarge')).toBeGreaterThanOrEqual(135.5);
    } else {
      // iOS has fewer `.controlSize` values than the ladder has rungs, so the top of
      // the ladder collapses there — documented in `docs/components/menu.md` as the
      // same collapse `docs/components/button.md` measures for Button. Asserted, so a
      // future SDK that stops collapsing it is a change someone notices.
      expect(heightOf('xlarge')).toBeGreaterThanOrEqual(heightOf('medium'));
      expect(Math.abs(heightOf('xlarge') - heightOf('xxlarge'))).toBeLessThan(
        0.6
      );
    }
  });
});

/**
 * `androidIcon` on the rows (G21): a glyph in each row's Material slot.
 *
 * The popup is a window of its own, so nothing readable on this control - no box, no
 * semantics node, no prop echo - can say whether a row's glyph reached the screen. Two
 * things make it readable here:
 *
 *  - `iconTints=` in the menu's own report, which each row writes **as it draws**, from
 *    the `LocalContentColor` its glyph is tinted with. A harness cannot name this
 *    device's dynamic Material palette, so it asks the row and then samples for that;
 *  - `nuiTestMenuPixelProbe`, which samples the popup window the witness already keeps.
 *
 * The numbers are compared as **differences** between two menus that differ only by the
 * icon, because a colour count includes the row titles - which are drawn in the same
 * colour. Subtract the menu with no icons and what is left is the artwork, and the
 * artwork here is a filled square, so what is left is also the slot's area. That is the
 * size claim: 20 dp (`MenuDefaults.LeadingIconSize`) on this device's density, squared.
 *
 * One popup is open at a time, everywhere below. A Material popup takes focus and
 * dismisses on a touch outside itself, so pressing a second trigger while a first menu
 * is open would dismiss the first and its sample would be the frame of a dying window.
 */
describe('Menu · the row glyphs (G21)', () => {
  /** The same filled square, through each road D43 gives an app. */
  const SLAB_ASSET = require('../src/assets/icons/slab_24px.xml');
  const SLAB_NAME = 'nitroui_test_slab';
  const NOT_SHIPPED = 'nitroui_test_never_built';

  /** `MenuDefaults.LeadingIconSize` in material3 1.5.0-beta02. Not 24 dp. */
  const ROW_ICON_DP = 20;

  /**
   * One row with a glyph, one row without, and a disabled row to close through.
   *
   * The glyph is on the row that can also be `checked`, because that is the pair worth
   * measuring: Material swaps the check *into the same slot*, so the menu is one width
   * either way. The titles are the ones every comparison menu here uses too, so
   * subtracting one probe from the other cancels the text and leaves the artwork.
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
   * A rect's `WxH`, which is the half of it two menus can share.
   *
   * Two triggers in one column are not in one place, so their popups are not either;
   * the claim a size makes - no reserved gap, no moved label - is about the frame, and
   * comparing whole rects would compare where each menu happens to sit.
   */
  function frameOf(rect: number[]): string {
    const [left, top, right, bottom] = edges(rect, 'menu');
    return `${String(Math.round(right - left))}x${String(
      Math.round(bottom - top)
    )}`;
  }

  /**
   * Run one probe on `probe`/`read` and wait for that probe's own answer.
   *
   * Sampling needs the UI thread and a Nitro method may not block for it, so a probe is
   * a pair: ask, then poll. The `n=` a line carries is the sentinel that says the answer
   * is the one this call asked for and not the previous control's.
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

  /** Open `testId`, wait for its rows to be composed, and hand back the report. */
  async function openRows(testId: string): Promise<MenuReport> {
    await pressTrigger(testId);
    return await waitForMenu(testId, (r) => r.expanded === true);
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
    // The artwork for a Metro asset arrives on its own schedule, and the row records its
    // tint as soon as it *composes* the slot - before the bytes, if the bytes are late.
    // Sampling then would count a slot reserved for a glyph, not a glyph, so the count is
    // read until it stops moving.
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
      // no Android glyph. Both are the honest version of a green.
      const opened = await openRows('rows-asset');
      expect(opened.iconTints).toBe('-');
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

    // The slot, measured: `MenuDefaults.LeadingIconSize` is 20 dp, and a square that
    // fills its canvas paints the slot squared. 12% is the anti-aliased edge of a
    // 55-pixel square, and nothing else: Material's 24 dp default would be 44% more ink
    // and "resolved but never drawn" is 100% less.
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
    // counting the last frame it saw - a stale answer would otherwise pass as a live one
    // for everything that reads this handle next.
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
      expect((await openRows('rows-missing')).iconTints).toBe('-');
      return;
    }

    // Before anything is open, the probe refuses: "nothing to sample" is a different
    // answer from "sampled, and found none", and the harness needs to tell them apart.
    const handle = await waitForHandle('rows-missing', 'the closed control');
    handle.nuiTestMenuPixelProbe(0x123456);
    expect(handle.nuiTestMenuPixelReport()).toContain('no popup');

    const missing = await openRows('rows-missing');
    expect(missing.iconTints).toBe('-');
    // Resolved-to-nothing is the menu with no icons at all: no reserved gap, no moved
    // label, one popup frame. `Absent` reaches `leadingIcon` as `null`, which is what
    // makes that true - a non-null-but-empty lambda would still take 20 dp.
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
      return;
    }

    // The row's own glyph, on the row that can be checked, on the menu where it is not.
    const unchecked = await openRows('rows-unchecked');
    expect(tintsOf(unchecked).has('slab')).toBe(true);
    const uncheckedFrame = frameOf(unchecked.menu);
    await shut('rows-unchecked');

    // The same row checked: it drew Material's check *in that slot* instead, so it
    // recorded no tint for the app's glyph - and the popup is exactly as wide, which is
    // the difference between "the check takes the slot" and "the slot comes and goes
    // with the state". Same props, same group: one `MenuGroup`, one `checked`.
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
    const tint = 0xff00a0;
    await render(
      <View style={columnStyle}>
        <Menu
          title="Publish"
          group={glyphGroup(undefined)}
          primaryAction={() => {}}
          tintColor={tint}
          androidIcon={SLAB_NAME}
          testID="split-ink"
          hybridRef={captureHybrid('split-ink')}
        />
        <Menu
          title="Publish"
          group={glyphGroup(undefined)}
          primaryAction={() => {}}
          tintColor={tint}
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
      expect(
        (
          await waitForHandle('split-ink', 'the iOS split trigger')
        ).nuiTestPixelReport()
      ).toBe('');
      return;
    }

    const withGlyph = report('split-ink');
    const without = report('split-noink');
    const [lLeft, , lRight] = edges(withGlyph.leading, 'leading');
    const [tLeft, , tRight] = edges(withGlyph.trailing, 'trailing');
    const [plainLLeft, , plainLRight] = edges(without.leading, 'leading');
    const [plainTLeft, , plainTRight] = edges(without.trailing, 'trailing');
    console.log(
      `split halves: glyph=${lRight - lLeft}/${tRight - tLeft} ` +
        `plain=${plainLRight - plainLLeft}/${plainTRight - plainTLeft}`
    );
    // The label, glyph and all, lives in the leading half: that half grows by the slot,
    // and the chevron's half does not move at all.
    expect(lRight - lLeft).toBeGreaterThan(plainLRight - plainLLeft + 8);
    expect(Math.abs(tRight - tLeft - (plainTRight - plainTLeft))).toBeLessThan(
      0.6
    );

    // And the glyph is *painted* there. The tint is the app's own, so the colour is
    // known; the label carries it too, so what is asserted is the difference the square
    // makes - an icon that resolved, laid out a slot wide, and never drew is exactly
    // what a prop echo cannot be told apart from, and what this can.
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

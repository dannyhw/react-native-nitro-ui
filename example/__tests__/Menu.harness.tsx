/**
 * On-device tests for the Menu (task G7a).
 *
 * A Menu is a Button's box and a window's worth of content, so this suite has two
 * halves that read completely differently.
 *
 * **The box** is the Button's story, told again: the sizing configuration is
 * `variant|size|systemImage|title` (`Menu.tsx`'s `sizingVariantFor`), the items are
 * deliberately *not* in it, and every cold configuration is poisoned first
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
 * measured that for every Button style). So on iOS the open/close counters, the
 * rects, `live` and the inline-vs-nested difference are asserted only as far as the
 * `-1`s and the row count go, and the taps that need a real HID-level event are
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
  readonly accessibilityLabel: string | null;
  measureContent(): { width: number; height: number };
  nuiTestSelectRow(id: string): void;
  nuiTestMenuReport(): string;
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
 * `stateLog` cannot say between them: two arrays have no shared position, so a
 * pick that fired `onSelect` first and `onClose` second would leave both of them
 * exactly as they are now. `docs/components/menu.md` states the order, so this is
 * the line that holds it.
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

// MARK: - The witness

/** The five numbers a menu is asked about, parsed out of its report line. */
type MenuReport = {
  /** `-1` means "this platform cannot tell", which is not the same as `false`. */
  expanded: boolean | null;
  live: number | null;
  anchor: number[];
  menu: number[];
  rows: number;
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
  return {
    // `-1` is this control's own "unanswerable" (Q1 §2: "never a `0` that reads as
    // 'checked'"), so it must not coerce into `false`/`0` here and hide the
    // difference between "closed" and "cannot tell".
    expanded: expandedField === '-1' ? null : expandedField === '1',
    live: liveField === '-1' ? null : Number(liveField),
    anchor: rect('anchor'),
    menu: rect('menu'),
    rows: Number(field('rows')),
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
 * Poll until *this* mount reports a size.
 *
 * `handles` outlives `unmount()` - the entry is replaced when the next mount
 * registers, never cleared when the last one goes away - so `waitForMeasured` can be
 * answered by the handle of a control that no longer exists, and the previous
 * instance's number would satisfy "the remount measured". Q3 §1's
 * `waitForFreshMeasure` is the house patch for exactly this: only a handle that is not
 * the one captured before the teardown may answer, and zero is absence, not a verdict.
 */
async function waitForFreshMeasure(
  testId: string,
  stale: MenuHandle | undefined,
  what: string
): Promise<Size> {
  return await pollUntil(
    () => {
      const handle = handles.get(testId);
      if (handle == null || handle === stale) {
        return null;
      }
      const size = handle.measureContent();
      return size.width > 0 && size.height > 0 ? size : null;
    },
    () =>
      new Error(
        `"${testId}" (${what}) never measured on its new mount - the handle that ` +
          `answers is ${
            handles.get(testId) === stale ? 'the old mount' : 'absent'
          }, measureContent() says ${describeSize(measured(testId))}, box ` +
          `${describeSize(sizeOf(testId))}.`
      )
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
 * The key `Menu.tsx` builds: `variant|size|systemImage|title`, each piece escaped.
 *
 * Written out here rather than imported - a harness that poisoned the cache through
 * the library's own helper could not catch the helper being wrong, and a missing
 * input in that key is the R3 bug class. The absence of `group` is asserted, too
 * (see the "trigger, not the list" test).
 */
function sizingKey(
  variant: string,
  size: string,
  title: string,
  systemImage = ''
): string {
  const escape = (value: string): string => value.replace(/[\\|]/g, '\\$&');
  return [variant, size, escape(systemImage), escape(title)].join('|');
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
    : { width: 118, height: 52 };

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
  nitroUiCore.setSizingTraceEnabled(false);
});

// MARK: - The box

describe('Menu · G7a', () => {
  /** The five Button variants a trigger can be, plus two of its three sizes. */
  const VARIANTS = ['filled', 'tonal', 'outlined', 'text', 'elevated'] as const;
  const TRIGGER_SIZES = ['small', 'large'] as const;

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
    // listener that never sees the menu go away. (`Q1` §5 words this as "never for a
    // pick"; the reading taken here is that an *unpaired* close is what to refuse -
    // see the report.)
    expect(stateLog).toEqual(['events:open', 'events:close']);
    // And the order between the two callbacks, which neither log above can express.
    // `MenuModel.applyPick` closes the popup before it reports the choice, and
    // `docs/components/menu.md` promises exactly this sequence: a listener that
    // re-enables something on the pick never does it while the window is still up.
    expect(orderLog).toEqual([
      'open:events',
      'close:events',
      'select:events:copy',
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
    // The handle this mount leaves behind, captured while it is still the only one.
    const stale = handles.get('recycle');
    unmount();
    await settle(400);
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
    await waitForFreshMeasure('recycle', stale, 'the remounted menu');
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

    expect(log.menu).toBeDefined();
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
    await pressTrigger('hosted-removal');
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
    await pressTrigger('hosted-survivor');
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
    const named = handles.get('read-back');
    const plain = handles.get('read-back-plain');
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
    // reader lands on. Everything above is a round trip through React's props and
    // would still pass with the platform's own labelling deleted, so this reads the
    // tree the harness can walk - the house pattern of `Progress.harness.tsx` and
    // `Slider.harness.tsx`. iOS exposes UIElements carrying `accessibilityLabel`, and
    // the query answers with the control's own box; Compose publishes `SemanticsNode`s
    // that are not Views, so on Android it answers null however correct the component
    // is, and reading that tree is `uiautomator dump` - G7b's real-input pass.
    const namedElement =
      harnessUi.queryByAccessibilityLabel('Open the actions');
    // `read-back-fallback` sets no `accessibilityLabel`: this is the title fallback,
    // asserted on a control a screen reader can stop on.
    const fallbackElement = harnessUi.queryByAccessibilityLabel('Fallback');
    // `Plain` is disabled, and whether a disabled control belongs in the tree is the
    // platform's call rather than this control's, so it is logged and not asserted.
    console.log(
      `a11y tree: named=${describeSize(namedElement)} ` +
        `fallback=${describeSize(fallbackElement)} ` +
        `plain=${describeSize(harnessUi.queryByAccessibilityLabel('Plain'))}`
    );
    expect(handles.get('read-back-fallback')?.accessibilityLabel).toBeNull();
    if (Platform.OS === 'ios') {
      const namedBox = await waitForTestId('read-back');
      const fallbackBox = await waitForTestId('read-back-fallback');
      expect(namedElement).not.toBeNull();
      expect(Math.abs(namedElement!.width - namedBox.width)).toBeLessThan(2);
      expect(fallbackElement).not.toBeNull();
      expect(Math.abs(fallbackElement!.width - fallbackBox.width)).toBeLessThan(
        2
      );
    }
    // What this cannot say: on Android the one-node promise (`clearAndSetSemantics`
    // carrying name, value, role, state and the action, so TalkBack gets one focus
    // stop rather than a nameless one beside it) is a claim about the node tree, and
    // the only reading of that tree this environment has is `uiautomator dump` -
    // which is `realInput`, and G7b's. Same for the rows being announced on iOS,
    // where SwiftUI's own names are what a screen reader gets.
  });
});

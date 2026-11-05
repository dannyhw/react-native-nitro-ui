/**
 * On-device tests for the Android theme (task X18, DECISIONS D39 item 3).
 *
 * Android draws every control with Material 3 Expressive unless the app calls
 * `setMaterialTheme('baseline')`. The question each case asks is the one the opt-out
 * has to answer for: does the choice reach *every* composition the library owns - a
 * control's own (one per Hybrid View) and a `<Host>`'s, which its children compose
 * inside - and does it reach the ones already on screen, both ways?
 *
 * The reading is `nitroUiCore.materialThemeReport()`: the setting, how many theme roots
 * have composed under each Material motion scheme, and how many content subtrees were
 * created under a root (`created`). A switch must *recompose* what is on screen, never
 * rebuild it: a rebuild ends a presented sheet's presentation, closes an open menu and
 * drops a focused field's focus (X18 fix round 1), so the live cases hold `created` still
 * and watch a sheet, a context menu and a field through the switch. The count is taken inside
 * the theme from `MaterialTheme.motionScheme` - what Material hands a control's
 * content, not what the root meant to choose - so a root that ignored the setting
 * shows up as a count under the wrong scheme. Every case reads the change across
 * its own window, because the totals belong to the process and other suites mount
 * controls too.
 *
 * iOS has no Material theme: there the report is empty and the call is a no-op, and
 * the last case holds it to that.
 */
import { useState } from 'react';
import { Platform, View } from 'react-native';
import {
  afterEach,
  cleanup,
  describe,
  expect,
  it,
  render,
} from 'react-native-harness';
import {
  BottomSheet,
  Checkbox,
  ContextMenu,
  Host,
  type MenuGroup,
  Switch,
  TextField,
  nitroUiCore,
  setMaterialTheme,
} from 'react-native-nitro-ui';

import { waitForHandle } from './handles';

type Report = {
  setting: string;
  expressive: number;
  baseline: number;
  other: number;
  created: number;
};

function readReport(): Report {
  const raw = nitroUiCore.materialThemeReport();
  const fields = new Map(
    raw.split(';').map((pair) => {
      const [key, value] = pair.split('=');
      return [key ?? '', value ?? ''] as const;
    })
  );
  return {
    setting: fields.get('setting') ?? '',
    expressive: Number(fields.get('expressive') ?? 'NaN'),
    baseline: Number(fields.get('baseline') ?? 'NaN'),
    other: Number(fields.get('other') ?? 'NaN'),
    created: Number(fields.get('created') ?? 'NaN'),
  };
}

function delta(before: Report, after: Report) {
  return {
    expressive: after.expressive - before.expressive,
    baseline: after.baseline - before.baseline,
    other: after.other - before.other,
    created: after.created - before.created,
  };
}

/** Poll until `done(report)` holds; fail with the last report if it never does. */
async function waitForReport(
  done: (report: Report) => boolean,
  what: string,
  timeoutMs = 5000
): Promise<Report> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const report = readReport();
    if (done(report)) return report;
    if (Date.now() > deadline) {
      throw new Error(
        `${what}: never happened within ${String(timeoutMs)}ms; last report ` +
          nitroUiCore.materialThemeReport()
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Long enough for any recomposition the last change scheduled to have run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Poll `read` until it hands back something; fail naming `what`. */
async function waitFor<T>(
  read: () => T | null,
  what: string,
  timeoutMs = 8000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value != null) return value;
    if (Date.now() > deadline) {
      throw new Error(`${what}: never happened within ${String(timeoutMs)}ms`);
    }
    await sleep(50);
  }
}

/** The BottomSheet's handle and report (declared, not imported - D14). */
type SheetHandle = { nuiTestStateReport(): string };
let sheet: SheetHandle | null = null;
const captureSheet = (handle: SheetHandle): void => {
  sheet = handle;
};
type SheetReport = Record<string, string> & { raw: string };
function sheetReport(): SheetReport {
  const raw = sheet?.nuiTestStateReport() ?? '';
  const report: SheetReport = { raw };
  for (const pair of raw.split(';')) {
    const at = pair.indexOf('=');
    if (at > 0) report[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return report;
}
/** Everything the sheet told the app. A switch must tell it nothing. */
const sheetEvents: string[] = [];
const onSheetPresentedChange = (next: boolean): void => {
  sheetEvents.push(`presented:${String(next)}`);
  sheetSetOpen?.(next);
};
const onSheetDismiss = (): void => {
  sheetEvents.push('dismiss');
};
const onSheetDetentChange = (index: number): void => {
  sheetEvents.push(`detent:${String(index)}`);
};
let sheetSetOpen: ((next: boolean) => void) | null = null;

/** A sheet presented from the first render, at `medium` of `medium`/`large`. */
function SheetScreen() {
  const [open, setOpen] = useState(true);
  sheetSetOpen = setOpen;
  return (
    <BottomSheet
      testID="theme-sheet"
      isPresented={open}
      detents={['medium', 'large']}
      onIsPresentedChange={onSheetPresentedChange}
      onDismiss={onSheetDismiss}
      onDetentChange={onSheetDetentChange}
      hybridRef={captureSheet}
    >
      <View style={{ height: 160 }} />
    </BottomSheet>
  );
}

/** The ContextMenu's handle (declared, not imported - D14). */
type MenuHandle = {
  nuiTestA11yLongClick(): void;
  nuiTestSelectRow(id: string): void;
  nuiTestContextMenuReport(): string;
};
let menu: MenuHandle | null = null;
const captureMenu = (handle: MenuHandle): void => {
  menu = handle;
};
function menuReport(handle: MenuHandle): SheetReport {
  const raw = handle.nuiTestContextMenuReport();
  const report: SheetReport = { raw };
  for (const pair of raw.split(';')) {
    const at = pair.indexOf('=');
    if (at > 0) report[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return report;
}
const MENU_GROUP: MenuGroup = {
  actions: [
    { id: 'first', title: 'First' },
    { id: 'second', title: 'Second' },
  ],
};
/** Everything the menu told the app after it opened. A switch must tell it nothing. */
const menuEvents: string[] = [];
const onMenuOpen = (): void => {
  menuEvents.push('open');
};
const onMenuClose = (): void => {
  menuEvents.push('close');
};
const onMenuSelect = (id: string): void => {
  menuEvents.push(`select:${id}`);
};

function MenuScreen() {
  return (
    <ContextMenu
      testID="theme-context-menu"
      group={MENU_GROUP}
      onOpen={onMenuOpen}
      onClose={onMenuClose}
      onSelect={onMenuSelect}
      hybridRef={captureMenu}
    >
      <View style={{ width: 200, height: 80 }} />
    </ContextMenu>
  );
}

/** The TextField's handle (declared, not imported - D14). */
type FieldHandle = {
  focus(): void;
  blur(): void;
  nuiTestState(): { text: string; focused: boolean };
};
let field: FieldHandle | null = null;
const captureField = (handle: FieldHandle): void => {
  field = handle;
};
const FIELD_TEXT = 'kept through a switch';
/** Everything the field told the app after it took focus. A switch must tell it nothing. */
const fieldEvents: string[] = [];
const onFieldFocus = (): void => {
  fieldEvents.push('focus');
};
const onFieldBlur = (): void => {
  fieldEvents.push('blur');
};
const onFieldChange = (text: string): void => {
  fieldEvents.push(`change:${text}`);
};

function FieldScreen() {
  return (
    <TextField
      testID="theme-field"
      accessibilityLabel="Theme field"
      value={FIELD_TEXT}
      onChangeText={onFieldChange}
      onFocus={onFieldFocus}
      onBlur={onFieldBlur}
      autoCorrect={false}
      autoCapitalize="none"
      hybridRef={captureField}
    />
  );
}

/**
 * Four controls with a composition each (three Switches and a Checkbox), and a Host
 * whose two Switches compose in the Host's: five theme roots, so a root the setting
 * missed would leave its count under the wrong scheme.
 */
const ROOTS = 5;

function Screen() {
  return (
    <>
      <Switch defaultValue testID="theme-switch-a" />
      <Switch defaultValue={false} testID="theme-switch-b" />
      <Switch defaultValue disabled testID="theme-switch-c" />
      <Checkbox defaultChecked label="Theme checkbox" testID="theme-checkbox" />
      <Host style={{ width: 200, height: 96 }}>
        <Switch defaultValue testID="theme-hosted-a" />
        <Switch defaultValue={false} testID="theme-hosted-b" />
      </Host>
    </>
  );
}

const android = Platform.OS === 'android';

describe('MaterialTheme', () => {
  afterEach(async () => {
    await cleanup();
    sheet = null;
    field = null;
    menu = null;
    sheetSetOpen = null;
    // The setting is the process's, and the suites after this one expect the default.
    setMaterialTheme('expressive');
  });

  it('draws every composition with Material 3 Expressive by default', async () => {
    if (!android) return;
    const before = readReport();
    expect(before.setting).toBe('expressive');
    await render(<Screen />);
    const after = await waitForReport(
      (report) => report.expressive - before.expressive >= ROOTS,
      `${String(ROOTS)} roots composing under the Expressive motion scheme`
    );
    await settle();
    const moved = delta(before, readReport());
    console.log(`[theme] default: ${JSON.stringify(moved)} (${after.setting})`);
    expect(moved.baseline).toBe(0);
    expect(moved.other).toBe(0);
  });

  it('opts every composition out to the baseline theme, a Host included', async () => {
    if (!android) return;
    setMaterialTheme('baseline');
    const before = readReport();
    expect(before.setting).toBe('baseline');
    await render(<Screen />);
    await waitForReport(
      (report) => report.baseline - before.baseline >= ROOTS,
      `${String(ROOTS)} roots composing under the standard motion scheme`
    );
    await settle();
    const moved = delta(before, readReport());
    console.log(`[theme] opted out: ${JSON.stringify(moved)}`);
    expect(moved.expressive).toBe(0);
    expect(moved.other).toBe(0);
  });

  it('moves the controls already on screen, both ways', async () => {
    if (!android) return;
    const mounted = readReport();
    await render(<Screen />);
    await waitForReport(
      (report) => report.expressive - mounted.expressive >= ROOTS,
      `${String(ROOTS)} roots composing under the Expressive motion scheme`
    );
    await settle();

    // Out: every live root recomposes under the baseline theme.
    const beforeOut = readReport();
    setMaterialTheme('baseline');
    await waitForReport(
      (report) => report.baseline - beforeOut.baseline >= ROOTS,
      `${String(ROOTS)} mounted roots recomposing under the standard motion scheme`
    );
    await settle();
    const out = delta(beforeOut, readReport());
    console.log(`[theme] live out: ${JSON.stringify(out)}`);
    expect(out.expressive).toBe(0);
    // Recomposed, not rebuilt: no root created its content again.
    expect(out.created).toBe(0);

    // And back: the same roots return to Expressive.
    const beforeBack = readReport();
    setMaterialTheme('expressive');
    await waitForReport(
      (report) => report.expressive - beforeBack.expressive >= ROOTS,
      `${String(ROOTS)} mounted roots recomposing under the Expressive motion scheme`
    );
    await settle();
    const back = delta(beforeBack, readReport());
    console.log(`[theme] live back: ${JSON.stringify(back)}`);
    expect(back.baseline).toBe(0);
    expect(back.other).toBe(0);
    expect(back.created).toBe(0);
  });

  it('keeps a presented sheet up, at its detent, through a switch both ways', async () => {
    if (!android) return;
    sheetEvents.length = 0;
    await render(<SheetScreen />);
    const up = await waitFor(() => {
      const report = sheetReport();
      return report.presented === '1' &&
        report.sheetValue === 'PartiallyExpanded'
        ? report
        : null;
    }, 'the sheet to come up at its medium detent');
    await settle();
    for (const theme of ['baseline', 'expressive'] as const) {
      const before = readReport();
      setMaterialTheme(theme);
      await waitForReport(
        (report) =>
          (theme === 'baseline'
            ? report.baseline - before.baseline
            : report.expressive - before.expressive) >= 1,
        `the sheet's root recomposing for '${theme}'`
      );
      // A presentation ended by a rebuild reports on the next turn; give it several.
      await sleep(1500);
      const after = sheetReport();
      console.log(`[theme] sheet after '${theme}': ${after.raw}`);
      expect(sheetEvents).toEqual([]);
      expect(after.presented).toBe('1');
      expect(after.presentCount).toBe(up.presentCount);
      expect(after.sheetValue).toBe(up.sheetValue);
      expect(after.selected).toBe(up.selected);
      expect(delta(before, readReport()).created).toBe(0);
    }
  });

  it('keeps an open context menu open through a switch both ways', async () => {
    if (!android) return;
    menuEvents.length = 0;
    await render(<MenuScreen />);
    const handle = await waitForHandle(() => menu, {
      what: 'the theme context menu',
    });
    // TalkBack's long-click: the Android path that opens the menu without a hold.
    handle.nuiTestA11yLongClick();
    const opened = await waitFor(() => {
      const report = menuReport(handle);
      return report.open === '1' ? report : null;
    }, 'the context menu to open');
    await settle();
    menuEvents.length = 0;
    for (const theme of ['baseline', 'expressive'] as const) {
      const before = readReport();
      setMaterialTheme(theme);
      await waitForReport(
        (report) =>
          (theme === 'baseline'
            ? report.baseline - before.baseline
            : report.expressive - before.expressive) >= 1,
        `the context menu's root recomposing for '${theme}'`
      );
      await sleep(1000);
      const after = menuReport(handle);
      console.log(`[theme] menu after '${theme}': ${after.raw}`);
      expect(menuEvents).toEqual([]);
      expect(after.open).toBe('1');
      expect(after.opens).toBe(opened.opens);
      expect(after.closes).toBe(opened.closes);
      expect(delta(before, readReport()).created).toBe(0);
    }
    handle.nuiTestSelectRow('first');
    await waitFor(
      () => (menuReport(handle).open === '0' ? true : null),
      'the pick to close the menu'
    );
  });

  it('keeps a focused field focused, with its text, through a switch both ways', async () => {
    if (!android) return;
    fieldEvents.length = 0;
    await render(<FieldScreen />);
    const handle = await waitForHandle(() => field, {
      what: 'the theme field',
    });
    handle.focus();
    await waitFor(
      () => (handle.nuiTestState().focused ? true : null),
      'the field to take focus'
    );
    await settle();
    fieldEvents.length = 0;
    for (const theme of ['baseline', 'expressive'] as const) {
      const before = readReport();
      setMaterialTheme(theme);
      await waitForReport(
        (report) =>
          (theme === 'baseline'
            ? report.baseline - before.baseline
            : report.expressive - before.expressive) >= 1,
        `the field's root recomposing for '${theme}'`
      );
      await sleep(1000);
      const state = handle.nuiTestState();
      console.log(`[theme] field after '${theme}': ${JSON.stringify(state)}`);
      expect(fieldEvents).toEqual([]);
      expect(state.focused).toBe(true);
      expect(state.text).toBe(FIELD_TEXT);
      expect(delta(before, readReport()).created).toBe(0);
    }
    handle.blur();
  });

  it('is a no-op on iOS, with nothing to report', async () => {
    if (android) return;
    expect(nitroUiCore.materialThemeReport()).toBe('');
    setMaterialTheme('baseline');
    setMaterialTheme('expressive');
    expect(nitroUiCore.materialThemeReport()).toBe('');
  });
});

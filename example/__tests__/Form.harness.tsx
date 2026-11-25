import type { ReactElement } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  afterEach,
  cleanup,
  describe,
  expect,
  it,
  render,
} from 'react-native-harness';
import { screen, userEvent } from '@react-native-harness/ui';

import { Form } from '../../src/components/Form/Form';
import { useSelfSizingBaseStyle } from '../../src/core/useSelfSizing';
import { Switch } from '../../src/components/Switch/Switch';
import { pressAimed } from './aimedPress';
import { forgetPromisedHandles, handleOf } from './handles';

const IOS = Platform.OS === 'ios';

type FormHandle = {
  nuiTestFormReport(): string;
  nuiTestScrollTo(y: number): void;
  nuiTestCommand(command: string): void;
};
type SectionHandle = { nuiTestSectionReport(): string };
type RowHandle = {
  nuiTestRowReport(): string;
  nuiTestA11yClick(): void;
};

const forms: Record<string, FormHandle> = {};
const sections: Record<string, SectionHandle> = {};
const rows: Record<string, RowHandle> = {};
const fields: Record<string, { focus(): void } | null> = {};

function parse(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of line.split(';')) {
    const at = pair.indexOf('=');
    if (at > 0) out[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return out;
}

function num(report: Record<string, string>, key: string): number {
  const value = report[key];
  if (value == null)
    throw new Error(`report has no "${key}": ${JSON.stringify(report)}`);
  return Number(value);
}

function raw(report: Record<string, string>, key: string): string {
  return report[key] ?? '<missing>';
}

async function formReport(
  ok: (r: Record<string, string>) => boolean,
  what: string,
  which = 'form'
): Promise<Record<string, string>> {
  const deadline = Date.now() + 12000;
  for (;;) {
    const handle = forms[which];
    if (handle != null) {
      const report = parse(handle.nuiTestFormReport());
      // A first read can still be "pending", which parses to {}, and a predicate that
      // reads a missing field throws.
      try {
        if (ok(report)) return report;
      } catch {
        /* not yet */
      }
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Form report never satisfied "${what}" - last was ${String(
          forms[which]?.nuiTestFormReport()
        )}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function trace(what: string, report: Record<string, string>): void {
  console.log(
    `FORM TRACE ${what}: ` +
      [
        'rows',
        'items',
        'inCells',
        'reparents',
        'reclaims',
        'applies',
        'alive',
        'placed',
        'screen',
        'offset',
        'recycles',
        'insetTop',
        'width',
        'boxW',
        'boxSpan',
        'boxMismatch',
      ]
        .map((key) => `${key}=${report[key] ?? '-'}`)
        .join(';')
  );
}

function need<T>(handle: T | undefined): T {
  if (handle == null)
    throw new Error('expected a hybridRef handle and there is none');
  return handle;
}

// Asserts relative order only: the report's `order=` field is the rows' labels joined.
function expectOrder(
  report: Record<string, string>,
  names: readonly string[]
): void {
  const order = report.order;
  if (order == null) throw new Error('the Form report has no "order=" field');
  const at = names.map((name) => order.indexOf(name));
  const missing = names.filter((_, index) => (at[index] ?? -1) < 0);
  if (missing.length > 0) {
    throw new Error(
      `the Form's order "${order}" does not name ${missing.join(', ')} - every row is named ` +
        'by the words inside it, so a row that answers to nothing is its own finding'
    );
  }
  for (let index = 1; index < names.length; index += 1) {
    const before = at[index - 1];
    const now = at[index];
    if (before == null || now == null || now <= before) {
      throw new Error(
        `the Form holds "${names[index]}" before "${names[index - 1]}" - its order is "${order}"`
      );
    }
  }
}

// The fourth number of `screen=`: how many items the list says it is drawing. It equals
// `inCells` exactly when no cell on screen is blank.
function visibleItems(report: Record<string, string>): number {
  const box = report.screen;
  if (box == null) throw new Error('the Form report has no "screen=" field');
  const value = Number(box.split(',')[3]);
  if (!Number.isFinite(value))
    throw new Error(`"screen=${box}" has no visible-item count`);
  return value;
}

// iOS only: on Android a row never leaves its Yoga box, so there are no cells to wait for.
async function drawnOnScreen(step: string, which = 'form') {
  const report = await formReport(
    (r) => num(r, 'inCells') === visibleItems(r),
    `${step}: every item on screen drawn from a cell (inCells against the ` +
      'visible-item count; the last report below says which of the two moved)',
    which
  );
  trace(`drawn: ${step}`, report);
  return report;
}

async function formRef(): Promise<FormHandle> {
  return handleOf(() => forms.form, 'the Form');
}

// `giveUps` counts the times the list asked for a cell or header whose item the Form had
// already forgotten. iOS only: Android's Form has no cells.
function expectNoGiveUps(report: Record<string, string>, step: string): void {
  if (!IOS) return;
  console.log(
    `FORM GIVE-UPS ${step}: ` +
      [
        'giveUps',
        'rows',
        'items',
        'sections',
        'inCells',
        'claims',
        'wrongCells',
        'losses',
        'applies',
        'alive',
      ]
        .map((key) => `${key}=${report[key] ?? '-'}`)
        .join(';')
  );
  expect(num(report, 'giveUps')).toBe(0);
}

// iOS only. A press is aimed at a row's measured position, so before pressing, every row
// must be drawn by exactly one cell, by the cell its own item names, and laid out at its
// own box: UIKit's hit-test stops at a row's bounds, and a row left in its hidden holding
// view is still measurable but not drawn.
async function formReadyToPress(step: string): Promise<Record<string, string>> {
  return formReport(
    (report) =>
      num(report, 'boxMismatch') <= 0.5 &&
      num(report, 'rowsInCells') === num(report, 'rows') &&
      num(report, 'distinctDrawn') === num(report, 'inCells') &&
      num(report, 'claims') === 0 &&
      num(report, 'wrongCells') === 0,
    `every row drawn by exactly one cell, at its own box (${step}) - the report ` +
      'names rowsInCells, rows, distinctDrawn, inCells, claims, wrongCells and boxMismatch'
  );
}

async function boxOf(
  testId: string
): Promise<Parameters<typeof userEvent.press>[0]> {
  const deadline = Date.now() + 8000;
  for (;;) {
    try {
      return await screen.findByTestId(testId);
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

// `userEvent.press` presses the view its query answered with. While the previous case's
// surface is still on its way out, two live views share a testID and the press could land
// on either.
async function oneLiveViewPer(testIds: readonly string[]): Promise<string> {
  const deadline = Date.now() + 8000;
  for (;;) {
    const seen = testIds.map(
      (id) => `${id}=${screen.queryAllByTestId(id).length}`
    );
    if (seen.every((entry) => entry.endsWith('=1'))) return seen.join(' ');
    if (Date.now() > deadline) {
      throw new Error(
        `a testID does not have exactly one live view: ${seen.join(' ')} - with two copies ` +
          'on screen a press is aimed at whichever one the query answered with, which is the ' +
          'previous case’s surface rather than this one'
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// Shorter than the probe's 646 pt of content, so the list can scroll and recycle cells.
const SHORT_BOX = { maxHeight: 420 } as const;

const LONG_TEXT =
  'Airplane mode turns off every radio at once, including Bluetooth, Wi-Fi and cellular.';

type Mode = 'base' | 'inserted' | 'removed' | 'grown' | 'reordered';

// The first section's row order, per mode. Every row keeps its key, so `reordered` is a
// Fabric move and not a rebuild.
const FIRST_ROWS: Record<Mode, readonly string[]> = {
  base: ['wifi', 'bt', 'cell', 'pressable'],
  inserted: ['wifi', 'bt', 'hotspot', 'cell', 'pressable'],
  removed: ['wifi', 'bt', 'pressable'],
  grown: ['wifi', 'bt', 'cell', 'pressable'],
  reordered: ['cell', 'wifi', 'bt', 'pressable'],
};

function counters() {
  const log = {
    rows: 0,
    pressable: 0,
    switches: 0,
    silent: false,
  };
  return {
    log,
    onRowPress: () => {
      log.rows += 1;
    },
    onPressablePress: () => {
      log.pressable += 1;
    },
    onSwitchChange: (value: boolean) => {
      log.switches += 1;
      log.silent = value;
    },
  };
}

type ProbeProps = ReturnType<typeof counters> & {
  mode: Mode;
  formStyle?: StyleProp<ViewStyle>;
};

// Three sections and nine rows (4 + 3 + 2) in `base`; `inserted` makes ten and `removed`
// eight.
function Probe({
  mode,
  log,
  formStyle,
  onRowPress,
  onPressablePress,
  onSwitchChange,
}: ProbeProps) {
  const firstSectionRows: Record<string, ReactElement> = {
    wifi: (
      <Form.Row
        hybridRef={(view) => {
          if (view != null) rows.wifi = view;
        }}
        key="wifi"
        onPress={onRowPress}
      >
        <Text testID="label-wifi">Wi-Fi</Text>
      </Form.Row>
    ),
    bt: (
      <Form.Row
        accessory="disclosure"
        hybridRef={(view) => {
          if (view != null) rows.bt = view;
        }}
        key="bt"
        onPress={onRowPress}
      >
        <Text testID="label-bt">Bluetooth</Text>
      </Form.Row>
    ),
    hotspot: (
      <Form.Row key="hotspot" onPress={onRowPress}>
        <Text testID="label-hotspot">Personal hotspot</Text>
      </Form.Row>
    ),
    cell: (
      <Form.Row key="cell" onPress={onRowPress}>
        <Text testID="label-cell">Cellular data</Text>
      </Form.Row>
    ),
    pressable: (
      <Form.Row
        hybridRef={(view) => {
          if (view != null) rows.pressable = view;
        }}
        key="pressable"
      >
        <Text style={styles.wrapped}>
          {mode === 'grown' ? `${LONG_TEXT} ${LONG_TEXT}` : 'Ring on receipt'}
        </Text>
        <Pressable
          onPress={onPressablePress}
          testID="inner-press"
          style={styles.pressable}
        >
          <Text>Press me</Text>
        </Pressable>
      </Form.Row>
    ),
  };
  return (
    <Form
      hybridRef={(view) => {
        if (view != null) forms.form = view;
      }}
      style={[styles.form, formStyle]}
    >
      <Form.Section
        footer="These settings apply to this device only."
        hybridRef={(view) => {
          if (view != null) sections.first = view;
        }}
        title="Connectivity"
      >
        {FIRST_ROWS[mode].map((key) => firstSectionRows[key])}
      </Form.Section>
      <Form.Section
        hybridRef={(view) => {
          if (view != null) sections.second = view;
        }}
        title="Sound"
      >
        {(['ringer', 'alert', 'notification'] as const).map((key) => (
          <Form.Row key={key} onPress={onRowPress}>
            <Text testID={`label-${key}`}>{key}</Text>
          </Form.Row>
        ))}
      </Form.Section>
      <Form.Section title="About">
        <Form.Row key="about">
          <Text testID="label-about">nitro-ui 0.4.0</Text>
        </Form.Row>
        <Form.Row
          key="silent"
          hybridRef={(view) => {
            if (view != null) rows.silent = view;
          }}
        >
          <Text testID="label-silent">Silent mode</Text>
          <Switch
            onValueChange={onSwitchChange}
            testID="switch-silent"
            value={log.silent}
          />
        </Form.Row>
      </Form.Section>
    </Form>
  );
}

function Column({ count }: { count: number }) {
  return (
    <ScrollView contentContainerStyle={styles.column}>
      {Array.from({ length: count }, (_, index) => (
        <View key={`c${index}`} style={styles.columnRow}>
          <Text testID={`c${index}`}>Row {index}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function CostForm({ count }: { count: number }) {
  return (
    <Form
      hybridRef={(view) => {
        if (view != null) forms.cost = view;
      }}
      style={styles.form}
    >
      <Form.Section title="Many">
        {Array.from({ length: count }, (_, index) => (
          <Form.Row key={`f${index}`}>
            <Text testID={`f${index}`}>Row {index}</Text>
          </Form.Row>
        ))}
      </Form.Section>
    </Form>
  );
}

const CHURN_PARTS = ['a', 'b', 'c'] as const;

// Several sections: a one-section Form can only lose section index 0, which stays valid
// for as long as any section is left.
function ChurnForm({
  parts,
  perSection,
}: {
  parts: number;
  perSection: number;
}) {
  return (
    <Form
      hybridRef={(view) => {
        if (view != null) forms.churn = view;
      }}
      style={[styles.form, SHORT_BOX]}
    >
      {CHURN_PARTS.slice(0, parts).map((part) => (
        <Form.Section key={part} title={`Section ${part}`}>
          {Array.from({ length: perSection }, (_, index) => (
            <Form.Row key={`${part}${index}`}>
              <Text>
                Row {part}
                {index}
              </Text>
            </Form.Row>
          ))}
        </Form.Section>
      ))}
    </Form>
  );
}

// The Form, or nothing, in one surface: React Native's view pool is per surface, so only a
// remount inside the same surface is handed the views the last mount dropped.
function Churn({
  on,
  parts,
  perSection,
}: {
  on: boolean;
  parts: number;
  perSection: number;
}) {
  return on ? (
    <ChurnForm parts={parts} perSection={perSection} />
  ) : (
    <View testID="churn-off" />
  );
}

function pressNow(): void {
  // Exists only to make a row pressable.
}

function OneRow({
  title,
  label,
  styled,
  rowKey = 'single',
}: {
  title: string | null;
  label: string | null;
  styled: boolean;
  // Swapping the key drops and creates a row in the same surface, which is how React
  // Native's per-surface view pool hands back a recycled view.
  rowKey?: string;
}) {
  return (
    <Form
      hybridRef={(view) => {
        if (view != null) forms.one = view;
      }}
      onLayout={(event) => {
        formBox.height = event.nativeEvent.layout.height;
      }}
      style={styled ? styles.form : undefined}
    >
      <Form.Section
        hybridRef={(view) => {
          if (view != null) sections.one = view;
        }}
        title={title}
      >
        <Form.Row
          key={rowKey}
          accessibilityLabel={label ?? undefined}
          hybridRef={(view) => {
            if (view != null) rows.one = view;
          }}
          onPress={pressNow}
        >
          <Text testID="one-row">One row</Text>
        </Form.Row>
      </Form.Section>
    </Form>
  );
}

const formBox = { height: Number.NaN };

/** Rows tall and many enough that the last of them starts a screen below the viewport. */
const TALL_ROWS = 12;
const TALL_ROW_HEIGHT = 160;

/**
 * The row that holds a focusable field: below a first viewport of any phone this Form runs on,
 * and three rows short of the end, so the scroller has room left below it to move into.
 */
const FOCUSED_ROW = 8;

/** The keyboard height a test command reports to the Form, in dp. */
const REPORTED_IME_DP = 300;

/**
 * The offset a case parks the tall Form at before it asks anything: low enough that the field's
 * box ends well below where a keyboard of `REPORTED_IME_DP` would reach - the harness emulator
 * gives the Form some 910 dp of viewport, and the ninth row's box ends near 800 dp at this
 * offset - and far enough from the end of the content that a reveal has room to move. The
 * offset a case measures from is not 0 either, which is what makes "it did not move" a claim.
 */
const PARK_DP = 700;

const styles = StyleSheet.create({
  form: { flex: 1 },
  wrapped: { flex: 1 },
  pressable: { paddingHorizontal: 8 },
  column: { gap: 8 },
  columnRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center' },
  // No alignment or padding, so a child that fills the row has the row's own box.
  measuringRow: { alignItems: 'stretch', paddingHorizontal: 0 },
  measured: { flex: 1 },
  // A Form with a fixed height inside a padded container: its rows move after their
  // first layout.
  storyOuter: { flex: 1, padding: 16 },
  storyForm: { height: 420 },
  tallRow: { height: TALL_ROW_HEIGHT },
  tallField: { alignSelf: 'stretch' },
});

// The same `Pressable` and `Switch` outside any Form: a positive control for the press
// channel itself.
function Loose({
  onPressablePress,
  onSwitchChange,
}: {
  onPressablePress: () => void;
  onSwitchChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.column}>
      <Pressable
        onPress={onPressablePress}
        style={styles.pressable}
        testID="loose-press"
      >
        <Text>Press me</Text>
      </Pressable>
      <Switch
        onValueChange={onSwitchChange}
        testID="loose-switch"
        value={false}
      />
    </View>
  );
}

function describeBox(box: unknown): string {
  try {
    return JSON.stringify(box);
  } catch {
    return String(box);
  }
}

async function mount(props: ProbeProps) {
  // Forget the previous case's handles first: a handle to a Form that is being torn down
  // still answers reports.
  for (const map of [forms, sections, rows]) {
    for (const key of Object.keys(map)) delete map[key];
  }
  const { rerender } = await render(<Probe {...props} />);
  await formRef();
  await boxOf('label-wifi');
  // `rerender` keeps a case in this surface: a second `render` is a new surface, where
  // every row mounts in document order.
  return Object.assign(props, { rerender });
}

function nth(values: number[], index: number): number {
  const value = values[index];
  if (value == null || !Number.isFinite(value))
    throw new Error(`no item ${index} in [${values.join(', ')}]`);
  return value;
}

// A native report is refreshed on the main thread and read on the JS thread, so the first
// read is often still "pending".
async function reportUntil(
  read: () => string | undefined,
  ok: (r: Record<string, string>) => boolean,
  what: string
): Promise<Record<string, string>> {
  const deadline = Date.now() + 8000;
  for (;;) {
    const line = read();
    if (line != null) {
      const report = parse(line);
      if (ok(report)) return report;
    }
    if (Date.now() > deadline) {
      throw new Error(`never saw "${what}" - last was ${String(read())}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

// Polls a probe until its verdict passes. On timeout the last verdict is returned, not
// thrown, so the caller's assertion can name what is still wrong.
async function until<T>(
  probe: () => Promise<T>,
  ok: (value: T) => boolean,
  timeoutMs: number,
  what: string
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (ok(value)) return value;
    if (Date.now() > deadline) {
      console.log(`S6b MEASURE timed out waiting for ${what}`);
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('Form (G24)', () => {
  afterEach(() => {
    cleanup();
    forgetPromisedHandles();
    // An unmounted view still answers `measureInWindow`, with its size at (0, 0).
    for (const map of [forms, sections, rows, measured]) {
      for (const key of Object.keys(map)) delete map[key];
    }
  });

  it('mounts every row into the list with none stranded (E1)', async () => {
    await mount({ mode: 'base', ...counters() });
    const report = await formReport((r) => num(r, 'rows') === 9, 'nine rows');
    expect(num(report, 'sections')).toBe(3);
    expect(num(report, 'orphans')).toBe(0);
    if (IOS) {
      expect(num(report, 'items')).toBe(9);
      expect(num(report, 'inCells')).toBeGreaterThan(0);
    } else {
      expect(num(report, 'inCells')).toBe(num(report, 'rows'));
      const section = await reportUntil(
        () => sections.first?.nuiTestSectionReport(),
        (r) => r.shapes != null,
        'the first section to count its shapes'
      );
      expect(num(section, 'shapes')).toBe(4);
    }
    const wifi = await reportUntil(
      () => rows.wifi?.nuiTestRowReport(),
      (r) => r.where != null,
      'the Wi-Fi row to say where it is'
    );
    expect(num(wifi, 'h')).toBeGreaterThanOrEqual(IOS ? 43 : 55);
    expect(wifi.where).toBe(IOS ? 'cell' : 'inplace');
    const second = await reportUntil(
      () => sections.second?.nuiTestSectionReport(),
      (r) => r.index != null,
      'the second section to know its index'
    );
    expect(num(second, 'rows')).toBe(3);
    expect(num(second, 'index')).toBe(1);
    if (IOS) expect(num(report, 'stale')).toBe(0);
    expectNoGiveUps(report, 'E1 at rest');
  });

  it('keeps the tree intact through an insert, a removal and 50 scrolls (E1)', async () => {
    const probe = await mount({
      mode: 'base',
      formStyle: SHORT_BOX,
      ...counters(),
    });
    await formReport((r) => num(r, 'rows') === 9, 'nine rows');
    trace('base', parse(need(forms.form).nuiTestFormReport()));

    const { rerender } = probe;

    if (IOS) {
      // The insert must happen after rows have left the holding view for cells: only then
      // can the holding view's subview index differ from the index React used.
      const resting = await formReport(
        (r) => num(r, 'inCells') > 1,
        'rows to be drawn from cells before the insert'
      );
      trace('at rest', resting);
      expect(num(resting, 'inCells')).toBeGreaterThan(1);
      await drawnOnScreen('at rest');
    }

    await rerender(
      <Probe mode="inserted" formStyle={SHORT_BOX} {...counters()} />
    );
    await formReport((r) => num(r, 'rows') === 10, 'ten rows after the insert');
    trace('inserted', parse(need(forms.form).nuiTestFormReport()));
    await boxOf('label-hotspot');
    expect(parse(need(forms.form).nuiTestFormReport()).orphans).toBe('0');

    if (IOS) {
      expectOrder(parse(need(forms.form).nuiTestFormReport()), [
        'Wi-Fi',
        'Bluetooth',
        'Personal hotspot',
        'Cellular data',
      ]);
      await drawnOnScreen('after the insert');
    }

    await rerender(
      <Probe mode="removed" formStyle={SHORT_BOX} {...counters()} />
    );
    await formReport(
      (r) => num(r, 'rows') === 8,
      'eight rows after the removal'
    );
    trace('removed', parse(need(forms.form).nuiTestFormReport()));
    if (IOS) {
      expect(parse(need(forms.form).nuiTestFormReport()).stale).toBe('0');
      await drawnOnScreen('after the removal');
    }

    await rerender(
      <Probe mode="reordered" formStyle={SHORT_BOX} {...counters()} />
    );
    const reordered = await formReport(
      (r) => num(r, 'rows') === 9,
      'nine rows after the reorder'
    );
    trace('reordered', reordered);
    expect(reordered.orphans).toBe('0');
    if (IOS) {
      expectOrder(reordered, [
        'Cellular data',
        'Wi-Fi',
        'Bluetooth',
        'Ring on receipt',
      ]);
      await drawnOnScreen('after the reorder');
    }
    if (!IOS) {
      const section = await reportUntil(
        () => sections.first?.nuiTestSectionReport(),
        (r) => r.shapes != null,
        'the first section to recount its shapes'
      );
      expect(num(section, 'shapes')).toBe(4);
    }

    await rerender(<Probe mode="base" formStyle={SHORT_BOX} {...counters()} />);
    const settled = await formReport(
      (r) => num(r, 'rows') === 9,
      'nine rows again'
    );
    expect(settled.orphans).toBe('0');

    // The leak check is growth across the cycles, not equality with the row count:
    // Fabric's component-view pool can keep alive a row React has thrown away.
    const beforeCycles = parse(need(forms.form).nuiTestFormReport());
    trace('before the cycles', beforeCycles);
    for (let cycle = 0; cycle < 50; cycle += 1) {
      need(forms.form).nuiTestScrollTo(cycle % 2 === 0 ? 400 : 0);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    need(forms.form).nuiTestScrollTo(0);
    const after = parse(need(forms.form).nuiTestFormReport());
    trace('after the cycles', after);
    expect(after.orphans).toBe('0');
    expect(num(after, 'rows')).toBe(9);
    expect(num(after, 'alive')).toBe(num(beforeCycles, 'alive'));
    if (IOS) {
      // The loop above does not wait for each scroll to land, so one more scroll is waited
      // for here to see the list really move.
      need(forms.form).nuiTestScrollTo(400);
      const scrolled = await formReport(
        (r) => num(r, 'offset') > 100,
        'the Form to scroll for the cycles'
      );
      trace('scrolled for the cycles', scrolled);
      expect(num(scrolled, 'offset')).toBeGreaterThan(100);
      await drawnOnScreen('at offset 400');
      // The two counters are not compared with each other: UIKit keeps a cell across a
      // snapshot apply, so a row can be given back and re-adopted without the cell
      // provider running again.
      expect(num(scrolled, 'reparents')).toBeGreaterThan(
        num(after, 'reparents')
      );
      expect(num(scrolled, 'reclaims')).toBeGreaterThan(0);
      need(forms.form).nuiTestScrollTo(0);
      const home = await reportUntil(
        () => rows.wifi?.nuiTestRowReport(),
        (r) => r.where != null,
        'Wi-Fi to say where it lives'
      );
      expect(home.where).toBe('cell');
    }
    expectNoGiveUps(
      parse(need(forms.form).nuiTestFormReport()),
      'E1 after an insert, a removal, a reorder and 50 cycles'
    );
  });

  it('gives a row the height its content needs, before and after it grows (E3)', async () => {
    const probe = await mount({ mode: 'base', ...counters() });
    const settled = await formReport((r) => num(r, 'rows') === 9, 'nine rows');
    const wifi = await reportUntil(
      () => rows.wifi?.nuiTestRowReport(),
      (r) => Number(r.h) > 0,
      'Wi-Fi to have a height'
    );
    const bt = await reportUntil(
      () => rows.bt?.nuiTestRowReport(),
      (r) => Number(r.h) > 0,
      'Bluetooth to have a height'
    );
    const short = await reportUntil(
      () => rows.pressable?.nuiTestRowReport(),
      (r) => Number(r.h) > 0,
      'the wrapped row to have a height'
    );
    const items = (settled.heights ?? '').split(',').map(Number);
    expect(items.length).toBeGreaterThanOrEqual(4);
    // The difference between the list's item height and the row's Yoga height is the
    // cell's own padding, the same for every row. Android has no cell, so it is zero there.
    const chrome = nth(items, 0) - num(wifi, 'h');
    if (IOS) expect(chrome).toBeGreaterThan(0);
    else expect(Math.abs(chrome)).toBeLessThanOrEqual(1);
    expect(Math.abs(nth(items, 1) - num(bt, 'h') - chrome)).toBeLessThanOrEqual(
      1
    );

    await probe.rerender(<Probe {...probe} mode="grown" />);
    const grown = await formReport(
      (r) =>
        Math.abs(Number((r.heights ?? 'x,').split(',')[3]) - nth(items, 3)) > 4,
      'the wrapped row to be taller in the list'
    );
    const grownItems = (grown.heights ?? '').split(',').map(Number);
    expect(Math.abs(nth(grownItems, 0) - nth(items, 0))).toBeLessThanOrEqual(1);
    expect(Math.abs(nth(grownItems, 1) - nth(items, 1))).toBeLessThanOrEqual(1);
    const tall = await reportUntil(
      () => rows.pressable?.nuiTestRowReport(),
      (r) => Number(r.h) > num(short, 'h') + 4,
      'the wrapped row to have grown'
    );
    expect(
      Math.abs(nth(grownItems, 3) - num(tall, 'h') - chrome)
    ).toBeLessThanOrEqual(1);
  });

  it('aims a row content at its Yoga origin and presses it on both platforms (E4)', async () => {
    const probe = await mount({ mode: 'base', ...counters() });
    await formReport((r) => num(r, 'rows') === 9, 'nine rows');
    const pressable = await boxOf('inner-press');
    const toggle = await boxOf('switch-silent');

    console.log(
      `FORM TAP boxes pressable=${describeBox(pressable)} switch=${describeBox(toggle)}`
    );
    if (IOS) {
      await drawnOnScreen('before the presses');
      const geometry = await formReadyToPress('before the presses');
      const live = await oneLiveViewPer(['inner-press', 'switch-silent']);
      // Queried again after the waits: a press is delivered at the centre of the view the
      // query answered with, and a settle moves rows.
      const aim = {
        pressable: await boxOf('inner-press'),
        toggle: await boxOf('switch-silent'),
      };
      console.log(
        `FORM TAP geometry rows=${geometry.rows} rowsInCells=${geometry.rowsInCells} ` +
          `inCells=${geometry.inCells} distinct=${geometry.distinctDrawn} ` +
          `claims=${geometry.claims} wrong=${geometry.wrongCells} ` +
          `losses=${geometry.losses} ` +
          `mismatch=${geometry.boxMismatch} boxSpan=${geometry.boxSpan} ` +
          `width=${geometry.width} boxW=${geometry.boxW} live=${live}`
      );
      expect(Number(geometry.rowsInCells)).toBe(Number(geometry.rows));
      expect(Number(geometry.distinctDrawn)).toBe(Number(geometry.inCells));
      expect(Number(geometry.claims)).toBe(0);
      expect(Number(geometry.wrongCells)).toBe(0);
      // The rows on this screen must not all share one width (an accessory row is
      // narrower), or `boxMismatch` 0 would hold for a single list-wide width.
      expect(Number(geometry.boxSpan)).toBeGreaterThan(0);
      for (let index = 0; index < 10; index += 1) {
        await pressAimed(aim.pressable, 'inner-press');
        await pressAimed(aim.toggle, 'switch-silent');
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(probe.log.pressable).toBe(10);
      expect(probe.log.switches).toBe(10);
      // Read here: the positive control below unmounts this Form.
      expectNoGiveUps(
        parse(need(forms.form).nuiTestFormReport()),
        'E4 after twenty presses into row content'
      );
      const loose = {
        pressable: probe.log.pressable,
        switches: probe.log.switches,
      };
      cleanup();
      render(
        <Loose
          onPressablePress={probe.onPressablePress}
          onSwitchChange={probe.onSwitchChange}
        />
      );
      await oneLiveViewPer(['loose-press', 'loose-switch']);
      await pressAimed(await boxOf('loose-press'), 'loose-press');
      await pressAimed(await boxOf('loose-switch'), 'loose-switch');
      expect(probe.log.pressable - loose.pressable).toBe(1);
      expect(probe.log.switches - loose.switches).toBe(1);
      return;
    }
    for (let index = 0; index < 10; index += 1) {
      await pressAimed(pressable, 'inner-press');
      await pressAimed(toggle, 'switch-silent');
    }
    expect(probe.log.pressable).toBe(10);
    expect(probe.log.switches).toBe(10);
    expect(probe.log.silent).toBe(true);
    expect(parse(need(forms.form).nuiTestFormReport()).orphans).toBe('0');
    expectNoGiveUps(
      parse(need(forms.form).nuiTestFormReport()),
      'E4 after twenty presses into row content'
    );
  });

  it('mounts 20 and 50 rows in one apply and no more views than rows (E6)', async () => {
    for (const count of [20, 50]) {
      const started = Date.now();
      render(<CostForm count={count} />);
      await handleOf(() => forms.cost, 'the cost Form');
      const report = await formReport(
        (r) => num(r, 'rows') === count,
        `${count} rows`,
        'cost'
      );
      const native = Date.now() - started;
      cleanup();
      delete forms.cost;
      const plainStart = Date.now();
      render(<Column count={count} />);
      await boxOf(`c${count - 1}`);
      const plain = Date.now() - plainStart;
      cleanup();

      console.log(
        `FORM COST N=${count} form=${native}ms plain=${plain}ms ${raw(report, 'applies')}`
      );
      expect(num(report, 'orphans')).toBe(0);
      expect(num(report, 'alive')).toBe(count);
      if (IOS) {
        expect(num(report, 'items')).toBe(count);
        // Fewer cells than rows: cells are reused.
        expect(num(report, 'inCells')).toBeLessThan(count);
      }
    }
  });

  it('survives a Form scrolled, reduced and torn down in a loop (X25)', async () => {
    const PER_SECTION = 7;
    const PARTS = CHURN_PARTS.length;
    const SCROLL = 400;
    const CYCLES = 4;

    const settledTo = async (parts: number, step: string) => {
      const want = parts * PER_SECTION;
      const report = await formReport(
        (r) =>
          num(r, 'rows') === want &&
          num(r, 'sections') === parts &&
          (!IOS || num(r, 'items') === want),
        `${step}: ${String(want)} rows in ${String(parts)} sections`,
        'churn'
      );
      if (IOS) await drawnOnScreen(step, 'churn');
      // On every settle: the counter belongs to one mount, and the loop remounts the Form.
      expectNoGiveUps(report, `churn ${step}`);
      return report;
    };

    const surface = await render(
      <Churn on={true} parts={PARTS} perSection={PER_SECTION} />
    );
    const { rerender } = surface;
    for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
      const step = `cycle ${String(cycle)}`;
      const churn = await handleOf(
        () => forms.churn,
        `the churn Form (${step})`
      );
      let report = await settledTo(PARTS, `${step}: mounted`);

      churn.nuiTestScrollTo(SCROLL);
      if (IOS) {
        report = await formReport(
          (r) => Math.abs(num(r, 'offset') - SCROLL) <= 2,
          `${step}: the list to have scrolled ${SCROLL} pt`,
          'churn'
        );
      }

      await rerender(
        <Churn on={true} parts={PARTS - 1} perSection={PER_SECTION} />
      );
      report = await settledTo(PARTS - 1, `${step}: one Section gone`);
      await rerender(
        <Churn on={true} parts={PARTS} perSection={PER_SECTION} />
      );
      report = await settledTo(PARTS, `${step}: the Section back`);

      console.log(
        `FORM CHURN ${step} ` +
          [
            'sections',
            'rows',
            'items',
            'inCells',
            'applies',
            'reparents',
            'reclaims',
            'recycles',
          ]
            .map((key) => `${key}=${report[key] ?? '-'}`)
            .join(';')
      );

      await rerender(
        <Churn on={false} parts={PARTS} perSection={PER_SECTION} />
      );
      delete forms.churn;
      await rerender(
        <Churn on={true} parts={PARTS} perSection={PER_SECTION} />
      );
      await handleOf(() => forms.churn, `the churn Form (${step}, remounted)`);
    }

    const last = await settledTo(PARTS, 'after the loop');
    trace('after the loop', last);
    expect(num(last, 'orphans')).toBe(0);
    if (IOS) expect(num(last, 'stale')).toBe(0);

    // A dropped Form leaves its recycled list holding the old items and headers, and the
    // next mount's layout asks the new Form for them. Mount a titled Section into it.
    surface.unmount();
    for (const map of [forms, sections, rows]) {
      for (const key of Object.keys(map)) delete map[key];
    }
    const next = await render(
      <OneRow label="Named" styled={true} title="Refilled" />
    );
    const refilled = await reportUntil(
      () => sections.one?.nuiTestSectionReport(),
      (r) => Number(r.rows) === 1,
      'the Section that took the churn seat to hold its row'
    );
    expect(Number(refilled.rows)).toBe(1);
    const refilledForm = await formReport(
      (r) => num(r, 'rows') === 1,
      'the Form that took the churn seat to answer for its own row',
      'one'
    );
    expectNoGiveUps(refilledForm, 'churn seat refilled');
    next.unmount();
  });

  it('composes a recycled Section, and drops the band of a gone title', async () => {
    const first = await render(
      <OneRow label="Named" styled={true} title="First" />
    );
    await reportUntil(
      () => sections.one?.nuiTestSectionReport(),
      (r) => Number(r.rows) === 1,
      'the first section to hold its row'
    );
    first.unmount();
    await new Promise((resolve) => setTimeout(resolve, 150));

    for (const map of [forms, sections, rows]) {
      for (const key of Object.keys(map)) delete map[key];
    }
    const again = await render(
      <OneRow label="Named" styled={true} title="Second" />
    );
    const second = await reportUntil(
      () => sections.one?.nuiTestSectionReport(),
      // Android: `layerH` is the Compose layer's measured height and `boxH` the section's
      // own. They are equal when the recycled section composed its layer again.
      (r) =>
        Number(r.rows) === 1 &&
        (IOS || Math.abs(num(r, 'layerH') - num(r, 'boxH')) < 1),
      'the recycled section to draw its layer again'
    );
    if (!IOS) {
      expect(num(second, 'headerBand')).toBeGreaterThan(0);
    }
    if (IOS) {
      expect(second.form).toBe('held');
      // A changed title does not change the snapshot, so UIKit does not run the header
      // provider on its own. `drawnTitle` is what the header is painted with.
      const redrawn = await reportUntil(
        () => sections.one?.nuiTestSectionReport(),
        (r) => r.drawnTitle === 'Second',
        'the recycled band to be painted with the new title'
      );
      expect(redrawn.drawnTitle).toBe('Second');
    }

    await again.rerender(<OneRow label="Named" styled={true} title={null} />);
    if (!IOS) {
      const untitled = await reportUntil(
        () => sections.one?.nuiTestSectionReport(),
        (r) => r.headerBand != null && num(r, 'headerBand') === 0,
        'the gone title to give its band back'
      );
      expect(num(untitled, 'headerBand')).toBe(0);
    }
    if (IOS) {
      await reportUntil(
        () => sections.one?.nuiTestSectionReport(),
        (r) => r.drawnTitle === '',
        'the gone title to come off the band'
      );
    }
  });

  it('presses a row from the accessibility path and names it for its own mount', async () => {
    const { rerender } = await render(
      <OneRow label="Named row" styled={true} title="A" rowKey="labelled" />
    );
    const named = await reportUntil(
      () => rows.one?.nuiTestRowReport(),
      (r) => r.desc != null,
      'the row to carry its label'
    );
    if (!IOS) expect(named.desc).toBe('Named row');

    // A key swap in this surface, not a second `render`: React Native's view pool is per
    // surface, and only a recycled view could carry the previous row's name over.
    await rerender(
      <OneRow label={null} styled={true} title="B" rowKey="plain" />
    );
    const plain = await reportUntil(
      () => rows.one?.nuiTestRowReport(),
      (r) => r.where != null && r.desc != null,
      'the second row to be laid out'
    );
    if (!IOS) {
      expect(num(plain, 'recycles')).toBeGreaterThanOrEqual(1);
      expect(plain.desc).toBe('-');
      // TalkBack presses with `ACTION_CLICK`, never with a touch event.
      const before = num(plain, 'presses');
      need(rows.one).nuiTestA11yClick();
      await reportUntil(
        () => rows.one?.nuiTestRowReport(),
        (r) => num(r, 'presses') === before + 1,
        '`ACTION_CLICK` to reach `onPress`'
      );
    }
  });

  it('has a height when the app gave it no style at all', async () => {
    // Every iOS section is `position: 'absolute'` inside the Form, so nothing in flow gives
    // an unstyled Form a height.
    formBox.height = Number.NaN;
    await render(<OneRow label={null} styled={false} title="Unstyled" />);
    const deadline = Date.now() + 8000;
    for (;;) {
      if (formBox.height > 0) break;
      if (Date.now() > deadline) {
        throw new Error(
          `an unstyled Form measured height ${String(formBox.height)} - it takes no space, so ` +
            'its rows cannot be seen'
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(formBox.height).toBeGreaterThan(0);
  });

  it('reports a settle that no drag announced', async () => {
    render(<MeasureForm />);
    const form = await handleOf(() => forms.measure, 'the measuring Form');
    await formReport(
      (r) => num(r, 'rows') === MEASURE_ROWS,
      `${MEASURE_ROWS} rows`,
      'measure'
    );
    // Wait on state: the list may not have realised its cells by the turn the rows report
    // their count.
    await formReport(
      (r) => num(r, 'inCells') >= 10,
      'ten rows to be drawn from cells',
      'measure'
    );
    if (IOS) {
      const atRest = await formReport(
        (r) => r.origin !== undefined,
        'the Form to have published an offset',
        'measure'
      );
      expect(num(atRest, 'origin')).toBeCloseTo(num(atRest, 'offset'), 0);
      form.nuiTestCommand('scroll-no-report');
      const moved = await formReport(
        (r) => num(r, 'offset') > num(atRest, 'offset') + 20,
        'the list to have scrolled',
        'measure'
      );
      await formReport(
        (r) => Math.abs(num(r, 'origin') - num(moved, 'offset')) < 0.5,
        'the shadow tree to be told the offset the list is at',
        'measure'
      );
    }
  });

  it('starts a recycled Form at the top of its own content', async () => {
    // A `UICollectionView` keeps its `contentOffset` when its view goes back to React
    // Native's pool. The view is only recycled when its surface ends, so this case ends the
    // surface and mounts another.
    await mount({ mode: 'base', formStyle: SHORT_BOX, ...counters() });
    await formReport((r) => num(r, 'rows') === 9, 'nine rows');
    need(forms.form).nuiTestScrollTo(200);
    // iOS reports the list's `contentOffset` as `offset`; Android reports its scroll
    // position as `scroll` and keeps `offset` at 0.
    const offsetField = IOS ? 'offset' : 'scroll';
    const scrolled = await formReport(
      (r) => num(r, offsetField) > 100,
      'the list to have scrolled before the recycle'
    );
    trace('scrolled before the recycle', scrolled);
    {
      // `recycles` counts views that came back out of the pool. Android's report has no
      // such field.
      const recycled = IOS ? num(scrolled, 'recycles') : 0;
      cleanup();
      // The pool gets the view when the surface is really gone, not when React says so.
      await new Promise((resolve) => setTimeout(resolve, 150));
      forgetPromisedHandles();
      for (const map of [forms, sections, rows]) {
        for (const key of Object.keys(map)) delete map[key];
      }
      await render(<Probe mode="base" formStyle={SHORT_BOX} {...counters()} />);
      await formRef();
      await boxOf('label-wifi');
      const next = await formReport(
        (r) =>
          num(r, 'rows') === 9 && (!IOS || num(r, 'recycles') >= recycled + 1),
        'a Form mounted into the list the case above left scrolled (`recycles` to move)'
      );
      trace('the recycled Form', next);
      // The top of the content is at the list's own inset on iOS. Android's scroller has no
      // content inset.
      const top = IOS ? num(next, 'insetTop') : 0;
      if (IOS) expect(top).toBeGreaterThan(0);
      expect(Math.abs(num(next, offsetField) + top)).toBeLessThanOrEqual(1);
    }
  });

  it('publishes a settle for a scroll it started, not a frame', async () => {
    // A scroll UIKit animates for a caller sets none of `isDragging`, `isTracking` or
    // `isDecelerating`.
    await mount({ mode: 'base', formStyle: SHORT_BOX, ...counters() });
    if (!IOS) {
      // Android's scroller is React Native's own `ScrollView`, and its report has no
      // `offsetPublishes` field.
      return;
    }
    const atRest = await formReport(
      (r) => num(r, 'rows') === 9 && num(r, 'offsetPublishes') >= 1,
      'nine rows and a published offset'
    );
    const before = num(atRest, 'offsetPublishes');
    const target = num(atRest, 'offset') + 60;
    need(forms.form).nuiTestCommand('scroll-animated');
    // `setContentOffset` writes the offset before UIKit has drawn a frame of the animation,
    // so the wait is on the publish, not on the offset alone.
    await formReport(
      (r) =>
        Math.abs(num(r, 'offset') - target) <= 1 &&
        num(r, 'offsetPublishes') >= before + 1,
      `the Form to have published the settle at ${String(target)} pt (` +
        `offsetPublishes was ${String(before)})`
    );
    // Longer than the animation, so the count below is of a scroll that is over.
    await new Promise((resolve) => setTimeout(resolve, 600));
    const settled = parse(need(forms.form).nuiTestFormReport());
    const published = num(settled, 'offsetPublishes') - before;
    console.log(
      `FORM ANIMATED SCROLL: publishes=${String(published)} offset=${String(
        atRest.offset
      )} -> ${String(settled.offset)}`
    );
    // One for the settle, and room for the inset change that can come with it.
    expect(published).toBeGreaterThanOrEqual(1);
    expect(published).toBeLessThanOrEqual(2);
  });

  it('grows a row when UIKit is not watching its height constraint (E3, iOS 15)', async () => {
    // `selfSizingInvalidation` is iOS 16 and later. The `self-sizing-off` command switches
    // it off, to exercise the fallback older systems rely on.
    const probe = await mount({ mode: 'base', ...counters() });
    const settled = await formReport((r) => num(r, 'rows') === 9, 'nine rows');
    if (!IOS) return;
    expect(num(settled, 'selfSizing')).toBe(1);
    const items = (settled.heights ?? '').split(',').map(Number);
    const short = await reportUntil(
      () => rows.pressable?.nuiTestRowReport(),
      (r) => Number(r.h) > 0,
      'the wrapped row to have a height'
    );
    need(forms.form).nuiTestCommand('self-sizing-off');
    await formReport(
      (r) => num(r, 'selfSizing') === 0,
      'the list to stop watching row height constraints'
    );

    await probe.rerender(<Probe {...probe} mode="grown" />);
    const grown = await formReport(
      (r) =>
        Math.abs(Number((r.heights ?? 'x,').split(',')[3]) - nth(items, 3)) > 4,
      'the grown row to be taller in the layout with no self-sizing to do it',
      'form'
    );
    const grownItems = (grown.heights ?? '').split(',').map(Number);
    expect(Math.abs(nth(grownItems, 0) - nth(items, 0))).toBeLessThanOrEqual(1);
    expect(Math.abs(nth(grownItems, 1) - nth(items, 1))).toBeLessThanOrEqual(1);
    const tall = await reportUntil(
      () => rows.pressable?.nuiTestRowReport(),
      (r) => Number(r.h) > num(short, 'h') + 4,
      'the wrapped row to have grown'
    );
    const chrome = nth(items, 3) - num(short, 'h');
    expect(
      Math.abs(nth(grownItems, 3) - num(tall, 'h') - chrome)
    ).toBeLessThanOrEqual(1);
  });

  it('leaves the window with the app still running', async () => {
    // UIKit shifts a scroll view's `contentOffset` as it leaves the window, and
    // `scrollViewDidScroll` fires for that shift after the JS callbacks may be gone.
    await mount({ mode: 'base', formStyle: SHORT_BOX, ...counters() });
    const resting = await formReport((r) => num(r, 'rows') === 9, 'nine rows');
    need(forms.form).nuiTestScrollTo(400);
    await formReport(
      // Android has only about 84 dp of travel in this box, so the wait is for 20 dp of
      // movement in whichever field the platform reports.
      (r) =>
        num(r, 'offset') > num(resting, 'offset') + 20 ||
        num(r, 'scroll') > num(resting, 'scroll') + 20,
      'the list to have scrolled before it goes'
    );
    delete forms.one;
    delete rows.one;
    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 250));

    render(<OneRow label="Alive" styled={true} title="After" />);
    const alive = await reportUntil(
      () => rows.one?.nuiTestRowReport(),
      (r) => r.where != null,
      'the app to still answer after a scrolled Form left the window'
    );
    expect(alive.where).toBeDefined();
  });

  it('names the aim when a press is refused (X31)', async () => {
    // Only iOS refuses a press: the Android harness module resolves whatever it injected.
    if (!IOS) return;
    // Mounted 6 000 pt down, so the hit-test at its centre is outside the window.
    render(
      <View
        testID="aimed-off-window"
        style={{
          position: 'absolute',
          left: 40,
          top: 6000,
          width: 120,
          height: 60,
        }}
      >
        <Text>far below the window</Text>
      </View>
    );
    const target = await boxOf('aimed-off-window');
    let message: string | null = null;
    try {
      await pressAimed(target, 'aimed-off-window');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    if (message == null) {
      throw new Error(
        'the off-window press was accepted, so there was no rejection to grade — the aim is ' +
          'named only on the branch that refuses'
      );
    }
    console.log(`FORM AIM refusal message: ${message}`);
    expect(message).toContain('aimed-off-window');
    expect(message).toContain('nativeId=');
    // The fixture's centre is (100, 6030), plus wherever the root view sits under the
    // status bar.
    const centre = message.match(
      /centre is \((-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?)\)/u
    );
    expect(centre).not.toBeNull();
    expect(Number(centre?.[1])).toBeGreaterThanOrEqual(99);
    expect(Number(centre?.[1])).toBeLessThanOrEqual(101);
    expect(Number(centre?.[2])).toBeGreaterThanOrEqual(6000);
    expect(Number(centre?.[2])).toBeLessThanOrEqual(6100);
    expect(message).toContain('No view found at point');
  });
});

// MARK: - Does `measure` say where the row is, or where the Form is?

// Enough rows that the list scrolls on any phone.
const MEASURE_ROWS = 24;

// Each comparison is two round trips, and the case has a 30 s budget.
const COMPARE_LIMIT = 14;

const measured: Record<
  string,
  {
    measureInWindow: (
      callback: (x: number, y: number, width: number, height: number) => void
    ) => void;
  }
> = {};

function MeasureForm() {
  return (
    <Form
      hybridRef={(view) => {
        if (view != null) forms.measure = view;
      }}
      style={styles.form}
    >
      <Form.Section title="Twenty-four">
        {Array.from({ length: MEASURE_ROWS }, (_, index) => (
          <Form.Row
            hybridRef={(view) => (rows[`m${index}`] = view)}
            key={`m${index}`}
            style={styles.measuringRow}
          >
            <View
              ref={(handle) => {
                if (handle != null) measured[`m${index}`] = handle as never;
              }}
              style={styles.measured}
              testID={`m${index}`}
            >
              <Text>Row {index}</Text>
            </View>
          </Form.Row>
        ))}
      </Form.Section>
    </Form>
  );
}

function measureInWindow(
  testId: string
): Promise<[number, number, number, number]> {
  const handle = measured[testId];
  if (handle == null)
    throw new Error(`no measured view registered for "${testId}"`);
  return new Promise((resolve) => {
    handle.measureInWindow((x, y, width, height) =>
      resolve([x, y, width, height])
    );
  });
}

function windowOf(
  report: Record<string, string>
): [number, number, number, number] | null {
  const box = report.window;
  if (box == null || box === '-') return null;
  const parts = box.split(',').map(Number);
  return parts.length === 4 && parts.every(Number.isFinite)
    ? (parts as [number, number, number, number])
    : null;
}

// Asks the shadow tree and the native view where every row in a cell is, and returns what
// disagrees. Rows without a cell have no view position to read and are skipped.
//
// `scrolledBy` is 0 on both platforms. Android's scroller is an RN `ScrollView`, whose
// shadow node already subtracts its content offset in `measureInWindow`. A
// `UICollectionView` is not a shadow node, so on iOS the Form writes each cell's resting
// place into the row's own layout position.
async function compareRows(
  what: string,
  scrolledBy: number
): Promise<{ compared: number; bad: string[] }> {
  let compared = 0;
  const bad: string[] = [];
  for (
    let index = 0;
    index < MEASURE_ROWS && compared < COMPARE_LIMIT;
    index += 1
  ) {
    const id = `m${index}`;
    const report = await reportUntil(
      () => rows[id]?.nuiTestRowReport(),
      (r) =>
        windowOf(r) != null || r.where === 'holding' || r.where === 'detached',
      `${id} to have a window or be off screen`
    );
    const native = windowOf(report);
    if (native == null) continue;
    const measured2 = await measureInWindow(id);
    compared += 1;
    const expectY = measured2[1] - scrolledBy;
    const off = Math.max(
      Math.abs(measured2[0] - native[0]),
      Math.abs(expectY - native[1])
    );
    if (off > 1) {
      bad.push(
        `${id}: measureInWindow ${measured2.map(round1).join(',')} (-scroll ` +
          `${round1(scrolledBy)} = ${round1(expectY)}) vs UIKit ` +
          `${native.map(round1).join(',')} (off by ${round1(off)} pt)`
      );
    }
  }
  const geometry = need(forms.measure).nuiTestFormReport();
  console.log(
    `S6b MEASURE ${what}: compared=${compared} scroll=${round1(scrolledBy)} ` +
      `mismatched=${bad.length} geometry{${[
        'offset',
        'origin',
        'received',
        'listY',
        'insetTop',
      ]
        .map((key) => `${key}=${raw(parse(geometry), key)}`)
        .join(',')}}` +
      (bad.length > 0 ? ` - ${bad.join(' | ')}` : '')
  );
  return { compared, bad };
}

// Android only. A read straight after `nuiTestScrollTo` can still answer with the offset
// from before it, so this waits for an offset that has passed `minimum` and stopped moving.
async function formScrollY(minimum: number): Promise<number> {
  const deadline = Date.now() + 12000;
  let previous = Number.NaN;
  for (;;) {
    const report = await formReport(
      (r) => r.scroll !== undefined,
      'the Form to report its scroll offset',
      'measure'
    );
    const scroll = num(report, 'scroll');
    if (scroll === previous && scroll >= minimum) return scroll;
    previous = scroll;
    if (Date.now() > deadline) {
      throw new Error(
        `the Form's scroll offset never settled past ${String(minimum)} dp - last reads ` +
          `were ${String(previous)}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function round1(value: number): string {
  return value.toFixed(1);
}

describe('Form measure (E7)', () => {
  afterEach(() => {
    cleanup();
    for (const key of Object.keys(measured)) delete measured[key];
  });

  it('measures a row as the row, before and after a scroll (E7)', async () => {
    await render(<MeasureForm />);
    const form = await handleOf(() => forms.measure, 'the measuring Form');
    await formReport(
      (r) => num(r, 'rows') === MEASURE_ROWS,
      `${MEASURE_ROWS} rows`,
      'measure'
    );
    const registered = await until(
      async () => Object.keys(measured).length,
      (n) => n >= MEASURE_ROWS,
      8000,
      `${MEASURE_ROWS} measured views to be registered`
    );
    expect(registered).toBe(MEASURE_ROWS);

    // Polled: frames arrive per view, and the section is laid out again once its header
    // has been measured.
    const atRest = await until(
      () => compareRows('at rest', 0),
      (r) => r.bad.length === 0 && r.compared >= 10,
      12000,
      'every row to measure where its own tree put it'
    );
    expect(atRest.bad).toEqual([]);
    expect(atRest.compared).toBeGreaterThanOrEqual(10);

    const height = 180;
    form.nuiTestScrollTo(height);
    // Confirm the list really moved, or the comparison below passes on the at-rest
    // readings.
    if (IOS) {
      await formReport(
        (r) => Math.abs(num(r, 'offset') - height) <= 2,
        `the list to have scrolled to ${height} pt`,
        'measure'
      );
    } else {
      expect(
        Math.abs((await formScrollY(height / 2)) - height)
      ).toBeLessThanOrEqual(2);
    }
    const scrolledBy = 0;
    const scrolled = await until(
      () => compareRows(`after ${height} pt`, scrolledBy),
      (r) => r.bad.length === 0 && r.compared >= 10,
      12000,
      'every row in a cell to measure where UIKit put it'
    );
    expect(scrolled.bad).toEqual([]);
    expect(scrolled.compared).toBeGreaterThanOrEqual(10);
    cleanup();
  });
});

// MARK: - Does a row's content reach the row's trailing edge, level with its label?

// `[left, top, width, height]`, in pt on iOS and dp on Android.
type WindowBox = [number, number, number, number];

type Measurable = {
  measureInWindow: (
    callback: (x: number, y: number, width: number, height: number) => void
  ) => void;
};

// Each measured box is a plain `View` wrapping a control: a library control takes no
// `ref`, and only a view React Native lays out answers `measureInWindow`.
const contentBoxes: Record<string, Measurable> = {};

function keepBox(key: string): (handle: Measurable | null) => void {
  return (handle) => {
    if (handle != null) contentBoxes[key] = handle as never;
  };
}

async function readBox(key: string): Promise<WindowBox | null> {
  const handle = contentBoxes[key];
  if (handle == null) throw new Error(`no box registered for "${key}"`);
  const box = await new Promise<WindowBox>((resolve) => {
    handle.measureInWindow((x, y, width, height) =>
      resolve([x, y, width, height])
    );
  });
  return box[2] > 0 && box[3] > 0 ? box : null;
}

// Settled means two reads in a row agree on the probe row's width: on iOS a row starts
// at `width: '100%'` and then narrows to the width its cell reports.
async function settledBoxes<const K extends readonly string[]>(
  keys: K
): Promise<Record<K[number], WindowBox>> {
  let previous: number | null = null;
  const deadline = Date.now() + 15000;
  for (;;) {
    const boxes: Record<string, WindowBox> = {};
    for (const key of keys) {
      const box = await readBox(key);
      if (box != null) boxes[key] = box;
    }
    const width = boxes.probe?.[2];
    if (width != null && width > 100 && width === previous) {
      return boxes as Record<K[number], WindowBox>;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `the row content never settled: ${keys
          .map((key) => `${key}=${JSON.stringify(boxes[key] ?? null)}`)
          .join(' ')}`
      );
    }
    previous = width ?? null;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const x24Fill = { flex: 1 } as const;

// A measurable stand-in for a self-sizing control: a `View` carrying the same base style
// the real controls read from `useSelfSizingBaseStyle`.
function SelfSizingProbe({
  boxKey,
  children,
}: {
  boxKey: string;
  children?: ReactElement;
}) {
  return (
    <View ref={keepBox(boxKey)} style={useSelfSizingBaseStyle()}>
      {children}
    </View>
  );
}

const x24Box = {
  alignItems: 'center',
  flex: 1,
  flexDirection: 'row',
} as const;

const x24Styles = StyleSheet.create({
  form: { flex: 1 },
  label: { flex: 1 },
  text: { fontSize: 16 },
});

// Row one is a probe whose single `flex: 1` child has the row's content box. Row two is a
// label and a switch as direct children of the row. Row three is that pair inside a box
// of the app's own.
function TrailingEdgeForm() {
  return (
    <Form style={x24Styles.form}>
      <Form.Section title="Notifications">
        <Form.Row>
          <View ref={keepBox('probe')} style={x24Fill} testID="x24-probe">
            <Text style={x24Styles.text}>Notifications</Text>
          </View>
        </Form.Row>
        <Form.Row>
          <View ref={keepBox('label')} style={x24Styles.label}>
            <Text style={x24Styles.text}>Push notifications</Text>
          </View>
          <SelfSizingProbe boxKey="control">
            <Switch testID="x24-switch" value />
          </SelfSizingProbe>
        </Form.Row>
        <Form.Row>
          <View style={x24Box}>
            <View ref={keepBox('boxedLabel')} style={x24Styles.label}>
              <Text style={x24Styles.text}>Play a sound</Text>
            </View>
            <SelfSizingProbe boxKey="boxedControl">
              <Switch testID="x24-boxed-switch" value={false} />
            </SelfSizingProbe>
          </View>
        </Form.Row>
      </Form.Section>
    </Form>
  );
}

describe('Form row content (X24)', () => {
  afterEach(() => {
    cleanup();
    // An unmounted view still answers `measureInWindow`, with its size at (0, 0).
    for (const key of Object.keys(contentBoxes)) delete contentBoxes[key];
  });

  it('lays a row’s content across the row and level with its label (X24)', async () => {
    await render(<TrailingEdgeForm />);
    await screen.findByTestId('x24-switch');
    const { probe, label, control, boxedLabel, boxedControl } =
      await settledBoxes([
        'probe',
        'label',
        'control',
        'boxedLabel',
        'boxedControl',
      ] as const);
    const right = (box: WindowBox): number => box[0] + box[2];
    const centre = (box: WindowBox): number => box[1] + box[3] / 2;
    const issues: string[] = [];
    const pairs: Record<string, { label: WindowBox; control: WindowBox }> = {
      'a bare row': { label, control },
      'a boxed row': { label: boxedLabel, control: boxedControl },
    };
    for (const [name, pair] of Object.entries(pairs)) {
      if (Math.abs(pair.label[0] - probe[0]) > 1) {
        issues.push(
          `${name}: the label starts at x=${pair.label[0].toFixed(1)} while the row's content starts at x=${probe[0].toFixed(1)}`
        );
      }
      if (Math.abs(right(pair.control) - right(probe)) > 1) {
        issues.push(
          `${name}: the control ends at x=${right(pair.control).toFixed(1)} while the row's content ends at x=${right(probe).toFixed(1)}`
        );
      }
      // A child's `alignSelf` beats the row's `alignItems`, so a self-sizing control's
      // base style must be `center` inside a row for it to sit level with its label.
      if (Math.abs(centre(pair.control) - centre(pair.label)) > 1) {
        issues.push(
          `${name}: the control is centred at y=${centre(pair.control).toFixed(1)} while its label is centred at y=${centre(pair.label).toFixed(1)}`
        );
      }
    }
    const delta = (pair: { label: WindowBox; control: WindowBox }): string =>
      (centre(pair.control) - centre(pair.label)).toFixed(1);
    console.log(
      `X24 BARE pair: row content x=${probe[0].toFixed(1)}..${right(probe).toFixed(1)}, ` +
        `control x=${control[0].toFixed(1)}..${right(control).toFixed(1)}, centre delta ` +
        `${delta({ label, control })}`
    );
    console.log(
      `X24 BOXED pair: control x=${boxedControl[0].toFixed(1)}..${right(boxedControl).toFixed(1)}, ` +
        `centre delta ${delta({ label: boxedLabel, control: boxedControl })}`
    );
    expect(issues).toEqual([]);
  });
});

// MARK: - The box a row is told, and who is told about it

// A Form in a box whose width the case changes. Twelve rows in a 420 pt box leave the two
// deep rows (10 and 12) off screen at rest. Row 2 has an accessory and stays on screen,
// so the Form can learn what an accessory costs at the new width.
function SizedForm({ boxWidth }: { boxWidth: number }) {
  return (
    <View style={{ height: 420, width: boxWidth }} testID="resize-host">
      <Form
        hybridRef={(view) => {
          if (view != null) forms.resize = view;
        }}
        style={styles.form}
      >
        <Form.Section title="Rows">
          {Array.from({ length: 12 }, (_, index) => (
            <Form.Row
              accessory={index === 1 || index === 11 ? 'disclosure' : 'none'}
              hybridRef={
                index === 9
                  ? (view) => {
                      if (view != null) rows.resizePlain = view;
                    }
                  : index === 11
                    ? (view) => {
                        if (view != null) rows.resizeAccessory = view;
                      }
                    : undefined
              }
              key={`resize-${index}`}
            >
              <Text testID={`resize-label-${index}`}>Row {index + 1}</Text>
            </Form.Row>
          ))}
        </Form.Section>
      </Form>
    </View>
  );
}

function AccessoryForm({ accessoried }: { accessoried: boolean }) {
  return (
    <Form
      hybridRef={(view) => {
        if (view != null) forms.toggle = view;
      }}
      style={styles.form}
    >
      <Form.Section title="Sound">
        <Form.Row>
          <Text testID="toggle-label-steady">Ringer</Text>
        </Form.Row>
        <Form.Row
          accessory={accessoried ? 'disclosure' : 'none'}
          hybridRef={(view) => {
            if (view != null) rows.toggled = view;
          }}
        >
          <Text testID="toggle-label-target">Alerts</Text>
        </Form.Row>
        <Form.Row>
          <Text testID="toggle-label-third">Notifications</Text>
        </Form.Row>
      </Form.Section>
    </Form>
  );
}

describe('Form row boxes (X29 r2)', () => {
  afterEach(() => {
    cleanup();
    forgetPromisedHandles();
    for (const map of [forms, sections, rows]) {
      for (const key of Object.keys(map)) delete map[key];
    }
  });

  it('hands no row back as a loss across 400 pt scrolls (X29 r2, item 1)', async () => {
    // iOS only: Android has no cells.
    if (!IOS) return;
    await mount({ mode: 'base', formStyle: SHORT_BOX, ...counters() });
    await formReport((r) => num(r, 'rows') === 9, 'nine rows');

    // Each scroll waits for the offset to move relative to where it was: `nuiTestScrollTo`
    // is clamped to the content, and a list at rest sits at its own top inset.
    let rest = await formReport(() => true, 'the report at rest');
    const cycle = async (step: string): Promise<void> => {
      const at = num(rest, 'offset');
      need(forms.form).nuiTestScrollTo(400);
      const down = await formReport(
        (r) => num(r, 'offset') > at + 20,
        `${step}: the list to have scrolled down from ${at} pt`
      );
      await drawnOnScreen(`${step} down`);
      need(forms.form).nuiTestScrollTo(0);
      rest = await formReport(
        (r) => num(r, 'offset') < num(down, 'offset') - 20,
        `${step}: the list to have come back up from ${down.offset} pt`
      );
      await drawnOnScreen(`${step} back up`);
    };
    // Warm up first, so the baseline is read from a list that has already recycled.
    await cycle('warm-up 1');
    await cycle('warm-up 2');
    const lossesAtRest = num(rest, 'losses');

    for (const step of ['1', '2', '3', '4']) {
      await cycle(`cycle ${step}`);
    }
    const after = await formReport(() => true, 'the report after four scrolls');
    expect(num(after, 'claims')).toBe(0);
    expect(num(after, 'wrongCells')).toBe(0);
    // A cell handing its own row back while it scrolls off is not a lost row.
    expect(num(after, 'losses') - lossesAtRest).toBe(0);
  });

  it('re-lays a row that is off screen at the Form’s new width (X29 r2, item 2)', async () => {
    // iOS only: Android lays every row out at the width the list gives it.
    if (!IOS) return;
    const { rerender } = await render(<SizedForm boxWidth={400} />);
    await handleOf(() => forms.resize, 'the resizable Form');
    const wide = await formReport(
      (r) =>
        num(r, 'rows') === 12 &&
        num(r, 'width') > 100 &&
        num(r, 'boxMismatch') <= 0.5 &&
        num(r, 'inCells') === visibleItems(r),
      'the wide Form to draw every visible row at its own box',
      'resize'
    );
    const wideWidth = num(wide, 'width');
    const restingOffset = num(wide, 'offset');

    // Scroll the deep rows into view so their own cells tell them their box, and wait
    // until every row on screen is at its cell's box: a pooled row view keeps the width of
    // its previous use until the new one arrives.
    need(forms.resize).nuiTestScrollTo(400);
    const shown = await formReport(
      (r) =>
        num(r, 'offset') > restingOffset + 60 &&
        num(r, 'boxMismatch') <= 0.5 &&
        num(r, 'inCells') === visibleItems(r),
      'the list to have scrolled to the deep rows, each drawn by its own cell at its own box',
      'resize'
    );
    // What an accessory costs, as the Form measured it from its own cells.
    const wideInset = num(shown, 'accessoryInset');
    expect(wideInset).toBeGreaterThan(4);
    await reportUntil(
      () => rows.resizePlain?.nuiTestRowReport(),
      (r) => r.where === 'cell' && Math.abs(Number(r.laid) - wideWidth) <= 0.5,
      `the deep plain row to be drawn in a cell at the Form’s ${wideWidth} pt box`
    );
    await reportUntil(
      () => rows.resizeAccessory?.nuiTestRowReport(),
      (r) =>
        r.where === 'cell' &&
        Math.abs(Number(r.laid) - (wideWidth - wideInset)) <= 0.5,
      `the deep accessory row to be drawn in a cell at ${wideWidth} - ${wideInset} pt`
    );

    // Scroll them back off screen, into the section's holding view.
    need(forms.resize).nuiTestScrollTo(0);
    await formReport(
      (r) => num(r, 'offset') < num(shown, 'offset') - 60,
      'the list to be back at the top again',
      'resize'
    );
    for (const [name, handle, remembered] of [
      ['plain', rows.resizePlain, wideWidth],
      ['accessory', rows.resizeAccessory, wideWidth - wideInset],
    ] as const) {
      const parked = await reportUntil(
        () => handle?.nuiTestRowReport(),
        (r) => r.where === 'holding',
        `the deep ${name} row to be off screen again`
      );
      expect(Math.abs(Number(parked.laid) - remembered)).toBeLessThanOrEqual(
        0.5
      );
    }

    // A parent's width changes, as it does on rotation.
    await rerender(<SizedForm boxWidth={320} />);
    const narrow = await formReport(
      (r) =>
        num(r, 'width') > 100 &&
        wideWidth - num(r, 'width') > 20 &&
        num(r, 'boxMismatch') <= 0.5 &&
        num(r, 'inCells') === visibleItems(r),
      'the Form to publish a new, narrower box for the rows it can see',
      'resize'
    );
    const narrowWidth = num(narrow, 'width');
    const narrowInset = num(narrow, 'accessoryInset');
    expect(narrowInset).toBeGreaterThan(4);
    const expectedAccessory = narrowWidth - narrowInset;

    // Neither deep row was in a cell for that layout pass, so only the Form can tell them
    // their new width.
    const plainRelaid = await reportUntil(
      () => rows.resizePlain?.nuiTestRowReport(),
      (r) => Math.abs(Number(r.laid) - narrowWidth) <= 0.5,
      `the parked plain row to be laid out at the new ${narrowWidth} pt box (where it ` +
        'is parked, at what the Form publishes now)'
    );
    expect(plainRelaid.where).toBe('holding');
    const accessoryRelaid = await reportUntil(
      () => rows.resizeAccessory?.nuiTestRowReport(),
      (r) => Math.abs(Number(r.laid) - expectedAccessory) <= 0.5,
      `the parked accessory row to be laid out at ${narrowWidth} - ${narrowInset} = ` +
        `${expectedAccessory} pt`
    );
    expect(accessoryRelaid.where).toBe('holding');

    // An accessory costs the cell's own margins, which do not change with the width.
    expect(Math.abs(narrowInset - wideInset)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(num(narrow, 'plainBox') - narrowWidth)).toBeLessThanOrEqual(
      0.5
    );
  });

  it('moves no row of the list when one row gains an accessory (X29 r2, items 3 and 5)', async () => {
    // iOS only: on Android the row reserves the accessory's room with padding, so every
    // row has the same box.
    if (!IOS) return;
    const { rerender } = await render(<AccessoryForm accessoried={false} />);
    await handleOf(() => forms.toggle, 'the accessory Form');
    const before = await formReport(
      (r) =>
        num(r, 'rows') === 3 &&
        num(r, 'width') > 100 &&
        num(r, 'boxMismatch') <= 0.5 &&
        num(r, 'inCells') === visibleItems(r),
      'the all-plain Form to settle',
      'toggle'
    );
    const plainBox = num(before, 'plainBox');
    const published = num(before, 'widthPublishes');
    expect(Math.abs(num(before, 'width') - plainBox)).toBeLessThanOrEqual(0.5);
    expect(num(before, 'boxSpan')).toBeLessThanOrEqual(0.5);

    await rerender(<AccessoryForm accessoried={true} />);
    const after = await formReport(
      (r) =>
        num(r, 'boxMismatch') <= 0.5 &&
        num(r, 'boxSpan') > 4 &&
        num(r, 'inCells') === visibleItems(r),
      'the toggled row to be laid out at its own narrower box, and its neighbours at theirs',
      'toggle'
    );
    const inset = num(after, 'accessoryInset');
    expect(inset).toBeGreaterThan(4);
    expect(Math.abs(inset - num(after, 'boxSpan'))).toBeLessThanOrEqual(0.5);
    const toggled = await reportUntil(
      () => rows.toggled?.nuiTestRowReport(),
      (r) =>
        r.where === 'cell' &&
        Math.abs(Number(r.laid) - (plainBox - inset)) <= 0.5,
      `the toggled row to be laid out at ${plainBox} - ${inset} = ${plainBox - inset} pt`
    );
    expect(toggled.where).toBe('cell');

    // The list-wide width is the plain box and is not published again: every publish
    // re-renders every Section and row.
    expect(num(after, 'widthPublishes')).toBe(published);
    expect(Math.abs(num(after, 'width') - plainBox)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(num(after, 'plainBox') - plainBox)).toBeLessThanOrEqual(
      0.5
    );
  });
});

// Android only from here: the section draws its headers, footers and row containers in a
// Compose layer beneath the rows. iOS draws rows through UIKit cells and has no such layer.

// `left,top,width,height` in dp.
type PlacedBox = [number, number, number, number];

function placedBox(field: string | undefined): PlacedBox {
  const parts = (field ?? '').split(',').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`"${String(field)}" is not a left,top,width,height box`);
  }
  return [
    parts[0] as number,
    parts[1] as number,
    parts[2] as number,
    parts[3] as number,
  ];
}

async function sectionReport(
  which: string,
  ok: (r: Record<string, string>) => boolean = () => true
): Promise<Record<string, string>> {
  const deadline = Date.now() + 12000;
  for (;;) {
    try {
      const report = parse(need(sections[which]).nuiTestSectionReport());
      if (ok(report)) return report;
    } catch {
      /* not yet: a first read is often "pending", which parses to {} */
    }
    if (Date.now() > deadline) {
      throw new Error(
        `the "${which}" section report never satisfied its condition - last was ` +
          `${String(sections[which]?.nuiTestSectionReport() ?? '<no handle>')}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

// A disclosure accessory sits inside the row's trailing edge, level with its middle.
function accessoryIssues(accessory: PlacedBox, rowBox: PlacedBox): string[] {
  const issues: string[] = [];
  const centre = (b: PlacedBox) => b[1] + b[3] / 2;
  const rowRight = rowBox[0] + rowBox[2];
  if (accessory[0] < rowBox[0] - 1) {
    issues.push(
      `the accessory starts at x=${accessory[0]} dp, left of its row at x=${rowBox[0]} dp`
    );
  }
  if (accessory[0] + accessory[2] > rowRight + 1) {
    issues.push(
      `the accessory ends at x=${(accessory[0] + accessory[2]).toFixed(1)} dp, past its ` +
        `row's trailing edge at x=${rowRight.toFixed(1)} dp`
    );
  }
  if (Math.abs(centre(accessory) - centre(rowBox)) > 1) {
    issues.push(
      `the accessory is centred at y=${centre(accessory).toFixed(1)} dp while its row is ` +
        `centred at y=${centre(rowBox).toFixed(1)} dp`
    );
  }
  return issues;
}

function SettingsForm() {
  return (
    <Form
      hybridRef={(view) => {
        if (view != null) forms.drawing = view;
      }}
      style={styles.form}
    >
      <Form.Section
        footer="These settings apply to this device only."
        hybridRef={(view) => {
          if (view != null) sections.first = view;
        }}
        title="Connectivity"
      >
        <Form.Row>
          <Text>Wi-Fi</Text>
        </Form.Row>
        <Form.Row>
          <Text>Bluetooth</Text>
        </Form.Row>
        <Form.Row>
          <Text>Cellular data</Text>
        </Form.Row>
        <Form.Row>
          <Text>Ring on receipt</Text>
        </Form.Row>
      </Form.Section>
      <Form.Section title="Sound">
        <Form.Row>
          <Text>ringer</Text>
        </Form.Row>
        <Form.Row>
          <Text>alert</Text>
        </Form.Row>
        <Form.Row>
          <Text>notification</Text>
        </Form.Row>
      </Form.Section>
      <Form.Section title="About">
        <Form.Row>
          <Text>nitro-ui 0.4.0</Text>
        </Form.Row>
      </Form.Section>
    </Form>
  );
}

// A Form with a fixed height in a padded container. A section learns its header and footer
// heights from a round trip through JavaScript, so here the rows move after their first
// layout.
function StoryForm() {
  return (
    <View style={styles.storyOuter}>
      <Form style={styles.storyForm}>
        <Form.Section
          footer="Push arrives on this device only."
          hybridRef={(view) => {
            if (view != null) sections.story = view;
          }}
          title="Notifications"
        >
          <Form.Row
            accessory="disclosure"
            hybridRef={(view) => {
              if (view != null) rows.storyFirst = view;
            }}
          >
            <Text>Push notifications</Text>
          </Form.Row>
          <Form.Row
            hybridRef={(view) => {
              if (view != null) rows.storySecond = view;
            }}
          >
            <Text>Play a sound</Text>
          </Form.Row>
        </Form.Section>
      </Form>
    </View>
  );
}

describe('Form section drawing (E2, Android)', () => {
  afterEach(() => {
    cleanup();
    for (const map of [forms, sections, rows]) {
      for (const key of Object.keys(map)) delete map[key];
    }
  });

  it('reserves a band with its padding and draws into a layer as tall as its section (E2)', async () => {
    if (IOS) return;
    await render(<SettingsForm />);
    await formReport(
      (r) => num(r, 'rows') === 8,
      'the settings Form list',
      'drawing'
    );

    // The header and footer are Compose text in a layer under the rows, so the rows cover
    // whatever Yoga did not reserve. The reserved height must be the text plus its padding.
    const bands = await sectionReport('first', (r) => {
      // Both read 0 until the section's measurement has come back.
      const header = num(r, 'headerBand');
      const footer = num(r, 'footerBand');
      return header > 0 && footer > 0;
    });
    console.log(`FORM BANDS first section ${JSON.stringify(bands)}`);
    const padding = (band: string, text: string) =>
      num(bands, band) - num(bands, text);
    expect(padding('headerBand', 'headerText')).toBeGreaterThanOrEqual(8);
    expect(padding('footerBand', 'footerText')).toBeGreaterThanOrEqual(4);

    // How far the row shapes the layer drew are from the boxes it was handed. Both are read
    // from the section, but one is what a layout pass did and the other is what it was told.
    function shapeLag(report: Record<string, string>): string {
      const told = (report.cardBoxes ?? '-')
        .split('|')
        .filter((box) => box.includes(','));
      if (told.length === 0) return 'the layer was handed no row boxes';
      const drawn = new Map<number, string>();
      for (const entry of (report.drawnCards ?? '-').split('|')) {
        const at = entry.indexOf(':');
        if (at > 0) drawn.set(Number(entry.slice(0, at)), entry.slice(at + 1));
      }
      for (let row = 0; row < told.length; row++) {
        const placed = drawn.get(row);
        if (placed === undefined) return `row ${row} has no drawn shape`;
        const want = (told[row] ?? '').split(',').map(Number);
        const got = placed.split(',').map(Number);
        const outBy = Math.max(
          ...want.map((edge, field) => Math.abs(edge - (got[field] ?? -1)))
        );
        if (outBy > 1) {
          return (
            `row ${row} draws ${placed} against its box ${told[row]} ` +
            `(out by ${outBy.toFixed(1)} dp)`
          );
        }
      }
      return '';
    }

    // The layer is a Compose pass behind the section until a pass has read the section as it is
    // now: its height and its row shapes are both whatever the last pass saw. Wait for that pass
    // - once the section has grown to include its footer, and with a timeout that names which
    // half is still stale.
    const stalePair = () => {
      const line = need(sections.first).nuiTestSectionReport();
      const report = parse(line);
      return (
        `the layer is ${num(report, 'layerH')} dp tall against a ` +
        `${num(report, 'boxH')} dp section, and ` +
        `${shapeLag(report) || 'every drawn row shape is on its row'} ` +
        `(last report ${line})`
      );
    };
    const settled = await sectionReport('first', (r) => {
      const lastRowBottom = (r.rects ?? '')
        .split(',')
        .filter((entry) => entry.includes('-'))
        .reduce((bottom, entry) => {
          const edge = entry.split('-').map(Number);
          return Math.max(bottom, (edge[0] ?? 0) + (edge[1] ?? 0));
        }, 0);
      return (
        num(r, 'layerH') > 0 &&
        num(r, 'boxH') >= lastRowBottom + num(r, 'footerBand') &&
        Math.abs(num(r, 'boxH') - num(r, 'layerH')) <= 1 &&
        shapeLag(r) === ''
      );
    }).catch(() => {
      throw new Error(
        `question 2: the section never settled into a layer as tall as itself: ` +
          `${stalePair()}`
      );
    });
    console.log(`FORM LAYER first section ${JSON.stringify(settled)}`);
    const outBy = num(settled, 'boxH') - num(settled, 'layerH');
    if (Math.abs(outBy) > 1) {
      throw new Error(
        `question 2: the section draws into a layer ${num(
          settled,
          'layerH'
        )} dp tall while the section itself is ${num(
          settled,
          'boxH'
        )} dp, so the footer is bottom-aligned against, and the row shapes clipped to, a ` +
          `box that is not the section's (out by ${outBy.toFixed(1)} dp)`
      );
    }
  });

  it('places a drawn accessory inside the row it belongs to, and keeps it there (E2)', async () => {
    if (IOS) return;
    await render(<StoryForm />);

    // Compares the row's own box with the box the Compose layer placed the accessory in.
    const disagreement = (): string[] => {
      const report = parse(
        sections.story?.nuiTestSectionReport() ?? '<no handle>'
      );
      const rowReport = parse(
        rows.storyFirst?.nuiTestRowReport() ?? '<no handle>'
      );
      if (num(rowReport, 'h') <= 0) {
        return ['the row has no height yet'];
      }
      if (
        report.drawnAccessory === undefined ||
        report.drawnAccessory === '-'
      ) {
        return ['the layer has placed no accessory at all'];
      }
      return accessoryIssues(
        placedBox(report.drawnAccessory),
        placedBox(rowReport.frame)
      );
    };
    const story = await sectionReport(
      'story',
      (r) => num(r, 'shapes') > 0 && disagreement().length === 0
    ).catch(() => {
      throw new Error(
        `question 2: ${disagreement().join('; ')} - the row is where Yoga put it and the ` +
          `layer's drawing is not, which is the layer placing its chrome somewhere other ` +
          `than the row it belongs to (section ${String(
            sections.story?.nuiTestSectionReport() ?? '<no handle>'
          )}; row ${String(rows.storyFirst?.nuiTestRowReport() ?? '<no handle>')})`
      );
    });
    console.log(
      `FORM DRAWN story section ${JSON.stringify(story)} row ${String(
        rows.storyFirst?.nuiTestRowReport()
      )}`
    );
    // Sampled again after two seconds: the section is laid out more than once, and the
    // layer has to follow the later layouts too.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const late = disagreement();
    if (late.length > 0) {
      throw new Error(
        `question 2: ${late.join('; ')} - the layer followed the section's first layout and ` +
          `not the one after it (section ${String(
            sections.story?.nuiTestSectionReport() ?? '<no handle>'
          )}; row ${String(rows.storyFirst?.nuiTestRowReport() ?? '<no handle>')})`
      );
    }
    expect(num(story, 'shapes')).toBe(2);
  });

  it('lays every row of a section inside its own card (X24)', async () => {
    if (IOS) return;
    await render(<StoryForm />);

    // `drawnCards` is where the layer placed each row's container; `cardBoxes` is the box
    // it was handed. A card may fall short of its row by the gap between cards only.
    const disagree = (): string[] => {
      const report = parse(
        sections.story?.nuiTestSectionReport() ?? '<no handle>'
      );
      const rowsInStory = [rows.storyFirst, rows.storySecond].filter(
        (row) => row != null
      );
      if (rowsInStory.length < 2)
        return ['the story section has no two rows yet'];
      const gap = num(report, 'gap');
      // `hostBox` is the layer's own frame in the section: it must be at the section's
      // origin and as tall as the section, or every card is painted somewhere else.
      const layer = placedBox(report.hostBox);
      const layerIssues: string[] = [];
      if (layer[0] !== 0 || layer[1] !== 0) {
        layerIssues.push(
          `the layer that paints the cards sits at x=${layer[0]}, y=${layer[1]} inside its ` +
            `own section (hostBox=${String(report.hostBox)})`
        );
      }
      if (Math.abs(layer[3] - num(report, 'boxH')) > 1) {
        layerIssues.push(
          `the layer is ${layer[3]} dp tall in a section ${num(
            report,
            'boxH'
          )} dp tall (hostBox=${String(report.hostBox)})`
        );
      }
      // `layerBox` is the box the layer's content is laid out in, which the cards are
      // drawn relative to.
      const root = placedBox(report.layerBox);
      if (root[0] !== 0 || root[1] !== 0) {
        layerIssues.push(
          `the section's own layer box sits at x=${root[0]}, y=${root[1]} inside the ` +
            `layer's view (layerBox=${String(report.layerBox)})`
        );
      }
      if (Math.abs(root[3] - num(report, 'boxH')) > 1) {
        layerIssues.push(
          `the section's own layer box is ${root[3]} dp tall in a section ` +
            `${num(report, 'boxH')} dp tall (layerBox=${String(report.layerBox)})`
        );
      }
      if (layerIssues.length > 0) return layerIssues;
      // `0:l,t,w,h|1:l,t,w,h`, by row index.
      const drawn = new Map<number, PlacedBox>();
      for (const entry of (report.drawnCards ?? '').split('|')) {
        const at = entry.indexOf(':');
        if (at < 0 || !entry.includes(',')) continue;
        drawn.set(Number(entry.slice(0, at)), placedBox(entry.slice(at + 1)));
      }
      const missing = rowsInStory
        .map((_, index) => index)
        .filter((index) => !drawn.has(index));
      if (missing.length > 0) {
        return [
          `the layer placed no container for row(s) ${missing.join(', ')} of ${rowsInStory.length}: drawnCards=${String(
            report.drawnCards ?? '<absent>'
          )} (handed cardBoxes=${String(report.cardBoxes ?? '<absent>')})`,
        ];
      }
      const cards = rowsInStory.map(
        (_, index) => drawn.get(index) as PlacedBox
      );
      const handed = (report.cardBoxes ?? '')
        .split('|')
        .filter((entry) => entry.includes(','))
        .map((entry) => placedBox(entry));
      const handedTop = (index: number): string =>
        handed[index] == null ? '?' : String(handed[index][1]);
      const rowBoxes = rowsInStory.map((row) =>
        placedBox(parse(row.nuiTestRowReport()).frame)
      );
      if (rowBoxes.some((b) => b[3] <= 0)) {
        return ['a row of the story section has no height yet'];
      }
      const out: string[] = [];
      cards.forEach((card, index) => {
        const [cardLeft, cardTop, cardWidth, cardHeight] = card;
        const [rowLeft, rowTop, rowWidth, rowHeight] = rowBoxes[index] ?? [
          0, 0, 0, 0,
        ];
        const slack = gap / 2 + 0.5;
        if (cardWidth <= 0 || cardHeight <= 0) {
          out.push(
            `row ${index}: the container drawn for it is ${cardWidth} x ${cardHeight}`
          );
          return;
        }
        if (cardTop > rowTop + slack) {
          out.push(
            `row ${index}: its container is drawn at y=${cardTop} while the row starts at ` +
              `y=${rowTop} (its box was handed to the layer as y=${handedTop(index)})`
          );
        }
        if (cardTop + cardHeight < rowTop + rowHeight - slack) {
          out.push(
            `row ${index}: its card ends at y=${(cardTop + cardHeight).toFixed(1)} while the ` +
              `row ends at y=${(rowTop + rowHeight).toFixed(1)}`
          );
        }
        if (Math.abs(cardLeft - rowLeft) > 1) {
          out.push(
            `row ${index}: its card starts at x=${cardLeft} while the row starts at x=${rowLeft}`
          );
        }
        if (Math.abs(cardWidth - rowWidth) > 1) {
          out.push(
            `row ${index}: its card is ${cardWidth} wide while the row is ${rowWidth} wide`
          );
        }
      });
      return out;
    };
    const issues = (): string[] => {
      try {
        return disagree();
      } catch (error) {
        return [String(error)];
      }
    };

    const settled = await sectionReport(
      'story',
      (r) => num(r, 'shapes') > 0 && issues().length === 0
    ).catch(() => {
      throw new Error(
        `X24: ${issues().join('; ')} - a row is drawn outside the container its own section ` +
          `paints behind it (section ${String(
            sections.story?.nuiTestSectionReport() ?? '<no handle>'
          )}; rows ${String(rows.storyFirst?.nuiTestRowReport())} / ${String(
            rows.storySecond?.nuiTestRowReport()
          )})`
      );
    });
    console.log(
      `FORM CARDS story section ${JSON.stringify(settled)} rows ${String(
        rows.storyFirst?.nuiTestRowReport()
      )} / ${String(rows.storySecond?.nuiTestRowReport())}`
    );
    // Sampled again after two seconds: the rows move after their first layout.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const late = issues();
    if (late.length > 0) {
      throw new Error(
        `X24: ${late.join('; ')} - the cards followed the section's first layout and not the ` +
          `one after it (section ${String(
            sections.story?.nuiTestSectionReport() ?? '<no handle>'
          )})`
      );
    }
  });
});

function TallForm({ avoids }: { avoids: boolean }) {
  return (
    <Form
      hybridRef={(view) => {
        if (view != null) forms.tall = view;
      }}
      keyboardAvoidance={avoids}
      style={styles.form}
    >
      <Form.Section title="Scrolling">
        {Array.from({ length: TALL_ROWS }, (_, index) => (
          <Form.Row key={index} style={styles.tallRow}>
            {index === FOCUSED_ROW ? (
              // A field that raises no keyboard of the emulator's own: these cases report the
              // inset themselves, and a real one would answer for the same ask.
              <TextInput
                ref={(field) => {
                  fields.tall = field;
                }}
                testID="tall-field"
                showSoftInputOnFocus={false}
                style={styles.tallField}
              />
            ) : (
              <Text>{`Row ${String(index + 1)}`}</Text>
            )}
          </Form.Row>
        ))}
      </Form.Section>
    </Form>
  );
}

describe('Form keyboard opt-out (Android)', () => {
  afterEach(() => {
    cleanup();
    for (const key of Object.keys(forms)) delete forms[key];
    fields.tall = null;
  });

  /**
   * The tall Form's report once its rows have stopped moving.
   *
   * A section learns its header, footer and gap from a round trip through JavaScript, so the
   * content grows after its first layout: a baseline taken too early reads that growth as
   * something the keyboard did.
   */
  async function settledReport(): Promise<Record<string, string>> {
    const form = need(forms.tall);
    let previous = parse(form.nuiTestFormReport());
    for (let read = 0; read < 30; read += 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      const next = parse(form.nuiTestFormReport());
      if (
        raw(next, 'contentH') === raw(previous, 'contentH') &&
        raw(next, 'scroll') === raw(previous, 'scroll')
      ) {
        return next;
      }
      previous = next;
    }
    throw new Error(
      `the tall Form's numbers never settled - last read ${JSON.stringify(previous)}`
    );
  }

  /**
   * A report built after this call, not the one the last call left behind: the first read
   * asks for a rebuild, the second reads what the UI thread has since written.
   */
  async function freshReport(): Promise<Record<string, string>> {
    const form = need(forms.tall);
    form.nuiTestFormReport();
    await new Promise((resolve) => setTimeout(resolve, 150));
    return parse(form.nuiTestFormReport());
  }

  /**
   * The tall Form with its field focused and parked at `PARK_DP`: the numbers a case measures
   * from, with no keyboard reported to the Form yet.
   */
  async function parkField(avoids: boolean): Promise<Record<string, string>> {
    await render(<TallForm avoids={avoids} />);
    await formReport(
      (r) =>
        num(r, 'rows') === TALL_ROWS &&
        num(r, 'contentH') >= TALL_ROWS * TALL_ROW_HEIGHT,
      'the tall Form laid out past its viewport',
      'tall'
    );
    const field = fields.tall;
    if (field == null)
      throw new Error('the tall Form was laid out and has no field to focus');
    field.focus();
    await formReport(
      (r) => num(r, 'focus') === FOCUSED_ROW,
      'the Form holding focus on the field in its ninth row',
      'tall'
    );
    need(forms.tall).nuiTestScrollTo(PARK_DP);
    await formReport(
      (r) => Math.abs(num(r, 'scroll') - PARK_DP) <= 2,
      `the Form parked at ${String(PARK_DP)} dp`,
      'tall'
    );
    const parked = await settledReport();
    expect(raw(parked, 'keyboard')).toBe(avoids ? 'rn' : 'off');
    expect(
      num(parked, 'focus'),
      `focus is not on the field these cases reveal (${JSON.stringify(parked)})`
    ).toBe(FOCUSED_ROW);
    return parked;
  }

  /**
   * Reporting the keyboard to the Form, and answering once the reservation it causes has been
   * laid out and any reveal has stopped retrying.
   */
  async function raiseKeyboard(): Promise<Record<string, string>> {
    need(forms.tall).nuiTestCommand(`ime:${String(REPORTED_IME_DP)}`);
    await formReport(
      (r) => Math.abs(num(r, 'ime') - REPORTED_IME_DP) <= 1,
      'the Form being told a keyboard is up',
      'tall'
    );
    // A reservation lands in a render, and a reveal retries for 600 ms waiting for it.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return settledReport();
  }

  it('grows nothing and moves nothing for a keyboard it was told to leave alone (FIX15)', async () => {
    if (IOS) return;
    const parked = await parkField(false);
    const offset = num(parked, 'scroll');
    const content = num(parked, 'contentH');

    const insetUp = await raiseKeyboard();
    expect(Math.abs(num(insetUp, 'ime') - REPORTED_IME_DP)).toBeLessThanOrEqual(
      1
    );
    expect(
      Math.abs(num(insetUp, 'contentH') - content),
      `an opted-out Form grew its content by ${(
        num(insetUp, 'contentH') - content
      ).toFixed(1)} dp for the ${String(
        REPORTED_IME_DP
      )} dp keyboard it was told to leave alone (${JSON.stringify(insetUp)})`
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(num(insetUp, 'scroll') - offset),
      `an opted-out Form lifted its focused field ${String(
        Math.round(num(insetUp, 'scroll') - offset)
      )} dp off the spot it was parked at for a ${String(
        REPORTED_IME_DP
      )} dp keyboard it was told to leave alone (${JSON.stringify(insetUp)})`
    ).toBeLessThanOrEqual(1);

    // A reveal is retried for 600 ms after the content grows, so the offset is read again
    // once that window has closed.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const later = await freshReport();
    expect(
      Math.abs(num(later, 'scroll') - offset) <= 1,
      `an opted-out Form was told a keyboard was up, and a second later it had moved ${String(
        Math.round(num(later, 'scroll') - offset)
      )} dp from where it was parked (${JSON.stringify(later)})`
    ).toBe(true);
    console.log(`FORM KEYBOARD opted out, inset up: ${JSON.stringify(later)}`);
  });

  it('reserves the keyboard in its content and lifts its focused field clear of it (FIX15)', async () => {
    if (IOS) return;
    const parked = await parkField(true);
    const offset = num(parked, 'scroll');
    const content = num(parked, 'contentH');

    const insetUp = await raiseKeyboard();
    expect(
      num(insetUp, 'contentH'),
      `a Form that keeps the focused row visible grew its content by only ${(
        num(insetUp, 'contentH') - content
      ).toFixed(1)} dp, not the ${String(
        REPORTED_IME_DP
      )} dp it was asked to reserve (${JSON.stringify(insetUp)})`
    ).toBeGreaterThanOrEqual(content + REPORTED_IME_DP - 2);
    expect(
      num(insetUp, 'scroll'),
      `a Form that keeps the focused row visible left it behind the ${String(
        REPORTED_IME_DP
      )} dp keyboard, still parked at ${offset.toFixed(1)} dp (${JSON.stringify(
        insetUp
      )})`
    ).toBeGreaterThan(offset + 1);
    console.log(`FORM KEYBOARD avoiding, inset up: ${JSON.stringify(insetUp)}`);
  });

  /**
   * Asking the scroller to show a row a screen below it - what Tab, the keyboard's Next key
   * and a `focus()` from code ask - and reading the answer.
   *
   * The Form's own keyboard promise says nothing about this ask: the scroll view answers it
   * into its own viewport, which is the size it was given and knows no keyboard.
   */
  async function expectShownOnRequest(avoids: boolean): Promise<void> {
    const parked = await parkField(avoids);
    const offset = num(parked, 'scroll');

    need(forms.tall).nuiTestCommand(`rect:${String(TALL_ROWS - 1)}`);
    const asked = await formReport(
      (r) => num(r, 'rectReqs') >= 1,
      'the Form being asked to show its last row',
      'tall'
    );
    expect(
      num(asked, 'rectBelow'),
      `the premise of this case is gone: the last row was on screen when it was asked for (${JSON.stringify(asked)})`
    ).toBe(1);
    const shown = await formReport(
      (r) => num(r, 'scroll') > offset + 1,
      `the scroller showing the row it was asked about, last parked at ${offset.toFixed(
        1
      )} dp (${JSON.stringify(asked)})`,
      'tall'
    );
    console.log(
      `FORM KEYBOARD rect request, avoids=${avoids ? 'yes' : 'no'}: ${JSON.stringify(shown)}`
    );
  }

  it('still shows a requested row while it avoids the keyboard (FIX15)', async () => {
    if (IOS) return;
    await expectShownOnRequest(true);
  });

  it('still shows a requested row after opting out of keyboard avoidance (FIX15)', async () => {
    if (IOS) return;
    await expectShownOnRequest(false);
  });
});

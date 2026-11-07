/**
 * On-device tests for the S6 Form spike (Q10 Appendix E's seven questions).
 *
 * The prototype is a `UICollectionView` inset-grouped list on iOS and a Material 3
 * segmented column on Android, so the honest channel is the test seams
 * (`nuiTestFormReport`, `nuiTestSectionReport`, `nuiTestRowReport`, whose fields
 * `src/components/Form/Form.nitro.ts` documents) plus React's own counters. The report is
 * not a stand-in for what the screen would show: `heights` is the layout's own answer for
 * a row, `where` is which superview a row's component view is in right now, and `kind` /
 * `x` / `w` / `radius` / `headerH` are the measurements question 2 compares.
 *
 * What these cases *cannot* prove is a finger's touch: `react-native-harness` delivers
 * events by tag, so they show that a reparented row and its hosted Switch are addressable
 * and wired, while `docs/tasks/S6/real-input.md` records the same taps synthesised by the
 * OS. Both are named in the report.
 */
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
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
import { Switch } from '../../src/components/Switch/Switch';
import { forgetPromisedHandles, handleOf } from './handles';

const IOS = Platform.OS === 'ios';

type FormHandle = {
  nuiTestFormReport(): string;
  nuiTestScrollTo(y: number): void;
  nuiTestCommand(command: string): void;
};
type SectionHandle = { nuiTestSectionReport(): string };
type RowHandle = { nuiTestRowReport(): string };

const forms: Record<string, FormHandle> = {};
const sections: Record<string, SectionHandle> = {};
const rows: Record<string, RowHandle> = {};

/** The report as `key -> value`. */
function parse(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of line.split(';')) {
    const at = pair.indexOf('=');
    if (at > 0) out[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return out;
}

function num(report: Record<string, string>, key: string): number {
  const raw = report[key];
  if (raw == null)
    throw new Error(`report has no "${key}": ${JSON.stringify(report)}`);
  return Number(raw);
}

function raw(report: Record<string, string>, key: string): string {
  return report[key] ?? '<missing>';
}

/** Read the Form's report until `ok` holds, and fail naming the report if it never does. */
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
      // A first read is often still "pending", which parses to {} - and a predicate that
      // reads a missing field throws rather than returning false, so the poll must swallow
      // it rather than let it out through the assertion.
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

/** Fail loudly rather than reading a method off `undefined`. */
function need<T>(handle: T | undefined): T {
  if (handle == null)
    throw new Error('expected a hybridRef handle and there is none');
  return handle;
}

async function formRef(): Promise<FormHandle> {
  return handleOf(() => forms.form, 'the Form');
}

/** The reference for a testID, retried: the first pass can find nothing. */
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

const LONG_TEXT =
  'Airplane mode turns off every radio at once, including Bluetooth, Wi-Fi and cellular.';

/** What `Probe` renders, and the counters a case reads back. */
type Mode = 'base' | 'inserted' | 'removed' | 'grown';

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

type ProbeProps = ReturnType<typeof counters> & { mode: Mode };

/**
 * The form under test: three sections, nine rows, a hosted Switch, a `Pressable`, and a
 * `Text` that wraps at the cell width. Nine = 4 + 3 + 2 in `base`; `inserted` makes ten and
 * `removed` eight, so a keyed change is a real insert or removal rather than a rebuild.
 */
function Probe({
  mode,
  log,
  onRowPress,
  onPressablePress,
  onSwitchChange,
}: ProbeProps) {
  return (
    <Form hybridRef={(view) => (forms.form = view)} style={styles.form}>
      <Form.Section
        footer="These settings apply to this device only."
        hybridRef={(view) => (sections.first = view)}
        title="Connectivity"
      >
        <Form.Row
          hybridRef={(view) => (rows.wifi = view)}
          key="wifi"
          onPress={onRowPress}
        >
          <Text testID="label-wifi">Wi-Fi</Text>
        </Form.Row>
        <Form.Row
          accessory="disclosure"
          hybridRef={(view) => (rows.bt = view)}
          key="bt"
          onPress={onRowPress}
        >
          <Text testID="label-bt">Bluetooth</Text>
        </Form.Row>
        {mode === 'inserted' ? (
          <Form.Row key="hotspot" onPress={onRowPress}>
            <Text testID="label-hotspot">Personal hotspot</Text>
          </Form.Row>
        ) : null}
        {mode === 'removed' ? null : (
          <Form.Row key="cell" onPress={onRowPress}>
            <Text testID="label-cell">Cellular data</Text>
          </Form.Row>
        )}
        <Form.Row hybridRef={(view) => (rows.pressable = view)} key="pressable">
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
      </Form.Section>
      <Form.Section
        hybridRef={(view) => (sections.second = view)}
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
        <Form.Row key="silent">
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

/** The same rows outside any native container - question 6's comparison. */
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
    <Form hybridRef={(view) => (forms.cost = view)} style={styles.form}>
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

const styles = StyleSheet.create({
  form: { flex: 1 },
  wrapped: { flex: 1 },
  pressable: { paddingHorizontal: 8 },
  column: { gap: 8 },
  columnRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center' },
});

/** A handle, printed without assuming it is plain data. */
function describeBox(box: unknown): string {
  try {
    return JSON.stringify(box);
  } catch {
    return String(box);
  }
}

/** Mount the probe and wait for the Form's handle and first laid-out row. */
async function mount(props: ProbeProps) {
  render(<Probe {...props} />);
  await formRef();
  await boxOf('label-wifi');
  return props;
}

/** Element `index` of a parsed height list, or a failure naming the list. */
function nth(values: number[], index: number): number {
  const value = values[index];
  if (value == null || !Number.isFinite(value))
    throw new Error(`no item ${index} in [${values.join(', ')}]`);
  return value;
}

/**
 * Read a Row's or Section's report until `ok` holds. Every native report is refreshed on
 * main and read on the JS thread, so the first read is often still `"pending"`.
 */
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

describe('Form (S6 spike)', () => {
  afterEach(() => {
    cleanup();
    forgetPromisedHandles();
    for (const map of [forms, sections, rows]) {
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
      // Rows on screen are inside a cell; the rest are in a section's holding view.
      expect(num(report, 'inCells')).toBeGreaterThan(0);
    } else {
      expect(num(report, 'inCells')).toBe(num(report, 'rows'));
      // Question 2's Android half: one shape per row, so the count is the row count.
      const section = parse(need(sections.first).nuiTestSectionReport());
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
    // Every row the Form holds is a row this tree rendered - no phantom from a recycled
    // view. iOS-only: on Android the section's children *are* its rows, in place.
    if (IOS) {
      const first = await reportUntil(
        () => sections.first?.nuiTestSectionReport(),
        (r) => r.subviews != null,
        'the first section to count its children'
      );
      expect(num(first, 'rows')).toBe(4);
      expect(num(first, 'subviews')).toBe(num(first, 'rows'));
    }
  });

  it('keeps the tree intact through an insert, a removal and 50 scrolls (E1)', async () => {
    await mount({ mode: 'base', ...counters() });
    await formReport((r) => num(r, 'rows') === 9, 'nine rows');

    // A keyed insert in the middle of the first section.
    const { rerender } = await render(
      <Probe mode="inserted" {...counters()} />
    );
    await formReport((r) => num(r, 'rows') === 10, 'ten rows after the insert');
    await boxOf('label-hotspot');
    expect(parse(need(forms.form).nuiTestFormReport()).orphans).toBe('0');

    await rerender(<Probe mode="removed" {...counters()} />);
    await formReport(
      (r) => num(r, 'rows') === 8,
      'eight rows after the removal'
    );
    if (!IOS) {
      // Question 2 again: the shapes follow the new index/count, not the old ones.
      const section = parse(need(sections.first).nuiTestSectionReport());
      expect(num(section, 'shapes')).toBe(3);
    }

    await rerender(<Probe mode="base" {...counters()} />);
    const settled = await formReport(
      (r) => num(r, 'rows') === 9,
      'nine rows again'
    );
    expect(settled.orphans).toBe('0');

    // The leak probe is growth across the cycles, not equality with the row count: a row
    // React has thrown away can still be alive in Fabric's own component-view pool, and
    // that is RN's retention, not the list's.
    const beforeCycles = parse(need(forms.form).nuiTestFormReport());
    // 50 scroll-through cycles: cells are reused, so rows move in and out of them.
    for (let cycle = 0; cycle < 50; cycle += 1) {
      need(forms.form).nuiTestScrollTo(cycle % 2 === 0 ? 400 : 0);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    need(forms.form).nuiTestScrollTo(0);
    const after = parse(need(forms.form).nuiTestFormReport());
    expect(after.orphans).toBe('0');
    expect(num(after, 'rows')).toBe(9);
    // Nothing was left behind by the churn or by 50 cycles of cell reuse.
    expect(num(after, 'alive')).toBe(num(beforeCycles, 'alive'));
    if (IOS) {
      // The witness that cells actually handed rows back rather than dropping them.
      expect(num(after, 'reclaims')).toBeGreaterThan(0);
      expect(num(after, 'reparents')).toBeGreaterThanOrEqual(
        num(after, 'reclaims')
      );
    }
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
    // The delta between what the list says an item is and what Yoga says its row is is the
    // cell's own chrome. It must be the same for every row - that is "the cell follows
    // Yoga", and it is a comparison rather than a threshold.
    const chrome = nth(items, 0) - num(wifi, 'h');
    expect(chrome).toBeGreaterThan(0);
    expect(Math.abs(nth(items, 1) - num(bt, 'h') - chrome)).toBeLessThanOrEqual(
      1
    );

    // Grow the wrapped row's text: its cell follows, and its neighbours do not move.
    await render(<Probe {...probe} mode="grown" />);
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

  it('delivers taps to a Switch and a Pressable inside a row (E4, in-app events)', async () => {
    const probe = await mount({ mode: 'base', ...counters() });
    await formReport((r) => num(r, 'rows') === 9, 'nine rows');
    const pressable = await boxOf('inner-press');
    const toggle = await boxOf('switch-silent');
    // eslint-disable-next-line no-console
    console.log(
      `S6 TAP boxes pressable=${describeBox(pressable)} switch=${describeBox(toggle)}`
    );
    for (let index = 0; index < 10; index += 1) {
      await userEvent.press(pressable);
      await userEvent.press(toggle);
    }
    expect(probe.log.pressable).toBe(10);
    expect(probe.log.switches).toBe(10);
    expect(probe.log.silent).toBe(true);
    // The row stayed where it belongs after ten taps in its content.
    expect(parse(need(forms.form).nuiTestFormReport()).orphans).toBe('0');
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
      // The same rows outside any native container, same probe: `native` versus `plain`,
      // wall-clock from `render()` to the report agreeing on the row count. Question 6's
      // harness stand-in for a bench arm - the report says so in as many words.
      const plainStart = Date.now();
      render(<Column count={count} />);
      await boxOf(`c${count - 1}`);
      const plain = Date.now() - plainStart;
      cleanup();
      // eslint-disable-next-line no-console
      console.log(
        `S6 COST N=${count} form=${native}ms plain=${plain}ms ${raw(report, 'applies')}`
      );
      expect(num(report, 'orphans')).toBe(0);
      expect(num(report, 'alive')).toBe(count);
      if (IOS) {
        expect(num(report, 'items')).toBe(count);
        // The cell-reuse claim, measured: on screen, not mounted-and-visible, is a window.
        expect(num(report, 'inCells')).toBeLessThan(count);
      }
    }
  });
});

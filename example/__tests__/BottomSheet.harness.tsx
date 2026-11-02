/**
 * On-device tests for BottomSheet (task G14, Q5 Appendix C8 as amended by D35).
 *
 * A sheet is a window the harness cannot tap into (H9/H10), so these tests read
 * three honest channels:
 *
 *  - `hybridRef.nuiTestStateReport()` - what is on screen, from the controller iOS
 *    presented and the Android model as composed, plus process-wide counts that
 *    survive a drop (`live` windows, iOS `controllers` and `touchRoots`, Android
 *    `roots`), read through a fresh mount when the one that opened it is gone;
 *  - the content's own `onLayout` and mount/unmount, which is React Native's view of
 *    where the sheet put it;
 *  - the events that reached JS, in order.
 *
 * and drive the sheet through test seams that run the real paths (`nuiTestDismiss`
 * takes the sheet down as a swipe does; `nuiTestSelectDetent` moves it the way a drag
 * ends). Real fingers are `real-input:*`'s job.
 *
 * The stranded-Modal hazard (D35 item 5) is *not* here: a run that reproduced it would
 * leave RN's `Modal` host over the app for every file after this one, so it runs in an
 * app instance of its own (`__tests__/isolated/BottomSheetModalHazard.harness.tsx`).
 */
import { useEffect, useState } from 'react';
import { Modal, Platform, ScrollView, View } from 'react-native';
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
  nitroUiCore,
  type BottomSheetDetent,
} from 'react-native-nitro-ui';

/** What `hybridRef` hands back - declared, not imported (D14). */
type SheetHandle = {
  readonly presented: boolean;
  nuiTestStateReport(): string;
  nuiTestDismiss(): void;
  nuiTestSelectDetent(index: number): void;
};

const IOS = Platform.OS === 'ios';

const handles = new Map<string, SheetHandle>();
const captureHybrid =
  (testId: string) =>
  (view: SheetHandle): void => {
    handles.set(testId, view);
  };

/** Every event the app received, in order: `testID:presented:false`, `testID:dismiss`, `testID:detent:1`. */
const eventLog: string[] = [];
/** The parents' `isPresented` setters and content setters, by testID. */
const setters = new Map<string, (next: boolean) => void>();
const rowSetters = new Map<string, (rows: number) => void>();
/** The content's last layout, by testID. */
const layouts = new Map<
  string,
  { x: number; y: number; width: number; height: number }
>();
/** How many times each testID's content mounted and unmounted. */
const mounts = new Map<string, number>();
const unmounts = new Map<string, number>();

const bump = (map: Map<string, number>, key: string) =>
  map.set(key, (map.get(key) ?? 0) + 1);

/** The content: a box of a known height, plus rows of 80 a test can add. */
function Content({ testId, base }: { testId: string; base: number }) {
  const [rows, setRows] = useState(0);
  rowSetters.set(testId, setRows);
  useEffect(() => {
    bump(mounts, testId);
    return () => {
      bump(unmounts, testId);
    };
  }, [testId]);
  return (
    <View
      testID={`${testId}-content`}
      onLayout={(event) => layouts.set(testId, event.nativeEvent.layout)}
    >
      <View style={{ height: base, backgroundColor: '#9ec5fe' }} />
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} style={{ height: 80, backgroundColor: '#cfe2ff' }} />
      ))}
    </View>
  );
}

/** A ScrollView that fills the sheet's box, for the non-`fit` cases. */
function ScrollContent({ testId }: { testId: string }) {
  return (
    <ScrollView
      testID={`${testId}-scroll`}
      onLayout={(event) => layouts.set(testId, event.nativeEvent.layout)}
    >
      {Array.from({ length: 40 }, (_, index) => (
        <View
          key={index}
          style={{ height: 60, backgroundColor: index % 2 ? '#eee' : '#ddd' }}
        />
      ))}
    </ScrollView>
  );
}

/**
 * A sheet whose `isPresented` lives in a parent, as an app's would. `refuse` makes the
 * parent ignore every dismissal (D33); otherwise it follows `onIsPresentedChange`.
 */
function Stage({
  testId,
  initial = false,
  refuse = false,
  detents,
  dismissible,
  base = 240,
  scroll = false,
}: {
  testId: string;
  initial?: boolean;
  refuse?: boolean;
  detents?: BottomSheetDetent[];
  dismissible?: boolean;
  base?: number;
  scroll?: boolean;
}) {
  const [open, setOpen] = useState(initial);
  setters.set(testId, setOpen);
  return (
    <BottomSheet
      testID={testId}
      hybridRef={captureHybrid(testId)}
      isPresented={open}
      onIsPresentedChange={(next) => {
        eventLog.push(`${testId}:presented:${String(next)}`);
        if (!refuse) setOpen(next);
      }}
      onDetentChange={(index) => eventLog.push(`${testId}:detent:${index}`)}
      onDismiss={() => eventLog.push(`${testId}:dismiss`)}
      detents={detents}
      dismissible={dismissible}
    >
      {scroll ? (
        <ScrollContent testId={testId} />
      ) : (
        <Content testId={testId} base={base} />
      )}
    </BottomSheet>
  );
}

/**
 * A sheet that can be dropped while a second, closed BottomSheet - the probe - stays
 * mounted beside it, to read the process-wide counts after the drop.
 */
function DropScene({ testId }: { testId: string }) {
  const [shown, setShown] = useState(true);
  setters.set(`${testId}:shown`, setShown);
  return (
    <>
      <Stage testId={`${testId}-probe`} />
      {shown ? <Stage testId={testId} /> : null}
    </>
  );
}

type Report = Record<string, string>;

function reportOf(testId: string): Report {
  const raw = handles.get(testId)?.nuiTestStateReport() ?? '';
  const report: Report = { raw };
  for (const pair of raw.split(';')) {
    const at = pair.indexOf('=');
    if (at > 0) report[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return report;
}

const num = (report: Report, key: string): number => {
  const value = report[key];
  if (value == null) {
    throw new Error(`the report has no "${key}": "${report.raw}"`);
  }
  return Number(value);
};

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollUntil<T>(
  read: () => T | null,
  failure: () => Error,
  timeoutMs = 8000
): Promise<T> {
  const deadline = nitroUiCore.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value != null) return value;
    if (nitroUiCore.now() > deadline) throw failure();
    await sleep(25);
  }
}

async function waitForHandle(testId: string): Promise<SheetHandle> {
  return pollUntil(
    () => handles.get(testId) ?? null,
    () => new Error(`no hybridRef handle for "${testId}"`),
    10000
  );
}

/** Poll until `testId`'s report satisfies `check`; fail naming what it last said. */
async function waitForReport(
  testId: string,
  check: (report: Report) => boolean,
  what: string,
  timeoutMs = 8000
): Promise<Report> {
  return pollUntil(
    () => {
      const report = reportOf(testId);
      return check(report) ? report : null;
    },
    () =>
      new Error(
        `"${testId}" never reached ${what}; its report is "${reportOf(testId).raw}"; events=[${eventLog.join(',')}]`
      ),
    timeoutMs
  );
}

/** Up, counted and holding its content - the React Native children, in the sheet. */
const isUp = (report: Report) =>
  report.presented === '1' &&
  report.live === '1' &&
  Number(report.children) >= 1 &&
  (IOS
    ? report.onScreen === '1' && report.inSheet === '1'
    : report.sheetValue !== 'none' &&
      report.sheetValue !== 'Hidden' &&
      Number(report.inSheet) >= 1);

async function waitForUp(testId: string, what = 'presented') {
  return waitForReport(testId, isUp, `${what} (up, counted, content in it)`);
}

/** A plain mount whose only job is to read the process-wide counts. */
async function probe(): Promise<string> {
  const probeId = `probe-${String(nitroUiCore.now())}`;
  await render(<Stage testId={probeId} />);
  await waitForHandle(probeId);
  await waitForReport(probeId, (r) => r.raw !== '', 'a report');
  return probeId;
}

/** Nothing of any sheet is left anywhere: no window, no controller, no root. */
const nothingLeft = (baseline: Report) => (report: Report) =>
  report.live === '0' &&
  (IOS
    ? report.windows === '0' &&
      report.topPresented === '-' &&
      num(report, 'controllers') <= num(baseline, 'controllers') &&
      num(report, 'touchRoots') <= num(baseline, 'touchRoots')
    : report.roots === '0');

/**
 * The sheet stays up, untouched, for `ms`: nothing closes it on its own when its box
 * arrives or its content moves, and nothing is reported.
 */
async function staysUp(testId: string, ms: number, what: string) {
  const events = eventLog.length;
  const deadline = nitroUiCore.now() + ms;
  while (nitroUiCore.now() < deadline) {
    const report = reportOf(testId);
    if (!isUp(report) || eventLog.length !== events) {
      throw new Error(
        `"${testId}" did not stay up ${what}: report "${report.raw}"; events=[${eventLog.join(',')}]`
      );
    }
    await sleep(100);
  }
}

async function waitForEvent(entry: string, timeoutMs = 8000) {
  return pollUntil(
    () => (eventLog.includes(entry) ? true : null),
    () => new Error(`never saw "${entry}"; events=[${eventLog.join(',')}]`),
    timeoutMs
  );
}

/** The content's layout once it holds still. */
async function settledLayout(
  testId: string,
  check: (l: { width: number; height: number }) => boolean,
  what: string
) {
  return pollUntil(
    () => {
      const layout = layouts.get(testId);
      return layout != null && check(layout) ? layout : null;
    },
    () =>
      new Error(
        `"${testId}"'s content never laid out ${what}: ${JSON.stringify(layouts.get(testId) ?? null)}; report "${reportOf(testId).raw}"`
      )
  );
}

function reset() {
  cleanup();
  handles.clear();
  setters.clear();
  rowSetters.clear();
  layouts.clear();
  mounts.clear();
  unmounts.clear();
  eventLog.length = 0;
}

describe('BottomSheet', () => {
  afterEach(async () => {
    reset();
    // Let a window a test left behind finish leaving before the next one counts.
    await sleep(700);
  });

  it('lays a fit sheet out at its content height and the sheet width', async () => {
    await render(<Stage testId="fit" />);
    await waitForHandle('fit');
    await waitForReport('fit', (r) => r.live === '0', 'nothing up yet');
    setters.get('fit')?.(true);
    const up = await waitForUp('fit');
    // 240 matches no detent: `medium` is about half the screen and `large` all of
    // it, so a `fit` that failed cannot read 240 by accident.
    const layout = await settledLayout(
      'fit',
      (l) => Math.abs(l.height - 240) < 1 && l.width > 100,
      'at 240 tall'
    );
    const box = await waitForReport(
      'fit',
      (r) =>
        num(r, 'boxW') > 100 && Math.abs(num(r, 'boxW') - layout.width) <= 1,
      `a native box as wide as the content (${layout.width})`
    );
    expect(Math.abs(num(box, 'contentH') - 240)).toBeLessThanOrEqual(1);
    expect(num(up, 'presentCount')).toBe(1);
    if (IOS) {
      expect(up.ownWindow).toBe('0');
      expect(up.hidden).toBe('0');
      // The sheet is the content plus UIKit's own chrome (the home-indicator inset):
      // nowhere near `medium`.
      expect(num(box, 'sheetH')).toBeGreaterThanOrEqual(240);
      expect(num(box, 'sheetH')).toBeLessThan(240 + 60);
    } else {
      expect(Math.abs(num(box, 'hostH') - 240)).toBeLessThanOrEqual(1);
    }
    expect(mounts.get('fit')).toBe(1);
  });

  it('follows its content while it is up (fit)', async () => {
    await render(<Stage testId="grow" initial />);
    await waitForHandle('grow');
    await waitForUp('grow');
    await settledLayout('grow', (l) => Math.abs(l.height - 240) < 1, 'at 240');
    const before = await waitForReport(
      'grow',
      (r) =>
        Math.abs(num(r, IOS ? 'sheetH' : 'contentH') - (IOS ? 274 : 240)) < 80,
      'settled at its first height'
    );
    await sleep(500);
    const first = reportOf('grow');
    rowSetters.get('grow')?.(2);
    await settledLayout('grow', (l) => Math.abs(l.height - 400) < 1, 'at 400');
    const key = IOS ? 'sheetH' : 'contentH';
    const grown = await waitForReport(
      'grow',
      (r) => Math.abs(num(r, key) - num(first, key) - 160) <= 2,
      `${key} 160 taller than ${first[key]} (two rows of 80)`
    );
    expect(Math.abs(num(grown, 'contentH') - 400)).toBeLessThanOrEqual(1);
    expect(before.presented).toBe('1');
    // Growing is not leaving: the sheet that followed its content is still the one up.
    await staysUp('grow', 1500, 'after its content grew');
    expect(num(reportOf('grow'), 'presentCount')).toBe(1);
  });

  it('opens a medium/large sheet at the first detent and reports a drag to the second', async () => {
    await render(
      <Stage testId="detents" detents={['medium', 'large']} scroll />
    );
    await waitForHandle('detents');
    setters.get('detents')?.(true);
    const up = await waitForUp('detents');
    expect(up.detents).toBe('medium,large');
    await waitForReport('detents', (r) => r.selected === '0', 'selected=0');
    // Opening at a detent is not a change, and the box arriving is not a reason to go.
    await staysUp('detents', 1500, 'once its box arrived');
    expect(eventLog.filter((e) => e.includes(':detent:'))).toEqual([]);
    handles.get('detents')?.nuiTestSelectDetent(1);
    await waitForEvent('detents:detent:1');
    await waitForReport('detents', (r) => r.selected === '1', 'selected=1');
  });

  it('gives a ScrollView inside the sheet the sheet box', async () => {
    await render(<Stage testId="scroll" detents={['large']} scroll initial />);
    await waitForHandle('scroll');
    await waitForUp('scroll');
    const report = await waitForReport(
      'scroll',
      (r) => num(r, 'boxW') > 100 && num(r, 'boxH') > 200,
      'a native box'
    );
    const viewport = await settledLayout(
      'scroll',
      (l) =>
        Math.abs(l.width - num(reportOf('scroll'), 'boxW')) <= 1 &&
        Math.abs(l.height - num(reportOf('scroll'), 'boxH')) <= 1,
      `as the box ${report.boxW}x${report.boxH}`
    );
    // The viewport is the sheet's, not the 40 rows' 2400.
    expect(viewport.height).toBeLessThan(2400);
  });

  it('takes touches through a touch root of its own while it is up', async () => {
    await render(<Stage testId="touch" initial />);
    await waitForHandle('touch');
    const up = await waitForUp('touch');
    if (IOS) {
      expect(num(up, 'touchRoots')).toBeGreaterThanOrEqual(1);
      // `hitTest` at the content's centre - the call UIKit routes a finger by -
      // lands in the content, inside the sheet.
      await waitForReport(
        'touch',
        (r) => r.hit === '1',
        'a hit inside the content'
      );
    } else {
      // Only the frontmost focusable window has focus: the sheet's is the one a
      // finger reaches, and the content is in it.
      await waitForReport(
        'touch',
        (r) => r.focused === '1',
        'the sheet window focused'
      );
    }
  });

  it('closes on a JS false with onDismiss and no onIsPresentedChange, then unmounts the content', async () => {
    await render(<Stage testId="js" initial />);
    await waitForHandle('js');
    await waitForUp('js');
    setters.get('js')?.(false);
    await waitForEvent('js:dismiss');
    await waitForReport('js', (r) => r.live === '0', 'live=0');
    await pollUntil(
      () => (unmounts.get('js') === 1 ? true : null),
      () => new Error(`the content did not unmount: ${unmounts.get('js')}`)
    );
    await sleep(400);
    expect(eventLog).toEqual(['js:dismiss']);
  });

  it('closes as a user dismissal does: onIsPresentedChange(false), then onDismiss', async () => {
    await render(<Stage testId="user" initial />);
    await waitForHandle('user');
    await waitForUp('user');
    handles.get('user')?.nuiTestDismiss();
    await waitForEvent('user:dismiss');
    await waitForReport(
      'user',
      (r) => r.live === '0' && r.presented === '0',
      'closed'
    );
    expect(eventLog).toEqual(['user:presented:false', 'user:dismiss']);
    expect(reportOf('user').userDismissals).toBe('1');
    expect(reportOf('user').unasked).toBe('0');
    await pollUntil(
      () => (unmounts.get('user') === 1 ? true : null),
      () => new Error('the content did not unmount after a user dismissal')
    );
  });

  it('does nothing for a user dismissal when dismissible is false', async () => {
    await render(<Stage testId="sticky" initial dismissible={false} />);
    await waitForHandle('sticky');
    const up = await waitForUp('sticky');
    if (IOS) expect(up.modalInPresentation).toBe('1');
    handles.get('sticky')?.nuiTestDismiss();
    await sleep(1200);
    expect(isUp(reportOf('sticky'))).toBe(true);
    expect(eventLog).toEqual([]);
  });

  it('presents again when the app refuses a dismissal', async () => {
    await render(<Stage testId="refuse" initial refuse />);
    await waitForHandle('refuse');
    await waitForUp('refuse');
    handles.get('refuse')?.nuiTestDismiss();
    await waitForEvent('refuse:presented:false');
    await waitForReport(
      'refuse',
      (r) => isUp(r) && r.presentCount === '2',
      'up again (presentCount=2)',
      10000
    );
    // The content went with the first sheet only as far as React was concerned: it
    // never unmounted, because the app never stopped asking for it.
    expect(unmounts.get('refuse') ?? 0).toBe(0);
  });

  it('closes when JS withdraws it mid-entry, and leaves nothing', async () => {
    const baselineId = await probe();
    const baseline = reportOf(baselineId);
    reset();
    await render(<Stage testId="mid" />);
    await waitForHandle('mid');
    setters.get('mid')?.(true);
    await sleep(120);
    setters.get('mid')?.(false);
    await waitForEvent('mid:dismiss');
    await waitForReport(
      'mid',
      nothingLeft(baseline),
      'nothing left after a mid-entry false'
    );
    expect(eventLog.filter((e) => e === 'mid:dismiss').length).toBe(1);
    expect(eventLog.some((e) => e.includes('presented'))).toBe(false);
    await pollUntil(
      () => (unmounts.get('mid') === 1 ? true : null),
      () => new Error('the content did not unmount after a mid-entry false')
    );
  });

  for (const delay of [0, 80, 150, 1000]) {
    it(`leaves nothing when dropped ${delay} ms after presenting`, async () => {
      // The probe is mounted *before* the drop and stays mounted, so it can never be
      // the dropped view handed back by the recycle pool: a probe mounted after the
      // drop was that view, and its first props batch (`presented=false`) closed the
      // dropped sheet itself - the drop was never what the test read (G14 review).
      const id = `drop-${delay}`;
      await render(<DropScene testId={id} />);
      await waitForHandle(id);
      const probeId = `${id}-probe`;
      await waitForHandle(probeId);
      const baseline = await waitForReport(
        probeId,
        (r) => r.raw !== '' && r.live === '0',
        'a baseline with nothing up'
      );
      setters.get(id)?.(true);
      if (delay > 0) await sleep(delay);
      setters.get(`${id}:shown`)?.(false);
      await waitForReport(
        probeId,
        nothingLeft(baseline),
        `nothing left after a drop at ${delay} ms`
      );
    });
  }

  it('gives a recycled view none of its previous sheet', async () => {
    await render(<Stage testId="old" initial base={300} />);
    await waitForHandle('old');
    await waitForUp('old');
    reset();
    await render(<Stage testId="new" detents={['large']} />);
    await waitForHandle('new');
    const fresh = await waitForReport(
      'new',
      (r) => r.presented === '0',
      'closed'
    );
    expect(fresh.presentCount).toBe('0');
    expect(fresh.children).toBe('0');
    expect(fresh.inSheet).toBe('0');
    expect(fresh.selected).toBe('0');
    expect(fresh.detents).toBe('large');
    setters.get('new')?.(true);
    const up = await waitForUp('new');
    expect(up.presentCount).toBe('1');
    await settledLayout(
      'new',
      (l) => Math.abs(l.height - 240) < 1,
      'at its own 240'
    );
    // Report whether the pool really handed the old view back (`drops`/`recycles` are
    // per object): the assertions above hold either way.
    console.log(`recycle: new view drops=${up.drops} recycles=${up.recycles}`);
  });

  it('presents at mount once its view is in a window', async () => {
    await render(<Stage testId="mount" initial />);
    await waitForHandle('mount');
    const up = await waitForUp('mount');
    expect(up.presentCount).toBe('1');
  });

  it('presents inside an RN Modal and closes cleanly before the Modal does', async () => {
    const baselineId = await probe();
    const baseline = reportOf(baselineId);
    reset();
    function InModal() {
      const [modal, setModal] = useState(true);
      setters.set('modal-host', setModal);
      return (
        <Modal visible={modal} animationType="none">
          <View style={{ flex: 1 }}>
            <Stage testId="in-modal" />
          </View>
        </Modal>
      );
    }
    await render(<InModal />);
    await waitForHandle('in-modal');
    await sleep(500);
    setters.get('in-modal')?.(true);
    const up = await waitForUp('in-modal');
    if (IOS) {
      // D35: an RN Modal on top means a window of its own.
      expect(up.ownWindow).toBe('1');
      expect(up.appTop).toContain('ModalHostViewController');
    } else {
      await waitForReport(
        'in-modal',
        (r) => r.focused === '1',
        'the sheet window focused over the Modal'
      );
    }
    setters.get('in-modal')?.(false);
    await waitForEvent('in-modal:dismiss');
    setters.get('modal-host')?.(false);
    await sleep(800);
    reset();
    const probeId = await probe();
    const after = await waitForReport(
      probeId,
      nothingLeft(baseline),
      'nothing left'
    );
    if (IOS) expect(after.modalHosts).toBe('0');
  });

  it('follows its content in a window of its own, over an RN Modal (fit)', async () => {
    function OverModal() {
      const [modal, setModal] = useState(true);
      setters.set('own-modal', setModal);
      return (
        <Modal visible={modal} animationType="none">
          <View style={{ flex: 1 }}>
            <Stage testId="own-fit" />
          </View>
        </Modal>
      );
    }
    await render(<OverModal />);
    await waitForHandle('own-fit');
    await sleep(500);
    setters.get('own-fit')?.(true);
    const up = await waitForUp('own-fit', 'up over the Modal');
    if (IOS) expect(up.ownWindow).toBe('1');
    await settledLayout(
      'own-fit',
      (l) => Math.abs(l.height - 240) < 1,
      'at 240'
    );
    await sleep(500);
    const key = IOS ? 'sheetH' : 'contentH';
    const first = reportOf('own-fit');
    rowSetters.get('own-fit')?.(2);
    await settledLayout(
      'own-fit',
      (l) => Math.abs(l.height - 400) < 1,
      'at 400'
    );
    await waitForReport(
      'own-fit',
      (r) => Math.abs(num(r, key) - num(first, key) - 160) <= 2,
      `${key} 160 taller than ${first[key]} in a window of its own`
    );
    await staysUp('own-fit', 800, 'after its content grew');
    // The sheet goes before the Modal: closing the Modal under a sheet is the hazard
    // case, which runs in an app instance of its own.
    setters.get('own-fit')?.(false);
    await waitForEvent('own-fit:dismiss');
    setters.get('own-modal')?.(false);
    await sleep(800);
  });
});

/**
 * A second sheet asked for in the same commit as a first one presents over it while
 * the first is still arriving - a busy chain on iOS, which a present waits out in 50 ms
 * steps. The budget for that wait was once per *mount* (60 steps), so a mount that met
 * a busy chain often enough stopped presenting at all, with `presented=1` and nothing
 * up. Rounds enough to spend that budget several times over, on one mount, across two
 * tests (react-native-harness 1.6 has one timeout for every test).
 */
describe('BottomSheet · presenting over a sheet that is still arriving', () => {
  afterEach(async () => {
    reset();
    await sleep(700);
  });

  /** Both sheets up: each holds its content, and the process counts two windows. */
  const upWithTwo = (report: Report) =>
    report.presented === '1' &&
    report.live === '2' &&
    Number(report.children) >= 1 &&
    (IOS
      ? report.onScreen === '1' && report.inSheet === '1'
      : report.sheetValue !== 'none' && report.sheetValue !== 'Hidden');

  it('presents every time, round after round, on one mount', async () => {
    await render(
      <>
        <Stage testId="under" base={120} />
        <Stage testId="over" base={160} />
      </>
    );
    await waitForHandle('under');
    await waitForHandle('over');
    const rounds = IOS ? 9 : 4;
    for (let round = 1; round <= rounds; round += 1) {
      // Both in one commit, as an app opening two at once would: React batches the
      // two writes, and the second sheet's present meets the first one arriving.
      setters.get('under')?.(true);
      setters.get('over')?.(true);
      await waitForReport(
        'over',
        upWithTwo,
        `round ${round}: the second up over the first`
      );
      // The top one goes first: closing a sheet under another is a different case.
      setters.get('over')?.(false);
      await waitForReport(
        'over',
        (r) => r.live === '1',
        `round ${round}: the second gone`
      );
      setters.get('under')?.(false);
      await waitForReport(
        'under',
        (r) => r.live === '0',
        `round ${round}: both gone`
      );
    }
    if (IOS) {
      const over = await waitForReport('over', (r) => r.raw !== '', 'a report');
      // The run went past the 60 waits a mount used to get in all, on this one mount.
      expect(num(over, 'presentWaitsTotal')).toBeGreaterThan(60);
    }
  });
});

/**
 * Changing the detents while the sheet is up. On Android, whether `medium` is in the
 * list decides Material's `skipPartiallyExpanded`, which keys the sheet's saved state:
 * a new key built a new, hidden `SheetState` under a sheet that was up. The sheet keeps
 * one state for the whole presentation, and a list that adds or drops `medium` applies
 * at the next presentation there (docs/components/bottom-sheet.md).
 */
describe('BottomSheet · detents changed while up', () => {
  afterEach(async () => {
    reset();
    await sleep(700);
  });

  it('stays up when medium joins and leaves the list, and opens with the new list next time', async () => {
    function Changing() {
      const [two, setTwo] = useState(false);
      setters.set('two', setTwo);
      return (
        <Stage
          testId="change"
          initial
          scroll
          detents={two ? ['medium', 'large'] : ['large']}
        />
      );
    }
    await render(<Changing />);
    await waitForHandle('change');
    await waitForUp('change');
    await staysUp('change', 800, 'at large');
    setters.get('two')?.(true);
    await waitForReport(
      'change',
      (r) => r.detents === 'medium,large',
      'the new list'
    );
    await staysUp('change', 1500, 'after medium joined the list');
    setters.get('two')?.(false);
    await waitForReport(
      'change',
      (r) => r.detents === 'large',
      'the list again'
    );
    await staysUp('change', 1500, 'after medium left the list');
    expect(reportOf('change').presentCount).toBe('1');
    // Next presentation: the new list from the start.
    setters.get('two')?.(true);
    setters.get('change')?.(false);
    await waitForEvent('change:dismiss');
    setters.get('change')?.(true);
    const again = await waitForUp('change', 'up again with medium');
    expect(again.presentCount).toBe('2');
    if (!IOS) {
      await waitForReport(
        'change',
        (r) => r.sheetValue === 'PartiallyExpanded',
        'opened half expanded'
      );
    }
  });
});

/**
 * Fifty present/dismiss cycles, five files' worth of tests of ten - react-native-harness
 * 1.6 has one timeout for every test, and fifty animated cycles do not fit in it.
 */
describe('BottomSheet · 50 cycles', () => {
  let baseline: Report | null = null;
  let cycles = 0;

  for (let round = 0; round < 5; round += 1) {
    it(`cycles 10 more times (round ${round + 1})`, async () => {
      if (baseline == null) {
        const baselineId = await probe();
        baseline = reportOf(baselineId);
        reset();
      }
      await render(<Stage testId="cycle" />);
      await waitForHandle('cycle');
      for (let i = 0; i < 10; i += 1) {
        eventLog.length = 0;
        setters.get('cycle')?.(true);
        await waitForUp('cycle', `cycle ${cycles + 1} up`);
        setters.get('cycle')?.(false);
        await waitForEvent('cycle:dismiss');
        await waitForReport(
          'cycle',
          (r) => r.live === '0',
          `cycle ${cycles + 1} closed`
        );
        cycles += 1;
      }
      expect(mounts.get('cycle')).toBe(10);
      expect(unmounts.get('cycle')).toBe(10);
      reset();
    });
  }

  it('leaves nothing behind after fifty cycles', async () => {
    expect(cycles).toBe(50);
    const probeId = await probe();
    const after = await waitForReport(
      probeId,
      nothingLeft(baseline ?? reportOf(probeId)),
      'nothing left after 50 cycles',
      10000
    );
    console.log(`after 50 cycles: ${after.raw}`);
  });
});

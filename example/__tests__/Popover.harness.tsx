import { useEffect, useState } from 'react';
import { Modal, Platform, View } from 'react-native';
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
  Popover,
  Tooltip,
} from 'react-native-nitro-ui';
import { waitForHandle } from './handles';

type PopoverHandle = {
  readonly presented: boolean;
  readonly mostRecentEventCount: number;
  readonly maxWidth: number;
  nuiTestStateReport(): string;
  nuiTestDismiss(): void;
};

const IOS = Platform.OS === 'ios';

const handles = new Map<string, PopoverHandle>();
const captureHybrid =
  (testId: string) =>
  (view: PopoverHandle): void => {
    handles.set(testId, view);
  };

type SheetHandle = { nuiTestStateReport(): string };
type TipHandle = { nuiTestStateReport(): string };
const sheets = new Map<string, SheetHandle>();
const tips = new Map<string, TipHandle>();

/** Every event the app received, in order: `id:presented:false`, `id:dismiss`. */
const eventLog: string[] = [];
/** The parents' `isPresented` setters, and the mount switches of the drop fixtures. */
const setters = new Map<string, (next: boolean) => void>();
/** The content's last layout, by testID: what Yoga made of the box native was given. */
const layouts = new Map<
  string,
  { x: number; y: number; width: number; height: number }
>();
const mounts = new Map<string, number>();
const unmounts = new Map<string, number>();

const bump = (map: Map<string, number>, key: string) =>
  map.set(key, (map.get(key) ?? 0) + 1);

/** The content: a box of a known size, with mount and layout witnesses of its own. */
function Content({
  testId,
  width,
  height,
  fill = false,
}: {
  testId: string;
  width: number;
  height: number;
  /** Take the whole width the wrapper allows, rather than a width of its own. */
  fill?: boolean;
}) {
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
      style={{
        width: fill ? '100%' : width,
        height,
        backgroundColor: '#9ec5fe',
      }}
    />
  );
}

/** Content that has no box until `delayMs` after it mounts. */
function LateContent({
  testId,
  width,
  height,
  delayMs,
}: {
  testId: string;
  width: number;
  height: number;
  delayMs: number;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    bump(mounts, testId);
    const timer = setTimeout(setReady, delayMs, true);
    return () => {
      clearTimeout(timer);
      bump(unmounts, testId);
    };
  }, [testId, delayMs]);
  return (
    <View
      testID={`${testId}-content`}
      onLayout={(event) => layouts.set(testId, event.nativeEvent.layout)}
      style={{
        width: ready ? width : 0,
        height: ready ? height : 0,
        backgroundColor: '#9ec5fe',
      }}
    />
  );
}

/** Content whose own height a test changes while the popover is up. */
function GrowingContent({
  testId,
  width,
  height,
  grownHeight,
}: {
  testId: string;
  width: number;
  height: number;
  grownHeight: number;
}) {
  const [grown, setGrown] = useState(false);
  setters.set(`${testId}:grown`, (next: boolean) => setGrown(next));
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
      style={{
        width,
        height: grown ? grownHeight : height,
        backgroundColor: '#9ec5fe',
      }}
    />
  );
}

/**
 * A popover whose `isPresented` lives in a parent, as an app's would. `refuse` makes the
 * parent ignore every close; `uncontrolled` leaves `onIsPresentedChange` off altogether.
 */
function Stage({
  testId,
  initial = false,
  refuse = false,
  uncontrolled = false,
  width = 180,
  height = 90,
  fill = false,
  maxWidth,
  anchorWidth = 72,
  anchorHeight = 36,
  topSpacing = 0,
  children,
}: {
  testId: string;
  initial?: boolean;
  refuse?: boolean;
  uncontrolled?: boolean;
  width?: number;
  height?: number;
  fill?: boolean;
  maxWidth?: number;
  anchorWidth?: number;
  anchorHeight?: number;
  topSpacing?: number;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(initial);
  setters.set(testId, setOpen);
  return (
    <View style={topSpacing > 0 ? { marginTop: topSpacing } : undefined}>
      <Popover
        testID={testId}
        hybridRef={captureHybrid(testId)}
        isPresented={open}
        onIsPresentedChange={
          uncontrolled
            ? undefined
            : (next) => {
                eventLog.push(`${testId}:presented:${String(next)}`);
                if (!refuse) setOpen(next);
              }
        }
        onDismiss={() => eventLog.push(`${testId}:dismiss`)}
        maxWidth={maxWidth}
        anchor={
          <View
            testID={`${testId}-anchor`}
            style={{
              width: anchorWidth,
              height: anchorHeight,
              backgroundColor: '#e5e5ea',
            }}
          />
        }
      >
        {children ?? (
          <Content testId={testId} width={width} height={height} fill={fill} />
        )}
      </Popover>
    </View>
  );
}

/** A tooltip whose `isPresented` lives in a parent, as `Stage` holds a popover's. */
function TipStage({ testId }: { testId: string }) {
  const [open, setOpen] = useState(false);
  setters.set(testId, setOpen);
  return (
    <Tooltip
      testID={testId}
      hybridRef={(view: TipHandle) => tips.set(testId, view)}
      isPresented={open}
      onIsPresentedChange={(next) => {
        eventLog.push(`${testId}:presented:${String(next)}`);
        setOpen(next);
      }}
      message="Both up at once"
    >
      <View style={{ width: 96, height: 34, backgroundColor: '#e5e5ea' }} />
    </Tooltip>
  );
}

/** The stage, plus a probe that can outlive it, and a switch that drops it. */
function DropScene({
  testId,
  initial = false,
  ...rest
}: {
  testId: string;
  initial?: boolean;
  width?: number;
  height?: number;
  maxWidth?: number;
}) {
  const [shown, setShown] = useState(true);
  setters.set(`${testId}:shown`, setShown);
  return (
    <>
      <Stage testId={`${testId}-probe`} />
      {shown ? <Stage testId={testId} initial={initial} {...rest} /> : null}
    </>
  );
}

type Report = Record<string, string>;

function parseReport(raw: string): Report {
  const report: Report = { raw };
  for (const pair of raw.split(';')) {
    const at = pair.indexOf('=');
    if (at > 0) report[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return report;
}

function reportOf(testId: string): Report {
  return parseReport(handles.get(testId)?.nuiTestStateReport() ?? '');
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
  timeoutMs = 10000
): Promise<T> {
  const deadline = nitroUiCore.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value != null) return value;
    if (nitroUiCore.now() > deadline) throw failure();
    await sleep(25);
  }
}

async function requireHandle(testId: string): Promise<PopoverHandle> {
  return waitForHandle(() => handles.get(testId), { what: `"${testId}"` });
}

/** Poll until `testId`'s report satisfies `check`; fail naming what it last said. */
async function waitForReport(
  testId: string,
  check: (report: Report) => boolean,
  what: string,
  timeoutMs = 10000
): Promise<Report> {
  return pollUntil(
    () => {
      const report = reportOf(testId);
      return check(report) ? report : null;
    },
    () =>
      new Error(
        `"${testId}" never reached ${what}; its report is "${reportOf(testId).raw}"`
      ),
    timeoutMs
  );
}

/**
 * Poll for a report built after this call. iOS returns the report it built last and asks
 * the main thread for the next, so only a report with a higher `seq` is accepted.
 */
async function waitForFreshReport(
  testId: string,
  check: (report: Report) => boolean,
  what: string,
  timeoutMs = 10000
): Promise<Report> {
  const now = Number(reportOf(testId).seq ?? '0');
  return waitForReport(
    testId,
    (r) => Number(r.seq ?? '0') > now && check(r),
    what,
    timeoutMs
  );
}

/** The same reads for a `BottomSheet`'s or a `Tooltip`'s handle. */
function reportOfHandle(
  map: Map<string, { nuiTestStateReport(): string }>,
  testId: string
): Report {
  return parseReport(map.get(testId)?.nuiTestStateReport() ?? '');
}

async function waitForHandleReport(
  map: Map<string, { nuiTestStateReport(): string }>,
  testId: string,
  check: (report: Report) => boolean,
  what: string,
  timeoutMs = 10000,
  fresh = false
): Promise<Report> {
  const start = fresh ? Number(reportOfHandle(map, testId).seq ?? '0') : -1;
  return pollUntil(
    () => {
      const report = reportOfHandle(map, testId);
      if (Number(report.seq ?? '0') <= start) return null;
      return check(report) ? report : null;
    },
    () =>
      new Error(
        `"${testId}" never reached ${what}; its report is "${
          reportOfHandle(map, testId).raw
        }"; events=[${eventLog.join(',')}]`
      ),
    timeoutMs
  );
}

/** Wait until Fabric has dropped `testId`'s view: its own drop count moved past `before`. */
async function waitForDropped(testId: string, before: Report) {
  await waitForReport(
    testId,
    (r) => num(r, 'drops') > num(before, 'drops'),
    'its view dropped by Fabric'
  );
}

async function waitForEvent(entry: string, timeoutMs = 10000) {
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
        `"${testId}"'s content never laid out ${what}: ${JSON.stringify(
          layouts.get(testId) ?? null
        )}; report "${reportOf(testId).raw}"`
      )
  );
}

async function waitForUnmount(testId: string, count: number, what: string) {
  await pollUntil(
    () => ((unmounts.get(testId) ?? 0) >= count ? true : null),
    () =>
      new Error(
        `"${testId}" never counted ${what}: mounts=${String(
          mounts.get(testId) ?? 0
        )}, unmounts=${String(unmounts.get(testId) ?? 0)}`
      )
  );
}

/**
 * The popover is up: the handshake says presented, the platform says the window is
 * there, and the presentation has been counted once.
 */
const isUp = (report: Report) =>
  report.presented === '1' &&
  report.onScreen === '1' &&
  num(report, 'askedW') > 0 &&
  num(report, 'askedH') > 0 &&
  num(report, 'presentCount') >= 1;

/**
 * Nothing of this popover is on screen. `onScreen` means "React asked for this" on Android
 * and "the presentation is up" on iOS, so each platform checks its own fields.
 */
const nothingUp = (report: Report) =>
  num(report, 'presentCount') === 0 &&
  (IOS
    ? num(report, 'onScreen') === 0 && num(report, 'inPopover') === 0
    : num(report, 'inPopup') === 0 && num(report, 'draws') === 0);

/** Assert a report field says yes, naming the whole report when it does not. */
function requireYes(report: Report, field: string, what: string): void {
  if (report[field] !== '1') {
    throw new Error(
      `${what}: "${field}" is "${report[field] ?? '-'}" in "${report.raw}"`
    );
  }
}

async function waitForUp(testId: string, timeoutMs = 10000): Promise<Report> {
  return waitForReport(testId, isUp, 'a popover on screen', timeoutMs);
}

/**
 * A report taken after the drawn sizes have been sampled: iOS samples frames for a second
 * after the present, and Android has to have seen its popup draw twice. The first report
 * that says "up" is built before any frame was sampled.
 */
async function waitForDrawnSample(
  testId: string,
  timeoutMs = 20000
): Promise<Report> {
  await waitForUp(testId, timeoutMs);
  return waitForFreshReport(
    testId,
    (r) =>
      isUp(r) &&
      num(r, IOS ? 'visibleFrames' : 'draws') > 1 &&
      (IOS ? r.sampling === '0' : num(r, 'firstDrawMs') >= 0),
    IOS ? 'a finished frame sample' : 'two drawn frames',
    timeoutMs
  );
}

/** A plain mount whose only job is to read the process-wide counts. */
async function probe(): Promise<string> {
  const probeId = `probe-${String(nitroUiCore.now())}`;
  await render(<Stage testId={probeId} />);
  await requireHandle(probeId);
  await waitForReport(probeId, (r) => r.raw !== '', 'a report');
  return probeId;
}

/**
 * Nothing of any popover is left anywhere: no presentation counted, no window, and on
 * iOS no controller and no touch root beyond the baseline. Android's `lifecycleObservers`
 * is not compared: it is the Activity's own count and rises as the app mounts anything.
 */
const nothingLeft = (baseline: Report) => (report: Report) =>
  report.live === '0' &&
  (IOS
    ? report.windows === '0' &&
      num(report, 'controllers') <= num(baseline, 'controllers') &&
      num(report, 'touchRoots') <= num(baseline, 'touchRoots')
    : report.roots === '0');

/** No popover window is left anywhere, read through a live mount. */
async function waitForNothingLeft(testId: string, what: string) {
  const baseline = await waitForReport(
    testId,
    (r) => r.raw !== '' && r.live === '0',
    'a baseline with nothing up'
  );
  await waitForFreshReport(
    testId,
    nothingLeft(baseline),
    `nothing left (${what})`
  );
  return baseline;
}

type Rect = { x: number; y: number; width: number; height: number };

/** `x,y,w,h` from a report field, or `null` for `-`. */
function rectOf(field: string | undefined): Rect | null {
  if (field == null || field === '-') return null;
  const [x, y, width, height] = field.split(',').map(Number);
  if ([x, y, width, height].some((n) => n == null || Number.isNaN(n))) {
    return null;
  }
  return { x: x!, y: y!, width: width!, height: height! };
}

function reset() {
  cleanup();
  handles.clear();
  sheets.clear();
  tips.clear();
  setters.clear();
  layouts.clear();
  mounts.clear();
  unmounts.clear();
  eventLog.length = 0;
}

/** Forget the events so far, without touching the fixtures. */
function clearEvents() {
  eventLog.length = 0;
}

/** The density the report's px fields are in: points on iOS, device px on Android. */
function scaleOf(report: Report): number {
  if (IOS) return 1;
  const density = Number(report.density ?? '0');
  return density > 0 ? density : 1;
}

/** The box native asked the platform for, in the same units the draw witness uses. */
function askedPx(report: Report): { w: number; h: number } {
  const scale = scaleOf(report);
  return {
    w: Math.round(num(report, 'askedW') * scale),
    h: Math.round(num(report, 'askedH') * scale),
  };
}

/** The first and last drawn sizes, in the same units. */
function drawn(report: Report): {
  first: string;
  last: string;
  distinct: string[];
} {
  if (IOS) {
    return {
      first: `${report.firstW}x${report.firstH}`,
      last: `${report.finalW}x${report.finalH}`,
      distinct: (report.sizes ?? '').split(',').filter((s) => s !== ''),
    };
  }
  return {
    first: report.firstDraw ?? '0x0',
    last: report.lastDraw ?? '0x0',
    distinct: (report.drawSizes ?? '').split(',').filter((s) => s !== ''),
  };
}

/** `WxH`, within one pixel either way. */
function isSize(value: string, w: number, h: number): boolean {
  const parts = value.split('x').map(Number);
  return (
    parts.length === 2 &&
    Math.abs(parts[0]! - w) <= 1 &&
    Math.abs(parts[1]! - h) <= 1
  );
}

describe('Popover', () => {
  afterEach(async () => {
    reset();
    // Let a window a test left behind finish leaving before the next one counts.
    await sleep(700);
  });

  describe('the first frame is the final size (D44)', () => {
    // The two capped fixtures ask for more than their cap, not for `100%`: a popover has
    // no width of its own until its content gives it one.
    const fixtures: {
      name: string;
      width: number;
      height: number;
      maxWidth?: number;
    }[] = [
      { name: 'narrow', width: 148, height: 96 },
      { name: 'tall', width: 220, height: 244 },
      { name: 'short', width: 276, height: 52 },
      { name: 'capped', width: 300, height: 120, maxWidth: 224 },
      { name: 'window-capped', width: 400, height: 84, maxWidth: 4000 },
    ];

    for (const fixture of fixtures) {
      it(`presents "${fixture.name}" at its box, with one drawn size`, async () => {
        const id = `size-${fixture.name}`;
        await render(
          <Stage
            testId={id}
            initial
            width={fixture.width}
            height={fixture.height}
            maxWidth={fixture.maxWidth}
          />
        );
        await requireHandle(id);
        const box = await settledLayout(
          id,
          (l) => l.width > 0 && l.height > 0,
          'a box at all'
        );
        const up = await waitForDrawnSample(id);
        const scale = scaleOf(up);
        expect(num(up, 'children')).toBe(1);
        requireYes(
          up,
          IOS ? 'inPopover' : 'inPopup',
          'the content moved into the popover'
        );
        const asked = askedPx(up);
        // What native asked for is what Yoga laid out, capped at `maxWidth`.
        const cap = num(up, 'maxWidth');
        expect(
          Math.abs(num(up, 'askedW') - Math.min(box.width, cap))
        ).toBeLessThanOrEqual(1);
        expect(Math.abs(num(up, 'askedH') - box.height)).toBeLessThanOrEqual(1);
        expect(cap).toBeLessThanOrEqual((fixture.maxWidth ?? 320) + 1);
        expect(num(up, 'askedW')).toBeLessThanOrEqual(cap + 1);
        expect(
          Math.abs(num(up, 'contentW') * scale - asked.w)
        ).toBeLessThanOrEqual(1);
        expect(
          Math.abs(num(up, 'contentH') * scale - asked.h)
        ).toBeLessThanOrEqual(1);
        // One size, from the first frame to the last, and it is the box.
        const seen = drawn(up);
        expect(seen.distinct).toHaveLength(1);
        expect(isSize(seen.distinct[0] ?? '', asked.w, asked.h)).toBe(true);
        expect(isSize(seen.first, asked.w, asked.h)).toBe(true);
        expect(isSize(seen.last, asked.w, asked.h)).toBe(true);
        // "One size" has to cover more than a single sampled frame.
        expect(num(up, IOS ? 'visibleFrames' : 'draws')).toBeGreaterThan(1);
        expect(num(up, 'presentCount')).toBe(1);
        // iOS counts its polling turns for a layout (it stops at 60); Android counts the
        // compositions it refused to build a popup from.
        expect(num(up, 'contentWaits')).toBeLessThan(IOS ? 12 : 24);
        console.log(
          `first frame "${fixture.name}": asked=${String(asked.w)}x${String(
            asked.h
          )}, contentWaits=${String(up.contentWaits)}, firstDrawMs=${String(
            up.firstDrawMs ?? '-'
          )}, frames=${String(up.visibleFrames ?? up.draws)}`
        );
      });
    }
  });

  it('caps the content at the smaller of maxWidth and the window less its margins', async () => {
    const probeId = await probe();
    await waitForReport(
      probeId,
      (r) => r.raw !== '' && r.live === '0',
      'a baseline with nothing up'
    );
    // With no useful `maxWidth`, the cap is the window less its margins.
    const wide = 'cap-wide';
    await render(
      <Stage testId={wide} initial maxWidth={4000} width={400} height={70} />
    );
    await requireHandle(wide);
    const up = await waitForUp(wide);
    const layout = await settledLayout(
      wide,
      (l) => l.width > 100,
      'a box of its own'
    );
    expect(num(up, 'maxWidth')).toBeLessThan(4000);
    expect(layout.width).toBeGreaterThan(num(up, 'maxWidth'));
    expect(num(up, 'askedW')).toBe(Math.round(num(up, 'maxWidth')));
    expect(Math.abs(num(up, 'askedW') - num(up, 'nodeW'))).toBeLessThanOrEqual(
      1
    );

    // And with a `maxWidth` smaller than the window's share, that is the cap.
    const narrow = 'cap-narrow';
    await render(
      <Stage testId={narrow} initial maxWidth={210} width={300} height={64} />
    );
    await requireHandle(narrow);
    const second = await waitForUp(narrow);
    expect(num(second, 'maxWidth')).toBe(210);
    expect(num(second, 'askedW')).toBeGreaterThanOrEqual(209);
    expect(num(second, 'askedW')).toBeLessThanOrEqual(211);
  });

  it('presents content that sizes itself after native stopped waiting', async () => {
    // Both platforms wait a bounded number of turns for a box before presenting. This
    // box arrives after that wait.
    const id = 'late-box';
    await render(
      <Stage testId={id} initial>
        <LateContent testId={id} width={184} height={112} delayMs={2500} />
      </Stage>
    );
    await requireHandle(id);
    // Past iOS's 60 turns (about 1 s) and before the box: nothing is up, and the ask
    // still stands.
    await sleep(1700);
    const waiting = reportOf(id);
    expect(waiting.presented).toBe('1');
    expect(nothingUp(waiting)).toBe(true);
    const up = await waitForUp(id, 15000);
    expect(num(up, 'presentCount')).toBe(1);
    // And it comes up at the box it finally measured, not at a default it then jumps from.
    const settled = await waitForDrawnSample(id);
    const scale = scaleOf(settled);
    const asked = askedPx(settled);
    expect(asked.w).toBe(Math.round(184 * scale));
    expect(asked.h).toBe(Math.round(112 * scale));
    const seen = drawn(settled);
    expect(seen.distinct).toHaveLength(1);
    expect(isSize(seen.first, asked.w, asked.h)).toBe(true);
  });

  it('follows the content when it resizes while the popover is up', async () => {
    // Two checks per platform: the size the platform was told, and the frame it drew.
    const id = 'grows';
    const width = 180;
    const grownHeight = 208;
    await render(
      <Stage testId={id} initial width={width} height={92}>
        <GrowingContent
          testId={id}
          width={width}
          height={92}
          grownHeight={grownHeight}
        />
      </Stage>
    );
    await requireHandle(id);
    const up = await waitForUp(id);
    expect(num(up, 'presentCount')).toBe(1);
    expect(Math.abs(num(up, 'askedH') - 92)).toBeLessThanOrEqual(1);
    // `prefH` is the number UIKit was given. UIKit may round its own `viewH`, so that is
    // compared as a delta further down.
    const beforeViewH = IOS ? num(up, 'viewH') : 0;
    if (IOS) {
      expect(Math.abs(num(up, 'prefH') - 92)).toBeLessThanOrEqual(1);
    }

    setters.get(`${id}:grown`)?.(true);
    await settledLayout(
      id,
      (l) => Math.abs(l.height - grownHeight) <= 1,
      `at its grown height of ${String(grownHeight)}`
    );
    const scale = scaleOf(up);
    const grownPx = Math.round(grownHeight * scale);
    // Android's `askedH` follows the content. iOS's is the box at present time and never
    // moves; its live number is `prefH`.
    const grownReport = await waitForFreshReport(
      id,
      (r) =>
        IOS
          ? Math.abs(num(r, 'prefH') - grownHeight) <= 1 &&
            num(r, 'viewH') - beforeViewH >= grownHeight - 92 - 2
          : Math.abs(num(r, 'askedH') - grownHeight) <= 1 &&
            isSize(r.lastDraw ?? '', Math.round(width * scale), grownPx),
      'the popover at the content height it grew to',
      12000
    );
    // The drawn frame moved too, and it is still the same presentation: a resize that
    // closed and reopened the popover would also reach the new size.
    const last = drawn(grownReport).last.split('x').map(Number);
    expect(Math.abs((last[1] ?? 0) - grownPx)).toBeLessThanOrEqual(2);
    const box = rectOf(grownReport.popRect);
    expect(box).not.toBeNull();
    expect(Math.abs(box!.height - grownPx)).toBeLessThanOrEqual(2);
    expect(num(grownReport, 'presentCount')).toBe(1);
    // This mount's own fields, not the process-wide `live`: iOS only raises `live` when
    // UIKit's entry transition ends, and this popover can still be animating in.
    requireYes(grownReport, 'onScreen', 'the grown popover is still on screen');
    requireYes(
      grownReport,
      IOS ? 'inPopover' : 'inPopup',
      'its content is still inside it'
    );
  });

  it('opens below its anchor, and above it when there is no room below', async () => {
    const below = 'place-below';
    await render(<Stage testId={below} initial />);
    await requireHandle(below);
    // The platform reports the window before the frame it was given, so wait for a report
    // that has both.
    const up = await waitForReport(
      below,
      (r) => isUp(r) && rectOf(r.popRect) != null,
      'a popover on screen with a frame',
      12000
    );
    const anchor = rectOf(up.anchorRect);
    const popup = rectOf(up.popRect);
    expect(anchor).not.toBeNull();
    expect(popup).not.toBeNull();
    const scale = scaleOf(up);
    if (IOS) {
      // UIKit puts the arrow on the anchor's far side and points at it: the popover is
      // either wholly below or wholly above, and its arrow names which.
      expect(['up', 'down']).toContain(up.arrow);
      const pointsDown = up.arrow === 'down';
      const expected = pointsDown
        ? popup!.y + popup!.height <= anchor!.y + 2
        : popup!.y >= anchor!.y + anchor!.height - 2;
      expect(expected).toBe(true);
      expect(
        Math.abs(popup!.x + popup!.width / 2 - (anchor!.x + anchor!.width / 2))
      ).toBeLessThan(Math.max(anchor!.width, 40) + 24);
    } else {
      // Below the anchor and start-aligned, pulled in to the 16 dp window margin when the
      // anchor sits at the edge, as this one does.
      expect(popup!.y).toBeGreaterThanOrEqual(anchor!.y + anchor!.height - 2);
      expect(
        Math.abs(popup!.x - Math.max(anchor!.x, 16 * scale))
      ).toBeLessThanOrEqual(2);
      expect(num(up, 'placed')).toBeGreaterThanOrEqual(1);
    }

    const above = 'place-above';
    await render(
      <Stage
        testId={above}
        initial
        height={260}
        topSpacing={640}
        anchorHeight={40}
      />
    );
    await requireHandle(above);
    const flipped = await waitForReport(
      above,
      (r) => isUp(r) && rectOf(r.popRect) != null,
      'the popover that had no room below',
      12000
    );
    const highAnchor = rectOf(flipped.anchorRect)!;
    const highPopup = rectOf(flipped.popRect)!;
    expect(highPopup.y + highPopup.height).toBeLessThanOrEqual(
      highAnchor.y + 2
    );
  });

  describe('the handshake', () => {
    it('closes like a tap outside does: onIsPresentedChange(false), then onDismiss', async () => {
      await render(<Stage testId="close" initial />);
      await requireHandle('close');
      await waitForUp('close');
      handles.get('close')?.nuiTestDismiss();
      await waitForEvent('close:dismiss');
      await waitForReport(
        'close',
        (r) => r.live === '0' && r.presented === '0',
        'closed',
        12000
      );
      expect(eventLog).toEqual(['close:presented:false', 'close:dismiss']);
      expect(reportOf('close').userDismissals).toBe('1');
      expect(reportOf('close').unasked).toBe('0');
      expect(handles.get('close')?.mostRecentEventCount).toBe(1);
      await waitForUnmount('close', 1, 'its content unmounted');
    });

    it('presents again when the app refuses the close', async () => {
      await render(<Stage testId="refuse" initial refuse />);
      await requireHandle('refuse');
      await waitForUp('refuse');
      handles.get('refuse')?.nuiTestDismiss();
      await waitForEvent('refuse:presented:false');
      const again = await waitForReport(
        'refuse',
        (r) => isUp(r) && r.presentCount === '2',
        'up again (presentCount=2)',
        12000
      );
      // The app never stopped asking for the popover, so its content never unmounted.
      expect(unmounts.get('refuse') ?? 0).toBe(0);
      expect(again.userDismissals).toBe('1');
    });

    it('presents again when nothing is listening for the close', async () => {
      await render(<Stage testId="unheard" initial uncontrolled />);
      await requireHandle('unheard');
      await waitForUp('unheard');
      handles.get('unheard')?.nuiTestDismiss();
      const again = await waitForReport(
        'unheard',
        (r) => isUp(r) && r.presentCount === '2',
        'up again (presentCount=2)',
        12000
      );
      expect(again.userDismissals).toBe('1');
      // With no listener no close reaches JS, but the dismiss is still reported and the
      // event count still moves, so the next `isPresented` is not refused as stale.
      await waitForEvent('unheard:dismiss', 12000);
      expect(eventLog.filter((e) => e.startsWith('unheard:'))).toEqual([
        'unheard:dismiss',
      ]);
      expect(handles.get('unheard')?.mostRecentEventCount).toBe(1);
    });

    it('takes a close JS asked for without an event of its own', async () => {
      await render(<Stage testId="withdraw" initial />);
      await requireHandle('withdraw');
      await waitForUp('withdraw');
      clearEvents();
      setters.get('withdraw')?.(false);
      // A close the app asked for sends no `onIsPresentedChange` back. The dismiss is the
      // only event, and it arrives once the popover has left the screen.
      await waitForEvent('withdraw:dismiss', 12000);
      await waitForReport(
        'withdraw',
        (r) => r.presented === '0' && r.onScreen === '0',
        'closed',
        12000
      );
      expect(eventLog).toEqual(['withdraw:dismiss']);
      expect(reportOf('withdraw').userDismissals).toBe('0');
      expect(reportOf('withdraw').unasked).toBe('0');
    });

    it('presents at mount once its view is in a window', async () => {
      await render(<Stage testId="at-mount" initial />);
      await requireHandle('at-mount');
      const up = await waitForUp('at-mount');
      expect(up.presentCount).toBe('1');
      expect(up.anchored).toBe('1');
    });
  });

  describe('lifetime', () => {
    // Fifty open/close cycles in five tests of ten: react-native-harness has one timeout
    // for every test, and fifty animated cycles do not fit in it.
    let cyclesBaseline: Report | null = null;
    let cycles = 0;

    for (let round = 0; round < 5; round += 1) {
      it(`cycles 10 more times (round ${String(round + 1)})`, async () => {
        // The probe has to be in this test's own tree, or it reports one that was torn
        // down before the round started.
        await render(
          <>
            <Stage testId="cycles-probe" />
            <Stage testId="cycles" />
          </>
        );
        await requireHandle('cycles-probe');
        await requireHandle('cycles');
        if (cyclesBaseline == null) {
          cyclesBaseline = await waitForReport(
            'cycles-probe',
            (r) => r.raw !== '' && r.live === '0',
            'a baseline with nothing up'
          );
        }
        // Read, not assumed: a round after one that failed mid-loop inherits its counters.
        const unmountBase = unmounts.get('cycles') ?? 0;
        for (let cycle = 0; cycle < 10; cycle += 1) {
          eventLog.length = 0;
          setters.get('cycles')?.(true);
          await waitForUp('cycles', 12000);
          setters.get('cycles')?.(false);
          await waitForEvent('cycles:dismiss', 12000);
          // The unmount has to commit before the next open, or the two updates are one
          // batch and the content is never dropped at all.
          await waitForUnmount(
            'cycles',
            unmountBase + cycle + 1,
            `unmounted ${String(unmountBase + cycle + 1)} times`
          );
          cycles += 1;
        }
        expect(mounts.get('cycles') ?? 0).toBe(10);
        expect(unmounts.get('cycles') ?? 0).toBe(10);
        if (round === 4) {
          expect(cycles).toBe(50);
          await waitForFreshReport(
            'cycles-probe',
            nothingLeft(cyclesBaseline ?? reportOf('cycles-probe')),
            'nothing left after 50 cycles',
            12000
          );
        }
      });
    }

    for (const delay of [0, 80, 150]) {
      it(`leaves nothing when dropped ${delay} ms into the entry`, async () => {
        // The probe is mounted before the drop and stays mounted, so it can never be the
        // view the recycle pool hands back to a later mount.
        const id = `drop-${String(delay)}`;
        await render(<DropScene testId={id} />);
        await requireHandle(id);
        const probeId = `${id}-probe`;
        await requireHandle(probeId);
        const baseline = await waitForReport(
          probeId,
          (r) => r.raw !== '' && r.live === '0',
          'a baseline with nothing up'
        );
        const before = await waitForReport(id, (r) => r.raw !== '', 'a report');
        setters.get(id)?.(true);
        if (delay > 0) await sleep(delay);
        setters.get(`${id}:shown`)?.(false);
        await waitForDropped(id, before);
        await waitForFreshReport(
          probeId,
          nothingLeft(baseline),
          `nothing left after a drop at ${String(delay)} ms`,
          12000
        );
      });
    }

    it('takes the content back from a popover that never got up', async () => {
      // `fill` content asks for `100%` of a box that has no width until the content gives
      // it one, so no popover is ever built. Closing still has to unmount the content.
      const id = 'never-up';
      await render(<Stage testId={id} fill />);
      await requireHandle(id);
      await waitForReport(id, (r) => r.raw !== '', 'a report');
      setters.get(id)?.(true);
      const waiting = await waitForReport(
        id,
        (r) =>
          r.presented === '1' &&
          nothingUp(r) &&
          num(r, 'askedW') === 0 &&
          num(r, 'contentWaits') > 0,
        'an ask that waited for a box and got none',
        20000
      );
      expect(num(waiting, 'presentCount')).toBe(0);
      expect(mounts.get(id)).toBe(1);
      setters.get(id)?.(false);
      await waitForUnmount(id, 1, 'its content after a close with nothing up');
      // A withdrawal is not a dismissal: the app asked for the close, so no event.
      expect(eventLog).toEqual([]);
    });

    it('reports nothing for a popover dropped while it is presented (D44 item 2)', async () => {
      const id = 'drop-open';
      // Mounted closed and opened by hand: with `initial` the popover presents in the
      // same commit as the probe, and the baseline below would race that presentation.
      await render(<DropScene testId={id} />);
      await requireHandle(id);
      const probeId = `${id}-probe`;
      await requireHandle(probeId);
      const baseline = await waitForReport(
        probeId,
        (r) => r.raw !== '' && r.live === '0',
        'a baseline with nothing up',
        20000
      );
      setters.get(id)?.(true);
      await waitForUp(id);
      const before = reportOf(id);
      clearEvents();
      setters.get(`${id}:shown`)?.(false);
      await waitForDropped(id, before);
      await waitForFreshReport(
        probeId,
        nothingLeft(baseline),
        'nothing left after a drop of an open popover',
        12000
      );
      // An unmounted popover closes silently: its handlers are gone.
      expect(eventLog).toEqual([]);
    });

    it('gives a recycled view none of its previous popover', async () => {
      await render(<Stage testId="old" initial width={260} height={180} />);
      await requireHandle('old');
      await waitForUp('old');
      reset();
      await render(<Stage testId="new" />);
      await requireHandle('new');
      const fresh = await waitForReport(
        'new',
        (r) => r.presented === '0',
        'closed'
      );
      expect(fresh.presentCount).toBe('0');
      expect(fresh.askedW).toBe('0');
      expect(fresh.askedH).toBe('0');
      expect(fresh.contentW).toBe('0');
      setters.get('new')?.(true);
      const up = await waitForUp('new');
      expect(up.presentCount).toBe('1');
      await settledLayout(
        'new',
        (l) => Math.abs(l.height - 90) <= 1,
        'at its own 90'
      );
      // Whether the pool handed the old view back is logged, not asserted: the claims
      // above hold either way.
      console.log(
        `recycle: new view drops=${up.drops ?? '?'} recycles=${up.recycles ?? '?'}`
      );
    });
  });

  describe('over an RN Modal', () => {
    it('presents inside a Modal and closes cleanly before the Modal does', async () => {
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
      await render(
        <>
          <Stage testId="modal-probe" />
          <InModal />
        </>
      );
      await requireHandle('modal-probe');
      const baseline = await waitForReport(
        'modal-probe',
        (r) => r.raw !== '' && r.live === '0',
        'a baseline with nothing up',
        20000
      );
      // Opened here, not at mount, so the baseline above does not race the presentation.
      await requireHandle('in-modal');
      setters.get('in-modal')?.(true);
      const up = await waitForUp('in-modal', 15000);
      expect(up.presentCount).toBe('1');
      expect(up.anchored).toBe('1');
      // Android places the popup in the anchor's window, which inside a `Modal` is not the
      // app's own.
      const placed = await waitForReport(
        'in-modal',
        (r) => isUp(r) && rectOf(r.popRect) != null,
        'the popover inside the Modal, with the frame it was given',
        15000
      );
      const popup = rectOf(placed.popRect)!;
      const anchor = rectOf(placed.anchorRect)!;
      expect(popup.y).toBeGreaterThanOrEqual(anchor.y + anchor.height - 2);
      expect(popup.height).toBeGreaterThan(0);
      if (!IOS) {
        // Android is start-aligned, into the 16 dp margin when the anchor is at the edge;
        // UIKit centres its arrow on the anchor instead.
        expect(
          Math.abs(popup.x - Math.max(anchor.x, 16 * scaleOf(placed)))
        ).toBeLessThanOrEqual(2);
        expect(num(placed, 'placed')).toBeGreaterThanOrEqual(1);
      }
      if (IOS) {
        // In its own window: a popover in the app's presentation chain would be taken
        // down with the `Modal`, and would make UIKit refuse the next `Modal`.
        expect(up.ownWindow).toBe('1');
        expect(num(up, 'modalHosts')).toBeGreaterThanOrEqual(1);
      }
      handles.get('in-modal')?.nuiTestDismiss();
      await waitForEvent('in-modal:dismiss');
      await waitForFreshReport(
        'modal-probe',
        nothingLeft(baseline),
        'nothing left after the popover closed inside the Modal',
        12000
      );
      // And the Modal still works: closing it now is an ordinary thing to do.
      setters.get('modal-host')?.(false);
      await sleep(700);
      await waitForNothingLeft('modal-probe', 'after the Modal closed');
    });
  });

  describe('beside another presenter', () => {
    const sheetUp = (report: Report) =>
      report.presented === '1' &&
      report.live === '1' &&
      Number(report.children) >= 1 &&
      (IOS
        ? report.onScreen === '1' && report.inSheet === '1'
        : report.sheetValue !== 'none' &&
          report.sheetValue !== 'Hidden' &&
          Number(report.inSheet) >= 1);

    const tipUp = (report: Report) =>
      report.presented === '1' &&
      (IOS ? report.onScreen === '1' : report.kind === 'plain');

    it('presents inside a presented BottomSheet, and neither takes the other down', async () => {
      // On iOS a popover given a source view from the app's own tree joins that tree's
      // presentation chain; inside a sheet it still has to get a window of its own.
      function InSheet() {
        const [sheet, setSheet] = useState(true);
        setters.set('sheet-host', setSheet);
        return (
          <BottomSheet
            testID="sheet"
            hybridRef={(view: SheetHandle) => sheets.set('sheet', view)}
            isPresented={sheet}
            onIsPresentedChange={(next) => {
              eventLog.push(`sheet:presented:${String(next)}`);
              setSheet(next);
            }}
            detents={['large']}
          >
            <View style={{ paddingTop: 170, paddingLeft: 64 }}>
              <Stage testId="in-sheet" />
            </View>
          </BottomSheet>
        );
      }
      await render(
        <>
          <Stage testId="sheet-probe" />
          <InSheet />
        </>
      );
      await requireHandle('sheet-probe');
      await waitForHandleReport(
        sheets,
        'sheet',
        sheetUp,
        'the sheet, open',
        20000
      );
      // The baseline is taken with the sheet up: a sheet has a controller and a touch
      // root of its own, which would otherwise be counted as the popover's remains.
      const sheetBaseline = await waitForFreshReport(
        'sheet-probe',
        (r) => r.live === '0',
        'the probe with the sheet up and no popover',
        20000
      );
      await requireHandle('in-sheet');
      setters.get('in-sheet')?.(true);
      const up = await waitForReport(
        'in-sheet',
        (r) => isUp(r) && rectOf(r.popRect) != null,
        'a popover up inside the sheet',
        20000
      );
      // Both up, and the popover in a window of its own rather than in the sheet's chain.
      expect(sheetUp(reportOfHandle(sheets, 'sheet'))).toBe(true);
      expect(num(up, 'presentCount')).toBe(1);
      expect(num(up, 'children')).toBe(1);
      if (IOS) {
        requireYes(up, 'ownWindow', 'the popover inside the sheet');
      }

      clearEvents();
      handles.get('in-sheet')?.nuiTestDismiss();
      await waitForEvent('in-sheet:dismiss');
      // Closing the popover is not closing the sheet.
      expect(sheetUp(reportOfHandle(sheets, 'sheet'))).toBe(true);
      await waitForFreshReport(
        'sheet-probe',
        nothingLeft(sheetBaseline),
        'nothing of the popover left inside the sheet',
        12000
      );
      setters.get('sheet-host')?.(false);
      await waitForHandleReport(
        sheets,
        'sheet',
        (r) => r.live === '0',
        'the sheet closed',
        20000
      );
    });

    for (const closeTooltipFirst of [true, false]) {
      it(`presents a Tooltip and a Popover together, closing the ${
        closeTooltipFirst ? 'tooltip' : 'popover'
      } first`, async () => {
        const id = `pair-${closeTooltipFirst ? 'tip-first' : 'pop-first'}`;
        await render(
          <>
            <Stage testId={`${id}-probe`} />
            <View
              style={{
                flexDirection: 'row',
                paddingTop: 220,
                paddingLeft: 60,
                gap: 24,
              }}
            >
              <Stage testId={`${id}-pop`} />
              <TipStage testId={`${id}-tip`} />
            </View>
          </>
        );
        await requireHandle(`${id}-probe`);
        const baseline = await waitForReport(
          `${id}-probe`,
          (r) => r.raw !== '' && r.live === '0',
          'a baseline with no popover up',
          20000
        );
        await requireHandle(`${id}-pop`);
        await waitForHandle(() => tips.get(`${id}-tip`), {
          what: `"${id}-tip"`,
        });
        setters.get(`${id}-pop`)?.(true);
        setters.get(`${id}-tip`)?.(true);
        const popUp = await waitForReport(
          `${id}-pop`,
          (r) => isUp(r) && rectOf(r.popRect) != null,
          'the popover up beside a tooltip',
          20000
        );
        const tipReport = await waitForHandleReport(
          tips,
          `${id}-tip`,
          tipUp,
          'the tooltip up beside a popover',
          20000
        );
        if (IOS) {
          requireYes(popUp, 'ownWindow', 'the popover beside the tooltip');
          expect(tipReport.presenter).toBe('ownWindow');
        }

        const closeTip = async () => {
          setters.get(`${id}-tip`)?.(false);
          // A tooltip's report has no `seq`, so there is no freshness check; `live` was 1
          // just above, so a 0 is new.
          await waitForHandleReport(
            tips,
            `${id}-tip`,
            (r) => r.live === '0',
            'the tooltip gone',
            15000
          );
        };
        const closePop = async () => {
          handles.get(`${id}-pop`)?.nuiTestDismiss();
          await waitForEvent(`${id}-pop:dismiss`);
        };
        if (closeTooltipFirst) {
          await closeTip();
          expect(isUp(reportOf(`${id}-pop`))).toBe(true);
          if (IOS) {
            // The tooltip opened last, so its window was key. Closing it must hand the key
            // window back to the popover, or the popover is on screen and takes no input.
            const keyBack = await waitForReport(
              `${id}-pop`,
              (r) => r.windowKey === '1',
              'the popover holding the key window again after the tooltip closed',
              10000
            );
            requireYes(
              keyBack,
              'windowKey',
              'the popover beside a closed tooltip'
            );
          }
          await closePop();
        } else {
          await closePop();
          expect(tipUp(reportOfHandle(tips, `${id}-tip`))).toBe(true);
          if (IOS) {
            // The popover was not key when it closed, so the tooltip's window has to stay
            // key rather than the app's window behind both.
            const keyBack = await waitForHandleReport(
              tips,
              `${id}-tip`,
              (r) => r.windowKey === '1',
              'the tooltip holding the key window again after the popover closed',
              10000
            );
            requireYes(
              keyBack,
              'windowKey',
              'the tooltip beside a closed popover'
            );
          }
          await closeTip();
        }
        await waitForFreshReport(
          `${id}-probe`,
          nothingLeft(baseline),
          'nothing of the pair left on screen',
          12000
        );
      });
    }
  });

  it('puts the content where the popover is, not where the anchor is', async () => {
    // A popover that left its content behind would draw an empty bubble and still pass
    // the size checks above.
    const id = 'moved';
    await render(<Stage testId={id} initial width={190} height={110} />);
    await requireHandle(id);
    const up = await waitForUp(id);
    expect(num(up, 'children')).toBe(1);
    requireYes(
      up,
      IOS ? 'inPopover' : 'inPopup',
      'the content moved into the popover'
    );
    expect(num(up, 'nodeW')).toBeGreaterThanOrEqual(num(up, 'askedW') - 1);
  });
});

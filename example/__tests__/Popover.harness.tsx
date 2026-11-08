/**
 * On-device tests for Popover (task G22, DECISIONS D44).
 *
 * A popover is a window the harness cannot tap into (H9/H10), so - as for Tooltip and
 * BottomSheet - these tests read three honest channels and drive the control through
 * seams that run the real paths:
 *
 *  - `hybridRef.nuiTestStateReport()`: what each platform actually built (the
 *    `UIPopoverPresentationController` on iOS, the composed `Popup` on Android), plus
 *    the process-wide counts that survive a drop (`live`, iOS `controllers`/`windows`/
 *    `touchRoots`, Android `roots`/`lifecycleObservers`), read through a mount that is
 *    still alive because a dropped one has nothing left to say;
 *  - the content's own `onLayout` and mount/unmount, which is Yoga's answer to "what
 *    box did native get" - the one number the no-measuring design is built on;
 *  - the events that reached JS, in order.
 *
 * The first block is the brief's headline claim: the first frame *is* the final size.
 * The witness is not an assertion about timing but a count of distinct drawn sizes
 * (iOS samples the presentation's layer every frame; Android watches its own
 * `OnDrawListener`), so a popover that resized and settled would show two sizes even
 * though its last frame looks right. The fixtures are deliberately not square and not
 * round numbers, and `contentWaits`/`firstDrawMs` say how long native waited for the
 * box, which is what a regression to "ask UIKit first" would move.
 *
 * The stranded-`Modal` hazard is *not* here: a run that reproduced it would leave RN's
 * `Modal` host over the app for every file after this one, so it lives in
 * `__tests__/isolated/PopoverModalHazard.harness.tsx`, which runs in its own app.
 */
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

/** What `hybridRef` hands back - declared, not imported (D14). */
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

/** A `BottomSheet`/`Tooltip` mount, for the fixtures that share a screen with one. */
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

/**
 * Content that has no box until `delayMs` after it mounts. The one shape of content that
 * can outlast native's wait for a layout: a lazy list, an image that sizes its own box, a
 * `Suspense` boundary that resolves after the popover was asked for.
 */
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

/**
 * Content whose own height a test changes while the popover is up: the resize D44's
 * "the popover follows its content" claim is about, told from the content's side.
 */
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
 * parent ignore every close (D33); `uncontrolled` leaves `onIsPresentedChange` off
 * altogether, which is the same refusal told from the other API.
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

/**
 * A tooltip whose `isPresented` lives in a parent, exactly as `Stage` holds a popover's -
 * the pair fixture needs the two controls opened and closed by the same kind of hand.
 */
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
 * Poll for a report built *after this call*. iOS returns the report it built last and
 * asks the main thread for the next, so a read made now can still describe the moment
 * before; `seq` says which build it is, so only a later one is accepted (G14's rule).
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

/**
 * The same two questions of a handle that is not a popover's - a `BottomSheet`'s or a
 * `Tooltip`'s, for the fixtures that share a screen with one. Same report shape, same rule
 * about only believing a build newer than the one you read.
 */
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
 * there, and the presentation has been counted once. `asked` is the box native was
 * given, which is the number every size claim below is checked against.
 */
/**
 * The popover is up: the handshake says presented, the platform says the window is
 * there, and the presentation has been counted once. Asking for the count too is what
 * keeps a caller from reading the one report where the window is up and the counter has
 * not moved yet.
 */
const isUp = (report: Report) =>
  report.presented === '1' &&
  report.onScreen === '1' &&
  num(report, 'askedW') > 0 &&
  num(report, 'askedH') > 0 &&
  num(report, 'presentCount') >= 1;

/**
 * Nothing of this popover is on screen. `onScreen` is not the same claim on both
 * platforms - Android's is "React asked for this" (`model.presented`, in
 * `nuiTestStateReport`), iOS's is "the presentation is up" (`popoverIsUp`) - so each half
 * names what its own platform witnesses instead: no counted presentation, and no window of
 * the popover's to point at.
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
 * A report whose *drawn-size witness has finished*: iOS runs its display-link sampler for
 * a second after the present and publishes once more when it stops, and Android has seen
 * its popup draw twice. The report that first says "up" is built before either platform
 * has sampled a frame, so sizes read off it describe no witness at all — the failure that
 * came back as `expected [] to have a length of 1`.
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
 * iOS no controller and no touch root beyond the baseline the probe read at the start.
 *
 * Android's `lifecycleObservers` is deliberately *not* part of the claim. It is the
 * Activity's own `LifecycleRegistry` count, and no view in this library has ever added an
 * observer to it — the whole Android suite runs on the number going up as the app mounts
 * anything, which is a claim about RN, not about a popover. It stays in the report as a
 * diagnostic (`live` and `roots` are Popover's own counters and are what the drop rule
 * needs); a full-suite run is what showed the difference, with `live=0;roots=0` sitting in
 * the same report as an observer count 13 higher than a five-rounds-older baseline.
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
    // The content sizes itself: the box is the content's own width, capped, so the two
    // capped fixtures ask for *more* than their cap rather than for `100%` of a popover
    // that has no width of its own until the content has given it one.
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
        // The content lives where the popover is, not where the anchor is: the node
        // stays behind as the anchor's neighbour and its one child is what native moves.
        expect(num(up, 'children')).toBe(1);
        requireYes(
          up,
          IOS ? 'inPopover' : 'inPopup',
          'the content moved into the popover'
        );
        const asked = askedPx(up);
        // What native asked for *is* what Yoga laid out: no measuring, no guessing, and
        // no platform default in between — except where the content asked for more than
        // the cap, which is the one case the cap exists to catch.
        const cap = num(up, 'maxWidth');
        expect(
          Math.abs(num(up, 'askedW') - Math.min(box.width, cap))
        ).toBeLessThanOrEqual(1);
        expect(Math.abs(num(up, 'askedH') - box.height)).toBeLessThanOrEqual(1);
        // And the cap is the one the wrapper promised: never wider than `maxWidth`,
        // never wider than the window less its margins.
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
        // The witness saw more than the one frame it asserts on, so "one size" is a
        // statement about a run of frames rather than about a single sample.
        expect(num(up, IOS ? 'visibleFrames' : 'draws')).toBeGreaterThan(1);
        expect(num(up, 'presentCount')).toBe(1);
        // Native waited for a layout, and got one at once: a present that went out before
        // Yoga had sized anything is the regression this number is here to catch. iOS
        // counts its polling turns and stops asking at 60; Android counts the compositions
        // it refused to build a popup from, which a healthy mount needs none or one of.
        expect(num(up, 'contentWaits')).toBeLessThan(IOS ? 12 : 24);
        // The same numbers, printed: `bench: false` means no bench row is minted for a
        // popover, and the first-frame claim has to be carried by the run that measures it.
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
    // 400 dp of content with no useful `maxWidth`: the only thing left to cap it with is
    // the window less its margins, and the box native asks for is that, not the 400.
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
    // Both platforms refuse to ask for a popover at no size, and both wait a bounded
    // number of turns for the box: iOS counts the turns and then stands down, Android
    // composes on the layout that finally comes. A box that arrives *after* the wait is
    // the case the wait cannot answer by waiting longer - iOS used to stand down for
    // good, and the app was left with `isPresented` true and nothing on screen.
    const id = 'late-box';
    await render(
      <Stage testId={id} initial>
        <LateContent testId={id} width={184} height={112} delayMs={2500} />
      </Stage>
    );
    await requireHandle(id);
    // Past iOS's 60 turns (~1 s) and before the box: still nothing up, and the ask is
    // not withdrawn - the app still wants the popover.
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
    // `docs/components/popover.md` promises a popover that grows with its content, and the
    // promise is one write per platform: iOS moves `preferredContentSize`, Android re-composes
    // the popup at the new box. Two witnesses each, because the number the platform was
    // *told* and the frame it *drew* are different claims - a write that never reaches the
    // window is exactly the bug a single assertion would miss.
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
    // `prefH` is the number UIKit was given; `viewH` is UIKit's own view, which it is free
    // to round, so what the popover does with it is measured as a delta further down.
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
    // The live number each platform holds differs by more than its name: Android's `askedH`
    // is the content box as it stands, iOS's is `sizeAtPresent` - the box the present happened,
    // which never moves - and the number iOS is *currently* told is `prefH`.
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
    // The frame the window drew moved with it, and this is still the same presentation: a
    // resize that took the popover down and put it back would pass the two lines above.
    const last = drawn(grownReport).last.split('x').map(Number);
    expect(Math.abs((last[1] ?? 0) - grownPx)).toBeLessThanOrEqual(2);
    const box = rectOf(grownReport.popRect);
    expect(box).not.toBeNull();
    expect(Math.abs(box!.height - grownPx)).toBeLessThanOrEqual(2);
    expect(num(grownReport, 'presentCount')).toBe(1);
    // And this mount still owns a presentation: the witnesses are its own, not the
    // process-wide `live`, which iOS only moves when UIKit's entry transition *ends* -
    // measured here at `live=0` beside `onScreen=1;windows=1;controllers=1`, because a
    // popover grown as fast as this one grows is still animating in.
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
    // Where the popover landed is a later fact than that it is up: the platform knows the
    // window before it knows the frame it was given, so this waits for the report that has
    // both rather than reading a report that is only half a presentation.
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
      // Our own provider: below the anchor, start-aligned — where "start" is the anchor's
      // own edge unless the window margin is closer: the fixture's anchor sits at x=0, and
      // content that hung over the edge of the screen is the one thing the margin exists
      // to prevent, so the provider pulls the popup in to 16 dp. Asserting the anchor's x
      // exactly would call that a bug.
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
      // The count went up: JS is expected to echo it, and the wrapper's
      // `mostRecentEventCount` is what native then accepts a `presented` write from.
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
      // The content never left: the app never stopped asking for the popover, so the
      // wrapper had no reason to unmount it.
      expect(unmounts.get('refuse') ?? 0).toBe(0);
      expect(again.userDismissals).toBe('1');
    });

    it('presents again when nothing is listening for the close', async () => {
      // The same refusal told from the other API: an app that passes no
      // `onIsPresentedChange` cannot be blamed for the state it was never told about,
      // and the popover still must not go out of step with `isPresented`.
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
      // Nothing reached JS as a *close* it could answer — that is what `uncontrolled`
      // means — while the presentation that ended still reported its dismiss, and the
      // event count moved so the next `isPresented` is not refused as stale.
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
      // A change React asked for is not a native interaction: the app gets no
      // `onIsPresentedChange` back for its own write (D33). The dismiss is the only event,
      // and it arrives when the popover has really left the screen, not when the write
      // landed - so the wait is the assertion, and the log then says it was only that.
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
    // Fifty open/close cycles in five tests of ten. react-native-harness 1.6 has one
    // timeout for every test — `it` takes no third argument and `testTimeout` is one
    // global number — and fifty animated popover cycles do not fit in it: the single-test
    // version of this loop died with "Test timed out after 30000ms" with four open
    // promises left behind. BottomSheet split the same loop the same way.
    let cyclesBaseline: Report | null = null;
    let cycles = 0;

    for (let round = 0; round < 5; round += 1) {
      it(`cycles 10 more times (round ${String(round + 1)})`, async () => {
        // Probe and cycling popover in one tree: the probe has to be a view of *this*
        // test's app, or it reports a tree that was torn down before the round started.
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
        // Read rather than assumed: a round whose predecessor failed mid-loop inherits
        // its counters, and has to fail naming its own ten cycles.
        const unmountBase = unmounts.get('cycles') ?? 0;
        for (let cycle = 0; cycle < 10; cycle += 1) {
          eventLog.length = 0;
          setters.get('cycles')?.(true);
          await waitForUp('cycles', 12000);
          setters.get('cycles')?.(false);
          await waitForEvent('cycles:dismiss', 12000);
          // The unmount has to commit before the next open, or the two updates are one
          // batch and the content is never dropped at all (BottomSheet's E2 lesson).
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
        // view the recycle pool hands back to a later mount (G14's lesson).
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
      // `fill` is the content that cannot be honoured: `width: '100%'` of a box that has
      // no width until the content gives it one, so neither platform ever composes a
      // popover for it. React still asked, and the wrapper still mounted the content for
      // the ask - so closing it owes the wrapper its second call, whether or not a
      // presentation ever began. iOS and BottomSheet take that debt on the ask; Android
      // took it only when a presentation ended, and this content stayed mounted forever.
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
      // same commit as the probe beside it, so the baseline below races the very
      // presentation it measures from - under load the probe's first report already
      // says `live=1` and the baseline never arrives.
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
      // BottomSheet's rule, on both platforms: an unmounted popover closes silently.
      // The app is gone, so a close event could only ever land on a dead handler - and
      // on iOS it used to be worse than nothing, because the close it *did* send
      // arrived as the app's next screen was being installed.
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
      // Whether the pool really handed the old view back is reported, not asserted: the
      // claims above hold either way, and this is the line that says which world the run
      // was in (F6's rule).
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
      // The probe is on the screen under the Modal from the start, so it is never a view
      // the recycle pool hands back after the popover went.
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
      // Opened here, not at mount: `initial` would present the popover in the same
      // commit as the probe under the Modal, and the baseline above would be reading a
      // race with it rather than a starting line. The Modal is up and settled by now,
      // which is also the case a user actually hits.
      await requireHandle('in-modal');
      setters.get('in-modal')?.(true);
      const up = await waitForUp('in-modal', 15000);
      expect(up.presentCount).toBe('1');
      expect(up.anchored).toBe('1');
      // Android places the popup inside the window the anchor is in, and a `Modal` is where
      // that window stops being the app's own: the frame the provider places against comes
      // from the host view's window, the anchor box comes from Compose, and the two are read
      // back here in a third space (both rects on screen). A popover placed in the wrong one
      // is off the Modal, not merely a few px out.
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
        // Our own provider is start-aligned (into the 16 dp margin when the anchor is at the
        // edge, as it is here); UIKit centres its arrow on the anchor instead, which the
        // placement test next door pins.
        expect(
          Math.abs(popup.x - Math.max(anchor.x, 16 * scaleOf(placed)))
        ).toBeLessThanOrEqual(2);
        expect(num(placed, 'placed')).toBeGreaterThanOrEqual(1);
      }
      if (IOS) {
        // A popover in the app's own presentation chain is what UIKit takes down when
        // the `Modal` closes - and the thing that makes the next `Modal` be refused.
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
    /** Up, by `BottomSheet.harness.tsx`'s own reading of its report. */
    const sheetUp = (report: Report) =>
      report.presented === '1' &&
      report.live === '1' &&
      Number(report.children) >= 1 &&
      (IOS
        ? report.onScreen === '1' && report.inSheet === '1'
        : report.sheetValue !== 'none' &&
          report.sheetValue !== 'Hidden' &&
          Number(report.inSheet) >= 1);

    /** Up, by `Tooltip.harness.tsx`'s own reading of its report. */
    const tipUp = (report: Report) =>
      report.presented === '1' &&
      (IOS ? report.onScreen === '1' : report.kind === 'plain');

    it('presents inside a presented BottomSheet, and neither takes the other down', async () => {
      // The sheet is the other presenter that matters for a popover: like a `Modal` it is a
      // window of its own over the app, and unlike a `Modal` it is opened by an app that
      // then expects its own popovers to work inside it. iOS has the sharp edge - give the
      // popover presentation a source view from the app's own tree and UIKit puts the
      // presentation back into that tree's chain, `ownWindow=0`, which is the residue
      // Decision 1 exists to prevent and which the popover-over-a-`Modal` case cannot see
      // because there the app's chain is not what the popover is asked to sit on.
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
      // The residue baseline is the sheet up and the popover never opened: a sheet is a
      // presenter of its own (its controller, its touch root), and `nothingLeft` compares
      // those counts, so a baseline from before the sheet would read the sheet as the
      // popover's remains.
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
        // Two of our own presentations on one screen is what an app ships (a hint and a menu
        // on the same row), and both windows are ours - so a close that strands either is
        // ours to fix. Both orders are pinned because the two go down by different paths: a
        // tooltip's is a window UIKit or Material owns, a popover's a presentation.
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
          // No `seq` in a tooltip's report, so no freshness rule: `live` was 1 a line
          // above, and 0 is a fact that could not have been true before.
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
          await closePop();
        } else {
          await closePop();
          expect(tipUp(reportOfHandle(tips, `${id}-tip`))).toBe(true);
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
    // The redirect is the design: the node stays in the app's tree as the anchor's
    // neighbour, and its one child - the content box - is what native moves into the
    // popover's own window. A popover that leaves the content behind draws an empty
    // bubble, which the size checks above would still pass.
    const id = 'moved';
    await render(<Stage testId={id} initial width={190} height={110} />);
    await requireHandle(id);
    const up = await waitForUp(id);
    expect(num(up, 'children')).toBe(1);
    // The node is not the popover: it is the content's box, and the box itself is what
    // moves - iOS puts it in the popover's own view controller, Android in the popup's
    // root — so there is never a second copy left in the app's tree.
    requireYes(
      up,
      IOS ? 'inPopover' : 'inPopup',
      'the content moved into the popover'
    );
    expect(num(up, 'nodeW')).toBeGreaterThanOrEqual(num(up, 'askedW') - 1);
  });
});

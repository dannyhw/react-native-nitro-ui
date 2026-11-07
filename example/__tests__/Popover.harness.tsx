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
import { Modal, Platform, Pressable, TextInput, View } from 'react-native';
import {
  afterEach,
  cleanup,
  describe,
  expect,
  it,
  render,
} from 'react-native-harness';
import { nitroUiCore, Popover } from 'react-native-nitro-ui';
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
}: {
  testId: string;
  width: number;
  height: number;
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
      style={{ width, height, backgroundColor: '#9ec5fe' }}
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
        {children ?? <Content testId={testId} width={width} height={height} />}
      </Popover>
    </View>
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
const isUp = (report: Report) =>
  report.presented === '1' &&
  report.onScreen === '1' &&
  num(report, 'askedW') > 0 &&
  num(report, 'askedH') > 0;

async function waitForUp(testId: string, timeoutMs = 10000): Promise<Report> {
  return waitForReport(testId, isUp, 'a popover on screen', timeoutMs);
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
 */
const nothingLeft = (baseline: Report) => (report: Report) =>
  report.live === '0' &&
  (IOS
    ? report.windows === '0' &&
      report.controllers <= baseline.controllers &&
      report.touchRoots <= baseline.touchRoots
    : report.roots === '0' &&
      (report.lifecycleObservers ?? baseline.lifecycleObservers) ===
        baseline.lifecycleObservers);

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
  const parts = field.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;
  return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
}

function reset() {
  cleanup();
  handles.clear();
  setters.clear();
  layouts.clear();
  mounts.clear();
  unmounts.clear();
  eventLog.length = 0;
}

/** Every drawn size the platform saw, as `WxH` entries (deduplicated by the witness). */
function drawnSizes(report: Report): string {
  return IOS ? report.sizes ?? '' : report.drawSizes ?? '';
}

/**
 * S5 spike only (never merged): the Popover prototype's measurements, Q7 Appendix F.
 *
 * Q1 (two-axis fit, first frame at its final size) and Q5 (lifetime). Q2-Q4 need a
 * real finger and live in `real-input:*` (`s5-popover`). Read through
 * `nuiTestStateReport()`: the per-frame sampler native runs from the present until a
 * second after it (iOS: the controller's view bounds on every display frame; Android:
 * the popup window's size on every draw), process-wide presentation counts, and on
 * Android the activity `LifecycleRegistry`'s observer count.
 *
 * Run with `HARNESS_TEST_TIMEOUT=240000`: the 50-cycle case takes longer than the
 * default 30 s.
 */
import { useState } from 'react';
import { Platform, Text, View, type LayoutRectangle } from 'react-native';
import {
  afterEach,
  cleanup,
  describe,
  expect,
  it,
  render,
} from 'react-native-harness';
import { nitroUiCore } from 'react-native-nitro-ui';

import {
  PopoverProto,
  type PopoverProtoHandle,
} from '../../src/spike/PopoverProto/PopoverProto';

const IOS = Platform.OS === 'ios';
const handles = new Map<string, PopoverProtoHandle>();
const setters = new Map<string, (next: boolean) => void>();
const layouts = new Map<string, LayoutRectangle>();
const eventLog: string[] = [];
/** Every number the tests measured, printed by the last test (see it). */
const evidence: string[] = [];

const capture = (id: string) => (view: PopoverProtoHandle) => {
  handles.set(id, view);
};

type Report = Record<string, string>;

function reportOf(id: string): Report {
  const raw = handles.get(id)?.nuiTestStateReport() ?? '';
  const report: Report = { raw };
  for (const pair of raw.split(';')) {
    const at = pair.indexOf('=');
    if (at > 0) report[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return report;
}

async function sleep(ms: number) {
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

async function waitForHandle(id: string) {
  return pollUntil(
    () => handles.get(id) ?? null,
    () => new Error(`no hybridRef handle for "${id}"`),
    10000
  );
}

async function waitForReport(
  id: string,
  check: (r: Report) => boolean,
  what: string,
  timeoutMs = 8000
) {
  // iOS reports are one behind (published on main, read without waiting): read twice.
  return pollUntil(
    () => {
      const r = reportOf(id);
      return check(r) ? r : null;
    },
    () =>
      new Error(`"${id}" never reached ${what}; report "${reportOf(id).raw}"`),
    timeoutMs
  );
}

/**
 * A report read twice, 200 ms apart: both platforms refresh some fields on main for
 * the *next* read (JS never waits for main), so the second read is the settled one.
 */
async function fresh(id: string): Promise<Report> {
  reportOf(id);
  await sleep(200);
  return reportOf(id);
}

/** Android's observer count has been read on main at least once. */
const observed = (r: Report) => IOS || (r.lifecycleObservers ?? '-1') !== '-1';

const isUp = (r: Report) =>
  r.presented === '1' && r.onScreen === '1' && r.live !== '0';

/** The sampler has finished its second and seen the popover. */
const sampled = (r: Report) =>
  IOS
    ? r.sampling === '0' && Number(r.visibleFrames ?? 0) > 10
    : Number(r.draws ?? 0) > 0 && Number(r.firstDrawMs ?? -1) >= 0;

/** The content of fixture `k`: a different width and height each time. */
function Fixture({ id, k }: { id: string; k: number }) {
  const lines = (k % 4) + 1;
  const words = ['Popover', 'content', 'is', 'React', 'Native', 'and', 'wraps'];
  return (
    <View
      style={{ padding: 8 + (k % 3) * 4 }}
      onLayout={(e) => {
        layouts.set(id, e.nativeEvent.layout);
      }}
    >
      {Array.from({ length: lines }, (_, i) => (
        <Text key={i} style={{ fontSize: 15 + (k % 2) * 3 }}>
          {words.slice(0, 2 + ((k + i) % 6)).join(' ') +
            (k >= 8 && i === 0 ? ' - ' + words.join(' ').repeat(3) : '')}
        </Text>
      ))}
    </View>
  );
}

function Stage({
  id,
  k = 0,
  sizeBeforePresent = true,
  initial = false,
  top = 200,
}: {
  id: string;
  k?: number;
  sizeBeforePresent?: boolean;
  initial?: boolean;
  top?: number;
}) {
  const [open, setOpen] = useState(initial);
  setters.set(id, setOpen);
  return (
    <View style={{ paddingTop: top, paddingLeft: 24 }}>
      <PopoverProto
        testID={id}
        hybridRef={capture(id)}
        isPresented={open}
        sizeBeforePresent={sizeBeforePresent}
        onIsPresentedChange={(next) => {
          eventLog.push(`${id}:presented:${String(next)}`);
          setOpen(next);
        }}
        anchor={
          <View style={{ width: 120, height: 40, backgroundColor: '#ccc' }} />
        }
      >
        <Fixture id={id} k={k} />
      </PopoverProto>
    </View>
  );
}

/** A plain mount whose only job is to read the process-wide counts. */
async function probe(): Promise<string> {
  const id = `probe-${String(nitroUiCore.now())}`;
  await render(<Stage id={id} />);
  await waitForHandle(id);
  return id;
}

/** Q1's verdict for one presentation: first frame, final frame, and the content box. */
function firstFrameVerdict(r: Report, layout: LayoutRectangle | undefined) {
  const expectedW = Math.ceil(layout?.width ?? -1);
  const expectedH = Math.ceil(layout?.height ?? -1);
  if (IOS) {
    const first = `${r.firstW}x${r.firstH}`;
    const final = `${r.finalW}x${r.finalH}`;
    const atContent =
      Math.abs(Number(r.finalW) - expectedW) <= 1 &&
      Math.abs(Number(r.finalH) - expectedH) <= 1;
    return {
      ok:
        first === final && (r.sizes ?? '').split(',').length === 1 && atContent,
      line: `first=${first} final=${final} sizes=${r.sizes} yoga=${expectedW}x${expectedH} frames=${r.visibleFrames} trace=${r.trace}`,
    };
  }
  const density = Number(r.density ?? 1);
  const [lw, lh] = (r.lastDraw ?? '0x0').split('x').map(Number);
  const atContent =
    Math.abs((lw ?? 0) - Math.round((layout?.width ?? 0) * density)) <= 2 &&
    Math.abs((lh ?? 0) - Math.round((layout?.height ?? 0) * density)) <= 2;
  return {
    ok:
      r.firstDraw === r.lastDraw &&
      (r.drawSizes ?? '').split(',').length === 1 &&
      atContent,
    line: `firstDraw=${r.firstDraw} lastDraw=${r.lastDraw} drawSizes=${r.drawSizes} yoga=${layout?.width}x${layout?.height}dp density=${density} draws=${r.draws} firstDrawMs=${r.firstDrawMs} trace=${r.trace}`,
  };
}

afterEach(async () => {
  cleanup();
  handles.clear();
  setters.clear();
  layouts.clear();
  eventLog.length = 0;
  await sleep(600);
});

describe('PopoverProto · Q1 two-axis fit', () => {
  it('shows its first frame at its final size, 10 of 10 contents', async () => {
    const lines: string[] = [];
    let ok = 0;
    for (let k = 0; k < 10; k++) {
      const id = `fit-${k}`;
      await render(<Stage id={id} k={k} />);
      await waitForHandle(id);
      setters.get(id)?.(true);
      const r = await waitForReport(
        id,
        (x) => isUp(x) && sampled(x),
        `fixture ${k} up and sampled`
      );
      await sleep(IOS ? 50 : 1000);
      const settled = reportOf(id);
      const verdict = firstFrameVerdict(
        settled.seq != null ? settled : r,
        layouts.get(id)
      );
      if (verdict.ok) ok += 1;
      lines.push(`k=${k} ok=${verdict.ok ? 1 : 0} ${verdict.line}`);
      setters.get(id)?.(false);
      await waitForReport(id, (x) => x.live === '0', `fixture ${k} closed`);
      cleanup();
      handles.clear();
      await sleep(300);
    }
    evidence.push(`S5 Q1 ${ok}/10\n${lines.join('\n')}`);
    expect(`${ok}/10\n${lines.join('\n')}`).toBe(
      `10/10\n${lines.join('\n')}`.replace(/ok=0/g, 'ok=1')
    );
  });

  it('sees a resize when the size arrives after the present (the oracle goes red)', async () => {
    // The built-in mutation: `sizeBeforePresent={false}` presents first and sizes after
    // (iOS: `preferredContentSize` set in the completion; Android: an estimated first
    // size, corrected 150 ms later). The same verdict must call that a resize.
    await render(<Stage id="late" k={3} sizeBeforePresent={false} />);
    await waitForHandle('late');
    setters.get('late')?.(true);
    await waitForReport('late', (x) => isUp(x) && sampled(x), 'up and sampled');
    await sleep(1200);
    const r = await waitForReport(
      'late',
      (x) => (IOS ? x.sampling === '0' : true),
      'sampled'
    );
    const verdict = firstFrameVerdict(r, layouts.get('late'));
    evidence.push(`S5 Q1 red arm: ok=${verdict.ok ? 1 : 0} ${verdict.line}`);
    expect(`ok=${verdict.ok ? 1 : 0} ${verdict.line}`).toMatch(/^ok=0 /);
  });
});

describe('PopoverProto · Q5 lifetime', () => {
  it('leaves live=0 after 50 present/dismiss cycles, and no LifecycleRegistry growth', async () => {
    await render(<Stage id="cycles" k={1} />);
    await waitForHandle('cycles');
    await sleep(300);
    await waitForReport(
      'cycles',
      (x) => x.live === '0' && observed(x),
      'nothing up'
    );
    const before = await fresh('cycles');
    for (let i = 0; i < 50; i++) {
      setters.get('cycles')?.(true);
      await waitForReport('cycles', isUp, `cycle ${i} up`);
      setters.get('cycles')?.(false);
      await waitForReport(
        'cycles',
        (x) => x.live === '0' && x.presented === '0' && x.onScreen === '0',
        `cycle ${i} down`
      );
    }
    await sleep(800);
    await waitForReport(
      'cycles',
      (x) => x.live === '0' && (IOS ? x.controllers === '0' : x.roots === '0'),
      'nothing left after 50 cycles'
    );
    const after = await fresh('cycles');
    const line = IOS
      ? `presentCount=${after.presentCount} live=${after.live} controllers=${after.controllers} touchRoots ${before.touchRoots}->${after.touchRoots} windows=${after.windows} topPresented=${after.topPresented}`
      : `presentCount=${after.presentCount} live=${after.live} roots=${after.roots} lifecycleObservers ${before.lifecycleObservers}->${after.lifecycleObservers}`;
    evidence.push(`S5 Q5 cycles: ${line}`);
    expect(line).toBe(
      IOS
        ? `presentCount=50 live=0 controllers=0 touchRoots ${before.touchRoots}->${before.touchRoots} windows=0 topPresented=-`
        : `presentCount=50 live=0 roots=0 lifecycleObservers ${before.lifecycleObservers}->${before.lifecycleObservers}`
    );
    // JS closed it every time: nothing was reported.
    expect(eventLog.join(',')).toBe('');
  });

  for (const delay of [0, 50, 100, 150]) {
    it(`leaves nothing when dropped ${String(delay)} ms into its entry`, async () => {
      const first = await probe();
      await waitForReport(
        first,
        (x) => x.live === '0' && observed(x),
        'baseline'
      );
      const baseline = await fresh(first);
      cleanup();
      handles.clear();
      const { unmount } = await render(<Stage id="dropped" k={2} />);
      await waitForHandle('dropped');
      setters.get('dropped')?.(true);
      await waitForReport(
        'dropped',
        (r) => r.presentCount === '1',
        'presenting'
      );
      await sleep(delay);
      unmount();
      handles.clear();
      const probeId = await probe();
      const r = await waitForReport(
        probeId,
        (x) =>
          x.live === '0' &&
          (IOS
            ? x.controllers === '0' &&
              x.windows === '0' &&
              x.topPresented === '-'
            : x.roots === '0'),
        `nothing left after a drop ${String(delay)} ms into the entry`
      );
      evidence.push(
        `S5 Q5 drop ${String(delay)} ms: live=${r.live} ` +
          (IOS
            ? `controllers=${r.controllers} windows=${r.windows} topPresented=${r.topPresented} touchRoots ${baseline.touchRoots}->${r.touchRoots}`
            : `roots=${r.roots} lifecycleObservers ${baseline.lifecycleObservers}->${reportOf(probeId).lifecycleObservers}`)
      );
      if (!IOS) {
        await sleep(500);
        const settled = await fresh(probeId);
        expect(`lifecycleObservers=${settled.lifecycleObservers}`).toBe(
          `lifecycleObservers=${baseline.lifecycleObservers}`
        );
      } else {
        expect(r.touchRoots).toBe(baseline.touchRoots);
      }
      expect(eventLog.join(',')).toBe('');
    });
  }

  it('gives a recycled view none of the open popover it came from', async () => {
    function Swap({ round }: { round: number | null }) {
      const old = round != null && round % 2 === 0;
      return (
        <View style={{ paddingTop: 200, paddingLeft: 40 }}>
          {round == null ? null : (
            <PopoverProto
              key={old ? 'a' : 'b'}
              testID="recycled"
              hybridRef={capture('recycled')}
              isPresented={old}
              anchor={<View style={{ width: 40, height: 40 }} />}
            >
              <Text>{old ? 'Old content' : 'New content'}</Text>
            </PopoverProto>
          )}
        </View>
      );
    }
    const { rerender } = await render(<Swap round={0} />);
    await waitForHandle('recycled');
    await waitForReport('recycled', isUp, 'the old popover up');
    const reuses: number[] = [Number(reportOf('recycled').recycles ?? NaN)];
    for (const round of [1, 2, 3]) {
      const before = Number(reportOf('recycled').recycles ?? NaN);
      const dropped = handles.get('recycled');
      handles.clear();
      if (dropped != null) handles.set('recycled-dropped', dropped);
      await rerender(<Swap round={null} />);
      await waitForReport(
        'recycled-dropped',
        (r) => Number(r.recycles ?? NaN) > before,
        `round ${String(round)}: the dropped mount in the pool`
      );
      handles.clear();
      await rerender(<Swap round={round} />);
      await waitForHandle('recycled');
      if (round % 2 === 1) {
        const r = await waitForReport(
          'recycled',
          (x) =>
            x.live === '0' && (IOS ? x.controllers === '0' : x.roots === '0'),
          `round ${String(round)} closed`
        );
        expect(r.presented).toBe('0');
        expect(r.presentCount).toBe('0');
        expect(r.children).toBe('0');
      } else {
        await waitForReport('recycled', isUp, 'reopened');
      }
      const recycles = Number(reportOf('recycled').recycles ?? NaN);
      const previous = reuses[reuses.length - 1] ?? NaN;
      reuses.push(recycles);
      if (!(recycles > previous)) {
        throw new Error(
          `round ${String(round)}: the recycle count did not grow (${reuses.join(' -> ')})`
        );
      }
    }
    // The last round left one open; drop it, then nothing may remain.
    await rerender(<Swap round={null} />);
    handles.clear();
    const probeId = await probe();
    await waitForReport(
      probeId,
      (x) => x.live === '0' && (IOS ? x.controllers === '0' : x.roots === '0'),
      'nothing left after the recycle rounds'
    );
    evidence.push(`S5 Q5 recycle rounds: ${reuses.join(',')}`);
  });
});

describe('PopoverProto · evidence', () => {
  // Red by design. The harness prints a test's output only when it fails, so a passing
  // run would keep none of the numbers above; this test fails with all of them, and the
  // gate's failure excerpt is where they are kept. The questions are the tests above,
  // each with its own pass or fail.
  it('prints every number the tests above measured (red by design)', () => {
    throw new Error(`S5 evidence (red by design):\n${evidence.join('\n')}`);
  });
});

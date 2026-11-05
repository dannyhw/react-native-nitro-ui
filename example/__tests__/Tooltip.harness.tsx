/**
 * On-device tests for Tooltip (task G18, Q7 Appendix C7).
 *
 * A tooltip is a window, and the harness cannot tap into another window
 * (`Switch.harness.tsx`, H9/H10). So these tests read two honest channels, as
 * `Dialog.harness.tsx` does:
 *
 *  - `hybridRef.nuiTestStateReport()` - what is on screen, read from what each platform
 *    actually built (the popover controller and its presentation on iOS, the composed
 *    tooltip content on Android), plus `live`, a process-wide count of tooltip windows
 *    that survives a drop (read through a fresh mount, because a dropped mount has
 *    nothing left to report);
 *  - the events that reached JS, in order (`eventLog`).
 *
 * and drive the tooltip through test seams that run the real handlers
 * (`nuiTestPerformAction`, `nuiTestDismiss`). Real taps are `real-input:*`'s job.
 *
 * The first block is the design's three early checks (Q7 C9): a tap reaches the
 * anchor through the overlay, the popup sits where the platform puts it (on Android,
 * Material's spacing) and follows its anchor on a move, and on iOS a popover presented
 * from a window of its own still points at the anchor.
 */
import { useState } from 'react';
import {
  Modal,
  PixelRatio,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type LayoutRectangle,
} from 'react-native';
import { screen, userEvent } from '@react-native-harness/ui';
import {
  afterEach,
  cleanup,
  describe,
  expect,
  it,
  render,
} from 'react-native-harness';
import {
  nitroUiCore,
  Tooltip,
  type TooltipAction,
  type TooltipPlacement,
} from 'react-native-nitro-ui';

/** What `hybridRef` hands back - declared, not imported (D14). */
type TooltipHandle = {
  readonly presented: boolean;
  readonly mostRecentEventCount: number;
  nuiTestStateReport(): string;
  nuiTestPerformAction(id: string): void;
  nuiTestDismiss(): void;
};

const IOS = Platform.OS === 'ios';
const handles = new Map<string, TooltipHandle>();
const captureHybrid =
  (testId: string) =>
  (view: TooltipHandle): void => {
    handles.set(testId, view);
  };

/** Every event the app received, in order: `testID:action:<id>` / `testID:presented:<bool>`. */
const eventLog: string[] = [];

/** The parent's `isPresented` setters, by testID, so a test can play the app. */
const setters = new Map<string, (next: boolean) => void>();

/** The wrappers' boxes, by testID, as React Native laid them out. */
const layouts = new Map<string, LayoutRectangle>();

const ACTIONS: TooltipAction[] = [{ id: 'ok', title: 'Got it' }];

/**
 * A tooltip whose `isPresented` lives in a parent, as an app's would. `refuse` makes
 * the parent ignore every close (the D33 refusal case); otherwise the parent follows
 * `onIsPresentedChange`. The anchor is a box of a known size.
 */
function Stage({
  testId,
  initial = false,
  refuse = false,
  title = 'Saved searches',
  message = 'Tap the star to keep this search.',
  actions = ACTIONS,
  placement,
  anchorWidth = 40,
  anchorHeight = 40,
  children,
}: {
  testId: string;
  initial?: boolean;
  refuse?: boolean;
  title?: string;
  message?: string;
  actions?: TooltipAction[];
  placement?: TooltipPlacement;
  anchorWidth?: number;
  anchorHeight?: number;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(initial);
  setters.set(testId, setOpen);
  return (
    <Tooltip
      testID={testId}
      hybridRef={captureHybrid(testId)}
      isPresented={open}
      onIsPresentedChange={(next) => {
        eventLog.push(`${testId}:presented:${String(next)}`);
        if (!refuse) setOpen(next);
      }}
      onAction={(id) => {
        eventLog.push(`${testId}:action:${id}`);
      }}
      title={title}
      message={message}
      actions={actions}
      placement={placement}
      onLayout={(event) => {
        layouts.set(testId, event.nativeEvent.layout);
      }}
    >
      {children ?? (
        <View
          style={{
            width: anchorWidth,
            height: anchorHeight,
            backgroundColor: '#e5e5ea',
          }}
        />
      )}
    </Tooltip>
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

async function waitForHandle(testId: string): Promise<TooltipHandle> {
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
        `"${testId}" never reached ${what}; its report is "${reportOf(testId).raw}"`
      ),
    timeoutMs
  );
}

/** Up: native shows it, iOS has the popover on screen, Android composed its content. */
const isUp = (report: Report) =>
  report.presented === '1' &&
  (IOS
    ? report.onScreen === '1'
    : report.kind === 'rich' || report.kind === 'plain');

/** Up, and counted: the count goes up in the presentation's completion on iOS. */
const isUpCounted = (count: number) => (report: Report) =>
  isUp(report) && report.live === String(count);

/** The process-wide window count is back to `count`, read through `testId`. */
async function waitForLive(testId: string, count: number, what: string) {
  return waitForReport(
    testId,
    (r) => r.live === String(count),
    `live=${count} (${what})`
  );
}

/** A plain mount whose only job is to read the process-wide count. */
async function probe(): Promise<string> {
  const probeId = `probe-${String(nitroUiCore.now())}`;
  await render(<Stage testId={probeId} />);
  await waitForHandle(probeId);
  return probeId;
}

/** No tooltip window is left anywhere: none counted, and on iOS none presented. */
async function waitForNothingLeft(testId: string, what: string) {
  await waitForLive(testId, 0, what);
  if (IOS) {
    await waitForReport(
      testId,
      (r) => r.topPresented === '-' && r.windows === '0',
      `nothing presented in the app window and no tooltip window left (${what})`
    );
  }
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

/**
 * Where the popup sits against the anchor, in dp (Android) or pt (iOS): `gap` is the
 * distance between the facing edges on the popup's side, `side` which side it is on,
 * and `centred` whether the anchor's horizontal centre is inside the popup's span.
 */
function popupPlacement(report: Report) {
  const popup = rectOf(report.popRect ?? report.popupRect);
  const anchor = rectOf(report.anchorRect);
  if (popup == null || anchor == null) return null;
  const scale = IOS ? 1 : Number(report.density ?? '1');
  const above = popup.y + popup.height <= anchor.y + 1;
  const gap = above
    ? (anchor.y - (popup.y + popup.height)) / scale
    : (popup.y - (anchor.y + anchor.height)) / scale;
  const centre = anchor.x + anchor.width / 2;
  const centred = centre >= popup.x - 1 && centre <= popup.x + popup.width + 1;
  return { side: above ? 'above' : 'below', gap, centred, popup, anchor };
}

/** Material's `SpacingBetweenTooltipAndAnchor` (material3 1.5, `TooltipKt`; the same 4 dp as 1.4.0). */
const M3_SPACING_DP = 4;
/** The most an iOS popover's arrow and its gap put between the content and the anchor. */
const IOS_ARROW_MAX_PT = 30;

afterEach(async () => {
  cleanup();
  handles.clear();
  setters.clear();
  layouts.clear();
  eventLog.length = 0;
  // Let a window that a test left behind finish going away before the next one
  // counts: the assertions are on `live`, and it is process-wide.
  await sleep(600);
});

describe('Tooltip · early checks (Q7 C9)', () => {
  it('leaves a tap on its anchor to the anchor (check 1)', async () => {
    const presses: string[] = [];
    await render(
      <View>
        <Stage testId="touch">
          <Pressable
            testID="touch-anchor"
            onPress={() => presses.push('anchor')}
            style={{ width: 120, height: 44, backgroundColor: '#e5e5ea' }}
          >
            <Text>Anchor</Text>
          </Pressable>
        </Stage>
      </View>
    );
    await waitForHandle('touch');
    const anchor = await screen.findByTestId('touch-anchor');
    await userEvent.press(anchor);
    await pollUntil(
      () => (presses.length > 0 ? true : null),
      () =>
        new Error(
          `the harness tap on the anchor inside a closed tooltip never reached it; the tooltip says "${reportOf('touch').raw}"`
        ),
      5000
    );
    await sleep(400);
    expect(presses).toEqual(['anchor']);
    // The overlay is behind the anchor and takes no touch of its own.
    const report = reportOf('touch');
    expect(report.presented).toBe('0');
    if (IOS) expect(report.touchable).toBe('0');
    expect(eventLog.join(',')).toBe('');
  });

  for (const placement of ['above', 'below'] as const) {
    it(`sits ${placement} its anchor, where the platform puts it (check 2${IOS ? '' : ', spacing'})`, async () => {
      await render(
        <View style={{ paddingTop: 260, paddingLeft: 120 }}>
          <Stage testId={`at-${placement}`} initial placement={placement} />
        </View>
      );
      await waitForHandle(`at-${placement}`);
      const up = await waitForReport(
        `at-${placement}`,
        (r) => isUpCounted(1)(r) && popupPlacement(r) != null,
        'up, with its popup and anchor on screen'
      );
      // Past the entry animation, so the numbers are the resting ones.
      await sleep(700);
      const settled = reportOf(`at-${placement}`);
      const where = popupPlacement(settled);
      console.log(
        `tooltip ${placement}: ${JSON.stringify(where)} (report ${settled.raw})`
      );
      expect(where?.side).toBe(placement);
      expect(where?.centred).toBe(true);
      if (IOS) {
        expect(settled.arrow).toBe(placement === 'above' ? 'down' : 'up');
        expect(settled.presenter).toBe('ownWindow');
        expect(settled.sourceIsOwnRoot).toBe('1');
        expect(settled.sourceIsAnchorBox).toBe('1');
        expect(where!.gap).toBeGreaterThanOrEqual(0);
        expect(where!.gap).toBeLessThanOrEqual(IOS_ARROW_MAX_PT);
      } else {
        // Within 1 dp of Material's spacing, from the box Material was given - which is
        // this view's own box in the window, so the popup points at the anchor.
        expect(Math.abs(where!.gap - M3_SPACING_DP)).toBeLessThanOrEqual(1);
        expect(sameBox(settled.hostRect, settled.anchorRect)).toBe(true);
      }
      expect(up.presentCount).toBe('1');
    });
  }

  /**
   * Where an open tooltip is after its anchor moved, and that it still points at the
   * anchor: the design's invariant (Q7 C9 check 2) - it follows or it closes, and never
   * points at nothing. Both platforms' popups follow (measured): Android's Material
   * popup is placed again against the box it now has (`placements` goes up, and the box
   * Material was given is this view's), and iOS's popover follows its source view.
   */
  async function expectStillPointing(testId: string, what: string) {
    // The anchor moved 100 dp: a popup left behind would sit that far off.
    await sleep(800);
    // A report read schedules its own refresh: the second read is the settled one.
    reportOf(testId);
    await sleep(150);
    const after = reportOf(testId);
    const where = popupPlacement(after);
    const problems: string[] = [];
    if (!isUpCounted(1)(after)) problems.push('not up');
    if (where == null) problems.push('no geometry');
    else {
      if (!where.centred) problems.push('not centred on the anchor');
      if (IOS) {
        if (where.gap < 0 || where.gap > IOS_ARROW_MAX_PT) {
          problems.push(`gap ${String(where.gap)} pt`);
        }
        // The source was moved after the anchor, and is the anchor's box again.
        if (!(Number(after.sourceMoves) > 0))
          problems.push('source never moved');
        if (after.sourceIsAnchorBox !== '1')
          problems.push('source is not the anchor box');
      } else {
        if (Math.abs(where.gap - M3_SPACING_DP) > 1) {
          problems.push(`gap ${String(where.gap)} dp`);
        }
        if (!sameBox(after.hostRect, after.anchorRect)) {
          problems.push('placed against another box');
        }
        if (!(Number(after.placements) > 1))
          problems.push('never placed again');
      }
    }
    expect(
      problems.length === 0
        ? 'pointing'
        : `${what}: ${problems.join(', ')} - ${JSON.stringify(where)} - ${after.raw ?? ''}`
    ).toBe('pointing');
    // Following is not a close: nothing was reported.
    expect(eventLog.join(',')).toBe('');
  }

  it('follows its anchor when a layout move carries it away (check 2)', async () => {
    function Mover() {
      const [tall, setTall] = useState(false);
      setters.set('mover-grow', setTall);
      return (
        <View style={{ paddingTop: 200 }}>
          <View style={{ height: tall ? 120 : 20 }} />
          <Stage testId="moved" initial />
        </View>
      );
    }
    await render(<Mover />);
    await waitForHandle('moved');
    await waitForReport('moved', isUpCounted(1), 'up');
    await sleep(500);
    const before = popupPlacement(reportOf('moved'));
    setters.get('mover-grow')?.(true);
    await expectStillPointing('moved', 'a layout move');
    const after = popupPlacement(reportOf('moved'));
    // And it did move: the anchor is 100 dp lower, and so is the popup.
    expect(after!.anchor.y).toBeGreaterThan(before!.anchor.y);
    expect(after!.popup.y).toBeGreaterThan(before!.popup.y);
  });

  it('follows its anchor when a scroll carries it away (check 2)', async () => {
    const scroller: {
      current: { scrollTo(to: { y: number; animated: boolean }): void } | null;
    } = {
      current: null,
    };
    await render(
      <ScrollView
        ref={(view) => {
          scroller.current = view;
        }}
        style={{ height: 500 }}
      >
        <View style={{ height: 300 }} />
        <Stage testId="scrolled" initial placement="below" />
        <View style={{ height: 1200 }} />
      </ScrollView>
    );
    await waitForHandle('scrolled');
    await waitForReport('scrolled', isUpCounted(1), 'up');
    await sleep(500);
    const before = popupPlacement(reportOf('scrolled'));
    // A programmatic scroll: a person's starts with a touch outside the tooltip, which
    // closes it (real input's to prove), so this is the case where nothing else would.
    scroller.current?.scrollTo({ y: 100, animated: false });
    await expectStillPointing('scrolled', 'a scroll');
    const after = popupPlacement(reportOf('scrolled'));
    expect(after!.popup.y).toBeLessThan(before!.popup.y);
  });

  it('presents from a window of its own inside an RN Modal, and still points at its anchor (check 3)', async () => {
    await render(
      <Modal visible animationType="none">
        <View style={{ flex: 1, paddingTop: 300, paddingLeft: 80 }}>
          <Stage testId="in-modal" initial anchorWidth={120} />
        </View>
      </Modal>
    );
    await waitForHandle('in-modal');
    await waitForReport(
      'in-modal',
      (r) => isUpCounted(1)(r) && popupPlacement(r) != null,
      'up inside the Modal',
      12000
    );
    await sleep(700);
    const up = reportOf('in-modal');
    const where = popupPlacement(up);
    console.log(
      `tooltip in a Modal: ${JSON.stringify(where)} (report ${up.raw})`
    );
    if (IOS) {
      expect(up.presenter).toBe('ownWindow');
      expect(up.sourceIsOwnRoot).toBe('1');
      expect(up.sourceIsAnchorBox).toBe('1');
      expect(up.appTop).toContain('ModalHostViewController');
      expect(['up', 'down']).toContain(up.arrow);
      expect(where?.side).toBe(up.arrow === 'down' ? 'above' : 'below');
      expect(where!.gap).toBeGreaterThanOrEqual(0);
      expect(where!.gap).toBeLessThanOrEqual(IOS_ARROW_MAX_PT);
    } else {
      expect(Math.abs(where!.gap - M3_SPACING_DP)).toBeLessThanOrEqual(1);
      expect(sameBox(up.hostRect, up.anchorRect)).toBe(true);
    }
    expect(where?.centred).toBe(true);
    handles.get('in-modal')?.nuiTestDismiss();
    await waitForLive('in-modal', 0, 'dismissed inside the Modal');
    expect(eventLog.join(',')).toBe('in-modal:presented:false');
    if (IOS) {
      await waitForReport(
        'in-modal',
        (r) => r.windows === '0',
        'its own window gone'
      );
    }
  });
});

describe('Tooltip · behaviour (Q7 C7)', () => {
  it('reports a JS close as nothing, and a user close as a close (barrier twin)', async () => {
    await render(
      <View style={{ paddingTop: 200, paddingLeft: 40 }}>
        <Stage testId="quiet" initial />
        <Stage testId="twin" />
      </View>
    );
    await waitForHandle('twin');
    const up = await waitForReport('quiet', isUpCounted(1), 'the tooltip up');
    expect(up.kind).toBe(IOS ? 'popover' : 'rich');
    expect(up.title).toBe('Saved searches');
    expect(up.message).toBe('Tap the star to keep this search.');
    expect(up.actions).toBe('1');
    setters.get('quiet')?.(false);
    await waitForLive('quiet', 0, 'closed by JS');
    // The barrier: the same channel does report a user close, so the empty log above
    // is the JS close reporting nothing, not a channel that reports nothing at all.
    setters.get('twin')?.(true);
    await waitForReport('twin', isUpCounted(1), 'the twin up');
    handles.get('twin')?.nuiTestDismiss();
    await waitForLive('twin', 0, 'the twin dismissed by the user');
    expect(eventLog.join(',')).toBe('twin:presented:false');
  });

  it('reports an action before the close it causes', async () => {
    await render(
      <View style={{ paddingTop: 200, paddingLeft: 40 }}>
        <Stage testId="act" initial />
      </View>
    );
    await waitForHandle('act');
    await waitForReport('act', isUpCounted(1), 'up');
    handles.get('act')?.nuiTestPerformAction('ok');
    await waitForLive('act', 0, 'closed by the action');
    await sleep(300);
    expect(eventLog.join(',')).toBe('act:action:ok,act:presented:false');
    expect(reportOf('act').presented).toBe('0');
  });

  it('draws the plain kind with no title and no actions (Android), one popover on iOS', async () => {
    await render(
      <View style={{ paddingTop: 200, paddingLeft: 40 }}>
        <Stage testId="plain" initial title="" actions={[]} />
      </View>
    );
    await waitForHandle('plain');
    const up = await waitForReport('plain', isUpCounted(1), 'up');
    expect(up.kind).toBe(IOS ? 'popover' : 'plain');
    expect(up.title).toBe('-');
    expect(up.actions).toBe('0');
    if (!IOS) expect(up.focusable).toBe('0');
  });

  for (const kind of ['plain', 'rich'] as const) {
    it(`never closes itself (${kind})`, async () => {
      await render(
        <View style={{ paddingTop: 200, paddingLeft: 40 }}>
          <Stage
            testId={`stays-${kind}`}
            initial
            title={kind === 'plain' ? '' : 'Saved searches'}
            actions={kind === 'plain' ? [] : ACTIONS}
          />
        </View>
      );
      await waitForHandle(`stays-${kind}`);
      await waitForReport(`stays-${kind}`, isUpCounted(1), 'up');
      // Twice Material's plain-tooltip timeout (1.5 s, `BasicTooltipDefaults`).
      await sleep(3000);
      const after = reportOf(`stays-${kind}`);
      expect(isUpCounted(1)(after) ? 'up' : after.raw).toBe('up');
      expect(eventLog.join(',')).toBe('');
    });
  }

  for (const width of [40, 120]) {
    it(`gives the overlay the wrapper's box, which hugs a ${String(width)} x 40 anchor`, async () => {
      await render(
        <View style={{ paddingTop: 200, width: 320 }}>
          <Stage testId={`box-${String(width)}`} anchorWidth={width} />
        </View>
      );
      const handle = await waitForHandle(`box-${String(width)}`);
      const layout = await pollUntil(
        () => layouts.get(`box-${String(width)}`) ?? null,
        () => new Error('the wrapper never reported its layout')
      );
      // The wrapper hugs its anchor (`alignSelf: 'flex-start'`), not the 320-wide row.
      expect(layout.width).toBe(width);
      expect(layout.height).toBe(40);
      const report = await waitForReport(
        `box-${String(width)}`,
        (r) => Number(r.anchorW) > 0,
        'the overlay laid out'
      );
      const scale = IOS ? 1 : pixelRatio(report);
      expect(
        Math.abs(Number(report.anchorW) / scale - width)
      ).toBeLessThanOrEqual(1);
      expect(Math.abs(Number(report.anchorH) / scale - 40)).toBeLessThanOrEqual(
        1
      );
      expect(handle.presented).toBe(false);
    });
  }

  it('presents again when the app refuses a close, and warns once', async () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };
    try {
      await render(
        <View style={{ paddingTop: 200, paddingLeft: 40 }}>
          <Stage testId="refused" initial refuse />
        </View>
      );
      await waitForHandle('refused');
      await waitForReport('refused', isUpCounted(1), 'up');
      await sleep(400);
      handles.get('refused')?.nuiTestDismiss();
      // The close lands, JS echoes it, `isPresented` is still true: it comes back.
      await waitForReport(
        'refused',
        (r) => isUpCounted(1)(r) && r.presentCount === '2',
        'presented a second time after the refused close',
        12000
      );
      await sleep(800);
      handles.get('refused')?.nuiTestDismiss();
      await waitForReport(
        'refused',
        (r) => isUpCounted(1)(r) && r.presentCount === '3',
        'presented a third time',
        12000
      );
      const refusal = warnings.filter((w) => w.includes('closed by the user'));
      expect(refusal.length).toBe(1);
      expect(eventLog.join(',')).toBe(
        'refused:presented:false,refused:presented:false'
      );
    } finally {
      console.warn = original;
    }
  });

  it('presents once when mounted presented, after the view has a window', async () => {
    await render(
      <View style={{ paddingTop: 200, paddingLeft: 40 }}>
        <Stage testId="at-mount" initial />
      </View>
    );
    await waitForHandle('at-mount');
    const up = await waitForReport(
      'at-mount',
      isUpCounted(1),
      'up from the first commit'
    );
    await sleep(800);
    expect(reportOf('at-mount').presentCount).toBe('1');
    expect(up.live).toBe('1');
    expect(eventLog.join(',')).toBe('');
  });

  it('updates the message in place while up', async () => {
    function Live() {
      const [round, setRound] = useState(0);
      setters.set('round', (next) => setRound(next ? 1 : 0));
      return (
        <View style={{ paddingTop: 200, paddingLeft: 40 }}>
          <Tooltip
            testID="live"
            hybridRef={captureHybrid('live')}
            isPresented
            title={round === 0 ? 'Before' : 'After'}
            message={
              round === 0
                ? 'Short.'
                : 'A much longer message that has to wrap onto more than one line, ' +
                  'because a tooltip is never wider than Material’s rich maximum.'
            }
          >
            <View style={{ width: 40, height: 40 }} />
          </Tooltip>
        </View>
      );
    }
    await render(<Live />);
    await waitForHandle('live');
    const before = await waitForReport(
      'live',
      (r) => isUpCounted(1)(r) && r.title === 'Before',
      'up with the first title'
    );
    await sleep(500);
    const beforeHeight = popupHeight(reportOf('live'));
    setters.get('round')?.(true);
    const after = await waitForReport(
      'live',
      (r) =>
        r.title === 'After' && r.message?.startsWith('A much longer') === true,
      'the new title and message on the open tooltip'
    );
    await sleep(500);
    const afterHeight = popupHeight(reportOf('live'));
    console.log(
      `tooltip height before/after: ${beforeHeight} / ${afterHeight}`
    );
    // Resized in place: taller for the wrapped text, and still the one presentation.
    expect(afterHeight).toBeGreaterThan(beforeHeight);
    expect(after.presentCount).toBe(before.presentCount);
    expect(reportOf('live').live).toBe('1');
  });

  it('gives a recycled view none of the open tooltip it came from', async () => {
    function Swap({ round }: { round: number }) {
      const old = round % 2 === 0;
      return (
        <View style={{ paddingTop: 200, paddingLeft: 40 }}>
          <Tooltip
            key={old ? 'a' : 'b'}
            testID="recycled"
            hybridRef={captureHybrid('recycled')}
            isPresented={old}
            title={old ? 'Old title' : 'New title'}
            message={old ? 'Old message' : 'New message'}
            actions={old ? ACTIONS : []}
          >
            <View style={{ width: 40, height: 40 }} />
          </Tooltip>
        </View>
      );
    }
    const { rerender } = await render(<Swap round={0} />);
    await waitForHandle('recycled');
    await waitForReport(
      'recycled',
      (r) => isUpCounted(1)(r) && r.title === 'Old title',
      'the old tooltip up'
    );
    const reuses: string[] = [];
    for (const round of [1, 2, 3]) {
      handles.clear();
      await rerender(<Swap round={round} />);
      await waitForHandle('recycled');
      if (round % 2 === 1) {
        // The new mount asked for nothing: whatever instance it got shows nothing.
        await waitForLive('recycled', 0, `round ${String(round)} closed`);
        const report = reportOf('recycled');
        expect(report.presented).toBe('0');
        expect(report.kind).toBe('none');
        expect((report.raw ?? '').includes('Old message')).toBe(false);
        reuses.push(report.recycles ?? '?');
      } else {
        await waitForReport(
          'recycled',
          (r) => isUpCounted(1)(r) && r.title === 'Old title',
          'reopened'
        );
      }
    }
    console.log(`recycled-tooltip recycles per round: ${reuses.join(',')}`);
  });

  for (const delay of [null, 50, 100, 150]) {
    const when =
      delay == null ? 'while open' : `${String(delay)} ms into its entry`;
    it(`leaves nothing when dropped ${when}`, async () => {
      const { unmount } = await render(
        <View style={{ paddingTop: 200, paddingLeft: 40 }}>
          <Stage testId="dropped" />
        </View>
      );
      await waitForHandle('dropped');
      setters.get('dropped')?.(true);
      if (delay == null) {
        await waitForReport('dropped', isUpCounted(1), 'up');
        await sleep(400);
      } else {
        // The delay runs from the native present (iOS: `present` asked; Android: the
        // popup composed), not from the JS write.
        await waitForReport(
          'dropped',
          (r) => r.presentCount === '1',
          'presenting'
        );
        await sleep(delay);
      }
      unmount();
      handles.clear();
      const probeId = await probe();
      await waitForNothingLeft(probeId, `dropped ${when}`);
      // The drop is the app's own doing: nothing was reported.
      expect(eventLog.join(',')).toBe('');
    });
  }

  it('closes and reports when a full-screen Modal takes its view out of the window', async () => {
    // UIKit takes the presenting screen's views out of the window once a full-screen
    // presentation lands, so a tooltip open on that screen loses its anchor's window -
    // the window-loss rule then closes it and reports the close (as a dialog's does).
    // Android's RN Modal is a window of its own and the screen under it stays attached,
    // so the tooltip stays up there. Pinned both ways: an app can see the difference.
    function Scene() {
      const [modal, setModal] = useState(false);
      setters.set('modal', setModal);
      return (
        <View style={{ flex: 1, paddingTop: 200, paddingLeft: 40 }}>
          <Stage testId="under-full-screen" initial />
          <Modal visible={modal} animationType="none">
            <View style={{ flex: 1 }} />
          </Modal>
        </View>
      );
    }
    await render(<Scene />);
    await waitForHandle('under-full-screen');
    await waitForReport('under-full-screen', isUpCounted(1), 'up');
    await sleep(500);
    setters.get('modal')?.(true);
    if (IOS) {
      await waitForLive('under-full-screen', 0, 'closed with its window gone');
      await sleep(300);
      // The close is the proof the Modal came up: only a full-screen presentation takes
      // the screen's views out of the window. In the app's chain, the popover made UIKit
      // refuse the Modal instead, and the tooltip stayed up (G18 round 1, measured).
      expect(eventLog.join(',')).toBe('under-full-screen:presented:false');
    } else {
      await sleep(1000);
      expect(reportOf('under-full-screen').live).toBe('1');
      expect(eventLog.join(',')).toBe('');
    }
    setters.get('modal')?.(false);
    await sleep(600);
  });
});

/** Whether two `x,y,w,h` report fields are the same box, to the pixel. */
function sameBox(a: string | undefined, b: string | undefined): boolean {
  const one = rectOf(a);
  const two = rectOf(b);
  if (one == null || two == null) return false;
  return (
    Math.abs(one.x - two.x) <= 1 &&
    Math.abs(one.y - two.y) <= 1 &&
    Math.abs(one.width - two.width) <= 1 &&
    Math.abs(one.height - two.height) <= 1
  );
}

/** The popup's height, in the report's own unit: the content size iOS asked for. */
function popupHeight(report: Report): number {
  if (IOS) return Number(report.contentH ?? '0');
  return rectOf(report.popupRect)?.height ?? 0;
}

/** Android reports px; the density it reported, or the one the screen has. */
function pixelRatio(report: Report): number {
  const density = Number(report.density ?? 'NaN');
  return !Number.isNaN(density) && density > 0 ? density : PixelRatio.get();
}

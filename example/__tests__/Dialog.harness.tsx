/**
 * On-device tests for AlertDialog and ConfirmationDialog (task G11, Q5 Appendix B7).
 *
 * A dialog is a window, and the harness cannot tap into another window
 * (`Switch.harness.tsx`, H9/H10). So these tests read two honest channels:
 *
 *  - `hybridRef.nuiTestStateReport()` - what is on screen, read from the controller
 *    iOS actually built and from the Android model as composed, plus `live`, a
 *    process-wide count of dialog windows that survives a drop (read through a fresh
 *    mount, because a dropped mount has nothing left to report);
 *  - the events that reached JS, in order (`eventLog`).
 *
 * and drive the dialog through test seams that run the real handlers
 * (`nuiTestPerformAction`, `nuiTestDismiss`); on iOS the action seam has the alert take
 * itself down, as a tap does, rather than asking the presentation helper to. Real taps
 * are `real-input:*`'s job.
 *
 * The first block is the presentation spike (Q5 B9, brief item 1): can a plain view
 * always find a controller to present from - inside an RN `Modal`, over one, over
 * another dialog - and is the window gone when the dismissal or the drop lands during
 * the entry transition.
 */
import { useState } from 'react';
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
  AlertDialog,
  ConfirmationDialog,
  Host,
  nitroUiCore,
  type DialogAction,
} from 'react-native-nitro-ui';

/** What `hybridRef` hands back - declared, not imported (D14). */
type DialogHandle = {
  readonly presented: boolean;
  readonly mostRecentEventCount: number;
  nuiTestStateReport(): string;
  nuiTestPerformAction(id: string): void;
  nuiTestDismiss(): void;
};

const handles = new Map<string, DialogHandle>();
const captureHybrid =
  (testId: string) =>
  (view: DialogHandle): void => {
    handles.set(testId, view);
  };

/** Every event the app received, in order: `testID:action:<id>` / `testID:presented:<bool>`. */
const eventLog: string[] = [];

/** The parent's `isPresented` setters, by testID, so a test can play the app. */
const setters = new Map<string, (next: boolean) => void>();

const ACTIONS: DialogAction[] = [
  { id: 'cancel', title: 'Cancel', role: 'cancel' },
  { id: 'delete', title: 'Delete', role: 'destructive' },
  { id: 'later', title: 'Later' },
];

/**
 * A dialog whose `isPresented` lives in a parent, as an app's would. `refuse` makes
 * the parent ignore every dismissal (the D33 refusal case); otherwise the parent
 * follows `onIsPresentedChange`.
 */
function Stage({
  testId,
  initial = false,
  refuse = false,
  variant = 'alert',
  title = 'Dialog',
  message,
  actions = ACTIONS,
  dismissible,
}: {
  testId: string;
  initial?: boolean;
  refuse?: boolean;
  variant?: 'alert' | 'confirmation';
  title?: string;
  message?: string;
  actions?: DialogAction[];
  dismissible?: boolean;
}) {
  const [open, setOpen] = useState(initial);
  setters.set(testId, setOpen);
  const Component =
    variant === 'confirmation' ? ConfirmationDialog : AlertDialog;
  return (
    <Component
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
      dismissible={dismissible}
    />
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

async function waitForHandle(testId: string): Promise<DialogHandle> {
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

const isUp = (report: Report) =>
  report.presented === '1' &&
  (Platform.OS === 'ios'
    ? report.onScreen === '1'
    : report.kind === 'alert' || report.kind === 'sheet');

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

/** Up, and counted: the count goes up in the presentation's completion on iOS. */
const isUpCounted = (count: number) => (report: Report) =>
  isUp(report) && report.live === String(count);

/** No dialog window is left anywhere: none counted, and on iOS none in the scene. */
async function waitForNothingLeft(testId: string, what: string) {
  await waitForLive(testId, 0, what);
  if (Platform.OS === 'ios') {
    await waitForReport(
      testId,
      (r) => r.topPresented === '-' && r.windows === '0',
      `nothing presented in the app window and no dialog window left (${what})`
    );
  }
}

describe('Dialog · presentation spike (G11, Q5 B9)', () => {
  afterEach(async () => {
    cleanup();
    handles.clear();
    setters.clear();
    eventLog.length = 0;
    // Let a window that a test left behind finish going away before the next one
    // counts: the assertions are on `live`, and it is process-wide.
    await sleep(600);
  });

  it('presents from a plain view; a JS false closes it with no event', async () => {
    await render(<Stage testId="plain" />);
    await waitForHandle('plain');
    await waitForLive('plain', 0, 'nothing open yet');
    setters.get('plain')?.(true);
    const up = await waitForReport(
      'plain',
      isUpCounted(1),
      'presented and counted'
    );
    expect(up.presentCount).toBe('1');
    if (Platform.OS === 'ios') {
      expect(up.kind).toBe('alert');
      expect(up.ownWindow).toBe('1');
      expect(up.windows).toBe('1');
    }
    setters.get('plain')?.(false);
    await waitForNothingLeft('plain', 'after the JS false');
    expect(reportOf('plain').presented).toBe('0');
    // A change React made is not a native interaction: nothing was reported.
    expect(eventLog.join(',')).toBe('');
  });

  it('presents inside an RN Modal', async () => {
    await render(
      <Modal visible animationType="none">
        <View style={{ flex: 1 }}>
          <Stage
            testId="in-modal"
            initial
            variant="confirmation"
            title="In the Modal"
          />
        </View>
      </Modal>
    );
    await waitForHandle('in-modal');
    const up = await waitForReport(
      'in-modal',
      isUpCounted(1),
      'presented inside the Modal',
      12000
    );
    if (Platform.OS === 'ios') {
      // Over the Modal, from a window of its own.
      expect(up.appTop).toContain('Modal');
      expect(up.kind).toBe('sheet');
      expect(up.ownWindow).toBe('1');
    }
    setters.get('in-modal')?.(false);
    await waitForLive('in-modal', 0, 'closed inside the Modal');
    expect(eventLog.join(',')).toBe('');
  });

  it('presents over an RN Modal from a view under it, mid-slide', async () => {
    await render(
      <View style={{ flex: 1 }}>
        <Stage testId="under-modal" title="Over the Modal" />
        <Modal visible animationType="slide" presentationStyle="pageSheet">
          <View style={{ flex: 1 }} />
        </Modal>
      </View>
    );
    await waitForHandle('under-modal');
    // Asked for while the Modal may still be sliding in: an in-chain presenter has to
    // wait that transition out, a window of its own does not.
    await sleep(150);
    setters.get('under-modal')?.(true);
    const up = await waitForReport(
      'under-modal',
      isUpCounted(1),
      'presented over the Modal',
      12000
    );
    if (Platform.OS === 'ios') expect(up.ownWindow).toBe('1');
    setters.get('under-modal')?.(false);
    await waitForLive('under-modal', 0, 'closed over the Modal');
  });

  it('presents a second dialog over the first, and each closes on its own', async () => {
    await render(
      <View>
        <Stage testId="first" initial title="First" />
        <Stage testId="second" title="Second" />
      </View>
    );
    await waitForHandle('second');
    await waitForReport('first', isUpCounted(1), 'the first dialog up');
    setters.get('second')?.(true);
    const second = await waitForReport(
      'second',
      isUpCounted(2),
      'the second dialog up',
      12000
    );
    if (Platform.OS === 'ios') expect(second.windows).toBe('2');
    handles.get('second')?.nuiTestPerformAction('later');
    await waitForLive('first', 1, 'the second closed, the first still up');
    expect(reportOf('first').presented).toBe('1');
    handles.get('first')?.nuiTestPerformAction('cancel');
    await waitForNothingLeft('first', 'both closed');
    expect(eventLog.join(',')).toBe(
      'second:action:later,second:presented:false,first:action:cancel,first:presented:false'
    );
  });

  it('closes cleanly when JS says false during the entry transition', async () => {
    await render(<Stage testId="flicker" />);
    await waitForHandle('flicker');
    setters.get('flicker')?.(true);
    await sleep(50);
    setters.get('flicker')?.(false);
    await waitForNothingLeft('flicker', 'after a mid-entry false');
    await sleep(800);
    const settled = reportOf('flicker');
    expect(settled.live).toBe('0');
    expect(settled.presented).toBe('0');
    expect(eventLog.join(',')).toBe('');
  });

  for (const delay of [0, 80, 150, 1000]) {
    it(`leaves no window when dropped ${String(delay)} ms after presenting`, async () => {
      const first = await render(<Stage testId="dropped" />);
      await waitForHandle('dropped');
      setters.get('dropped')?.(true);
      if (delay > 0) await sleep(delay);
      if (delay >= 1000) {
        await waitForReport('dropped', isUpCounted(1), 'up before the drop');
      }
      first.unmount();
      handles.clear();
      const probeId = await probe();
      await waitForNothingLeft(probeId, `after a drop ${String(delay)} ms in`);
      // The dropped mount reports nothing: its callbacks went with it.
      expect(eventLog.join(',')).toBe('');
    });
  }

  // The other end of the presentation: the view goes while the dialog is animating
  // *out*. After an action tap UIKit takes the alert down itself, and the teardown that
  // lands during that exit found it already leaving and stood down - while the one
  // report of the exit's end, the alert's witness, is what the teardown detaches. The
  // window stayed up at `.alert + 1` and `live` at 1 (G11 review, round 2). A JS
  // `false` is the helper's own dismissal, which already carried both: the barrier.
  for (const closing of ['an action', 'a JS false'] as const) {
    it(`leaves no window when dropped 100 ms into the close of ${closing}`, async () => {
      const first = await render(<Stage testId="closing" initial />);
      await waitForHandle('closing');
      await waitForReport('closing', isUpCounted(1), 'up');
      if (closing === 'an action') {
        handles.get('closing')?.nuiTestPerformAction('later');
      } else {
        setters.get('closing')?.(false);
      }
      await sleep(100);
      if (Platform.OS === 'ios' && closing === 'an action') {
        // Precondition: the exit is still running when the view goes (the count comes
        // down at its end, and that end republishes the report).
        expect(reportOf('closing').live).toBe('1');
      }
      first.unmount();
      handles.clear();
      const probeId = await probe();
      await waitForNothingLeft(
        probeId,
        `dropped 100 ms into the close of ${closing}`
      );
      expect(eventLog.join(',')).toBe(
        closing === 'an action'
          ? 'closing:action:later,closing:presented:false'
          : ''
      );
    });
  }

  it('leaves no Modal behind when the RN Modal under an open dialog closes', async () => {
    // The case an in-chain presenter fails: React Native dismisses its Modal with
    // `[modalController dismissViewControllerAnimated:]`, which UIKit reads as "dismiss
    // what this controller presented" - so with a dialog on top, the dialog went and
    // the Modal stayed on screen with React believing it gone.
    function Scene() {
      const [modal, setModal] = useState(true);
      setters.set('modal', setModal);
      return (
        <View style={{ flex: 1 }}>
          <Stage testId="over-closing-modal" initial title="Over" />
          {/* A page sheet keeps the screen under it in the window; a full-screen
              Modal does not, which is the next test. */}
          <Modal
            visible={modal}
            animationType="none"
            presentationStyle="pageSheet"
          >
            <View style={{ flex: 1 }}>
              <Stage testId="in-closing-modal" initial title="Inside" />
            </View>
          </Modal>
        </View>
      );
    }
    await render(<Scene />);
    await waitForHandle('in-closing-modal');
    await waitForReport('in-closing-modal', isUpCounted(2), 'both up', 12000);
    setters.get('modal')?.(false);
    // The dialog inside the Modal goes with it; the one under it stays up.
    await waitForLive(
      'over-closing-modal',
      1,
      'the inner dialog gone with its Modal'
    );
    if (Platform.OS === 'ios') {
      await waitForReport(
        'over-closing-modal',
        (r) => r.topPresented === '-',
        'no RN Modal left presented in the app window'
      );
    }
    handles.get('over-closing-modal')?.nuiTestPerformAction('later');
    await waitForNothingLeft(
      'over-closing-modal',
      'the outer dialog closed too'
    );
    // The inner dialog's view left the window with its Modal, which reports a close
    // if the view outlived the dismissal (B1) and nothing if it was dropped first.
    console.log(`events: ${eventLog.join(',')}`);
    expect(
      eventLog.filter((e) => e.startsWith('over-closing-modal:')).join(',')
    ).toBe(
      'over-closing-modal:action:later,over-closing-modal:presented:false'
    );
    expect(
      eventLog.filter((e) => e.startsWith('in-closing-modal:action')).length
    ).toBe(0);
  });

  it('closes and reports when its view leaves the window under a full-screen Modal', async () => {
    // UIKit takes the presenting screen's views out of the window once a full-screen
    // presentation lands, so a dialog open on that screen loses its anchor's window -
    // B2's rule then closes it and reports the close. Android's RN Modal is a window of
    // its own, the screen under it stays attached, and the dialog stays up. Pinned both
    // ways, because it is a platform difference an app can see.
    function Scene() {
      const [modal, setModal] = useState(false);
      setters.set('modal', setModal);
      return (
        <View style={{ flex: 1 }}>
          <Stage testId="under-full-screen" initial title="Under" />
          <Modal visible={modal} animationType="none">
            <View style={{ flex: 1 }} />
          </Modal>
        </View>
      );
    }
    await render(<Scene />);
    await waitForHandle('under-full-screen');
    await waitForReport('under-full-screen', isUpCounted(1), 'up');
    setters.get('modal')?.(true);
    if (Platform.OS === 'ios') {
      await waitForLive('under-full-screen', 0, 'closed with its window gone');
      expect(eventLog.join(',')).toBe('under-full-screen:presented:false');
    } else {
      await sleep(1000);
      expect(reportOf('under-full-screen').live).toBe('1');
      expect(eventLog.join(',')).toBe('');
    }
    setters.get('modal')?.(false);
  });
});

describe('Dialog · behaviour (G11, Q5 B7)', () => {
  afterEach(async () => {
    cleanup();
    handles.clear();
    setters.clear();
    eventLog.length = 0;
    await sleep(600);
  });

  it('reports a JS close as nothing, and a user close as a close (barrier twin)', async () => {
    await render(
      <View>
        <Stage testId="quiet" initial message="Body" />
        <Stage testId="twin" />
      </View>
    );
    await waitForHandle('twin');
    const up = await waitForReport('quiet', isUpCounted(1), 'the dialog up');
    expect(up.title).toBe('Dialog');
    expect(up.message).toBe('Body');
    expect(up.actions).toBe('3');
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
    await render(<Stage testId="act" initial />);
    await waitForHandle('act');
    await waitForReport('act', isUpCounted(1), 'up');
    handles.get('act')?.nuiTestPerformAction('delete');
    await waitForLive('act', 0, 'closed by the action');
    expect(eventLog.join(',')).toBe('act:action:delete,act:presented:false');
    expect(reportOf('act').presented).toBe('0');
  });

  for (const variant of ['alert', 'confirmation'] as const) {
    it(`takes no tap on a disabled action, and draws it disabled (${variant})`, async () => {
      const actions: DialogAction[] = [
        { id: 'cancel', title: 'Cancel', role: 'cancel' },
        { id: 'locked', title: 'Locked', disabled: true },
        { id: 'go', title: 'Go' },
      ];
      await render(
        <Stage testId="locked" initial variant={variant} actions={actions} />
      );
      await waitForHandle('locked');
      const up = await waitForReport('locked', isUpCounted(1), 'up');
      // What is drawn, in the app's action order. iOS: the `isEnabled` of the actions
      // on the controller UIKit draws. Android: the colour each composed label was
      // given (`drawn`), not the model's flag (`enabled`) - an M3 `ListItem` row that
      // ignores the flag paints the disabled action like the others.
      expect(Platform.OS === 'ios' ? up.enabled : up.drawn).toBe('1,0,1');
      handles.get('locked')?.nuiTestPerformAction('locked');
      await sleep(400);
      expect(eventLog.join(',')).toBe('');
      expect(reportOf('locked').presented).toBe('1');
      // Barrier: an enabled action on the same dialog does report.
      handles.get('locked')?.nuiTestPerformAction('go');
      await waitForLive('locked', 0, 'closed by the enabled action');
      expect(eventLog.join(',')).toBe(
        'locked:action:go,locked:presented:false'
      );
    });
  }

  /**
   * Android, and only Android can answer it: what the sheet's rows *are*, read off the
   * open sheet rather than out of the props that produced it. Reading the report arms
   * one row probe while one is unanswered, so polling the report is the whole seam (G28).
   *
   * `rows=` is each row's own merged accessibility node - `~` marks one that says it is
   * disabled, the same mark `Menu.harness.tsx`'s probe writes - and `radii=` is the
   * corner radius, in dp, that the row's container is *painted* with at its leading edge.
   * Between them they say the row honours `enabled` and is the segmented row it claims to
   * be: a row that ignored `enabled` loses its `~`, and a plain row loses the 16 dp outer
   * corners, whichever way the first half of the line moved.
   */
  const itAndroid = Platform.OS === 'android' ? it : it.skip;
  itAndroid(
    'reports the sheet rows as the component draws them, disabled included',
    async () => {
      const actions: DialogAction[] = [
        { id: 'locked', title: 'Locked', disabled: true },
        { id: 'go', title: 'Go' },
        { id: 'wipe', title: 'Wipe', role: 'destructive' },
      ];
      await render(
        <Stage testId="rows" initial variant="confirmation" actions={actions} />
      );
      await waitForHandle('rows');
      await waitForReport('rows', isUpCounted(1), 'the sheet up');
      // Past the slide-in: a sheet on its way up measures below the window, and the
      // probe says `?-moving` rather than guess. Polling re-arms it, so this waits for
      // an answer that could be measured, whatever the first ones said.
      await sleep(900);
      const probed = await waitForReport(
        'rows',
        (report) => {
          const answer = report.probe ?? '';
          return answer.includes('radii=') && !answer.includes('?');
        },
        'a row probe answer the sheet could be measured in',
        20000
      );
      const probe = probed.probe ?? '';
      console.log(`sheet rows: ${probe}`);
      const fields: Record<string, string> = {};
      for (const part of probe.split(' ')) {
        const at = part.indexOf('=');
        if (at > 0) fields[part.slice(0, at)] = part.slice(at + 1);
      }
      // In the order the sheet draws them. No `cancel` action here, so the app's order.
      expect(fields.rows).toBe('Locked~,Go,Wipe');
      // The group's outer radius (material3's `CornerLarge`) on the first row's top and
      // the last row's bottom; the small radius (`CornerExtraSmall`) where rows meet.
      expect(fields.radii).toBe('16/4,4/4,4/16');
      // What the container is painted in, so a failure names what it compared against.
      expect(fields.container).toMatch(/^[0-9A-F]{6}$/);
      // The barrier that makes `~` mean something: an ordinary row of the same sheet is
      // not marked, and the sheet as a whole is not one long disabled row.
      expect(fields.rows).not.toBe('Locked,Go,Wipe');
      // The disabled row still takes no press, once the probe has read it.
      handles.get('rows')?.nuiTestPerformAction('locked');
      await sleep(400);
      expect(eventLog.join(',')).toBe('');
      expect(reportOf('rows').presented).toBe('1');
    }
  );

  it('presents again when the app refuses a dismissal, and warns once', async () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };
    try {
      await render(<Stage testId="refused" initial refuse />);
      await waitForHandle('refused');
      await waitForReport('refused', isUpCounted(1), 'up');
      await sleep(300);
      handles.get('refused')?.nuiTestDismiss();
      // The close lands, JS echoes it, `isPresented` is still true: it comes back.
      await waitForReport(
        'refused',
        (r) => isUpCounted(1)(r) && r.presentCount === '2',
        'presented a second time after the refused dismissal',
        12000
      );
      expect(reportOf('refused').live).toBe('1');
      // Past the new window's entry transition, so the next dismissal is a real one
      // rather than a close carried to a presentation that is still arriving.
      await sleep(800);
      handles.get('refused')?.nuiTestDismiss();
      await waitForReport(
        'refused',
        (r) => isUpCounted(1)(r) && r.presentCount === '3',
        'presented a third time',
        12000
      );
      const refusal = warnings.filter((w) =>
        w.includes('dismissed by the user')
      );
      expect(refusal.length).toBe(1);
      expect(eventLog.join(',')).toBe(
        'refused:presented:false,refused:presented:false'
      );
    } finally {
      console.warn = original;
    }
  });

  it('presents once when mounted presented, after the view has a window', async () => {
    await render(<Stage testId="at-mount" initial />);
    await waitForHandle('at-mount');
    const up = await waitForReport(
      'at-mount',
      isUpCounted(1),
      'up from the first commit'
    );
    await sleep(600);
    expect(reportOf('at-mount').presentCount).toBe('1');
    expect(up.live).toBe('1');
    expect(eventLog.join(',')).toBe('');
  });

  it('does nothing on a user dismissal while not dismissible', async () => {
    await render(<Stage testId="sticky" initial dismissible={false} />);
    await waitForHandle('sticky');
    await waitForReport('sticky', isUpCounted(1), 'up');
    handles.get('sticky')?.nuiTestDismiss();
    await sleep(500);
    expect(reportOf('sticky').presented).toBe('1');
    expect(eventLog.join(',')).toBe('');
    handles.get('sticky')?.nuiTestPerformAction('later');
    await waitForLive('sticky', 0, 'closed by its action');
  });

  it('updates title, message and a disabled action in place while up', async () => {
    function Live() {
      const [round, setRound] = useState(0);
      setters.set('round', (next) => setRound(next ? 1 : 0));
      const actions: DialogAction[] =
        round === 0
          ? [
              { id: 'a', title: 'Alpha' },
              { id: 'b', title: 'Bravo' },
            ]
          : [
              { id: 'a', title: 'Alpha', disabled: true },
              { id: 'b', title: 'Bravo' },
              { id: 'c', title: 'Charlie' },
            ];
      return (
        <AlertDialog
          testID="live"
          hybridRef={captureHybrid('live')}
          isPresented
          title={round === 0 ? 'Before' : 'After'}
          message={round === 0 ? 'First body' : 'Second body'}
          actions={actions}
        />
      );
    }
    await render(<Live />);
    await waitForHandle('live');
    await waitForReport(
      'live',
      (r) => isUpCounted(1)(r) && r.title === 'Before',
      'up with the first title'
    );
    setters.get('round')?.(true);
    const after = await waitForReport(
      'live',
      (r) => r.title === 'After' && r.message === 'Second body',
      'the new title and message on the open dialog'
    );
    // The disabled flag follows in place on both platforms...
    expect(after.enabled?.split(',')[0]).toBe('0');
    // ...and the action *set* is the platform difference B2 documents: UIKit cannot drop
    // or add an action on a presented alert, so iOS keeps two until the next
    // presentation; Compose recomposes, so Android shows three now.
    expect(after.actions).toBe(Platform.OS === 'ios' ? '2' : '3');
    expect(after.presentCount).toBe('1');
  });

  it('gives a recycled view none of the open dialog it came from', async () => {
    function Swap({ round }: { round: number }) {
      const old = round % 2 === 0;
      return (
        <View>
          <AlertDialog
            key={old ? 'a' : 'b'}
            testID="recycled"
            hybridRef={captureHybrid('recycled')}
            isPresented={old}
            title={old ? 'Old title' : 'New title'}
            actions={old ? ACTIONS : [{ id: 'only', title: 'Only' }]}
          />
        </View>
      );
    }
    const { rerender } = await render(<Swap round={0} />);
    await waitForHandle('recycled');
    await waitForReport(
      'recycled',
      (r) => isUpCounted(1)(r) && r.title === 'Old title',
      'the old dialog up'
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
        reuses.push(report.recycles ?? '?');
      } else {
        await waitForReport(
          'recycled',
          (r) => isUpCounted(1)(r) && r.title === 'Old title',
          'reopened'
        );
      }
    }
    console.log(`recycled-dialog recycles per round: ${reuses.join(',')}`);
  });

  // A re-key hands the dropped view straight back to the new mount (Fabric's pool is
  // LIFO, and the delete runs before the create in one transaction), so the old
  // mount's dialog can still be animating in when the same native view presents the
  // new one. iOS builds a controller per presentation, and the old one's carried
  // dismissal has to survive the new `present`: when it did not (G11 review, item 2),
  // the old alert stayed up in a key window of its own, `live` never came down, and the
  // old completion marked the *new* entry finished, so the new mount's own teardown was
  // refused too. Two endings per delay: the new dialog stays up and is then dropped,
  // or it is dropped during its own entry.
  for (const delay of [0, 80, 150]) {
    for (const ending of ['kept', 'dropped mid-entry'] as const) {
      it(`leaves one dialog, then none, when a recycled view presents again ${String(delay)} ms into the entry (${ending})`, async () => {
        function Swap() {
          const [scene, setScene] = useState({ open: false, key: 'a' });
          setters.set('swap-open', (next) =>
            setScene((s) => ({ ...s, open: next }))
          );
          setters.set('swap-key', (next) =>
            setScene((s) => ({ ...s, key: next ? 'b' : 'a' }))
          );
          return (
            <View>
              <AlertDialog
                key={scene.key}
                testID="swapped"
                hybridRef={captureHybrid('swapped')}
                isPresented={scene.open}
                title={`Mount ${scene.key}`}
                actions={ACTIONS}
              />
            </View>
          );
        }
        const { unmount } = await render(<Swap />);
        await waitForHandle('swapped');
        const before = reportOf('swapped');
        setters.get('swap-open')?.(true);
        // The delay runs from the native present (iOS: `present` asked; Android: the
        // window composed), not from the JS write.
        await waitForReport(
          'swapped',
          (r) => r.presentCount === '1',
          'the first mount presenting'
        );
        if (delay > 0) await sleep(delay);
        handles.clear();
        setters.get('swap-key')?.(true);
        await waitForHandle('swapped');
        if (ending === 'kept') {
          // One dialog counted *and* one window: mid-flight, the first mount's
          // completion counts its own alert while the new one is still entering, so
          // `live=1` alone can be the old dialog's.
          const oneLeft = (r: Report) =>
            isUpCounted(1)(r) &&
            r.title === 'Mount b' &&
            (Platform.OS !== 'ios' || r.windows === '1');
          const up = await waitForReport(
            'swapped',
            oneLeft,
            'the new mount up, the only dialog counted and the only window',
            12000
          );
          if (Platform.OS === 'ios') {
            // The precondition: this is the instance the first mount had, recycled -
            // the per-object counters `prepareForRecycle` keeps went up by one.
            expect(Number(up.recycles)).toBe(Number(before.recycles) + 1);
          }
          // Past both entry transitions, it is still so.
          await sleep(800);
          reportOf('swapped');
          await sleep(100);
          const settled = reportOf('swapped');
          expect(oneLeft(settled) ? 'one' : settled.raw).toBe('one');
        } else {
          await waitForReport(
            'swapped',
            (r) =>
              r.presentCount === '1' &&
              r.presented === '1' &&
              r.title === 'Mount b',
            'the new mount presenting'
          );
          if (Platform.OS === 'ios') {
            expect(Number(reportOf('swapped').recycles)).toBe(
              Number(before.recycles) + 1
            );
          }
          // Past the first entry's completion, inside the new one's.
          await sleep(200);
        }
        unmount();
        handles.clear();
        const probeId = await probe();
        await waitForNothingLeft(
          probeId,
          `a swap ${String(delay)} ms in, ${ending}`
        );
        // Neither mount reports anything: the app changed every prop.
        expect(eventLog.join(',')).toBe('');
      });
    }
  }

  it('presents from inside a <Host>, and goes when the Host is dropped', async () => {
    // Q5 B7 item 11. On Android the Host's one composition composes the dialog, window
    // and all, so dropping the Host is what has to take the window down; on iOS a Host
    // is a passthrough and this is the plain drop.
    function Scene() {
      const [shown, setShown] = useState(true);
      setters.set('host-shown', setShown);
      return shown ? (
        <Host>
          <AlertDialog
            testID="hosted"
            hybridRef={captureHybrid('hosted')}
            isPresented
            onIsPresentedChange={(next) => {
              eventLog.push(`hosted:presented:${String(next)}`);
            }}
            title="Hosted dialog"
            actions={ACTIONS}
          />
        </Host>
      ) : (
        <View />
      );
    }
    await render(<Scene />);
    await waitForHandle('hosted');
    const up = await waitForReport(
      'hosted',
      isUpCounted(1),
      'up from inside the Host',
      12000
    );
    expect(up.title).toBe('Hosted dialog');
    if (Platform.OS === 'android') {
      expect(up.hosted).toBe('1');
    }
    setters.get('host-shown')?.(false);
    const probeId = await probe();
    await waitForNothingLeft(probeId, 'the Host dropped with its dialog up');
  });

  if (Platform.OS === 'ios') {
    it('answers for the status bar and orientations as the screen it covers does', async () => {
      // The dialog's window is above the app's, so UIKit asks *its* root about the
      // status bar and the orientations while the dialog is up. The root has to give
      // the answers of the app's top controller - here an RN Modal, portrait only.
      // Only the orientations discriminate: this app sets
      // `UIViewControllerBasedStatusBarAppearance` to NO, and RN's StatusBar then
      // changes neither answer the Modal gives (measured: `0,0` with `hidden` and
      // `light-content`), so the status bar half is the same code path held equal to
      // its defaults. A bare controller answers `30` (all orientations) here.
      await render(
        <Modal
          visible
          animationType="none"
          supportedOrientations={['portrait']}
        >
          <View style={{ flex: 1 }}>
            <Stage testId="chrome" initial title="Chrome" />
          </View>
        </Modal>
      );
      await waitForHandle('chrome');
      const up = await waitForReport(
        'chrome',
        isUpCounted(1),
        'up over the Modal',
        12000
      );
      // Not hidden, `.default`, `.portrait`.
      expect(up.appChrome).toBe('0,0,2');
      expect(up.chrome).toBe(up.appChrome);
      setters.get('chrome')?.(false);
      await waitForLive('chrome', 0, 'closed');
    });

    it('keeps answering as the screen it covers when that screen changes under it', async () => {
      // The answers are worked out when UIKit asks, not when the dialog presented: a
      // portrait-only Modal the app opens under an open dialog is the screen it covers
      // from then on, and once that Modal closes the app's own screen is again.
      function Scene() {
        const [modal, setModal] = useState(false);
        setters.set('chrome-modal', setModal);
        return (
          <View>
            <Stage testId="rechrome" initial title="Chrome" />
            <Modal
              visible={modal}
              animationType="none"
              presentationStyle="pageSheet"
              supportedOrientations={['portrait']}
            >
              <View style={{ flex: 1 }} />
            </Modal>
          </View>
        );
      }
      await render(<Scene />);
      await waitForHandle('rechrome');
      const up = await waitForReport('rechrome', isUpCounted(1), 'up', 12000);
      // The fixture: the app's own screen answers something other than the Modal's
      // `.portrait`, so a root still answering for it reads wrong once the Modal is up.
      expect(up.appChrome).not.toBe('0,0,2');
      expect(up.chrome).toBe(up.appChrome);
      const before = up.appChrome;
      setters.get('chrome-modal')?.(true);
      const covered = await waitForReport(
        'rechrome',
        (r) => r.appChrome === '0,0,2',
        'the portrait-only Modal on top of the app window',
        12000
      );
      expect(covered.presented).toBe('1');
      expect(covered.chrome).toBe(covered.appChrome);
      setters.get('chrome-modal')?.(false);
      const uncovered = await waitForReport(
        'rechrome',
        (r) => r.topPresented === '-',
        'the Modal closed',
        12000
      );
      expect(uncovered.appChrome).toBe(before);
      expect(uncovered.chrome).toBe(uncovered.appChrome);
      setters.get('rechrome')?.(false);
      await waitForLive('rechrome', 0, 'closed');
    });

    it('hands the key window back to the app when it closes or is dropped', async () => {
      const first = await render(<Stage testId="keyed" initial />);
      await waitForHandle('keyed');
      const up = await waitForReport('keyed', isUpCounted(1), 'up');
      // Barrier: the channel does say so when a window of ours is key.
      expect(up.key).toBe('ours');
      handles.get('keyed')?.nuiTestPerformAction('later');
      await waitForNothingLeft('keyed', 'closed by its action');
      await waitForReport(
        'keyed',
        (r) => r.key === 'app',
        'the app window key after an action'
      );
      // And when the mount goes with the dialog up.
      setters.get('keyed')?.(true);
      await waitForReport('keyed', isUpCounted(1), 'up again');
      await sleep(600);
      first.unmount();
      handles.clear();
      const probeId = await probe();
      await waitForNothingLeft(probeId, 'dropped while up');
      await waitForReport(
        probeId,
        (r) => r.key === 'app',
        'the app window key after a drop'
      );
    });
  }

  if (Platform.OS === 'android') {
    it('composes the confirmation form as a sheet with one row per action', async () => {
      await render(
        <Stage testId="sheet" initial variant="confirmation" title="Pick" />
      );
      await waitForHandle('sheet');
      const up = await waitForReport(
        'sheet',
        (r) => r.kind === 'sheet',
        'a sheet'
      );
      expect(up.actions).toBe('3');
      handles.get('sheet')?.nuiTestPerformAction('later');
      await waitForLive('sheet', 0, 'the sheet animated out and gone');
      expect(eventLog.join(',')).toBe(
        'sheet:action:later,sheet:presented:false'
      );
    });
  }
});

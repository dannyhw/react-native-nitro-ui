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
 * (`nuiTestPerformAction`, `nuiTestDismiss`). Real taps are `real-input:*`'s job.
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
    expect(eventLog).toEqual([]);
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
    expect(eventLog).toEqual([]);
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
    expect(eventLog).toEqual([
      'second:action:later',
      'second:presented:false',
      'first:action:cancel',
      'first:presented:false',
    ]);
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
    expect(eventLog).toEqual([]);
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
      expect(eventLog).toEqual([]);
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
          <Modal visible={modal} animationType="none">
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
    expect(eventLog).toEqual([
      'over-closing-modal:action:later',
      'over-closing-modal:presented:false',
    ]);
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
    expect(eventLog).toEqual(['twin:presented:false']);
  });

  it('reports an action before the close it causes', async () => {
    await render(<Stage testId="act" initial />);
    await waitForHandle('act');
    await waitForReport('act', isUp, 'up');
    handles.get('act')?.nuiTestPerformAction('delete');
    await waitForLive('act', 0, 'closed by the action');
    expect(eventLog).toEqual(['act:action:delete', 'act:presented:false']);
    expect(reportOf('act').presented).toBe('0');
  });

  it('takes no tap on a disabled action, and draws it disabled', async () => {
    const actions: DialogAction[] = [
      { id: 'cancel', title: 'Cancel', role: 'cancel' },
      { id: 'locked', title: 'Locked', disabled: true },
      { id: 'go', title: 'Go' },
    ];
    await render(<Stage testId="locked" initial actions={actions} />);
    await waitForHandle('locked');
    const up = await waitForReport('locked', isUp, 'up');
    // Read from the controller iOS built and the model Android composed.
    expect(up.enabled).toBe(Platform.OS === 'ios' ? '1,0,1' : '1,0,1');
    handles.get('locked')?.nuiTestPerformAction('locked');
    await sleep(400);
    expect(eventLog).toEqual([]);
    expect(reportOf('locked').presented).toBe('1');
    // Barrier: an enabled action on the same dialog does report.
    handles.get('locked')?.nuiTestPerformAction('go');
    await waitForLive('locked', 0, 'closed by the enabled action');
    expect(eventLog).toEqual(['locked:action:go', 'locked:presented:false']);
  });

  it('presents again when the app refuses a dismissal, and warns once', async () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };
    try {
      await render(<Stage testId="refused" initial refuse />);
      await waitForHandle('refused');
      await waitForReport('refused', isUp, 'up');
      handles.get('refused')?.nuiTestDismiss();
      // The close lands, JS echoes it, `isPresented` is still true: it comes back.
      await waitForReport(
        'refused',
        (r) => isUpCounted(1)(r) && r.presentCount === '2',
        'presented a second time after the refused dismissal',
        12000
      );
      expect(reportOf('refused').live).toBe('1');
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
      expect(eventLog).toEqual([
        'refused:presented:false',
        'refused:presented:false',
      ]);
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
    expect(eventLog).toEqual([]);
  });

  it('does nothing on a user dismissal while not dismissible', async () => {
    await render(<Stage testId="sticky" initial dismissible={false} />);
    await waitForHandle('sticky');
    await waitForReport('sticky', isUp, 'up');
    handles.get('sticky')?.nuiTestDismiss();
    await sleep(500);
    expect(reportOf('sticky').presented).toBe('1');
    expect(eventLog).toEqual([]);
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
      (r) => isUp(r) && r.title === 'Before',
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
      (r) => isUp(r) && r.title === 'Old title',
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
          (r) => isUp(r) && r.title === 'Old title',
          'reopened'
        );
      }
    }
    console.log(`recycled-dialog recycles per round: ${reuses.join(',')}`);
  });

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
      expect(eventLog).toEqual(['sheet:action:later', 'sheet:presented:false']);
    });
  }
});

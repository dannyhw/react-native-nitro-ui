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
    const up = await waitForReport('plain', isUp, 'presented on screen');
    expect(up.live).toBe('1');
    expect(up.presentCount).toBe('1');
    if (Platform.OS === 'ios') {
      console.log(`plain presenter: ${up.presenter}`);
      expect(up.kind).toBe('alert');
    }
    setters.get('plain')?.(false);
    await waitForLive('plain', 0, 'after the JS false');
    expect(reportOf('plain').presented).toBe('0');
    // A change React made is not a native interaction: nothing was reported.
    expect(eventLog).toEqual([]);
  });

  it('presents inside an RN Modal, from the Modal', async () => {
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
      isUp,
      'presented inside the Modal',
      12000
    );
    expect(up.live).toBe('1');
    if (Platform.OS === 'ios') {
      console.log(`in-modal presenter: ${up.presenter} kind=${up.kind}`);
      expect(up.presenter).toContain('Modal');
    }
    setters.get('in-modal')?.(false);
    await waitForLive('in-modal', 0, 'closed inside the Modal');
    expect(eventLog).toEqual([]);
  });

  it('presents over an RN Modal from a view under it', async () => {
    await render(
      <View style={{ flex: 1 }}>
        <Stage testId="under-modal" title="Over the Modal" />
        <Modal visible animationType="slide" presentationStyle="pageSheet">
          <View style={{ flex: 1 }} />
        </Modal>
      </View>
    );
    await waitForHandle('under-modal');
    // The Modal slides in; the dialog is asked for while it may still be animating,
    // which is the transition `topPresenter` has to wait out.
    await sleep(150);
    setters.get('under-modal')?.(true);
    const up = await waitForReport(
      'under-modal',
      isUp,
      'presented over the Modal',
      12000
    );
    expect(up.live).toBe('1');
    if (Platform.OS === 'ios') {
      console.log(`under-modal presenter: ${up.presenter}`);
      expect(up.presenter).toContain('Modal');
    }
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
    await waitForReport('first', isUp, 'the first dialog up');
    setters.get('second')?.(true);
    const second = await waitForReport(
      'second',
      isUp,
      'the second dialog up',
      12000
    );
    expect(second.live).toBe('2');
    if (Platform.OS === 'ios') {
      console.log(`second presenter: ${second.presenter}`);
      expect(second.presenter).toBe('NitroUiAlertController');
    }
    handles.get('second')?.nuiTestPerformAction('later');
    await waitForLive('first', 1, 'the second closed, the first still up');
    expect(reportOf('first').presented).toBe('1');
    handles.get('first')?.nuiTestPerformAction('cancel');
    await waitForLive('first', 0, 'both closed');
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
    await waitForLive('flicker', 0, 'the window gone after a mid-entry false');
    await sleep(800);
    const settled = reportOf('flicker');
    expect(settled.live).toBe('0');
    expect(settled.presented).toBe('0');
    if (Platform.OS === 'ios') expect(settled.topPresented).toBe('-');
    expect(eventLog).toEqual([]);
  });

  for (const delay of [0, 80, 150, 1000]) {
    it(`leaves no window when dropped ${String(delay)} ms after presenting`, async () => {
      const first = await render(<Stage testId="dropped" />);
      await waitForHandle('dropped');
      setters.get('dropped')?.(true);
      if (delay > 0) await sleep(delay);
      if (delay >= 1000)
        await waitForReport('dropped', isUp, 'up before the drop');
      first.unmount();
      handles.clear();
      const probeId = await probe();
      await waitForLive(probeId, 0, `after a drop ${String(delay)} ms in`);
      if (Platform.OS === 'ios') {
        await waitForReport(
          probeId,
          (r) => r.topPresented === '-',
          'nothing presented on top'
        );
      }
      // The dropped mount reports nothing: its callbacks went with it.
      expect(eventLog).toEqual([]);
    });
  }

  it('reports a close when the RN Modal under an open dialog goes away', async () => {
    function Scene() {
      const [modal, setModal] = useState(true);
      setters.set('modal', setModal);
      return (
        <Modal visible={modal} animationType="none">
          <View style={{ flex: 1 }}>
            <Stage testId="in-closing-modal" initial title="Doomed" />
          </View>
        </Modal>
      );
    }
    await render(<Scene />);
    await waitForHandle('in-closing-modal');
    await waitForReport('in-closing-modal', isUp, 'up inside the Modal', 12000);
    setters.get('modal')?.(false);
    const probeId = await probe();
    await waitForLive(probeId, 0, 'the Modal and its dialog gone');
    console.log(
      `events after the Modal closed: ${eventLog.join(',') || '(none)'}`
    );
  });
});

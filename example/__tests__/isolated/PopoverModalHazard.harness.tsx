/**
 * The stranded-Modal hazard (DECISIONS D35 item 5) for Popover, in an app instance of
 * its own.
 *
 * React Native closes a `Modal` by dismissing *its own* controller. A popover presented
 * in that controller's chain is what UIKit dismisses instead, and the `Modal`'s host
 * stays over the app for good - and, as G18 measured for Tooltip, a popover left in the
 * chain is also what makes UIKit *refuse the next* `Modal` the app opens. So Popover
 * presents from a window of its own, as Tooltip does (D41), rather than through D35's
 * chain.
 *
 * This file closes the Modal *while the popover inside it is up*: the exact move that
 * strands. Were the rule ever to regress, RN's host would be left over the app and every
 * later file in the same process would lay out under it, so this file must never run in
 * the shared harness process. `example/jest.harness.config.mjs` keeps `__tests__/isolated/`
 * out of the shared run; run it alone with
 *
 *   NITRO_UI_HARNESS_ISOLATED=1 node scripts/gate.mjs harness:ios -- PopoverModalHazard
 *
 * Android has no chain to strand - the popup is a window, and so is the Modal - so there
 * the same moves pin the other half: the Modal going takes the popup with it, silently,
 * and leaves no root behind.
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
import { nitroUiCore, Popover } from 'react-native-nitro-ui';

type PopoverHandle = { nuiTestStateReport(): string };

const IOS = Platform.OS === 'ios';
const handles = new Map<string, PopoverHandle>();
const eventLog: string[] = [];
const setters = new Map<string, (next: boolean) => void>();

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

async function waitForReport(
  testId: string,
  check: (report: Report) => boolean,
  what: string,
  timeoutMs = 10000
): Promise<Report> {
  const deadline = nitroUiCore.now() + timeoutMs;
  for (;;) {
    const report = reportOf(testId);
    if (check(report)) return report;
    if (nitroUiCore.now() > deadline) {
      throw new Error(
        `"${testId}" never reached ${what}; its report is "${report.raw}"; events=[${eventLog.join(',')}]`
      );
    }
    await sleep(50);
  }
}

const isUp = (report: Report) =>
  report.presented === '1' &&
  report.live === '1' &&
  report.onScreen === '1' &&
  Number(report.askedW) > 0;

/** A popover whose `isPresented` lives in a parent, as an app's would. */
function Pin({ testId }: { testId: string }) {
  const [open, setOpen] = useState(false);
  setters.set(testId, setOpen);
  return (
    <Popover
      hybridRef={(view: PopoverHandle) => handles.set(testId, view)}
      isPresented={open}
      onIsPresentedChange={(next) => {
        eventLog.push(`${testId}:presented:${String(next)}`);
        setOpen(next);
      }}
      onDismiss={() => eventLog.push(`${testId}:dismiss`)}
      anchor={<View style={{ width: 120, height: 40, backgroundColor: '#e5e5ea' }} />}
    >
      <View style={{ width: 170, height: 96, backgroundColor: '#9ec5fe' }} />
    </Popover>
  );
}

/** A screen with an RN `Modal` and a popover in the Modal's content. */
function Screen({ style }: { style: 'fullScreen' | 'pageSheet' }) {
  const [modal, setModal] = useState(true);
  setters.set('modal', setModal);
  return (
    <View style={{ flex: 1 }}>
      <Modal visible={modal} animationType="none" presentationStyle={style}>
        <View style={{ flex: 1, paddingTop: 260, paddingLeft: 70 }}>
          <Pin testId="pin" />
        </View>
      </Modal>
    </View>
  );
}

/** A plain mount under no Modal, whose only job is to read what is left. */
function Probe() {
  return (
    <View style={{ flex: 1, paddingTop: 260, paddingLeft: 70 }}>
      <Pin testId="probe" />
    </View>
  );
}

describe('Popover · the stranded-Modal hazard (own app instance)', () => {
  afterEach(async () => {
    cleanup();
    handles.clear();
    setters.clear();
    eventLog.length = 0;
    await sleep(800);
  });

  for (const style of ['fullScreen', 'pageSheet'] as const) {
    it(`leaves no Modal host behind when a ${style} Modal closes with its popover up`, async () => {
      await render(<Screen style={style} />);
      await waitForReport('pin', (r) => r.raw !== '', 'a report');
      await sleep(600);
      setters.get('pin')?.(true);
      const shown = await waitForReport('pin', isUp, 'up inside the Modal');
      // The move that strands a popover in the Modal's chain. On iOS RN keeps a closing
      // Modal's content mounted until its native dismissal has ended, so the popover
      // sees its window go first - the window-loss close, reported once - and is
      // unmounted after. On Android the unmount comes first: a drop, which reports
      // nothing (D44 item 2). Pinned both ways, so a change on either side is seen.
      setters.get('modal')?.(false);
      await sleep(1800);
      cleanup();
      handles.clear();
      // Read through a fresh mount under no Modal: no popover, and no `Modal` host left
      // over the app - which is the residue that makes UIKit refuse the next one.
      await render(<Probe />);
      const after = await waitForReport(
        'probe',
        (r) =>
          r.live === '0' &&
          (IOS
            ? r.modalHosts === '0' && r.topPresented === '-' && r.windows === '0'
            : r.roots === '0'),
        'nothing of the popover or the Modal left'
      );
      expect(after.presented).toBe('0');
      if (IOS) {
        // Why, asserted after the strand itself so a regression reads as the strand: a
        // window of its own, so RN's dismissal of the Modal reaches the Modal and not
        // the popover - and the app's chain never holds a popover at all.
        expect(shown.ownWindow).toBe('1');
        expect(shown.topPresented).toContain('ModalHostViewController');
      }
      console.log(
        `popover in a closing ${style} Modal reported: [${eventLog.join(',')}]`
      );
      expect(eventLog).toEqual(IOS ? ['pin:presented:false'] : []);
    });
  }
});

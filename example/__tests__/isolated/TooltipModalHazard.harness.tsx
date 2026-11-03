/**
 * The stranded-Modal hazard (DECISIONS D35 item 5) for Tooltip, in an app instance of
 * its own.
 *
 * React Native closes a `Modal` by dismissing *its own* controller. A popover presented
 * in that controller's chain is what UIKit dismisses instead, and the `Modal`'s host
 * stays over the app for good (G11's finding). A tooltip opened inside a `Modal` is the
 * plainest way to get there, so on iOS a tooltip always presents from a window of its
 * own (`docs/components/tooltip.md`, "Presenting").
 *
 * This file closes the Modal *while the tooltip inside it is up* - the move that strands
 * it. If the rule ever regresses, RN's host is left over the app and every later file
 * in the same process lays out under it, so this file must never run in the shared
 * harness process. `example/jest.harness.config.mjs` keeps `__tests__/isolated/` out of
 * the shared run; run it alone with
 *
 *   NITRO_UI_HARNESS_ISOLATED=1 node scripts/gate.mjs harness:ios -- TooltipModalHazard
 *
 * Android has no chain to strand - Material's popup is a window, and so is the Modal -
 * so there the same moves pin the other half: closing the Modal takes the tooltip in
 * it down with it, and leaves no popup behind.
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
import { nitroUiCore, Tooltip } from 'react-native-nitro-ui';

/** What `hybridRef` hands back - declared, not imported (D14). */
type TooltipHandle = {
  nuiTestStateReport(): string;
};

const IOS = Platform.OS === 'ios';
const handles = new Map<string, TooltipHandle>();
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

/** Up: native shows it, iOS has the popover on screen, Android composed its content. */
const up = (report: Report) =>
  report.presented === '1' &&
  report.live === '1' &&
  (IOS
    ? report.onScreen === '1'
    : report.kind === 'rich' || report.kind === 'plain');

/** A tooltip whose `isPresented` lives in a parent, as an app's would. */
function Tip({ testId }: { testId: string }) {
  const [open, setOpen] = useState(false);
  setters.set(testId, setOpen);
  return (
    <Tooltip
      hybridRef={(view: TooltipHandle) => handles.set(testId, view)}
      isPresented={open}
      onIsPresentedChange={(next) => {
        eventLog.push(`${testId}:presented:${String(next)}`);
        setOpen(next);
      }}
      title="Saved searches"
      message="Tap the star to keep this search."
      actions={[{ id: 'ok', title: 'Got it' }]}
    >
      <View style={{ width: 120, height: 44, backgroundColor: '#e5e5ea' }} />
    </Tooltip>
  );
}

/** A screen with an RN `Modal` and a tooltip in the Modal's content. */
function Screen({ style }: { style: 'fullScreen' | 'pageSheet' }) {
  const [modal, setModal] = useState(true);
  setters.set('modal', setModal);
  return (
    <View style={{ flex: 1 }}>
      <Modal visible={modal} animationType="none" presentationStyle={style}>
        <View style={{ flex: 1, paddingTop: 300, paddingLeft: 80 }}>
          <Tip testId="tip" />
        </View>
      </Modal>
    </View>
  );
}

/** A plain mount under no Modal, whose only job is to read what is left. */
function Probe() {
  return (
    <View style={{ flex: 1, paddingTop: 300, paddingLeft: 80 }}>
      <Tip testId="probe" />
    </View>
  );
}

describe('Tooltip · the stranded-Modal hazard (own app instance)', () => {
  afterEach(async () => {
    cleanup();
    handles.clear();
    setters.clear();
    eventLog.length = 0;
    await sleep(800);
  });

  for (const style of ['fullScreen', 'pageSheet'] as const) {
    it(`leaves no Modal host behind when a ${style} Modal closes with its tooltip up`, async () => {
      await render(<Screen style={style} />);
      await waitForReport('tip', (r) => r.raw !== '', 'a report');
      await sleep(600);
      setters.get('tip')?.(true);
      const shown = await waitForReport('tip', up, 'up inside the Modal');
      if (IOS) {
        // Why: a window of its own, so RN's dismissal of the Modal reaches the Modal.
        expect(shown.presenter).toBe('ownWindow');
        expect(shown.appTop).toContain('ModalHostViewController');
      }
      // The move that strands a popover in the Modal's chain. On iOS React Native keeps
      // a closing Modal's content mounted until its native dismissal has ended, so the
      // tooltip sees its window go first - the window-loss close, reported once - and is
      // unmounted after. On Android the unmount comes first: a drop, which reports
      // nothing. Pinned both ways (measured), so a change on either side is seen.
      setters.get('modal')?.(false);
      await sleep(1500);
      cleanup();
      handles.clear();
      // Nothing of either is left: read through a fresh mount under no Modal.
      await render(<Probe />);
      const after = await waitForReport(
        'probe',
        (r) =>
          r.live === '0' &&
          (IOS
            ? r.modalHosts === '0' &&
              r.topPresented === '-' &&
              r.windows === '0'
            : true),
        'nothing of the tooltip or the Modal left'
      );
      expect(after.presented).toBe('0');
      console.log(
        `tooltip in a closing ${style} Modal reported: [${eventLog.join(',')}]`
      );
      expect(eventLog).toEqual(IOS ? ['tip:presented:false'] : []);
    });
  }
});

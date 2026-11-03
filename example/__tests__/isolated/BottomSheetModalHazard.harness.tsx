/**
 * The stranded-Modal hazard (DECISIONS D35 item 5), in an app instance of its own.
 *
 * React Native closes a `Modal` by dismissing *its own* controller. A sheet presented in
 * that controller's chain is what UIKit dismisses instead, and the `Modal`'s host stays
 * over the app for good (G11's finding, reproduced by S2). D35's rule avoids it: a
 * BottomSheet presents in a window of its own whenever an RN `Modal` is on top.
 *
 * This file closes the Modal *while the sheet is up* - the exact move that strands it.
 * If the rule ever regresses, RN's host is left over the app and every later file in
 * the same process lays out under it (S2: 15 files at `0 x 0`), so this file must never
 * run in the shared harness process. `example/jest.harness.config.mjs` keeps
 * `__tests__/isolated/` out of the shared run; run it alone with
 *
 *   NITRO_UI_HARNESS_ISOLATED=1 node scripts/gate.mjs harness:ios -- BottomSheetModalHazard
 *
 * Android has no chain to strand - Material's sheet is a `Dialog` window, and so is the
 * Modal - so there the same moves pin the other half: the Modal closing under the sheet
 * leaves the sheet up, focused and unreported.
 */
import { useState } from 'react';
import { Modal, Platform, Text, View } from 'react-native';
import {
  afterEach,
  cleanup,
  describe,
  expect,
  it,
  render,
} from 'react-native-harness';
import { BottomSheet, nitroUiCore } from 'react-native-nitro-ui';

type SheetHandle = {
  nuiTestStateReport(): string;
};

const IOS = Platform.OS === 'ios';
const handles = new Map<string, SheetHandle>();
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

const up = (report: Report) =>
  report.presented === '1' &&
  report.live === '1' &&
  Number(report.children) >= 1 &&
  (IOS
    ? report.onScreen === '1'
    : report.sheetValue !== 'none' && report.sheetValue !== 'Hidden');

/**
 * A screen with a BottomSheet and an RN `Modal`. `inside` puts the sheet in the Modal's
 * content; otherwise the sheet's view is on the screen *under* the Modal, which is the
 * case where only D35's rule - not the view's own place - keeps it out of the chain.
 */
function Screen({ inside }: { inside: boolean }) {
  const [modal, setModal] = useState(true);
  const [sheet, setSheet] = useState(false);
  setters.set('modal', setModal);
  setters.set('sheet', setSheet);
  const content = (
    <BottomSheet
      hybridRef={(view: SheetHandle) => handles.set('sheet', view)}
      isPresented={sheet}
      onIsPresentedChange={(next) => {
        eventLog.push(`presented:${String(next)}`);
        setSheet(next);
      }}
      onDismiss={() => eventLog.push('dismiss')}
    >
      <View style={{ height: 200, padding: 20 }}>
        <Text>Over the Modal</Text>
      </View>
    </BottomSheet>
  );
  return (
    <View style={{ flex: 1 }}>
      {inside ? null : content}
      {/* `pageSheet` when the sheet is under the Modal: a full-screen Modal takes the
          screen under it out of the window, and a sheet whose place is out of the window
          closes (as a dialog does), which is a different case. */}
      <Modal
        visible={modal}
        animationType="none"
        presentationStyle={inside ? 'fullScreen' : 'pageSheet'}
      >
        <View style={{ flex: 1 }}>{inside ? content : null}</View>
      </Modal>
    </View>
  );
}

describe('BottomSheet · the stranded-Modal hazard (own app instance)', () => {
  afterEach(async () => {
    cleanup();
    handles.clear();
    setters.clear();
    eventLog.length = 0;
    await sleep(800);
  });

  it('leaves no Modal host behind when the Modal closes under a sheet presented over it', async () => {
    await render(<Screen inside={false} />);
    await waitForReport('sheet', (r) => r.raw !== '', 'a report');
    await sleep(600);
    setters.get('sheet')?.(true);
    const shown = await waitForReport('sheet', up, 'up over the Modal');
    // The move that strands a sheet in the Modal's chain. Asserted first, so a
    // regression reads as the strand itself, not as a field that predicts it.
    setters.get('modal')?.(false);
    await sleep(1200);
    const after = await waitForReport(
      'sheet',
      (r) => (IOS ? r.modalHosts === '0' && r.topPresented === '-' : true),
      'no Modal host left in the app window'
    );
    // The sheet was not in the Modal's chain, so closing the Modal did not take it.
    expect(up(after)).toBe(true);
    expect(after.unasked).toBe('0');
    expect(eventLog).toEqual([]);
    if (IOS) {
      // Why: D35 - an RN Modal on top means a window of its own, above the alerts.
      expect(shown.ownWindow).toBe('1');
      expect(shown.appTop).toContain('ModalHostViewController');
      expect(Number(shown.windowLevel)).toBeGreaterThan(1000);
    }
    setters.get('sheet')?.(false);
    await waitForReport('sheet', (r) => r.live === '0', 'closed');
    expect(eventLog).toEqual(['dismiss']);
  });

  it('leaves no Modal host behind when the Modal holding the sheet closes while it is up', async () => {
    await render(<Screen inside />);
    await waitForReport('sheet', (r) => r.raw !== '', 'a report');
    await sleep(600);
    setters.get('sheet')?.(true);
    const shown = await waitForReport('sheet', up, 'up from inside the Modal');
    if (IOS) expect(shown.ownWindow).toBe('1');
    // Closing the Modal unmounts the sheet with it: a drop while presented.
    setters.get('modal')?.(false);
    await sleep(1500);
    cleanup();
    handles.clear();
    // Nothing of either is left: read through a fresh mount.
    await render(<Screen inside={false} />);
    setters.get('modal')?.(false);
    await waitForReport(
      'sheet',
      (r) =>
        r.live === '0' &&
        (IOS
          ? r.modalHosts === '0' && r.topPresented === '-' && r.windows === '0'
          : r.roots === '0'),
      'nothing of the sheet or the Modal left'
    );
  });
});

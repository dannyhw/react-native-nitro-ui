/**
 * BottomSheet under react-native-screens (DECISIONS D35 item 3): measured with the
 * dependency added for one commit and reverted, as G11 did for the dialogs.
 *
 * Isolated, because an in-chain sheet over a `formSheet` that closes under it is the
 * same shape as the stranded-Modal case: whatever this measures must not be able to
 * leave a presented controller over the files after it.
 */
import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { ScreenStack, ScreenStackItem } from 'react-native-screens';
import {
  afterEach,
  cleanup,
  describe,
  expect,
  it,
  render,
} from 'react-native-harness';
import { BottomSheet, nitroUiCore } from 'react-native-nitro-ui';

type SheetHandle = { nuiTestStateReport(): string };
type Report = Record<string, string>;

const IOS = Platform.OS === 'ios';
const handles = new Map<string, SheetHandle>();
const setters = new Map<string, (next: boolean) => void>();
const eventLog: string[] = [];

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
  timeoutMs = 12000
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

function Sheet({ testId, initial }: { testId: string; initial: boolean }) {
  const [open, setOpen] = useState(initial);
  setters.set(testId, setOpen);
  return (
    <BottomSheet
      hybridRef={(view: SheetHandle) => handles.set(testId, view)}
      isPresented={open}
      onIsPresentedChange={(next) => {
        eventLog.push(`${testId}:presented:${String(next)}`);
        setOpen(next);
      }}
      onDismiss={() => eventLog.push(`${testId}:dismiss`)}
    >
      <View style={{ height: 180, padding: 20 }}>
        <Text>In a screen</Text>
      </View>
    </BottomSheet>
  );
}

describe('BottomSheet · react-native-screens (G14, D35 item 3)', () => {
  afterEach(async () => {
    cleanup();
    handles.clear();
    setters.clear();
    eventLog.length = 0;
    await sleep(800);
  });

  it('presents from a native-stack screen, and a push over that screen closes and reports it', async () => {
    function Scene() {
      const [pushed, setPushed] = useState(false);
      setters.set('push', setPushed);
      return (
        <ScreenStack style={{ flex: 1 }}>
          <ScreenStackItem screenId="base" headerConfig={{ hidden: true }}>
            <View style={{ flex: 1 }}>
              <Sheet testId="stack" initial={false} />
            </View>
          </ScreenStackItem>
          {pushed ? (
            <ScreenStackItem screenId="next" headerConfig={{ hidden: true }}>
              <View style={{ flex: 1 }} />
            </ScreenStackItem>
          ) : null}
        </ScreenStack>
      );
    }
    await render(<Scene />);
    await waitForReport('stack', (r) => r.raw !== '', 'a report');
    await sleep(500);
    setters.get('stack')?.(true);
    const shown = await waitForReport(
      'stack',
      up,
      'up from a native-stack screen'
    );
    console.log(`native-stack report: ${shown.raw}`);
    if (IOS) expect(shown.ownWindow).toBe('0');
    setters.get('push')?.(true);
    const after = await waitForReport(
      'stack',
      (r) => r.live === '0',
      'closed when a screen was pushed over',
      15000
    );
    console.log(`push: ${after.raw} events=[${eventLog.join(',')}]`);
    expect(eventLog).toContain('stack:presented:false');
  });

  it('presents over a formSheet, and the formSheet closing under it leaves nothing', async () => {
    function Scene() {
      const [sheet, setSheet] = useState(true);
      setters.set('form', setSheet);
      return (
        <ScreenStack style={{ flex: 1 }}>
          <ScreenStackItem screenId="base" headerConfig={{ hidden: true }}>
            <View style={{ flex: 1 }} />
          </ScreenStackItem>
          {sheet ? (
            <ScreenStackItem
              screenId="form"
              stackPresentation="formSheet"
              sheetAllowedDetents={[0.6]}
              headerConfig={{ hidden: true }}
            >
              <View style={{ flex: 1 }}>
                <Sheet testId="over-form" initial={false} />
              </View>
            </ScreenStackItem>
          ) : null}
        </ScreenStack>
      );
    }
    await render(<Scene />);
    await waitForReport('over-form', (r) => r.raw !== '', 'a report');
    await sleep(1200);
    setters.get('over-form')?.(true);
    const shown = await waitForReport('over-form', up, 'up over the formSheet');
    console.log(`formSheet report: ${shown.raw}`);
    // The formSheet goes away with the sheet still up on it.
    setters.get('form')?.(false);
    await sleep(1500);
    cleanup();
    handles.clear();
    // Read what is left through a fresh mount on a plain screen.
    await render(<Sheet testId="probe" initial={false} />);
    const left = await waitForReport(
      'probe',
      (r) =>
        r.live === '0' &&
        (IOS ? r.topPresented === '-' && r.windows === '0' : r.roots === '0'),
      'nothing of the formSheet or the sheet left',
      15000
    );
    console.log(
      `after the formSheet closed: ${left.raw} events=[${eventLog.join(',')}]`
    );
  });
});

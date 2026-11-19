import { processColor, TurboModuleRegistry, View } from 'react-native';
import {
  afterEach,
  cleanup,
  describe,
  expect,
  it,
  render,
  screen,
} from 'react-native-harness';
import { Button, nitroUiCore } from 'react-native-nitro-ui';

import { waitForHandle } from './handles';

/**
 * An `androidIcon` the app `require`s from a folder whose name holds a space. In development
 * Metro writes that URL out of the file's path as it stands, and the file still has to be reached.
 */

type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

type ButtonHandle = {
  /** The string the wrapper sent native: `url:<Metro url>` for an imported asset. */
  readonly androidIcon: string | null;
  nuiTestPixelProbe(color: number): void;
  nuiTestPixelReport(): string;
};

const handles = new Map<string, ButtonHandle>();
const captureHybrid =
  (testId: string) =>
  (view: ButtonHandle): void => {
    handles.set(testId, view);
  };

const TEST_ID = 'spaced-star';

/** A colour no chrome of the Button wears, so a hit can only be the glyph. */
const TINT_CSS = '#FF00A0';
const TINT = processColor(TINT_CSS) as number;

/** `star_24px.xml` again, byte for byte, one folder deeper: a name a URL must escape. */
const SPACED_ASSET = require('../src/assets/icons with a space/star_24px.xml');

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function probeHits(report: string): number {
  const hits = / hits=(\d+)/.exec(report);
  return hits == null ? 0 : Number(hits[1]);
}

/** Probes the slot until the probe answers with a line about the sample it took. */
async function probeUntilAnswered(
  handle: ButtonHandle,
  timeoutMs: number
): Promise<string> {
  const before = handle.nuiTestPixelReport();
  handle.nuiTestPixelProbe(TINT);
  const deadline = nitroUiCore.now() + timeoutMs;
  for (;;) {
    const report = handle.nuiTestPixelReport();
    if (report !== '' && report !== before) {
      return report;
    }
    if (nitroUiCore.now() > deadline) {
      return report;
    }
    await sleep(50);
  }
}

afterEach(() => {
  cleanup();
  handles.clear();
});

describe('androidIcon · a Metro path that needs escaping', () => {
  it('draws an icon whose folder name holds a space', async () => {
    await render(
      <View style={{ gap: 6 }}>
        <Button
          title=""
          variant="text"
          tintColor={TINT_CSS}
          androidIcon={SPACED_ASSET}
          testID={TEST_ID}
          hybridRef={captureHybrid(TEST_ID)}
        />
      </View>,
      { timeout: 20000 }
    );
    await screen.findByTestId(TEST_ID);
    const handle = await waitForHandle(() => handles.get(TEST_ID), {
      what: 'the Button holding the spaced icon',
    });

    const sent = handle.androidIcon ?? '';
    console.log(`spaced icon wire: ${sent}`);
    expect(sent.startsWith('url:')).toBe(true);
    // The premise of the whole case: Metro's URL arrives with the space still in it.
    expect(sent).toContain(' ');

    let report = '';
    let hits = 0;
    const deadline = nitroUiCore.now() + 20000;
    for (;;) {
      report = await probeUntilAnswered(handle, 4000);
      hits = probeHits(report);
      if (hits > 0 || nitroUiCore.now() > deadline) {
        break;
      }
      await sleep(50);
    }
    if (hits === 0) {
      throw new Error(
        `the icon served from "${sent}" never drew. Last probe: "${report}". ` +
          `Nothing is drawn when the request for the file is not made for the right URL.`
      );
    }
    expect(hits).toBeGreaterThan(0);
    // The slot is drawn where the control is, not somewhere else on the screen.
    expect(harnessUi.queryByTestId(TEST_ID)).not.toBeNull();
  });
});

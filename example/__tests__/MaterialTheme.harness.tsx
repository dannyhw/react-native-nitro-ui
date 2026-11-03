/**
 * On-device tests for the Android theme (task X18, DECISIONS D39 item 3).
 *
 * Android draws every control with Material 3 Expressive unless the app calls
 * `setMaterialTheme('baseline')`. The question each case asks is the one the opt-out
 * has to answer for: does the choice reach *every* composition the library owns - a
 * control's own (one per Hybrid View) and a `<Host>`'s, which its children compose
 * inside - and does it reach the ones already on screen, both ways?
 *
 * The reading is `nitroUiCore.materialThemeReport()`: the setting, and how many theme
 * roots have composed under each Material motion scheme. The count is taken inside
 * the theme from `MaterialTheme.motionScheme` - what Material hands a control's
 * content, not what the root meant to choose - so a root that ignored the setting
 * shows up as a count under the wrong scheme. Every case reads the change across
 * its own window, because the totals belong to the process and other suites mount
 * controls too.
 *
 * iOS has no Material theme: there the report is empty and the call is a no-op, and
 * the last case holds it to that.
 */
import { Platform } from 'react-native';
import {
  afterEach,
  cleanup,
  describe,
  expect,
  it,
  render,
} from 'react-native-harness';
import {
  Host,
  Switch,
  nitroUiCore,
  setMaterialTheme,
} from 'react-native-nitro-ui';

type Report = {
  setting: string;
  expressive: number;
  baseline: number;
  other: number;
};

function readReport(): Report {
  const raw = nitroUiCore.materialThemeReport();
  const fields = new Map(
    raw.split(';').map((pair) => {
      const [key, value] = pair.split('=');
      return [key ?? '', value ?? ''] as const;
    })
  );
  return {
    setting: fields.get('setting') ?? '',
    expressive: Number(fields.get('expressive') ?? 'NaN'),
    baseline: Number(fields.get('baseline') ?? 'NaN'),
    other: Number(fields.get('other') ?? 'NaN'),
  };
}

function delta(before: Report, after: Report) {
  return {
    expressive: after.expressive - before.expressive,
    baseline: after.baseline - before.baseline,
    other: after.other - before.other,
  };
}

/** Poll until `done(report)` holds; fail with the last report if it never does. */
async function waitForReport(
  done: (report: Report) => boolean,
  what: string,
  timeoutMs = 5000
): Promise<Report> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const report = readReport();
    if (done(report)) return report;
    if (Date.now() > deadline) {
      throw new Error(
        `${what}: never happened within ${String(timeoutMs)}ms; last report ` +
          nitroUiCore.materialThemeReport()
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Long enough for any recomposition the last change scheduled to have run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

/**
 * Three controls with a composition each, and a Host whose two Switches compose in
 * the Host's: four theme roots, so a root the setting missed would leave its count
 * under the wrong scheme.
 */
const ROOTS = 4;

function Screen() {
  return (
    <>
      <Switch defaultValue testID="theme-switch-a" />
      <Switch defaultValue={false} testID="theme-switch-b" />
      <Switch defaultValue disabled testID="theme-switch-c" />
      <Host style={{ width: 200, height: 96 }}>
        <Switch defaultValue testID="theme-hosted-a" />
        <Switch defaultValue={false} testID="theme-hosted-b" />
      </Host>
    </>
  );
}

const android = Platform.OS === 'android';

describe('MaterialTheme', () => {
  afterEach(async () => {
    await cleanup();
    // The setting is the process's, and the suites after this one expect the default.
    setMaterialTheme('expressive');
  });

  it('draws every composition with Material 3 Expressive by default', async () => {
    if (!android) return;
    const before = readReport();
    expect(before.setting).toBe('expressive');
    await render(<Screen />);
    const after = await waitForReport(
      (report) => report.expressive - before.expressive >= ROOTS,
      `${String(ROOTS)} roots composing under the Expressive motion scheme`
    );
    await settle();
    const moved = delta(before, readReport());
    console.log(
      `[theme] default: ${JSON.stringify(moved)} (${after.setting})`
    );
    expect(moved.baseline).toBe(0);
    expect(moved.other).toBe(0);
  });

  it('opts every composition out to the baseline theme, a Host included', async () => {
    if (!android) return;
    setMaterialTheme('baseline');
    const before = readReport();
    expect(before.setting).toBe('baseline');
    await render(<Screen />);
    await waitForReport(
      (report) => report.baseline - before.baseline >= ROOTS,
      `${String(ROOTS)} roots composing under the standard motion scheme`
    );
    await settle();
    const moved = delta(before, readReport());
    console.log(`[theme] opted out: ${JSON.stringify(moved)}`);
    expect(moved.expressive).toBe(0);
    expect(moved.other).toBe(0);
  });

  it('moves the controls already on screen, both ways', async () => {
    if (!android) return;
    const mounted = readReport();
    await render(<Screen />);
    await waitForReport(
      (report) => report.expressive - mounted.expressive >= ROOTS,
      `${String(ROOTS)} roots composing under the Expressive motion scheme`
    );
    await settle();

    // Out: every live root recomposes under the baseline theme.
    const beforeOut = readReport();
    setMaterialTheme('baseline');
    await waitForReport(
      (report) => report.baseline - beforeOut.baseline >= ROOTS,
      `${String(ROOTS)} mounted roots recomposing under the standard motion scheme`
    );
    await settle();
    const out = delta(beforeOut, readReport());
    console.log(`[theme] live out: ${JSON.stringify(out)}`);
    expect(out.expressive).toBe(0);

    // And back: the same roots return to Expressive.
    const beforeBack = readReport();
    setMaterialTheme('expressive');
    await waitForReport(
      (report) => report.expressive - beforeBack.expressive >= ROOTS,
      `${String(ROOTS)} mounted roots recomposing under the Expressive motion scheme`
    );
    await settle();
    const back = delta(beforeBack, readReport());
    console.log(`[theme] live back: ${JSON.stringify(back)}`);
    expect(back.baseline).toBe(0);
    expect(back.other).toBe(0);
  });

  it('is a no-op on iOS, with nothing to report', async () => {
    if (android) return;
    expect(nitroUiCore.materialThemeReport()).toBe('');
    setMaterialTheme('baseline');
    setMaterialTheme('expressive');
    expect(nitroUiCore.materialThemeReport()).toBe('');
  });
});

import {
  afterEach,
  cleanup,
  describe,
  expect,
  it,
  render,
} from 'react-native-harness';
import {
  Button,
  ButtonGroup,
  type ButtonGroupItem,
} from 'react-native-nitro-ui';

/**
 * An SF Symbol name iOS has no symbol for draws nothing. In a development build
 * that says so: one warning per component and name, naming the prop and the
 * name. Whether a name draws is the device's answer, and it arrives after the
 * render that asked, so each test waits for it.
 *
 * The `.ios.` in the file name is what keeps this off the Android run: the
 * harness collects a platform-suffixed file only for that platform. Android has
 * no SF Symbols, and warns about its own icon names in plain JS instead, where
 * that is tested (`src/__tests__/iconName.test.tsx`).
 */

/** A name every iOS this library runs on has a symbol for. */
const DRAWABLE = 'square.and.arrow.up';
/** Names no iOS has: each test owns one, so the once-per-name memory is its own. */
const MISSING_BUTTON = 'nui.sysimg.button.missing';
const MISSING_ROW = 'nui.sysimg.item.missing';
const MISSING_RERENDER = 'nui.sysimg.rerender.missing';

const press = (): void => {};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Everything the app warned with while the current test held the console. */
let printed: string[] = [];

/** Holds the app's console for one test, keeping its warnings. */
function captureWarnings(): () => void {
  const lines = printed;
  const original = console.warn;
  console.warn = (...args: unknown[]): void => {
    lines.push(args.map(String).join(' '));
  };
  return () => {
    console.warn = original;
  };
}

/**
 * The warnings this library said. Anything else the app warned with is the
 * app's business and cannot make these tests depend on it.
 */
function libraryWarnings(): string[] {
  return printed.filter((line) => line.startsWith('nitro-ui:'));
}

/**
 * Waits for the device's answer to have been said out loud. It also fails the
 * test with every warning that did come, which is what a wrong answer looks
 * like from here.
 */
async function waitForWarning(name: string): Promise<void> {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (libraryWarnings().some((line) => line.includes(name))) {
      return;
    }
    await sleep(50);
  }
  throw new Error(
    `no warning named "${name}" within 8s; warnings so far: ` +
      JSON.stringify(printed)
  );
}

function about(name: string): string[] {
  return libraryWarnings().filter((line) => line.includes(name));
}

const ROWS: ButtonGroupItem[] = [
  { id: 'draws', title: 'Share', systemImage: DRAWABLE },
  { id: 'missing', title: 'Copy', systemImage: MISSING_ROW },
];

describe('SF Symbol names this iOS cannot draw', () => {
  afterEach(() => {
    cleanup();
    printed = [];
  });

  it('names the Button prop and name iOS cannot draw, once', async () => {
    const restore = captureWarnings();
    try {
      await render(
        <>
          <Button
            title="Share"
            systemImage={DRAWABLE}
            onPress={press}
            testID="draws"
          />
          <Button
            title="Share"
            systemImage={MISSING_BUTTON}
            onPress={press}
            testID="missing"
          />
        </>,
        // The first hosted view of a run pays for the first Nitro call.
        { timeout: 20000 }
      );
      await waitForWarning(MISSING_BUTTON);
      expect(about(MISSING_BUTTON)).toEqual([
        `nitro-ui: Button's systemImage "${MISSING_BUTTON}" is not an SF ` +
          `Symbol this iOS can draw. Nothing will be drawn for it. ` +
          `See docs/components/button.md, "SF Symbols".`,
      ]);
      // The valid name in the same batch was asked about too, and answered.
      expect(about(DRAWABLE)).toEqual([]);
      expect(libraryWarnings().length).toBe(1);
    } finally {
      restore();
    }
  });

  it('names a row-level name by the item prop that carried it', async () => {
    const restore = captureWarnings();
    try {
      await render(<ButtonGroup items={ROWS} onPress={press} testID="rows" />);
      await waitForWarning(MISSING_ROW);
      expect(about(MISSING_ROW)).toEqual([
        `nitro-ui: ButtonGroup's items[].systemImage "${MISSING_ROW}" is not ` +
          `an SF Symbol this iOS can draw. Nothing will be drawn for it. ` +
          `See docs/components/button.md, "SF Symbols".`,
      ]);
      expect(about(DRAWABLE)).toEqual([]);
      expect(libraryWarnings().length).toBe(1);
    } finally {
      restore();
    }
  });

  it('says it once for a name that outlives its renders', async () => {
    const restore = captureWarnings();
    try {
      const { rerender } = await render(
        <Button
          title="Share"
          systemImage={MISSING_RERENDER}
          onPress={press}
          testID="once"
        />
      );
      await waitForWarning(MISSING_RERENDER);
      await rerender(
        <Button
          title="Share and paste"
          systemImage={MISSING_RERENDER}
          onPress={press}
          testID="once"
        />
      );
      await rerender(
        <Button
          title="Share, paste and copy"
          systemImage={MISSING_RERENDER}
          onPress={press}
          testID="once"
        />
      );
      // Anything still on its way from the device has had time to say itself.
      await sleep(500);
      expect(about(MISSING_RERENDER).length).toBe(1);
    } finally {
      restore();
    }
  });
});

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Component, Fragment, createElement, type ReactNode } from 'react';
import { ScrollView, Switch as RNCoreSwitch, Text, View } from 'react-native';

import * as lib from '../index';

import { Host } from '../components/Host/Host';
import {
  assertHostChildren,
  HOSTABLE_NAMES,
} from '../components/Host/HostChildren';
import { BottomSheet } from '../components/BottomSheet/BottomSheet';
import { Chip } from '../components/Chip/Chip';
import {
  HOSTABLE_CONTROLS,
  UNHOSTABLE_CONTROLS,
} from '../components/Host/HostChildren';
import { Switch } from '../components/Switch/Switch';
import { TextField } from '../components/TextField/TextField';
import { nitroUiHybridObjects } from '../../__mocks__/react-native-nitro-modules';

beforeEach(() => {
  // `useSizingId` asks the native core for an instance id.
  nitroUiHybridObjects.NitroUiCore = () => ({ nextSizingId: () => 1 });
});

afterEach(() => {
  jest.restoreAllMocks();
});

/**
 * Catches a render error. Letting the throw escape leaves React with a failed
 * root, and the next `render` in this file would return an empty tree.
 */
class Boundary extends Component<
  { children?: ReactNode; onCatch: (error: Error) => void },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error): void {
    this.props.onCatch(error);
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/** The error for a child a Host cannot compose, or `null` when it accepted them. */
function errorFor(children: ReactNode): Error | null {
  try {
    assertHostChildren(children, Host);
    return null;
  } catch (error) {
    return error as Error;
  }
}

describe('Host children', () => {
  it('accepts the controls a Host renders', () => {
    expect(errorFor(<Switch value />)).toBeNull();
    expect(
      errorFor(
        <>
          <Switch value />
          <Switch value={false} />
        </>
      )
    ).toBeNull();
  });

  it('ignores the children RN renders as nothing', () => {
    expect(errorFor(null)).toBeNull();
    expect(errorFor(false)).toBeNull();
    expect(
      errorFor([null, undefined, false && <Switch value />, <Switch value />])
    ).toBeNull();
  });

  // `{label && <Switch/>}` with an empty `label` gives React the string `''`.
  it('ignores an empty string, which React draws as nothing too', () => {
    expect(errorFor('')).toBeNull();
    expect(errorFor(['', <Switch value />])).toBeNull();
  });

  it('refuses a Host inside a Host, by name', () => {
    const error = errorFor(
      <>
        <Switch value />
        <Host>
          <Switch value />
        </Host>
      </>
    );
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/Child 1/);
    expect(error?.message).toMatch(/another <Host>/);
    expect(error?.message).toMatch(/side by side/);
  });

  it('refuses a nested Host through the component apps render', async () => {
    const caught: Error[] = [];
    const errors = captureErrors();
    await render(
      <Boundary onCatch={(error) => caught.push(error)}>
        <Host testID="outer">
          <Host testID="inner">
            <Switch value />
          </Host>
        </Host>
      </Boundary>
    );
    expect(caught).toHaveLength(1);
    expect(caught[0]?.message).toMatch(/another <Host>/);
    // React also logs what the boundary caught. A second logged error would mean
    // the outer Host or the Switch failed for a reason of its own.
    const logged = errors();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatch(/another <Host>/);
  });

  // An RN view inside a Host draws nothing on Android.
  it('names an RN view', () => {
    const error = errorFor(
      <>
        <Switch value />
        <View testID="row" />
      </>
    );
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/Child 1/);
    expect(error?.message).toMatch(/<View>/);
    expect(error?.message).toMatch(/Move it outside/);
  });

  it('names the Chip, which no round has measured inside a Host', () => {
    expect([...UNHOSTABLE_CONTROLS.values()]).toContain('Chip');
    const error = errorFor(<Chip label="Vegan" />);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/react-native-nitro-ui's <Chip>/);
  });

  it('names a control the Host does not render yet', () => {
    expect([...UNHOSTABLE_CONTROLS.values()]).toContain('TextField');
    const error = errorFor(<TextField placeholder="Name" />);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/<TextField>/);
    // The message names the owning package: `TextField` and `Switch` exist in
    // more than one library.
    expect(error?.message).toMatch(/react-native-nitro-ui's <TextField>/);
    // The allowlist is consulted first, so a control on both tables is accepted.
    HOSTABLE_CONTROLS.set(TextField, 'TextField');
    try {
      expect(errorFor(<TextField placeholder="Name" />)).toBeNull();
    } finally {
      HOSTABLE_CONTROLS.delete(TextField);
    }
  });

  // `BottomSheet` is refused by design: its content is React Native views.
  it('names a control the Host refuses by design', () => {
    expect([...UNHOSTABLE_CONTROLS.values()]).toContain('BottomSheet');
    expect(HOSTABLE_CONTROLS.has(BottomSheet)).toBe(false);
    const error = errorFor(<BottomSheet isPresented={false} />);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/<BottomSheet>/);
    expect(error?.message).toMatch(/react-native-nitro-ui's <BottomSheet>/);
  });

  it.each(['SegmentedControl', 'Picker', 'DatePicker'] as const)(
    'accepts the control H2b hosted: <%s>',
    (name) => {
      const Control = (lib as Record<string, unknown>)[name];
      expect(typeof Control).toBe('function');
      expect(errorFor(createElement(Control as never))).toBeNull();
    }
  );

  // Accepted by identity, not by a name match: other packages export controls
  // with the same names.
  it.each(['Slider', 'Progress', 'Button', 'Switch'] as const)(
    'accepts its own <%s> (H1/H2a rows)',
    (name) => {
      const Control = (lib as Record<string, unknown>)[name];
      expect(typeof Control).toBe('function');
      // No props: the check never mounts the child, it only creates the element.
      expect(errorFor(createElement(Control as never))).toBeNull();
    }
  );

  // Matching on `displayName` would accept RN's own Switch, which the Host
  // cannot compose.
  it('names a plain RN Switch, which is not ours', () => {
    const error = errorFor(<RNCoreSwitch value />);
    expect(error).not.toBeNull();
    // The message names the package that owns the child.
    expect(error?.message).toMatch(/react-native's <Switch>/);
    // Never the bare `<Switch>`, which is how ours is named when it is refused.
    expect(error?.message).not.toMatch(/ is <Switch>/u);
  });

  it('names a text child', () => {
    const error = errorFor('Settings');
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/the text "Settings"/);
  });

  it('names a text child inside a fragment', () => {
    const error = errorFor(
      <>
        <Switch value />
        <Text>row label</Text>
      </>
    );
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/<Text>/);
  });

  // Fragments and arrays do not exist in the native tree, so a child under one
  // is a direct child of the Host.
  it('walks through fragments and arrays', () => {
    for (const children of [
      <Fragment key="f">
        <ScrollView />
      </Fragment>,
      <Fragment key="f2">
        <Switch value />
        <ScrollView />
      </Fragment>,
      <ScrollView key="a" />,
    ]) {
      const error = errorFor(<>{children}</>);
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/<R?(CT)?[Ss]crollView>/);
    }
    expect(
      errorFor([0, 1].map((index) => <Switch key={index} value />))
    ).toBeNull();
  });

  // `Platform.OS` is `ios` under jest, where a Host is a passthrough view, so
  // this shows the check runs even where the native Host would not need it.
  it('is wired into the component that apps render', async () => {
    // React logs an uncaught render error; keep it out of the test output.
    const errors = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const caught: Error[] = [];
    await render(
      <Boundary onCatch={(error) => caught.push(error)}>
        <Host testID="settings">
          <View />
        </Host>
      </Boundary>
    );
    errors.mockRestore();
    expect(caught.map((error) => error.message).join('\n')).toMatch(
      /Move it outside the <Host>/
    );
    const view = await render(
      <Host testID="settings">
        <Switch value />
      </Host>
    );
    expect(view.getByTestId('settings')).toBeTruthy();
  });

  // One layout event per test: this version of `@testing-library/react-native`
  // leaves the act queue dirty after a second `fireEvent`, and the next `render`
  // in the file comes back empty. The repeated-layout case is in
  // `hostLayoutWarning.test.tsx`.
  it('warns when a Host with children measures no height', async () => {
    const warnings = captureWarnings();
    const seen: number[] = [];
    const view = await render(
      <Host
        testID="settings"
        onLayout={(event) => seen.push(event.nativeEvent.layout.height)}
      >
        <Switch value />
      </Host>
    );
    fireLayout(view.getByTestId('settings'), { width: 360, height: 0 });
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toMatch(/measured 0 tall/);
    // The app's own `onLayout` still ran.
    expect(seen).toEqual([0]);
  });

  it('says nothing about a Host that has a height', async () => {
    const warnings = captureWarnings();
    const seen: number[] = [];
    const view = await render(
      <Host
        testID="settings"
        onLayout={(event) => seen.push(event.nativeEvent.layout.height)}
      >
        <Switch value />
      </Host>
    );
    fireLayout(view.getByTestId('settings'), { width: 360, height: 96 });
    expect(warnings()).toEqual([]);
    expect(seen).toEqual([96]);
  });

  it('stays quiet about a Host with no children', async () => {
    const warnings = captureWarnings();
    const view = await render(<Host testID="empty" />);
    fireLayout(view.getByTestId('empty'), { width: 360, height: 0 });
    expect(warnings()).toEqual([]);
  });

  // `{show && <Switch/>}` with `show = false` is `false`, and a `map` over an
  // empty array is `[]`. Both draw nothing.
  it('stays quiet when the children are a conditional that is off', async () => {
    const warnings = captureWarnings();
    const show = false;
    const view = await render(
      <Host testID="conditional">
        {show && <Switch value />}
        {[].map((id: never) => (
          <Switch key={id} value />
        ))}
      </Host>
    );
    fireLayout(view.getByTestId('conditional'), { width: 360, height: 0 });
    expect(warnings()).toEqual([]);
  });

  // These styles size the Host's box in Yoga and do nothing in Compose.
  it('says which of its styles a Host will not draw', async () => {
    const warnings = captureWarnings();
    const view = await render(
      <Host testID="spaced" style={{ gap: 8, alignItems: 'center' }}>
        <Switch value />
      </Host>
    );
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toMatch(/`gap`/);
    expect(warnings()[0]).toMatch(/`alignItems`/);
    fireLayout(view.getByTestId('spaced'), { width: 360, height: 96 });
    expect(warnings()).toHaveLength(1);
  });

  it('says a Host lays its rows in a column only', async () => {
    const warnings = captureWarnings();
    await render(
      <Host testID="rowed" style={{ flexDirection: 'row', height: 48 }}>
        <Switch value />
      </Host>
    );
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toMatch(/only a column is drawn/);
  });

  it('says nothing about the styles a Host does draw', async () => {
    const warnings = captureWarnings();
    await render(
      <Host
        testID="padded"
        style={{ padding: 16, height: 96, flexDirection: 'column' }}
      >
        <Switch value />
      </Host>
    );
    expect(warnings()).toEqual([]);
  });
});

/** Tap `console.error` for this test. `afterEach` restores it. */
function captureErrors(): () => string[] {
  const seen: string[] = [];
  jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    seen.push(args.map(String).join(' '));
  });
  return () => seen;
}

/** Tap `console.warn` for this test. `afterEach` restores it. */
function captureWarnings(): () => string[] {
  const seen: string[] = [];
  jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    seen.push(args.map(String).join(' '));
  });
  return () => seen;
}

function fireLayout(
  host: Parameters<typeof fireEvent>[0],
  layout: { width: number; height: number }
): void {
  fireEvent(host, 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, ...layout } },
  });
}

// React flattens components out of the native tree, so a child component that
// renders a `Switch` is hosted. The check cannot see through a component, so it
// must not refuse one it does not know.
describe('Host children · components the library does not know', () => {
  it('accepts an app component that renders a Switch', () => {
    function Row({ id }: { id: string }) {
      return <Switch testID={id} value />;
    }
    expect(errorFor(<Row id="a" />)).toBeNull();
  });

  it('accepts a third-party component, leaving the decision to the native Host', () => {
    // What an unknown component returns is judged by the native Host, not here.
    expect(
      errorFor(
        (() => {
          const Foreign = () => null;
          return <Foreign />;
        })()
      )
    ).toBeNull();
  });
});

// The control list is read from the filesystem, so a control added without a
// row in `HostChildren.ts` fails here.
describe('Host children · tables cover the library', () => {
  it('has an opinion on every control in src/components', () => {
    const componentsDir = join(__dirname, '..', 'components');
    // A directory exports the names its manifest lists under `exports`, or its
    // own name.
    const controls = readdirSync(componentsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'Host')
      .flatMap((entry) => {
        const manifest = JSON.parse(
          readFileSync(
            join(componentsDir, entry.name, 'component.json'),
            'utf8'
          )
        ) as { exports?: string[] };
        return manifest.exports ?? [entry.name];
      });
    expect(controls.length).toBeGreaterThanOrEqual(6);
    expect(controls).toEqual(
      expect.arrayContaining(['AlertDialog', 'ConfirmationDialog'])
    );
    for (const name of controls) {
      // Imported through the public index, so a control that stops being
      // exported there fails here.
      const exported = (lib as Record<string, unknown>)[name];
      expect(exported).toBeDefined();
      const refused = errorFor(createElement(exported as never));
      if (HOSTABLE_NAMES.includes(name)) {
        expect(refused).toBeNull();
      } else {
        expect(refused).not.toBeNull();
        expect(refused?.message).toContain(`<${name}>`);
      }
    }
  });
});

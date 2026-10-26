import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import { Component, Fragment, type ReactNode } from 'react';
import { ScrollView, Switch as RNCoreSwitch, Text, View } from 'react-native';

import { Host } from '../components/Host/Host';
import { assertHostChildren } from '../components/Host/HostChildren';
import { Slider } from '../components/Slider/Slider';
import { Switch } from '../components/Switch/Switch';
import { nitroUiHybridObjects } from '../../__mocks__/react-native-nitro-modules';

/**
 * Which children a `<Host>` may hold, and what its box is (task H1).
 *
 * On Android the Host composes its direct nitro-ui children and *skips* every
 * other child, so an unsupported one is invisible rather than loud - and the
 * native side can only see a `View`, never which component made it. These tests are
 * the JS half of that contract: the check must name the child, and it must fire for
 * the shapes that reach the native tree (`ScrollView`, `Text`, a raw string) as well
 * as for a nitro-ui control the Host has not been measured with.
 *
 * The rule runs on iOS too, where a `<Host>` is a passthrough and a `View` child
 * would render: one contract, so an app cannot pass on the platform it tested and
 * fail on the other.
 */

beforeEach(() => {
  // `useSizingId` asks native for an instance id; the root mock keeps a registry
  // of fakes for exactly that.
  nitroUiHybridObjects.NitroUiCore = () => ({ nextSizingId: () => 1 });
});

afterEach(() => {
  jest.restoreAllMocks();
});

/**
 * Catches a render error so the reconciler unwinds the way it does in an app.
 *
 * Letting the throw escape instead would be a tidier assertion, but React keeps a
 * failed root: the next `render` in the same file then returns an empty tree, and
 * an unrelated test fails. This is also the honest shape — in a real app the throw
 * is caught by something.
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
    assertHostChildren(children);
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

  /** `null`/`false`/`undefined` are how a conditional child arrives. */
  it('ignores the children RN renders as nothing', () => {
    expect(errorFor(null)).toBeNull();
    expect(errorFor(false)).toBeNull();
    expect(
      errorFor([null, undefined, false && <Switch value />, <Switch value />])
    ).toBeNull();
  });

  /**
   * The case the spike reported as silently wrong: an RN view inside a Host draws
   * nothing on Android, because the only thing that could draw it is the
   * composition it was never invited into.
   */
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

  it('names a control the Host does not render yet', () => {
    const error = errorFor(<Slider value={0.5} />);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/<Slider>/);
  });

  /**
   * Matching on `displayName` would host RN's own Switch - same name, different
   * component, and a view the composition has never seen. It would render nothing.
   */
  it('names a plain RN Switch, which is not ours', () => {
    const error = errorFor(<RNCoreSwitch value />);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/Switch/);
  });

  /** Text is a child too, and the one a person is most likely to type by habit. */
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

  /**
   * Fragments and arrays do not exist in the native tree, so a child under one *is*
   * a direct child of the Host. A check that stopped at the fragment would let the
   * `items.map(...)` shape through unvalidated.
   */
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

  /**
   * The check has to be on the component, not merely exported: `Host` is the only
   * thing an app renders, and this is the render that would have painted half a
   * screen. Driven through `render`, because `Host` is a component with state and
   * calling it by hand is not rendering it.
   *
   * iOS is what `Platform.OS` reports under jest, i.e. the branch that would have
   * laid the child out happily, so a pass here means the check fires even where the
   * native Host would not have needed it.
   */
  it('is wired into the component that apps render', async () => {
    // React reports an uncaught render error through its own logger; this is about
    // the throw, not about the noise around it.
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

  /**
   * A hosted control reports no size (D24), so a Host with no height gets none, and
   * that has to be *said*. The box is only knowable at layout, which is what this
   * drives: the `onLayout` the component installs must warn, and must still call the
   * app's own `onLayout` - replacing an app's callback to add a dev warning would be
   * a worse bug than the one it reports.
   *
   * One layout event per test. The repeated-layout case (warn once, then fall quiet
   * after a correction) is in `hostLayoutWarning.test.tsx`: this version of
   * `@testing-library/react-native` leaves the act queue dirty after a *second*
   * `fireEvent` in a test, and the next `render` in the same file then comes back
   * empty. Reproduced with a plain RN `View` and no Host in sight, so the workaround
   * belongs to the tests, not to the component.
   */
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
    // The app's callback still ran, exactly as it would have without us.
    expect(seen).toEqual([0]);
  });

  /** The other half of the warning: a Host that was given a height is fine. */
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

  /** An empty Host is legitimately 0 tall, and says nothing. */
  it('stays quiet about a Host with no children', async () => {
    const warnings = captureWarnings();
    const view = await render(<Host testID="empty" />);
    fireLayout(view.getByTestId('empty'), { width: 360, height: 0 });
    expect(warnings()).toEqual([]);
  });
});

/**
 * Tap `console.warn` for this test. `afterEach` restores it.
 *
 * A tap rather than `toBeCalledWith`: the assertion wants the whole text, and two of
 * the three cases assert that nothing arrived.
 */
function captureWarnings(): () => string[] {
  const seen: string[] = [];
  jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    seen.push(args.map(String).join(' '));
  });
  return () => seen;
}

/** Send the Host a layout event, the way RN does. */
function fireLayout(
  host: Parameters<typeof fireEvent>[0],
  layout: { width: number; height: number }
): void {
  fireEvent(host, 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, ...layout } },
  });
}

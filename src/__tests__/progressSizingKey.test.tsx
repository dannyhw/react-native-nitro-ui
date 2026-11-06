import { beforeEach, describe, expect, it } from '@jest/globals';
import { render, type RenderResult } from '@testing-library/react-native';

import { nitroUiHybridObjects } from '../../__mocks__/react-native-nitro-modules';
import {
  Progress,
  type ProgressAppearance,
  type ProgressVariant,
} from '../components/Progress/Progress';

/**
 * Wrapper-level tests for the Progress's `nuiSizingKey` (task E4).
 *
 * E4 added two size-affecting props to a control whose key used to be one prop
 * wide. The key is the cache key: two Progresses that build the same string share
 * one cached size for the life of the process, so a configuration the key forgets
 * is laid out at another configuration's size forever - the R3 bug class
 * (`docs/architecture/sizing.md`, "Building `nuiSizingKey`", DECISIONS D16).
 *
 * The device suite cannot stand in for this. It sees the sizes that come out of
 * the cache, and a collision reads as a correct measurement of the other shape;
 * on a *host* these three props are three strings and one boolean, and nothing
 * about them is platform-shaped. Both halves matter: what a key says is decided
 * here, and what the platform then measures for it is `Progress.harness.tsx`.
 */
beforeEach(() => {
  // `useSizingId` asks native for an instance id; the root mock keeps a registry
  // of fakes for exactly that.
  nitroUiHybridObjects.NitroUiCore = () => ({
    nextSizingId: () => 1,
  });
});

function nativeProps(
  view: RenderResult,
  testId: string
): Record<string, unknown> {
  return view.getByTestId(testId).props as unknown as Record<string, unknown>;
}

const keyOf = (view: RenderResult, testId: string): string =>
  String(nativeProps(view, testId).nuiSizingKey);

const shapeOf = (view: RenderResult, testId: string): string =>
  String(nativeProps(view, testId).variant);

/** One row of {@link CONFIGURATIONS} rendered as `testID`s that read as what they are. */
const testIdFor = (configuration: {
  variant: ProgressVariant;
  appearance: ProgressAppearance;
  contained: boolean;
}): string =>
  `${configuration.variant}-${configuration.appearance}-${
    configuration.contained ? 'contained' : 'bare'
  }`;

/** Every configuration the component can be asked to draw, and the key it must get. */
const CONFIGURATIONS: ReadonlyArray<{
  variant: ProgressVariant;
  appearance: ProgressAppearance;
  contained: boolean;
  key: string;
}> = [
  { variant: 'linear', appearance: 'flat', contained: false, key: '' },
  { variant: 'linear', appearance: 'wavy', contained: false, key: 'wavy' },
  { variant: 'circular', appearance: 'flat', contained: false, key: 'circular' },
  {
    variant: 'circular',
    appearance: 'wavy',
    contained: false,
    key: 'circular|wavy',
  },
  { variant: 'loading', appearance: 'flat', contained: false, key: 'loading' },
  {
    variant: 'loading',
    appearance: 'flat',
    contained: true,
    key: 'loading|contained',
  },
];

describe('Progress · sizing key', () => {
  it('keys each configuration by its shape, its look and its container', async () => {
    const view = await render(
      <>
        {CONFIGURATIONS.map((configuration) => (
          <Progress
            key={configuration.key}
            testID={testIdFor(configuration)}
            value={0.5}
            variant={configuration.variant}
            appearance={configuration.appearance}
            contained={configuration.contained}
          />
        ))}
      </>
    );
    const keys = CONFIGURATIONS.map((configuration) =>
      keyOf(view, testIdFor(configuration))
    );
    expect(keys).toEqual(CONFIGURATIONS.map((row) => row.key));
    // The point of the table, not its wording: six configurations the component can
    // draw, six cache entries. Drop any of the three props from the key and two of
    // these rows collide - which is exactly the bug the harness could never see,
    // because both controls would then be laid out at whichever measured first.
    expect(new Set(keys).size).toBe(CONFIGURATIONS.length);
  });

  it('keeps the default configuration on the empty key that prewarm seeds', async () => {
    const bare = await render(<Progress value={0.5} testID="bare" />);
    const spelledOut = await render(
      <Progress
        value={0.5}
        variant="linear"
        appearance="flat"
        contained={false}
        testID="spelled"
      />
    );
    // `''` is what `prewarm(['NitroUiProgress'])` seeds and what the component
    // declares its fallback for, so naming the defaults must not mint a second key
    // for the same control (`docs/architecture/sizing.md` §8).
    expect(keyOf(bare, 'bare')).toBe('');
    expect(keyOf(spelledOut, 'spelled')).toBe('');
  });

  it('changes the key when any one of the three props changes', async () => {
    const view = await render(
      <Progress value={0.5} variant="circular" testID="one" />
    );
    expect(keyOf(view, 'one')).toBe('circular');

    // appearance
    await view.rerender(
      <Progress
        value={0.5}
        variant="circular"
        appearance="wavy"
        testID="one"
      />
    );
    expect(keyOf(view, 'one')).toBe('circular|wavy');

    // variant, holding the look
    await view.rerender(
      <Progress
        value={0.5}
        variant="loading"
        appearance="wavy"
        testID="one"
      />
    );
    expect(keyOf(view, 'one')).toBe('loading');

    // contained
    await view.rerender(
      <Progress
        value={0.5}
        variant="loading"
        appearance="wavy"
        contained
        testID="one"
      />
    );
    expect(keyOf(view, 'one')).toBe('loading|contained');
  });

  it('sends the props it keys with, so native draws the configuration cached', async () => {
    const view = await render(
      <Progress
        value={0.5}
        variant="loading"
        appearance="wavy"
        contained
        testID="sent"
      />
    );
    const props = nativeProps(view, 'sent');
    // `appearance` is `'flat'` here on purpose: a loading indicator has no wavy
    // form on either platform, so the wrapper resolves the combination rather than
    // forwarding a request that cannot be drawn - what the handle answers is what
    // is drawn, and the key cannot disagree with the drawing.
    expect(props.variant).toBe('loading');
    expect(props.appearance).toBe('flat');
    expect(props.contained).toBe(true);
    expect(props.nuiSizingKey).toBe('loading|contained');
  });

  it('normalises a prop outside the union into the default configuration', async () => {
    const round = await render(
      <Progress value={0.5} variant={'round' as ProgressVariant} testID="round" />
    );
    expect(shapeOf(round, 'round')).toBe('linear');
    expect(keyOf(round, 'round')).toBe('');

    // `contained` belongs to `loading` alone: a bar has no container, so the prop
    // cannot change what is drawn and must not mint an entry for a configuration
    // that does not exist.
    const barWithContainer = await render(
      <Progress value={0.5} contained testID="bar-container" />
    );
    expect(shapeOf(barWithContainer, 'bar-container')).toBe('linear');
    expect(nativeProps(barWithContainer, 'bar-container').contained).toBe(false);
    expect(keyOf(barWithContainer, 'bar-container')).toBe('');
  });

  it('keys the shape it tells native to draw, never another one', async () => {
    // The two halves of one decision, read side by side: `variant` is what the
    // control is *told* to be, and the key's leading segment is the box it is
    // *cached* under. They are computed from the same resolved shape
    // (`Progress.tsx`), and if they ever disagree the control draws one
    // configuration while the engine files its size under another - which shows up
    // as a layout bug in an app that has never heard of either of them.
    //
    // What this cannot check is the `key` on the element: React does not put it in
    // props, and a unit test has no native view to remount. The harness owns that
    // half, and asserts both directions of it - that a shape change re-measures,
    // and that an `appearance`/`contained` change re-measures *without* dropping
    // the handle (`re-measures an appearance change on the same view`).
    const view = await render(
      <>
        {CONFIGURATIONS.map((configuration) => (
          <Progress
            key={configuration.key}
            testID={testIdFor(configuration)}
            value={0.5}
            variant={configuration.variant}
            appearance={configuration.appearance}
            contained={configuration.contained}
          />
        ))}
      </>
    );
    for (const configuration of CONFIGURATIONS) {
      const props = nativeProps(view, testIdFor(configuration));
      const shape = String(props.variant);
      const key = String(props.nuiSizingKey);
      // The key is empty (the linear default) or begins with the shape it was
      // built for. What it may never begin with is *another* shape's name: that is
      // exactly how a disagreement between the two would read in a layout bug.
      for (const other of ['linear', 'circular', 'loading'] as const) {
        if (other === shape) {
          continue;
        }
        expect(key === other || key.startsWith(`${other}|`)).toBe(false);
      }
      if (shape === 'linear') {
        expect(key === '' || key === 'wavy').toBe(true);
      } else {
        expect(key === shape || key.startsWith(`${shape}|`)).toBe(true);
      }
    }
  });
});

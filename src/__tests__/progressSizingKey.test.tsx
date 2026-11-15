import { beforeEach, describe, expect, it } from '@jest/globals';
import { render, type RenderResult } from '@testing-library/react-native';

import { nitroUiHybridObjects } from '../../__mocks__/react-native-nitro-modules';
import {
  Progress,
  type ProgressAppearance,
  type ProgressVariant,
} from '../components/Progress/Progress';

beforeEach(() => {
  // `useSizingId` asks the native core for an instance id.
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
  {
    variant: 'circular',
    appearance: 'flat',
    contained: false,
    key: 'circular',
  },
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
    expect(keyOf(bare, 'bare')).toBe('');
    expect(keyOf(spelledOut, 'spelled')).toBe('');
  });

  it('changes the key when any one of the three props changes', async () => {
    const view = await render(
      <Progress value={0.5} variant="circular" testID="one" />
    );
    expect(keyOf(view, 'one')).toBe('circular');

    await view.rerender(
      <Progress value={0.5} variant="circular" appearance="wavy" testID="one" />
    );
    expect(keyOf(view, 'one')).toBe('circular|wavy');

    await view.rerender(
      <Progress value={0.5} variant="loading" appearance="wavy" testID="one" />
    );
    expect(keyOf(view, 'one')).toBe('loading');

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
    // `appearance` comes out `'flat'`: a loading indicator has no wavy form on
    // either platform, so the wrapper resolves the combination.
    expect(props.variant).toBe('loading');
    expect(props.appearance).toBe('flat');
    expect(props.contained).toBe(true);
    expect(props.nuiSizingKey).toBe('loading|contained');
  });

  it('normalises a prop outside the union into the default configuration', async () => {
    const round = await render(
      <Progress
        value={0.5}
        variant={'round' as ProgressVariant}
        testID="round"
      />
    );
    expect(shapeOf(round, 'round')).toBe('linear');
    expect(keyOf(round, 'round')).toBe('');

    // `contained` applies to `loading` alone: a bar has no container.
    const barWithContainer = await render(
      <Progress value={0.5} contained testID="bar-container" />
    );
    expect(shapeOf(barWithContainer, 'bar-container')).toBe('linear');
    expect(nativeProps(barWithContainer, 'bar-container').contained).toBe(
      false
    );
    expect(keyOf(barWithContainer, 'bar-container')).toBe('');
  });

  it('keys the shape it tells native to draw, never another one', async () => {
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

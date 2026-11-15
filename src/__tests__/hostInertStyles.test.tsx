import { beforeEach, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';
import type { ViewStyle } from 'react-native';

import { Host } from '../components/Host/Host';
import { Switch } from '../components/Switch/Switch';
import type { ViewProps } from 'react-native';
import { nitroUiHybridObjects } from '../../__mocks__/react-native-nitro-modules';

beforeEach(() => {
  nitroUiHybridObjects.NitroUiCore = () => ({ nextSizingId: () => 1 });
});

async function warningsFor(
  style: ViewStyle | undefined,
  pointerEvents?: ViewProps['pointerEvents']
): Promise<string[]> {
  const warnings: string[] = [];
  const spy = jest.spyOn(console, 'warn').mockImplementation((...args) => {
    warnings.push(args.map(String).join(' '));
  });
  // Awaited: React 19 flushes the render, and its dev warning, in a microtask,
  // so restoring the spy straight after `render` would miss it.
  await render(
    <Host testID="styles" style={style} pointerEvents={pointerEvents}>
      <Switch value />
    </Host>
  );
  spy.mockRestore();
  return warnings;
}

it('names the styles that size the box without reaching the drawing', async () => {
  for (const style of [
    { gap: 8 },
    { rowGap: 8 },
    { columnGap: 8 },
    { alignItems: 'center' },
    { alignContent: 'center' },
    { justifyContent: 'center' },
    { flexDirection: 'row' },
  ] as const) {
    const warnings = await warningsFor(style as ViewStyle);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(
      /sizes its box but does not reach what it draws/
    );
    expect(warnings[0]).toContain(
      Object.keys(style)[0] === 'flexDirection'
        ? '`flexDirection`'
        : `\`${Object.keys(style)[0]}\``
    );
  }
});

it('says nothing about the styles that do reach the drawing', async () => {
  expect(await warningsFor({ alignSelf: 'flex-start' })).toEqual([]);
  expect(await warningsFor({ alignSelf: 'stretch', width: '100%' })).toEqual(
    []
  );
  expect(await warningsFor({ borderWidth: 2, padding: 4 })).toEqual([]);
  expect(
    await warningsFor({ borderWidth: 2, flexDirection: 'row' })
  ).toHaveLength(1);
});

it('warns once per Host instance about an inert style', async () => {
  const warnings = await warningsFor({ gap: 8 });
  expect(warnings).toHaveLength(1);
  const again = await warningsFor({ gap: 8 });
  expect(again).toHaveLength(1);
});

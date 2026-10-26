import { beforeEach, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';
import type { ViewStyle } from 'react-native';

import { Host } from '../components/Host/Host';
import { Switch } from '../components/Switch/Switch';
import type { ViewProps } from 'react-native';
import { nitroUiHybridObjects } from '../../__mocks__/react-native-nitro-modules';

/**
 * Which `<Host>` styles the dev warning names (H1 review F5/F6, carried into H2a).
 *
 * The set has to be *true*, not merely wide. `alignSelf` positions the Host inside its
 * parent, so it moves the box and everything drawn in it; `borderWidth` insets the
 * drawing, because Fabric folds it into the padding the Host's manager forwards to
 * `setPadding`. Warning about either would tell an app author that a style they wrote
 * does nothing when it does, which is worse than saying nothing — and both were in the
 * table before the review caught it. The styles that *are* named (`gap`, `alignItems`,
 * `justifyContent`, a sideways `flexDirection`, `pointerEvents`) size the box while
 * Compose arranges the children, which is the trap worth a sentence.
 *
 * In its own file: `hostLayoutWarning.test.tsx` documents that a `fireEvent` leaves this
 * version of `@testing-library/react-native` with a dirty act queue. Nothing here fires
 * an event — the warning is a render-time read of `style` — so the file can hold several
 * cases, but mixing them into that one would put them behind its caveat.
 */
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
  // Awaited: React 19's act queue flushes the render (and with it the dev warning) in a
  // microtask, so restoring the spy straight after `render` would miss it.
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
    expect(warnings[0]).toMatch(/sizes its box but does not reach what it draws/);
    // The sentence names the prop it is complaining about, rather than a generic
    // "some of your styles do nothing".
    expect(warnings[0]).toContain(
      Object.keys(style)[0] === 'flexDirection'
        ? '`flexDirection`'
        : `\`${Object.keys(style)[0]}\``
    );
  }
});

it('says nothing about the styles that do reach the drawing', async () => {
  // The F5/F6 pair. `alignSelf` moves the box (so the drawing moves with it), and
  // `borderWidth` insets the drawing through RN's padding. `padding` always did.
  expect(await warningsFor({ alignSelf: 'flex-start' })).toEqual([]);
  expect(await warningsFor({ alignSelf: 'stretch', width: '100%' })).toEqual([]);
  expect(await warningsFor({ borderWidth: 2, padding: 4 })).toEqual([]);
  // A row `flexDirection` is still a lie about the arrangement, even next to a style
  // that works, so the pair above cannot be read as "any single style is fine".
  expect(await warningsFor({ borderWidth: 2, flexDirection: 'row' })).toHaveLength(1);
});

it('warns once per Host instance about an inert style', async () => {
  const warnings = await warningsFor({ gap: 8 });
  expect(warnings).toHaveLength(1);
  // A second render of the same element is the same instance, and says nothing new:
  // the warning is per instance, not per render, or a Host in a list re-renders a
  // warning per frame.
  const again = await warningsFor({ gap: 8 });
  expect(again).toHaveLength(1);
});

import { beforeEach, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';

import { Host } from '../components/Host/Host';
import { Switch } from '../components/Switch/Switch';
import { nitroUiHybridObjects } from '../../__mocks__/react-native-nitro-modules';

/**
 * The dev-only zero-height warning fires *once*, not once per layout.
 *
 * Alone in a file: a second `fireEvent` inside a test leaves this version of
 * `@testing-library/react-native` with a dirty act queue, and the next `render` in
 * the same file returns an empty tree (reproduced with a plain RN `View`, so it is
 * not the Host). The behaviour still needs testing - a warning that repeats on every
 * relayout is a warning per frame - and one test per file is how to ask for it.
 */
beforeEach(() => {
  nitroUiHybridObjects.NitroUiCore = () => ({ nextSizingId: () => 1 });
});

it('warns once about a zero-height Host, then falls quiet', async () => {
  const warnings: string[] = [];
  jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  });
  const heights: number[] = [];
  const view = await render(
    <Host
      testID="settings"
      onLayout={(event) => heights.push(event.nativeEvent.layout.height)}
    >
      <Switch value />
    </Host>
  );
  const host = view.getByTestId('settings');
  const layout = (height: number) =>
    fireEvent(host, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 360, height } },
    });

  layout(0);
  layout(0);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toMatch(/measured 0 tall/);

  // A later layout that is still 0 tall says nothing new, and one that is not says
  // nothing either: the app's callback keeps running either way.
  layout(0);
  layout(96);
  expect(warnings).toHaveLength(1);
  expect(heights).toEqual([0, 0, 0, 96]);
});

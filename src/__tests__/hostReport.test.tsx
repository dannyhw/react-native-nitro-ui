import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { DeviceEventEmitter, Platform } from 'react-native';

import { assertHostChildren } from '../components/Host/HostChildren';
import { Switch } from '../components/Switch/Switch';
import { Host } from '../components/Host/Host';

/**
 * The native Host's report about a child it will not compose (review S5).
 *
 * On Android the Host can see what React flattened away — a `Picker` behind a
 * `memo`, an RN view behind a `<Row>`, another `<Host>` — and a `Log.w` for that
 * is a line no app author reads. The bridge is a device event, and JS turns it
 * into a `console.error`, which is what reaches Metro and LogBox.
 *
 * One case per file, because the listener latches on the module: the second
 * `assertHostChildren` in this test proves it registers once per process, and a
 * second test could not tell a latch from a fresh subscription.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Host unhostable-child report', () => {
  it('subscribes once and prints what the native Host refused', () => {
    const os = Platform.OS;
    Platform.OS = 'android';
    try {
      const subscribe = jest
        .spyOn(DeviceEventEmitter, 'addListener')
        .mockImplementation(() => ({ remove: jest.fn() }) as never);
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});

      // Two Hosts mounting: one subscription, not two. A listener per Host would
      // mean an app with a hundred Hosts prints the same refusal a hundred times.
      assertHostChildren(<Switch value />, Host);
      assertHostChildren(<Switch value />, Host);

      const calls = subscribe.mock.calls.filter(
        ([event]) => event === 'NitroUiHostUnhostableChild'
      );
      expect(calls).toHaveLength(1);

      const [, handler] = calls[0]!;
      (handler as (report: { message: string }) => void)({
        message: 'react-native-nitro-ui: a <Host> holds a Picker.',
      });
      expect(error).toHaveBeenCalledWith(
        'react-native-nitro-ui: a <Host> holds a Picker.'
      );

      // A report without a message must still say something: the alternative is a
      // dev-time problem that is silently ignored, which is the bug being fixed.
      error.mockClear();
      (handler as () => void)();
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('cannot compose')
      );
    } finally {
      Platform.OS = os;
    }
  });
});

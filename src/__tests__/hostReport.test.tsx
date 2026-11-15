import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { DeviceEventEmitter, Platform } from 'react-native';

import { assertHostChildren } from '../components/Host/HostChildren';
import { Switch } from '../components/Switch/Switch';
import { Host } from '../components/Host/Host';

// The only test in this file: the listener registers once per module, so a
// second test could not tell that latch from a fresh subscription.

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

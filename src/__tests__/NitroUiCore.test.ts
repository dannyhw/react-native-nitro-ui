import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  nitroUiHybridObjects,
  nitroUiHybridObjectsReset,
} from '../../__mocks__/react-native-nitro-modules';

const mockNow = jest.fn((): number => 1337.25);
const mockSetPerfEnabled = jest.fn((_enabled: boolean) => {});
const mockDrainPerf = jest.fn((): unknown[] => []);
const mockCreate = jest.fn((_name: string) => ({
  now: mockNow,
  setPerfEnabled: mockSetPerfEnabled,
  drainPerf: mockDrainPerf,
}));

describe('nitroUiCore', () => {
  beforeEach(() => {
    jest.resetModules();
    nitroUiHybridObjectsReset();
    nitroUiHybridObjects.NitroUiCore = () => mockCreate('NitroUiCore');
    mockNow.mockClear();
    mockSetPerfEnabled.mockClear();
    mockDrainPerf.mockClear();
    mockCreate.mockClear();
  });

  it('does not create the native object on import', async () => {
    await import('../index');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('creates the native object on first use and caches it', async () => {
    const { nitroUiCore } = await import('../index');
    expect(nitroUiCore.now()).toBe(1337.25);
    expect(nitroUiCore.now()).toBe(1337.25);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockNow).toHaveBeenCalledTimes(2);
  });

  it('forwards the perf-mark API to the native core', async () => {
    const { nitroUiCore } = await import('../index');
    nitroUiCore.setPerfEnabled(true);
    expect(mockSetPerfEnabled).toHaveBeenCalledWith(true);

    const events = [{ instanceId: 3, kind: 'propsApplied', time: 12.5 }];
    mockDrainPerf.mockReturnValueOnce(events);
    expect(nitroUiCore.drainPerf()).toEqual(events);
  });
});

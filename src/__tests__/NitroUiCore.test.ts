import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockNow = jest.fn((): number => 1337.25);
const mockCreateHybridObject = jest.fn((_name: string) => ({ now: mockNow }));

jest.mock('react-native-nitro-modules', () => ({
  NitroModules: {
    createHybridObject: (name: string) => mockCreateHybridObject(name),
  },
}));

describe('nitroUiCore', () => {
  beforeEach(() => {
    jest.resetModules();
    mockNow.mockClear();
    mockCreateHybridObject.mockClear();
  });

  it('does not create the native object on import', async () => {
    await import('../index');
    expect(mockCreateHybridObject).not.toHaveBeenCalled();
  });

  it('creates the native object on first use and caches it', async () => {
    const { nitroUiCore } = await import('../index');
    expect(nitroUiCore.now()).toBe(1337.25);
    expect(nitroUiCore.now()).toBe(1337.25);
    expect(mockCreateHybridObject).toHaveBeenCalledTimes(1);
    expect(mockCreateHybridObject).toHaveBeenCalledWith('NitroUiCore');
    expect(mockNow).toHaveBeenCalledTimes(2);
  });
});

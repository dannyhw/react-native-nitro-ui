import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  nitroUiHybridObjects,
  nitroUiHybridObjectsReset,
} from '../../__mocks__/react-native-nitro-modules';

/** What `setMaterialTheme` wrote, in order, and how many objects it created. */
const writes: boolean[] = [];
const mockCreate = jest.fn((_name: string) => {
  const state = { value: true };
  return {
    get expressive(): boolean {
      return state.value;
    },
    set expressive(value: boolean) {
      writes.push(value);
      state.value = value;
    },
    composedReport: (): string =>
      `setting=${state.value ? 'expressive' : 'baseline'};expressive=1;baseline=0;other=0`,
  };
});

async function load(os: 'ios' | 'android') {
  const { Platform } = await import('react-native');
  Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
  return import('../index');
}

describe('setMaterialTheme', () => {
  beforeEach(() => {
    jest.resetModules();
    nitroUiHybridObjectsReset();
    nitroUiHybridObjects.NitroUiMaterialTheme = () =>
      mockCreate('NitroUiMaterialTheme');
    mockCreate.mockClear();
    writes.length = 0;
  });

  it('does not create the native object on import', async () => {
    await load('android');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('writes the opt-out and the default through to the Android object', async () => {
    const { setMaterialTheme, nitroUiCore } = await load('android');
    setMaterialTheme('baseline');
    expect(writes).toEqual([false]);
    expect(nitroUiCore.materialThemeReport()).toMatch(/^setting=baseline;/);
    setMaterialTheme('expressive');
    expect(writes).toEqual([false, true]);
    expect(nitroUiCore.materialThemeReport()).toMatch(/^setting=expressive;/);
    // One object for the process: the setting is native and process-wide.
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('touches nothing native on iOS', async () => {
    const { setMaterialTheme, nitroUiCore } = await load('ios');
    setMaterialTheme('baseline');
    expect(mockCreate).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    expect(nitroUiCore.materialThemeReport()).toBe('');
  });

  it('refuses a theme it does not know, on every platform', async () => {
    for (const os of ['ios', 'android'] as const) {
      jest.resetModules();
      const { setMaterialTheme } = await load(os);
      expect(() =>
        setMaterialTheme('Expressive' as unknown as 'expressive')
      ).toThrow(/expected 'expressive' or 'baseline', got "Expressive"/);
    }
    expect(writes).toEqual([]);
  });
});

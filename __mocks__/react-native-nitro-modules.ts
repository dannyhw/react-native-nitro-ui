/**
 * Jest manual mock for `react-native-nitro-modules`.
 *
 * The real package reads its TurboModule while its index is loading, so any unit
 * test that imports this library would otherwise die on "NitroModules could not
 * be found". Mocking it at the root makes importing this package work in a plain
 * Node environment.
 *
 * `callback` mirrors the four-line upstream implementation in
 * `react-native-nitro-modules/src/views/callback.ts`: React Native turns raw
 * functions in props into `true`, so Nitro sends them inside an object with the
 * function under `f`. Keep it in sync if upstream ever changes it.
 */

type HybridObjectFactory = () => unknown;

interface Registry {
  [name: string]: HybridObjectFactory | undefined;
}

// Kept on `globalThis` so it survives `jest.resetModules()`, which reloads this
// module while a test file keeps its original import binding.
const holder = globalThis as unknown as { __nitroUiHybridObjects?: Registry };

const registry: Registry = holder.__nitroUiHybridObjects ?? {};
holder.__nitroUiHybridObjects = registry;

/**
 * Test hook: `nitroUiHybridObjects.NitroUiCore = () => ({ now: ... })` registers
 * a fake for `NitroModules.createHybridObject("NitroUiCore")`.
 *
 * Call `nitroUiHybridObjectsReset()` from `beforeEach`.
 */
export const nitroUiHybridObjects = registry;

export function nitroUiHybridObjectsReset(): void {
  for (const key of Object.keys(registry)) {
    delete registry[key];
  }
}

export const NitroModules = {
  createHybridObject(name: string): unknown {
    const factory = registry[name];
    if (factory == null) {
      throw new Error(
        `No mock registered for the HybridObject "${name}". Register one with ` +
          'nitroUiHybridObjects.<Name> = () => ({ ... }) in the test.'
      );
    }
    return factory();
  },
};

export function callback(func: unknown) {
  return typeof func === 'function' ? { f: func } : func;
}

/**
 * Host components cannot be rendered in Node, but importing a wrapper must not
 * fail, so this hands back the component name instead.
 */
export function getHostComponent(name: string): unknown {
  return name;
}

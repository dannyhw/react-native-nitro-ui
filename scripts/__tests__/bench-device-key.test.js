/**
 * A simulator's device key comes from its hardware type, not its name.
 *
 * The device key is half of a committed baseline's path
 * (`bench/baselines/<machine>/<deviceKey>.json`), so a key that describes what a
 * simulator was *named* rather than what it *is* silently splits the baselines:
 * the lease pool's pair-a is an iPhone 17 simulator named `nitro-ui A`, and by
 * name that keys as `ios27-sim-nitrouia` - a file no canonical run will ever
 * gate against, and one D9 never contemplated. The fixture below keeps the two
 * sources deliberately apart (`nitro-ui A` vs `…iPhone-17`): a derivation that
 * reads the wrong one produces a visibly wrong key, not an accidental match.
 *
 * The pure derivation lives in `devices.mjs` (no `import.meta`, no process calls
 * at module scope), so this needs no simulator and no lease.
 */

import { describe, expect, it } from '@jest/globals';

import {
  deviceClassName,
  iosDeviceClassName,
  iosDeviceKey,
} from '../bench/devices.mjs';

/** An iPhone 17 simulator under a lease-pool name, as `simctl list` reports it. */
const PAIR_A = {
  name: 'nitro-ui A',
  deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17',
};

describe('the iOS device key', () => {
  it('classes a leased simulator by its hardware type, not its lease name', () => {
    // The name says nothing a baseline path can use; the type identifier says
    // exactly the D9 class.
    expect(iosDeviceClassName(PAIR_A)).toBe('iphone17');
    expect(iosDeviceKey('27.0', PAIR_A)).toBe('ios27-sim-iphone17');
    // The wrong source is visible, not silent: the name's class is a different
    // string entirely, so reading it cannot coincidentally match.
    expect(deviceClassName(PAIR_A.name)).toBe('nitrouia');
    expect(iosDeviceKey('27.0', PAIR_A)).not.toBe(
      `ios27-sim-${deviceClassName(PAIR_A.name)}`
    );
  });

  it('classes the other lease names by the same rule', () => {
    // pair-b: an iPhone Air named `nitro-ui B`.
    expect(
      iosDeviceKey('27.0', {
        name: 'nitro-ui B',
        deviceTypeIdentifier:
          'com.apple.CoreSimulator.SimDeviceType.iPhone-Air',
      })
    ).toBe('ios27-sim-iphoneair');
    expect(
      iosDeviceKey('26.4', {
        name: 'bench-phoney',
        deviceTypeIdentifier:
          'com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro',
      })
    ).toBe('ios26-sim-iphone16pro');
  });

  it('falls back to the name only when there is no identifier to read', () => {
    expect(iosDeviceClassName({ name: 'iPhone 17' })).toBe('iphone17');
    expect(
      iosDeviceClassName({ name: 'iPhone Air', deviceTypeIdentifier: '' })
    ).toBe('iphoneair');
    expect(
      iosDeviceClassName({ name: 'iPhone 17', deviceTypeIdentifier: null })
    ).toBe('iphone17');
  });

  it('tolerates an identifier without the simctl prefix', () => {
    expect(
      iosDeviceClassName({
        name: 'whatever',
        deviceTypeIdentifier: 'iPhone-17e',
      })
    ).toBe('iphone17e');
  });

  it('keeps the runtime major in the key, and unknown when the runtime is missing', () => {
    expect(iosDeviceKey(null, PAIR_A)).toBe('iosunknown-sim-iphone17');
    expect(iosDeviceKey('27.0', { name: 'x' })).toBe('ios27-sim-x');
  });
});

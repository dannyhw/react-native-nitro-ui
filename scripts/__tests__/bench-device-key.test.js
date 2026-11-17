import { describe, expect, it } from 'vitest';

import {
  deviceClassName,
  iosDeviceClassName,
  iosDeviceKey,
} from '../bench/devices.mjs';

/**
 * An iPhone 17 simulator under an unrelated name, as `simctl list` reports it. Name and
 * type differ, so a key derived from the wrong one is visibly wrong.
 */
const PAIR_A = {
  name: 'nitro-ui A',
  deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17',
};

describe('the iOS device key', () => {
  it('classes a leased simulator by its hardware type, not its lease name', () => {
    expect(iosDeviceClassName(PAIR_A)).toBe('iphone17');
    expect(iosDeviceKey('27.0', PAIR_A)).toBe('ios27-sim-iphone17');
    expect(deviceClassName(PAIR_A.name)).toBe('nitrouia');
    expect(iosDeviceKey('27.0', PAIR_A)).not.toBe(
      `ios27-sim-${deviceClassName(PAIR_A.name)}`
    );
  });

  it('classes the other lease names by the same rule', () => {
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

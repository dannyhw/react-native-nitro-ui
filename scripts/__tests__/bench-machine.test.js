/**
 * The label a run records is the label its pre-flight accepted.
 *
 * `run.mjs` refuses an unusable `NITRO_UI_MACHINE_LABEL` before it boots a device,
 * because a baseline run costs hours and has nowhere to write its result without a
 * label. That only holds if the value the run later records - the one that picks the
 * baseline's directory - is the *same* value. Two reads that normalise differently
 * are the failure: a raw `process.env` read skips the trim, so
 * `NITRO_UI_MACHINE_LABEL=" maintainer-mac-1 "` would pass the pre-flight, get
 * recorded with its padding, and then throw on the way to the mint - after the
 * three-hour plan, which is precisely what the pre-flight exists to prevent.
 *
 * So this asserts the composition, not each half: what the pre-flight let through is
 * what the machine record carries, and is what resolves to a writable path.
 */

import { afterEach, describe, expect, it } from '@jest/globals';

import {
  labelPreFlightProblem,
  machineLabelFromEnv,
  mintBaselineFileFor,
} from '../bench/baseline.mjs';
import { collectMachine } from '../bench/machine.mjs';

const LABEL = 'maintainer-mac-1';

const originalLabel = process.env.NITRO_UI_MACHINE_LABEL;

afterEach(() => {
  if (originalLabel == null) {
    delete process.env.NITRO_UI_MACHINE_LABEL;
  } else {
    process.env.NITRO_UI_MACHINE_LABEL = originalLabel;
  }
});

describe('the label a run records', () => {
  it('is the label the pre-flight accepted, for a padded export', () => {
    // The case the two reads disagree about if one of them does not trim.
    process.env.NITRO_UI_MACHINE_LABEL = `  ${LABEL}  `;
    expect(
      labelPreFlightProblem(['--platform', 'ios', '--update-baseline'])
    ).toBeNull();

    const recorded = collectMachine('ios', { runtime: '27.0' }, null);
    expect(recorded.hostname).toBe(LABEL);
    expect(recorded.hostname).toBe(machineLabelFromEnv());
    // ...and that recorded value is what mints resolve, so the accepted run really
    // does have somewhere to write.
    const mint = mintBaselineFileFor({
      baselinesDir: 'bench/baselines',
      run: { deviceKey: 'ios27-sim-iphone17', machine: recorded },
    });
    expect(mint.refusal).toBeNull();
    expect(mint.file.replace(/\\/g, '/')).toBe(
      'bench/baselines/maintainer-mac-1/ios27-sim-iphone17.json'
    );
  });

  it('is unlabelled when the export is blank, so minting is refused rather than thrown on', () => {
    process.env.NITRO_UI_MACHINE_LABEL = '   ';
    const recorded = collectMachine('ios', { runtime: '27.0' }, null);
    expect(recorded.hostname).toBe('unlabelled');
    expect(
      labelPreFlightProblem(['--platform', 'ios', '--update-baseline'])
    ).toContain('NITRO_UI_MACHINE_LABEL');
    expect(
      mintBaselineFileFor({
        baselinesDir: 'bench/baselines',
        run: { deviceKey: 'ios27-sim-iphone17', machine: recorded },
      }).refusal
    ).toContain('NITRO_UI_MACHINE_LABEL');
  });

  it('is unchanged for a normal export, and iOS records the runtime', () => {
    process.env.NITRO_UI_MACHINE_LABEL = LABEL;
    const ios = collectMachine('ios', { runtime: '27.0' }, null);
    expect(ios.hostname).toBe(LABEL);
    expect(ios.simRuntime).toBe('27.0');
    expect(ios).not.toHaveProperty('avd');
    const android = collectMachine(
      'android',
      { avd: 'nitroui_t01', sdk: '35', image: 'fingerprint' },
      null
    );
    expect(android.hostname).toBe(LABEL);
    expect(android.avd).toBe('nitroui_t01');
    expect(android.androidApi).toBe('35');
    expect(android).not.toHaveProperty('simRuntime');
  });

  it('labels nothing for a plain run, which gates no baseline', () => {
    delete process.env.NITRO_UI_MACHINE_LABEL;
    expect(
      labelPreFlightProblem(['--platform', 'ios', '--plan', 'quick'])
    ).toBeNull();
    expect(labelPreFlightProblem(['--platform', 'ios', '--check'])).toContain(
      'no machine label'
    );
  });

  it('is not bypassed by --force, unlike the quality guards', () => {
    delete process.env.NITRO_UI_MACHINE_LABEL;
    expect(labelPreFlightProblem(['--update-baseline', '--force'])).toContain(
      'NITRO_UI_MACHINE_LABEL'
    );
  });
});

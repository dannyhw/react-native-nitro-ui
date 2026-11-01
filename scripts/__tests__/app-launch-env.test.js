/**
 * The app's own zone and locale, as one run decides them.
 *
 * Two harness rules assert a number that is only true in a particular
 * configuration, and CI's first hosted run lost both of them for exactly that
 * reason (run 41230848294):
 *
 *   - DatePicker's DST round trip needs a zone with a transition, and GitHub's
 *     macOS runners boot a simulator at `UTC` — the failure printed
 *     `expected +0 not to be +0`, reproduced locally with `NITRO_UI_TEST_TZ=UTC`;
 *   - DatePicker's declared `103 x 36.33` is the width the *measuring* locale's
 *     formatter produces, and an `en_US` simulator measures `107` — reproduced
 *     locally with `NITRO_UI_TEST_LOCALE=en_US`, which prints CI's sentence
 *     word for word.
 *
 * So the run has to *say* which configuration it is in rather than inherit one,
 * and these are the rules that turn an environment into launch arguments. They
 * live in `scripts/app-launch-env.mjs` because `example/rn-harness.config.mjs`
 * (the only place a launch is decided) runs a Node check, an `app.stamp` gate
 * and a device lookup when it is imported, so it cannot be unit-tested here.
 */

import { describe, expect, it } from '@jest/globals';

import {
  NITRO_UI_TEST_LANGUAGES_ENV,
  NITRO_UI_TEST_LOCALE_ENV,
  NITRO_UI_TEST_TZ_ENV,
  appLaunchOptionsFromEnv,
  describeAppLaunchOptions,
} from '../app-launch-env.mjs';

/** The three variables, with nothing set. */
const EMPTY = {};

const withLocale = (locale) => ({ [NITRO_UI_TEST_LOCALE_ENV]: locale });
const withZone = (zone) => ({ [NITRO_UI_TEST_TZ_ENV]: zone });

describe('what an app launch is told about its machine', () => {
  it('says nothing when the run does not ask, so a local launch is unchanged', () => {
    expect(appLaunchOptionsFromEnv(EMPTY)).toEqual({});
    expect(describeAppLaunchOptions(appLaunchOptionsFromEnv(EMPTY))).toBeNull();
  });

  it('passes the zone as TZ, which is what Foundation and Hermes answer from', () => {
    expect(appLaunchOptionsFromEnv(withZone('Europe/Lisbon'))).toEqual({
      environment: { TZ: 'Europe/Lisbon' },
    });
    // `UTC` is a legitimate answer, and the one a hosted runner already has. It
    // is what makes the DST failure reproducible on demand.
    expect(appLaunchOptionsFromEnv(withZone('UTC'))).toEqual({
      environment: { TZ: 'UTC' },
    });
  });

  it('passes the locale as -AppleLocale, in BCP-47 form', () => {
    // `en_US` is what `defaults`/`simctl` spell it, and what a shell naturally
    // sets; the argument the app reads is a language tag. Measured on the gate
    // simulator, this is the argument that moves the DatePicker's field width
    // from 103 pt to 107 pt.
    expect(appLaunchOptionsFromEnv(withLocale('en_US')).arguments).toEqual([
      '-AppleLocale',
      'en-US',
    ]);
    expect(appLaunchOptionsFromEnv(withLocale('en-PT')).arguments).toEqual([
      '-AppleLocale',
      'en-PT',
    ]);
  });

  it('keeps the UI language separate from the formatting region', () => {
    // Two different settings, and the standard automation form passes both.
    // `AppleLanguages` is a plist array, hence the parenthesised form simctl wants.
    const options = appLaunchOptionsFromEnv({
      ...withLocale('en_GB'),
      [NITRO_UI_TEST_LANGUAGES_ENV]: 'en_GB',
    });
    expect(options.arguments).toEqual([
      '-AppleLanguages',
      '(en-GB)',
      '-AppleLocale',
      'en-GB',
    ]);
  });

  it('refuses a language list with no formatting locale to match it', () => {
    // Half a pin is worse than none: the strings would be in one region and the
    // dates in the device's own, which is a configuration nobody measured and a
    // failure nobody can reproduce.
    expect(() =>
      appLaunchOptionsFromEnv({ [NITRO_UI_TEST_LANGUAGES_ENV]: 'de_DE' })
    ).toThrow(/names no locale/);
  });

  it.each(['en', 'en-US', 'zh-Hans-CN', 'pt_PT', 'de_419'])(
    'accepts %s, which the OS honours',
    (locale) => {
      expect(() => appLaunchOptionsFromEnv(withLocale(locale))).not.toThrow();
    }
  );

  it.each([
    'en; rm -rf /',
    '--AppleLocale en',
    'C.UTF-8',
    '../etc/passwd',
    'english',
  ])(
    'refuses %s, which would reach the app as its default locale',
    (locale) => {
      // These strings are appended to a `simctl launch` command line and become
      // the app's globals for its whole life, so a stray value is not a typo
      // anybody spots — it is an app-wide default and a misleading run.
      expect(() => appLaunchOptionsFromEnv(withLocale(locale))).toThrow(
        /not a locale identifier/
      );
    }
  );

  it.each(['UTC', 'Europe/Lisbon', 'America/New_York', 'Etc/GMT+1'])(
    'accepts the zone %s',
    (zone) => {
      expect(() => appLaunchOptionsFromEnv(withZone(zone))).not.toThrow();
    }
  );

  it.each(['UTC; rm -rf /', '../etc/zoneinfo', '--set-timezone UTC', ' '])(
    'refuses the zone %s rather than passing it to the app',
    (zone) => {
      // `' '` is the opt-out, and it is tested below rather than treated as a
      // zone: an empty value means "ask the device".
      if (zone.trim() === '') return;
      expect(() => appLaunchOptionsFromEnv(withZone(zone))).toThrow(
        /not an IANA zone name/
      );
    }
  );

  it('treats an empty value as "do not pin", which is what a developer’s own machine wants', () => {
    // Setting either variable to '' is how a run says "use the device's own",
    // so a shell that exports deliberately (a Mac set to `de_DE` on purpose)
    // opts out without the config having to know about it.
    expect(
      appLaunchOptionsFromEnv({
        [NITRO_UI_TEST_TZ_ENV]: '  ',
        [NITRO_UI_TEST_LOCALE_ENV]: '',
      })
    ).toEqual({});
  });

  it('describes the pin in one line, so the run says what it did', () => {
    // Printed by the config before the first launch. Without it a green run and
    // a run that compared a locale-dependent number in the wrong locale are the
    // same thing to whoever reads the log next.
    expect(
      describeAppLaunchOptions(
        appLaunchOptionsFromEnv({
          ...withZone('Europe/Lisbon'),
          ...withLocale('en_PT'),
        })
      )
    ).toBe('TZ=Europe/Lisbon locale=en-PT');
  });
});

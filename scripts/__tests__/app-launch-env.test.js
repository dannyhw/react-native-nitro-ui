import { describe, expect, it } from 'vitest';

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
    expect(appLaunchOptionsFromEnv(withZone('UTC'))).toEqual({
      environment: { TZ: 'UTC' },
    });
  });

  it('passes the locale as -AppleLocale, in BCP-47 form', () => {
    // `en_US` is how `defaults` and `simctl` spell it. The argument the app
    // reads is a language tag.
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
      // An empty value means "ask the device" and is tested below.
      if (zone.trim() === '') return;
      expect(() => appLaunchOptionsFromEnv(withZone(zone))).toThrow(
        /not an IANA zone name/
      );
    }
  );

  it('treats an empty value as "do not pin", which is what a developer’s own machine wants', () => {
    expect(
      appLaunchOptionsFromEnv({
        [NITRO_UI_TEST_TZ_ENV]: '  ',
        [NITRO_UI_TEST_LOCALE_ENV]: '',
      })
    ).toEqual({});
  });

  it('describes the pin in one line, so the run says what it did', () => {
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

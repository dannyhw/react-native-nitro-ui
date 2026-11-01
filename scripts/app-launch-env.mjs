/**
 * The app's own clock and locale, pinned for one run.
 *
 * Two harness rules have a premise about the machine the *app* runs on, not the
 * one Jest runs on:
 *
 *   - the DatePicker's DST round trip needs a zone that actually observes a
 *     transition (`example/__tests__/DatePicker.harness.tsx`);
 *   - the DatePicker's declared sizing fallback is the width the *current
 *     locale's* date formatter produces — 103 pt under `en_PT`, 107 pt under
 *     `en_US` (`ios/components/DatePicker/HybridNitroUiDatePicker.swift`'s
 *     `fallbackSize`, which says so in its own comment).
 *
 * A GitHub hosted runner has neither. Run 41230848294 lost exactly those two
 * tests on `UTC` and `en_US`, which is why both now also state their premise
 * (an assertion about a premise the machine does not satisfy is not evidence).
 * But a *job* that wants the premise true has to ask for it, and `example/
 * rn-harness.config.mjs` is the only place an app launch is decided: it passes
 * what this returns as `applePlatform({ appLaunchOptions })`, and
 * `simctl launch` forwards `environment` as `SIMCTL_CHILD_*` and appends
 * `arguments` to the launch.
 *
 * Lives here rather than in the config for the same reason `app-stamp-core.mjs`
 * and `lease-core.mjs` do: the config file runs a Node version check, an
 * `app.stamp` gate and a device lookup at import time, so it cannot be
 * unit-tested; this file is the decision, and
 * `scripts/__tests__/app-launch-env.test.js` drives it.
 */

/**
 * A locale identifier the OS will accept: `en_US`, `en-US`, `pt-PT`, `zh_Hans_CN`.
 * Deliberately strict, because a typo here becomes an app-wide default rather
 * than a failing assertion.
 */
const LOCALE_PATTERN = /^[A-Za-z]{2,3}([_-][A-Za-z0-9]{2,8})*([_-][A-Z]{2})?$/;

/**
 * Environment variable that pins the app's zone, and the two that pin its locale.
 *
 * Exported because `example/rn-harness.config.mjs` names them in the line it
 * prints, and a name that only exists in two files is how a run stops being
 * reproducible.
 */
export const NITRO_UI_TEST_TZ_ENV = 'NITRO_UI_TEST_TZ';
export const NITRO_UI_TEST_LOCALE_ENV = 'NITRO_UI_TEST_LOCALE';
export const NITRO_UI_TEST_LANGUAGES_ENV = 'NITRO_UI_TEST_LANGUAGES';

/**
 * Build `appLaunchOptions` from the environment.
 *
 * - `NITRO_UI_TEST_TZ` becomes `TZ` in the app's environment, which is the zone
 *   both Foundation and Hermes answer `Date.getTimezoneOffset()` from. An IANA
 *   name (`Europe/Lisbon`) is what to pass; `UTC` is legitimate and is what a
 *   hosted runner already has.
 * - `NITRO_UI_TEST_LOCALE` becomes the `-AppleLocale` launch argument — the
 *   *formatting* locale, which is what a `DateFormatter` set to
 *   `.autoupdatingCurrent` answers with, and so what decides the DatePicker's
 *   field width.
 * - `NITRO_UI_TEST_LANGUAGES` becomes `-AppleLanguages`. It defaults to the
 *   locale's own tag, and is separate because the two are genuinely different
 *   settings: which strings the UI is in, versus which region formats them.
 *   Passing both is the standard automation form; measured here, `-AppleLocale`
 *   alone is what moves the picker's width.
 *
 * These are NSArgumentDomain overrides, which outrank the app domain for the life
 * of the process — the alternative would be writing to the simulator's
 * preferences, a device mutation a test run has no business making on a leased
 * device.
 *
 * Unset means "say nothing", so a run that opts out tests the machine's own
 * configuration.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ environment?: Record<string,string>, arguments?: string[] }}
 * @throws when a value is set to something the OS would not honour
 */
export function appLaunchOptionsFromEnv(env = process.env) {
  /** @type {{ environment?: Record<string, string>, arguments?: string[] }} */
  const options = {};

  const zone = String(env[NITRO_UI_TEST_TZ_ENV] ?? '').trim();
  if (zone !== '') {
    // `..`, a space or a leading `-` would be a command line, not a zone name:
    // these strings go to `simctl launch` as arguments and to the app's env.
    if (!/^[A-Za-z0-9_+/-]+$/.test(zone) || zone.includes('..')) {
      throw new Error(
        `${NITRO_UI_TEST_TZ_ENV}="${zone}" is not an IANA zone name ` +
          '(e.g. Europe/Lisbon) or UTC, and it is passed to the app verbatim'
      );
    }
    options.environment = { TZ: zone };
  }

  const locale = String(env[NITRO_UI_TEST_LOCALE_ENV] ?? '').trim();
  const languages = String(env[NITRO_UI_TEST_LANGUAGES_ENV] ?? '').trim();
  if (locale === '' && languages !== '') {
    throw new Error(
      `${NITRO_UI_TEST_LANGUAGES_ENV}="${languages}" names no locale: set ` +
        `${NITRO_UI_TEST_LOCALE_ENV} too, or the UI would be in one region while ` +
        'dates format in the device’s own'
    );
  }
  if (locale !== '') {
    if (!LOCALE_PATTERN.test(locale)) {
      throw new Error(
        `${NITRO_UI_TEST_LOCALE_ENV}="${locale}" is not a locale identifier ` +
          '(e.g. `en_US` or `en-US`); a stray value would be handed to the app ' +
          'as its default formatting locale'
      );
    }
    const tag = locale.replaceAll('_', '-');
    options.arguments = ['-AppleLocale', tag];
    if (languages !== '') {
      const languageTag = languages.replaceAll('_', '-');
      if (!LOCALE_PATTERN.test(languageTag)) {
        throw new Error(
          `${NITRO_UI_TEST_LANGUAGES_ENV}="${languages}" is not a language tag ` +
            '(e.g. `en-GB`), and it is passed to the app as its `AppleLanguages`'
        );
      }
      options.arguments.unshift('-AppleLanguages', `(${languageTag})`);
    }
  }

  return options;
}

/**
 * The one-line statement of which configuration a run pinned, for the log.
 *
 * @param {ReturnType<typeof appLaunchOptionsFromEnv>} options
 * @returns {string | null}
 */
export function describeAppLaunchOptions(options) {
  const parts = [];
  const zone = options.environment?.TZ;
  if (zone != null) parts.push(`TZ=${zone}`);
  const args = options.arguments;
  if (args != null) parts.push(`locale=${args[args.length - 1]}`);
  return parts.length === 0 ? null : parts.join(' ');
}

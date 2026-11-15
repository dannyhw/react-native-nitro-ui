/**
 * The time zone and locale the app under test is launched with, read from the environment.
 * `simctl launch` forwards `environment` to the app and appends `arguments` to the launch.
 */

/**
 * A locale identifier the OS will accept: `en_US`, `en-US`, `pt-PT`, `zh_Hans_CN`.
 * Deliberately strict, because a typo here becomes an app-wide default rather
 * than a failing assertion.
 */
const LOCALE_PATTERN = /^[A-Za-z]{2,3}([_-][A-Za-z0-9]{2,8})*([_-][A-Z]{2})?$/;

/** Environment variables that pin the app's time zone, formatting locale and UI language. */
export const NITRO_UI_TEST_TZ_ENV = 'NITRO_UI_TEST_TZ';
export const NITRO_UI_TEST_LOCALE_ENV = 'NITRO_UI_TEST_LOCALE';
export const NITRO_UI_TEST_LANGUAGES_ENV = 'NITRO_UI_TEST_LANGUAGES';

/**
 * Build `appLaunchOptions` from the environment.
 *
 * - `NITRO_UI_TEST_TZ` becomes `TZ` in the app's environment: an IANA name such as
 *   `Europe/Lisbon`, or `UTC`.
 * - `NITRO_UI_TEST_LOCALE` becomes the `-AppleLocale` launch argument, the locale dates and
 *   numbers are formatted in.
 * - `NITRO_UI_TEST_LANGUAGES` becomes `-AppleLanguages`, the language the UI is in. It needs
 *   the locale to be set too.
 *
 * Launch arguments override the app's defaults for the life of the process only, so nothing
 * is written to the simulator. An unset variable adds nothing.
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

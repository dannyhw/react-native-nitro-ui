/**
 * The settings the *app under test* is actually running with, read from inside it.
 *
 * Two of this repo's assertions depend on something the test cannot choose: a
 * declared sizing fallback is a number for one locale's formatter, and a DST case
 * is only a DST case in a zone that changes its clock. Both premises used to be
 * `expect`ed, which is how CI's first hosted iOS run went red on
 * `expected +0 not to be +0` — GitHub's macOS images boot a simulator at `UTC`,
 * and the run that discovered it had no way to say "the premise was missing"
 * apart from "the product is broken".
 *
 * So the app asks the runtime instead. `example/rn-harness.config.mjs` pins a
 * locale and zone for every harness launch, and these helpers read back what the
 * process really got, so a suite can (a) name the configuration its numbers were
 * taken in and (b) report a missing premise as a printed skip rather than either a
 * silent pass or a misleading failure.
 *
 * Nothing here weakens a claim on a machine where the premise holds.
 */

/**
 * The locale the app's formatters will use, canonicalised to `en-US` style
 * (`en-US`, `pt-PT`). `''` when the runtime cannot say.
 *
 * `Intl` is the only channel both platforms answer through, and it answers with
 * the process's real setting rather than with what the run asked for: launching
 * the pool simulator with `-AppleLocale en-US` makes it report `en-US` (that is
 * how CI's `103x36.33` was reproduced locally), and launching it with the
 * `en_PT` the harness config now pins makes it report `pt-PT`. A hosted
 * simulator that was never given a locale reports its image default, which is the
 * premise miss this file exists to catch.
 */
export function deviceLocale(): string {
  try {
    const locale = new Intl.DateTimeFormat().resolvedOptions().locale;
    return typeof locale === 'string' ? locale.replace(/_/g, '-') : '';
  } catch {
    return '';
  }
}

/**
 * {@link deviceLocale} shaped for a log line: `locale=en-PT`, or
 * `locale=unknown` when the app cannot say, so an absent premise is visible in the
 * log rather than looking like an empty string that happens to match nothing.
 */
export function deviceLocaleNote(): string {
  const locale = deviceLocale();
  return `locale=${locale === '' ? 'unknown' : locale}`;
}

/** What {@link deviceZone} reports. */ export interface DeviceZone {
  /** IANA name when the runtime gives one (`Europe/Lisbon`), else `null`. */
  name: string | null;
  /** `Date#getTimezoneOffset()` in January, in minutes ahead of UTC (Lisbon: 0). */
  winterOffset: number;
  /** The same in July. Differs from {@link winterOffset} only in a zone with DST. */
  summerOffset: number;
  /** `true` when the two offsets differ, so an instant can cross a transition. */
  observesDst: boolean;
}

/**
 * The time zone the app's clock reads, and whether it has a DST transition between
 * January and July 2026 — the window every DST case in the suite lives in.
 *
 * Read from `Intl` rather than a launch argument because the zone arrives through
 * the process environment (`TZ`), which is the only thing both platforms agree on,
 * and because the answer has to be the runtime's: a zone the run *asked* for is a
 * premise, and the point of this file is that premises get checked.
 */
export function deviceZone(): DeviceZone {
  let name: string | null = null;
  try {
    const resolved = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof resolved === 'string' && resolved !== '') name = resolved;
  } catch {
    // No Intl: `name` stays null and the offsets below still answer the question
    // that the DST assertion actually asks.
  }
  // getTimezoneOffset is minutes *behind* UTC, so negate: Lisbon in January is
  // +0 and in July +1. January/July rather than the spring/autumn transition days
  // themselves: the offsets at a solstice are what say whether a zone shifts at
  // all, and a zone that shifts somewhere in the year shifts between those two.
  const winterOffset = -new Date(2026, 0, 15, 12).getTimezoneOffset() / 60;
  const summerOffset = -new Date(2026, 6, 15, 12).getTimezoneOffset() / 60;
  return {
    name,
    winterOffset,
    summerOffset,
    observesDst: winterOffset !== summerOffset,
  };
}

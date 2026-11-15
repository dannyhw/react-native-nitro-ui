// The locale and time zone the app under test is really running with, read from
// inside it, so a suite checks its premises instead of trusting the launch arguments.

/**
 * The locale the app's formatters will use, in `en-US` form; `''` when the runtime
 * cannot say. It is the process's real setting, not what the launcher asked for.
 */
export function deviceLocale(): string {
  try {
    const locale = new Intl.DateTimeFormat().resolvedOptions().locale;
    return typeof locale === 'string' ? locale.replace(/_/g, '-') : '';
  } catch {
    return '';
  }
}

/** {@link deviceLocale} for a log line: `locale=en-PT`, or `locale=unknown`. */
export function deviceLocaleNote(): string {
  const locale = deviceLocale();
  return `locale=${locale === '' ? 'unknown' : locale}`;
}

export interface DeviceZone {
  /** IANA name when the runtime gives one (`Europe/Lisbon`), else `null`. */
  name: string | null;
  /** Hours ahead of UTC in January (Lisbon: 0). */
  winterOffset: number;
  /** The same in July. Differs from {@link winterOffset} only in a zone with DST. */
  summerOffset: number;
  /** `true` when the two offsets differ, so an instant can cross a transition. */
  observesDst: boolean;
}

/**
 * The time zone the app's clock reads, and whether it has a DST transition between
 * January and July 2026.
 */
export function deviceZone(): DeviceZone {
  let name: string | null = null;
  try {
    const resolved = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof resolved === 'string' && resolved !== '') name = resolved;
  } catch {
    // No Intl: `name` stays null and the offsets below still say whether it shifts.
  }
  // getTimezoneOffset is minutes *behind* UTC, so negate: Lisbon in January is
  // +0 and in July +1. A zone that shifts at all shifts between January and July.
  const winterOffset = -new Date(2026, 0, 15, 12).getTimezoneOffset() / 60;
  const summerOffset = -new Date(2026, 6, 15, 12).getTimezoneOffset() / 60;
  return {
    name,
    winterOffset,
    summerOffset,
    observesDst: winterOffset !== summerOffset,
  };
}

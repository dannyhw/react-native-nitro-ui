/**
 * The name rules of the `androidIcon` prop. The Kotlin twin is `NitroUiIconNames`
 * in `NitroUiIcon.kt`; the two must agree.
 *
 * @internal Not app API — exported for this repo's tests.
 */

const NORMALIZED_NAME = /^[a-z][a-z0-9_]*$/;

/**
 * The name as the Android resource table wants it: lower case, with `-` and `.`
 * written as `_`, because `aapt` rejects a file name containing either.
 */
export function normalizeAndroidIconName(name: string): string {
  return name.toLowerCase().replace(/[-.]/g, '_');
}

/**
 * Why this string cannot name a drawable, or `null` when it can.
 *
 * Checked in JS because native cannot tell a name that cannot exist from a file
 * that was not shipped: both draw nothing.
 */
export function androidIconNameProblem(name: string): string | null {
  const normalized = normalizeAndroidIconName(name);
  if (normalized.length === 0) {
    return 'is empty';
  }
  if (!NORMALIZED_NAME.test(normalized)) {
    return (
      `is not a valid Android resource name — lower-case letters, digits and ` +
      `underscores only, and not starting with a digit`
    );
  }
  return null;
}

const warnedNames = new Set<string>();

/** Warn once per bad name, in development only. */
export function warnAndroidIconName(
  componentName: string,
  propName: string,
  name: string
): void {
  if (!__DEV__) {
    return;
  }
  const problem = androidIconNameProblem(name);
  if (problem === null) {
    return;
  }
  const key = `${componentName}:${name}`;
  if (warnedNames.has(key)) {
    return;
  }
  warnedNames.add(key);
  console.warn(
    `nitro-ui: ${componentName}'s ${propName} "${name}" ${problem}. ` +
      `Nothing will be drawn for it. See docs/components/button.md, "Android icons".`
  );
}

/** Forget the warning history. For tests, which must each see a fresh console. */
export function resetAndroidIconNameWarningsForTests(): void {
  warnedNames.clear();
}

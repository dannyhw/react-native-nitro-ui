/**
 * The name rules of the `androidIcon` prop.
 *
 * Android has no system icon set, so `androidIcon` names a drawable the app
 * ships, and the lookup is by string. Three of those names' failure modes are
 * silent in a release build and loud in a development one, which is the
 * difference between "the icon is missing" being a bug report and being a
 * console line while you write the screen (`docs/components/button.md`,
 * "Android icons").
 *
 * The Kotlin twin of these rules is `NitroUiIconNames` in
 * `android/src/main/java/com/margelo/nitro/nitroui/NitroUiIcon.kt`. They are
 * written twice because the two halves run in different languages and neither
 * can call the other at the moment it needs the answer, and
 * `src/__tests__/iconName.test.ts` pins the shared cases so a change on one
 * side that stops matching the other goes red here rather than in an app.
 *
 * @internal Not app API (DECISIONS D14) — exported for this repo's tests.
 */

/** What {@link normalizeAndroidIconName} and {@link androidIconNameProblem} agree on. */
const NORMALIZED_NAME = /^[a-z][a-z0-9_]*$/;

/**
 * The name as the Android resource table wants it: lower case, with `-` and `.`
 * written as `_`.
 *
 * Both substitutions exist because `aapt` rejects a resource file whose name
 * contains either, so a developer who downloaded `share-24px.xml` renames it to
 * `share_24px.xml` before it builds — and then has to remember that when typing
 * the prop. Accepting both spellings costs nothing and removes the trap.
 */
export function normalizeAndroidIconName(name: string): string {
  return name.toLowerCase().replace(/[-.]/g, '_');
}

/**
 * Why this string cannot name a drawable, or `null` when it can.
 *
 * Checked on the JS side rather than left to the native lookup because native's
 * answer to a name that cannot exist is identical to its answer to a file that
 * was not shipped: `0`, no icon, and — after the once-per-name warning — silence.
 * Telling those two apart at the point the developer can still act is the whole
 * value of this function.
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

/**
 * Warn once per bad name, in development only.
 *
 * Once per name rather than once per render: a list row that renders the same
 * broken name fifty times should produce one line, and a production app must not
 * pay a console write on a path that runs per frame.
 */
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

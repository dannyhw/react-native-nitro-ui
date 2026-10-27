/**
 * The lockfile-follows-releases logic, apart from the CLI that uses it.
 *
 * `sync-example-lock.mjs` resolves repo paths through `import.meta`, and a module
 * containing `import.meta` cannot be evaluated by jest's CommonJS transform at all -
 * the same split `scripts/pod-install-lib.mjs` exists for. So every decision lives
 * here, where `scripts/__tests__/example-lock.test.js` can test it without pods, a
 * simulator or a working tree.
 *
 * What the module guards against is a specific, expensive silence: after the 0.3.x
 * releases, `example/ios/Podfile.lock` stayed at `NitroUi (0.2.0)`, so every iOS
 * build wrote the lock and dirtied the tree, which invalidated the fresh `app.stamp`
 * the device gates had just recorded. A build that always looks dirty is a build
 * nobody trusts.
 *
 * What it deliberately does *not* do is validate `SPEC CHECKSUMS`. For a pod pulled
 * `from:` a path - which ours is - CocoaPods stores that checksum as the sha1 of its
 * own *stored* evaluation of the podspec (`Pods/Local Podspecs/NitroUi.podspec.json`,
 * gitignored, written by Ruby's `to_pretty_json` of a live `Pod::Spec`). No script in
 * this repo can recompute it, so the only content of a lock a Node guard can check
 * is the version. Anything stricter would have to run CocoaPods, which is why the
 * repair lives in a macOS CI step and not in `check`.
 */

/** The pod this repo ships, as the lock spells it. */
export const POD_NAME = 'NitroUi';

/** The lock's `PODS:` section, which is the only one carrying versions. */
const SECTION = /^PODS:$/;
/** Any other section header: unindented, and ends in a colon. */
const NEXT_SECTION = /^\S.*:$/;

/**
 * The readings that are not a version, and must not be reported as one.
 *
 * Both have to be distinct failures rather than null: "no `NitroUi (x)` entry" is
 * what a mistyped regex returns, and telling someone whose lock has *two* entries to
 * go install pods is a wild goose chase.
 */
export const NO_LOCK_ENTRY = 'no-entry';
export const AMBIGUOUS_LOCK_ENTRY = 'ambiguous';

/**
 * The version a `Podfile.lock` records for this package.
 *
 * Scoped to the `PODS:` section deliberately, because the same shape appears twice
 * more in a real lock: `DEPENDENCIES:` writes `  - NitroUi (from \`../..\`)` and
 * `EXTERNAL SOURCES:` writes `  NitroUi:`. An unscoped `- NitroUi (…)` match reads
 * the string `` from `../..` `` as a version and reports the lock as in sync with a
 * manifest that says `` from `../..` `` - i.e. it would never fire. Scanning only
 * until the next section header is what makes the guard able to fail at all.
 *
 * Within that section an entry is two-space indented, dash-prefixed, and carries a
 * colon only when it has dependencies underneath it; the 4-space lines below it are
 * *its* dependencies, which may themselves be parenthesised.
 *
 * @param {string} lockText
 * @param {string} [podName]
 * @returns {string | typeof NO_LOCK_ENTRY | typeof AMBIGUOUS_LOCK_ENTRY}
 */
export function lockedVersion(lockText, podName = POD_NAME) {
  const lines = lockText.split('\n');
  const start = lines.findIndex((line) => SECTION.test(line));
  if (start === -1) return NO_LOCK_ENTRY;
  const entry = new RegExp(`^ {2}- ${podName} \\((.+)\\):?$`);
  const found = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (NEXT_SECTION.test(line)) break;
    const match = entry.exec(line);
    if (match?.[1] != null) found.push(match[1]);
  }
  if (found.length === 0) return NO_LOCK_ENTRY;
  if (found.length > 1) return AMBIGUOUS_LOCK_ENTRY;
  return found[0];
}

/**
 * Why the lock and the manifest disagree, or null when they agree.
 *
 * The message is the product here. The failure has two very different causes - a
 * locally stale lock (run the sync script) and a release whose CI did not refresh
 * the lock (the `version` job's refresh step) - and a reader who is on the second
 * one must not be told to install pods on a Linux box.
 *
 * @param {{
 *   manifestVersion: string,
 *   lockText: string | null,
 *   lockPath?: string,
 *   podName?: string,
 * }} options
 * @returns {string | null} the failure text, or null when the lock is in sync
 */
export function lockSyncProblem({
  manifestVersion,
  lockText,
  lockPath = 'example/ios/Podfile.lock',
  podName = POD_NAME,
}) {
  if (lockText == null) {
    return (
      `${lockPath} does not exist, so nothing records the ${podName} version the ` +
      'example builds against.\n' +
      '  Fix: node scripts/sync-example-lock.mjs --fix'
    );
  }
  const locked = lockedVersion(lockText, podName);
  if (locked === NO_LOCK_ENTRY) {
    return (
      `${lockPath} has no \`- ${podName} (<version>)\` entry in its PODS: section, ` +
      'so nothing here can say what version it locks.\n' +
      '  Fix: node scripts/sync-example-lock.mjs --fix, then read the diff - the pod ' +
      'is probably not linked at all.'
    );
  }
  if (locked === AMBIGUOUS_LOCK_ENTRY) {
    return (
      `${lockPath} records ${podName} with a version more than once, which a real ` +
      '`pod install` never writes.\n' +
      '  Fix: read the diff against main - something has hand-edited the lock.'
    );
  }
  if (locked === manifestVersion) return null;
  return (
    `${lockPath} locks ${podName} (${locked}) while package.json is at ` +
    `${manifestVersion}.\n` +
    '  Fix locally:  node scripts/sync-example-lock.mjs --fix   (needs CocoaPods)\n' +
    '  On a release: the Version Packages pull request should have carried it - the ' +
    'refresh runs inside `bun run release:version`, whose job in ' +
    '.github/workflows/release.yml is the one on a macOS runner. It cannot be fixed ' +
    'on Linux: a path-pod’s checksum is only reproducible by CocoaPods, so this guard ' +
    'can only compare the version.'
  );
}

/**
 * Reads the working tree well enough to attribute what a command just changed.
 *
 * `run` is `git` with an argument list, returning its stdout, or null when it failed -
 * injected so this is unit-testable, and the test runs a *real* git against a throwaway
 * repository: a flag that does not exist is the failure mode here, and only the real
 * binary notices. `git status --name-only` looks like a real flag and is not one, which
 * cost this script its whole hygiene step while still exiting 0.
 *
 * Tracked changes come from `git status --porcelain` rather than `git diff --name-only`
 * because the former also sees a *staged* change: a file staged before the command ran is
 * somebody's work, and restoring it would destroy it.
 *
 * @param {(args: string[]) => string | null} run
 * @returns {{tracked: string[], untracked: string[]} | null}
 */
export function readTreeState(run) {
  const status = run(['status', '--porcelain=v1', '--untracked-files=no']);
  const untracked = run(['ls-files', '--others', '--exclude-standard']);
  if (status == null || untracked == null) return null;
  return {
    tracked: parseStatusEntries(status),
    untracked: untracked.split('\n').filter((line) => line !== ''),
  };
}

/**
 * The paths in `git status --porcelain=v1` output.
 *
 * Each line is `<XY><space><path>`, except a rename, which is
 * `<XY><space><old> -> <new>`: the new path is the one that exists now, and a rename
 * under `example/ios` is not something `pod install` does, so treating it as "this file
 * is dirty" is the conservative reading.
 *
 * @param {string} status
 * @returns {string[]}
 */
export function parseStatusEntries(status) {
  const paths = [];
  for (const line of status.split('\n')) {
    if (line === '') continue;
    const entry = line.slice(3);
    const arrow = entry.indexOf(' -> ');
    paths.push(
      (arrow === -1 ? entry : entry.slice(arrow + 4)).replace(/^"|"$/g, '')
    );
  }
  return paths;
}

/**
 * What to undo after a `pod install` that was run *for the lock*.
 *
 * `pod install` also regenerates the workspace data, writes `.xcode.env.local` and
 * rewrites the app project, and the changesets action commits *everything* in the
 * working tree (`git diff --name-status` plus every untracked non-ignored file). So a
 * refresh that leaves those behind publishes a pod user's breakpoints and a
 * machine-local `.xcode.env.local` inside the release commit.
 *
 * Everything is scoped to the example's iOS directory: a library source a person is
 * mid-way through editing must never be reverted by a script that only meant to
 * refresh a lock file. And files that were *already* dirty before the install are
 * reported rather than restored - they are somebody's work, not this command's mess.
 *
 * @param {{
 *   before: { tracked: string[], untracked: string[] } | null,
 *   after: { tracked: string[], untracked: string[] },
 *   scope?: string,
 *   lockPath?: string,
 * }} options
 *   `before` is what git reported before the install; null when git did not answer, in
 *   which case nothing can be attributed to the install and nothing should be touched.
 * @returns {{restore: string[], remove: string[], leaveAlone: string[], unknown: boolean}}
 */
export function sideEffectsToUndo({
  before,
  after,
  scope = 'example/ios',
  lockPath = 'example/ios/Podfile.lock',
}) {
  if (before == null) {
    return { restore: [], remove: [], leaveAlone: [], unknown: true };
  }
  const inside = (file) => file.startsWith(`${scope}/`);
  const newlyTracked = after.tracked.filter(
    (file) => inside(file) && !before.tracked.includes(file)
  );
  return {
    restore: newlyTracked.filter((file) => file !== lockPath),
    // An untracked, non-ignored file that was not there before can only have been
    // left by this install.
    remove: after.untracked.filter(
      (file) => inside(file) && !before.untracked.includes(file)
    ),
    leaveAlone: before.tracked.filter(
      (file) =>
        inside(file) && file !== lockPath && after.tracked.includes(file)
    ),
    unknown: false,
  };
}

/**
 * Re-apply a recorded `COCOAPODS:` trailer to a lock that really did change.
 *
 * `scripts/pod-install-lib.mjs` restores the trailer only when the trailer is *all*
 * that changed, which is right for a normal install: a real lock change should show
 * what ran it. A release refresh wants the opposite - exactly one line of churn, the
 * one the release caused - because the trailer records the runner's CocoaPods, not
 * anything about the release, and a runner on 1.19 bumping the trailer of a lock
 * pinned at 1.17.0 is the same noise R1/C1/G5/G6 lost hours to.
 *
 * @param {string} lockText what `pod` wrote
 * @param {string | null} stamp the trailer the lock had before
 * @returns {{ text: string, restored: boolean, from: string | null, to: string | null }}
 */
export function keepCocoapodsStamp(lockText, stamp) {
  const current = /^COCOAPODS: [^\S\n]*(\S+)[^\S\n]*$/m.exec(lockText);
  const to = current?.[1] ?? null;
  if (stamp == null || to == null || stamp === to) {
    return { text: lockText, restored: false, from: stamp, to };
  }
  return {
    text: lockText.replace(
      /^COCOAPODS: [^\S\n]*\S+[^\S\n]*$/m,
      `COCOAPODS: ${stamp}`
    ),
    restored: true,
    from: stamp,
    to,
  };
}

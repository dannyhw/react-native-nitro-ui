/**
 * Keeps `example/ios/Podfile.lock` at the released version: the decisions behind
 * `sync-example-lock.mjs`, free of `import.meta` so Jest can import them.
 */

/** The pod this repo ships, as the lock spells it. */
export const POD_NAME = 'NitroUi';

const SECTION = /^PODS:$/;
const NEXT_SECTION = /^\S.*:$/;

/** The readings that are not a version, and must not be reported as one. */
export const NO_LOCK_ENTRY = 'no-entry';
export const AMBIGUOUS_LOCK_ENTRY = 'ambiguous';

/**
 * The version a `Podfile.lock` records for this package.
 *
 * Scoped to the `PODS:` section: `DEPENDENCIES:` writes
 * `  - NitroUi (from \`../..\`)`, which an unscoped match would read as a version.
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
 * `run` is `git` with an argument list, returning its stdout, or null when it
 * failed. Tracked changes come from `git status --porcelain` rather than
 * `git diff --name-only` because the former also sees a staged change.
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
 * `<XY><space><old> -> <new>`: the new path is the one reported.
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
 * What to undo after a `pod install` that was run for the lock.
 *
 * `pod install` also regenerates workspace data, writes `.xcode.env.local` and
 * rewrites the app project, and the release action commits everything in the
 * working tree. Only the example's iOS directory is in scope, and files that
 * were already dirty before the install are reported rather than restored.
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
 * The lines two versions of a lock disagree about, as a multiset difference:
 * `pod install` regenerates the file, so the same lines in a different order
 * count as the same lock.
 *
 * @param {string | null} beforeText
 * @param {string | null} afterText
 * @returns {{kind: 'removed'|'added', line: string, times: number}[]}
 */
export function changedLockLines(beforeText, afterText) {
  const tally = (text) => {
    const counts = new Map();
    for (const line of (text ?? '').split('\n')) {
      if (line === '') continue;
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
    return counts;
  };
  const before = tally(beforeText);
  const after = tally(afterText);
  const changes = [];
  /** @type {('removed' | 'added')[]} */
  const kinds = ['removed', 'added'];
  for (const kind of kinds) {
    const from = kind === 'removed' ? before : after;
    const other = kind === 'removed' ? after : before;
    for (const [line, count] of from) {
      const times = count - (other.get(line) ?? 0);
      if (times > 0) changes.push({ kind, line, times });
    }
  }
  return changes;
}

/**
 * Why a refreshed lock is more than a version bump, or null when it is only one.
 *
 * A release refresh should change exactly two lines: this pod's `PODS:` entry and
 * its `SPEC CHECKSUMS` line. Anything else means `pod install` resolved something
 * other than the release (a different gem set, Xcode or `PODFILE CHECKSUM`). The
 * `COCOAPODS:` trailer is not allowed through either: `keepCocoapodsStamp` has
 * already put the recorded one back.
 *
 * @param {{
 *   beforeText: string | null,
 *   afterText: string | null,
 *   podName?: string,
 *   lockPath?: string,
 * }} options
 * @returns {string | null} the failure, naming every unexpected line
 */
export function lockChurnProblem({
  beforeText,
  afterText,
  podName = POD_NAME,
  lockPath = 'example/ios/Podfile.lock',
}) {
  const allowed = [
    // The PODS: entry and the checksum, at any version: the old line appears as
    // removed and the new one as added.
    new RegExp(`^ {2}- ${podName} \\(.+\\):?$`),
    new RegExp(`^ {2}${podName}: [0-9a-f]+$`),
  ];
  const unexpected = changedLockLines(beforeText, afterText).filter(
    (change) => !allowed.some((pattern) => pattern.test(change.line))
  );
  if (unexpected.length === 0) return null;
  const listed = unexpected
    .map(
      (change) =>
        `    ${change.kind === 'removed' ? '-' : '+'} ${
          change.times > 1 ? `${String(change.times)}x ` : ''
        }${change.line.trim()}`
    )
    .join('\n');
  return (
    `${lockPath} changed beyond ${podName}'s version line, so this refresh is not ` +
    'the release alone:\n' +
    `${listed}\n` +
    '  Fix: do not commit that. Compare `pod --version`, the Xcode and the Podfile ' +
    'on the machine that ran it with the ones that produced the file at HEAD; a ' +
    '`PODFILE CHECKSUM` line here means the Podfile itself changed in the same ' +
    'commit as the release, which belongs in its own pull request.'
  );
}

/**
 * Whether CocoaPods is usable here. `pod --version` costs a moment and writes
 * nothing, so a release can ask before `changeset version` rewrites anything.
 *
 * @param {(cmd: string[]) => { ok: boolean, version?: string }} probe
 * @param {string | undefined} override `COCOAPODS_BIN`, so a caller with its own
 *   `bundle exec pod` is not refused for the absence of a gem it does not use.
 * @returns {{ ok: boolean, why: string }}
 */
export function cocoaPodsAvailability(probe, override) {
  if (override != null && override.trim() !== '') {
    const cmd = override.trim().split(/\s+/);
    const probed = probe([...cmd, '--version']);
    return {
      ok: probed.ok,
      why: probed.ok
        ? `COCOAPODS_BIN (${cmd.join(' ')}) answered ${probed.version ?? 'ok'}`
        : `COCOAPODS_BIN is set to "${cmd.join(' ')}" and it does not run`,
    };
  }
  const probed = probe(['pod', '--version']);
  return {
    ok: probed.ok,
    why: probed.ok
      ? `pod on PATH (${probed.version ?? 'version unknown'})`
      : 'no `pod` on PATH',
  };
}

/**
 * Re-apply a recorded `COCOAPODS:` trailer to a lock that really did change.
 *
 * The trailer records the CocoaPods version of the machine that ran the
 * install, not anything about the release, so a release refresh keeps the old
 * one.
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

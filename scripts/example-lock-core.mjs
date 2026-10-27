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
 * The lines two versions of a lock disagree about, as a multiset difference.
 *
 * Not a positional diff: `pod install` regenerates the file, so a real change can
 * shift lines around, and a diff that reported every shift as churn would be noise
 * nobody reads. Two files with the same lines in a different order are, for this
 * purpose, the same lock.
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
 * A release refresh wants to change exactly two lines: this pod's `PODS:` entry and
 * its `SPEC CHECKSUMS` line. Anything else in the diff means the runner that ran
 * `pod install` resolved something other than the release - a different gem set, a
 * different Xcode, a changed `PODFILE CHECKSUM` - and that lock would be committed
 * *green*, only for the next maintainer's `pod install` to rewrite it back. That is
 * item 2's own bug arriving again quietly, dirtying a tracked file and invalidating
 * `app.stamp`, so the refresh refuses it loudly instead.
 *
 * The `COCOAPODS:` trailer is deliberately *not* allowed through: `keepCocoapodsStamp`
 * has already put the recorded one back, so a difference here means the lock had no
 * trailer to keep, which is worth a conversation of its own.
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
    // The PODS: entry (with or without dependencies underneath) and the checksum.
    // Both match at any version, because both sides of a version change appear
    // here: the old line as removed, the new one as added.
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
 * Is CocoaPods actually usable here? The reason `--fix` refuses *before* touching
 * anything.
 *
 * `release:version` is `changeset version && sync-example-lock.mjs --fix`, and the
 * second half needs CocoaPods while the first half does not. On a laptop without
 * it - a Linux contributor following CONTRIBUTING to preview the next version - the
 * old order rewrote `package.json`, `CHANGELOG.md` and `.changeset/`, *then* failed,
 * leaving a half-applied version the doc never mentioned. The probe is the cheapest
 * thing that answers the question: `pod --version` costs a moment and writes nothing.
 *
 * @param {(cmd: string[]) => { ok: boolean, version?: string }} probe
 * @param {string | undefined} override `COCOAPODS_BIN`, honoured the way
 *   `pod-install-lib.mjs` honours it, so a caller with its own `bundle exec pod`
 *   is not refused for the absence of a gem it does not use.
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

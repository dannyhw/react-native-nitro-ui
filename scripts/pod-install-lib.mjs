/**
 * The CocoaPods decisions behind `pod-install.mjs`: the lock's version stamp and
 * the environment a `pod install` runs in. No `import.meta`, so Jest can load it.
 */

/**
 * The `COCOAPODS:` trailer of a Podfile.lock, or null when there is none.
 * @param {string | null} lockText
 * @returns {string | null}
 */
export function cocoapodsStamp(lockText) {
  if (lockText == null) return null;
  const match = /^COCOAPODS: [^\S\n]*(\S+)[^\S\n]*$/m.exec(lockText);
  return match == null ? null : match[1];
}

/**
 * Put the recorded CocoaPods stamp back, but only when the stamp is *all* that
 * changed.
 *
 * @param {string | null} beforeText the lock as it was before the install
 * @param {string} afterText the lock as `pod` wrote it
 * @returns {{ text: string, changed: boolean, stampOnly: boolean, from: string | null, to: string | null }}
 *   `text` is what to write back; `stampOnly` is true when the only difference
 *   was the tool version and `text` is therefore the original text.
 */
export function reconcileCocoapodsStamp(beforeText, afterText) {
  const from = cocoapodsStamp(beforeText);
  const to = cocoapodsStamp(afterText);
  if (beforeText == null || beforeText === afterText) {
    return { text: afterText, changed: false, stampOnly: false, from, to };
  }
  if (from != null && to != null && from !== to) {
    const rewritten = afterText.replace(
      /^COCOAPODS: [^\S\n]*\S+[^\S\n]*$/m,
      `COCOAPODS: ${from}`
    );
    if (rewritten === beforeText) {
      return { text: beforeText, changed: true, stampOnly: true, from, to };
    }
  }
  return { text: afterText, changed: true, stampOnly: false, from, to };
}

/**
 * The CocoaPods version to aim for: the target lock's own stamp, else the
 * repository's (a generated consumer app has no lock of its own yet).
 *
 * @param {{ targetLockText: string | null, repoLockText?: string | null }} options
 * @returns {string | null}
 */
export function pinnedCocoapods({ targetLockText, repoLockText = null }) {
  return cocoapodsStamp(targetLockText) ?? cocoapodsStamp(repoLockText);
}

/**
 * Pick the command to install with, as `[file, ...args]` (no shell: the caller's
 * environment is already the one to honour).
 *
 * @param {object} options
 * @param {string | null} options.pin the CocoaPods version to prefer
 * @param {(cmd: string[]) => { ok: boolean, version?: string }} options.probe
 * @param {boolean} options.hasGemfile whether bundler can resolve one here
 * @param {string | undefined} options.override `COCOAPODS_BIN`
 * @returns {{ cmd: string[], why: string }}
 */
export function choosePodCommand({ pin, probe, hasGemfile, override }) {
  if (override != null && override.trim() !== '') {
    return { cmd: override.trim().split(/\s+/), why: 'COCOAPODS_BIN' };
  }
  if (pin != null) {
    // Ruby's `gem version` syntax: exact, and needs no shell profile or bundler.
    const gem = probe(['pod', `_${pin}_`]);
    if (gem.ok)
      return { cmd: ['pod', `_${pin}_`], why: `gem ${pin} installed` };
  }
  if (hasGemfile) {
    const bundled = probe(['bundle', 'exec', 'pod']);
    if (bundled.ok && (pin == null || bundled.version === pin)) {
      return { cmd: ['bundle', 'exec', 'pod'], why: 'Gemfile resolves it' };
    }
  }
  return {
    cmd: ['pod'],
    why: pin == null ? 'pod on PATH' : `pod on PATH, not ${pin}`,
  };
}

/**
 * The `json` gem version `.github/workflows/release.yml` installs. Which `json`
 * the Ruby behind `pod` loads decides every `SPEC CHECKSUMS` entry of a path pod:
 * the checksum is the sha1 of the podspec JSON CocoaPods writes with
 * `JSON.pretty_generate`, and `json` before 2.8 prints an empty array with a blank
 * line inside it where 2.8 and later print `[]`. A machine is checked against the
 * formatting (`EXPECTED_EMPTY_ARRAY_STYLE`), not against the version.
 */
export const PINNED_JSON_GEM = '2.18.0';

/** How a machine's CocoaPods renders an empty array inside a stored podspec. */
export const EMPTY_ARRAY_COMPACT = 'compact';
export const EMPTY_ARRAY_EXPANDED = 'expanded';
/**
 * Any other spacing, such as `[ ]` or `[\n]`. Distinct from `null`, which means
 * there was nothing to read. Both refuse.
 */
export const EMPTY_ARRAY_OTHER = 'other';

/** The style the committed `Podfile.lock` checksums were produced with. */
export const EXPECTED_EMPTY_ARRAY_STYLE = EMPTY_ARRAY_COMPACT;

/**
 * The podspec `scripts/pod-install.mjs` asks CocoaPods to re-serialise to find
 * out which style a machine writes. Its one dependency has no version
 * requirement, which is what produces the empty array, and it has no
 * `source_files`, so asking about it compiles nothing.
 */
export const SERIALISATION_CANARY_PODSPEC = `
Pod::Spec.new do |s|
  s.name         = 'NitroUiSerialisationCanary'
  s.version      = '0.0.0'
  s.summary      = 'Does this CocoaPods put a newline inside an empty array?'
  s.homepage     = 'https://github.com/dannyhw/react-native-nitro-ui'
  s.license      = 'MIT'
  s.authors      = 'nitro-ui'
  s.platforms    = { :ios => '15.1' }
  s.source       = { :git => 'https://github.com/dannyhw/react-native-nitro-ui.git', :tag => 'v0.0.0' }
  s.dependency 'react-native-nitro-ui'
end
`;

/**
 * Which style a `pod ipc spec` answer shows, or null when it cannot be read. It
 * reads what the machine writes, not a version number, and looks at any empty
 * collection because the style belongs to the serialiser. Compact means exactly
 * `[]`: the checksum hashes bytes, so no other spacing counts as agreement.
 *
 * @param {string | null} specJson the `to_pretty_json` of some podspec
 * @returns {
 *   | typeof EMPTY_ARRAY_COMPACT
 *   | typeof EMPTY_ARRAY_EXPANDED
 *   | typeof EMPTY_ARRAY_OTHER
 *   | null
 * }
 */
export function emptyArrayStyleOf(specJson) {
  if (specJson == null) return null;
  // json < 2.8.0: the opener, a blank line, the closer. Tested first, because
  // it is the answer that refuses an install.
  if (/\[[ \t]*\n[ \t]*\n[ \t]*\]/.test(specJson)) return EMPTY_ARRAY_EXPANDED;
  // json >= 2.8.0: `[]` on the line that opened it, nothing in between.
  if (/:[ \t]*\[\]/.test(specJson)) return EMPTY_ARRAY_COMPACT;
  // Any other spacing of an empty array: `[ ]`, `[\n]`, `[\n\t  ]`.
  if (/:[ \t]*\[[\s]*\]/.test(specJson)) return EMPTY_ARRAY_OTHER;
  return null;
}

/**
 * Why this CocoaPods would not write the committed lock's checksums, or null.
 *
 * @param {{ style: string | null, lockPath?: string }} options
 * @returns {string | null}
 */
export function podSerialisationProblem({
  style,
  lockPath = 'example/ios/Podfile.lock',
}) {
  if (style === EXPECTED_EMPTY_ARRAY_STYLE) return null;
  const seen =
    style == null
      ? 'the probe could not be read (no `pod ipc spec` answer, or nothing ' +
        'recognisable in it)'
      : style === EMPTY_ARRAY_EXPANDED
        ? 'it writes empty arrays with a blank line inside them (the `json` ' +
          'gem before 2.8.0)'
        : 'it writes them some other way (`[ ]` or `[\n]`), a spacing this ' +
          'repo has never seen';
  return (
    `this CocoaPods does not serialise podspecs the way ${lockPath} was ` +
    `written: ${seen}, and the lock needs ${EXPECTED_EMPTY_ARRAY_STYLE}.\n` +
    '  Every `SPEC CHECKSUMS` entry is the sha1 of the JSON CocoaPods stores in ' +
    '`Pods/Local Podspecs`, which `JSON.pretty_generate` writes, so this is not ' +
    'a formatting opinion - installing here would rewrite that lock across ' +
    'almost every pod. X13: a release runner on json 2.7.2 against Macs on ' +
    '2.18.0 moved 87 of 96 checksums and the churn guard stopped the release.\n' +
    `  Fix: use a Ruby whose \`json\` is ${PINNED_JSON_GEM} or newer-but-still-compact, ` +
    'as loaded rather than as installed - check with `ruby -rjson -e ' +
    "'print JSON::VERSION'`, not `gem list json`. The release job installs that " +
    'version before it installs CocoaPods, and says what loads.'
  );
}

/**
 * The variables that decide how the example's pods get evaluated, and the value
 * `example/ios/Podfile.lock` was resolved with. Each is read by a podspec or by
 * `react_native_pods.rb` before it settles anything the lock records.
 *
 * `value: null` means unset is the resolved state: the variable has no default in
 * React Native, and any value changes the evaluated spec.
 */
export const POD_INSTALL_CONTRACT = [
  {
    name: 'RCT_USE_PREBUILT_RNCORE',
    value: '1',
    why: 'react_native_pods.rb:117 defaults it to 1; at 0 the React pods build from source, `podspec_sources` (react_native_pods.rb:384) swaps their source_files and `rncore_pod` (react_native_pods.rb:62) stops installing the generated facades - React-Core, Yoga, RCT-Folly and the rest all change checksum.',
  },
  {
    name: 'RCT_USE_RN_DEP',
    value: '1',
    why: 'react_native_pods.rb:116, same default and the same effect on the third-party pods, which are installed as `build/rndeps-facades` specs (cocoapods/rndeps_facades.rb).',
  },
  {
    name: 'USE_FRAMEWORKS',
    value: null,
    emptyCountsAsSet: true,
    why: "`if ENV['USE_FRAMEWORKS']` is in dozens of podspecs and adds header search paths and xcconfig entries; `detect_use_frameworks` (cocoapods/utils.rb:310) returns early when it is already set, so an inherited value is never recomputed from the target's real build type.",
  },
  {
    name: 'RCT_SKIP_CODEGEN',
    value: null,
    why: 'codegen.rb:24 short-circuits codegen and its build-folder cleanup, which is what the ReactCodegen and ReactAppDependencyProvider pods are built from.',
  },
  {
    name: 'RCT_IGNORE_PODS_DEPRECATION',
    value: null,
    why: "react_native_pods.rb:112 folds it into RCT_SKIP_CODEGEN (`RCT_SKIP_CODEGEN == '1' || RCT_IGNORE_PODS_DEPRECATION == '1'`), so setting it skips codegen through the same path while looking, from the environment alone, like a deprecation-warning switch.",
  },
  {
    name: 'IS_REANIMATED_PROFILING',
    value: null,
    emptyCountsAsSet: true,
    why: 'RNReanimated.podspec:10 adds -DREANIMATED_PROFILING to its compiler_flags.',
  },
  {
    name: 'IS_WORKLETS_PROFILING',
    value: null,
    emptyCountsAsSet: true,
    why: 'RNWorklets.podspec:18, same shape.',
  },
  {
    name: 'RCT_USE_LOCAL_RN_DEP',
    value: null,
    emptyCountsAsSet: true,
    why: 'rndependencies.rb:72 points ReactNativeDependencies at a local xcframework instead of the published artifact.',
  },
  {
    name: 'RCT_TESTONLY_RNCORE_TARBALL_PATH',
    value: null,
    emptyCountsAsSet: true,
    why: 'rncore.rb:60, same shape for React-Core-prebuilt.',
  },
  {
    name: 'RCT_TESTONLY_RNCORE_VERSION',
    value: null,
    emptyCountsAsSet: true,
    why: 'rncore.rb:47 overrides the prebuilt React Native core version.',
  },
  {
    name: 'RCT_DEPS_VERSION',
    value: null,
    emptyCountsAsSet: true,
    why: 'rndependencies.rb:106 overrides the prebuilt third-party version.',
  },
];

/**
 * The environment to hand a `pod install`, plus anything this machine disagrees
 * with the committed lock about.
 *
 * - A variable the caller has not set is written when the lock resolves it to its
 *   documented default, so every machine agrees by construction.
 * - A variable a person has set is kept and reported, never overridden.
 *
 * `NAME=` (set but empty) is not uniformly "unset" in Ruby: `if ENV['X']` is true
 * for an empty string and `ENV['X'] == '1'` is not. Each entry says which applies
 * in `emptyCountsAsSet`.
 *
 * @param {Record<string, string | undefined>} env the caller's environment
 * @param {{ contract?: typeof POD_INSTALL_CONTRACT }} [options]
 * @returns {{ env: Record<string, string | undefined>, pinned: string[], deviations: {name: string, value: string, expected: string | null, why: string}[] }}
 */
export function podInstallEnvironment(
  env,
  { contract = POD_INSTALL_CONTRACT } = {}
) {
  const next = { ...env };
  const pinned = [];
  const deviations = [];

  for (const entry of contract) {
    const current = next[entry.name];
    const isSet =
      current !== undefined && (current !== '' || entry.emptyCountsAsSet);
    if (!isSet) {
      if (entry.value != null) {
        next[entry.name] = entry.value;
        pinned.push(`${entry.name}=${entry.value}`);
      }
      continue;
    }
    if (current !== entry.value) {
      deviations.push({
        name: entry.name,
        value: current,
        expected: entry.value,
        why: entry.why,
      });
    }
  }

  return { env: next, pinned, deviations };
}

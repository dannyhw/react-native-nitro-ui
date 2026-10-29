/**
 * The CocoaPods-stamp logic, apart from the CLI that uses it.
 *
 * `pod-install.mjs` resolves repo paths through `import.meta`, and a module
 * containing `import.meta` cannot be evaluated by jest's CommonJS transform at
 * all - the same split `scripts/bench/render.mjs` documents against
 * `report.mjs`. So the decisions live here, where
 * `scripts/__tests__/pod-install.test.js` can test them without pods.
 *
 * The environment pins (`podInstallEnvironment`) live here for the same reason,
 * and because they answer a different question from the stamp: not "which pod
 * wrote this file" but "would a different machine have evaluated these
 * podspecs the same way". See the comment on that function.
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
 * The environment a `pod install` runs in, and the one thing about it this repo
 * cannot leave to the machine.
 *
 * Which `json` gem the Ruby behind `pod` loads decides the *bytes* CocoaPods
 * writes for every path-pod, so it decides every `SPEC CHECKSUMS` entry.
 * `Pod::Specification#checksum` is `Digest::SHA1.hexdigest(File.read(defined_in_file))`
 * (`cocoapods-core/specification.rb:690`), and for a pod pulled `from:` a path
 * `defined_in_file` is `Pods/Local Podspecs/<Name>.podspec.json` - a file
 * CocoaPods regenerates from the evaluated spec with
 * `Pod::Specification::JSONSupport#to_pretty_json`
 * (`cocoapods-core/specification/json.rb:18`), which is
 * `JSON.pretty_generate(spec.to_hash)`. `json` < 2.8 prints an empty array with
 * a blank line inside it; `json` >= 2.8 prints `[]` (`ruby/json` CHANGES.md,
 * 2.8.0: "`JSON.pretty_generate` no longer includes newlines inside empty object
 * and arrays"). So one dependency written without a version constraint -
 * `s.dependency 'React-cxxstableapi'` in `react-native/ReactCommon/callinvoker/`
 * `React-callinvoker.podspec:43`, which serialises as `"React-cxxstableapi": []` -
 * moves that pod's checksum by two bytes of whitespace. X13: the release run's
 * macOS runner resolved CocoaPods under Ruby 3.3.9 (json 2.7.2, expanded), the
 * maintainer Macs run it under Ruby 4.0.5 (json 2.18.0, compact), and 87 of the
 * lock's 96 checksums moved. Nothing about the release had changed.
 *
 * That is why the *formatting* is the contract and the version is only its
 * cause: `EXPECTED_EMPTY_ARRAY_STYLE` is what a machine is measured against, so
 * a Ruby upgrade that keeps `[]` compact is accepted and a Ruby whose json
 * changes again is caught, rather than this script trusting a version number.
 * `.github/workflows/release.yml` pins the gem itself, at
 * `PINNED_JSON_GEM`, so CI cannot be on the wrong side of the line at all.
 */
export const PINNED_JSON_GEM = '2.18.0';

/** How a machine's CocoaPods renders an empty array inside a stored podspec. */
export const EMPTY_ARRAY_COMPACT = 'compact';
export const EMPTY_ARRAY_EXPANDED = 'expanded';

/** The style the committed `Podfile.lock` checksums were produced with. */
export const EXPECTED_EMPTY_ARRAY_STYLE = EMPTY_ARRAY_COMPACT;

/**
 * The podspec `scripts/pod-install.mjs` asks CocoaPods to re-serialise to find
 * out which style a machine writes.
 *
 * It is a real DSL podspec, not a `.podspec.json`, because the question is what
 * the *evaluation + serialisation* pipeline emits. The one dependency is
 * declared without a requirement, which is what produces the empty array
 * (`"react-native-nitro-ui": []`) - the two bytes everything turns on. It has no
 * `source_files`, so asking about it lays nothing down and compiles nothing.
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
 * Which style a `pod ipc spec` answer shows, or null when it cannot be read.
 *
 * Deliberately a reading of the *answer*, not of `json --version` or
 * `ruby -v`: those say what the machine has, this says what it does, and the
 * failure that cost a release was a machine that had something nobody had
 * compared. Unreadable comes back null rather than as either style, so a probe
 * that could not run is never counted as agreement.
 *
 * It looks at *any* empty collection rather than at the canary's one dependency
 * by name, because the style is a property of the serialiser and not of the
 * spec - which is also what lets the same reader be pointed at a real stored
 * podspec to check the answer against something nobody authored.
 *
 * @param {string | null} specJson the `to_pretty_json` of some podspec
 * @returns {typeof EMPTY_ARRAY_COMPACT | typeof EMPTY_ARRAY_EXPANDED | null}
 */
export function emptyArrayStyleOf(specJson) {
  if (specJson == null) return null;
  // json < 2.8.0 ("Always indent even if empty", ruby/json 2.7.0): the opener, a
  // blank line, the closer. Tested first, because it is the answer that refuses
  // an install and the one a false positive costs anything.
  if (/\[[ \t]*\n[ \t]*\n[ \t]*\]/.test(specJson)) return EMPTY_ARRAY_EXPANDED;
  // json >= 2.8.0: an empty array is `[]` on the line that opened it.
  if (/:\s*\[\s*\]/.test(specJson)) return EMPTY_ARRAY_COMPACT;
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
      ? 'the probe could not be read'
      : `it writes empty arrays ${style === EMPTY_ARRAY_EXPANDED ? 'with a blank line inside them (the `json` gem before 2.8.0)' : 'a different way again'}`;
  return (
    `this CocoaPods does not serialise podspecs the way ${lockPath} was ` +
    `written: ${seen}, and the lock needs ${EXPECTED_EMPTY_ARRAY_STYLE}.\n` +
    '  Every `SPEC CHECKSUMS` entry is the sha1 of the JSON CocoaPods stores in ' +
    '`Pods/Local Podspecs`, which `JSON.pretty_generate` writes, so this is not ' +
    'a formatting opinion - installing here would rewrite that lock across ' +
    'almost every pod. X13: a release runner on json 2.7.2 against Macs on ' +
    '2.18.0 moved 87 of 96 checksums and the churn guard stopped the release.\n' +
    `  Fix: use a Ruby whose \`json\` is ${PINNED_JSON_GEM} or newer-but-still-compact ` +
    '(`gem list json`), or run the refresh on a machine that matches. The ' +
    'release job installs that version before it installs CocoaPods.'
  );
}

/**
 * The variables that decide how the example's pods get evaluated, and the value
 * `example/ios/Podfile.lock` was resolved with.
 *
 * Each of these is read by a podspec or by `react_native_pods.rb` *before* it
 * settles anything the lock records, so a value carried in from a shell profile
 * or a runner image rewrites a large part of it - the same shape of failure as
 * the `json` one above, from a different variable. Every entry names the line
 * that reads it.
 *
 * `value: null` means "unset is the resolved state": the variable has no
 * default in React Native, and *any* value changes the evaluated spec.
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
    why: "`if ENV['USE_FRAMEWORKS']` is in dozens of podspecs and adds header search paths and xcconfig entries; `detect_use_frameworks` (cocoapods/utils.rb:310) returns early when it is already set, so an inherited value is never recomputed from the target's real build type.",
  },
  {
    name: 'RCT_SKIP_CODEGEN',
    value: null,
    why: 'codegen.rb:24 short-circuits codegen and its build-folder cleanup, which is what the ReactCodegen and ReactAppDependencyProvider pods are built from.',
  },
  {
    name: 'IS_REANIMATED_PROFILING',
    value: null,
    why: 'RNReanimated.podspec:10 adds -DREANIMATED_PROFILING to its compiler_flags.',
  },
  {
    name: 'IS_WORKLETS_PROFILING',
    value: null,
    why: 'RNWorklets.podspec:18, same shape.',
  },
  {
    name: 'RCT_USE_LOCAL_RN_DEP',
    value: null,
    why: 'rndependencies.rb:72 points ReactNativeDependencies at a local xcframework instead of the published artifact.',
  },
  {
    name: 'RCT_TESTONLY_RNCORE_TARBALL_PATH',
    value: null,
    why: 'rncore.rb:60, same shape for React-Core-prebuilt.',
  },
  {
    name: 'RCT_TESTONLY_RNCORE_VERSION',
    value: null,
    why: 'rncore.rb:47 overrides the prebuilt React Native core version.',
  },
  {
    name: 'RCT_DEPS_VERSION',
    value: null,
    why: 'rndependencies.rb:106 overrides the prebuilt third-party version.',
  },
];

/**
 * The environment to hand a `pod install`, plus anything this machine disagrees
 * with the committed lock about.
 *
 * Two decisions, deliberately different:
 *
 * - A variable the lock resolves *unset or to its documented default* is
 *   **written**, when the caller has not set it. On a machine that matches the
 *   lock this changes nothing - React Native would have chosen the same value -
 *   which is what makes a CI run and a maintainer run agree by construction
 *   rather than by luck, and it states the contract in this repo instead of
 *   inheriting it from a gem's source.
 * - A variable a person *has* set is **kept and reported**, never overridden.
 *   `RCT_USE_PREBUILT_RNCORE=0` in a shell is somebody debugging a source
 *   build; silently clearing it would make `pod install` lie about what it was
 *   asked to do. What they get instead is the name, the line that reads it and
 *   the fact that their next lock diff will be large - with the churn guard in
 *   `sync-example-lock.mjs` as the backstop if they ignore it and are on the
 *   release path.
 *
 * Note what is deliberately *not* here: `CI`, which CocoaPods reads only for
 * interactivity and repo-update chatter (`UI.interactive?`) and which
 * `installPods` already defaults to 1 - it was a candidate for this bug and is
 * not it; and `NODE_BINARY`, which reaches podspecs only as the literal string
 * `$NODE_BINARY` inside a script phase, never expanded, so its value cannot
 * move a checksum.
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
    if (current === undefined || current === '') {
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

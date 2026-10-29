# X13 review — the release's Podfile.lock refresh churns every pod on the CI runner

**Branch:** `task/X13-release-lock-refresh` at `2bfdb05` (base `f818ea0`) · **Reviewer:** read-only, Node 24 jest only

## Verdict: MERGE WITH FIXES

The root cause is right and fully proved, and the release workflow change will take effect.
The churn guard is untouched. Two small correctness bugs in the new probe need fixing first.
The style reader can call an unknown format "compact", so it fails open (M1). The probe also
runs from a temp directory, not from the directory the install runs in (M2). Each fix is
about one line plus a test, so neither needs a full fix round.

## What I verified

- **Root cause (supported, and the whole cause).** I read the CocoaPods 1.17.0 source on
  this machine:
  - `command/ipc/spec.rb:24` is `output_pipe.puts(spec.to_pretty_json)`;
  - `sandbox.rb:299` stores path pods with `podspec.to_pretty_json`;
  - `specification/json.rb:15` is `JSON.pretty_generate(to_hash) << "\n"`;
  - `specification.rb:690` is `sha1(File.read(defined_in_file))`.

  ruby/json CHANGES.md has 2.7.0 "Always indent even if empty" and 2.8.0 "no longer includes
  newlines inside empty object and arrays". I checked both versions locally:
  - json 2.3.0 (rbenv 2.7.6) prints `"x": [\n\n    ]`;
  - json 2.18.0 (Homebrew 4.0.5) prints `"x": []`.

  So the "< 2.8.0" boundary in the message is right for the C extension. It is the *whole*
  cause because of the fixture arithmetic. Re-serialising the Mac's stored specs reproduces
  CI's checksums for all 87. The 8 unchanged pods (96 − 87 − NitroUi) are exactly the ones
  with no empty collection, so nothing is left to explain. The run log matches: 87 `+ Pod:`
  lines, Ruby 3.3.9 from ruby-builder, and `pod _1.17.0_`.
- **The json pin takes effect.** CI runs `pod _1.17.0_`, a RubyGems binstub, not
  `bundle exec`. `algoliasearch-1.27.5` (from cocoapods-core) declares `json >= 1.5.1`.
  - With two installed versions (default 2.7.2 and 2.18.0), `activate_dependencies` leaves
    the choice unresolved (`specification.rb:1423-1431`).
  - The later `require 'json'` goes through the default-gem branch of `kernel_require.rb`.
  - That branch calls `gem 'json', '>= 0.a'`, and `Dependency#to_spec` takes the highest
    version, 2.18.0.

  Installing before cocoapods is harmless. The pin is exact (`-v 2.18.0`); json 2.18.0 needs
  Ruby ≥ 2.7 and builds a C extension, which the macOS runner can do. Nothing else in
  `release.yml` uses Ruby. `pack`/`stage`/provenance are separate jobs, and
  `changesets/action` and `lock:check` are Node. If the pin somehow doesn't take, the
  preflight probe refuses before `changeset version`, so a failed pin can't corrupt anything.
- **Probe and refusals.** Preflight asks before `changeset version`. The witness test proves
  it, and mutation C (removing the preflight refusal) turned 1 test red.
  - `--fix` asks before `treeState()`/`installPods`. Mutation E (removing that refusal)
    turned 1 test red.
  - `installPods({strict:true})` returns before spawning `pod install`.
  - The probe writes only under `os.tmpdir()` and removes it in `finally`. I ran the
    canary by hand: 0.39 s, prints `"react-native-nitro-ui": []`, and the temp dir held only
    the canary.
  - A null style refuses.
- **Churn guard not weakened.** `example-lock-core.mjs` is not in the diff. Mutation D
  (allowing any `Pod: sha` line) turned 2 tests red.
- **Tests.** pod-serialisation, example-lock and pod-install: 63/63 green under Node 24.
  Mutation B (compact regex tested first) turned 5 red. Mutation A (ignoring the probe's
  exit status) **stayed green** (N2). I reverted every mutation with `git checkout -- .`,
  and the tree is clean.
- **Env contract citations.** I spot-checked `react_native_pods.rb:116-117`, `codegen.rb:24`,
  `RNReanimated.podspec:10`, `RNWorklets.podspec:18`, `utils.rb:310` and
  `rndependencies.rb:72`; all are accurate. The pins are no-ops relative to RN's own
  defaulting (line 116/117: anything but `'0'` becomes `'1'`).
- **Gates.** `gate.mjs need --for review` passes: check, harness:ios and harness:android are
  green on this tree.

## Must fix

**M1. `scripts/pod-install-lib.mjs:186`: the compact regex accepts formats that are not `[]`,
so an unknown style counts as agreement.**
`/:\s*\[\s*\]/` lets `\s*` match newlines and spaces. `emptyArrayStyleOf('"d": [\n    ]')`,
`'"d": [ ]'` and `'"d": [\n]'` all return `"compact"`; I checked this under Node 24.
- **Failure scenario:** a json/Ruby (json_pure, JRuby, a future json) renders an empty array
  as `[\n  ]`. Preflight answers "serialises the way the lock was written" and lets
  `changeset version` bump the tree. `pod install` rewrites every path-pod checksum, and only
  the churn guard stops it, after the bump — the half-versioned-tree outcome the preflight
  exists to prevent.
- **Contradicts:** the report's "Unknown is never agreement" and the function's own doc. The
  `'a different way again'` branch (line 204) can never be reached.
- **Fix:** match the exact bytes, e.g. `/:[ \t]*\[\]/`. Add `[\n    ]`, `[ ]` and `[\n]` to
  the "says unknown" test (`pod-serialisation.test.js:180`).

**M2. `scripts/pod-install.mjs:103-110`: the probe runs with `cwd` set to a fresh temp
directory, not the Podfile directory the install runs in.**
- **Failure scenario 1:** with `COCOAPODS_BIN='bundle exec pod'`, the probe can't find a
  Gemfile (I confirmed `bundle exec pod --version` from a temp dir exits 10, "Could not
  locate Gemfile"). The style comes back null on every machine. That override is documented
  at `pod-install.mjs:21` and used by `scripts/smoke/rn-cli.sh:43`. `--preflight`/`--fix`
  then refuse unconditionally on a correctly set-up machine. Every rn-cli smoke install
  prints "the probe could not be read".
- **Failure scenario 2:** an rbenv/asdf `.ruby-version` near the app selects a different
  Ruby (and json) from the global one. The probe measures the global Ruby while the install
  uses the local one, so the probe can say compact while the install writes expanded. That
  is the very disagreement `resolvePodCommand`'s doc says it exists to prevent.
- **Fix:** write the canary to the temp dir but spawn with `cwd: <the Podfile dir>` and the
  absolute podspec path. Pass that dir into `probeSerialisationStyle`. Give the example-lock
  fake pod a variant that fails `ipc spec` unless `$PWD` holds a `Podfile`, so the test goes
  red without the fix.

## Non-blocking

**N1. `.github/workflows/release.yml:287`: nobody ran the fixed CI configuration (Ruby 3.3.9
plus gem json 2.18.0).** The "only NitroUi's two lines" proof ran under Ruby 4.0.5. The
arithmetic proof and RubyGems activation make it very likely to work, and preflight fails
closed if not. But `gem list json` shows what is *installed*, not what loads.
- **Scenario:** a later image or setup-ruby change preloads json. The run then fails at
  preflight with no line in the pin step saying why.
- **Fix:** replace `gem list json` with
  `ruby -rjson -e 'v = JSON::VERSION; puts v; exit(v == "2.18.0" ? 0 : 1)'`, which uses the
  same default-gem activation path `pod` takes.

**N2. `scripts/pod-install.mjs:112`: the `result.status !== 0 → null` path has no test.**
Mutation A (deleting the line) left all 63 green. No end-to-end test has a fake pod that
fails or prints garbage for `ipc spec`, so nothing checks that preflight refuses on an
unreadable probe. Only the pure `podSerialisationProblem({style:null})` is tested.
- **Scenario:** an erroring `pod` that prints a partial spec containing `[]` would pass.

**N3. Follow-up line 86 of the report is partly wrong.**
- `smoke.yml` never touches `example/ios/Podfile.lock`. It runs `pod-install.mjs --dir
  $APP/ios` on generated consumer apps (`scripts/smoke/expo.sh:39`, `rn-cli.sh:44-46`).
- `ci.yml`'s `harness-ios` is `workflow_dispatch`-only and uses `bundler-cache: true` in
  `example/`. Its json is whatever Bundler resolves, probably ≥ 2.8, so "churns the same
  way" is unverified.
- The real side effect of this diff is different. Every consumer-app install (smoke) on
  Ruby 3.3 now warns that "installing here would rewrite `example/ios/Podfile.lock` across
  almost every pod", about an app that has nothing to do with that lock. The "pinned …
  values `example/ios/Podfile.lock` resolves with" line has the same problem.
- **Suggestion:** only probe and report when `dir` is the example's iOS dir, or make the
  message lock-neutral. Correct the follow-up.

**N4. `scripts/pod-install-lib.mjs:326`: `''` is treated as unset, but the cited podspecs test
Ruby truthiness.** `ENV['IS_REANIMATED_PROFILING'] ? …` and `ENV['USE_FRAMEWORKS'] != nil`
both treat `''` as set.
- **Scenario:** `IS_REANIMATED_PROFILING=` passes with no deviation reported, yet adds
  `-DREANIMATED_PROFILING` and moves RNReanimated's checksum.
- The contract also misses `RCT_IGNORE_PODS_DEPRECATION`, which `react_native_pods.rb:112`
  treats exactly like `RCT_SKIP_CODEGEN=1`. Low impact: it only affects the reporting, and
  the churn guard backstops the release.

**N5. `scripts/__tests__/pod-serialisation.test.js:248`: the test title says "clears the
profiling and local-artifact switches", but the body asserts they are *kept* and reported.**
Rename it to say so.

**N6. `scripts/pod-install.mjs:107-111`: the probe's `spawnSync` has no `timeout`.** A `pod`
that hangs (plugin prompt, broken Ruby) hangs preflight until the job's 30-minute limit.
`--fix` also probes twice (`sync-example-lock.mjs:271`, then `installPods` strict at
`pod-install.mjs:234`), which is harmless but redundant.

## Premises

- "87 of 96 checksums moved": it is 87 non-NitroUi checksums plus NitroUi's own, so 88 of 96
  lines changed. The 8 unchanged pods match the commit message. This is wording only.
- "Splicing NitroUi's lines is rejected because its checksum is environment-dependent" is
  sound, since NitroUi is also a path pod whose stored spec contains empty arrays.

---

**Verdict: MERGE WITH FIXES**

- M1 `pod-install-lib.mjs:186` — the compact regex `\s*` accepts `[\n  ]` and `[ ]`, so an unknown style reads as agreement; match `[]` exactly and add those cases to the unknown test.
- M2 `pod-install.mjs:103-110` — the probe runs in a temp cwd, so `bundle exec pod` (COCOAPODS_BIN, rn-cli smoke) always reads null and a directory-local `.ruby-version` is measured wrong; run it with `cwd` set to the Podfile dir.
- N1 `release.yml:287` — the Ruby 3.3 + json 2.18.0 configuration never ran; assert `JSON::VERSION` via `ruby -rjson` instead of `gem list json`.
- N2 `pod-install.mjs:112` — the probe's exit-status check is untested (mutation stayed green); add an end-to-end test with a failing or garbage `ipc spec`.
- N3 report Follow-ups — the ci.yml/smoke.yml churn claim is partly wrong; smoke consumer installs now get a misleading example-lock warning.
- N4 `pod-install-lib.mjs:326` — `''` counts as unset but Ruby treats it as set; `RCT_IGNORE_PODS_DEPRECATION` is missing from the contract.
- N5 `pod-serialisation.test.js:248` — the test title says "clears" but the body asserts the switches are kept.
- N6 `pod-install.mjs:107` — the probe has no spawn timeout, and `--fix` probes twice.

# T01 — Review

Reviewer pass over `task/T01-scaffold` (`git diff main..HEAD`, commits `3fe8c88`, `c895c29`).

**Verdict: APPROVE-WITH-FIXES.** Brief items 1–8 are done, and the deviations (Metro port,
clock base, `xcode-27` label, harness jobs in `ci.yml`, harness patch, no api-extractor) are
justified. Nothing blocks merge. Fix SHOULD-FIX #1–#3 before T02, T03 and T10 run in parallel.
#4–#8 can go with T01 or into the next task's brief.

## What I verified

- `bun run check`: PASS (8.4 s). The working tree was clean before and after the run.
- `node scripts/patch-nitrogen.mjs` with no views: prints "nothing to do" and exits 0.
- The patch fixture `scripts/__tests__/fixtures/basic/.../HybridNitroUiComponent.cpp` is real
  nitrogen 0.37.1 output. It is byte-identical to the spike's pre-patch view file, apart from
  the spike's extra props. Patched output equals the spike's working patch. The anchor and
  idempotency logic match `docs/research/spike-artifacts/patch-nitrogen.mjs` and add stricter
  checks (marker without call, missing include anchor). The patch should work for the T10 view.
- `android/build.gradle` is identical to the spike's (Compose plugin keyed to
  `rootProject.ext.kotlinVersion`, BOM, `jsRootDir` fix). The podspec only changes the repo
  URL. CMake adds `../cpp` sources, and `include_directories("../cpp")` resolves the compat
  header.
- The consumer surface looks right: exports/main/types, `type: commonjs` (bob writes
  `lib/module/package.json` as `type: module`), peers, and `files`. The 43-file manifest
  contains no `patches/`, `example/`, `docs/`, `scripts/` or `eslint-rules/`. The
  `patchedDependencies` field ships in `package.json`, but bun only honors it in the root
  project, so it does nothing for consumers.
- All pinned action SHAs I checked resolve to the tags in their comments (`git ls-remote`):
  setup-ruby v1.264.0, react-native-harness v1.6.0, setup-bun v2.2.0. The harness action
  runs the project's installed CLI, so the bun patch applies in CI too.
- Hygiene: no secrets. No absolute paths in committed files outside `AGENTS.md` (from main)
  and the task-specific AVD default (NIT). No spike `x` or `Test` identities. Both commits are
  authored `Daniel Williams <me@dannyhw.com>`. Large files are the usual template artifacts
  (`bun.lock`, `Podfile.lock`, wrapper jar, debug keystore).

## BLOCKING

None.

## SHOULD-FIX

1. **Lefthook installs hooks into the shared git dir of every worktree** (`lefthook.yml:1-15`,
   `package.json:94`, report "Lefthook side effect").
   - **Why:** any `bun install` in any worktree (T02, T03, T10) rewrites
     `~/Developer/oss/nitro-ui/.git/hooks/*`. bun trusts lefthook's postinstall by default.
     The hooks then run `npx eslint` / `npx tsc` in the main checkout, which has no
     `node_modules`. `npx tsc` without a local typescript fetches the bogus `tsc` package,
     so orchestrator commits and merges on main fail or slow down. Hooks also point at
     whichever worktree installed last, and break when that worktree is removed.
   - **Fix:** make hooks opt-in:
     - add `"trustedDependencies": []` (or a list without lefthook) to block the auto-install;
     - add `"hooks:install": "lefthook install"`;
     - switch the hooks to `bunx`;
     - document it in CONTRIBUTING.

2. **`harness-ios` CI will fail at "Setup Ruby"** (`.github/workflows/ci.yml:140-144`).
   - **Why:** `ruby/setup-ruby` without `ruby-version` needs a `.ruby-version`,
     `.tool-versions` or `mise.toml` in `working-directory: example`. None exists, so the
     action errors out ("input ruby-version needs to be specified..."). Every reference repo
     (nitro, nitro-input, nitro-zxing) passes `ruby-version` explicitly. The template's job
     just ran `bundle install` on the system Ruby.
   - **Fix:** add `ruby-version: '3.3'` (or commit `example/.ruby-version`).

3. **`release.yml` cannot publish with trusted publishing** (`package.json:179`
   `release-it.npm`).
   - **Why:** release-it's npm plugin runs `npm whoami` in `init()` unless
     `npm.skipChecks` is set (`node_modules/release-it/lib/plugin/npm/npm.js:40-77`). With
     OIDC there is no token, so on CI it throws "Not authenticated with npm" before
     publishing.
   - **Fix:** set `"npm": { "publish": true, "skipChecks": true }`. Optionally also run
     `bun run check` in `release.yml` before `release-it`.

4. **The `patch-nitrogen.mjs` entry guard silently no-ops in some paths**
   (`scripts/patch-nitrogen.mjs:114-117`).
   - **Why:** `import.meta.url === \`file://${process.argv[1]}\`` is false when the path
     contains a space, `#`, `%` or non-ASCII characters, because the URL is percent-encoded.
     I reproduced it under `/tmp/t01 review space/`: the changed-shape fixture exited **0**
     with no output. So both the patch and the hard-fail vanish, and `bob build` (which
     cleans and regenerates `nitrogen/`) would ship unpatched views from such a checkout.
     `nitrogen:check` (which imports the function) and the release `git diff` would catch
     it, but the guarantee the brief asked for ("must hard-fail") does not hold there.
   - **Fix:** use
     `import.meta.filename === realpathSync(process.argv[1])` or
     `fileURLToPath(import.meta.url) === resolve(process.argv[1])`. Node 24 also has
     `import.meta.main`.

5. **`no-optional-view-props` has realistic false negatives** (`eslint-rules/index.js:172-210`).
   I confirmed these with eslint on a probe `src/**/*.nitro.ts`:
   - indirect props: `interface Base extends HybridViewProps {}` then
     `interface SwitchProps extends Base { label?: string }`. A shared base for control props
     is a likely T10+ pattern.
   - type aliases: `type P = HybridViewProps & { tint?: string }`.
   - qualified names: `extends N.HybridViewProps`. typescript-eslint gives a
     `MemberExpression` here, so the `TSQualifiedName` branch (which also checks `.left`
     instead of `.right`) is dead code.

   **Fix:** in spec files, collect the first type argument of every `HybridView<P, M>`
   reference and resolve local interfaces and aliases transitively. Simpler alternative: ban
   `?:` in every interface or type literal in `*.nitro.ts` except ones extending
   `HybridViewMethods` or `HybridObject`. Add RuleTester cases for all three.

6. **Nitrogen scans the whole repo for specs** (`nitro.json:18`, `scripts/nitrogen-check.mjs:51-60`).
   - **Why:** `ignorePaths` is only `["node_modules"]`, and the base dir is the repo root.
     T02's private `BenchProbe` `*.nitro.ts` under `bench/` would be generated into the
     **library's** `nitrogen/generated` and autolinking.
   - **Fix:** set `ignorePaths: ["node_modules", "example", "bench", "lib", "scripts"]` now,
     or point nitrogen at `src` (`nitrogen src`) in both `package.json:nitrogen` and
     `nitrogen-check.mjs`.

7. **Root configs are not ready for `bench/` (T02).**
   - `tsconfig.json` has no `include`, so `tsc` typechecks `bench/**` with library settings.
   - `tsconfig.build.json:3` excludes only `example` and `lib`, so bob would emit
     `lib/typescript/bench/**`.
   - Jest `testPathIgnorePatterns` and `modulePathIgnorePatterns` (`package.json`) cover
     only `example`.
   - The ESLint ignores (`eslint.config.mjs:21-37`) lack `bench/` build, Pods and android
     outputs, and `example/vendor/`. Flat config does not read `.gitignore`.

   **Fix:** add `bench` alongside `example` in each place, or hand these lines to T02
   explicitly.

8. **The harness default device is task-specific and selected by name**
   (`example/rn-harness.config.mjs:34`, `CONTRIBUTING.md:132`).
   - The default AVD `nitroui_t01` is a T01 artifact. The research used `Pixel_9` / API 36,
     and CI caches an AVD under this name.
   - `appleSimulator('iPhone 17', '27.0')` picks by name. Parallel tasks with different
     UDIDs in their briefs would all grab the same "iPhone 17".

   **Fix:** use a neutral default (`nitroui`), and document that each task sets
   `IOS_SIM`/`AVD` to a uniquely named device plus `METRO_PORT`.

## NIT

- `CONTRIBUTING.md:70`: ViewProps fix is nitro#1655/#1656, not "#1184/#1655" (#1184 is the null-props crash).
- `CONTRIBUTING.md:153`: rule is "no `callback(...)` call inside a JSX attribute", not "`callback={...}`".
- `eslint-rules/index.js:25-85`, `no-inline-callback-in-jsx`:
  - It reports twice when the call sits in nested JSX inside an attribute (`render={() => <X onD={callback(fn)} />}`).
  - It misses aliased imports (`import { callback as cb }`), `{...{ onX: callback(fn) }}`, and `const c = callback(fn)` in the render body.
  - Document these as known gaps, or bind to the `callback` import from `react-native-nitro-modules`.
- `eslint-rules/index.js:92`: the first regex in `isSpecFile` is subsumed by the second.
- `scripts/patch-nitrogen.mjs:37`: the JSDoc status union lacks `'error'`.
- `package.json:48`: research §6 says `publint --strict`. Clean today, but without `--strict` future warnings won't fail the gate.
- `scripts/nitrogen-check.mjs:98`: compares the working tree, including untracked files, so a stray `.DS_Store` under `nitrogen/` gives a false "stale" error. Consider `git ls-files nitrogen/` or skipping dotfiles other than `.gitattributes`.
- `.github/actions/setup/action.yml:22`: the node_modules cache key ignores `patches/**`. bun.lock records only the patch path, so editing the patch can restore a stale node_modules.
- `turbo.json:3`: references `.yarnrc.yml`, and turbo is no longer used by CI. `package.json:169` `dependenciesMeta` is a Yarn-ism. `example/README.md:17` mentions yarn. `example/jest.config.js` is a leftover (noted in the report).
- `package.json:25`: `files` lists `react-native.config.js`, which doesn't exist, and `ios/` is an empty untracked dir. Both are harmless; T10 creates `ios/`.
- `CODE_OF_CONDUCT.md:63`: still `[INSERT CONTACT METHOD]`.
- `lefthook.yml`: `npx tsc` runs a full typecheck on every commit. Fine, but slow once `bench/` exists.

## Notes for T10 / T02 / T03

- **T10:**
  - Return the generated `Hybrid<X>Manager()` from `NitroUiPackage.createViewManagers`; it is empty today.
  - Add a `nitro.json` `autolinking` entry per view.
  - Run `bun run manifest:update` (json configs and Swift/Kotlin files join the tarball).
  - The `./nitrogen/generated/shared/json/*` export was dropped. That is fine for relative imports from `src/`, but re-add it if anything imports the config by package path.
  - Expect `nitrogen:check` to report "1 view(s) patched".
- **T02:** SHOULD-FIX #6 and #7 apply directly. Keep `bench` hoisted on the same RN 0.88 to avoid the duplicate-RN problem (harness #215).
- **T03:** `npm pack` runs `prepare`, which cleans and regenerates `nitrogen/`. Run smoke from a path without spaces until SHOULD-FIX #4 lands. `manifest:check` needs `lib/` built first.
- **Clock question:** I agree with the implementer that `steady_clock` (`CLOCK_UPTIME_RAW` / `CLOCK_MONOTONIC`) is the right base for Choreographer and CADisplayLink alignment, not `elapsedRealtimeNanos`.

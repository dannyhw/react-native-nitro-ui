# X13 — The release's Podfile.lock refresh churns every pod on the CI runner

**Branch:** `task/X13-release-lock-refresh` (from `main` at `f818ea0`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `X13-u1t66` (pair-b: `iPhone Air` 27.0 / `emulator-5570` `nitroui_b` / Metro `8293`)

## Summary

**Root cause: the `json` gem's `JSON.pretty_generate` renders an empty collection
differently before and after 2.8.0, and that text is what every `SPEC CHECKSUMS`
entry hashes.** `Pod::Specification#checksum` is
`Digest::SHA1.hexdigest(File.read(defined_in_file))` (`cocoapods-core/specification.rb:690`);
for a pod pulled `from:` a path, `defined_in_file` is
`Pods/Local Podspecs/<Name>.podspec.json`, which CocoaPods writes with
`to_pretty_json` → `JSON.pretty_generate(spec.to_hash)` (`specification/json.rb:18`).
json 2.7.0 added "Always indent even if empty"; 2.8.0 removed it again. So
`s.dependency 'React-cxxstableapi'` — version-less, as RN and most third-party pods
declare dependencies — serialises as `"React-cxxstableapi": [\n\n]` on the runner and
`[]` on a Mac. Two bytes of whitespace per dependency. The runner had Ruby 3.3.9
(json 2.7.2); the maintainer Macs run Ruby 4.0.5 (json 2.18.0). `CI`, `RCT_USE_RN_DEP`,
`USE_FRAMEWORKS`, `NODE_BINARY` and the checkout path were each ruled out: none reaches
a checksum. `NODE_BINARY` never even reaches a podspec — it stays literal `$NODE_BINARY`
inside a script phase.

**Decision: measure the format, not the version.** `pod-install.mjs` asks
`pod ipc spec` one version-less dependency and reads the answer (0.3 s, writes nothing,
the same `to_pretty_json` the checksum hashes). Unknown is never agreement. The churn
guard is untouched, and splicing only NitroUi's lines is rejected: its own checksum moves
too (`4a89200d…` vs `cf666c99…`), so it is not environment-independent. `release.yml`
pins `gem install json -v 2.18.0` before CocoaPods; `podInstallEnvironment` states the
prebuild defaults and *reports rather than overrides* anything a person did set.
`--preflight` now asks the serialisation question too, so `release:version` refuses before
`changeset version` bumps.

**Local proof, no pushes.** A scratch copy under the runner's own Ruby 3.3.9 + CocoaPods
1.17.0 reproduced **87 of the 87** checksums CI printed, byte for byte (89 changed lines:
87 checksums plus NitroUi's allowed version line); the same tree on this Mac's json 2.18.0
leaves **exactly** NitroUi's two lines changed after a bump to 0.3.2. `pod-serialisation.test.js`
re-derives both checksums per fixture pod from the stored file, so the mechanism is asserted,
not narrated.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1135 tests / 43 suites | `f5358952127f` | 3 m 01 s | start 3.7 / med 5.8 / max 28.4 |
| `harness:ios` | **PASS** | 168 tests / 13 suites | `f5358952127f` (ios tree) | 2 m 15 s | start 67.3 / med 26.4 / max 67.3 |
| `harness:android` | **PASS** | 217 tests / 13 suites | `f5358952127f` (android tree) | 6 m 18 s | start 16.7 / med 6.1 / max 16.7 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

`need --for review`: `✓ check`, `✓ harness:ios`, `✓ harness:android`; `real-input:*` are
deliberately left for merge (AGENTS.md: the full harness plus real-input runs once, at
merge). `scripts/pod-install*.mjs` are outside the platform prefixes, so `need` counted
them as both platforms — correct, since every device build runs `installPods`.

## Red proofs

- `pod-serialisation › reproduces the runner checksum` -> old json's renderer stops expanding (`return '[]'`) -> `Expected: "f9dd5e5a…" Received: sha1 of compact text` (3 tests red)
- `pod-serialisation › refuses an unreadable probe too` -> `style == null` treated as agreement -> `expect(problem).not.toBeNull()`
- `pod-serialisation › says unknown rather than guessing` -> `emptyArrayStyleOf` falls through to `compact` -> `expect(emptyArrayStyleOf("")).toBeNull()`
- `pod-serialisation › refuses the style that churns` -> contract flipped to `expanded` -> `expect(problem).toContain("SPEC CHECKSUMS")`
- `pod-serialisation › pins the json gem` -> `gem install json -v 2.18.0` removed from `release.yml` -> workflow regex
- `pod-serialisation › does not carry a source-build … / clears the profiling …` -> pins overwrite what the person set, report dropped -> `expect(deviations.map(d => d.name)).toEqual([...])`
- `what this task must not have weakened › still allows only NitroUi …` -> churn guard also allows any pod's checksum line -> `expect(churn).toContain("changed beyond NitroUi")` (+ `refuses a lock whose diff is bigger`, 2 red)
- `example-lock › refuses a refresh on a machine whose json gem …` -> `--fix`'s serialisation refusal removed -> `expect(out.status).toBe(1)`
- `example-lock › refuses at preflight … before changeset version` -> `--preflight`'s question removed -> `expect(repo.exists("changeset-ran")).toBe(false)`
- `example-lock › refuses the install itself when strict` -> `installPods` warns but proceeds -> `expect(out.stdout).toContain("STATUS 1")`. Worth noting: this test had to be **written** — mutations 1 and 2 stayed green under it and vice versa, because `--fix`/`--preflight` both ask before reaching `installPods`.

**Live proofs (not mutations).** Runner's Ruby + CocoaPods 1.17.0 in a scratch tree:
`--preflight` exits 1 and leaves the tree clean; `--fix` exits 1 and leaves the lock
untouched; bypassing the guard and running `pod install` directly churns 87 checksums, all
87 equal to CI's; the same tree on json 2.18.0 produces only NitroUi's two lines.

## Files changed

- `scripts/pod-install-lib.mjs` — `POD_INSTALL_CONTRACT` (each variable named at the line that reads it), `podInstallEnvironment`, `emptyArrayStyleOf`, `podSerialisationProblem`, `SERIALISATION_CANARY_PODSPEC`, `PINNED_JSON_GEM`.
- `scripts/pod-install.mjs` — `probeSerialisationStyle`, `resolvePodCommand`, `podSerialisationCheck`, `strict` on `installPods`.
- `scripts/sync-example-lock.mjs` — `--preflight` and `--fix` both refuse before touching the tree.
- `.github/workflows/release.yml` — json pin, plus why there is no separate style step.
- `scripts/__tests__/pod-serialisation.test.js`, `…/fixtures/x13-json-empty-array/` — 21 tests over the three stored podspecs CI churned.
- `scripts/__tests__/example-lock.test.js` — fake pod answers `ipc spec`; three new end-to-end refusals.
- `.prettierignore` — the fixtures are byte-exact stored podspecs; reformatting them would make the sha1 proof false.

## Follow-ups

- `ci.yml` / `smoke.yml`: their `pod install` (via `build-app.mjs`) churns the working-tree lock the same way; nothing checks that file's cleanliness today, and the next maintainer's `pod install` writes it back. `installPods` warns, which is the intended non-blocking behaviour for builds.
- `pod-install-lib.mjs`: if a future json changes the style again, the probe reports "a different way again" and every macOS job refuses until `EXPECTED_EMPTY_ARRAY_STYLE` is revisited — correct, but unpractised.
- `scripts/pod-install.mjs`: `example/Gemfile`'s `concurrent-ruby < 1.3.4` and friends are a second, unenforced environment contract that could move a checksum someday; only json is pinned.
- `.github/workflows/release.yml`: the json pin and `ruby-version: '3.3'` are maintained separately from `ci.yml`'s Ruby; a shared `env:` or composite action would keep them from drifting.

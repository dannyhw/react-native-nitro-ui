FIX ROUND

# FIX14 review — task/FIX14-android-icon-url-spaces at 781a0225

The quoting itself is right, and nothing that drew before changes. One M: the new example icon gets past the provenance check that exists to catch exactly this kind of file. Fixing it means editing `scripts/`, which is outside the brief, so the orchestrator has to choose how (see the end).

`node scripts/gate.mjs check` was run once in the foreground: PASS, 18/18, 70.1 s (no lease was in use by real-input:ios). PR #105 has no inline CodeRabbit comments, only its summary.

## Findings

1. **M. The fixture is outside every folder the provenance check scans, and the README gives the wrong path for it.**
   - `example/src/assets/icons with a space/star_24px.xml` sits beside `icons/`, not inside it.
   - `scripts/__tests__/android-icons.test.js:13-17` (`EXAMPLE_ICON_DIRS`) lists `example/src/assets/icons` and the two `res/drawable*` folders. Line 267 reads each one with a flat `readdirSync`.
   - The file has no entry under `exampleFiles` in `scripts/icons/material-symbols.lock.json` and none in `EXAMPLE_FIXTURES`. No digest or pinned URL protects it.
   - Today the bytes match `icons/star_24px.xml` (`cmp` is clean), so the artwork is the official file. But someone could hand-edit it and `check` would stay green.
   - `example/src/assets/icons/README.md:12` lists it as `icons with a space/star_24px.xml` in a table of files in `icons/`. That points to `icons/icons with a space/`, which does not exist.
   - `README.md:14-19` still says the check fails on any `.xml` the fetch script did not write. That is now false for this file.
   - The report's "one folder deeper", repeated in `MetroIconPath.android.harness.tsx:47`, is also wrong: the folder is a sibling.
   - Fix: add a fetch target with `out` set to this path in `scripts/icons/fetch-material-symbols.mjs`, rerun it so the lock records the URL and sha256, and add the folder to `EXAMPLE_ICON_DIRS` (or scan with the file's own `walk()`). Correct the README row.
   - Moving the file under `icons/` does not fix it: a subfolder is never read, and a spaced file name sitting directly in `icons/` still needs a lock or fixture entry.

2. **N. Matches Metro on every point checked.**
   - `AssetSourceResolver.assetServerURL` builds the URL by joining strings, and Metro's `Assets.js` copies `httpServerLocation` from the path. So spaces, `#` and `%` arrive raw, as the harness premise check confirms.
   - `metro/src/Server.js:424-428` (0.87.1) decodes the path one `/`-segment at a time with `decodeURIComponent`. So `%23` gives back `#` and `%25` gives back `%`. Quoting per segment is the exact inverse.
   - The query passes through unchanged: `&`, `=` and `+` are in `SUB_DELIMS`, `/` and `?` are in `QUERY_EXTRA`, and an existing `%XX` is copied.
   - RN never adds a `#` fragment, and Metro's hash is hex.
   - Every `Url` source matches `^scheme://` (`NitroUiIcon.kt:155,165`). A `content://` URL fails in `toURL()` exactly as before.

3. **N. Nothing that drew before changes.**
   - `NitroUiIconUrl.kt:111-114` allows the same raw ASCII set that `java.net.URI` accepts in a path or query, so any ASCII URL `URI(url)` accepted comes out byte-identical.
   - `anOrdinaryUrlIsRequestedExactlyAsMetroWroteIt` asserts that for one `10.0.2.2:8081` URL. It compares against the input rather than `URI(url).toString()`, which is the same string.
   - Two behaviour changes are worth one doc line in `docs/components/button.md` and the changeset (the report already lists this as a follow-up):
     - A hand-written `uri:` with a real `#fragment` now requests the wrong file (`%23frag`).
     - A folder whose name already looks like an escape (`a%41b`) is still decoded by Metro to `aAb` and returns 404. That was also true before, but the changeset's claim that a folder name holding `%` draws covers only a `%` not followed by two hex digits.

4. **N. Test gaps.** Not covered:
   - an escaped query value (`hash=a%2Bb`) and a raw `+`;
   - `localhost`;
   - a URL with no path (`http://h:8081`);
   - an input without `://` passing through.

   `anOrdinaryUrl…` and `anEscapeMetroAlreadySent…` both pass against the old `URI(raw)`, so the report's mutation never turned them red. They can fail (dropping the `isEscape` branch at `NitroUiIconUrl.kt:70` gives `%2520`), but no red proof was recorded for them.

5. **N. Library check.**
   - Rejecting both alternatives is correct: the multi-argument `java.net.URI` constructors always quote `%`, and `android.net.Uri.encode` does too.
   - OkHttp's `HttpUrl` would keep existing escapes, but it treats `#` as a fragment, resolves `..` segments (which would change the `/assets/../` case) and handles only http(s). Hand-written code is justified.
   - Small simplifications:
     - `indexOfAnyIn` (`:117-122`) is the stdlib's `raw.indexOfAny(charArrayOf('/', '?'), schemeEnd + 3)`.
     - The comment at `:80` claims a lone surrogate "travels as its UTF-8 bytes". In fact `toByteArray` replaces it with `?`, which goes out as `%3F`.

6. **N. Harness case checks out.**
   - The harness's `test-file-platform-filter.js` skips `*.android.harness.*` on iOS as pending (iOS 30 suites vs Android 32, both green).
   - It relies on Metro no more than `Button.harness.tsx:1573` already does with its `url:` assertion.
   - Red proof: the report says the `URI(raw)` mutation was built into the APK and went red with "never drew … hits=0".

7. **N. Hygiene checks out.**
   - `etc/package-files.txt` is right: `android` ships, the new file is under `src/main`, and `manifest:check` passed.
   - The changeset is a patch.
   - No changes under `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/` or the e2e helpers.
   - One author identity, and nothing personal in the diff.
   - The comments follow the AGENTS rules.

## Questions for orchestrator

The fix for M1 is in `scripts/icons/fetch-material-symbols.mjs`, the lock file and `scripts/__tests__/android-icons.test.js`. Those are tooling, which belongs to the audit thread, and outside the FIX14 brief. Options:

- (a) Allow those three files in this task's fix round. Recommended: the change is about 6 lines and keeps the fixture's provenance proven before merge.
- (b) Send the change to the audit thread and merge FIX14 after it lands.
- (c) Drop the harness case and fixture, and rely on the JVM test. This loses the brief's device proof.

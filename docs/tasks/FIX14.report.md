# FIX14 — An Android icon whose file path has a space in it is drawn in development

**Branch:** `task/FIX14-android-icon-url-spaces` (from `main` at `4cf99e54`) · **Round:** 1 of up to 3 ·
**Lease:** `FIX14-8pji7` (`nitroui_b` / `emulator-5570`, `iPhone Air` / Metro android `9293`, iOS `8293`)

## Summary

In development an `androidIcon` the app `require`s is read from the URL Metro writes out of the
asset's own path. That URL is concatenated, not encoded, so an asset in a folder named
`icons with a space` reaches Android with the space still in it — and `URI(url)` refuses the whole
string, so the read fails, the warning fires once and the slot stays empty. Release builds read the
compiled drawable and were never affected.

`NitroUiIconSource.Url` now reaches the network through `NitroUiIconUrl.requestUri`, which quotes the
URL from its parts: the scheme and authority are copied as they stand, so brackets around an IPv6
host survive; the path is quoted one `/`-separated segment at a time; the query, from the first `?`,
is quoted as one unit. A `%` followed by two hex digits is a quote that was already made and is
copied through, so an escaped URL is not escaped twice, and everything else that may not appear raw
goes over as its UTF-8 bytes.

Two decisions behind that shape:

- `java.net.URI`'s multi-argument constructor and `Uri.Builder` both turn `my%20icons` into
  `my%2520icons`, which breaks the brief's "not escaped twice" rule, so the quoting is done per
  segment and the finished string is handed to `URI`. `Uri.Builder` is also unreachable from a JVM
  unit test.
- An icon URL carries no fragment: a `#` is quoted, so it names part of the file, and only the first
  `?` starts the query. That is what makes `c#sharp.xml` reachable, and it is the reading React
  Native used when it wrote the URL. The cost is a hand-written `uri:` with a real `#fragment`,
  which is now asked for with `%23`.

A file that really is missing behaves as before: the request still goes out, a 4xx is still
remembered so the URL costs one request rather than one per frame, and the warning is still one line
per URL. Release builds, drawable names and named Material Symbols are untouched.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2178 tests / 96 suites | `67bec96aa336` | 1 m 01 s | start 23.5 / med 18.1 / max 23.5 |
| `harness:ios` | **PASS** | 611 tests / 30 suites + isolated 6 tests / 3 suites | `67bec96aa336` (harness:ios digest) | 14 m 30 s | start 5.9 / med 8.1 / max 30.0 |
| `harness:android` | **PASS** | 670 tests / 32 suites + isolated 6 tests / 3 suites | `67bec96aa336` (harness:android digest) | 18 m 10 s | start 3.7 / med 4.7 / max 12.7 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:android:MetroIconPath` | **PASS** | 1 tests / 1 suites | `af7fe4d940b2` (harness:android digest) | 7.1 s | start 5.8 / med 6.1 / max 6.4 |

`need --for review`: ✓ check — green · ✓ harness:ios — green on its own digest · ✓ harness:android —
green on its own digest · note: treated as both platforms (outside the known prefixes):
`example/__tests__/MetroIconPath.android.harness.tsx`,
`example/src/assets/icons with a space/star_24px.xml` · need: review is satisfied on this code tree.
`real-input:*` is left for merge, as the brief says.

## Red proofs

- `NitroUiIconUrlTest` (10 tests) -> `requestUri(raw) = URI(raw)`, the behaviour before this change ->
  8 of 10 red, e.g. `aSpaceInThePathIsQuotedAndTheFileIsStillReached FAILED
  java.net.URISyntaxException at NitroUiIconUrlTest.kt:35`; green with the fix, `tests="10"
  failures="0"`.
- Withdrawn in fix round 1: `MetroIconPath.android.harness.tsx › draws an icon whose folder name
  holds a space` did go red against the same mutation built into the APK, but the case and its
  fixture are gone (see `## Fix round 1`), so that proof stands for nothing here.

## Files changed

- `android/src/main/java/com/margelo/nitro/nitroui/NitroUiIconUrl.kt`: the quoter, free of Android
  imports so the JVM test reaches it.
- `android/src/main/java/com/margelo/nitro/nitroui/NitroUiIcon.kt`: `parse` opens
  `NitroUiIconUrl.requestUri(url)`.
- `android/src/test/java/com/margelo/nitro/nitroui/NitroUiIconUrlTest.kt`: the request URL for a
  space, a `#`, a stray `%`, non-ASCII, an already-escaped path, an IPv6 authority and a `file://`.
- Added in round 1 and removed again in fix round 1:
  `example/__tests__/MetroIconPath.android.harness.tsx`, its fixture in a sibling folder named
  `icons with a space`, and the `example/src/assets/icons/README.md` row that pointed at it.
- `.changeset/android-icon-url-spaces.md`, `etc/package-files.txt`.

## Follow-ups

- A device case drawing a `require`d icon from a folder with a space, once
  `scripts/__tests__/android-icons.test.js` reads that folder and
  `scripts/icons/material-symbols.lock.json` records the file. The provenance scan reads
  `example/src/assets/icons` one level deep and the lock knows no sibling folder, so such a fixture
  cannot be shown to be an official file from inside this task.
- FOLLOWUPS G19, second half (`/assets/../..` sent as-is): not settled by this change — `..` is
  legal inside a segment, so the quoter leaves it exactly as `URI` did. Out of scope per the brief.
- `docs/components/button.md`, "Android icons": worth one sentence saying an icon URL has no
  fragment, so a `#` names part of the file. Left out so both device gates stay green on one code
  tree.
- The Gradle daemon this round started is left running: `gradlew --stop` is machine-wide and another
  task is building on this machine.

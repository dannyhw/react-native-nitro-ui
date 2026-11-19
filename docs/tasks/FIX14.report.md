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

Round 1's own runs are in the ledger. The table that stands is the generated one at the end of this
report, under `## Fix round 1`, which covers the branch's final code tree.

## Fix round 1

The provenance check and the Material Symbols lock live under `scripts/`, which this task may not
change, so no folder beside `icons/` can be shown official from here. The device fixture, the harness
case that used it and the README row naming it are gone. The library fix and its JVM test stay; the
device check is a follow-up.

An escaped query value, a raw `+`, a `localhost` host and a pathless URL joined `NitroUiIconUrlTest`
(14 tests). The path-start search is now `indexOfAny`, and the lone-surrogate comment says the encoder
gives a `?`, sent as `%3F`. The changeset and `docs/components/button.md` now say a `#` in a
development path belongs to the file's name, and that a folder already named like an escape
(`icons/a%41b/`) draws nothing; the changeset's `%` claim is narrowed to a `%` no escape starts with.

Red proofs — one build each, one thing broken:

- `anOrdinaryUrlIsRequestedExactlyAsMetroWroteIt`, `anEscapeMetroAlreadySentIsNotSentTwice` -> the
  authority quoted like a path -> 13 of 14 red, `ComparisonFailure at NitroUiIconUrlTest.kt:24` and
  `:52`; against `isEscape(part, at) = false` -> `my%2[]0icons` over as `my%2[52]0icons`.
- `aPlusInTheQueryIsSentAsItWasWritten` -> `+` out of `SUB_DELIMS` -> `hash=a[%2B]b`.
- `anUrlWithNoPathIsRequestedAsItStands` -> the pathless branch returns `"$raw/"` -> `8081[/]`.

`need --for review` asked for `check` and `harness:android` alone; both are green here. The
`MetroIconPath` row names a suite that no longer exists.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2178 tests / 96 suites | `201ffc08b8f5` | 1 m 02 s | start 7.5 / med 8.4 / max 9.3 |
| `harness:ios` | **PASS** (from `task/FIX13-button-group-text-spacing`) | 611 tests / 30 suites + isolated 6 tests / 3 suites | `85cf285d0ecf` (harness:ios digest) | 14 m 26 s | start 11.2 / med 5.8 / max 11.2 |
| `harness:android` | **PASS** | 669 tests / 31 suites + isolated 6 tests / 3 suites | `201ffc08b8f5` (harness:android digest) | 20 m 18 s | start 4.6 / med 5.8 / max 19.4 |
| `real-input:ios` | **PASS** (from `merge/FIX13`) | — | `85cf285d0ecf` (real-input:ios digest) | 44 m 12 s | start 3.8 / med 6.0 / max 17.5 |
| `real-input:android` | missing | — | — | — | — |
| `harness:android:MetroIconPath` | stale | 1 tests / 1 suites | af7fe4d940b2 (not this tree) | 7.1 s | start 5.8 / med 6.1 / max 6.4 |

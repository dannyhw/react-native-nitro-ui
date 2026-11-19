MERGE WITH FIXES

# FIX14 re-review, fix round 1: task/FIX14-android-icon-url-spaces at 078caf3a

**M1 is closed.** The fixture, `MetroIconPath.android.harness.tsx` and the README row are gone.
- `git diff main...HEAD` touches nothing under `example/`. `git grep` finds no `MetroIconPath` or `icons with a space` outside `docs/tasks`. The one hit is a string inside a JVM test.
- `etc/package-files.txt` adds only `NitroUiIconUrl.kt`. `manifest:check` passes.

**`check`** was run once in the foreground (no lease was running real-input:ios): PASS, 18/18, 59.8 s.

**Gate table:** `check` and `harness:android` are green on code tree `201ffc08b8f5`, which is HEAD's code tree. `need --for review` is satisfied.

**`harness:ios` is not owed.** The task no longer touches any harness or example file, so harness:ios has the same inputs as main. `need` says the diff "touches android". The stale `harness:android:MetroIconPath` row is harmless.

**`indexOfAny`** gives the same result in every case. `CharSequence.indexOfAny(CharArray, start)` returns the lowest index of either character at or after `start`, or -1. That is what the min/filter helper returned. `start` is at most `length` because `://` was found.

**New JVM cases** are sound and their expected strings are correct. The red proofs check out:
- `+` removed from `SUB_DELIMS` gives `a%2Bb`.
- The pathless branch returning `"$raw/"` gives `8081/`.
- `isEscape=false` gives `%2520`.
- Quoting the authority turns 13 of 14 red. Only the pathless case returns early, so 13 is right.

**Scope and hygiene:** nothing changed under `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/` or the e2e helpers. There is one author address, nothing personal, and the patch changeset is in place.

**Comments:** the lone-surrogate comment is now true. Java's UTF-8 encoder replaces a malformed char with `?` (0x3F). The comments follow AGENTS.md "Comments".

## New findings

**M2. An explicit `uri` with a `#fragment` now requests the wrong file in every build. The changeset and docs do not say so.** CodeRabbit's inline comment on PR #105 is valid.
- `src/iconSource.ts:218-224,238-240` sends `{uri: 'https://host/star.xml#v2'}` to native as `url:https://host/star.xml#v2`. It does the same in a release build.
- Before this task, `URI(url).toURL()` requested `/star.xml`. Now `NitroUiIconUrl.kt:59` quotes `#`, so the request is `/star.xml%23v2`. That returns a 404, the URL is remembered as rejected, and the icon is blank.
- This breaks brief Behaviour 3 ("Release builds ... unchanged").
- `docs/components/button.md:207-211` and the changeset describe `#` only for a Metro development path.
- Minimum fix: one sentence in the changeset and in button.md, saying a `#` in a `uri` is sent as part of the path.
- Better fix: drop the fragment from an explicit `uri` in `resolveAndroidIconString`, which Metro URLs never pass through. A Jest case for it needs a red proof.

**M3. `docs/components/button.md:208-211` claims too much.**
- It says "a name a file system allows is a name that draws" and "One name stays out of reach".
- A `?` in a folder or file name also fails. `NitroUiIconUrl.kt:47` takes the first `?` as the start of the query, and Metro's own `url.parse` does the same.
- An escape-shaped file name fails too, not only a folder name.
- Fix: name `?` and say "a folder or file whose name...".

**N1.** "is served by Metro under the decoded `aAb`" (button.md:211 and the changeset) is inaccurate. Metro reads the request for `a%41b` as `aAb` and finds nothing; it does not serve the folder at `aAb`. Suggested wording: "Metro reads the request as `aAb`".

**N2.** The red proof for `anOrdinaryUrlIsRequestedExactlyAsMetroWroteIt` turns 13 of 14 tests red, so it does not show what that test alone guards. Removing `=` from `SUB_DELIMS` would be a targeted mutation. `anEscapeInTheQueryIsNotSentTwiceEither` and `aLocalHostName...` are red only under that same broad mutation, or implicitly under `isEscape=false`. All of these tests can fail.

**N3.** The device proof the brief asked for is now a follow-up (fixture provenance in `scripts/`). The report says so.

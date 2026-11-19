# FIX14 — An Android icon whose file path has a space in it is drawn in development

**Kind:** bugfix · **Devices:** android ·
**Budget:** 1.5 h for round one (a small Android fix with a unit test; no device-heavy proof)

## Goal

In development, an `androidIcon` from `require()` draws even when the file's path holds a space or
another character a URL must escape, as it does in a release build.

## Why

`docs/tasks/FOLLOWUPS.md` "G19 review: `URI(url)` throws on asset paths with spaces, so such an icon
draws nothing". In development the icon is fetched from the URL Metro serves, and
`NitroUiIcon.kt` builds it with `URI(url)`, which throws on an unescaped space; the read fails and
the icon is left blank with a warning. A release build reads the bundled resource instead.

## Behaviour

1. A development icon URL whose path holds spaces, `#`, `%`, non-ASCII letters or other characters
   Metro sends unescaped is fetched and drawn. A URL that is already escaped is not escaped twice.
2. The failure warning, the failure memory and the HTTP status handling are unchanged for a file that
   really is missing.
3. Release builds, resource icons and named Material Symbols are unchanged.

## Proof

- A JVM unit test (beside `NitroUiIconSourceTest.kt` or `NitroUiIconTest.kt`) over the URL turned
  into a request: a path with a space, one with `#`, one already escaped, one with non-ASCII; red
  against today's `URI(url)`.
- One device check that a real `require()`d icon in a folder whose name has a space draws in the
  example app on Android (a harness case, or a filtered run of an existing icon harness suite with
  a fixture added), shown red once without the fix.
- `harness:android`, `check` and `need --for review` clean; a patch changeset.

## Out of scope

- The second half of the same FOLLOWUPS line (`/assets/../..` sent as-is), unless the same change
  settles it; say which in the report.
- iOS (it does not fetch Android icons), and the other icon lines in FOLLOWUPS.
- `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/`, and the shared e2e helpers.

## Decided already

- Escape the URL's path per segment from its parts (`java.net.URI`'s multi-argument constructor or
  `Uri.Builder`), never by string replacement of spaces alone.

## Context

`android/src/main/java/com/margelo/nitro/nitroui/NitroUiIcon.kt` (`parse`, `read`),
`android/src/test/java/com/margelo/nitro/nitroui/NitroUiIcon*Test.kt`, `docs/components/button.md`
"Android icons".

# FIX21 — An Android SearchField's default prompt and clear label follow the app's language

**Kind:** bugfix · **Devices:** android ·
**Budget:** 2 h for round one (a small Android fix with a device read; FIX14 took about 1.5 h)

## Goal

On Android, a `SearchField` with no `placeholder` shows "Search…" and names its clear button in the
app's own language, including a per-app language set on Android 13 and later, not in the device's.

## Why

`docs/tasks/FOLLOWUPS.md` "G17 review: `SearchFieldStrings` reads `Resources.getSystem()` once per
process". Checked against `main`: `HybridNitroUiSearchField.kt` (`SearchFieldStrings`) looks up the
framework's `search_hint` and `searchview_description_clear` in `Resources.getSystem()`, which is
the device's configuration, and caches each by `lazy` for the life of the process. An app shown in
another language than the device's, or whose language changes while running, gets the device's
words; the clear button's screen-reader label is one of them.

## Behaviour

1. The default prompt and the clear button's label are read from the field's own context, so they
   follow the configuration the app's views are drawn in, and a configuration change (a new app
   language) is reflected the next time the field draws.
2. A `placeholder` the app passes is unchanged; the English fallbacks stay for a framework that does
   not have the strings.
3. iOS, and the rest of the SearchField, are unchanged.

## Proof

- A device check on Android that reads the default prompt and clear label of a SearchField given a
  context whose configuration names a language other than the device's (for example through a test
  seam that resolves the strings for a given locale, or by mounting under a locale-overridden
  context), and asserts they are that language's strings, not the device's; red against today's
  `Resources.getSystem()` lookup.
- `harness:android` and `harness:ios` green (if the shared harness file changes), `check` and
  `need --for review` clean; a patch changeset.

## Out of scope

- Other SearchField lines in FOLLOWUPS; TextField; iOS strings.
- `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/`, and the shared e2e helpers.

## Decided already

- Resolve through the view's context, not a process-wide cache; a cache keyed by the configuration's
  locale is fine. No new public prop.

## Context

`android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiSearchField.kt` (`SearchFieldStrings`,
its uses at the placeholder and the clear button), `example/__tests__/SearchField.harness.tsx`,
`docs/components/search-field.md`.

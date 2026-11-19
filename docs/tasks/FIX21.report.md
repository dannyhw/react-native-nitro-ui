# FIX21 — An Android SearchField's default prompt and clear label follow the app's language

**Branch:** `task/FIX21-search-field-app-language` (from the tip of
`task/FIX20-search-field-no-suggestions`, `main` at `fd0ba959` + its SearchField fix) ·
**Round:** 1 of up to 3 ·
**Lease:** `FIX21-4cxtu` (`emulator-5570` + `iPhone Air` simulator / Metro `9293` and `8293`)

## Summary

`SearchFieldStrings` read the framework's `search_hint` and `searchview_description_clear` from
`Resources.getSystem()` — the device's configuration — and kept each behind a `lazy` for the life
of the process, so an app shown in another language than the device's, including a per-app language
on Android 13 and later, was prompted in the device's language and gave its clear button a
screen-reader label in the device's language too.

The object now resolves both strings from the `Context` a field draws in: the composition passes
`LocalContext.current`, the clear button takes the label from the same read, and the test state
reports the prompt from the host view's own context. Nothing is process-wide: the cache is keyed by
the configuration's locale list and bounded to eight entries, in the shape `DatePickerFieldText`
already uses, so a language change is picked up by the next draw and one language's answer cannot
overwrite another's. A `placeholder` the app passes still wins, and the English fallbacks stay for a
framework without the strings. iOS and the rest of the field are untouched.

The decision worth reading before the diff: the field's own context decides, not a locale
passed in. The library
never learns the app's language, and a view's configuration is already what the app's views are
drawn in — a per-app language on 13+ arrives there. The cache key is the locale list rather than the
`Resources` identity, because a configuration changes in place.

The device check asks the field's own context through a new probe seam,
`NitroUiProbeModule.searchFieldStrings(localeTag)`, which resolves the strings through
`SearchFieldStrings.forLocale` for the app's configuration, for a German-overridden one, and for the
device's, and reports the three locales. It pins the German pair (`Suchen…`, `Anfrage löschen` — the
values this emulator's `/system/framework/framework-res.apk` carries for `de`, read out with `aapt2`
rather than guessed), asserts they are not the device's, and re-reads both languages to show neither
reading poisoned the other. What it cannot watch on a running emulator is the app restart a per-app
language change causes, so it proves the mechanism — a field reads its own configuration — rather
than the restart. The clear button's label is read as the string the field applies; its name in the
accessibility tree is what `real-input:android` looks at, at merge.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2191 tests / 97 suites | `3da2310e185a` | 1 m 06 s | start 6.3 / med 13.1 / max 14.8 |
| `harness:ios` | **PASS** | 620 tests / 30 suites + isolated 6 tests / 3 suites | `3da2310e185a` (harness:ios digest) | 14 m 39 s | start 5.8 / med 8.9 / max 23.3 |
| `harness:android` | **PASS** | 678 tests / 31 suites + isolated 6 tests / 3 suites | `3da2310e185a` (harness:android digest) | 18 m 25 s | start 5.8 / med 8.8 / max 23.3 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:android:SearchField` | stale | 18 tests / 1 suites | 5240869ae545 (not this tree) | 23.8 s | start 11.6 / med 10.3 / max 11.6 |

`need --for review`: `need: review is satisfied on this code tree.` The real-input gates are
deliberately left for merge.

## Red proofs

- `SearchField > reads its prompt and clear label in the app's language` -> in
  `SearchFieldStrings.entryFor`, read `Resources.getSystem()` and key the cache on `"device"` —
  the device's configuration, held for the process, which is what the object did before ->
  `expected 'Search…' to be 'Suchen…'` at
  `expect(inGerman.localeHint).toBe('Suchen…')`: the field answered in the device's language
  whatever configuration it was asked for. The `not.toBe(device*)` pair goes red on the same
  mutation, so the case does not depend on the German wording.

## Files changed

- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiSearchField.kt:75`:
  `SearchFieldStrings` resolves for a `Context`, cached per locale list and bounded; the placeholder,
  the clear label and the test state read it through the drawing context; `forLocale` is the seam the
  example app's probe asks through.
- `example/android/app/src/main/java/nitroui/example/NitroUiProbePackage.kt:79`:
  `searchFieldStrings`, which resolves the pair for the app's configuration, for a language tag and
  for the device's, and reports the three locales.
- `example/__tests__/SearchField.harness.tsx:707`: the new case, and the probe's answer on its type.
- `docs/components/search-field.md:156`: which configuration the Android strings come from.
- `docs/tasks/FOLLOWUPS.md`: the resolved `SearchFieldStrings` line removed.
- `.changeset/search-field-strings-app-language.md`: a patch entry.

## Follow-ups

- `HybridNitroUiDatePicker.kt:470`: the compact field's formatter cache keys on `Locale.getDefault()`
  rather than a view's configuration, which is the same device-vs-app language difference in another
  component.
- `SearchFieldStrings.forLocale` is public Kotlin — the example app's probe is another Gradle module
  and cannot reach an `internal` one. Nothing JS-visible: no prop, no spec, no generated change.
- `docs/tasks/FOLLOWUPS.md`: the `SearchFieldStrings` line is gone, since this closes it; the
  other SearchField lines there are untouched, as the brief said.

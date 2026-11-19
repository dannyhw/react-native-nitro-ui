---
'react-native-nitro-ui': patch
---

fix(search-field): its default prompt and clear label follow the app's language

An Android `SearchField` with no `placeholder` said "Search…" and named its clear button in the
device's language, not the app's: the framework's `search_hint` and `searchview_description_clear`
strings were read from `Resources.getSystem()` once per process, which is the device's
configuration. An app shown in another language than the device's, including a per-app language on
Android 13 and later, got the device's words — the clear button's screen-reader label among them.
Both are now resolved for the configuration the field draws in, so an app's own language is what it
says, and the next draw after a language change has the new words. A `placeholder` the app passes
is unchanged, and the English fallbacks stay for a framework without the strings. iOS is unchanged.

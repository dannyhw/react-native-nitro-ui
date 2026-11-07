# Example icon assets

Test fixtures for the `androidIcon` prop of `Button` and `Menu`
(`docs/components/button.md`, "Android icons"). They are the same files an app
would own: `.xml` Android vector drawables, `require`d from JavaScript and
carried by Metro.

| File                                                | Where it comes from                                                                                                           |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `star_24px.xml`, `share_24px.xml`, `close_24px.xml` | Google's [Material Symbols][src], Android vector-drawable format, unedited. Apache 2.0, © Google. Fetched and hash-checked.   |
| `not-a-vector.xml`                                  | Written for this repo. Well-formed XML that is not a vector drawable, so the parser has something wrong to be tested against. |

Nothing here is hand-typed. `scripts/icons/fetch-material-symbols.mjs` writes the
three real files byte for byte from Google's repository at a pinned commit and
records each URL and SHA-256 under `exampleFiles` in
`scripts/icons/material-symbols.lock.json`;
`scripts/__tests__/android-icons.test.js` fails `bun run check` when a shipped
file no longer matches its digest — an edited coordinate, which is the exact
mistake that made SearchField 0.7.0 draw a key instead of a magnifier — or when a
new `.xml` appears here that the script did not write and the test did not
declare. The same rule covers the compiled fixtures in
`example/android/app/src/main/res/drawable*/`, which is where the drawable _names_
`Button.harness.tsx` and `Menu.harness.tsx` use live.

Why the digests are a script's job and not this file's: the bytes a test loads over
Metro, the bytes a release build compiles, and the bytes a screenshot in
`docs/images/` is taken of have to be one file. The JVM parser test
(`android/src/test/java/com/margelo/nitro/nitroui/NitroUiVectorDrawableTest.kt`)
reads `share_24px.xml` from disk, so the same bytes are checked off-line too.

Each file is loaded by a known set of tests, and `close_24px.xml` by exactly one
pair: nitro-ui caches artwork per URL for the process, so a second reader would
draw it in its first frame and quietly turn "the box did not wait for the file"
into a statement about a warm cache.

[src]: https://developers.google.com/fonts/docs/material_symbols

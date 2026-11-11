# Bench glyph fixtures

Two drawings, each in the two formats the arms can load, so every arm of
`mount.icon-button` / `update.icon-button` draws the _same_ glyph on each platform:

| Shape  | Raster (RN core, Expo `Icon`) | Vector (nitro-ui `androidIcon`) | iOS symbol    |
| ------ | ----------------------------- | ------------------------------- | ------------- |
| disc   | `circle.png`                  | `circle-vector.xml`             | `circle.fill` |
| square | `square.png`                  | `square-vector.xml`             | `square.fill` |

They are plain geometric shapes, on purpose. These are benchmark fixtures, not
iconography: the library's own glyphs are official Material Symbols files and stay
in `android/src/main/res/drawable/` (DECISIONS D43), and nothing here is presented
as an icon an app would ship. The PNGs are 72 px so a 3× screen has real pixels for
the 24 dp box every arm asks for; the RN-core arm still has to size its `Image`
explicitly, which is part of what that floor costs.

The two formats do not share a stem. Android names a drawable after the `require` path
plus the file name without its extension, so `assets/circle.png` and `assets/circle.xml`
would be one resource name and aapt would call it a duplicate — hence `-vector` (X25,
which found the bench app could not bundle at all: the requires named
`bench/src/assets/`, a folder that has never existed).

The raster exists because RN's `Image` has no vector path on iOS and refuses an
Android `.xml` asset from the dev server; nitro-ui refuses a PNG by design. No one
format covers both, so the fixture ships both.

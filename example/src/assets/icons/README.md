# Example icon assets

Test fixtures for the `androidIcon` prop of `Button`
(`docs/components/button.md`, "Android icons"). They are the same files an app
would own: `.xml` Android vector drawables, `require`d from JavaScript and
carried by Metro.

| File                              | Where it comes from                                                                                                           |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `share_24px.xml`, `star_24px.xml` | Google's [Material Symbols][src], Android vector-drawable format, unedited. Apache 2.0, © Google. Not hand-typed (D43).       |
| `not-a-vector.xml`                | Written for this repo. Well-formed XML that is not a vector drawable, so the parser has something wrong to be tested against. |

The two real files are read by `android/src/test/.../NitroUiVectorDrawableTest.kt`
— the same bytes the emulator loads over Metro — and their digests are:

```
e68cc51976886c8395e3317d8bea0b8324e98d365ed8a15fc8c67767c2241931  share_24px.xml
49d8cf2a439f18bcafc0c9e765ac04cf52edc7105f82c637c50b4e8890fd00b2  star_24px.xml
```

`shasum -a 256 example/src/assets/icons/*.xml` says whether a file has been
edited since this digest was taken: an edited Material Symbol is exactly the
thing D43 retires, and the digest is how anyone can check the claim in one
command. The same byte string is what the two harness tests load over Metro, so
a fixture that has been quietly redrawn shows up here first.

[src]: https://developers.google.com/fonts/docs/material_symbols

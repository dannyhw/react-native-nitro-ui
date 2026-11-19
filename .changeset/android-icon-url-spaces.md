---
'react-native-nitro-ui': patch
---

`androidIcon`: an asset `require`d from a folder whose name holds a space, a `#`, or a `%` that is
not the start of an escape draws in development as it does in a release build. The URL Metro serves
it at is quoted per path segment on the way to the network: a `#` is quoted, so it stays part of the
file's name, and a `%` is quoted only when two hex digits do not follow it. A URL that is already
quoted goes over as it is, which is why two development names still draw nothing: one with a `?` in a
folder or file name, read as the start of the query, and one whose own name looks like an escape
(`icons/a%41b/`), which Metro reads as the decoded `aAb` and answers with nothing. A `#` in a URL the
app writes itself starts a fragment, which is not asked for. A file that really is missing is still
reported once and left undrawn.

---
'react-native-nitro-ui': patch
---

`androidIcon`: an asset `require`d from a folder whose name holds a space, a `#`, or a `%` that is
not the start of an escape draws in development as it does in a release build. The URL Metro serves
it at is quoted per path segment on the way to the network: a `#` is quoted, so it stays part of the
file's name, and a `%` is quoted only when two hex digits do not follow it. A URL that is already
quoted goes over as it is, which is also why a folder whose name itself looks like an escape
(`icons/a%41b/`) draws nothing — Metro serves it under the decoded `aAb`. A file that really is
missing is still reported once and left undrawn.

---
'react-native-nitro-ui': patch
---

`androidIcon`: an asset `require`d from a folder whose name holds a space, a `#` or a `%` draws in
development as it does in a release build. The URL Metro serves it at is quoted per path segment on
the way to the network, so the request names that file. A URL that is already quoted goes over as
it is, and a file that really is missing is still reported once and left undrawn.

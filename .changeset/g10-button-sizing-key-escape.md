---
'react-native-nitro-ui': patch
---

A `Button` is no longer ever laid out at another `Button`'s width. Its size-configuration key joins four fields with a `|`, and the icon name and title are free-form, so a title containing that character could move the boundary between two fields: an icon named `x|a` with the title `b` and an icon named `x` with the title `a|b` both built one key, and the two buttons have different widths — the second was measured once and then answered from the first one's cache entry for the rest of the process. Both fields are escaped on the way in now (`\` becomes `\\`, `|` becomes `\|`), which is what the `Menu` trigger, `Picker` options and `SegmentedControl` labels already did. Titles and icon names without either character build exactly the key they built before, so nothing that was already correct re-measures.

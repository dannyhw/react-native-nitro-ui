---
'react-native-nitro-ui': patch
---

Android `IconButton`/`IconToggleButton`: an `outlined` control with a `tintColor` draws its border
the way Material draws one — the tint at full strength while enabled, the same colour at Material's
disabled strength while disabled, and no border at all on a toggle that is on. Material's own border
answers the width and the strength for the state, and the control's tint supplies the colour. The
`outlined` border without a `tintColor` follows the control's state as well: the calls that asked
Material for its default border handed it a disabled flag where its parameter is `enabled`, and the
toggle's two arguments were swapped, so an enabled control read the disabled answer and a toggle
that is on read the unchecked one.

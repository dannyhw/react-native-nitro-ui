---
'react-native-nitro-ui': patch
---

Android `IconButton`/`IconToggleButton`: an `outlined` control with a `tintColor` draws its border
the way Material draws one — the tint at full strength while enabled, the same colour dimmed while
disabled, and no border at all on a toggle that is on. Until now a tinted border kept Material's
width but was always painted in the full tint, so a disabled button still looked enabled and a
toggle that was on wore a ring of its own.

An `outlined` control with no `tintColor` shows its ring at the strength Material gives that state
too. The two looked the other way round before: an enabled button drew its ring as faintly as a
disabled one, and a disabled button drew it at full strength. The toggle form was wrong in the same
way — a full ring while switched on and a faint one while off, where Material draws a ring only
while off, and no ring at all while disabled, where Material draws a faint one.

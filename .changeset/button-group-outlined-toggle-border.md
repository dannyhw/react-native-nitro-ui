---
'react-native-nitro-ui': patch
---

`ButtonGroup`: on Android an `outlined` toggle item now draws the outline Material draws for its
state. An untinted one drew no outline at all; a tinted one drew the full tint in every state, so it
stayed at full strength while disabled and wore a ring while switched on where Material draws none. A
tinted `text` item wore that ring too, though `text` has no outline. A tint now changes only the
colour: Material's width and its strength per state are kept, and where Material draws no outline none
is drawn. Other variants, sizes and layout are unchanged.

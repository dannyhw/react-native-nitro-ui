---
'react-native-nitro-ui': patch
---

iOS now says out loud an SF Symbol name it cannot draw. `Button`, `Chip`, `IconButton`,
`ListItem`, a `Menu` trigger, and the items and rows of `ButtonGroup`, `Menu` and `ContextMenu`
take an SF Symbol name in `systemImage`, and a name with no symbol on the device - a typo, or a
symbol newer than the device's iOS - drew nothing without a word about it. In a development build
the name is looked up on the device and one warning per component and name says which control was
given it and where:

  nitro-ui: Button's systemImage "square.and.arrow.up.up" is not an SF Symbol this iOS can draw.
  Nothing will be drawn for it. See docs/components/button.md, "SF Symbols".

A release build looks nothing up and warns nothing, and what is drawn for a good name and a bad
one is unchanged. Android's `androidIcon` warnings are as they were.

---
'react-native-nitro-ui': patch
---

`Form`, `Stepper` and `Checkbox` fixes.

- **A `Form` row on iOS no longer presses when you scroll past it.** A drag that began on a row with `onPress` scrolled the list _and_ fired the row's press, so a flick could take you to the screen behind the row as well as down the page. A row now presses only when the finger stays on it, as Android's rows already did.
- **A screen-reader step on `Stepper` reads the number the control published.** On a range whose stops are not exact in binary — any `0.1` grid — a reader asking for the value already on screen was read as one step up: the control moved and announced a number nobody asked for. It now answers with nothing, as it does on every other range.
- **`Stepper`'s `defaultValue` and its first `value` now agree about where the control started.** The first controlled write could be dropped when it asked for the bottom of the range, leaving the screen showing the default while React held something else.
- **A `Stepper`'s top of the track is tidied the way its value is.** With `maximumValue = 0.1 + 0.2` the raw prop is a binary hair above the top stop, and iOS kept the plus half live at the end of the track; it is now disabled there, like every other bound.
- **iOS says the third checkbox state as the English word "mixed" in every locale**, and `docs/components/checkbox.md` now says so plainly: iOS publishes no localised string for a checkbox in a mixed state, so there is nothing to hand a reader instead. Android's word comes from Compose's own string resource and is localised.
